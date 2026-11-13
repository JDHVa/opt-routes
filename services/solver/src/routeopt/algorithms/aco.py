from __future__ import annotations

from typing import Any, ClassVar

import numba
import numpy as np
from pydantic import Field

from routeopt.algorithms.base import (
    ProgressCallback,
    ProgressEvent,
    Solver,
    SolveResult,
    SolverParams,
    Stopwatch,
    register_solver,
)
from routeopt.algorithms.init import initial_routesets
from routeopt.algorithms.local_search import improve
from routeopt.core.evaluate import additive_coefs, evaluate, route_additive, route_args, route_eval
from routeopt.core.types import F64, I64, Evaluation, Instance, Penalties, RouteSet

TOLERANCE = 1e-9
DIST_EPS = 1e-3
URGENCY_HORIZON_MIN = 120.0
BRANCHING_LAMBDA = 0.05
BRANCHING_RESTART = 1.05
CONVERGENCE_P_BEST = 0.05
NEW_VEHICLE_PROBABILITY = 0.02
SEED_RANGE = 2**31 - 1


class AcoParams(SolverParams):
    n_ants: int = Field(default=20, ge=1)
    alpha: float = Field(default=1.0, ge=0)
    beta: float = Field(default=3.0, ge=0)
    rho: float = Field(default=0.1, gt=0, lt=1)
    q0: float = Field(default=0.9, ge=0, le=1)
    cand_k: int = Field(default=15, ge=1)
    tw_weight: float = Field(default=1.0, ge=0)
    ls_ants: int = Field(default=5, ge=0)
    stagnation_iterations: int = Field(default=40, ge=1)


@numba.njit(cache=True)
def _route_value(k: int, route: Any, ra: Any, cap_kg: Any, cap_m3: Any, coef: Any) -> float:
    if route.shape[0] == 0:
        return 0.0
    _, duration, _, kg, m3, late, overtime, cost = route_eval(k, route, *ra)
    return route_additive(
        duration,
        cost,
        True,
        max(0.0, kg - cap_kg[k]),
        max(0.0, m3 - cap_m3[k]),
        late,
        overtime,
        coef,
    )


@numba.njit(cache=True)
def _step_feasible(
    k: int,
    cur: int,
    j: int,
    t_k: float,
    kg_k: float,
    m3_k: float,
    ra: Any,
    cap_kg: Any,
    cap_m3: Any,
) -> tuple[bool, float, float]:
    n, m = ra[0], ra[1]
    dur, service, tw_start, tw_end = ra[3], ra[4], ra[5], ra[6]
    demand_kg, demand_m3 = ra[8], ra[9]
    shift_start, max_shift, speed_factor = ra[10], ra[11], ra[12]
    open_end, tw_enabled = ra[16], ra[17]
    if kg_k + demand_kg[j] > cap_kg[k] + TOLERANCE:
        return False, 0.0, 0.0
    if m3_k + demand_m3[j] > cap_m3[k] + TOLERANCE:
        return False, 0.0, 0.0
    sf = speed_factor[k]
    begin = t_k + dur[cur, j] * sf
    if tw_enabled:
        begin = max(begin, tw_start[j])
        if begin > tw_end[j] + TOLERANCE:
            return False, 0.0, 0.0
    finish = begin + service[j]
    back = 0.0 if open_end[k] else dur[j, n + m + k] * sf
    if finish + back - shift_start[k] > max_shift[k] + TOLERANCE:
        return False, 0.0, 0.0
    return True, begin, finish


@numba.njit(cache=True)
def _choose_stop(
    k: int,
    cur: int,
    t_k: float,
    kg_k: float,
    m3_k: float,
    visited: Any,
    tau_a: Any,
    eta_b: Any,
    cand: Any,
    ra: Any,
    cap_kg: Any,
    cap_m3: Any,
    beta: float,
    q0: float,
    tw_weight: float,
    scores: Any,
    picks: Any,
    finishes: Any,
) -> tuple[int, float]:
    n = ra[0]
    tw_end, tw_enabled = ra[6], ra[17]
    for phase in range(2):
        limit = cand.shape[1] if phase == 0 else n
        count = 0
        total = 0.0
        for c in range(limit):
            j = cand[cur, c] if phase == 0 else c
            if visited[j]:
                continue
            ok, begin, finish = _step_feasible(k, cur, j, t_k, kg_k, m3_k, ra, cap_kg, cap_m3)
            if not ok:
                continue
            score = tau_a[cur, j] * eta_b[cur, j]
            if tw_enabled and tw_weight > 0.0:
                slack = tw_end[j] - begin
                urgency = 1.0 + tw_weight * max(0.0, 1.0 - slack / URGENCY_HORIZON_MIN)
                score *= urgency**beta
            scores[count] = score
            picks[count] = j
            finishes[count] = finish
            total += score
            count += 1
        if count == 0:
            continue
        chosen = 0
        if np.random.random() >= q0 or total <= 0.0:
            best_score = -1.0
            for c in range(count):
                if scores[c] > best_score:
                    best_score = scores[c]
                    chosen = c
        else:
            r = np.random.random() * total
            acc = 0.0
            chosen = count - 1
            for c in range(count):
                acc += scores[c]
                if acc >= r:
                    chosen = c
                    break
        return picks[chosen], finishes[chosen]
    return -1, 0.0


@numba.njit(cache=True)
def _pick_vehicle(t: Any, closed: Any, used: Any, visited: Any, ra: Any, open_prob: float) -> int:
    n, m = ra[0], ra[1]
    dist = ra[2]
    has_used_open = False
    has_unused_open = False
    for k in range(m):
        if closed[k]:
            continue
        if used[k]:
            has_used_open = True
        else:
            has_unused_open = True
    if not has_used_open and not has_unused_open:
        return -1
    open_new = False
    if has_unused_open:
        open_new = (not has_used_open) or np.random.random() < open_prob
    if open_new:
        best_k = -1
        best_d = np.inf
        for k in range(m):
            if closed[k] or used[k]:
                continue
            nearest = np.inf
            for j in range(n):
                if not visited[j] and dist[n + k, j] < nearest:
                    nearest = dist[n + k, j]
            if best_k < 0 or nearest < best_d:
                best_d = nearest
                best_k = k
        return best_k
    best_k = -1
    best_t = np.inf
    for k in range(m):
        if closed[k]:
            continue
        if has_used_open and not used[k]:
            continue
        if t[k] < best_t:
            best_t = t[k]
            best_k = k
    return best_k


@numba.njit(cache=True)
def _insert_leftovers(
    mat: Any, cnt: Any, visited: Any, ra: Any, cap_kg: Any, cap_m3: Any, coef: Any
) -> None:
    n, m = ra[0], ra[1]
    values = np.zeros(m)
    for k in range(m):
        values[k] = _route_value(k, mat[k, : cnt[k]], ra, cap_kg, cap_m3, coef)
    for stop in range(n):
        if visited[stop]:
            continue
        best_delta = np.inf
        best_k = 0
        best_p = 0
        best_value = 0.0
        for k in range(m):
            c = cnt[k]
            for p in range(c + 1):
                trial = np.empty(c + 1, dtype=np.int64)
                trial[:p] = mat[k, :p]
                trial[p] = stop
                trial[p + 1 :] = mat[k, p:c]
                value = _route_value(k, trial, ra, cap_kg, cap_m3, coef)
                delta = value - values[k]
                if delta < best_delta:
                    best_delta = delta
                    best_k = k
                    best_p = p
                    best_value = value
        c = cnt[best_k]
        for q in range(c, best_p, -1):
            mat[best_k, q] = mat[best_k, q - 1]
        mat[best_k, best_p] = stop
        cnt[best_k] = c + 1
        values[best_k] = best_value
        visited[stop] = True


@numba.njit(cache=True)
def _construct_batch(
    seeds: Any,
    tau_a: Any,
    eta_b: Any,
    cand: Any,
    ra: Any,
    cap_kg: Any,
    cap_m3: Any,
    coef: Any,
    beta: float,
    q0: float,
    tw_weight: float,
    open_prob: float,
) -> tuple[Any, Any]:
    n, m = ra[0], ra[1]
    shift_start = ra[10]
    demand_kg, demand_m3 = ra[8], ra[9]
    ants = seeds.shape[0]
    mats = np.zeros((ants, m, n), dtype=np.int64)
    cnts = np.zeros((ants, m), dtype=np.int64)
    scores = np.empty(n)
    picks = np.empty(n, dtype=np.int64)
    finishes = np.empty(n)
    for a in range(ants):
        np.random.seed(seeds[a])
        visited = np.zeros(n, dtype=np.bool_)
        cur = np.arange(n, n + m)
        t = shift_start.copy()
        kg = np.zeros(m)
        m3 = np.zeros(m)
        closed = np.zeros(m, dtype=np.bool_)
        used = np.zeros(m, dtype=np.bool_)
        remaining = n
        while remaining > 0:
            k = _pick_vehicle(t, closed, used, visited, ra, open_prob)
            if k < 0:
                break
            j, finish = _choose_stop(
                k,
                cur[k],
                t[k],
                kg[k],
                m3[k],
                visited,
                tau_a,
                eta_b,
                cand,
                ra,
                cap_kg,
                cap_m3,
                beta,
                q0,
                tw_weight,
                scores,
                picks,
                finishes,
            )
            if j < 0:
                closed[k] = True
                continue
            mats[a, k, cnts[a, k]] = j
            cnts[a, k] += 1
            visited[j] = True
            remaining -= 1
            used[k] = True
            cur[k] = j
            t[k] = finish
            kg[k] += demand_kg[j]
            m3[k] += demand_m3[j]
        if remaining > 0:
            _insert_leftovers(mats[a], cnts[a], visited, ra, cap_kg, cap_m3, coef)
    return mats, cnts


def _to_routeset(mat: I64, cnt: I64, unassigned: list[int] | None = None) -> RouteSet:
    routes = [mat[k, : int(cnt[k])].tolist() for k in range(mat.shape[0])]
    return RouteSet(routes, list(unassigned) if unassigned else [])


def node_keys(inst: Instance) -> list[str]:
    return [*inst.stop_ids, *(f"start:{driver_id}" for driver_id in inst.driver_ids)]


def map_pheromone(
    old: F64, old_keys: list[str], new_keys: list[str], n_new: int, fill: float
) -> F64:
    mapped = np.full((len(new_keys), n_new), fill, dtype=np.float64)
    old_index = {key: idx for idx, key in enumerate(old_keys)}
    old_cols = old.shape[1]
    rows_new = [i for i, key in enumerate(new_keys) if key in old_index]
    rows_old = [old_index[new_keys[i]] for i in rows_new]
    cols_new = [i for i in range(n_new) if old_index.get(new_keys[i], old_cols) < old_cols]
    cols_old = [old_index[new_keys[i]] for i in cols_new]
    if rows_new and cols_new:
        mapped[np.ix_(rows_new, cols_new)] = old[np.ix_(rows_old, cols_old)]
    return mapped


class AntColony:
    def __init__(
        self,
        inst: Instance,
        params: AcoParams,
        rng: np.random.Generator,
        penalties: Penalties | None = None,
    ) -> None:
        self.inst = inst
        self.params = params
        self.rng = rng
        self.penalties = penalties
        self.coef = additive_coefs(inst, penalties)
        self.args = route_args(inst)
        self.open_prob = NEW_VEHICLE_PROBABILITY
        rows = inst.n + inst.m
        base = inst.dist[:rows, : inst.n].copy()
        for i in range(inst.n):
            base[i, i] = np.inf
        width = max(1, min(params.cand_k, inst.n - 1))
        self.cand: I64 = np.argsort(base, axis=1, kind="stable")[:, :width].astype(np.int64)
        self.eta_beta: F64 = (1.0 / (inst.dist[:rows, : inst.n] + DIST_EPS)) ** params.beta
        self.pheromone: F64 = np.ones((rows, inst.n), dtype=np.float64)
        self.tau_max = 1.0
        self.tau_min = 0.5
        self.iteration = 0
        self.since_restart = 0
        self.since_improvement = 0
        self._best: tuple[RouteSet, Evaluation] | None = None

    def best(self) -> tuple[RouteSet, Evaluation]:
        if self._best is None:
            raise RuntimeError("no solution registered yet")
        return self._best[0].copy(), self._best[1]

    def reset(self) -> None:
        self.pheromone[:] = self.tau_max
        self.since_restart = 0
        self.since_improvement = 0

    def branching(self) -> float:
        rows = np.arange(self.pheromone.shape[0])[:, None]
        values = self.pheromone[rows, self.cand]
        threshold = self.tau_min + BRANCHING_LAMBDA * (self.tau_max - self.tau_min)
        return float(np.mean(np.sum(values > threshold, axis=1)))

    def import_state(self, pheromone: F64, keys: list[str]) -> None:
        self.pheromone = map_pheromone(
            np.asarray(pheromone, dtype=np.float64),
            keys,
            node_keys(self.inst),
            self.inst.n,
            self.tau_max,
        )

    def seed(
        self,
        routesets: list[RouteSet],
        pheromone: F64 | None = None,
        keys: list[str] | None = None,
    ) -> None:
        evals = [evaluate(self.inst, rs, self.penalties) for rs in routesets]
        for rs, ev in zip(routesets, evals, strict=True):
            self._register_best(rs, ev)
        self.pheromone[:] = self.tau_max
        if pheromone is not None and keys is not None:
            self.import_state(pheromone, keys)
        for rs, ev in zip(routesets, evals, strict=True):
            self._deposit(rs, 1.0 / max(ev.fitness, TOLERANCE))
        self._clip()

    def construct(self, n_ants: int) -> list[RouteSet]:
        inst = self.inst
        if inst.m == 0:
            return [RouteSet([], list(range(inst.n))) for _ in range(n_ants)]
        seeds = self.rng.integers(0, SEED_RANGE, size=n_ants).astype(np.int64)
        tau_a = self.pheromone if self.params.alpha == 1.0 else self.pheromone**self.params.alpha
        mats, cnts = _construct_batch(
            seeds,
            tau_a,
            self.eta_beta,
            self.cand,
            self.args,
            inst.cap_kg,
            inst.cap_m3,
            self.coef,
            self.params.beta,
            self.params.q0,
            self.params.tw_weight,
            self.open_prob,
        )
        return [_to_routeset(mats[a], cnts[a]) for a in range(n_ants)]

    def update(
        self, routesets: list[RouteSet], evaluations: list[Evaluation] | None = None
    ) -> None:
        evals = evaluations or [evaluate(self.inst, rs, self.penalties) for rs in routesets]
        iteration_best = int(np.argmin([ev.fitness for ev in evals]))
        improved = self._register_best(routesets[iteration_best], evals[iteration_best])
        self.iteration += 1
        self.since_restart += 1
        self.since_improvement = 0 if improved else self.since_improvement + 1
        if self._best is None:
            return
        if self._use_global():
            source, fitness = self._best[0], self._best[1].fitness
        else:
            source, fitness = routesets[iteration_best], evals[iteration_best].fitness
        self.pheromone *= 1.0 - self.params.rho
        self._deposit(source, 1.0 / max(fitness, TOLERANCE))
        self._clip()
        if (
            self.since_improvement >= self.params.stagnation_iterations
            or self.branching() < BRANCHING_RESTART
        ):
            self.reset()

    def _use_global(self) -> bool:
        r = self.since_restart
        if r < 10:
            return False
        if r < 30:
            period = 5
        elif r < 70:
            period = 3
        elif r < 120:
            period = 2
        else:
            period = 1
        return r % period == 0

    def _register_best(self, rs: RouteSet, ev: Evaluation) -> bool:
        if self._best is not None and ev.fitness >= self._best[1].fitness - TOLERANCE:
            return False
        self._best = (rs.copy(), ev)
        self._set_limits(ev.fitness)
        return True

    def _set_limits(self, fitness: float) -> None:
        self.tau_max = 1.0 / (self.params.rho * max(fitness, TOLERANCE))
        avg = float(self.cand.shape[1])
        root = CONVERGENCE_P_BEST ** (1.0 / max(self.inst.n, 1))
        ratio = (1.0 - root) / (max(avg - 1.0, 1.0) * root)
        self.tau_min = self.tau_max * min(ratio, 1.0)

    def _deposit(self, rs: RouteSet, amount: float) -> None:
        n = self.inst.n
        rows: list[int] = []
        cols: list[int] = []
        for k, route in enumerate(rs.routes):
            prev = n + k
            for stop in route:
                rows.append(prev)
                cols.append(stop)
                prev = stop
        if rows:
            self.pheromone[rows, cols] += amount

    def _clip(self) -> None:
        np.clip(self.pheromone, self.tau_min, self.tau_max, out=self.pheromone)


@register_solver
class AcoSolver(Solver):
    name: ClassVar[str] = "aco"
    label: ClassVar[str] = "Ant Colony (MAX-MIN)"
    params_model: ClassVar[type[SolverParams]] = AcoParams
    multi_objective: ClassVar[bool] = False

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        params = self.params
        assert isinstance(params, AcoParams)
        watch = Stopwatch(params.time_limit_s)
        rng = np.random.default_rng(params.seed)
        colony = AntColony(inst, params, rng, penalties)
        starts = initial_routesets(inst, params.init, 1, rng, penalties)
        starts.extend(rs.copy() for rs in warm_start or [])
        if state and "node_keys" in state and "pheromone" in state:
            colony.seed(starts, state["pheromone"], list(state["node_keys"]))
        else:
            colony.seed(starts)
        history: list[tuple[int, float, float]] = []
        iteration = 0
        stopped = False
        while iteration < params.max_iterations and not watch.expired():
            ants = colony.construct(params.n_ants)
            evals = [evaluate(inst, rs, penalties) for rs in ants]
            if params.local_search and params.ls_ants > 0:
                order = np.argsort([ev.fitness for ev in evals], kind="stable")
                for idx in order[: params.ls_ants]:
                    polished = improve(inst, ants[idx], penalties, rng)
                    ants[idx] = polished
                    evals[idx] = evaluate(inst, polished, penalties)
            colony.update(ants, evals)
            iteration += 1
            if iteration % params.progress_every == 0:
                history.append((iteration, watch.elapsed, colony.best()[1].fitness))
                if callback is not None and not self._emit(
                    callback, colony, evals, iteration, watch
                ):
                    stopped = True
                    break
        best_rs, best_ev = colony.best()
        if not history or history[-1][0] != iteration:
            history.append((iteration, watch.elapsed, best_ev.fitness))
        if callback is not None and not stopped:
            self._emit(callback, colony, [], iteration, watch)
        return SolveResult(
            algorithm=self.name,
            best=best_rs,
            evaluation=best_ev,
            runtime_s=watch.elapsed,
            iterations=iteration,
            history=history,
            state={"pheromone": colony.pheromone.copy(), "node_keys": node_keys(inst)},
        )

    @staticmethod
    def _emit(
        callback: ProgressCallback,
        colony: AntColony,
        evals: list[Evaluation],
        iteration: int,
        watch: Stopwatch,
    ) -> bool:
        best_rs, best_ev = colony.best()
        avg = float(np.mean([ev.fitness for ev in evals])) if evals else best_ev.fitness
        return callback(
            ProgressEvent(
                iteration=iteration,
                elapsed_s=watch.elapsed,
                best_fitness=best_ev.fitness,
                best_eval=best_ev,
                best=best_rs,
                extra={
                    "avg_fitness": avg,
                    "branching": colony.branching(),
                    "tau_max": colony.tau_max,
                    "tau_min": colony.tau_min,
                },
            )
        )
