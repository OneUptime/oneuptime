import { describe, expect, test } from "@jest/globals";
import {
  ALBERS_USA_VIEW_BOX,
  ALBERS_USA_VIEW_BOX_HEIGHT,
  ALBERS_USA_VIEW_BOX_WIDTH,
  ProjectedPoint,
  ROBINSON_VIEW_BOX,
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
  projectAlbersUsa,
  projectRobinson,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";

/*
 * Pins the NetworkSite map projections. The absolute expectations were
 * derived from this implementation and cross-checked against the documented
 * d3.geoAlbersUsa()/Robinson layouts (continental US centred, Alaska inset
 * bottom left, Hawaii inset bottom middle; Robinson world centred on 0,0) —
 * they guard against accidental parameter drift, which would silently move
 * every site pin off its state/country outline.
 */

// Reference cities as [latitude, longitude].
const DC: [number, number] = [38.9072, -77.0369];
const LOS_ANGELES: [number, number] = [34.0522, -118.2437];
const SEATTLE: [number, number] = [47.6062, -122.3321];
const ANCHORAGE: [number, number] = [61.2181, -149.9003];
const HONOLULU: [number, number] = [21.3069, -157.8583];
const MIAMI: [number, number] = [25.7617, -80.1918];
const LONDON: [number, number] = [51.5074, -0.1278];
const NEW_YORK: [number, number] = [40.7128, -74.006];
const SYDNEY: [number, number] = [-33.8688, 151.2093];
const TOKYO: [number, number] = [35.6762, 139.6503];
const GUAM: [number, number] = [13.4443, 144.7937];
const SAN_JUAN: [number, number] = [18.4655, -66.1057];

describe("projectAlbersUsa", () => {
  test("viewBox constants match the 975x610 layout", () => {
    expect(ALBERS_USA_VIEW_BOX_WIDTH).toBe(975);
    expect(ALBERS_USA_VIEW_BOX_HEIGHT).toBe(610);
    expect(ALBERS_USA_VIEW_BOX).toBe("0 0 975 610");
  });

  test("known continental points project to their classic positions", () => {
    const dc: ProjectedPoint | null = projectAlbersUsa(...DC);
    const la: ProjectedPoint | null = projectAlbersUsa(...LOS_ANGELES);
    const seattle: ProjectedPoint | null = projectAlbersUsa(...SEATTLE);

    expect(dc).not.toBeNull();
    expect(la).not.toBeNull();
    expect(seattle).not.toBeNull();

    expect(dc![0]).toBeCloseTo(827.4, 0);
    expect(dc![1]).toBeCloseTo(267.3, 0);
    expect(la![0]).toBeCloseTo(86.8, 0);
    expect(la![1]).toBeCloseTo(363.1, 0);
    expect(seattle![0]).toBeCloseTo(97.6, 0);
    expect(seattle![1]).toBeCloseTo(46.3, 0);
  });

  test("Alaska and Hawaii land in their insets", () => {
    const anchorage: ProjectedPoint | null = projectAlbersUsa(...ANCHORAGE);
    const honolulu: ProjectedPoint | null = projectAlbersUsa(...HONOLULU);

    expect(anchorage).not.toBeNull();
    expect(honolulu).not.toBeNull();

    expect(anchorage![0]).toBeCloseTo(112.3, 0);
    expect(anchorage![1]).toBeCloseTo(544.3, 0);
    expect(honolulu![0]).toBeCloseTo(267.0, 0);
    expect(honolulu![1]).toBeCloseTo(549.2, 0);

    // Alaska inset: bottom left of the viewBox.
    expect(anchorage![0]).toBeLessThan(300);
    expect(anchorage![1]).toBeGreaterThan(450);

    // Hawaii inset: bottom middle, to the right of the Alaska inset.
    expect(honolulu![0]).toBeGreaterThan(209);
    expect(honolulu![0]).toBeLessThan(338);
    expect(honolulu![1]).toBeGreaterThan(520);
  });

  test("relative geometry matches the classic composite layout", () => {
    const dc: ProjectedPoint = projectAlbersUsa(...DC)!;
    const la: ProjectedPoint = projectAlbersUsa(...LOS_ANGELES)!;
    const seattle: ProjectedPoint = projectAlbersUsa(...SEATTLE)!;
    const anchorage: ProjectedPoint = projectAlbersUsa(...ANCHORAGE)!;
    const miami: ProjectedPoint = projectAlbersUsa(...MIAMI)!;

    // East coast is right of the west coast.
    expect(dc[0]).toBeGreaterThan(la[0]);
    // Seattle is above Los Angeles.
    expect(seattle[1]).toBeLessThan(la[1]);
    // The Alaska inset sits below the lower 48 and left of the east coast.
    expect(anchorage[1]).toBeGreaterThan(seattle[1]);
    expect(anchorage[0]).toBeLessThan(dc[0]);
    // Miami is in the bottom right of the lower 48.
    expect(miami[0]).toBeGreaterThan(la[0]);
    expect(miami[1]).toBeGreaterThan(dc[1]);
  });

  test("projected points stay inside the viewBox", () => {
    const cities: Array<[number, number]> = [
      DC,
      LOS_ANGELES,
      SEATTLE,
      ANCHORAGE,
      HONOLULU,
      MIAMI,
    ];
    for (const [latitude, longitude] of cities) {
      const point: ProjectedPoint | null = projectAlbersUsa(
        latitude,
        longitude,
      );
      expect(point).not.toBeNull();
      expect(point![0]).toBeGreaterThanOrEqual(0);
      expect(point![0]).toBeLessThanOrEqual(ALBERS_USA_VIEW_BOX_WIDTH);
      expect(point![1]).toBeGreaterThanOrEqual(0);
      expect(point![1]).toBeLessThanOrEqual(ALBERS_USA_VIEW_BOX_HEIGHT);
    }
  });

  test("points outside all three zones return null", () => {
    expect(projectAlbersUsa(...LONDON)).toBeNull();
    expect(projectAlbersUsa(...TOKYO)).toBeNull();
    expect(projectAlbersUsa(...SYDNEY)).toBeNull();
    /*
     * US territories outside the composite must return null rather than
     * being smeared onto the nearest zone — the map drops those pins and
     * lists them separately instead of drawing them over Florida.
     */
    expect(projectAlbersUsa(...GUAM)).toBeNull();
    expect(projectAlbersUsa(...SAN_JUAN)).toBeNull();
  });

  test("just outside a zone's clip rectangle returns null, just inside does not", () => {
    /*
     * The Hawaii inset owns a narrow clip window; Midway Atoll sits well
     * beyond its western edge and must fall through every zone.
     */
    expect(projectAlbersUsa(28.2072, -177.3735)).toBeNull();
    // Hilo, at the far east of the Hawaiian chain, is still inside.
    expect(projectAlbersUsa(19.7297, -155.09)).not.toBeNull();
  });

  test("non-finite input returns null", () => {
    expect(projectAlbersUsa(NaN, -77)).toBeNull();
    expect(projectAlbersUsa(38.9, Infinity)).toBeNull();
  });

  test("deterministic: same input, same output; different input, different output", () => {
    expect(projectAlbersUsa(...DC)).toEqual(projectAlbersUsa(...DC));
    expect(projectAlbersUsa(...DC)).not.toEqual(
      projectAlbersUsa(...LOS_ANGELES),
    );
  });
});

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
