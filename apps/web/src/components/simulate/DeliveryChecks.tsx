"use client";

import { useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { usePrefersReducedMotion } from "@/components/map/use-map-colors";
import type { Stop } from "@/lib/api/types";

export const CHECK_VISIBLE_MS = 1800;

type Check = { id: string; lat: number; lon: number };

export function DeliveryChecks({ stops, delivered }: { stops: Stop[]; delivered: string[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const [checks, setChecks] = useState<Check[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (delivered.length < seen.current) seen.current = 0;
    const fresh = delivered.slice(seen.current);
    seen.current = delivered.length;
    if (fresh.length === 0 || reducedMotion) return;
    const byId = new Map(stops.map((stop) => [stop.id, stop]));
    const added: Check[] = fresh.flatMap((id) => {
      const stop = byId.get(id);
      return stop ? [{ id, lat: stop.location.lat, lon: stop.location.lon }] : [];
    });
    if (added.length === 0) return;
    setChecks((current) => [...current, ...added]);
    setTimeout(() => {
      setChecks((current) => current.filter((check) => !added.some((a) => a.id === check.id)));
    }, CHECK_VISIBLE_MS);
  }, [delivered, stops, reducedMotion]);

  return (
    <>
      {checks.map((check) => (
        <Marker key={check.id} longitude={check.lon} latitude={check.lat} anchor="center">
          <span
            aria-hidden="true"
            data-testid="delivery-check"
            className="flex size-5 items-center justify-center rounded-full bg-success text-bg shadow-sm"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path
                d="M3.5 8.5 6.5 11.5 12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="check-draw"
              />
            </svg>
          </span>
        </Marker>
      ))}
    </>
  );
}
