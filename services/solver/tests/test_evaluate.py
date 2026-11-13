from __future__ import annotations

import time

import numpy as np
import pytest

from routeopt.core.evaluate import (
    additive_cost,
    evaluate,
    route_cost_components,
    validate_routeset,
)
from routeopt.core.instance import build_instance
from routeopt.core.models import (
    DistanceSource,
    Driver,
    FuelType,
    Location,
    Objective,
    ObjectiveWeights,
    Priority,
    Problem,
    ProblemMode,
    Stop,
    VehicleCategory,
    VehicleType,
)
from routeopt.core.types import Instance, Penalties, RouteSet
from tests.factories import make_instance

LOCATION = Location(lat=25.0, lon=-100.0)
KM_COST = 24.5 / 10.0
TOL = 1e-9


def _vehicle(vehicle_id: str, fuel: FuelType, speed_factor: float, fixed: float) -> VehicleType:
    return VehicleType(
        id=vehicle_id,
        name=vehicle_id,
        brand="test",
        category=VehicleCategory.COMPACT_VAN,
        payload_kg=100.0,
        volume_m3=10.0,
        fuel_type=fuel,
        km_per_l=10.0 if fuel == FuelType.GASOLINE else 6.0,
        speed_factor=speed_factor,
        fixed_cost_mxn=fixed,
    )


def _line_instance(problem: Problem, positions: list[float]) -> Instance:
    pts = np.array(positions)
    dist = np.abs(pts[:, None] - pts[None, :])
    return build_instance(problem, dist, dist * 2.0)


def _stop(
    stop_id: str,
    tw_start_min: float | None = None,
    tw_end_min: float | None = None,
    priority: Priority = Priority.NORMAL,
) -> Stop:
    return Stop(
        id=stop_id,
        location=LOCATION,
        tw_start_min=tw_start_min,
        tw_end_min=tw_end_min,
        priority=priority,
    )


def test_depot_case() -> None:
    problem = Problem(
        mode=ProblemMode.DEPOT,
        depot=LOCATION,
        drivers=[
            Driver(id="a", vehicle_type_id="van", hourly_wage_mxn=60.0),
            Driver(id="b", vehicle_type_id="truck", hourly_wage_mxn=60.0),
        ],
        vehicle_types=[
            _vehicle("van", FuelType.GASOLINE, 1.0, 50.0),
            _vehicle("truck", FuelType.DIESEL, 1.2, 120.0),
        ],
        stops=[_stop("s0"), _stop("s1"), _stop("s2")],
        distance_source=DistanceSource.HAVERSINE,
        objective=Objective(
            weights=ObjectiveWeights(time=1.0, cost=1.0, vehicles=0.5, makespan=0.5)
        ),
    )
    inst = _line_instance(problem, [1, 2, 4, 0, 0, 0, 0])
    ev = evaluate(inst, RouteSet([[0, 1], [2]]))
    dist_a, dur_a = 4.0, 2.0 * 4.0 + 6.0
    cost_a = dist_a * KM_COST + dur_a * 1.0 + 50.0
    dist_b, dur_b = 8.0, 2.0 * 8.0 * 1.2 + 3.0
    cost_b = dist_b * 26.0 / 6.0 + dur_b * 1.0 + 120.0
    assert ev.total_distance_km == pytest.approx(dist_a + dist_b, abs=TOL)
    assert ev.total_duration_min == pytest.approx(dur_a + dur_b, abs=TOL)
    assert ev.total_cost_mxn == pytest.approx(cost_a + cost_b, abs=TOL)
    assert ev.vehicles_used == 2
    assert ev.makespan_min == pytest.approx(max(dur_a, dur_b), abs=TOL)
    assert ev.feasible
    w = np.array([1.0, 1.0, 0.5, 0.5]) / 3.0
    f = np.array([dur_a + dur_b, cost_a + cost_b, 2.0])
    balance = (dur_a**2 + dur_b**2) / inst.obj_scale[3] ** 2
    expected = float(np.sum(w[:3] * f / inst.obj_scale[:3]) + w[3] * balance)
    assert ev.fitness == pytest.approx(expected, abs=TOL)


def test_multi_origin_open_route() -> None:
    problem = Problem(
        mode=ProblemMode.MULTI_ORIGIN,
        drivers=[
            Driver(
                id="a",
                vehicle_type_id="van",
                start=LOCATION,
                hourly_wage_mxn=60.0,
                shift_start_min=30.0,
            ),
            Driver(id="b", vehicle_type_id="van", start=LOCATION, end=LOCATION),
        ],
        vehicle_types=[_vehicle("van", FuelType.GASOLINE, 1.0, 50.0)],
        stops=[_stop("s0"), _stop("s1")],
        distance_source=DistanceSource.HAVERSINE,
        objective=Objective(
            weights=ObjectiveWeights(time=0.0, cost=0.0, vehicles=0.0, makespan=1.0)
        ),
    )
    inst = _line_instance(problem, [11, 13, 10, 50, 10, 50])
    assert inst.open_end.tolist() == [True, False]
    ev = evaluate(inst, RouteSet([[0, 1], []]))
    assert ev.total_distance_km == pytest.approx(3.0, abs=TOL)
    assert ev.total_duration_min == pytest.approx(12.0, abs=TOL)
    assert ev.total_cost_mxn == pytest.approx(3.0 * KM_COST + 12.0 + 50.0, abs=TOL)
    assert ev.makespan_min == pytest.approx(30.0 + 12.0, abs=TOL)
    assert ev.vehicles_used == 1
    assert ev.fitness == pytest.approx(12.0**2 / inst.obj_scale[3] ** 2, abs=TOL)


def test_time_window_wait_and_priority_lateness() -> None:
    problem = Problem(
        mode=ProblemMode.DEPOT,
        depot=LOCATION,
        drivers=[Driver(id="a", vehicle_type_id="van", hourly_wage_mxn=60.0)],
        vehicle_types=[_vehicle("van", FuelType.GASOLINE, 1.0, 0.0)],
        stops=[
            _stop("s0", tw_start_min=10.0, tw_end_min=10.0),
            _stop("s1", tw_start_min=0.0, tw_end_min=5.0, priority=Priority.HIGH),
        ],
        distance_source=DistanceSource.HAVERSINE,
        objective=Objective(
            weights=ObjectiveWeights(time=1.0, cost=0.0, vehicles=0.0, makespan=0.0)
        ),
    )
    inst = _line_instance(problem, [1, 2, 0, 0])
    ev = evaluate(inst, RouteSet([[0, 1]]))
    assert ev.lateness_min == pytest.approx(10.0 * 3.0, abs=TOL)
    assert ev.total_duration_min == pytest.approx(22.0, abs=TOL)
    expected = 22.0 / inst.obj_scale[0] + 10.0 * 30.0 / 60.0
    assert ev.fitness == pytest.approx(expected, abs=TOL)
    assert ev.feasible
    reversed_ev = evaluate(inst, RouteSet([[1, 0]]))
    assert reversed_ev.lateness_min == pytest.approx(0.0, abs=TOL)


def test_overload_overtime_unassigned_penalties() -> None:
    inst = make_instance(n=10, m=2, tight_capacity=True)
    rs = RouteSet([list(range(8)), []], [8, 9])
    ev = evaluate(inst, rs)
    assert ev.unassigned == 2
    assert not ev.feasible
    mean_kg = float(np.mean(inst.cap_kg))
    parts = ev.fitness - 2 * Penalties().unassigned
    assert parts >= Penalties().capacity * ev.overload_kg / mean_kg - 1e-9
    heavier = evaluate(inst, rs, Penalties(unassigned=5.0))
    assert heavier.fitness < ev.fitness


def test_missing_stop_counts_as_unassigned() -> None:
    inst = make_instance(n=6, m=2)
    ev = evaluate(inst, RouteSet([[0, 1, 2], [3, 4]], []))
    assert ev.unassigned == 1


def test_route_cost_components_matches_evaluate() -> None:
    inst = make_instance(n=12, m=3, time_windows=True)
    rs = RouteSet([[0, 1, 2, 3], [4, 5, 6], [7, 8, 9, 10, 11]])
    ev = evaluate(inst, rs)
    parts = [
        route_cost_components(inst, k, np.array(r, dtype=np.int64)) for k, r in enumerate(rs.routes)
    ]
    assert sum(p[0] for p in parts) == pytest.approx(ev.total_distance_km, abs=TOL)
    assert sum(p[1] for p in parts) == pytest.approx(ev.total_duration_min, abs=TOL)
    assert sum(p[5] for p in parts) == pytest.approx(ev.lateness_min, abs=TOL)
    assert sum(p[7] for p in parts) == pytest.approx(ev.total_cost_mxn, abs=TOL)
    assert route_cost_components(inst, 0, np.array([], dtype=np.int64)) == (0.0,) * 8
    assert additive_cost(inst, rs) <= ev.fitness + TOL


def test_validate_routeset() -> None:
    inst = make_instance(n=5, m=2)
    validate_routeset(inst, RouteSet([[0, 1], [2, 3]], [4]))
    with pytest.raises(ValueError):
        validate_routeset(inst, RouteSet([[0, 1], [1, 2]], [3, 4]))
    with pytest.raises(ValueError):
        validate_routeset(inst, RouteSet([[0, 1], [2, 7]], [3, 4]))
    with pytest.raises(ValueError):
        validate_routeset(inst, RouteSet([[0, 1], [2]], [3]))
    with pytest.raises(ValueError):
        validate_routeset(inst, RouteSet([[0, 1, 2, 3, 4]], []))


@pytest.mark.slow
def test_evaluate_speed() -> None:
    inst = make_instance(n=200, m=20, seed=1)
    routes = [list(range(k, 200, 20)) for k in range(20)]
    rs = RouteSet(routes)
    evaluate(inst, rs)
    runs = 300
    begin = time.perf_counter()
    for _ in range(runs):
        evaluate(inst, rs)
    per_call_ms = (time.perf_counter() - begin) / runs * 1000.0
    assert per_call_ms < 0.3
