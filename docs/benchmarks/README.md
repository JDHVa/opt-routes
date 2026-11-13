# Benchmarks (corrida preliminar, F1)

Configuración: 30 s por corrida, seeds 1, 2 y 3, en un host de 16 núcleos con las 6 instancias corriendo en paralelo. El "t hasta la mejor" puede estar inflado por esa carga. Gap = distancia total frente a la BKS de CVRPLIB/Solomon. Datos crudos en `res_*.json`.

Para reproducirlo:
```
cd services/solver
uv run python scripts/benchmark.py --solvers ga,aco,aco_ga,pyvrp,ortools \
  --instances A-n32-k5,A-n45-k7,P-n50-k7,A-n80-k10,X-n101-k25,C101 --time 30 --seeds 1,2,3
```

| Instancia | GA | ACO | ACO+GA | PyVRP (HGS) | OR-Tools |
|---|---:|---:|---:|---:|---:|
| A-n32-k5 | 0.00 % | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| A-n45-k7 | 0.00 % | 0.00 % | 0.00 % | 0.00 % | 0.00 % |
| P-n50-k7 | 0.00 % | 0.06 % | 0.00 % | 0.00 % | 0.72 % |
| A-n80-k10 | 0.93 % | 1.13 % | 0.98 % | 0.00 % | 2.27 % |
| X-n101-k25 | 1.83 % | 1.84 % | **1.60 %** | 0.00 % | 3.04 % |
| C101 (VRPTW) | 0.00 % | 0.00 % | 0.00 % | 0.00 % | 0.00 % |

Gap medio de 3 seeds. Todas las soluciones son factibles.

## Lectura
- **Instancias pequeñas (≤ 50 clientes):** los tres algoritmos bioinspirados alcanzan el óptimo.
- **Instancia más grande (X-n101):** el híbrido ACO+GA es el mejor de los bioinspirados, con 1.60 % de gap medio y 1.21 % de mejor gap, frente a 1.83 % del GA y 1.84 % del ACO.
- **A-n80:** el GA queda ligeramente mejor que el híbrido (0.93 % frente a 0.98 %). Con 3 seeds la diferencia es ruido.
- **Contra los baselines:** los tres superan a OR-Tools (GLS) en las instancias medianas y grandes. PyVRP (HGS, estado del arte) sigue siendo la referencia, con 0 % en todas.
- **Conclusión:** la ventaja del híbrido sobre el GA es modesta y todavía no es estadísticamente sólida. Hace falta correr más seeds antes de afirmar superioridad.
