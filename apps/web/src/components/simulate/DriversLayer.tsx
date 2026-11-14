"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
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

  return (
    <>
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
