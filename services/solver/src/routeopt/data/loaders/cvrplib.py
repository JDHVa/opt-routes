from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import vrplib

from routeopt.core.models import (
    ConstraintToggles,
    CostParams,
    DistanceSource,
    Driver,
    FuelType,
    Location,
    Objective,
    ObjectiveWeights,
    Problem,
    ProblemMode,
    ProvidedMatrix,
    Stop,
    VehicleCategory,
    VehicleType,
)
from routeopt.core.types import F64

CENTER_LAT = 25.6866
CENTER_LON = -100.3161
MAP_SPAN_DEG = 0.3
UNLIMITED_VOLUME_M3 = 1e9
UNLIMITED_SHIFT_MIN = 1e9
VEHICLE_TYPE_ID = "benchmark"
DEPOT_ID = "depot"


def map_locations(coords: F64) -> list[Location]:
    center = (coords.min(axis=0) + coords.max(axis=0)) / 2.0
    span = max(float((coords.max(axis=0) - coords.min(axis=0)).max()), 1e-9)
    scaled = (coords - center) / span * MAP_SPAN_DEG
    return [Location(lat=CENTER_LAT + float(y), lon=CENTER_LON + float(x)) for x, y in scaled]


def vehicle_type(capacity: float, gasoline_mxn_per_l: float) -> VehicleType:
    return VehicleType(
        id=VEHICLE_TYPE_ID,
        name=VEHICLE_TYPE_ID,
        brand="benchmark",
        category=VehicleCategory.TRUCK,
        payload_kg=float(capacity),
        volume_m3=UNLIMITED_VOLUME_M3,
        fuel_type=FuelType.GASOLINE,
        km_per_l=gasoline_mxn_per_l,
    )


def drivers(count: int, hourly_wage_mxn: float = 0.0) -> list[Driver]:
    return [
        Driver(
            id=f"d{k}",
            vehicle_type_id=VEHICLE_TYPE_ID,
            max_shift_min=UNLIMITED_SHIFT_MIN,
            hourly_wage_mxn=hourly_wage_mxn,
        )
        for k in range(count)
    ]


def provided_matrix(distance: F64) -> ProvidedMatrix:
    node_ids = [DEPOT_ID, *(str(i) for i in range(1, distance.shape[0]))]
    rows = distance.tolist()
    return ProvidedMatrix(node_ids=node_ids, distance_km=rows, duration_min=rows)


def euclidean(coords: F64) -> F64:
    diff = coords[:, None, :] - coords[None, :, :]
    result: F64 = np.sqrt((diff**2).sum(axis=-1))
    return result


def trucks_from_name(name: str) -> int:
    match = re.search(r"-k(\d+)", name)
    if match is None:
        raise ValueError(f"cannot read the vehicle count from instance name: {name}")
    return int(match.group(1))


def load_cvrplib(path: str | Path) -> Problem:
    raw = vrplib.read_instance(str(path), compute_edge_weights=False)
    coords = np.asarray(raw["node_coord"], dtype=np.float64)
    demand = np.asarray(raw["demand"], dtype=np.float64)
    distance = np.floor(euclidean(coords) + 0.5)
    locations = map_locations(coords)
    trucks = trucks_from_name(str(raw["name"]))
    costs = CostParams()
    stops = [
        Stop(
            id=str(i),
            location=locations[i],
            demand_kg=float(demand[i]),
            demand_m3=0.0,
            service_min=0.0,
        )
        for i in range(1, coords.shape[0])
    ]
    return Problem(
        name=str(raw["name"]),
        mode=ProblemMode.DEPOT,
        depot=locations[0],
        depot_id=DEPOT_ID,
        drivers=drivers(trucks + max(1, trucks // 5)),
        vehicle_types=[vehicle_type(float(raw["capacity"]), costs.gasoline_mxn_per_l)],
        stops=stops,
        objective=Objective(
            weights=ObjectiveWeights(time=0.0, cost=1.0, vehicles=0.0, makespan=0.0)
        ),
        costs=costs,
        constraints=ConstraintToggles(
            capacity_kg=True,
            capacity_m3=False,
            time_windows=False,
            max_shift=False,
            priorities=False,
        ),
        distance_source=DistanceSource.PROVIDED,
        matrix=provided_matrix(distance),
    )


def best_known(sol_path: str | Path) -> float:
    return float(vrplib.read_solution(str(sol_path))["cost"])
