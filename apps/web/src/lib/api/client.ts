import { readSse, SseHttpError } from "./sse";
import type {
  AlgorithmInfo,
  CompareEntry,
  CompareRequest,
  CompareResponse,
  CsvErrorResponse,
  CsvRowError,
  ErrorPayload,
  GenerateRequest,
  ImportCsvResponse,
  Problem,
  ProgressPayload,
  ScenarioInfo,
  Solution,
  SolveRequest,
  SolveResponse,
  Stop,
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

const JSON_HEADERS = { "content-type": "application/json" };

export class CsvImportError extends Error {
  readonly rows: CsvRowError[];

  constructor(rows: CsvRowError[], message: string) {
    super(message);
    this.rows = rows;
  }
}

function parseCsvErrors(raw: string): CsvErrorResponse | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Partial<CsvErrorResponse>;
      if (Array.isArray(record.rows)) {
        return {
          code: record.code ?? "invalid_csv",
          message: record.message ?? "invalid_csv",
          rows: record.rows,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function importCsv(text: string, signal?: AbortSignal): Promise<Stop[]> {
  try {
    const response = await request<ImportCsvResponse>("/import/csv", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text }),
      signal,
    });
    return response.stops;
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      const parsed = parseCsvErrors(error.detail);
      if (parsed) throw new CsvImportError(parsed.rows, parsed.message);
    }
    throw error;
  }
}

export async function exportCsv(solution: Solution, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/export/csv`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ solution }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, { code: "network", message: "network" }, String(error));
  }
  const raw = await response.text();
  if (!response.ok) throw new ApiError(response.status, toErrorPayload(response.status, raw), raw);
  return raw;
}

export function generateScenario(
  body: GenerateRequest,
  signal?: AbortSignal,
): Promise<Problem> {
  return request<Problem>("/scenarios/generate", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  });
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

export type CompareProgressPayload = ProgressPayload & { run_index: number };
export type CompareResultPayload = CompareEntry & { run_index: number };

export type CompareStreamEvent =
  | { kind: "progress"; payload: CompareProgressPayload }
  | { kind: "result"; payload: CompareResultPayload }
  | { kind: "complete"; payload: CompareResponse }
  | { kind: "error"; payload: ErrorPayload };

export function parseCompareMessage(message: {
  event: string;
  data: string;
}): CompareStreamEvent | null {
  if (message.event === "progress") {
    return { kind: "progress", payload: JSON.parse(message.data) as CompareProgressPayload };
  }
  if (message.event === "result") {
    return { kind: "result", payload: JSON.parse(message.data) as CompareResultPayload };
  }
  if (message.event === "complete") {
    return { kind: "complete", payload: JSON.parse(message.data) as CompareResponse };
  }
  if (message.event === "error") {
    return { kind: "error", payload: JSON.parse(message.data) as ErrorPayload };
  }
  return null;
}

export type CompareStreamHandlers = {
  onEvent: (event: CompareStreamEvent) => void;
  onResponse?: () => void;
};

export async function streamCompare(
  body: CompareRequest,
  handlers: CompareStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await readSse({
      url: `${API_BASE}/compare/stream`,
      body,
      signal,
      onResponse: handlers.onResponse,
      onMessage: (message) => {
        const event = parseCompareMessage(message);
        if (event) handlers.onEvent(event);
      },
    });
  } catch (error) {
    if (signal?.aborted) return;
    if (error instanceof SseHttpError) {
      handlers.onEvent({ kind: "error", payload: toErrorPayload(error.status, error.body) });
      return;
    }
    handlers.onEvent({ kind: "error", payload: { code: "network", message: "network" } });
  }
}
