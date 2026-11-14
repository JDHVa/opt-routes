# RouteOpt NL: frontend

Next.js (App Router) + TypeScript estricto + Tailwind v4. Guía visual obligatoria en `DESIGN.md`; reglas del repo en `CLAUDE.md`.

## Pantallas

| Ruta | Qué hace |
|---|---|
| `/[locale]` | Landing con una solución demo animada. |
| `/[locale]/planner` | Carga o genera paradas (demo, CSV, aleatorias), optimiza con `/solve/stream` y exporta CSV o JSON. |
| `/[locale]/compare` | De 2 a 6 corridas en secuencia con `/compare/stream`: tabla ordenable, curvas de convergencia y minimapas sincronizados opcionales. |
| `/[locale]/pareto` | NSGA-II sobre el problema actual del Planner: dispersión con frente escalonado, mapa y botón para llevar la solución al Planner. |
| `/[locale]/simulate` | Simulación dinámica por WebSocket: repartidores animados, pedidos nuevos, línea de tiempo y registro de eventos. |

## Desarrollo

```
npm run dev            servidor de desarrollo (puerto 3000)
npm run build          build de producción
npm run lint           ESLint
npm run typecheck      tsc --noEmit
npm test               Vitest
npm run test:e2e       Playwright (necesita npm run build antes)
npm run gen:api        regenera openapi.json y src/lib/api/schema.d.ts (necesita uv)
npm run contrast       mide el contraste WCAG de los tokens de globals.css
```

Con el backend real:

```
cd services/solver && WARMUP=0 uv run uvicorn routeopt.api.main:app --port 8000
cd apps/web && SOLVER_URL=http://localhost:8000 NEXT_PUBLIC_SOLVER_WS_URL=ws://localhost:8000/simulate npm run dev
```

Sin OSRM el backend usa haversine y la geometría de las rutas es de línea recta.

## Variables de entorno

| Variable | Dónde se lee | Por defecto | Uso |
|---|---|---|---|
| `SOLVER_URL` | servidor | `http://localhost:8000` | Destino del proxy `/api/solver/*`. |
| `NEXT_PUBLIC_SOLVER_WS_URL` | navegador (se incrusta en el build) | `ws://localhost:8000/simulate` | WebSocket de la simulación. |
| `NEXT_PUBLIC_REPO_URL` | navegador | repositorio del proyecto | Enlace "Ver código". |

## WebSocket de la simulación

El proxy BFF de Next.js (`src/app/api/solver/[...path]/route.ts`) solo reenvía HTTP y SSE: **no soporta WebSocket**. La pantalla de simulación se conecta directo al solver con `NEXT_PUBLIC_SOLVER_WS_URL`. En producción hay que apuntarla al endpoint `wss://` del servicio del solver (Cloud Run admite WebSocket) y permitir ese origen en el solver. Como la variable es pública, se fija en el momento del build.

El cliente (`src/lib/sim/socket.ts`) es tipado, descarta mensajes inválidos y distingue el cierre pedido por el usuario del cierre inesperado. La reconexión es manual: tras un corte aparece "Reconectar e iniciar de nuevo", que abre una sesión nueva desde el inicio del día.

## Estructura

```
src/app/[locale]/       páginas
src/app/api/solver/     proxy BFF (zod, rate limit, lista de rutas permitidas)
src/components/         map/, planner/, panels/, compare/, pareto/, simulate/, charts/, shell/, ui/
src/lib/                api/ (cliente, SSE, tipos), compare/, pareto/, sim/, planner/, map/, color/
src/stores/             zustand: planner, compare, pareto
src/data/demo/          fixtures de la landing (copias de src/test/fixtures)
messages/{es,en}.json   todo el texto de la UI (next-intl)
e2e/                    Playwright con mocks del solver y del WebSocket
```

`src/lib/api/schema.d.ts` y `openapi.json` son generados: no se editan a mano.

## Atribuciones

El mapa muestra la atribución del estilo de OpenFreeMap (© OpenMapTiles, datos de OpenStreetMap). Establecimientos: INEGI, DENUE. Entregas de referencia: Amazon Last Mile Routing Challenge, Amazon y MIT CTL (CC BY-NC 4.0, solo uso no comercial).
