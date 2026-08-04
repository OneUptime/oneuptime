import { describe, expect, test } from "@jest/globals";
import {
  BuildPinsResult,
  CLUSTER_CELL_SIZE,
  CONTAINER_COLLISION_FACTOR,
  CONTAINER_SIDE_FACTOR,
  ClusterColorKey,
  ClusterColorMember,
  GENERIC_SITE_TYPE_LABEL,
  HealthTone,
  MAX_CLUSTER_RADIUS,
  MAX_LABELLED_MARKERS,
  MAX_MARKER_LABEL_CHARS,
  MIN_CLUSTER_RADIUS,
  FingerprintableSite,
  LabelPlacement,
  MapMarker,
  PinnableSite,
  PlacedMapMarker,
  buildMapMarkers,
  buildPins,
  childTypeLabelFor,
  clusterCellSize,
  clusterRadius,
  collisionRadiusOfMarker,
  colorKeyForTone,
  decideClusterColorKey,
  describeMapCoverage,
  describeMarkerHealth,
  describeMarkerSite,
  formatUptimePercent,
  groupedMarkerRadius,
  layoutMapMarkers,
  mapPinFingerprint,
  pluralizeSiteType,
  markerCountForSite,
  markerToneForSite,
  resolveMarkerLabels,
  truncateMarkerLabel,
  unitRollupTone,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel";
import { MARKER_CLEARANCE } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/MarkerLayout";
import { MapSiteView } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";
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

/*
 * ── Hierarchy markers ──────────────────────────────────────────────────
 *
 * The map draws one marker per CHILD of the level in view. Everything that
 * decides what such a marker looks like — its colour, its size, the figure
 * inside it, the name under it — is a plain function over plain data, and
 * every one of them is pinned below.
 *
 * The defect they exist to stop coming back: the map plotted every
 * coordinate-bearing site in the project, flat, and let screen-proximity
 * clustering decide what a marker meant. The customer's regions were
 * nowhere on it, and the numbers on it ("104", "58") counted nothing
 * anybody had named.
 */

function mapSite(
  overrides: Partial<MapSiteView> & { id: string },
): MapSiteView {
  return {
    name: `Site ${overrides.id}`,
    siteType: "Region",
    isUnitLevel: false,
    latitude: 0,
    longitude: 0,
    statusPriority: 0,
    isOperational: null,
    parentBreadcrumb: "",
    isContainer: true,
    isDerivedLocation: false,
    locatedDescendantCount: 0,
    unlocatedDescendantCount: 0,
    totalUnits: 0,
    operationalUnits: 0,
    childSiteCount: 0,
    ...overrides,
  };
}

describe("unitRollupTone", () => {
  test("a level with no units has no tone to report", () => {
    expect(unitRollupTone({ totalUnits: 0, operationalUnits: 0 })).toBe("none");
    expect(unitRollupTone({ totalUnits: -4, operationalUnits: 2 })).toBe(
      "none",
    );
    expect(
      unitRollupTone({ totalUnits: Number.NaN, operationalUnits: 0 }),
    ).toBe("none");
  });

  test("everything up is ok", () => {
    expect(unitRollupTone({ totalUnits: 69, operationalUnits: 69 })).toBe("ok");
    expect(unitRollupTone({ totalUnits: 1, operationalUnits: 1 })).toBe("ok");
  });

  /*
   * Half or more down is an outage, not a wobble. This is the exact rule
   * the site card leads with, and the map reads it from the same function
   * so a region cannot be red on its card and amber on its marker.
   */
  test("half or more down is an outage", () => {
    expect(unitRollupTone({ totalUnits: 4, operationalUnits: 2 })).toBe("down");
    expect(unitRollupTone({ totalUnits: 4, operationalUnits: 1 })).toBe("down");
    expect(unitRollupTone({ totalUnits: 69, operationalUnits: 0 })).toBe(
      "down",
    );
    expect(unitRollupTone({ totalUnits: 1, operationalUnits: 0 })).toBe("down");
  });

  test("a minority down is degraded", () => {
    expect(unitRollupTone({ totalUnits: 4, operationalUnits: 3 })).toBe("warn");
    expect(unitRollupTone({ totalUnits: 100, operationalUnits: 99 })).toBe(
      "warn",
    );
  });

  test("more healthy units than exist cannot invent a healthier tone", () => {
    expect(unitRollupTone({ totalUnits: 4, operationalUnits: 99 })).toBe("ok");
    expect(unitRollupTone({ totalUnits: 4, operationalUnits: -2 })).toBe(
      "down",
    );
  });
});

describe("colorKeyForTone", () => {
  test("the card's warn is the map's mixed; everything else is itself", () => {
    expect(colorKeyForTone("warn")).toBe("mixed");
    expect(colorKeyForTone("ok")).toBe("ok");
    expect(colorKeyForTone("down")).toBe("down");
    expect(colorKeyForTone("none")).toBe("none");
  });
});

describe("markerToneForSite", () => {
  test("a container with units is coloured by its rollup", () => {
    expect(
      markerToneForSite(
        mapSite({ id: "a", totalUnits: 100, operationalUnits: 97 }),
      ),
    ).toBe("warn");
    expect(
      markerToneForSite(
        mapSite({ id: "b", totalUnits: 69, operationalUnits: 0 }),
      ),
    ).toBe("down");
  });

  /*
   * A region 3% down must not look identical to one that is entirely dark.
   * The old map coloured any cluster containing a down site solid red,
   * which made every marker on a large estate red and the colour useless.
   */
  test("a mostly-healthy container does not read as an outage", () => {
    const tone: HealthTone = markerToneForSite(
      mapSite({
        id: "a",
        totalUnits: 200,
        operationalUnits: 197,
        isOperational: false,
      }),
    );
    expect(tone).toBe("warn");
  });

  test("a container with no units falls back to its own health", () => {
    expect(markerToneForSite(mapSite({ id: "a", isOperational: false }))).toBe(
      "down",
    );
    expect(markerToneForSite(mapSite({ id: "b", isOperational: true }))).toBe(
      "ok",
    );
    expect(markerToneForSite(mapSite({ id: "c", isOperational: null }))).toBe(
      "none",
    );
  });

  test("a single site is coloured by its own status, not by a rollup", () => {
    expect(
      markerToneForSite(
        mapSite({
          id: "u1",
          isContainer: false,
          isUnitLevel: true,
          totalUnits: 1,
          operationalUnits: 0,
          isOperational: true,
        }),
      ),
    ).toBe("ok");
  });
});

describe("markerCountForSite", () => {
  test("counts the units under it", () => {
    expect(markerCountForSite(mapSite({ id: "a", totalUnits: 69 }))).toBe(69);
  });

  test("falls back to direct sites when there are no units yet", () => {
    expect(
      markerCountForSite(
        mapSite({ id: "a", totalUnits: 0, childSiteCount: 12 }),
      ),
    ).toBe(12);
  });

  test("an empty level counts as one marker, not as zero", () => {
    expect(markerCountForSite(mapSite({ id: "a" }))).toBe(1);
  });
});

describe("describeMarkerHealth", () => {
  test("a healthy container counts what is up", () => {
    expect(
      describeMarkerHealth(
        mapSite({ id: "a", totalUnits: 12, operationalUnits: 12 }),
      ),
    ).toBe("12 units operational");
    expect(
      describeMarkerHealth(
        mapSite({ id: "b", totalUnits: 1, operationalUnits: 1 }),
      ),
    ).toBe("1 unit operational");
  });

  test("an unhealthy container counts what is down", () => {
    expect(
      describeMarkerHealth(
        mapSite({ id: "a", totalUnits: 69, operationalUnits: 0 }),
      ),
    ).toBe("69 of 69 units down");
    expect(
      describeMarkerHealth(
        mapSite({ id: "b", totalUnits: 4, operationalUnits: 3 }),
      ),
    ).toBe("1 of 4 units down");
  });

  test("a single site says how it is, not how many of it there are", () => {
    expect(
      describeMarkerHealth(
        mapSite({ id: "u", isContainer: false, isOperational: true }),
      ),
    ).toBe("Operational");
    expect(
      describeMarkerHealth(
        mapSite({ id: "u", isContainer: false, isOperational: false }),
      ),
    ).toBe("Down");
    expect(
      describeMarkerHealth(
        mapSite({ id: "u", isContainer: false, isOperational: null }),
      ),
    ).toBe("No status yet");
  });
});

describe("describeMarkerSite", () => {
  test("names the site, its type and its state", () => {
    expect(
      describeMarkerSite(
        mapSite({
          id: "r1",
          name: "Region 1000",
          siteType: "Region",
          totalUnits: 69,
          operationalUnits: 0,
          childSiteCount: 4,
        }),
      ),
    ).toBe("Region 1000 — Region · 69 of 69 units down · 4 sites");
  });

  /*
   * An inferred position must not be presented with the same confidence as
   * one somebody typed in.
   */
  test("says so when the position was inferred from what is beneath", () => {
    expect(
      describeMarkerSite(
        mapSite({
          id: "r1",
          name: "Region 1000",
          isDerivedLocation: true,
          locatedDescendantCount: 69,
          totalUnits: 69,
          operationalUnits: 69,
        }),
      ),
    ).toBe(
      "Region 1000 — Region · 69 units operational · centered on 69 located sites",
    );
  });

  test("a single site's description carries no rollup", () => {
    expect(
      describeMarkerSite(
        mapSite({
          id: "u1",
          name: "Unit 1042",
          siteType: "Store",
          isContainer: false,
          isUnitLevel: true,
          isOperational: true,
        }),
      ),
    ).toBe("Unit 1042 — Store · Operational");
  });
});

describe("groupedMarkerRadius", () => {
  test("a level where nothing has more than one site draws at the minimum", () => {
    expect(groupedMarkerRadius(1, 1)).toBe(MIN_CLUSTER_RADIUS);
    expect(groupedMarkerRadius(5, 1)).toBe(MIN_CLUSTER_RADIUS);
  });

  test("the largest marker on screen draws at the maximum", () => {
    expect(groupedMarkerRadius(110, 110)).toBeCloseTo(MAX_CLUSTER_RADIUS, 9);
  });

  /*
   * The absolute sqrt scale saturates at ten sites, so a franchise whose
   * regions hold 63-110 units each would render thirteen identical maximum
   * discs and throw away the one thing size is for. Scaling to the largest
   * marker keeps the comparison alive at any estate size.
   */
  test("regions of different sizes stay distinguishable at franchise scale", () => {
    const small: number = groupedMarkerRadius(63, 110);
    const large: number = groupedMarkerRadius(110, 110);
    expect(small).toBeLessThan(large);
    expect(large - small).toBeGreaterThan(1);
  });

  test("stays inside the marker size bounds for any input", () => {
    const cases: Array<Array<number>> = [
      [0, 0],
      [-5, 10],
      [Number.NaN, 10],
      [10, Number.NaN],
      [1, 100000],
      [100000, 100000],
    ];
    for (const pair of cases) {
      const radius: number = groupedMarkerRadius(pair[0]!, pair[1]!);
      expect(Number.isFinite(radius)).toBe(true);
      expect(radius).toBeGreaterThanOrEqual(MIN_CLUSTER_RADIUS);
      expect(radius).toBeLessThanOrEqual(MAX_CLUSTER_RADIUS);
    }
  });

  test("area tracks the count, so the reading stays honest", () => {
    // Four times the count is twice the linear scale above the minimum.
    const quarter: number = groupedMarkerRadius(25, 100) - MIN_CLUSTER_RADIUS;
    const full: number = groupedMarkerRadius(100, 100) - MIN_CLUSTER_RADIUS;
    expect(full / quarter).toBeCloseTo(2, 9);
  });
});

describe("childTypeLabelFor", () => {
  test("uses the customer's own word when the level agrees on one", () => {
    expect(
      childTypeLabelFor([{ siteType: "Region" }, { siteType: "Region" }]),
    ).toBe("Region");
    expect(childTypeLabelFor([{ siteType: "Restaurant" }])).toBe("Restaurant");
  });

  test("case is not a difference of type", () => {
    expect(
      childTypeLabelFor([{ siteType: "Region" }, { siteType: "region" }]),
    ).toBe("Region");
  });

  /*
   * The map must never put a word in the customer's mouth. A level holding
   * both regions and a stray unit is a level of "sites".
   */
  test("falls back to a generic word when the level mixes types", () => {
    expect(
      childTypeLabelFor([{ siteType: "Region" }, { siteType: "Unit" }]),
    ).toBe(GENERIC_SITE_TYPE_LABEL);
  });

  test("an empty or unnamed level gets the generic word", () => {
    expect(childTypeLabelFor([])).toBe(GENERIC_SITE_TYPE_LABEL);
    expect(childTypeLabelFor([{ siteType: "" }])).toBe(GENERIC_SITE_TYPE_LABEL);
    expect(childTypeLabelFor([{ siteType: "   " }])).toBe(
      GENERIC_SITE_TYPE_LABEL,
    );
  });
});

describe("describeMapCoverage", () => {
  test("grouped mode counts the level's children by their own type name", () => {
    expect(
      describeMapCoverage({
        mode: "grouped",
        markerCount: 13,
        inViewCount: 13,
        siteCount: 13,
        childTypeLabel: "Region",
      }),
    ).toBe("13 regions on the map");
  });

  test("grouped mode says what the frame holds once it stops holding all of it", () => {
    expect(
      describeMapCoverage({
        mode: "grouped",
        markerCount: 13,
        inViewCount: 4,
        siteCount: 13,
        childTypeLabel: "Region",
      }),
    ).toBe("4 of 13 regions in view");
  });

  test("one of something is not plural", () => {
    expect(
      describeMapCoverage({
        mode: "grouped",
        markerCount: 1,
        inViewCount: 1,
        siteCount: 1,
        childTypeLabel: "Market",
      }),
    ).toBe("1 market on the map");
  });

  /*
   * In the flat view a marker really is one site, so the old wording is
   * still the true one — and counting containers as "sites" would be the
   * same category error the flat map made.
   */
  test("all-sites mode counts sites", () => {
    expect(
      describeMapCoverage({
        mode: "all",
        markerCount: 40,
        inViewCount: 900,
        siteCount: 900,
        childTypeLabel: "Region",
      }),
    ).toBe("900 sites mapped");
    expect(
      describeMapCoverage({
        mode: "all",
        markerCount: 40,
        inViewCount: 120,
        siteCount: 900,
        childTypeLabel: "Region",
      }),
    ).toBe("120 of 900 sites in view");
  });
});

describe("buildMapMarkers", () => {
  const REGIONS: Array<MapSiteView> = [
    mapSite({
      id: "r1",
      name: "Region 1000",
      latitude: 32,
      longitude: -96,
      totalUnits: 69,
      operationalUnits: 0,
      isDerivedLocation: true,
    }),
    mapSite({
      id: "r2",
      name: "Region 1100",
      latitude: 40,
      longitude: -74,
      totalUnits: 79,
      operationalUnits: 79,
    }),
    mapSite({
      id: "u1",
      name: "WB Unit 1382",
      siteType: "Unit",
      isContainer: false,
      isUnitLevel: true,
      latitude: 34,
      longitude: -118,
      totalUnits: 1,
      operationalUnits: 1,
      isOperational: true,
    }),
  ];

  test("grouped mode draws exactly one marker per child", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "grouped",
      cellSize: 0,
    });
    expect(markers).toHaveLength(3);
    expect(
      markers
        .map((marker: MapMarker) => {
          return marker.ids[0]!;
        })
        .sort(),
    ).toEqual(["r1", "r2", "u1"]);
    for (const marker of markers) {
      expect(marker.ids).toHaveLength(1);
    }
  });

  /*
   * THE defect. Two regions whose centroids fall close together must stay
   * two markers: merging them by proximity puts a number back on the map
   * that stands for nothing the customer has a name for.
   */
  test("grouped mode never merges two children, however close they sit", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: [
        mapSite({ id: "r1", name: "Region A", latitude: 32, longitude: -96 }),
        mapSite({
          id: "r2",
          name: "Region B",
          latitude: 32.0001,
          longitude: -96.0001,
        }),
      ],
      mode: "grouped",
      cellSize: CLUSTER_CELL_SIZE,
    });
    expect(markers).toHaveLength(2);
  });

  test("all-sites mode still merges nearby sites into one marker", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: [
        mapSite({
          id: "s1",
          isContainer: false,
          latitude: 32,
          longitude: -96,
        }),
        mapSite({
          id: "s2",
          isContainer: false,
          latitude: 32.0001,
          longitude: -96.0001,
        }),
      ],
      mode: "all",
      cellSize: CLUSTER_CELL_SIZE,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]!.count).toBe(2);
    expect(markers[0]!.ids).toEqual(["s1", "s2"]);
  });

  test("a marker knows whether it is a level or a place", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "grouped",
      cellSize: 0,
    });
    const byId: Map<string, MapMarker> = new Map<string, MapMarker>(
      markers.map((marker: MapMarker): [string, MapMarker] => {
        return [marker.ids[0]!, marker];
      }),
    );
    expect(byId.get("r1")!.isContainer).toBe(true);
    expect(byId.get("u1")!.isContainer).toBe(false);
    expect(byId.get("r1")!.isApproximate).toBe(true);
    expect(byId.get("r2")!.isApproximate).toBe(false);
  });

  test("grouped markers carry their name and their rollup colour", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "grouped",
      cellSize: 0,
    });
    const byId: Map<string, MapMarker> = new Map<string, MapMarker>(
      markers.map((marker: MapMarker): [string, MapMarker] => {
        return [marker.ids[0]!, marker];
      }),
    );
    expect(byId.get("r1")!.label).toBe("Region 1000");
    expect(byId.get("r1")!.count).toBe(69);
    expect(byId.get("r1")!.colorKey).toBe("down");
    expect(byId.get("r2")!.colorKey).toBe("ok");
    expect(byId.get("r1")!.tooltip).toContain("69 of 69 units down");
  });

  test("clusters in all-sites mode carry no name label", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "all",
      cellSize: CLUSTER_CELL_SIZE,
    });
    for (const marker of markers) {
      expect(marker.label).toBe("");
      expect(marker.isContainer).toBe(false);
    }
  });

  /*
   * The smallest marker is painted last so a single store never disappears
   * under the region that contains its neighbours.
   */
  test("markers are painted biggest first", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "grouped",
      cellSize: 0,
    });
    const counts: Array<number> = markers.map((marker: MapMarker): number => {
      return marker.count;
    });
    expect(counts).toEqual([79, 69, 1]);
  });

  test("paint order is deterministic when counts tie", () => {
    const tied: Array<MapSiteView> = [
      mapSite({ id: "zzz", latitude: 1, longitude: 1, totalUnits: 5 }),
      mapSite({ id: "aaa", latitude: 2, longitude: 2, totalUnits: 5 }),
      mapSite({ id: "mmm", latitude: 3, longitude: 3, totalUnits: 5 }),
    ];
    const forward: Array<MapMarker> = buildMapMarkers({
      sites: tied,
      mode: "grouped",
      cellSize: 0,
    });
    const reversed: Array<MapMarker> = buildMapMarkers({
      sites: tied.slice().reverse(),
      mode: "grouped",
      cellSize: 0,
    });
    expect(
      forward.map((marker: MapMarker) => {
        return marker.key;
      }),
    ).toEqual(["aaa", "mmm", "zzz"]);
    expect(
      reversed.map((marker: MapMarker) => {
        return marker.key;
      }),
    ).toEqual(
      forward.map((marker: MapMarker) => {
        return marker.key;
      }),
    );
  });

  /*
   * Past the threshold the labels would overlap into an unreadable mat.
   * The hover tooltip still names every marker.
   */
  test("labels come off once a level is too busy for them", () => {
    const many: Array<MapSiteView> = [];
    for (let index: number = 0; index <= MAX_LABELLED_MARKERS; index++) {
      many.push(
        mapSite({
          id: `s${index}`,
          name: `Site ${index}`,
          latitude: index * 0.5,
          longitude: index * 0.5,
        }),
      );
    }
    const overBudget: Array<MapMarker> = buildMapMarkers({
      sites: many,
      mode: "grouped",
      cellSize: 0,
    });
    expect(overBudget.length).toBeGreaterThan(MAX_LABELLED_MARKERS);
    for (const marker of overBudget) {
      expect(marker.label).toBe("");
      expect(marker.tooltip).not.toBe("");
    }

    const withinBudget: Array<MapMarker> = buildMapMarkers({
      sites: many.slice(0, MAX_LABELLED_MARKERS),
      mode: "grouped",
      cellSize: 0,
    });
    expect(withinBudget[0]!.label).not.toBe("");
  });

  test("sites the projection cannot place are left off rather than guessed at", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: [
        mapSite({ id: "good", latitude: 10, longitude: 20 }),
        mapSite({ id: "broken", latitude: Number.NaN, longitude: 20 }),
      ],
      mode: "grouped",
      cellSize: 0,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]!.ids).toEqual(["good"]);
  });

  test("an empty level draws nothing without throwing", () => {
    expect(
      buildMapMarkers({ sites: [], mode: "grouped", cellSize: 0 }),
    ).toEqual([]);
    expect(
      buildMapMarkers({ sites: [], mode: "all", cellSize: CLUSTER_CELL_SIZE }),
    ).toEqual([]);
  });

  test("every marker lands inside the world it is drawn on", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: REGIONS,
      mode: "grouped",
      cellSize: 0,
    });
    for (const marker of markers) {
      expect(marker.x).toBeGreaterThanOrEqual(0);
      expect(marker.x).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_WIDTH);
      expect(marker.y).toBeGreaterThanOrEqual(0);
      expect(marker.y).toBeLessThanOrEqual(ROBINSON_VIEW_BOX_HEIGHT);
      expect(Number.isFinite(marker.screenRadius)).toBe(true);
    }
  });
});

/*
 * A grouped marker stands for a whole region, so the pin it seeds has to
 * carry that weight — and a weight that is not a usable number must not
 * reach the cluster maths, where it would silently become a NaN badge or a
 * zero-count marker.
 */
describe("buildPins carries a marker's weight", () => {
  test("a site's count travels onto its pin", () => {
    const result: BuildPinsResult = buildPins([
      { id: "a", latitude: 10, longitude: 20, statusPriority: 0, count: 69 },
    ]);
    expect(result.pins[0]!.count).toBe(69);
  });

  test("a missing or unusable count reads as one site", () => {
    const result: BuildPinsResult = buildPins([
      { id: "a", latitude: 10, longitude: 20, statusPriority: 0 },
      {
        id: "b",
        latitude: 10,
        longitude: 20,
        statusPriority: 0,
        count: Number.NaN,
      },
      { id: "c", latitude: 10, longitude: 20, statusPriority: 0, count: 0 },
      { id: "d", latitude: 10, longitude: 20, statusPriority: 0, count: -7 },
      { id: "e", latitude: 10, longitude: 20, statusPriority: 0, count: 2.6 },
    ]);
    expect(
      result.pins.map((pin: { count?: number | undefined }) => {
        return pin.count;
      }),
    ).toEqual([1, 1, 1, 1, 3]);
  });
});

describe("truncateMarkerLabel", () => {
  test("a name that fits is left alone", () => {
    expect(truncateMarkerLabel("Region 1000")).toBe("Region 1000");
    expect(
      truncateMarkerLabel("a".repeat(MAX_MARKER_LABEL_CHARS)),
    ).toHaveLength(MAX_MARKER_LABEL_CHARS);
  });

  test("a long name is cut with an ellipsis and no trailing space", () => {
    const label: string = truncateMarkerLabel(
      "Midwest Franchise Group — Northern Division",
    );
    expect(label).toHaveLength(MAX_MARKER_LABEL_CHARS);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toContain(" …");
  });

  test("handles an empty name", () => {
    expect(truncateMarkerLabel("")).toBe("");
  });
});

/*
 * Names on the map are the whole point of the grouped view — "Region 1000"
 * belongs where the customer put it, not only in a tooltip. But three
 * regions whose centroids land in one corner of a state would print their
 * names on top of each other, which hides two of them AND makes the third
 * unreadable.
 */
describe("resolveMarkerLabels", () => {
  function markerAt(
    key: string,
    x: number,
    y: number,
    overrides: Partial<MapMarker> = {},
  ): MapMarker {
    return {
      key: key,
      x: x,
      y: y,
      ids: [key],
      count: 10,
      screenRadius: MIN_CLUSTER_RADIUS,
      colorKey: "ok",
      isContainer: true,
      isApproximate: false,
      label: key,
      tooltip: key,
      ...overrides,
    };
  }

  test("well-separated markers all keep their names, below them", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100), markerAt("B", 300, 300)],
      1,
    );
    expect(placements.get("A")).toBe("below");
    expect(placements.get("B")).toBe("below");
  });

  test("a marker with no label is never placed", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100, { label: "" })],
      1,
    );
    expect(placements.has("A")).toBe(false);
  });

  /*
   * Below is tried first because the eye reads marker-then-name; above is
   * the escape hatch, so a name is only lost when neither position is free.
   */
  test("a label blocked from below flips above rather than disappearing", () => {
    const blocker: MapMarker = markerAt("blocker", 100, 118, { label: "" });
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100), blocker],
      1,
    );
    expect(placements.get("A")).toBe("above");
  });

  test("a label with nowhere to go is dropped, not stacked", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [
        markerAt("A", 100, 100),
        markerAt("above", 100, 82, { label: "" }),
        markerAt("below", 100, 118, { label: "" }),
      ],
      1,
    );
    expect(placements.has("A")).toBe(false);
  });

  /*
   * Paint order is biggest-first, so the region a reader is most likely to
   * be looking for is the one that keeps its name.
   */
  test("when two names collide the first in paint order keeps the better spot", () => {
    /*
     * Far enough apart that neither marker BODY blocks a label — the
     * collision under test is name-against-name. The bigger marker comes
     * first in paint order and keeps the preferred position below it; its
     * neighbour is pushed above rather than dropped.
     */
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("Big", 100, 100), markerAt("Small", 118, 100)],
      1,
    );
    expect(placements.get("Big")).toBe("below");
    expect(placements.get("Small")).toBe("above");
  });

  /*
   * Zooming in genuinely separates markers, so names dropped at a wide
   * frame come back — that is what makes dropping them acceptable.
   */
  test("zooming in brings dropped names back", () => {
    const markers: Array<MapMarker> = [
      markerAt("A", 100, 100),
      markerAt("above", 100, 84, { label: "" }),
      markerAt("below", 100, 116, { label: "" }),
    ];
    expect(resolveMarkerLabels(markers, 1).size).toBe(0);
    expect(resolveMarkerLabels(markers, 12).size).toBe(1);
  });

  test("a non-finite or zero zoom does not throw or lose every name", () => {
    const markers: Array<MapMarker> = [
      markerAt("A", 100, 100),
      markerAt("B", 400, 400),
    ];
    expect(resolveMarkerLabels(markers, Number.NaN).size).toBe(2);
    expect(resolveMarkerLabels(markers, 0).size).toBe(2);
    expect(resolveMarkerLabels(markers, -3).size).toBe(2);
  });

  test("an empty marker list resolves to no labels", () => {
    expect(resolveMarkerLabels([], 1).size).toBe(0);
  });

  test("is deterministic for the same markers and zoom", () => {
    const markers: Array<MapMarker> = [
      markerAt("A", 100, 100),
      markerAt("B", 106, 100),
      markerAt("C", 300, 300),
    ];
    expect(Array.from(resolveMarkerLabels(markers, 4).entries())).toEqual(
      Array.from(resolveMarkerLabels(markers, 4).entries()),
    );
  });

  /*
   * A longer name reserves a wider box, so it collides where a short one
   * would have fitted. This is what keeps the estimate honest.
   */
  test("a longer name needs more room", () => {
    const short: Map<string, LabelPlacement> = resolveMarkerLabels(
      [
        markerAt("A", 100, 100, { label: "A" }),
        markerAt("B", 118, 100, { label: "B" }),
      ],
      1,
    );
    const long: Map<string, LabelPlacement> = resolveMarkerLabels(
      [
        markerAt("A", 100, 100, { label: "Midwest Franchise Gr" }),
        markerAt("B", 118, 100, { label: "Southern Franchise G" }),
      ],
      1,
    );
    // Two short names both sit below their markers; two long ones cannot.
    expect(short.get("A")).toBe("below");
    expect(short.get("B")).toBe("below");
    expect(long.get("A")).toBe("below");
    expect(long.get("B")).toBe("above");
  });
});

/*
 * Site types are free text on a per-project row, so the naive "+ s" that is
 * fine for this file's hardcoded English nouns put "Facilitys", "Branchs"
 * and "Franchise Unitss" on real customers' maps.
 */
describe("pluralizeSiteType", () => {
  test.each([
    ["Region", "Regions"],
    ["Market", "Markets"],
    ["Unit", "Units"],
    ["Store", "Stores"],
    ["Facility", "Facilities"],
    ["Territory", "Territories"],
    ["Branch", "Branches"],
    ["Business", "Businesses"],
    ["Campus", "Campuses"],
    ["Box", "Boxes"],
    ["Dish", "Dishes"],
  ])("%s becomes %s", (singular: string, plural: string) => {
    expect(pluralizeSiteType(singular)).toBe(plural);
  });

  // A customer who already named the type in the plural is left alone.
  test.each([["Units"], ["Premises"], ["Franchise Units"], ["Sites"]])(
    "%s is already plural",
    (word: string) => {
      expect(pluralizeSiteType(word)).toBe(word);
    },
  );

  test("keeps the customer's capitalisation", () => {
    expect(pluralizeSiteType("FRANCHISE")).toBe("FRANCHISEs");
    expect(pluralizeSiteType("region")).toBe("regions");
  });

  test("an empty or blank name stays empty", () => {
    expect(pluralizeSiteType("")).toBe("");
    expect(pluralizeSiteType("   ")).toBe("");
  });
});

describe("describeMapCoverage pluralises the customer's own words", () => {
  test.each([
    ["Facility", 13, "13 facilities on the map"],
    ["Branch", 4, "4 branches on the map"],
    ["Territory", 7, "7 territories on the map"],
    ["Franchise Units", 3, "3 franchise units on the map"],
    ["Region", 1, "1 region on the map"],
  ])("%s x%i reads as %s", (label: string, count: number, expected: string) => {
    expect(
      describeMapCoverage({
        mode: "grouped",
        markerCount: count,
        inViewCount: count,
        siteCount: count,
        childTypeLabel: label,
      }),
    ).toBe(expected);
  });

  test("the partial-frame line pluralises too", () => {
    expect(
      describeMapCoverage({
        mode: "grouped",
        markerCount: 13,
        inViewCount: 5,
        siteCount: 13,
        childTypeLabel: "Facility",
      }),
    ).toBe("5 of 13 facilities in view");
  });
});

/*
 * A grouped marker's SIZE is how a reader compares one region against
 * another at a glance. It is computed inside buildMapMarkers, so asserting
 * groupedMarkerRadius alone would leave the wiring free to regress with the
 * suite green.
 */
describe("buildMapMarkers sizes markers by what is under them", () => {
  test("a bigger estate draws a bigger marker, all the way down the level", () => {
    const sites: Array<MapSiteView> = [110, 97, 69, 41, 1].map(
      (units: number, index: number): MapSiteView => {
        return mapSite({
          id: `r${index}`,
          name: `Region ${index}`,
          latitude: 30 + index * 3,
          longitude: -100 + index * 3,
          totalUnits: units,
          operationalUnits: units,
        });
      },
    );
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: sites,
      mode: "grouped",
      cellSize: 0,
    });
    const radii: Array<number> = markers.map((marker: MapMarker): number => {
      return marker.screenRadius;
    });
    // Paint order is biggest first, so radii descend with it.
    for (let index: number = 1; index < radii.length; index++) {
      expect(radii[index]!).toBeLessThan(radii[index - 1]!);
    }
    expect(radii[0]!).toBeCloseTo(MAX_CLUSTER_RADIUS, 9);
    expect(radii[radii.length - 1]!).toBeGreaterThanOrEqual(MIN_CLUSTER_RADIUS);
  });

  test("a level where every child is the same size draws them the same", () => {
    const sites: Array<MapSiteView> = [0, 1, 2].map(
      (index: number): MapSiteView => {
        return mapSite({
          id: `r${index}`,
          latitude: 30 + index * 5,
          longitude: -100 + index * 5,
          totalUnits: 50,
          operationalUnits: 50,
        });
      },
    );
    const radii: Set<number> = new Set<number>(
      buildMapMarkers({ sites: sites, mode: "grouped", cellSize: 0 }).map(
        (marker: MapMarker): number => {
          return marker.screenRadius;
        },
      ),
    );
    expect(radii.size).toBe(1);
  });
});

/*
 * Paint order stopped being enough the moment two markers landed on the same
 * point. "The smaller one is painted last" only helps while there is some of
 * the bigger one left to see — and a market whose centroid is its parent's,
 * or six regions whose derived positions all average out over one city, draw
 * N markers in one place and show ONE. The others cannot be hovered, named
 * or clicked, and nothing on screen admits they are there.
 *
 * layoutMapMarkers is where that is fixed: it decides where each marker is
 * DRAWN, and SiteGeoMap threads a line from the ones that moved back to
 * where they really are. The geometry lives in Geo/MarkerLayout.ts (pinned
 * by MarkerLayout.test.ts); what is pinned here is the part that knows what
 * a MARKER is — how much room each shape needs, and that everything
 * downstream follows the drawn position rather than the projected one.
 */
describe("collisionRadiusOfMarker", () => {
  function marker(overrides: Partial<MapMarker> = {}): MapMarker {
    return {
      key: "m",
      x: 100,
      y: 100,
      ids: ["m"],
      count: 1,
      screenRadius: 10,
      colorKey: "ok",
      isContainer: false,
      isApproximate: false,
      label: "",
      tooltip: "",
      ...overrides,
    };
  }

  test("a single site needs exactly its own radius", () => {
    expect(collisionRadiusOfMarker(marker())).toBe(10);
  });

  /*
   * A container is a SQUARE. Keeping squares apart by their side length lets
   * two of them meet corner to corner, which is the one direction that looks
   * like a collision to a reader and like clearance to the math.
   */
  test("a container needs the circle that contains its square", () => {
    expect(collisionRadiusOfMarker(marker({ isContainer: true }))).toBeCloseTo(
      10 * CONTAINER_COLLISION_FACTOR,
      9,
    );
    expect(CONTAINER_COLLISION_FACTOR).toBeGreaterThan(1);
    // Which is exactly half the diagonal of the square that gets drawn.
    expect(CONTAINER_COLLISION_FACTOR).toBeCloseTo(
      (CONTAINER_SIDE_FACTOR / 2) * Math.SQRT2,
      9,
    );
  });

  test.each([
    ["NaN", Number.NaN],
    ["negative", -4],
    ["infinite", Infinity],
    ["zero", 0],
  ])(
    "a %s radius asks for no room rather than a broken layout",
    (_name: string, screenRadius: number) => {
      expect(collisionRadiusOfMarker(marker({ screenRadius }))).toBe(0);
      expect(
        collisionRadiusOfMarker(marker({ screenRadius, isContainer: true })),
      ).toBe(0);
    },
  );
});

describe("layoutMapMarkers", () => {
  function marker(
    key: string,
    x: number,
    y: number,
    overrides: Partial<MapMarker> = {},
  ): MapMarker {
    return {
      key: key,
      x: x,
      y: y,
      ids: [key],
      count: 4,
      screenRadius: MIN_CLUSTER_RADIUS,
      colorKey: "ok",
      isContainer: true,
      isApproximate: false,
      label: key,
      tooltip: `${key} tooltip`,
      ...overrides,
    };
  }

  // The square SiteGeoMap actually draws, in screen units.
  function squareOf(
    placed: PlacedMapMarker,
    zoom: number,
  ): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    const half: number = (placed.screenRadius * CONTAINER_SIDE_FACTOR) / 2;
    return {
      left: placed.x * zoom - half,
      right: placed.x * zoom + half,
      top: placed.y * zoom - half,
      bottom: placed.y * zoom + half,
    };
  }

  test("markers come back in paint order, with everything else intact", () => {
    const markers: Array<MapMarker> = [
      marker("first", 100, 100, { count: 90 }),
      marker("second", 400, 300, { count: 3, colorKey: "down" }),
    ];
    const placed: Array<PlacedMapMarker> = layoutMapMarkers(markers, 1);

    expect(
      placed.map((entry: PlacedMapMarker): string => {
        return entry.key;
      }),
    ).toEqual(["first", "second"]);
    expect(placed[0]!.count).toBe(90);
    expect(placed[1]!.colorKey).toBe("down");
    expect(placed[1]!.tooltip).toBe("second tooltip");
    expect(placed[1]!.ids).toEqual(["second"]);
  });

  test("a map with room on it is drawn exactly where the coordinates say", () => {
    const placed: Array<PlacedMapMarker> = layoutMapMarkers(
      [marker("a", 100, 100), marker("b", 500, 300)],
      1,
    );
    for (const entry of placed) {
      expect(entry.x).toBe(entry.anchorX);
      expect(entry.y).toBe(entry.anchorY);
      expect(entry.needsLeaderLine).toBe(false);
    }
  });

  test("an empty map lays out to nothing", () => {
    expect(layoutMapMarkers([], 1)).toEqual([]);
  });

  /*
   * The defect, end to end: two children of a level whose positions are the
   * same point. Before, one of them was simply invisible.
   */
  test("two markers on one point are drawn clear of each other", () => {
    const placed: Array<PlacedMapMarker> = layoutMapMarkers(
      [marker("alpha", 480, 250), marker("beta", 480, 250)],
      1,
    );

    const first: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    } = squareOf(placed[0]!, 1);
    const second: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    } = squareOf(placed[1]!, 1);

    const overlaps: boolean = !(
      first.right <= second.left ||
      first.left >= second.right ||
      first.bottom <= second.top ||
      first.top >= second.bottom
    );
    expect(overlaps).toBe(false);

    // Both keep a line home to the spot they share.
    for (const entry of placed) {
      expect(entry.needsLeaderLine).toBe(true);
      expect(entry.anchorX).toBe(480);
      expect(entry.anchorY).toBe(250);
    }
  });

  test("containers are given more room than single sites of the same size", () => {
    const gap: (isContainer: boolean) => number = (
      isContainer: boolean,
    ): number => {
      const placed: Array<PlacedMapMarker> = layoutMapMarkers(
        [
          marker("a", 480, 250, { isContainer }),
          marker("b", 480, 250, { isContainer }),
        ],
        1,
      );
      return Math.hypot(
        placed[0]!.x - placed[1]!.x,
        placed[0]!.y - placed[1]!.y,
      );
    };
    expect(gap(true)).toBeGreaterThan(gap(false));
    expect(gap(false)).toBeCloseTo(
      2 * MIN_CLUSTER_RADIUS + MARKER_CLEARANCE,
      2,
    );
  });

  /*
   * The whole point of laying out before drawing: everything the reader
   * touches — the name under the marker, the tooltip anchor, the site picker
   * — follows the marker they can SEE, not the coordinate underneath it.
   */
  test("names come back once the markers they belong to are pulled apart", () => {
    /*
     * Short names, so what is being measured is the marker positions rather
     * than how wide "Region 1000" is: a label reserves a box roughly its own
     * length, and six long names cannot fit around one point however well
     * the markers are spread.
     */
    const markers: Array<MapMarker> = ["A", "B", "C", "D", "E", "F"].map(
      (name: string): MapMarker => {
        return marker(name, 480, 250);
      },
    );

    const stacked: number = resolveMarkerLabels(markers, 1).size;
    const spread: number = resolveMarkerLabels(
      layoutMapMarkers(markers, 1),
      1,
    ).size;

    /*
     * Stacked, every name but the two that fit above and below has to be
     * dropped rather than printed on top of another one. Spread out, the
     * map can say what each marker is again.
     */
    expect(stacked).toBeLessThan(markers.length);
    expect(spread).toBeGreaterThan(stacked);
  });

  /*
   * Straight off the real builder, not hand-made markers: five sites a
   * customer pinned to the same coordinates.
   */
  test("a level whose children share one address draws all of them", () => {
    const sites: Array<MapSiteView> = [0, 1, 2, 3, 4].map(
      (index: number): MapSiteView => {
        return mapSite({
          id: `store-${index}`,
          name: `Store ${index}`,
          latitude: 41.88,
          longitude: -87.63,
          totalUnits: 10,
          operationalUnits: 10,
        });
      },
    );
    const placed: Array<PlacedMapMarker> = layoutMapMarkers(
      buildMapMarkers({ sites: sites, mode: "grouped", cellSize: 0 }),
      1,
    );

    expect(placed).toHaveLength(5);
    const tooClose: Array<string> = [];
    for (let i: number = 0; i < placed.length; i++) {
      for (let j: number = i + 1; j < placed.length; j++) {
        const distance: number = Math.hypot(
          placed[i]!.x - placed[j]!.x,
          placed[i]!.y - placed[j]!.y,
        );
        const required: number =
          collisionRadiusOfMarker(placed[i]!) +
          collisionRadiusOfMarker(placed[j]!) +
          MARKER_CLEARANCE;
        if (distance < required - 0.05) {
          tooClose.push(
            `${placed[i]!.key}/${placed[j]!.key}: ${distance.toFixed(2)}`,
          );
        }
      }
    }
    expect(tooClose).toEqual([]);

    // Every one of them still knows the address it was pinned to.
    for (const entry of placed) {
      expect(entry.anchorX).toBeCloseTo(placed[0]!.anchorX, 9);
      expect(entry.anchorY).toBeCloseTo(placed[0]!.anchorY, 9);
    }

    /*
     * And none of them is drawn off that address without saying so. A pile
     * this size usually settles as one marker still sitting on the spot with
     * the rest fanned around it — the one in the middle needs no line,
     * because it has not left.
     */
    const unexplained: Array<string> = placed
      .filter((entry: PlacedMapMarker): boolean => {
        const moved: number = Math.hypot(
          entry.x - entry.anchorX,
          entry.y - entry.anchorY,
        );
        return !entry.needsLeaderLine && moved > collisionRadiusOfMarker(entry);
      })
      .map((entry: PlacedMapMarker): string => {
        return entry.key;
      });
    expect(unexplained).toEqual([]);
    expect(
      placed.filter((entry: PlacedMapMarker): boolean => {
        return entry.needsLeaderLine;
      }).length,
    ).toBeGreaterThanOrEqual(placed.length - 1);
  });

  /*
   * Clusters in "all" mode overlap too — the cluster grid buckets by
   * proximity, and two neighbouring buckets can still draw discs that touch.
   */
  test("clustered markers are laid out as well as grouped ones", () => {
    const sites: Array<MapSiteView> = [];
    for (let index: number = 0; index < 8; index++) {
      sites.push(
        mapSite({
          id: `site-${index}`,
          latitude: 34.05 + index * 0.01,
          longitude: -118.24,
          isContainer: false,
          isOperational: true,
        }),
      );
    }
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: sites,
      mode: "all",
      cellSize: 0.2,
    });
    const placed: Array<PlacedMapMarker> = layoutMapMarkers(markers, 1);

    expect(placed).toHaveLength(markers.length);
    const tooClose: Array<string> = [];
    for (let i: number = 0; i < placed.length; i++) {
      for (let j: number = i + 1; j < placed.length; j++) {
        const distance: number = Math.hypot(
          placed[i]!.x - placed[j]!.x,
          placed[i]!.y - placed[j]!.y,
        );
        const required: number =
          placed[i]!.screenRadius + placed[j]!.screenRadius + MARKER_CLEARANCE;
        if (distance < required - 0.05) {
          tooClose.push(`${i}/${j}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });
});
