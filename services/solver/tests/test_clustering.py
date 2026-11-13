from __future__ import annotations

from collections.abc import Callable
from typing import Literal

import numpy as np
import pytest

from routeopt.algorithms.base import InitStrategy
from routeopt.algorithms.clustering import (
    kmeans_assignment,
    project_km,
    route_clusters,
    sweep_assignment,
)
from routeopt.algorithms.init import initial_routesets
from routeopt.core.evaluate import evaluate, validate_routeset
from routeopt.core.types import Instance
from tests.factories import make_instance

Assigner = Callable[[Instance, np.random.Generator], list[list[int]]]
ASSIGNERS: dict[str, Assigner] = {"kmeans": kmeans_assignment, "sweep": sweep_assignment}
Mode = Literal["depot", "multi_origin"]


def flatten(groups: list[list[int]]) -> list[int]:
    return sorted(stop for group in groups for stop in group)


@pytest.mark.parametrize("name", ASSIGNERS)
@pytest.mark.parametrize("mode", ["depot", "multi_origin"])
def test_assignment_covers_every_stop_once(name: str, mode: Mode) -> None:
    for seed in range(4):
        inst = make_instance(n=40, m=5, seed=seed, mode=mode)
        groups = ASSIGNERS[name](inst, np.random.default_rng(seed))
        assert len(groups) == inst.m
        assert flatten(groups) == list(range(inst.n))


@pytest.mark.parametrize("name", ASSIGNERS)
@pytest.mark.parametrize("mode", ["depot", "multi_origin"])
def test_routes_are_valid_deterministic_and_within_capacity(name: str, mode: Mode) -> None:
    for seed in range(4):
        inst = make_instance(n=40, m=5, seed=seed, mode=mode)
        first = route_clusters(
            inst, ASSIGNERS[name](inst, np.random.default_rng(7)), np.random.default_rng(7)
        )
        again = route_clusters(
            inst, ASSIGNERS[name](inst, np.random.default_rng(7)), np.random.default_rng(7)
        )
        validate_routeset(inst, first)
        assert first.routes == again.routes
        evaluation = evaluate(inst, first)
        assert evaluation.overload_kg == 0.0
        assert evaluation.overload_m3 == 0.0
        assert evaluation.unassigned == 0


@pytest.mark.parametrize("name", ASSIGNERS)
def test_different_seeds_give_different_assignments(name: str) -> None:
    inst = make_instance(n=40, m=5, seed=1)
    runs = {tuple(map(tuple, ASSIGNERS[name](inst, np.random.default_rng(s)))) for s in range(6)}
    assert len(runs) > 1


@pytest.mark.parametrize("name", ASSIGNERS)
def test_tight_capacity_stays_feasible_when_possible(name: str) -> None:
    inst = make_instance(n=20, m=6, seed=3, tight_capacity=True)
    total = inst.demand_kg.sum()
    assert total < 0.5 * inst.cap_kg.sum()
    groups = ASSIGNERS[name](inst, np.random.default_rng(0))
    for k, group in enumerate(groups):
        assert inst.demand_kg[group].sum() <= inst.cap_kg[k] + 1e-9
        assert inst.demand_m3[group].sum() <= inst.cap_m3[k] + 1e-9


def test_multi_origin_kmeans_follows_nearest_start() -> None:
    hits = 0
    total = 0
    for seed in range(5):
        inst = make_instance(n=60, m=4, seed=seed, mode="multi_origin")
        inst.cap_kg *= 4.0
        inst.cap_m3 *= 4.0
        points = project_km(inst)
        starts = points[inst.n : inst.n + inst.m]
        groups = kmeans_assignment(inst, np.random.default_rng(seed))
        for k, group in enumerate(groups):
            if not group:
                continue
            centroid = points[group].mean(axis=0)
            nearest = int(np.argmin(np.linalg.norm(starts - centroid, axis=1)))
            hits += len(group) if nearest == k else 0
            total += len(group)
    assert total == 5 * 60
    assert hits / total >= 0.8


def test_no_capacity_limit_still_assigns_everything() -> None:
    inst = make_instance(n=25, m=4, seed=2)
    inst.cap_kg[:] = np.inf
    inst.cap_m3[:] = np.inf
    for assigner in ASSIGNERS.values():
        assert flatten(assigner(inst, np.random.default_rng(0))) == list(range(inst.n))


@pytest.mark.parametrize("strategy", [InitStrategy.KMEANS, InitStrategy.SWEEP])
@pytest.mark.parametrize("mode", ["depot", "multi_origin"])
def test_initial_routesets_are_valid_and_deterministic(strategy: InitStrategy, mode: Mode) -> None:
    inst = make_instance(n=35, m=4, seed=5, mode=mode, time_windows=True)
    first = initial_routesets(inst, strategy, 6, np.random.default_rng(11))
    again = initial_routesets(inst, strategy, 6, np.random.default_rng(11))
    assert len(first) == 6
    for rs, other in zip(first, again, strict=True):
        validate_routeset(inst, rs)
        assert rs.routes == other.routes
    assert len({tuple(map(tuple, rs.routes)) for rs in first}) > 1
