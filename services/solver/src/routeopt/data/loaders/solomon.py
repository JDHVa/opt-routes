from __future__ import annotations

from pathlib import Path

import numpy as np
import vrplib

from routeopt.core.models import (
    ConstraintToggles,
    CostParams,
    DistanceSource,
    Objective,
    ObjectiveWeights,
    Problem,
    ProblemMode,
    Stop,
)
from routeopt.data.loaders.cvrplib import (
    DEPOT_ID,
    best_known,
    drivers,
    euclidean,
    map_locations,
    provided_matrix,
    vehicle_type,
)

SOLOMON_VEHICLES = 25
TRUNCATION_EPS = 1e-9

__all__ = ["best_known", "load_solomon"]


def load_solomon(path: str | Path) -> Problem:
    raw = vrplib.read_instance(str(path), instance_format="solomon", compute_edge_weights=False)
    coords = np.asarray(raw["node_coord"], dtype=np.float64)
    demand = np.asarray(raw["demand"], dtype=np.float64)
    windows = np.asarray(raw["time_window"], dtype=np.float64)
    service = np.asarray(raw["service_time"], dtype=np.float64)
    distance = np.floor(euclidean(coords) * 10.0 + TRUNCATION_EPS) / 10.0
    locations = map_locations(coords)
    costs = CostParams()
    stops = [
        Stop(
            id=str(i),
            location=locations[i],
            demand_kg=float(demand[i]),
            demand_m3=0.0,
            service_min=float(service[i]),
            tw_start_min=float(windows[i, 0]),
            tw_end_min=float(windows[i, 1]),
        )
        for i in range(1, coords.shape[0])
    ]
    fleet = drivers(SOLOMON_VEHICLES)
    horizon = float(windows[0, 1])
    fleet = [driver.model_copy(update={"max_shift_min": horizon}) for driver in fleet]
    return Problem(
        name=str(raw["name"]),
        mode=ProblemMode.DEPOT,
        depot=locations[0],
        depot_id=DEPOT_ID,
        drivers=fleet,
        vehicle_types=[vehicle_type(float(raw["capacity"]), costs.gasoline_mxn_per_l)],
        stops=stops,
        objective=Objective(
            weights=ObjectiveWeights(time=0.0, cost=0.5, vehicles=0.5, makespan=0.0)
        ),
        costs=costs,
        constraints=ConstraintToggles(
            capacity_kg=True,
            capacity_m3=False,
            time_windows=True,
            max_shift=True,
            priorities=False,
        ),
        distance_source=DistanceSource.PROVIDED,
        matrix=provided_matrix(distance),
    )
