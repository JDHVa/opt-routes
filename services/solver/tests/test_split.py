from __future__ import annotations

import itertools
import time
from typing import Any

import numpy as np
import pytest

from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import additive_cost, validate_routeset
from routeopt.core.split import random_chromosome, routes_to_chromosome, split
from routeopt.core.types import Chromosome, Instance, Penalties, RouteSet
from tests.factories import make_instance

CONFIGS: list[dict[str, Any]] = [
    {"mode": "depot", "time_windows": False},
    {"mode": "depot", "time_windows": True},
    {"mode": "multi_origin", "time_windows": False},
    {"mode": "multi_origin", "time_windows": True, "open_end": True},
]


def test_split_matches_additive_fitness() -> None:
    rng = np.random.default_rng(7)
    for case in range(200):
        config = CONFIGS[case % len(CONFIGS)]
        inst = make_instance(
            n=int(rng.integers(5, 40)),
            m=int(rng.integers(1, 7)),
            seed=case,
            tight_capacity=bool(case % 3 == 0),
            **config,
        )
        chrom = random_chromosome(inst, rng)
        rs, cost = split(inst, chrom)
        validate_routeset(inst, rs)
        assert cost == pytest.approx(additive_cost(inst, rs), abs=1e-6)


def _brute_force(inst: Instance, chrom: Chromosome) -> float:
    n, m = inst.n, inst.m
    best = float("inf")
    for cuts in itertools.combinations_with_replacement(range(n + 1), m - 1):
        bounds = [0, *cuts, n]
        routes: list[list[int]] = [[] for _ in range(m)]
        for j in range(m):
            routes[int(chrom.vorder[j])] = chrom.tour[bounds[j] : bounds[j + 1]].tolist()
        best = min(best, additive_cost(inst, RouteSet(routes)))
    return best


def test_split_is_optimal_for_small_instances() -> None:
    rng = np.random.default_rng(11)
    for case in range(60):
        config = CONFIGS[case % len(CONFIGS)]
        inst = make_instance(
            n=int(rng.integers(2, 8)),
            m=int(rng.integers(1, 4)),
            seed=100 + case,
            **config,
        )
        chrom = random_chromosome(inst, rng)
        _, cost = split(inst, chrom)
        assert cost == pytest.approx(_brute_force(inst, chrom), abs=1e-6)


def test_split_respects_vehicle_order() -> None:
    inst = make_instance(n=12, m=4, seed=3)
    rng = np.random.default_rng(0)
    chrom = random_chromosome(inst, rng)
    rs, _ = split(inst, chrom)
    rebuilt = np.concatenate([np.array(rs.routes[int(k)], dtype=np.int64) for k in chrom.vorder])
    assert np.array_equal(rebuilt, chrom.tour)


def test_routes_to_chromosome_never_worse() -> None:
    rng = np.random.default_rng(5)
    for case in range(100):
        inst = make_instance(
            n=int(rng.integers(6, 40)),
            m=int(rng.integers(2, 7)),
            seed=case,
            **CONFIGS[case % len(CONFIGS)],
        )
        if case % 2 == 0:
            rs = nearest_neighbor(inst)
        else:
            assignment = rng.integers(0, inst.m, size=inst.n)
            order = [int(i) for i in rng.permutation(inst.n)]
            rs = RouteSet([[i for i in order if assignment[i] == k] for k in range(inst.m)])
        chrom = routes_to_chromosome(inst, rs)
        _, cost = split(inst, chrom)
        assert cost <= additive_cost(inst, rs) + 1e-6


def test_routes_to_chromosome_layout() -> None:
    inst = make_instance(n=6, m=3)
    rs = RouteSet([[], [2, 0], [4]], [1, 3, 5])
    chrom = routes_to_chromosome(inst, rs)
    assert chrom.tour.tolist() == [2, 0, 4, 1, 3, 5]
    assert chrom.vorder.tolist() == [1, 2, 0]


def test_split_handles_infeasible_prune() -> None:
    inst = make_instance(n=30, m=2, tight_capacity=True)
    chrom = random_chromosome(inst, np.random.default_rng(2))
    rs, cost = split(inst, chrom, Penalties(capacity=10.0))
    validate_routeset(inst, rs)
    assert np.isfinite(cost)


def test_determinism() -> None:
    inst = make_instance(n=30, m=4, time_windows=True)
    chrom = random_chromosome(inst, np.random.default_rng(1))
    first = split(inst, chrom)
    second = split(inst, chrom)
    assert first[0].routes == second[0].routes
    assert first[1] == second[1]


@pytest.mark.slow
def test_split_speed() -> None:
    inst = make_instance(n=200, m=20, seed=1)
    chrom = random_chromosome(inst, np.random.default_rng(0))
    split(inst, chrom)
    runs = 100
    begin = time.perf_counter()
    for _ in range(runs):
        split(inst, chrom)
    per_call_ms = (time.perf_counter() - begin) / runs * 1000.0
    assert per_call_ms < 2.0
