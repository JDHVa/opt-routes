from __future__ import annotations

import numpy as np
import pytest

from routeopt.core.instance import build_instance, instance_locations
from routeopt.core.models import (
    ConstraintToggles,
    DistanceSource,
    ObjectiveWeights,
    Priority,
    ProvidedMatrix,
)
from tests.factories import make_instance, make_problem


def test_locations_depot_mode() -> None:
    problem = make_problem(n=5, m=3, mode="depot")
    locations = instance_locations(problem)
    assert len(locations) == 5 + 6
    assert all(loc == problem.depot for loc in locations[5:])
    assert locations[:5] == [s.location for s in problem.stops]


def test_locations_multi_origin() -> None:
    problem = make_problem(n=4, m=2, mode="multi_origin")
    locations = instance_locations(problem)
    assert locations[4] == problem.drivers[0].start
    assert locations[5] == problem.drivers[1].start
    assert locations[6] == problem.drivers[0].end
    assert locations[7] == problem.drivers[1].end


def test_open_end_zeroes_end_columns() -> None:
    inst = make_instance(n=6, m=2, mode="multi_origin", open_end=True)
    assert inst.open_end.all()
    for k in range(inst.m):
        assert np.all(inst.dist[:, inst.end_node(k)] == 0.0)
        assert np.all(inst.dur[:, inst.end_node(k)] == 0.0)


def test_closed_routes_keep_end_columns() -> None:
    inst = make_instance(n=6, m=2, mode="multi_origin")
    assert not inst.open_end.any()
    assert inst.dist[0, inst.end_node(0)] > 0.0


def test_weights_are_normalized() -> None:
    inst = make_instance(weights=ObjectiveWeights(time=2.0, cost=2.0, vehicles=0.0, makespan=4.0))
    assert inst.weights.tolist() == [0.25, 0.25, 0.0, 0.5]


def test_zero_weights_fall_back_to_time() -> None:
    inst = make_instance(weights=ObjectiveWeights(time=0.0, cost=0.0, vehicles=0.0, makespan=0.0))
    assert inst.weights.tolist() == [1.0, 0.0, 0.0, 0.0]


def test_obj_scale_has_minimum_one() -> None:
    inst = make_instance()
    assert inst.obj_scale.shape == (4,)
    assert np.all(inst.obj_scale >= 1.0)


def test_toggles_applied() -> None:
    toggles = ConstraintToggles(
        capacity_kg=False, capacity_m3=False, time_windows=False, max_shift=False, priorities=False
    )
    inst = make_instance(time_windows=True, constraints=toggles)
    assert np.all(np.isinf(inst.cap_kg))
    assert np.all(np.isinf(inst.cap_m3))
    assert np.all(np.isinf(inst.max_shift))
    assert not inst.tw_enabled
    assert np.all(inst.priority_w == 1.0)


def test_priority_factors_and_default_windows() -> None:
    inst = make_instance(n=30)
    problem = make_problem(n=30)
    factors = {Priority.LOW: 0.5, Priority.NORMAL: 1.0, Priority.HIGH: 3.0}
    assert inst.priority_w.tolist() == [factors[s.priority] for s in problem.stops]
    assert np.all(inst.tw_start == 0.0)
    assert np.all(np.isinf(inst.tw_end))


def test_cost_per_unit() -> None:
    inst = make_instance(n=5, m=3)
    assert inst.cost_per_km[0] == pytest.approx(24.5 / 10.0)
    assert inst.cost_per_km[1] == pytest.approx(26.0 / 6.0)
    assert inst.cost_per_km[2] == pytest.approx(18.0 / 100.0 * 3.0)
    assert np.allclose(inst.cost_per_min, 80.0 / 60.0)


def test_missing_matrices_raise() -> None:
    with pytest.raises(ValueError):
        build_instance(make_problem(n=5, m=2))


def test_wrong_shape_raises() -> None:
    with pytest.raises(ValueError):
        build_instance(make_problem(n=5, m=2), np.zeros((3, 3)), np.zeros((3, 3)))


def test_provided_matrix_maps_node_ids() -> None:
    base = make_problem(n=2, m=1, mode="multi_origin")
    ids = ["s1", "d0:end", "s0", "d0:start"]
    dist = [[10.0 * r + c for c in range(4)] for r in range(4)]
    problem = base.model_copy(
        update={
            "distance_source": DistanceSource.PROVIDED,
            "matrix": ProvidedMatrix(node_ids=ids, distance_km=dist, duration_min=dist),
        }
    )
    inst = build_instance(problem)
    order = [2, 0, 3, 1]
    expected = np.array(dist)[np.ix_(order, order)]
    assert np.array_equal(inst.dist, expected)


def test_provided_matrix_missing_id_raises() -> None:
    base = make_problem(n=2, m=1)
    problem = base.model_copy(
        update={
            "distance_source": DistanceSource.PROVIDED,
            "matrix": ProvidedMatrix(
                node_ids=["s0", "depot"],
                distance_km=[[0, 1], [1, 0]],
                duration_min=[[0, 1], [1, 0]],
            ),
        }
    )
    with pytest.raises(ValueError):
        build_instance(problem)
