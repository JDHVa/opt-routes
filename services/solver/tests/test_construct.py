from __future__ import annotations

from typing import Literal

import pytest

from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate, validate_routeset
from tests.factories import make_instance


@pytest.mark.parametrize("mode", ["depot", "multi_origin"])
@pytest.mark.parametrize("time_windows", [False, True])
def test_nearest_neighbor_is_complete(
    mode: Literal["depot", "multi_origin"], time_windows: bool
) -> None:
    for seed in range(5):
        inst = make_instance(
            n=40,
            m=5,
            seed=seed,
            mode=mode,
            time_windows=time_windows,
        )
        rs = nearest_neighbor(inst)
        validate_routeset(inst, rs)
        assert rs.unassigned == []


def test_nearest_neighbor_is_deterministic() -> None:
    inst = make_instance(n=30, m=4, seed=2)
    assert nearest_neighbor(inst).routes == nearest_neighbor(inst).routes


def test_nearest_neighbor_feasible_with_ample_capacity() -> None:
    inst = make_instance(n=30, m=6, seed=4)
    assert evaluate(inst, nearest_neighbor(inst)).feasible


def test_nearest_neighbor_overflow_goes_to_existing_routes() -> None:
    inst = make_instance(n=60, m=2, seed=1, tight_capacity=True)
    rs = nearest_neighbor(inst)
    validate_routeset(inst, rs)
    assert evaluate(inst, rs).unassigned == 0
