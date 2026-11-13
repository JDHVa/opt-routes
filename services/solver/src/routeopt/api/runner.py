from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from collections.abc import AsyncIterator
from typing import Any

import anyio
import anyio.to_thread
from pydantic import ValidationError

from routeopt.algorithms import SOLVERS, Solver
from routeopt.algorithms.base import ProgressEvent, SolveResult
from routeopt.api.schemas import (
    AlgorithmRun,
    HistoryPoint,
    ParetoPoint,
    ProgressPayload,
    SolveResponse,
)
from routeopt.api.settings import Settings
from routeopt.core.instance import build_instance, instance_locations
from routeopt.core.models import (
    DistanceSource,
    Problem,
    Solution,
    SolutionMetrics,
)
from routeopt.core.solution import to_solution
from routeopt.core.types import OBJECTIVES, Evaluation, Instance, RouteSet
from routeopt.data.scenarios import load_scenario
from routeopt.distances.service import DistanceService

logger = logging.getLogger("routeopt.runner")


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class Busy(Exception):
    pass


class SolveLimiter:
    def __init__(self, limit: int) -> None:
        self._semaphore = asyncio.Semaphore(limit)

    @contextlib.asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        if self._semaphore.locked():
            raise Busy
        async with self._semaphore:
            yield

    @contextlib.asynccontextmanager
    async def wait_slot(self) -> AsyncIterator[None]:
        async with self._semaphore:
            yield


def describe_validation(error: ValidationError) -> str:
    parts = []
    for item in error.errors()[:5]:
        location = ".".join(str(part) for part in item["loc"])
        parts.append(f"{location}: {item['msg']}" if location else item["msg"])
    return "; ".join(parts)


def validate_run(
    run: AlgorithmRun, settings: Settings, time_limit_s: float | None = None
) -> Solver:
    solver_cls = SOLVERS.get(run.algorithm)
    if solver_cls is None:
        raise ApiError(
            422,
            "unknown_algorithm",
            f"unknown algorithm {run.algorithm!r}; available: {sorted(SOLVERS)}",
        )
    try:
        params = solver_cls.params_model.model_validate(run.params)
    except ValidationError as error:
        raise ApiError(422, "invalid_params", describe_validation(error)) from error
    if params.time_limit_s > settings.max_time_limit_s:
        raise ApiError(
            422,
            "time_limit_exceeded",
            f"time_limit_s={params.time_limit_s} exceeds the maximum of {settings.max_time_limit_s}",
        )
    if time_limit_s is not None:
        params = params.model_copy(update={"time_limit_s": time_limit_s})
    return solver_cls(params)


async def prepare_instance(problem: Problem, service: DistanceService) -> tuple[Instance, str]:
    try:
        if problem.distance_source == DistanceSource.PROVIDED:
            return await anyio.to_thread.run_sync(build_instance, problem), "provided"
        matrix = await service.matrix(
            instance_locations(problem),
            "haversine" if problem.distance_source == DistanceSource.HAVERSINE else "osrm",
        )
        inst = await anyio.to_thread.run_sync(
            build_instance, problem, matrix.dist_km, matrix.dur_min
        )
    except ValueError as error:
        raise ApiError(422, "invalid_problem", str(error)) from error
    return inst, matrix.source


def evaluation_metrics(ev: Evaluation) -> SolutionMetrics:
    return SolutionMetrics(
        total_distance_km=ev.total_distance_km,
        total_duration_min=ev.total_duration_min,
        makespan_min=ev.makespan_min,
        vehicles_used=ev.vehicles_used,
        total_cost_mxn=ev.total_cost_mxn,
        lateness_min=ev.lateness_min,
        overload_kg=ev.overload_kg,
        overload_m3=ev.overload_m3,
        overtime_min=ev.overtime_min,
        unassigned=ev.unassigned,
        feasible=ev.feasible,
        fitness=ev.fitness,
    )


def progress_payload(inst: Instance, event: ProgressEvent, algorithm: str) -> ProgressPayload:
    solution: Solution | None = None
    if event.best is not None:
        solution = to_solution(inst, event.best, event.best_eval, algorithm, event.elapsed_s)
    extra = {
        key: float(value)
        for key, value in event.extra.items()
        if isinstance(value, int | float) and not isinstance(value, bool)
    }
    return ProgressPayload(
        iteration=event.iteration,
        elapsed_s=event.elapsed_s,
        best_fitness=event.best_fitness,
        metrics=evaluation_metrics(event.best_eval),
        solution=solution,
        extra=extra,
    )


def pareto_points(inst: Instance, result: SolveResult) -> list[ParetoPoint] | None:
    if result.pareto is None:
        return None
    return [
        ParetoPoint(
            objectives={
                name: float(value) for name, value in zip(OBJECTIVES, ev.objectives, strict=True)
            },
            solution=to_solution(inst, rs, ev, result.algorithm, result.runtime_s),
        )
        for rs, ev in result.pareto
    ]


def history_points(result: SolveResult) -> list[HistoryPoint]:
    return [
        HistoryPoint(iteration=iteration, elapsed_s=elapsed, best_fitness=fitness)
        for iteration, elapsed, fitness in result.history
    ]


async def attach_geometry(
    problem: Problem, inst: Instance, rs: RouteSet, solution: Solution, service: DistanceService
) -> None:
    locations = instance_locations(problem)
    n, m = inst.n, inst.m
    used = [k for k, route in enumerate(rs.routes) if route]
    paths = []
    for k in used:
        points = [locations[n + k], *(locations[i] for i in rs.routes[k])]
        if not inst.open_end[k]:
            points.append(locations[n + m + k])
        paths.append(points)
    results = await asyncio.gather(*(service.geometry(points) for points in paths))
    for route, geometry in zip(solution.routes, results, strict=True):
        route.geometry = geometry.geometry


async def build_response(
    problem: Problem,
    inst: Instance,
    result: SolveResult,
    include_geometry: bool,
    service: DistanceService,
) -> SolveResponse:
    solution = to_solution(inst, result.best, result.evaluation, result.algorithm, result.runtime_s)
    if include_geometry:
        await attach_geometry(problem, inst, result.best, solution, service)
    return SolveResponse(
        solution=solution,
        history=history_points(result),
        pareto=pareto_points(inst, result),
    )


async def stream_solver(
    inst: Instance,
    solver: Solver,
    stop: threading.Event | None = None,
    warm_start: list[RouteSet] | None = None,
    state: dict[str, Any] | None = None,
) -> AsyncIterator[ProgressEvent | SolveResult]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[ProgressEvent | None] = asyncio.Queue()
    local_cancel = threading.Event()

    def callback(event: ProgressEvent) -> bool:
        if local_cancel.is_set() or (stop is not None and stop.is_set()):
            return False
        loop.call_soon_threadsafe(queue.put_nowait, event)
        return True

    def work() -> SolveResult:
        return solver.solve(inst, callback, warm_start, state)

    task = asyncio.ensure_future(anyio.to_thread.run_sync(work))
    task.add_done_callback(lambda _: queue.put_nowait(None))
    try:
        finished = False
        while not finished:
            event = await queue.get()
            while event is not None:
                try:
                    newer = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                if newer is None:
                    finished = True
                    break
                event = newer
            if event is None:
                finished = True
            else:
                yield event
        yield await task
    finally:
        local_cancel.set()
        with anyio.CancelScope(shield=True):
            await asyncio.wait({task})
        if not task.cancelled():
            task.exception()


async def run_solver(
    inst: Instance,
    solver: Solver,
    stop: threading.Event | None = None,
    warm_start: list[RouteSet] | None = None,
    state: dict[str, Any] | None = None,
) -> SolveResult:
    final: SolveResult | None = None
    async for item in stream_solver(inst, solver, stop, warm_start, state):
        if isinstance(item, SolveResult):
            final = item
    if final is None:
        raise ApiError(500, "solver_error", "solver produced no result")
    return final


async def execute_solve(
    problem: Problem,
    solver: Solver,
    include_geometry: bool,
    service: DistanceService,
    stop: threading.Event | None = None,
) -> SolveResponse:
    inst, _ = await prepare_instance(problem, service)
    started = time.perf_counter()
    result = await run_solver(inst, solver, stop)
    logger.info(
        "solve finished",
        extra={
            "algorithm": solver.name,
            "n_stops": inst.n,
            "runtime_s": round(time.perf_counter() - started, 3),
        },
    )
    return await build_response(problem, inst, result, include_geometry, service)


async def warm_up(service: DistanceService) -> float:
    started = time.perf_counter()
    base = load_scenario("mty-centro-depot-40")
    problem = base.model_copy(
        update={
            "stops": base.stops[:10],
            "drivers": base.drivers[:2],
            "distance_source": DistanceSource.HAVERSINE,
        }
    )
    inst, _ = await prepare_instance(problem, service)
    params = {"max_iterations": 1, "time_limit_s": 10.0, "seed": 0}
    for name in ("ga", "aco", "aco_ga", "nsga2"):
        if name not in SOLVERS:
            continue
        solver = SOLVERS[name](SOLVERS[name].params_model.model_validate(params))
        await run_solver(inst, solver)
    elapsed = time.perf_counter() - started
    logger.info("warm-up finished", extra={"elapsed_s": round(elapsed, 3)})
    return elapsed
