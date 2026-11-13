from __future__ import annotations

import pytest

from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate, validate_routeset
from routeopt.core.models import ProblemMode
from tests.factories import BENCHMARK_DIR, benchmark_instance, benchmark_reference_routes

BEST_KNOWN = {
    "A-n32-k5": 784.0,
    "A-n45-k7": 1146.0,
    "P-n50-k7": 554.0,
    "A-n80-k10": 1763.0,
    "X-n101-k25": 27591.0,
    "C101": 827.3,
    "R101": 1637.7,
    "RC101": 1619.8,
}


@pytest.mark.parametrize("name", list(BEST_KNOWN))
def test_best_known_and_nearest_neighbor(name: str) -> None:
    inst, bks = benchmark_instance(name)
    assert bks == BEST_KNOWN[name]
    rs = nearest_neighbor(inst)
    validate_routeset(inst, rs)


@pytest.mark.parametrize("name", ["A-n32-k5", "A-n45-k7", "P-n50-k7", "A-n80-k10", "X-n101-k25"])
def test_cvrp_reference_solution_matches_bks(name: str) -> None:
    inst, bks = benchmark_instance(name)
    ev = evaluate(inst, benchmark_reference_routes(name, inst))
    assert ev.total_distance_km == bks
    assert ev.total_cost_mxn == bks
    assert ev.feasible
    assert ev.unassigned == 0


def test_cvrp_vehicle_count_and_mode() -> None:
    inst, _ = benchmark_instance("A-n32-k5")
    assert inst.m == 6
    assert inst.n == 31
    assert not inst.tw_enabled
    assert (BENCHMARK_DIR / "A-n32-k5.vrp").exists()
    from routeopt.data.loaders.cvrplib import load_cvrplib

    assert load_cvrplib(BENCHMARK_DIR / "A-n32-k5.vrp").mode == ProblemMode.DEPOT


@pytest.mark.parametrize("name", ["C101", "R101", "RC101"])
def test_solomon_reference_solution(name: str) -> None:
    inst, bks = benchmark_instance(name)
    ev = evaluate(inst, benchmark_reference_routes(name, inst))
    assert ev.total_distance_km == pytest.approx(bks, abs=0.1)
    assert ev.lateness_min == 0.0
    assert ev.feasible
    assert inst.m == 25
    assert inst.tw_enabled
