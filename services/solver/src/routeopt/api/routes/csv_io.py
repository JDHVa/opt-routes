from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from routeopt.core.models import Solution, Stop
from routeopt.data.loaders.csv_io import CsvValidationError, solution_to_csv, stops_from_csv

router = APIRouter()


class ImportCsvRequest(BaseModel):
    text: str


class CsvRowError(BaseModel):
    row: int
    message: str


class CsvErrorResponse(BaseModel):
    code: str
    message: str
    rows: list[CsvRowError]


class ImportCsvResponse(BaseModel):
    stops: list[Stop]


class ExportCsvRequest(BaseModel):
    solution: Solution


@router.post(
    "/import/csv",
    response_model=ImportCsvResponse,
    responses={422: {"model": CsvErrorResponse}},
)
def import_csv(body: ImportCsvRequest) -> ImportCsvResponse | JSONResponse:
    try:
        return ImportCsvResponse(stops=stops_from_csv(body.text))
    except CsvValidationError as error:
        payload = CsvErrorResponse(
            code="csv_invalid",
            message=str(error),
            rows=[CsvRowError(row=row, message=message) for row, message in error.errors],
        )
        return JSONResponse(status_code=422, content=payload.model_dump())


@router.post(
    "/export/csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string"}}}}},
)
def export_csv(body: ExportCsvRequest) -> Response:
    return Response(content=solution_to_csv(body.solution), media_type="text/csv")
