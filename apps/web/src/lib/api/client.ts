import { readSse, SseHttpError } from "./sse";
import type {
  AlgorithmInfo,
  ErrorPayload,
  Problem,
  ProgressPayload,
  ScenarioInfo,
  SolveRequest,
  SolveResponse,
  VehicleCatalog,
} from "./types";

export const API_BASE = "/api/solver";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, payload: ErrorPayload, detail = "") {
    super(payload.message);
    this.status = status;
    this.code = payload.code;
    this.detail = detail;
  }
}

function toErrorPayload(status: number, raw: string): ErrorPayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.code === "string" && typeof record.message === "string") {
        return { code: record.code, message: record.message };
      }
      if (typeof record.detail === "string") {
        return { code: `http_${status}`, message: record.detail };
      }
    }
  } catch {
    return { code: `http_${status}`, message: raw.slice(0, 200) || `HTTP ${status}` };
  }
  return { code: `http_${status}`, message: `HTTP ${status}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError(0, { code: "network", message: "network" }, String(error));
  }
  if (!response.ok) {
    const raw = await response.text();
    throw new ApiError(response.status, toErrorPayload(response.status, raw), raw);
  }
  return (await response.json()) as T;
}

export function fetchAlgorithms(signal?: AbortSignal): Promise<AlgorithmInfo[]> {
  return request<AlgorithmInfo[]>("/algorithms", { signal });
}

export async function fetchVehicles(signal?: AbortSignal): Promise<VehicleCatalog> {
  return request<VehicleCatalog>("/vehicles", { signal });
}

export function fetchScenarios(signal?: AbortSignal): Promise<ScenarioInfo[]> {
  return request<ScenarioInfo[]>("/scenarios", { signal });
}

export function fetchScenario(id: string, signal?: AbortSignal): Promise<Problem> {
  return request<Problem>(`/scenarios/${encodeURIComponent(id)}`, { signal });
}

export function postSolve(
  body: SolveRequest,
  signal?: AbortSignal,
): Promise<SolveResponse> {
  return request<SolveResponse>("/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export function importCsv(file: File, signal?: AbortSignal): Promise<Problem> {
  const form = new FormData();
  form.append("file", file);
  return request<Problem>("/import/csv", { method: "POST", body: form, signal });
}

export type SolveStreamHandlers = {
  onProgress: (payload: ProgressPayload) => void;
  onResult: (response: SolveResponse) => void;
  onError: (error: ErrorPayload) => void;
  onResponse?: () => void;
};

export async function streamSolve(
  body: SolveRequest,
  handlers: SolveStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await readSse({
      url: `${API_BASE}/solve/stream`,
      body,
      signal,
      onResponse: handlers.onResponse,
      onMessage: (message) => {
        if (message.event === "progress") {
          handlers.onProgress(JSON.parse(message.data) as ProgressPayload);
        } else if (message.event === "result") {
          handlers.onResult(JSON.parse(message.data) as SolveResponse);
        } else if (message.event === "error") {
          handlers.onError(JSON.parse(message.data) as ErrorPayload);
        }
      },
    });
  } catch (error) {
    if (signal?.aborted) return;
    if (error instanceof SseHttpError) {
      handlers.onError(toErrorPayload(error.status, error.body));
      return;
    }
    handlers.onError({ code: "network", message: "network" });
  }
}
