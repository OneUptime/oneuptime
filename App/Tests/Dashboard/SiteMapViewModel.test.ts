import { describe, expect, test } from "@jest/globals";
import {
  BuildPinsResult,
  CLUSTER_CELL_SIZE,
  ClusterColorKey,
  ClusterColorMember,
  MAX_CLUSTER_RADIUS,
  MIN_CLUSTER_RADIUS,
  FingerprintableSite,
  PinnableSite,
  buildPins,
  clusterCellSize,
  clusterRadius,
  decideClusterColorKey,
  formatUptimePercent,
  mapPinFingerprint,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel";
import {
  ROBINSON_VIEW_BOX_HEIGHT,
  ROBINSON_VIEW_BOX_WIDTH,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";
import {
  MAX_ZOOM,
  MapViewport,
  WORLD_VIEWPORT,
  zoomViewport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoViewport";
import {
  GeoCluster,
  clusterPoints,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoClusterUtil";

/*
 * Pins the SiteGeoMap view-model: pin building on the single world
 * projection, the cluster color decision matrix, the sqrt-scaled radius
 * clamp, and the zoom-awareness that makes zooming worth doing — markers
 * that stay the same size on screen, and a cluster grid that lets a lump of
 * nearby sites break apart as you zoom into it.
 *
 * buildPins used to take a region ("us" | "world") and drop every site the
 * AlbersUSA composite could not place — which was every site outside the
 * United States. It takes no region now, and the tests below assert the
 * replacement promise: nothing with usable coordinates is ever dropped.
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
    expect(buildPins([])).toEqual({ pins: [], unmappableCount: 0 });
  });

  /*
   * The change that let the region toggle be deleted. Every one of these
   * except Kansas City and Honolulu used to be silently unmappable whenever
   * the map was in its "United States" mode.
   */
  test.each([
    ["Kansas City", 39.1, -94.58],
    ["Honolulu", 21.31, -157.86],
    ["London", 51.5, -0.12],
    ["Berlin", 52.52, 13.4],
    ["Mumbai", 19.08, 72.88],
    ["Sydney", -33.87, 151.21],
    ["São Paulo", -23.55, -46.63],
    ["Nairobi", -1.29, 36.82],
    ["Guam", 13.44, 144.79],
    ["San Juan", 18.47, -66.11],
    ["Reykjavík", 64.15, -21.94],
    ["Ushuaia", -54.8, -68.3],
  ])(
    "%s is placed on the map",
    (name: string, latitude: number, longitude: number) => {
      const result: BuildPinsResult = buildPins([
        site(name, latitude, longitude),
      ]);
      expect(result.unmappableCount).toBe(0);
      expect(result.pins).toHaveLength(1);
      const pin: { x: number; y: number } = result.pins[0]!;
      expect(pin.x).toBeGreaterThanOrEqual(0);
      expect(pin.x).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
      expect(pin.y).toBeGreaterThanOrEqual(0);
      expect(pin.y).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
    },
  );

  test("a whole international network is placed, none dropped", () => {
    const result: BuildPinsResult = buildPins([
      site("london", 51.5, -0.12),
      site("guam", 13.44, 144.79),
      site("sydney", -33.87, 151.21),
      site("kc", 39.1, -94.58),
      site("nairobi", -1.29, 36.82),
    ]);
    expect(result.unmappableCount).toBe(0);
    expect(result.pins).toHaveLength(5);
  });

  test("only non-finite coordinates are unmappable", () => {
    const result: BuildPinsResult = buildPins([
      site("nan-lat", Number.NaN, -94.58),
      site("nan-lon", 39.1, Number.NaN),
      site("inf-lat", Number.POSITIVE_INFINITY, 0),
      site("neg-inf-lon", 39.1, Number.NEGATIVE_INFINITY),
    ]);
    expect(result.pins).toEqual([]);
    expect(result.unmappableCount).toBe(4);
  });

  test("mappable and unmappable sites split correctly in one call", () => {
    const result: BuildPinsResult = buildPins([
      site("kc", 39.1, -94.58),
      site("broken", Number.NaN, Number.NaN),
      site("london", 51.5, -0.12),
    ]);
    expect(result.pins).toHaveLength(2);
    expect(result.pins[0]!.id).toBe("kc");
    expect(result.pins[1]!.id).toBe("london");
    expect(result.unmappableCount).toBe(1);
  });

  test("out-of-range coordinates are clamped onto the map, not dropped", () => {
    // Corrupt-but-finite data still gets a pin rather than vanishing.
    const result: BuildPinsResult = buildPins([site("weird", 500, 900)]);
    expect(result.unmappableCount).toBe(0);
    expect(result.pins).toHaveLength(1);
  });

  test("statusPriority is carried through; non-finite collapses to 0", () => {
    const result: BuildPinsResult = buildPins([
      site("a", 39.1, -94.58, 7),
      site("b", 38.6, -90.2, Number.NaN),
    ]);
    expect(result.pins[0]!.statusPriority).toBe(7);
    expect(result.pins[1]!.statusPriority).toBe(0);
  });

  test("pins preserve input order and the result is deterministic", () => {
    const sites: Array<PinnableSite> = [
      site("b", 40.71, -74.01, 1),
      site("a", 34.05, -118.24, 2),
      site("c", 41.88, -87.63, 0),
    ];
    const first: BuildPinsResult = buildPins(sites);
    const second: BuildPinsResult = buildPins(sites);
    expect(
      first.pins.map((pin: { id: string }) => {
        return pin.id;
      }),
    ).toEqual(["b", "a", "c"]);
    expect(second).toEqual(first);
  });

  test("sites in different places project to different pins", () => {
    const result: BuildPinsResult = buildPins([
      site("london", 51.5, -0.12),
      site("sydney", -33.87, 151.21),
    ]);
    expect(result.pins[0]!.x).not.toBeCloseTo(result.pins[1]!.x, 3);
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

  /*
   * A marker is UI, not geography. If it grew with the zoom, zooming in to
   * separate two sites would just give you two bigger overlapping blobs.
   */
  test("shrinks in viewBox units as the map zooms in, staying constant on screen", () => {
    const world: number = clusterRadius(1, WORLD_VIEWPORT);
    expect(world).toBe(MIN_CLUSTER_RADIUS);

    for (const zoom of [2, 4, 8, MAX_ZOOM]) {
      const viewport: MapViewport = zoomViewport(WORLD_VIEWPORT, zoom);
      expect(clusterRadius(1, viewport)).toBeCloseTo(
        MIN_CLUSTER_RADIUS / zoom,
        9,
      );
    }
  });

  test("no viewport means screen units — the two forms agree at zoom 1", () => {
    for (const count of [1, 3, 9, 50]) {
      expect(clusterRadius(count, WORLD_VIEWPORT)).toBeCloseTo(
        clusterRadius(count),
        9,
      );
    }
  });

  test("the count still drives the relative size at every zoom", () => {
    const viewport: MapViewport = zoomViewport(WORLD_VIEWPORT, 8);
    expect(clusterRadius(4, viewport) / clusterRadius(1, viewport)).toBeCloseTo(
      2,
      9,
    );
  });
});

describe("clusterCellSize", () => {
  test("at zoom 1 it is the base cell size", () => {
    expect(clusterCellSize(WORLD_VIEWPORT)).toBe(CLUSTER_CELL_SIZE);
  });

  test("shrinks with zoom, so the grid is a constant distance on screen", () => {
    for (const zoom of [2, 4, MAX_ZOOM]) {
      expect(clusterCellSize(zoomViewport(WORLD_VIEWPORT, zoom))).toBeCloseTo(
        CLUSTER_CELL_SIZE / zoom,
        9,
      );
    }
  });

  /*
   * This is what makes zoom worth having: without it, sites that share a
   * marker at world zoom would share it at every zoom, and the only way to
   * tell them apart would be the picker popover.
   */
  test("zooming in actually splits a lump of nearby sites apart", () => {
    /*
     * Four sites a few viewBox units apart, all inside one base-size grid
     * cell (cells are anchored at multiples of CLUSTER_CELL_SIZE, so 476-503
     * horizontally and 252-279 vertically is a single cell) — one marker on
     * the world map.
     */
    const pins: Array<{
      id: string;
      x: number;
      y: number;
      statusPriority: number;
    }> = [
      { id: "a", x: 480, y: 255, statusPriority: 0 },
      { id: "b", x: 486, y: 258, statusPriority: 0 },
      { id: "c", x: 492, y: 262, statusPriority: 0 },
      { id: "d", x: 498, y: 266, statusPriority: 0 },
    ];

    const atWorld: Array<GeoCluster> = clusterPoints(
      pins,
      clusterCellSize(WORLD_VIEWPORT),
    );
    expect(atWorld).toHaveLength(1);
    expect(atWorld[0]!.totalCount).toBe(4);

    const zoomedIn: Array<GeoCluster> = clusterPoints(
      pins,
      clusterCellSize(zoomViewport(WORLD_VIEWPORT, MAX_ZOOM)),
    );
    expect(zoomedIn.length).toBeGreaterThan(1);
    expect(
      zoomedIn.reduce((total: number, cluster: GeoCluster): number => {
        return total + cluster.totalCount;
      }, 0),
    ).toBe(4);
  });

  test("clustering never loses or duplicates a site at any zoom", () => {
    const pins: Array<{
      id: string;
      x: number;
      y: number;
      statusPriority: number;
    }> = Array.from({ length: 25 }, (_unused: unknown, index: number) => {
      return {
        id: `site-${index}`,
        x: 200 + (index % 5) * 3,
        y: 150 + Math.floor(index / 5) * 3,
        statusPriority: 0,
      };
    });

    for (const zoom of [1, 2, 5, 10, MAX_ZOOM]) {
      const clusters: Array<GeoCluster> = clusterPoints(
        pins,
        clusterCellSize(zoomViewport(WORLD_VIEWPORT, zoom)),
      );
      const ids: Array<string> = clusters.flatMap((cluster: GeoCluster) => {
        return cluster.ids;
      });
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25);
    }
  });

  test("the number of clusters never falls as the map zooms in", () => {
    const pins: Array<{
      id: string;
      x: number;
      y: number;
      statusPriority: number;
    }> = Array.from({ length: 12 }, (_unused: unknown, index: number) => {
      return {
        id: `site-${index}`,
        x: 300 + index * 4,
        y: 200 + index * 2,
        statusPriority: 0,
      };
    });

    let previous: number = 0;
    for (const zoom of [1, 2, 4, 8, 16, MAX_ZOOM]) {
      const count: number = clusterPoints(
        pins,
        clusterCellSize(zoomViewport(WORLD_VIEWPORT, zoom)),
      ).length;
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
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
 * out from under anyone reading it, and now it would also re-frame the map
 * under anyone who has zoomed in. The fingerprint is what it keys both
 * resets on, so what it does and does NOT include is the contract.
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
   * not close a popover or re-frame the map — the resets exist for a map
   * that has actually changed shape, not for status churn.
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
