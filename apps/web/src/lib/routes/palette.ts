export const ROUTE_PALETTE = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#E69F00",
  "#882255",
  "#44AA99",
  "#997700",
  "#332288",
  "#EE6677",
  "#117733",
] as const;

export const PALETTE_SIZE = ROUTE_PALETTE.length;

export function routeColor(driverIndex: number): string {
  const size = ROUTE_PALETTE.length;
  return ROUTE_PALETTE[((driverIndex % size) + size) % size];
}

export function routeIsDashed(driverIndex: number): boolean {
  return driverIndex >= PALETTE_SIZE;
}

export const ALGORITHM_COLORS: Record<string, string> = {
  ga: ROUTE_PALETTE[0],
  aco: ROUTE_PALETTE[1],
  aco_ga: ROUTE_PALETTE[2],
  nsga2: ROUTE_PALETTE[3],
};
