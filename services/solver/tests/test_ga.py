from __future__ import annotations

import time

import numpy as np
import pytest

from routeopt.algorithms.base import InitStrategy, ProgressEvent
from routeopt.algorithms.ga import (
    GaParams,
    GaSolver,
    GeneticEngine,
    mutate_tour,
    order_crossover,
    pmx_crossover,
)
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate, validate_routeset
from routeopt.core.types import Penalties
from tests.factories import benchmark_instance, make_instance


def small_params(**overrides: object) -> GaParams:
    values: dict[str, object] = {
        "time_limit_s": 60.0,
        "max_iterations": 15,
        "seed": 3,
        "pop_size": 16,
        "init": InitStrategy.NEAREST_NEIGHBOR,
    }
    values.update(overrides)
    return GaParams.model_validate(values)


def test_crossovers_return_permutations() -> None:
    rng = np.random.default_rng(0)
    for size in (1, 2, 5, 30):
        a = rng.permutation(size).astype(np.int64)
        b = rng.permutation(size).astype(np.int64)
        for cross in (order_crossover, pmx_crossover):
            child = cross(a, b, rng)
            assert sorted(child.tolist()) == list(range(size))
        assert sorted(mutate_tour(a, rng).tolist()) == list(range(size))


@pytest.mark.parametrize("crossover", ["ox", "pmx"])
def test_returns_valid_routeset(crossover: str) -> None:
    inst = make_instance(n=30, m=4, seed=1, time_windows=True)
    result = GaSolver(small_params(crossover=crossover)).solve(inst)
    validate_routeset(inst, result.best)
    assert result.best.unassigned == []
    assert result.evaluation.fitness == pytest.approx(evaluate(inst, result.best).fitness)
    assert result.history[-1][2] == pytest.approx(result.evaluation.fitness)
    assert result.iterations == 15


def test_multi_origin_open_routes() -> None:
    inst = make_instance(n=25, m=4, seed=2, mode="multi_origin", open_end=True, time_windows=True)
    result = GaSolver(small_params()).solve(inst)
    validate_routeset(inst, result.best)


def test_deterministic_with_seed() -> None:
    inst = make_instance(n=30, m=4, seed=4)
    first = GaSolver(small_params()).solve(inst)
    second = GaSolver(small_params()).solve(inst)
    assert first.best.routes == second.best.routes
    assert first.evaluation.fitness == second.evaluation.fitness
    other = GaSolver(small_params(seed=99)).solve(inst)
    assert other.evaluation.fitness > 0


def test_respects_time_limit() -> None:
    inst = make_instance(n=60, m=6, seed=5)
    params = small_params(time_limit_s=2.0, max_iterations=10**6, pop_size=30)
    t0 = time.perf_counter()
    result = GaSolver(params).solve(inst)
    elapsed = time.perf_counter() - t0
    assert abs(elapsed - 2.0) <= 0.5
    validate_routeset(inst, result.best)


def test_stops_when_callback_returns_false() -> None:
    inst = make_instance(n=30, m=4, seed=6)
    events: list[ProgressEvent] = []

    def callback(event: ProgressEvent) -> bool:
        events.append(event)
        return len(events) < 3

    result = GaSolver(small_params(max_iterations=500, progress_every=2)).solve(
        inst, callback=callback
    )
    assert len(events) == 3
    assert result.iterations == 6
    assert events[-1].best is not None
    assert set(events[-1].extra) == {"avg_fitness", "diversity", "feasible_pct"}


def test_final_callback_is_called_once_at_end() -> None:
    inst = make_instance(n=20, m=3, seed=7)
    iterations: list[int] = []

    def callback(event: ProgressEvent) -> bool:
        iterations.append(event.iteration)
        return True

    GaSolver(small_params(max_iterations=7, progress_every=5)).solve(inst, callback=callback)
    assert iterations == [5, 7]


def test_warm_start_is_never_worsened() -> None:
    inst = make_instance(n=40, m=5, seed=8)
    warm = nearest_neighbor(inst)
    warm_fitness = evaluate(inst, warm).fitness
    result = GaSolver(small_params(max_iterations=3, local_search=False)).solve(
        inst, warm_start=[warm]
    )
    assert result.evaluation.fitness <= warm_fitness + 1e-9


def test_engine_interface() -> None:
    inst = make_instance(n=30, m=4, seed=9, tight_capacity=True)
    params = small_params(pop_size=12)
    engine = GeneticEngine(inst, params, np.random.default_rng(0), Penalties())
    engine.seed([nearest_neighbor(inst)])
    assert len(engine.population) == 12
    start = engine.best()[1].fitness
    for _ in range(25):
        engine.step()
    assert engine.generation == 25
    best, ev = engine.best()
    validate_routeset(inst, best)
    assert ev.fitness <= start + 1e-12
    elite = engine.elite(5)
    assert 1 <= len(elite) <= 5
    keys = {tuple(tuple(r) for r in rs.routes) for rs in elite}
    assert len(keys) == len(elite)
    stats = engine.stats()
    assert 0.0 <= stats["feasible_pct"] <= 100.0
    assert 0.0 <= stats["diversity"] <= 1.0
    assert stats["avg_fitness"] > 0.0


def test_inject_replaces_worst_without_duplicates() -> None:
    inst = make_instance(n=30, m=4, seed=10)
    engine = GeneticEngine(inst, small_params(pop_size=10), np.random.default_rng(1), Penalties())
    engine.seed([])
    strong = nearest_neighbor(inst)
    engine.inject([strong, strong.copy()])
    assert len(engine.population) == 10
    fitness = evaluate(inst, strong).fitness
    assert engine.best()[1].fitness <= fitness + 1e-9
    matches = sum(1 for ind in engine.population if abs(ind.fitness - fitness) < 1e-9)
    assert matches <= 1


def test_penalty_adaptation_keeps_base_best() -> None:
    inst = make_instance(n=35, m=4, seed=11, tight_capacity=True)
    engine = GeneticEngine(inst, small_params(pop_size=10), np.random.default_rng(2), Penalties())
    engine.seed([])
    for _ in range(40):
        engine.step()
    assert engine.penalties.capacity >= 0.1 * Penalties().capacity
    best, ev = engine.best()
    assert ev.fitness == pytest.approx(evaluate(inst, best).fitness)


def test_diversification_triggers_on_stagnation() -> None:
    inst = make_instance(n=20, m=3, seed=12)
    params = small_params(pop_size=10, stagnation_generations=3)
    engine = GeneticEngine(inst, params, np.random.default_rng(5), Penalties())
    engine.seed([])
    for _ in range(40):
        engine.step()
    assert len(engine.population) == 10
    validate_routeset(inst, engine.best()[0])


def gap_percent(name: str, seed: int = 1) -> float:
    inst, bks = benchmark_instance(name)
    params = GaParams(
        time_limit_s=30.0, max_iterations=10**6, seed=seed, init=InitStrategy.NEAREST_NEIGHBOR
    )
    result = GaSolver(params).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.feasible
    return 100.0 * (result.evaluation.total_distance_km - bks) / bks


@pytest.mark.slow
@pytest.mark.parametrize(
    ("name", "limit"), [("A-n32-k5", 3.0), ("A-n45-k7", 4.0), ("P-n50-k7", 4.0)]
)
def test_cvrp_gap(name: str, limit: float) -> None:
    assert gap_percent(name) <= limit


@pytest.mark.slow
def test_solomon_c101_feasible_with_small_gap() -> None:
    assert gap_percent("C101") <= 8.0
