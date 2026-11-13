from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from routeopt.algorithms.base import ProgressEvent, SolveResult
from routeopt.api.deps import LimiterDep, ServiceDep, SettingsDep
from routeopt.api.routes.solve import (
    ERROR_RESPONSES,
    STREAM_RESPONSES,
    error_event,
    sse,
)
from routeopt.api.runner import (
    ApiError,
    Busy,
    SolveLimiter,
    build_response,
    history_points,
    prepare_instance,
    progress_payload,
    stream_solver,
    validate_run,
)
from routeopt.api.schemas import (
    AlgorithmRun,
    CompareEntry,
    CompareRequest,
    CompareResponse,
    ProgressPayload,
    SseEvent,
)
from routeopt.api.settings import Settings
from routeopt.distances.service import DistanceService

logger = logging.getLogger("routeopt.api")

router = APIRouter()


class CompareProgress(ProgressPayload):
    run_index: int


class CompareResult(CompareEntry):
    run_index: int


def with_gaps(entries: list[CompareEntry]) -> CompareResponse:
    best = min(entry.solution.metrics.fitness for entry in entries)
    gapped = []
    for entry in entries:
        gap = (entry.solution.metrics.fitness - best) / best * 100.0 if best > 0.0 else None
        gapped.append(entry.model_copy(update={"gap_pct": gap}))
    return CompareResponse(entries=gapped, best_known=None)


async def _iterate(
    body: CompareRequest, settings: Settings, service: DistanceService
) -> AsyncIterator[ProgressPayload | CompareEntry]:
    solvers = [validate_run(run, settings) for run in body.runs]
    inst, _ = await prepare_instance(body.problem, service)
    for run, solver in zip(body.runs, solvers, strict=True):
        async for item in stream_solver(inst, solver):
            if isinstance(item, ProgressEvent):
                yield progress_payload(inst, item, solver.name)
            elif isinstance(item, SolveResult):
                response = await build_response(
                    body.problem, inst, item, body.include_geometry, service
                )
                yield CompareEntry(
                    run=AlgorithmRun(algorithm=run.algorithm, params=run.params),
                    solution=response.solution,
                    history=history_points(item),
                )


@router.post("/compare", response_model=CompareResponse, responses=ERROR_RESPONSES)
async def compare(
    body: CompareRequest,
    settings: Settings = SettingsDep,
    limiter: SolveLimiter = LimiterDep,
    service: DistanceService = ServiceDep,
) -> CompareResponse:
    for run in body.runs:
        validate_run(run, settings)
    try:
        async with limiter.slot():
            entries = [
                item
                async for item in _iterate(body, settings, service)
                if isinstance(item, CompareEntry)
            ]
    except Busy as error:
        raise ApiError(429, "busy", "the solver is busy, retry shortly") from error
    return with_gaps(entries)


@router.post("/compare/stream", responses=STREAM_RESPONSES)
async def compare_stream(
    body: CompareRequest,
    settings: Settings = SettingsDep,
    limiter: SolveLimiter = LimiterDep,
    service: DistanceService = ServiceDep,
) -> EventSourceResponse:
    for run in body.runs:
        validate_run(run, settings)

    async def events() -> AsyncIterator[dict[str, str]]:
        entries: list[CompareEntry] = []
        try:
            async with limiter.slot():
                async for item in _iterate(body, settings, service):
                    run_index = len(entries)
                    if isinstance(item, CompareEntry):
                        entries.append(item)
                        yield sse(
                            SseEvent.RESULT,
                            CompareResult(run_index=run_index, **dict(item)),
                        )
                    else:
                        yield sse(
                            SseEvent.PROGRESS,
                            CompareProgress(run_index=run_index, **dict(item)),
                        )
            yield {"event": "complete", "data": with_gaps(entries).model_dump_json()}
        except Busy:
            yield error_event("busy", "the solver is busy, retry shortly")
        except ApiError as error:
            yield error_event(error.code, error.message)
        except Exception as error:
            logger.exception("compare stream failed")
            yield error_event("solver_error", str(error))

    return EventSourceResponse(events())
