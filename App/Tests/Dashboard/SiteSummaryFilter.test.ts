import { describe, expect, test } from "@jest/globals";
import {
  SITE_SUMMARY_FILTER_URL_PARAM,
  SITE_SUMMARY_TILES,
  SiteSummaryFilterDefinition,
  SiteSummaryFilterKey,
  SiteSummaryTile,
  SiteSummaryTileAction,
  UNASSIGNED_DEVICES_FILTER_KEY,
  getSiteSummaryFilterDefinition,
  getSiteSummaryFilterQuery,
  parseSiteSummaryFilterKey,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryFilter";
import { DeviceSummaryFilterKey } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryFilter";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Query from "Common/Types/BaseDatabase/Query";

/*
 * SiteSummaryFilter is the Sites-page counterpart of DeviceSummaryFilter: the
 * contract between a count on a tile and the rows behind it.
 *
 * The wrinkle this file exists to pin is the fourth tile. Three tiles count
 * sites and narrow the sites table; "Unassigned Devices" counts DEVICES, and
 * the only page that lists devices is the device page. Filtering the sites
 * table by a device predicate would produce an empty table and no explanation,
 * so that tile navigates instead — and the two pages have to agree on which
 * filter it means.
 */

const ALL_KEYS: Array<SiteSummaryFilterKey> =
  Object.values(SiteSummaryFilterKey);

describe("SiteSummaryFilterKey", () => {
  /*
   * These strings are in shared URLs. Renaming one silently breaks every link
   * already pasted into a ticket, so the rename has to be a conscious edit.
   */
  test("the wire values are stable", () => {
    expect(SiteSummaryFilterKey.Unhealthy).toBe("unhealthy");
    expect(SiteSummaryFilterKey.NoData).toBe("no-data");
  });

  test("there are exactly two, and they are distinct", () => {
    expect(ALL_KEYS).toHaveLength(2);
    expect(new Set(ALL_KEYS).size).toBe(2);
  });

  test("the URL parameter name is stable", () => {
    expect(SITE_SUMMARY_FILTER_URL_PARAM).toBe("siteFilter");
  });

  /*
   * The Sites page and the Devices page can both be filtered, and a user can
   * arrive at one from the other. Distinct parameter names are what keeps a
   * site filter from being read as a device filter.
   */
  test("does not share a parameter name with the device filter", () => {
    expect(SITE_SUMMARY_FILTER_URL_PARAM).not.toBe("deviceFilter");
  });
});

describe("parseSiteSummaryFilterKey", () => {
  test.each(ALL_KEYS)("round-trips %s", (key: SiteSummaryFilterKey) => {
    expect(parseSiteSummaryFilterKey(key)).toBe(key);
  });

  describe("absent values read as no filter", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
    ])("%s", (_label: string, raw: string | null | undefined) => {
      expect(parseSiteSummaryFilterKey(raw)).toBeNull();
    });
  });

  /*
   * The parameter is in the address bar, so its value is whatever anyone
   * chooses to type. Nothing but an exact key may reach the query builder.
   */
  describe("hostile and stale values read as no filter", () => {
    test.each([
      ["unknown word", "banana"],
      ["a tile key rather than a filter key", "unhealthy-sites"],
      ["the other tile key", "sites-no-data"],
      ["wrong case", "UNHEALTHY"],
      ["mixed case", "NoData"],
      ["leading whitespace", " unhealthy"],
      ["trailing whitespace", "no-data "],
      ["a device filter key", "no-site"],
      ["an Object.prototype member", "constructor"],
      ["a prototype-pollution attempt", "__proto__"],
      ["another prototype member", "valueOf"],
      ["a JSON payload", '{"currentMonitorStatusId":null}'],
      ["a SQL fragment", "1' OR '1'='1"],
    ])("%s", (_label: string, raw: string) => {
      expect(parseSiteSummaryFilterKey(raw)).toBeNull();
    });
  });

  /*
   * The two pages use different vocabularies on purpose, and a link carrying
   * one page's key must not accidentally filter the other page.
   */
  test("no device filter key parses as a site filter key", () => {
    for (const deviceKey of Object.values(DeviceSummaryFilterKey)) {
      expect(parseSiteSummaryFilterKey(deviceKey)).toBeNull();
    }
  });
});

describe("getSiteSummaryFilterQuery", () => {
  test("no selection is an empty fragment, not a special case", () => {
    expect(getSiteSummaryFilterQuery(null)).toEqual({});
  });

  test("every key produces a fragment naming exactly one column", () => {
    for (const key of ALL_KEYS) {
      expect(Object.keys(getSiteSummaryFilterQuery(key))).toHaveLength(1);
    }
  });

  test.each(ALL_KEYS)(
    "%s carries no scoping of its own",
    (key: SiteSummaryFilterKey) => {
      const query: Query<NetworkSite> = getSiteSummaryFilterQuery(key);
      expect(query.projectId).toBeUndefined();
    },
  );

  describe("Unhealthy — the sites the 'Unhealthy Sites' tile counted", () => {
    /*
     * SiteSummaryCards counts a site as unhealthy when it HAS a rolled-up
     * status and that status is not operational. The nested relation query is
     * how that same predicate is expressed to the API — the same shape
     * NotOperationalMonitors.tsx uses for monitors.
     */
    test("is currentMonitorStatus.isOperationalState = false", () => {
      expect(getSiteSummaryFilterQuery(SiteSummaryFilterKey.Unhealthy)).toEqual(
        {
          currentMonitorStatus: {
            isOperationalState: false,
          },
        },
      );
    });

    /*
     * `false`, not a falsy stand-in: `undefined` would drop the predicate and
     * silently return every site, and `null` would ask for rows whose flag is
     * NULL — a different set again.
     */
    test("asks for the boolean false, not a falsy stand-in", () => {
      const query: Query<NetworkSite> = getSiteSummaryFilterQuery(
        SiteSummaryFilterKey.Unhealthy,
      );
      const nested: { isOperationalState?: unknown } =
        query.currentMonitorStatus as { isOperationalState?: unknown };

      expect(nested.isOperationalState).toBe(false);
      expect(typeof nested.isOperationalState).toBe("boolean");
    });

    /*
     * Joining the status is what excludes sites with no rollup at all — they
     * have no MonitorStatus row to match, so they stay in the "no data" tile
     * where they were counted, and are not double-counted as unhealthy.
     */
    test("goes through the relation, so sites with no rollup are excluded", () => {
      expect(
        getSiteSummaryFilterQuery(SiteSummaryFilterKey.Unhealthy)
          .currentMonitorStatusId,
      ).toBeUndefined();
    });
  });

  describe("NoData — the sites the 'Sites Without Data' tile counted", () => {
    /*
     * The FK, not the relation: a site with no rollup has no MonitorStatus
     * row, so there is nothing to join and nothing a nested predicate could
     * match against.
     */
    test("is currentMonitorStatusId IS NULL", () => {
      const query: Query<NetworkSite> = getSiteSummaryFilterQuery(
        SiteSummaryFilterKey.NoData,
      );

      expect(query.currentMonitorStatusId).toBeInstanceOf(IsNull);
      expect(query.currentMonitorStatus).toBeUndefined();
    });
  });

  describe("the two site filters are mutually exclusive", () => {
    test("they filter different columns, so no site can match both", () => {
      expect(
        Object.keys(getSiteSummaryFilterQuery(SiteSummaryFilterKey.Unhealthy)),
      ).toEqual(["currentMonitorStatus"]);
      expect(
        Object.keys(getSiteSummaryFilterQuery(SiteSummaryFilterKey.NoData)),
      ).toEqual(["currentMonitorStatusId"]);
    });
  });

  /*
   * The Sites page memoises this fragment on the selected key, and ModelTable
   * decides whether to refetch by JSON-comparing the previous query prop with
   * the next. Nothing here reads the clock, so the same key always serialises
   * the same way — which is what makes the memo sufficient.
   */
  test("serialises identically on every call", () => {
    for (const key of [...ALL_KEYS, null]) {
      expect(JSON.stringify(getSiteSummaryFilterQuery(key))).toBe(
        JSON.stringify(getSiteSummaryFilterQuery(key)),
      );
    }
  });
});

describe("getSiteSummaryFilterDefinition", () => {
  test.each(ALL_KEYS)(
    "%s has a chip label and empty-state copy",
    (key: SiteSummaryFilterKey) => {
      const definition: SiteSummaryFilterDefinition =
        getSiteSummaryFilterDefinition(key);

      expect(definition.key).toBe(key);
      expect(definition.chipLabel.length).toBeGreaterThan(0);
      expect(definition.emptyMessage.length).toBeGreaterThan(0);
    },
  );

  test("no two filters present the same chip", () => {
    const labels: Array<string> = ALL_KEYS.map((key: SiteSummaryFilterKey) => {
      return getSiteSummaryFilterDefinition(key).chipLabel;
    });

    expect(new Set(labels).size).toBe(labels.length);
  });

  /*
   * "Every site is operational" would be a false claim while sites with no
   * rollup exist — they are neither operational nor counted here.
   */
  test("the unhealthy empty state does not overstate what it checked", () => {
    expect(
      getSiteSummaryFilterDefinition(SiteSummaryFilterKey.Unhealthy)
        .emptyMessage,
    ).toBe("Every site with a health rollup is operational.");
  });
});

describe("SITE_SUMMARY_TILES", () => {
  test("is the four tiles the page has always shown, in order", () => {
    expect(
      SITE_SUMMARY_TILES.map((tile: SiteSummaryTile) => {
        return tile.key;
      }),
    ).toEqual([
      "total-sites",
      "unhealthy-sites",
      "sites-no-data",
      "devices-without-site",
    ]);
  });

  test("keeps the original labels and captions", () => {
    expect(
      SITE_SUMMARY_TILES.map((tile: SiteSummaryTile) => {
        return tile.label;
      }),
    ).toEqual([
      "Sites",
      "Unhealthy Sites",
      "Sites Without Data",
      "Unassigned Devices",
    ]);

    expect(SITE_SUMMARY_TILES[3]!.caption).toBe(
      "Devices not assigned to any site.",
    );
  });

  test("each tile reads a distinct count", () => {
    expect(
      SITE_SUMMARY_TILES.map((tile: SiteSummaryTile) => {
        return tile.countField;
      }),
    ).toEqual([
      "totalSites",
      "unhealthySites",
      "sitesWithNoData",
      "devicesWithoutSite",
    ]);
  });

  describe("what each tile does when it is activated", () => {
    /*
     * The total is not a subset — clicking it means "show me everything
     * again", which is the only sensible drill-down for a total and doubles
     * as a second way out of a filtered view.
     */
    test("the total clears the filter", () => {
      expect(SITE_SUMMARY_TILES[0]!.action).toBe(
        SiteSummaryTileAction.ClearFilter,
      );
      expect(SITE_SUMMARY_TILES[0]!.filterKey).toBeUndefined();
    });

    test("the two site counts narrow the table in place", () => {
      expect(SITE_SUMMARY_TILES[1]!.action).toBe(
        SiteSummaryTileAction.FilterSites,
      );
      expect(SITE_SUMMARY_TILES[1]!.filterKey).toBe(
        SiteSummaryFilterKey.Unhealthy,
      );

      expect(SITE_SUMMARY_TILES[2]!.action).toBe(
        SiteSummaryTileAction.FilterSites,
      );
      expect(SITE_SUMMARY_TILES[2]!.filterKey).toBe(
        SiteSummaryFilterKey.NoData,
      );
    });

    /*
     * This is the tile that counts something the sites table cannot show. If
     * it were ever wired to FilterSites, its filterKey would be undefined and
     * the click would silently clear the filter instead of opening the rows.
     */
    test("the device count leaves for the device list", () => {
      expect(SITE_SUMMARY_TILES[3]!.action).toBe(
        SiteSummaryTileAction.ShowUnassignedDevices,
      );
      expect(SITE_SUMMARY_TILES[3]!.filterKey).toBeUndefined();
    });

    test("every FilterSites tile carries a real filter key", () => {
      for (const tile of SITE_SUMMARY_TILES) {
        if (tile.action !== SiteSummaryTileAction.FilterSites) {
          continue;
        }
        expect(tile.filterKey).toBeDefined();
        expect(ALL_KEYS).toContain(tile.filterKey!);
      }
    });

    test("no two tiles drill into the same filter", () => {
      const filterKeys: Array<SiteSummaryFilterKey> = SITE_SUMMARY_TILES.filter(
        (tile: SiteSummaryTile) => {
          return Boolean(tile.filterKey);
        },
      ).map((tile: SiteSummaryTile) => {
        return tile.filterKey!;
      });

      expect(new Set(filterKeys).size).toBe(filterKeys.length);
    });

    test("exactly one tile leaves the page", () => {
      expect(
        SITE_SUMMARY_TILES.filter((tile: SiteSummaryTile) => {
          return tile.action === SiteSummaryTileAction.ShowUnassignedDevices;
        }),
      ).toHaveLength(1);
    });

    test("every tile declares an action, so none is silently inert", () => {
      const actions: Array<string> = Object.values(SiteSummaryTileAction);
      for (const tile of SITE_SUMMARY_TILES) {
        expect(actions).toContain(tile.action);
      }
    });
  });
});

describe("UNASSIGNED_DEVICES_FILTER_KEY", () => {
  /*
   * The hand-off between the two pages. The Sites page names the filter, the
   * Devices page resolves it — pinning it here is what stops the two from
   * drifting into a link that lands on an unfiltered device list.
   */
  test("is the device list's 'no site' filter", () => {
    expect(UNASSIGNED_DEVICES_FILTER_KEY).toBe(DeviceSummaryFilterKey.NoSite);
  });

  test("is a key the device page will actually accept", () => {
    expect(Object.values(DeviceSummaryFilterKey)).toContain(
      UNASSIGNED_DEVICES_FILTER_KEY,
    );
  });
});
