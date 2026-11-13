from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from routeopt.core.models import Location, Problem, Solution, SolutionMetrics, Stop, VehicleType


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AlgorithmRun(_Model):
    algorithm: str
    params: dict[str, Any] = {}


class SolveRequest(_Model):
    problem: Problem
    run: AlgorithmRun
    include_geometry: bool = True


class CompareRequest(_Model):
    problem: Problem
    runs: Annotated[list[AlgorithmRun], Field(min_length=1, max_length=6)]
    include_geometry: bool = False


class HistoryPoint(_Model):
    iteration: int
    elapsed_s: float
    best_fitness: float


class ParetoPoint(_Model):
    objectives: dict[str, float]
    solution: Solution


class SolveResponse(_Model):
    solution: Solution
    history: list[HistoryPoint]
    pareto: list[ParetoPoint] | None = None


class CompareEntry(_Model):
    run: AlgorithmRun
    solution: Solution
    history: list[HistoryPoint]
    gap_pct: float | None = None


class CompareResponse(_Model):
    entries: list[CompareEntry]
    best_known: float | None = None


class SolverStage(StrEnum):
    SEEDING = "seeding"
    EVOLVING = "evolving"
    CONSTRUCTING = "constructing"
    COOPERATING = "cooperating"
    FINISHED = "finished"


class ProgressPayload(_Model):
    stage: SolverStage | None = None
    iteration: int
    elapsed_s: float
    best_fitness: float
    metrics: SolutionMetrics
    solution: Solution | None = None
    pareto: list[ParetoPoint] | None = None
    extra: dict[str, float] = {}


class SseEvent(StrEnum):
    PROGRESS = "progress"
    RESULT = "result"
    ERROR = "error"
    COMPLETE = "complete"


class ErrorPayload(_Model):
    code: str
    message: str


class AlgorithmInfo(_Model):
    name: str
    label: str
    multi_objective: bool
    params_schema: dict[str, Any]


class ScenarioInfo(_Model):
    id: str
    name: str
    description: str
    n_stops: int
    n_drivers: int
    mode: str
    region: str


class MatrixRequest(_Model):
    points: Annotated[list[Location], Field(min_length=2, max_length=400)]


class MatrixResponse(_Model):
    distance_km: list[list[float]]
    duration_min: list[list[float]]
    source: Literal["osrm", "haversine"]


class GeometryRequest(_Model):
    points: Annotated[list[Location], Field(min_length=2, max_length=400)]


class GeometryResponse(_Model):
    geometry: list[tuple[float, float]]
    source: Literal["osrm", "straight"]


class TriggerMode(StrEnum):
    EVENT = "event"
    BATCH = "batch"


class SimulationConfig(_Model):
    problem: Problem
    run: AlgorithmRun
    speed: Annotated[float, Field(gt=0, le=600)] = 60.0
    trigger: TriggerMode = TriggerMode.EVENT
    batch_minutes: Annotated[float, Field(gt=0)] = 15.0
    reopt_time_limit_s: Annotated[float, Field(gt=0, le=60)] = 5.0


class DriverPosition(_Model):
    driver_id: str
    location: Location
    next_stop_id: str | None
    completed: int
    remaining: int


class SimClientStart(_Model):
    type: Literal["start"] = "start"
    config: SimulationConfig


class SimClientAddOrder(_Model):
    type: Literal["add_order"] = "add_order"
    stop: Stop


class SimClientControl(_Model):
    type: Literal["pause", "resume", "stop"]


class SimClientSpeed(_Model):
    type: Literal["speed"] = "speed"
    speed: Annotated[float, Field(gt=0, le=600)]


SimClientMessage = Annotated[
    SimClientStart | SimClientAddOrder | SimClientControl | SimClientSpeed,
    Field(discriminator="type"),
]


class SimServerTick(_Model):
    type: Literal["tick"] = "tick"
    clock_min: float
    positions: list[DriverPosition]
    delivered_stop_ids: list[str]


class SimServerOrder(_Model):
    type: Literal["order"] = "order"
    clock_min: float
    stop: Stop


class SimServerReoptimized(_Model):
    type: Literal["reoptimized"] = "reoptimized"
    clock_min: float
    solution: Solution
    runtime_s: float
    reason: Literal["initial", "event", "batch"]


class SimServerDone(_Model):
    type: Literal["done"] = "done"
    clock_min: float
    metrics: SolutionMetrics


class SimServerError(_Model):
    type: Literal["error"] = "error"
    error: ErrorPayload


SimServerMessage = Annotated[
    SimServerTick | SimServerOrder | SimServerReoptimized | SimServerDone | SimServerError,
    Field(discriminator="type"),
]


class VehicleCatalog(_Model):
    vehicles: list[VehicleType]


class GenerateRequest(_Model):
    n_stops: Annotated[int, Field(ge=2, le=250)] = 60
    n_drivers: Annotated[int, Field(ge=1, le=30)] = 6
    mode: Literal["depot", "multi_origin"] = "depot"
    time_windows_pct: Annotated[float, Field(ge=0, le=1)] = 0.3
    high_priority_pct: Annotated[float, Field(ge=0, le=1)] = 0.1
    dynamic_pct: Annotated[float, Field(ge=0, le=1)] = 0.0
    seed: int = 1
