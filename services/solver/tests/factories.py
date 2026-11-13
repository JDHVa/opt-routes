from __future__ import annotations

import math
from pathlib import Path
from typing import Literal

import numpy as np
import vrplib

from routeopt.core.instance import build_instance, instance_locations
from routeopt.core.models import (
    ConstraintToggles,
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
from routeopt.core.types import Instance, RouteSet
from routeopt.data.loaders.cvrplib import best_known, load_cvrplib
from routeopt.data.loaders.solomon import load_solomon

BENCHMARK_DIR = Path(__file__).resolve().parents[1] / "data" / "benchmarks"
LAT0 = 25.6866
LON0 = -100.3161
KM_PER_DEG = 111.0
SPEED_KM_PER_MIN = 0.5
SOLOMON_NAMES = ("C101", "R101", "RC101")


def _location(x: float, y: float) -> Location:
    lat = LAT0 + y / KM_PER_DEG
    lon = LON0 + x / (KM_PER_DEG * math.cos(math.radians(LAT0)))
    return Location(lat=lat, lon=lon)


def _xy(location: Location) -> tuple[float, float]:
    y = (location.lat - LAT0) * KM_PER_DEG
    x = (location.lon - LON0) * KM_PER_DEG * math.cos(math.radians(LAT0))
    return x, y


def _vehicle_types(tight_capacity: bool) -> list[VehicleType]:
    scale = 0.35 if tight_capacity else 1.0
    return [
        VehicleType(
            id="van",
            name="Van",
            brand="Test",
            category=VehicleCategory.COMPACT_VAN,
            payload_kg=200.0 * scale,
            volume_m3=4.0 * scale,
            fuel_type=FuelType.GASOLINE,
            km_per_l=10.0,
            fixed_cost_mxn=50.0,
        ),
        VehicleType(
            id="truck",
            name="Truck",
            brand="Test",
            category=VehicleCategory.TRUCK,
            payload_kg=400.0 * scale,
            volume_m3=8.0 * scale,
            fuel_type=FuelType.DIESEL,
            km_per_l=6.0,
            speed_factor=1.2,
            fixed_cost_mxn=120.0,
        ),
        VehicleType(
            id="ev",
            name="Electric",
            brand="Test",
            category=VehicleCategory.CARGO_TRICYCLE,
            payload_kg=150.0 * scale,
            volume_m3=2.0 * scale,
            fuel_type=FuelType.ELECTRIC,
            kwh_per_100km=18.0,
            speed_factor=0.9,
        ),
    ]


def make_problem(
    n: int = 20,
    m: int = 3,
    seed: int = 0,
    mode: Literal["depot", "multi_origin"] = "depot",
    time_windows: bool = False,
    open_end: bool = False,
    tight_capacity: bool = False,
    weights: ObjectiveWeights | None = None,
    constraints: ConstraintToggles | None = None,
) -> Problem:
    rng = np.random.default_rng(seed)
    types = _vehicle_types(tight_capacity)
    stops: list[Stop] = []
    for i in range(n):
        x, y = rng.uniform(0.0, 30.0, size=2)
        window: dict[str, float] = {}
        if time_windows:
            start = float(rng.uniform(0.0, 240.0))
            window = {"tw_start_min": start, "tw_end_min": start + float(rng.uniform(30.0, 150.0))}
        stops.append(
            Stop(
                id=f"s{i}",
                location=_location(float(x), float(y)),
                demand_kg=float(rng.uniform(1.0, 20.0)),
                demand_m3=float(rng.uniform(0.01, 0.2)),
                service_min=float(rng.uniform(2.0, 8.0)),
                priority=Priority(rng.choice(["low", "normal", "high"])),
                **window,
            )
        )
    depot_mode = mode == "depot"
    drivers = []
    for k in range(m):
        start = None if depot_mode else _location(*rng.uniform(0.0, 30.0, size=2))
        end = None
        if not depot_mode and not open_end:
            end = _location(*rng.uniform(0.0, 30.0, size=2))
        drivers.append(
            Driver(
                id=f"d{k}",
                vehicle_type_id=types[k % len(types)].id,
                start=start,
                end=end,
                shift_start_min=float(rng.choice([0.0, 30.0])),
                max_shift_min=480.0,
                hourly_wage_mxn=80.0,
            )
        )
    return Problem(
        name=f"random-{mode}-{n}-{m}-{seed}",
        mode=ProblemMode(mode),
        depot=_location(15.0, 15.0) if depot_mode else None,
        drivers=drivers,
        vehicle_types=types,
        stops=stops,
        objective=Objective(weights=weights or ObjectiveWeights(time=1.0, cost=1.0, vehicles=0.5)),
        constraints=constraints or ConstraintToggles(),
        distance_source=DistanceSource.HAVERSINE,
    )


def euclidean_matrices(problem: Problem) -> tuple[np.ndarray, np.ndarray]:
    points = np.array([_xy(location) for location in instance_locations(problem)])
    diff = points[:, None, :] - points[None, :, :]
    dist = np.sqrt((diff**2).sum(axis=-1))
    return dist, dist / SPEED_KM_PER_MIN


def make_instance(
    n: int = 20,
    m: int = 3,
    seed: int = 0,
    mode: Literal["depot", "multi_origin"] = "depot",
    time_windows: bool = False,
    open_end: bool = False,
    tight_capacity: bool = False,
    weights: ObjectiveWeights | None = None,
    constraints: ConstraintToggles | None = None,
) -> Instance:
    problem = make_problem(
        n, m, seed, mode, time_windows, open_end, tight_capacity, weights, constraints
    )
    dist, dur = euclidean_matrices(problem)
    return build_instance(problem, dist, dur)


def benchmark_instance(name: str) -> tuple[Instance, float]:
    if name in SOLOMON_NAMES:
        problem = load_solomon(BENCHMARK_DIR / f"{name}.txt")
    else:
        problem = load_cvrplib(BENCHMARK_DIR / f"{name}.vrp")
    return build_instance(problem), best_known(BENCHMARK_DIR / f"{name}.sol")


def benchmark_reference_routes(name: str, inst: Instance) -> RouteSet:
    solution = vrplib.read_solution(str(BENCHMARK_DIR / f"{name}.sol"))
    routes: list[list[int]] = [[] for _ in range(inst.m)]
    for k, route in enumerate(solution["routes"]):
        routes[k] = [int(node) - 1 for node in route]
    return RouteSet(routes, [])
