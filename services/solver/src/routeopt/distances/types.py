from dataclasses import dataclass
from typing import Literal

import numpy as np


@dataclass(frozen=True, slots=True)
class MatrixResult:
    dist_km: np.ndarray
    dur_min: np.ndarray
    source: Literal["osrm", "haversine"]


@dataclass(frozen=True, slots=True)
class GeometryResult:
    geometry: list[tuple[float, float]]
    source: Literal["osrm", "straight"]
