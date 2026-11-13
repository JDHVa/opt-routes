from __future__ import annotations

from dataclasses import dataclass, field

from routeopt.api.schemas import DriverPosition
from routeopt.core import models
from routeopt.core.models import Location, Problem, Solution, SolutionMetrics, Stop
from routeopt.core.types import Instance


@dataclass(slots=True)
class PlannedVisit:
    stop_id: str
    location: Location
    arrival: float
    start_service: float
    departure: float
    late: float
    leg_km: float
    demand_kg: float
    demand_m3: float


@dataclass(slots=True)
class RoutePlan:
    visits: list[PlannedVisit]
    end_location: Location | None
    end_time: float | None
    end_leg_km: float


@dataclass(slots=True)
class DriverTrack:
    driver_id: str
    vehicle_type_id: str
    origin: Location
    origin_time: float
    shift_start: float
    shift_end: float
    cap_kg: float
    cap_m3: float
    cost_per_km: float
    cost_per_min: float
    fixed_cost: float
    visits: list[PlannedVisit] = field(default_factory=list)
    completed: list[PlannedVisit] = field(default_factory=list)
    end_location: Location | None = None
    end_time: float | None = None
    end_leg_km: float = 0.0

    def last_location(self) -> Location:
        return self.completed[-1].location if self.completed else self.origin


@dataclass(slots=True)
class SimState:
    problem: Problem
    stops: dict[str, Stop]
    future: list[Stop]
    pending_new: list[str] = field(default_factory=list)
    delivered: set[str] = field(default_factory=set)
    unassigned: set[str] = field(default_factory=set)
    tracks: dict[str, DriverTrack] = field(default_factory=dict)
    clock: float = 0.0


@dataclass(slots=True)
class Advance:
    revealed: list[Stop]
    delivered: list[str]


def new_state(problem: Problem) -> SimState:
    known = {stop.id: stop for stop in problem.stops if stop.release_min <= 0.0}
    future = sorted(
        (stop for stop in problem.stops if stop.release_min > 0.0), key=lambda s: s.release_min
    )
    return SimState(problem=problem, stops=known, future=future)


def known_problem(state: SimState) -> Problem:
    return state.problem.model_copy(update={"stops": list(state.stops.values())})


def location_of(inst: Instance, node: int) -> Location:
    return Location(lat=float(inst.coords[node, 0]), lon=float(inst.coords[node, 1]))


def plan_route(
    inst: Instance, k: int, anchor: int, start_time: float, route: list[int]
) -> RoutePlan:
    speed = float(inst.speed_factor[k])
    t = start_time
    prev = anchor
    visits: list[PlannedVisit] = []
    for i in route:
        leg_km = float(inst.dist[prev, i])
        t += float(inst.dur[prev, i]) * speed
        arrival = t
        late = 0.0
        if inst.tw_enabled:
            t = max(t, float(inst.tw_start[i]))
            late = max(0.0, t - float(inst.tw_end[i]))
        begin = t
        t += float(inst.service[i])
        visits.append(
            PlannedVisit(
                stop_id=inst.stop_ids[i],
                location=location_of(inst, i),
                arrival=arrival,
                start_service=begin,
                departure=t,
                late=late,
                leg_km=leg_km,
                demand_kg=float(inst.demand_kg[i]),
                demand_m3=float(inst.demand_m3[i]),
            )
        )
        prev = i
    if inst.open_end[k]:
        return RoutePlan(visits, None, None, 0.0)
    end_node = inst.end_node(k)
    return RoutePlan(
        visits,
        location_of(inst, end_node),
        t + float(inst.dur[prev, end_node]) * speed,
        float(inst.dist[prev, end_node]),
    )


def reveal(state: SimState, stop: Stop) -> None:
    if stop.id in state.stops or any(f.id == stop.id for f in state.future):
        raise ValueError(f"duplicate stop id: {stop.id}")
    state.stops[stop.id] = stop
    state.pending_new.append(stop.id)


def queue_order(state: SimState, stop: Stop) -> Stop | None:
    if stop.release_min <= state.clock:
        reveal(state, stop)
        return stop
    if stop.id in state.stops or any(f.id == stop.id for f in state.future):
        raise ValueError(f"duplicate stop id: {stop.id}")
    state.future.append(stop)
    state.future.sort(key=lambda s: s.release_min)
    return None


def advance(state: SimState, clock: float) -> Advance:
    state.clock = max(state.clock, clock)
    revealed: list[Stop] = []
    while state.future and state.future[0].release_min <= state.clock:
        stop = state.future.pop(0)
        reveal(state, stop)
        revealed.append(stop)
    finished: list[tuple[float, str]] = []
    for track in state.tracks.values():
        while track.visits and track.visits[0].departure <= state.clock:
            visit = track.visits.pop(0)
            track.completed.append(visit)
            track.origin = visit.location
            track.origin_time = visit.departure
            state.delivered.add(visit.stop_id)
            finished.append((visit.departure, visit.stop_id))
    finished.sort()
    return Advance(revealed, [stop_id for _, stop_id in finished])


def is_done(state: SimState) -> bool:
    return (
        not state.future
        and not state.pending_new
        and all(not track.visits for track in state.tracks.values())
    )


def _interpolate(a: Location, t0: float, b: Location, t1: float, clock: float) -> Location:
    span = t1 - t0
    if span <= 0.0:
        return b
    fraction = min(1.0, max(0.0, (clock - t0) / span))
    return Location(lat=a.lat + (b.lat - a.lat) * fraction, lon=a.lon + (b.lon - a.lon) * fraction)


def track_position(track: DriverTrack, clock: float) -> tuple[Location, str | None]:
    prev_location, prev_time = track.origin, track.origin_time
    for visit in track.visits:
        if clock < visit.arrival:
            where = _interpolate(prev_location, prev_time, visit.location, visit.arrival, clock)
            return where, visit.stop_id
        if clock <= visit.departure:
            return visit.location, visit.stop_id
        prev_location, prev_time = visit.location, visit.departure
    if track.end_location is not None and track.end_time is not None:
        return _interpolate(
            prev_location, prev_time, track.end_location, track.end_time, clock
        ), None
    return prev_location, None


def positions(state: SimState) -> list[DriverPosition]:
    result: list[DriverPosition] = []
    for track in state.tracks.values():
        where, next_stop = track_position(track, state.clock)
        result.append(
            DriverPosition(
                driver_id=track.driver_id,
                location=where,
                next_stop_id=next_stop,
                completed=len(track.completed),
                remaining=len(track.visits),
            )
        )
    return result


def _route_model(
    track: DriverTrack,
    visits: list[PlannedVisit],
    start_min: float,
    end_min: float,
    end_leg_km: float,
) -> models.Route:
    distance = sum(v.leg_km for v in visits) + end_leg_km
    duration = max(0.0, end_min - start_min)
    return models.Route(
        driver_id=track.driver_id,
        vehicle_type_id=track.vehicle_type_id,
        visits=[
            models.Visit(
                stop_id=v.stop_id,
                arrival_min=v.arrival,
                start_service_min=v.start_service,
                departure_min=v.departure,
                late_min=v.late,
            )
            for v in visits
        ],
        metrics=models.RouteMetrics(
            distance_km=distance,
            duration_min=duration,
            start_min=start_min,
            end_min=end_min,
            load_kg=sum(v.demand_kg for v in visits),
            load_m3=sum(v.demand_m3 for v in visits),
            cost_mxn=distance * track.cost_per_km
            + duration * track.cost_per_min
            + track.fixed_cost,
            lateness_min=sum(v.late for v in visits),
            overtime_min=max(0.0, end_min - track.shift_end),
        ),
    )


def _aggregate(
    routes: list[models.Route],
    tracks: dict[str, DriverTrack],
    unassigned: int,
    fitness: float,
) -> SolutionMetrics:
    overload_kg = 0.0
    overload_m3 = 0.0
    for route in routes:
        track = tracks[route.driver_id]
        overload_kg += max(0.0, route.metrics.load_kg - track.cap_kg)
        overload_m3 += max(0.0, route.metrics.load_m3 - track.cap_m3)
    overtime = sum(r.metrics.overtime_min for r in routes)
    return SolutionMetrics(
        total_distance_km=sum(r.metrics.distance_km for r in routes),
        total_duration_min=sum(r.metrics.duration_min for r in routes),
        makespan_min=max((r.metrics.end_min for r in routes), default=0.0),
        vehicles_used=len(routes),
        total_cost_mxn=sum(r.metrics.cost_mxn for r in routes),
        lateness_min=sum(r.metrics.lateness_min for r in routes),
        overload_kg=overload_kg,
        overload_m3=overload_m3,
        overtime_min=overtime,
        unassigned=unassigned,
        feasible=unassigned == 0
        and overload_kg <= 1e-9
        and overload_m3 <= 1e-9
        and overtime <= 1e-9,
        fitness=fitness,
    )


def plan_solution(state: SimState, algorithm: str, runtime_s: float, fitness: float) -> Solution:
    routes: list[models.Route] = []
    for track in state.tracks.values():
        if not track.visits:
            continue
        end_min = track.end_time if track.end_time is not None else track.visits[-1].departure
        routes.append(
            _route_model(track, track.visits, track.origin_time, end_min, track.end_leg_km)
        )
    planned = {visit.stop_id for track in state.tracks.values() for visit in track.visits}
    pending = [
        stop_id
        for stop_id in state.stops
        if stop_id not in state.delivered and stop_id not in planned
    ]
    return Solution(
        algorithm=algorithm,
        routes=routes,
        unassigned_stop_ids=pending,
        metrics=_aggregate(routes, state.tracks, len(pending), fitness),
        runtime_s=runtime_s,
    )


def executed_metrics(state: SimState) -> SolutionMetrics:
    routes: list[models.Route] = []
    for track in state.tracks.values():
        if not track.completed:
            continue
        returned = not track.visits and track.end_time is not None
        end_min = (
            track.end_time
            if returned and track.end_time is not None
            else track.completed[-1].departure
        )
        routes.append(
            _route_model(
                track,
                track.completed,
                track.shift_start,
                end_min,
                track.end_leg_km if returned else 0.0,
            )
        )
    undelivered = len(state.stops) - len(state.delivered)
    return _aggregate(routes, state.tracks, undelivered, 0.0)
