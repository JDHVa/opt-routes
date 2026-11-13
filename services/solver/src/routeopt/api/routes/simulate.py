from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, TypeAdapter, ValidationError

from routeopt.algorithms import Solver
from routeopt.algorithms.base import SolveResult
from routeopt.api.runner import (
    ApiError,
    Busy,
    SolveLimiter,
    describe_validation,
    prepare_instance,
    run_solver,
    validate_run,
)
from routeopt.api.schemas import (
    ErrorPayload,
    SimClientAddOrder,
    SimClientControl,
    SimClientMessage,
    SimClientSpeed,
    SimClientStart,
    SimServerDone,
    SimServerError,
    SimServerOrder,
    SimServerReoptimized,
    SimServerTick,
    SimulationConfig,
)
from routeopt.api.settings import Settings
from routeopt.core.types import Instance
from routeopt.distances.service import DistanceService, get_distance_service
from routeopt.dynamic.reoptimizer import SubProblem, warm_start
from routeopt.dynamic.simulator import Simulation

logger = logging.getLogger("routeopt.simulate")

router = APIRouter()

CLIENT_MESSAGE = TypeAdapter(SimClientMessage)


@dataclass(slots=True)
class ReoptOutcome:
    sub: SubProblem
    inst: Instance
    result: SolveResult
    runtime_s: float


class SimulationSession:
    def __init__(
        self,
        ws: WebSocket,
        settings: Settings,
        limiter: SolveLimiter,
        service: DistanceService,
    ) -> None:
        self.ws = ws
        self.settings = settings
        self.limiter = limiter
        self.service = service
        self.stop = threading.Event()
        self.inbox: asyncio.Queue[object | None] = asyncio.Queue()
        self.solver_state: dict[str, Any] = {}
        self.reopt_task: asyncio.Task[ReoptOutcome] | None = None
        self.reopt_reason: Literal["event", "batch"] = "event"
        self.reader: asyncio.Task[None] | None = None

    async def send(self, message: BaseModel) -> None:
        await self.ws.send_json(message.model_dump(mode="json"))

    async def fail(self, code: str, text: str) -> None:
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await self.send(SimServerError(error=ErrorPayload(code=code, message=text)))

    async def read_loop(self) -> None:
        try:
            while True:
                self.inbox.put_nowait(await self.ws.receive_json())
        except (WebSocketDisconnect, RuntimeError):
            self.inbox.put_nowait(None)

    async def receive_start(self) -> SimulationConfig | None:
        try:
            raw = await self.ws.receive_json()
            message = CLIENT_MESSAGE.validate_python(raw)
        except ValidationError as error:
            await self.fail("invalid_request", describe_validation(error))
            return None
        if not isinstance(message, SimClientStart):
            await self.fail("invalid_request", "the first message must be of type 'start'")
            return None
        return message.config

    async def run(self) -> None:
        await self.ws.accept()
        try:
            await self._run()
        except WebSocketDisconnect:
            logger.info("simulation client disconnected")
        except ApiError as error:
            await self.fail(error.code, error.message)
        except Exception as error:
            logger.exception("simulation failed")
            await self.fail("simulation_error", str(error))
        finally:
            await self._cleanup()

    async def _run(self) -> None:
        config = await self.receive_start()
        if config is None:
            return
        initial_solver = validate_run(config.run, self.settings)
        reopt_solver = validate_run(config.run, self.settings, config.reopt_time_limit_s)
        sim = Simulation(config.problem, config.trigger, config.batch_minutes)
        known = sim.known_problem()
        if known is None:
            await self.fail("invalid_request", "no orders with release_min <= 0 to plan")
            return
        try:
            async with self.limiter.slot():
                started = time.perf_counter()
                inst, _ = await prepare_instance(known, self.service)
                result = await run_solver(inst, initial_solver, self.stop)
        except Busy:
            await self.fail("busy", "the solver is busy, retry shortly")
            return
        self.solver_state = result.state
        sim.install_initial(inst, result.best)
        await self.send(
            SimServerReoptimized(
                clock_min=sim.clock,
                solution=sim.plan_solution(
                    result.algorithm, time.perf_counter() - started, result.evaluation.fitness
                ),
                runtime_s=time.perf_counter() - started,
                reason="initial",
            )
        )
        self.reader = asyncio.create_task(self.read_loop())
        await self.loop(sim, config, reopt_solver)

    async def loop(self, sim: Simulation, config: SimulationConfig, reopt_solver: Solver) -> None:
        speed = config.speed
        paused = False
        last = time.monotonic()
        while True:
            await asyncio.sleep(self.settings.sim_tick_s)
            now = time.monotonic()
            elapsed, last = now - last, now
            while not self.inbox.empty():
                message = self.inbox.get_nowait()
                if message is None:
                    return
                outcome = await self.handle(sim, message)
                if outcome == "stop":
                    return
                if outcome == "pause":
                    paused = True
                elif outcome == "resume":
                    paused = False
                elif isinstance(outcome, float):
                    speed = outcome
            clock = sim.clock if paused else sim.clock + speed * elapsed
            advanced = sim.advance(clock)
            for stop in advanced.revealed:
                await self.send(SimServerOrder(clock_min=sim.clock, stop=stop))
            if self.reopt_task is not None and self.reopt_task.done():
                await self.apply_reopt(sim, self.reopt_task.result())
                self.reopt_task = None
            if self.reopt_task is None:
                self.start_reopt(sim, reopt_solver)
            await self.send(
                SimServerTick(
                    clock_min=sim.clock,
                    positions=sim.positions(),
                    delivered_stop_ids=advanced.delivered,
                )
            )
            if sim.done():
                await self.send(SimServerDone(clock_min=sim.clock, metrics=sim.final_metrics()))
                return

    async def handle(self, sim: Simulation, raw: object) -> str | float | None:
        try:
            message = CLIENT_MESSAGE.validate_python(raw)
        except ValidationError as error:
            await self.fail("invalid_request", describe_validation(error))
            return None
        if isinstance(message, SimClientControl):
            return message.type
        if isinstance(message, SimClientSpeed):
            return message.speed
        if isinstance(message, SimClientAddOrder):
            try:
                revealed = sim.add_order(message.stop)
            except ValueError as error:
                await self.fail("invalid_order", str(error))
                return None
            if revealed is not None:
                await self.send(SimServerOrder(clock_min=sim.clock, stop=revealed))
            return None
        await self.fail("invalid_request", "'start' was already received")
        return None

    def start_reopt(self, sim: Simulation, solver: Solver) -> None:
        reason = sim.reopt_reason()
        if reason is None:
            return
        sub = sim.begin_reopt()
        if sub is None:
            return
        self.reopt_reason = reason
        self.reopt_task = asyncio.create_task(self.reoptimize(sub, solver))

    async def reoptimize(self, sub: SubProblem, solver: Solver) -> ReoptOutcome:
        async with self.limiter.wait_slot():
            started = time.perf_counter()
            inst, _ = await prepare_instance(sub.problem, self.service)
            warm = warm_start(inst, sub)
            result = await run_solver(inst, solver, self.stop, [warm], self.solver_state)
            return ReoptOutcome(sub, inst, result, time.perf_counter() - started)

    async def apply_reopt(self, sim: Simulation, outcome: ReoptOutcome) -> None:
        self.solver_state = outcome.result.state
        sim.finish_reopt(outcome.sub, outcome.inst, outcome.result.best)
        await self.send(
            SimServerReoptimized(
                clock_min=sim.clock,
                solution=sim.plan_solution(
                    outcome.result.algorithm,
                    outcome.runtime_s,
                    outcome.result.evaluation.fitness,
                ),
                runtime_s=outcome.runtime_s,
                reason=self.reopt_reason,
            )
        )

    async def _cleanup(self) -> None:
        self.stop.set()
        reader = self.reader
        if reader is not None:
            reader.cancel()
        with anyio.CancelScope(shield=True):
            if self.reopt_task is not None:
                await asyncio.wait({self.reopt_task})
                if not self.reopt_task.cancelled():
                    self.reopt_task.exception()
            if reader is not None:
                await asyncio.wait({reader})
        with contextlib.suppress(RuntimeError):
            await self.ws.close()


@router.websocket("/simulate")
async def simulate(ws: WebSocket) -> None:
    settings: Settings = ws.app.state.settings
    limiter: SolveLimiter = ws.app.state.limiter
    await SimulationSession(ws, settings, limiter, get_distance_service()).run()
