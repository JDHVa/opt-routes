"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Warehouse } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { setWorkerUrl, type ExpressionSpecification } from "maplibre-gl";
import type { Problem, Solution } from "@/lib/api/types";
import {
  buildRouteCollection,
  buildStopCollections,
  computeBounds,
  describeStop,
  originOf,
  type MapFocus,
} from "@/lib/map/geojson";
import { routeColor } from "@/lib/routes/palette";
import { CHEVRON_IMAGE_ID, createChevronImage } from "./chevron";
import { StopTooltip } from "./StopTooltip";
import { useMapColors, usePrefersReducedMotion } from "./use-map-colors";

setWorkerUrl("/maplibre-gl-worker.mjs");

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const MONTERREY = { longitude: -100.3161, latitude: 25.6866, zoom: 11 };
const CLUSTER_THRESHOLD = 150;
const LABEL_FONT = ["Noto Sans Bold"];

export type MapPadding = { top: number; right: number; bottom: number; left: number };

export type RouteMapProps = {
  problem: Problem | null;
  solution: Solution | null;
  focus: MapFocus;
  padding: MapPadding;
  fitNonce: number;
  interactive?: boolean;
  showNavigation?: boolean;
  onHoverRoute?: (index: number | null) => void;
  onSelectRoute?: (index: number | null) => void;
  onSelectStop?: (id: string | null) => void;
  className?: string;
};

const DIM: ExpressionSpecification = ["==", ["get", "emphasis"], "dim"];
const SELECTED: ExpressionSpecification = ["==", ["get", "emphasis"], "selected"];

type HoverStop = { id: string; lng: number; lat: number };

export default function RouteMap({
  problem,
  solution,
  focus,
  padding,
  fitNonce,
  interactive = true,
  showNavigation = true,
  onHoverRoute,
  onSelectRoute,
  onSelectStop,
  className,
}: RouteMapProps) {
  const t = useTranslations("map");
  const { resolvedTheme } = useTheme();
  const colors = useMapColors();
  const reducedMotion = usePrefersReducedMotion();
  const mapRef = useRef<MapRef | null>(null);
  const [ready, setReady] = useState(false);
  const [hoverStop, setHoverStop] = useState<HoverStop | null>(null);
  const [cursor, setCursor] = useState("");

  const mapStyle = resolvedTheme === "dark" ? STYLE_DARK : STYLE_LIGHT;

  const routes = useMemo(
    () => (problem ? buildRouteCollection(problem, solution, focus) : null),
    [problem, solution, focus],
  );
  const stops = useMemo(
    () => (problem ? buildStopCollections(problem, solution, focus) : null),
    [problem, solution, focus],
  );
  const bounds = useMemo(() => (problem ? computeBounds(problem) : null), [problem]);
  const clusterLoose = (stops?.loose.features.length ?? 0) > CLUSTER_THRESHOLD;

  const ensureChevron = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || map.hasImage(CHEVRON_IMAGE_ID)) return;
    const image = createChevronImage();
    if (image) map.addImage(CHEVRON_IMAGE_ID, image, { sdf: true, pixelRatio: 2 });
  }, []);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.on("styleimagemissing", (event) => {
      if (event.id === CHEVRON_IMAGE_ID) ensureChevron();
    });
    ensureChevron();
    setReady(true);
  }, [ensureChevron]);

  const fit = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !bounds) return;
    const camera = map.cameraForBounds(bounds, { padding, maxZoom: 15 });
    if (!camera) return;
    if (reducedMotion) map.jumpTo(camera);
    else map.easeTo({ ...camera, duration: 500 });
  }, [bounds, padding, reducedMotion]);

  const lastFit = useRef(-1);
  useEffect(() => {
    if (!ready || !bounds) return;
    if (lastFit.current === fitNonce) return;
    lastFit.current = fitNonce;
    fit();
  }, [ready, bounds, fitNonce, fit]);

  useEffect(() => {
    if (!ready || !problem || focus.selectedStopId === null) return;
    const stop = problem.stops.find((s) => s.id === focus.selectedStopId);
    const map = mapRef.current?.getMap();
    if (!stop || !map) return;
    const target = { center: [stop.location.lon, stop.location.lat] as [number, number] };
    if (reducedMotion) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 400 });
  }, [ready, problem, focus.selectedStopId, reducedMotion]);

  const handleMove = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!interactive) return;
      const feature = event.features?.[0];
      if (!feature) {
        setCursor("");
        setHoverStop(null);
        onHoverRoute?.(null);
        return;
      }
      setCursor("pointer");
      if (feature.layer.id === "route-hit") {
        setHoverStop(null);
        onHoverRoute?.(Number(feature.properties?.driverIndex));
        return;
      }
      const id = feature.properties?.id;
      if (typeof id === "string") {
        const geometry = feature.geometry;
        if (geometry.type === "Point") {
          setHoverStop({ id, lng: geometry.coordinates[0], lat: geometry.coordinates[1] });
        }
        const driverIndex = Number(feature.properties?.driverIndex);
        onHoverRoute?.(driverIndex >= 0 ? driverIndex : null);
      }
    },
    [interactive, onHoverRoute],
  );

  const handleLeave = useCallback(() => {
    setCursor("");
    setHoverStop(null);
    onHoverRoute?.(null);
  }, [onHoverRoute]);

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!interactive) return;
      const feature = event.features?.[0];
      if (!feature) {
        onSelectStop?.(null);
        onSelectRoute?.(null);
        return;
      }
      if (feature.layer.id === "route-hit") {
        onSelectRoute?.(Number(feature.properties?.driverIndex));
        return;
      }
      const id = feature.properties?.id;
      if (typeof id === "string") onSelectStop?.(id);
    },
    [interactive, onSelectRoute, onSelectStop],
  );

  const hoverDetail = useMemo(
    () => (problem && hoverStop ? describeStop(problem, solution, hoverStop.id) : null),
    [problem, solution, hoverStop],
  );

  const interactiveLayerIds = interactive
    ? ["route-hit", "stop-circle", "loose-circle"]
    : undefined;

  return (
    <div className={className} role="application" aria-label={t("ariaLabel")}>
      <MapGL
        ref={mapRef}
        initialViewState={MONTERREY}
        mapStyle={mapStyle}
        onLoad={handleLoad}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        interactiveLayerIds={interactiveLayerIds}
        cursor={cursor}
        attributionControl={{ compact: false, customAttribution: t("attribution") }}
        dragRotate={false}
        touchPitch={false}
        scrollZoom={interactive}
        style={{ width: "100%", height: "100%" }}
      >
        {showNavigation ? (
          <NavigationControl position="bottom-right" showCompass={false} />
        ) : null}

        {routes ? (
          <Source id="routes" type="geojson" data={routes}>
            <Layer
              id="route-hit"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{ "line-width": 16, "line-opacity": 0 }}
            />
            <Layer
              id="route-casing"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": colors.bg,
                "line-width": ["case", SELECTED, 9, 7],
                "line-opacity": ["case", DIM, 0.25, 0.9],
                "line-opacity-transition": { duration: 150, delay: 0 },
              }}
            />
            <Layer
              id="route-line"
              type="line"
              filter={["!", ["get", "dashed"]]}
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": ["get", "color"],
                "line-width": ["case", SELECTED, 6, 4],
                "line-opacity": ["case", DIM, 0.25, 1],
                "line-opacity-transition": { duration: 150, delay: 0 },
              }}
            />
            <Layer
              id="route-line-dashed"
              type="line"
              filter={["get", "dashed"]}
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": ["get", "color"],
                "line-width": ["case", SELECTED, 6, 4],
                "line-opacity": ["case", DIM, 0.25, 1],
                "line-dasharray": [2, 1],
              }}
            />
            <Layer
              id="route-arrows"
              type="symbol"
              layout={{
                "symbol-placement": "line",
                "symbol-spacing": 80,
                "icon-image": CHEVRON_IMAGE_ID,
                "icon-size": 0.5,
                "icon-rotation-alignment": "map",
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              }}
              paint={{
                "icon-color": ["get", "color"],
                "icon-halo-color": colors.bg,
                "icon-halo-width": 1,
                "icon-opacity": ["case", DIM, 0.25, 1],
              }}
            />
          </Source>
        ) : null}

        {stops ? (
          <Source
            id="stops-loose"
            type="geojson"
            data={stops.loose}
            cluster={clusterLoose}
            clusterMaxZoom={11}
            clusterRadius={44}
          >
            <Layer
              id="loose-cluster"
              type="circle"
              filter={["has", "point_count"]}
              paint={{
                "circle-radius": 14,
                "circle-color": colors.surface,
                "circle-stroke-color": colors["text-muted"],
                "circle-stroke-width": 2,
              }}
            />
            <Layer
              id="loose-cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": LABEL_FONT,
                "text-size": 11,
                "text-allow-overlap": true,
              }}
              paint={{ "text-color": colors.text }}
            />
            <Layer
              id="loose-circle"
              type="circle"
              filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 7],
                "circle-color": colors.surface,
                "circle-stroke-color": [
                  "case",
                  ["get", "infeasible"],
                  colors.danger,
                  colors["text-muted"],
                ],
                "circle-stroke-width": 2,
              }}
            />
            <Layer
              id="loose-selected"
              type="circle"
              filter={["all", ["!", ["has", "point_count"]], ["get", "selected"]]}
              paint={{
                "circle-radius": 12,
                "circle-color": "transparent",
                "circle-stroke-color": colors.accent,
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        ) : null}

        {stops ? (
          <Source id="stops-assigned" type="geojson" data={stops.assigned}>
            <Layer
              id="stop-high-ring"
              type="circle"
              filter={["get", "high"]}
              paint={{
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 13, 13],
                "circle-color": "transparent",
                "circle-stroke-color": colors.danger,
                "circle-stroke-width": 2,
                "circle-stroke-opacity": ["case", DIM, 0.25, 1],
              }}
            />
            <Layer
              id="stop-circle"
              type="circle"
              paint={{
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 13, 9],
                "circle-color": ["get", "color"],
                "circle-stroke-color": colors.bg,
                "circle-stroke-width": 2,
                "circle-opacity": ["case", DIM, 0.25, 1],
                "circle-stroke-opacity": ["case", DIM, 0.25, 1],
              }}
            />
            <Layer
              id="stop-selected"
              type="circle"
              filter={["get", "selected"]}
              paint={{
                "circle-radius": 15,
                "circle-color": "transparent",
                "circle-stroke-color": colors.accent,
                "circle-stroke-width": 2,
              }}
            />
            <Layer
              id="stop-label"
              type="symbol"
              minzoom={12}
              layout={{
                "text-field": ["get", "label"],
                "text-font": LABEL_FONT,
                "text-size": 11,
                "text-allow-overlap": true,
                "text-ignore-placement": true,
              }}
              paint={{
                "text-color": "white",
                "text-opacity": ["case", DIM, 0.25, 1],
              }}
            />
          </Source>
        ) : null}

        {problem?.depot ? (
          <Marker longitude={problem.depot.lon} latitude={problem.depot.lat} anchor="center">
            <div
              role="img"
              aria-label={t("depot")}
              className="flex size-[22px] items-center justify-center rounded-[4px] bg-foreground text-bg"
            >
              <Warehouse size={14} strokeWidth={1.75} aria-hidden="true" />
            </div>
          </Marker>
        ) : null}

        {problem && problem.mode === "multi_origin"
          ? problem.drivers.map((driver, index) => {
              const origin = originOf(problem, driver);
              if (!origin) return null;
              return (
                <Marker
                  key={driver.id}
                  longitude={origin.lon}
                  latitude={origin.lat}
                  anchor="center"
                >
                  <div
                    role="img"
                    aria-label={t("driverStart", { n: index + 1 })}
                    className="num flex size-[22px] items-center justify-center rounded-full border-2 bg-surface text-[11px] font-medium text-foreground"
                    style={{ borderColor: routeColor(index) }}
                  >
                    {index + 1}
                  </div>
                </Marker>
              );
            })
          : null}

        {hoverStop && hoverDetail ? (
          <Popup
            longitude={hoverStop.lng}
            latitude={hoverStop.lat}
            anchor="bottom"
            offset={14}
            closeButton={false}
            closeOnClick={false}
            maxWidth="280px"
          >
            <StopTooltip detail={hoverDetail} />
          </Popup>
        ) : null}
      </MapGL>
    </div>
  );
}
