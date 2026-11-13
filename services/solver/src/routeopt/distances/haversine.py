import numpy as np

from routeopt.core.models import Location
from routeopt.distances.types import MatrixResult

EARTH_RADIUS_KM = 6371.0088


def haversine_matrix(
    points: list[Location], detour_factor: float = 1.3, speed_kmh: float = 28.0
) -> MatrixResult:
    coords = np.array([(p.lat, p.lon) for p in points], dtype=np.float64).reshape(-1, 2)
    lat = np.radians(coords[:, 0])
    lon = np.radians(coords[:, 1])
    dlat = lat[None, :] - lat[:, None]
    dlon = lon[None, :] - lon[:, None]
    a = np.sin(dlat / 2) ** 2 + np.cos(lat)[:, None] * np.cos(lat)[None, :] * np.sin(dlon / 2) ** 2
    dist = 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0))) * detour_factor
    np.fill_diagonal(dist, 0.0)
    return MatrixResult(dist_km=dist, dur_min=dist / speed_kmh * 60.0, source="haversine")
