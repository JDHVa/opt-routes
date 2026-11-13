from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path
from statistics import mean
from typing import Any

from routeopt.algorithms.base import get_solver
from routeopt.core.evaluate import validate_routeset

ROOT = Path(__file__).resolve().parents[1]

TRACKED_HISTORY = {"ga", "aco", "aco_ga"}
EPS = 1e-9


def time_to_best(solver: str, history: list[tuple[int, float, float]], runtime: float) -> float:
    if solver not in TRACKED_HISTORY:
        return runtime
    final = history[-1][2]
    for _, elapsed, fitness in history:
        if fitness <= final + EPS:
            return elapsed
    return runtime


def run_one(solver: str, instance: str, limit: float, seed: int) -> dict[str, Any]:
    factories = importlib.import_module("tests.factories")
    inst, bks = factories.benchmark_instance(instance)
    params = {"time_limit_s": limit, "max_iterations": 10**6, "seed": seed}
    result = get_solver(solver, params).solve(inst)
    validate_routeset(inst, result.best)
    distance = result.evaluation.total_distance_km
    return {
        "solver": solver,
        "instance": instance,
        "seed": seed,
        "bks": bks,
        "distance_km": distance,
        "gap_pct": 100.0 * (distance - bks) / bks,
        "time_to_best_s": time_to_best(solver, result.history, result.runtime_s),
        "runtime_s": result.runtime_s,
        "feasible": bool(result.evaluation.feasible),
    }


def table(rows: list[dict[str, Any]], solvers: list[str], instances: list[str]) -> str:
    lines = [
        "| Instancia | Solver | Gap medio % | Mejor gap % | t hasta mejor (s) | Factibles |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for instance in instances:
        for solver in solvers:
            cell = [r for r in rows if r["instance"] == instance and r["solver"] == solver]
            if not cell:
                continue
            gaps = [r["gap_pct"] for r in cell]
            feasible = sum(1 for r in cell if r["feasible"])
            lines.append(
                f"| {instance} | {solver} | {mean(gaps):.2f} | {min(gaps):.2f} | "
                f"{mean(r['time_to_best_s'] for r in cell):.1f} | {feasible}/{len(cell)} |"
            )
    return "\n".join(lines)


def main() -> None:
    sys.path.insert(0, str(ROOT))
    importlib.import_module("routeopt.algorithms")
    importlib.import_module("routeopt.algorithms.hybrid")
    parser = argparse.ArgumentParser()
    parser.add_argument("--solvers", default="ga,aco,aco_ga,pyvrp,ortools")
    parser.add_argument(
        "--instances", default="A-n32-k5,A-n45-k7,P-n50-k7,A-n80-k10,X-n101-k25,C101"
    )
    parser.add_argument("--time", type=float, default=30.0)
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    solvers = args.solvers.split(",")
    instances = args.instances.split(",")
    seeds = [int(s) for s in args.seeds.split(",")]
    rows: list[dict[str, Any]] = []
    for instance in instances:
        for solver in solvers:
            for seed in seeds:
                row = run_one(solver, instance, args.time, seed)
                rows.append(row)
                print(
                    f"{instance} {solver} seed={seed} gap={row['gap_pct']:.2f}% "
                    f"feasible={row['feasible']}",
                    file=sys.stderr,
                    flush=True,
                )
    print(table(rows, solvers, instances))
    if args.out is not None:
        args.out.write_text(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
