import { describe, expect, test } from "@jest/globals";
import NetworkSiteHierarchyUtil, {
  BreadcrumbEntry,
  ChildAggregate,
  DEFAULT_UPTIME_WINDOW_DAYS,
  DeviceAttachmentRow,
  MAX_SEARCH_TEXT_LENGTH,
  MAX_UPTIME_WINDOW_DAYS,
  MIN_UPTIME_WINDOW_DAYS,
  SiteLinkRow,
  SubtreeSiteRow,
} from "../../FeatureSet/BaseAPI/Utils/NetworkSiteHierarchyUtil";

/*
 * Pure-logic tests for the /network-site/children aggregation helpers:
 * breadcrumb ordering from materialized paths, per-child unit/device
 * rollups, both-endpoints link filtering and uptime-window clamping.
 * These are the exact behaviors the API endpoint delegates to, tested
 * without a database.
 *
 * Site types are per-project rows a customer may rename, so the fixtures
 * below deliberately use type NAMES that would break any name-based unit
 * check ("Store" rather than "Unit") while flagging the leaf level through
 * isUnitLevel. If a rollup ever regresses to comparing siteType strings,
 * these tests fail.
 */

describe("clampUptimeWindowDays", () => {
  test("defaults to 30 when the body omits the field", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(undefined)).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(null)).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
  });

  test("passes through an in-range integer", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(7)).toBe(7);
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(90)).toBe(90);
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(1)).toBe(1);
  });

  test("clamps values above the 90-day maximum", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(91)).toBe(
      MAX_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(10000)).toBe(
      MAX_UPTIME_WINDOW_DAYS,
    );
  });

  test("clamps zero and negative values up to the 1-day minimum", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(0)).toBe(
      MIN_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(-5)).toBe(
      MIN_UPTIME_WINDOW_DAYS,
    );
  });

  test("rounds fractional day counts", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(7.4)).toBe(7);
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(7.5)).toBe(8);
  });

  test("falls back to the default for non-numeric junk", () => {
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays("30")).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(NaN)).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays(Infinity)).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
    expect(NetworkSiteHierarchyUtil.clampUptimeWindowDays({})).toBe(
      DEFAULT_UPTIME_WINDOW_DAYS,
    );
  });
});

describe("parseAncestorIds", () => {
  test("returns ordered ids from a slash-delimited path", () => {
    expect(
      NetworkSiteHierarchyUtil.parseAncestorIds("/root/region/market/", "me"),
    ).toEqual(["root", "region", "market"]);
  });

  test("returns [] for a missing or empty path", () => {
    expect(NetworkSiteHierarchyUtil.parseAncestorIds(undefined, "me")).toEqual(
      [],
    );
    expect(NetworkSiteHierarchyUtil.parseAncestorIds("", "me")).toEqual([]);
    expect(NetworkSiteHierarchyUtil.parseAncestorIds("/", "me")).toEqual([]);
  });

  test("drops the site's own id when a writer included it in the path", () => {
    expect(
      NetworkSiteHierarchyUtil.parseAncestorIds("/root/region/me/", "me"),
    ).toEqual(["root", "region"]);
  });

  test("dedupes repeated segments, keeping first occurrence order", () => {
    expect(
      NetworkSiteHierarchyUtil.parseAncestorIds("/root/region/root/", "me"),
    ).toEqual(["root", "region"]);
  });
});

describe("buildBreadcrumb", () => {
  const ancestorsById: Map<string, BreadcrumbEntry> = new Map<
    string,
    BreadcrumbEntry
  >([
    [
      "root",
      {
        id: "root",
        name: "Acme Corp",
        siteType: "Account Type",
        isUnitLevel: false,
      },
    ],
    [
      "region",
      { id: "region", name: "Midwest", siteType: "Region", isUnitLevel: false },
    ],
    [
      "market",
      {
        id: "market",
        name: "Springfield",
        siteType: "Market",
        isUnitLevel: false,
      },
    ],
  ]);

  test("orders crumbs root-first and ends with the requested site", () => {
    const breadcrumb: Array<BreadcrumbEntry> =
      NetworkSiteHierarchyUtil.buildBreadcrumb(
        {
          id: "me",
          name: "Store 1042",
          siteType: "Store",
          isUnitLevel: true,
          materializedPath: "/root/region/market/",
        },
        ancestorsById,
      );
    expect(
      breadcrumb.map((entry: BreadcrumbEntry) => {
        return entry.id;
      }),
    ).toEqual(["root", "region", "market", "me"]);
    expect(breadcrumb[0]).toEqual({
      id: "root",
      name: "Acme Corp",
      siteType: "Account Type",
      isUnitLevel: false,
    });
    expect(breadcrumb[3]).toEqual({
      id: "me",
      name: "Store 1042",
      siteType: "Store",
      isUnitLevel: true,
    });
  });

  test("carries the leaf-level flag, not a guess from the type name", () => {
    /*
     * The map view drills the last crumb into a device topology when it is
     * the leaf level. A project that renamed its leaf type to "Store" must
     * still drill in, and one that named a mid-level type "Unit" must not.
     */
    const leaf: Array<BreadcrumbEntry> =
      NetworkSiteHierarchyUtil.buildBreadcrumb(
        { id: "me", name: "Store 7", siteType: "Store", isUnitLevel: true },
        new Map<string, BreadcrumbEntry>(),
      );
    expect(leaf[0]!.isUnitLevel).toBe(true);

    const notLeaf: Array<BreadcrumbEntry> =
      NetworkSiteHierarchyUtil.buildBreadcrumb(
        { id: "me", name: "Midwest", siteType: "Unit", isUnitLevel: false },
        new Map<string, BreadcrumbEntry>(),
      );
    expect(notLeaf[0]!.isUnitLevel).toBe(false);
  });

  test("a site without ancestors is its own single crumb", () => {
    const breadcrumb: Array<BreadcrumbEntry> =
      NetworkSiteHierarchyUtil.buildBreadcrumb(
        { id: "me", name: "Root Site", siteType: "Region", isUnitLevel: false },
        new Map<string, BreadcrumbEntry>(),
      );
    expect(breadcrumb).toEqual([
      { id: "me", name: "Root Site", siteType: "Region", isUnitLevel: false },
    ]);
  });

  test("skips ancestors that did not resolve to a row, keeping order", () => {
    const breadcrumb: Array<BreadcrumbEntry> =
      NetworkSiteHierarchyUtil.buildBreadcrumb(
        {
          id: "me",
          name: "Store 1042",
          siteType: "Store",
          isUnitLevel: true,
          materializedPath: "/root/deleted/market/",
        },
        ancestorsById,
      );
    expect(
      breadcrumb.map((entry: BreadcrumbEntry) => {
        return entry.id;
      }),
    ).toEqual(["root", "market", "me"]);
  });
});

describe("buildParentBreadcrumbString", () => {
  const nameById: Map<string, string> = new Map<string, string>([
    ["root", "Acme Corp"],
    ["region", "Midwest"],
  ]);

  test("joins ancestor names root-first with ' / '", () => {
    expect(
      NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
        "/root/region/",
        "me",
        nameById,
      ),
    ).toBe("Acme Corp / Midwest");
  });

  test("empty string when the site has no ancestors", () => {
    expect(
      NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
        undefined,
        "me",
        nameById,
      ),
    ).toBe("");
  });

  test("skips ancestors with unknown names", () => {
    expect(
      NetworkSiteHierarchyUtil.buildParentBreadcrumbString(
        "/root/mystery/region/",
        "me",
        nameById,
      ),
    ).toBe("Acme Corp / Midwest");
  });
});

describe("aggregateChildStats", () => {
  /*
   * Fixture hierarchy under the requested site "parent". The project in this
   * fixture renamed its leaf type to "Store", so every unit rollup below is
   * driven purely by isUnitLevel:
   *
   *   marketA (Market)                    — child
   *     unit1 (Store, leaf, operational)
   *     unit2 (Store, leaf, down)
   *     closet (Other)
   *       unit3 (Store, leaf, operational)
   *   unitB (Store, leaf, operational)    — child that IS the leaf level
   *   emptyC (Market)                     — child with nothing below it
   */
  const OPERATIONAL: string = "status-op";
  const DOWN: string = "status-down";
  const operationalStatusIds: Set<string> = new Set<string>([OPERATIONAL]);

  const children: Array<{
    id: string;
    siteType: string;
    isUnitLevel: boolean;
    currentMonitorStatusId?: string | undefined;
  }> = [
    {
      id: "marketA",
      siteType: "Market",
      isUnitLevel: false,
      currentMonitorStatusId: DOWN,
    },
    {
      id: "unitB",
      siteType: "Store",
      isUnitLevel: true,
      currentMonitorStatusId: OPERATIONAL,
    },
    {
      id: "emptyC",
      siteType: "Market",
      isUnitLevel: false,
      currentMonitorStatusId: undefined,
    },
  ];

  const descendants: Array<SubtreeSiteRow> = [
    // The children themselves also come back from the subtree query.
    {
      id: "marketA",
      siteType: "Market",
      isUnitLevel: false,
      parentSiteId: "parent",
      materializedPath: "/parent/",
      currentMonitorStatusId: DOWN,
    },
    {
      id: "unitB",
      siteType: "Store",
      isUnitLevel: true,
      parentSiteId: "parent",
      materializedPath: "/parent/",
      currentMonitorStatusId: OPERATIONAL,
    },
    {
      id: "emptyC",
      siteType: "Market",
      isUnitLevel: false,
      parentSiteId: "parent",
      materializedPath: "/parent/",
    },
    {
      id: "unit1",
      siteType: "Store",
      isUnitLevel: true,
      parentSiteId: "marketA",
      materializedPath: "/parent/marketA/",
      currentMonitorStatusId: OPERATIONAL,
    },
    {
      id: "unit2",
      siteType: "Store",
      isUnitLevel: true,
      parentSiteId: "marketA",
      materializedPath: "/parent/marketA/",
      currentMonitorStatusId: DOWN,
    },
    {
      id: "closet",
      siteType: "Other",
      isUnitLevel: false,
      parentSiteId: "marketA",
      materializedPath: "/parent/marketA/",
    },
    {
      id: "unit3",
      siteType: "Store",
      isUnitLevel: true,
      parentSiteId: "closet",
      materializedPath: "/parent/marketA/closet/",
      currentMonitorStatusId: OPERATIONAL,
    },
  ];

  function aggregate(
    deviceSiteIds: Array<string> = [],
  ): Map<string, ChildAggregate> {
    return NetworkSiteHierarchyUtil.aggregateChildStats({
      children: children,
      descendants: descendants,
      devices: deviceSiteIds.map((siteId: string): DeviceAttachmentRow => {
        return { siteId: siteId, healthState: "healthy" , deviceCount: 1 };
      }),
      operationalStatusIds: operationalStatusIds,
    });
  }

  test("counts direct children only in childSiteCount", () => {
    const result: Map<string, ChildAggregate> = aggregate();
    // marketA has unit1, unit2, closet — unit3 is a grandchild.
    expect(result.get("marketA")!.childSiteCount).toBe(3);
    expect(result.get("unitB")!.childSiteCount).toBe(0);
    expect(result.get("emptyC")!.childSiteCount).toBe(0);
  });

  test("unit stats count unit-level descendants across the whole subtree", () => {
    const result: Map<string, ChildAggregate> = aggregate();
    // unit1 + unit2 + unit3 (nested under closet) — closet itself excluded.
    expect(result.get("marketA")!.unitStats).toEqual({
      totalUnits: 3,
      operationalUnits: 2,
    });
  });

  test("descendants that are not unit-level never count as units", () => {
    const result: Map<string, ChildAggregate> = aggregate();
    expect(result.get("emptyC")!.unitStats).toEqual({
      totalUnits: 0,
      operationalUnits: 0,
    });
  });

  test("a unit-level child reports exactly itself: 1/1 when operational", () => {
    const result: Map<string, ChildAggregate> = aggregate();
    expect(result.get("unitB")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 1,
    });
  });

  test("a unit-level child reports 1/0 when not operational", () => {
    const result: Map<string, ChildAggregate> =
      NetworkSiteHierarchyUtil.aggregateChildStats({
        children: [
          {
            id: "unitB",
            siteType: "Store",
            isUnitLevel: true,
            currentMonitorStatusId: DOWN,
          },
        ],
        descendants: [],
        devices: [],
        operationalStatusIds: operationalStatusIds,
      });
    expect(result.get("unitB")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 0,
    });
  });

  test("a unit-level child with no status at all reports 1/0", () => {
    const result: Map<string, ChildAggregate> =
      NetworkSiteHierarchyUtil.aggregateChildStats({
        children: [{ id: "unitB", siteType: "Store", isUnitLevel: true }],
        descendants: [],
        devices: [],
        operationalStatusIds: operationalStatusIds,
      });
    expect(result.get("unitB")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 0,
    });
  });

  /*
   * The regression guard for the whole rename: a project may call any level
   * "Unit" without it being the leaf, and may call its leaf anything at all.
   * Only the flag decides.
   */
  test("a type NAMED Unit does not count when it is not unit-level", () => {
    const result: Map<string, ChildAggregate> =
      NetworkSiteHierarchyUtil.aggregateChildStats({
        children: [
          { id: "regionA", siteType: "Unit", isUnitLevel: false },
          { id: "storeB", siteType: "Store", isUnitLevel: true },
        ],
        descendants: [
          {
            id: "misnamed",
            siteType: "Unit",
            isUnitLevel: false,
            parentSiteId: "regionA",
            materializedPath: "/parent/regionA/",
            currentMonitorStatusId: OPERATIONAL,
          },
          {
            id: "realLeaf",
            siteType: "Branch Office",
            isUnitLevel: true,
            parentSiteId: "regionA",
            materializedPath: "/parent/regionA/",
            currentMonitorStatusId: OPERATIONAL,
          },
        ],
        devices: [],
        operationalStatusIds: operationalStatusIds,
      });
    // Only "realLeaf" is unit-level, despite "misnamed" being typed "Unit".
    expect(result.get("regionA")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 1,
    });
    expect(result.get("storeB")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 0,
    });
  });

  test("devices roll up through the subtree to the owning child", () => {
    const result: Map<string, ChildAggregate> = aggregate([
      "marketA", // directly at the child
      "unit1", // in marketA's subtree
      "unit3", // nested two levels down
      "unitB", // at the unit child
      "parent", // at the requested site itself — belongs to no child
      "elsewhere", // outside the subtree entirely
    ]);
    expect(result.get("marketA")!.deviceCount).toBe(3);
    expect(result.get("unitB")!.deviceCount).toBe(1);
    expect(result.get("emptyC")!.deviceCount).toBe(0);
  });

  test("falls back to parentSiteId when a row has no materialized path", () => {
    const result: Map<string, ChildAggregate> =
      NetworkSiteHierarchyUtil.aggregateChildStats({
        children: [{ id: "marketA", siteType: "Market", isUnitLevel: false }],
        descendants: [
          {
            id: "unit1",
            siteType: "Store",
            isUnitLevel: true,
            parentSiteId: "marketA",
            currentMonitorStatusId: OPERATIONAL,
          },
        ],
        devices: [{ siteId: "unit1", healthState: "healthy" , deviceCount: 1 }],
        operationalStatusIds: operationalStatusIds,
      });
    expect(result.get("marketA")!.childSiteCount).toBe(1);
    expect(result.get("marketA")!.unitStats).toEqual({
      totalUnits: 1,
      operationalUnits: 1,
    });
    expect(result.get("marketA")!.deviceCount).toBe(1);
  });

  test("returns zeroed aggregates when there are no children", () => {
    const result: Map<string, ChildAggregate> =
      NetworkSiteHierarchyUtil.aggregateChildStats({
        children: [],
        descendants: descendants,
        devices: [{ siteId: "unit1", healthState: "healthy" , deviceCount: 1 }],
        operationalStatusIds: operationalStatusIds,
      });
    expect(result.size).toBe(0);
  });

  /*
   * Issue #3320: the level has to be able to say WHICH of its children
   * holds something that needs attention, which is the whole reason the
   * device rollup carries a health breakdown rather than only a count.
   */
  describe("device health rolls up alongside the count", () => {
    function aggregateWithHealth(
      devices: Array<DeviceAttachmentRow>,
    ): Map<string, ChildAggregate> {
      return NetworkSiteHierarchyUtil.aggregateChildStats({
        children: children,
        descendants: descendants,
        devices: devices,
        operationalStatusIds: operationalStatusIds,
      });
    }

    test("each state lands in its own bucket of the owning child", () => {
      const result: Map<string, ChildAggregate> = aggregateWithHealth([
        { siteId: "unit1", healthState: "down" , deviceCount: 1 },
        { siteId: "unit3", healthState: "degraded" , deviceCount: 1 },
        { siteId: "marketA", healthState: "healthy" , deviceCount: 1 },
        { siteId: "unitB", healthState: "unknown" , deviceCount: 1 },
      ]);
      expect(result.get("marketA")!.deviceStats).toEqual({
        total: 3,
        down: 1,
        degraded: 1,
        healthy: 1,
        unknown: 0,
      });
      expect(result.get("unitB")!.deviceStats).toEqual({
        total: 1,
        down: 0,
        degraded: 0,
        healthy: 0,
        unknown: 1,
      });
    });

    test("deviceStats.total and deviceCount never disagree", () => {
      const result: Map<string, ChildAggregate> = aggregateWithHealth([
        { siteId: "unit1", healthState: "down" , deviceCount: 1 },
        { siteId: "unit1", healthState: "healthy" , deviceCount: 1 },
        { siteId: "unit2", healthState: "degraded" , deviceCount: 1 },
        { siteId: "unitB", healthState: "healthy" , deviceCount: 1 },
      ]);
      for (const aggregate of result.values()) {
        expect(aggregate.deviceStats.total).toBe(aggregate.deviceCount);
      }
    });

    /*
     * A device attached to the requested site itself, or to a site outside
     * the subtree entirely, belongs to no child — counting it under one
     * would put a red badge on a store that is perfectly fine.
     */
    test("devices outside every child's subtree are counted nowhere", () => {
      const result: Map<string, ChildAggregate> = aggregateWithHealth([
        { siteId: "parent", healthState: "down" , deviceCount: 1 },
        { siteId: "elsewhere", healthState: "down" , deviceCount: 1 },
      ]);
      for (const aggregate of result.values()) {
        expect(aggregate.deviceStats.total).toBe(0);
        expect(aggregate.deviceStats.down).toBe(0);
      }
    });

    test("a child with no devices reports a zeroed tally, not a missing one", () => {
      const result: Map<string, ChildAggregate> = aggregateWithHealth([]);
      expect(result.get("emptyC")!.deviceStats).toEqual({
        total: 0,
        down: 0,
        degraded: 0,
        healthy: 0,
        unknown: 0,
      });
    });

    test("each child's tally is its own object, never a shared one", () => {
      const result: Map<string, ChildAggregate> = aggregateWithHealth([
        { siteId: "unit1", healthState: "down" , deviceCount: 1 },
      ]);
      expect(result.get("marketA")!.deviceStats.down).toBe(1);
      expect(result.get("unitB")!.deviceStats.down).toBe(0);
      expect(result.get("marketA")!.deviceStats).not.toBe(
        result.get("unitB")!.deviceStats,
      );
    });
  });
});

/*
 * The level the reader is STANDING on. aggregateChildStats deliberately
 * says nothing about it — a site's own devices belong to no child's
 * subtree — so before this helper they were counted nowhere and drawn
 * nowhere.
 */
describe("tallyDeviceHealth", () => {
  const devices: Array<DeviceAttachmentRow> = [
    { siteId: "dc1", healthState: "down" , deviceCount: 1 },
    { siteId: "dc1", healthState: "healthy" , deviceCount: 1 },
    { siteId: "dc1", healthState: "degraded" , deviceCount: 1 },
    { siteId: "store7", healthState: "healthy" , deviceCount: 1 },
    { siteId: "store8", healthState: "unknown" , deviceCount: 1 },
  ];

  test("counts only the sites asked about", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(
        devices,
        new Set<string>(["dc1"]),
      ),
    ).toEqual({
      total: 3,
      down: 1,
      degraded: 1,
      healthy: 1,
      unknown: 0,
    });
  });

  test("takes more than one site at a time", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(
        devices,
        new Set<string>(["store7", "store8"]),
      ),
    ).toEqual({
      total: 2,
      down: 0,
      degraded: 0,
      healthy: 1,
      unknown: 1,
    });
  });

  test("a site nothing is attached to tallies to zeroes", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(
        devices,
        new Set<string>(["nobody"]),
      ).total,
    ).toBe(0);
  });

  test("an empty site set counts nothing at all", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(devices, new Set<string>())
        .total,
    ).toBe(0);
  });
});

describe("filterLinksBetweenChildren", () => {
  const childIds: Set<string> = new Set<string>(["a", "b", "c"]);

  function link(
    id: string,
    fromSiteId: string | undefined,
    toSiteId: string | undefined,
  ): SiteLinkRow {
    return { id: id, fromSiteId: fromSiteId, toSiteId: toSiteId };
  }

  test("keeps only links whose BOTH endpoints are returned children", () => {
    const links: Array<SiteLinkRow> = [
      link("keep-1", "a", "b"),
      link("keep-2", "c", "a"),
      link("drop-one-end", "a", "outsider"),
      link("drop-other-end", "outsider", "b"),
      link("drop-both-ends", "x", "y"),
    ];
    expect(
      NetworkSiteHierarchyUtil.filterLinksBetweenChildren(links, childIds).map(
        (kept: SiteLinkRow) => {
          return kept.id;
        },
      ),
    ).toEqual(["keep-1", "keep-2"]);
  });

  test("drops links with a missing endpoint id", () => {
    const links: Array<SiteLinkRow> = [
      link("no-from", undefined, "a"),
      link("no-to", "a", undefined),
      link("neither", undefined, undefined),
    ];
    expect(
      NetworkSiteHierarchyUtil.filterLinksBetweenChildren(links, childIds),
    ).toEqual([]);
  });

  test("empty child set filters everything out", () => {
    const links: Array<SiteLinkRow> = [link("l", "a", "b")];
    expect(
      NetworkSiteHierarchyUtil.filterLinksBetweenChildren(
        links,
        new Set<string>(),
      ),
    ).toEqual([]);
  });
});

/*
 * The two helpers behind /network-site/search.
 *
 * The endpoint exists because the map is a drill-down: a store four levels
 * under a region cannot be found by filtering the level in view, since it is
 * not on that level. So the search reaches across the whole project — and
 * every hit has to print the path to it, which is what collectAncestorIds
 * makes affordable (one extra query for the whole result set, not a path walk
 * per hit).
 */
describe("normalizeSearchText", () => {
  test("trims, and keeps the reader's own casing for the ILIKE to fold", () => {
    expect(NetworkSiteHierarchyUtil.normalizeSearchText("  Kansas City ")).toBe(
      "Kansas City",
    );
  });

  /*
   * The load-bearing case. An empty box must not be the query that matches
   * every site in the project, so it normalizes to "" and the endpoint
   * answers with no results rather than with everything.
   */
  test("blank and non-string inputs read as NO search", () => {
    expect(NetworkSiteHierarchyUtil.normalizeSearchText("")).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText("    ")).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText("\t\n")).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText(undefined)).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText(null)).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText(42)).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText({})).toBe("");
    expect(NetworkSiteHierarchyUtil.normalizeSearchText(["kansas"])).toBe("");
  });

  test("caps the length, after trimming", () => {
    const long: string = `   ${"a".repeat(MAX_SEARCH_TEXT_LENGTH + 50)}   `;
    expect(NetworkSiteHierarchyUtil.normalizeSearchText(long)).toHaveLength(
      MAX_SEARCH_TEXT_LENGTH,
    );
  });
});

describe("collectAncestorIds", () => {
  test("collects every ancestor referenced, deduplicated", () => {
    expect(
      NetworkSiteHierarchyUtil.collectAncestorIds(
        [
          { id: "u1", materializedPath: "/east/acme/chicago/" },
          { id: "u2", materializedPath: "/east/acme/chicago/" },
          { id: "u3", materializedPath: "/west/pdx/" },
        ],
        new Set<string>(),
      ).sort(),
    ).toEqual(["acme", "chicago", "east", "pdx", "west"]);
  });

  /*
   * Rows the caller already holds are excluded — their names came back with
   * the search itself, so re-fetching them would be a second query for data
   * already in hand.
   */
  test("skips ids the caller already has rows for", () => {
    expect(
      NetworkSiteHierarchyUtil.collectAncestorIds(
        [{ id: "u1", materializedPath: "/east/acme/" }],
        new Set<string>(["east"]),
      ),
    ).toEqual(["acme"]);
  });

  // A root site has no ancestors, and a pathless row must not throw.
  test("root and pathless rows contribute nothing", () => {
    expect(
      NetworkSiteHierarchyUtil.collectAncestorIds(
        [
          { id: "r1", materializedPath: "/" },
          { id: "r2", materializedPath: "" },
          { id: "r3" },
        ],
        new Set<string>(),
      ),
    ).toEqual([]);
  });

  /*
   * Some writers append a site's own id to its materialized path. Fetching a
   * site as its own ancestor would print it twice in its own path.
   */
  test("a row's own id is never collected as its ancestor", () => {
    expect(
      NetworkSiteHierarchyUtil.collectAncestorIds(
        [{ id: "u1", materializedPath: "/east/acme/u1/" }],
        new Set<string>(),
      ).sort(),
    ).toEqual(["acme", "east"]);
  });
});
