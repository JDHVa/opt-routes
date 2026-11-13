from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from routeopt.core.models import VehicleType

VEHICLES_PATH = Path(__file__).resolve().parent / "vehicles.json"


@lru_cache(maxsize=1)
def _cached_vehicles() -> tuple[VehicleType, ...]:
    raw = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
    return tuple(VehicleType.model_validate(item) for item in raw)


def load_vehicles() -> list[VehicleType]:
    return list(_cached_vehicles())


def get_vehicle(vehicle_id: str) -> VehicleType:
    for vehicle in _cached_vehicles():
        if vehicle.id == vehicle_id:
            return vehicle
    raise KeyError(f"unknown vehicle type: {vehicle_id}")
