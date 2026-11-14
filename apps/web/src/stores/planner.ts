import { create } from "zustand";
import {
  ApiError,
  fetchAlgorithms,
  fetchScenario,
  fetchScenarios,
  fetchVehicles,
  generateScenario,
  streamSolve,
} from "@/lib/api/client";
import type {
  AlgorithmInfo,
  ConstraintToggles,
  CsvRowError,
  Driver,
  GenerateRequest,
  HistoryPoint,
  ObjectiveWeights,
  Problem,
  ProblemMode,
  ScenarioInfo,
  Solution,
  SolverStage,
  Stop,
  VehicleType,
} from "@/lib/api/types";
import {
  buildParamFields,
  defaultValues,
  toRunParams,
  validateParams,
  type ParamValue,
  type ParamValues,
} from "@/lib/planner/params-form";
import { presetToWeights, type PresetId } from "@/lib/planner/presets";

export const DEMO_SCENARIO_ID = "mty-centro-depot-40";
export const WAKE_NOTICE_DELAY_MS = 3000;

export type RunStatus = "idle" | "loading" | "running" | "done" | "error";
export type CatalogStatus = "idle" | "loading" | "ready" | "error";
export type LeftTab = "stops" | "fleet" | "constraints" | "algorithm";

export type PlannerError = {
  code: string;
  message: string;
  detail: string;
  retry: "optimize" | "scenario" | "catalog";
};

export type Progress = {
  iteration: number;
  elapsedS: number;
  bestFitness: number;
  stage: SolverStage | null;
  extra: Record<string, unknown>;
};

type PlannerState = {
  problem: Problem | null;
  solution: Solution | null;
  history: HistoryPoint[];
  progress: Progress | null;
  status: RunStatus;
  stopped: boolean;
  error: PlannerError | null;
  wakeSince: number | null;
  csvErrors: CsvRowError[];
  generating: boolean;

  algorithms: AlgorithmInfo[];
  vehicles: VehicleType[];
  scenarios: ScenarioInfo[];
  catalogStatus: CatalogStatus;
  scenarioLoading: boolean;

  algorithm: string;
  paramValues: ParamValues;

  leftTab: LeftTab;
  selectedRoute: number | null;
  hoveredRoute: number | null;
  selectedStopId: string | null;
  fitNonce: number;

  loadCatalog: () => Promise<void>;
  loadScenario: (id?: string) => Promise<void>;
  loadProblem: (problem: Problem) => void;
  replaceStops: (stops: Stop[]) => Promise<void>;
  setCsvErrors: (errors: CsvRowError[]) => void;
  generate: (request: GenerateRequest) => Promise<boolean>;
  adoptSolution: (solution: Solution) => void;
  setMode: (mode: ProblemMode) => void;
  toggleConstraint: (key: keyof ConstraintToggles, value: boolean) => void;
  applyPreset: (preset: PresetId) => void;
  setWeight: (key: keyof ObjectiveWeights, value: number) => void;
  setAlgorithm: (name: string) => void;
  setParam: (key: string, value: ParamValue) => void;
  updateDriver: (index: number, patch: Partial<Driver>) => void;
  addDriver: () => void;
  removeDriver: (index: number) => void;
  optimize: () => Promise<void>;
  stop: () => void;
  retry: () => void;
  setLeftTab: (tab: LeftTab) => void;
  selectRoute: (index: number | null) => void;
  setSelectedRoute: (index: number | null) => void;
  hoverRoute: (index: number | null) => void;
  selectStop: (id: string | null) => void;
  requestFit: () => void;
};

let controller: AbortController | null = null;

function toPlannerError(
  error: unknown,
  retry: PlannerError["retry"],
): PlannerError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, detail: error.detail, retry };
  }
  return { code: "unknown", message: "unknown", detail: String(error), retry };
}

function algorithmDefaults(info: AlgorithmInfo | undefined): ParamValues {
  return info ? defaultValues(buildParamFields(info.params_schema)) : {};
}

function pickDemo(scenarios: ScenarioInfo[]): string {
  const demo = scenarios.find((s) => s.id === DEMO_SCENARIO_ID);
  return demo?.id ?? scenarios[0]?.id ?? DEMO_SCENARIO_ID;
}

export const usePlanner = create<PlannerState>((set, get) => {
  async function withWake<T>(task: () => Promise<T>): Promise<T> {
    const timer = setTimeout(
      () => set({ wakeSince: Date.now() }),
      WAKE_NOTICE_DELAY_MS,
    );
    try {
      return await task();
    } finally {
      clearTimeout(timer);
      set({ wakeSince: null });
    }
  }

  return {
    problem: null,
    solution: null,
    history: [],
    progress: null,
    status: "idle",
    stopped: false,
    error: null,
    wakeSince: null,
    csvErrors: [],
    generating: false,

    algorithms: [],
    vehicles: [],
    scenarios: [],
    catalogStatus: "idle",
    scenarioLoading: false,

    algorithm: "ga",
    paramValues: {},

    leftTab: "stops",
    selectedRoute: null,
    hoveredRoute: null,
    selectedStopId: null,
    fitNonce: 0,

    loadCatalog: async () => {
      if (get().catalogStatus === "loading" || get().catalogStatus === "ready") return;
      set({ catalogStatus: "loading" });
      try {
        const [algorithms, catalog, scenarios] = await withWake(() =>
          Promise.all([fetchAlgorithms(), fetchVehicles(), fetchScenarios()]),
        );
        const current = get().algorithm;
        const chosen = algorithms.find((a) => a.name === current) ?? algorithms[0];
        set({
          algorithms,
          vehicles: catalog.vehicles,
          scenarios,
          catalogStatus: "ready",
          algorithm: chosen?.name ?? current,
          paramValues: algorithmDefaults(chosen),
        });
      } catch (error) {
        set({
          catalogStatus: "error",
          error: toPlannerError(error, "catalog"),
        });
      }
    },

    loadScenario: async (id) => {
      set({ scenarioLoading: true, error: null });
      try {
        const scenarioId = id ?? pickDemo(get().scenarios);
        const problem = await withWake(() => fetchScenario(scenarioId));
        get().loadProblem(problem);
      } catch (error) {
        set({ error: toPlannerError(error, "scenario"), status: "error" });
      } finally {
        set({ scenarioLoading: false });
      }
    },

    loadProblem: (problem) => {
      controller?.abort();
      set({
        problem,
        solution: null,
        history: [],
        progress: null,
        status: "idle",
        stopped: false,
        error: null,
        csvErrors: [],
        selectedRoute: null,
        hoveredRoute: null,
        selectedStopId: null,
        fitNonce: get().fitNonce + 1,
      });
    },

    replaceStops: async (stops) => {
      if (get().problem === null) await get().loadScenario();
      const problem = get().problem;
      if (!problem) return;
      controller?.abort();
      set({
        problem: { ...problem, stops },
        solution: null,
        history: [],
        progress: null,
        status: "idle",
        stopped: false,
        csvErrors: [],
        selectedRoute: null,
        selectedStopId: null,
        fitNonce: get().fitNonce + 1,
      });
    },

    setCsvErrors: (errors) => set({ csvErrors: errors }),

    generate: async (request) => {
      set({ generating: true, error: null });
      try {
        const problem = await withWake(() => generateScenario(request));
        get().loadProblem(problem);
        return true;
      } catch (error) {
        set({ error: toPlannerError(error, "scenario") });
        return false;
      } finally {
        set({ generating: false });
      }
    },

    adoptSolution: (solution) =>
      set({
        solution,
        history: [],
        progress: null,
        status: "done",
        stopped: false,
        selectedRoute: null,
        hoveredRoute: null,
        selectedStopId: null,
        fitNonce: get().fitNonce + 1,
      }),

    setMode: (mode) => {
      const problem = get().problem;
      if (!problem) return;
      const drivers =
        mode === "multi_origin"
          ? problem.drivers.map((driver) => ({
              ...driver,
              start: driver.start ?? problem.depot ?? null,
            }))
          : problem.drivers;
      set({ problem: { ...problem, mode, drivers }, solution: null, status: "idle" });
    },

    toggleConstraint: (key, value) => {
      const problem = get().problem;
      if (!problem) return;
      set({
        problem: { ...problem, constraints: { ...problem.constraints, [key]: value } },
      });
    },

    applyPreset: (preset) => {
      const problem = get().problem;
      if (!problem) return;
      set({
        problem: {
          ...problem,
          objective: { ...problem.objective, weights: presetToWeights(preset) },
        },
      });
    },

    setWeight: (key, value) => {
      const problem = get().problem;
      if (!problem) return;
      set({
        problem: {
          ...problem,
          objective: {
            ...problem.objective,
            weights: { ...problem.objective.weights, [key]: value },
          },
        },
      });
    },

    setAlgorithm: (name) => {
      const info = get().algorithms.find((a) => a.name === name);
      set({ algorithm: name, paramValues: algorithmDefaults(info) });
    },

    setParam: (key, value) =>
      set((state) => ({ paramValues: { ...state.paramValues, [key]: value } })),

    updateDriver: (index, patch) => {
      const problem = get().problem;
      if (!problem) return;
      const drivers = problem.drivers.map((driver, i) =>
        i === index ? { ...driver, ...patch } : driver,
      );
      set({ problem: { ...problem, drivers } });
    },

    addDriver: () => {
      const { problem, vehicles } = get();
      if (!problem) return;
      const template = problem.drivers[problem.drivers.length - 1];
      const number = problem.drivers.length + 1;
      const driver: Driver = {
        id: `d${String(number).padStart(2, "0")}`,
        name: null,
        vehicle_type_id: template?.vehicle_type_id ?? vehicles[0]?.id ?? "",
        start: problem.mode === "multi_origin" ? (template?.start ?? problem.depot ?? null) : null,
        end: null,
        shift_start_min: template?.shift_start_min ?? 0,
        max_shift_min: template?.max_shift_min ?? 600,
        hourly_wage_mxn: template?.hourly_wage_mxn ?? 80,
      };
      set({ problem: { ...problem, drivers: [...problem.drivers, driver] } });
    },

    removeDriver: (index) => {
      const problem = get().problem;
      if (!problem || problem.drivers.length <= 1) return;
      set({
        problem: {
          ...problem,
          drivers: problem.drivers.filter((_, i) => i !== index),
        },
        solution: null,
        status: "idle",
      });
    },

    optimize: async () => {
      const { problem, algorithm, algorithms, paramValues } = get();
      if (!problem || problem.stops.length === 0) return;
      const info = algorithms.find((a) => a.name === algorithm);
      if (info) {
        const check = validateParams(buildParamFields(info.params_schema), paramValues);
        if (!check.ok) return;
      }
      controller?.abort();
      const run = new AbortController();
      controller = run;
      set({
        status: "loading",
        stopped: false,
        error: null,
        solution: null,
        history: [],
        progress: null,
        selectedRoute: null,
        hoveredRoute: null,
      });
      const wakeTimer = setTimeout(
        () => set({ wakeSince: Date.now() }),
        WAKE_NOTICE_DELAY_MS,
      );
      const clearWake = () => {
        clearTimeout(wakeTimer);
        set({ wakeSince: null });
      };
      const last: { value: Solution | null } = { value: null };
      await streamSolve(
        {
          problem,
          run: { algorithm, params: toRunParams(paramValues) },
          include_geometry: true,
        },
        {
          onResponse: clearWake,
          onProgress: (payload) => {
            if (run.signal.aborted) return;
            if (payload.solution) last.value = payload.solution;
            set((state) => ({
              status: "running",
              solution: payload.solution ?? state.solution,
              progress: {
                iteration: payload.iteration,
                elapsedS: payload.elapsed_s,
                bestFitness: payload.best_fitness,
                stage: payload.stage ?? null,
                extra: payload.extra ?? {},
              },
              history: [
                ...state.history,
                {
                  iteration: payload.iteration,
                  elapsed_s: payload.elapsed_s,
                  best_fitness: payload.best_fitness,
                },
              ],
            }));
          },
          onResult: (response) => {
            if (run.signal.aborted) return;
            last.value = response.solution;
            set({
              status: "done",
              solution: response.solution,
              history: response.history,
              fitNonce: get().fitNonce + 1,
            });
          },
          onError: (error) => {
            if (run.signal.aborted) return;
            clearWake();
            set({
              status: "error",
              error: {
                code: error.code,
                message: error.message,
                detail: "",
                retry: "optimize",
              },
            });
          },
        },
        run.signal,
      );
      clearWake();
      if (run.signal.aborted) {
        if (controller === run) {
          set({
            status: last.value ? "done" : "idle",
            stopped: true,
            solution: last.value,
          });
        }
        return;
      }
      const status = get().status;
      if (status === "running" || status === "loading") {
        if (last.value) {
          set({ status: "done", solution: last.value });
        } else {
          set({
            status: "error",
            error: { code: "stream_closed", message: "stream_closed", detail: "", retry: "optimize" },
          });
        }
      }
    },

    stop: () => {
      const run = controller;
      if (!run) return;
      run.abort();
      const { solution } = get();
      set({ status: solution ? "done" : "idle", stopped: true, wakeSince: null });
    },

    retry: () => {
      const error = get().error;
      if (!error) return;
      set({ error: null });
      if (error.retry === "optimize") void get().optimize();
      else if (error.retry === "scenario") void get().loadScenario();
      else {
        set({ catalogStatus: "idle" });
        void get().loadCatalog();
      }
    },

    setLeftTab: (tab) => set({ leftTab: tab }),
    selectRoute: (index) =>
      set((state) => ({ selectedRoute: state.selectedRoute === index ? null : index })),
    setSelectedRoute: (index) => set({ selectedRoute: index }),
    hoverRoute: (index) => set({ hoveredRoute: index }),
    selectStop: (id) => set({ selectedStopId: id }),
    requestFit: () => set((state) => ({ fitNonce: state.fitNonce + 1 })),
  };
});
