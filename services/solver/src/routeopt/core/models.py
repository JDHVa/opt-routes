from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Location(_Model):
    lat: Annotated[float, Field(ge=-90, le=90)]
    lon: Annotated[float, Field(ge=-180, le=180)]
    address: str | None = None


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


PRIORITY_LATENESS_FACTOR: dict[Priority, float] = {
    Priority.LOW: 0.5,
    Priority.NORMAL: 1.0,
    Priority.HIGH: 3.0,
}


class Stop(_Model):
    id: str
    location: Location
    demand_kg: Annotated[float, Field(ge=0)] = 1.0
    demand_m3: Annotated[float, Field(ge=0)] = 0.01
    service_min: Annotated[float, Field(ge=0)] = 3.0
    tw_start_min: Annotated[float, Field(ge=0)] | None = None
    tw_end_min: Annotated[float, Field(ge=0)] | None = None
    priority: Priority = Priority.NORMAL
    release_min: Annotated[float, Field(ge=0)] = 0.0

    @model_validator(mode="after")
    def _tw_ok(self) -> Stop:
        if (
            self.tw_start_min is not None
            and self.tw_end_min is not None
            and (self.tw_end_min < self.tw_start_min)
        ):
            raise ValueError(f"stop {self.id}: tw_end_min < tw_start_min")
        return self


class VehicleCategory(StrEnum):
    MOTORCYCLE = "motorcycle"
    CARGO_TRICYCLE = "cargo_tricycle"
    COMPACT_VAN = "compact_van"
    LARGE_VAN = "large_van"
    TRUCK = "truck"


class FuelType(StrEnum):
    GASOLINE = "gasoline"
    DIESEL = "diesel"
    ELECTRIC = "electric"


class VehicleType(_Model):
    id: str
    name: str
    brand: str
    category: VehicleCategory
    payload_kg: Annotated[float, Field(gt=0)]
    volume_m3: Annotated[float, Field(gt=0)]
    fuel_type: FuelType
    km_per_l: Annotated[float, Field(gt=0)] | None = None
    kwh_per_100km: Annotated[float, Field(gt=0)] | None = None
    range_km: Annotated[float, Field(gt=0)] | None = None
    speed_factor: Annotated[float, Field(gt=0)] = 1.0
    fixed_cost_mxn: Annotated[float, Field(ge=0)] = 0.0
    approx: bool = False
    source: str | None = None

    @model_validator(mode="after")
    def _energy_ok(self) -> VehicleType:
        if self.fuel_type == FuelType.ELECTRIC and self.kwh_per_100km is None:
            raise ValueError(f"{self.id}: electric vehicle needs kwh_per_100km")
        if self.fuel_type != FuelType.ELECTRIC and self.km_per_l is None:
            raise ValueError(f"{self.id}: combustion vehicle needs km_per_l")
        return self


class Driver(_Model):
    id: str
    name: str | None = None
    vehicle_type_id: str
    start: Location | None = None
    end: Location | None = None
    shift_start_min: Annotated[float, Field(ge=0)] = 0.0
    max_shift_min: Annotated[float, Field(gt=0)] = 480.0
    hourly_wage_mxn: Annotated[float, Field(ge=0)] = 80.0


class ProblemMode(StrEnum):
    DEPOT = "depot"
    MULTI_ORIGIN = "multi_origin"


class ObjectiveKind(StrEnum):
    WEIGHTED = "weighted"
    PARETO = "pareto"


class ObjectiveWeights(_Model):
    time: Annotated[float, Field(ge=0)] = 1.0
    cost: Annotated[float, Field(ge=0)] = 1.0
    vehicles: Annotated[float, Field(ge=0)] = 0.5
    makespan: Annotated[float, Field(ge=0)] = 0.0


class Objective(_Model):
    kind: ObjectiveKind = ObjectiveKind.WEIGHTED
    weights: ObjectiveWeights = ObjectiveWeights()


class CostParams(_Model):
    gasoline_mxn_per_l: float = 24.5
    diesel_mxn_per_l: float = 26.0
    electricity_mxn_per_kwh: float = 3.0


class ConstraintToggles(_Model):
    capacity_kg: bool = True
    capacity_m3: bool = True
    time_windows: bool = True
    max_shift: bool = True
    priorities: bool = True


class DistanceSource(StrEnum):
    OSRM = "osrm"
    HAVERSINE = "haversine"
    PROVIDED = "provided"


class ProvidedMatrix(_Model):
    node_ids: list[str]
    distance_km: list[list[float]]
    duration_min: list[list[float]]


class Problem(_Model):
    name: str = "untitled"
    mode: ProblemMode
    depot: Location | None = None
    depot_id: str = "depot"
    drivers: Annotated[list[Driver], Field(min_length=1)]
    vehicle_types: list[VehicleType]
    stops: Annotated[list[Stop], Field(min_length=1)]
    objective: Objective = Objective()
    costs: CostParams = CostParams()
    constraints: ConstraintToggles = ConstraintToggles()
    distance_source: DistanceSource = DistanceSource.OSRM
    matrix: ProvidedMatrix | None = None

    @model_validator(mode="after")
    def _consistency(self) -> Problem:
        if self.mode == ProblemMode.DEPOT and self.depot is None:
            raise ValueError("DEPOT mode requires `depot`")
        if self.mode == ProblemMode.MULTI_ORIGIN:
            missing = [d.id for d in self.drivers if d.start is None]
            if missing:
                raise ValueError(f"MULTI_ORIGIN mode: drivers without start: {missing}")
        vt_ids = {v.id for v in self.vehicle_types}
        bad = [d.id for d in self.drivers if d.vehicle_type_id not in vt_ids]
        if bad:
            raise ValueError(f"drivers with unknown vehicle_type_id: {bad}")
        ids = [s.id for s in self.stops]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate stop ids")
        if self.distance_source == DistanceSource.PROVIDED and self.matrix is None:
            raise ValueError("distance_source=provided requires `matrix`")
        return self


class RouteMetrics(_Model):
    distance_km: float
    duration_min: float
    start_min: float
    end_min: float
    load_kg: float
    load_m3: float
    cost_mxn: float
    lateness_min: float
    overtime_min: float


class Visit(_Model):
    stop_id: str
    arrival_min: float
    start_service_min: float
    departure_min: float
    late_min: float = 0.0


class Route(_Model):
    driver_id: str
    vehicle_type_id: str
    visits: list[Visit]
    metrics: RouteMetrics
    geometry: list[tuple[float, float]] | None = None


class SolutionMetrics(_Model):
    total_distance_km: float
    total_duration_min: float
    makespan_min: float
    vehicles_used: int
    total_cost_mxn: float
    lateness_min: float
    overload_kg: float
    overload_m3: float
    overtime_min: float
    unassigned: int
    feasible: bool
    fitness: float


class Solution(_Model):
    algorithm: str
    routes: list[Route]
    unassigned_stop_ids: list[str] = []
    metrics: SolutionMetrics
    runtime_s: float
