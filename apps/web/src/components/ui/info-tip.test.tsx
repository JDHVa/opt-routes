import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import { InfoTip } from "./info-tip";

function render(node: React.ReactNode, locale: "es" | "en" = "es"): string {
  const messages = locale === "es" ? es : en;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function attr(html: string, name: string): string | null {
  const match = html.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

describe("InfoTip", () => {
  it("es un botón enfocable con nombre accesible", () => {
    const html = render(<InfoTip topic="metrics.distance" />);
    expect(html).toContain("<button");
    expect(attr(html, "aria-label")).toBe("Más información: Distancia");
    expect(html).not.toContain('tabindex="-1"');
  });

  it("aria-describedby apunta a un texto con título y explicación", () => {
    const html = render(<InfoTip topic="metrics.makespan" />);
    const id = attr(html, "aria-describedby");
    expect(id).toBeTruthy();
    const description = html.match(new RegExp(`<span id="${id}"[^>]*>([^<]*)</span>`));
    expect(description?.[1]).toContain("Última entrega");
    expect(description?.[1]).toContain("ruta más larga");
  });

  it("incluye el ejemplo con unidades cuando existe", () => {
    const html = render(<InfoTip topic="params.rho" />);
    expect(html).toContain("ρ = 0.1");
  });

  it("usa el texto del idioma activo", () => {
    const html = render(<InfoTip topic="algorithms.aco_ga" />, "en");
    expect(attr(html, "aria-label")).toBe("More info: ACO + GA");
    expect(html).toContain("Hybrid");
  });

  it("cae al título y descripción del schema si no hay texto de ayuda", () => {
    const html = render(
      <InfoTip topic="params.campo_desconocido" fallback={{ title: "Campo", body: "Descripción del schema" }} />,
    );
    expect(html).toContain("Descripción del schema");
    expect(attr(html, "aria-label")).toBe("Más información: Campo");
  });

  it("no renderiza nada si no hay ningún texto", () => {
    expect(render(<InfoTip topic="params.campo_desconocido" />)).toBe("");
  });
});
