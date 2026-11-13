from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from pyvrp import Client, Depot, Location, ProblemData, VehicleType, solve
from pyvrp.stop import MaxRuntime

from routeopt.algorithms.base import (
    ProgressCallback,
    ProgressEvent,
    Solver,
    SolveResult,
    SolverParams,
    Stopwatch,
    register_solver,
)
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import (
    COEF_COST,
    COEF_TIME,
    COEF_VEHICLES,
    additive_coefs,
    evaluate,
)
from routeopt.core.types import Instance, Penalties, RouteSet

SPACE_SCALE = 100
LOAD_SCALE = 1000
COST_TARGET = 1000.0
UNBOUNDED = 10**13
UNBOUNDED_LOAD = 10**12
FINITE_CAPACITY_LIMIT = 1e8
EPS = 1e-6


@dataclass(slots=True)
class Translation:
    data: ProblemData
    pools: list[list[int]]


def scaled_matrix(matrix: Any) -> Any:
    return np.rint(np.asarray(matrix) * SPACE_SCALE).astype(np.int64)


def finite_dimension(capacity: Any) -> bool:
    return bool(np.all(np.isfinite(capacity)) and np.all(capacity < FINITE_CAPACITY_LIMIT))


def load_units(value: float) -> int:
    return math.ceil(round(value * LOAD_SCALE, 6))


def capacity_units(value: float) -> int:
    if not math.isfinite(value) or value >= FINITE_CAPACITY_LIMIT:
        return UNBOUNDED_LOAD
    return math.floor(round(value * LOAD_SCALE, 6) + EPS)


def reachable_deadline(inst: Instance, stop: int) -> float:
    earliest = inst.shift_start + inst.dur[inst.n : inst.n + inst.m, stop] * inst.speed_factor
    return float(earliest.min())


def client_window(inst: Instance, stop: int) -> tuple[int, int]:
    if not inst.tw_enabled:
        return 0, UNBOUNDED
    early = math.ceil(round(float(inst.tw_start[stop]) * SPACE_SCALE, 6))
    if not math.isfinite(inst.tw_end[stop]):
        return early, UNBOUNDED
    late = math.floor(round(float(inst.tw_end[stop]) * SPACE_SCALE, 6))
    floor_late = math.ceil(reachable_deadline(inst, stop) * SPACE_SCALE)
    return early, max(late, floor_late, early)


def unit_costs(inst: Instance, penalties: Penalties | None) -> tuple[Any, Any, float]:
    coef = additive_coefs(inst, penalties)
    per_dist = coef[COEF_COST] * inst.cost_per_km / SPACE_SCALE
    per_time = (coef[COEF_TIME] + coef[COEF_COST] * inst.cost_per_min) / SPACE_SCALE
    peak = max(float(per_dist.max()), float(per_time.max()), 1e-12)
    return per_dist, per_time, COST_TARGET / peak


def shares_depot(inst: Instance) -> bool:
    starts = slice(inst.n, inst.n + inst.m)
    ends = slice(inst.n + inst.m, inst.n + 2 * inst.m)
    rows_equal = all(np.all(a[starts] == a[inst.n]) for a in (inst.dist, inst.dur))
    cols_equal = all(np.all(a[:, ends] == a[:, [inst.n + inst.m]]) for a in (inst.dist, inst.dur))
    start_to_end = bool(np.all(inst.dist[inst.n, ends] == inst.dist[inst.n, inst.n + inst.m]))
    return bool(rows_equal and cols_equal and start_to_end and not inst.open_end.any())


def vehicle_key(inst: Instance, k: int, depot_mode: bool) -> tuple[Any, ...]:
    nodes = (0, 0) if depot_mode else (inst.n + k, inst.n + inst.m + k)
    return (
        nodes,
        inst.cap_kg[k],
        inst.cap_m3[k],
        inst.shift_start[k],
        inst.max_shift[k],
        inst.speed_factor[k],
        inst.cost_per_km[k],
        inst.cost_per_min[k],
        inst.fixed_cost[k],
        bool(inst.open_end[k]),
    )


def build_problem_data(inst: Instance, penalties: Penalties | None) -> Translation:
    n, m = inst.n, inst.m
    size = n + 2 * m
    coords = inst.coords if inst.coords.shape[0] == size else np.zeros((size, 2))
    locations = [Location(x=float(c[1]), y=float(c[0])) for c in coords]
    use_kg = finite_dimension(inst.cap_kg)
    use_m3 = finite_dimension(inst.cap_m3)
    clients = []
    for i in range(n):
        delivery = []
        if use_kg:
            delivery.append(load_units(float(inst.demand_kg[i])))
        if use_m3:
            delivery.append(load_units(float(inst.demand_m3[i])))
        early, late = client_window(inst, i)
        clients.append(
            Client(
                location=i,
                delivery=delivery,
                service_duration=round(float(inst.service[i]) * SPACE_SCALE),
                tw_early=early,
                tw_late=late,
            )
        )
    depot_mode = shares_depot(inst)
    keys = [vehicle_key(inst, k, depot_mode) for k in range(m)]
    unique: dict[tuple[Any, ...], list[int]] = {}
    for k, key in enumerate(keys):
        unique.setdefault(key, []).append(k)
    depot_nodes: list[int] = []

    def depot_index(node: int) -> int:
        if node not in depot_nodes:
            depot_nodes.append(node)
        return depot_nodes.index(node)

    per_dist, per_time, scale = unit_costs(inst, penalties)
    coef = additive_coefs(inst, penalties)
    speeds = sorted({float(s) for s in inst.speed_factor})
    vehicle_types: list[VehicleType] = []
    pools: list[list[int]] = []
    for members in unique.values():
        k = members[0]
        start_node = inst.n + k if keys[k][0][0] else inst.n
        end_node = inst.n + m + k if keys[k][0][1] else inst.n + m
        capacity = []
        if use_kg:
            capacity.append(capacity_units(float(inst.cap_kg[k])))
        if use_m3:
            capacity.append(capacity_units(float(inst.cap_m3[k])))
        shift_start = round(float(inst.shift_start[k]) * SPACE_SCALE)
        duration = (
            UNBOUNDED
            if not math.isfinite(inst.max_shift[k])
            else round(float(inst.max_shift[k]) * SPACE_SCALE)
        )
        fixed = coef[COEF_COST] * inst.fixed_cost[k] + coef[COEF_VEHICLES]
        vehicle_types.append(
            VehicleType(
                num_available=len(members),
                capacity=capacity,
                start_depot=depot_index(start_node),
                end_depot=depot_index(end_node),
                fixed_cost=round(float(fixed) * scale),
                tw_early=shift_start,
                tw_late=UNBOUNDED,
                shift_duration=duration,
                unit_distance_cost=round(float(per_dist[k]) * scale),
                unit_duration_cost=round(float(per_time[k]) * scale),
                profile=speeds.index(float(inst.speed_factor[k])),
                start_late=shift_start,
            )
        )
        pools.append(members)
    depots = [Depot(location=node) for node in depot_nodes]
    dist = scaled_matrix(inst.dist)
    durations = [scaled_matrix(inst.dur * s) for s in speeds]
    data = ProblemData(
        locations=locations,
        clients=clients,
        depots=depots,
        vehicle_types=vehicle_types,
        distance_matrices=[dist for _ in speeds],
        duration_matrices=durations,
    )
    return Translation(data=data, pools=pools)


def routes_from_solution(inst: Instance, translation: Translation, best: Any) -> RouteSet:
    queues = [list(pool) for pool in translation.pools]
    routes: list[list[int]] = [[] for _ in range(inst.m)]
    for route in best.routes():
        vehicle = queues[route.vehicle_type()].pop(0)
        routes[vehicle] = [a.idx for a in route.schedule() if a.is_client()]
    return RouteSet(routes, [])


@register_solver
class PyVrpSolver(Solver):
    name = "pyvrp"
    label = "PyVRP (HGS baseline)"
    params_model = SolverParams
    multi_objective = False

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        watch = Stopwatch(self.params.time_limit_s)
        baseline = warm_start[0] if warm_start else nearest_neighbor(inst)
        current = evaluate(inst, baseline, penalties)
        history = [(0, 0.0, current.fitness)]
        if callback is not None and not callback(
            ProgressEvent(0, watch.elapsed, current.fitness, current, best=baseline)
        ):
            return SolveResult(self.name, baseline, current, watch.elapsed, 0, history)
        translation = build_problem_data(inst, penalties)
        seed = 0 if self.params.seed is None else self.params.seed
        remaining = max(0.05, self.params.time_limit_s - watch.elapsed)
        result = solve(translation.data, stop=MaxRuntime(remaining), seed=seed, display=False)
        routes = routes_from_solution(inst, translation, result.best)
        evaluation = evaluate(inst, routes, penalties)
        history.append((int(result.num_iterations), watch.elapsed, evaluation.fitness))
        if callback is not None:
            callback(
                ProgressEvent(
                    int(result.num_iterations),
                    watch.elapsed,
                    evaluation.fitness,
                    evaluation,
                    best=routes,
                )
            )
        return SolveResult(
            self.name,
            routes,
            evaluation,
            watch.elapsed,
            int(result.num_iterations),
            history,
        )
