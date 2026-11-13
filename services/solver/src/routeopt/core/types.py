from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

F64 = NDArray[np.float64]
I64 = NDArray[np.int64]
B = NDArray[np.bool_]
OBJECTIVES: tuple[str, ...] = ("time", "cost", "vehicles", "makespan")


@dataclass(slots=True)
class Instance:
    name: str
    n: int
    m: int
    dist: F64
    dur: F64
    demand_kg: F64
    demand_m3: F64
    service: F64
    tw_start: F64
    tw_end: F64
    priority_w: F64
    release: F64
    cap_kg: F64
    cap_m3: F64
    shift_start: F64
    max_shift: F64
    speed_factor: F64
    cost_per_km: F64
    cost_per_min: F64
    fixed_cost: F64
    open_end: B
    weights: F64
    obj_scale: F64
    tw_enabled: bool = True
    coords: F64 = field(default_factory=lambda: np.zeros((0, 2), dtype=np.float64))
    stop_ids: list[str] = field(default_factory=list)
    driver_ids: list[str] = field(default_factory=list)
    vehicle_type_ids: list[str] = field(default_factory=list)

    def start_node(self, k: int) -> int:
        return self.n + k

    def end_node(self, k: int) -> int:
        return self.n + self.m + k


@dataclass(slots=True)
class Penalties:
    capacity: float = 1000.0
    lateness: float = 10.0
    overtime: float = 10.0
    unassigned: float = 100000.0


@dataclass(slots=True)
class RouteSet:
    routes: list[list[int]]
    unassigned: list[int] = field(default_factory=list)

    def copy(self) -> RouteSet:
        return RouteSet([list(r) for r in self.routes], list(self.unassigned))


@dataclass(slots=True)
class Chromosome:
    tour: I64
    vorder: I64


@dataclass(slots=True, frozen=True)
class Evaluation:
    fitness: float
    feasible: bool
    total_duration_min: float
    total_cost_mxn: float
    vehicles_used: int
    makespan_min: float
    total_distance_km: float
    overload_kg: float
    overload_m3: float
    lateness_min: float
    overtime_min: float
    unassigned: int

    @property
    def objectives(self) -> F64:
        return np.array(
            [self.total_duration_min, self.total_cost_mxn, self.vehicles_used, self.makespan_min],
            dtype=np.float64,
        )
