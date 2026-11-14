from __future__ import annotations

import statistics
import time
from typing import Any, Literal

import numpy as np
import pytest

from routeopt.algorithms.aco import (
    AcoParams,
    AcoSolver,
    AntColony,
    node_keys,
)
from routeopt.algorithms.base import ProgressEvent, get_solver
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate, validate_routeset
from routeopt.core.instance import build_instance
from routeopt.core.models import ObjectiveWeights
from routeopt.core.types import Instance
from tests.factories import (
    benchmark_instance,
    euclidean_matrices,
    make_instance,
    make_problem,
)

Mode = Literal["depot", "multi_origin"]


def quick_params(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"max_iterations": 8, "time_limit_s": 60.0, "seed": 3}
    base.update(overrides)
    return base


@pytest.mark.parametrize(
    ("mode", "time_windows", "open_end", "tight"),
    [
        ("depot", False, False, False),
        ("depot", True, False, True),
        ("multi_origin", False, False, False),
        ("multi_origin", True, True, False),
        ("multi_origin", False, True, True),
    ],
)
def test_valid_routeset(mode: Mode, time_windows: bool, open_end: bool, tight: bool) -> None:
    inst = make_instance(
        n=30,
        m=5,
        seed=2,
        mode=mode,
        time_windows=time_windows,
        open_end=open_end,
        tight_capacity=tight,
    )
    result = AcoSolver(quick_params()).solve(inst)
    validate_routeset(inst, result.best)
    assert result.best.unassigned == []
    assert len(result.best.routes) == inst.m
    assert result.evaluation.fitness == pytest.approx(evaluate(inst, result.best).fitness)


def test_vehicle_weight_uses_fewer_vehicles() -> None:
    weights = ObjectiveWeights(time=0.1, cost=0.1, vehicles=5.0)
    inst = make_instance(n=30, m=6, seed=4, weights=weights)
    result = AcoSolver(quick_params(max_iterations=15)).solve(inst)
    assert result.evaluation.vehicles_used <= inst.m
    assert result.evaluation.feasible


def test_registered() -> None:
    assert isinstance(get_solver("aco"), AcoSolver)


def test_determinism() -> None:
    inst = make_instance(n=25, m=4, seed=5, time_windows=True)
    first = AcoSolver(quick_params(max_iterations=12)).solve(inst)
    second = AcoSolver(quick_params(max_iterations=12)).solve(inst)
    assert first.best.routes == second.best.routes
    assert first.evaluation.fitness == second.evaluation.fitness
    other = AcoSolver(quick_params(max_iterations=12, seed=99)).solve(inst)
    assert other.iterations == 12


def test_time_limit_and_cancel() -> None:
    inst = make_instance(n=40, m=5, seed=6)
    AcoSolver(quick_params(max_iterations=2)).solve(inst)
    started = time.perf_counter()
    result = AcoSolver({"time_limit_s": 1.0, "max_iterations": 10**6, "seed": 1}).solve(inst)
    elapsed = time.perf_counter() - started
    assert abs(elapsed - 1.0) <= 0.5
    assert result.iterations > 0

    events: list[ProgressEvent] = []

    def cancel(event: ProgressEvent) -> bool:
        events.append(event)
        return event.extra["stage"] == "seeding"

    cancelled = AcoSolver(
        {"time_limit_s": 30.0, "max_iterations": 1000, "progress_every": 3, "seed": 1}
    ).solve(inst, callback=cancel)
    assert cancelled.iterations == 3
    assert len(events) == 2
    assert set(events[-1].extra) == {"avg_fitness", "branching", "tau_max", "tau_min", "stage"}


def test_callback_cadence_and_final() -> None:
    inst = make_instance(n=20, m=3, seed=7)
    iterations: list[int] = []
    stages: list[str] = []

    def record(event: ProgressEvent) -> bool:
        iterations.append(event.iteration)
        stages.append(event.extra["stage"])
        return True

    AcoSolver(quick_params(max_iterations=10, progress_every=4)).solve(inst, callback=record)
    assert iterations == [0, 4, 8, 10]
    assert stages == ["seeding", "constructing", "constructing", "finished"]


def test_state_mapping_by_keys() -> None:
    problem = make_problem(n=20, m=3, seed=8)
    dist, dur = euclidean_matrices(problem)
    old = build_instance(problem, dist, dur)
    rng = np.random.default_rng(0)
    params = AcoParams(max_iterations=5)
    colony = AntColony(old, params, rng, None)
    colony.seed([nearest_neighbor(old)])
    for _ in range(4):
        colony.update(colony.construct(6))
    old_tau = colony.pheromone.copy()
    old_keys = node_keys(old)

    donor = problem.stops[0]
    stops = problem.stops[5:] + [donor.model_copy(update={"id": f"new{i}"}) for i in range(3)]
    shifted = problem.model_copy(update={"stops": stops})
    dist2, dur2 = euclidean_matrices(shifted)
    new = build_instance(shifted, dist2, dur2)
    assert new.n == 18

    fresh = AntColony(new, params, np.random.default_rng(1), None)
    fresh.seed([nearest_neighbor(new)])
    fresh.import_state(old_tau, old_keys)
    new_keys = node_keys(new)
    index_old = {key: i for i, key in enumerate(old_keys)}
    survivors = [(i, key) for i, key in enumerate(new_keys[: new.n]) if key in index_old]
    assert len(survivors) == 15
    rows = [(i, key) for i, key in enumerate(new_keys) if key in index_old]
    for row_new, row_key in rows:
        for col_new, col_key in survivors:
            assert (
                fresh.pheromone[row_new, col_new] == old_tau[index_old[row_key], index_old[col_key]]
            )
    new_cols = [i for i, key in enumerate(new_keys[: new.n]) if key not in index_old]
    assert len(new_cols) == 3
    assert np.all(fresh.pheromone[:, new_cols] == fresh.tau_max)


def test_state_roundtrip_in_solve() -> None:
    inst = make_instance(n=20, m=3, seed=9)
    first = AcoSolver(quick_params(max_iterations=6)).solve(inst)
    assert first.state["node_keys"] == node_keys(inst)
    assert first.state["pheromone"].shape == (inst.n + inst.m, inst.n)
    second = AcoSolver(quick_params(max_iterations=3)).solve(inst, state=first.state)
    validate_routeset(inst, second.best)


def test_warm_start_never_worse() -> None:
    inst = make_instance(n=30, m=4, seed=10, time_windows=True)
    reference = AcoSolver(quick_params(max_iterations=10, seed=1)).solve(inst)
    warm = [reference.best, nearest_neighbor(inst)]
    result = AcoSolver(quick_params(max_iterations=3, seed=2)).solve(inst, warm_start=warm)
    assert result.evaluation.fitness <= reference.evaluation.fitness + 1e-9
    assert result.evaluation.fitness <= evaluate(inst, warm[1]).fitness + 1e-9


@pytest.mark.slow
@pytest.mark.parametrize(
    ("name", "max_gap"),
    [("A-n32-k5", 0.05), ("A-n45-k7", 0.07), ("P-n50-k7", 0.07)],
)
def test_quality_cvrplib(name: str, max_gap: float) -> None:
    inst, bks = benchmark_instance(name)
    result = AcoSolver({"time_limit_s": 30.0, "max_iterations": 10**6, "seed": 1}).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.feasible
    gap = result.evaluation.total_distance_km / bks - 1.0
    assert gap <= max_gap


def _iteration_ms(inst: Instance) -> float:
    colony = AntColony(inst, AcoParams(), np.random.default_rng(0), None)
    colony.seed([nearest_neighbor(inst)])
    colony.update(colony.construct(20))
    samples = []
    for _ in range(15):
        started = time.perf_counter()
        ants = colony.construct(20)
        evals = [evaluate(inst, rs) for rs in ants]
        colony.update(ants, evals)
        samples.append((time.perf_counter() - started) * 1000.0)
    return statistics.median(samples)


@pytest.mark.slow
def test_iteration_speed_n200() -> None:
    inst = make_instance(n=200, m=20, seed=11)
    assert _iteration_ms(inst) < 50.0


def test_rank_based_deposit_adds_more_pheromone() -> None:
    inst = make_instance(n=20, m=3, seed=4)

    def total_after(deposit_top: int) -> float:
        colony = AntColony(inst, AcoParams(), np.random.default_rng(0), None)
        colony.seed([nearest_neighbor(inst)])
        ants = colony.construct(6)
        before = colony.pheromone.copy()
        colony.update(ants, deposit_top=deposit_top)
        return float(np.sum(colony.pheromone - before * (1.0 - colony.params.rho)))

    assert total_after(3) >= total_after(1)
