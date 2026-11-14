import { create } from "zustand";
import { ApiError, fetchScenario, streamCompare } from "@/lib/api/client";
import type { AlgorithmInfo, Problem } from "@/lib/api/types";
import {
  applyCompareEvent,
  applyComplete,
  initialRuns,
  startRun,
} from "@/lib/compare/reducer";
import type { RunState } from "@/lib/compare/table";
import {
  buildParamFields,
  defaultValues,
  toRunParams,
  validateParams,
  type ParamValue,
  type ParamValues,
} from "@/lib/planner/params-form";
import { WAKE_NOTICE_DELAY_MS } from "@/stores/planner";

export const PLANNER_SOURCE = "planner";
export const DEFAULT_TIME_LIMIT_S = 10;
export const MIN_RUNS = 2;
export const MAX_RUNS = 6;
export const DEFAULT_ALGORITHMS = ["ga", "aco", "aco_ga", "pyvrp", "ortools"];

export type RunConfig = {
  id: string;
  algorithm: string;
  params: ParamValues;
};

export type CompareStatus = "idle" | "running" | "done" | "error";

export type CompareError = { code: string; message: string; detail: string };

type CompareState = {
  runs: RunConfig[];
  configured: boolean;
  timeLimitS: number | null;
  sourceId: string;
  scenarioProblem: Problem | null;
  scenarioLoading: boolean;
  status: CompareStatus;
  results: RunState[];
  error: CompareError | null;
  wakeSince: number | null;

  initRuns: (algorithms: AlgorithmInfo[]) => void;
  addRun: (algorithms: AlgorithmInfo[]) => void;
  removeRun: (id: string) => void;
  setRunAlgorithm: (id: string, algorithms: AlgorithmInfo[], name: string) => void;
  setRunParam: (id: string, key: string, value: ParamValue) => void;
  setTimeLimit: (value: number | null) => void;
  setSource: (sourceId: string) => Promise<void>;
  start: (problem: Problem) => Promise<void>;
  stop: () => void;
};

let controller: AbortController | null = null;
let counter = 0;

function nextId(): string {
  counter += 1;
  return `run-${counter}`;
}

function paramsFor(
  info: AlgorithmInfo | undefined,
  timeLimitS: number | null,
): ParamValues {
  const values = info ? defaultValues(buildParamFields(info.params_schema)) : {};
  if (timeLimitS !== null && "time_limit_s" in values) values.time_limit_s = timeLimitS;
  return values;
}

export function runIsValid(run: RunConfig, algorithms: AlgorithmInfo[]): boolean {
  const info = algorithms.find((a) => a.name === run.algorithm);
  if (!info) return false;
  return validateParams(buildParamFields(info.params_schema), run.params).ok;
}

export const useCompare = create<CompareState>((set, get) => ({
  runs: [],
  configured: false,
  timeLimitS: DEFAULT_TIME_LIMIT_S,
  sourceId: PLANNER_SOURCE,
  scenarioProblem: null,
  scenarioLoading: false,
  status: "idle",
  results: [],
  error: null,
  wakeSince: null,

  initRuns: (algorithms) => {
    if (get().configured || algorithms.length === 0) return;
    const available = DEFAULT_ALGORITHMS.filter((name) =>
      algorithms.some((a) => a.name === name),
    );
    const names = available.length >= MIN_RUNS ? available : algorithms.map((a) => a.name);
    const timeLimit = get().timeLimitS;
    set({
      configured: true,
      runs: names.slice(0, MAX_RUNS).map((name) => ({
        id: nextId(),
        algorithm: name,
        params: paramsFor(
          algorithms.find((a) => a.name === name),
          timeLimit,
        ),
      })),
    });
  },

  addRun: (algorithms) => {
    const { runs, timeLimitS } = get();
    if (runs.length >= MAX_RUNS || algorithms.length === 0) return;
    const used = new Set(runs.map((run) => run.algorithm));
    const info = algorithms.find((a) => !used.has(a.name)) ?? algorithms[0];
    set({
      runs: [
        ...runs,
        { id: nextId(), algorithm: info.name, params: paramsFor(info, timeLimitS) },
      ],
    });
  },

  removeRun: (id) => {
    const { runs } = get();
    if (runs.length <= MIN_RUNS) return;
    set({ runs: runs.filter((run) => run.id !== id) });
  },

  setRunAlgorithm: (id, algorithms, name) => {
    const info = algorithms.find((a) => a.name === name);
    const timeLimit = get().timeLimitS;
    set({
      runs: get().runs.map((run) =>
        run.id === id ? { ...run, algorithm: name, params: paramsFor(info, timeLimit) } : run,
      ),
    });
  },

  setRunParam: (id, key, value) =>
    set({
      runs: get().runs.map((run) =>
        run.id === id ? { ...run, params: { ...run.params, [key]: value } } : run,
      ),
    }),

  setTimeLimit: (value) =>
    set({
      timeLimitS: value,
      runs:
        value === null
          ? get().runs
          : get().runs.map((run) =>
              "time_limit_s" in run.params
                ? { ...run, params: { ...run.params, time_limit_s: value } }
                : run,
            ),
    }),

  setSource: async (sourceId) => {
    set({ sourceId, error: null });
    if (sourceId === PLANNER_SOURCE) return;
    set({ scenarioLoading: true });
    try {
      const problem = await fetchScenario(sourceId);
      if (get().sourceId === sourceId) set({ scenarioProblem: problem });
    } catch (error) {
      set({
        error:
          error instanceof ApiError
            ? { code: error.code, message: error.message, detail: error.detail }
            : { code: "unknown", message: "unknown", detail: String(error) },
      });
    } finally {
      set({ scenarioLoading: false });
    }
  },

  start: async (problem) => {
    const { runs } = get();
    controller?.abort();
    const run = new AbortController();
    controller = run;
    set({
      status: "running",
      error: null,
      results: startRun(
        initialRuns(runs.map((config) => config.algorithm)),
        0,
      ),
    });
    const wakeTimer = setTimeout(() => set({ wakeSince: Date.now() }), WAKE_NOTICE_DELAY_MS);
    const clearWake = () => {
      clearTimeout(wakeTimer);
      set({ wakeSince: null });
    };
    await streamCompare(
      {
        problem,
        runs: runs.map((config) => ({
          algorithm: config.algorithm,
          params: toRunParams(config.params),
        })),
        include_geometry: true,
      },
      {
        onResponse: clearWake,
        onEvent: (event) => {
          if (run.signal.aborted) return;
          if (event.kind === "error") {
            clearWake();
            set({
              status: "error",
              error: { code: event.payload.code, message: event.payload.message, detail: "" },
            });
            return;
          }
          if (event.kind === "complete") {
            set({ status: "done", results: applyComplete(get().results, event.payload) });
            return;
          }
          let next = applyCompareEvent(get().results, event);
          if (event.kind === "result") next = startRun(next, event.payload.run_index + 1);
          set({ results: next });
        },
      },
      run.signal,
    );
    clearWake();
    if (run.signal.aborted) return;
    if (get().status === "running") {
      const finished = get().results.some((result) => result.entry !== null);
      set({
        status: finished ? "done" : "error",
        error: finished ? null : { code: "stream_closed", message: "stream_closed", detail: "" },
      });
    }
  },

  stop: () => {
    controller?.abort();
    const results = get().results.map((result) =>
      result.status === "running" ? { ...result, status: "pending" as const } : result,
    );
    set({ status: results.some((r) => r.entry !== null) ? "done" : "idle", results, wakeSince: null });
  },
}));
