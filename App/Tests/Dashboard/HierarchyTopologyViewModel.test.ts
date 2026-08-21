import { describe, expect, test } from "@jest/globals";
import {
  DeviceHealthCounts,
  emptyDeviceHealthCounts,
} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";
import { SiteChildView } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";
import {
  ALL_SITE_TOPOLOGY_FILTER_MODES,
  FlatFallbackReason,
  HierarchyTopologyView,
  HierarchyTopologyViewInput,
  SITE_TOPOLOGY_STATE_COLORS,
  SiteTopologyFilterOption,
  SiteTopologyHealthState,
  SiteTopologyHealthSummary,
  TOPOLOGY_DEVICES_PARAM,
  TOPOLOGY_SITE_PARAM,
  TopologyDrillState,
  buildSiteTopologyFilterOptions,
  canShowDeviceView,
  describeDeviceCounts,
  describeSiteTopologyFilter,
  describeUnattachedDevices,
  filterSitesByTopologyHealth,
  firstMatchingSiteId,
  flatFallbackReason,
  isSiteTopologyFilterActive,
  parseTopologyDrillState,
  resolveHierarchyTopologyView,
  siteTopologyCountForMode,
  siteTopologyHealthState,
  siteTopologyStateMatchesMode,
  summarizeSiteTopologyHealth,
} from "../../FeatureSet/Dashboard/src/Components/Topology/HierarchyTopologyViewModel";

/*
 * Issue #3320 — the hierarchy-first topology explorer, one claim at a time.
 *
 * The whole change is an argument that an operator with 21,700 devices
 * across 949 sites is better served by levels than by one graph. Every part
 * of that argument that can be wrong is pinned here: which view a level
 * resolves to, what a site's health means when it is rolled up from
 * devices, what a filter is allowed to hide, and what the page SAYS about
 * how much of the estate the reader is looking at.
 *
 * The tests that matter most are the ones about not hiding things. A
 * drill-down that quietly omits a site is the same failure as a map that
 * quietly drops a node, and it is much harder to notice.
 */

type MakeCountsFunction = (
  overrides?: Partial<DeviceHealthCounts>,
) => DeviceHealthCounts;

const makeCounts: MakeCountsFunction = (
  overrides?: Partial<DeviceHealthCounts>,
): DeviceHealthCounts => {
  const counts: DeviceHealthCounts = {
    ...emptyDeviceHealthCounts(),
    ...overrides,
  };
  counts.total = Math.max(
    counts.total,
    counts.down + counts.degraded + counts.healthy + counts.unknown,
  );
  return counts;
};

type MakeSiteFunction = (
  id: string,
  overrides?: Partial<SiteChildView>,
) => SiteChildView;

const makeSite: MakeSiteFunction = (
  id: string,
  overrides?: Partial<SiteChildView>,
): SiteChildView => {
  return {
    id: id,
    name: id,
    siteType: "Market",
    isUnitLevel: false,
    currentMonitorStatus: undefined,
    childSiteCount: 0,
    deviceCount: 0,
    deviceStats: emptyDeviceHealthCounts(),
    unitStats: { totalUnits: 0, operationalUnits: 0 },
    uptimePercent: null,
    ...overrides,
  };
};

type MakeViewInputFunction = (
  overrides?: Partial<HierarchyTopologyViewInput>,
) => HierarchyTopologyViewInput;

const makeViewInput: MakeViewInputFunction = (
  overrides?: Partial<HierarchyTopologyViewInput>,
): HierarchyTopologyViewInput => {
  return {
    isAtRoot: true,
    isUnitLevel: false,
    childCount: 5,
    attachedDeviceCount: 120,
    requestedDeviceView: false,
    ...overrides,
  };
};

/*
 * ------------------------------------------------------------------
 * Which view a level resolves to
 * ------------------------------------------------------------------
 */

describe("resolveHierarchyTopologyView", () => {
  test("a root with sites and attached devices opens on the hierarchy", () => {
    expect(resolveHierarchyTopologyView(makeViewInput())).toBe("hierarchy");
  });

  /*
   * The user's requirement in its plainest form: no entities to hang the
   * network off, so there is nothing to drill through and the flat map is
   * the only honest thing to draw.
   */
  test("a project with no sites falls back to the flat map", () => {
    expect(resolveHierarchyTopologyView(makeViewInput({ childCount: 0 }))).toBe(
      "flat",
    );
  });

  test("sites that hold no devices fall back to the flat map", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ childCount: 40, attachedDeviceCount: 0 }),
      ),
    ).toBe("flat");
  });

  test("one attached device anywhere is enough to earn the hierarchy", () => {
    expect(
      resolveHierarchyTopologyView(makeViewInput({ attachedDeviceCount: 1 })),
    ).toBe("hierarchy");
  });

  test("a drilled level with children stays on the hierarchy", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ isAtRoot: false, childCount: 12 }),
      ),
    ).toBe("hierarchy");
  });

  test("the bottom of a drill opens the site's device topology", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ isAtRoot: false, childCount: 0 }),
      ),
    ).toBe("topology");
  });

  /*
   * A unit is where devices live. It opens its devices even when somebody
   * has modelled sites underneath it, because that is what the Network Map
   * page does at the same depth — and two pages disagreeing about what a
   * "Store" opens into is worse than either choice.
   */
  test("a unit-level site opens its devices even with children below it", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ isAtRoot: false, isUnitLevel: true, childCount: 7 }),
      ),
    ).toBe("topology");
  });

  test("isUnitLevel is ignored at the root, which is not a site", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ isAtRoot: true, isUnitLevel: true }),
      ),
    ).toBe("hierarchy");
  });

  test("asking for devices wins over everything else", () => {
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({ requestedDeviceView: true }),
      ),
    ).toBe("flat");
    expect(
      resolveHierarchyTopologyView(
        makeViewInput({
          isAtRoot: false,
          childCount: 30,
          requestedDeviceView: true,
        }),
      ),
    ).toBe("topology");
  });

  /*
   * The "no attached devices" fallback is a ROOT decision only. Once
   * somebody has drilled into a branch they are owed what is actually under
   * it — bouncing them out to a project-wide map because that one branch is
   * empty would throw away the navigation they just did.
   */
  test("an empty branch below the root is not bounced out to the flat map", () => {
    const view: HierarchyTopologyView = resolveHierarchyTopologyView(
      makeViewInput({
        isAtRoot: false,
        childCount: 4,
        attachedDeviceCount: 0,
      }),
    );
    expect(view).toBe("hierarchy");
  });
});

describe("flatFallbackReason", () => {
  test("names the reason so the page can explain itself", () => {
    expect(flatFallbackReason(makeViewInput({ childCount: 0 }))).toBe(
      "no-sites",
    );
    expect(flatFallbackReason(makeViewInput({ attachedDeviceCount: 0 }))).toBe(
      "no-attached-devices",
    );
    expect(
      flatFallbackReason(makeViewInput({ requestedDeviceView: true })),
    ).toBe("requested");
  });

  test("is null when the root is not falling back at all", () => {
    const reason: FlatFallbackReason = flatFallbackReason(makeViewInput());
    expect(reason).toBeNull();
  });

  test("is null anywhere below the root — a drill is never a fallback", () => {
    expect(
      flatFallbackReason(makeViewInput({ isAtRoot: false, childCount: 0 })),
    ).toBeNull();
  });

  /*
   * An explicit request is reported before the structural reasons. A reader
   * who pressed "All devices" does not need to be told their project has no
   * sites — they can see the button they pressed.
   */
  test("an explicit request outranks the structural reasons", () => {
    expect(
      flatFallbackReason(
        makeViewInput({ childCount: 0, requestedDeviceView: true }),
      ),
    ).toBe("requested");
  });
});

describe("canShowDeviceView", () => {
  test("the root always offers the way back to the flat map", () => {
    expect(
      canShowDeviceView({
        view: "hierarchy",
        isAtRoot: true,
        ownDeviceCount: 0,
      }),
    ).toBe(true);
  });

  test("a container offers it only when it holds devices of its own", () => {
    expect(
      canShowDeviceView({
        view: "hierarchy",
        isAtRoot: false,
        ownDeviceCount: 0,
      }),
    ).toBe(false);
    expect(
      canShowDeviceView({
        view: "hierarchy",
        isAtRoot: false,
        ownDeviceCount: 3,
      }),
    ).toBe(true);
  });

  test("a view that is already a device graph does not offer it again", () => {
    expect(
      canShowDeviceView({ view: "flat", isAtRoot: true, ownDeviceCount: 9 }),
    ).toBe(false);
    expect(
      canShowDeviceView({
        view: "topology",
        isAtRoot: false,
        ownDeviceCount: 9,
      }),
    ).toBe(false);
  });
});

/*
 * ------------------------------------------------------------------
 * A site's health, rolled up from its devices
 * ------------------------------------------------------------------
 */

describe("siteTopologyHealthState", () => {
  test("one down device below it makes the site down", () => {
    expect(
      siteTopologyHealthState(
        makeSite("m1", {
          deviceStats: makeCounts({ down: 1, healthy: 200 }),
        }),
      ),
    ).toBe("down");
  });

  test("dark ports with nothing hard-down make the site degraded", () => {
    expect(
      siteTopologyHealthState(
        makeSite("m1", {
          deviceStats: makeCounts({ degraded: 2, healthy: 9 }),
        }),
      ),
    ).toBe("degraded");
  });

  test("down outranks degraded", () => {
    expect(
      siteTopologyHealthState(
        makeSite("m1", { deviceStats: makeCounts({ down: 1, degraded: 40 }) }),
      ),
    ).toBe("down");
  });

  test("a site whose devices all answer is healthy", () => {
    expect(
      siteTopologyHealthState(
        makeSite("m1", { deviceStats: makeCounts({ healthy: 12 }) }),
      ),
    ).toBe("healthy");
  });

  /*
   * The franchise case: a region whose own monitor is perfectly green while
   * four of its stores are dark. The unit rollup is the only thing that
   * knows, and it must survive into this level's state or the row a reader
   * came for is filtered away.
   */
  test("dark units below a site surface even with no device complaining", () => {
    expect(
      siteTopologyHealthState(
        makeSite("region", {
          unitStats: { totalUnits: 200, operationalUnits: 196 },
        }),
      ),
    ).toBe("degraded");
  });

  test("a site whose own monitor is not operational surfaces too", () => {
    expect(
      siteTopologyHealthState(
        makeSite("store", {
          currentMonitorStatus: {
            id: "s1",
            name: "Offline",
            color: "#dc2626",
            priority: 3,
            isOperationalState: false,
          },
        }),
      ),
    ).toBe("degraded");
  });

  /*
   * "Down" has to mean the same thing at both levels of the product. A
   * device that does not answer is down; a site-level complaint with no
   * such device is real but softer, and calling it "down" would make the
   * word useless on the level below.
   */
  test("a site-level complaint alone never claims a device is down", () => {
    expect(
      siteTopologyHealthState(
        makeSite("region", {
          unitStats: { totalUnits: 10, operationalUnits: 0 },
        }),
      ).valueOf(),
    ).not.toBe("down");
  });

  test("a site with an operational status and no devices is healthy", () => {
    expect(
      siteTopologyHealthState(
        makeSite("store", {
          currentMonitorStatus: {
            id: "s1",
            name: "Operational",
            color: "#16a34a",
            priority: 1,
            isOperationalState: true,
          },
        }),
      ),
    ).toBe("healthy");
  });

  test("a site nobody has judged at all is unknown, not healthy", () => {
    expect(siteTopologyHealthState(makeSite("new"))).toBe("unknown");
  });

  test("a site row that is missing entirely is unknown rather than a crash", () => {
    expect(siteTopologyHealthState(null as unknown as SiteChildView)).toBe(
      "unknown",
    );
  });

  /*
   * A payload from a server that predates deviceStats narrows to undefined
   * on that field. The classifier has to keep working — the level still has
   * a site rollup to reason with.
   */
  test("a row with no deviceStats at all still classifies from the site rollup", () => {
    const legacyRow: SiteChildView = makeSite("legacy", {
      unitStats: { totalUnits: 4, operationalUnits: 1 },
    });
    delete (legacyRow as unknown as { deviceStats?: DeviceHealthCounts })
      .deviceStats;
    expect(siteTopologyHealthState(legacyRow)).toBe("degraded");
  });
});

describe("siteTopologyStateMatchesMode", () => {
  test("all matches everything, including unknown", () => {
    const states: Array<SiteTopologyHealthState> = [
      "down",
      "degraded",
      "healthy",
      "unknown",
    ];
    for (const state of states) {
      expect(siteTopologyStateMatchesMode(state, "all")).toBe(true);
    }
  });

  test("attention is exactly the union of down and degraded", () => {
    expect(siteTopologyStateMatchesMode("down", "attention")).toBe(true);
    expect(siteTopologyStateMatchesMode("degraded", "attention")).toBe(true);
    expect(siteTopologyStateMatchesMode("healthy", "attention")).toBe(false);
    expect(siteTopologyStateMatchesMode("unknown", "attention")).toBe(false);
  });

  test("down and degraded are each exactly themselves", () => {
    expect(siteTopologyStateMatchesMode("down", "down")).toBe(true);
    expect(siteTopologyStateMatchesMode("degraded", "down")).toBe(false);
    expect(siteTopologyStateMatchesMode("degraded", "degraded")).toBe(true);
    expect(siteTopologyStateMatchesMode("down", "degraded")).toBe(false);
  });

  test("every declared mode is one this function actually handles", () => {
    for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
      expect(typeof siteTopologyStateMatchesMode("down", mode)).toBe("boolean");
    }
  });

  test("only 'all' is inactive", () => {
    expect(isSiteTopologyFilterActive("all")).toBe(false);
    expect(isSiteTopologyFilterActive("attention")).toBe(true);
    expect(isSiteTopologyFilterActive("down")).toBe(true);
    expect(isSiteTopologyFilterActive("degraded")).toBe(true);
  });
});

/*
 * ------------------------------------------------------------------
 * Summarizing and filtering a level
 * ------------------------------------------------------------------
 */

const LEVEL: Array<SiteChildView> = [
  makeSite("kc", {
    name: "Kansas City",
    deviceStats: makeCounts({ down: 2, healthy: 46 }),
  }),
  makeSite("stl", {
    name: "St. Louis",
    deviceStats: makeCounts({ degraded: 1, healthy: 29 }),
  }),
  makeSite("den", {
    name: "Denver",
    deviceStats: makeCounts({ healthy: 30 }),
  }),
  makeSite("phx", { name: "Phoenix" }),
];

describe("summarizeSiteTopologyHealth", () => {
  test("counts SITES by state, and devices alongside them", () => {
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(LEVEL);
    expect(summary.total).toBe(4);
    expect(summary.down).toBe(1);
    expect(summary.degraded).toBe(1);
    expect(summary.healthy).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.devices.total).toBe(108);
    expect(summary.devices.down).toBe(2);
    expect(summary.devices.degraded).toBe(1);
  });

  test("attention is down plus degraded, counted over sites", () => {
    expect(summarizeSiteTopologyHealth(LEVEL).attention).toBe(2);
  });

  test("the four site states always sum to the total", () => {
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(LEVEL);
    expect(
      summary.down + summary.degraded + summary.healthy + summary.unknown,
    ).toBe(summary.total);
  });

  test("an absent or empty level summarizes to zeroes rather than throwing", () => {
    expect(summarizeSiteTopologyHealth(undefined).total).toBe(0);
    expect(summarizeSiteTopologyHealth([]).devices.total).toBe(0);
  });

  test("null rows in a level are skipped, not counted", () => {
    const summary: SiteTopologyHealthSummary = summarizeSiteTopologyHealth([
      LEVEL[0]!,
      null as unknown as SiteChildView,
      LEVEL[2]!,
    ]);
    expect(summary.total).toBe(2);
  });

  test("counts for each mode read straight off the summary", () => {
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(LEVEL);
    expect(siteTopologyCountForMode(summary, "all")).toBe(4);
    expect(siteTopologyCountForMode(summary, "attention")).toBe(2);
    expect(siteTopologyCountForMode(summary, "down")).toBe(1);
    expect(siteTopologyCountForMode(summary, "degraded")).toBe(1);
  });
});

describe("filterSitesByTopologyHealth", () => {
  test("narrows a level to the sites that need a look", () => {
    const filtered: Array<SiteChildView> = filterSitesByTopologyHealth(
      LEVEL,
      "attention",
    );
    expect(
      filtered.map((site: SiteChildView) => {
        return site.id;
      }),
    ).toEqual(["kc", "stl"]);
  });

  test("down narrows further than attention", () => {
    expect(
      filterSitesByTopologyHealth(LEVEL, "down").map((site: SiteChildView) => {
        return site.id;
      }),
    ).toEqual(["kc"]);
  });

  /*
   * Identity, not a copy. The card grid and the auto-focus effect both key
   * memos off this array, and a fresh array on every unrelated render would
   * re-run them for nothing.
   */
  test("'all' returns the input array itself", () => {
    expect(filterSitesByTopologyHealth(LEVEL, "all")).toBe(LEVEL);
  });

  test("a level where nothing matches filters to empty, not to everything", () => {
    const healthyLevel: Array<SiteChildView> = [
      makeSite("a", { deviceStats: makeCounts({ healthy: 4 }) }),
    ];
    expect(filterSitesByTopologyHealth(healthyLevel, "down")).toHaveLength(0);
  });

  test("filtering never invents a site the level did not contain", () => {
    for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
      const filtered: Array<SiteChildView> = filterSitesByTopologyHealth(
        LEVEL,
        mode,
      );
      for (const site of filtered) {
        expect(LEVEL).toContain(site);
      }
      expect(filtered.length).toBeLessThanOrEqual(LEVEL.length);
    }
  });

  /*
   * The claim the chips make has to be the claim the grid honours. If a chip
   * says "Down 1" the filter must leave exactly one card behind.
   */
  test("every chip count equals the number of cards its filter leaves", () => {
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(LEVEL);
    for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
      expect(filterSitesByTopologyHealth(LEVEL, mode).length).toBe(
        siteTopologyCountForMode(summary, mode),
      );
    }
  });
});

describe("firstMatchingSiteId — issue #3320's auto-zoom", () => {
  test("points at the first site the filter matched, in listing order", () => {
    expect(firstMatchingSiteId(LEVEL, "attention")).toBe("kc");
    expect(firstMatchingSiteId(LEVEL, "degraded")).toBe("stl");
  });

  test("is null with no filter on — a level nobody narrowed jumps nowhere", () => {
    expect(firstMatchingSiteId(LEVEL, "all")).toBeNull();
  });

  test("is null when the filter matched nothing", () => {
    const healthyLevel: Array<SiteChildView> = [
      makeSite("a", { deviceStats: makeCounts({ healthy: 4 }) }),
    ];
    expect(firstMatchingSiteId(healthyLevel, "down")).toBeNull();
  });

  test("an empty level jumps nowhere rather than throwing", () => {
    expect(firstMatchingSiteId([], "attention")).toBeNull();
    expect(
      firstMatchingSiteId(
        undefined as unknown as Array<SiteChildView>,
        "attention",
      ),
    ).toBeNull();
  });

  test("the target is always a site the same filter keeps on screen", () => {
    for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
      const target: string | null = firstMatchingSiteId(LEVEL, mode);
      if (target === null) {
        continue;
      }
      expect(
        filterSitesByTopologyHealth(LEVEL, mode).map((site: SiteChildView) => {
          return site.id;
        }),
      ).toContain(target);
    }
  });
});

/*
 * ------------------------------------------------------------------
 * What the level says about itself
 * ------------------------------------------------------------------
 */

describe("buildSiteTopologyFilterOptions", () => {
  const summary: SiteTopologyHealthSummary = summarizeSiteTopologyHealth(LEVEL);
  const options: Array<SiteTopologyFilterOption> =
    buildSiteTopologyFilterOptions(summary, "Market");

  test("offers all four modes, in a fixed order", () => {
    expect(
      options.map((option: SiteTopologyFilterOption) => {
        return option.value;
      }),
    ).toEqual(["all", "attention", "down", "degraded"]);
  });

  test("each chip carries the live count for its own mode", () => {
    for (const option of options) {
      expect(option.count).toBe(
        siteTopologyCountForMode(summary, option.value),
      );
    }
  });

  test("speaks the customer's own word for the level's children", () => {
    for (const option of options) {
      expect(option.description.toLowerCase()).toContain("market");
    }
  });

  test("'All' carries no status colour — it is not a state", () => {
    expect(options[0]!.color).toBeUndefined();
    expect(options[2]!.color).toBe(SITE_TOPOLOGY_STATE_COLORS.down);
    expect(options[3]!.color).toBe(SITE_TOPOLOGY_STATE_COLORS.degraded);
  });

  test("every chip has a distinct test id", () => {
    const ids: Set<string> = new Set<string>(
      options.map((option: SiteTopologyFilterOption) => {
        return option.testId;
      }),
    );
    expect(ids.size).toBe(options.length);
  });

  test("a level where nothing is wrong still offers all four chips", () => {
    const calm: Array<SiteTopologyFilterOption> =
      buildSiteTopologyFilterOptions(
        summarizeSiteTopologyHealth([
          makeSite("a", { deviceStats: makeCounts({ healthy: 3 }) }),
        ]),
        "Store",
      );
    expect(calm).toHaveLength(4);
    expect(calm[1]!.count).toBe(0);
  });
});

describe("describeSiteTopologyFilter", () => {
  const summary: SiteTopologyHealthSummary = summarizeSiteTopologyHealth(LEVEL);

  test("unfiltered, it gives the level's size and the estate below it", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summary,
      childTypeLabel: "Market",
    });
    expect(line).toContain("4 markets");
    expect(line).toContain("108 devices");
  });

  /*
   * The number the complaint in #3320 is really about: "12 sites need
   * attention" means nothing without knowing it is 12 out of 949.
   */
  test("filtered, it says how many of how many — sites and devices both", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "attention",
      summary: summary,
      childTypeLabel: "Market",
    });
    expect(line).toContain("2 of 4 markets");
    expect(line).toContain("3 of 108 devices");
  });

  test("a filter that matched nothing says so plainly", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "down",
      summary: summarizeSiteTopologyHealth([
        makeSite("a", { deviceStats: makeCounts({ healthy: 2 }) }),
      ]),
      childTypeLabel: "Store",
    });
    expect(line).toContain("Nothing at this level matches");
  });

  test("a level with no devices yet does not claim a device count", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([makeSite("a"), makeSite("b")]),
      childTypeLabel: "Region",
    });
    expect(line).toContain("2 regions");
    expect(line).not.toContain("0 devices");
  });

  /*
   * A level of exactly one is an ordinary sight — a franchisee with one
   * market, a level narrowed to a single match — and "1 stores need a look"
   * is the kind of sentence that makes a page read as generated.
   */
  test("counts of one read as singular, for sites and devices alike", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([
        makeSite("a", { deviceStats: makeCounts({ healthy: 1 }) }),
      ]),
      childTypeLabel: "Store",
    });
    expect(line).toContain("1 store at this level");
    expect(line).toContain("1 device below them");
    expect(line).not.toContain("1 devices");
    expect(line).not.toContain("1 stores");
  });

  /*
   * Site types are free text the customer wrote, so the plural has to go
   * through the same rule the map uses. "Facilitys" on somebody's estate is
   * the tell that two halves of the product are pluralising differently.
   */
  test("a customer's own site type is pluralised properly, not with a bare s", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([makeSite("a"), makeSite("b")]),
      childTypeLabel: "Facility",
    });
    expect(line).toContain("2 facilities");
    expect(line).not.toContain("facilitys");
  });

  test("the singular form is used where the sentence needs one", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([
        makeSite("a", { deviceStats: makeCounts({ healthy: 3 }) }),
        makeSite("b", { deviceStats: makeCounts({ healthy: 3 }) }),
      ]),
      childTypeLabel: "Store",
    });
    expect(line).toContain("open a store for its topology");
  });
});

describe("describeDeviceCounts", () => {
  test("an empty site says so rather than reporting a healthy zero", () => {
    expect(describeDeviceCounts(emptyDeviceHealthCounts())).toBe(
      "No devices attached",
    );
  });

  test("a healthy site just counts them", () => {
    expect(describeDeviceCounts(makeCounts({ healthy: 12 }))).toBe(
      "12 devices",
    );
    expect(describeDeviceCounts(makeCounts({ healthy: 1 }))).toBe("1 device");
  });

  test("a complaining site leads with what is wrong, out of the whole", () => {
    expect(
      describeDeviceCounts(makeCounts({ down: 2, degraded: 1, healthy: 45 })),
    ).toBe("2 down, 1 degraded of 48 devices");
  });

  test("only the states that are present are named", () => {
    expect(describeDeviceCounts(makeCounts({ down: 1, healthy: 9 }))).toBe(
      "1 down of 10 devices",
    );
    expect(describeDeviceCounts(makeCounts({ degraded: 3, healthy: 1 }))).toBe(
      "3 degraded of 4 devices",
    );
  });

  /*
   * A subtree of nothing but never-polled devices is not a healthy subtree,
   * but it is not a complaint either — it counts them and says nothing more.
   */
  test("unknown devices are counted but never reported as a problem", () => {
    expect(describeDeviceCounts(makeCounts({ unknown: 6 }))).toBe("6 devices");
  });

  test("a missing tally does not throw", () => {
    expect(describeDeviceCounts(null as unknown as DeviceHealthCounts)).toBe(
      "No devices attached",
    );
  });
});

describe("describeUnattachedDevices", () => {
  /*
   * A hierarchy that silently omits four hundred devices is the same
   * failure as a map that silently drops nodes — the reader has no way to
   * know the view is partial.
   */
  test("names the devices the hierarchy is NOT showing", () => {
    expect(
      describeUnattachedDevices({
        attachedDeviceCount: 21000,
        unattachedDeviceCount: 713,
      }),
    ).toContain("713 devices are not attached to a site");
  });

  test("reads singular for one", () => {
    const line: string = describeUnattachedDevices({
      attachedDeviceCount: 4,
      unattachedDeviceCount: 1,
    });
    expect(line).toContain("1 device is not attached");
    expect(line).toContain("it does not appear");
  });

  test("says nothing when every device is in the hierarchy", () => {
    expect(
      describeUnattachedDevices({
        attachedDeviceCount: 40,
        unattachedDeviceCount: 0,
      }),
    ).toBe("");
  });
});

/*
 * ------------------------------------------------------------------
 * Drill state in the URL
 * ------------------------------------------------------------------
 */

describe("parseTopologyDrillState", () => {
  test("reads a drilled level and the device view out of the query string", () => {
    const state: TopologyDrillState = parseTopologyDrillState({
      siteId: "abc",
      devices: "1",
    });
    expect(state).toEqual({ siteId: "abc", requestedDeviceView: true });
  });

  test("an absent site is the root, not an empty-string site", () => {
    expect(parseTopologyDrillState({ siteId: null, devices: null })).toEqual({
      siteId: null,
      requestedDeviceView: false,
    });
    expect(parseTopologyDrillState({ siteId: "", devices: "" })).toEqual({
      siteId: null,
      requestedDeviceView: false,
    });
  });

  /*
   * Only the exact string the page writes turns the device view on. An
   * unrecognised value must not put the explorer into a mode the URL cannot
   * express — and "?topologyDevices=", which is how the parameter is
   * cleared, has to read as off.
   */
  test("anything but '1' reads as no device view", () => {
    expect(
      parseTopologyDrillState({ siteId: null, devices: "true" })
        .requestedDeviceView,
    ).toBe(false);
    expect(
      parseTopologyDrillState({ siteId: null, devices: "0" })
        .requestedDeviceView,
    ).toBe(false);
    expect(
      parseTopologyDrillState({ siteId: null, devices: undefined })
        .requestedDeviceView,
    ).toBe(false);
  });

  test("the parameter names are stable — links in inboxes depend on them", () => {
    expect(TOPOLOGY_SITE_PARAM).toBe("topologySite");
    expect(TOPOLOGY_DEVICES_PARAM).toBe("topologyDevices");
  });
});

/*
 * ------------------------------------------------------------------
 * The whole flow, end to end
 * ------------------------------------------------------------------
 */

describe("a 949-site estate, the way issue #3320 describes it", () => {
  /*
   * The scenario from the issue, scaled down but shaped the same: a level
   * of markets, a handful of which hold something wrong, over an estate far
   * too big to draw. The point of every assertion here is that the reader
   * lands on a readable, correctly-labelled set of SITES rather than on a
   * grid of anonymous device clusters.
   */
  const estate: Array<SiteChildView> = [
    ...Array.from({ length: 20 }, (_unused: unknown, index: number) => {
      return makeSite(`healthy-${index}`, {
        name: `Market ${index}`,
        deviceStats: makeCounts({ healthy: 40 }),
      });
    }),
    makeSite("broken-a", {
      name: "Market A",
      deviceStats: makeCounts({ down: 3, healthy: 37 }),
    }),
    makeSite("broken-b", {
      name: "Market B",
      deviceStats: makeCounts({ degraded: 5, healthy: 35 }),
    }),
  ];

  test("the level is a couple of dozen cards, not 22 thousand nodes", () => {
    expect(estate.length).toBeLessThan(50);
    expect(summarizeSiteTopologyHealth(estate).devices.total).toBe(880);
  });

  test("'needs attention' answers with sites, and only the affected ones", () => {
    const affected: Array<SiteChildView> = filterSitesByTopologyHealth(
      estate,
      "attention",
    );
    expect(
      affected.map((site: SiteChildView) => {
        return site.name;
      }),
    ).toEqual(["Market A", "Market B"]);
  });

  test("the reader is landed on the first affected site, by name", () => {
    const target: string | null = firstMatchingSiteId(estate, "attention");
    expect(target).toBe("broken-a");
    expect(
      estate.find((site: SiteChildView) => {
        return site.id === target;
      })!.name,
    ).toBe("Market A");
  });

  test("the hint gives both scales, so 2 of 22 never reads as 2 of everything", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "attention",
      summary: summarizeSiteTopologyHealth(estate),
      childTypeLabel: "Market",
    });
    expect(line).toContain("2 of 22 markets");
    expect(line).toContain("8 of 880 devices");
  });

  test("drilling into the affected market opens its devices, not another level", () => {
    const view: HierarchyTopologyView = resolveHierarchyTopologyView({
      isAtRoot: false,
      isUnitLevel: true,
      childCount: 0,
      attachedDeviceCount: 880,
      requestedDeviceView: false,
    });
    expect(view).toBe("topology");
  });
});
