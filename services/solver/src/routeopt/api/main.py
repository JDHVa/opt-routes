from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from routeopt.api.routes import catalog, compare, csv_io, geometry, health, simulate, solve
from routeopt.api.runner import ApiError, SolveLimiter, warm_up
from routeopt.api.schemas import ErrorPayload
from routeopt.api.settings import Settings
from routeopt.distances.service import get_distance_service

logger = logging.getLogger("routeopt.api")

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED})
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    root = logging.getLogger("routeopt")
    if root.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root.propagate = False


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    payload = ErrorPayload(code=code, message=message)
    return JSONResponse(status_code=status_code, content=payload.model_dump())


def _summarize(error: RequestValidationError) -> str:
    parts = []
    for item in error.errors()[:5]:
        location = ".".join(str(part) for part in item["loc"] if part != "body")
        parts.append(f"{location}: {item['msg']}" if location else str(item["msg"]))
    return "; ".join(parts)


def create_app(settings: Settings | None = None) -> FastAPI:
    configure_logging()
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if resolved.warmup:
            await warm_up(get_distance_service())
        yield
        await get_distance_service().aclose()

    app = FastAPI(title="RouteOpt NL solver", version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved
    app.state.limiter = SolveLimiter(resolved.max_concurrent_solves)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.allowed_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, error: ApiError) -> JSONResponse:
        return _error_response(error.status_code, error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, error: RequestValidationError) -> JSONResponse:
        return _error_response(422, "validation_error", _summarize(error))

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return _error_response(error.status_code, "http_error", str(error.detail))

    @app.exception_handler(Exception)
    async def unhandled_handler(_: Request, error: Exception) -> JSONResponse:
        logger.exception("unhandled error", exc_info=error)
        return _error_response(500, "internal_error", "internal server error")

    for module in (health, catalog, solve, compare, geometry, csv_io, simulate):
        app.include_router(module.router)
    return app


app = create_app()
