import type {
  DriverPosition,
  ErrorPayload,
  Problem,
  Solution,
  SolutionMetrics,
  SimServerMessage,
  Stop,
} from "@/lib/api/types";

export type SimPhase = "idle" | "connecting" | "running" | "paused" | "done" | "error" | "closed";

export type SimEvent =
  | { id: number; kind: "reopt"; clock: number; reason: "initial" | "event" | "batch"; runtimeS: number; remaining: number }
  | { id: number; kind: "order"; clock: number; stopId: string }
  | { id: number; kind: "delivered"; clock: number; stopIds: string[] }
  | { id: number; kind: "done"; clock: number }
  | { id: number; kind: "error"; clock: number; code: string };

export type SimMark = { kind: "order" | "reopt"; clock: number };

export type SimState = {
  phase: SimPhase;
  clock: number;
  speed: number;
  plan: Solution | null;
  positions: DriverPosition[];
  tickSeq: number;
  delivered: string[];
  orders: { stop: Stop; clock: number }[];
  events: SimEvent[];
  marks: SimMark[];
  reoptCount: number;
  metrics: SolutionMetrics | null;
  error: ErrorPayload | null;
  nextEventId: number;
};

export type SimAction =
  | { type: "connect"; speed: number }
  | { type: "message"; message: SimServerMessage }
  | { type: "closed"; requested: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "speed"; speed: number }
  | { type: "reset" };

export const MAX_LOG_EVENTS = 300;

export const MIN_HORIZON_MIN = 60;

export function initialSimState(speed = 60): SimState {
  return {
    phase: "idle",
    clock: 0,
    speed,
    plan: null,
    positions: [],
    tickSeq: 0,
    delivered: [],
    orders: [],
    events: [],
    marks: [],
    reoptCount: 0,
    metrics: null,
    error: null,
    nextEventId: 1,
  };
}

type EventDraft =
  | { kind: "reopt"; clock: number; reason: "initial" | "event" | "batch"; runtimeS: number; remaining: number }
  | { kind: "order"; clock: number; stopId: string }
  | { kind: "delivered"; clock: number; stopIds: string[] }
  | { kind: "done"; clock: number }
  | { kind: "error"; clock: number; code: string };

function pushEvent(state: SimState, draft: EventDraft): Pick<SimState, "events" | "nextEventId"> {
  const event = { ...draft, id: state.nextEventId } as SimEvent;
  const events = [...state.events, event];
  return {
    events: events.length > MAX_LOG_EVENTS ? events.slice(events.length - MAX_LOG_EVENTS) : events,
    nextEventId: state.nextEventId + 1,
  };
}

export function remainingStops(plan: Solution): number {
  return plan.routes.reduce((total, route) => total + route.visits.length, 0);
}

function applyMessage(state: SimState, message: SimServerMessage): SimState {
  switch (message.type) {
    case "reoptimized": {
      const initial = message.reason === "initial";
      return {
        ...state,
        phase: state.phase === "connecting" ? "running" : state.phase,
        clock: Math.max(state.clock, message.clock_min),
        plan: message.solution,
        reoptCount: initial ? state.reoptCount : state.reoptCount + 1,
        marks: initial
          ? state.marks
          : [...state.marks, { kind: "reopt", clock: message.clock_min }],
        ...pushEvent(state, {
          kind: "reopt",
          clock: message.clock_min,
          reason: message.reason,
          runtimeS: message.runtime_s,
          remaining: remainingStops(message.solution),
        }),
      };
    }
    case "tick": {
      const delivered =
        message.delivered_stop_ids.length > 0
          ? [...state.delivered, ...message.delivered_stop_ids]
          : state.delivered;
      const logged =
        message.delivered_stop_ids.length > 0
          ? pushEvent(state, {
              kind: "delivered",
              clock: message.clock_min,
              stopIds: message.delivered_stop_ids,
            })
          : { events: state.events, nextEventId: state.nextEventId };
      return {
        ...state,
        phase: state.phase === "connecting" ? "running" : state.phase,
        clock: Math.max(state.clock, message.clock_min),
        positions: message.positions,
        tickSeq: state.tickSeq + 1,
        delivered,
        ...logged,
      };
    }
    case "order":
      return {
        ...state,
        orders: [...state.orders, { stop: message.stop, clock: message.clock_min }],
        marks: [...state.marks, { kind: "order", clock: message.clock_min }],
        ...pushEvent(state, { kind: "order", clock: message.clock_min, stopId: message.stop.id }),
      };
    case "done":
      return {
        ...state,
        phase: "done",
        clock: Math.max(state.clock, message.clock_min),
        metrics: message.metrics,
        ...pushEvent(state, { kind: "done", clock: message.clock_min }),
      };
    case "error":
      return {
        ...state,
        phase: "error",
        error: message.error,
        ...pushEvent(state, { kind: "error", clock: state.clock, code: message.error.code }),
      };
  }
}

export function simReducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case "connect":
      return { ...initialSimState(action.speed), phase: "connecting" };
    case "message":
      if (state.phase === "idle" || state.phase === "closed") return state;
      return applyMessage(state, action.message);
    case "closed":
      if (state.phase === "done" || state.phase === "error" || state.phase === "idle") return state;
      if (action.requested) return { ...state, phase: "closed" };
      return {
        ...state,
        phase: "error",
        error: { code: "disconnected", message: "disconnected" },
      };
    case "pause":
      return state.phase === "running" ? { ...state, phase: "paused" } : state;
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "running" } : state;
    case "speed":
      return { ...state, speed: action.speed };
    case "reset":
      return initialSimState(state.speed);
  }
}

export function knownStops(problem: Problem, orders: { stop: Stop }[]): Stop[] {
  const initial = problem.stops.filter((stop) => (stop.release_min ?? 0) <= 0);
  const known = new Set(initial.map((stop) => stop.id));
  const revealed = orders.filter((order) => !known.has(order.stop.id)).map((order) => order.stop);
  return [...initial, ...revealed];
}

export function timelineHorizon(state: SimState): number {
  let horizon = Math.max(MIN_HORIZON_MIN, state.clock);
  if (state.plan) {
    for (const route of state.plan.routes) horizon = Math.max(horizon, route.metrics.end_min);
  }
  return horizon;
}
