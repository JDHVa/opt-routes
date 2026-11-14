"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { fetchScenario } from "@/lib/api/client";
import type { Problem } from "@/lib/api/types";
import { EMPTY_FOCUS, type MapExtras } from "@/lib/map/geojson";
import {
  SIM_FORM_DEFAULTS,
  toSimulationConfig,
  validateSimForm,
  type SimConfigForm,
} from "@/lib/sim/config";
import { buildPlanView, makeOrder, nextOrderId } from "@/lib/sim/plan";
import { knownStops } from "@/lib/sim/reducer";
import { cn } from "@/lib/utils";
import { clearPresetParam, usePresetParam } from "@/lib/use-preset-param";
import { usePlanner } from "@/stores/planner";
import { DeliveryChecks } from "./DeliveryChecks";
import { DriversLayer } from "./DriversLayer";
import { EventLog } from "./EventLog";
import { OrderPulses } from "./OrderPulses";
import { SimConfigPanel } from "./SimConfigPanel";
import { SimStatusPanel } from "./SimStatusPanel";
import { Timeline } from "./Timeline";
import { useSimulation } from "./use-simulation";

const LEFT_PANEL = 384;
const RIGHT_PANEL = 344;
const EDGE = 24;
const TIMELINE_HEIGHT = 140;
const DESKTOP_QUERY = "(min-width: 768px)";

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function SimulateView() {
  const t = useTranslations("simulate");
  const desktop = useDesktop();
  const sim = useSimulation();
  const { state } = sim;

  const catalogStatus = usePlanner((s) => s.catalogStatus);
  const scenarios = usePlanner((s) => s.scenarios);
  const algorithms = usePlanner((s) => s.algorithms);
  const loadCatalog = usePlanner((s) => s.loadCatalog);

  const [form, setForm] = useState<SimConfigForm>(SIM_FORM_DEFAULTS);
  const [loaded, setLoaded] = useState<{ id: string; problem: Problem | null } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [fitNonce, setFitNonce] = useState(1);
  const [mobileTab, setMobileTab] = useState<"panel" | "log">("panel");

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const catalogReady = catalogStatus === "ready";
  const scenarioId = scenarios.some((s) => s.id === form.scenarioId)
    ? form.scenarioId
    : (scenarios[0]?.id ?? null);

  useEffect(() => {
    if (!catalogReady || scenarioId === null) return;
    let cancelled = false;
    fetchScenario(scenarioId)
      .then((problem) => {
        if (cancelled) return;
        setLoaded({ id: scenarioId, problem });
        setFitNonce((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: scenarioId, problem: null });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogReady, scenarioId]);

  const problem = loaded && loaded.id === scenarioId ? loaded.problem : null;
  const scenarioLoading = catalogReady && scenarioId !== null && loaded?.id !== scenarioId;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const errors = useMemo(() => validateSimForm(form), [form]);
  const configurable =
    state.phase === "idle" || state.phase === "error" || state.phase === "closed";

  const stops = useMemo(
    () => (problem ? knownStops(problem, state.orders) : []),
    [problem, state.orders],
  );

  const view = useMemo(
    () =>
      problem
        ? buildPlanView(problem, stops, state.plan, state.positions, state.delivered)
        : null,
    [problem, stops, state.plan, state.positions, state.delivered],
  );

  const extras = useMemo<MapExtras | undefined>(
    () =>
      view
        ? { origins: view.origins, delivered: view.delivered, flagUnassigned: false }
        : undefined,
    [view],
  );

  const start = useCallback(() => {
    if (!problem) return;
    const config = toSimulationConfig(problem, form);
    if (config) sim.start(config);
  }, [problem, form, sim]);

  const preset = usePresetParam("simulate");
  const handledPreset = useRef<string | null>(null);
  const autoStart = useRef(false);
  useEffect(() => {
    if (!preset) {
      handledPreset.current = null;
      return;
    }
    if (handledPreset.current === preset.id) return;
    handledPreset.current = preset.id;
    clearPresetParam();
    setForm((current) => ({
      ...current,
      scenarioId: preset.scenarioId,
      algorithm: preset.algorithm,
      reoptTimeLimitS: preset.timeLimitS,
    }));
    autoStart.current = true;
  }, [preset]);

  useEffect(() => {
    if (!autoStart.current || !problem || !configurable || !catalogReady) return;
    autoStart.current = false;
    start();
  }, [problem, configurable, catalogReady, start]);

  const placeOrder = useCallback(
    (point: { lng: number; lat: number }) => {
      if (!problem) return;
      const id = nextOrderId([
        ...problem.stops.map((s) => s.id),
        ...state.orders.map((o) => o.stop.id),
      ]);
      sim.addOrder(makeOrder(id, { lat: point.lat, lon: point.lng }, state.clock));
      setPlacing(false);
    },
    [problem, sim, state.orders, state.clock],
  );

  const reset = useCallback(() => {
    sim.reset();
    setPlacing(false);
    setFitNonce((n) => n + 1);
  }, [sim]);

  const padding = useMemo(
    () =>
      desktop
        ? { top: EDGE, bottom: TIMELINE_HEIGHT + EDGE, left: LEFT_PANEL + EDGE, right: RIGHT_PANEL + EDGE }
        : { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
    [desktop],
  );

  const scenarioName = scenarios.find((s) => s.id === scenarioId)?.name ?? scenarioId ?? "";
  const showTimeline = !configurable;

  const leftPanel = configurable ? (
    <SimConfigPanel
      form={{ ...form, scenarioId: scenarioId ?? form.scenarioId }}
      errors={errors}
      scenarios={scenarios}
      algorithms={algorithms}
      catalogReady={catalogReady}
      scenarioLoading={scenarioLoading}
      scenarioReady={problem !== null}
      connecting={false}
      state={state}
      onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
      onStart={start}
    />
  ) : (
    <SimStatusPanel
      state={state}
      form={form}
      scenarioName={scenarioName}
      totalStops={stops.length}
      onReset={reset}
    />
  );

  const timeline = showTimeline ? (
    <Timeline
      state={state}
      placing={placing}
      onTogglePlacing={() => setPlacing((p) => !p)}
      onPause={sim.pause}
      onResume={sim.resume}
      onSpeed={sim.setSpeed}
      onStop={sim.stop}
    />
  ) : null;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <RouteMapLoader
        className="absolute inset-x-0 top-0 bottom-[45dvh] md:inset-0"
        problem={view?.problem ?? null}
        solution={view?.solution ?? null}
        focus={EMPTY_FOCUS}
        padding={padding}
        fitNonce={fitNonce}
        extras={extras}
        placing={placing}
        onMapClick={placeOrder}
      >
        {problem ? (
          <DriversLayer problem={problem} positions={state.positions} tickSeq={state.tickSeq} />
        ) : null}
        <OrderPulses orders={state.orders} />
        <DeliveryChecks stops={stops} delivered={state.delivered} />
      </RouteMapLoader>

      {placing ? (
        <p
          role="status"
          className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-small shadow-sm"
        >
          {t("placingHint")}
        </p>
      ) : null}

      <aside
        aria-label={t("panelLabel")}
        className={cn(
          "absolute z-10 flex flex-col overflow-hidden border border-border bg-surface shadow-sm",
          "inset-x-0 bottom-0 h-[45dvh] rounded-t-lg border-b-0",
          "md:inset-x-auto md:top-3 md:bottom-3 md:left-3 md:h-auto md:w-90 md:rounded-lg md:border-b",
          !desktop && mobileTab !== "panel" && "hidden",
        )}
      >
        {!desktop ? (
          <MobileSwitch value={mobileTab} onChange={setMobileTab} />
        ) : null}
        {!desktop && timeline ? <div className="p-2">{timeline}</div> : null}
        {leftPanel}
      </aside>

      {desktop || mobileTab === "log" ? (
        <aside
          aria-label={t("log.title")}
          className={cn(
            "absolute z-10 flex flex-col overflow-hidden border border-border bg-surface shadow-sm",
            "inset-x-0 bottom-0 h-[45dvh] rounded-t-lg border-b-0",
            "md:inset-x-auto md:top-3 md:right-3 md:bottom-10 md:h-auto md:w-80 md:rounded-lg md:border-b",
          )}
        >
          {!desktop ? <MobileSwitch value={mobileTab} onChange={setMobileTab} /> : null}
          <EventLog events={state.events} />
        </aside>
      ) : null}

      {desktop && timeline ? (
        <div className="absolute bottom-3 left-96 right-86 z-10">{timeline}</div>
      ) : null}

      {!problem && !scenarioLoading && catalogReady ? (
        <p
          role="alert"
          className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-danger bg-surface px-3 py-2 text-small shadow-sm"
        >
          {t("scenarioFailed")}
        </p>
      ) : null}
    </div>
  );
}

function MobileSwitch({
  value,
  onChange,
}: {
  value: "panel" | "log";
  onChange: (value: "panel" | "log") => void;
}) {
  const t = useTranslations("simulate.mobile");
  return (
    <div role="tablist" aria-label={t("label")} className="flex shrink-0 gap-1 border-b border-border p-2">
      {(["panel", "log"] as const).map((id) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-9 flex-1 rounded-md text-small font-medium",
            value === id ? "bg-accent-soft text-foreground" : "text-muted",
          )}
        >
          {t(id)}
        </button>
      ))}
    </div>
  );
}
