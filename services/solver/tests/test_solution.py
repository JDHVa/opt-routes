from __future__ import annotations

import pytest

from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate
from routeopt.core.solution import to_solution
from routeopt.core.types import RouteSet
from tests.factories import make_instance


def test_solution_matches_evaluation() -> None:
    inst = make_instance(n=25, m=4, seed=3, time_windows=True)
    rs = nearest_neighbor(inst)
    ev = evaluate(inst, rs)
    solution = to_solution(inst, rs, ev, "test", 1.5)
    assert solution.algorithm == "test"
    assert solution.runtime_s == 1.5
    assert len(solution.routes) == sum(1 for r in rs.routes if r)
    assert solution.metrics.fitness == ev.fitness
    assert solution.metrics.vehicles_used == len(solution.routes)
    assert sum(r.metrics.distance_km for r in solution.routes) == pytest.approx(
        ev.total_distance_km
    )
    assert sum(r.metrics.cost_mxn for r in solution.routes) == pytest.approx(ev.total_cost_mxn)
    assert max(r.metrics.end_min for r in solution.routes) == pytest.approx(ev.makespan_min)


def test_visit_times_are_consistent() -> None:
    inst = make_instance(n=15, m=3, seed=1, time_windows=True)
    rs = nearest_neighbor(inst)
    solution = to_solution(inst, rs, evaluate(inst, rs), "test", 0.0)
    for route in solution.routes:
        previous_departure = route.metrics.start_min
        for visit in route.visits:
            assert visit.arrival_min >= previous_departure - 1e-9
            assert visit.start_service_min >= visit.arrival_min - 1e-9
            assert visit.departure_min >= visit.start_service_min
            previous_departure = visit.departure_min
        assert route.metrics.end_min >= previous_departure - 1e-9


def test_unassigned_stops_are_reported() -> None:
    inst = make_instance(n=6, m=2)
    rs = RouteSet([[0, 1], [2, 3]], [4, 5])
    solution = to_solution(inst, rs, evaluate(inst, rs), "test", 0.0)
    assert solution.unassigned_stop_ids == ["s4", "s5"]
    assert solution.metrics.unassigned == 2
    assert not solution.metrics.feasible
    assert all(route.geometry is None for route in solution.routes)
