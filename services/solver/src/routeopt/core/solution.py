from __future__ import annotations

import numpy as np

from routeopt.core import models
from routeopt.core.evaluate import route_cost_components
from routeopt.core.types import Evaluation, Instance, RouteSet


def _visits(inst: Instance, k: int, route: list[int]) -> list[models.Visit]:
    visits: list[models.Visit] = []
    t = float(inst.shift_start[k])
    prev = inst.start_node(k)
    sf = float(inst.speed_factor[k])
    for stop in route:
        t += float(inst.dur[prev, stop]) * sf
        arrival = t
        late = 0.0
        if inst.tw_enabled:
            t = max(t, float(inst.tw_start[stop]))
            late = max(0.0, t - float(inst.tw_end[stop]))
        start_service = t
        t += float(inst.service[stop])
        visits.append(
            models.Visit(
                stop_id=inst.stop_ids[stop],
                arrival_min=arrival,
                start_service_min=start_service,
                departure_min=t,
                late_min=late,
            )
        )
        prev = stop
    return visits


def to_solution(
    inst: Instance, rs: RouteSet, ev: Evaluation, algorithm: str, runtime_s: float
) -> models.Solution:
    routes: list[models.Route] = []
    routed: set[int] = set()
    for k, route in enumerate(rs.routes):
        if not route:
            continue
        routed.update(route)
        distance, duration, end, kg, m3, late, overtime, cost = route_cost_components(
            inst, k, np.asarray(route, dtype=np.int64)
        )
        routes.append(
            models.Route(
                driver_id=inst.driver_ids[k],
                vehicle_type_id=inst.vehicle_type_ids[k],
                visits=_visits(inst, k, route),
                metrics=models.RouteMetrics(
                    distance_km=distance,
                    duration_min=duration,
                    start_min=float(inst.shift_start[k]),
                    end_min=end,
                    load_kg=kg,
                    load_m3=m3,
                    cost_mxn=cost,
                    lateness_min=late,
                    overtime_min=overtime,
                ),
            )
        )
    unassigned_ids = [inst.stop_ids[i] for i in range(inst.n) if i not in routed]
    return models.Solution(
        algorithm=algorithm,
        routes=routes,
        unassigned_stop_ids=unassigned_ids,
        metrics=models.SolutionMetrics(
            total_distance_km=ev.total_distance_km,
            total_duration_min=ev.total_duration_min,
            makespan_min=ev.makespan_min,
            vehicles_used=ev.vehicles_used,
            total_cost_mxn=ev.total_cost_mxn,
            lateness_min=ev.lateness_min,
            overload_kg=ev.overload_kg,
            overload_m3=ev.overload_m3,
            overtime_min=ev.overtime_min,
            unassigned=ev.unassigned,
            feasible=ev.feasible,
            fitness=ev.fitness,
        ),
        runtime_s=runtime_s,
    )
