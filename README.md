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

## Datos y atribuciones

- **DENUE (INEGI):** los puntos de entrega de Monterrey provienen de una muestra estratificada de ~15,000 establecimientos del Directorio Estadístico Nacional de Unidades Económicas (descarga masiva de Nuevo León, edición vigente), datos abiertos con atribución a INEGI.
- **OpenStreetMap:** © OpenStreetMap contributors (ODbL), usado para el ruteo y el mapa.
- **Amazon Last Mile Routing Research Challenge:** la muestra de 3 rutas en `services/solver/data/amazon_sample/` es material de Amazon.com, Inc. y el MIT Center for Transportation & Logistics (MIT CTL), bajo licencia CC BY-NC 4.0 (solo uso no comercial).
- **Catálogo de vehículos:** las especificaciones no confirmadas con ficha oficial llevan `approx: true` y la URL de referencia en `source`.
