from __future__ import annotations

import math
from typing import Any

import numpy as np
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from routeopt.algorithms.base import (
    ProgressCallback,
    ProgressEvent,
    Solver,
    SolveResult,
    SolverParams,
    Stopwatch,
    register_solver,
)
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import (
    COEF_COST,
    COEF_LATENESS,
    COEF_TIME,
    COEF_UNASSIGNED,
    COEF_VEHICLES,
    additive_coefs,
    evaluate,
)
from routeopt.core.types import Instance, Penalties, RouteSet

TIME_SCALE = 100
LOAD_SCALE = 1000
ARC_TARGET = 1e6
HORIZON = 10**9
MAX_UNASSIGNED_PENALTY = 100.0
FINITE_CAPACITY_LIMIT = 1e8


def finite_dimension(capacity: Any) -> bool:
    return bool(np.all(np.isfinite(capacity)) and np.all(capacity < FINITE_CAPACITY_LIMIT))


def arc_costs(inst: Instance, k: int, coef: Any) -> Any:
    per_dist = coef[COEF_COST] * inst.cost_per_km[k]
    per_time = coef[COEF_TIME] + coef[COEF_COST] * inst.cost_per_min[k]
    service = np.zeros(inst.dist.shape[0])
    service[: inst.n] = inst.service
    time_part = inst.dur * inst.speed_factor[k] + service[:, None]
    result: Any = per_dist * inst.dist + per_time * time_part
    return result


def time_transit(inst: Instance, k: int) -> Any:
    service = np.zeros(inst.dist.shape[0])
    service[: inst.n] = inst.service
    scaled = (inst.dur * inst.speed_factor[k] + service[:, None]) * TIME_SCALE
    return np.rint(scaled).astype(np.int64)


def matrix_rows(matrix: Any) -> list[list[int]]:
    rows: list[list[int]] = matrix.tolist()
    return rows


class RoutingBuilder:
    def __init__(self, inst: Instance, penalties: Penalties | None) -> None:
        self.inst = inst
        self.coef = additive_coefs(inst, penalties)
        size = inst.n + 2 * inst.m
        self.manager = pywrapcp.RoutingIndexManager(
            size,
            inst.m,
            [inst.n + k for k in range(inst.m)],
            [inst.n + inst.m + k for k in range(inst.m)],
        )
        self.routing = pywrapcp.RoutingModel(self.manager)
        peak = max(float(arc_costs(inst, k, self.coef).max()) for k in range(inst.m))
        self.scale = ARC_TARGET / max(peak, 1e-12)
        self.register_costs()
        self.register_fixed_costs()
        self.add_capacity("kg", inst.demand_kg, inst.cap_kg)
        self.add_capacity("m3", inst.demand_m3, inst.cap_m3)
        self.add_time()
        self.add_disjunctions()

    def register_costs(self) -> None:
        cache: dict[tuple[float, float, float], int] = {}
        for k in range(self.inst.m):
            key = (
                float(self.inst.cost_per_km[k]),
                float(self.inst.cost_per_min[k]),
                float(self.inst.speed_factor[k]),
            )
            if key not in cache:
                matrix = np.rint(arc_costs(self.inst, k, self.coef) * self.scale).astype(np.int64)
                cache[key] = self.routing.RegisterTransitMatrix(matrix_rows(matrix))
            self.routing.SetArcCostEvaluatorOfVehicle(cache[key], k)

    def register_fixed_costs(self) -> None:
        for k in range(self.inst.m):
            fixed = self.coef[COEF_COST] * self.inst.fixed_cost[k] + self.coef[COEF_VEHICLES]
            self.routing.SetFixedCostOfVehicle(round(float(fixed) * self.scale), k)

    def add_capacity(self, name: str, demand: Any, capacity: Any) -> None:
        if not finite_dimension(capacity):
            return
        inst = self.inst
        values = np.zeros(inst.n + 2 * inst.m, dtype=np.int64)
        values[: inst.n] = np.ceil(np.round(demand * LOAD_SCALE, 6)).astype(np.int64)
        callback = self.routing.RegisterUnaryTransitVector([int(v) for v in values])
        limits = [math.floor(round(float(c) * LOAD_SCALE, 6) + 1e-6) for c in capacity]
        self.routing.AddDimensionWithVehicleCapacity(callback, 0, limits, True, name)

    def needs_time(self) -> bool:
        return self.inst.tw_enabled or bool(np.any(np.isfinite(self.inst.max_shift)))

    def add_time(self) -> None:
        inst = self.inst
        if not self.needs_time():
            return
        callbacks: dict[float, int] = {}
        evaluators = []
        for k in range(inst.m):
            sf = float(inst.speed_factor[k])
            if sf not in callbacks:
                callbacks[sf] = self.routing.RegisterTransitMatrix(
                    matrix_rows(time_transit(inst, k))
                )
            evaluators.append(callbacks[sf])
        self.routing.AddDimensionWithVehicleTransits(evaluators, HORIZON, HORIZON, False, "time")
        dim = self.routing.GetDimensionOrDie("time")
        for k in range(inst.m):
            start = round(float(inst.shift_start[k]) * TIME_SCALE)
            dim.CumulVar(self.routing.Start(k)).SetRange(start, start)
            if math.isfinite(inst.max_shift[k]):
                limit = start + round(float(inst.max_shift[k]) * TIME_SCALE)
                dim.CumulVar(self.routing.End(k)).SetMax(limit)
        if not inst.tw_enabled:
            return
        for i in range(inst.n):
            index = self.manager.NodeToIndex(i)
            early = math.ceil(round(float(inst.tw_start[i]) * TIME_SCALE, 6))
            dim.CumulVar(index).SetMin(early)
            if math.isfinite(inst.tw_end[i]):
                late = math.floor(round(float(inst.tw_end[i]) * TIME_SCALE, 6))
                weight = self.coef[COEF_LATENESS] * inst.priority_w[i] / TIME_SCALE
                dim.SetCumulVarSoftUpperBound(index, late, max(1, round(weight * self.scale)))

    def add_disjunctions(self) -> None:
        penalty = round(min(float(self.coef[COEF_UNASSIGNED]), MAX_UNASSIGNED_PENALTY) * self.scale)
        for i in range(self.inst.n):
            self.routing.AddDisjunction([self.manager.NodeToIndex(i)], penalty)

    def extract(self, assignment: Any) -> RouteSet:
        inst = self.inst
        routes: list[list[int]] = [[] for _ in range(inst.m)]
        served: set[int] = set()
        for k in range(inst.m):
            index = assignment.Value(self.routing.NextVar(self.routing.Start(k)))
            while not self.routing.IsEnd(index):
                node = self.manager.IndexToNode(index)
                routes[k].append(node)
                served.add(node)
                index = assignment.Value(self.routing.NextVar(index))
        missing = [i for i in range(inst.n) if i not in served]
        return RouteSet(routes, missing)


def search_parameters(time_limit_s: float) -> Any:
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.FromMilliseconds(max(50, int(time_limit_s * 1000)))
    return params


@register_solver
class OrToolsSolver(Solver):
    name = "ortools"
    label = "OR-Tools (GLS baseline)"
    params_model = SolverParams
    multi_objective = False

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        watch = Stopwatch(self.params.time_limit_s)
        baseline = warm_start[0] if warm_start else nearest_neighbor(inst)
        current = evaluate(inst, baseline, penalties)
        history = [(0, current.fitness, 0.0)]
        if callback is not None and not callback(
            ProgressEvent(0, watch.elapsed, current.fitness, current, best=baseline)
        ):
            return SolveResult(self.name, baseline, current, watch.elapsed, 0, history)
        builder = RoutingBuilder(inst, penalties)
        remaining = self.params.time_limit_s - watch.elapsed
        assignment = builder.routing.SolveWithParameters(search_parameters(remaining))
        routes = baseline if assignment is None else builder.extract(assignment)
        evaluation = evaluate(inst, routes, penalties)
        history.append((1, evaluation.fitness, watch.elapsed))
        if callback is not None:
            callback(ProgressEvent(1, watch.elapsed, evaluation.fitness, evaluation, best=routes))
        return SolveResult(self.name, routes, evaluation, watch.elapsed, 1, history)
