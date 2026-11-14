export type HybridContribution = {
  ga: number;
  aco: number;
  gaShare: number;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function hybridContribution(extra: Record<string, unknown>): HybridContribution | null {
  const ga = count(extra.improvements_from_ga);
  const aco = count(extra.improvements_from_aco);
  if (ga === null || aco === null) return null;
  const total = ga + aco;
  return { ga, aco, gaShare: total === 0 ? 0.5 : ga / total };
}
