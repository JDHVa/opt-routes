from __future__ import annotations

from fastapi import APIRouter

from routeopt.api.deps import ServiceDep
from routeopt.api.schemas import (
    ErrorPayload,
    GeometryRequest,
    GeometryResponse,
    MatrixRequest,
    MatrixResponse,
)
from routeopt.distances.service import DistanceService

router = APIRouter()


@router.post("/matrix", response_model=MatrixResponse, responses={422: {"model": ErrorPayload}})
async def matrix(body: MatrixRequest, service: DistanceService = ServiceDep) -> MatrixResponse:
    result = await service.matrix(body.points)
    return MatrixResponse(
        distance_km=result.dist_km.tolist(),
        duration_min=result.dur_min.tolist(),
        source=result.source,
    )


@router.post("/geometry", response_model=GeometryResponse, responses={422: {"model": ErrorPayload}})
async def geometry(
    body: GeometryRequest, service: DistanceService = ServiceDep
) -> GeometryResponse:
    result = await service.geometry(body.points)
    return GeometryResponse(geometry=result.geometry, source=result.source)
