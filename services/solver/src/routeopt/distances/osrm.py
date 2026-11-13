import asyncio
from typing import Any

import httpx
import numpy as np

from routeopt.core.models import Location
from routeopt.distances.haversine import haversine_matrix
from routeopt.distances.types import GeometryResult, MatrixResult

ROUTE_BATCH_SIZE = 100
RETRIES = 2
BACKOFF_S = 0.2


class OsrmUnavailable(Exception):
    pass


def _coords(points: list[Location]) -> str:
    return ";".join(f"{p.lon:.6f},{p.lat:.6f}" for p in points)


class OsrmClient:
    def __init__(
        self,
        base_url: str = "http://localhost:5000",
        timeout_s: float = 30.0,
        max_table_size: int = 500,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._max_table_size = max_table_size
        self._client = httpx.AsyncClient(timeout=timeout_s, transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        last: Exception | None = None
        for attempt in range(RETRIES + 1):
            if attempt:
                await asyncio.sleep(BACKOFF_S * 2 ** (attempt - 1))
            try:
                response = await self._client.get(url, params=params)
                response.raise_for_status()
                body: dict[str, Any] = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last = exc
                continue
            if body.get("code") != "Ok":
                last = OsrmUnavailable(f"OSRM code {body.get('code')}")
                continue
            return body
        raise OsrmUnavailable(str(last)) from last

    async def table(self, points: list[Location]) -> MatrixResult:
        n = len(points)
        if n == 0:
            return MatrixResult(dist_km=np.zeros((0, 0)), dur_min=np.zeros((0, 0)), source="osrm")
        dist = np.zeros((n, n))
        dur = np.zeros((n, n))
        fallback = haversine_matrix(points)
        coords = _coords(points)
        if n <= self._max_table_size:
            blocks = [(range(n), range(n))]
        else:
            size = max(1, self._max_table_size // 2)
            chunks = [range(i, min(i + size, n)) for i in range(0, n, size)]
            blocks = [(src, dst) for src in chunks for dst in chunks]
        for src, dst in blocks:
            params = {"annotations": "distance,duration"}
            if len(src) != n or len(dst) != n:
                params["sources"] = ";".join(map(str, src))
                params["destinations"] = ";".join(map(str, dst))
            body = await self._get(f"/table/v1/driving/{coords}", params)
            self._fill(body, src, dst, dist, dur, fallback)
        np.fill_diagonal(dist, 0.0)
        np.fill_diagonal(dur, 0.0)
        return MatrixResult(dist_km=dist, dur_min=dur, source="osrm")

    @staticmethod
    def _fill(
        body: dict[str, Any],
        src: range,
        dst: range,
        dist: np.ndarray,
        dur: np.ndarray,
        fallback: MatrixResult,
    ) -> None:
        raw_dist = body.get("distances")
        raw_dur = body.get("durations")
        if raw_dist is None or raw_dur is None:
            raise OsrmUnavailable("OSRM table response without annotations")
        d = np.array(raw_dist, dtype=np.float64) / 1000.0
        t = np.array(raw_dur, dtype=np.float64) / 60.0
        if d.shape != (len(src), len(dst)) or t.shape != d.shape:
            raise OsrmUnavailable("OSRM table response with unexpected shape")
        rows = np.fromiter(src, dtype=np.intp)[:, None]
        cols = np.fromiter(dst, dtype=np.intp)[None, :]
        missing = np.isnan(d) | np.isnan(t)
        dist[rows, cols] = np.where(missing, fallback.dist_km[rows, cols], d)
        dur[rows, cols] = np.where(missing, fallback.dur_min[rows, cols], t)

    async def route(self, points: list[Location]) -> GeometryResult:
        if len(points) < 2:
            return GeometryResult(geometry=[(p.lat, p.lon) for p in points], source="osrm")
        geometry: list[tuple[float, float]] = []
        start = 0
        while start < len(points) - 1:
            batch = points[start : start + ROUTE_BATCH_SIZE]
            body = await self._get(
                f"/route/v1/driving/{_coords(batch)}",
                {"overview": "full", "geometries": "geojson"},
            )
            try:
                line = body["routes"][0]["geometry"]["coordinates"]
            except (KeyError, IndexError, TypeError) as exc:
                raise OsrmUnavailable("OSRM route response malformed") from exc
            segment = [(float(lat), float(lon)) for lon, lat in line]
            geometry.extend(segment[1:] if geometry else segment)
            start += ROUTE_BATCH_SIZE - 1
        return GeometryResult(geometry=geometry, source="osrm")
