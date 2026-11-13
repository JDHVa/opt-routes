from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import pytest_asyncio

from routeopt.api.main import create_app
from routeopt.api.schemas import (
    AlgorithmInfo,
    AlgorithmRun,
    ScenarioInfo,
    SolveRequest,
    SolveResponse,
    VehicleCatalog,
)
from routeopt.api.settings import Settings
from routeopt.core.models import DistanceSource, Problem
from routeopt.data.scenarios import load_scenario


def haversine_problem(scenario: str = "mty-centro-depot-40") -> Problem:
    return load_scenario(scenario).model_copy(update={"distance_source": DistanceSource.HAVERSINE})


def solve_body(problem: Problem, algorithm: str = "ga", **params: Any) -> dict[str, Any]:
    request = SolveRequest(
        problem=problem, run=AlgorithmRun(algorithm=algorithm, params=params)
    )
    return request.model_dump(mode="json")


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(Settings(warmup=False, max_time_limit_s=30.0))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


@pytest.mark.asyncio
async def test_health(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["osrm"], bool)


@pytest.mark.asyncio
async def test_algorithms(client: httpx.AsyncClient) -> None:
    response = await client.get("/algorithms")
    assert response.status_code == 200
    infos = [AlgorithmInfo.model_validate(item) for item in response.json()]
    names = {info.name for info in infos}
    assert {"ga", "aco", "nsga2", "pyvrp", "ortools"} <= names
    for info in infos:
        assert "properties" in info.params_schema


@pytest.mark.asyncio
async def test_vehicles_and_scenarios(client: httpx.AsyncClient) -> None:
    vehicles = VehicleCatalog.model_validate((await client.get("/vehicles")).json())
    assert vehicles.vehicles
    scenarios = [
        ScenarioInfo.model_validate(item) for item in (await client.get("/scenarios")).json()
    ]
    assert "mty-centro-depot-40" in {s.id for s in scenarios}
    detail = await client.get("/scenarios/mty-centro-depot-40")
    assert Problem.model_validate(detail.json()).name
    missing = await client.get("/scenarios/nope")
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


@pytest.mark.asyncio
async def test_solve_returns_valid_solution(client: httpx.AsyncClient) -> None:
    problem = haversine_problem()
    response = await client.post(
        "/solve", json=solve_body(problem, time_limit_s=2.0, seed=1), timeout=30
    )
    assert response.status_code == 200
    result = SolveResponse.model_validate(response.json())
    routed = [v.stop_id for route in result.solution.routes for v in route.visits]
    everything = routed + result.solution.unassigned_stop_ids
    assert sorted(everything) == sorted(stop.id for stop in problem.stops)
    assert len(set(everything)) == len(everything)
    assert result.history
    assert all(route.geometry for route in result.solution.routes)


@pytest.mark.asyncio
async def test_solve_nsga2_returns_pareto(client: httpx.AsyncClient) -> None:
    problem = haversine_problem()
    response = await client.post(
        "/solve",
        json=solve_body(problem, "nsga2", time_limit_s=2.0, max_iterations=5, seed=1),
        timeout=30,
    )
    assert response.status_code == 200
    result = SolveResponse.model_validate(response.json())
    assert result.pareto
    assert set(result.pareto[0].objectives) == {"time", "cost", "vehicles", "makespan"}


@pytest.mark.asyncio
async def test_unknown_algorithm_is_422(client: httpx.AsyncClient) -> None:
    response = await client.post("/solve", json=solve_body(haversine_problem(), "nope"))
    assert response.status_code == 422
    assert response.json()["code"] == "unknown_algorithm"


@pytest.mark.asyncio
async def test_invalid_params_is_422(client: httpx.AsyncClient) -> None:
    response = await client.post("/solve", json=solve_body(haversine_problem(), pop_size="x"))
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_params"


@pytest.mark.asyncio
async def test_excessive_time_limit_is_422(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/solve", json=solve_body(haversine_problem(), time_limit_s=500.0)
    )
    assert response.status_code == 422
    assert response.json()["code"] == "time_limit_exceeded"


@pytest.mark.asyncio
async def test_malformed_body_is_uniform_422(client: httpx.AsyncClient) -> None:
    response = await client.post("/solve", json={"problem": {}})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_matrix_and_geometry(client: httpx.AsyncClient) -> None:
    points = [{"lat": 25.67, "lon": -100.31}, {"lat": 25.70, "lon": -100.29}]
    matrix = await client.post("/matrix", json={"points": points})
    assert matrix.status_code == 200
    assert len(matrix.json()["distance_km"]) == 2
    geometry = await client.post("/geometry", json={"points": points})
    assert geometry.status_code == 200
    assert len(geometry.json()["geometry"]) >= 2


@pytest.mark.asyncio
async def test_csv_roundtrip_and_errors(client: httpx.AsyncClient) -> None:
    text = "id,lat,lon\nA,25.67,-100.31\nB,25.68,-100.30\n"
    imported = await client.post("/import/csv", json={"text": text})
    assert imported.status_code == 200
    assert [s["id"] for s in imported.json()["stops"]] == ["A", "B"]
    broken = await client.post("/import/csv", json={"text": "id,lat,lon\nA,x,-100.3\n"})
    assert broken.status_code == 422
    assert broken.json()["rows"][0]["row"] == 2
    problem = haversine_problem()
    solved = await client.post(
        "/solve", json=solve_body(problem, time_limit_s=1.0, seed=1, max_iterations=20), timeout=30
    )
    exported = await client.post(
        "/export/csv", json={"solution": solved.json()["solution"]}
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert exported.text.count("\n") > len(problem.stops)
