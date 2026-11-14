from __future__ import annotations

import time

import numpy as np

from routeopt.algorithms.base import ProgressEvent, SolveResult, get_solver
from routeopt.algorithms.nsga2 import Nsga2Params, Nsga2Solver, pareto_objectives
from routeopt.core.evaluate import evaluate, validate_routeset
from routeopt.core.types import Instance
from tests.factories import make_instance


def varied_instance() -> Instance:
    inst = make_instance(n=40, m=6, seed=3)
    inst.cap_kg *= 0.2 / 0.35
    inst.cap_m3 *= 0.2 / 0.35
    return inst


def run(inst: Instance, **params: object) -> tuple[SolveResult, list[ProgressEvent]]:
    events: list[ProgressEvent] = []

    def callback(event: ProgressEvent) -> bool:
        events.append(event)
        return True

    base: dict[str, object] = {"time_limit_s": 30, "max_iterations": 60, "seed": 1}
    result = Nsga2Solver({**base, **params}).solve(inst, callback)
    return result, events


def dominates(a: np.ndarray, b: np.ndarray) -> bool:
    return bool(np.all(a <= b) and np.any(a < b))


def test_registered_and_metadata() -> None:
    solver = get_solver("nsga2")
    assert isinstance(solver, Nsga2Solver)
    assert solver.multi_objective
    assert solver.label == "NSGA-II (multi-objective)"
    defaults = Nsga2Params()
    assert (
        defaults.pop_size,
        defaults.crossover_rate,
        defaults.mutation_rate,
        defaults.ls_every,
    ) == (
        60,
        0.9,
        0.2,
        0,
    )


def test_front_is_non_dominated_unique_and_valid() -> None:
    inst = varied_instance()
    result, _ = run(inst)
    assert result.pareto is not None
    front = result.pareto
    objectives = [pareto_objectives(ev) for _, ev in front]
    keys = {tuple(np.round(o, 6)) for o in objectives}
    assert len(keys) == len(front)
    for i, a in enumerate(objectives):
        for j, b in enumerate(objectives):
            assert i == j or not dominates(a, b)
    for rs, ev in front:
        validate_routeset(inst, rs)
        assert rs.unassigned == []
        assert evaluate(inst, rs).total_cost_mxn == ev.total_cost_mxn
    times = [ev.total_duration_min for _, ev in front]
    assert times == sorted(times)


def test_front_has_trade_offs_with_varied_weights() -> None:
    result, _ = run(varied_instance(), max_iterations=120)
    assert result.pareto is not None
    points = {
        (round(ev.total_duration_min, 3), round(ev.total_cost_mxn, 3), ev.vehicles_used)
        for _, ev in result.pareto
    }
    assert len(points) >= 3
    assert all(ev.feasible for _, ev in result.pareto)


def test_best_minimizes_weighted_fitness_over_front() -> None:
    inst = varied_instance()
    result, _ = run(inst)
    assert result.pareto is not None
    assert result.evaluation.fitness == min(ev.fitness for _, ev in result.pareto)
    assert result.evaluation.fitness == evaluate(inst, result.best).fitness


def test_progress_events_carry_the_front() -> None:
    result, events = run(make_instance(n=25, m=4, seed=1), progress_every=5, max_iterations=20)
    assert len(events) >= 4
    assert all(e.pareto for e in events)
    assert events[-1].iteration == result.iterations
    assert [e.iteration for e in events] == sorted(e.iteration for e in events)


def test_respects_time_limit() -> None:
    inst = make_instance(n=40, m=5, seed=2)
    start = time.perf_counter()
    result = Nsga2Solver({"time_limit_s": 1.0, "max_iterations": 100000, "seed": 0}).solve(inst)
    assert time.perf_counter() - start < 4.0
    assert result.pareto


def test_respects_max_iterations() -> None:
    result, _ = run(make_instance(n=20, m=3, seed=1), max_iterations=7)
    assert result.iterations == 7


def test_cancellation_stops_early() -> None:
    inst = make_instance(n=25, m=4, seed=1)
    calls: list[int] = []

    def callback(event: ProgressEvent) -> bool:
        calls.append(event.iteration)
        return event.extra["stage"] == "seeding"

    result = Nsga2Solver({"time_limit_s": 30, "max_iterations": 500, "seed": 0}).solve(
        inst, callback
    )
    assert calls == [0, 5]
    assert result.iterations == 5
    assert result.pareto


def test_stage_sequence() -> None:
    inst = make_instance(n=25, m=4, seed=1)
    stages: list[str] = []

    def callback(event: ProgressEvent) -> bool:
        stages.append(event.extra["stage"])
        return True

    Nsga2Solver({"time_limit_s": 30, "max_iterations": 7, "seed": 0, "progress_every": 3}).solve(
        inst, callback
    )
    assert stages == ["seeding", "evolving", "evolving", "finished"]


def test_same_seed_same_front() -> None:
    inst = make_instance(n=25, m=4, seed=1)
    first, _ = run(inst, max_iterations=15)
    second, _ = run(inst, max_iterations=15)
    assert first.pareto is not None and second.pareto is not None
    assert [rs.routes for rs, _ in first.pareto] == [rs.routes for rs, _ in second.pareto]


def test_local_search_hook_keeps_front_valid() -> None:
    inst = make_instance(n=25, m=4, seed=1)
    result, _ = run(inst, ls_every=5, max_iterations=10)
    assert result.pareto
    for rs, _ in result.pareto:
        validate_routeset(inst, rs)


def test_works_with_multi_origin_and_time_windows() -> None:
    inst = make_instance(n=30, m=4, seed=4, mode="multi_origin", time_windows=True, open_end=True)
    result, _ = run(inst, max_iterations=20)
    assert result.pareto
    for rs, _ in result.pareto:
        validate_routeset(inst, rs)
