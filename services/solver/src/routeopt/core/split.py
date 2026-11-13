from __future__ import annotations

from typing import Any

import numba
import numpy as np

from routeopt.core.evaluate import additive_coefs, route_additive
from routeopt.core.types import Chromosome, Instance, Penalties, RouteSet

PRUNE_FACTOR = 1.5


@numba.njit(cache=True)  # type: ignore[untyped-decorator]
def split_kernel(
    tour: Any,
    vorder: Any,
    n: int,
    m: int,
    dist: Any,
    dur: Any,
    service: Any,
    tw_start: Any,
    tw_end: Any,
    priority_w: Any,
    demand_kg: Any,
    demand_m3: Any,
    cap_kg: Any,
    cap_m3: Any,
    shift_start: Any,
    max_shift: Any,
    speed_factor: Any,
    cost_per_km: Any,
    cost_per_min: Any,
    fixed_cost: Any,
    open_end: Any,
    tw_enabled: bool,
    coef: Any,
    prune: bool,
) -> tuple[float, Any, Any]:
    inf = np.inf
    value = np.full((m + 1, n + 1), inf)
    parent = np.full((m + 1, n + 1), -1, dtype=np.int64)
    value[0, 0] = 0.0
    for j in range(1, m + 1):
        k = vorder[j - 1]
        sf = speed_factor[k]
        ss = shift_start[k]
        start_node = n + k
        end_node = n + m + k
        kg_limit = PRUNE_FACTOR * cap_kg[k]
        m3_limit = PRUNE_FACTOR * cap_m3[k]
        shift_limit = PRUNE_FACTOR * max_shift[k]
        for i in range(n + 1):
            value[j, i] = value[j - 1, i]
        for p in range(n):
            base = value[j - 1, p]
            if base == inf:
                continue
            t = ss
            prev = start_node
            distance = 0.0
            lateness = 0.0
            load_kg = 0.0
            load_m3 = 0.0
            for q in range(p, n):
                stop = tour[q]
                t += dur[prev, stop] * sf
                distance += dist[prev, stop]
                if tw_enabled:
                    t = max(t, tw_start[stop])
                    excess = t - tw_end[stop]
                    if excess > 0.0:
                        lateness += excess * priority_w[stop]
                t += service[stop]
                load_kg += demand_kg[stop]
                load_m3 += demand_m3[stop]
                prev = stop
                t_final = t
                dist_final = distance
                if not open_end[k]:
                    t_final += dur[prev, end_node] * sf
                    dist_final += dist[prev, end_node]
                duration = t_final - ss
                overtime = max(0.0, duration - max_shift[k])
                cost = dist_final * cost_per_km[k] + duration * cost_per_min[k] + fixed_cost[k]
                candidate = base + route_additive(
                    duration,
                    cost,
                    True,
                    max(0.0, load_kg - cap_kg[k]),
                    max(0.0, load_m3 - cap_m3[k]),
                    lateness,
                    overtime,
                    coef,
                )
                if candidate < value[j, q + 1]:
                    value[j, q + 1] = candidate
                    parent[j, q + 1] = p
                if prune and (load_kg > kg_limit or load_m3 > m3_limit or t - ss > shift_limit):
                    break
    seg_start = np.zeros(m, dtype=np.int64)
    seg_end = np.zeros(m, dtype=np.int64)
    i = n
    for j in range(m, 0, -1):
        p = parent[j, i]
        if p < 0:
            seg_start[j - 1] = i
            seg_end[j - 1] = i
        else:
            seg_start[j - 1] = p
            seg_end[j - 1] = i
            i = p
    return value[m, n], seg_start, seg_end


def _run(inst: Instance, chrom: Chromosome, coef: Any, prune: bool) -> tuple[float, Any, Any]:
    result: tuple[float, Any, Any] = split_kernel(
        chrom.tour,
        chrom.vorder,
        inst.n,
        inst.m,
        inst.dist,
        inst.dur,
        inst.service,
        inst.tw_start,
        inst.tw_end,
        inst.priority_w,
        inst.demand_kg,
        inst.demand_m3,
        inst.cap_kg,
        inst.cap_m3,
        inst.shift_start,
        inst.max_shift,
        inst.speed_factor,
        inst.cost_per_km,
        inst.cost_per_min,
        inst.fixed_cost,
        inst.open_end,
        inst.tw_enabled,
        coef,
        prune,
    )
    return result


def split(
    inst: Instance, chrom: Chromosome, penalties: Penalties | None = None
) -> tuple[RouteSet, float]:
    coef = additive_coefs(inst, penalties)
    cost, seg_start, seg_end = _run(inst, chrom, coef, True)
    if not np.isfinite(cost):
        cost, seg_start, seg_end = _run(inst, chrom, coef, False)
    routes: list[list[int]] = [[] for _ in range(inst.m)]
    for j in range(inst.m):
        k = int(chrom.vorder[j])
        routes[k] = chrom.tour[seg_start[j] : seg_end[j]].tolist()
    return RouteSet(routes, []), float(cost)


def routes_to_chromosome(inst: Instance, rs: RouteSet) -> Chromosome:
    used = [k for k in range(inst.m) if rs.routes[k]]
    unused = [k for k in range(inst.m) if not rs.routes[k]]
    tour: list[int] = []
    for k in used:
        tour.extend(rs.routes[k])
    tour.extend(rs.unassigned)
    return Chromosome(
        tour=np.asarray(tour, dtype=np.int64),
        vorder=np.asarray(used + unused, dtype=np.int64),
    )


def random_chromosome(inst: Instance, rng: np.random.Generator) -> Chromosome:
    return Chromosome(
        tour=rng.permutation(inst.n).astype(np.int64),
        vorder=rng.permutation(inst.m).astype(np.int64),
    )
