import { describe, expect, test } from "@jest/globals";
import NetworkSiteHierarchyUtil, {
  BreadcrumbEntry,
  ChildAggregate,
  DEFAULT_UPTIME_WINDOW_DAYS,
  DeviceAttachmentRow,
  MAX_SEARCH_TEXT_LENGTH,
  MAX_SEARCH_WORDS,
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
 *
 * The device rows are BUCKETS: one per (site, health verdict) combination,
 * carrying how many devices share it, because the endpoint asks Postgres to
 * group the fleet rather than fetching it. Most fixtures here pass
 * deviceCount: 1 — the per-device case the aggregator was originally written
 * for, and the one that cannot tell counting rows apart from counting
 * devices. The blocks that say "bucket" in their name are the ones that can.
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
        return { siteId: siteId, healthState: "healthy", deviceCount: 1 };
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
        devices: [{ siteId: "unit1", healthState: "healthy", deviceCount: 1 }],
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
        devices: [{ siteId: "unit1", healthState: "healthy", deviceCount: 1 }],
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
        { siteId: "unit1", healthState: "down", deviceCount: 1 },
        { siteId: "unit3", healthState: "degraded", deviceCount: 1 },
        { siteId: "marketA", healthState: "healthy", deviceCount: 1 },
        { siteId: "unitB", healthState: "unknown", deviceCount: 1 },
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
        { siteId: "unit1", healthState: "down", deviceCount: 1 },
        { siteId: "unit1", healthState: "healthy", deviceCount: 1 },
        { siteId: "unit2", healthState: "degraded", deviceCount: 1 },
        { siteId: "unitB", healthState: "healthy", deviceCount: 1 },
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
        { siteId: "parent", healthState: "down", deviceCount: 1 },
        { siteId: "elsewhere", healthState: "down", deviceCount: 1 },
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
        { siteId: "unit1", healthState: "down", deviceCount: 1 },
      ]);
      expect(result.get("marketA")!.deviceStats.down).toBe(1);
      expect(result.get("unitB")!.deviceStats.down).toBe(0);
      expect(result.get("marketA")!.deviceStats).not.toBe(
        result.get("unitB")!.deviceStats,
      );
    });
  });

  /*
   * A row is a BUCKET, not a device.
   *
   * The rollup stopped reading device rows: Postgres groups the fleet by the
   * facts the classifier reads and returns one row per (site, verdict)
   * combination, so a single row routinely stands for four hundred switches.
   * Every count in here therefore has to MULTIPLY by deviceCount rather than
   * add one — and getting that wrong is silent, because the shape of the
   * response is unchanged and only its magnitudes are wrong.
   *
   * Every test above passes deviceCount: 1, which is the per-device world
   * they were written in; not one of them can tell `+= 1` apart from
   * `+= row.deviceCount`. These can.
   */
  describe("a bucket stands for as many devices as it counts", () => {
    function aggregateBuckets(
      devices: Array<DeviceAttachmentRow>,
    ): Map<string, ChildAggregate> {
      return NetworkSiteHierarchyUtil.aggregateChildStats({
        children: children,
        descendants: descendants,
        devices: devices,
        operationalStatusIds: operationalStatusIds,
      });
    }

    test("one bucket contributes its whole count, not one", () => {
      const result: Map<string, ChildAggregate> = aggregateBuckets([
        { siteId: "unitB", healthState: "degraded", deviceCount: 412 },
      ]);
      const unitB: ChildAggregate = result.get("unitB")!;
      expect(unitB.deviceCount).toBe(412);
      expect(unitB.deviceStats).toEqual({
        total: 412,
        down: 0,
        degraded: 412,
        healthy: 0,
        unknown: 0,
      });
      /*
       * The invariant ChildAggregate documents, restated where it can now
       * actually break: deviceCount and deviceStats.total are incremented by
       * two separate statements, so one of them can start counting rows while
       * the other counts devices, and the card would print a denominator its
       * own breakdown does not add up to.
       */
      expect(unitB.deviceStats.total).toBe(unitB.deviceCount);
    });

    test("several buckets at one site sum, each into its own state", () => {
      const result: Map<string, ChildAggregate> = aggregateBuckets([
        { siteId: "unitB", healthState: "down", deviceCount: 3 },
        { siteId: "unitB", healthState: "degraded", deviceCount: 17 },
        { siteId: "unitB", healthState: "healthy", deviceCount: 1180 },
        { siteId: "unitB", healthState: "unknown", deviceCount: 9 },
      ]);
      expect(result.get("unitB")!.deviceStats).toEqual({
        total: 1209,
        down: 3,
        degraded: 17,
        healthy: 1180,
        unknown: 9,
      });
      expect(result.get("unitB")!.deviceCount).toBe(1209);
    });

    test("buckets from anywhere in a subtree land on the right child", () => {
      const result: Map<string, ChildAggregate> = aggregateBuckets([
        { siteId: "marketA", healthState: "healthy", deviceCount: 50 },
        { siteId: "unit1", healthState: "down", deviceCount: 7 },
        // Two levels down, under closet.
        { siteId: "unit3", healthState: "degraded", deviceCount: 200 },
        { siteId: "unitB", healthState: "healthy", deviceCount: 11 },
        // The requested level itself, and a site outside the subtree.
        { siteId: "parent", healthState: "down", deviceCount: 9999 },
        { siteId: "elsewhere", healthState: "down", deviceCount: 9999 },
      ]);
      expect(result.get("marketA")!.deviceCount).toBe(257);
      expect(result.get("marketA")!.deviceStats).toEqual({
        total: 257,
        down: 7,
        degraded: 200,
        healthy: 50,
        unknown: 0,
      });
      expect(result.get("unitB")!.deviceCount).toBe(11);
      expect(result.get("emptyC")!.deviceCount).toBe(0);
    });

    /*
     * A bucket can legitimately be empty — a grouped aggregate over a
     * filtered set answers with the combination and a count of zero rather
     * than omitting the row. Adding one per row would invent a device that
     * does not exist, and if its verdict were "down" it would put a red badge
     * on a site holding nothing at all.
     */
    test("a bucket of zero devices contributes nothing", () => {
      const result: Map<string, ChildAggregate> = aggregateBuckets([
        { siteId: "unitB", healthState: "down", deviceCount: 0 },
        { siteId: "unitB", healthState: "healthy", deviceCount: 5 },
      ]);
      expect(result.get("unitB")!.deviceCount).toBe(5);
      expect(result.get("unitB")!.deviceStats).toEqual({
        total: 5,
        down: 0,
        degraded: 0,
        healthy: 5,
        unknown: 0,
      });
    });

    /*
     * The regression, at the scale it happens at. Buckets are few BY DESIGN
     * — that is the whole point of grouping — so a count of rows is not a
     * little wrong, it is three orders of magnitude wrong, and it still reads
     * as a perfectly ordinary number on a card.
     */
    test("counting rows instead of devices is not a rounding error", () => {
      const buckets: Array<DeviceAttachmentRow> = [
        { siteId: "unit1", healthState: "healthy", deviceCount: 38000 },
        { siteId: "unit2", healthState: "down", deviceCount: 1500 },
        { siteId: "unit3", healthState: "degraded", deviceCount: 500 },
      ];
      const result: Map<string, ChildAggregate> = aggregateBuckets(buckets);
      expect(result.get("marketA")!.deviceCount).toBe(40000);
      expect(result.get("marketA")!.deviceCount).not.toBe(buckets.length);
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
    { siteId: "dc1", healthState: "down", deviceCount: 1 },
    { siteId: "dc1", healthState: "healthy", deviceCount: 1 },
    { siteId: "dc1", healthState: "degraded", deviceCount: 1 },
    { siteId: "store7", healthState: "healthy", deviceCount: 1 },
    { siteId: "store8", healthState: "unknown", deviceCount: 1 },
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

  /*
   * The level's own devices arrive as buckets too, from the same grouped
   * aggregate as every other row — so this helper multiplies as well.
   *
   * The fixtures above all carry deviceCount: 1, which is exactly the case
   * that cannot distinguish a tally that adds one per row from one that adds
   * the row's count. A distribution centre with 276 core switches would print
   * "3 devices" and read as a rounding-error site instead of the biggest
   * concentration of hardware on the level.
   */
  test("counts a bucket's devices, not the bucket", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(
        [
          { siteId: "dc1", healthState: "down", deviceCount: 4 },
          { siteId: "dc1", healthState: "healthy", deviceCount: 260 },
          { siteId: "dc1", healthState: "degraded", deviceCount: 12 },
          { siteId: "store7", healthState: "healthy", deviceCount: 9999 },
        ],
        new Set<string>(["dc1"]),
      ),
    ).toEqual({
      total: 276,
      down: 4,
      degraded: 12,
      healthy: 260,
      unknown: 0,
    });
  });

  test("a bucket of zero devices adds nothing to the level's tally", () => {
    expect(
      NetworkSiteHierarchyUtil.tallyDeviceHealth(
        [
          { siteId: "dc1", healthState: "down", deviceCount: 0 },
          { siteId: "dc1", healthState: "healthy", deviceCount: 2 },
        ],
        new Set<string>(["dc1"]),
      ),
    ).toEqual({
      total: 2,
      down: 0,
      degraded: 0,
      healthy: 2,
      unknown: 0,
    });
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

/*
 * splitSearchWords turns the search box's text into the words that
 * POST /network-site/search ANDs together, one ILIKE per word.
 *
 * Issue #3981 was a search that only looked at the level on screen. The fix
 * sends the same text to a hierarchy-wide query, and that only helps if the
 * query agrees with the level-local filter on what "matches" means: every
 * word, in any order, case-blind. So "michigan 104822" has to find
 * "Unit 104822 - Michigan Ave" four levels down, exactly as it narrows the
 * cards on the level in view. The blocks below pin the rules that agreement
 * rests on, and the cap that keeps a pasted paragraph from becoming a hundred
 * ILIKEs over the project's sites.
 */
describe("splitSearchWords", () => {
  function split(text: string): Array<string> {
    return NetworkSiteHierarchyUtil.splitSearchWords(text);
  }

  /*
   * The endpoint's match rule — every word is a case-blind substring of the
   * name — in plain TypeScript, so a test can say whether a site would still
   * be found by a given set of words.
   */
  function nameMatchesEvery(name: string, words: Array<string>): boolean {
    const folded: string = name.toLowerCase();
    return words.every((word: string): boolean => {
      return folded.includes(word);
    });
  }

  /*
   * Lower-cased, de-duplicated words in first-occurrence order: everything
   * splitSearchWords does short of the cap. The oracle the capping checks
   * compare against.
   */
  function uniqueWordsOf(text: string): Array<string> {
    const unique: Array<string> = [];
    for (const token of text.toLowerCase().split(/\s+/)) {
      if (token.length > 0 && !unique.includes(token)) {
        unique.push(token);
      }
    }
    return unique;
  }

  /*
   * The hand-written fixtures below count their words against 8. If the cap
   * moves they have to be re-derived, rather than silently testing some other
   * boundary. The generated checks further down are written against the
   * constant and keep holding either way.
   */
  test("the cap is a handful of words", () => {
    expect(MAX_SEARCH_WORDS).toBe(8);
  });

  /*
   * Whitespace, and only whitespace, separates words. People type double
   * spaces and paste names out of spreadsheets (tabs) and tickets (newlines,
   * non-breaking spaces); none of that may turn into an empty word, because
   * an empty word is an ILIKE '%%' that matches every site in the project.
   */
  describe("splitting", () => {
    test("splits on whitespace into the words to AND together", () => {
      expect(split("michigan 104822")).toEqual(["michigan", "104822"]);
      expect(split("kansas")).toEqual(["kansas"]);
    });

    test("treats runs of spaces, tabs and newlines as one separator", () => {
      expect(split("  Unit \t\t 104822\n\nMichigan\r\nAve  ")).toEqual([
        "unit",
        "104822",
        "michigan",
        "ave",
      ]);
      expect(split("a\vb\fc")).toEqual(["a", "b", "c"]);
    });

    test("non-breaking and other Unicode spaces separate words too", () => {
      expect(split("unit 104822 michigan　ave")).toEqual([
        "unit",
        "104822",
        "michigan",
        "ave",
      ]);
    });

    test("empty and whitespace-only text has no words", () => {
      expect(split("")).toEqual([]);
      expect(split(" ")).toEqual([]);
      expect(split("     ")).toEqual([]);
      expect(split("\t\n  \r\n")).toEqual([]);
      expect(split(" 　")).toEqual([]);
    });

    /*
     * The parameter is typed string, but the guard in the source exists for
     * a body that slipped past normalization — it must read as no search,
     * not throw.
     */
    test("a missing value at runtime reads as no words", () => {
      expect(split(undefined as unknown as string)).toEqual([]);
      expect(split(null as unknown as string)).toEqual([]);
    });

    test("never returns an empty word, whatever the whitespace", () => {
      const awkward: Array<string> = [
        " leading",
        "trailing ",
        "  both  ",
        "a  b",
        "\ta\t\tb\t",
        "\n\na\n",
        "\r\n",
        "a   b",
      ];
      for (const text of awkward) {
        for (const word of split(text)) {
          expect(word).not.toBe("");
          expect(word).not.toMatch(/\s/);
        }
      }
    });

    /*
     * Punctuation is part of a name ("104822-Michigan", "St. Louis",
     * "O'Hare"), and splitting on it would make "104822-michigan" also match
     * a site called "Michigan 104822". LIKE wildcards stay in too: escaping
     * them is QueryHelper.searchAllWords' job, so the split must hand them
     * over untouched.
     */
    test("punctuation stays inside a word", () => {
      expect(split("104822-Michigan")).toEqual(["104822-michigan"]);
      expect(split("St. Louis, MO")).toEqual(["st.", "louis,", "mo"]);
      expect(split("O'Hare")).toEqual(["o'hare"]);
      expect(split("100% a_b back\\slash")).toEqual([
        "100%",
        "a_b",
        "back\\slash",
      ]);
    });
  });

  /*
   * Case never matters to the ILIKE, so it must not matter here either:
   * lower-casing is what lets "Kansas" and "KANSAS" collapse into one word
   * instead of two identical ILIKEs.
   */
  describe("case and duplicates", () => {
    test("lower-cases every word", () => {
      expect(split("Kansas CITY")).toEqual(["kansas", "city"]);
      expect(split("UNIT 104822 MiChIgAn")).toEqual([
        "unit",
        "104822",
        "michigan",
      ]);
    });

    test("de-duplicates case-blind, keeping first-occurrence order", () => {
      expect(split("Kansas city KANSAS City kansas")).toEqual([
        "kansas",
        "city",
      ]);
      expect(split("b a B c A")).toEqual(["b", "a", "c"]);
    });

    /*
     * Duplicates are collapsed BEFORE the cap is applied. Otherwise sixteen
     * tokens that are eight words repeated would lose words they never
     * needed to lose.
     */
    test("repeats do not count toward the cap", () => {
      const eight: Array<string> = [
        "unit",
        "104822",
        "michigan",
        "ave",
        "kansas",
        "city",
        "mo",
        "us",
      ];
      const doubled: string = `${eight.join(" ")} ${eight.join(" ").toUpperCase()}`;
      expect(split(doubled)).toEqual(eight);
    });

    /*
     * Saying a short word nine times does not make it a better filter. The
     * cap ranks unique words by length alone.
     */
    test("repetition does not earn a word a slot", () => {
      expect(split("a a a a a a a a a bb cc dd ee ff gg hh ii")).toEqual([
        "bb",
        "cc",
        "dd",
        "ee",
        "ff",
        "gg",
        "hh",
        "ii",
      ]);
    });
  });

  /*
   * Site names are customer data and plenty of them are not English. A
   * lower-case that only knew A-Z would leave "ZÜRICH" and "zürich" as two
   * different words, and the level-local filter (which folds with the same
   * toLowerCase) would disagree with the endpoint.
   */
  describe("non-ASCII words", () => {
    test("lower-cases accented Latin letters", () => {
      expect(split("Zürich Überlingen")).toEqual(["zürich", "überlingen"]);
      expect(split("SÃO PAULO ÅLESUND")).toEqual(["são", "paulo", "ålesund"]);
      expect(split("Straße")).toEqual(["straße"]);
    });

    test("lower-cases other scripts", () => {
      expect(split("МОСКВА")).toEqual(["москва"]);
      expect(split("ΑΘΗΝΑ")).toEqual(["αθηνα"]);
      expect(split("東京 Store")).toEqual(["東京", "store"]);
    });

    test("de-duplicates non-ASCII words case-blind", () => {
      expect(split("ZÜRICH zürich Zürich")).toEqual(["zürich"]);
    });
  });

  /*
   * Past MAX_SEARCH_WORDS, the longest words are kept: they narrow the match
   * most. The kept words stay in the reader's order, and a tie in length goes
   * to the earlier word, so the same text always produces the same query.
   */
  describe("the word cap", () => {
    test("exactly MAX_SEARCH_WORDS words are kept intact", () => {
      expect(split("Unit 104822 Michigan Ave Kansas City MO US")).toEqual([
        "unit",
        "104822",
        "michigan",
        "ave",
        "kansas",
        "city",
        "mo",
        "us",
      ]);

      // Short words included: under the cap, nothing is ranked or dropped.
      const atCap: Array<string> = Array.from(
        { length: MAX_SEARCH_WORDS },
        (_value: unknown, index: number): string => {
          return "x".repeat(MAX_SEARCH_WORDS - index);
        },
      );
      expect(split(atCap.join(" "))).toEqual(atCap);
    });

    test("one word over the cap drops the shortest, the later of a tie", () => {
      expect(
        split("Unit 104822 Michigan Ave Kansas City MO US Midwest"),
      ).toEqual([
        "unit",
        "104822",
        "michigan",
        "ave",
        "kansas",
        "city",
        "mo",
        "midwest",
      ]);
    });

    test("keeps the longest words, in the reader's order", () => {
      /*
       * Lengths: a1 unit4 104822:6 in2 the3 michigan8 ave3 area4 of2 kansas6
       * city4. The eight longest are everything but "a", "in" and "of" —
       * returned where they were typed, not longest-first.
       */
      expect(
        split("a unit 104822 in the michigan ave area of kansas city"),
      ).toEqual([
        "unit",
        "104822",
        "the",
        "michigan",
        "ave",
        "area",
        "kansas",
        "city",
      ]);
    });

    test("a tie at the boundary goes to the earlier word", () => {
      /*
       * Five words of length 4+ fill five slots; three of the four
       * two-letter words fill the rest. "vv" is the latest of those, so it
       * goes, and "x" goes for being shortest even though it came first.
       */
      expect(split("x yy north zz south ww east west vv kansas")).toEqual([
        "yy",
        "north",
        "zz",
        "south",
        "ww",
        "east",
        "west",
        "kansas",
      ]);
    });

    /*
     * Position, not alphabet, breaks the tie: reversing a run of equal-length
     * words flips which ones survive.
     */
    test("tie-breaking follows position, not alphabetical order", () => {
      expect(split("aa bb cc dd ee ff gg hh ii jj")).toEqual([
        "aa",
        "bb",
        "cc",
        "dd",
        "ee",
        "ff",
        "gg",
        "hh",
      ]);
      expect(split("jj ii hh gg ff ee dd cc bb aa")).toEqual([
        "jj",
        "ii",
        "hh",
        "gg",
        "ff",
        "ee",
        "dd",
        "cc",
      ]);
    });

    test("the longest word survives wherever it was typed", () => {
      const filler: string = "a b c d e f g h i j k l";
      expect(split(`${filler} michigan`)).toContain("michigan");
      expect(split(`michigan ${filler}`)).toContain("michigan");
      expect(split(`a b c d e f michigan g h i j k l`)).toContain("michigan");
    });

    test("the same text always produces the same words", () => {
      const text: string =
        "north south east west up down left right in out on off";
      expect(split(text)).toEqual(split(text));
    });

    /*
     * The safety argument for the cap: every kept word came from the input,
     * so any site whose name matched all the typed words still matches the
     * kept ones. Dropping a word can only let MORE sites through — never hide
     * a site that matched.
     */
    test("dropping a word only ever widens the search", () => {
      const query: string =
        "Unit 104822 Michigan Ave Kansas City MO US Midwest";
      const allWords: Array<string> = uniqueWordsOf(query);
      const kept: Array<string> = split(query);
      expect(kept.length).toBeLessThan(allWords.length);

      for (const word of kept) {
        expect(allWords).toContain(word);
        expect(query.toLowerCase()).toContain(word);
      }

      const fullMatch: string =
        "Unit 104822 Michigan Ave, Kansas City MO, US Midwest";
      expect(nameMatchesEvery(fullMatch, allWords)).toBe(true);
      expect(nameMatchesEvery(fullMatch, kept)).toBe(true);

      // Missing only the dropped "us": excluded before, admitted now.
      const missingDropped: string =
        "Unit 104822 Michigan Ave, Kansas City MO, Midwest";
      expect(nameMatchesEvery(missingDropped, allWords)).toBe(false);
      expect(nameMatchesEvery(missingDropped, kept)).toBe(true);
    });
  });

  /*
   * The endpoint runs normalizeSearchText first and splits what is left, so
   * the two have to compose. The worst case the length cap allows — 200
   * characters of one-letter words, a hundred of them — must still come out
   * as at most MAX_SEARCH_WORDS ILIKEs.
   */
  describe("composed with normalizeSearchText", () => {
    const letters: string = "abcdefghijklmnopqrstuvwxyz";

    function oneLetterWords(count: number): string {
      return Array.from(
        { length: count },
        (_value: unknown, index: number): string => {
          return letters.charAt(index % letters.length);
        },
      ).join(" ");
    }

    test("a capped string of one-letter words yields at most the cap", () => {
      const normalized: string = NetworkSiteHierarchyUtil.normalizeSearchText(
        `   ${oneLetterWords(150)}   `,
      );
      expect(normalized).toHaveLength(MAX_SEARCH_TEXT_LENGTH);

      const words: Array<string> = split(normalized);
      expect(words).toHaveLength(MAX_SEARCH_WORDS);
      expect(words).toEqual(letters.slice(0, MAX_SEARCH_WORDS).split(""));
    });

    test("a real word inside the capped string wins a slot", () => {
      // 90 one-letter words are 179 characters; " michigan" fits under 200.
      const normalized: string = NetworkSiteHierarchyUtil.normalizeSearchText(
        `${oneLetterWords(90)} michigan`,
      );
      expect(normalized.length).toBeLessThanOrEqual(MAX_SEARCH_TEXT_LENGTH);
      expect(split(normalized)).toEqual([
        ...letters.slice(0, MAX_SEARCH_WORDS - 1).split(""),
        "michigan",
      ]);
    });

    /*
     * The length cap can cut the last word short. The fragment is a prefix
     * of what was typed, so it too can only widen the match.
     */
    test("a word cut short by the length cap is searched as its prefix", () => {
      const normalized: string = NetworkSiteHierarchyUtil.normalizeSearchText(
        `${"q ".repeat(95)}${"z".repeat(20)}`,
      );
      expect(normalized).toHaveLength(MAX_SEARCH_TEXT_LENGTH);
      expect(split(normalized)).toEqual(["q", "z".repeat(10)]);
    });

    test("normalized text splits the way the endpoint uses it", () => {
      expect(
        split(
          NetworkSiteHierarchyUtil.normalizeSearchText("  Michigan  104822\n"),
        ),
      ).toEqual(["michigan", "104822"]);
    });

    /*
     * Blank and non-string bodies normalize to "", and "" must split to no
     * words: searchAllWords turns zero words into a query that matches
     * nothing, rather than one that matches everything.
     */
    test("a blank or non-string body ends in no words", () => {
      const bodies: Array<unknown> = [
        "",
        "   ",
        "\t\n",
        undefined,
        null,
        42,
        {},
      ];
      for (const body of bodies) {
        expect(
          split(NetworkSiteHierarchyUtil.normalizeSearchText(body)),
        ).toEqual([]);
      }
    });
  });

  /*
   * The hand-written cases above cover the boundaries the author thought of.
   * This batch throws a few hundred seeded, reproducible inputs at the
   * function — mixed case, punctuation, non-ASCII, every kind of whitespace,
   * from zero words to well past the cap — and checks the properties that
   * must hold for all of them.
   */
  describe("generated inputs", () => {
    type RandomSource = () => number;

    // mulberry32: tiny, seedable, and the same sequence on every machine.
    function seededRandom(seed: number): RandomSource {
      let state: number = seed >>> 0;
      return (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed: number = state;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
      };
    }

    function pick<T>(random: RandomSource, items: Array<T>): T {
      return items[Math.floor(random() * items.length)] as T;
    }

    const vocabulary: Array<string> = [
      "unit",
      "Unit",
      "UNIT",
      "104822",
      "michigan",
      "Michigan",
      "ave",
      "kansas",
      "City",
      "st.",
      "104822-michigan",
      "o'hare",
      "Zürich",
      "ÜBERLINGEN",
      "café",
      "100%",
      "a_b",
      "a",
      "b",
      "x",
      "north",
      "south",
      "east",
      "west",
      "store",
      "market",
      "region",
      "Region",
      "acme",
      "ACME",
    ];

    const alphabet: string =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._'#äöüÄÖÜ";

    const separators: Array<string> = [
      " ",
      "  ",
      "\t",
      "\n",
      "\r\n",
      " \t ",
      " ",
      "　",
    ];

    function randomWord(random: RandomSource): string {
      if (random() < 0.5) {
        return pick(random, vocabulary);
      }
      const length: number = 1 + Math.floor(random() * 12);
      let word: string = "";
      for (let index: number = 0; index < length; index++) {
        word += alphabet.charAt(Math.floor(random() * alphabet.length));
      }
      return word;
    }

    function randomQuery(random: RandomSource): string {
      const wordCount: number = Math.floor(random() * 31);
      let text: string = random() < 0.3 ? pick(random, separators) : "";
      for (let index: number = 0; index < wordCount; index++) {
        if (index > 0) {
          text += pick(random, separators);
        }
        text += randomWord(random);
      }
      if (random() < 0.3) {
        text += pick(random, separators);
      }
      return text;
    }

    function lengthOf(word: string): number {
      return word.length;
    }

    type Outcome = "under-cap" | "capped" | "capped-at-a-tie";

    // Every property one input must satisfy; returns which branch it hit.
    function checkSplit(input: string): Outcome {
      const words: Array<string> = split(input);
      const unique: Array<string> = uniqueWordsOf(input);

      expect(words.length).toBeLessThanOrEqual(MAX_SEARCH_WORDS);
      expect(new Set<string>(words).size).toBe(words.length);

      for (const word of words) {
        expect(word.length).toBeGreaterThan(0);
        expect(word).not.toMatch(/\s/);
        expect(word).toBe(word.toLowerCase());
        expect(unique).toContain(word);
        expect(input.toLowerCase()).toContain(word);
      }

      // Kept words come back in the order they were typed.
      const positions: Array<number> = words.map((word: string): number => {
        return unique.indexOf(word);
      });
      expect(positions).toEqual(
        [...positions].sort((a: number, b: number): number => {
          return a - b;
        }),
      );

      // Re-splitting the kept words is a no-op: they are already final.
      expect(split(words.join(" "))).toEqual(words);

      if (unique.length <= MAX_SEARCH_WORDS) {
        expect(words).toEqual(unique);
        return "under-cap";
      }

      expect(words).toHaveLength(MAX_SEARCH_WORDS);

      const dropped: Array<string> = unique.filter((word: string): boolean => {
        return !words.includes(word);
      });
      const shortestKept: number = Math.min(...words.map(lengthOf));
      const longestDropped: number = Math.max(...dropped.map(lengthOf));
      expect(shortestKept).toBeGreaterThanOrEqual(longestDropped);

      if (shortestKept !== longestDropped) {
        return "capped";
      }

      // At the boundary length, every kept word precedes every dropped one.
      const keptAtBoundary: Array<number> = words
        .filter((word: string): boolean => {
          return word.length === shortestKept;
        })
        .map((word: string): number => {
          return unique.indexOf(word);
        });
      const droppedAtBoundary: Array<number> = dropped
        .filter((word: string): boolean => {
          return word.length === shortestKept;
        })
        .map((word: string): number => {
          return unique.indexOf(word);
        });
      expect(Math.min(...droppedAtBoundary)).toBeGreaterThan(
        Math.max(...keptAtBoundary),
      );
      return "capped-at-a-tie";
    }

    test("every generated input satisfies the split's properties", () => {
      const random: RandomSource = seededRandom(3981);
      const seen: Map<Outcome, number> = new Map<Outcome, number>();

      for (let run: number = 0; run < 400; run++) {
        const outcome: Outcome = checkSplit(randomQuery(random));
        seen.set(outcome, (seen.get(outcome) || 0) + 1);
      }

      /*
       * Guard against a generator that never reaches the interesting cases:
       * the batch must have exercised the pass-through, the cap and a tie at
       * the cap's boundary.
       */
      expect(seen.get("under-cap") || 0).toBeGreaterThan(0);
      expect(seen.get("capped") || 0).toBeGreaterThan(0);
      expect(seen.get("capped-at-a-tie") || 0).toBeGreaterThan(0);
    });

    test("every generated normalized input stays within the cap", () => {
      const random: RandomSource = seededRandom(20260926);

      for (let run: number = 0; run < 200; run++) {
        // Glue several queries together so many exceed the length cap.
        const raw: string = `${randomQuery(random)} ${randomQuery(random)} ${randomQuery(random)}`;
        const normalized: string =
          NetworkSiteHierarchyUtil.normalizeSearchText(raw);
        expect(normalized.length).toBeLessThanOrEqual(MAX_SEARCH_TEXT_LENGTH);
        checkSplit(normalized);
      }
    });
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
