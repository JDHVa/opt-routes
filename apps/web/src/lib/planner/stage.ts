import type { SolverStage } from "@/lib/api/types";

export type StageLabel =
  | { key: "seeding"; init: string | null }
  | { key: "evolving" | "constructing" | "cooperating" | "finished" };

export function stageLabel(
  stage: SolverStage | null | undefined,
  init: string | null,
): StageLabel | null {
  if (!stage) return null;
  if (stage === "seeding") return { key: "seeding", init };
  return { key: stage };
}
