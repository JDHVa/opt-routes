import type { CompareStreamEvent } from "@/lib/api/client";
import type { CompareResponse } from "@/lib/api/types";
import { emptyRun, type RunState } from "./table";

export function initialRuns(algorithms: string[]): RunState[] {
  return algorithms.map((algorithm, index) => emptyRun(index, algorithm));
}

export function startRun(runs: RunState[], index: number): RunState[] {
  return runs.map((run) => (run.index === index ? { ...run, status: "running" } : run));
}

export function applyCompareEvent(runs: RunState[], event: CompareStreamEvent): RunState[] {
  if (event.kind === "progress") {
    const { run_index: index, ...payload } = event.payload;
    return runs.map((run) =>
      run.index !== index
        ? run
        : {
            ...run,
            status: "running",
            liveMetrics: payload.metrics,
            liveSolution: payload.solution ?? run.liveSolution,
            progress: {
              iteration: payload.iteration,
              elapsedS: payload.elapsed_s,
              bestFitness: payload.best_fitness,
              stage: payload.stage ?? null,
            },
            history: [
              ...run.history,
              {
                iteration: payload.iteration,
                elapsed_s: payload.elapsed_s,
                best_fitness: payload.best_fitness,
              },
            ],
          },
    );
  }
  if (event.kind === "result") {
    const { run_index: index, ...entry } = event.payload;
    return runs.map((run) =>
      run.index !== index
        ? run
        : {
            ...run,
            status: "done",
            entry,
            liveSolution: entry.solution,
            liveMetrics: entry.solution.metrics,
            history: entry.history.length > 0 ? entry.history : run.history,
          },
    );
  }
  return runs;
}

export function applyComplete(runs: RunState[], response: CompareResponse): RunState[] {
  return runs.map((run) => {
    const entry = response.entries[run.index];
    if (!entry) return run;
    return {
      ...run,
      status: "done",
      entry,
      liveSolution: entry.solution,
      liveMetrics: entry.solution.metrics,
      history: entry.history.length > 0 ? entry.history : run.history,
    };
  });
}

export function currentRunIndex(runs: RunState[]): number | null {
  const running = runs.find((run) => run.status === "running");
  return running ? running.index : null;
}
