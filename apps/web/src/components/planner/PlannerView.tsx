"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";
import { LeftPanel } from "./LeftPanel";
import { LiveBar } from "./LiveBar";
import { ResultsPanel } from "./ResultsPanel";
import { StatusBanners } from "./StatusBanners";

const DESKTOP_QUERY = "(min-width: 768px)";
const LEFT_PANEL = 384;
const RIGHT_PANEL = 344;
const EDGE = 24;

function useViewport() {
  const [state, setState] = useState({ desktop: true });
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => setState({ desktop: query.matches });
    update();
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return state;
}

export function PlannerView() {
  const t = useTranslations("planner");
  const { desktop } = useViewport();
  const [showResults, setShowResults] = useState(true);
  const [mobileView, setMobileView] = useState<"config" | "results">("config");

  const problem = usePlanner((state) => state.problem);
  const solution = usePlanner((state) => state.solution);
  const status = usePlanner((state) => state.status);
  const fitNonce = usePlanner((state) => state.fitNonce);
  const selectedRoute = usePlanner((state) => state.selectedRoute);
  const hoveredRoute = usePlanner((state) => state.hoveredRoute);
  const selectedStopId = usePlanner((state) => state.selectedStopId);
  const loadCatalog = usePlanner((state) => state.loadCatalog);
  const loadScenario = usePlanner((state) => state.loadScenario);
  const optimize = usePlanner((state) => state.optimize);
  const setSelectedRoute = usePlanner((state) => state.setSelectedRoute);
  const hoverRoute = usePlanner((state) => state.hoverRoute);
  const selectStop = usePlanner((state) => state.selectStop);

  const running = status === "running" || status === "loading";
  const resultsVisible = solution !== null && showResults;

  useEffect(() => {
    void loadCatalog();
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1" && usePlanner.getState().problem === null) {
      void loadScenario();
    }
  }, [loadCatalog, loadScenario]);

  const hasSolution = solution !== null;
  const [seenSolution, setSeenSolution] = useState(hasSolution);
  if (seenSolution !== hasSolution) {
    setSeenSolution(hasSolution);
    setShowResults(true);
    setMobileView(hasSolution ? "results" : "config");
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const state = usePlanner.getState();
        if (state.selectedRoute !== null) state.setSelectedRoute(null);
        else if (state.selectedStopId !== null) state.selectStop(null);
        else setShowResults(false);
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void optimize();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [optimize]);

  const padding = useMemo(
    () =>
      desktop
        ? {
            top: EDGE,
            bottom: EDGE,
            left: LEFT_PANEL + EDGE,
            right: resultsVisible ? RIGHT_PANEL + EDGE : EDGE,
          }
        : { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE },
    [desktop, resultsVisible],
  );

  const focus = useMemo(
    () => ({ selectedRoute, hoveredRoute, selectedStopId }),
    [selectedRoute, hoveredRoute, selectedStopId],
  );

  const showConfig = desktop || mobileView === "config" || !resultsVisible;
  const showResultsPanel = resultsVisible && (desktop || mobileView === "results");

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <RouteMapLoader
        className="absolute inset-x-0 top-0 bottom-[45dvh] md:inset-0"
        problem={problem}
        solution={solution}
        focus={focus}
        padding={padding}
        fitNonce={fitNonce}
        onHoverRoute={hoverRoute}
        onSelectRoute={setSelectedRoute}
        onSelectStop={selectStop}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 md:left-96 md:right-3">
        <StatusBanners
          className={cn(
            "pointer-events-auto max-w-xl",
            resultsVisible && desktop && "md:mr-86",
          )}
        />
      </div>

      <aside
        aria-label={t("panelLabel")}
        className={cn(
          "absolute z-10 flex-col overflow-hidden border border-border bg-surface shadow-sm",
          "inset-x-0 bottom-0 h-[45dvh] rounded-t-lg border-b-0",
          "md:inset-x-auto md:top-3 md:bottom-3 md:left-3 md:h-auto md:w-90 md:rounded-lg md:border-b",
          showConfig ? "flex" : "hidden",
          !desktop && showResultsPanel && "hidden",
        )}
      >
        {!desktop && resultsVisible ? (
          <MobileSwitch value={mobileView} onChange={setMobileView} />
        ) : null}
        <LeftPanel />
      </aside>

      {showResultsPanel && solution && problem ? (
        <aside
          aria-label={t("results.panelLabel")}
          className={cn(
            "absolute z-10 flex flex-col overflow-hidden border border-border bg-surface shadow-sm",
            "inset-x-0 bottom-0 h-[45dvh] rounded-t-lg border-b-0",
            "md:inset-x-auto md:top-3 md:right-3 md:bottom-24 md:h-auto md:w-80 md:rounded-lg md:border-b",
          )}
        >
          {!desktop ? <MobileSwitch value={mobileView} onChange={setMobileView} /> : null}
          <ResultsPanel
            solution={solution}
            problem={problem}
            onClose={desktop ? () => setShowResults(false) : undefined}
          />
        </aside>
      ) : null}

      {solution && !showResults && desktop ? (
        <Button
          variant="outline"
          className="absolute top-3 right-3 z-10 bg-surface"
          onClick={() => setShowResults(true)}
        >
          {t("results.show")}
        </Button>
      ) : null}

      {running ? (
        <LiveBar
          className={cn(
            "absolute z-20 inset-x-3 bottom-[calc(45dvh+12px)]",
            "md:inset-x-auto md:bottom-3 md:left-96",
            resultsVisible ? "md:right-86" : "md:right-3",
          )}
        />
      ) : null}
    </div>
  );
}

function MobileSwitch({
  value,
  onChange,
}: {
  value: "config" | "results";
  onChange: (value: "config" | "results") => void;
}) {
  const t = useTranslations("planner");
  return (
    <div role="tablist" aria-label={t("panelLabel")} className="flex shrink-0 gap-1 border-b border-border p-2">
      {(["config", "results"] as const).map((id) => (
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
          {t(`mobile.${id}`)}
        </button>
      ))}
    </div>
  );
}
