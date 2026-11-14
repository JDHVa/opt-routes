from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field

from routeopt.algorithms.aco import AcoParams, AntColony, node_keys
from routeopt.algorithms.base import (
    ProgressCallback,
    ProgressEvent,
    Solver,
    SolveResult,
    SolverParams,
    Stopwatch,
    register_solver,
)
from routeopt.algorithms.ga import GaParams, GeneticEngine
from routeopt.algorithms.init import initial_routesets
from routeopt.algorithms.local_search import improve
from routeopt.algorithms.progress import (
    STAGE_COOPERATING,
    STAGE_FINISHED,
    STAGE_SEEDING,
    ProgressGate,
)
from routeopt.core.evaluate import evaluate
from routeopt.core.types import Evaluation, Instance, Penalties, RouteSet

SEED_LS_TIME_SHARE = 0.15
IMPROVEMENT_EPS = 1e-9
GA_STALL_CYCLES = 3
ACO_IDLE_CYCLES = 8
MIN_ANTS = 2


class HybridParams(SolverParams):
    pop_size: int = Field(default=40, ge=4, le=1000)
    ga_generations_per_cycle: int = Field(default=10, ge=1, le=200)
    ants_per_cycle: int = Field(default=10, ge=1, le=500)
    elite_deposit: int = Field(default=3, ge=1, le=50)
    inject_k: int = Field(default=3, ge=1, le=50)
    seed_ants: int | None = Field(default=None, ge=0, le=5000)
    ls_ants: int = Field(default=3, ge=0, le=500)
    adaptive: bool = True
    ga_crossover: Literal["ox", "pmx"] = "ox"
    ga_crossover_rate: float = Field(default=0.9, ge=0.0, le=1.0)
    ga_mutation_rate: float = Field(default=0.2, ge=0.0, le=1.0)
    ga_ls_rate: float = Field(default=0.25, ge=0.0, le=1.0)
    ga_elite_size: int = Field(default=2, ge=1, le=100)
    ga_stagnation_generations: int = Field(default=60, ge=1)
    aco_alpha: float = Field(default=1.0, ge=0)
    aco_beta: float = Field(default=3.0, ge=0)
    aco_rho: float = Field(default=0.1, gt=0, lt=1)
    aco_q0: float = Field(default=0.9, ge=0, le=1)
    aco_cand_k: int = Field(default=15, ge=1)
    aco_stagnation_cycles: int = Field(default=40, ge=1)


@dataclass(slots=True)
class Tally:
    from_ga: int = 0
    from_aco: int = 0
    ga_stall: int = 0
    aco_idle: int = 0
    ants: int = 0
    inject: int = 0


def ga_params(params: HybridParams) -> GaParams:
    return GaParams(
        time_limit_s=params.time_limit_s,
        max_iterations=params.max_iterations,
        seed=params.seed,
        init=params.init,
        local_search=params.local_search,
        pop_size=params.pop_size,
        crossover=params.ga_crossover,
        crossover_rate=params.ga_crossover_rate,
        mutation_rate=params.ga_mutation_rate,
        ls_rate=params.ga_ls_rate,
        elite_size=params.ga_elite_size,
        stagnation_generations=params.ga_stagnation_generations,
    )


def aco_params(params: HybridParams) -> AcoParams:
    return AcoParams(
        time_limit_s=params.time_limit_s,
        max_iterations=params.max_iterations,
        seed=params.seed,
        init=params.init,
        local_search=params.local_search,
        n_ants=params.ants_per_cycle,
        alpha=params.aco_alpha,
        beta=params.aco_beta,
        rho=params.aco_rho,
        q0=params.aco_q0,
        cand_k=params.aco_cand_k,
        ls_ants=params.ls_ants,
        stagnation_iterations=params.aco_stagnation_cycles,
    )


@register_solver
class HybridSolver(Solver):
    name: ClassVar[str] = "aco_ga"
    label: ClassVar[str] = "Hybrid ACO + GA"
    params_model: ClassVar[type[SolverParams]] = HybridParams
    multi_objective: ClassVar[bool] = False

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        params = HybridParams.model_validate(self.params.model_dump())
        pen = penalties if penalties is not None else Penalties()
        rng = np.random.default_rng(params.seed)
        watch = Stopwatch(params.time_limit_s)
        deadline = watch.t0 + params.time_limit_s
        engine = GeneticEngine(inst, ga_params(params), rng, pen)
        engine.deadline = deadline
        colony = AntColony(inst, aco_params(params), rng, pen)
        pool = self._seed_pool(inst, params, colony, rng, pen, watch, warm_start or [])
        engine.seed(pool)
        if state and "node_keys" in state and "pheromone" in state:
            colony.seed(pool, state["pheromone"], list(state["node_keys"]))
        else:
            colony.seed(pool)
        best, best_eval = engine.best()
        tally = Tally(ants=params.ants_per_cycle, inject=params.inject_k)
        history: list[tuple[int, float, float]] = [(0, watch.elapsed, best_eval.fitness)]
        cycle = 0
        stopped = False
        gate = ProgressGate(watch, params.progress_every, params.progress_interval_s)
        current = (best, best_eval)

        def emit(stage: str) -> bool:
            assert callback is not None
            return callback(
                self._event(engine, colony, cycle, watch, current[0], current[1], tally, stage)
            )

        def tick() -> bool:
            if callback is None or not gate.due_time():
                return True
            gate.mark_time()
            pair = engine.best()
            if current[1].fitness <= pair[1].fitness:
                pair = current
            return callback(
                self._event(
                    engine, colony, cycle, watch, pair[0], pair[1], tally, STAGE_COOPERATING
                )
            )

        if callback is not None:
            stopped = not emit(STAGE_SEEDING)
            gate.mark(0)
        engine.hook = tick
        while not stopped and cycle < params.max_iterations and time.perf_counter() < deadline:
            cycle += 1
            ga_best, ga_eval = self._ga_phase(engine, params, deadline)
            if engine.aborted:
                stopped = True
                break
            ga_won = ga_eval.fitness < best_eval.fitness - IMPROVEMENT_EPS
            if ga_won:
                best, best_eval = ga_best, ga_eval
                tally.from_ga += 1
            aco_won = False
            if time.perf_counter() < deadline:
                ants, evals = self._aco_phase(
                    inst, engine, colony, params, tally, pen, rng, deadline
                )
                fitness = [ev.fitness for ev in evals]
                top = int(np.argmin(fitness))
                if fitness[top] < best_eval.fitness - IMPROVEMENT_EPS:
                    best, best_eval = ants[top].copy(), evals[top]
                    tally.from_aco += 1
                    aco_won = True
                order = np.argsort(fitness, kind="stable")
                engine.inject([ants[int(i)] for i in order[: tally.inject]])
            current = (best, best_eval)
            if ga_won or aco_won:
                history.append((cycle, watch.elapsed, best_eval.fitness))
            if params.adaptive:
                self._adapt(params, tally, ga_won, aco_won)
            if callback is not None and gate.due(cycle):
                gate.mark(cycle)
                if not emit(STAGE_COOPERATING):
                    stopped = True
        if callback is not None and not stopped:
            emit(STAGE_FINISHED)
        if history[-1][0] != cycle:
            history.append((cycle, watch.elapsed, best_eval.fitness))
        return SolveResult(
            algorithm=self.name,
            best=best,
            evaluation=best_eval,
            runtime_s=watch.elapsed,
            iterations=cycle,
            history=history,
            state={"pheromone": colony.pheromone.copy(), "node_keys": node_keys(inst)},
        )

    @staticmethod
    def _seed_pool(
        inst: Instance,
        params: HybridParams,
        colony: AntColony,
        rng: np.random.Generator,
        pen: Penalties,
        watch: Stopwatch,
        warm_start: list[RouteSet],
    ) -> list[RouteSet]:
        candidates = initial_routesets(inst, params.init, params.pop_size, rng, pen)
        seed_ants = 2 * params.pop_size if params.seed_ants is None else params.seed_ants
        if seed_ants > 0:
            candidates.extend(colony.construct(seed_ants))
        scored = sorted(candidates, key=lambda rs: evaluate(inst, rs, pen).fitness)
        pool: list[RouteSet] = []
        budget = SEED_LS_TIME_SHARE * params.time_limit_s
        for rs in scored[: params.pop_size]:
            if params.local_search and watch.elapsed < budget:
                rs = improve(inst, rs, pen, rng)
            pool.append(rs)
        pool.extend(rs.copy() for rs in warm_start)
        return pool

    @staticmethod
    def _ga_phase(
        engine: GeneticEngine, params: HybridParams, deadline: float
    ) -> tuple[RouteSet, Evaluation]:
        for _ in range(params.ga_generations_per_cycle):
            if time.perf_counter() >= deadline:
                break
            engine.step()
        return engine.best()

    @staticmethod
    def _aco_phase(
        inst: Instance,
        engine: GeneticEngine,
        colony: AntColony,
        params: HybridParams,
        tally: Tally,
        pen: Penalties,
        rng: np.random.Generator,
        deadline: float,
    ) -> tuple[list[RouteSet], list[Evaluation]]:
        colony.update(engine.elite(params.elite_deposit), deposit_top=params.elite_deposit)
        ants = colony.construct(tally.ants)
        evals = [evaluate(inst, rs, pen) for rs in ants]
        if params.local_search and params.ls_ants > 0:
            order = np.argsort([ev.fitness for ev in evals], kind="stable")
            for idx in order[: max(params.ls_ants, tally.inject)]:
                if time.perf_counter() >= deadline:
                    break
                ants[int(idx)] = improve(inst, ants[int(idx)], pen, rng)
                evals[int(idx)] = evaluate(inst, ants[int(idx)], pen)
        return ants, evals

    @staticmethod
    def _adapt(params: HybridParams, tally: Tally, ga_won: bool, aco_won: bool) -> None:
        tally.ga_stall = 0 if ga_won else tally.ga_stall + 1
        tally.aco_idle = 0 if aco_won else tally.aco_idle + 1
        if tally.ga_stall >= GA_STALL_CYCLES:
            tally.inject = min(tally.inject + 1, tally.ants)
        elif ga_won:
            tally.inject = max(params.inject_k, tally.inject - 1)
        if tally.aco_idle >= ACO_IDLE_CYCLES:
            tally.ants = max(MIN_ANTS, tally.ants // 2)
            tally.inject = min(tally.inject, tally.ants)
            tally.aco_idle = 0
        elif aco_won:
            tally.ants = params.ants_per_cycle

    @staticmethod
    def _event(
        engine: GeneticEngine,
        colony: AntColony,
        cycle: int,
        watch: Stopwatch,
        best: RouteSet,
        best_eval: Evaluation,
        tally: Tally,
        stage: str,
    ) -> ProgressEvent:
        stats = engine.stats()
        return ProgressEvent(
            iteration=cycle,
            elapsed_s=watch.elapsed,
            best_fitness=best_eval.fitness,
            best_eval=best_eval,
            best=best.copy(),
            extra={
                "avg_fitness": stats["avg_fitness"],
                "diversity": stats["diversity"],
                "branching": colony.branching(),
                "improvements_from_ga": tally.from_ga,
                "improvements_from_aco": tally.from_aco,
                "cycle": cycle,
                "stage": stage,
            },
        )
