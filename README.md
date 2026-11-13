# RouteOpt NL

Optimización de rutas de reparto para Nuevo León con algoritmos bioinspirados (GA y ACO), con un solver en Python y una interfaz en Next.js.

## Requisitos

- Python 3.12 y [uv](https://docs.astral.sh/uv/)
- Node.js 20+ y npm
- Docker (opcional, para el stack completo)

## Solver (services/solver)

```bash
cd services/solver
uv sync
uv run uvicorn routeopt.api.main:app --reload --port 8000
uv run pytest
```

Documentación interactiva de la API: http://localhost:8000/docs

## Web (apps/web)

```bash
cd apps/web
npm install
npm run dev
```

Abre http://localhost:3000. Para generar los tipos desde la API con el solver corriendo: `npm run gen:api`.

## Benchmarks

Instancias CVRP y Solomon con sus soluciones de referencia en `services/solver/data/benchmarks/` (ver el README de esa carpeta).
