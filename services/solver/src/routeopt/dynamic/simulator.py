from __future__ import annotations

from typing import Literal

from routeopt.api.schemas import DriverPosition, TriggerMode
from routeopt.core.models import Problem, Solution, SolutionMetrics, Stop
from routeopt.core.types import Instance, RouteSet
from routeopt.dynamic import state as plan_state
from routeopt.dynamic.reoptimizer import (
    SubProblem,
    build_subproblem,
    install_tracks,
    splice,
)
from routeopt.dynamic.state import Advance, SimState


class Simulation:
    def __init__(self, problem: Problem, trigger: TriggerMode, batch_minutes: float) -> None:
        self.state: SimState = plan_state.new_state(problem)
        self.trigger = trigger
        self.batch_minutes = batch_minutes
        self.last_reopt_clock = 0.0

    @property
    def clock(self) -> float:
        return self.state.clock

    def known_problem(self) -> Problem | None:
        if not self.state.stops:
            return None
        return plan_state.known_problem(self.state)

    def install_initial(self, inst: Instance, routes: RouteSet) -> None:
        install_tracks(self.state, inst)
        splice(self.state, {}, inst, routes)

    def advance(self, clock: float) -> Advance:
        return plan_state.advance(self.state, clock)

    def add_order(self, stop: Stop) -> Stop | None:
        return plan_state.queue_order(self.state, stop)

    def reopt_reason(self) -> Literal["event", "batch"] | None:
        if not self.state.pending_new:
            return None
        if self.trigger == TriggerMode.EVENT:
            return "event"
        if self.state.clock >= self.last_reopt_clock + self.batch_minutes:
            return "batch"
        return None

    def begin_reopt(self) -> SubProblem | None:
        sub = build_subproblem(self.state)
        self.state.pending_new.clear()
        self.last_reopt_clock = self.state.clock
        return sub

    def finish_reopt(self, sub: SubProblem, inst: Instance, routes: RouteSet) -> None:
        splice(self.state, sub.committed, inst, routes)

    def positions(self) -> list[DriverPosition]:
        return plan_state.positions(self.state)

    def plan_solution(self, algorithm: str, runtime_s: float, fitness: float) -> Solution:
        return plan_state.plan_solution(self.state, algorithm, runtime_s, fitness)

    def done(self) -> bool:
        return plan_state.is_done(self.state)

    def final_metrics(self) -> SolutionMetrics:
        return plan_state.executed_metrics(self.state)
