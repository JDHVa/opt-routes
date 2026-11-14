from __future__ import annotations

import time
from typing import Any, Literal

import numpy as np
import pytest

from routeopt.algorithms.aco import node_keys
from routeopt.algorithms.base import ProgressEvent, get_solver
from routeopt.algorithms.hybrid import HybridParams, HybridSolver
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate, validate_routeset
from tests.factories import benchmark_instance, make_instance

Mode = Literal["depot", "multi_origin"]
EXTRA_KEYS = {
    "avg_fitness",
    "diversity",
    "branching",
    "improvements_from_ga",
    "improvements_from_aco",
    "cycle",
    "stage",
}


def quick(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "max_iterations": 4,
        "time_limit_s": 60.0,
        "seed": 3,
        "pop_size": 12,
        "seed_ants": 20,
        "ga_generations_per_cycle": 3,
        "ants_per_cycle": 6,
    }
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
        m=4,
        seed=1,
        mode=mode,
        time_windows=time_windows,
        open_end=open_end,
        tight_capacity=tight,
    )
    result = HybridSolver(quick()).solve(inst)
    validate_routeset(inst, result.best)
    assert result.best.unassigned == []
    assert result.evaluation.fitness == pytest.approx(evaluate(inst, result.best).fitness)
    assert result.iterations == 4
    assert result.history[-1][2] == pytest.approx(result.evaluation.fitness)


def test_registered_and_schema_is_flat() -> None:
    assert isinstance(get_solver("aco_ga"), HybridSolver)
    properties = HybridParams.model_json_schema()["properties"]
    assert {"ga_crossover_rate", "aco_beta", "elite_deposit", "inject_k"} <= set(properties)
    assert all(prop.get("type") != "object" for prop in properties.values())


def test_determinism() -> None:
    inst = make_instance(n=30, m=4, seed=4)
    first = HybridSolver(quick()).solve(inst)
    second = HybridSolver(quick()).solve(inst)
    assert first.best.routes == second.best.routes
    assert first.evaluation.fitness == second.evaluation.fitness


def test_time_limit_and_cancel() -> None:
    inst = make_instance(n=60, m=6, seed=5)
    HybridSolver(quick(max_iterations=1)).solve(inst)
    started = time.perf_counter()
    result = HybridSolver(quick(time_limit_s=2.0, max_iterations=10**6)).solve(inst)
    assert abs(time.perf_counter() - started - 2.0) <= 0.5
    validate_routeset(inst, result.best)

    events: list[ProgressEvent] = []

    def cancel(event: ProgressEvent) -> bool:
        events.append(event)
        return event.extra["stage"] == "seeding"

    cancelled = HybridSolver(quick(max_iterations=100, progress_every=2)).solve(
        inst, callback=cancel
    )
    assert cancelled.iterations == 2
    assert len(events) == 2


def test_callback_cadence_and_extra() -> None:
    inst = make_instance(n=25, m=3, seed=6)
    events: list[ProgressEvent] = []

    def record(event: ProgressEvent) -> bool:
        events.append(event)
        return True

    result = HybridSolver(quick(max_iterations=7, progress_every=3)).solve(inst, callback=record)
    assert [event.iteration for event in events] == [0, 3, 6, 7]
    assert [event.extra["stage"] for event in events] == [
        "seeding",
        "cooperating",
        "cooperating",
        "finished",
    ]
    for event in events:
        assert set(event.extra) == EXTRA_KEYS
        assert event.best is not None
    last = events[-1].extra
    assert last["cycle"] == 7
    assert last["improvements_from_ga"] >= 0
    assert last["improvements_from_aco"] >= 0
    assert result.evaluation.fitness == pytest.approx(events[-1].best_fitness)


def test_improvement_counters_are_monotonic() -> None:
    inst = make_instance(n=40, m=5, seed=7)
    totals: list[int] = []

    def record(event: ProgressEvent) -> bool:
        totals.append(event.extra["improvements_from_ga"] + event.extra["improvements_from_aco"])
        return True

    HybridSolver(quick(max_iterations=10, progress_every=1)).solve(inst, callback=record)
    assert totals == sorted(totals)
    assert totals[-1] >= 0


def test_state_roundtrip() -> None:
    inst = make_instance(n=20, m=3, seed=9)
    first = HybridSolver(quick()).solve(inst)
    assert first.state["node_keys"] == node_keys(inst)
    assert first.state["pheromone"].shape == (inst.n + inst.m, inst.n)
    assert np.all(np.isfinite(first.state["pheromone"]))
    second = HybridSolver(quick(max_iterations=2)).solve(inst, state=first.state)
    validate_routeset(inst, second.best)


def test_warm_start_never_worse() -> None:
    inst = make_instance(n=30, m=4, seed=10, time_windows=True)
    reference = HybridSolver(quick(max_iterations=5, seed=1)).solve(inst)
    warm = [reference.best, nearest_neighbor(inst)]
    result = HybridSolver(quick(max_iterations=2, seed=2)).solve(inst, warm_start=warm)
    assert result.evaluation.fitness <= reference.evaluation.fitness + 1e-9
    assert result.evaluation.fitness <= evaluate(inst, warm[1]).fitness + 1e-9


@pytest.mark.slow
@pytest.mark.parametrize(
    ("name", "max_gap"),
    [
        ("A-n32-k5", 0.01),
        ("A-n45-k7", 0.01),
        ("P-n50-k7", 0.01),
        ("A-n80-k10", 0.02),
        ("X-n101-k25", 0.03),
    ],
)
def test_quality_cvrplib(name: str, max_gap: float) -> None:
    inst, bks = benchmark_instance(name)
    result = HybridSolver({"time_limit_s": 30.0, "max_iterations": 10**6, "seed": 1}).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.feasible
    assert result.evaluation.total_distance_km / bks - 1.0 <= max_gap
