from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from routeopt.api.main import create_app
from routeopt.api.schemas import (
    AlgorithmRun,
    SimClientAddOrder,
    SimClientStart,
    SimServerDone,
    SimServerReoptimized,
    SimServerTick,
    SimulationConfig,
    TriggerMode,
)
from routeopt.api.settings import Settings
from routeopt.core.models import DistanceSource, Problem
from routeopt.data.scenarios import load_scenario


def sim_problem() -> Problem:
    base = load_scenario("mty-centro-depot-40")
    release = {8: 15.0, 9: 30.0}
    stops = [
        stop.model_copy(update={"release_min": release.get(i, 0.0)})
        for i, stop in enumerate(base.stops[:10])
    ]
    return base.model_copy(
        update={
            "stops": stops,
            "drivers": base.drivers[:2],
            "distance_source": DistanceSource.HAVERSINE,
        }
    )


def start_message(trigger: TriggerMode = TriggerMode.EVENT) -> dict[str, Any]:
    config = SimulationConfig(
        problem=sim_problem(),
        run=AlgorithmRun(
            algorithm="ga", params={"time_limit_s": 1.0, "max_iterations": 10, "seed": 1}
        ),
        speed=120.0,
        trigger=trigger,
        batch_minutes=10.0,
        reopt_time_limit_s=0.3,
    )
    return SimClientStart(config=config).model_dump(mode="json")


def test_full_websocket_simulation() -> None:
    app = create_app(Settings(warmup=False, sim_tick_s=0.05))
    problem = sim_problem()
    extra = problem.stops[0].model_copy(update={"id": "late-client-order", "release_min": 0.0})
    types: list[str] = []
    reasons: list[str] = []
    delivered: set[str] = set()
    done: dict[str, Any] | None = None
    with TestClient(app) as client, client.websocket_connect("/simulate") as ws:
        ws.send_json(start_message())
        sent = False
        for _ in range(2000):
            message = ws.receive_json()
            types.append(message["type"])
            if message["type"] == "reoptimized":
                SimServerReoptimized.model_validate(message)
                reasons.append(message["reason"])
            if message["type"] == "tick":
                SimServerTick.model_validate(message)
                delivered.update(message["delivered_stop_ids"])
                if not sent:
                    ws.send_json(SimClientAddOrder(stop=extra).model_dump(mode="json"))
                    sent = True
            if message["type"] == "done":
                done = message
                break
            assert message["type"] != "error", message
    assert done is not None
    SimServerDone.model_validate(done)
    assert types[0] == "reoptimized"
    assert reasons[0] == "initial"
    assert "tick" in types
    assert "order" in types
    assert "event" in reasons
    assert types.index("order") < len(types) - 1
    assert delivered == {s.id for s in problem.stops} | {"late-client-order"}
    assert done["metrics"]["unassigned"] == 0


def test_websocket_rejects_non_start_first_message() -> None:
    app = create_app(Settings(warmup=False, sim_tick_s=0.05))
    with TestClient(app) as client, client.websocket_connect("/simulate") as ws:
        ws.send_json({"type": "pause"})
        message = ws.receive_json()
    assert message["type"] == "error"
    assert message["error"]["code"] == "invalid_request"


def test_websocket_unknown_algorithm_reports_error() -> None:
    app = create_app(Settings(warmup=False, sim_tick_s=0.05))
    message = start_message()
    message["config"]["run"]["algorithm"] = "nope"
    with TestClient(app) as client, client.websocket_connect("/simulate") as ws:
        ws.send_json(message)
        reply = ws.receive_json()
    assert reply["type"] == "error"
    assert reply["error"]["code"] == "unknown_algorithm"
