from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

BASE_URL = (
    "https://amazon-last-mile-challenges.s3.us-west-2.amazonaws.com/"
    "almrrc2021/almrrc2021-data-training"
)
SOURCES = {
    "route_data": f"{BASE_URL}/model_apply_inputs/new_route_data.json",
    "package_data": f"{BASE_URL}/model_apply_inputs/new_package_data.json",
    "travel_times": f"{BASE_URL}/model_apply_inputs/new_travel_times.json",
    "actual_sequences": f"{BASE_URL}/model_score_inputs/new_actual_sequences.json",
}
OUTPUT = Path(__file__).resolve().parents[1] / "data/amazon_sample"
ROUTES_WANTED = 3
MAX_STOPS = 220

ATTRIBUTION = """# Atribución

Los archivos de este directorio son un subconjunto (3 rutas) del Amazon Last Mile Routing Research
Challenge Dataset (`almrrc2021`, conjunto `model_apply_inputs` / `model_score_inputs`).

- Titular: Amazon.com, Inc. o sus afiliadas, con el MIT Center for Transportation & Logistics (MIT CTL).
- Licencia: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0),
  https://creativecommons.org/licenses/by-nc/4.0/legalcode.txt
- Uso: solo no comercial, con atribución a Amazon y al MIT CTL.
- Origen: s3://amazon-last-mile-challenges (us-west-2), acceso anónimo.
- Modificaciones: se recortó el conjunto a 3 rutas de ciudades distintas; el contenido de cada ruta no
  fue alterado.
"""


def download(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=120) as response:
        payload: dict[str, Any] = json.loads(response.read())
    return payload


def pick_routes(route_data: dict[str, Any]) -> list[str]:
    by_city: dict[str, tuple[int, str]] = {}
    for route_id, route in sorted(route_data.items()):
        city = route["station_code"][:3]
        size = len(route["stops"])
        if size > MAX_STOPS:
            continue
        if city not in by_city or size < by_city[city][0]:
            by_city[city] = (size, route_id)
    ranked = sorted(by_city.values())
    return [route_id for _, route_id in ranked[:ROUTES_WANTED]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    tables = {name: download(url) for name, url in SOURCES.items()}
    chosen = pick_routes(tables["route_data"])
    args.output.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        subset = {route_id: table[route_id] for route_id in chosen}
        (args.output / f"{name}.json").write_text(json.dumps(subset, separators=(",", ":")))
    (args.output / "ATTRIBUTION.md").write_text(ATTRIBUTION, encoding="utf-8")
    print(chosen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
