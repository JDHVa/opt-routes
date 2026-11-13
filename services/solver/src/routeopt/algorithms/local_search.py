from __future__ import annotations

import numpy as np

from routeopt.core.types import Instance, Penalties, RouteSet


def improve(
    inst: Instance,
    rs: RouteSet,
    penalties: Penalties | None = None,
    rng: np.random.Generator | None = None,
    max_rounds: int = 50,
) -> RouteSet:
    return rs.copy()
