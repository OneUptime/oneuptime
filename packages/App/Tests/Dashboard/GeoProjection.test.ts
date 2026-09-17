import { describe, expect, test } from "@jest/globals";
import {
  ProjectedPoint,
  ROBINSON_VIEW_BOX,
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
  projectRobinson,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";

/*
 * Pins the NetworkSite map projection. The absolute expectations were derived
 * from this implementation and cross-checked against the documented Robinson
 * layout (world centred on 0,0 in a 960x500 box) — they guard against
 * accidental parameter drift, which would silently move every site pin off
 * its country outline.
 *
 * Robinson is now the ONLY projection. The map used to carry a second one, an
 * AlbersUSA composite behind a "United States / World" toggle, which returned
 * null for anything outside the United States — every site in Europe, Asia,
 * Africa, Oceania or Latin America was simply unplottable on half the
 * product's map control. The tests below assert the property that replaced
 * it: every finite coordinate on Earth has a place on this map.
 */

// Reference cities as [latitude, longitude].
const LONDON: [number, number] = [51.5074, -0.1278];
const NEW_YORK: [number, number] = [40.7128, -74.006];
const SYDNEY: [number, number] = [-33.8688, 151.2093];
const TOKYO: [number, number] = [35.6762, 139.6503];
const SAO_PAULO: [number, number] = [-23.5505, -46.6333];
const NAIROBI: [number, number] = [-1.2921, 36.8219];
const MUMBAI: [number, number] = [19.076, 72.8777];
const REYKJAVIK: [number, number] = [64.1466, -21.9426];
const ANCHORAGE: [number, number] = [61.2181, -149.9003];
const HONOLULU: [number, number] = [21.3069, -157.8583];
const GUAM: [number, number] = [13.4443, 144.7937];
const SAN_JUAN: [number, number] = [18.4655, -66.1057];
const SUVA: [number, number] = [-18.1416, 178.4419];
const USHUAIA: [number, number] = [-54.8019, -68.303];

describe("projectRobinson", () => {
  test("viewBox constants match the 960x500 layout", () => {
    expect(ROBINSON_VIEW_BOX_WIDTH).toBe(960);
    expect(ROBINSON_VIEW_BOX_HEIGHT).toBe(500);
    expect(ROBINSON_VIEW_BOX).toBe("0 0 960 500");
  });

  test("origin and extremes land on the layout anchors", () => {
    // Lat/lon 0,0 is the exact centre of the viewBox.
    expect(projectRobinson(0, 0)[0]).toBeCloseTo(480, 5);
    expect(projectRobinson(0, 0)[1]).toBeCloseTo(250, 5);

    // The antimeridian at the equator touches the viewBox edges exactly.
    expect(projectRobinson(0, 180)[0]).toBeCloseTo(960, 5);
    expect(projectRobinson(0, 180)[1]).toBeCloseTo(250, 5);
    expect(projectRobinson(0, -180)[0]).toBeCloseTo(0, 5);

    // Poles sit on the central meridian with a small vertical margin.
    const northPole: ProjectedPoint = projectRobinson(90, 0);
    const southPole: ProjectedPoint = projectRobinson(-90, 0);
    expect(northPole[0]).toBeCloseTo(480, 5);
    expect(northPole[1]).toBeCloseTo(6.5, 0);
    expect(southPole[1]).toBeCloseTo(493.5, 0);
  });

  test("known world cities project to expected positions", () => {
    const london: ProjectedPoint = projectRobinson(...LONDON);
    const newYork: ProjectedPoint = projectRobinson(...NEW_YORK);
    const sydney: ProjectedPoint = projectRobinson(...SYDNEY);
    const tokyo: ProjectedPoint = projectRobinson(...TOKYO);

    expect(london[0]).toBeCloseTo(479.7, 0);
    expect(london[1]).toBeCloseTo(95.3, 0);
    expect(newYork[0]).toBeCloseTo(298.8, 0);
    expect(newYork[1]).toBeCloseTo(127.2, 0);
    expect(sydney[0]).toBeCloseTo(861.7, 0);
    expect(sydney[1]).toBeCloseTo(352.2, 0);
    expect(tokyo[0]).toBeCloseTo(830.0, 0);
    expect(tokyo[1]).toBeCloseTo(142.3, 0);
  });

  test("relative geometry is preserved", () => {
    const london: ProjectedPoint = projectRobinson(...LONDON);
    const newYork: ProjectedPoint = projectRobinson(...NEW_YORK);
    const sydney: ProjectedPoint = projectRobinson(...SYDNEY);

    // London is further north (smaller y) and further east than New York.
    expect(london[1]).toBeLessThan(newYork[1]);
    expect(london[0]).toBeGreaterThan(newYork[0]);
    // Sydney is in the south-east quadrant.
    expect(sydney[0]).toBeGreaterThan(480);
    expect(sydney[1]).toBeGreaterThan(250);
    // New York is in the north-west quadrant.
    expect(newYork[0]).toBeLessThan(480);
    expect(newYork[1]).toBeLessThan(250);
  });

  /*
   * The property that let the region toggle be deleted rather than extended:
   * there is no location this projection refuses. The AlbersUSA composite it
   * replaced returned null for every one of these but Anchorage and Honolulu
   * — including two US territories.
   */
  test.each([
    ["London", LONDON],
    ["Tokyo", TOKYO],
    ["Sydney", SYDNEY],
    ["São Paulo", SAO_PAULO],
    ["Nairobi", NAIROBI],
    ["Mumbai", MUMBAI],
    ["Reykjavík", REYKJAVIK],
    ["Anchorage", ANCHORAGE],
    ["Honolulu", HONOLULU],
    ["Guam", GUAM],
    ["San Juan", SAN_JUAN],
    ["Suva", SUVA],
    ["Ushuaia", USHUAIA],
  ])(
    "%s has a place on the map",
    (_name: string, location: [number, number]) => {
      const point: ProjectedPoint = projectRobinson(...location);
      expect(Number.isFinite(point[0])).toBe(true);
      expect(Number.isFinite(point[1])).toBe(true);
      expect(point[0]).toBeGreaterThanOrEqual(0);
      expect(point[0]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
      expect(point[1]).toBeGreaterThanOrEqual(0);
      expect(point[1]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
    },
  );

  test("distinct cities project to distinct places", () => {
    const seen: Set<string> = new Set<string>();
    for (const location of [
      LONDON,
      TOKYO,
      SYDNEY,
      SAO_PAULO,
      NAIROBI,
      MUMBAI,
      REYKJAVIK,
      ANCHORAGE,
      HONOLULU,
      GUAM,
      SAN_JUAN,
      SUVA,
      USHUAIA,
    ] as Array<[number, number]>) {
      const point: ProjectedPoint = projectRobinson(...location);
      seen.add(`${point[0].toFixed(3)}:${point[1].toFixed(3)}`);
    }
    expect(seen.size).toBe(13);
  });

  test("all output stays inside the viewBox, even for extreme input", () => {
    const inputs: Array<[number, number]> = [
      [90, 180],
      [-90, -180],
      [1000, -1000],
      [-1000, 1000],
      [51.5074, -0.1278],
      [-33.8688, 151.2093],
    ];
    for (const [latitude, longitude] of inputs) {
      const point: ProjectedPoint = projectRobinson(latitude, longitude);
      expect(point[0]).toBeGreaterThanOrEqual(0);
      expect(point[0]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
      expect(point[1]).toBeGreaterThanOrEqual(0);
      expect(point[1]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
    }
  });

  /*
   * A dense sweep of the whole globe. The map's viewport math assumes every
   * pin is inside the world box; one escaping coordinate would put a marker
   * outside any frame the user can pan to.
   */
  test("every 5 degrees of the globe lands inside the viewBox", () => {
    for (let latitude: number = -90; latitude <= 90; latitude += 5) {
      for (let longitude: number = -180; longitude <= 180; longitude += 5) {
        const point: ProjectedPoint = projectRobinson(latitude, longitude);
        expect(point[0]).toBeGreaterThanOrEqual(0);
        expect(point[0]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
        expect(point[1]).toBeGreaterThanOrEqual(0);
        expect(point[1]).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
      }
    }
  });

  test("x is monotonic in longitude and y in latitude", () => {
    // Two properties a reader relies on: east is right, north is up.
    for (let longitude: number = -180; longitude < 180; longitude += 15) {
      expect(projectRobinson(20, longitude)[0]).toBeLessThan(
        projectRobinson(20, longitude + 15)[0],
      );
    }
    for (let latitude: number = -90; latitude < 90; latitude += 15) {
      expect(projectRobinson(latitude, 20)[1]).toBeGreaterThan(
        projectRobinson(latitude + 15, 20)[1],
      );
    }
  });

  test("out-of-range input is clamped", () => {
    expect(projectRobinson(120, 0)).toEqual(projectRobinson(90, 0));
    expect(projectRobinson(0, 250)).toEqual(projectRobinson(0, 180));
    expect(projectRobinson(-120, -250)).toEqual(projectRobinson(-90, -180));
  });

  test("non-finite input collapses to the viewBox centre", () => {
    const point: ProjectedPoint = projectRobinson(NaN, Infinity);
    expect(point[0]).toBeCloseTo(480, 5);
    expect(point[1]).toBeCloseTo(250, 5);
  });

  test("deterministic: same input, same output; different input, different output", () => {
    expect(projectRobinson(...SYDNEY)).toEqual(projectRobinson(...SYDNEY));
    expect(projectRobinson(...SYDNEY)).not.toEqual(projectRobinson(...TOKYO));
  });

  test("latitude sign is mirrored about the equator", () => {
    // Same parallel north and south maps to the same |offset| from centre.
    const north: ProjectedPoint = projectRobinson(45, 30);
    const south: ProjectedPoint = projectRobinson(-45, 30);
    expect(north[0]).toBeCloseTo(south[0], 10);
    expect(north[1] - 250).toBeCloseTo(250 - south[1], 10);
  });
});
