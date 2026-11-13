import { z } from "zod";

export type ParamValue = number | boolean | string | null;
export type ParamValues = Record<string, ParamValue>;

type FieldBase = { key: string; title: string; nullable: boolean };

export type NumberField = FieldBase & {
  kind: "number" | "integer";
  defaultValue: number | null;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
};

export type BooleanField = FieldBase & {
  kind: "boolean";
  defaultValue: boolean;
};

export type EnumField = FieldBase & {
  kind: "enum";
  defaultValue: string;
  options: string[];
};

export type ParamField = NumberField | BooleanField | EnumField;

type JsonSchema = Record<string, unknown>;

function asRecord(value: unknown): JsonSchema | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchema)
    : null;
}

function resolveRef(node: JsonSchema, defs: JsonSchema): JsonSchema {
  const ref = node["$ref"];
  if (typeof ref !== "string") return node;
  const name = ref.split("/").pop() ?? "";
  const target = asRecord(defs[name]);
  if (!target) return node;
  const { $ref: _ignored, ...overrides } = node;
  void _ignored;
  return { ...target, ...overrides };
}

function unwrapNullable(node: JsonSchema, defs: JsonSchema): {
  schema: JsonSchema;
  nullable: boolean;
} {
  const variants = node["anyOf"];
  if (!Array.isArray(variants)) return { schema: resolveRef(node, defs), nullable: false };
  const records = variants.map(asRecord).filter((v): v is JsonSchema => v !== null);
  const nonNull = records.filter((v) => v["type"] !== "null");
  const nullable = nonNull.length !== records.length;
  const { anyOf: _anyOf, ...rest } = node;
  void _anyOf;
  const first = nonNull[0] ?? {};
  return { schema: resolveRef({ ...first, ...rest }, defs), nullable };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function buildParamFields(paramsSchema: JsonSchema): ParamField[] {
  const properties = asRecord(paramsSchema["properties"]);
  if (!properties) return [];
  const defs = asRecord(paramsSchema["$defs"]) ?? {};
  const fields: ParamField[] = [];
  for (const [key, raw] of Object.entries(properties)) {
    const node = asRecord(raw);
    if (!node) continue;
    const { schema, nullable } = unwrapNullable(node, defs);
    const title = typeof schema["title"] === "string" ? schema["title"] : key;
    const base = { key, title, nullable };
    const options = schema["enum"];
    if (Array.isArray(options)) {
      const values = options.filter((o): o is string => typeof o === "string");
      const defaultValue =
        typeof schema["default"] === "string" ? schema["default"] : (values[0] ?? "");
      fields.push({ ...base, kind: "enum", options: values, defaultValue });
      continue;
    }
    const type = schema["type"];
    if (type === "boolean") {
      fields.push({
        ...base,
        kind: "boolean",
        defaultValue: schema["default"] === true,
      });
    } else if (type === "integer" || type === "number") {
      const defaultValue =
        typeof schema["default"] === "number" ? schema["default"] : null;
      fields.push({
        ...base,
        kind: type,
        defaultValue,
        min: numberOrUndefined(schema["minimum"]),
        max: numberOrUndefined(schema["maximum"]),
        exclusiveMin: numberOrUndefined(schema["exclusiveMinimum"]),
        exclusiveMax: numberOrUndefined(schema["exclusiveMaximum"]),
      });
    }
  }
  return fields;
}

export function defaultValues(fields: ParamField[]): ParamValues {
  const values: ParamValues = {};
  for (const field of fields) values[field.key] = field.defaultValue;
  return values;
}

export const KEY_PARAMS: Record<string, string[]> = {
  ga: ["time_limit_s", "pop_size", "mutation_rate", "crossover"],
  aco: ["time_limit_s", "n_ants", "rho", "beta"],
  aco_ga: ["time_limit_s", "n_ants", "pop_size"],
  nsga2: ["time_limit_s", "pop_size", "mutation_rate"],
};

const FALLBACK_KEY_PARAMS = ["time_limit_s", "max_iterations", "init"];

export function splitFields(
  algorithm: string,
  fields: ParamField[],
): { key: ParamField[]; advanced: ParamField[] } {
  const wanted = KEY_PARAMS[algorithm] ?? FALLBACK_KEY_PARAMS;
  const present = wanted.filter((name) => fields.some((f) => f.key === name));
  const keyNames = present.length > 0 ? present : FALLBACK_KEY_PARAMS;
  const key = keyNames
    .map((name) => fields.find((f) => f.key === name))
    .filter((f): f is ParamField => f !== undefined);
  const advanced = fields.filter((f) => !key.includes(f));
  return { key, advanced };
}

export type ParamErrorCode = "required" | "integer" | "min" | "max";
export type ParamErrors = Record<string, { code: ParamErrorCode; bound?: number }>;

function numberSchema(field: NumberField): z.ZodType<number | null> {
  let schema = z.number({ error: "required" });
  if (field.kind === "integer") schema = schema.int({ error: "integer" });
  if (field.min !== undefined) schema = schema.min(field.min, { error: "min" });
  if (field.max !== undefined) schema = schema.max(field.max, { error: "max" });
  if (field.exclusiveMin !== undefined) schema = schema.gt(field.exclusiveMin, { error: "min" });
  if (field.exclusiveMax !== undefined) schema = schema.lt(field.exclusiveMax, { error: "max" });
  return field.nullable ? schema.nullable() : schema;
}

function boundFor(field: NumberField, code: "min" | "max"): number | undefined {
  if (code === "min") return field.exclusiveMin ?? field.min;
  return field.exclusiveMax ?? field.max;
}

export function validateParams(
  fields: ParamField[],
  values: ParamValues,
): { ok: boolean; errors: ParamErrors } {
  const errors: ParamErrors = {};
  for (const field of fields) {
    if (field.kind !== "number" && field.kind !== "integer") continue;
    const value = values[field.key];
    const parsed = numberSchema(field).safeParse(
      value === undefined || value === "" ? null : value,
    );
    if (parsed.success) continue;
    const message = parsed.error.issues[0]?.message;
    const code: ParamErrorCode =
      message === "integer" || message === "min" || message === "max"
        ? message
        : "required";
    errors[field.key] = {
      code,
      bound: code === "min" || code === "max" ? boundFor(field, code) : undefined,
    };
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toRunParams(values: ParamValues): Record<string, number | boolean | string> {
  const params: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") params[key] = value;
  }
  return params;
}
