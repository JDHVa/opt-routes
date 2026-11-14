"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { SimClientAddOrder, SimulationConfig, Stop } from "@/lib/api/types";
import { SOLVER_WS_URL } from "@/lib/env";
import { initialSimState, simReducer, type SimState } from "@/lib/sim/reducer";
import { SimSocket } from "@/lib/sim/socket";

export type SimulationControls = {
  state: SimState;
  start: (config: SimulationConfig) => void;
  pause: () => void;
  resume: () => void;
  setSpeed: (speed: number) => void;
  addOrder: (stop: Stop) => void;
  stop: () => void;
  reset: () => void;
};

export function useSimulation(): SimulationControls {
  const [state, dispatch] = useReducer(simReducer, undefined, () => initialSimState());
  const socketRef = useRef<SimSocket | null>(null);

  const start = useCallback((config: SimulationConfig) => {
    socketRef.current?.close();
    dispatch({ type: "connect", speed: config.speed });
    const socket: SimSocket = new SimSocket(SOLVER_WS_URL, {
      onMessage: (message) => {
        if (socketRef.current === socket) dispatch({ type: "message", message });
      },
      onClose: (info) => {
        if (socketRef.current === socket) dispatch({ type: "closed", requested: info.requested });
      },
    });
    socketRef.current = socket;
    socket.send({ type: "start", config });
  }, []);

  const pause = useCallback(() => {
    socketRef.current?.send({ type: "pause" });
    dispatch({ type: "pause" });
  }, []);

  const resume = useCallback(() => {
    socketRef.current?.send({ type: "resume" });
    dispatch({ type: "resume" });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    socketRef.current?.send({ type: "speed", speed });
    dispatch({ type: "speed", speed });
  }, []);

  const addOrder = useCallback((stop: Stop) => {
    const message: SimClientAddOrder = { type: "add_order", stop };
    socketRef.current?.send(message);
  }, []);

  const stop = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.send({ type: "stop" });
    socket.close();
  }, []);

  const reset = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  return { state, start, pause, resume, setSpeed, addOrder, stop, reset };
}
