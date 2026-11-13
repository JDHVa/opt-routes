from __future__ import annotations

import pytest

from routeopt.algorithms.base import ProgressEvent, Solver, get_solver
from routeopt.baselines.ortools_solver import OrToolsSolver
from routeopt.baselines.pyvrp_solver import PyVrpSolver
from routeopt.core.evaluate import evaluate, validate_routeset
from tests.factories import benchmark_instance, make_instance

SOLVERS: dict[str, type[Solver]] = {"pyvrp": PyVrpSolver, "ortools": OrToolsSolver}
GAP_LIMIT = {"pyvrp": 0.01, "ortools": 0.06}


def solver(name: str, time_limit_s: float) -> Solver:
    return SOLVERS[name]({"time_limit_s": time_limit_s, "seed": 1})


def test_registered_with_expected_labels() -> None:
    assert get_solver("pyvrp").label == "PyVRP (HGS baseline)"
    assert get_solver("ortools").label == "OR-Tools (GLS baseline)"


@pytest.mark.slow
@pytest.mark.parametrize("name", SOLVERS)
@pytest.mark.parametrize("instance", ["A-n32-k5", "A-n45-k7"])
def test_cvrplib_gap(name: str, instance: str) -> None:
    inst, bks = benchmark_instance(instance)
    result = solver(name, 10.0).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.feasible
    gap = result.evaluation.total_distance_km / bks - 1.0
    assert gap <= GAP_LIMIT[name], f"{name} {instance} gap {gap:.4f}"


@pytest.mark.parametrize("name", SOLVERS)
def test_multi_origin_open_routes(name: str) -> None:
    inst = make_instance(n=30, m=4, seed=3, mode="multi_origin", open_end=True)
    assert inst.open_end.all()
    result = solver(name, 2.0).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.unassigned == 0
    assert result.evaluation.feasible
    assert result.evaluation == evaluate(inst, result.best)


@pytest.mark.parametrize("name", SOLVERS)
def test_multi_origin_closed_routes(name: str) -> None:
    inst = make_instance(n=25, m=3, seed=5, mode="multi_origin")
    result = solver(name, 2.0).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.feasible


@pytest.mark.parametrize("name", SOLVERS)
def test_time_windows_c101(name: str) -> None:
    inst, _ = benchmark_instance("C101")
    result = solver(name, 5.0).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.unassigned == 0
    assert result.evaluation.overload_kg == 0.0
    assert result.evaluation.lateness_min < 1.0


@pytest.mark.parametrize("name", SOLVERS)
def test_heterogeneous_fleet_with_windows_and_shift(name: str) -> None:
    inst = make_instance(n=30, m=5, seed=7, time_windows=True)
    result = solver(name, 3.0).solve(inst)
    validate_routeset(inst, result.best)
    assert result.evaluation.overload_kg == 0.0
    assert result.evaluation.overload_m3 == 0.0
    assert result.evaluation.overtime_min == 0.0
    assert result.evaluation.unassigned == 0


@pytest.mark.parametrize("name", SOLVERS)
def test_callback_at_start_and_end_and_history(name: str) -> None:
    inst = make_instance(n=15, m=3, seed=1)
    events: list[ProgressEvent] = []

    def callback(event: ProgressEvent) -> bool:
        events.append(event)
        return True

    result = solver(name, 1.0).solve(inst, callback)
    assert len(events) == 2
    assert events[0].iteration == 0
    assert events[-1].best_fitness == result.evaluation.fitness
    assert len(result.history) >= 2


@pytest.mark.parametrize("name", SOLVERS)
def test_cancel_at_start_returns_valid_fallback(name: str) -> None:
    inst = make_instance(n=15, m=3, seed=1)
    result = solver(name, 5.0).solve(inst, lambda event: False)
    validate_routeset(inst, result.best)
    assert result.runtime_s < 2.0


@pytest.mark.parametrize("name", SOLVERS)
def test_respects_time_limit(name: str) -> None:
    inst = make_instance(n=40, m=5, seed=2)
    result = solver(name, 1.5).solve(inst)
    assert result.runtime_s < 4.0


@pytest.mark.parametrize("name", SOLVERS)
def test_unservable_stop_goes_to_unassigned_or_overloads_without_losing_stops(name: str) -> None:
    inst = make_instance(n=12, m=2, seed=1)
    inst.demand_kg[0] = float(inst.cap_kg.max()) * 3.0
    result = solver(name, 1.0).solve(inst)
    validate_routeset(inst, result.best)
