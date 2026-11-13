export type SseMessage = {
  event: string;
  data: string;
};

export class SseParser {
  private buffer = "";
  private event = "";
  private dataLines: string[] = [];

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let newline = this.buffer.search(/\r\n|\n|\r/);
    while (newline !== -1) {
      const terminator = this.buffer.startsWith("\r\n", newline) ? 2 : 1;
      if (this.buffer[newline] === "\r" && terminator === 1 && newline === this.buffer.length - 1) {
        break;
      }
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + terminator);
      const message = this.consumeLine(line);
      if (message) messages.push(message);
      newline = this.buffer.search(/\r\n|\n|\r/);
    }
    return messages;
  }

  flush(): SseMessage[] {
    const messages: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const message = this.consumeLine(this.buffer);
      this.buffer = "";
      if (message) messages.push(message);
    }
    const last = this.consumeLine("");
    if (last) messages.push(last);
    return messages;
  }

  private consumeLine(line: string): SseMessage | null {
    if (line === "") {
      if (this.dataLines.length === 0) {
        this.event = "";
        return null;
      }
      const message = {
        event: this.event || "message",
        data: this.dataLines.join("\n"),
      };
      this.event = "";
      this.dataLines = [];
      return message;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    if (field === "data") this.dataLines.push(value);
    return null;
  }
}

export type SseRequest = {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onMessage: (message: SseMessage) => void;
  onResponse?: (response: Response) => void;
};

export async function readSse({
  url,
  body,
  signal,
  onMessage,
  onResponse,
}: SseRequest): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  onResponse?.(response);
  if (!response.ok || !response.body) {
    throw new SseHttpError(response.status, await safeText(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const message of parser.push(decoder.decode(value, { stream: true }))) {
      onMessage(message);
    }
  }
  for (const message of parser.push(decoder.decode())) onMessage(message);
  for (const message of parser.flush()) onMessage(message);
}

export class SseHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
