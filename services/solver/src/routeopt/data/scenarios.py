from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from routeopt.api.schemas import ScenarioInfo
from routeopt.core.models import Location, Problem, ProblemMode
from routeopt.data.generators.synthetic import generate_problem

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"
CENTRO_FOCUS = Location(lat=25.6700, lon=-100.3090)
CENTRO_DEPOT = Location(
    lat=25.7000,
    lon=-100.2900,
    address="Centro de distribución, zona norte de Monterrey, N.L. (aproximada)",
)


@dataclass(frozen=True)
class ScenarioSpec:
    id: str
    name: str
    description: str
    seed: int
    generator_args: dict[str, Any] = field(default_factory=dict)


SPECS: tuple[ScenarioSpec, ...] = (
    ScenarioSpec(
        id="mty-centro-depot-40",
        name="Centro de Monterrey, 40 paradas",
        description=(
            "Caso pequeño con un depósito, 4 repartidores y 40 paradas en el centro de Monterrey, "
            "sin ventanas de tiempo."
        ),
        seed=101,
        generator_args={
            "n_stops": 40,
            "n_drivers": 4,
            "mode": "depot",
            "time_windows_pct": 0.0,
            "high_priority_pct": 0.0,
            "vehicle_mix": {"nissan-nv200": 0.5, "renault-kangoo": 0.5},
            "depot": CENTRO_DEPOT,
            "focus": CENTRO_FOCUS,
            "radius_km": 7.0,
        },
    ),
    ScenarioSpec(
        id="mty-metro-depot-150",
        name="Área metropolitana, 150 paradas",
        description=(
            "Reparto metropolitano desde un depósito en Apodaca con 12 repartidores de flota mixta "
            "y 30 % de paradas con ventana de tiempo."
        ),
        seed=102,
        generator_args={
            "n_stops": 150,
            "n_drivers": 12,
            "mode": "depot",
            "time_windows_pct": 0.3,
            "high_priority_pct": 0.1,
            "vehicle_mix": {
                "nissan-nv200": 0.35,
                "ford-transit-connect": 0.25,
                "ford-transit": 0.25,
                "mercedes-sprinter": 0.15,
            },
        },
    ),
    ScenarioSpec(
        id="mty-multiorigin-80",
        name="Multi-origen, 80 paradas",
        description=(
            "Ocho repartidores que salen de puntos distintos y terminan su ruta en la última "
            "entrega (rutas abiertas)."
        ),
        seed=103,
        generator_args={
            "n_stops": 80,
            "n_drivers": 8,
            "mode": "multi_origin",
            "time_windows_pct": 0.2,
            "high_priority_pct": 0.1,
            "vehicle_mix": {
                "italika-moto-reparto": 0.25,
                "nissan-nv200": 0.5,
                "renault-kangoo": 0.25,
            },
            "open_routes": True,
        },
    ),
    ScenarioSpec(
        id="mty-urgent-tw-120",
        name="Entregas urgentes, 120 paradas",
        description=(
            "Escenario exigente con 50 % de paradas con ventana de tiempo y 20 % de prioridad alta, "
            "10 repartidores."
        ),
        seed=104,
        generator_args={
            "n_stops": 120,
            "n_drivers": 10,
            "mode": "depot",
            "time_windows_pct": 0.5,
            "high_priority_pct": 0.2,
            "vehicle_mix": {"nissan-nv200": 0.5, "ford-transit-connect": 0.3, "ford-transit": 0.2},
        },
    ),
    ScenarioSpec(
        id="mty-dynamic-100",
        name="Pedidos dinámicos, 100 paradas",
        description=(
            "Cien paradas, 8 repartidores y 40 % de pedidos que aparecen durante la jornada, para "
            "probar la re-optimización."
        ),
        seed=105,
        generator_args={
            "n_stops": 100,
            "n_drivers": 8,
            "mode": "depot",
            "time_windows_pct": 0.25,
            "high_priority_pct": 0.1,
            "dynamic_pct": 0.4,
            "vehicle_mix": {"nissan-nv200": 0.5, "ford-transit-connect": 0.5},
        },
    ),
    ScenarioSpec(
        id="mty-motos-60",
        name="Motos y vans, 60 paradas",
        description=(
            "Flota heterogénea de 6 motos y 2 vans para 60 paradas, para mostrar el efecto de la "
            "capacidad y la velocidad por tipo de vehículo."
        ),
        seed=106,
        generator_args={
            "n_stops": 60,
            "n_drivers": 8,
            "mode": "depot",
            "time_windows_pct": 0.2,
            "high_priority_pct": 0.1,
            "vehicle_mix": {"italika-moto-reparto": 0.75, "nissan-nv200": 0.25},
        },
    ),
)


def build_scenario(spec: ScenarioSpec) -> Problem:
    return generate_problem(seed=spec.seed, name=spec.id, **spec.generator_args)


def write_scenarios(directory: Path = SCENARIOS_DIR) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for spec in SPECS:
        problem = build_scenario(spec)
        document = {
            "id": spec.id,
            "name": spec.name,
            "description": spec.description,
            "region": "mty",
            "problem": problem.model_dump(mode="json"),
        }
        target = directory / f"{spec.id}.json"
        target.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n")
        written.append(target)
    return written


def _read(scenario_id: str) -> dict[str, Any]:
    path = SCENARIOS_DIR / f"{scenario_id}.json"
    if not path.exists():
        raise KeyError(f"unknown scenario: {scenario_id}")
    document: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return document


def list_scenarios() -> list[ScenarioInfo]:
    infos: list[ScenarioInfo] = []
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        document = _read(path.stem)
        problem = Problem.model_validate(document["problem"])
        infos.append(
            ScenarioInfo(
                id=document["id"],
                name=document["name"],
                description=document["description"],
                n_stops=len(problem.stops),
                n_drivers=len(problem.drivers),
                mode=ProblemMode(problem.mode).value,
                region=document["region"],
            )
        )
    return infos


def load_scenario(scenario_id: str) -> Problem:
    return Problem.model_validate(_read(scenario_id)["problem"])
