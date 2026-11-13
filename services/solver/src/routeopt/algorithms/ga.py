from __future__ import annotations

import math
import time
from dataclasses import dataclass, replace
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field

from routeopt.algorithms.base import (
    ProgressCallback,
    ProgressEvent,
    Solver,
    SolveResult,
    SolverParams,
    Stopwatch,
    register_solver,
)
from routeopt.algorithms.init import initial_routesets
from routeopt.algorithms.local_search import improve
from routeopt.core.evaluate import evaluate
from routeopt.core.split import random_chromosome, routes_to_chromosome, split
from routeopt.core.types import I64, Chromosome, Evaluation, Instance, Penalties, RouteSet

ADAPT_EVERY = 10
LOW_FEASIBLE = 0.2
HIGH_FEASIBLE = 0.6
PENALTY_UP = 1.2
PENALTY_DOWN = 0.85
PENALTY_MIN_SCALE = 0.1
PENALTY_MAX_SCALE = 100.0
KEEP_ON_DIVERSIFY = 0.3
CLONE_TOLERANCE = 1e-6
ATTEMPTS_PER_CHILD = 3
INIT_LS_TIME_SHARE = 0.15
VORDER_MUTATION_SHARE = 0.5


class GaParams(SolverParams):
    pop_size: int = Field(default=40, ge=4, le=1000)
    crossover_rate: float = Field(default=0.9, ge=0.0, le=1.0)
    mutation_rate: float = Field(default=0.2, ge=0.0, le=1.0)
    ls_rate: float = Field(default=0.25, ge=0.0, le=1.0)
    elite_size: int = Field(default=2, ge=1, le=100)
    tournament_size: int = Field(default=2, ge=1, le=20)
    crossover: Literal["ox", "pmx"] = "ox"
    stagnation_generations: int = Field(default=60, ge=1)
    granular_k: int = Field(default=20, ge=1, le=200)


@dataclass(slots=True)
class Individual:
    chrom: Chromosome
    rs: RouteSet
    ev: Evaluation

    @property
    def fitness(self) -> float:
        return self.ev.fitness


def order_crossover(a: I64, b: I64, rng: np.random.Generator) -> I64:
    size = a.shape[0]
    if size < 2:
        return a.copy()
    lo, hi = sorted(int(x) for x in rng.choice(size + 1, size=2, replace=False))
    taken = np.zeros(size, dtype=np.bool_)
    taken[a[lo:hi]] = True
    rolled = np.roll(b, -hi)
    rest = rolled[~taken[rolled]]
    child = np.empty_like(a)
    child[lo:hi] = a[lo:hi]
    child[np.concatenate((np.arange(hi, size), np.arange(0, lo)))] = rest
    return child


def pmx_crossover(a: I64, b: I64, rng: np.random.Generator) -> I64:
    size = a.shape[0]
    if size < 2:
        return a.copy()
    lo, hi = sorted(int(x) for x in rng.choice(size + 1, size=2, replace=False))
    child = np.empty_like(a)
    child[lo:hi] = a[lo:hi]
    mapping = {int(a[j]): int(b[j]) for j in range(lo, hi)}
    for i in list(range(lo)) + list(range(hi, size)):
        value = int(b[i])
        while value in mapping:
            value = mapping[value]
        child[i] = value
    return child


def mutate_tour(tour: I64, rng: np.random.Generator) -> I64:
    size = tour.shape[0]
    if size < 2:
        return tour
    out = tour.copy()
    i, j = sorted(int(x) for x in rng.choice(size, size=2, replace=False))
    kind = int(rng.integers(0, 3))
    if kind == 0:
        out[i], out[j] = out[j], out[i]
    elif kind == 1:
        out[i : j + 1] = out[i : j + 1][::-1].copy()
    else:
        moved = out[j]
        out[i + 1 : j + 1] = out[i:j].copy()
        out[i] = moved
    return out


def mutate_vorder(vorder: I64, rng: np.random.Generator) -> I64:
    if vorder.shape[0] < 2:
        return vorder
    out = vorder.copy()
    i, j = rng.choice(vorder.shape[0], size=2, replace=False)
    out[i], out[j] = out[j], out[i]
    return out


class GeneticEngine:
    def __init__(
        self, inst: Instance, params: GaParams, rng: np.random.Generator, penalties: Penalties
    ) -> None:
        self.inst = inst
        self.params = params
        self.rng = rng
        self.base_penalties = replace(penalties)
        self.penalties = replace(penalties)
        self.population: list[Individual] = []
        self.generation = 0
        self.deadline: float | None = None
        self._best: tuple[RouteSet, Evaluation] | None = None
        self._stagnation = 0

    def seed(self, routesets: list[RouteSet]) -> None:
        individuals = [self._from_routeset(rs) for rs in routesets]
        individuals.sort(key=lambda ind: ind.fitness)
        pool = individuals[: self.params.pop_size]
        while len(pool) < self.params.pop_size:
            pool.append(self._random_individual())
        self.population = pool
        for ind in pool:
            self._register(ind)

    def step(self) -> None:
        params = self.params
        self.generation += 1
        best_before = self._best_fitness()
        self.population.sort(key=lambda ind: ind.fitness)
        elites = self.population[: params.elite_size]
        target = params.pop_size - len(elites)
        children: list[Individual] = []
        attempts = 0
        while len(children) < target and attempts < ATTEMPTS_PER_CHILD * target:
            if self.deadline is not None and time.perf_counter() >= self.deadline:
                break
            attempts += 1
            child = self._offspring()
            if self._is_clone(child, elites, children):
                continue
            children.append(child)
        leftovers = iter(self.population[params.elite_size :])
        while len(children) < target:
            extra = next(leftovers, None)
            if extra is None:
                children.append(self._random_individual())
            else:
                children.append(extra)
        self.population = [*elites, *children]
        if self._best_fitness() < best_before - 1e-12:
            self._stagnation = 0
        else:
            self._stagnation += 1
        if self.generation % ADAPT_EVERY == 0:
            self._adapt_penalties()
        if self._stagnation >= params.stagnation_generations:
            self._diversify()

    def best(self) -> tuple[RouteSet, Evaluation]:
        if self._best is None:
            raise RuntimeError("engine has no population; call seed first")
        return self._best[0].copy(), self._best[1]

    def elite(self, k: int) -> list[RouteSet]:
        out: list[RouteSet] = []
        seen: set[tuple[tuple[int, ...], ...]] = set()
        for ind in sorted(self.population, key=lambda item: item.fitness):
            key = tuple(tuple(route) for route in ind.rs.routes)
            if key in seen:
                continue
            seen.add(key)
            out.append(ind.rs.copy())
            if len(out) >= k:
                break
        return out

    def inject(self, routesets: list[RouteSet]) -> None:
        for rs in routesets:
            ind = self._from_routeset(rs)
            if any(self._same(ind, other) for other in self.population):
                continue
            worst = max(range(len(self.population)), key=lambda i: self.population[i].fitness)
            self._register(ind)
            if ind.fitness < self.population[worst].fitness:
                self.population[worst] = ind

    def stats(self) -> dict[str, float]:
        if not self.population:
            return {"avg_fitness": 0.0, "diversity": 0.0, "feasible_pct": 0.0}
        fitness = [ind.fitness for ind in self.population]
        feasible = sum(1 for ind in self.population if ind.ev.feasible)
        return {
            "avg_fitness": float(np.mean(fitness)),
            "diversity": self._diversity(),
            "feasible_pct": 100.0 * feasible / len(self.population),
        }

    def _best_fitness(self) -> float:
        return math.inf if self._best is None else self._best[1].fitness

    def _individual(self, chrom: Chromosome, rs: RouteSet) -> Individual:
        return Individual(chrom, rs, evaluate(self.inst, rs, self.penalties))

    def _decode(self, chrom: Chromosome) -> Individual:
        rs, _ = split(self.inst, chrom, self.penalties)
        return self._individual(chrom, rs)

    def _from_routeset(self, rs: RouteSet) -> Individual:
        chrom = routes_to_chromosome(self.inst, rs)
        if rs.unassigned:
            return self._decode(chrom)
        return self._individual(chrom, rs.copy())

    def _random_individual(self) -> Individual:
        return self._decode(random_chromosome(self.inst, self.rng))

    def _register(self, ind: Individual) -> None:
        ev = ind.ev
        if self.penalties != self.base_penalties:
            ev = evaluate(self.inst, ind.rs, self.base_penalties)
        if self._best is None or ev.fitness < self._best[1].fitness:
            self._best = (ind.rs.copy(), ev)

    def _tournament(self) -> Individual:
        picks = self.rng.integers(0, len(self.population), size=self.params.tournament_size)
        return min((self.population[int(i)] for i in picks), key=lambda ind: ind.fitness)

    def _offspring(self) -> Individual:
        params = self.params
        a = self._tournament()
        b = self._tournament()
        tour = a.chrom.tour
        vorder = a.chrom.vorder
        if self.rng.random() < params.crossover_rate:
            cross = order_crossover if params.crossover == "ox" else pmx_crossover
            tour = cross(a.chrom.tour, b.chrom.tour, self.rng)
            vorder = order_crossover(a.chrom.vorder, b.chrom.vorder, self.rng)
        if self.rng.random() < params.mutation_rate:
            tour = mutate_tour(tour, self.rng)
            if self.rng.random() < VORDER_MUTATION_SHARE:
                vorder = mutate_vorder(vorder, self.rng)
        ind = self._decode(Chromosome(tour=tour.copy(), vorder=vorder.copy()))
        if params.local_search and self.rng.random() < params.ls_rate:
            ind = self._educate(ind)
        self._register(ind)
        return ind

    def _educate(self, ind: Individual) -> Individual:
        better = improve(
            self.inst, ind.rs, self.penalties, self.rng, granular_k=self.params.granular_k
        )
        return self._individual(routes_to_chromosome(self.inst, better), better)

    def _same(self, a: Individual, b: Individual) -> bool:
        return abs(a.fitness - b.fitness) < CLONE_TOLERANCE and bool(
            np.array_equal(a.chrom.tour, b.chrom.tour)
        )

    def _is_clone(
        self, child: Individual, elites: list[Individual], children: list[Individual]
    ) -> bool:
        return any(self._same(child, other) for other in (*elites, *children))

    def _adapt_penalties(self) -> None:
        feasible = sum(1 for ind in self.population if ind.ev.feasible) / len(self.population)
        if feasible < LOW_FEASIBLE:
            factor = PENALTY_UP
        elif feasible > HIGH_FEASIBLE:
            factor = PENALTY_DOWN
        else:
            return
        base = self.base_penalties
        pen = self.penalties
        low = PENALTY_MIN_SCALE
        high = PENALTY_MAX_SCALE
        new_capacity = min(max(pen.capacity * factor, base.capacity * low), base.capacity * high)
        new_overtime = min(max(pen.overtime * factor, base.overtime * low), base.overtime * high)
        if new_capacity == pen.capacity and new_overtime == pen.overtime:
            return
        self.penalties = replace(pen, capacity=new_capacity, overtime=new_overtime)
        self.population = [self._decode(ind.chrom) for ind in self.population]

    def _diversify(self) -> None:
        self.population.sort(key=lambda ind: ind.fitness)
        keep = max(1, math.ceil(KEEP_ON_DIVERSIFY * self.params.pop_size))
        survivors = self.population[:keep]
        fresh: list[Individual] = []
        while len(survivors) + len(fresh) < self.params.pop_size:
            ind = self._random_individual()
            self._register(ind)
            fresh.append(ind)
        self.population = [*survivors, *fresh]
        self._stagnation = 0

    def _diversity(self) -> float:
        reference = self._arcs(self.population[0].rs)
        if not reference:
            return 0.0
        shares = []
        for ind in self.population:
            arcs = self._arcs(ind.rs)
            shares.append(1.0 - len(arcs & reference) / max(len(arcs), len(reference)))
        return float(np.mean(shares))

    def _arcs(self, rs: RouteSet) -> set[int]:
        width = self.inst.n + 2
        arcs: set[int] = set()
        for route in rs.routes:
            prev = self.inst.n
            for stop in route:
                arcs.add(prev * width + stop)
                prev = stop
            if route:
                arcs.add(prev * width + self.inst.n + 1)
        return arcs


@register_solver
class GaSolver(Solver):
    name: ClassVar[str] = "ga"
    label: ClassVar[str] = "Genetic Algorithm (memetic)"
    params_model: ClassVar[type[SolverParams]] = GaParams

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        params = GaParams.model_validate(self.params.model_dump())
        pen = penalties if penalties is not None else Penalties()
        rng = np.random.default_rng(params.seed)
        watch = Stopwatch(params.time_limit_s)
        engine = GeneticEngine(inst, params, rng, pen)
        engine.deadline = watch.t0 + params.time_limit_s
        seeds = initial_routesets(inst, params.init, params.pop_size, rng, pen)
        if params.local_search:
            seeds = self._educate_seeds(inst, seeds, params, rng, pen, watch)
        engine.seed([*seeds, *(warm_start or [])])
        history: list[tuple[int, float, float]] = []
        best_fitness = engine.best()[1].fitness
        history.append((0, watch.elapsed, best_fitness))
        iterations = 0
        stopped = False
        while iterations < params.max_iterations and not watch.expired():
            engine.step()
            iterations += 1
            fitness = engine.best()[1].fitness
            if fitness < best_fitness - 1e-12:
                best_fitness = fitness
                history.append((iterations, watch.elapsed, fitness))
            if (
                callback is not None
                and iterations % params.progress_every == 0
                and not callback(self._event(engine, iterations, watch))
            ):
                stopped = True
                break
        if callback is not None and not stopped:
            callback(self._event(engine, iterations, watch))
        best, evaluation = engine.best()
        if history[-1][0] != iterations:
            history.append((iterations, watch.elapsed, evaluation.fitness))
        return SolveResult(
            algorithm=self.name,
            best=best,
            evaluation=evaluation,
            runtime_s=watch.elapsed,
            iterations=iterations,
            history=history,
            state={},
        )

    @staticmethod
    def _educate_seeds(
        inst: Instance,
        seeds: list[RouteSet],
        params: GaParams,
        rng: np.random.Generator,
        pen: Penalties,
        watch: Stopwatch,
    ) -> list[RouteSet]:
        budget = INIT_LS_TIME_SHARE * params.time_limit_s
        out: list[RouteSet] = []
        for rs in seeds:
            if watch.elapsed < budget:
                rs = improve(inst, rs, pen, rng, granular_k=params.granular_k)
            out.append(rs)
        return out

    @staticmethod
    def _event(engine: GeneticEngine, iteration: int, watch: Stopwatch) -> ProgressEvent:
        best, evaluation = engine.best()
        return ProgressEvent(
            iteration=iteration,
            elapsed_s=watch.elapsed,
            best_fitness=evaluation.fitness,
            best_eval=evaluation,
            best=best,
            extra=engine.stats(),
        )
