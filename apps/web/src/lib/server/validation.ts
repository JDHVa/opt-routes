import { z } from "zod";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_STOPS = 500;
export const MAX_DRIVERS = 60;

const problemShape = z.looseObject({
  stops: z.array(z.unknown()).min(1).max(MAX_STOPS),
  drivers: z.array(z.unknown()).min(1).max(MAX_DRIVERS),
});

const runShape = z.looseObject({
  algorithm: z.string().min(1).max(40),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const solveBodySchema = z.looseObject({
  problem: problemShape,
  run: runShape,
});

export const compareBodySchema = z.looseObject({
  problem: problemShape,
  runs: z.array(runShape).min(1).max(8),
});

export const ALLOWED_GET = [
  /^algorithms$/,
  /^vehicles$/,
  /^scenarios$/,
  /^scenarios\/[A-Za-z0-9_-]+$/,
  /^export\/csv$/,
];

export const ALLOWED_POST = [
  /^solve$/,
  /^solve\/stream$/,
  /^compare$/,
  /^compare\/stream$/,
  /^matrix$/,
  /^geometry$/,
  /^import\/csv$/,
  /^export\/csv$/,
];

export function isAllowed(method: "GET" | "POST", path: string): boolean {
  const patterns = method === "GET" ? ALLOWED_GET : ALLOWED_POST;
  return patterns.some((pattern) => pattern.test(path));
}

export function isRateLimited(path: string): boolean {
  return path.startsWith("solve") || path.startsWith("compare");
}

export function validateBody(
  path: string,
  raw: string,
): { ok: true } | { ok: false; message: string } {
  const schema = path.startsWith("solve")
    ? solveBodySchema
    : path.startsWith("compare")
      ? compareBodySchema
      : null;
  if (!schema) return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "invalid_json" };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true };
  const issue = result.error.issues[0];
  return { ok: false, message: `${issue.path.join(".")}: ${issue.message}` };
}
