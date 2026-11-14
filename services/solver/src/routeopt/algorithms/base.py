from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from routeopt.core.types import Evaluation, Instance, Penalties, RouteSet


class InitStrategy(StrEnum):
    RANDOM = "random"
    NEAREST_NEIGHBOR = "nearest_neighbor"
    KMEANS = "kmeans"
    SWEEP = "sweep"


class SolverParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time_limit_s: float = Field(default=30.0, gt=0, le=600)
    max_iterations: int = Field(default=500, gt=0)
    seed: int | None = None
    init: InitStrategy = InitStrategy.KMEANS
    local_search: bool = True
    progress_every: int = Field(default=5, ge=1)
    progress_interval_s: float = Field(default=0.5, gt=0, le=10)


@dataclass(slots=True)
class ProgressEvent:
    iteration: int
    elapsed_s: float
    best_fitness: float
    best_eval: Evaluation
    best: RouteSet | None = None
    pareto: list[tuple[RouteSet, Evaluation]] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


ProgressCallback = Callable[[ProgressEvent], bool]


@dataclass(slots=True)
class SolveResult:
    algorithm: str
    best: RouteSet
    evaluation: Evaluation
    runtime_s: float
    iterations: int
    history: list[tuple[int, float, float]]
    pareto: list[tuple[RouteSet, Evaluation]] | None = None
    state: dict[str, Any] = field(default_factory=dict)


class Solver(ABC):
    name: ClassVar[str]
    label: ClassVar[str]
    params_model: ClassVar[type[SolverParams]]
    multi_objective: ClassVar[bool] = False

    def __init__(self, params: SolverParams | dict[str, Any] | None = None) -> None:
        if params is None:
            params = self.params_model()
        elif isinstance(params, dict):
            params = self.params_model.model_validate(params)
        self.params = params

    @abstractmethod
    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        pass


class Stopwatch:
    def __init__(self, limit_s: float) -> None:
        self.t0 = time.perf_counter()
        self.limit = limit_s

    @property
    def elapsed(self) -> float:
        return time.perf_counter() - self.t0

    def expired(self) -> bool:
        return self.elapsed >= self.limit


SOLVERS: dict[str, type[Solver]] = {}


def register_solver(cls: type[Solver]) -> type[Solver]:
    if cls.name in SOLVERS:
        raise ValueError(f"duplicate solver name {cls.name!r}")
    SOLVERS[cls.name] = cls
    return cls


def get_solver(name: str, params: SolverParams | dict[str, Any] | None = None) -> Solver:
    try:
        return SOLVERS[name](params)
    except KeyError as e:
        raise KeyError(f"unknown solver {name!r}; available: {sorted(SOLVERS)}") from e
