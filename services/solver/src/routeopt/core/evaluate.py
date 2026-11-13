from __future__ import annotations

from itertools import chain
from typing import Any

import numba
import numpy as np

from routeopt.core.types import F64, Evaluation, Instance, Penalties, RouteSet

COEF_TIME = 0
COEF_COST = 1
COEF_VEHICLES = 2
COEF_OVERLOAD_KG = 3
COEF_OVERLOAD_M3 = 4
COEF_LATENESS = 5
COEF_OVERTIME = 6
COEF_MAKESPAN = 7
COEF_UNASSIGNED = 8
COEF_SIZE = 9

FEASIBILITY_TOL = 1e-9


@numba.njit(cache=True)
def route_eval(
    k: int,
    route: Any,
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
    shift_start: Any,
    max_shift: Any,
    speed_factor: Any,
    cost_per_km: Any,
    cost_per_min: Any,
    fixed_cost: Any,
    open_end: Any,
    tw_enabled: bool,
) -> tuple[float, float, float, float, float, float, float, float]:
    count = route.shape[0]
    if count == 0:
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    sf = speed_factor[k]
    t = shift_start[k]
    prev = n + k
    distance = 0.0
    lateness = 0.0
    load_kg = 0.0
    load_m3 = 0.0
    for idx in range(count):
        i = route[idx]
        t += dur[prev, i] * sf
        distance += dist[prev, i]
        if tw_enabled:
            t = max(t, tw_start[i])
            excess = t - tw_end[i]
            if excess > 0.0:
                lateness += excess * priority_w[i]
        t += service[i]
        load_kg += demand_kg[i]
        load_m3 += demand_m3[i]
        prev = i
    if not open_end[k]:
        last = n + m + k
        t += dur[prev, last] * sf
        distance += dist[prev, last]
    duration = t - shift_start[k]
    overtime = duration - max_shift[k]
    overtime = max(overtime, 0.0)
    cost = distance * cost_per_km[k] + duration * cost_per_min[k] + fixed_cost[k]
    return distance, duration, t, load_kg, load_m3, lateness, overtime, cost


@numba.njit(cache=True)
def route_additive(
    duration: float,
    cost: float,
    used: bool,
    over_kg: float,
    over_m3: float,
    lateness: float,
    overtime: float,
    coef: Any,
) -> float:
    value = (
        coef[COEF_TIME] * duration
        + coef[COEF_COST] * cost
        + coef[COEF_OVERLOAD_KG] * over_kg
        + coef[COEF_OVERLOAD_M3] * over_m3
        + coef[COEF_LATENESS] * lateness
        + coef[COEF_OVERTIME] * overtime
    )
    if used:
        value += coef[COEF_VEHICLES]
    return value


@numba.njit(cache=True)
def fitness_parts_to_scalar(
    additive_sum: float, makespan: float, unassigned: int, coef: Any
) -> float:
    return additive_sum + coef[COEF_MAKESPAN] * makespan + coef[COEF_UNASSIGNED] * unassigned


@numba.njit(cache=True)
def evaluate_kernel(
    flat: Any,
    offsets: Any,
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
) -> Any:
    out = np.zeros(11)
    seen = np.zeros(n, dtype=np.bool_)
    additive_sum = 0.0
    for k in range(m):
        route = flat[offsets[k] : offsets[k + 1]]
        for idx in range(route.shape[0]):
            seen[route[idx]] = True
        used = route.shape[0] > 0
        d, duration, t_end, kg, m3, late, overtime, cost = route_eval(
            k,
            route,
            n,
            m,
            dist,
            dur,
            service,
            tw_start,
            tw_end,
            priority_w,
            demand_kg,
            demand_m3,
            shift_start,
            max_shift,
            speed_factor,
            cost_per_km,
            cost_per_min,
            fixed_cost,
            open_end,
            tw_enabled,
        )
        over_kg = max(0.0, kg - cap_kg[k])
        over_m3 = max(0.0, m3 - cap_m3[k])
        out[0] += d
        out[1] += duration
        out[2] += cost
        if used:
            out[3] += 1.0
            out[4] = max(out[4], t_end)
        out[5] += over_kg
        out[6] += over_m3
        out[7] += late
        out[8] += overtime
        additive_sum += route_additive(duration, cost, used, over_kg, over_m3, late, overtime, coef)
    unassigned = 0
    for i in range(n):
        if not seen[i]:
            unassigned += 1
    out[9] = additive_sum
    out[10] = unassigned
    return out


def route_args(inst: Instance) -> tuple[Any, ...]:
    return (
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
        inst.shift_start,
        inst.max_shift,
        inst.speed_factor,
        inst.cost_per_km,
        inst.cost_per_min,
        inst.fixed_cost,
        inst.open_end,
        inst.tw_enabled,
    )


def additive_coefs(inst: Instance, penalties: Penalties | None = None) -> F64:
    pen = penalties if penalties is not None else Penalties()
    coef = np.zeros(COEF_SIZE, dtype=np.float64)
    scaled = inst.weights / inst.obj_scale
    coef[COEF_TIME] = scaled[0]
    coef[COEF_COST] = scaled[1]
    coef[COEF_VEHICLES] = scaled[2]
    coef[COEF_MAKESPAN] = scaled[3]
    coef[COEF_OVERLOAD_KG] = pen.capacity / float(np.mean(inst.cap_kg))
    coef[COEF_OVERLOAD_M3] = pen.capacity / float(np.mean(inst.cap_m3))
    coef[COEF_LATENESS] = pen.lateness / 60.0
    coef[COEF_OVERTIME] = pen.overtime / 60.0
    coef[COEF_UNASSIGNED] = pen.unassigned
    return coef


def route_cost_components(
    inst: Instance, k: int, route: np.ndarray[Any, Any]
) -> tuple[float, float, float, float, float, float, float, float]:
    return route_eval(k, np.asarray(route, dtype=np.int64), *route_args(inst))


def _flatten(inst: Instance, rs: RouteSet) -> tuple[np.ndarray[Any, Any], np.ndarray[Any, Any]]:
    if len(rs.routes) != inst.m:
        raise ValueError(f"routes has {len(rs.routes)} entries, expected {inst.m}")
    offsets = np.zeros(inst.m + 1, dtype=np.int64)
    np.cumsum([len(r) for r in rs.routes], out=offsets[1:])
    flat = np.fromiter(chain.from_iterable(rs.routes), dtype=np.int64, count=int(offsets[-1]))
    return flat, offsets


def _raw(inst: Instance, rs: RouteSet, coef: F64) -> F64:
    flat, offsets = _flatten(inst, rs)
    out: F64 = evaluate_kernel(
        flat,
        offsets,
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
    )
    return out


def additive_cost(inst: Instance, rs: RouteSet, penalties: Penalties | None = None) -> float:
    return float(_raw(inst, rs, additive_coefs(inst, penalties))[9])


def evaluate(inst: Instance, rs: RouteSet, penalties: Penalties | None = None) -> Evaluation:
    coef = additive_coefs(inst, penalties)
    out = _raw(inst, rs, coef)
    unassigned = int(out[10])
    fitness = float(fitness_parts_to_scalar(float(out[9]), float(out[4]), unassigned, coef))
    feasible = (
        out[5] <= FEASIBILITY_TOL
        and out[6] <= FEASIBILITY_TOL
        and out[8] <= FEASIBILITY_TOL
        and unassigned == 0
    )
    return Evaluation(
        fitness=fitness,
        feasible=bool(feasible),
        total_duration_min=float(out[1]),
        total_cost_mxn=float(out[2]),
        vehicles_used=int(out[3]),
        makespan_min=float(out[4]),
        total_distance_km=float(out[0]),
        overload_kg=float(out[5]),
        overload_m3=float(out[6]),
        lateness_min=float(out[7]),
        overtime_min=float(out[8]),
        unassigned=unassigned,
    )


def validate_routeset(inst: Instance, rs: RouteSet) -> None:
    if len(rs.routes) != inst.m:
        raise ValueError(f"routes has {len(rs.routes)} entries, expected {inst.m}")
    seen: set[int] = set()
    for item in chain(chain.from_iterable(rs.routes), rs.unassigned):
        if not 0 <= item < inst.n:
            raise ValueError(f"stop index out of range: {item}")
        if item in seen:
            raise ValueError(f"duplicate stop: {item}")
        seen.add(item)
    if len(seen) != inst.n:
        missing = sorted(set(range(inst.n)) - seen)
        raise ValueError(f"missing stops: {missing}")
