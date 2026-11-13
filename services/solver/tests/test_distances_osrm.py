import math
from collections.abc import Callable

import httpx
import numpy as np
import pytest

from routeopt.core.models import Location
from routeopt.distances.cache import LruCache, cache_key
from routeopt.distances.haversine import haversine_matrix
from routeopt.distances.osrm import OsrmClient, OsrmUnavailable
from routeopt.distances.service import DistanceService

MTY = Location(lat=25.6866, lon=-100.3161)
SPGG = Location(lat=25.6573, lon=-100.4022)


def haversine_km(a: Location, b: Location) -> float:
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dlat = p2 - p1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def grid(n: int) -> list[Location]:
    return [Location(lat=25.5 + 0.01 * (i % 17), lon=-100.4 + 0.01 * (i // 17)) for i in range(n)]


def parse_points(request: httpx.Request) -> list[Location]:
    raw = request.url.path.rsplit("/", 1)[-1]
    points = []
    for pair in raw.split(";"):
        lon, lat = pair.split(",")
        points.append(Location(lat=float(lat), lon=float(lon)))
    return points


def fake_table(
    null_cells: set[tuple[int, int]] | None = None,
) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        points = parse_points(request)
        params = request.url.params
        src = [int(s) for s in params["sources"].split(";")] if "sources" in params else None
        dst = (
            [int(s) for s in params["destinations"].split(";")]
            if "destinations" in params
            else None
        )
        src = src if src is not None else list(range(len(points)))
        dst = dst if dst is not None else list(range(len(points)))
        distances: list[list[float | None]] = []
        durations: list[list[float | None]] = []
        for i in src:
            drow: list[float | None] = []
            trow: list[float | None] = []
            for j in dst:
                if (i, j) in (null_cells or set()):
                    drow.append(None)
                    trow.append(None)
                else:
                    meters = haversine_km(points[i], points[j]) * 1000.0
                    drow.append(meters)
                    trow.append(meters / 10.0)
            distances.append(drow)
            durations.append(trow)
        return httpx.Response(
            200, json={"code": "Ok", "distances": distances, "durations": durations}
        )

    return handler


def client_with(
    handler: Callable[[httpx.Request], httpx.Response], max_table: int = 500
) -> OsrmClient:
    return OsrmClient(
        base_url="http://osrm.test",
        max_table_size=max_table,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_table_converts_units() -> None:
    client = client_with(fake_table())
    result = await client.table([MTY, SPGG])
    expected_km = haversine_km(MTY, SPGG)
    assert result.source == "osrm"
    assert result.dist_km[0, 1] == pytest.approx(expected_km)
    assert result.dur_min[0, 1] == pytest.approx(expected_km * 1000.0 / 10.0 / 60.0)
    assert result.dist_km[0, 0] == 0.0
    await client.aclose()


@pytest.mark.asyncio
async def test_table_blocks_match_single_call() -> None:
    points = grid(23)
    whole = await client_with(fake_table(), max_table=500).table(points)
    calls: list[httpx.Request] = []
    inner = fake_table()

    def counting(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return inner(request)

    blocked = await client_with(counting, max_table=10).table(points)
    assert len(calls) > 1
    assert all("sources" in c.url.params for c in calls)
    np.testing.assert_allclose(blocked.dist_km, whole.dist_km)
    np.testing.assert_allclose(blocked.dur_min, whole.dur_min)


@pytest.mark.asyncio
async def test_table_null_uses_haversine_cell() -> None:
    points = [MTY, SPGG, Location(lat=25.7, lon=-100.3)]
    result = await client_with(fake_table({(0, 2)})).table(points)
    fallback = haversine_matrix(points)
    assert result.dist_km[0, 2] == pytest.approx(fallback.dist_km[0, 2])
    assert result.dur_min[0, 2] == pytest.approx(fallback.dur_min[0, 2])
    assert result.dist_km[0, 1] == pytest.approx(haversine_km(points[0], points[1]))


@pytest.mark.asyncio
async def test_retries_then_succeeds() -> None:
    attempts = {"n": 0}
    inner = fake_table()

    def flaky(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(503)
        return inner(request)

    result = await client_with(flaky).table([MTY, SPGG])
    assert attempts["n"] == 3
    assert result.source == "osrm"


@pytest.mark.asyncio
async def test_raises_unavailable_after_retries() -> None:
    attempts = {"n": 0}

    def down(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(500)

    with pytest.raises(OsrmUnavailable):
        await client_with(down).table([MTY, SPGG])
    assert attempts["n"] == 3


def fake_route(request: httpx.Request) -> httpx.Response:
    points = parse_points(request)
    coordinates = [[p.lon, p.lat] for p in points]
    return httpx.Response(
        200,
        json={
            "code": "Ok",
            "routes": [{"geometry": {"type": "LineString", "coordinates": coordinates}}],
        },
    )


@pytest.mark.asyncio
async def test_route_batches_and_concatenates() -> None:
    points = grid(250)
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(len(parse_points(request)))
        return fake_route(request)

    result = await client_with(handler).route(points)
    assert max(calls) <= 100
    assert len(calls) == 3
    assert result.source == "osrm"
    assert len(result.geometry) == len(points)
    for got, want in zip(result.geometry, points, strict=True):
        assert got == pytest.approx((want.lat, want.lon))


@pytest.mark.asyncio
async def test_service_falls_back_to_haversine_and_straight() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    service = DistanceService(base_url="http://osrm.test", transport=httpx.MockTransport(down))
    matrix = await service.matrix([MTY, SPGG])
    geometry = await service.geometry([MTY, SPGG])
    assert matrix.source == "haversine"
    assert geometry.source == "straight"
    assert geometry.geometry == [(MTY.lat, MTY.lon), (SPGG.lat, SPGG.lon)]
    await service.aclose()


@pytest.mark.asyncio
async def test_service_caches_matrix() -> None:
    calls = {"n": 0}
    inner = fake_table()

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return inner(request)

    service = DistanceService(base_url="http://osrm.test", transport=httpx.MockTransport(handler))
    first = await service.matrix([MTY, SPGG])
    second = await service.matrix([MTY, SPGG])
    assert first is second
    assert calls["n"] == 1
    assert (await service.matrix([MTY, SPGG], prefer="haversine")).source == "haversine"


def test_cache_key_rounds_to_five_decimals() -> None:
    a = [Location(lat=25.686601, lon=-100.316101)]
    b = [Location(lat=25.686602, lon=-100.316102)]
    c = [Location(lat=25.69, lon=-100.316101)]
    assert cache_key("matrix", a) == cache_key("matrix", b)
    assert cache_key("matrix", a) != cache_key("matrix", c)
    assert cache_key("matrix", a) != cache_key("route", a)


def test_lru_evicts_oldest() -> None:
    cache: LruCache[int] = LruCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1
    cache.put("c", 3)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert len(cache) == 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_local_osrm_integration() -> None:
    client = OsrmClient(base_url="http://localhost:5000", timeout_s=5.0)
    try:
        result = await client.table([MTY, SPGG])
    except OsrmUnavailable:
        pytest.skip("OSRM local no disponible")
    finally:
        await client.aclose()
    assert result.dist_km[0, 1] > haversine_km(MTY, SPGG) * 0.9
