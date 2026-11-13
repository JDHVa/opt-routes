#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$HERE/data}"
BBOX="${BBOX:--100.75,25.35,-99.85,26.05}"
MEXICO_URL="${MEXICO_URL:-https://download.geofabrik.de/north-america/mexico-latest.osm.pbf}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"
OSMIUM_IMAGE="${OSMIUM_IMAGE:-routeopt-osmium:local}"
KEEP_RAW="${KEEP_RAW:-0}"

MEXICO_PBF="$DATA_DIR/mexico-latest.osm.pbf"
NL_PBF="$DATA_DIR/nuevo-leon.osm.pbf"
NL_OSRM="$DATA_DIR/nuevo-leon.osrm"
USER_SPEC="$(id -u):$(id -g)"

mkdir -p "$DATA_DIR"

if [[ -f "$NL_OSRM.mldgr" && -f "$NL_OSRM.cell_metrics" ]]; then
  echo "OSRM data already prepared at $NL_OSRM"
  exit 0
fi

if [[ ! -f "$NL_PBF" ]]; then
  if [[ ! -f "$MEXICO_PBF" ]]; then
    curl -fL --retry 3 -C - -o "$MEXICO_PBF.part" "$MEXICO_URL"
    mv "$MEXICO_PBF.part" "$MEXICO_PBF"
  fi

  if ! docker image inspect "$OSMIUM_IMAGE" >/dev/null 2>&1; then
    docker build -t "$OSMIUM_IMAGE" -f "$HERE/osmium.Dockerfile" "$HERE"
  fi

  docker run --rm --user "$USER_SPEC" -v "$DATA_DIR:/data" "$OSMIUM_IMAGE" \
    extract --bbox "$BBOX" --strategy complete_ways --overwrite \
    -o /data/nuevo-leon.osm.pbf /data/mexico-latest.osm.pbf
fi

run_osrm() {
  docker run --rm --user "$USER_SPEC" -v "$DATA_DIR:/data" "$OSRM_IMAGE" "$@"
}

run_osrm osrm-extract -p /opt/car.lua /data/nuevo-leon.osm.pbf
run_osrm osrm-partition /data/nuevo-leon.osrm
run_osrm osrm-customize /data/nuevo-leon.osrm

if [[ "$KEEP_RAW" != "1" ]]; then
  rm -f "$MEXICO_PBF"
fi
rm -f "$NL_PBF"

du -sh "$DATA_DIR"
