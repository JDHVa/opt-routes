from __future__ import annotations

import csv
import io

from pydantic import ValidationError

from routeopt.core.models import Location, Priority, Solution, Stop

DAY_START_MIN = 8 * 60
STOP_COLUMNS = (
    "id",
    "lat",
    "lon",
    "address",
    "demand_kg",
    "demand_m3",
    "service_min",
    "tw_start",
    "tw_end",
    "priority",
)
REQUIRED_COLUMNS = ("id", "lat", "lon")
ITINERARY_COLUMNS = (
    "driver_id",
    "vehicle_type_id",
    "sequence",
    "stop_id",
    "arrival",
    "start_service",
    "departure",
    "late_min",
)
PRIORITY_ALIASES = {
    "low": Priority.LOW,
    "baja": Priority.LOW,
    "normal": Priority.NORMAL,
    "media": Priority.NORMAL,
    "high": Priority.HIGH,
    "alta": Priority.HIGH,
}


class CsvValidationError(ValueError):
    def __init__(self, errors: list[tuple[int, str]]) -> None:
        self.errors = errors
        super().__init__("; ".join(f"fila {row}: {message}" for row, message in errors))


def parse_clock(text: str) -> float:
    hours, separator, minutes = text.strip().partition(":")
    if not separator or not hours.isdigit() or not minutes.isdigit():
        raise ValueError(f"hora inválida '{text}', se espera HH:MM")
    h, m = int(hours), int(minutes)
    if h > 23 or m > 59:
        raise ValueError(f"hora fuera de rango '{text}'")
    return float(h * 60 + m - DAY_START_MIN)


def format_clock(minutes_from_day_start: float) -> str:
    total = round(minutes_from_day_start) + DAY_START_MIN
    return f"{total // 60 % 24:02d}:{total % 60:02d}"


def _optional_float(row: dict[str, str], column: str, default: float) -> float:
    raw = (row.get(column) or "").strip()
    return float(raw) if raw else default


def _optional_clock(row: dict[str, str], column: str) -> float | None:
    raw = (row.get(column) or "").strip()
    if not raw:
        return None
    value = parse_clock(raw)
    if value < 0:
        raise ValueError(f"{column} anterior a las 08:00")
    return value


def _parse_priority(row: dict[str, str]) -> Priority:
    raw = (row.get("priority") or "").strip().lower()
    if not raw:
        return Priority.NORMAL
    if raw not in PRIORITY_ALIASES:
        raise ValueError(f"prioridad desconocida '{raw}'")
    return PRIORITY_ALIASES[raw]


def _parse_row(row: dict[str, str]) -> Stop:
    for column in REQUIRED_COLUMNS:
        if not (row.get(column) or "").strip():
            raise ValueError(f"falta la columna obligatoria '{column}'")
    address = (row.get("address") or "").strip() or None
    defaults = Stop.model_fields
    return Stop(
        id=row["id"].strip(),
        location=Location(lat=float(row["lat"]), lon=float(row["lon"]), address=address),
        demand_kg=_optional_float(row, "demand_kg", float(defaults["demand_kg"].default)),
        demand_m3=_optional_float(row, "demand_m3", float(defaults["demand_m3"].default)),
        service_min=_optional_float(row, "service_min", float(defaults["service_min"].default)),
        tw_start_min=_optional_clock(row, "tw_start"),
        tw_end_min=_optional_clock(row, "tw_end"),
        priority=_parse_priority(row),
    )


def stops_from_csv(text: str) -> list[Stop]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    header = [name.strip() for name in (reader.fieldnames or [])]
    missing = [column for column in REQUIRED_COLUMNS if column not in header]
    if missing:
        raise CsvValidationError([(1, f"faltan columnas obligatorias: {', '.join(missing)}")])
    stops: list[Stop] = []
    errors: list[tuple[int, str]] = []
    seen: dict[str, int] = {}
    for row in reader:
        line = reader.line_num
        normalized = {(key or "").strip(): (value or "") for key, value in row.items()}
        try:
            stop = _parse_row(normalized)
        except (ValueError, ValidationError) as error:
            errors.append((line, _short_message(error)))
            continue
        if stop.id in seen:
            errors.append((line, f"id duplicado '{stop.id}' (fila {seen[stop.id]})"))
            continue
        seen[stop.id] = line
        stops.append(stop)
    if errors:
        raise CsvValidationError(errors)
    if not stops:
        raise CsvValidationError([(1, "el archivo no contiene paradas")])
    return stops


def _short_message(error: Exception) -> str:
    if isinstance(error, ValidationError):
        first = error.errors()[0]
        location = ".".join(str(part) for part in first["loc"])
        return f"{location}: {first['msg']}"
    return str(error)


def stops_to_csv(stops: list[Stop]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(STOP_COLUMNS)
    for stop in stops:
        writer.writerow(
            [
                stop.id,
                stop.location.lat,
                stop.location.lon,
                stop.location.address or "",
                stop.demand_kg,
                stop.demand_m3,
                stop.service_min,
                "" if stop.tw_start_min is None else format_clock(stop.tw_start_min),
                "" if stop.tw_end_min is None else format_clock(stop.tw_end_min),
                stop.priority.value,
            ]
        )
    return buffer.getvalue()


def solution_to_csv(solution: Solution) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(ITINERARY_COLUMNS)
    for route in solution.routes:
        for position, visit in enumerate(route.visits, start=1):
            writer.writerow(
                [
                    route.driver_id,
                    route.vehicle_type_id,
                    position,
                    visit.stop_id,
                    format_clock(visit.arrival_min),
                    format_clock(visit.start_service_min),
                    format_clock(visit.departure_min),
                    f"{visit.late_min:.1f}",
                ]
            )
    return buffer.getvalue()
