import { describe, expect, test } from "@jest/globals";
import {
  BuildPinsResult,
  CLUSTER_CELL_SIZE,
  DEFAULT_MAP_LINK_COLOR,
  DrawableMapLink,
  LinkableMarker,
  MAP_LINK_PARALLEL_OFFSET,
  buildMapLinks,
  describeMapLink,
  mapLinkColor,
  mapLinkPath,
  parallelLinkOffset,
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
  LABEL_DIRECTIONS,
  LABEL_PUSH_STEP,
  LabelBounds,
  LabelDirection,
  LabelPlacement,
  MAX_LABEL_PUSH,
  MapMarker,
  labelBounds,
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
  isUnitLevelFor,
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
import {
  MapLinkView,
  MapSiteView,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";
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

/*
 * The level's own depth, read off the children rather than off a name. This
 * is what decides whether the map draws the threads from a name to its
 * marker (issue #3372), so it has to be exactly "there is nothing below
 * this" and not "there is a unit somewhere in here".
 */
describe("isUnitLevelFor", () => {
  test("a level whose children are all units is the unit level", () => {
    expect(isUnitLevelFor([{ isUnitLevel: true }, { isUnitLevel: true }])).toBe(
      true,
    );
    expect(isUnitLevelFor([{ isUnitLevel: true }])).toBe(true);
  });

  test("a level of containers is not", () => {
    expect(
      isUnitLevelFor([{ isUnitLevel: false }, { isUnitLevel: false }]),
    ).toBe(false);
  });

  /*
   * The load-bearing case. A top level holding thirty regions and one stray
   * unit is still a level a reader drills DOWN from — and it is exactly the
   * crowded, aggregated map the threads make unreadable. One container is
   * enough to disqualify the whole level.
   */
  test("one container among the units disqualifies the level", () => {
    expect(
      isUnitLevelFor([
        { isUnitLevel: true },
        { isUnitLevel: true },
        { isUnitLevel: false },
      ]),
    ).toBe(false);
    // Whichever end of the list it sits at.
    expect(
      isUnitLevelFor([
        { isUnitLevel: false },
        { isUnitLevel: true },
        { isUnitLevel: true },
      ]),
    ).toBe(false);
  });

  /*
   * An empty level has no children to be units. Reading it as the unit level
   * would turn "this level has not loaded yet" into a claim about the
   * hierarchy — and the map has nothing to draw threads between anyway.
   */
  test("an empty level is not the unit level", () => {
    expect(isUnitLevelFor([])).toBe(false);
  });

  /*
   * Structural on purpose, like childTypeLabelFor: the page feeds it
   * SiteChildView rows and nothing else about them may matter. The flag is
   * the only input, never the type's name — a customer who renamed "Unit" to
   * "Restaurant" has not changed the shape of their hierarchy.
   */
  test("nothing but the flag is read", () => {
    /*
     * Rows carrying everything a SiteChildView carries. A type NAMED "Unit"
     * whose flag is false is a container, and a type named "Region" whose
     * flag is true is a unit: the name is the customer's, the flag is the
     * hierarchy's.
     */
    const namedLikeUnits: Array<{ isUnitLevel: boolean; siteType: string }> = [
      { isUnitLevel: true, siteType: "Region" },
      { isUnitLevel: true, siteType: "" },
    ];
    const namedLikeAContainer: Array<{
      isUnitLevel: boolean;
      siteType: string;
    }> = [{ isUnitLevel: false, siteType: "Unit" }];

    expect(isUnitLevelFor(namedLikeUnits)).toBe(true);
    expect(isUnitLevelFor(namedLikeAContainer)).toBe(false);
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

  /*
   * A name of nothing but spaces is not a name — but it is TRUTHY, so an
   * untrimmed one sails past every "does this marker have a label" guard,
   * takes a reserved box away from a marker with a real name, and draws
   * nothing in it.
   */
  test("a name of nothing but whitespace is no name at all", () => {
    expect(truncateMarkerLabel("   ")).toBe("");
    expect(truncateMarkerLabel("\t\n ")).toBe("");
  });

  test("surrounding whitespace does not count towards the length", () => {
    expect(truncateMarkerLabel("  Camden Store  ")).toBe("Camden Store");
  });
});

/*
 * A blank-named site used to steal the slot under its neighbour's marker.
 */
describe("a site with a blank name takes no label slot", () => {
  test("its neighbour keeps the position it wanted", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: [
        mapSite({ id: "blank", name: "   ", latitude: 51.5, longitude: -0.12 }),
        mapSite({
          id: "named",
          name: "Camden Store",
          latitude: 51.5,
          longitude: -0.12,
        }),
      ],
      mode: "grouped",
      cellSize: 0,
    });

    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      markers,
      1,
    );

    expect(placements.has("blank")).toBe(false);
    expect(placements.get("named")?.direction).toBe("below");
    expect(placements.get("named")?.push).toBe(0);
  });
});

/*
 * Names on the map are the whole point of the grouped view — "Region 1000"
 * belongs where the customer put it, not only in a tooltip. But three regions
 * whose centroids land in one corner of a state would print their names on
 * top of each other, which hides two of them AND makes the third unreadable.
 *
 * The hard case is a level of UNITS: a dozen of them in one retail park
 * arrive at near-identical coordinates, the marker layout fans the markers
 * apart but the names are boxes seventy screen units wide, and zooming in
 * never separates them because there is no distance between them to magnify.
 * Two positions per marker left ten of those twelve nameless; the spiral
 * below is what fixed it, and most of this suite is about keeping it fixed.
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

  // The boxes that were actually reserved, in the order they were placed.
  function boxesOf(
    markers: Array<MapMarker>,
    placements: Map<string, LabelPlacement>,
    zoom: number,
  ): Array<LabelBounds> {
    const boxes: Array<LabelBounds> = [];
    for (const marker of markers) {
      const placement: LabelPlacement | undefined = placements.get(marker.key);
      if (placement) {
        boxes.push(labelBounds(marker, zoom, placement));
      }
    }
    return boxes;
  }

  function overlaps(a: LabelBounds, b: LabelBounds): boolean {
    return !(
      a.right <= b.left ||
      a.left >= b.right ||
      a.bottom <= b.top ||
      a.top >= b.bottom
    );
  }

  function bodyOf(marker: MapMarker, zoom: number): LabelBounds {
    const half: number = marker.isContainer
      ? (marker.screenRadius * CONTAINER_SIDE_FACTOR) / 2
      : marker.screenRadius;
    return {
      left: marker.x * zoom - half,
      right: marker.x * zoom + half,
      top: marker.y * zoom - half,
      bottom: marker.y * zoom + half,
    };
  }

  test("well-separated markers all keep their names, below them", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100), markerAt("B", 300, 300)],
      1,
    );
    expect(placements.get("A")?.direction).toBe("below");
    expect(placements.get("B")?.direction).toBe("below");
  });

  /*
   * A name with room around it must not be nudged even slightly: the map
   * would redraw every label a hair off where the marker is on a map with
   * nothing colliding on it.
   */
  test("a name with room around it is not pushed at all", () => {
    const placement: LabelPlacement = resolveMarkerLabels(
      [markerAt("A", 100, 100)],
      1,
    ).get("A") as LabelPlacement;

    expect(placement.push).toBe(0);
    expect(placement.offsetX).toBe(0);
    expect(placement.textAnchor).toBe("middle");
    expect(placement.leaderLine).toBeNull();
  });

  test("a marker with no label is never placed", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100, { label: "" })],
      1,
    );
    expect(placements.has("A")).toBe(false);
  });

  /*
   * Below is tried first because the eye reads marker-then-name; above is the
   * first escape hatch, so a name only leaves the vertical axis when both
   * ends of it are taken.
   */
  test("a label blocked from below flips above rather than disappearing", () => {
    const blocker: MapMarker = markerAt("blocker", 100, 118, { label: "" });
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("A", 100, 100), blocker],
      1,
    );
    expect(placements.get("A")?.direction).toBe("above");
  });

  /*
   * The old behaviour: boxed in above and below, the name was DROPPED. That
   * is the defect from the Units view in miniature — there was plenty of room
   * either side and nothing looked there.
   */
  test("a label boxed in above and below goes sideways instead of vanishing", () => {
    const placement: LabelPlacement = resolveMarkerLabels(
      [
        markerAt("A", 100, 100),
        markerAt("above", 100, 82, { label: "" }),
        markerAt("below", 100, 118, { label: "" }),
      ],
      1,
    ).get("A") as LabelPlacement;

    expect(placement.direction).toBe("right");
    // Beside its marker, so it reads outwards from it.
    expect(placement.textAnchor).toBe("start");
    expect(placement.offsetX).toBeGreaterThan(0);
    expect(placement.offsetY).toBe(0);
    // Still against the marker, so nothing has to be explained.
    expect(placement.push).toBe(0);
    expect(placement.leaderLine).toBeNull();
  });

  test("a label boxed in on three sides takes the fourth", () => {
    const placement: LabelPlacement = resolveMarkerLabels(
      [
        markerAt("A", 100, 100),
        markerAt("above", 100, 82, { label: "" }),
        markerAt("below", 100, 118, { label: "" }),
        markerAt("right", 116, 100, { label: "" }),
      ],
      1,
    ).get("A") as LabelPlacement;

    expect(placement.direction).toBe("left");
    expect(placement.textAnchor).toBe("end");
    expect(placement.offsetX).toBeLessThan(0);
  });

  /*
   * Paint order is biggest-first, so the region a reader is most likely to be
   * looking for is the one that keeps the position closest to its marker.
   */
  test("when two names collide the first in paint order keeps the better spot", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [markerAt("Big", 100, 100), markerAt("Small", 118, 100)],
      1,
    );
    expect(placements.get("Big")?.direction).toBe("below");
    expect(placements.get("Small")?.direction).toBe("above");
  });

  test("an empty marker list resolves to no labels", () => {
    expect(resolveMarkerLabels([], 1).size).toBe(0);
  });

  /*
   * A marker with corrupt coordinates is drawn nowhere, so it has no body to
   * keep clear of and no place to hang a name. Treating it as a rectangle of
   * NaNs would be catastrophic rather than merely wrong: every comparison
   * against a NaN is false, so it would read as overlapping EVERY candidate
   * and cost every other marker on the level its name.
   */
  test("a marker with corrupt coordinates costs nobody else their name", () => {
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      [
        markerAt("broken", Number.NaN, 100),
        markerAt("alsoBroken", 100, Number.POSITIVE_INFINITY),
        markerAt("A", 100, 100),
        markerAt("B", 400, 400),
      ],
      1,
    );

    expect(placements.has("broken")).toBe(false);
    expect(placements.has("alsoBroken")).toBe(false);
    expect(placements.get("A")?.direction).toBe("below");
    expect(placements.get("B")?.direction).toBe("below");
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
    expect(short.get("A")?.direction).toBe("below");
    expect(short.get("B")?.direction).toBe("below");
    expect(long.get("A")?.direction).toBe("below");
    expect(long.get("B")?.direction).toBe("above");
  });

  /*
   * ── The defect in the issue ────────────────────────────────────────────
   *
   * A dozen units in one retail park, at coordinates a customer entered to
   * four decimal places — which is to say, at the same point. Ten of the
   * twelve used to go nameless at every zoom the map has.
   */
  describe("a pile of units on one point", () => {
    function pile(count: number, zoom: number): Array<PlacedMapMarker> {
      const units: Array<MapMarker> = Array.from(
        { length: count },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `WB Unit ${(316 + index)
            .toString()
            .padStart(4, "0")}`;
          return markerAt(name, 480, 250, {
            label: name,
            count: 1,
            isContainer: false,
            screenRadius: MIN_CLUSTER_RADIUS,
          });
        },
      );
      return layoutMapMarkers(units, zoom);
    }

    test("every one of a dozen coincident units keeps its name", () => {
      const markers: Array<PlacedMapMarker> = pile(12, MAX_ZOOM);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
      );
      expect(placements.size).toBe(12);
    });

    /*
     * Not only at the deepest zoom: the reporter's screenshot was taken
     * zoomed in, but the names have to survive the frame the map opens on
     * too. Nothing here depends on the zoom, which is the point — the
     * markers are laid out in screen units either way.
     */
    test.each([1, 4, 20, MAX_ZOOM])(
      "a dozen coincident units keep their names at zoom %s",
      (zoom: number) => {
        const markers: Array<PlacedMapMarker> = pile(12, zoom);
        expect(resolveMarkerLabels(markers, zoom).size).toBe(12);
      },
    );

    test("the names it draws never overlap each other", () => {
      const markers: Array<PlacedMapMarker> = pile(12, MAX_ZOOM);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
      );
      const boxes: Array<LabelBounds> = boxesOf(markers, placements, MAX_ZOOM);

      expect(boxes).toHaveLength(12);
      for (let a: number = 0; a < boxes.length; a++) {
        for (let b: number = a + 1; b < boxes.length; b++) {
          expect(overlaps(boxes[a]!, boxes[b]!)).toBe(false);
        }
      }
    });

    test("a name never lands on another unit's marker", () => {
      const markers: Array<PlacedMapMarker> = pile(12, MAX_ZOOM);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
      );

      for (const owner of markers) {
        const placement: LabelPlacement | undefined = placements.get(owner.key);
        if (!placement) {
          continue;
        }
        const box: LabelBounds = labelBounds(owner, MAX_ZOOM, placement);
        for (const other of markers) {
          if (other.key === owner.key) {
            continue;
          }
          expect(overlaps(box, bodyOf(other, MAX_ZOOM))).toBe(false);
        }
      }
    });

    /*
     * A name that had to leave its marker keeps a thread back to it — that
     * is the whole licence for moving it. A name still sitting against its
     * marker must NOT have one: a thread nobody can see is ink and a legend
     * entry for nothing.
     */
    test("exactly the pushed names carry a thread", () => {
      const markers: Array<PlacedMapMarker> = pile(12, MAX_ZOOM);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
      );

      let pushed: number = 0;
      for (const placement of placements.values()) {
        expect(placement.leaderLine === null).toBe(placement.push === 0);
        if (placement.push > 0) {
          pushed++;
        }
      }
      // A pile this tight cannot possibly seat twelve names unpushed.
      expect(pushed).toBeGreaterThan(0);
    });

    test("no name is pushed further than the map allows", () => {
      const markers: Array<PlacedMapMarker> = pile(24, MAX_ZOOM);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
      );

      for (const placement of placements.values()) {
        expect(placement.push).toBeLessThanOrEqual(MAX_LABEL_PUSH);
        expect(placement.push % LABEL_PUSH_STEP).toBe(0);
      }
    });

    /*
     * Two dozen is past anything the reporter had and still well inside the
     * label budget, so it has to work too.
     */
    test("two dozen coincident units all keep their names", () => {
      const markers: Array<PlacedMapMarker> = pile(24, MAX_ZOOM);
      expect(resolveMarkerLabels(markers, MAX_ZOOM).size).toBe(24);
    });

    test("the pile lays out the same way twice", () => {
      const markers: Array<PlacedMapMarker> = pile(12, MAX_ZOOM);
      expect(
        Array.from(resolveMarkerLabels(markers, MAX_ZOOM).entries()),
      ).toEqual(Array.from(resolveMarkerLabels(markers, MAX_ZOOM).entries()));
    });
  });

  /*
   * ── The thread ─────────────────────────────────────────────────────────
   */
  describe("the thread back to the marker", () => {
    function pushedPlacement(): {
      marker: MapMarker;
      placement: LabelPlacement;
    } {
      /*
       * Boxed in on all eight sides, so the only room left is further out.
       */
      const owner: MapMarker = markerAt("A", 500, 500, { label: "Name" });
      const blockers: Array<MapMarker> = [];
      for (let dx: number = -1; dx <= 1; dx++) {
        for (let dy: number = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          blockers.push(
            markerAt(`b${dx}${dy}`, 500 + dx * 22, 500 + dy * 22, {
              label: "",
            }),
          );
        }
      }
      const placement: LabelPlacement = resolveMarkerLabels(
        [owner, ...blockers],
        1,
      ).get("A") as LabelPlacement;
      return { marker: owner, placement: placement };
    }

    test("a boxed-in name is pushed out and threaded rather than dropped", () => {
      const { placement }: { placement: LabelPlacement } = pushedPlacement();
      expect(placement).toBeDefined();
      expect(placement.push).toBeGreaterThan(0);
      expect(placement.leaderLine).not.toBeNull();
    });

    test("the thread starts on the marker's edge, not at its centre", () => {
      const {
        marker,
        placement,
      }: { marker: MapMarker; placement: LabelPlacement } = pushedPlacement();
      const half: number = (marker.screenRadius * CONTAINER_SIDE_FACTOR) / 2;
      const start: number = Math.hypot(
        placement.leaderLine?.x1 as number,
        placement.leaderLine?.y1 as number,
      );
      /*
       * Exactly the marker's half-extent along the direction of the name: a
       * thread from the centre would print over the marker it belongs to.
       */
      expect(start).toBeCloseTo(half, 6);
    });

    test("the thread ends on the label's box, not inside the glyphs", () => {
      const {
        marker,
        placement,
      }: { marker: MapMarker; placement: LabelPlacement } = pushedPlacement();
      const box: LabelBounds = labelBounds(marker, 1, placement);
      const endX: number = marker.x + (placement.leaderLine?.x2 as number);
      const endY: number = marker.y + (placement.leaderLine?.y2 as number);

      // On the boundary of the box, to floating-point tolerance.
      const onEdge: boolean =
        Math.abs(endX - box.left) < 1e-6 ||
        Math.abs(endX - box.right) < 1e-6 ||
        Math.abs(endY - box.top) < 1e-6 ||
        Math.abs(endY - box.bottom) < 1e-6;
      expect(onEdge).toBe(true);
      expect(endX).toBeGreaterThanOrEqual(box.left - 1e-6);
      expect(endX).toBeLessThanOrEqual(box.right + 1e-6);
      expect(endY).toBeGreaterThanOrEqual(box.top - 1e-6);
      expect(endY).toBeLessThanOrEqual(box.bottom + 1e-6);
    });

    test("the thread is shorter than the marker could be pushed", () => {
      const { placement }: { placement: LabelPlacement } = pushedPlacement();
      const length: number = Math.hypot(
        (placement.leaderLine?.x2 as number) -
          (placement.leaderLine?.x1 as number),
        (placement.leaderLine?.y2 as number) -
          (placement.leaderLine?.y1 as number),
      );
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThanOrEqual(MAX_LABEL_PUSH);
    });

    /*
     * A thread that runs through a name points at the wrong thing. It is a
     * preference rather than a rule — a crossed thread still beats a missing
     * name — but on an ordinary pile-up nothing should have to cross.
     */
    test("threads in a pile do not run through the names already placed", () => {
      const units: Array<MapMarker> = Array.from(
        { length: 10 },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `Unit ${index}`;
          return markerAt(name, 480, 250, {
            label: name,
            count: 1,
            isContainer: false,
          });
        },
      );
      const markers: Array<PlacedMapMarker> = layoutMapMarkers(units, 8);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        8,
      );

      const boxes: Map<string, LabelBounds> = new Map<string, LabelBounds>();
      for (const marker of markers) {
        const placement: LabelPlacement | undefined = placements.get(
          marker.key,
        );
        if (placement) {
          boxes.set(marker.key, labelBounds(marker, 8, placement));
        }
      }

      for (const marker of markers) {
        const placement: LabelPlacement | undefined = placements.get(
          marker.key,
        );
        if (!placement?.leaderLine) {
          continue;
        }
        const fromX: number = marker.x * 8 + placement.leaderLine.x1;
        const fromY: number = marker.y * 8 + placement.leaderLine.y1;
        const toX: number = marker.x * 8 + placement.leaderLine.x2;
        const toY: number = marker.y * 8 + placement.leaderLine.y2;

        for (const [key, box] of boxes) {
          if (key === marker.key) {
            continue;
          }
          // Sampled along the thread — a crossing shows up at some point on it.
          for (let step: number = 1; step < 20; step++) {
            const at: number = step / 20;
            const x: number = fromX + (toX - fromX) * at;
            const y: number = fromY + (toY - fromY) * at;
            const inside: boolean =
              x > box.left && x < box.right && y > box.top && y < box.bottom;
            expect(inside).toBe(false);
          }
        }
      }
    });
  });

  /*
   * ── The eight positions ────────────────────────────────────────────────
   */
  describe("the positions a name can take", () => {
    test("there are eight of them, and no duplicates", () => {
      expect(LABEL_DIRECTIONS).toHaveLength(8);
      expect(new Set(LABEL_DIRECTIONS).size).toBe(8);
    });

    // Below reads best, so it is what an uncrowded map uses everywhere.
    test("below is tried first", () => {
      expect(LABEL_DIRECTIONS[0]).toBe("below");
    });

    /*
     * The anchor has to match the side the name is on, or a twenty-character
     * name set to the left of its marker would run back over it.
     */
    test.each<[LabelDirection, string, number]>([
      ["below", "middle", 0],
      ["above", "middle", 0],
      ["right", "start", 1],
      ["left", "end", -1],
      ["below-right", "start", 1],
      ["below-left", "end", -1],
      ["above-right", "start", 1],
      ["above-left", "end", -1],
    ])(
      "%s anchors %s and sits on the expected side",
      (direction: LabelDirection, anchor: string, horizontalSign: number) => {
        /*
         * Blank blockers on every side but the one under test, so the search
         * is forced into it. They are placed far enough out that they only
         * rule out the ring of positions against the marker.
         */
        const wanted: { x: number; y: number } = {
          x: direction.includes("right")
            ? 1
            : direction.includes("left")
              ? -1
              : 0,
          y: direction.startsWith("below")
            ? 1
            : direction.startsWith("above")
              ? -1
              : 0,
        };
        const owner: MapMarker = markerAt("A", 500, 500, { label: "Name" });
        const blockers: Array<MapMarker> = [];
        for (let dx: number = -1; dx <= 1; dx++) {
          for (let dy: number = -1; dy <= 1; dy++) {
            if (
              (dx === 0 && dy === 0) ||
              (dx === wanted.x && dy === wanted.y)
            ) {
              continue;
            }
            blockers.push(
              markerAt(`b${dx}${dy}`, 500 + dx * 26, 500 + dy * 20, {
                label: "",
              }),
            );
          }
        }

        const placement: LabelPlacement = resolveMarkerLabels(
          [owner, ...blockers],
          1,
        ).get("A") as LabelPlacement;

        expect(placement.textAnchor).toBe(anchor);
        expect(Math.sign(placement.offsetX)).toBe(horizontalSign);
      },
    );

    /*
     * One step out is one step out whichever way it goes. Adding the push to
     * both axes of a corner would make a diagonal step forty percent longer
     * than a straight one, and the spiral would stop being a spiral.
     */
    test("a step out is the same distance in every direction", () => {
      const marker: MapMarker = markerAt("A", 0, 0, { label: "Name" });
      const distances: Array<number> = LABEL_DIRECTIONS.map(
        (direction: LabelDirection): number => {
          const attached: LabelBounds = labelBounds(marker, 1, {
            direction: direction,
            push: 0,
            offsetX: 0,
            offsetY: 0,
            textAnchor: "middle",
            leaderLine: null,
          });
          const pushed: LabelBounds = labelBounds(marker, 1, {
            direction: direction,
            push: 40,
            offsetX: 0,
            offsetY: 0,
            textAnchor: "middle",
            leaderLine: null,
          });
          return Math.hypot(
            (pushed.left + pushed.right) / 2 -
              (attached.left + attached.right) / 2,
            (pushed.top + pushed.bottom) / 2 -
              (attached.top + attached.bottom) / 2,
          );
        },
      );
      for (const distance of distances) {
        expect(distance).toBeCloseTo(40, 6);
      }
    });
  });

  /*
   * ── What the renderers are handed ──────────────────────────────────────
   *
   * Both maps draw a name at marker + offset / zoom. If the offset did not
   * scale with the zoom, every name would drift off its marker the moment
   * anybody zoomed.
   */
  describe("the offsets handed to a renderer", () => {
    test("a name below its marker sits a marker-radius plus a gap under it", () => {
      const marker: MapMarker = markerAt("A", 100, 100, {
        isContainer: false,
        label: "Name",
      });
      const placement: LabelPlacement = resolveMarkerLabels([marker], 1).get(
        "A",
      ) as LabelPlacement;

      expect(placement.offsetY).toBeGreaterThan(marker.screenRadius);
      expect(placement.offsetY).toBeLessThan(marker.screenRadius + 20);
    });

    /*
     * The offsets are SCREEN units, and a marker's radius is too, so the same
     * name is the same distance from its marker in pixels at every zoom.
     */
    test("the offset is a screen distance, unchanged by the zoom", () => {
      const marker: MapMarker = markerAt("A", 100, 100, { label: "Name" });
      const at: (zoom: number) => LabelPlacement = (
        zoom: number,
      ): LabelPlacement => {
        return resolveMarkerLabels(
          [{ ...marker, x: 100 / zoom, y: 100 / zoom }],
          zoom,
        ).get("A") as LabelPlacement;
      };
      expect(at(1).offsetY).toBeCloseTo(at(32).offsetY, 6);
      expect(at(1).offsetX).toBeCloseTo(at(32).offsetX, 6);
    });

    /*
     * A container is a SQUARE of side CONTAINER_SIDE_FACTOR * r, so its name
     * clears the side rather than the circle around it — the same shape the
     * map draws and the same one the collision layout keeps clear.
     */
    test("a container's name clears the square, a site's name the disc", () => {
      const disc: LabelPlacement = resolveMarkerLabels(
        [markerAt("A", 100, 100, { isContainer: false, label: "Name" })],
        1,
      ).get("A") as LabelPlacement;
      const square: LabelPlacement = resolveMarkerLabels(
        [markerAt("A", 100, 100, { isContainer: true, label: "Name" })],
        1,
      ).get("A") as LabelPlacement;

      expect(square.offsetY).toBeCloseTo(
        (MIN_CLUSTER_RADIUS * CONTAINER_SIDE_FACTOR) / 2 +
          (disc.offsetY - MIN_CLUSTER_RADIUS),
        6,
      );
    });

    test("labelBounds gives back the box the placement was measured in", () => {
      const marker: MapMarker = markerAt("A", 100, 100, { label: "Name" });
      const placement: LabelPlacement = resolveMarkerLabels([marker], 1).get(
        "A",
      ) as LabelPlacement;
      const box: LabelBounds = labelBounds(marker, 1, placement);

      // The text's anchor point is inside the box that was reserved for it.
      expect(marker.x + placement.offsetX).toBeGreaterThanOrEqual(box.left);
      expect(marker.x + placement.offsetX).toBeLessThanOrEqual(box.right);
      expect(marker.y + placement.offsetY).toBeGreaterThan(box.top);
      expect(marker.y + placement.offsetY).toBeLessThan(box.bottom);
    });

    test("labelBounds survives a zoom that has not been measured yet", () => {
      const marker: MapMarker = markerAt("A", 100, 100, { label: "Name" });
      const placement: LabelPlacement = resolveMarkerLabels(
        [marker],
        Number.NaN,
      ).get("A") as LabelPlacement;

      expect(labelBounds(marker, Number.NaN, placement)).toEqual(
        labelBounds(marker, 1, placement),
      );
    });
  });

  /*
   * ── Names still come back as the frame tightens ────────────────────────
   */
  describe("zoom", () => {
    /*
     * Markers that ARE apart in the world separate as the frame tightens, so
     * their names walk back in against them and the threads go away. This is
     * the property that keeps the spiral from being a permanent scattering.
     */
    test("zooming in pulls names back against their markers", () => {
      const markers: Array<MapMarker> = Array.from(
        { length: 6 },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `Store ${index}`;
          return markerAt(name, 480 + index * 0.6, 250 + index * 0.4, {
            label: name,
            count: 1,
            isContainer: false,
          });
        },
      );

      const pushedAt: (zoom: number) => number = (zoom: number): number => {
        let pushed: number = 0;
        for (const placement of resolveMarkerLabels(markers, zoom).values()) {
          if (placement.push > 0) {
            pushed++;
          }
        }
        return pushed;
      };

      expect(pushedAt(1)).toBeGreaterThan(0);
      expect(pushedAt(MAX_ZOOM)).toBe(0);
    });

    test("zooming in never costs a name", () => {
      const markers: Array<MapMarker> = Array.from(
        { length: 8 },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `A Fairly Long Name ${index}`;
          return markerAt(name, 480 + index * 0.5, 250 + index * 0.5, {
            label: name,
            count: 1,
            isContainer: false,
          });
        },
      );

      const counts: Array<number> = [1, 2, 4, 8, 16, 32, MAX_ZOOM].map(
        (zoom: number): number => {
          return resolveMarkerLabels(markers, zoom).size;
        },
      );
      for (let index: number = 1; index < counts.length; index++) {
        expect(counts[index]!).toBeGreaterThanOrEqual(counts[index - 1]!);
      }
      expect(counts[counts.length - 1]).toBe(markers.length);
    });
  });

  /*
   * ── The last resort ────────────────────────────────────────────────────
   */
  describe("when there is genuinely nowhere to put a name", () => {
    /*
     * Dropping is still the answer once the spiral runs out: two names on top
     * of each other are worse than one name and a tooltip. It just takes a
     * far more crowded map to get there than it used to.
     */
    /*
     * A solid field of nameless markers around one that wants a name, wider
     * in every direction than the spiral can reach. The blank markers are
     * closer together than they are wide, so there is not one gap in it.
     */
    function walledIn(): Array<MapMarker> {
      const wall: Array<MapMarker> = [];
      for (let column: number = -19; column <= 19; column++) {
        for (let row: number = -19; row <= 19; row++) {
          if (column === 0 && row === 0) {
            continue;
          }
          wall.push(
            markerAt(`b${column}:${row}`, 500 + column * 12, 500 + row * 12, {
              label: "",
            }),
          );
        }
      }
      return wall;
    }

    test("a name with nowhere left to go is dropped, not stacked", () => {
      const owner: MapMarker = markerAt("A", 500, 500);

      expect(resolveMarkerLabels([owner, ...walledIn()], 1).has("A")).toBe(
        false,
      );
    });

    test("dropping one name does not cost the others theirs", () => {
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        [
          markerAt("far", 100, 100, { label: "Far Away" }),
          markerAt("A", 500, 500),
          ...walledIn(),
        ],
        1,
      );

      expect(placements.has("far")).toBe(true);
      expect(placements.has("A")).toBe(false);
    });
  });

  /*
   * A level of a thousand sites is laid out again on every wheel tick of a
   * zoom. The spiral must not turn that into a stutter.
   */
  test("a crowded level resolves without running away", () => {
    const units: Array<MapMarker> = Array.from(
      { length: MAX_LABELLED_MARKERS },
      (_unused: unknown, index: number): MapMarker => {
        const name: string = `Long Franchise Name ${index}`;
        return markerAt(name, 480, 250, {
          label: name,
          count: 1,
          isContainer: false,
        });
      },
    );
    const markers: Array<PlacedMapMarker> = layoutMapMarkers(units, MAX_ZOOM);

    const started: number = Date.now();
    const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
      markers,
      MAX_ZOOM,
    );
    /*
     * Generous by two orders of magnitude — this is a runaway detector, not a
     * benchmark, and a CI runner under load must not fail it.
     */
    expect(Date.now() - started).toBeLessThan(2000);
    expect(placements.size).toBeGreaterThan(0);
  });

  /*
   * The map hands this its markers including the ones with no name — the "all
   * sites" view is thousands of them — so the unnameable majority must not
   * cost anything.
   */
  test("markers with no name are skipped rather than searched for", () => {
    const markers: Array<MapMarker> = Array.from(
      { length: 2000 },
      (_unused: unknown, index: number): MapMarker => {
        return markerAt(`m${index}`, 480, 250, { label: "" });
      },
    );

    const started: number = Date.now();
    expect(resolveMarkerLabels(markers, 4).size).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  /*
   * ── Above the unit level: no threads, and no floating names ────────────
   *
   * Issue #3372. The push and the thread are one bargain, and it is only
   * worth making where the markers are units: a dozen of them in one retail
   * park, each thread pointing at one store. On the levels above, thirty
   * regions scattered over a continent produced thirty threads crossing each
   * other — a web nobody could trace a line back through.
   *
   * So the caller can refuse the bargain, and refusing it must take BOTH
   * halves: no thread, and no push either. A name pushed a hundred screen
   * units with no line explaining it is worse than the web — it is a name
   * hanging over somebody else's marker.
   */
  describe("when the caller allows no label threads", () => {
    const NO_THREADS: { allowLabelThreads: boolean } = {
      allowLabelThreads: false,
    };
    const THREADS: { allowLabelThreads: boolean } = {
      allowLabelThreads: true,
    };

    /*
     * The reporter's screenshot in miniature: an aggregated level, a few
     * dozen named markers, close enough together that most of the names
     * have nowhere to sit against their own marker.
     *
     * A golden-angle spiral rather than a grid, so the crowding is uneven
     * the way a real estate's is — and deterministic, because a layout that
     * depended on a clock or a random would make every assertion below a
     * coin toss.
     */
    function scatteredRegions(count: number): Array<MapMarker> {
      return Array.from(
        { length: count },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `Region ${1100 + index * 100}`;
          const angle: number = index * 2.399_963_23;
          const radius: number = 4 + index * 1.1;
          return markerAt(
            name,
            480 + Math.cos(angle) * radius,
            250 + Math.sin(angle) * radius,
            { label: name, count: 40 },
          );
        },
      );
    }

    // A name boxed in on all eight sides: the only room left is further out.
    function boxedIn(): Array<MapMarker> {
      const markers: Array<MapMarker> = [
        markerAt("A", 500, 500, { label: "Name" }),
      ];
      for (let dx: number = -1; dx <= 1; dx++) {
        for (let dy: number = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          markers.push(
            markerAt(`b${dx}${dy}`, 500 + dx * 22, 500 + dy * 22, {
              label: "",
            }),
          );
        }
      }
      return markers;
    }

    function threadCount(placements: Map<string, LabelPlacement>): number {
      let threaded: number = 0;
      for (const placement of placements.values()) {
        if (placement.leaderLine !== null) {
          threaded++;
        }
      }
      return threaded;
    }

    /*
     * The defect itself. Every one of these markers used to be able to hang
     * its name off a thread, and on this level that is the web.
     */
    test("not one name on an aggregated level carries a thread", () => {
      const markers: Array<MapMarker> = scatteredRegions(30);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        1,
        NO_THREADS,
      );

      expect(placements.size).toBeGreaterThan(0);
      for (const placement of placements.values()) {
        expect(placement.leaderLine).toBeNull();
        expect(placement.push).toBe(0);
      }
    });

    /*
     * And the control: the same markers, threads allowed, DO draw them. A
     * suppression test that would pass on a map with nothing to suppress is
     * not a test of anything.
     */
    test("the very same map draws a web of them when they are allowed", () => {
      const markers: Array<MapMarker> = scatteredRegions(30);

      expect(
        threadCount(resolveMarkerLabels(markers, 1, THREADS)),
      ).toBeGreaterThan(0);
      expect(threadCount(resolveMarkerLabels(markers, 1, NO_THREADS))).toBe(0);
    });

    /*
     * Both halves of the bargain. Suppressing only the LINE would leave the
     * name where the spiral put it — up to MAX_LABEL_PUSH away, with nothing
     * on screen joining it to anything. The name comes off instead, and the
     * hover tooltip still names the marker.
     */
    test("a name that would have to travel is dropped, not left floating", () => {
      const markers: Array<MapMarker> = boxedIn();

      const threaded: LabelPlacement = resolveMarkerLabels(
        markers,
        1,
        THREADS,
      ).get("A") as LabelPlacement;
      expect(threaded.push).toBeGreaterThan(0);
      expect(threaded.leaderLine).not.toBeNull();

      expect(resolveMarkerLabels(markers, 1, NO_THREADS).has("A")).toBe(false);
    });

    /*
     * Dropping one name is not licence to drop its neighbours': a marker
     * with room around it keeps its name on any level.
     */
    test("dropping the boxed-in name costs its neighbours nothing", () => {
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        [markerAt("far", 100, 100, { label: "Far Away" }), ...boxedIn()],
        1,
        NO_THREADS,
      );

      expect(placements.has("far")).toBe(true);
      expect(placements.get("far")?.push).toBe(0);
      expect(placements.has("A")).toBe(false);
    });

    /*
     * A map with room on it never reached past the first ring in the first
     * place, so turning the threads off must not move a single name on it —
     * the top level of a small estate looks exactly as it did.
     */
    test("a map with room on it is drawn identically either way", () => {
      const markers: Array<MapMarker> = [
        markerAt("A", 100, 100),
        markerAt("B", 300, 300),
        markerAt("C", 100, 300),
      ];

      expect(
        Array.from(resolveMarkerLabels(markers, 1, NO_THREADS).entries()),
      ).toEqual(Array.from(resolveMarkerLabels(markers, 1, THREADS).entries()));
    });

    /*
     * A CROWDED map is a different matter, and the contract has to say so.
     *
     * The pass is greedy over one shared set of reserved boxes, so a name
     * that is dropped also releases the box it would have taken. A later
     * marker then finds a position against its own marker that was occupied
     * before — so names move between the eight directions, and a name that
     * only fitted because a neighbour had been pushed out of its way can be
     * dropped in its turn. The result is NOT "the same map minus the names
     * that travelled", and a maintainer who believed it was would write a
     * subset assertion that fails on real data.
     *
     * Pinned on a level that reproduces every part of it, so the day the
     * geometry changes this reads as a contract to re-check rather than as
     * a mystery.
     */
    test("on a crowded level the two are not one minus the other", () => {
      const points: Array<[string, number, number]> = [
        ["Store 33-0", 453.02, 206.62],
        ["Store 33-1", 435.99, 237.46],
        ["Store 33-2", 432.17, 222.6],
        ["Store 33-7", 400.74, 212.82],
        ["Store 33-8", 440.74, 202.41],
        ["Store 33-11", 453.77, 204.43],
        ["Store 33-12", 428.03, 223.67],
      ];
      const markers: Array<MapMarker> = points.map(
        (point: [string, number, number]): MapMarker => {
          return markerAt(point[0], point[1], point[2], {
            count: 1,
            isContainer: false,
            screenRadius: MIN_CLUSTER_RADIUS,
          });
        },
      );

      const threaded: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        1,
        THREADS,
      );
      const bare: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        1,
        NO_THREADS,
      );

      // "Store 33-8" had to travel 96 units for a spot when threads were allowed.
      expect(threaded.get("Store 33-8")?.push).toBeGreaterThan(0);
      // Without them it fits hard against its marker instead — not dropped.
      expect(bare.get("Store 33-8")?.push).toBe(0);
      expect(bare.get("Store 33-8")?.leaderLine).toBeNull();

      /*
       * And the other direction: a name that needed no thread at all loses
       * its spot to that re-seating. This is the surprising half, and it is
       * why the contract is stated as a guarantee about what is DRAWN rather
       * than as a subset of what was drawn before.
       */
      expect(threaded.get("Store 33-11")?.push).toBe(0);
      expect(threaded.get("Store 33-11")?.leaderLine).toBeNull();
      expect(bare.has("Store 33-11")).toBe(false);

      // A name can also simply change sides.
      expect(threaded.get("Store 33-7")?.direction).toBe("left");
      expect(bare.get("Store 33-7")?.direction).toBe("above");
    });

    /*
     * What DOES hold, whatever the re-seating does: nothing is ever drawn
     * away from its marker. Swept over a range of crowding and zoom rather
     * than pinned to one level, because that is the promise the renderer
     * relies on — it draws no thread element at all for these placements.
     */
    test.each([
      [12, 1],
      [24, 1],
      [30, 2],
      [30, 8],
      [40, 4],
      [MAX_LABELLED_MARKERS, 16],
    ])(
      "%s markers at zoom %s: every name it keeps sits on its marker",
      (count: number, zoom: number) => {
        const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
          layoutMapMarkers(scatteredRegions(count), zoom),
          zoom,
          NO_THREADS,
        );

        expect(placements.size).toBeGreaterThan(0);
        for (const placement of placements.values()) {
          expect(placement.push).toBe(0);
          expect(placement.leaderLine).toBeNull();
        }
      },
    );

    /*
     * The collision guarantee is the reason this pass exists, and it is not
     * weakened by the option: what it does draw is still clear of every
     * other name and of every marker's body.
     */
    test("the names it does draw still land on nothing", () => {
      const markers: Array<MapMarker> = scatteredRegions(30);
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        1,
        NO_THREADS,
      );
      const boxes: Array<LabelBounds> = boxesOf(markers, placements, 1);

      expect(boxes.length).toBeGreaterThan(1);
      for (let a: number = 0; a < boxes.length; a++) {
        for (let b: number = a + 1; b < boxes.length; b++) {
          expect(overlaps(boxes[a]!, boxes[b]!)).toBe(false);
        }
      }

      for (const marker of markers) {
        const placement: LabelPlacement | undefined = placements.get(
          marker.key,
        );
        if (!placement) {
          continue;
        }
        const box: LabelBounds = labelBounds(marker, 1, placement);
        for (const other of markers) {
          if (other.key === marker.key) {
            continue;
          }
          expect(overlaps(box, bodyOf(other, 1))).toBe(false);
        }
      }
    });

    /*
     * Same reason the threaded pass is pinned deterministic: the page hands
     * the map a brand-new array every sixty seconds, and a level that
     * re-decided its names on every poll would flicker.
     */
    test("it lays the level out the same way twice", () => {
      const markers: Array<MapMarker> = scatteredRegions(24);

      expect(
        Array.from(resolveMarkerLabels(markers, 3, NO_THREADS).entries()),
      ).toEqual(
        Array.from(resolveMarkerLabels(markers, 3, NO_THREADS).entries()),
      );
    });

    /*
     * The dashboard widget calls this with no options at all and must keep
     * its threads — every name it draws already stands for one single site.
     */
    test("omitting the options leaves the threads on", () => {
      const markers: Array<MapMarker> = scatteredRegions(30);

      expect(Array.from(resolveMarkerLabels(markers, 1).entries())).toEqual(
        Array.from(resolveMarkerLabels(markers, 1, THREADS).entries()),
      );
      expect(threadCount(resolveMarkerLabels(markers, 1))).toBeGreaterThan(0);
    });

    /*
     * Zoom does the same work the threads did: markers that are apart in the
     * world separate as the frame tightens, their names walk back in against
     * them, and the two settings converge on the same picture. The option
     * costs a name only while the map is genuinely crowded.
     */
    test("zooming in until nothing has to travel makes the two agree", () => {
      const markers: Array<MapMarker> = Array.from(
        { length: 6 },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `Store ${index}`;
          return markerAt(name, 480 + index * 0.6, 250 + index * 0.4, {
            label: name,
            count: 1,
            isContainer: false,
          });
        },
      );

      // Crowded: the two disagree, and only the threaded one draws lines.
      expect(
        threadCount(resolveMarkerLabels(markers, 1, THREADS)),
      ).toBeGreaterThan(0);
      expect(
        Array.from(resolveMarkerLabels(markers, 1, NO_THREADS).entries()),
      ).not.toEqual(
        Array.from(resolveMarkerLabels(markers, 1, THREADS).entries()),
      );

      // Zoomed in: nothing needs to travel, so nothing is lost by refusing.
      expect(
        Array.from(
          resolveMarkerLabels(markers, MAX_ZOOM, NO_THREADS).entries(),
        ),
      ).toEqual(
        Array.from(resolveMarkerLabels(markers, MAX_ZOOM, THREADS).entries()),
      );
      expect(resolveMarkerLabels(markers, MAX_ZOOM, NO_THREADS).size).toBe(
        markers.length,
      );
    });

    /*
     * The earlier fix must survive this one. A pile of units in one retail
     * park is the case the threads were added for, and the unit level still
     * asks for them — every one of the twelve keeps its name.
     */
    test("the unit level still threads a pile of coincident units", () => {
      const units: Array<MapMarker> = Array.from(
        { length: 12 },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `WB Unit ${(316 + index)
            .toString()
            .padStart(4, "0")}`;
          return markerAt(name, 480, 250, {
            label: name,
            count: 1,
            isContainer: false,
            screenRadius: MIN_CLUSTER_RADIUS,
          });
        },
      );
      const markers: Array<PlacedMapMarker> = layoutMapMarkers(units, MAX_ZOOM);

      const threaded: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
        THREADS,
      );
      expect(threaded.size).toBe(12);
      expect(threadCount(threaded)).toBeGreaterThan(0);

      /*
       * And the same pile above the unit level would lose most of them —
       * which is exactly why the flag is the level's, not the marker's.
       */
      const bare: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
        NO_THREADS,
      );
      expect(threadCount(bare)).toBe(0);
      expect(bare.size).toBeLessThan(threaded.size);
    });

    /*
     * The spiral is where this pass spends its time, and clamping it to one
     * ring can only make it cheaper — but the level is laid out again on
     * every wheel tick of a zoom, so pin it rather than assume it.
     */
    test("a crowded level resolves without running away", () => {
      const units: Array<MapMarker> = Array.from(
        { length: MAX_LABELLED_MARKERS },
        (_unused: unknown, index: number): MapMarker => {
          const name: string = `Long Franchise Name ${index}`;
          return markerAt(name, 480, 250, {
            label: name,
            count: 1,
            isContainer: false,
          });
        },
      );
      const markers: Array<PlacedMapMarker> = layoutMapMarkers(units, MAX_ZOOM);

      const started: number = Date.now();
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        markers,
        MAX_ZOOM,
        NO_THREADS,
      );
      expect(Date.now() - started).toBeLessThan(2000);
      for (const placement of placements.values()) {
        expect(placement.push).toBe(0);
        expect(placement.leaderLine).toBeNull();
      }
    });

    /*
     * The degenerate inputs the threaded pass already survives have to
     * survive the option too — a map that has not been measured yet reports
     * a zero or a NaN for a frame or two.
     */
    test("a non-finite zoom and an empty level are still handled", () => {
      const markers: Array<MapMarker> = [
        markerAt("A", 100, 100),
        markerAt("B", 400, 400),
      ];

      expect(resolveMarkerLabels([], 1, NO_THREADS).size).toBe(0);
      expect(resolveMarkerLabels(markers, Number.NaN, NO_THREADS).size).toBe(2);
      expect(resolveMarkerLabels(markers, 0, NO_THREADS).size).toBe(2);
      expect(resolveMarkerLabels(markers, -3, NO_THREADS).size).toBe(2);
    });

    /*
     * A marker drawn nowhere has no body to keep clear of and no place to
     * hang a name, on any level.
     */
    test("a marker with corrupt coordinates costs nobody else their name", () => {
      const placements: Map<string, LabelPlacement> = resolveMarkerLabels(
        [
          markerAt("broken", Number.NaN, 100),
          markerAt("A", 100, 100),
          markerAt("B", 400, 400),
        ],
        1,
        NO_THREADS,
      );

      expect(placements.has("broken")).toBe(false);
      expect(placements.get("A")?.direction).toBe("below");
      expect(placements.get("B")?.direction).toBe("below");
    });
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
  test("names sit against their markers once those are pulled apart", () => {
    const markers: Array<MapMarker> = ["A", "B", "C", "D", "E", "F"].map(
      (name: string): MapMarker => {
        return marker(name, 480, 250, { label: `Region ${name}00` });
      },
    );

    // How far, in total, the names had to be pushed off their markers.
    const totalPush: (of: Array<MapMarker>) => number = (
      of: Array<MapMarker>,
    ): number => {
      let total: number = 0;
      for (const placement of resolveMarkerLabels(of, 1).values()) {
        total += placement.push;
      }
      return total;
    };

    /*
     * Every name survives either way — the placement spiral sees to that.
     * The difference the layout makes is that the names no longer have to be
     * flung as far to find room: six markers stacked on one point leave
     * nowhere near their own coordinates for six names to sit.
     */
    expect(resolveMarkerLabels(markers, 1).size).toBe(markers.length);
    expect(resolveMarkerLabels(layoutMapMarkers(markers, 1), 1).size).toBe(
      markers.length,
    );
    expect(totalPush(layoutMapMarkers(markers, 1))).toBeLessThan(
      totalPush(markers),
    );
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

/*
 * ── Link lines ─────────────────────────────────────────────────────────
 *
 * A map of where the sites are is only half a network; the other half is
 * what is connected to what. These pin the rules that decide which links
 * become lines, and where those lines go.
 *
 * The load-bearing one is a negative: a link with NO monitor attached is
 * still drawn. The monitor decides the line's COLOR — never whether the
 * connection exists — so every "is it drawn" assertion below has an
 * unmonitored twin.
 */

function linkRow(
  overrides: Partial<MapLinkView> & { id: string },
): MapLinkView {
  return {
    name: `Link ${overrides.id}`,
    fromSiteId: "a",
    toSiteId: "b",
    monitorStatus: undefined,
    ...overrides,
  };
}

function linkMarker(
  key: string,
  x: number,
  y: number,
  ids: Array<string> = [key],
): LinkableMarker {
  return { key: key, x: x, y: y, ids: ids };
}

// Where a quadratic Bezier actually is, halfway along.
function quadraticMidpoint(link: DrawableMapLink): { x: number; y: number } {
  return {
    x: 0.25 * link.x1 + 0.5 * link.controlX + 0.25 * link.x2,
    y: 0.25 * link.y1 + 0.5 * link.controlY + 0.25 * link.y2,
  };
}

describe("parallelLinkOffset", () => {
  /*
   * One link between two sites is the overwhelmingly common case, and
   * bowing it would be decoration on the thing the map is actually for.
   */
  test("the first link between a pair is straight", () => {
    expect(parallelLinkOffset(0)).toBe(0);
  });

  test("the rest alternate sides in widening steps", () => {
    expect(parallelLinkOffset(1)).toBe(MAP_LINK_PARALLEL_OFFSET);
    expect(parallelLinkOffset(2)).toBe(-MAP_LINK_PARALLEL_OFFSET);
    expect(parallelLinkOffset(3)).toBe(2 * MAP_LINK_PARALLEL_OFFSET);
    expect(parallelLinkOffset(4)).toBe(-2 * MAP_LINK_PARALLEL_OFFSET);
    expect(parallelLinkOffset(5)).toBe(3 * MAP_LINK_PARALLEL_OFFSET);
  });

  test("a bundle stays symmetric about the line it belongs to", () => {
    for (let index: number = 1; index < 12; index += 2) {
      expect(parallelLinkOffset(index)).toBe(-parallelLinkOffset(index + 1));
    }
  });

  test.each([
    ["NaN", Number.NaN],
    ["negative", -3],
    ["infinite", Infinity],
  ])(
    "a %s index draws straight rather than off the map",
    (_name: string, index: number) => {
      expect(parallelLinkOffset(index)).toBe(0);
    },
  );
});

describe("mapLinkColor", () => {
  test("a monitored link takes the color of its status", () => {
    expect(
      mapLinkColor({
        monitorStatus: { color: "#ef4444" },
      }),
    ).toBe("#ef4444");
  });

  /*
   * The requirement, stated as a color: no monitor is not no line. It is a
   * line in the neutral.
   */
  test("a link with no monitor is drawn in the neutral", () => {
    expect(mapLinkColor({ monitorStatus: undefined })).toBe(
      DEFAULT_MAP_LINK_COLOR,
    );
    expect(mapLinkColor({})).toBe(DEFAULT_MAP_LINK_COLOR);
  });

  // A status row whose color was never set must not paint a line "undefined".
  test("a status with no color of its own falls back to the neutral", () => {
    expect(mapLinkColor({ monitorStatus: { color: undefined } })).toBe(
      DEFAULT_MAP_LINK_COLOR,
    );
  });
});

describe("describeMapLink", () => {
  test("a monitored link says what its monitor says", () => {
    expect(
      describeMapLink({
        name: "DC1 to Midwest WAN",
        monitorStatus: { name: "Degraded" },
      }),
    ).toBe("DC1 to Midwest WAN — Degraded");
  });

  /*
   * "No monitor attached" rather than "No status": the line is grey because
   * nothing is watching it, which is a different fact — and a fixable one —
   * from a monitor that has not reported yet.
   */
  test("an unmonitored link says so instead of implying a problem", () => {
    expect(describeMapLink({ name: "Dark fibre" })).toBe(
      "Dark fibre — No monitor attached",
    );
  });

  test("a nameless link still reads as a link", () => {
    expect(describeMapLink({ name: "" })).toBe(
      "Unnamed link — No monitor attached",
    );
  });
});

describe("buildMapLinks", () => {
  test("draws a straight line between the two markers", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1", fromSiteId: "a", toSiteId: "b" })],
      markers: [linkMarker("a", 100, 100), linkMarker("b", 300, 200)],
      zoom: 1,
    });

    expect(lines).toHaveLength(1);
    const line: DrawableMapLink = lines[0]!;
    expect([line.x1, line.y1, line.x2, line.y2]).toEqual([100, 100, 300, 200]);
    // No bow: the control point is the midpoint, so the path is a segment.
    expect(line.controlX).toBe(200);
    expect(line.controlY).toBe(150);
    expect(line.midX).toBe(200);
    expect(line.midY).toBe(150);
    expect(mapLinkPath(line)).toBe("M 100 100 Q 200 150 300 200");
  });

  /*
   * THE requirement. A link nobody has pointed a monitor at is still part
   * of the network, so it is still a line — neutral, dashed, and honest
   * about why.
   */
  test("a link with no monitor is drawn, in the neutral, marked unmonitored", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1", name: "Dark fibre" })],
      markers: [linkMarker("a", 0, 0), linkMarker("b", 50, 0)],
      zoom: 1,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.hasMonitor).toBe(false);
    expect(lines[0]!.color).toBe(DEFAULT_MAP_LINK_COLOR);
    expect(lines[0]!.tooltip).toBe("Dark fibre — No monitor attached");
  });

  test("a monitored link is drawn in its status color and marked monitored", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [
        linkRow({
          id: "l1",
          name: "DC1 to DC2",
          monitorStatus: { name: "Offline", color: "#ef4444", priority: 5 },
        }),
      ],
      markers: [linkMarker("a", 0, 0), linkMarker("b", 50, 0)],
      zoom: 1,
    });

    expect(lines[0]!.hasMonitor).toBe(true);
    expect(lines[0]!.color).toBe("#ef4444");
    expect(lines[0]!.tooltip).toBe("DC1 to DC2 — Offline");
  });

  /*
   * Lines follow the markers a reader can SEE. layoutMapMarkers pushes
   * markers off each other and leaves an anchor behind; a line drawn to the
   * anchor would end in empty space next to the marker it names.
   */
  test("ends land on the drawn positions, not the projected ones", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1" })],
      markers: [
        { key: "a", ids: ["a"], x: 120, y: 90 },
        { key: "b", ids: ["b"], x: 300, y: 90 },
      ],
      zoom: 1,
    });
    expect([lines[0]!.x1, lines[0]!.y1]).toEqual([120, 90]);
    expect([lines[0]!.x2, lines[0]!.y2]).toEqual([300, 90]);
  });

  test("a link with an end that has no marker is not drawn", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [
        linkRow({ id: "l1", fromSiteId: "a", toSiteId: "elsewhere" }),
        linkRow({ id: "l2", fromSiteId: "nowhere", toSiteId: "b" }),
        linkRow({ id: "l3", fromSiteId: "a", toSiteId: "b" }),
      ],
      markers: [linkMarker("a", 0, 0), linkMarker("b", 50, 0)],
      zoom: 1,
    });
    expect(
      lines.map((line: DrawableMapLink): string => {
        return line.id;
      }),
    ).toEqual(["l3"]);
  });

  /*
   * In "all" mode a marker speaks for every site clustered into it, which
   * is what lets a link between two clustered sites still be drawn between
   * their clusters — and what makes a link INSIDE one cluster undrawable.
   */
  test("ends resolve through clustered markers", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1", fromSiteId: "s2", toSiteId: "s4" })],
      markers: [
        linkMarker("west", 10, 10, ["s1", "s2"]),
        linkMarker("east", 90, 10, ["s3", "s4"]),
      ],
      zoom: 1,
    });
    expect(lines).toHaveLength(1);
    expect([lines[0]!.x1, lines[0]!.x2]).toEqual([10, 90]);
  });

  test("a link whose ends share one marker is a dot, so it is dropped", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [
        linkRow({ id: "l1", fromSiteId: "s1", toSiteId: "s2" }),
        linkRow({ id: "l2", fromSiteId: "s1", toSiteId: "s1" }),
      ],
      markers: [linkMarker("west", 10, 10, ["s1", "s2"])],
      zoom: 1,
    });
    expect(lines).toEqual([]);
  });

  describe("parallel links between the same pair", () => {
    const markers: Array<LinkableMarker> = [
      linkMarker("a", 0, 0),
      linkMarker("b", 200, 0),
    ];

    test("the first is straight and the rest bow to alternating sides", () => {
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: [
          linkRow({ id: "l1" }),
          linkRow({ id: "l2" }),
          linkRow({ id: "l3" }),
        ],
        markers: markers,
        zoom: 1,
      });

      expect(lines).toHaveLength(3);
      // Horizontal segment, so the bow shows up entirely in y.
      expect(lines[0]!.midY).toBe(0);
      expect(lines[1]!.midY).toBe(MAP_LINK_PARALLEL_OFFSET);
      expect(lines[2]!.midY).toBe(-MAP_LINK_PARALLEL_OFFSET);
      for (const line of lines) {
        expect(line.midX).toBe(100);
      }
    });

    /*
     * A→B and B→A are the same pair of markers. Bundling them separately
     * would draw the second link straight, right on top of the first.
     */
    test("direction does not split a bundle in two", () => {
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: [
          linkRow({ id: "l1", fromSiteId: "a", toSiteId: "b" }),
          linkRow({ id: "l2", fromSiteId: "b", toSiteId: "a" }),
        ],
        markers: markers,
        zoom: 1,
      });
      expect(lines[0]!.midY).toBe(0);
      expect(Math.abs(lines[1]!.midY)).toBe(MAP_LINK_PARALLEL_OFFSET);
    });

    // Different pairs each start their own bundle, straight.
    test("a different pair starts over", () => {
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: [
          linkRow({ id: "l1", fromSiteId: "a", toSiteId: "b" }),
          linkRow({ id: "l2", fromSiteId: "a", toSiteId: "c" }),
        ],
        markers: [...markers, linkMarker("c", 0, 200)],
        zoom: 1,
      });
      expect(lines[0]!.midY).toBe(0);
      expect(lines[1]!.midX).toBe(0);
      expect(lines[1]!.midY).toBe(100);
    });
  });

  test("the bow is perpendicular to the line it belongs to", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1" }), linkRow({ id: "l2" })],
      markers: [linkMarker("a", 0, 0), linkMarker("b", 100, 100)],
      zoom: 1,
    });

    const bowed: DrawableMapLink = lines[1]!;
    const alongX: number = bowed.x2 - bowed.x1;
    const alongY: number = bowed.y2 - bowed.y1;
    const bowX: number = bowed.midX - (bowed.x1 + bowed.x2) / 2;
    const bowY: number = bowed.midY - (bowed.y1 + bowed.y2) / 2;

    expect(alongX * bowX + alongY * bowY).toBeCloseTo(0, 9);
    expect(Math.hypot(bowX, bowY)).toBeCloseTo(MAP_LINK_PARALLEL_OFFSET, 9);
  });

  /*
   * midX/midY anchor the hover label, so they have to be where the curve
   * actually is — not where the control point is, which is twice as far out.
   */
  test("the reported middle is where the drawn curve passes", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1" }), linkRow({ id: "l2" })],
      markers: [linkMarker("a", 20, 40), linkMarker("b", 260, 130)],
      zoom: 1,
    });

    for (const line of lines) {
      const middle: { x: number; y: number } = quadraticMidpoint(line);
      expect(line.midX).toBeCloseTo(middle.x, 9);
      expect(line.midY).toBeCloseTo(middle.y, 9);
    }
  });

  /*
   * The bow is a SCREEN distance, like every other piece of map furniture:
   * zooming in must not inflate the gap between two parallel links until it
   * reads as two different routes.
   */
  test("the bow stays the same size on screen at every zoom", () => {
    const links: Array<MapLinkView> = [
      linkRow({ id: "l1" }),
      linkRow({ id: "l2" }),
    ];
    const markers: Array<LinkableMarker> = [
      linkMarker("a", 0, 0),
      linkMarker("b", 200, 0),
    ];

    const atZoomOne: Array<DrawableMapLink> = buildMapLinks({
      links,
      markers,
      zoom: 1,
    });
    const atZoomFour: Array<DrawableMapLink> = buildMapLinks({
      links,
      markers,
      zoom: 4,
    });

    expect(atZoomFour[1]!.midY).toBeCloseTo(atZoomOne[1]!.midY / 4, 9);
    expect(atZoomFour[1]!.midY * 4).toBeCloseTo(MAP_LINK_PARALLEL_OFFSET, 9);
  });

  test.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -2],
    ["infinite", Infinity],
  ])(
    "a %s zoom falls back to 1 rather than producing NaN geometry",
    (_name: string, zoom: number) => {
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: [linkRow({ id: "l1" }), linkRow({ id: "l2" })],
        markers: [linkMarker("a", 0, 0), linkMarker("b", 200, 0)],
        zoom: zoom,
      });
      for (const line of lines) {
        for (const value of [
          line.x1,
          line.y1,
          line.x2,
          line.y2,
          line.controlX,
          line.controlY,
          line.midX,
          line.midY,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
      expect(lines[1]!.midY).toBe(MAP_LINK_PARALLEL_OFFSET);
    },
  );

  // Two markers on the same point have no direction to be perpendicular to.
  test("markers on the same point still produce finite geometry", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1" }), linkRow({ id: "l2" })],
      markers: [linkMarker("a", 40, 40), linkMarker("b", 40, 40)],
      zoom: 1,
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Number.isFinite(line.midX)).toBe(true);
      expect(Number.isFinite(line.midY)).toBe(true);
    }
    // And the bundle is still separated rather than stacked.
    expect(lines[0]!.midY).not.toBe(lines[1]!.midY);
  });

  test("drawing order is payload order, and the inputs are left alone", () => {
    const links: Array<MapLinkView> = [
      linkRow({ id: "l3" }),
      linkRow({ id: "l1" }),
      linkRow({ id: "l2" }),
    ];
    const markers: Array<LinkableMarker> = [
      linkMarker("a", 0, 0),
      linkMarker("b", 200, 0),
    ];
    const before: string = JSON.stringify({ links, markers });

    const lines: Array<DrawableMapLink> = buildMapLinks({
      links,
      markers,
      zoom: 1,
    });

    expect(
      lines.map((line: DrawableMapLink): string => {
        return line.key;
      }),
    ).toEqual(["l3", "l1", "l2"]);
    expect(JSON.stringify({ links, markers })).toBe(before);
  });

  test("no links, no markers, nothing to draw", () => {
    expect(buildMapLinks({ links: [], markers: [], zoom: 1 })).toEqual([]);
    expect(
      buildMapLinks({
        links: [linkRow({ id: "l1" })],
        markers: [],
        zoom: 1,
      }),
    ).toEqual([]);
  });
});

describe("mapLinkPath", () => {
  test("a quadratic through the control point", () => {
    const lines: Array<DrawableMapLink> = buildMapLinks({
      links: [linkRow({ id: "l1" }), linkRow({ id: "l2" })],
      markers: [linkMarker("a", 0, 0), linkMarker("b", 100, 0)],
      zoom: 1,
    });
    expect(mapLinkPath(lines[0]!)).toBe("M 0 0 Q 50 0 100 0");
    expect(mapLinkPath(lines[1]!)).toBe(
      `M 0 0 Q 50 ${2 * MAP_LINK_PARALLEL_OFFSET} 100 0`,
    );
  });
});

/*
 * Regression: "site links only visible when zoomed out, disappear when
 * zoomed in" (issue #3025).
 *
 * What that customer was seeing was never a link. The map drew no links at
 * all; the lines in their zoomed-out screenshot are the LEADER THREADS that
 * markers keep to their real spot when they have been nudged apart — and
 * those correctly melt away as zoom separates the markers, taking the only
 * lines on the map with them.
 *
 * So the fix is that the map draws real links, and these pin the property
 * that makes it a fix: which links are drawn is a question about the
 * MARKERS, never about the zoom. Zoom may change how far a bundle bows
 * apart; it may never change what is on the map.
 */
describe("link lines survive every zoom level", () => {
  const ZOOMS: Array<number> = [1, 2, 4, 8, 16, 32, 64];

  function linkedSites(): Array<MapSiteView> {
    return [
      mapSite({
        id: "cardac",
        name: "CARDAC Datacenter",
        latitude: 39.1,
        longitude: -94.58,
        isContainer: false,
        isOperational: true,
      }),
      mapSite({
        id: "corporate",
        name: "Corporate Units",
        latitude: 39.4,
        longitude: -94.2,
        totalUnits: 1014,
        operationalUnits: 0,
        childSiteCount: 1014,
      }),
      mapSite({
        id: "franchise",
        name: "Franchise Units",
        latitude: 39.6,
        longitude: -93.9,
        totalUnits: 259,
        operationalUnits: 0,
        childSiteCount: 259,
      }),
    ];
  }

  const links: Array<MapLinkView> = [
    linkRow({ id: "l1", fromSiteId: "cardac", toSiteId: "corporate" }),
    linkRow({
      id: "l2",
      fromSiteId: "corporate",
      toSiteId: "franchise",
      monitorStatus: { name: "Operational", color: "#10b981", priority: 1 },
    }),
  ];

  /*
   * The whole point, end to end: markers laid out at each zoom (nudged apart
   * when they collide, left alone once they do not), links built from those
   * markers, and the same two lines on the map every time.
   */
  test("the same links are drawn at every zoom", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: linkedSites(),
      mode: "grouped",
      cellSize: 0,
    });

    for (const zoom of ZOOMS) {
      const placed: Array<PlacedMapMarker> = layoutMapMarkers(markers, zoom);
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: links,
        markers: placed,
        zoom: zoom,
      });
      expect(
        lines.map((line: DrawableMapLink): string => {
          return line.id;
        }),
      ).toEqual(["l1", "l2"]);
    }
  });

  /*
   * At low zoom these markers overlap and get pushed apart — the state the
   * customer's screenshot was taken in. The lines have to follow them
   * there, not stay behind at the projected positions.
   */
  test("lines follow the markers whether or not they were nudged apart", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: linkedSites(),
      mode: "grouped",
      cellSize: 0,
    });

    const nudged: Array<PlacedMapMarker> = layoutMapMarkers(markers, 1);
    expect(
      nudged.some((marker: PlacedMapMarker): boolean => {
        return marker.needsLeaderLine;
      }),
    ).toBe(true);

    const roomy: Array<PlacedMapMarker> = layoutMapMarkers(markers, 64);
    expect(
      roomy.every((marker: PlacedMapMarker): boolean => {
        return !marker.needsLeaderLine;
      }),
    ).toBe(true);

    for (const placed of [nudged, roomy]) {
      const byKey: Map<string, PlacedMapMarker> = new Map<
        string,
        PlacedMapMarker
      >(
        placed.map((marker: PlacedMapMarker): [string, PlacedMapMarker] => {
          return [marker.key, marker];
        }),
      );
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: [links[0]!],
        markers: placed,
        zoom: placed === nudged ? 1 : 64,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]!.x1).toBe(byKey.get("cardac")!.x);
      expect(lines[0]!.y1).toBe(byKey.get("cardac")!.y);
      expect(lines[0]!.x2).toBe(byKey.get("corporate")!.x);
      expect(lines[0]!.y2).toBe(byKey.get("corporate")!.y);
    }
  });

  test("zoom changes the bow, never the membership", () => {
    const markers: Array<LinkableMarker> = [
      { key: "a", ids: ["a"], x: 0, y: 0 },
      { key: "b", ids: ["b"], x: 200, y: 0 },
    ];
    const pair: Array<MapLinkView> = [
      linkRow({ id: "l1" }),
      linkRow({ id: "l2" }),
    ];

    let previousBow: number = Infinity;
    for (const zoom of ZOOMS) {
      const lines: Array<DrawableMapLink> = buildMapLinks({
        links: pair,
        markers: markers,
        zoom: zoom,
      });
      expect(lines).toHaveLength(2);
      const bow: number = Math.abs(lines[1]!.midY);
      expect(bow).toBeGreaterThan(0);
      expect(bow).toBeLessThan(previousBow);
      previousBow = bow;
    }
  });

  /*
   * The one honest exception, and it runs the other way: in "all" mode two
   * sites close enough to share a clustered marker have no line between
   * them, and zooming IN splits the cluster and reveals it. A link never
   * disappears as you zoom in.
   */
  test("in all mode, zooming in can only add lines", () => {
    const sites: Array<MapSiteView> = [
      mapSite({
        id: "s1",
        latitude: 40.7,
        longitude: -74,
        isContainer: false,
        isOperational: true,
      }),
      mapSite({
        id: "s2",
        latitude: 40.71,
        longitude: -74.01,
        isContainer: false,
        isOperational: true,
      }),
    ];
    const siteLinks: Array<MapLinkView> = [
      linkRow({ id: "l1", fromSiteId: "s1", toSiteId: "s2" }),
    ];

    const clustered: Array<MapMarker> = buildMapMarkers({
      sites: sites,
      mode: "all",
      cellSize: CLUSTER_CELL_SIZE,
    });
    expect(clustered).toHaveLength(1);
    expect(
      buildMapLinks({
        links: siteLinks,
        markers: layoutMapMarkers(clustered, 1),
        zoom: 1,
      }),
    ).toEqual([]);

    // Zoomed in far enough for the cell to split them, the line appears.
    const split: Array<MapMarker> = buildMapMarkers({
      sites: sites,
      mode: "all",
      cellSize: 0.01,
    });
    expect(split.length).toBeGreaterThan(1);
    expect(
      buildMapLinks({
        links: siteLinks,
        markers: layoutMapMarkers(split, 64),
        zoom: 64,
      }),
    ).toHaveLength(1);
  });

  /*
   * Grouped mode never clusters, so its link set cannot move at all: the
   * markers are the level's children at every zoom.
   */
  test("grouped mode draws the same lines however the map is framed", () => {
    const markers: Array<MapMarker> = buildMapMarkers({
      sites: linkedSites(),
      mode: "grouped",
      cellSize: 0,
    });
    const drawn: Set<string> = new Set<string>();
    for (const zoom of ZOOMS) {
      drawn.add(
        buildMapLinks({
          links: links,
          markers: layoutMapMarkers(markers, zoom),
          zoom: zoom,
        })
          .map((line: DrawableMapLink): string => {
            return line.id;
          })
          .join(","),
      );
    }
    expect(Array.from(drawn)).toEqual(["l1,l2"]);
  });
});
