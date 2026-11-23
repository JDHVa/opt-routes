FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/app/.numba_cache \
    NUMBA_CPU_NAME=generic \
    WARMUP=0

WORKDIR /app

COPY pyproject.toml uv.lock .python-version README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

RUN python -c "import asyncio; from routeopt.api.runner import warm_up; from routeopt.distances.service import get_distance_service; asyncio.run(warm_up(get_distance_service()))"

RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn routeopt.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
