"use client";

import type { FeatureCollection, LineString, Point } from "geojson";
import type { GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef, type RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import type { Solution } from "@/lib/api/types";
import { antFeatures, buildAntPaths, type AntPath, type AntProps } from "@/lib/map/ants";
import type { RouteProps } from "@/lib/map/geojson";
import {
  CROSSFADE_DIP,
  CROSSFADE_LAYERS,
  CROSSFADE_MS,
  routeOpacity,
} from "./route-style";
import { startRouteDraw } from "./route-draw";

export const ANTS_SOURCE_ID = "ants";
export const EMPTY_ANTS: FeatureCollection<Point, AntProps> = {
  type: "FeatureCollection",
  features: [],
};

const FRAME_INTERVAL_MS = 33;
const FADE_OUT_MS = 350;
const LAYER_POLL_LIMIT = 90;

type Params = {
  mapRef: RefObject<MapRef | null>;
  ready: boolean;
  routes: FeatureCollection<LineString, RouteProps> | null;
  solution: Solution | null;
  drawNonce: number | undefined;
  ants: boolean;
  reduced: boolean;
  background: string;
};

export function useRouteMotion({
  mapRef,
  ready,
  routes,
  solution,
  drawNonce,
  ants,
  reduced,
  background,
}: Params): void {
  const routesRef = useRef(routes);
  const pathsRef = useRef<AntPath[]>([]);
  const backgroundRef = useRef(background);
  const lastDrawn = useRef<number | null>(null);
  const cancelDraw = useRef<(() => void) | null>(null);
  const drawing = useRef(false);
  const lastSolution = useRef<Solution | null>(null);
  const hasRoutes = (routes?.features.length ?? 0) > 0;

  useEffect(() => {
    routesRef.current = routes;
    backgroundRef.current = background;
    pathsRef.current = routes ? buildAntPaths(routes) : [];
  }, [routes, background]);

  useEffect(() => {
    if (!ready || drawNonce === undefined || reduced || !hasRoutes) return;
    if (lastDrawn.current === drawNonce) return;
    lastDrawn.current = drawNonce;
    cancelDraw.current?.();
    cancelDraw.current = null;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let attempts = 0;
    let frame = 0;
    const begin = () => {
      const current = routesRef.current;
      if (!current) return;
      if (!map.getLayer("route-arrows") || !map.getSource("routes")) {
        attempts += 1;
        if (attempts < LAYER_POLL_LIMIT) frame = requestAnimationFrame(begin);
        return;
      }
      drawing.current = true;
      cancelDraw.current = startRouteDraw(
        map,
        current.features.map((feature) => ({
          driverIndex: feature.properties.driverIndex,
          color: feature.properties.color,
        })),
        {
          background: backgroundRef.current,
          onDone: () => {
            drawing.current = false;
          },
        },
      );
    };
    frame = requestAnimationFrame(begin);
    return () => cancelAnimationFrame(frame);
  }, [ready, drawNonce, hasRoutes, reduced, mapRef]);

  useEffect(
    () => () => {
      cancelDraw.current?.();
      cancelDraw.current = null;
    },
    [],
  );

  useEffect(() => {
    const previous = lastSolution.current;
    lastSolution.current = solution;
    if (!ready || reduced || previous === null || solution === null || previous === solution) return;
    if (drawing.current) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    for (const layer of CROSSFADE_LAYERS) {
      if (!map.getLayer(layer.id)) continue;
      map.setPaintProperty(layer.id, `${layer.property}-transition`, { duration: 0, delay: 0 });
      map.setPaintProperty(layer.id, layer.property, routeOpacity(layer.base * CROSSFADE_DIP));
    }
    const frame = requestAnimationFrame(() => {
      for (const layer of CROSSFADE_LAYERS) {
        if (!map.getLayer(layer.id)) continue;
        map.setPaintProperty(layer.id, `${layer.property}-transition`, {
          duration: CROSSFADE_MS,
          delay: 0,
        });
        map.setPaintProperty(layer.id, layer.property, routeOpacity(layer.base));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [solution, ready, reduced, mapRef]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    const source = () => map.getSource(ANTS_SOURCE_ID) as GeoJSONSource | undefined;
    const setOpacity = (value: number) => {
      for (const id of ["ants", "ants-halo"]) {
        if (map.getLayer(id)) map.setPaintProperty(id, "circle-opacity", value);
      }
      if (map.getLayer("ants")) map.setPaintProperty("ants", "circle-stroke-opacity", value);
    };
    if (!ants || reduced) {
      setOpacity(0);
      const timer = setTimeout(() => source()?.setData(EMPTY_ANTS), FADE_OUT_MS);
      return () => clearTimeout(timer);
    }
    setOpacity(1);
    const start = performance.now();
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      if (now - last >= FRAME_INTERVAL_MS) {
        last = now;
        source()?.setData(antFeatures(pathsRef.current, now - start));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ants, reduced, ready, mapRef]);
}
