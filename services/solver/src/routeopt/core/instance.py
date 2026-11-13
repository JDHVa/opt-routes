from __future__ import annotations

import numpy as np

from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate
from routeopt.core.models import (
    PRIORITY_LATENESS_FACTOR,
    DistanceSource,
    FuelType,
    Location,
    Problem,
    ProblemMode,
    VehicleType,
)
from routeopt.core.types import F64, Instance


def _require(location: Location | None, what: str) -> Location:
    if location is None:
        raise ValueError(f"missing location: {what}")
    return location


def _start_location(problem: Problem, index: int) -> Location:
    driver = problem.drivers[index]
    if problem.mode == ProblemMode.DEPOT:
        return _require(problem.depot, "depot")
    return _require(driver.start, f"{driver.id}:start")


def _end_location(problem: Problem, index: int) -> Location:
    driver = problem.drivers[index]
    if problem.mode == ProblemMode.DEPOT:
        return _require(problem.depot, "depot")
    return driver.end if driver.end is not None else _start_location(problem, index)


def instance_locations(problem: Problem) -> list[Location]:
    m = len(problem.drivers)
    locations = [stop.location for stop in problem.stops]
    locations.extend(_start_location(problem, k) for k in range(m))
    locations.extend(_end_location(problem, k) for k in range(m))
    return locations


def _open_end_flags(problem: Problem) -> np.ndarray[tuple[int], np.dtype[np.bool_]]:
    return np.array(
        [
            problem.mode == ProblemMode.MULTI_ORIGIN and driver.end is None
            for driver in problem.drivers
        ],
        dtype=np.bool_,
    )


def _provided_matrices(problem: Problem) -> tuple[F64, F64]:
    matrix = problem.matrix
    if matrix is None:
        raise ValueError("distance_source=provided requires `matrix`")
    positions = {node_id: i for i, node_id in enumerate(matrix.node_ids)}

    def lookup(*candidates: str) -> int:
        for candidate in candidates:
            if candidate in positions:
                return positions[candidate]
        raise ValueError(f"matrix.node_ids has none of {candidates}")

    depot_mode = problem.mode == ProblemMode.DEPOT
    indices = [lookup(stop.id) for stop in problem.stops]
    for driver in problem.drivers:
        starts = (f"{driver.id}:start", problem.depot_id) if depot_mode else (f"{driver.id}:start",)
        indices.append(lookup(*starts))
    for driver in problem.drivers:
        ends = (
            (f"{driver.id}:end", problem.depot_id)
            if depot_mode
            else (f"{driver.id}:end", f"{driver.id}:start")
        )
        indices.append(lookup(*ends))
    size = len(matrix.node_ids)
    full_dist = np.asarray(matrix.distance_km, dtype=np.float64)
    full_dur = np.asarray(matrix.duration_min, dtype=np.float64)
    if full_dist.shape != (size, size) or full_dur.shape != (size, size):
        raise ValueError("provided matrices must be square and match node_ids")
    selector = np.ix_(indices, indices)
    return full_dist[selector], full_dur[selector]


def _cost_per_km(vehicle: VehicleType, problem: Problem) -> float:
    if vehicle.fuel_type == FuelType.ELECTRIC:
        assert vehicle.kwh_per_100km is not None
        return vehicle.kwh_per_100km / 100.0 * problem.costs.electricity_mxn_per_kwh
    assert vehicle.km_per_l is not None
    price = (
        problem.costs.diesel_mxn_per_l
        if vehicle.fuel_type == FuelType.DIESEL
        else problem.costs.gasoline_mxn_per_l
    )
    return price / vehicle.km_per_l


def _normalized_weights(problem: Problem) -> F64:
    w = problem.objective.weights
    raw = np.array([w.time, w.cost, w.vehicles, w.makespan], dtype=np.float64)
    total = raw.sum()
    if total <= 0.0:
        return np.array([1.0, 0.0, 0.0, 0.0])
    return raw / total


def build_instance(
    problem: Problem, dist: np.ndarray | None = None, dur: np.ndarray | None = None
) -> Instance:
    n = len(problem.stops)
    m = len(problem.drivers)
    size = n + 2 * m
    if problem.distance_source == DistanceSource.PROVIDED:
        dist_m, dur_m = _provided_matrices(problem)
    else:
        if dist is None or dur is None:
            raise ValueError("dist and dur are required unless distance_source=provided")
        dist_m = np.array(dist, dtype=np.float64)
        dur_m = np.array(dur, dtype=np.float64)
        if dist_m.shape != (size, size) or dur_m.shape != (size, size):
            raise ValueError(f"dist and dur must be {size}x{size}")
    open_end = _open_end_flags(problem)
    for k in np.flatnonzero(open_end):
        dist_m[:, n + m + k] = 0.0
        dur_m[:, n + m + k] = 0.0

    types = {vehicle.id: vehicle for vehicle in problem.vehicle_types}
    vehicles = [types[driver.vehicle_type_id] for driver in problem.drivers]
    toggles = problem.constraints
    stops = problem.stops
    inf = np.inf

    cap_kg = np.array([v.payload_kg for v in vehicles], dtype=np.float64)
    cap_m3 = np.array([v.volume_m3 for v in vehicles], dtype=np.float64)
    if not toggles.capacity_kg:
        cap_kg[:] = inf
    if not toggles.capacity_m3:
        cap_m3[:] = inf
    max_shift = np.array([d.max_shift_min for d in problem.drivers], dtype=np.float64)
    if not toggles.max_shift:
        max_shift[:] = inf
    priority_w = np.array(
        [PRIORITY_LATENESS_FACTOR[s.priority] if toggles.priorities else 1.0 for s in stops],
        dtype=np.float64,
    )

    inst = Instance(
        name=problem.name,
        n=n,
        m=m,
        dist=np.ascontiguousarray(dist_m),
        dur=np.ascontiguousarray(dur_m),
        demand_kg=np.array([s.demand_kg for s in stops], dtype=np.float64),
        demand_m3=np.array([s.demand_m3 for s in stops], dtype=np.float64),
        service=np.array([s.service_min for s in stops], dtype=np.float64),
        tw_start=np.array(
            [0.0 if s.tw_start_min is None else s.tw_start_min for s in stops], dtype=np.float64
        ),
        tw_end=np.array(
            [inf if s.tw_end_min is None else s.tw_end_min for s in stops], dtype=np.float64
        ),
        priority_w=priority_w,
        release=np.array([s.release_min for s in stops], dtype=np.float64),
        cap_kg=cap_kg,
        cap_m3=cap_m3,
        shift_start=np.array([d.shift_start_min for d in problem.drivers], dtype=np.float64),
        max_shift=max_shift,
        speed_factor=np.array([v.speed_factor for v in vehicles], dtype=np.float64),
        cost_per_km=np.array([_cost_per_km(v, problem) for v in vehicles], dtype=np.float64),
        cost_per_min=np.array(
            [d.hourly_wage_mxn / 60.0 for d in problem.drivers], dtype=np.float64
        ),
        fixed_cost=np.array([v.fixed_cost_mxn for v in vehicles], dtype=np.float64),
        open_end=open_end,
        weights=_normalized_weights(problem),
        obj_scale=np.ones(4, dtype=np.float64),
        tw_enabled=toggles.time_windows,
        stop_ids=[s.id for s in stops],
        driver_ids=[d.id for d in problem.drivers],
        vehicle_type_ids=[d.vehicle_type_id for d in problem.drivers],
    )
    baseline = evaluate(inst, nearest_neighbor(inst))
    inst.obj_scale = np.maximum(baseline.objectives, 1.0)
    return inst
