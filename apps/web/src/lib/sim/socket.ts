import type { SimClientMessage, SimServerMessage } from "@/lib/api/types";
import { parseServerMessage, serializeClientMessage } from "./protocol";

export type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number) => void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null;
};

export type SocketFactory = (url: string) => SocketLike;

export type SimSocketHandlers = {
  onOpen?: () => void;
  onMessage: (message: SimServerMessage) => void;
  onInvalid?: (raw: string) => void;
  onClose: (info: { code: number; clean: boolean; requested: boolean }) => void;
};

const OPEN = 1;

export class SimSocket {
  private readonly socket: SocketLike;
  private readonly queue: string[] = [];
  private requested = false;

  constructor(
    url: string,
    private readonly handlers: SimSocketHandlers,
    factory: SocketFactory = (target) => new WebSocket(target) as unknown as SocketLike,
  ) {
    this.socket = factory(url);
    this.socket.onopen = () => {
      for (const data of this.queue.splice(0)) this.socket.send(data);
      this.handlers.onOpen?.();
    };
    this.socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (message) this.handlers.onMessage(message);
      else this.handlers.onInvalid?.(event.data);
    };
    this.socket.onerror = () => undefined;
    this.socket.onclose = (event) => {
      this.handlers.onClose({
        code: event.code,
        clean: event.wasClean,
        requested: this.requested,
      });
    };
  }

  get open(): boolean {
    return this.socket.readyState === OPEN;
  }

  send(message: SimClientMessage): void {
    const data = serializeClientMessage(message);
    if (this.open) this.socket.send(data);
    else this.queue.push(data);
  }

  close(): void {
    this.requested = true;
    this.socket.onmessage = null;
    this.socket.close();
  }
}
