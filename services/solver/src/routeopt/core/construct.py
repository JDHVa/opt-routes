from __future__ import annotations

import numpy as np

from routeopt.core.types import Instance, RouteSet

TOLERANCE = 1e-9


def nearest_neighbor(inst: Instance) -> RouteSet:
    n, m = inst.n, inst.m
    remaining = np.ones(n, dtype=np.bool_)
    routes: list[list[int]] = [[] for _ in range(m)]
    loads_kg = np.zeros(m)
    loads_m3 = np.zeros(m)
    for k in range(m):
        if not remaining.any():
            break
        sf = inst.speed_factor[k]
        end_node = n + m + k
        current = n + k
        t = inst.shift_start[k]
        while True:
            candidates = np.flatnonzero(remaining)
            if candidates.size == 0:
                break
            arrival = t + inst.dur[current, candidates] * sf
            begin = np.maximum(arrival, inst.tw_start[candidates]) if inst.tw_enabled else arrival
            finish = begin + inst.service[candidates]
            ok = (loads_kg[k] + inst.demand_kg[candidates] <= inst.cap_kg[k] + TOLERANCE) & (
                loads_m3[k] + inst.demand_m3[candidates] <= inst.cap_m3[k] + TOLERANCE
            )
            if inst.tw_enabled:
                ok &= begin <= inst.tw_end[candidates] + TOLERANCE
            back = inst.dur[candidates, end_node] * sf
            ok &= finish + back - inst.shift_start[k] <= inst.max_shift[k] + TOLERANCE
            if not ok.any():
                break
            feasible = np.flatnonzero(ok)
            nearest = int(np.argmin(inst.dist[current, candidates[feasible]]))
            pos = int(feasible[nearest])
            chosen = int(candidates[pos])
            routes[k].append(chosen)
            remaining[chosen] = False
            loads_kg[k] += inst.demand_kg[chosen]
            loads_m3[k] += inst.demand_m3[chosen]
            t = float(finish[pos])
            current = chosen
    for stop in np.flatnonzero(remaining):
        ratio = (loads_kg + inst.demand_kg[stop]) / inst.cap_kg + (
            loads_m3 + inst.demand_m3[stop]
        ) / inst.cap_m3
        best = int(np.lexsort((loads_kg, ratio))[0])
        routes[best].append(int(stop))
        loads_kg[best] += inst.demand_kg[stop]
        loads_m3[best] += inst.demand_m3[stop]
    return RouteSet(routes, [])
