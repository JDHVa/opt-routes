from __future__ import annotations

import time
from typing import Literal

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from routeopt.api.settings import Settings

router = APIRouter()

OSRM_PROBE_TTL_S = 10.0
OSRM_PROBE_TIMEOUT_S = 1.5
_probe: dict[str, float | bool] = {"at": -OSRM_PROBE_TTL_S, "ok": False}


class HealthResponse(BaseModel):
    status: Literal["ok"]
    osrm: bool


async def osrm_alive(settings: Settings) -> bool:
    now = time.monotonic()
    if now - float(_probe["at"]) < OSRM_PROBE_TTL_S:
        return bool(_probe["ok"])
    url = f"{settings.osrm_url.rstrip('/')}/nearest/v1/driving/-100.3161,25.6866"
    try:
        async with httpx.AsyncClient(timeout=OSRM_PROBE_TIMEOUT_S) as client:
            response = await client.get(url)
        alive = response.status_code == 200
    except httpx.HTTPError:
        alive = False
    _probe["at"] = now
    _probe["ok"] = alive
    return alive


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings: Settings = request.app.state.settings
    return HealthResponse(status="ok", osrm=await osrm_alive(settings))
