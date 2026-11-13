import logging
import os
from functools import lru_cache
from typing import Literal

import httpx

from routeopt.core.models import Location
from routeopt.distances.cache import LruCache, cache_key
from routeopt.distances.haversine import haversine_matrix
from routeopt.distances.osrm import OsrmClient, OsrmUnavailable
from routeopt.distances.types import GeometryResult, MatrixResult

logger = logging.getLogger(__name__)


class DistanceService:
    def __init__(
        self,
        base_url: str | None = None,
        timeout_s: float | None = None,
        max_table_size: int | None = None,
        cache_size: int = 256,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = OsrmClient(
            base_url=base_url or os.environ.get("OSRM_URL", "http://localhost:5000"),
            timeout_s=timeout_s or float(os.environ.get("OSRM_TIMEOUT_S", "30")),
            max_table_size=max_table_size or int(os.environ.get("OSRM_MAX_TABLE", "500")),
            transport=transport,
        )
        self._matrices: LruCache[MatrixResult] = LruCache(cache_size)
        self._geometries: LruCache[GeometryResult] = LruCache(cache_size)

    async def matrix(
        self, points: list[Location], prefer: Literal["osrm", "haversine"] = "osrm"
    ) -> MatrixResult:
        if prefer == "haversine":
            return haversine_matrix(points)
        key = cache_key("matrix", points)
        cached = self._matrices.get(key)
        if cached is not None:
            return cached
        try:
            result = await self._client.table(points)
        except OsrmUnavailable as exc:
            logger.warning("OSRM unavailable, using haversine matrix: %s", exc)
            return haversine_matrix(points)
        self._matrices.put(key, result)
        return result

    async def geometry(self, points: list[Location]) -> GeometryResult:
        key = cache_key("route", points)
        cached = self._geometries.get(key)
        if cached is not None:
            return cached
        try:
            result = await self._client.route(points)
        except OsrmUnavailable as exc:
            logger.warning("OSRM unavailable, using straight line geometry: %s", exc)
            return GeometryResult(geometry=[(p.lat, p.lon) for p in points], source="straight")
        self._geometries.put(key, result)
        return result

    async def aclose(self) -> None:
        await self._client.aclose()


@lru_cache(maxsize=1)
def get_distance_service() -> DistanceService:
    return DistanceService()
