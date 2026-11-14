import type { FeatureCollection, LineString } from "geojson";
import { describe, expect, it } from "vitest";
import type { RouteProps } from "./geojson";
import { antFeatures, buildAntPaths, positionAt } from "./ants";

const LINE: FeatureCollection<LineString, RouteProps> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-100.3, 25.6],
          [-100.3, 25.7],
          [-100.2, 25.7],
        ],
      },
      properties: { driverIndex: 2, color: "#000", dashed: false, emphasis: "normal" },
    },
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-100.3, 25.6]] },
      properties: { driverIndex: 3, color: "#000", dashed: false, emphasis: "normal" },
    },
  ],
};

describe("hormigas", () => {
  it("construye un camino por ruta válida con longitud acumulada", () => {
    const paths = buildAntPaths(LINE);
    expect(paths).toHaveLength(1);
    expect(paths[0].driverIndex).toBe(2);
    expect(paths[0].cumulative).toHaveLength(3);
    expect(paths[0].length).toBeGreaterThan(10);
    expect(paths[0].count).toBeGreaterThanOrEqual(1);
  });

  it("recorre del inicio al final y da la vuelta", () => {
    const [path] = buildAntPaths(LINE);
    expect(positionAt(path, 0)).toEqual([-100.3, 25.6]);
    const mid = positionAt(path, 0.5);
    expect(mid[0]).toBeCloseTo(-100.3, 5);
    expect(mid[1]).toBeGreaterThan(25.6);
    expect(positionAt(path, 1)).toEqual(positionAt(path, 0));
    expect(positionAt(path, 1.25)).toEqual(positionAt(path, 0.25));
  });

  it("es determinista y produce puntos dentro del recuadro de la ruta", () => {
    const paths = buildAntPaths(LINE);
    const a = antFeatures(paths, 1234);
    const b = antFeatures(paths, 1234);
    expect(a).toEqual(b);
    expect(a.features.length).toBe(paths[0].count);
    for (const feature of a.features) {
      const [lon, lat] = feature.geometry.coordinates;
      expect(lon).toBeGreaterThanOrEqual(-100.3);
      expect(lon).toBeLessThanOrEqual(-100.2);
      expect(lat).toBeGreaterThanOrEqual(25.6);
      expect(lat).toBeLessThanOrEqual(25.7);
    }
  });
});
