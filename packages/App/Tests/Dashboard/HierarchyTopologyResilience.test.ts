import { describe, expect, test } from "@jest/globals";
import {
  DeviceHealthCounts,
  emptyDeviceHealthCounts,
} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";
import { JSONObject } from "Common/Types/JSON";
import {
  SiteChildView,
  SiteChildrenResponse,
  parseSiteChildrenResponse,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTypes";
import {
  ALL_SITE_TOPOLOGY_FILTER_MODES,
  SiteTopologyFilterMode,
  SiteTopologyHealthState,
  SiteTopologyHealthSummary,
  buildSiteTopologyFilterOptions,
  describeSiteTopologyFilter,
  devicesForMode,
  filterSitesByTopologyHealth,
  firstMatchingSiteId,
  siteTopologyCountForMode,
  siteTopologyHealthState,
  summarizeSiteTopologyHealth,
} from "../../FeatureSet/Dashboard/src/Components/Topology/HierarchyTopologyViewModel";

/*
 * Issue #3320, from the other direction: not "does the drill-down work" but
 * "can it be made to LIE".
 *
 * The whole feature is a promise that an operator who filters a level to
 * "needs attention" is looking at every site that needs attention. A
 * hierarchy that quietly omits one is a worse failure than the flat map it
 * replaced, because the omission is invisible — the grid looks complete, the
 * chips look confident, and the dark store is simply not on screen.
 *
 * So this file is adversarial. It feeds the parsers what a broken, hostile
 * or merely old server can send, feeds the view model levels no sane
 * customer would configure, and asserts the invariants that have to survive
 * all of it. Where a case has a "right" answer the test names it; where the
 * only requirement is "do not lie", the test asserts the property.
 */

/*
 * ------------------------------------------------------------------
 * Builders
 * ------------------------------------------------------------------
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
    dailyUptimePercent: null,
    isUnderMaintenance: false,
    ...overrides,
  };
};

/*
 * A seeded generator, so a failure is reproducible. Math.random would make
 * this suite report a different level on every run, which turns a real
 * regression into "it failed once on CI".
 */
function makeRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomLevel(seed: number, size: number): Array<SiteChildView> {
  const random: () => number = makeRandom(seed);
  const sites: Array<SiteChildView> = [];
  for (let index: number = 0; index < size; index++) {
    const down: number = random() < 0.15 ? Math.floor(random() * 4) : 0;
    const degraded: number = random() < 0.25 ? Math.floor(random() * 6) : 0;
    const healthy: number = Math.floor(random() * 60);
    const unknown: number = random() < 0.2 ? Math.floor(random() * 3) : 0;
    const totalUnits: number = Math.floor(random() * 50);
    const operationalUnits: number =
      totalUnits === 0
        ? 0
        : Math.max(
            0,
            totalUnits - (random() < 0.2 ? Math.floor(random() * 3) : 0),
          );
    sites.push(
      makeSite(`site-${index}`, {
        name: `Site ${index}`,
        deviceStats: makeCounts({
          down: down,
          degraded: degraded,
          healthy: healthy,
          unknown: unknown,
        }),
        unitStats: {
          totalUnits: totalUnits,
          operationalUnits: operationalUnits,
        },
        currentMonitorStatus:
          random() < 0.3
            ? {
                id: "s",
                name: "Operational",
                color: "#16a34a",
                priority: 1,
                isOperationalState: random() < 0.8,
              }
            : undefined,
      }),
    );
  }
  return sites;
}

const SEEDS: Array<number> = [1, 7, 42, 1337, 90210, 2026];

/*
 * ------------------------------------------------------------------
 * The promise: a site that needs attention is never hidden
 * ------------------------------------------------------------------
 */

describe("the filter never hides a site that needs a look", () => {
  /*
   * The single most important property in the feature. Everything else is
   * presentation; this one is the reason an operator can trust the level.
   */
  test.each(SEEDS)(
    "seed %i: every site holding a down device survives 'attention' and 'down'",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 120);
      const holdingDown: Array<string> = level
        .filter((site: SiteChildView) => {
          return site.deviceStats.down > 0;
        })
        .map((site: SiteChildView) => {
          return site.id;
        });

      for (const mode of [
        "attention",
        "down",
      ] as Array<SiteTopologyFilterMode>) {
        const survivorIds: Set<string> = new Set<string>(
          filterSitesByTopologyHealth(level, mode).map(
            (site: SiteChildView) => {
              return site.id;
            },
          ),
        );
        for (const id of holdingDown) {
          expect(survivorIds.has(id)).toBe(true);
        }
      }
    },
  );

  test.each(SEEDS)(
    "seed %i: every site holding a degraded device survives 'attention'",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 120);
      const survivorIds: Set<string> = new Set<string>(
        filterSitesByTopologyHealth(level, "attention").map(
          (site: SiteChildView) => {
            return site.id;
          },
        ),
      );
      for (const site of level) {
        if (site.deviceStats.degraded > 0) {
          expect(survivorIds.has(site.id)).toBe(true);
        }
      }
    },
  );

  /*
   * A region whose own monitor is green while four of its stores are dark is
   * the franchise case the whole rollup exists for. It must not fall out of
   * "attention" merely because no device under it is complaining.
   */
  test.each(SEEDS)(
    "seed %i: a site with dark units survives 'attention' even with clean devices",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 120);
      const survivorIds: Set<string> = new Set<string>(
        filterSitesByTopologyHealth(level, "attention").map(
          (site: SiteChildView) => {
            return site.id;
          },
        ),
      );
      for (const site of level) {
        const hasDarkUnits: boolean =
          site.unitStats.totalUnits > 0 &&
          site.unitStats.operationalUnits < site.unitStats.totalUnits;
        if (hasDarkUnits) {
          expect(survivorIds.has(site.id)).toBe(true);
        }
      }
    },
  );
});

/*
 * ------------------------------------------------------------------
 * The chips and the grid always agree
 * ------------------------------------------------------------------
 */

describe("what the chips claim is what the grid shows", () => {
  test.each(SEEDS)(
    "seed %i: every chip count equals the rows its filter leaves",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 200);
      const summary: SiteTopologyHealthSummary =
        summarizeSiteTopologyHealth(level);
      for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
        expect(filterSitesByTopologyHealth(level, mode)).toHaveLength(
          siteTopologyCountForMode(summary, mode),
        );
      }
      for (const option of buildSiteTopologyFilterOptions(summary, "Market")) {
        expect(filterSitesByTopologyHealth(level, option.value)).toHaveLength(
          option.count,
        );
      }
    },
  );

  test.each(SEEDS)(
    "seed %i: filtering only ever removes rows — never adds, reorders or duplicates",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 150);
      for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
        const filtered: Array<SiteChildView> = filterSitesByTopologyHealth(
          level,
          mode,
        );
        expect(new Set<SiteChildView>(filtered).size).toBe(filtered.length);
        for (const site of filtered) {
          expect(level).toContain(site);
        }
        // Listing order is preserved, so the reader can find a card again.
        const levelOrder: Array<number> = filtered.map(
          (site: SiteChildView) => {
            return level.indexOf(site);
          },
        );
        const sorted: Array<number> = [...levelOrder].sort(
          (a: number, b: number) => {
            return a - b;
          },
        );
        expect(levelOrder).toEqual(sorted);
      }
    },
  );

  test.each(SEEDS)(
    "seed %i: the site states partition the level, and so do their devices",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 200);
      const summary: SiteTopologyHealthSummary =
        summarizeSiteTopologyHealth(level);
      expect(
        summary.down + summary.degraded + summary.healthy + summary.unknown,
      ).toBe(summary.total);
      expect(summary.attention).toBe(summary.down + summary.degraded);

      const states: Array<SiteTopologyHealthState> = [
        "down",
        "degraded",
        "healthy",
        "unknown",
      ];
      let devicesAcrossBuckets: number = 0;
      for (const state of states) {
        devicesAcrossBuckets += summary.devicesBySiteState[state].total;
      }
      expect(devicesAcrossBuckets).toBe(summary.devices.total);
    },
  );

  test.each(SEEDS)(
    "seed %i: the jump target is always a row the same filter keeps",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 150);
      for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
        const target: string | null = firstMatchingSiteId(level, mode);
        if (target === null) {
          // Only legitimate when nothing matched, or no filter is on.
          expect(
            mode === "all" ||
              filterSitesByTopologyHealth(level, mode).length === 0,
          ).toBe(true);
          continue;
        }
        const survivors: Array<string> = filterSitesByTopologyHealth(
          level,
          mode,
        ).map((site: SiteChildView) => {
          return site.id;
        });
        expect(survivors).toContain(target);
        // And it is the FIRST one, so the scroll lands where the eye does.
        expect(survivors[0]).toBe(target);
      }
    },
  );

  test.each(SEEDS)(
    "seed %i: the hint never claims more affected devices than exist",
    (seed: number) => {
      const level: Array<SiteChildView> = randomLevel(seed, 150);
      const summary: SiteTopologyHealthSummary =
        summarizeSiteTopologyHealth(level);
      for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
        const matched: DeviceHealthCounts = devicesForMode(summary, mode);
        expect(matched.down + matched.degraded).toBeLessThanOrEqual(
          summary.devices.down + summary.devices.degraded,
        );
        const line: string = describeSiteTopologyFilter({
          mode: mode,
          summary: summary,
          childTypeLabel: "Market",
        });
        expect(line.length).toBeGreaterThan(0);
        expect(line).not.toContain("undefined");
        expect(line).not.toContain("NaN");
      }
    },
  );
});

/*
 * ------------------------------------------------------------------
 * A hostile or merely old server
 * ------------------------------------------------------------------
 */

describe("a broken payload costs a number, never a hidden site", () => {
  function parseChild(row: JSONObject): SiteChildView {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      children: [row],
    } as unknown as JSONObject);
    return parsed.children[0]!;
  }

  test("negative device counts are clamped rather than subtracted", () => {
    const child: SiteChildView = parseChild({
      id: "c1",
      deviceStats: {
        total: -5,
        down: -2,
        degraded: -1,
        healthy: -3,
        unknown: -4,
      },
    } as unknown as JSONObject);
    expect(child.deviceStats).toEqual(emptyDeviceHealthCounts());
    expect(siteTopologyHealthState(child)).toBe("unknown");
  });

  /*
   * A total that disagrees with its parts would print "2 of 0 devices down",
   * which is the kind of number that makes an operator stop trusting the
   * page. The parser raises the total to the sum instead.
   */
  test("a total smaller than its parts is raised, never left inconsistent", () => {
    const child: SiteChildView = parseChild({
      id: "c1",
      deviceStats: { total: 0, down: 2, degraded: 1, healthy: 4, unknown: 1 },
    } as unknown as JSONObject);
    expect(child.deviceStats.total).toBe(8);
    expect(
      child.deviceStats.down +
        child.deviceStats.degraded +
        child.deviceStats.healthy +
        child.deviceStats.unknown,
    ).toBeLessThanOrEqual(child.deviceStats.total);
  });

  test("a total LARGER than its parts is kept — the extra is unclassified, not invented", () => {
    const child: SiteChildView = parseChild({
      id: "c1",
      deviceStats: { total: 100, down: 1, degraded: 0, healthy: 2, unknown: 0 },
    } as unknown as JSONObject);
    expect(child.deviceStats.total).toBe(100);
  });

  test.each([
    ["a string", "nonsense"],
    ["a number", 7],
    ["an array", []],
    ["null", null],
    ["absent", undefined],
  ])(
    "deviceStats as %s narrows to a zeroed tally",
    (_label: string, value: unknown) => {
      const child: SiteChildView = parseChild({
        id: "c1",
        deviceStats: value,
      } as unknown as JSONObject);
      expect(child.deviceStats).toEqual(emptyDeviceHealthCounts());
    },
  );

  test.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])(
    "a %s count falls back to zero rather than poisoning the arithmetic",
    (_label: string, value: number) => {
      const child: SiteChildView = parseChild({
        id: "c1",
        deviceStats: {
          total: value,
          down: value,
          degraded: 0,
          healthy: 1,
          unknown: 0,
        },
      } as unknown as JSONObject);
      expect(Number.isFinite(child.deviceStats.total)).toBe(true);
      expect(Number.isFinite(child.deviceStats.down)).toBe(true);

      const summary: SiteTopologyHealthSummary = summarizeSiteTopologyHealth([
        child,
      ]);
      expect(Number.isFinite(summary.devices.total)).toBe(true);
      expect(
        describeSiteTopologyFilter({
          mode: "all",
          summary: summary,
          childTypeLabel: "Store",
        }),
      ).not.toContain("NaN");
    },
  );

  /*
   * A server that predates deviceStats sends nothing at all. The level must
   * still classify from the site rollup rather than reporting a project of
   * uniformly healthy sites.
   */
  test("a payload with no deviceStats still surfaces sites with dark units", () => {
    const child: SiteChildView = parseChild({
      id: "region",
      unitStats: { totalUnits: 40, operationalUnits: 36 },
    } as unknown as JSONObject);
    expect(child.deviceStats).toEqual(emptyDeviceHealthCounts());
    expect(siteTopologyHealthState(child)).toBe("degraded");
    expect(filterSitesByTopologyHealth([child], "attention")).toHaveLength(1);
  });

  test("a missing deviceScope narrows to zeroes, which reads as 'no hierarchy'", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse(
      {} as unknown as JSONObject,
    );
    expect(parsed.deviceScope).toEqual({
      attachedDeviceCount: 0,
      unattachedDeviceCount: 0,
    });
    expect(parsed.ownDeviceStats).toEqual(emptyDeviceHealthCounts());
  });

  test("a negative unattached count cannot produce a negative sentence", () => {
    const parsed: SiteChildrenResponse = parseSiteChildrenResponse({
      deviceScope: { attachedDeviceCount: -4, unattachedDeviceCount: -9 },
    } as unknown as JSONObject);
    expect(parsed.deviceScope.attachedDeviceCount).toBe(0);
    expect(parsed.deviceScope.unattachedDeviceCount).toBe(0);
  });
});

/*
 * ------------------------------------------------------------------
 * Levels no sane customer would configure
 * ------------------------------------------------------------------
 */

describe("unusual levels still produce an honest page", () => {
  test("duplicate site ids are all kept — dropping one would hide a site", () => {
    const level: Array<SiteChildView> = [
      makeSite("dup", {
        name: "First",
        deviceStats: makeCounts({ down: 1, healthy: 1 }),
      }),
      makeSite("dup", {
        name: "Second",
        deviceStats: makeCounts({ healthy: 2 }),
      }),
    ];
    expect(summarizeSiteTopologyHealth(level).total).toBe(2);
    expect(filterSitesByTopologyHealth(level, "attention")).toHaveLength(1);
    // The jump target is ambiguous by construction; it must still be one of them.
    expect(firstMatchingSiteId(level, "attention")).toBe("dup");
  });

  test("a level where every row is unknown reports unknown, not healthy", () => {
    const level: Array<SiteChildView> = [
      makeSite("a"),
      makeSite("b"),
      makeSite("c"),
    ];
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(level);
    expect(summary.unknown).toBe(3);
    expect(summary.healthy).toBe(0);
    expect(summary.attention).toBe(0);
    // "Needs attention 0" over three unjudged sites must not read as "all fine".
    expect(filterSitesByTopologyHealth(level, "attention")).toHaveLength(0);
  });

  test("a ten thousand row level stays internally consistent", () => {
    const level: Array<SiteChildView> = randomLevel(4242, 10000);
    const summary: SiteTopologyHealthSummary =
      summarizeSiteTopologyHealth(level);
    expect(summary.total).toBe(10000);
    for (const mode of ALL_SITE_TOPOLOGY_FILTER_MODES) {
      expect(filterSitesByTopologyHealth(level, mode)).toHaveLength(
        siteTopologyCountForMode(summary, mode),
      );
    }
  });

  test("a single-row level reads as singular throughout", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([
        makeSite("only", { deviceStats: makeCounts({ healthy: 1 }) }),
      ]),
      childTypeLabel: "Store",
    });
    expect(line).toContain("1 store at this level");
    expect(line).toContain("1 device below them");
  });

  test("an empty level says nothing false about devices", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([]),
      childTypeLabel: "Region",
    });
    expect(line).toContain("0 regions");
    expect(line).not.toContain("NaN");
  });
});

/*
 * ------------------------------------------------------------------
 * Site types are free text the customer wrote
 * ------------------------------------------------------------------
 */

describe("a customer's own site type never breaks the copy", () => {
  const TYPES: Array<[string, string]> = [
    ["Market", "markets"],
    ["Facility", "facilities"],
    ["Business", "businesses"],
    ["Branch", "branches"],
    ["Campus", "campuses"],
    ["Premises", "premises"],
    ["Units", "units"],
    ["Box", "boxes"],
    ["Dish", "dishes"],
    ["Territory", "territories"],
  ];

  test.each(TYPES)("%s pluralises to %s", (input: string, plural: string) => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([makeSite("a"), makeSite("b")]),
      childTypeLabel: input,
    });
    expect(line).toContain(`2 ${plural}`);
  });

  test("a type with surrounding whitespace does not print a double space", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([makeSite("a"), makeSite("b")]),
      childTypeLabel: "  Market  ",
    });
    expect(line).not.toContain("  ");
  });

  /*
   * childTypeLabelFor falls back to "site" for a mixed or blank level, so an
   * empty label is a shape the copy really does receive.
   */
  test("an empty label degrades to a readable sentence rather than a gap", () => {
    const line: string = describeSiteTopologyFilter({
      mode: "all",
      summary: summarizeSiteTopologyHealth([makeSite("a")]),
      childTypeLabel: "",
    });
    expect(line).not.toContain("undefined");
    expect(line.trim().length).toBeGreaterThan(0);
  });

  test("the chips speak the same noun the hint does", () => {
    for (const [input, plural] of TYPES) {
      const options: Array<{ description: string }> =
        buildSiteTopologyFilterOptions(
          summarizeSiteTopologyHealth([makeSite("a")]),
          input,
        );
      for (const option of options) {
        expect(option.description.toLowerCase()).toContain(plural);
      }
    }
  });
});
