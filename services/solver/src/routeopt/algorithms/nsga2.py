from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any, Literal

import numpy as np
from pydantic import Field
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.core.crossover import Crossover
from pymoo.core.duplicate import ElementwiseDuplicateElimination
from pymoo.core.mutation import Mutation
from pymoo.core.problem import Problem
from pymoo.core.sampling import Sampling
from pymoo.core.termination import NoTermination

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
from routeopt.algorithms.progress import (
    STAGE_EVOLVING,
    STAGE_FINISHED,
    STAGE_SEEDING,
    ProgressGate,
)
from routeopt.core.evaluate import evaluate
from routeopt.core.split import routes_to_chromosome, split
from routeopt.core.types import F64, I64, Chromosome, Evaluation, Instance, Penalties, RouteSet

WEIGHT_GENES = 4
WEIGHT_FLOOR = 0.02
BLEND_ALPHA = 0.3
GAUSSIAN_SIGMA = 0.15
OBJECTIVE_DECIMALS = 6

Point = tuple[RouteSet, Evaluation]
ObjectiveName = Literal["time", "cost", "vehicles", "makespan"]
DEFAULT_OBJECTIVES: tuple[ObjectiveName, ...] = ("cost", "makespan", "vehicles")


class Nsga2Params(SolverParams):
    pop_size: int = Field(default=60, ge=4, le=1000)
    crossover_rate: float = Field(default=0.9, ge=0.0, le=1.0)
    mutation_rate: float = Field(default=0.2, ge=0.0, le=1.0)
    ls_every: int = Field(default=0, ge=0)
    objectives: list[ObjectiveName] = Field(
        default_factory=lambda: list(DEFAULT_OBJECTIVES), min_length=2, max_length=4
    )


@dataclass(slots=True)
class Genome:
    tour: I64
    vorder: I64
    genes: F64
    key: bytes = field(init=False)
    result: Point | None = field(default=None, init=False)

    def __post_init__(self) -> None:
        self.key = self.tour.tobytes()


def objective_value(ev: Evaluation, name: ObjectiveName) -> float:
    if name == "time":
        return ev.total_duration_min + ev.lateness_min
    if name == "cost":
        return ev.total_cost_mxn
    if name == "vehicles":
        return float(ev.vehicles_used)
    return ev.makespan_min + ev.lateness_min


def pareto_objectives(ev: Evaluation, names: tuple[ObjectiveName, ...] = DEFAULT_OBJECTIVES) -> F64:
    return np.array([objective_value(ev, name) for name in names], dtype=np.float64)


def violation(inst: Instance, ev: Evaluation) -> float:
    kg = float(np.mean(inst.cap_kg))
    m3 = float(np.mean(inst.cap_m3))
    over_kg = ev.overload_kg / kg if math.isfinite(kg) else 0.0
    over_m3 = ev.overload_m3 / m3 if math.isfinite(m3) else 0.0
    return over_kg + over_m3 + ev.overtime_min / 60.0 + float(ev.unassigned)


def weight_vector(genes: F64) -> F64:
    raw = np.clip(genes, 0.0, 1.0) + WEIGHT_FLOOR
    weights: F64 = raw / raw.sum()
    return weights


def decode(inst: Instance, genome: Genome, penalties: Penalties | None) -> Point:
    view = replace(inst, weights=weight_vector(genome.genes))
    routes, _ = split(view, Chromosome(genome.tour, genome.vorder), penalties)
    return routes, evaluate(inst, routes, penalties)


def non_dominated_indices(objectives: F64) -> list[int]:
    count = objectives.shape[0]
    keep: list[int] = []
    for i in range(count):
        dominated = np.any(
            np.all(objectives <= objectives[i], axis=1) & np.any(objectives < objectives[i], axis=1)
        )
        if not dominated:
            keep.append(i)
    return keep


def merge_front(
    points: list[Point], names: tuple[ObjectiveName, ...] = DEFAULT_OBJECTIVES
) -> list[Point]:
    if not points:
        return []
    if any(ev.feasible for _, ev in points):
        points = [p for p in points if p[1].feasible]
    objectives = np.array([pareto_objectives(ev, names) for _, ev in points])
    seen: set[tuple[float, ...]] = set()
    front: list[Point] = []
    for i in non_dominated_indices(objectives):
        key = tuple(np.round(objectives[i], OBJECTIVE_DECIMALS).tolist())
        if key in seen:
            continue
        seen.add(key)
        front.append(points[i])
    front.sort(key=lambda p: pareto_objectives(p[1], names).tolist())
    return front


def order_crossover(a: I64, b: I64, rng: np.random.Generator) -> I64:
    size = a.shape[0]
    if size < 2:
        return a.copy()
    lo, hi = sorted(int(x) for x in rng.choice(size + 1, size=2, replace=False))
    segment = a[lo:hi]
    child = np.empty(size, dtype=np.int64)
    child[lo:hi] = segment
    rest = b[~np.isin(b, segment)]
    child[:lo] = rest[:lo]
    child[hi:] = rest[lo:]
    return child


def blend_crossover(a: F64, b: F64, rng: np.random.Generator) -> F64:
    low = np.minimum(a, b)
    high = np.maximum(a, b)
    spread = high - low
    child: F64 = rng.uniform(low - BLEND_ALPHA * spread, high + BLEND_ALPHA * spread)
    return np.clip(child, 0.0, 1.0)


def swap_mutation(perm: I64, rng: np.random.Generator) -> I64:
    out = perm.copy()
    if out.shape[0] >= 2:
        i, j = rng.choice(out.shape[0], size=2, replace=False)
        out[i], out[j] = out[j], out[i]
    return out


def inversion_mutation(perm: I64, rng: np.random.Generator) -> I64:
    out = perm.copy()
    if out.shape[0] >= 2:
        lo, hi = sorted(int(x) for x in rng.choice(out.shape[0], size=2, replace=False))
        out[lo : hi + 1] = out[lo : hi + 1][::-1]
    return out


def mutate_genome(genome: Genome, rng: np.random.Generator) -> Genome:
    tour = (
        swap_mutation(genome.tour, rng)
        if rng.random() < 0.5
        else inversion_mutation(genome.tour, rng)
    )
    vorder = swap_mutation(genome.vorder, rng) if rng.random() < 0.3 else genome.vorder.copy()
    genes = genome.genes.copy()
    if rng.random() < 0.5:
        genes = np.clip(genes + rng.normal(0.0, GAUSSIAN_SIGMA, size=genes.shape), 0.0, 1.0)
    return Genome(tour, vorder, genes)


def cross_genomes(a: Genome, b: Genome, rng: np.random.Generator) -> Genome:
    return Genome(
        order_crossover(a.tour, b.tour, rng),
        order_crossover(a.vorder, b.vorder, rng),
        blend_crossover(a.genes, b.genes, rng),
    )


class SeededSampling(Sampling):
    def __init__(self, genomes: list[Genome]) -> None:
        super().__init__()
        self.genomes = genomes

    def _do(self, problem: Any, n_samples: int, *args: Any, **kwargs: Any) -> Any:
        out = np.empty((len(self.genomes), 1), dtype=object)
        for i, genome in enumerate(self.genomes):
            out[i, 0] = genome
        return out


class GenomeCrossover(Crossover):
    def __init__(self, prob: float) -> None:
        super().__init__(n_parents=2, n_offsprings=2, prob=prob)

    def _do(self, problem: Any, X: Any, *args: Any, random_state: Any = None, **kwargs: Any) -> Any:
        _, matings, _ = X.shape
        out = np.empty((2, matings, 1), dtype=object)
        for i in range(matings):
            first, second = X[0, i, 0], X[1, i, 0]
            out[0, i, 0] = cross_genomes(first, second, random_state)
            out[1, i, 0] = cross_genomes(second, first, random_state)
        return out


class GenomeMutation(Mutation):
    def __init__(self, prob: float) -> None:
        super().__init__(prob=prob)

    def _do(self, problem: Any, X: Any, *args: Any, random_state: Any = None, **kwargs: Any) -> Any:
        out = np.empty(X.shape, dtype=object)
        for i in range(X.shape[0]):
            out[i, 0] = mutate_genome(X[i, 0], random_state)
        return out


class TourDuplicates(ElementwiseDuplicateElimination):
    def is_equal(self, a: Any, b: Any) -> bool:
        return bool(a.X[0].key == b.X[0].key)


class RoutingProblem(Problem):
    def __init__(
        self, inst: Instance, penalties: Penalties | None, names: tuple[ObjectiveName, ...]
    ) -> None:
        super().__init__(n_var=1, n_obj=len(names), n_ieq_constr=1)
        self.inst = inst
        self.penalties = penalties
        self.names = names

    def _evaluate(self, X: Any, out: dict[str, Any], *args: Any, **kwargs: Any) -> None:
        objectives = np.zeros((X.shape[0], len(self.names)))
        violations = np.zeros((X.shape[0], 1))
        for i in range(X.shape[0]):
            genome: Genome = X[i, 0]
            genome.result = decode(self.inst, genome, self.penalties)
            ev = genome.result[1]
            objectives[i] = pareto_objectives(ev, self.names)
            violations[i, 0] = violation(self.inst, ev)
        out["F"] = objectives
        out["G"] = violations


def random_genes(rng: np.random.Generator) -> F64:
    genes: F64 = rng.dirichlet(np.full(WEIGHT_GENES, 0.7))
    return genes


def original_genes(inst: Instance) -> F64:
    base = inst.weights[:WEIGHT_GENES]
    total = float(base.sum())
    genes: F64 = base / total if total > 0.0 else np.full(WEIGHT_GENES, 1.0 / WEIGHT_GENES)
    return genes


def initial_genomes(
    inst: Instance,
    params: Nsga2Params,
    rng: np.random.Generator,
    warm_start: list[RouteSet] | None,
    penalties: Penalties | None,
) -> list[Genome]:
    seeds = list(warm_start or [])
    seeds.extend(
        initial_routesets(inst, params.init, max(1, params.pop_size - len(seeds)), rng, penalties)
    )
    genomes: list[Genome] = []
    seen: set[bytes] = set()
    for index, routes in enumerate(seeds[: params.pop_size]):
        chrom = routes_to_chromosome(inst, routes)
        genes = original_genes(inst) if index == 0 else random_genes(rng)
        genome = Genome(chrom.tour, chrom.vorder, genes)
        if genome.key not in seen:
            seen.add(genome.key)
            genomes.append(genome)
    return genomes


def population_points(algorithm: Any) -> list[Point]:
    points: list[Point] = []
    for individual in algorithm.pop:
        result = individual.X[0].result
        if result is not None:
            points.append(result)
    return points


@register_solver
class Nsga2Solver(Solver):
    name = "nsga2"
    label = "NSGA-II (multi-objective)"
    params_model = Nsga2Params
    multi_objective = True

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        params = self.params
        assert isinstance(params, Nsga2Params)
        watch = Stopwatch(params.time_limit_s)
        rng = np.random.default_rng(params.seed)
        names = tuple(dict.fromkeys(params.objectives))
        genomes = initial_genomes(inst, params, rng, warm_start, penalties)
        algorithm = NSGA2(
            pop_size=params.pop_size,
            sampling=SeededSampling(genomes),
            crossover=GenomeCrossover(params.crossover_rate),
            mutation=GenomeMutation(params.mutation_rate),
            eliminate_duplicates=TourDuplicates(),
        )
        algorithm.setup(
            RoutingProblem(inst, penalties, names),
            termination=NoTermination(),
            seed=int(rng.integers(0, 2**31 - 1)),
        )
        front: list[Point] = merge_front(
            [decode(inst, genome, penalties) for genome in genomes], names
        )
        history: list[tuple[int, float, float]] = []
        generation = 0
        gate = ProgressGate(watch, params.progress_every, params.progress_interval_s)
        stop = False
        if callback is not None:
            stop = not callback(self.event(0, watch, front, STAGE_SEEDING))
            gate.mark(0)
        while not stop:
            algorithm.next()
            generation += 1
            front = merge_front([*front, *population_points(algorithm)], names)
            if params.ls_every and generation % params.ls_every == 0:
                front = self.polish(inst, front, rng, penalties, names)
            best, best_eval = pick_best(front)
            history.append((generation, best_eval.fitness, watch.elapsed))
            if callback is not None and gate.due(generation):
                gate.mark(generation)
                stop = not callback(self.event(generation, watch, front, STAGE_EVOLVING))
            if stop or generation >= params.max_iterations or watch.expired():
                break
        best, best_eval = pick_best(front)
        if callback is not None and not stop:
            callback(self.event(generation, watch, front, STAGE_FINISHED))
        return SolveResult(
            self.name,
            best,
            best_eval,
            watch.elapsed,
            generation,
            history,
            pareto=list(front),
        )

    @staticmethod
    def event(generation: int, watch: Stopwatch, front: list[Point], stage: str) -> ProgressEvent:
        best, best_eval = pick_best(front)
        return ProgressEvent(
            generation,
            watch.elapsed,
            best_eval.fitness,
            best_eval,
            best=best,
            pareto=list(front),
            extra={"stage": stage},
        )

    @staticmethod
    def polish(
        inst: Instance,
        front: list[Point],
        rng: np.random.Generator,
        penalties: Penalties | None,
        names: tuple[ObjectiveName, ...],
    ) -> list[Point]:
        improved = [
            (rs, evaluate(inst, rs, penalties))
            for rs in (improve(inst, p[0], penalties, rng) for p in front)
        ]
        return merge_front([*front, *improved], names)


def pick_best(front: list[Point]) -> Point:
    return min(front, key=lambda p: p[1].fitness)
