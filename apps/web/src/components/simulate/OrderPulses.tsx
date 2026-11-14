"use client";

import { useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { usePrefersReducedMotion } from "@/components/map/use-map-colors";
import type { Stop } from "@/lib/api/types";

export const PULSE_MS = 600;
const CLEANUP_MS = PULSE_MS + 100;

type Pulse = { id: string; lat: number; lon: number };

export function OrderPulses({ orders }: { orders: { stop: Stop }[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (orders.length < seen.current) seen.current = 0;
    const fresh = orders.slice(seen.current);
    seen.current = orders.length;
    if (fresh.length === 0 || reducedMotion) return;
    const added = fresh.map((order) => ({
      id: order.stop.id,
      lat: order.stop.location.lat,
      lon: order.stop.location.lon,
    }));
    setPulses((current) => [...current, ...added]);
    setTimeout(() => {
      setPulses((current) => current.filter((pulse) => !added.some((a) => a.id === pulse.id)));
    }, CLEANUP_MS);
  }, [orders, reducedMotion]);

  return (
    <>
      {pulses.map((pulse) => (
        <Marker key={pulse.id} longitude={pulse.lon} latitude={pulse.lat} anchor="center">
          <span aria-hidden="true" data-testid="order-pulse" className="order-pulse block" />
        </Marker>
      ))}
    </>
  );
}
