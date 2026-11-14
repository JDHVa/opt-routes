from __future__ import annotations

from routeopt.algorithms.base import Stopwatch

STAGE_SEEDING = "seeding"
STAGE_EVOLVING = "evolving"
STAGE_CONSTRUCTING = "constructing"
STAGE_COOPERATING = "cooperating"
STAGE_FINISHED = "finished"


class ProgressGate:
    def __init__(self, watch: Stopwatch, every: int, interval_s: float) -> None:
        self.watch = watch
        self.every = every
        self.interval_s = interval_s
        self.last_iteration = 0
        self.last_time = watch.elapsed

    def due_time(self) -> bool:
        return self.watch.elapsed - self.last_time >= self.interval_s

    def due(self, iteration: int) -> bool:
        return iteration - self.last_iteration >= self.every or self.due_time()

    def mark(self, iteration: int) -> None:
        self.last_iteration = iteration
        self.last_time = self.watch.elapsed

    def mark_time(self) -> None:
        self.last_time = self.watch.elapsed
