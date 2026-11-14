import type { SimClientMessage, SimServerMessage } from "@/lib/api/types";

export const SERVER_MESSAGE_TYPES = ["tick", "order", "reoptimized", "done", "error"] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "number" && Number.isFinite(record[key]);
}

export function parseServerMessage(raw: string): SimServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (parsed.type) {
    case "tick":
      return hasNumber(parsed, "clock_min") &&
        Array.isArray(parsed.positions) &&
        Array.isArray(parsed.delivered_stop_ids)
        ? (parsed as unknown as SimServerMessage)
        : null;
    case "order":
      return hasNumber(parsed, "clock_min") && isRecord(parsed.stop)
        ? (parsed as unknown as SimServerMessage)
        : null;
    case "reoptimized":
      return hasNumber(parsed, "clock_min") &&
        isRecord(parsed.solution) &&
        (parsed.reason === "initial" || parsed.reason === "event" || parsed.reason === "batch")
        ? (parsed as unknown as SimServerMessage)
        : null;
    case "done":
      return hasNumber(parsed, "clock_min") && isRecord(parsed.metrics)
        ? (parsed as unknown as SimServerMessage)
        : null;
    case "error":
      return isRecord(parsed.error) && typeof parsed.error.code === "string"
        ? (parsed as unknown as SimServerMessage)
        : null;
    default:
      return null;
  }
}

export function serializeClientMessage(message: SimClientMessage): string {
  return JSON.stringify(message);
}
