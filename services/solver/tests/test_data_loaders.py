from __future__ import annotations

from pathlib import Path

import pytest

from routeopt.core.models import (
    DistanceSource,
    Route,
    RouteMetrics,
    Solution,
    SolutionMetrics,
    Visit,
)
from routeopt.data.generators.synthetic import generate_problem
from routeopt.data.loaders.amazon import (
    amazon_actual_sequence,
    list_amazon_routes,
    load_amazon_route,
)
from routeopt.data.loaders.csv_io import (
    CsvValidationError,
    solution_to_csv,
    stops_from_csv,
    stops_to_csv,
)

SAMPLE_DIR = Path(__file__).resolve().parents[1] / "data" / "amazon_sample"
SAMPLE_STOPS = Path(__file__).resolve().parents[1] / "src/routeopt/data/nl/sample_stops.csv"


def test_csv_roundtrip() -> None:
    stops = generate_problem(40, 3, "depot", seed=21, time_windows_pct=0.5).stops
    assert stops_from_csv(stops_to_csv(stops)) == stops


def test_csv_defaults() -> None:
    stops = stops_from_csv("id,lat,lon\na,25.6,-100.3\nb,25.7,-100.2\n")
    assert [s.id for s in stops] == ["a", "b"]
    assert stops[0].demand_kg == 1.0
    assert stops[0].tw_start_min is None


def test_csv_time_windows_and_priority() -> None:
    text = "id,lat,lon,tw_start,tw_end,priority\na,25.6,-100.3,09:00,11:30,ALTA\n"
    stop = stops_from_csv(text)[0]
    assert stop.tw_start_min == 60
    assert stop.tw_end_min == 210
    assert stop.priority.value == "high"


def test_csv_errors_report_row_numbers() -> None:
    text = (
        "id,lat,lon,tw_start,tw_end\n"
        "a,25.6,-100.3,,\n"
        "b,abc,-100.3,,\n"
        "c,25.6,-100.3,25:00,\n"
        "d,25.6,-100.3,12:00,10:00\n"
        "a,25.6,-100.3,,\n"
    )
    with pytest.raises(CsvValidationError) as info:
        stops_from_csv(text)
    rows = [row for row, _ in info.value.errors]
    assert rows == [3, 4, 5, 6]
    assert "fila 3" in str(info.value)


def test_csv_missing_columns() -> None:
    with pytest.raises(CsvValidationError):
        stops_from_csv("id,lat\na,25.6\n")


def test_sample_stops_file() -> None:
    stops = stops_from_csv(SAMPLE_STOPS.read_text(encoding="utf-8"))
    assert len(stops) == 12


def test_solution_to_csv() -> None:
    metrics = RouteMetrics(
        distance_km=1,
        duration_min=1,
        start_min=0,
        end_min=1,
        load_kg=1,
        load_m3=1,
        cost_mxn=1,
        lateness_min=0,
        overtime_min=0,
    )
    route = Route(
        driver_id="d01",
        vehicle_type_id="nissan-nv200",
        visits=[
            Visit(stop_id="s1", arrival_min=0, start_service_min=5, departure_min=8),
            Visit(stop_id="s2", arrival_min=75, start_service_min=75, departure_min=80, late_min=2),
        ],
        metrics=metrics,
    )
    solution = Solution(
        algorithm="ga",
        routes=[route],
        metrics=SolutionMetrics(
            total_distance_km=1,
            total_duration_min=1,
            makespan_min=1,
            vehicles_used=1,
            total_cost_mxn=1,
            lateness_min=0,
            overload_kg=0,
            overload_m3=0,
            overtime_min=0,
            unassigned=0,
            feasible=True,
            fitness=1,
        ),
        runtime_s=0.1,
    )
    lines = solution_to_csv(solution).strip().splitlines()
    assert lines[0].startswith("driver_id,vehicle_type_id,sequence")
    assert lines[1].split(",")[3:7] == ["s1", "08:00", "08:05", "08:08"]
    assert lines[2].split(",")[4] == "09:15"


def test_amazon_sample() -> None:
    routes = list_amazon_routes(SAMPLE_DIR)
    assert len(routes) == 3
    for route_id in routes:
        problem = load_amazon_route(SAMPLE_DIR, route_id)
        assert problem.distance_source == DistanceSource.PROVIDED
        assert problem.matrix is not None
        size = len(problem.stops) + 1
        assert len(problem.matrix.duration_min) == size
        assert problem.matrix.node_ids[-1] == problem.depot_id
        assert len(problem.drivers) == 1
        assert problem.vehicle_types[0].volume_m3 > 1
        assert all(s.tw_start_min is None or s.tw_start_min >= 0 for s in problem.stops)
        sequence = amazon_actual_sequence(SAMPLE_DIR, route_id)
        assert sorted(sequence) == sorted(s.id for s in problem.stops)
    assert any(
        s.tw_start_min is not None
        for route_id in routes
        for s in load_amazon_route(SAMPLE_DIR, route_id).stops
    )
