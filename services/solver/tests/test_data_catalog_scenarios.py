from __future__ import annotations

import json
from pathlib import Path

import pytest

from routeopt.core.models import FuelType, Priority, Problem, ProblemMode
from routeopt.data.catalog import VEHICLES_PATH, get_vehicle, load_vehicles
from routeopt.data.generators.synthetic import generate_problem, load_points
from routeopt.data.scenarios import (
    SCENARIOS_DIR,
    SPECS,
    list_scenarios,
    load_scenario,
    write_scenarios,
)

EXPECTED_SCENARIOS = {
    "mty-centro-depot-40",
    "mty-metro-depot-150",
    "mty-multiorigin-80",
    "mty-urgent-tw-120",
    "mty-dynamic-100",
    "mty-motos-60",
}


def test_catalog_validates() -> None:
    vehicles = load_vehicles()
    assert 10 <= len(vehicles) <= 12
    assert len({v.id for v in vehicles}) == len(vehicles)
    for vehicle in vehicles:
        assert vehicle.source
        if vehicle.fuel_type == FuelType.ELECTRIC:
            assert vehicle.kwh_per_100km is not None
    raw = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
    assert len(raw) == len(vehicles)


def test_get_vehicle() -> None:
    assert get_vehicle("nissan-nv200").brand == "Nissan"
    with pytest.raises(KeyError):
        get_vehicle("nope")


def test_denue_points() -> None:
    points = load_points("mty")
    assert 10000 < len(points) < 20000
    assert len({(p.lat, p.lon) for p in points}) == len(points)
    assert len({p.municipality for p in points}) == 9


def test_scenarios_load_and_match_files() -> None:
    files = {p.stem for p in Path(SCENARIOS_DIR).glob("*.json")}
    assert files == EXPECTED_SCENARIOS == {s.id for s in SPECS}
    infos = {info.id: info for info in list_scenarios()}
    assert set(infos) == files
    for scenario_id in files:
        problem = load_scenario(scenario_id)
        assert isinstance(problem, Problem)
        assert problem.name == scenario_id
        assert infos[scenario_id].n_stops == len(problem.stops)
        assert infos[scenario_id].n_drivers == len(problem.drivers)


def test_scenario_specifics() -> None:
    multi = load_scenario("mty-multiorigin-80")
    assert multi.mode == ProblemMode.MULTI_ORIGIN
    assert all(d.start is not None and d.end is None for d in multi.drivers)
    dynamic = load_scenario("mty-dynamic-100")
    assert sum(s.release_min > 0 for s in dynamic.stops) == 40
    motos = load_scenario("mty-motos-60")
    kinds = [d.vehicle_type_id for d in motos.drivers]
    assert kinds.count("italika-moto-reparto") == 6
    assert len(kinds) - kinds.count("italika-moto-reparto") == 2
    centro = load_scenario("mty-centro-depot-40")
    assert all(s.tw_start_min is None for s in centro.stops)


def test_generator_deterministic() -> None:
    a = generate_problem(50, 5, "depot", seed=11)
    b = generate_problem(50, 5, "depot", seed=11)
    c = generate_problem(50, 5, "depot", seed=12)
    assert a == b
    assert a != c


def test_generator_percentages() -> None:
    n = 200
    problem = generate_problem(
        n, 10, "depot", seed=3, time_windows_pct=0.5, high_priority_pct=0.2, dynamic_pct=0.4
    )
    windowed = sum(s.tw_start_min is not None for s in problem.stops) / n
    high = sum(s.priority == Priority.HIGH for s in problem.stops) / n
    dynamic = sum(s.release_min > 0 for s in problem.stops) / n
    assert abs(windowed - 0.5) <= 0.05
    assert abs(high - 0.2) <= 0.05
    assert abs(dynamic - 0.4) <= 0.05
    locations = {(s.location.lat, s.location.lon) for s in problem.stops}
    assert len(locations) == n


def test_generator_demands_and_windows() -> None:
    problem = generate_problem(300, 5, "depot", seed=5, time_windows_pct=1.0)
    kgs = [s.demand_kg for s in problem.stops]
    assert 1.5 < sum(kgs) / len(kgs) < 4.0
    assert max(kgs) <= 25.0
    for stop in problem.stops:
        assert 2 <= stop.service_min <= 6
        assert stop.tw_start_min is not None and stop.tw_end_min is not None
        assert 120 <= stop.tw_end_min - stop.tw_start_min <= 180
        assert stop.tw_end_min <= 600


def test_generator_multi_origin_closed() -> None:
    problem = generate_problem(30, 4, "multi_origin", seed=9, open_routes=False)
    assert all(d.start is not None and d.end == d.start for d in problem.drivers)


def test_scenario_files_match_generator(tmp_path: Path) -> None:
    for written in write_scenarios(tmp_path):
        assert written.read_text(encoding="utf-8") == (SCENARIOS_DIR / written.name).read_text(
            encoding="utf-8"
        )
