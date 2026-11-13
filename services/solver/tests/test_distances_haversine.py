import math

import numpy as np
import pytest

from routeopt.core.models import Location
from routeopt.distances.haversine import haversine_matrix

MTY = Location(lat=25.6866, lon=-100.3161)
SPGG = Location(lat=25.6573, lon=-100.4022)


def reference_km(a: Location, b: Location) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371.0088 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def test_monterrey_to_san_pedro_matches_independent_formula() -> None:
    result = haversine_matrix([MTY, SPGG], detour_factor=1.0)
    assert result.dist_km[0, 1] == pytest.approx(reference_km(MTY, SPGG), rel=0.005)
    assert 8.5 < result.dist_km[0, 1] < 10.0


def test_detour_speed_and_diagonal() -> None:
    plain = haversine_matrix([MTY, SPGG], detour_factor=1.0, speed_kmh=60.0)
    default = haversine_matrix([MTY, SPGG])
    assert default.source == "haversine"
    assert default.dist_km[0, 1] == pytest.approx(plain.dist_km[0, 1] * 1.3)
    assert plain.dur_min[0, 1] == pytest.approx(plain.dist_km[0, 1])
    assert default.dur_min[0, 1] == pytest.approx(default.dist_km[0, 1] / 28.0 * 60.0)
    assert np.all(np.diag(default.dist_km) == 0.0)
    assert np.all(np.diag(default.dur_min) == 0.0)


def test_symmetric_and_shape() -> None:
    points = [MTY, SPGG, Location(lat=25.78, lon=-100.19)]
    result = haversine_matrix(points)
    assert result.dist_km.shape == (3, 3)
    np.testing.assert_allclose(result.dist_km, result.dist_km.T)


def test_empty() -> None:
    assert haversine_matrix([]).dist_km.shape == (0, 0)
