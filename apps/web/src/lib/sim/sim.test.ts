import { describe, expect, it } from "vitest";
import type { Problem, SimServerMessage, Solution, SolutionMetrics, Stop } from "@/lib/api/types";
import {
  lerpLatLon,
  positionsOf,
  retarget,
  sampleTween,
  tickDuration,
  tweenFinished,
} from "./interpolate";
import { buildPlanView, makeOrder, markPosition, nextOrderId } from "./plan";
import { parseServerMessage, serializeClientMessage } from "./protocol";
import {
  initialSimState,
  knownStops,
  remainingStops,
  simReducer,
  timelineHorizon,
  type SimAction,
  type SimState,
} from "./reducer";
import { SimSocket, type SocketLike } from "./socket";

const METRICS: SolutionMetrics = {
  total_distance_km: 10,
  total_duration_min: 100,
  makespan_min: 90,
  vehicles_used: 2,
  total_cost_mxn: 500,
  lateness_min: 0,
  overload_kg: 0,
  overload_m3: 0,
  overtime_min: 0,
  unassigned: 0,
  feasible: true,
  fitness: 1,
};

function solution(visits: number[], endMin = 120): Solution {
  return {
    algorithm: "ga",
    routes: visits.map((count, index) => ({
      driver_id: `d${index}`,
      vehicle_type_id: "v",
      visits: Array.from({ length: count }, (_, i) => ({
        stop_id: `s${index}${i}`,
        arrival_min: 10,
        start_service_min: 10,
        departure_min: 15,
        late_min: 0,
      })),
      metrics: {
        distance_km: 1,
        duration_min: 1,
        start_min: 0,
        end_min: endMin,
        load_kg: 0,
        load_m3: 0,
        cost_mxn: 1,
        lateness_min: 0,
        overtime_min: 0,
      },
    })),
    unassigned_stop_ids: [],
    metrics: METRICS,
    runtime_s: 1,
  };
}

function run(actions: SimAction[], from: SimState = initialSimState()): SimState {
  return actions.reduce(simReducer, from);
}

const stop = (id: string, release = 0): Stop => ({
  id,
  location: { lat: 25.6, lon: -100.3 },
  demand_kg: 1,
  demand_m3: 0.01,
  service_min: 5,
  priority: "normal",
  release_min: release,
});

describe("protocolo del WebSocket", () => {
  it("parsea y discrimina cada tipo de mensaje del servidor", () => {
    const tick = parseServerMessage(
      JSON.stringify({ type: "tick", clock_min: 5, positions: [], delivered_stop_ids: [] }),
    );
    expect(tick?.type).toBe("tick");
    const order = parseServerMessage(
      JSON.stringify({ type: "order", clock_min: 5, stop: stop("s1") }),
    );
    expect(order?.type).toBe("order");
    const reopt = parseServerMessage(
      JSON.stringify({
        type: "reoptimized",
        clock_min: 0,
        solution: solution([1]),
        runtime_s: 1,
        reason: "initial",
      }),
    );
    expect(reopt?.type).toBe("reoptimized");
    expect(
      parseServerMessage(JSON.stringify({ type: "done", clock_min: 9, metrics: METRICS }))?.type,
    ).toBe("done");
    expect(
      parseServerMessage(JSON.stringify({ type: "error", error: { code: "busy", message: "x" } }))
        ?.type,
    ).toBe("error");
  });

  it("rechaza JSON inválido, tipos desconocidos y mensajes incompletos", () => {
    expect(parseServerMessage("no es json")).toBeNull();
    expect(parseServerMessage("[1,2]")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "pong" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "tick", clock_min: 1 }))).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ type: "reoptimized", clock_min: 1, solution: {}, reason: "otra" }),
      ),
    ).toBeNull();
  });

  it("serializa los mensajes del cliente con su discriminador", () => {
    expect(JSON.parse(serializeClientMessage({ type: "pause" }))).toEqual({ type: "pause" });
    expect(JSON.parse(serializeClientMessage({ type: "speed", speed: 120 }))).toEqual({
      type: "speed",
      speed: 120,
    });
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closedWith = 1000;
    this.readyState = 3;
    this.onclose?.({ code: 1000, wasClean: true });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

describe("SimSocket", () => {
  it("encola los mensajes hasta abrir y entrega los parseados", () => {
    const fake = new FakeSocket();
    const received: SimServerMessage[] = [];
    const invalid: string[] = [];
    const socket = new SimSocket(
      "ws://x",
      {
        onMessage: (m) => received.push(m),
        onInvalid: (raw) => invalid.push(raw),
        onClose: () => undefined,
      },
      () => fake,
    );
    socket.send({ type: "pause" });
    expect(fake.sent).toEqual([]);
    fake.open();
    expect(fake.sent).toEqual(['{"type":"pause"}']);
    socket.send({ type: "resume" });
    expect(fake.sent).toHaveLength(2);

    fake.onmessage?.({
      data: JSON.stringify({ type: "done", clock_min: 1, metrics: METRICS }),
    });
    fake.onmessage?.({ data: "basura" });
    expect(received.map((m) => m.type)).toEqual(["done"]);
    expect(invalid).toEqual(["basura"]);
  });

  it("distingue el cierre pedido del cierre inesperado", () => {
    const closes: { requested: boolean }[] = [];
    const first = new FakeSocket();
    const requested = new SimSocket(
      "ws://x",
      { onMessage: () => undefined, onClose: (info) => closes.push(info) },
      () => first,
    );
    requested.close();
    const second = new FakeSocket();
    new SimSocket(
      "ws://x",
      { onMessage: () => undefined, onClose: (info) => closes.push(info) },
      () => second,
    );
    second.onclose?.({ code: 1006, wasClean: false });
    expect(closes.map((c) => c.requested)).toEqual([true, false]);
  });
});

describe("reducer de la simulación", () => {
  it("conecta, recibe el plan inicial y pasa a running", () => {
    const state = run([
      { type: "connect", speed: 120 },
      {
        type: "message",
        message: {
          type: "reoptimized",
          clock_min: 0,
          solution: solution([3, 2]),
          runtime_s: 2,
          reason: "initial",
        },
      },
    ]);
    expect(state.phase).toBe("running");
    expect(state.speed).toBe(120);
    expect(remainingStops(state.plan as Solution)).toBe(5);
    expect(state.reoptCount).toBe(0);
    expect(state.marks).toEqual([]);
    expect(state.events[0]).toMatchObject({ kind: "reopt", reason: "initial", remaining: 5 });
  });

  it("acumula entregas, avanza el reloj sin retroceder y registra pedidos y re-optimizaciones", () => {
    const state = run([
      { type: "connect", speed: 60 },
      {
        type: "message",
        message: { type: "tick", clock_min: 10, positions: [], delivered_stop_ids: ["s1"] },
      },
      {
        type: "message",
        message: { type: "tick", clock_min: 8, positions: [], delivered_stop_ids: [] },
      },
      { type: "message", message: { type: "order", clock_min: 12, stop: stop("n1", 12) } },
      {
        type: "message",
        message: {
          type: "reoptimized",
          clock_min: 12,
          solution: solution([1]),
          runtime_s: 1.5,
          reason: "event",
        },
      },
      {
        type: "message",
        message: { type: "tick", clock_min: 20, positions: [], delivered_stop_ids: ["s2", "s3"] },
      },
    ]);
    expect(state.clock).toBe(20);
    expect(state.delivered).toEqual(["s1", "s2", "s3"]);
    expect(state.orders.map((o) => o.stop.id)).toEqual(["n1"]);
    expect(state.reoptCount).toBe(1);
    expect(state.marks).toEqual([
      { kind: "order", clock: 12 },
      { kind: "reopt", clock: 12 },
    ]);
    expect(state.tickSeq).toBe(3);
    expect(state.events.map((e) => e.kind)).toEqual([
      "delivered",
      "order",
      "reopt",
      "delivered",
    ]);
  });

  it("pausa y reanuda solo en las fases correctas", () => {
    const running = run([
      { type: "connect", speed: 60 },
      { type: "message", message: { type: "tick", clock_min: 1, positions: [], delivered_stop_ids: [] } },
    ]);
    const paused = simReducer(running, { type: "pause" });
    expect(paused.phase).toBe("paused");
    expect(simReducer(paused, { type: "resume" }).phase).toBe("running");
    expect(simReducer(initialSimState(), { type: "pause" }).phase).toBe("idle");
  });

  it("termina con las métricas y no reacciona al cierre posterior", () => {
    const done = run([
      { type: "connect", speed: 60 },
      { type: "message", message: { type: "done", clock_min: 300, metrics: METRICS } },
      { type: "closed", requested: false },
    ]);
    expect(done.phase).toBe("done");
    expect(done.metrics).toEqual(METRICS);
  });

  it("un cierre inesperado a mitad de la simulación es un error de desconexión", () => {
    const state = run([{ type: "connect", speed: 60 }, { type: "closed", requested: false }]);
    expect(state.phase).toBe("error");
    expect(state.error?.code).toBe("disconnected");
    const stopped = run([{ type: "connect", speed: 60 }, { type: "closed", requested: true }]);
    expect(stopped.phase).toBe("closed");
  });

  it("ignora mensajes tras el cierre y reinicia conservando la velocidad", () => {
    const closed = run([
      { type: "connect", speed: 120 },
      { type: "closed", requested: true },
      { type: "message", message: { type: "tick", clock_min: 5, positions: [], delivered_stop_ids: [] } },
    ]);
    expect(closed.clock).toBe(0);
    expect(simReducer(closed, { type: "reset" }).speed).toBe(120);
  });

  it("limita el log y calcula el horizonte de la línea de tiempo", () => {
    let state = simReducer(initialSimState(), { type: "connect", speed: 60 });
    for (let i = 0; i < 350; i += 1) {
      state = simReducer(state, {
        type: "message",
        message: { type: "order", clock_min: i, stop: stop(`n${i}`, i) },
      });
    }
    expect(state.events).toHaveLength(300);
    expect(state.events[0]).toMatchObject({ stopId: "n50" });
    expect(timelineHorizon(state)).toBe(60);
    const withPlan = simReducer(state, {
      type: "message",
      message: {
        type: "reoptimized",
        clock_min: 349,
        solution: solution([1], 480),
        runtime_s: 1,
        reason: "batch",
      },
    });
    expect(timelineHorizon(withPlan)).toBe(480);
  });

  it("los pedidos conocidos son los liberados al inicio más los revelados", () => {
    const problem = { stops: [stop("a"), stop("b", 30)] } as unknown as Problem;
    expect(knownStops(problem, []).map((s) => s.id)).toEqual(["a"]);
    expect(knownStops(problem, [{ stop: stop("b", 30) }]).map((s) => s.id)).toEqual(["a", "b"]);
    expect(knownStops(problem, [{ stop: stop("a") }]).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("interpolación de repartidores", () => {
  it("interpola linealmente y acota la fracción", () => {
    const mid = lerpLatLon({ lat: 0, lon: 0 }, { lat: 10, lon: -20 }, 0.5);
    expect(mid).toEqual({ lat: 5, lon: -10 });
    expect(lerpLatLon({ lat: 0, lon: 0 }, { lat: 10, lon: 10 }, 2)).toEqual({ lat: 10, lon: 10 });
    expect(lerpLatLon({ lat: 0, lon: 0 }, { lat: 10, lon: 10 }, -1)).toEqual({ lat: 0, lon: 0 });
  });

  it("el tween parte de la posición mostrada y llega al destino", () => {
    const current = { d1: { lat: 0, lon: 0 } };
    const next = positionsOf([
      {
        driver_id: "d1",
        location: { lat: 10, lon: 10 },
        next_stop_id: null,
        completed: 0,
        remaining: 0,
      },
      {
        driver_id: "d2",
        location: { lat: 1, lon: 1 },
        next_stop_id: null,
        completed: 0,
        remaining: 0,
      },
    ]);
    const tween = retarget(current, next, 1000, 500);
    expect(sampleTween(tween, 1000).d1).toEqual({ lat: 0, lon: 0 });
    expect(sampleTween(tween, 1250).d1).toEqual({ lat: 5, lon: 5 });
    expect(sampleTween(tween, 1250).d2).toEqual({ lat: 1, lon: 1 });
    expect(tweenFinished(tween, 1499)).toBe(false);
    expect(tweenFinished(tween, 1500)).toBe(true);
    expect(sampleTween(tween, 9999).d1).toEqual({ lat: 10, lon: 10 });
  });

  it("acota la duración entre ticks", () => {
    expect(tickDuration(null, 1000)).toBe(500);
    expect(tickDuration(900, 1000)).toBe(100);
    expect(tickDuration(0, 700)).toBe(700);
    expect(tickDuration(0, 90_000)).toBe(2000);
  });
});

describe("plan y pedidos nuevos", () => {
  it("genera ids consecutivos de pedidos del usuario", () => {
    expect(nextOrderId(["s1", "s2"])).toBe("u001");
    expect(nextOrderId(["u001", "u007", "x"])).toBe("u008");
  });

  it("crea el pedido con la liberación en el reloj actual", () => {
    const order = makeOrder("u001", { lat: 25.7, lon: -100.3 }, 42);
    expect(order.release_min).toBe(42);
    expect(order.location.lat).toBe(25.7);
    expect(order.priority).toBe("normal");
  });

  it("arma la vista del plan con orígenes en la posición actual", () => {
    const base = { stops: [], drivers: [] } as unknown as Problem;
    const view = buildPlanView(
      base,
      [stop("a")],
      solution([1]),
      [
        {
          driver_id: "d0",
          location: { lat: 1, lon: 2 },
          next_stop_id: "a",
          completed: 0,
          remaining: 1,
        },
      ],
      ["z"],
    );
    expect(view.problem.stops.map((s) => s.id)).toEqual(["a"]);
    expect(view.origins.d0).toEqual({ lat: 1, lon: 2 });
    expect(view.delivered.has("z")).toBe(true);
  });

  it("ubica las marcas como porcentaje del horizonte", () => {
    expect(markPosition(30, 120)).toBe(25);
    expect(markPosition(500, 120)).toBe(100);
    expect(markPosition(5, 0)).toBe(0);
  });
});
