# Instancias benchmark

Archivos de instancias y soluciones de referencia para validar los solvers.
Se commitean (son pequeños). Verificados con `vrplib.read_instance` / `vrplib.read_solution`
(Solomon: `vrplib.read_instance(..., instance_format="solomon")`).

## Fuente

- **CVRPLIB** (Uchoa et al. 2017 / Augerat et al. 1995 / Uchoa et al. 2013; Solomon 1987 para VRPTW):
  https://galgos.inf.puc-rio.br/cvrplib/index.php/en/cvrp/instances
  y https://galgos.inf.puc-rio.br/cvrplib/index.php/en/vrptw/instances
  Descargas: `/download/instance/{id}` (`.vrp` / `.txt`) y `/download/bks/{id}` (`.sol`).
  IDs usados: A-n32-k5=4, A-n45-k7=17, P-n50-k7=84, A-n80-k10=31, X-n101-k25=158,
  C101=380, R101=397, RC101=420.

## CVRP

| Instancia | Clientes | Vehículos (sol.) | Costo óptimo / BKS | Estatus (según fuente) | Archivos |
|---|---|---|---|---|---|
| A-n32-k5 | 31 | 5 | **784** | Óptimo (comentario de la instancia) | `A-n32-k5.vrp`, `A-n32-k5.sol` |
| A-n45-k7 | 44 | 7 | **1146** | Óptimo | `A-n45-k7.vrp`, `A-n45-k7.sol` |
| P-n50-k7 | 49 | 7 | **554** | Óptimo | `P-n50-k7.vrp`, `P-n50-k7.sol` |
| A-n80-k10 | 79 | 10 | **1763** | Óptimo (comentario de la instancia) | `A-n80-k10.vrp`, `A-n80-k10.sol` |
| X-n101-k25 | 100 | 26 (rutas en sol.) | **27591** | BKS de CVRPLIB | `X-n101-k25.vrp`, `X-n101-k25.sol` |

Costo recalculado desde la solución con distancias EUC_2D redondeadas (TSPLIB): coincide en las cinco.

## VRPTW (Solomon, 100 clientes)

| Instancia | Vehículos (sol.) | BKS CVRPLIB | Recalculado con distancia euclídea exacta | Archivos |
|---|---|---|---|---|
| C101 | 10 | **827.3** | 828.94 | `C101.txt`, `C101.sol` |
| R101 | 20 | **1637.7** | 1642.88 | `R101.txt`, `R101.sol` |
| RC101 | 15 | **1619.8** | 1623.56 | `RC101.txt`, `RC101.sol` |

Nota: los costos de CVRPLIB para Solomon usan la convención original de Solomon, con distancias
**truncadas a un decimal** (`floor(d*10)/10`); esa convención reproduce exactamente 827.3 / 1637.7 / 1619.8.
Con distancia euclídea exacta los valores son los de la última columna. Al comparar un solver,
usar la misma convención de distancia.

## Formatos

- CVRP: formato TSPLIB/CVRPLIB (`.vrp`, `.sol` con líneas `Route #k:` y `Cost`).
- Solomon: formato Solomon (`.txt`, leer con `instance_format="solomon"`).
