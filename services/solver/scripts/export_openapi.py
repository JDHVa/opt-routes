from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from routeopt.api import schemas
from routeopt.core.models import Problem, Solution


def contract_app() -> FastAPI:
    app = FastAPI(title="RouteOpt NL Solver")

    @app.get("/algorithms", response_model=list[schemas.AlgorithmInfo])
    def algorithms() -> Any: ...

    @app.get("/vehicles", response_model=schemas.VehicleCatalog)
    def vehicles() -> Any: ...

    @app.get("/scenarios", response_model=list[schemas.ScenarioInfo])
    def scenarios() -> Any: ...

    @app.get("/scenarios/{scenario_id}", response_model=Problem)
    def scenario(scenario_id: str) -> Any: ...

    @app.post("/solve", response_model=schemas.SolveResponse)
    def solve(body: schemas.SolveRequest) -> Any: ...

    @app.post("/compare", response_model=schemas.CompareResponse)
    def compare(body: schemas.CompareRequest) -> Any: ...

    @app.post("/matrix", response_model=schemas.MatrixResponse)
    def matrix(body: schemas.MatrixRequest) -> Any: ...

    @app.post("/geometry", response_model=schemas.GeometryResponse)
    def geometry(body: schemas.GeometryRequest) -> Any: ...

    @app.post("/_types/progress", response_model=schemas.ProgressPayload)
    def progress_type() -> Any: ...

    @app.post("/_types/error", response_model=schemas.ErrorPayload)
    def error_type() -> Any: ...

    @app.post("/_types/sim-client", response_model=schemas.SimClientMessage)
    def sim_client_type() -> Any: ...

    @app.post("/_types/sim-server", response_model=schemas.SimServerMessage)
    def sim_server_type() -> Any: ...

    @app.post("/_types/solution", response_model=Solution)
    def solution_type() -> Any: ...

    return app


def load_app() -> FastAPI:
    try:
        module = importlib.import_module("routeopt.api.main")
    except ModuleNotFoundError:
        return contract_app()
    app = module.app
    assert isinstance(app, FastAPI)
    return app


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.json")
    out.write_text(json.dumps(load_app().openapi(), indent=2))
    print(out)


if __name__ == "__main__":
    main()
