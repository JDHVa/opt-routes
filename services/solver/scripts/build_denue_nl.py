from __future__ import annotations

import argparse
import csv
import gzip
import io
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

DENUE_URL = "https://www.inegi.org.mx/contenidos/masiva/denue/denue_19_csv.zip"
OUTPUT = Path(__file__).resolve().parents[1] / "src/routeopt/data/nl/denue_points.csv.gz"
SEED = 20240601
TARGET_POINTS = 15000
MIN_PER_MUNICIPALITY = 600
LAT_RANGE = (25.3, 26.0)
LON_RANGE = (-100.7, -99.9)
METRO_MUNICIPALITIES = {
    "monterrey": "Monterrey",
    "san pedro garza garcia": "San Pedro Garza García",
    "san nicolas de los garza": "San Nicolás de los Garza",
    "guadalupe": "Guadalupe",
    "apodaca": "Apodaca",
    "general escobedo": "General Escobedo",
    "santa catarina": "Santa Catarina",
    "garcia": "García",
    "juarez": "Juárez",
}
FIELDS = ("municipio", "lat", "lon", "nombre", "direccion", "scian")


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.strip().lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def short_address(row: dict[str, str]) -> str:
    street = " ".join(p for p in (row["tipo_vial"], row["nom_vial"], row["numero_ext"]) if p)
    colony = row["nomb_asent"]
    return ", ".join(p.title() for p in (street, colony) if p)


def read_rows(source: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[tuple[float, float]] = set()
    with zipfile.ZipFile(source) as archive:
        name = next(n for n in archive.namelist() if n.startswith("conjunto_de_datos/"))
        with archive.open(name) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
            for row in reader:
                municipality = METRO_MUNICIPALITIES.get(normalize(row["municipio"]))
                if municipality is None:
                    continue
                try:
                    lat = float(row["latitud"])
                    lon = float(row["longitud"])
                except ValueError:
                    continue
                in_box = LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]
                key = (round(lat, 5), round(lon, 5))
                if not in_box or key in seen or not row["nom_vial"]:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "municipio": municipality,
                        "lat": f"{lat:.6f}",
                        "lon": f"{lon:.6f}",
                        "nombre": row["nom_estab"].strip().title()[:60],
                        "direccion": short_address(row)[:70],
                        "scian": row["codigo_act"],
                    }
                )
    return rows


def stratified_sample(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    rng = np.random.default_rng(SEED)
    by_municipality: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_municipality.setdefault(row["municipio"], []).append(row)
    total = len(rows)
    sample: list[dict[str, str]] = []
    for municipality in sorted(by_municipality):
        group = by_municipality[municipality]
        quota = max(MIN_PER_MUNICIPALITY, round(TARGET_POINTS * len(group) / total))
        quota = min(quota, len(group))
        picked = rng.choice(len(group), size=quota, replace=False)
        sample.extend(group[int(i)] for i in sorted(picked))
    return sample


def write_output(sample: list[dict[str, str]], target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(sample)
    with gzip.GzipFile(target, "wb", compresslevel=9, mtime=0) as handle:
        handle.write(buffer.getvalue().encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download or not args.zip.exists():
        args.zip.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(DENUE_URL, args.zip)
    sample = stratified_sample(read_rows(args.zip))
    write_output(sample, args.output)
    counts: dict[str, int] = {}
    for row in sample:
        counts[row["municipio"]] = counts.get(row["municipio"], 0) + 1
    print(len(sample), counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
