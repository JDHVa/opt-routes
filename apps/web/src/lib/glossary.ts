export const GLOSSARY_TERMS = [
  "split",
  "pheromone",
  "pareto",
  "makespan",
  "timeWindow",
  "localSearch",
  "kmeans",
  "gap",
] as const;

export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];
