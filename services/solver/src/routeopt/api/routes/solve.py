from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from routeopt.algorithms.base import ProgressEvent, SolveResult
from routeopt.api.deps import LimiterDep, ServiceDep, SettingsDep
from routeopt.api.runner import (
    ApiError,
    Busy,
    SolveLimiter,
    build_response,
    execute_solve,
    prepare_instance,
    progress_payload,
    stream_solver,
    validate_run,
)
from routeopt.api.schemas import (
    ErrorPayload,
    SolveRequest,
    SolveResponse,
    SseEvent,
)
from routeopt.api.settings import Settings
from routeopt.distances.service import DistanceService

logger = logging.getLogger("routeopt.api")

router = APIRouter()

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorPayload},
    429: {"model": ErrorPayload},
}
STREAM_RESPONSES: dict[int | str, dict[str, Any]] = {
    200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}},
    422: {"model": ErrorPayload},
}


def sse(event: SseEvent, payload: BaseModel) -> dict[str, str]:
    return {"event": event.value, "data": payload.model_dump_json()}


def error_event(code: str, message: str) -> dict[str, str]:
    return sse(SseEvent.ERROR, ErrorPayload(code=code, message=message))


@router.post(
    "/solve",
    response_model=SolveResponse,
    responses=ERROR_RESPONSES,
)
async def solve(
    body: SolveRequest,
    settings: Settings = SettingsDep,
    limiter: SolveLimiter = LimiterDep,
    service: DistanceService = ServiceDep,
) -> SolveResponse:
    solver = validate_run(body.run, settings)
    try:
        async with limiter.slot():
            return await execute_solve(body.problem, solver, body.include_geometry, service)
    except Busy as error:
        raise ApiError(429, "busy", "the solver is busy, retry shortly") from error


@router.post("/solve/stream", responses=STREAM_RESPONSES)
async def solve_stream(
    body: SolveRequest,
    settings: Settings = SettingsDep,
    limiter: SolveLimiter = LimiterDep,
    service: DistanceService = ServiceDep,
) -> EventSourceResponse:
    solver = validate_run(body.run, settings)

    async def events() -> AsyncIterator[dict[str, str]]:
        try:
            async with limiter.slot():
                inst, _ = await prepare_instance(body.problem, service)
                async for item in stream_solver(inst, solver):
                    if isinstance(item, ProgressEvent):
                        yield sse(SseEvent.PROGRESS, progress_payload(inst, item, solver.name))
                    elif isinstance(item, SolveResult):
                        response = await build_response(
                            body.problem, inst, item, body.include_geometry, service
                        )
                        yield sse(SseEvent.RESULT, response)
        except Busy:
            yield error_event("busy", "the solver is busy, retry shortly")
        except ApiError as error:
            yield error_event(error.code, error.message)
        except Exception as error:
            logger.exception("solve stream failed")
            yield error_event("solver_error", str(error))

    return EventSourceResponse(events())
