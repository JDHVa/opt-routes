from __future__ import annotations

from typing import Any

import numba
import numpy as np

from routeopt.algorithms.segments import (
    bound_context,
    candidate_bound,
    new_segment_table,
    refresh_route,
    set_piece,
    suffix_compatibility,
    weak_bound,
)
from routeopt.core.evaluate import additive_coefs, route_additive, route_args, route_eval
from routeopt.core.types import I64, Instance, Penalties, RouteSet

DEFAULT_GRANULAR_K = 20
IMPROVE_EPS = 1e-7
MAX_SEGMENT = 3
BUFFER_PAD = MAX_SEGMENT + 2
CACHE_SIZE = 8

_NEIGHBOR_CACHE: list[tuple[Instance, int, I64]] = []


def neighbor_lists(inst: Instance, k: int = DEFAULT_GRANULAR_K) -> I64:
    for cached_inst, cached_k, lists in _NEIGHBOR_CACHE:
        if cached_inst is inst and cached_k == k:
            return lists
    width = max(0, min(k, inst.n - 1))
    d = inst.dist[: inst.n, : inst.n].copy()
    np.fill_diagonal(d, np.inf)
    lists = np.ascontiguousarray(np.argsort(d, axis=1, kind="stable")[:, :width], dtype=np.int64)
    _NEIGHBOR_CACHE.append((inst, k, lists))
    if len(_NEIGHBOR_CACHE) > CACHE_SIZE:
        _NEIGHBOR_CACHE.pop(0)
    return lists


@numba.njit(cache=True, inline="always")
def route_cost(k: int, route: Any, ctx: Any) -> float:
    args, cap_kg, cap_m3, coef = ctx
    _, duration, _, kg, m3, late, overtime, cost = route_eval(k, route, *args)
    return route_additive(
        duration,
        cost,
        route.shape[0] > 0,
        max(0.0, kg - cap_kg[k]),
        max(0.0, m3 - cap_m3[k]),
        late,
        overtime,
        coef,
    )


@numba.njit(cache=True)
def commit(k: int, buf: Any, length: int, cost: float, st: Any, ctx: Any) -> None:
    R, Ln, C, rof, pos, stamp, F, _, _, bc = st
    m = R.shape[0]
    stamp[m + 1] += 1
    if (length == 0) != (Ln[k] == 0):
        stamp[m] = stamp[m + 1]
    stamp[k] = stamp[m + 1]
    for p in range(length):
        node = buf[p]
        R[k, p] = node
        rof[node] = k
        pos[node] = p
    Ln[k] = length
    C[k] = cost
    refresh_route(k, R, Ln, F, bc)


@numba.njit(cache=True)
def init_state(st: Any, ctx: Any) -> None:
    R, Ln, C, rof, pos, _, F, _, _, bc = st
    for k in range(R.shape[0]):
        for p in range(Ln[k]):
            rof[R[k, p]] = k
            pos[R[k, p]] = p
        C[k] = route_cost(k, R[k, : Ln[k]], ctx)
        refresh_route(k, R, Ln, F, bc)


@numba.njit(cache=True, inline="always")
def copy_range(dst: Any, at: int, src: Any, start: int, stop: int) -> int:
    for p in range(start, stop):
        dst[at] = src[p]
        at += 1
    return at


@numba.njit(cache=True, inline="always")
def copy_reversed(dst: Any, at: int, src: Any, start: int, stop: int) -> int:
    for p in range(stop - 1, start - 1, -1):
        dst[at] = src[p]
        at += 1
    return at


@numba.njit(cache=True, inline="always")
def put_segment(dst: Any, at: int, seg: Any, s: int, reverse: bool) -> int:
    if reverse:
        return copy_reversed(dst, at, seg, 0, s)
    return copy_range(dst, at, seg, 0, s)


@numba.njit(cache=True)
def insert_unassigned(stops: Any, st: Any, t1: Any, ctx: Any) -> None:
    R, Ln, C, _, _, _, _, _, _, _ = st
    for idx in range(stops.shape[0]):
        u = stops[idx]
        best_delta = np.inf
        best_k = -1
        best_q = 0
        for k in range(R.shape[0]):
            length = Ln[k]
            for q in range(length + 1):
                at = copy_range(t1, 0, R[k], 0, q)
                t1[at] = u
                at += 1
                at = copy_range(t1, at, R[k], q, length)
                delta = route_cost(k, t1[:at], ctx) - C[k]
                if delta < best_delta:
                    best_delta = delta
                    best_k = k
                    best_q = q
        length = Ln[best_k]
        at = copy_range(t1, 0, R[best_k], 0, best_q)
        t1[at] = u
        at += 1
        at = copy_range(t1, at, R[best_k], best_q, length)
        commit(best_k, t1, at, C[best_k] + best_delta, st, ctx)


@numba.njit(cache=True, inline="always")
def try_relocate(
    u: int, s: int, v: int, seg: Any, rem: Any, c_rem: float, st: Any, t1: Any, ctx: Any
) -> bool:
    R, Ln, C, rof, pos, _, F, _, mb, bc = st
    ru = rof[u]
    rv = rof[v]
    pv = pos[v]
    pu = pos[u]
    if ru == rv:
        if pv >= pu and pv < pu + s:
            return False
        base_len = Ln[ru] - s
        pvr = pv if pv < pu else pv - s
        target = rem
    else:
        base_len = Ln[rv]
        pvr = pv
        target = R[rv]
    for combo in range(2):
        q = pvr + 1 if combo == 0 else pvr
        reverse = combo == 1
        if ru == rv:
            if q >= pu:
                lo = pu
                hi = q + s
                set_piece(bc, 0, ru, 0, pu + s, q + s)
                set_piece(bc, 1, ru, combo, pu, pu + s)
            else:
                lo = q
                hi = pu + s
                set_piece(bc, 0, ru, combo, pu, pu + s)
                set_piece(bc, 1, ru, 0, q, pu)
            if weak_bound(ru, lo, 2, ru, hi, R, Ln, F, bc) - C[ru] >= -IMPROVE_EPS:
                continue
            if q >= pu:
                at = copy_range(mb, 0, R[ru], pu + s, q + s)
                at = put_segment(mb, at, seg, s, reverse)
            else:
                at = put_segment(mb, 0, seg, s, reverse)
                at = copy_range(mb, at, R[ru], q, pu)
            bound = candidate_bound(ru, lo, mb, at, ru, hi, R, Ln, F, bc)
            if bound - C[ru] >= -IMPROVE_EPS:
                continue
        else:
            put_segment(mb, 0, seg, s, reverse)
            bound = candidate_bound(rv, q, mb, s, rv, q, R, Ln, F, bc)
            if c_rem + bound - C[ru] - C[rv] >= -IMPROVE_EPS:
                continue
        at = copy_range(t1, 0, target, 0, q)
        at = put_segment(t1, at, seg, s, reverse)
        at = copy_range(t1, at, target, q, base_len)
        if ru == rv:
            new_cost = route_cost(ru, t1[:at], ctx)
            if new_cost - C[ru] < -IMPROVE_EPS:
                commit(ru, t1, at, new_cost, st, ctx)
                return True
        else:
            new_cost = route_cost(rv, t1[:at], ctx)
            if c_rem + new_cost - C[ru] - C[rv] < -IMPROVE_EPS:
                commit(rv, t1, at, new_cost, st, ctx)
                commit(ru, rem, Ln[ru] - s, c_rem, st, ctx)
                return True
    return False


@numba.njit(cache=True, inline="always")
def try_swap(u: int, v: int, st: Any, t1: Any, t2: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, F, _, mb, bc = st
    ru = rof[u]
    rv = rof[v]
    pu = pos[u]
    pv = pos[v]
    if ru == rv:
        length = Ln[ru]
        lo = min(pu, pv)
        hi = max(pu, pv)
        set_piece(bc, 0, ru, 0, hi, hi + 1)
        set_piece(bc, 1, ru, 0, lo + 1, hi)
        set_piece(bc, 2, ru, 0, lo, lo + 1)
        if weak_bound(ru, lo, 3, ru, hi + 1, R, Ln, F, bc) - C[ru] >= -IMPROVE_EPS:
            return False
        mb[0] = R[ru, hi]
        at = copy_range(mb, 1, R[ru], lo + 1, hi)
        mb[at] = R[ru, lo]
        bound = candidate_bound(ru, lo, mb, at + 1, ru, hi + 1, R, Ln, F, bc)
        if bound - C[ru] >= -IMPROVE_EPS:
            return False
        copy_range(t1, 0, R[ru], 0, length)
        t1[pu] = v
        t1[pv] = u
        new_cost = route_cost(ru, t1[:length], ctx)
        if new_cost - C[ru] < -IMPROVE_EPS:
            commit(ru, t1, length, new_cost, st, ctx)
            return True
        return False
    lu = Ln[ru]
    lv = Ln[rv]
    mb[0] = v
    bound_u = candidate_bound(ru, pu, mb, 1, ru, pu + 1, R, Ln, F, bc)
    mb[0] = u
    bound_v = candidate_bound(rv, pv, mb, 1, rv, pv + 1, R, Ln, F, bc)
    if bound_u + bound_v - C[ru] - C[rv] >= -IMPROVE_EPS:
        return False
    copy_range(t1, 0, R[ru], 0, lu)
    t1[pu] = v
    copy_range(t2, 0, R[rv], 0, lv)
    t2[pv] = u
    cost_u = route_cost(ru, t1[:lu], ctx)
    cost_v = route_cost(rv, t2[:lv], ctx)
    if cost_u + cost_v - C[ru] - C[rv] < -IMPROVE_EPS:
        commit(ru, t1, lu, cost_u, st, ctx)
        commit(rv, t2, lv, cost_v, st, ctx)
        return True
    return False


@numba.njit(cache=True, inline="always")
def try_two_opt_star(u: int, v: int, st: Any, t1: Any, t2: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, F, cmp, mb, bc = st
    ru = rof[u]
    rv = rof[v]
    if ru == rv:
        return False
    pu = pos[u]
    pv = pos[v]
    lu = Ln[ru]
    lv = Ln[rv]
    for variant in range(2):
        if variant == 0:
            if cmp[ru, rv]:
                bound_u = candidate_bound(ru, pu + 1, mb, 0, rv, pv, R, Ln, F, bc)
                bound_v = candidate_bound(rv, pv, mb, 0, ru, pu + 1, R, Ln, F, bc)
                if bound_u + bound_v - C[ru] - C[rv] >= -IMPROVE_EPS:
                    continue
        else:
            set_piece(bc, 0, rv, 1, 0, pv + 1)
            weak_u = weak_bound(ru, pu + 1, 1, ru, lu, R, Ln, F, bc)
            set_piece(bc, 0, ru, 1, pu + 1, lu)
            weak_v = weak_bound(rv, 0, 1, rv, pv + 1, R, Ln, F, bc)
            if weak_u + weak_v - C[ru] - C[rv] >= -IMPROVE_EPS:
                continue
            at = copy_reversed(mb, 0, R[rv], 0, pv + 1)
            bound_u = candidate_bound(ru, pu + 1, mb, at, ru, lu, R, Ln, F, bc)
            at = copy_reversed(mb, 0, R[ru], pu + 1, lu)
            bound_v = candidate_bound(rv, 0, mb, at, rv, pv + 1, R, Ln, F, bc)
            if bound_u + bound_v - C[ru] - C[rv] >= -IMPROVE_EPS:
                continue
        if variant == 0:
            a = copy_range(t1, 0, R[ru], 0, pu + 1)
            a = copy_range(t1, a, R[rv], pv, lv)
            b = copy_range(t2, 0, R[rv], 0, pv)
            b = copy_range(t2, b, R[ru], pu + 1, lu)
        else:
            a = copy_range(t1, 0, R[ru], 0, pu + 1)
            a = copy_reversed(t1, a, R[rv], 0, pv + 1)
            b = copy_reversed(t2, 0, R[ru], pu + 1, lu)
            b = copy_range(t2, b, R[rv], pv + 1, lv)
        cost_u = route_cost(ru, t1[:a], ctx)
        cost_v = route_cost(rv, t2[:b], ctx)
        if cost_u + cost_v - C[ru] - C[rv] < -IMPROVE_EPS:
            commit(ru, t1, a, cost_u, st, ctx)
            commit(rv, t2, b, cost_v, st, ctx)
            return True
    return False


@numba.njit(cache=True, inline="always")
def try_two_opt(u: int, v: int, st: Any, t1: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, F, _, mb, bc = st
    ru = rof[u]
    if ru != rof[v]:
        return False
    pu = pos[u]
    pv = pos[v]
    length = Ln[ru]
    if pu < pv:
        lo = pu + 1
        hi = pv
    else:
        lo = pv
        hi = pu - 1
    if hi <= lo:
        return False
    set_piece(bc, 0, ru, 1, lo, hi + 1)
    if weak_bound(ru, lo, 1, ru, hi + 1, R, Ln, F, bc) - C[ru] >= -IMPROVE_EPS:
        return False
    at = copy_reversed(mb, 0, R[ru], lo, hi + 1)
    bound = candidate_bound(ru, lo, mb, at, ru, hi + 1, R, Ln, F, bc)
    if bound - C[ru] >= -IMPROVE_EPS:
        return False
    at = copy_range(t1, 0, R[ru], 0, lo)
    at = copy_reversed(t1, at, R[ru], lo, hi + 1)
    at = copy_range(t1, at, R[ru], hi + 1, length)
    new_cost = route_cost(ru, t1[:at], ctx)
    if new_cost - C[ru] < -IMPROVE_EPS:
        commit(ru, t1, at, new_cost, st, ctx)
        return True
    return False


@numba.njit(cache=True)
def try_empty_vehicles(u: int, st: Any, rem: Any, t1: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, _, _, _, _ = st
    ru = rof[u]
    pu = pos[u]
    length = Ln[ru]
    if length == 1:
        return False
    at = copy_range(rem, 0, R[ru], 0, pu)
    at = copy_range(rem, at, R[ru], pu + 1, length)
    c_rem = route_cost(ru, rem[:at], ctx)
    t1[0] = u
    for k in range(R.shape[0]):
        if Ln[k] != 0:
            continue
        new_cost = route_cost(k, t1[:1], ctx)
        if c_rem + new_cost - C[ru] - C[k] < -IMPROVE_EPS:
            commit(k, t1, 1, new_cost, st, ctx)
            commit(ru, rem, at, c_rem, st, ctx)
            return True
    return False


@numba.njit(cache=True, inline="always")
def is_stale(u: int, neigh: Any, st: Any) -> bool:
    R, _, _, rof, _, stamp, _, _, _, _ = st
    m = R.shape[0]
    seen = stamp[m + 2 + u]
    if stamp[m] > seen or stamp[rof[u]] > seen:
        return True
    for j in range(neigh.shape[1]):
        if stamp[rof[neigh[u, j]]] > seen:
            return True
    return False


@numba.njit(cache=True)
def improve_stop(
    u: int, neigh: Any, st: Any, rem: Any, t1: Any, t2: Any, seg: Any, ctx: Any
) -> bool:
    R, Ln, _, rof, pos, _, _, _, _, _ = st
    ru = rof[u]
    pu = pos[u]
    length = Ln[ru]
    width = neigh.shape[1]
    for s in range(1, MAX_SEGMENT + 1):
        if pu + s > length:
            break
        for p in range(s):
            seg[p] = R[ru, pu + p]
        at = copy_range(rem, 0, R[ru], 0, pu)
        at = copy_range(rem, at, R[ru], pu + s, length)
        c_rem = route_cost(ru, rem[:at], ctx)
        for j in range(width):
            if try_relocate(u, s, neigh[u, j], seg, rem, c_rem, st, t1, ctx):
                return True
    for j in range(width):
        v = neigh[u, j]
        if try_swap(u, v, st, t1, t2, ctx):
            return True
        if try_two_opt_star(u, v, st, t1, t2, ctx):
            return True
        if try_two_opt(u, v, st, t1, ctx):
            return True
    return try_empty_vehicles(u, st, rem, t1, ctx)


@numba.njit(cache=True)
def improve_round(
    order: Any, neigh: Any, st: Any, rem: Any, t1: Any, t2: Any, seg: Any, ctx: Any
) -> bool:
    stamp = st[5]
    m = st[0].shape[0]
    improved = False
    for idx in range(order.shape[0]):
        u = order[idx]
        if not is_stale(u, neigh, st):
            continue
        if improve_stop(u, neigh, st, rem, t1, t2, seg, ctx):
            improved = True
        else:
            stamp[m + 2 + u] = stamp[m + 1]
    return improved


def improve(
    inst: Instance,
    rs: RouteSet,
    penalties: Penalties | None = None,
    rng: np.random.Generator | None = None,
    max_rounds: int = 50,
    granular_k: int = DEFAULT_GRANULAR_K,
) -> RouteSet:
    n, m = inst.n, inst.m
    if n == 0:
        return rs.copy()
    ctx = (route_args(inst), inst.cap_kg, inst.cap_m3, additive_coefs(inst, penalties))
    R = np.zeros((m, n), dtype=np.int64)
    Ln = np.zeros(m, dtype=np.int64)
    for k, route in enumerate(rs.routes):
        Ln[k] = len(route)
        R[k, : len(route)] = route
    C = np.zeros(m, dtype=np.float64)
    rof = np.full(n, -1, dtype=np.int64)
    pos = np.zeros(n, dtype=np.int64)
    stamp = np.zeros(m + 2 + n, dtype=np.int64)
    stamp[m + 2 :] = -1
    rem = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    t1 = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    t2 = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    mb = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    seg = np.zeros(MAX_SEGMENT, dtype=np.int64)
    st = (
        R,
        Ln,
        C,
        rof,
        pos,
        stamp,
        new_segment_table(inst),
        suffix_compatibility(inst),
        mb,
        bound_context(inst, penalties),
    )
    init_state(st, ctx)
    if rs.unassigned:
        insert_unassigned(np.asarray(rs.unassigned, dtype=np.int64), st, t1, ctx)
    neigh = neighbor_lists(inst, granular_k)
    for _ in range(max_rounds):
        order = rng.permutation(n).astype(np.int64) if rng is not None else np.arange(n)
        if not improve_round(order, neigh, st, rem, t1, t2, seg, ctx):
            break
    return RouteSet([R[k, : Ln[k]].tolist() for k in range(m)], [])
