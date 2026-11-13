import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatKm,
  formatMinutes,
  formatMXN,
  formatNumber,
  formatSeconds,
} from "./format";

const flat = (text: string) => text.replace(/[  ]/g, " ");

describe("formatClock", () => {
  it("t = 0 es 08:00", () => {
    expect(formatClock(0)).toBe("08:00");
  });

  it("suma minutos desde las 08:00", () => {
    expect(formatClock(75)).toBe("09:15");
    expect(formatClock(162.58)).toBe("10:43");
  });

  it("marca el día siguiente", () => {
    expect(formatClock(16 * 60)).toBe("00:00+1");
    expect(formatClock(16 * 60 + 5)).toBe("00:05+1");
  });

  it("acepta otro inicio de jornada", () => {
    expect(formatClock(30, 6 * 60)).toBe("06:30");
  });
});

describe("formatMinutes", () => {
  it("menos de una hora", () => {
    expect(flat(formatMinutes(45, "es"))).toBe("45 min");
  });

  it("horas exactas", () => {
    expect(flat(formatMinutes(120, "en"))).toBe("2 hr");
  });

  it("horas y minutos", () => {
    expect(flat(formatMinutes(135, "es"))).toBe("2 h 15 min");
  });
});

describe("formatKm", () => {
  it("usa unidad de kilómetro con un decimal", () => {
    expect(flat(formatKm(71.014, "es"))).toBe("71.0 km");
    expect(flat(formatKm(1234.56, "en"))).toBe("1,234.6 km");
  });
});

describe("formatMXN", () => {
  it("redondea a pesos", () => {
    expect(flat(formatMXN(1396.73, "es"))).toBe("$1,397");
    expect(flat(formatMXN(1396.73, "en"))).toContain("1,397");
  });
});

describe("formatNumber y formatSeconds", () => {
  it("respeta los decimales pedidos", () => {
    expect(formatNumber(0.7254, "es", 3)).toBe("0.725");
  });

  it("formatea segundos", () => {
    expect(flat(formatSeconds(12.34, "es"))).toBe("12.3s");
  });
});
