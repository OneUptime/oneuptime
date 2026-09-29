import { describe, expect, test } from "@jest/globals";
import NetworkSiteMapUtil, {
  GeoPoint,
  MapChildRow,
  MapLinkRow,
  MapMarkerAggregate,
  MapStatusInfo,
  MapSubtreeRow,
  isUsableCoordinate,
  sphericalCentroid,
} from "../../FeatureSet/BaseAPI/Utils/NetworkSiteMapUtil";

/*
 * Pure-logic tests for the /network-site/map marker aggregation: where a
 * container goes on the map, what it reports about the estate under it, and
 * which children have no place on the map at all.
 *
 * These exist because the map used to plot every coordinate-bearing site in
 * the project, flat, and let screen-proximity clustering decide what a
 * marker meant. A franchise network got numbered blobs matching nothing the
 * customer had named, and the levels they actually model — Region, Market,
 * "Corp" — carry no coordinates of their own, so they could not appear at
 * all. Every assertion below is one half of that fix.
 *
 * Site types are per-project rows a customer may rename, so the fixtures
 * deliberately use type NAMES that would break any name-based leaf check
 * ("Store", "Location" — never "Unit") while flagging the leaf level through
 * isUnitLevel. If the rollups ever regress to comparing siteType strings,
 * these tests fail.
 */

const OPERATIONAL: string = "status-up";
const OFFLINE: string = "status-down";

const STATUS_BY_ID: Map<string, MapStatusInfo> = new Map<string, MapStatusInfo>(
  [
    [OPERATIONAL, { priority: 1, isOperationalState: true }],
    [OFFLINE, { priority: 5, isOperationalState: false }],
  ],
);

describe("isUsableCoordinate", () => {
  test("accepts a finite pair inside the real ranges", () => {
    expect(isUsableCoordinate(39.1, -94.58)).toBe(true);
    expect(isUsableCoordinate(0, 0)).toBe(true);
  });

  test("accepts the exact range boundaries", () => {
    expect(isUsableCoordinate(90, 180)).toBe(true);
    expect(isUsableCoordinate(-90, -180)).toBe(true);
  });

  /*
   * A CSV import that shifts a column by one puts a longitude in the
   * latitude field. Projected, a latitude of 1246.7 drags the marker — and
   * the frame the map fits around it — somewhere no site is.
   */
  test("rejects coordinates outside the real ranges", () => {
    expect(isUsableCoordinate(90.0001, 0)).toBe(false);
    expect(isUsableCoordinate(-90.5, 0)).toBe(false);
    expect(isUsableCoordinate(0, 180.5)).toBe(false);
    expect(isUsableCoordinate(0, -181)).toBe(false);
    expect(isUsableCoordinate(1246.7, -94.58)).toBe(false);
  });

  test("rejects anything that is not a finite number", () => {
    expect(isUsableCoordinate(null, null)).toBe(false);
    expect(isUsableCoordinate(undefined, undefined)).toBe(false);
    expect(isUsableCoordinate(Number.NaN, 0)).toBe(false);
    expect(isUsableCoordinate(0, Number.NaN)).toBe(false);
    expect(isUsableCoordinate(Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(isUsableCoordinate(39.1, undefined)).toBe(false);
  });

  test("rejects numeric strings", () => {
    expect(
      isUsableCoordinate(
        "39.1" as unknown as number,
        "-94.58" as unknown as number,
      ),
    ).toBe(false);
  });
});

describe("sphericalCentroid", () => {
  test("has nothing to report for an empty set", () => {
    expect(sphericalCentroid([])).toBeNull();
  });

  test("a single point is its own centroid", () => {
    const centroid: GeoPoint | null = sphericalCentroid([
      { latitude: 39.0997, longitude: -94.5786 },
    ]);
    expect(centroid).not.toBeNull();
    expect(centroid!.latitude).toBeCloseTo(39.0997, 9);
    expect(centroid!.longitude).toBeCloseTo(-94.5786, 9);
  });

  test("repeated identical points stay put", () => {
    const point: GeoPoint = { latitude: -33.8688, longitude: 151.2093 };
    const centroid: GeoPoint | null = sphericalCentroid([point, point, point]);
    expect(centroid!.latitude).toBeCloseTo(-33.8688, 9);
    expect(centroid!.longitude).toBeCloseTo(151.2093, 9);
  });

  /*
   * The whole reason this is not an arithmetic mean. Two sites two degrees
   * apart across the antimeridian average to 180, not to 0 — a flat mean
   * would put the marker for a Pacific region in the Gulf of Guinea.
   */
  test("points either side of the antimeridian average across it", () => {
    const centroid: GeoPoint | null = sphericalCentroid([
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
    ]);
    expect(centroid).not.toBeNull();
    expect(centroid!.latitude).toBeCloseTo(0, 9);
    expect(Math.abs(centroid!.longitude)).toBeCloseTo(180, 9);
  });

  /*
   * For the ordinary case — stores in one state — the spherical mean and
   * the naive mean agree to well under a pixel, so nothing about the
   * everyday map changed when this replaced a flat average.
   */
  test("agrees with a flat average for a tight cluster", () => {
    const points: Array<GeoPoint> = [
      { latitude: 39.0997, longitude: -94.5786 },
      { latitude: 39.1155, longitude: -94.6268 },
      { latitude: 38.9822, longitude: -94.6708 },
    ];
    const centroid: GeoPoint | null = sphericalCentroid(points);
    const flatLatitude: number =
      points.reduce((total: number, point: GeoPoint): number => {
        return total + point.latitude;
      }, 0) / points.length;
    const flatLongitude: number =
      points.reduce((total: number, point: GeoPoint): number => {
        return total + point.longitude;
      }, 0) / points.length;
    expect(centroid!.latitude).toBeCloseTo(flatLatitude, 3);
    expect(centroid!.longitude).toBeCloseTo(flatLongitude, 3);
  });

  test("antipodal points have no centroid to report", () => {
    expect(
      sphericalCentroid([
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      ]),
    ).toBeNull();
    expect(
      sphericalCentroid([
        { latitude: 90, longitude: 0 },
        { latitude: -90, longitude: 0 },
      ]),
    ).toBeNull();
  });

  test("unusable points are skipped, and an all-unusable set reports nothing", () => {
    const centroid: GeoPoint | null = sphericalCentroid([
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 10, longitude: 20 },
      { latitude: 1246.7, longitude: 0 },
    ]);
    expect(centroid!.latitude).toBeCloseTo(10, 9);
    expect(centroid!.longitude).toBeCloseTo(20, 9);

    expect(
      sphericalCentroid([
        { latitude: Number.NaN, longitude: Number.NaN },
        { latitude: 0, longitude: 999 },
      ]),
    ).toBeNull();
  });

  test("is independent of input order", () => {
    const points: Array<GeoPoint> = [
      { latitude: 51.5074, longitude: -0.1278 },
      { latitude: 48.8566, longitude: 2.3522 },
      { latitude: 52.52, longitude: 13.405 },
    ];
    const forward: GeoPoint | null = sphericalCentroid(points);
    const reversed: GeoPoint | null = sphericalCentroid(
      points.slice().reverse(),
    );
    expect(forward!.latitude).toBeCloseTo(reversed!.latitude, 12);
    expect(forward!.longitude).toBeCloseTo(reversed!.longitude, 12);
  });

  test("always returns a placeable coordinate", () => {
    const centroid: GeoPoint | null = sphericalCentroid([
      { latitude: 89.9, longitude: 12 },
      { latitude: 89.8, longitude: -170 },
    ]);
    expect(centroid).not.toBeNull();
    expect(isUsableCoordinate(centroid!.latitude, centroid!.longitude)).toBe(
      true,
    );
  });
});

/*
 * The fixture is the customer's shape, shrunk: a level whose children are
 * regions with no coordinates of their own, holding markets that also have
 * none, holding the stores that do.
 *
 *   (the level in view)
 *   ├── Region A            no coords
 *   │   ├── Market A1       no coords
 *   │   │   ├── Store A1a   40, -74   operational
 *   │   │   └── Store A1b   42, -71   OFFLINE
 *   │   └── Market A2       no coords
 *   │       └── Store A2a   41, -73   operational
 *   ├── Region B            34, -118  (its own pin)
 *   │   └── Store B1        37, -122  operational
 *   ├── Region C            no coords
 *   │   └── Market C1       no coords          <- nothing locatable at all
 *   └── Store D             30, -97   OFFLINE  (a unit-level child)
 */
const CHILDREN: Array<MapChildRow> = [
  { id: "regionA", name: "Region A", siteType: "Region", isUnitLevel: false },
  {
    id: "regionB",
    name: "Region B",
    siteType: "Region",
    isUnitLevel: false,
    latitude: 34,
    longitude: -118,
  },
  { id: "regionC", name: "Region C", siteType: "Region", isUnitLevel: false },
  {
    id: "storeD",
    name: "Store D",
    siteType: "Store",
    isUnitLevel: true,
    latitude: 30,
    longitude: -97,
    currentMonitorStatusId: OFFLINE,
  },
];

const DESCENDANTS: Array<MapSubtreeRow> = [
  {
    id: "marketA1",
    name: "Market A1",
    isUnitLevel: false,
    parentSiteId: "regionA",
    materializedPath: "/regionA/",
  },
  {
    id: "marketA2",
    name: "Market A2",
    isUnitLevel: false,
    parentSiteId: "regionA",
    materializedPath: "/regionA/",
  },
  {
    id: "storeA1a",
    name: "Store A1a",
    isUnitLevel: true,
    parentSiteId: "marketA1",
    materializedPath: "/regionA/marketA1/",
    latitude: 40,
    longitude: -74,
    currentMonitorStatusId: OPERATIONAL,
  },
  {
    id: "storeA1b",
    name: "Store A1b",
    isUnitLevel: true,
    parentSiteId: "marketA1",
    materializedPath: "/regionA/marketA1/",
    latitude: 42,
    longitude: -71,
    currentMonitorStatusId: OFFLINE,
  },
  {
    id: "storeA2a",
    name: "Store A2a",
    isUnitLevel: true,
    parentSiteId: "marketA2",
    materializedPath: "/regionA/marketA2/",
    latitude: 41,
    longitude: -73,
    currentMonitorStatusId: OPERATIONAL,
  },
  {
    id: "storeB1",
    name: "Store B1",
    isUnitLevel: true,
    parentSiteId: "regionB",
    materializedPath: "/regionB/",
    latitude: 37,
    longitude: -122,
    currentMonitorStatusId: OPERATIONAL,
  },
  {
    id: "marketC1",
    name: "Market C1",
    isUnitLevel: false,
    parentSiteId: "regionC",
    materializedPath: "/regionC/",
  },
];

function aggregate(
  children: Array<MapChildRow> = CHILDREN,
  descendants: Array<MapSubtreeRow> = DESCENDANTS,
): Map<string, MapMarkerAggregate> {
  return NetworkSiteMapUtil.aggregateMapMarkers({
    children: children,
    descendants: descendants,
    statusById: STATUS_BY_ID,
  });
}

describe("aggregateMapMarkers", () => {
  test("returns exactly one aggregate per child, and nothing else", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate();
    expect(Array.from(result.keys()).sort()).toEqual([
      "regionA",
      "regionB",
      "regionC",
      "storeD",
    ]);
  });

  /*
   * The headline behaviour: a region with no coordinates of its own lands
   * at the middle of its stores, which is the only reason it can be on the
   * map at all.
   */
  test("a container with no coordinates lands on the centroid of its located sites", () => {
    const regionA: MapMarkerAggregate = aggregate().get("regionA")!;
    const expected: GeoPoint | null = sphericalCentroid([
      { latitude: 40, longitude: -74 },
      { latitude: 42, longitude: -71 },
      { latitude: 41, longitude: -73 },
    ]);
    expect(regionA.isDerivedLocation).toBe(true);
    expect(regionA.latitude).toBeCloseTo(expected!.latitude, 9);
    expect(regionA.longitude).toBeCloseTo(expected!.longitude, 9);
  });

  /*
   * Somebody who pinned their regional office meant the marker to sit
   * there, not at the middle of the stores it happens to own.
   */
  test("a container's own coordinates beat the centroid of its descendants", () => {
    const regionB: MapMarkerAggregate = aggregate().get("regionB")!;
    expect(regionB.latitude).toBe(34);
    expect(regionB.longitude).toBe(-118);
    expect(regionB.isDerivedLocation).toBe(false);
  });

  test("a child with nothing locatable beneath it has no position", () => {
    const regionC: MapMarkerAggregate = aggregate().get("regionC")!;
    expect(regionC.latitude).toBeNull();
    expect(regionC.longitude).toBeNull();
    expect(regionC.isDerivedLocation).toBe(false);
    expect(regionC.locatedDescendantCount).toBe(0);
    // Region C itself plus Market C1.
    expect(regionC.unlocatedDescendantCount).toBe(2);
  });

  test("unit-level descendants are counted by the flag, never by the type name", () => {
    const regionA: MapMarkerAggregate = aggregate().get("regionA")!;
    expect(regionA.totalUnits).toBe(3);
    expect(regionA.operationalUnits).toBe(2);
  });

  test("a unit-level child reports exactly itself", () => {
    const storeD: MapMarkerAggregate = aggregate().get("storeD")!;
    expect(storeD.totalUnits).toBe(1);
    expect(storeD.operationalUnits).toBe(0);
    expect(storeD.childSiteCount).toBe(0);
    expect(storeD.isDerivedLocation).toBe(false);
  });

  /*
   * A unit-level child that somehow has descendants must not start
   * counting them as units — the card next to it says "1 unit", and the
   * marker has to agree.
   */
  test("a unit-level child does not roll up units from beneath it", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "storeD",
          name: "Store D",
          siteType: "Store",
          isUnitLevel: true,
          latitude: 30,
          longitude: -97,
          currentMonitorStatusId: OPERATIONAL,
        },
      ],
      [
        {
          id: "subStore",
          name: "Sub store",
          isUnitLevel: true,
          parentSiteId: "storeD",
          materializedPath: "/storeD/",
          latitude: 31,
          longitude: -98,
          currentMonitorStatusId: OPERATIONAL,
        },
      ],
    );
    expect(result.get("storeD")!.totalUnits).toBe(1);
    expect(result.get("storeD")!.operationalUnits).toBe(1);
  });

  test("childSiteCount counts DIRECT children only", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate();
    // Market A1 and Market A2 — not the three stores under them.
    expect(result.get("regionA")!.childSiteCount).toBe(2);
    expect(result.get("regionB")!.childSiteCount).toBe(1);
    expect(result.get("regionC")!.childSiteCount).toBe(1);
  });

  test("located and unlocated descendants are counted separately", () => {
    const regionA: MapMarkerAggregate = aggregate().get("regionA")!;
    // The three stores.
    expect(regionA.locatedDescendantCount).toBe(3);
    // Region A itself and its two markets.
    expect(regionA.unlocatedDescendantCount).toBe(3);
  });

  /*
   * The marker's colour comes off these. A region with one dark store is
   * not operational, and the card beneath it says the same.
   */
  test("health folds up: anything down makes the whole subtree not operational", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate();
    expect(result.get("regionA")!.isOperational).toBe(false);
    expect(result.get("regionA")!.worstStatusPriority).toBe(5);
    expect(result.get("regionB")!.isOperational).toBe(true);
    expect(result.get("regionB")!.worstStatusPriority).toBe(1);
    expect(result.get("storeD")!.isOperational).toBe(false);
  });

  test("a subtree where nothing reports a status is neither up nor down", () => {
    const regionC: MapMarkerAggregate = aggregate().get("regionC")!;
    expect(regionC.isOperational).toBeNull();
    expect(regionC.worstStatusPriority).toBe(0);
  });

  test("a status id with no row behind it is ignored rather than guessed at", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "regionZ",
          name: "Region Z",
          siteType: "Region",
          isUnitLevel: false,
        },
      ],
      [
        {
          id: "storeZ",
          name: "Store Z",
          isUnitLevel: true,
          parentSiteId: "regionZ",
          materializedPath: "/regionZ/",
          latitude: 1,
          longitude: 1,
          currentMonitorStatusId: "status-deleted-since",
        },
      ],
    );
    const regionZ: MapMarkerAggregate = result.get("regionZ")!;
    expect(regionZ.isOperational).toBeNull();
    expect(regionZ.worstStatusPriority).toBe(0);
    expect(regionZ.totalUnits).toBe(1);
    expect(regionZ.operationalUnits).toBe(0);
  });

  /*
   * Rows whose materialized path has not been backfilled still have to land
   * under the right child, or a region's whole estate silently vanishes
   * from its marker.
   */
  test("a descendant with no materialized path falls back to its parent", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "regionA",
          name: "Region A",
          siteType: "Region",
          isUnitLevel: false,
        },
      ],
      [
        {
          id: "storeNoPath",
          name: "Store with no path",
          isUnitLevel: true,
          parentSiteId: "regionA",
          latitude: 12,
          longitude: 34,
          currentMonitorStatusId: OPERATIONAL,
        },
      ],
    );
    const regionA: MapMarkerAggregate = result.get("regionA")!;
    expect(regionA.totalUnits).toBe(1);
    expect(regionA.latitude).toBeCloseTo(12, 9);
    expect(regionA.longitude).toBeCloseTo(34, 9);
  });

  test("descendants belonging to no listed child are ignored", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "regionA",
          name: "Region A",
          siteType: "Region",
          isUnitLevel: false,
        },
      ],
      [
        {
          id: "strayStore",
          name: "Somewhere else entirely",
          isUnitLevel: true,
          parentSiteId: "someOtherRegion",
          materializedPath: "/someOtherRegion/",
          latitude: 60,
          longitude: 60,
          currentMonitorStatusId: OFFLINE,
        },
      ],
    );
    const regionA: MapMarkerAggregate = result.get("regionA")!;
    expect(regionA.totalUnits).toBe(0);
    expect(regionA.latitude).toBeNull();
    expect(regionA.isOperational).toBeNull();
  });

  test("a descendant's unusable coordinates count as unlocated, not as a position", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "regionA",
          name: "Region A",
          siteType: "Region",
          isUnitLevel: false,
        },
      ],
      [
        {
          id: "brokenStore",
          name: "Broken coordinates",
          isUnitLevel: true,
          parentSiteId: "regionA",
          materializedPath: "/regionA/",
          latitude: 1246.7,
          longitude: -94.58,
        },
        {
          id: "goodStore",
          name: "Good coordinates",
          isUnitLevel: true,
          parentSiteId: "regionA",
          materializedPath: "/regionA/",
          latitude: 20,
          longitude: 30,
        },
      ],
    );
    const regionA: MapMarkerAggregate = result.get("regionA")!;
    expect(regionA.locatedDescendantCount).toBe(1);
    // Region A itself, plus the store whose coordinates cannot be read.
    expect(regionA.unlocatedDescendantCount).toBe(2);
    expect(regionA.latitude).toBeCloseTo(20, 9);
    expect(regionA.longitude).toBeCloseTo(30, 9);
  });

  test("an empty level aggregates to nothing without throwing", () => {
    expect(
      NetworkSiteMapUtil.aggregateMapMarkers({
        children: [],
        descendants: DESCENDANTS,
        statusById: STATUS_BY_ID,
      }).size,
    ).toBe(0);
  });

  test("children with no descendants at all still get an aggregate", () => {
    const result: Map<string, MapMarkerAggregate> = aggregate(CHILDREN, []);
    expect(result.size).toBe(4);
    expect(result.get("regionA")!.latitude).toBeNull();
    expect(result.get("regionA")!.totalUnits).toBe(0);
    expect(result.get("regionB")!.latitude).toBe(34);
    expect(result.get("storeD")!.totalUnits).toBe(1);
  });

  test("is independent of the order rows arrive in", () => {
    const forward: Map<string, MapMarkerAggregate> = aggregate();
    const reversed: Map<string, MapMarkerAggregate> = aggregate(
      CHILDREN.slice().reverse(),
      DESCENDANTS.slice().reverse(),
    );
    for (const childId of forward.keys()) {
      const a: MapMarkerAggregate = forward.get(childId)!;
      const b: MapMarkerAggregate = reversed.get(childId)!;
      expect(b.totalUnits).toBe(a.totalUnits);
      expect(b.operationalUnits).toBe(a.operationalUnits);
      expect(b.childSiteCount).toBe(a.childSiteCount);
      expect(b.locatedDescendantCount).toBe(a.locatedDescendantCount);
      expect(b.isOperational).toBe(a.isOperational);
      if (a.latitude === null) {
        expect(b.latitude).toBeNull();
      } else {
        expect(b.latitude).toBeCloseTo(a.latitude, 9);
        expect(b.longitude!).toBeCloseTo(a.longitude!, 9);
      }
    }
  });

  /*
   * The customer's actual numbers: thirteen regions, every unit down. The
   * marker for such a region has to report the whole estate and read as an
   * outage — not as one grey dot among proximity blobs.
   */
  test("a wholly-down region reports its whole estate", () => {
    const stores: Array<MapSubtreeRow> = [];
    for (let index: number = 0; index < 69; index++) {
      stores.push({
        id: `store-${index}`,
        name: `Unit ${1000 + index}`,
        isUnitLevel: true,
        parentSiteId: "region1000",
        materializedPath: "/region1000/",
        latitude: 32 + index * 0.01,
        longitude: -96 - index * 0.01,
        currentMonitorStatusId: OFFLINE,
      });
    }
    const result: Map<string, MapMarkerAggregate> = aggregate(
      [
        {
          id: "region1000",
          name: "Region 1000",
          siteType: "Region",
          isUnitLevel: false,
        },
      ],
      stores,
    );
    const region: MapMarkerAggregate = result.get("region1000")!;
    expect(region.totalUnits).toBe(69);
    expect(region.operationalUnits).toBe(0);
    expect(region.isOperational).toBe(false);
    expect(region.isDerivedLocation).toBe(true);
    expect(region.locatedDescendantCount).toBe(69);
    expect(isUsableCoordinate(region.latitude, region.longitude)).toBe(true);
  });
});

/*
 * Which site links the map can draw as a line.
 *
 * The map answers with the links between the markers it is showing, so this
 * is the filter that decides what a customer sees connected to what. The
 * rule that matters most is the one that is NOT here: a missing monitor is
 * never a reason to drop a link. The monitor colors the line; it does not
 * decide whether the connection exists.
 */
describe("NetworkSiteMapUtil.filterDrawableLinks", () => {
  function link(overrides: Partial<MapLinkRow> & { id: string }): MapLinkRow {
    return {
      name: `Link ${overrides.id}`,
      fromSiteId: "a",
      toSiteId: "b",
      ...overrides,
    };
  }

  const markers: Set<string> = new Set<string>(["a", "b", "c"]);

  test("keeps a link whose both ends have a marker", () => {
    expect(
      NetworkSiteMapUtil.filterDrawableLinks(
        [link({ id: "l1", fromSiteId: "a", toSiteId: "c" })],
        markers,
      ).map((row: MapLinkRow): string => {
        return row.id;
      }),
    ).toEqual(["l1"]);
  });

  /*
   * The headline requirement. A link with no monitor attached — the normal
   * state of a freshly modelled network — has to survive this filter, or
   * the map silently shows a fraction of the customer's links.
   */
  test("keeps a link with no monitor attached", () => {
    const kept: Array<MapLinkRow> = NetworkSiteMapUtil.filterDrawableLinks(
      [
        link({ id: "unmonitored", monitorId: undefined }),
        link({ id: "monitored", monitorId: "monitor1" }),
      ],
      markers,
    );
    expect(
      kept.map((row: MapLinkRow): string => {
        return row.id;
      }),
    ).toEqual(["unmonitored", "monitored"]);
  });

  test("drops a link whose far end is not on the map", () => {
    expect(
      NetworkSiteMapUtil.filterDrawableLinks(
        [
          link({ id: "l1", fromSiteId: "a", toSiteId: "elsewhere" }),
          link({ id: "l2", fromSiteId: "elsewhere", toSiteId: "b" }),
        ],
        markers,
      ),
    ).toEqual([]);
  });

  test("drops a link that is missing an end entirely", () => {
    expect(
      NetworkSiteMapUtil.filterDrawableLinks(
        [
          link({ id: "l1", fromSiteId: undefined }),
          link({ id: "l2", toSiteId: undefined }),
          link({ id: "l3", fromSiteId: "", toSiteId: "" }),
        ],
        markers,
      ),
    ).toEqual([]);
  });

  /*
   * A line from a point to itself is a dot. This is not hypothetical: in
   * "all" mode two linked sites can be close enough to share one clustered
   * marker, and a self-referencing row is cheap to write through the API.
   */
  test("drops a link whose two ends are the same site", () => {
    expect(
      NetworkSiteMapUtil.filterDrawableLinks(
        [link({ id: "l1", fromSiteId: "a", toSiteId: "a" })],
        markers,
      ),
    ).toEqual([]);
  });

  test("no markers means no lines", () => {
    expect(
      NetworkSiteMapUtil.filterDrawableLinks(
        [link({ id: "l1" })],
        new Set<string>(),
      ),
    ).toEqual([]);
  });

  /*
   * The response order is the drawing order, and parallel links between one
   * pair of markers are bowed apart in the order they arrive — so a filter
   * that reordered them would shuffle the picture between refreshes.
   */
  test("preserves input order and does not mutate the input", () => {
    const links: Array<MapLinkRow> = [
      link({ id: "l3", fromSiteId: "a", toSiteId: "c" }),
      link({ id: "l1", fromSiteId: "b", toSiteId: "c" }),
      link({ id: "dropped", fromSiteId: "a", toSiteId: "gone" }),
      link({ id: "l2", fromSiteId: "a", toSiteId: "b" }),
    ];
    const before: string = JSON.stringify(links);

    expect(
      NetworkSiteMapUtil.filterDrawableLinks(links, markers).map(
        (row: MapLinkRow): string => {
          return row.id;
        },
      ),
    ).toEqual(["l3", "l1", "l2"]);
    expect(JSON.stringify(links)).toBe(before);
  });
});
