from __future__ import annotations

import time
from typing import Any

import numpy as np

from routeopt.algorithms.init import random_routeset
from routeopt.algorithms.local_search import improve, neighbor_lists
from routeopt.core.evaluate import additive_cost, evaluate, validate_routeset
from routeopt.core.models import ObjectiveWeights
from routeopt.core.types import Penalties, RouteSet
from tests.factories import make_instance

CONFIGS: list[dict[str, Any]] = [
    {"mode": "depot", "time_windows": False},
    {"mode": "depot", "time_windows": True},
    {"mode": "multi_origin", "time_windows": False},
    {"mode": "multi_origin", "time_windows": True, "open_end": True},
    {"mode": "multi_origin", "time_windows": False, "open_end": True, "tight_capacity": True},
]


def shuffled_routeset(n: int, m: int, rng: np.random.Generator) -> RouteSet:
    routes: list[list[int]] = [[] for _ in range(m)]
    for stop in rng.permutation(n):
        routes[int(rng.integers(0, m))].append(int(stop))
    return RouteSet(routes, [])


def test_invariant_on_random_routesets() -> None:
    rng = np.random.default_rng(11)
    for case in range(100):
        config = CONFIGS[case % len(CONFIGS)]
        inst = make_instance(
            n=int(rng.integers(5, 45)), m=int(rng.integers(1, 8)), seed=case, **config
        )
        rs = (
            random_routeset(inst, rng, None) if case % 2 else shuffled_routeset(inst.n, inst.m, rng)
        )
        penalties = Penalties(capacity=float(rng.uniform(1, 500)))
        before = additive_cost(inst, rs, penalties)
        out = improve(inst, rs, penalties, np.random.default_rng(case))
        validate_routeset(inst, out)
        assert out.unassigned == []
        assert additive_cost(inst, out, penalties) <= before + 1e-9


def test_does_not_mutate_input() -> None:
    inst = make_instance(n=30, m=4, seed=3)
    rs = shuffled_routeset(inst.n, inst.m, np.random.default_rng(0))
    snapshot = rs.copy()
    improve(inst, rs)
    assert rs.routes == snapshot.routes


def test_reduces_cost_on_random_solution() -> None:
    inst = make_instance(n=50, m=5, seed=2)
    rs = shuffled_routeset(inst.n, inst.m, np.random.default_rng(1))
    before = additive_cost(inst, rs)
    after = additive_cost(inst, improve(inst, rs, rng=np.random.default_rng(0)))
    assert after <= 0.7 * before


def test_inserts_unassigned() -> None:
    inst = make_instance(n=40, m=4, seed=5)
    full = random_routeset(inst, np.random.default_rng(0), None)
    dropped = [full.routes[0][0], full.routes[1][0], full.routes[2][-1]]
    routes = [[s for s in r if s not in dropped] for r in full.routes]
    rs = RouteSet(routes, list(dropped))
    out = improve(inst, rs, rng=np.random.default_rng(0))
    validate_routeset(inst, out)
    assert out.unassigned == []
    assert sorted(s for r in out.routes for s in r) == list(range(inst.n))
    assert evaluate(inst, out).fitness < evaluate(inst, rs).fitness


def test_uses_empty_vehicle_when_worthwhile() -> None:
    inst = make_instance(
        n=30,
        m=5,
        seed=9,
        tight_capacity=True,
        weights=ObjectiveWeights(time=1.0, cost=1.0, vehicles=0.0),
    )
    rs = RouteSet([list(range(inst.n))] + [[] for _ in range(inst.m - 1)], [])
    out = improve(inst, rs, rng=np.random.default_rng(0))
    validate_routeset(inst, out)
    assert sum(1 for r in out.routes if r) > 1
    assert evaluate(inst, out).fitness < evaluate(inst, rs).fitness


def test_neighbor_lists_shape_and_order() -> None:
    inst = make_instance(n=25, m=3, seed=1)
    lists = neighbor_lists(inst, 7)
    assert lists.shape == (25, 7)
    for i in range(inst.n):
        assert i not in lists[i]
        d = inst.dist[i, lists[i]]
        assert np.all(np.diff(d) >= -1e-12)
    assert neighbor_lists(inst, 7) is lists


def test_runtime_n200_m20() -> None:
    inst = make_instance(
        n=200, m=20, seed=1, weights=ObjectiveWeights(time=1.0, cost=1.0, vehicles=0.0)
    )
    rs = random_routeset(inst, np.random.default_rng(0), None)
    improve(inst, rs, rng=np.random.default_rng(0))
    elapsed = []
    for seed in range(3):
        t0 = time.perf_counter()
        improve(inst, rs, rng=np.random.default_rng(seed))
        elapsed.append(time.perf_counter() - t0)
    print(f"LS n=200 m=20: {min(elapsed) * 1000:.1f} ms")
    assert min(elapsed) < 0.15
