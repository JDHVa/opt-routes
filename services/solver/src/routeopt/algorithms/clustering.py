from __future__ import annotations

import itertools
import math

import numpy as np
from numpy.typing import NDArray
from sklearn.cluster import KMeans

from routeopt.algorithms.local_search import improve
from routeopt.core.types import F64, Instance, Penalties, RouteSet

EARTH_RADIUS_KM = 6371.0088
CAPACITY_HEADROOM = 0.85
TOLERANCE = 1e-9
BIG = 1e18


def project_km(inst: Instance) -> F64:
    coords = inst.coords
    center = coords.mean(axis=0)
    lat0 = math.radians(float(center[0]))
    y = np.radians(coords[:, 0] - center[0]) * EARTH_RADIUS_KM
    x = np.radians(coords[:, 1] - center[1]) * EARTH_RADIUS_KM * math.cos(lat0)
    projected: F64 = np.column_stack([x, y])
    return projected


def start_points(inst: Instance, points: F64) -> F64:
    result: F64 = points[inst.n : inst.n + inst.m]
    return result


def has_distinct_starts(inst: Instance, points: F64) -> bool:
    starts = start_points(inst, points)
    return bool(np.ptp(starts, axis=0).max() > 1e-6)


def capacity_ratio(demand: float, capacity: F64) -> float | None:
    mean = float(np.mean(capacity))
    if not math.isfinite(mean) or mean <= 0.0:
        return None
    return demand / (CAPACITY_HEADROOM * mean)


def required_vehicles(inst: Instance) -> int:
    ratios = [
        r
        for r in (
            capacity_ratio(float(inst.demand_kg.sum()), inst.cap_kg),
            capacity_ratio(float(inst.demand_m3.sum()), inst.cap_m3),
        )
        if r is not None
    ]
    if not ratios:
        return inst.m
    return int(min(inst.m, max(1, math.ceil(max(ratios)))))


def capacity_rank(inst: Instance) -> NDArray[np.int64]:
    key_kg = np.where(np.isfinite(inst.cap_kg), inst.cap_kg, BIG)
    key_m3 = np.where(np.isfinite(inst.cap_m3), inst.cap_m3, BIG)
    order: NDArray[np.int64] = np.lexsort((np.arange(inst.m), -key_m3, -key_kg))
    return order


def balanced_assignment(
    inst: Instance,
    stop_points: F64,
    centroids: F64,
    vehicles: list[int],
) -> list[list[int]]:
    groups: list[list[int]] = [[] for _ in range(inst.m)]
    load_kg = np.zeros(len(vehicles))
    load_m3 = np.zeros(len(vehicles))
    cap_kg = inst.cap_kg[vehicles]
    cap_m3 = inst.cap_m3[vehicles]
    diff = stop_points[:, None, :] - centroids[None, :, :]
    distance = np.sqrt((diff**2).sum(axis=-1))
    order = np.argsort(distance.min(axis=1), kind="stable")
    for stop in order:
        ranked = np.argsort(distance[stop], kind="stable")
        fits = (load_kg[ranked] + inst.demand_kg[stop] <= cap_kg[ranked] + TOLERANCE) & (
            load_m3[ranked] + inst.demand_m3[stop] <= cap_m3[ranked] + TOLERANCE
        )
        if fits.any():
            slot = int(ranked[int(np.argmax(fits))])
        else:
            excess = np.maximum(
                (load_kg + inst.demand_kg[stop]) / cap_kg - 1.0,
                (load_m3 + inst.demand_m3[stop]) / cap_m3 - 1.0,
            )
            slot = int(np.lexsort((distance[stop], excess))[0])
        groups[vehicles[slot]].append(int(stop))
        load_kg[slot] += inst.demand_kg[stop]
        load_m3[slot] += inst.demand_m3[stop]
    return groups


def cluster_demand(inst: Instance, labels: NDArray[np.int64], k: int) -> F64:
    ratio = capacity_ratio(1.0, inst.cap_kg)
    result = np.zeros(k)
    for c in range(k):
        mask = labels == c
        result[c] = (
            float(inst.demand_kg[mask].sum()) * ratio if ratio is not None else float(mask.sum())
        )
    return result


def match_nearest(cost: F64) -> list[int]:
    size = cost.shape[0]
    matched = [-1] * size
    taken: set[int] = set()
    for flat in np.argsort(cost, axis=None, kind="stable"):
        row, col = divmod(int(flat), size)
        if matched[row] < 0 and col not in taken:
            matched[row] = col
            taken.add(col)
    return matched


def kmeans_assignment(inst: Instance, rng: np.random.Generator) -> list[list[int]]:
    points = project_km(inst)
    stop_points = points[: inst.n]
    seed = int(rng.integers(0, 2**31 - 1))
    if has_distinct_starts(inst, points):
        starts = start_points(inst, points)
        model = KMeans(n_clusters=inst.m, init=starts, n_init=1, random_state=seed)
        model.fit(stop_points)
        centroids = np.asarray(model.cluster_centers_)
        cost = np.sqrt(((centroids[:, None, :] - starts[None, :, :]) ** 2).sum(axis=-1))
        vehicles = match_nearest(cost)
        return balanced_assignment(inst, stop_points, centroids, vehicles)
    k = min(required_vehicles(inst), inst.n)
    model = KMeans(n_clusters=k, n_init=1, random_state=seed)
    labels = model.fit_predict(stop_points)
    centroids = np.asarray(model.cluster_centers_)
    cluster_order = np.argsort(-cluster_demand(inst, labels, k), kind="stable")
    ranked_vehicles = capacity_rank(inst)[:k]
    vehicles = [0] * k
    for cluster, vehicle in zip(cluster_order, ranked_vehicles, strict=True):
        vehicles[int(cluster)] = int(vehicle)
    return balanced_assignment(inst, stop_points, centroids, vehicles)


def vehicle_fill_order(inst: Instance, rng: np.random.Generator) -> list[int]:
    shuffled = rng.permutation(inst.m)
    key_kg = np.where(np.isfinite(inst.cap_kg[shuffled]), inst.cap_kg[shuffled], BIG)
    ranked = shuffled[np.argsort(-key_kg, kind="stable")]
    return [int(k) for k in ranked]


def fits_vehicle(
    inst: Instance, k: int, route: list[int], stop: int, load_kg: float, load_m3: float
) -> bool:
    if load_kg + inst.demand_kg[stop] > inst.cap_kg[k] + TOLERANCE:
        return False
    if load_m3 + inst.demand_m3[stop] > inst.cap_m3[k] + TOLERANCE:
        return False
    if not math.isfinite(inst.max_shift[k]):
        return True
    chain = [inst.n + k, *route, stop]
    elapsed = sum(float(inst.dur[a, b]) for a, b in itertools.pairwise(chain))
    elapsed *= float(inst.speed_factor[k])
    elapsed += float(inst.service[[*route, stop]].sum())
    if not inst.open_end[k]:
        elapsed += float(inst.dur[stop, inst.n + inst.m + k] * inst.speed_factor[k])
    return elapsed <= inst.max_shift[k] + TOLERANCE


def sweep_assignment(inst: Instance, rng: np.random.Generator) -> list[list[int]]:
    points = project_km(inst)
    center = start_points(inst, points).mean(axis=0)
    rel = points[: inst.n] - center
    angles = np.arctan2(rel[:, 1], rel[:, 0])
    offset = float(rng.uniform(0.0, 2.0 * math.pi))
    stops = np.argsort(np.mod(angles - offset, 2.0 * math.pi), kind="stable")
    fill_order = vehicle_fill_order(inst, rng)
    groups: list[list[int]] = [[] for _ in range(inst.m)]
    load_kg = np.zeros(inst.m)
    load_m3 = np.zeros(inst.m)
    cursor = 0
    leftovers: list[int] = []
    for stop in (int(s) for s in stops):
        placed = False
        while cursor < len(fill_order):
            k = fill_order[cursor]
            if fits_vehicle(inst, k, groups[k], stop, float(load_kg[k]), float(load_m3[k])):
                groups[k].append(stop)
                load_kg[k] += inst.demand_kg[stop]
                load_m3[k] += inst.demand_m3[stop]
                placed = True
                break
            cursor += 1
        if not placed:
            leftovers.append(stop)
    for stop in leftovers:
        ratio = (load_kg + inst.demand_kg[stop]) / inst.cap_kg + (
            load_m3 + inst.demand_m3[stop]
        ) / inst.cap_m3
        k = int(np.lexsort((load_kg, ratio))[0])
        groups[k].append(stop)
        load_kg[k] += inst.demand_kg[stop]
        load_m3[k] += inst.demand_m3[stop]
    return groups


def order_cluster(inst: Instance, k: int, members: list[int]) -> list[int]:
    remaining = list(members)
    route: list[int] = []
    current = inst.n + k
    t = float(inst.shift_start[k])
    while remaining:
        candidates = np.asarray(remaining, dtype=np.int64)
        arrival = t + inst.dur[current, candidates] * inst.speed_factor[k]
        if inst.tw_enabled:
            score = np.maximum(arrival, inst.tw_start[candidates])
        else:
            score = inst.dist[current, candidates]
        pick = int(np.argmin(score))
        chosen = remaining.pop(pick)
        route.append(chosen)
        t = float(arrival[pick])
        if inst.tw_enabled:
            t = max(t, float(inst.tw_start[chosen]))
        t += float(inst.service[chosen])
        current = chosen
    return route


def perturb_routes(routes: list[list[int]], rng: np.random.Generator, moves: int) -> None:
    for _ in range(moves):
        sources = [k for k, route in enumerate(routes) if route]
        if not sources:
            return
        src = sources[int(rng.integers(0, len(sources)))]
        stop = routes[src].pop(int(rng.integers(0, len(routes[src]))))
        dst = int(rng.integers(0, len(routes)))
        routes[dst].insert(int(rng.integers(0, len(routes[dst]) + 1)), stop)


def route_clusters(
    inst: Instance,
    assignment: list[list[int]],
    rng: np.random.Generator,
    penalties: Penalties | None = None,
    perturb: int = 0,
) -> RouteSet:
    routes = [order_cluster(inst, k, assignment[k]) for k in range(inst.m)]
    if perturb > 0:
        perturb_routes(routes, rng, perturb)
    return improve(inst, RouteSet(routes, []), penalties, rng)
