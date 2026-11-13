from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from routeopt.core.models import DistanceSource, Driver, Problem, ProblemMode
from routeopt.core.types import Instance, RouteSet
from routeopt.dynamic.state import (
    DriverTrack,
    SimState,
    location_of,
    plan_route,
)


@dataclass(slots=True)
class SubProblem:
    problem: Problem
    clock: float
    committed: dict[str, str | None]
    planned: dict[str, list[str]]


def build_subproblem(state: SimState) -> SubProblem | None:
    problem = state.problem
    clock = state.clock
    committed: dict[str, str | None] = {}
    planned: dict[str, list[str]] = {}
    drivers: list[Driver] = []
    for driver in problem.drivers:
        track = state.tracks[driver.id]
        head = track.visits[0] if track.visits else None
        if head is not None:
            start, start_time = head.location, head.departure
            committed[driver.id] = head.stop_id
            planned[driver.id] = [v.stop_id for v in track.visits[1:]]
        else:
            start, start_time = track.last_location(), clock
            committed[driver.id] = None
            planned[driver.id] = []
        if problem.mode == ProblemMode.DEPOT:
            end = problem.depot
        else:
            end = driver.end
        remaining = max(driver.shift_start_min + driver.max_shift_min - start_time, 1.0)
        drivers.append(
            driver.model_copy(
                update={
                    "start": start,
                    "end": end,
                    "shift_start_min": start_time,
                    "max_shift_min": remaining,
                }
            )
        )
    skipped = {stop_id for stop_id in committed.values() if stop_id is not None}
    stops = [
        stop
        for stop in state.stops.values()
        if stop.id not in state.delivered and stop.id not in skipped
    ]
    if not stops:
        return None
    source = (
        DistanceSource.HAVERSINE
        if problem.distance_source == DistanceSource.PROVIDED
        else problem.distance_source
    )
    sub = Problem(
        name=problem.name,
        mode=ProblemMode.MULTI_ORIGIN,
        depot=problem.depot,
        depot_id=problem.depot_id,
        drivers=drivers,
        vehicle_types=problem.vehicle_types,
        stops=stops,
        objective=problem.objective,
        costs=problem.costs,
        constraints=problem.constraints,
        distance_source=source,
        matrix=None,
    )
    return SubProblem(problem=sub, clock=clock, committed=committed, planned=planned)


def _cheapest_insertion(inst: Instance, routes: list[list[int]], stop: int) -> None:
    n, m = inst.n, inst.m
    best_delta = np.inf
    best_k = 0
    best_pos = 0
    for k, route in enumerate(routes):
        nodes = [n + k, *route, n + m + k]
        for pos in range(len(route) + 1):
            a, b = nodes[pos], nodes[pos + 1]
            delta = inst.dist[a, stop] + inst.dist[stop, b] - inst.dist[a, b]
            if delta < best_delta:
                best_delta, best_k, best_pos = delta, k, pos
    routes[best_k].insert(best_pos, stop)


def warm_start(inst: Instance, sub: SubProblem) -> RouteSet:
    index = {stop_id: i for i, stop_id in enumerate(inst.stop_ids)}
    routes = [
        [index[stop_id] for stop_id in sub.planned[driver_id] if stop_id in index]
        for driver_id in inst.driver_ids
    ]
    placed = {i for route in routes for i in route}
    for stop in range(inst.n):
        if stop not in placed:
            _cheapest_insertion(inst, routes, stop)
    return RouteSet(routes, [])


def install_tracks(state: SimState, inst: Instance) -> None:
    problem = state.problem
    for k, driver in enumerate(problem.drivers):
        shift_start = float(inst.shift_start[k])
        state.tracks[driver.id] = DriverTrack(
            driver_id=driver.id,
            vehicle_type_id=driver.vehicle_type_id,
            origin=location_of(inst, inst.start_node(k)),
            origin_time=shift_start,
            shift_start=shift_start,
            shift_end=shift_start + float(inst.max_shift[k]),
            cap_kg=float(inst.cap_kg[k]),
            cap_m3=float(inst.cap_m3[k]),
            cost_per_km=float(inst.cost_per_km[k]),
            cost_per_min=float(inst.cost_per_min[k]),
            fixed_cost=float(inst.fixed_cost[k]),
        )


def splice(
    state: SimState,
    committed: dict[str, str | None],
    inst: Instance,
    routes: RouteSet,
) -> None:
    index = {stop_id: i for i, stop_id in enumerate(inst.stop_ids)}
    clock = state.clock
    for k, driver_id in enumerate(inst.driver_ids):
        track = state.tracks[driver_id]
        route = [i for i in routes.routes[k] if inst.stop_ids[i] not in state.delivered]
        head_id = committed.get(driver_id)
        keeps_head = (
            head_id is not None
            and head_id not in state.delivered
            and bool(track.visits)
            and track.visits[0].stop_id == head_id
        )
        if keeps_head:
            head = track.visits[0]
            plan = plan_route(inst, k, inst.start_node(k), head.departure, route)
            track.visits = [head, *plan.visits]
        else:
            last = track.completed[-1] if track.completed else None
            anchor = index.get(last.stop_id, inst.start_node(k)) if last else inst.start_node(k)
            start_time = max(clock, track.shift_start)
            plan = plan_route(inst, k, anchor, start_time, route)
            track.visits = plan.visits
            track.origin = location_of(inst, anchor)
            track.origin_time = start_time
        if track.visits or track.completed:
            track.end_location = plan.end_location
            track.end_time = plan.end_time
            track.end_leg_km = plan.end_leg_km
        else:
            track.end_location = None
            track.end_time = None
            track.end_leg_km = 0.0
    planned = {v.stop_id for t in state.tracks.values() for v in t.visits}
    state.unassigned = {
        stop_id
        for stop_id in inst.stop_ids
        if stop_id not in state.delivered and stop_id not in planned
    }
