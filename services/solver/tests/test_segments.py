from __future__ import annotations

from typing import Any

import numpy as np

from routeopt.algorithms.local_search import route_cost
from routeopt.algorithms.segments import (
    bound_context,
    candidate_bound,
    new_segment_table,
    refresh_route,
    set_piece,
    suffix_compatibility,
    weak_bound,
)
from routeopt.core.evaluate import additive_coefs, route_args
from routeopt.core.types import Instance, Penalties
from tests.factories import make_instance
from tests.test_local_search import CONFIGS, shuffled_routeset

TOL = 1e-8


def prepare(inst: Instance, penalties: Penalties, rng: np.random.Generator) -> tuple[Any, ...]:
    rs = shuffled_routeset(inst.n, inst.m, rng)
    R = np.zeros((inst.m, inst.n), dtype=np.int64)
    Ln = np.zeros(inst.m, dtype=np.int64)
    for k, route in enumerate(rs.routes):
        Ln[k] = len(route)
        R[k, : len(route)] = route
    F = new_segment_table(inst)
    bc = bound_context(inst, penalties)
    for k in range(inst.m):
        refresh_route(k, R, Ln, F, bc)
    ctx = (route_args(inst), inst.cap_kg, inst.cap_m3, additive_coefs(inst, penalties))
    return R, Ln, F, bc, ctx


def test_candidate_bound_is_lower_bound_and_exact_without_lateness() -> None:
    rng = np.random.default_rng(5)
    checked = 0
    for case in range(40):
        config = CONFIGS[case % len(CONFIGS)]
        inst = make_instance(
            n=int(rng.integers(8, 40)), m=int(rng.integers(2, 6)), seed=case, **config
        )
        penalties = Penalties(capacity=float(rng.uniform(1, 300)))
        R, Ln, F, bc, ctx = prepare(inst, penalties, rng)
        compat = suffix_compatibility(inst)
        mb = np.zeros(inst.n + 8, dtype=np.int64)
        for _ in range(200):
            kv = int(rng.integers(0, inst.m))
            w = int(rng.integers(0, inst.m))
            if not compat[kv, w]:
                w = kv
            i = int(rng.integers(0, Ln[kv] + 1))
            j = int(rng.integers(0, Ln[w] + 1))
            mlen = int(rng.integers(0, 4))
            mb[:mlen] = rng.integers(0, inst.n, size=mlen)
            new_route = np.concatenate((R[kv, :i], mb[:mlen], R[w, j : Ln[w]])).astype(np.int64)
            bound = candidate_bound(kv, i, mb, mlen, w, j, R, Ln, F, bc)
            real = route_cost(kv, new_route, ctx)
            assert bound <= real + TOL
            if not inst.tw_enabled:
                assert abs(bound - real) < TOL
            checked += 1
    assert checked == 40 * 200


def test_weak_bound_is_lower_bound() -> None:
    rng = np.random.default_rng(8)
    for case in range(40):
        config = CONFIGS[case % len(CONFIGS)]
        inst = make_instance(
            n=int(rng.integers(8, 40)), m=int(rng.integers(2, 6)), seed=100 + case, **config
        )
        penalties = Penalties(capacity=float(rng.uniform(1, 300)))
        R, Ln, F, bc, ctx = prepare(inst, penalties, rng)
        for _ in range(200):
            kv = int(rng.integers(0, inst.m))
            lo = int(rng.integers(0, Ln[kv] + 1))
            hi = int(rng.integers(lo, Ln[kv] + 1))
            mid_src = int(rng.integers(0, inst.m))
            x = int(rng.integers(0, Ln[mid_src] + 1))
            y = int(rng.integers(x, Ln[mid_src] + 1))
            kind = int(rng.integers(0, 2))
            set_piece(bc, 0, mid_src, kind, x, y)
            piece = R[mid_src, x:y]
            piece = piece[::-1] if kind else piece
            new_route = np.concatenate((R[kv, :lo], piece, R[kv, hi : Ln[kv]])).astype(np.int64)
            bound = weak_bound(kv, lo, 1, kv, hi, R, Ln, F, bc)
            assert bound <= route_cost(kv, new_route, ctx) + TOL
