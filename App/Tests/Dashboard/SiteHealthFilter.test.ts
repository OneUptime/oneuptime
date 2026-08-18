import { describe, expect, test } from "@jest/globals";
import {
  MapSiteView,
  MapUnplacedSiteView,
  SiteChildView,
  SiteLinkView,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";
import {
  ALL_SITE_HEALTH_FILTER_MODES,
  SITE_HEALTH_ATTENTION_COLOR,
  SiteHealthFilterMode,
  SiteHealthFilterOption,
  SiteHealthState,
  SiteHealthSummary,
  buildSiteHealthFilterOptions,
  buildSiteHealthIndex,
  filterLinksByVisibleSites,
  filterSitesByHealth,
  filterSitesByHealthLookup,
  isSiteHealthFilterActive,
  siteHealthCountForMode,
  siteHealthMatchesMode,
  siteHealthState,
  summarizeSiteHealth,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHealthFilter";
import { unitRollupTone } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteMapViewModel";

/*
 * Issue #3261, the site-and-unit half.
 *
 * The device map's filter answers "which of my devices needs me". This one
 * answers it a level up, where a franchise estate is hundreds of cards and
 * pins. The rule that earns the feature is the rollup one: a region whose
 * own monitor is green while four of its stores are dark has to survive
 * the filter, because that region is precisely what somebody is looking
 * for and is exactly what a green dot hides.
 */

type MakeChildFunction = (
  id: string,
  overrides?: Partial<SiteChildView>,
) => SiteChildView;

const makeChild: MakeChildFunction = (
  id: string,
  overrides?: Partial<SiteChildView>,
): SiteChildView => {
  return {
    id: id,
    name: id,
    siteType: "Region",
    isUnitLevel: false,
    currentMonitorStatus: undefined,
    childSiteCount: 0,
    deviceCount: 0,
    unitStats: { totalUnits: 0, operationalUnits: 0 },
    uptimePercent: null,
    ...overrides,
  };
};

type MakeMarkerFunction = (
  id: string,
  overrides?: Partial<MapSiteView>,
) => MapSiteView;

const makeMarker: MakeMarkerFunction = (
  id: string,
  overrides?: Partial<MapSiteView>,
): MapSiteView => {
  return {
    id: id,
    name: id,
    siteType: "Region",
    isUnitLevel: false,
    latitude: 10,
    longitude: 20,
    statusPriority: 1,
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
};

const OPERATIONAL_STATUS: SiteChildView["currentMonitorStatus"] = {
  id: "status-up",
  name: "Operational",
  color: "#16a34a",
  priority: 1,
  isOperationalState: true,
};

const OFFLINE_STATUS: SiteChildView["currentMonitorStatus"] = {
  id: "status-down",
  name: "Offline",
  color: "#dc2626",
  priority: 5,
  isOperationalState: false,
};

describe("siteHealthState — the unit rollup", () => {
  test("one dark store in a region needs attention, whatever the region's own status says", () => {
    /*
     * The whole reason this file exists. A region reporting Operational
     * while a store beneath it is down is the row a filter has to keep.
     */
    expect(
      siteHealthState(
        makeChild("region", {
          currentMonitorStatus: OPERATIONAL_STATUS,
          unitStats: { totalUnits: 200, operationalUnits: 199 },
        }),
      ),
    ).toBe("attention");
  });

  test("a region with every unit up is operational", () => {
    expect(
      siteHealthState(
        makeChild("region", {
          unitStats: { totalUnits: 200, operationalUnits: 200 },
        }),
      ),
    ).toBe("operational");
  });

  test("a region with every unit down needs attention", () => {
    expect(
      siteHealthState(
        makeChild("region", {
          unitStats: { totalUnits: 12, operationalUnits: 0 },
        }),
      ),
    ).toBe("attention");
  });

  test("the rollup verdict is exactly SiteCard's and the map marker's", () => {
    /*
     * Read from unitRollupTone rather than re-derived here, so a card
     * reading "3 of 200 units down" can never sit under a filter that
     * disagrees about whether that is a problem.
     */
    const rollup: { totalUnits: number; operationalUnits: number } = {
      totalUnits: 200,
      operationalUnits: 197,
    };
    expect(unitRollupTone(rollup)).toBe("warn");
    expect(siteHealthState(makeChild("region", { unitStats: rollup }))).toBe(
      "attention",
    );
  });

  test("a site with no units beneath it falls through to its own status", () => {
    expect(
      siteHealthState(
        makeChild("unit", {
          isUnitLevel: true,
          unitStats: { totalUnits: 0, operationalUnits: 0 },
          currentMonitorStatus: OFFLINE_STATUS,
        }),
      ),
    ).toBe("attention");
  });
});

describe("siteHealthState — the site's own status", () => {
  test("a non-operational status needs attention", () => {
    expect(
      siteHealthState(
        makeChild("unit", { currentMonitorStatus: OFFLINE_STATUS }),
      ),
    ).toBe("attention");
  });

  test("an operational status with a clean rollup is operational", () => {
    expect(
      siteHealthState(
        makeChild("unit", { currentMonitorStatus: OPERATIONAL_STATUS }),
      ),
    ).toBe("operational");
  });

  test("a healthy rollup does not paper over a site's own outage", () => {
    /*
     * Every unit beneath it answers, and the site itself does not. That
     * is still a problem, and the rollup must not vote it away.
     */
    expect(
      siteHealthState(
        makeChild("region", {
          currentMonitorStatus: OFFLINE_STATUS,
          unitStats: { totalUnits: 10, operationalUnits: 10 },
        }),
      ),
    ).toBe("attention");
  });

  test("nothing reported at all is unknown, not operational", () => {
    expect(siteHealthState(makeChild("new-site"))).toBe("unknown");
  });

  test("a missing row is unknown rather than a crash", () => {
    expect(siteHealthState(undefined as unknown as SiteChildView)).toBe(
      "unknown",
    );
  });
});

describe("siteHealthState — map markers speak the same shape", () => {
  test("a marker reported non-operational needs attention", () => {
    expect(siteHealthState(makeMarker("m", { isOperational: false }))).toBe(
      "attention",
    );
  });

  test("a marker reported operational is operational", () => {
    expect(siteHealthState(makeMarker("m", { isOperational: true }))).toBe(
      "operational",
    );
  });

  test("a marker with no verdict at all is unknown", () => {
    expect(siteHealthState(makeMarker("m"))).toBe("unknown");
  });

  test("a marker's flat unit counts are read like a child row's unitStats", () => {
    expect(
      siteHealthState(
        makeMarker("m", {
          isOperational: true,
          totalUnits: 40,
          operationalUnits: 38,
        }),
      ),
    ).toBe("attention");
  });

  test("a marker whose units are all up is operational even with no status", () => {
    expect(
      siteHealthState(
        makeMarker("m", { totalUnits: 40, operationalUnits: 40 }),
      ),
    ).toBe("operational");
  });
});

describe("mode helpers", () => {
  test("only All is inactive", () => {
    expect(isSiteHealthFilterActive("all")).toBe(false);
    expect(isSiteHealthFilterActive("attention")).toBe(true);
  });

  test("every declared mode is one of the two", () => {
    expect(Array.from(ALL_SITE_HEALTH_FILTER_MODES)).toEqual([
      "all",
      "attention",
    ]);
  });

  test("All matches every state", () => {
    const states: Array<SiteHealthState> = [
      "attention",
      "operational",
      "unknown",
    ];
    for (const state of states) {
      expect(siteHealthMatchesMode(state, "all")).toBe(true);
    }
  });

  test("Needs attention matches only attention", () => {
    expect(siteHealthMatchesMode("attention", "attention")).toBe(true);
    expect(siteHealthMatchesMode("operational", "attention")).toBe(false);
    expect(siteHealthMatchesMode("unknown", "attention")).toBe(false);
  });
});

describe("summarizeSiteHealth", () => {
  const sites: Array<SiteChildView> = [
    makeChild("down-region", {
      unitStats: { totalUnits: 10, operationalUnits: 3 },
    }),
    makeChild("wobbly-region", {
      unitStats: { totalUnits: 100, operationalUnits: 99 },
    }),
    makeChild("clean-region", {
      unitStats: { totalUnits: 100, operationalUnits: 100 },
    }),
    makeChild("offline-unit", {
      isUnitLevel: true,
      currentMonitorStatus: OFFLINE_STATUS,
    }),
    makeChild("new-site"),
  ];

  test("counts every state", () => {
    const summary: SiteHealthSummary = summarizeSiteHealth(sites);
    expect(summary).toEqual({
      total: 5,
      attention: 3,
      operational: 1,
      unknown: 1,
    });
  });

  test("the states partition the total", () => {
    const summary: SiteHealthSummary = summarizeSiteHealth(sites);
    expect(summary.attention + summary.operational + summary.unknown).toBe(
      summary.total,
    );
  });

  test("an empty level summarises to zeroes", () => {
    expect(summarizeSiteHealth(undefined)).toEqual({
      total: 0,
      attention: 0,
      operational: 0,
      unknown: 0,
    });
  });

  test("counts follow the mode", () => {
    const summary: SiteHealthSummary = summarizeSiteHealth(sites);
    expect(siteHealthCountForMode(summary, "all")).toBe(5);
    expect(siteHealthCountForMode(summary, "attention")).toBe(3);
  });
});

describe("filterSitesByHealth", () => {
  const sites: Array<SiteChildView> = [
    makeChild("bad", { currentMonitorStatus: OFFLINE_STATUS }),
    makeChild("good", { currentMonitorStatus: OPERATIONAL_STATUS }),
    makeChild("unknown"),
  ];

  test("All hands back the INPUT ARRAY, not a copy", () => {
    /*
     * The graph's grid layout, the map's projection and its cluster
     * bucketing all key expensive memos off this array's identity. A
     * fresh array on every unrelated render would relayout the level for
     * nothing — the same contract filterSitesBySearch keeps.
     */
    expect(filterSitesByHealth(sites, "all")).toBe(sites);
  });

  test("Needs attention keeps only the sites in trouble", () => {
    expect(
      filterSitesByHealth(sites, "attention").map(
        (site: SiteChildView): string => {
          return site.id;
        },
      ),
    ).toEqual(["bad"]);
  });

  test("a site with no verdict is not shown as needing attention", () => {
    expect(
      filterSitesByHealth(sites, "attention").some(
        (site: SiteChildView): boolean => {
          return site.id === "unknown";
        },
      ),
    ).toBe(false);
  });

  test("works on map markers as well as child rows", () => {
    const markers: Array<MapSiteView> = [
      makeMarker("m-bad", { isOperational: false }),
      makeMarker("m-good", { isOperational: true }),
    ];
    expect(
      filterSitesByHealth(markers, "attention").map(
        (site: MapSiteView): string => {
          return site.id;
        },
      ),
    ).toEqual(["m-bad"]);
  });
});

describe("buildSiteHealthIndex and filterSitesByHealthLookup", () => {
  const children: Array<SiteChildView> = [
    makeChild("bad", { currentMonitorStatus: OFFLINE_STATUS }),
    makeChild("good", { currentMonitorStatus: OPERATIONAL_STATUS }),
  ];

  const unplaced: Array<MapUnplacedSiteView> = [
    { id: "bad", name: "bad", siteType: "Region", isUnitLevel: false },
    { id: "good", name: "good", siteType: "Region", isUnitLevel: false },
    {
      id: "stranger",
      name: "stranger",
      siteType: "Region",
      isUnitLevel: false,
    },
  ];

  test("the index keys every row by id", () => {
    const index: Map<string, SiteHealthState> = buildSiteHealthIndex(children);
    expect(index.get("bad")).toBe("attention");
    expect(index.get("good")).toBe("operational");
  });

  test("rows with no id are dropped", () => {
    const index: Map<string, SiteHealthState> = buildSiteHealthIndex([
      makeChild("real"),
      { name: "nameless" } as unknown as SiteChildView,
    ]);
    expect(Array.from(index.keys())).toEqual(["real"]);
  });

  test("All hands back the input array here too", () => {
    expect(
      filterSitesByHealthLookup(
        unplaced,
        buildSiteHealthIndex(children),
        "all",
      ),
    ).toBe(unplaced);
  });

  test("a site with no coordinates is judged by its child row", () => {
    /*
     * The map's "no location" list is name-and-type only. Without the
     * lookup an attention filter would hide every unplaced site — a dark
     * store whose only sin is that nobody typed its latitude in included.
     */
    const kept: Array<MapUnplacedSiteView> = filterSitesByHealthLookup(
      unplaced,
      buildSiteHealthIndex(children),
      "attention",
    );
    expect(
      kept.map((site: MapUnplacedSiteView): string => {
        return site.id;
      }),
    ).toEqual(["bad", "stranger"]);
  });

  test("a row the index has never heard of is KEPT", () => {
    /*
     * Hiding something because we failed to classify it is how a map
     * starts lying. An unclassifiable row stays on screen.
     */
    const kept: Array<MapUnplacedSiteView> = filterSitesByHealthLookup(
      unplaced,
      new Map<string, SiteHealthState>(),
      "attention",
    );
    expect(kept).toHaveLength(unplaced.length);
  });
});

describe("filterLinksByVisibleSites", () => {
  const links: Array<SiteLinkView> = [
    {
      id: "l1",
      name: "KC to Denver",
      fromSiteId: "kc",
      toSiteId: "denver",
      monitorStatus: undefined,
    },
    {
      id: "l2",
      name: "Denver to Boise",
      fromSiteId: "denver",
      toSiteId: "boise",
      monitorStatus: undefined,
    },
    {
      id: "l3",
      name: "Dangling",
      fromSiteId: undefined,
      toSiteId: undefined,
      monitorStatus: undefined,
    },
  ];

  test("All hands back the input array", () => {
    expect(
      filterLinksByVisibleSites(links, new Set<string>(["kc"]), "all"),
    ).toBe(links);
  });

  test("a link touching one surviving site is kept", () => {
    /*
     * The far end being filtered away does not make the line meaningless
     * — a WAN link out of the site you are looking at is a large part of
     * why it is in trouble.
     */
    const kept: Array<SiteLinkView> = filterLinksByVisibleSites(
      links,
      new Set<string>(["kc"]),
      "attention",
    );
    expect(
      kept.map((link: SiteLinkView): string => {
        return link.id;
      }),
    ).toEqual(["l1"]);
  });

  test("a link with both ends filtered away is dropped", () => {
    const kept: Array<SiteLinkView> = filterLinksByVisibleSites(
      links,
      new Set<string>(["boise"]),
      "attention",
    );
    expect(
      kept.map((link: SiteLinkView): string => {
        return link.id;
      }),
    ).toEqual(["l2"]);
  });

  test("a link with no ends at all is dropped rather than crashing", () => {
    const kept: Array<SiteLinkView> = filterLinksByVisibleSites(
      links,
      new Set<string>(),
      "attention",
    );
    expect(kept).toHaveLength(0);
  });
});

describe("buildSiteHealthFilterOptions", () => {
  const summary: SiteHealthSummary = {
    total: 42,
    attention: 5,
    operational: 30,
    unknown: 7,
  };

  test("offers both modes in a fixed order", () => {
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      summary,
      "Region",
    );
    expect(
      options.map((option: SiteHealthFilterOption): SiteHealthFilterMode => {
        return option.value;
      }),
    ).toEqual(["all", "attention"]);
  });

  test("each chip carries the count its mode would leave on the level", () => {
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      summary,
      "Region",
    );
    for (const option of options) {
      expect(option.count).toBe(siteHealthCountForMode(summary, option.value));
    }
  });

  test("All speaks the customer's own word for the level", () => {
    /*
     * Site types are per-project rows a customer renames at will, so the
     * help text borrows the level's own label rather than inventing one.
     */
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      summary,
      "Franchise Unit",
    );
    expect(options[0]!.description).toContain("Franchise Unit");
  });

  test("All carries no status dot; Needs attention carries the map's red", () => {
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      summary,
      "Region",
    );
    expect(options[0]!.color).toBeUndefined();
    expect(options[1]!.color).toBe(SITE_HEALTH_ATTENTION_COLOR);
  });

  test("every chip has a label, help text and a stable test id", () => {
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      summary,
      "Region",
    );
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.testId).toBe(`network-map-health-filter-${option.value}`);
    }
  });

  test("a zero-attention level still gets its chip", () => {
    const options: Array<SiteHealthFilterOption> = buildSiteHealthFilterOptions(
      { total: 3, attention: 0, operational: 3, unknown: 0 },
      "Region",
    );
    expect(options).toHaveLength(2);
    expect(options[1]!.count).toBe(0);
  });
});
