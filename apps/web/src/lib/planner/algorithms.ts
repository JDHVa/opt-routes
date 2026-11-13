const DISPLAY_NAMES: Record<string, string> = {
  ga: "GA",
  aco: "ACO",
  aco_ga: "ACO+GA",
  nsga2: "NSGA-II",
  pyvrp: "PyVRP",
  ortools: "OR-Tools",
};

export function algorithmDisplayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name.toUpperCase();
}

export type StageKind = "generation" | "iteration";

export function stageKind(algorithm: string): StageKind {
  return algorithm === "ga" || algorithm === "nsga2" || algorithm === "aco_ga"
    ? "generation"
    : "iteration";
}
