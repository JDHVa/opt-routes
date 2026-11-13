from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import AsyncIterator
from typing import Any, ClassVar

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from routeopt.algorithms.base import (
    SOLVERS,
    ProgressCallback,
    ProgressEvent,
    SolveResult,
    Solver,
    SolverParams,
)
from routeopt.api.main import create_app
from routeopt.api.schemas import (
    AlgorithmRun,
    CompareRequest,
    ProgressPayload,
    SolveRequest,
    SolveResponse,
)
from routeopt.api.settings import Settings
from routeopt.core.construct import nearest_neighbor
from routeopt.core.evaluate import evaluate
from routeopt.core.models import DistanceSource, Problem
from routeopt.core.types import Instance, Penalties, RouteSet
from routeopt.data.scenarios import load_scenario


class SlowSolver(Solver):
    name: ClassVar[str] = "slow"
    label: ClassVar[str] = "Slow"
    params_model: ClassVar[type[SolverParams]] = SolverParams
    finished: ClassVar[threading.Event] = threading.Event()

    def solve(
        self,
        inst: Instance,
        callback: ProgressCallback | None = None,
        warm_start: list[RouteSet] | None = None,
        state: dict[str, Any] | None = None,
        penalties: Penalties | None = None,
    ) -> SolveResult:
        routes = nearest_neighbor(inst)
        ev = evaluate(inst, routes)
        started = time.perf_counter()
        iteration = 0
        while time.perf_counter() - started < 20.0:
            iteration += 1
            event = ProgressEvent(
                iteration=iteration,
                elapsed_s=time.perf_counter() - started,
                best_fitness=ev.fitness,
                best_eval=ev,
                best=routes,
            )
            if callback is not None and not callback(event):
                break
            time.sleep(0.02)
        SlowSolver.finished.set()
        return SolveResult(
            algorithm=self.name,
            best=routes,
            evaluation=ev,
            runtime_s=time.perf_counter() - started,
            iterations=iteration,
            history=[(iteration, 0.0, ev.fitness)],
        )


@pytest.fixture(autouse=True)
def slow_solver(monkeypatch: pytest.MonkeyPatch) -> None:
    SlowSolver.finished = threading.Event()
    monkeypatch.setitem(SOLVERS, "slow", SlowSolver)


def small_problem() -> Problem:
    base = load_scenario("mty-centro-depot-40")
    return base.model_copy(
        update={
            "stops": base.stops[:12],
            "drivers": base.drivers[:2],
            "distance_source": DistanceSource.HAVERSINE,
        }
    )


def make_app(limit: int = 2) -> FastAPI:
    return create_app(Settings(warmup=False, max_concurrent_solves=limit, max_time_limit_s=30.0))


def solve_payload(algorithm: str, **params: Any) -> dict[str, Any]:
    request = SolveRequest(
        problem=small_problem(), run=AlgorithmRun(algorithm=algorithm, params=params)
    )
    return request.model_dump(mode="json")


async def read_events(response: httpx.Response) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    name = ""
    async for line in response.aiter_lines():
        if line.startswith("event:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            events.append((name, json.loads(line.split(":", 1)[1])))
    return events


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_app()), base_url="http://test"
    ) as http:
        yield http


@pytest.mark.asyncio
async def test_solve_stream_progress_then_one_result(client: httpx.AsyncClient) -> None:
    payload = solve_payload("ga", time_limit_s=2.0, seed=1, progress_every=1)
    async with client.stream("POST", "/solve/stream", json=payload, timeout=30) as response:
        assert response.status_code == 200
        events = await read_events(response)
    names = [name for name, _ in events]
    assert names.count("result") == 1
    assert names.count("progress") >= 1
    assert names[-1] == "result"
    assert names.index("progress") < names.index("result")
    ProgressPayload.model_validate(next(data for name, data in events if name == "progress"))
    SolveResponse.model_validate(events[-1][1])


@pytest.mark.asyncio
async def test_compare_stream_has_run_indices(client: httpx.AsyncClient) -> None:
    body = CompareRequest(
        problem=small_problem(),
        runs=[
            AlgorithmRun(algorithm="ga", params={"time_limit_s": 1.0, "seed": 1}),
            AlgorithmRun(algorithm="ga", params={"time_limit_s": 1.0, "seed": 2}),
        ],
    ).model_dump(mode="json")
    async with client.stream("POST", "/compare/stream", json=body, timeout=60) as response:
        events = await read_events(response)
    result_indices = [data["run_index"] for name, data in events if name == "result"]
    assert result_indices == [0, 1]
    assert any(name == "progress" and data["run_index"] == 0 for name, data in events)
    complete = next(data for name, data in events if name == "complete")
    assert len(complete["entries"]) == 2
    assert min(entry["gap_pct"] for entry in complete["entries"]) == 0.0


@pytest.mark.asyncio
async def test_compare_non_stream(client: httpx.AsyncClient) -> None:
    body = CompareRequest(
        problem=small_problem(),
        runs=[AlgorithmRun(algorithm="ga", params={"time_limit_s": 1.0, "seed": 1})],
    ).model_dump(mode="json")
    response = await client.post("/compare", json=body, timeout=60)
    assert response.status_code == 200
    assert len(response.json()["entries"]) == 1


@pytest.mark.asyncio
async def test_busy_returns_429_and_busy_event() -> None:
    app = make_app(limit=1)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        first = asyncio.create_task(
            http.post("/solve", json=solve_payload("ga", time_limit_s=2.0, seed=1), timeout=30)
        )
        await asyncio.sleep(0.5)
        second = await http.post("/solve", json=solve_payload("ga", time_limit_s=1.0))
        assert second.status_code == 429
        assert second.json()["code"] == "busy"
        async with http.stream(
            "POST", "/solve/stream", json=solve_payload("ga", time_limit_s=1.0)
        ) as response:
            events = await read_events(response)
        assert events[0][0] == "error"
        assert events[0][1]["code"] == "busy"
        assert (await first).status_code == 200
        again = await http.post("/solve", json=solve_payload("ga", time_limit_s=1.0, seed=3))
        assert again.status_code == 200


@pytest.mark.asyncio
async def test_client_disconnect_cancels_solver_thread() -> None:
    app = make_app()
    body = json.dumps(solve_payload("slow")).encode()
    disconnected = asyncio.Event()
    delivered = False

    async def receive() -> dict[str, Any]:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.body" and b"progress" in message.get("body", b""):
            disconnected.set()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/solve/stream",
        "raw_path": b"/solve/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
        "client": ("test", 1),
        "server": ("test", 80),
    }
    started = time.perf_counter()
    await asyncio.wait_for(app(scope, receive, send), timeout=15)
    assert await asyncio.to_thread(SlowSolver.finished.wait, 5.0)
    assert time.perf_counter() - started < 10.0
