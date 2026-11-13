from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

from routeopt.core.models import (
    DistanceSource,
    Driver,
    FuelType,
    Location,
    Problem,
    ProblemMode,
    ProvidedMatrix,
    Stop,
    VehicleCategory,
    VehicleType,
)

ASSUMED_SPEED_KMH = 30.0
VOLUMETRIC_CM3_PER_KG = 5000.0
MIN_PACKAGE_KG = 0.1
PAYLOAD_KG_PER_M3 = 1_000_000.0 / VOLUMETRIC_CM3_PER_KG
MAX_SHIFT_MIN = 720.0
DEPOT_ID = "depot"
AMAZON_VEHICLE_ID = "amazon-delivery-van"
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def _read_table(directory: Path, name: str) -> dict[str, Any]:
    table: dict[str, Any] = json.loads((directory / f"{name}.json").read_text(encoding="utf-8"))
    return table


def _is_missing(value: Any) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def _departure(route: dict[str, Any]) -> datetime:
    return datetime.strptime(
        f"{route['date_YYYY_MM_DD']} {route['departure_time_utc']}", "%Y-%m-%d %H:%M:%S"
    )


def _package_volume_cm3(package: dict[str, Any]) -> float:
    dims = package["dimensions"]
    return float(dims["depth_cm"]) * float(dims["height_cm"]) * float(dims["width_cm"])


def _stop_window(
    packages: dict[str, Any], departure: datetime
) -> tuple[float | None, float | None]:
    starts: list[float] = []
    ends: list[float] = []
    for package in packages.values():
        window = package["time_window"]
        if _is_missing(window["start_time_utc"]) or _is_missing(window["end_time_utc"]):
            continue
        starts.append(
            (datetime.strptime(window["start_time_utc"], TIME_FORMAT) - departure).total_seconds()
            / 60
        )
        ends.append(
            (datetime.strptime(window["end_time_utc"], TIME_FORMAT) - departure).total_seconds()
            / 60
        )
    if not starts:
        return None, None
    start = max(0.0, max(starts))
    end = max(start, min(ends))
    return start, end


def _build_stop(
    stop_id: str, info: dict[str, Any], packages: dict[str, Any], departure: datetime
) -> Stop:
    volume_cm3 = sum(_package_volume_cm3(p) for p in packages.values())
    service_s = sum(float(p["planned_service_time_seconds"]) for p in packages.values())
    tw_start, tw_end = _stop_window(packages, departure)
    return Stop(
        id=stop_id,
        location=Location(
            lat=float(info["lat"]),
            lon=float(info["lng"]),
            address=None if _is_missing(info.get("zone_id")) else str(info["zone_id"]),
        ),
        demand_kg=max(MIN_PACKAGE_KG * len(packages), volume_cm3 / VOLUMETRIC_CM3_PER_KG),
        demand_m3=volume_cm3 / 1e6,
        service_min=service_s / 60.0,
        tw_start_min=tw_start,
        tw_end_min=tw_end,
    )


def _build_matrix(
    travel_times: dict[str, dict[str, float]], station_id: str, stop_ids: list[str]
) -> ProvidedMatrix:
    order = [*stop_ids, station_id]
    duration = [[float(travel_times[a][b]) / 60.0 for b in order] for a in order]
    distance = [[minutes / 60.0 * ASSUMED_SPEED_KMH for minutes in row] for row in duration]
    return ProvidedMatrix(
        node_ids=[*stop_ids, DEPOT_ID], distance_km=distance, duration_min=duration
    )


def load_amazon_route(directory: Path | str, route_id: str) -> Problem:
    base = Path(directory)
    route = _read_table(base, "route_data")[route_id]
    packages = _read_table(base, "package_data")[route_id]
    travel_times = _read_table(base, "travel_times")[route_id]
    departure = _departure(route)
    station_id, station = next(
        (sid, info) for sid, info in route["stops"].items() if info["type"] == "Station"
    )
    stops = [
        _build_stop(sid, info, packages[sid], departure)
        for sid, info in route["stops"].items()
        if info["type"] != "Station" and packages.get(sid)
    ]
    capacity_m3 = float(route["executor_capacity_cm3"]) / 1e6
    vehicle = VehicleType(
        id=AMAZON_VEHICLE_ID,
        name="Camioneta de reparto Amazon",
        brand="Amazon DSP",
        category=VehicleCategory.COMPACT_VAN,
        payload_kg=capacity_m3 * PAYLOAD_KG_PER_M3,
        volume_m3=capacity_m3,
        fuel_type=FuelType.GASOLINE,
        km_per_l=10.0,
        approx=True,
        source="Amazon Last Mile Routing Research Challenge (executor_capacity_cm3)",
    )
    return Problem(
        name=route_id,
        mode=ProblemMode.DEPOT,
        depot=Location(
            lat=float(station["lat"]), lon=float(station["lng"]), address=route["station_code"]
        ),
        depot_id=DEPOT_ID,
        drivers=[Driver(id="driver-1", vehicle_type_id=vehicle.id, max_shift_min=MAX_SHIFT_MIN)],
        vehicle_types=[vehicle],
        stops=stops,
        distance_source=DistanceSource.PROVIDED,
        matrix=_build_matrix(travel_times, station_id, [s.id for s in stops]),
    )


def amazon_actual_sequence(directory: Path | str, route_id: str) -> list[str]:
    actual = _read_table(Path(directory), "actual_sequences")[route_id]["actual"]
    route = _read_table(Path(directory), "route_data")[route_id]
    ordered = sorted(actual.items(), key=lambda item: item[1])
    return [sid for sid, _ in ordered if route["stops"][sid]["type"] != "Station"]


def list_amazon_routes(directory: Path | str) -> list[str]:
    return sorted(_read_table(Path(directory), "route_data"))
