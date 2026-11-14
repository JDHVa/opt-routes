from __future__ import annotations

from typing import Any

import numba
import numpy as np

from routeopt.core.evaluate import additive_coefs, route_additive
from routeopt.core.types import F64, Instance, Penalties

PDEP = 0
PDIST = 1
PLATE = 2
PKG = 3
PM3 = 4
PT = 5
PS = 6
SA = 7
SB = 8
SARR = 9
SLATE = 10
SSLR = 11
SSLL = 12
SDIST = 13
SKG = 14
SM3 = 15
RD = 16
RT = 17
NFIELDS = 18
MAX_PIECES = 4

V_SPEED = 0
V_SHIFT = 1
V_MAX_SHIFT = 2
V_COST_KM = 3
V_COST_MIN = 4
V_FIXED = 5
V_CAP_KG = 6
V_CAP_M3 = 7
V_OPEN = 8
V_SIZE = 9

N_SERVICE = 0
N_WS = 1
N_WE = 2
N_PRIO = 3
N_KG = 4
N_M3 = 5
N_SIZE = 6


def new_segment_table(inst: Instance) -> F64:
    return np.zeros((inst.m, inst.n + 2, NFIELDS), dtype=np.float64)


def suffix_compatibility(inst: Instance) -> Any:
    n, m = inst.n, inst.m
    compat = np.zeros((m, m), dtype=np.bool_)
    for a in range(m):
        for b in range(m):
            compat[a, b] = bool(
                inst.speed_factor[a] == inst.speed_factor[b]
                and inst.open_end[a] == inst.open_end[b]
                and np.array_equal(inst.dur[:n, n + m + a], inst.dur[:n, n + m + b])
                and np.array_equal(inst.dist[:n, n + m + a], inst.dist[:n, n + m + b])
            )
    return compat


def bound_context(inst: Instance, penalties: Penalties | None) -> tuple[Any, ...]:
    vehicles = np.zeros((inst.m, V_SIZE), dtype=np.float64)
    vehicles[:, V_SPEED] = inst.speed_factor
    vehicles[:, V_SHIFT] = inst.shift_start
    vehicles[:, V_MAX_SHIFT] = inst.max_shift
    vehicles[:, V_COST_KM] = inst.cost_per_km
    vehicles[:, V_COST_MIN] = inst.cost_per_min
    vehicles[:, V_FIXED] = inst.fixed_cost
    vehicles[:, V_CAP_KG] = inst.cap_kg
    vehicles[:, V_CAP_M3] = inst.cap_m3
    vehicles[:, V_OPEN] = inst.open_end.astype(np.float64)
    nodes = np.zeros((inst.n, N_SIZE), dtype=np.float64)
    nodes[:, N_SERVICE] = inst.service
    nodes[:, N_WS] = inst.tw_start if inst.tw_enabled else -np.inf
    nodes[:, N_WE] = inst.tw_end if inst.tw_enabled else np.inf
    nodes[:, N_PRIO] = inst.priority_w
    nodes[:, N_KG] = inst.demand_kg
    nodes[:, N_M3] = inst.demand_m3
    return (
        np.ascontiguousarray(inst.dist),
        np.ascontiguousarray(inst.dur),
        vehicles,
        nodes,
        additive_coefs(inst, penalties),
        np.zeros((MAX_PIECES, 4), dtype=np.int64),
    )


@numba.njit(cache=True)
def refresh_route(k: int, R: Any, Ln: Any, F: Any, bc: Any) -> None:
    dist, dur, V, Nd, _, _ = bc
    n = Nd.shape[0]
    m = V.shape[0]
    sf = V[k, V_SPEED]
    open_end = V[k, V_OPEN] > 0.5
    length = Ln[k]
    t = V[k, V_SHIFT]
    prev = n + k
    distance = 0.0
    late = 0.0
    kg = 0.0
    m3 = 0.0
    F[k, 0, PDEP] = t
    F[k, 0, PDIST] = 0.0
    F[k, 0, PLATE] = 0.0
    F[k, 0, PKG] = 0.0
    F[k, 0, PM3] = 0.0
    F[k, 0, PT] = 0.0
    F[k, 0, PS] = 0.0
    travel = 0.0
    served = 0.0
    for p in range(length):
        i = R[k, p]
        t += dur[prev, i] * sf
        distance += dist[prev, i]
        F[k, p, SARR] = t
        t = max(t, Nd[i, N_WS])
        excess = t - Nd[i, N_WE]
        if excess > 0.0:
            late += excess * Nd[i, N_PRIO]
        t += Nd[i, N_SERVICE]
        kg += Nd[i, N_KG]
        m3 += Nd[i, N_M3]
        travel += dur[prev, i]
        served += Nd[i, N_SERVICE]
        prev = i
        F[k, p + 1, PT] = travel
        F[k, p + 1, PS] = served
        F[k, p + 1, PDEP] = t
        F[k, p + 1, PDIST] = distance
        F[k, p + 1, PLATE] = late
        F[k, p + 1, PKG] = kg
        F[k, p + 1, PM3] = m3
    F[k, 0, RD] = 0.0
    F[k, 0, RT] = 0.0
    for p in range(1, length):
        F[k, p, RD] = F[k, p - 1, RD] + dist[R[k, p], R[k, p - 1]]
        F[k, p, RT] = F[k, p - 1, RT] + dur[R[k, p], R[k, p - 1]]
    last = n + m + k
    suffix_a = 0.0
    suffix_b = -np.inf
    suffix_late = 0.0
    slope_r = 0.0
    slope_l = 0.0
    suffix_dist = 0.0
    suffix_kg = 0.0
    suffix_m3 = 0.0
    for p in range(length - 1, -1, -1):
        i = R[k, p]
        leg_dur = 0.0
        leg_dist = 0.0
        if p < length - 1:
            nxt = R[k, p + 1]
            leg_dur = dur[i, nxt] * sf
            leg_dist = dist[i, nxt]
        elif not open_end:
            leg_dur = dur[i, last] * sf
            leg_dist = dist[i, last]
        arrival = F[k, p, SARR]
        ws = Nd[i, N_WS]
        excess = max(arrival, ws) - Nd[i, N_WE]
        ur = 1.0 if arrival >= ws else 0.0
        ul = 1.0 if arrival > ws else 0.0
        lat_r = Nd[i, N_PRIO] * ur if excess >= 0.0 else 0.0
        lat_l = Nd[i, N_PRIO] * ul if excess > 0.0 else 0.0
        slope_r = lat_r + ur * slope_r
        slope_l = lat_l + ul * slope_l
        if excess > 0.0:
            suffix_late += excess * Nd[i, N_PRIO]
        suffix_a = Nd[i, N_SERVICE] + leg_dur + suffix_a
        suffix_b = max(ws + suffix_a, suffix_b)
        suffix_dist += leg_dist
        suffix_kg += Nd[i, N_KG]
        suffix_m3 += Nd[i, N_M3]
        F[k, p, SA] = suffix_a
        F[k, p, SB] = suffix_b
        F[k, p, SLATE] = suffix_late
        F[k, p, SSLR] = slope_r
        F[k, p, SSLL] = slope_l
        F[k, p, SDIST] = suffix_dist
        F[k, p, SKG] = suffix_kg
        F[k, p, SM3] = suffix_m3


@numba.njit(cache=True, inline="always")
def candidate_bound(
    kv: int, i: int, mid: Any, mlen: int, w: int, j: int, R: Any, Ln: Any, F: Any, bc: Any
) -> float:
    dist, dur, V, Nd, coef, _ = bc
    n = Nd.shape[0]
    sf = V[kv, V_SPEED]
    suffix_len = Ln[w] - j
    if i + mlen + suffix_len == 0:
        return 0.0
    t = F[kv, i, PDEP]
    distance = F[kv, i, PDIST]
    late = F[kv, i, PLATE]
    kg = F[kv, i, PKG]
    m3 = F[kv, i, PM3]
    prev = R[kv, i - 1] if i > 0 else n + kv
    for idx in range(mlen):
        x = mid[idx]
        t += dur[prev, x] * sf
        distance += dist[prev, x]
        t = max(t, Nd[x, N_WS])
        excess = t - Nd[x, N_WE]
        if excess > 0.0:
            late += excess * Nd[x, N_PRIO]
        t += Nd[x, N_SERVICE]
        kg += Nd[x, N_KG]
        m3 += Nd[x, N_M3]
        prev = x
    if suffix_len > 0:
        y = R[w, j]
        arrival = t + dur[prev, y] * sf
        distance += dist[prev, y] + F[w, j, SDIST]
        kg += F[w, j, SKG]
        m3 += F[w, j, SM3]
        base = F[w, j, SARR]
        slope = F[w, j, SSLR] if arrival >= base else F[w, j, SSLL]
        late += max(0.0, F[w, j, SLATE] + slope * (arrival - base))
        t_end = max(arrival + F[w, j, SA], F[w, j, SB])
    else:
        t_end = t
        if V[kv, V_OPEN] < 0.5:
            last = n + V.shape[0] + kv
            t_end += dur[prev, last] * sf
            distance += dist[prev, last]
    duration = t_end - V[kv, V_SHIFT]
    overtime = max(duration - V[kv, V_MAX_SHIFT], 0.0)
    cost = distance * V[kv, V_COST_KM] + duration * V[kv, V_COST_MIN] + V[kv, V_FIXED]
    return route_additive(
        duration,
        cost,
        True,
        max(0.0, kg - V[kv, V_CAP_KG]),
        max(0.0, m3 - V[kv, V_CAP_M3]),
        late,
        overtime,
        coef,
    )


@numba.njit(cache=True, inline="always")
def weak_bound(
    kv: int, lo: int, pc: int, w: int, hi: int, R: Any, Ln: Any, F: Any, bc: Any
) -> float:
    dist, dur, V, Nd, coef, pb = bc
    n = Nd.shape[0]
    sf = V[kv, V_SPEED]
    t = F[kv, lo, PDEP]
    distance = F[kv, lo, PDIST]
    late = F[kv, lo, PLATE]
    kg = F[kv, lo, PKG]
    m3 = F[kv, lo, PM3]
    prev = R[kv, lo - 1] if lo > 0 else n + kv
    count = lo
    for c in range(pc):
        r = pb[c, 0]
        x = pb[c, 2]
        y = pb[c, 3]
        if y <= x:
            continue
        if pb[c, 1] == 0:
            first = R[r, x]
            last_node = R[r, y - 1]
            distance += dist[prev, first] + F[r, y, PDIST] - F[r, x + 1, PDIST]
            t += (dur[prev, first] + F[r, y, PT] - F[r, x + 1, PT]) * sf
        else:
            first = R[r, y - 1]
            last_node = R[r, x]
            distance += dist[prev, first] + F[r, y - 1, RD] - F[r, x, RD]
            t += (dur[prev, first] + F[r, y - 1, RT] - F[r, x, RT]) * sf
        t += F[r, y, PS] - F[r, x, PS]
        kg += F[r, y, PKG] - F[r, x, PKG]
        m3 += F[r, y, PM3] - F[r, x, PM3]
        count += y - x
        prev = last_node
    suffix_len = Ln[w] - hi
    if suffix_len > 0:
        y = R[w, hi]
        t += dur[prev, y] * sf + F[w, hi, SA]
        distance += dist[prev, y] + F[w, hi, SDIST]
        kg += F[w, hi, SKG]
        m3 += F[w, hi, SM3]
    else:
        if V[kv, V_OPEN] < 0.5 and count > 0:
            last = n + V.shape[0] + kv
            t += dur[prev, last] * sf
            distance += dist[prev, last]
    if count + suffix_len == 0:
        return 0.0
    duration = t - V[kv, V_SHIFT]
    overtime = max(duration - V[kv, V_MAX_SHIFT], 0.0)
    cost = distance * V[kv, V_COST_KM] + duration * V[kv, V_COST_MIN] + V[kv, V_FIXED]
    return route_additive(
        duration,
        cost,
        True,
        max(0.0, kg - V[kv, V_CAP_KG]),
        max(0.0, m3 - V[kv, V_CAP_M3]),
        late,
        overtime,
        coef,
    )


@numba.njit(cache=True, inline="always")
def set_piece(bc: Any, c: int, route: int, kind: int, x: int, y: int) -> None:
    pb = bc[5]
    pb[c, 0] = route
    pb[c, 1] = kind
    pb[c, 2] = x
    pb[c, 3] = y
