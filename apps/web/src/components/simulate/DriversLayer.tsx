"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { usePrefersReducedMotion } from "@/components/map/use-map-colors";
import type { DriverPosition, Problem } from "@/lib/api/types";
import {
  positionsOf,
  retarget,
  sampleTween,
  tickDuration,
  tweenFinished,
  type Positions,
  type Tween,
} from "@/lib/sim/interpolate";
import { routeColor } from "@/lib/routes/palette";

function useAnimatedPositions(
  positions: DriverPosition[],
  tickSeq: number,
  reducedMotion: boolean,
): Positions {
  const [shown, setShown] = useState<Positions>({});
  const shownRef = useRef<Positions>({});
  const tweenRef = useRef<Tween | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const target = positionsOf(positions);
    const now = performance.now();
    const duration = tickDuration(lastTickRef.current, now);
    lastTickRef.current = now;

    if (reducedMotion || Object.keys(shownRef.current).length === 0) {
      shownRef.current = target;
      tweenRef.current = null;
      setShown(target);
      return;
    }

    tweenRef.current = retarget(shownRef.current, target, now, duration);
    if (frameRef.current !== null) return;

    const step = (frame: number) => {
      const tween = tweenRef.current;
      if (!tween) {
        frameRef.current = null;
        return;
      }
      const next = sampleTween(tween, frame);
      shownRef.current = next;
      setShown(next);
      if (tweenFinished(tween, frame)) {
        tweenRef.current = null;
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, [positions, tickSeq, reducedMotion]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  return shown;
}

const TRAIL_POINTS = 10;
const TRAIL_MIN_STEP_DEG = 0.00005;

type TrailProps = { color: string };
type Trails = Record<string, [number, number][]>;

function useTrails(shown: Positions, reducedMotion: boolean): Trails {
  const [trails, setTrails] = useState<Trails>({});

  useEffect(() => {
    if (reducedMotion) return;
    const frame = requestAnimationFrame(() => {
      setTrails((current) => {
        const next: Trails = {};
        for (const [id, point] of Object.entries(shown)) {
          const history = current[id] ?? [];
          const last = history[history.length - 1];
          const moved =
            !last ||
            Math.abs(last[0] - point.lon) > TRAIL_MIN_STEP_DEG ||
            Math.abs(last[1] - point.lat) > TRAIL_MIN_STEP_DEG;
          next[id] = moved
            ? [...history, [point.lon, point.lat] as [number, number]].slice(-TRAIL_POINTS)
            : history;
        }
        return next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, reducedMotion]);

  return reducedMotion ? {} : trails;
}

function trailCollection(
  problem: Problem,
  trails: Trails,
): FeatureCollection<LineString, TrailProps> {
  const features: Feature<LineString, TrailProps>[] = [];
  problem.drivers.forEach((driver, index) => {
    const points = trails[driver.id];
    if (!points || points.length < 2) return;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points },
      properties: { color: routeColor(index) },
    });
  });
  return { type: "FeatureCollection", features };
}

export function DriversLayer({
  problem,
  positions,
  tickSeq,
}: {
  problem: Problem;
  positions: DriverPosition[];
  tickSeq: number;
}) {
  const t = useTranslations("simulate.map");
  const reducedMotion = usePrefersReducedMotion();
  const shown = useAnimatedPositions(positions, tickSeq, reducedMotion);
  const trails = useTrails(shown, reducedMotion);
  const trailData = trailCollection(problem, trails);

  return (
    <>
      <Source id="sim-trails" type="geojson" data={trailData}>
        <Layer
          id="sim-trails-line"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.45, "line-blur": 1 }}
        />
      </Source>
      {problem.drivers.map((driver, index) => {
        const point = shown[driver.id];
        if (!point) return null;
        return (
          <Marker key={driver.id} longitude={point.lon} latitude={point.lat} anchor="center">
            <div
              role="img"
              aria-label={t("driver", { n: index + 1 })}
              data-testid="sim-driver"
              className="num flex size-6 items-center justify-center rounded-full border-2 bg-surface text-[11px] font-medium text-foreground shadow-sm"
              style={{ borderColor: routeColor(index) }}
            >
              {index + 1}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
