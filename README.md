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

## OSRM local

El solver usa OSRM para distancias y geometría de calles; si no responde, cae a haversine y a línea recta. Los datos de Nuevo León se preparan una sola vez (descarga el extracto de México de Geofabrik, lo recorta con osmium en Docker y ejecuta `osrm-extract`, `osrm-partition` y `osrm-customize`):

```bash
bash infra/osrm/prepare.sh
docker compose up osrm
```

Los datos quedan en `infra/osrm/data/` (ignorado por git). Con `KEEP_RAW=1` se conserva el extracto de México; `BBOX` (`lon_min,lat_min,lon_max,lat_max`) ajusta el recorte. Verificación:

```bash
curl "http://localhost:5000/table/v1/driving/-100.3161,25.6866;-100.4022,25.6573?annotations=distance,duration"
curl "http://localhost:5000/route/v1/driving/-100.3161,25.6866;-100.4022,25.6573?overview=full&geometries=geojson"
```

El solver lee `OSRM_URL` (por defecto `http://localhost:5000`), `OSRM_TIMEOUT_S` y `OSRM_MAX_TABLE`. Para Cloud Run, `infra/osrm/Dockerfile` empaqueta los datos preprocesados (contexto de build `infra/osrm`). Mapa © OpenStreetMap contributors (ODbL).
