from __future__ import annotations

import numpy as np

from routeopt.algorithms.base import InitStrategy
from routeopt.algorithms.clustering import (
    kmeans_assignment,
    route_clusters,
    sweep_assignment,
)
from routeopt.core.construct import nearest_neighbor
from routeopt.core.split import random_chromosome, routes_to_chromosome, split
from routeopt.core.types import Chromosome, Instance, Penalties, RouteSet


def random_routeset(
    inst: Instance, rng: np.random.Generator, penalties: Penalties | None
) -> RouteSet:
    rs, _ = split(inst, random_chromosome(inst, rng), penalties)
    return rs


CLUSTER_SEEDS = 4


def perturbed(
    inst: Instance,
    base: RouteSet,
    rng: np.random.Generator,
    penalties: Penalties | None,
    swaps: int,
) -> RouteSet:
    chrom = routes_to_chromosome(inst, base)
    tour = chrom.tour.copy()
    for _ in range(swaps):
        a, b = rng.integers(0, inst.n, size=2)
        tour[a], tour[b] = tour[b], tour[a]
    rs, _ = split(inst, Chromosome(tour=tour, vorder=chrom.vorder.copy()), penalties)
    return rs


def initial_routesets(
    inst: Instance,
    strategy: InitStrategy,
    count: int,
    rng: np.random.Generator,
    penalties: Penalties | None = None,
) -> list[RouteSet]:
    if count <= 0:
        return []
    if strategy == InitStrategy.NEAREST_NEIGHBOR:
        first = nearest_neighbor(inst)
        rest = [
            perturbed(inst, first, rng, penalties, swaps=max(1, inst.n // 10))
            for _ in range(count - 1)
        ]
        return [first, *rest]
    if strategy in (InitStrategy.KMEANS, InitStrategy.SWEEP):
        build = kmeans_assignment if strategy == InitStrategy.KMEANS else sweep_assignment
        light = max(1, inst.n // 20)
        seeds = [
            route_clusters(inst, build(inst, rng), rng, penalties, perturb=0 if i == 0 else light)
            for i in range(min(count, CLUSTER_SEEDS))
        ]
        rest = [
            perturbed(inst, seeds[i % len(seeds)], rng, penalties, swaps=max(1, inst.n // 10))
            for i in range(count - len(seeds))
        ]
        return [*seeds, *rest]
    return [random_routeset(inst, rng, penalties) for _ in range(count)]
