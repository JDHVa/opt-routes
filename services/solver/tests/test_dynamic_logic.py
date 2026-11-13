from __future__ import annotations

import pytest

from routeopt.api.schemas import TriggerMode
from routeopt.core.construct import nearest_neighbor
from routeopt.core.instance import build_instance, instance_locations
from routeopt.core.models import DistanceSource, Problem, ProblemMode, Stop
from routeopt.core.types import Instance, RouteSet
from routeopt.data.scenarios import load_scenario
from routeopt.distances.haversine import haversine_matrix
from routeopt.dynamic.reoptimizer import SubProblem, build_subproblem, warm_start
from routeopt.dynamic.simulator import Simulation


def make_problem(n: int = 12, late: dict[str, float] | None = None) -> Problem:
    base = load_scenario("mty-centro-depot-40")
    stops = [
        stop.model_copy(update={"release_min": (late or {}).get(stop.id, 0.0)})
        for stop in base.stops[:n]
    ]
    return base.model_copy(
        update={
            "stops": stops,
            "drivers": base.drivers[:2],
            "distance_source": DistanceSource.HAVERSINE,
        }
    )


def make_instance(problem: Problem) -> Instance:
    matrix = haversine_matrix(instance_locations(problem))
    return build_instance(problem, matrix.dist_km, matrix.dur_min)


def plan_initial(sim: Simulation) -> Instance:
    known = sim.known_problem()
    assert known is not None
    inst = make_instance(known)
    sim.install_initial(inst, nearest_neighbor(inst))
    return inst


def reoptimize(sim: Simulation) -> tuple[SubProblem, Instance, RouteSet] | None:
    sub = sim.begin_reopt()
    if sub is None:
        return None
    inst = make_instance(sub.problem)
    return sub, inst, warm_start(inst, sub)


def stop_at(problem: Problem, index: int, stop_id: str, release: float) -> Stop:
    template = problem.stops[index]
    return template.model_copy(update={"id": stop_id, "release_min": release})


def test_orders_are_revealed_at_their_release_time() -> None:
    base = make_problem()
    late = {base.stops[10].id: 30.0, base.stops[11].id: 90.0}
    sim = Simulation(make_problem(late=late), TriggerMode.EVENT, 15.0)
    assert len(sim.state.stops) == 10
    plan_initial(sim)
    assert sim.advance(29.0).revealed == []
    first = sim.advance(30.0).revealed
    assert [s.id for s in first] == [base.stops[10].id]
    assert sim.state.pending_new == [base.stops[10].id]
    assert sim.advance(89.9).revealed == []
    second = sim.advance(95.0).revealed
    assert [s.id for s in second] == [base.stops[11].id]


def test_batch_trigger_waits_for_the_window() -> None:
    base = make_problem()
    late = {base.stops[11].id: 5.0}
    sim = Simulation(make_problem(late=late), TriggerMode.BATCH, 20.0)
    plan_initial(sim)
    sim.advance(6.0)
    assert sim.reopt_reason() is None
    sim.advance(20.0)
    assert sim.reopt_reason() == "batch"


def test_event_trigger_reoptimizes_immediately() -> None:
    base = make_problem()
    late = {base.stops[11].id: 5.0}
    sim = Simulation(make_problem(late=late), TriggerMode.EVENT, 20.0)
    plan_initial(sim)
    sim.advance(6.0)
    assert sim.reopt_reason() == "event"


def test_subproblem_drops_delivered_and_pins_committed_stop() -> None:
    sim = Simulation(make_problem(), TriggerMode.EVENT, 15.0)
    plan_initial(sim)
    sim.advance(25.0)
    delivered = set(sim.state.delivered)
    assert delivered
    heads = {
        driver_id: track.visits[0]
        for driver_id, track in sim.state.tracks.items()
        if track.visits
    }
    sub = build_subproblem(sim.state)
    assert sub is not None
    assert sub.problem.mode == ProblemMode.MULTI_ORIGIN
    sub_ids = {stop.id for stop in sub.problem.stops}
    committed_ids = {sid for sid in sub.committed.values() if sid}
    assert not sub_ids & delivered
    assert not sub_ids & committed_ids
    assert sub_ids | committed_ids | delivered == {s.id for s in sim.state.problem.stops}
    for driver in sub.problem.drivers:
        if driver.id not in heads:
            assert sub.committed[driver.id] is None
            continue
        head = heads[driver.id]
        assert sub.committed[driver.id] == head.stop_id
        assert driver.start is not None
        assert driver.start.lat == pytest.approx(head.location.lat)
        assert driver.shift_start_min == pytest.approx(head.departure)
        assert driver.end == sim.state.problem.depot
        original = next(d for d in sim.state.problem.drivers if d.id == driver.id)
        assert driver.shift_start_min + driver.max_shift_min == pytest.approx(
            original.shift_start_min + original.max_shift_min
        )


def test_splice_removes_stops_delivered_during_optimization() -> None:
    sim = Simulation(make_problem(), TriggerMode.EVENT, 15.0)
    plan_initial(sim)
    sim.advance(20.0)
    prepared = reoptimize(sim)
    assert prepared is not None
    sub, inst, routes = prepared
    before = set(sim.state.delivered)
    interim = sim.advance(120.0)
    assert interim.delivered
    sim.finish_reopt(sub, inst, routes)
    planned = [v.stop_id for t in sim.state.tracks.values() for v in t.visits]
    assert not set(planned) & sim.state.delivered
    assert not set(planned) & before
    assert len(planned) == len(set(planned))
    accounted = set(planned) | sim.state.delivered | sim.state.unassigned
    assert accounted == {s.id for s in sim.state.problem.stops}
    for track in sim.state.tracks.values():
        pending_visits = [v for v in track.visits if v.stop_id not in sub.committed.values()]
        assert all(v.arrival >= 120.0 - 1e-6 for v in pending_visits)


def test_full_simulation_delivers_every_order_including_dynamic() -> None:
    base = make_problem()
    late = {base.stops[10].id: 40.0, base.stops[11].id: 70.0}
    sim = Simulation(make_problem(late=late), TriggerMode.EVENT, 15.0)
    plan_initial(sim)
    injected = stop_at(base, 3, "injected-1", 0.0)
    scheduled = stop_at(base, 5, "scheduled-1", 150.0)
    clock = 0.0
    reopts = 0
    for step in range(2000):
        clock += 5.0
        if step == 6:
            assert sim.add_order(injected) is not None
        if step == 8:
            assert sim.add_order(scheduled) is None
        sim.advance(clock)
        if sim.reopt_reason() is not None:
            prepared = reoptimize(sim)
            if prepared is not None:
                sim.finish_reopt(*prepared)
                reopts += 1
        if sim.done():
            break
    assert sim.done()
    expected = {s.id for s in base.stops} | {"injected-1", "scheduled-1"}
    assert sim.state.delivered == expected
    assert reopts >= 3
    metrics = sim.final_metrics()
    assert metrics.unassigned == 0
    assert metrics.total_distance_km > 0
    assert metrics.vehicles_used >= 1


def test_duplicate_order_is_rejected() -> None:
    base = make_problem()
    sim = Simulation(make_problem(), TriggerMode.EVENT, 15.0)
    plan_initial(sim)
    with pytest.raises(ValueError):
        sim.add_order(base.stops[0])


def test_positions_interpolate_between_nodes() -> None:
    sim = Simulation(make_problem(), TriggerMode.EVENT, 15.0)
    plan_initial(sim)
    track = next(t for t in sim.state.tracks.values() if t.visits)
    first = track.visits[0]
    midpoint = (track.origin_time + first.arrival) / 2
    sim.advance(midpoint)
    position = next(p for p in sim.positions() if p.driver_id == track.driver_id)
    assert position.next_stop_id == first.stop_id
    low = min(track.origin.lat, first.location.lat)
    high = max(track.origin.lat, first.location.lat)
    assert low - 1e-9 <= position.location.lat <= high + 1e-9
    assert position.location.lat != pytest.approx(track.origin.lat, abs=1e-9)
