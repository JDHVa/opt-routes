from __future__ import annotations

import os
from dataclasses import dataclass


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


@dataclass(frozen=True, slots=True)
class Settings:
    max_concurrent_solves: int = 2
    max_time_limit_s: float = 120.0
    allowed_origins: tuple[str, ...] = ("http://localhost:3000",)
    warmup: bool = True
    osrm_url: str = "http://localhost:5000"
    sim_tick_s: float = 0.25

    @classmethod
    def from_env(cls) -> Settings:
        origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
        return cls(
            max_concurrent_solves=max(1, int(os.environ.get("MAX_CONCURRENT_SOLVES", "2"))),
            max_time_limit_s=float(os.environ.get("MAX_TIME_LIMIT_S", "120")),
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            warmup=_flag("WARMUP", True),
            osrm_url=os.environ.get("OSRM_URL", "http://localhost:5000"),
            sim_tick_s=float(os.environ.get("SIM_TICK_S", "0.25")),
        )
