import { describe, expect, test } from "@jest/globals";
import {
  BuildPinsResult,
  ClusterColorKey,
  ClusterColorMember,
  MAX_CLUSTER_RADIUS,
  MIN_CLUSTER_RADIUS,
  FingerprintableSite,
  MapRegion,
  PinnableSite,
  buildPins,
  clusterRadius,
  decideClusterColorKey,
  formatUptimePercent,
  mapPinFingerprint,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel";
import {
  ALBERS_USA_VIEW_BOX_HEIGHT,
  ALBERS_USA_VIEW_BOX_WIDTH,
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";

/*
 * Pins the SiteGeoMap view-model: projection-null handling (US map drops
 * out-of-zone sites into the unmappable count; the world map only drops
 * non-finite coordinates), the cluster color decision matrix, the
 * sqrt-scaled radius clamp, and determinism — the map re-renders from the
 * same data and must never move or recolor a marker.
 */

function site(
  id: string,
  latitude: number,
  longitude: number,
  statusPriority: number = 0,
): PinnableSite {
  return { id, latitude, longitude, statusPriority };
}

function member(
  statusPriority: number | null | undefined,
  isOperational: boolean | null | undefined,
): ClusterColorMember {
  return { statusPriority, isOperational };
}

describe("buildPins", () => {
  test("empty input yields no pins and no unmappable count", () => {
    expect(buildPins([], "us")).toEqual({ pins: [], unmappableCount: 0 });
    expect(buildPins([], "world")).toEqual({ pins: [], unmappableCount: 0 });
  });

  test("a lower-48 site projects onto the US map inside the viewBox", () => {
    // Kansas City — comfortably inside the lower-48 zone.
    const result: BuildPinsResult = buildPins([site("kc", 39.1, -94.58)], "us");
    expect(result.unmappableCount).toBe(0);
    expect(result.pins).toHaveLength(1);
    const pin: { x: number; y: number } = result.pins[0]!;
    expect(pin.x).toBeGreaterThan(0);
    expect(pin.x).toBeLessThan(ALBERS_USA_VIEW_BOX_WIDTH);
    expect(pin.y).toBeGreaterThan(0);
    expect(pin.y).toBeLessThan(ALBERS_USA_VIEW_BOX_HEIGHT);
  });

  test("Alaska and Hawaii land in their US-map insets", () => {
    const result: BuildPinsResult = buildPins(
      [site("anchorage", 61.22, -149.9), site("honolulu", 21.31, -157.86)],
      "us",
    );
    expect(result.unmappableCount).toBe(0);
    expect(result.pins).toHaveLength(2);
    for (const pin of result.pins) {
      // Both insets sit in the bottom-left quadrant of the viewBox.
      expect(pin.x).toBeLessThan(ALBERS_USA_VIEW_BOX_WIDTH / 2);
      expect(pin.y).toBeGreaterThan(ALBERS_USA_VIEW_BOX_HEIGHT / 2);
    }
  });

  test("sites outside every US zone are counted unmappable, not pinned", () => {
    // London and Guam — projectAlbersUsa returns null for both.
    const result: BuildPinsResult = buildPins(
      [site("london", 51.5, -0.12), site("guam", 13.44, 144.79)],
      "us",
    );
    expect(result.pins).toEqual([]);
    expect(result.unmappableCount).toBe(2);
  });

  test("the world map places every finite coordinate", () => {
    const result: BuildPinsResult = buildPins(
      [
        site("london", 51.5, -0.12),
        site("guam", 13.44, 144.79),
        site("sydney", -33.87, 151.21),
      ],
      "world",
    );
    expect(result.unmappableCount).toBe(0);
    expect(result.pins).toHaveLength(3);
    for (const pin of result.pins) {
      expect(pin.x).toBeGreaterThanOrEqual(0);
      expect(pin.x).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
      expect(pin.y).toBeGreaterThanOrEqual(0);
      expect(pin.y).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
    }
  });

  test("non-finite coordinates are unmappable on BOTH maps", () => {
    const badSites: Array<PinnableSite> = [
      site("nan-lat", Number.NaN, -94.58),
      site("nan-lon", 39.1, Number.NaN),
      site("inf-lat", Number.POSITIVE_INFINITY, 0),
    ];
    for (const region of ["us", "world"] as Array<MapRegion>) {
      const result: BuildPinsResult = buildPins(badSites, region);
      expect(result.pins).toEqual([]);
      expect(result.unmappableCount).toBe(3);
    }
  });

  test("mappable and unmappable sites split correctly in one call", () => {
    const result: BuildPinsResult = buildPins(
      [site("kc", 39.1, -94.58), site("london", 51.5, -0.12)],
      "us",
    );
    expect(result.pins).toHaveLength(1);
    expect(result.pins[0]!.id).toBe("kc");
    expect(result.unmappableCount).toBe(1);
  });

  test("statusPriority is carried through; non-finite collapses to 0", () => {
    const result: BuildPinsResult = buildPins(
      [site("a", 39.1, -94.58, 7), site("b", 38.6, -90.2, Number.NaN)],
      "us",
    );
    expect(result.pins[0]!.statusPriority).toBe(7);
    expect(result.pins[1]!.statusPriority).toBe(0);
  });

  test("pins preserve input order and the result is deterministic", () => {
    const sites: Array<PinnableSite> = [
      site("b", 40.71, -74.01, 1),
      site("a", 34.05, -118.24, 2),
      site("c", 41.88, -87.63, 0),
    ];
    const first: BuildPinsResult = buildPins(sites, "us");
    const second: BuildPinsResult = buildPins(sites, "us");
    expect(first.pins.map((pin: { id: string }) => pin.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(second).toEqual(first);
  });
});

describe("decideClusterColorKey", () => {
  test("no members means no status: 'none'", () => {
    expect(decideClusterColorKey([])).toBe("none");
  });

  test("all statusless (priority 0/null, no operational verdict): 'none'", () => {
    expect(decideClusterColorKey([member(0, null)])).toBe("none");
    expect(
      decideClusterColorKey([member(0, null), member(null, undefined)]),
    ).toBe("none");
    expect(decideClusterColorKey([member(undefined, null)])).toBe("none");
    // Non-finite priorities count as 0.
    expect(decideClusterColorKey([member(Number.NaN, null)])).toBe("none");
  });

  test("every member operational: 'ok'", () => {
    expect(decideClusterColorKey([member(1, true)])).toBe("ok");
    expect(decideClusterColorKey([member(1, true), member(2, true)])).toBe(
      "ok",
    );
    // Operational wins over a zero priority — health is known.
    expect(decideClusterColorKey([member(0, true)])).toBe("ok");
  });

  test("ANY member down: 'down' — an outage is never hidden", () => {
    expect(decideClusterColorKey([member(3, false)])).toBe("down");
    expect(decideClusterColorKey([member(1, true), member(3, false)])).toBe(
      "down",
    );
    expect(decideClusterColorKey([member(0, null), member(3, false)])).toBe(
      "down",
    );
    // Even a zero-priority down member turns the cluster red.
    expect(decideClusterColorKey([member(0, false), member(0, null)])).toBe(
      "down",
    );
  });

  test("partial/unknown health: 'mixed'", () => {
    // Some operational, some without a verdict.
    expect(decideClusterColorKey([member(1, true), member(0, null)])).toBe(
      "mixed",
    );
    // A meaningful (non-zero) priority without an operational verdict.
    expect(decideClusterColorKey([member(3, null)])).toBe("mixed");
    expect(decideClusterColorKey([member(0, null), member(2, null)])).toBe(
      "mixed",
    );
  });

  test("is deterministic and order-independent", () => {
    const members: Array<ClusterColorMember> = [
      member(1, true),
      member(0, null),
      member(2, true),
    ];
    const reversed: Array<ClusterColorMember> = [...members].reverse();
    const forward: ClusterColorKey = decideClusterColorKey(members);
    expect(decideClusterColorKey(members)).toBe(forward);
    expect(decideClusterColorKey(reversed)).toBe(forward);
  });
});

describe("clusterRadius", () => {
  test("a single site renders at the minimum radius", () => {
    expect(clusterRadius(1)).toBe(MIN_CLUSTER_RADIUS);
  });

  test("scales with the square root of the count", () => {
    expect(clusterRadius(4)).toBeCloseTo(MIN_CLUSTER_RADIUS * 2, 5);
    expect(clusterRadius(9)).toBeCloseTo(MIN_CLUSTER_RADIUS * 3, 5);
  });

  test("clamps at the maximum radius for large clusters", () => {
    expect(clusterRadius(11)).toBe(MAX_CLUSTER_RADIUS);
    expect(clusterRadius(100)).toBe(MAX_CLUSTER_RADIUS);
    expect(clusterRadius(1e9)).toBe(MAX_CLUSTER_RADIUS);
  });

  test("degenerate counts fall back to the minimum radius", () => {
    expect(clusterRadius(0)).toBe(MIN_CLUSTER_RADIUS);
    expect(clusterRadius(-5)).toBe(MIN_CLUSTER_RADIUS);
    expect(clusterRadius(Number.NaN)).toBe(MIN_CLUSTER_RADIUS);
    expect(clusterRadius(Number.POSITIVE_INFINITY)).toBe(MIN_CLUSTER_RADIUS);
  });

  test("is monotonically non-decreasing in the count", () => {
    let previous: number = 0;
    for (let count: number = 1; count <= 30; count++) {
      const radius: number = clusterRadius(count);
      expect(radius).toBeGreaterThanOrEqual(previous);
      expect(radius).toBeGreaterThanOrEqual(MIN_CLUSTER_RADIUS);
      expect(radius).toBeLessThanOrEqual(MAX_CLUSTER_RADIUS);
      previous = radius;
    }
  });
});

describe("formatUptimePercent", () => {
  test("renders one decimal with a percent sign", () => {
    expect(formatUptimePercent(99.94)).toBe("99.9%");
    expect(formatUptimePercent(100)).toBe("100.0%");
    expect(formatUptimePercent(0)).toBe("0.0%");
  });

  test("rounds to the nearest tenth", () => {
    expect(formatUptimePercent(99.96)).toBe("100.0%");
    expect(formatUptimePercent(99.95)).toBe("100.0%");
    expect(formatUptimePercent(12.34)).toBe("12.3%");
  });

  test("em-dash when there is no number to show", () => {
    expect(formatUptimePercent(null)).toBe("—");
    expect(formatUptimePercent(undefined)).toBe("—");
    expect(formatUptimePercent(Number.NaN)).toBe("—");
    expect(formatUptimePercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

/*
 * The map page hands SiteGeoMap a freshly built sites array on every
 * 60-second background poll, so the component cannot use array identity to
 * decide whether the map changed — it closed the multi-site picker popover
 * out from under anyone reading it. The fingerprint is what it keys that
 * reset on instead, so what it does and does NOT include is the contract.
 */
describe("mapPinFingerprint", () => {
  function pin(
    id: string,
    latitude: number,
    longitude: number,
  ): FingerprintableSite {
    return { id, latitude, longitude };
  }

  test("renders id, latitude and longitude per site", () => {
    expect(mapPinFingerprint([pin("a", 39.7817, -89.6501)])).toBe(
      "a:39.7817:-89.6501",
    );
    expect(mapPinFingerprint([pin("a", 1, 2), pin("b", 3, 4)])).toBe(
      "a:1:2|b:3:4",
    );
  });

  test("is empty for an empty map", () => {
    expect(mapPinFingerprint([])).toBe("");
  });

  test("a re-fetch of identical data fingerprints identically", () => {
    const first: Array<FingerprintableSite> = [
      pin("unit-1042", 39.7817, -89.6501),
      pin("unit-1401", 34.0522, -118.2437),
    ];
    // A new array with new objects — exactly what the poll produces.
    const second: Array<FingerprintableSite> = first.map(
      (site: FingerprintableSite): FingerprintableSite => {
        return { ...site };
      },
    );
    expect(first).not.toBe(second);
    expect(mapPinFingerprint(second)).toBe(mapPinFingerprint(first));
  });

  test("row order does not matter", () => {
    expect(mapPinFingerprint([pin("b", 3, 4), pin("a", 1, 2)])).toBe(
      mapPinFingerprint([pin("a", 1, 2), pin("b", 3, 4)]),
    );
  });

  /*
   * A site going down recolors its marker but does not move it, so it must
   * not close a popover — the reset exists for anchors that no longer
   * exist, not for status churn.
   */
  test("status is not part of it", () => {
    const withStatus: (
      isOperational: boolean,
      statusPriority: number,
    ) => FingerprintableSite = (
      isOperational: boolean,
      statusPriority: number,
    ): FingerprintableSite => {
      const site: FingerprintableSite & {
        isOperational: boolean;
        statusPriority: number;
      } = { id: "a", latitude: 1, longitude: 2, isOperational, statusPriority };
      return site;
    };
    expect(mapPinFingerprint([withStatus(false, 4)])).toBe(
      mapPinFingerprint([withStatus(true, 1)]),
    );
  });

  test("changes when a site is added, removed, or moved", () => {
    const base: Array<FingerprintableSite> = [pin("a", 1, 2), pin("b", 3, 4)];
    expect(mapPinFingerprint([...base, pin("c", 5, 6)])).not.toBe(
      mapPinFingerprint(base),
    );
    expect(mapPinFingerprint([pin("a", 1, 2)])).not.toBe(
      mapPinFingerprint(base),
    );
    expect(mapPinFingerprint([pin("a", 1, 2), pin("b", 3, 9)])).not.toBe(
      mapPinFingerprint(base),
    );
  });
});
