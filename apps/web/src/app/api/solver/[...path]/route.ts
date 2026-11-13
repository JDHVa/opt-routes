import { SOLVER_URL } from "@/lib/env";
import type { ErrorPayload } from "@/lib/api/types";
import { clientIp, createRateLimiter } from "@/lib/server/rate-limit";
import {
  isAllowed,
  isRateLimited,
  MAX_BODY_BYTES,
  validateBody,
} from "@/lib/server/validation";

const limiter = createRateLimiter(30, 60_000);

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "accept-language"];
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "cache-control",
];

type RouteContext = { params: Promise<{ path: string[] }> };

function errorResponse(
  status: number,
  payload: ErrorPayload,
  extra?: Record<string, string>,
): Response {
  return Response.json(payload, { status, headers: extra });
}

async function proxy(
  request: Request,
  context: RouteContext,
  method: "GET" | "POST",
): Promise<Response> {
  const { path: segments } = await context.params;
  const path = segments.join("/");

  if (!isAllowed(method, path)) {
    return errorResponse(404, { code: "not_found", message: "unknown solver route" });
  }

  if (isRateLimited(path)) {
    const verdict = limiter.hit(clientIp(request.headers));
    if (!verdict.allowed) {
      return errorResponse(
        429,
        { code: "rate_limited", message: "too many requests" },
        { "retry-after": String(verdict.retryAfterS) },
      );
    }
  }

  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, { code: "payload_too_large", message: "body too large" });
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const verdict = validateBody(path, new TextDecoder().decode(body));
      if (!verdict.ok) {
        return errorResponse(422, { code: "invalid_request", message: verdict.message });
      }
    }
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const search = new URL(request.url).search;
  let upstream: Response;
  try {
    upstream = await fetch(`${SOLVER_URL}/${path}${search}`, {
      method,
      headers,
      body,
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorResponse(502, {
      code: "solver_unreachable",
      message: error instanceof Error ? error.message : "solver unreachable",
    });
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    responseHeaders.set("cache-control", "no-cache, no-transform");
    responseHeaders.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxy(request, context, "GET");
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxy(request, context, "POST");
}
