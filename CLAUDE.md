# RouteOpt NL

Optimización de rutas de reparto de última milla con algoritmos bioinspirados: GA memético, ACO (MMAS), el híbrido ACO+GA, K-means como paso previo y NSGA-II multiobjetivo. Tiene dos modos (depósito único y multi-origen) y dos ejecuciones (estática y dinámica). La región demo es el área metropolitana de Monterrey, Nuevo León. Es un proyecto escolar y de portafolio.

Plan aprobado: `/home/jdhva/.claude/plans/greedy-dreaming-kite.md`. La guía visual está en `DESIGN.md` (obligatoria para todo el frontend).

## Reglas de oro
1. **Cero comentarios y cero docstrings en el código.** Exentos: archivos generados (`apps/web/src/lib/api/schema.d.ts`, `openapi.json`), que nunca se editan a mano. Aplica a Python, TS/TSX, CSS, Dockerfile, YAML y TOML. El código se explica con buenos nombres, tipos y funciones pequeñas. La documentación vive solo en `CLAUDE.md`, `DESIGN.md` y `README.md`. Al revisar, cualquier comentario es motivo de rechazo.
2. **Los contratos no se modifican sin el arquitecto (Opus).** Si un contrato no alcanza, el agente lo reporta en su entrega en vez de cambiarlo.
3. **Un agente solo toca los archivos que su prompt le asigna.**
4. **No se agregan dependencias** sin declararlas en la entrega.
5. **Todo se tipa:** mypy limpio en Python y `strict` en TS. Sin `any` salvo justificación en la entrega.
6. **Nada de texto de UI hardcodeado:** todo pasa por `next-intl` (`messages/es.json` y `messages/en.json`).
7. **Determinismo:** con la misma `seed`, mismo resultado. Toda aleatoriedad usa `np.random.Generator` creado desde `params.seed`.

## Estructura
```
apps/web/                 Next.js App Router + TS + Tailwind → Vercel
  src/app/[locale]/       páginas
  src/app/api/            route handlers Node (BFF/proxy al solver, zod, rate-limit)
  src/components/         map/, panels/, charts/, ui/
  src/lib/api/schema.d.ts tipos generados (npm run gen:api), nunca editar a mano
  messages/{es,en}.json
services/solver/          Python 3.12 + uv + FastAPI → Cloud Run
  src/routeopt/core/      models.py*, types.py*, instance.py, evaluate.py, split.py
  src/routeopt/algorithms/ base.py*, ga.py, aco.py, hybrid.py, nsga2.py, clustering.py, local_search.py, init.py
  src/routeopt/baselines/ pyvrp_solver.py, ortools_solver.py
  src/routeopt/dynamic/   simulator.py, reoptimizer.py
  src/routeopt/distances/ osrm.py, haversine.py, cache.py, service.py
  src/routeopt/data/      vehicles.json, scenarios/*.json, loaders/, generators/
  src/routeopt/api/       schemas.py*, main.py, routes/
  data/benchmarks/        CVRPLIB + Solomon (.vrp/.sol)
  tests/  scripts/
infra/osrm/               preparación del extracto OSM de Nuevo León (MLD)
docker-compose.yml
```
`*` = contrato del arquitecto.

## Unidades
Distancia en **km**, tiempo en **minutos** desde el inicio del día (t = 0), dinero en **MXN**, peso en **kg** y volumen en **m³**.

## Contratos

### `core/models.py`: dominio público (Pydantic, entrada y salida de la API)
- `Problem` tiene `mode` (`depot` | `multi_origin`), `depot`, `drivers` (cada uno con su `vehicle_type_id`), `vehicle_types`, `stops`, `objective`, `costs`, `constraints` (toggles), `distance_source` (`osrm` | `haversine` | `provided`) y una `matrix` opcional.
- **Modo `depot`:** `driver.start` y `driver.end` se ignoran; todos salen del depósito y regresan a él.
- **Modo `multi_origin`:** `driver.start` es obligatorio. Si `driver.end` es `None`, la ruta es abierta.
- `ProvidedMatrix.node_ids` usa los ids de las paradas, `depot_id`, `"{driver.id}:start"` y `"{driver.id}:end"`.
- `Priority` multiplica el retraso según `PRIORITY_LATENESS_FACTOR`: low 0.5, normal 1, high 3.
- `Solution` es la salida: rutas solo de los repartidores usados, con `Visit` (tiempos) y `RouteMetrics`, más `SolutionMetrics` global.

### `core/types.py`: representación numérica interna
- **`Instance`** guarda matrices `dist` y `dur` de tamaño N×N con N = n + 2m. Índices:
  - `0..n-1`: paradas, en el orden de `Problem.stops`.
  - `n+k`: inicio del vehículo k.
  - `n+m+k`: fin del vehículo k.
  - En modo depósito, todos los inicios y fines son el depósito (filas duplicadas).
  - Para rutas abiertas (`open_end[k]`), el builder pone en 0 la columna del nodo final.
  - El vehículo k es `Problem.drivers[k]`.
  - `coords` (N×2, lat/lon) sigue el mismo orden de nodos. Lo usan K-means, sweep y la UI; los costos siempre salen de las matrices.
- **Toggles de restricciones:** el builder los aplica así:
  - Capacidad apagada: `cap_* = inf`.
  - Jornada apagada: `max_shift = inf`.
  - Ventanas apagadas: `tw_enabled = False`.
  - Prioridades apagadas: `priority_w = 1`.
- **`RouteSet`:** `routes[k]` es la lista ordenada de paradas del vehículo k. Cada parada aparece a lo más una vez; las que no se rutean van en `unassigned`. **Todo solver devuelve un `RouteSet` completo**: toda parada está ruteada o en `unassigned`.
- **`Chromosome`:** `tour` es una permutación de las paradas y `vorder` una permutación de los vehículos. El Split asigna segmentos consecutivos del tour a los vehículos en el orden `vorder`; un vehículo puede quedar vacío.
- **`Penalties`:** multiplicadores de restricciones blandas. El solver puede adaptarlos.
- **`Evaluation`:** objetivos crudos y violaciones. `objectives` respeta el orden de `OBJECTIVES = (time, cost, vehicles, makespan)`.

### Simulación de una ruta k (la usan `evaluate` y `split`, que deben coincidir exactamente)
```
t = shift_start[k]; prev = n+k; dist_k = 0
for i in route:
    t += dur[prev,i] * speed_factor[k]; dist_k += dist[prev,i]
    arrival = t
    if tw_enabled: t = max(t, tw_start[i]); late += max(0, t - tw_end[i]) * priority_w[i]
    t += service[i]; prev = i
if not open_end[k]: t += dur[prev,n+m+k] * speed_factor[k]; dist_k += dist[prev,n+m+k]
duration_k = t - shift_start[k]
overtime_k = max(0, duration_k - max_shift[k])
load_kg_k = Σ demand_kg; overload_kg_k = max(0, load_kg_k - cap_kg[k])   (igual para m3)
cost_k = dist_k*cost_per_km[k] + duration_k*cost_per_min[k] + fixed_cost[k]
```
Una ruta vacía vale 0 en todo y no cuenta como vehículo usado.

### Fitness (minimizar)
```
f = (Σ duration_k, Σ cost_k, #rutas no vacías)
fitness = Σ_{j<3} weights[j] * f[j] / obj_scale[j]
        + weights[3] * Σ_k duration_k² / obj_scale[3]²
        + P.capacity  * (overload_kg/mean(cap_kg) + overload_m3/mean(cap_m3))
        + P.lateness  * lateness_min/60
        + P.overtime  * overtime_min/60
        + P.unassigned * n_unassigned
```
- `obj_scale` lo fija el builder con los objetivos de una solución de vecino más cercano, con un mínimo de 1.
- `weights` se normalizan para que sumen 1.
- **El makespan entra al fitness como proxy aditivo y convexo** (Σ duración², término de balance). El `max` real no es aditivo: el Split y la búsqueda local no podían optimizarlo y el peso no tenía efecto. Con el proxy todo es aditivo por ruta (`route_additive`), así que Split, LS, ACO y GA lo optimizan exactamente. `Evaluation.makespan_min` y el objetivo de NSGA-II siguen siendo el makespan real.
- `feasible` significa que no hay overload, overtime ni paradas sin asignar. El retraso en ventanas de tiempo es blando y no rompe la factibilidad.

### `algorithms/base.py`: interfaz de los solvers
- Cada solver hereda de `Solver`, define `name`, `label`, `params_model` (subclase de `SolverParams`, con defaults en todo) y `multi_objective`, y se registra con `@register_solver`.
- **`solve(inst, callback, warm_start, state, penalties) -> SolveResult`** debe:
  - respetar `time_limit_s` y `max_iterations`;
  - llamar a `callback` cada `progress_every` iteraciones y una vez al final;
  - detenerse si `callback` devuelve `False`;
  - aceptar `warm_start` (lista de `RouteSet`) para la re-optimización dinámica;
  - devolver en `state` lo que convenga reusar (por ejemplo `{"pheromone": ndarray}` en ACO).
- Nombres registrados: `ga`, `aco`, `aco_ga`, `nsga2`, `pyvrp`, `ortools`.
- La inicialización `init` es `random` | `nearest_neighbor` | `kmeans` | `sweep` y vive en `algorithms/init.py` + `algorithms/clustering.py`. Punto de entrada: `initial_routesets(inst, strategy, count, rng, penalties) -> list[RouteSet]`.
- Búsqueda local: `algorithms/local_search.py::improve(inst, rs, penalties, rng, max_rounds) -> RouteSet`. Nunca empeora el costo aditivo (`core.evaluate.additive_cost`). Ignora el makespan.
- API del núcleo que pueden usar los solvers:
  - `core.evaluate`: `evaluate`, `additive_cost`, `validate_routeset`, `route_eval`/`route_args` (numba), `additive_coefs`/`route_additive` (numba).
  - `core.split`: `split`, `routes_to_chromosome`, `random_chromosome`.
  - `core.construct`: `nearest_neighbor`.
- Tests: `tests.factories` provee `make_instance(...)` y `benchmark_instance(name) -> (Instance, bks)`.
- `algorithms/__init__.py` importa todos los solvers para llenar el registro. Solo lo edita el arquitecto.

### `api/schemas.py`: transporte
| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` |
| GET | `/algorithms` | `list[AlgorithmInfo]`, con el JSON schema de los params para generar formularios |
| GET | `/vehicles` | `VehicleCatalog` |
| GET | `/scenarios`, `/scenarios/{id}` | `list[ScenarioInfo]`, `Problem` |
| POST | `/solve` | `SolveRequest` → `SolveResponse` |
| POST | `/solve/stream` | `SolveRequest` → SSE: `progress` (`ProgressPayload`), `result` (`SolveResponse`), `error` (`ErrorPayload`) |
| POST | `/compare` | `CompareRequest` → `CompareResponse` |
| POST | `/compare/stream` | SSE por corrida: `progress`/`result` con `{"run_index": i, ...}` |
| POST | `/matrix` | `MatrixRequest` → `MatrixResponse` |
| POST | `/geometry` | `GeometryRequest` → `GeometryResponse` |
| WS | `/simulate` | cliente → `SimClientMessage`; servidor → `SimServerMessage` |

### Modo dinámico
El simulador avanza el reloj. Para re-optimizar construye una **sub-instancia**:
- quita las paradas ya entregadas;
- el inicio de cada repartidor pasa a ser su posición actual, con `shift_start` igual al reloj y la jornada restante;
- la parada en curso queda fija al inicio de su ruta.

Así los solvers no saben nada de dinamismo; solo reciben `warm_start` y `state`.

## Flujo con agentes
- **Opus (arquitecto/revisor):** escribe los contratos, revisa cada entrega y la integra.
- **Sonnet:** implementa en su worktree.
- **Haiku:** scaffolding, dependencias, descargas e investigación.
- Se avanza por fases (F0 a F4), con checkpoint del usuario al terminar cada una.

**Plantilla de prompt para Sonnet:**
1. Rol y objetivo.
2. Contexto (este archivo, más `DESIGN.md` si es frontend).
3. Contrato y lista de archivos permitidos.
4. Restricciones (reglas de oro).
5. Criterios de aceptación medibles.
6. Tests obligatorios.
7. Formato de entrega: resumen, archivos, salida de los tests y desviaciones.

**Checklist de revisión (Opus):**
- Corrección contra el contrato.
- `evaluate` y `split` coinciden.
- Factibilidad e invariantes de `RouteSet`.
- Rendimiento (numba en los loops calientes).
- Determinismo.
- Tests y `ruff`/`mypy` limpios.
- Cero comentarios.
- En frontend, apego a `DESIGN.md`.

## Comandos
```
cd services/solver && uv run pytest            (rápidos)
cd services/solver && uv run pytest -m slow    (benchmarks de calidad)
cd services/solver && uv run ruff check . && uv run ruff format . && uv run mypy src
cd services/solver && uv run uvicorn routeopt.api.main:app --reload --port 8000
cd apps/web && npm run dev
cd apps/web && npm run gen:api            (regenera openapi.json + tipos TS, sin servidor)
docker compose up
```

## Rendimiento
- Objetivo: 200 paradas y 20 vehículos en menos de 60 s con progreso fluido.
- Los loops calientes (`evaluate`, `split`, deltas de búsqueda local, construcción ACO) se escriben con `numba.njit` sobre arrays de `Instance`. Nada de objetos Python dentro de los loops.
- **Caché de numba (`cache=True`):** se invalida solo cuando cambia el archivo de la propia función, no el de las funciones que llama. Si se modifica un kernel de `core/evaluate.py`, los kernels de `split.py`, `local_search.py`, `aco.py`, etc. quedan compilados con la versión vieja. Después de tocar cualquier kernel, borra los cachés: `find services/solver/src -name '*.nbi' -delete -o -name '*.nbc' -delete`.

## Datos y licencias
- Amazon Last Mile Routing Challenge: CC BY-NC 4.0. Solo uso no comercial, con atribución a Amazon y al MIT CTL en el README y en la UI.
- DENUE (INEGI): datos abiertos, con atribución.
- OSM: ODbL, con atribución "© OpenStreetMap contributors" en el mapa.
- Las especificaciones de vehículos no confirmadas llevan `approx: true` y `source`.
