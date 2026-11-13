import { describe, expect, it } from "vitest";
import { SseParser, type SseMessage } from "./sse";

function feed(chunks: string[]): SseMessage[] {
  const parser = new SseParser();
  const out: SseMessage[] = [];
  for (const chunk of chunks) out.push(...parser.push(chunk));
  out.push(...parser.flush());
  return out;
}

describe("SseParser", () => {
  it("parsea un evento completo", () => {
    expect(feed(['event: progress\ndata: {"iteration":1}\n\n'])).toEqual([
      { event: "progress", data: '{"iteration":1}' },
    ]);
  });

  it("une un evento partido en chunks arbitrarios", () => {
    const text = 'event: progress\ndata: {"iteration":42,"x":"a b"}\n\n';
    for (let cut = 1; cut < text.length; cut += 1) {
      const result = feed([text.slice(0, cut), text.slice(cut)]);
      expect(result).toEqual([{ event: "progress", data: '{"iteration":42,"x":"a b"}' }]);
    }
  });

  it("entrega varios eventos de un mismo chunk y de chunks separados", () => {
    const result = feed([
      "event: progress\ndata: 1\n\nevent: progress\nda",
      "ta: 2\n\nevent: result\ndata: 3\n",
      "\n",
    ]);
    expect(result.map((m) => `${m.event}:${m.data}`)).toEqual([
      "progress:1",
      "progress:2",
      "result:3",
    ]);
  });

  it("acepta CRLF, incluso partido entre chunks", () => {
    const result = feed(["event: result\r", "\ndata: ok\r\n\r", "\n"]);
    expect(result).toEqual([{ event: "result", data: "ok" }]);
  });

  it("concatena líneas data con salto de línea", () => {
    expect(feed(["data: a\ndata: b\n\n"])).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("ignora comentarios y keep-alives", () => {
    expect(feed([": ping\n\nevent: error\ndata: {}\n\n"])).toEqual([
      { event: "error", data: "{}" },
    ]);
  });

  it("emite el último evento sin línea en blanco final al cerrar", () => {
    expect(feed(["event: result\ndata: fin"])).toEqual([{ event: "result", data: "fin" }]);
  });
});
