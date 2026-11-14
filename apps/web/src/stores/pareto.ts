import { create } from "zustand";
import { streamSolve } from "@/lib/api/client";
import type { ParetoPoint, Problem } from "@/lib/api/types";
import { OBJECTIVE_KEYS, type ObjectiveKey } from "@/lib/pareto/front";
import { WAKE_NOTICE_DELAY_MS } from "@/stores/planner";

export const DEFAULT_PARETO_TIME_LIMIT_S = 15;

export type ParetoStatus = "idle" | "running" | "done" | "error";

export type ParetoError = { code: string; message: string };

type ParetoState = {
  status: ParetoStatus;
  points: ParetoPoint[];
  progress: { iteration: number; elapsedS: number } | null;
  error: ParetoError | null;
  wakeSince: number | null;
  timeLimitS: number | null;
  xKey: ObjectiveKey;
  yKey: ObjectiveKey;
  selectedId: string | null;

  setTimeLimit: (value: number | null) => void;
  setAxis: (axis: "x" | "y", key: ObjectiveKey) => void;
  select: (id: string | null) => void;
  run: (problem: Problem) => Promise<void>;
  stop: () => void;
};

let controller: AbortController | null = null;

export const useParetoStore = create<ParetoState>((set, get) => ({
  status: "idle",
  points: [],
  progress: null,
  error: null,
  wakeSince: null,
  timeLimitS: DEFAULT_PARETO_TIME_LIMIT_S,
  xKey: "makespan",
  yKey: "cost",
  selectedId: null,

  setTimeLimit: (value) => set({ timeLimitS: value }),

  setAxis: (axis, key) => {
    const { xKey, yKey } = get();
    if (axis === "x") {
      set({ xKey: key, yKey: key === yKey ? (OBJECTIVE_KEYS.find((k) => k !== key) ?? yKey) : yKey });
    } else {
      set({ yKey: key, xKey: key === xKey ? (OBJECTIVE_KEYS.find((k) => k !== key) ?? xKey) : xKey });
    }
  },

  select: (id) => set({ selectedId: id }),

  run: async (problem) => {
    controller?.abort();
    const run = new AbortController();
    controller = run;
    const limit = get().timeLimitS;
    set({
      status: "running",
      points: [],
      progress: null,
      error: null,
      selectedId: null,
    });
    const wakeTimer = setTimeout(() => set({ wakeSince: Date.now() }), WAKE_NOTICE_DELAY_MS);
    const clearWake = () => {
      clearTimeout(wakeTimer);
      set({ wakeSince: null });
    };
    await streamSolve(
      {
        problem,
        run: {
          algorithm: "nsga2",
          params: limit === null ? {} : { time_limit_s: limit },
        },
        include_geometry: true,
      },
      {
        onResponse: clearWake,
        onProgress: (payload) => {
          if (run.signal.aborted) return;
          set((state) => ({
            progress: { iteration: payload.iteration, elapsedS: payload.elapsed_s },
            points: payload.pareto && payload.pareto.length > 0 ? payload.pareto : state.points,
          }));
        },
        onResult: (response) => {
          if (run.signal.aborted) return;
          set((state) => ({
            status: "done",
            points: response.pareto && response.pareto.length > 0 ? response.pareto : state.points,
          }));
        },
        onError: (error) => {
          if (run.signal.aborted) return;
          clearWake();
          set({ status: "error", error: { code: error.code, message: error.message } });
        },
      },
      run.signal,
    );
    clearWake();
    if (run.signal.aborted) return;
    if (get().status === "running") {
      set(
        get().points.length > 0
          ? { status: "done" }
          : { status: "error", error: { code: "stream_closed", message: "stream_closed" } },
      );
    }
  },

  stop: () => {
    controller?.abort();
    set((state) => ({
      status: state.points.length > 0 ? "done" : "idle",
      wakeSince: null,
    }));
  },
}));
