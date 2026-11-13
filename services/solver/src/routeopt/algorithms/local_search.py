from __future__ import annotations

from typing import Any

import numba
import numpy as np

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


@numba.njit(cache=True)
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
def has_violation(k: int, route: Any, ctx: Any) -> bool:
    args, cap_kg, cap_m3, _ = ctx
    _, _, _, kg, m3, late, overtime, _ = route_eval(k, route, *args)
    return kg > cap_kg[k] or m3 > cap_m3[k] or late > 0.0 or overtime > 0.0


@numba.njit(cache=True)
def commit(k: int, buf: Any, length: int, cost: float, st: Any, ctx: Any) -> None:
    R, Ln, C, rof, pos, stamp, viol = st
    viol[k] = has_violation(k, buf[:length], ctx)
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


@numba.njit(cache=True)
def init_state(st: Any, ctx: Any) -> None:
    R, Ln, C, rof, pos, _, viol = st
    for k in range(R.shape[0]):
        for p in range(Ln[k]):
            rof[R[k, p]] = k
            pos[R[k, p]] = p
        C[k] = route_cost(k, R[k, : Ln[k]], ctx)
        viol[k] = has_violation(k, R[k, : Ln[k]], ctx)


@numba.njit(cache=True)
def copy_range(dst: Any, at: int, src: Any, start: int, stop: int) -> int:
    for p in range(start, stop):
        dst[at] = src[p]
        at += 1
    return at


@numba.njit(cache=True)
def copy_reversed(dst: Any, at: int, src: Any, start: int, stop: int) -> int:
    for p in range(stop - 1, start - 1, -1):
        dst[at] = src[p]
        at += 1
    return at


@numba.njit(cache=True)
def arc(k: int, x: int, y: int, ctx: Any) -> float:
    args, _, _, coef = ctx
    t = args[3][x, y] * args[12][k]
    return coef[0] * t + coef[1] * (args[2][x, y] * args[13][k] + t * args[14][k])


@numba.njit(cache=True)
def node_weight(k: int, i: int, ctx: Any) -> float:
    args, _, _, coef = ctx
    return (coef[0] + coef[1] * args[14][k]) * args[4][i]


@numba.njit(cache=True)
def pred_node(k: int, p: int, R: Any, n: int) -> int:
    return R[k, p - 1] if p > 0 else n + k


@numba.njit(cache=True)
def succ_node(k: int, p: int, R: Any, Ln: Any, n: int, m: int) -> int:
    return R[k, p + 1] if p + 1 < Ln[k] else n + m + k


@numba.njit(cache=True)
def segment_arcs(k: int, seg: Any, s: int, reverse: bool, ctx: Any) -> float:
    total = 0.0
    for i in range(s - 1):
        if reverse:
            total += arc(k, seg[i + 1], seg[i], ctx)
        else:
            total += arc(k, seg[i], seg[i + 1], ctx)
    for i in range(s):
        total += node_weight(k, seg[i], ctx)
    return total


@numba.njit(cache=True)
def removal_delta(
    ru: int, pu: int, s: int, seg: Any, R: Any, Ln: Any, n: int, m: int, ctx: Any
) -> float:
    a = pred_node(ru, pu, R, n)
    b = succ_node(ru, pu + s - 1, R, Ln, n, m)
    return (
        arc(ru, a, b, ctx)
        - arc(ru, a, seg[0], ctx)
        - arc(ru, seg[s - 1], b, ctx)
        - segment_arcs(ru, seg, s, False, ctx)
    )


@numba.njit(cache=True)
def insert_unassigned(stops: Any, st: Any, t1: Any, ctx: Any) -> None:
    R, Ln, C, _, _, _, _ = st
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


@numba.njit(cache=True)
def try_relocate(
    u: int,
    s: int,
    v: int,
    seg: Any,
    rem: Any,
    c_rem: float,
    d_rem: float,
    st: Any,
    t1: Any,
    ctx: Any,
) -> bool:
    R, Ln, C, rof, pos, _, viol = st
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
    n = rof.shape[0]
    m = R.shape[0]
    screen = ru != rv and d_rem != np.inf and not viol[rv]
    for combo in range(2):
        if screen:
            if combo == 0:
                p = v
                q_node = succ_node(rv, pv, R, Ln, n, m)
                first = seg[0]
                last = seg[s - 1]
            else:
                p = pred_node(rv, pv, R, n)
                q_node = v
                first = seg[s - 1]
                last = seg[0]
            added = (
                arc(rv, p, first, ctx)
                + arc(rv, last, q_node, ctx)
                - arc(rv, p, q_node, ctx)
                + segment_arcs(rv, seg, s, combo == 1, ctx)
            )
            if d_rem + added >= -IMPROVE_EPS:
                continue
        q = pvr + 1 if combo == 0 else pvr
        at = copy_range(t1, 0, target, 0, q)
        if combo == 0:
            at = copy_range(t1, at, seg, 0, s)
        else:
            at = copy_reversed(t1, at, seg, 0, s)
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


@numba.njit(cache=True)
def try_swap(u: int, v: int, screening: bool, st: Any, t1: Any, t2: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, viol = st
    ru = rof[u]
    rv = rof[v]
    pu = pos[u]
    pv = pos[v]
    if ru == rv:
        length = Ln[ru]
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
    if screening and not viol[ru] and not viol[rv]:
        n = rof.shape[0]
        m = R.shape[0]
        pa = pred_node(ru, pu, R, n)
        na = succ_node(ru, pu, R, Ln, n, m)
        pb = pred_node(rv, pv, R, n)
        nb = succ_node(rv, pv, R, Ln, n, m)
        delta = (
            arc(ru, pa, v, ctx)
            + arc(ru, v, na, ctx)
            - arc(ru, pa, u, ctx)
            - arc(ru, u, na, ctx)
            + node_weight(ru, v, ctx)
            - node_weight(ru, u, ctx)
            + arc(rv, pb, u, ctx)
            + arc(rv, u, nb, ctx)
            - arc(rv, pb, v, ctx)
            - arc(rv, v, nb, ctx)
            + node_weight(rv, u, ctx)
            - node_weight(rv, v, ctx)
        )
        if delta >= -IMPROVE_EPS:
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


@numba.njit(cache=True)
def try_two_opt_star(u: int, v: int, screening: bool, st: Any, t1: Any, t2: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, viol = st
    ru = rof[u]
    rv = rof[v]
    if ru == rv:
        return False
    pu = pos[u]
    pv = pos[v]
    lu = Ln[ru]
    lv = Ln[rv]
    screen = screening and not viol[ru] and not viol[rv]
    n = rof.shape[0]
    m = R.shape[0]
    su = succ_node(ru, pu, R, Ln, n, m)
    sv = succ_node(rv, pv, R, Ln, n, m)
    pb = pred_node(rv, pv, R, n)
    for variant in range(2):
        if screen:
            if variant == 0:
                delta = (
                    arc(ru, u, v, ctx)
                    + arc(ru, pb, su, ctx)
                    - arc(ru, u, su, ctx)
                    - arc(ru, pb, v, ctx)
                )
            else:
                delta = (
                    arc(ru, u, v, ctx)
                    + arc(ru, su, sv, ctx)
                    - arc(ru, u, su, ctx)
                    - arc(ru, v, sv, ctx)
                )
            if delta >= -IMPROVE_EPS:
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


@numba.njit(cache=True)
def try_two_opt(u: int, v: int, screening: bool, st: Any, t1: Any, ctx: Any) -> bool:
    R, Ln, C, rof, pos, _, viol = st
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
    if screening and not viol[ru]:
        n = rof.shape[0]
        m = R.shape[0]
        before = pred_node(ru, lo, R, n)
        after = succ_node(ru, hi, R, Ln, n, m)
        first = R[ru, lo]
        last = R[ru, hi]
        delta = (
            arc(ru, before, last, ctx)
            + arc(ru, first, after, ctx)
            - arc(ru, before, first, ctx)
            - arc(ru, last, after, ctx)
        )
        if delta >= -IMPROVE_EPS:
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
    R, Ln, C, rof, pos, _, _ = st
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


@numba.njit(cache=True)
def is_stale(u: int, neigh: Any, st: Any) -> bool:
    R, _, _, rof, _, stamp, _ = st
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
    u: int, neigh: Any, screening: bool, st: Any, rem: Any, t1: Any, t2: Any, seg: Any, ctx: Any
) -> bool:
    R, Ln, _, rof, pos, _, viol = st
    ru = rof[u]
    pu = pos[u]
    length = Ln[ru]
    width = neigh.shape[1]
    n = rof.shape[0]
    m = R.shape[0]
    for s in range(1, MAX_SEGMENT + 1):
        if pu + s > length:
            break
        for p in range(s):
            seg[p] = R[ru, pu + p]
        at = copy_range(rem, 0, R[ru], 0, pu)
        at = copy_range(rem, at, R[ru], pu + s, length)
        c_rem = route_cost(ru, rem[:at], ctx)
        d_rem = np.inf
        if screening and not viol[ru] and length > s:
            d_rem = removal_delta(ru, pu, s, seg, R, Ln, n, m, ctx)
        for j in range(width):
            if try_relocate(u, s, neigh[u, j], seg, rem, c_rem, d_rem, st, t1, ctx):
                return True
    for j in range(width):
        v = neigh[u, j]
        if try_swap(u, v, screening, st, t1, t2, ctx):
            return True
        if try_two_opt_star(u, v, screening, st, t1, t2, ctx):
            return True
        if try_two_opt(u, v, screening, st, t1, ctx):
            return True
    return try_empty_vehicles(u, st, rem, t1, ctx)


@numba.njit(cache=True)
def improve_round(
    order: Any, neigh: Any, screening: bool, st: Any, rem: Any, t1: Any, t2: Any, seg: Any, ctx: Any
) -> bool:
    _, _, _, _, _, stamp, _ = st
    m = st[0].shape[0]
    improved = False
    for idx in range(order.shape[0]):
        u = order[idx]
        if not is_stale(u, neigh, st):
            continue
        if improve_stop(u, neigh, screening, st, rem, t1, t2, seg, ctx):
            improved = True
        else:
            stamp[m + 2 + u] = stamp[m + 1]
    return improved


def windows_bind(inst: Instance) -> bool:
    if not inst.tw_enabled:
        return False
    return bool(np.any(inst.tw_start > inst.shift_start.min()) or np.any(np.isfinite(inst.tw_end)))


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
    viol = np.zeros(m, dtype=np.bool_)
    st = (R, Ln, C, rof, pos, stamp, viol)
    init_state(st, ctx)
    rem = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    t1 = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    t2 = np.zeros(n + BUFFER_PAD, dtype=np.int64)
    seg = np.zeros(MAX_SEGMENT, dtype=np.int64)
    if rs.unassigned:
        insert_unassigned(np.asarray(rs.unassigned, dtype=np.int64), st, t1, ctx)
    neigh = neighbor_lists(inst, granular_k)
    screening = not windows_bind(inst)
    for _ in range(max_rounds):
        order = rng.permutation(n).astype(np.int64) if rng is not None else np.arange(n)
        if not improve_round(order, neigh, screening, st, rem, t1, t2, seg, ctx):
            break
    return RouteSet([R[k, : Ln[k]].tolist() for k in range(m)], [])
