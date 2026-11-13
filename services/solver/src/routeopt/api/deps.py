from __future__ import annotations

from fastapi import Depends
from starlette.requests import HTTPConnection

from routeopt.api.runner import SolveLimiter
from routeopt.api.settings import Settings
from routeopt.distances.service import DistanceService, get_distance_service


def get_settings(conn: HTTPConnection) -> Settings:
    settings: Settings = conn.app.state.settings
    return settings


def get_limiter(conn: HTTPConnection) -> SolveLimiter:
    limiter: SolveLimiter = conn.app.state.limiter
    return limiter


def get_service() -> DistanceService:
    return get_distance_service()


SettingsDep = Depends(get_settings)
LimiterDep = Depends(get_limiter)
ServiceDep = Depends(get_service)
