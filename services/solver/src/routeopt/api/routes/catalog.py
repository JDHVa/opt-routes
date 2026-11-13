from __future__ import annotations

from fastapi import APIRouter

from routeopt.algorithms import SOLVERS
from routeopt.api.runner import ApiError
from routeopt.api.schemas import AlgorithmInfo, ErrorPayload, ScenarioInfo, VehicleCatalog
from routeopt.core.models import Problem
from routeopt.data.catalog import load_vehicles
from routeopt.data.scenarios import list_scenarios, load_scenario

router = APIRouter()


@router.get("/algorithms", response_model=list[AlgorithmInfo])
def algorithms() -> list[AlgorithmInfo]:
    return [
        AlgorithmInfo(
            name=cls.name,
            label=cls.label,
            multi_objective=cls.multi_objective,
            params_schema=cls.params_model.model_json_schema(),
        )
        for cls in SOLVERS.values()
    ]


@router.get("/vehicles", response_model=VehicleCatalog)
def vehicles() -> VehicleCatalog:
    return VehicleCatalog(vehicles=load_vehicles())


@router.get("/scenarios", response_model=list[ScenarioInfo])
def scenarios() -> list[ScenarioInfo]:
    return list_scenarios()


@router.get(
    "/scenarios/{scenario_id}",
    response_model=Problem,
    responses={404: {"model": ErrorPayload}},
)
def scenario(scenario_id: str) -> Problem:
    try:
        return load_scenario(scenario_id)
    except KeyError as error:
        raise ApiError(404, "not_found", f"unknown scenario: {scenario_id}") from error
