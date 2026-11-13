from __future__ import annotations

import csv
import gzip
import io
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from routeopt.core.models import (
    DistanceSource,
    Driver,
    Location,
    Priority,
    Problem,
    ProblemMode,
    Stop,
    VehicleType,
)
from routeopt.data.catalog import get_vehicle

NL_DIR = Path(__file__).resolve().parents[1] / "nl"
DEFAULT_DEPOT = Location(
    lat=25.7752,
    lon=-100.1650,
    address="Centro de distribución, zona industrial, carretera Miguel Alemán, Apodaca, N.L.",
)
DEFAULT_VEHICLE_MIX: dict[str, float] = {
    "nissan-nv200": 0.4,
    "ford-transit-connect": 0.3,
    "ford-transit": 0.3,
}
WORKDAY_MIN = 600.0
MAX_SHIFT_MIN = 600.0
WINDOW_MIN_LENGTH = 120
WINDOW_MAX_LENGTH = 180
WINDOW_GRID_MIN = 15
LOW_PRIORITY_PCT = 0.1
DYNAMIC_RELEASE_RANGE = (20, 300)
KG_MEDIAN = 2.0
KG_SIGMA = 0.8
KG_RANGE = (0.2, 25.0)
M3_PER_KG = 0.004
EARTH_KM_PER_DEG = 111.32
HOME_JITTER_DEG = 0.004


@dataclass(frozen=True)
class DenuePoint:
    municipality: str
    lat: float
    lon: float
    name: str
    address: str
    scian: str


@lru_cache(maxsize=4)
def load_points(region: str = "mty") -> tuple[DenuePoint, ...]:
    if region != "mty":
        raise ValueError(f"unknown region: {region}")
    with gzip.open(NL_DIR / "denue_points.csv.gz", "rt", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(io.StringIO(handle.read()))
        return tuple(
            DenuePoint(
                municipality=row["municipio"],
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                name=row["nombre"],
                address=row["direccion"],
                scian=row["scian"],
            )
            for row in reader
        )


def distance_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    dlat = (lat_a - lat_b) * EARTH_KM_PER_DEG
    dlon = (lon_a - lon_b) * EARTH_KM_PER_DEG * math.cos(math.radians((lat_a + lat_b) / 2))
    return math.hypot(dlat, dlon)


def apportion(total: int, mix: dict[str, float]) -> list[str]:
    weight_sum = sum(mix.values())
    exact = {key: total * value / weight_sum for key, value in mix.items()}
    counts = {key: math.floor(value) for key, value in exact.items()}
    remaining = total - sum(counts.values())
    by_remainder = sorted(exact, key=lambda key: (counts[key] - exact[key], key))
    for key in by_remainder[:remaining]:
        counts[key] += 1
    return [key for key, count in counts.items() for _ in range(count)]


def sample_demands(rng: np.random.Generator, n: int) -> tuple[np.ndarray, np.ndarray]:
    kg = rng.lognormal(mean=math.log(KG_MEDIAN), sigma=KG_SIGMA, size=n)
    kg = np.clip(kg, KG_RANGE[0], KG_RANGE[1])
    m3 = kg * M3_PER_KG * rng.uniform(0.7, 1.4, size=n)
    return np.round(kg, 2), np.round(np.maximum(m3, 0.0005), 4)


def pick_indices(rng: np.random.Generator, pool: np.ndarray, pct: float, n: int) -> np.ndarray:
    count = min(len(pool), round(pct * n))
    return rng.choice(pool, size=count, replace=False) if count else np.empty(0, dtype=int)


def select_points(
    rng: np.random.Generator,
    points: tuple[DenuePoint, ...],
    n: int,
    municipalities: tuple[str, ...] | None,
    focus: Location | None,
    radius_km: float | None,
) -> list[DenuePoint]:
    candidates = [
        p
        for p in points
        if (municipalities is None or p.municipality in municipalities)
        and (
            focus is None
            or radius_km is None
            or distance_km(p.lat, p.lon, focus.lat, focus.lon) <= radius_km
        )
    ]
    if len(candidates) < n:
        raise ValueError(f"not enough points: {len(candidates)} < {n}")
    chosen = rng.choice(len(candidates), size=n, replace=False)
    return [candidates[int(i)] for i in chosen]


def build_stops(
    rng: np.random.Generator,
    points: list[DenuePoint],
    time_windows_pct: float,
    high_priority_pct: float,
    dynamic_pct: float,
) -> list[Stop]:
    n = len(points)
    kg, m3 = sample_demands(rng, n)
    service = rng.integers(2, 7, size=n)
    everyone = np.arange(n)
    windowed = set(pick_indices(rng, everyone, time_windows_pct, n).tolist())
    high = pick_indices(rng, everyone, high_priority_pct, n)
    rest = np.setdiff1d(everyone, high)
    low = pick_indices(rng, rest, LOW_PRIORITY_PCT, n)
    dynamic = set(pick_indices(rng, everyone, dynamic_pct, n).tolist())
    priorities = {int(i): Priority.HIGH for i in high} | {int(i): Priority.LOW for i in low}
    stops: list[Stop] = []
    for i, point in enumerate(points):
        release = float(rng.integers(*DYNAMIC_RELEASE_RANGE)) if i in dynamic else 0.0
        tw_start: float | None = None
        tw_end: float | None = None
        if i in windowed:
            length = int(rng.integers(WINDOW_MIN_LENGTH // 30, WINDOW_MAX_LENGTH // 30 + 1)) * 30
            slots = int((WORKDAY_MIN - length) // WINDOW_GRID_MIN)
            tw_start = max(float(rng.integers(0, slots + 1) * WINDOW_GRID_MIN), release)
            tw_end = tw_start + length
        stops.append(
            Stop(
                id=f"s{i + 1:03d}",
                location=Location(lat=point.lat, lon=point.lon, address=point.address),
                demand_kg=float(kg[i]),
                demand_m3=float(m3[i]),
                service_min=float(service[i]),
                tw_start_min=tw_start,
                tw_end_min=tw_end,
                priority=priorities.get(i, Priority.NORMAL),
                release_min=release,
            )
        )
    return stops


def build_drivers(
    rng: np.random.Generator,
    vehicle_ids: list[str],
    mode: ProblemMode,
    homes: list[DenuePoint],
    open_routes: bool,
) -> list[Driver]:
    order = rng.permutation(len(vehicle_ids))
    drivers: list[Driver] = []
    for k in range(len(vehicle_ids)):
        start: Location | None = None
        if mode == ProblemMode.MULTI_ORIGIN:
            home = homes[k]
            jitter = rng.uniform(-HOME_JITTER_DEG, HOME_JITTER_DEG, size=2)
            start = Location(
                lat=home.lat + float(jitter[0]),
                lon=home.lon + float(jitter[1]),
                address=home.address,
            )
        end = None if open_routes else start
        drivers.append(
            Driver(
                id=f"d{k + 1:02d}",
                name=f"Repartidor {k + 1}",
                vehicle_type_id=vehicle_ids[int(order[k])],
                start=start,
                end=end,
                max_shift_min=MAX_SHIFT_MIN,
            )
        )
    return drivers


def generate_problem(
    n_stops: int,
    n_drivers: int,
    mode: ProblemMode | str,
    seed: int,
    vehicle_mix: dict[str, float] | None = None,
    time_windows_pct: float = 0.3,
    high_priority_pct: float = 0.1,
    dynamic_pct: float = 0.0,
    depot: Location = DEFAULT_DEPOT,
    region: str = "mty",
    municipalities: tuple[str, ...] | None = None,
    focus: Location | None = None,
    radius_km: float | None = None,
    open_routes: bool = True,
    name: str | None = None,
) -> Problem:
    problem_mode = ProblemMode(mode)
    rng = np.random.default_rng(seed)
    points = load_points(region)
    homes_needed = n_drivers if problem_mode == ProblemMode.MULTI_ORIGIN else 0
    picked = select_points(rng, points, n_stops + homes_needed, municipalities, focus, radius_km)
    stop_points, home_points = picked[:n_stops], picked[n_stops:]
    stops = build_stops(rng, stop_points, time_windows_pct, high_priority_pct, dynamic_pct)
    vehicle_ids = apportion(n_drivers, vehicle_mix or DEFAULT_VEHICLE_MIX)
    drivers = build_drivers(rng, vehicle_ids, problem_mode, home_points, open_routes)
    used: dict[str, VehicleType] = {}
    for driver in drivers:
        used.setdefault(driver.vehicle_type_id, get_vehicle(driver.vehicle_type_id))
    return Problem(
        name=name or f"{region}-{problem_mode.value}-{n_stops}",
        mode=problem_mode,
        depot=depot,
        drivers=drivers,
        vehicle_types=list(used.values()),
        stops=stops,
        distance_source=DistanceSource.OSRM,
    )
