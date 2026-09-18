import { describe, expect, test } from "@jest/globals";
import {
  SITE_SUMMARY_TILES,
  SiteSummaryStatusFilter,
  SiteSummaryTile,
  SiteSummaryTileAction,
  SiteSummaryTileContext,
  UNASSIGNED_DEVICES_FACET_SELECTION,
  getSiteFacetSelectionForTile,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryTiles";
import {
  SITE_PARENT_FACET_KEY,
  SITE_STATUS_FACET_KEY,
  SITE_TYPE_FACET_KEY,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteFacets";
import {
  DEVICE_SITE_FACET_KEY,
  UNASSIGNED_DEVICES_FACET_SELECTION as DEVICE_FACETS_UNASSIGNED_DEVICES_FACET_SELECTION,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import {
  FacetOperatorMap,
  FacetSelectionMap,
  FacetTileSelection,
  isFacetTileSelectionApplied,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";

/*
 * SiteSummaryTiles is the contract between a number on a tile and the chip that
 * produces the rows behind it. If the two ever describe different sets the
 * product lies: the tile says "4 unhealthy sites", the list it opens shows
 * something else, and the chips above the list are the only place the difference
 * could have been explained.
 *
 * The wrinkle this file exists to pin is the fourth tile. Three tiles count
 * sites and move a chip on the sites table; "Unassigned Devices" counts DEVICES,
 * whose rows only exist on the device list — so it has no chip here to move and
 * has to say so, rather than handing back a selection that would narrow the
 * sites table to something its count never described.
 */

// Ids standing in for the project's non-operational MonitorStatuses.
const DEGRADED_STATUS_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OFFLINE_STATUS_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a6c";
const NEVER_COUNTED_STATUS_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a7d";

const CONTEXT: SiteSummaryTileContext = {
  unhealthyStatusIds: [DEGRADED_STATUS_ID, OFFLINE_STATUS_ID],
};

/*
 * Mirrors the SummaryCounts shape SiteSummaryCards fetches. Written as a mapped
 * type over the tiles' own `countField` union, so a tile that starts reading a
 * count the fetch never produces cannot compile.
 */
const SUMMARY_COUNTS: { [field in SiteSummaryTile["countField"]]: number } = {
  totalSites: 0,
  unhealthySites: 0,
  sitesWithNoData: 0,
  devicesWithoutSite: 0,
};

const SITE_FACET_KEYS: Array<string> = [
  SITE_STATUS_FACET_KEY,
  SITE_TYPE_FACET_KEY,
  SITE_PARENT_FACET_KEY,
];

interface FacetState {
  facetSelections: FacetSelectionMap;
  facetOperators: FacetOperatorMap;
}

/*
 * The bar as it looks once a tile's selection has been applied to it: the chip
 * the tile named carries its values and its operator, and nothing else is set.
 * Built by hand rather than through the hook so the round-trip below is a
 * statement about the data, not about React.
 */
function facetStateFor(selection: FacetTileSelection): FacetState {
  if (selection.facetKey === null) {
    return { facetSelections: {}, facetOperators: {} };
  }

  return {
    facetSelections: { [selection.facetKey]: [...selection.values] },
    facetOperators: { [selection.facetKey]: selection.operator },
  };
}

function tileByKey(key: string): SiteSummaryTile {
  const tile: SiteSummaryTile | undefined = SITE_SUMMARY_TILES.find(
    (candidate: SiteSummaryTile) => {
      return candidate.key === key;
    },
  );

  if (!tile) {
    throw new Error(`No summary tile named ${key}`);
  }

  return tile;
}

const TOTAL_TILE: SiteSummaryTile = tileByKey("total-sites");
const UNHEALTHY_TILE: SiteSummaryTile = tileByKey("unhealthy-sites");
const NO_DATA_TILE: SiteSummaryTile = tileByKey("sites-no-data");
const UNASSIGNED_DEVICES_TILE: SiteSummaryTile = tileByKey(
  "devices-without-site",
);

describe("SITE_SUMMARY_TILES", () => {
  /*
   * The keys are the React keys and the `data-testid` suffixes the page's own
   * assertions and any e2e selector reach for, so they are part of the surface.
   */
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

  test("no two tiles share a key", () => {
    const keys: Array<string> = SITE_SUMMARY_TILES.map(
      (tile: SiteSummaryTile) => {
        return tile.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
   * The labels and captions are the product surface, unchanged by this feature —
   * the tiles became clickable, they did not become different tiles.
   */
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

    expect(UNASSIGNED_DEVICES_TILE.caption).toBe(
      "Devices not assigned to any site.",
    );
  });

  test("every tile has a label, a caption and an attention colour", () => {
    for (const tile of SITE_SUMMARY_TILES) {
      expect(tile.label.length).toBeGreaterThan(0);
      expect(tile.caption.length).toBeGreaterThan(0);
      expect(tile.attentionClassName.length).toBeGreaterThan(0);
    }
  });

  test("each tile reads a distinct count", () => {
    const countFields: Array<string> = SITE_SUMMARY_TILES.map(
      (tile: SiteSummaryTile) => {
        return tile.countField;
      },
    );

    expect(countFields).toEqual([
      "totalSites",
      "unhealthySites",
      "sitesWithNoData",
      "devicesWithoutSite",
    ]);
    expect(new Set(countFields).size).toBe(countFields.length);
  });

  /*
   * The strip renders `counts?.[tile.countField] || 0`, so a tile naming a field
   * the fetch does not set shows a permanent zero rather than failing.
   */
  test("every count field is one the summary fetch produces", () => {
    const fetched: Array<string> = Object.keys(SUMMARY_COUNTS);

    for (const tile of SITE_SUMMARY_TILES) {
      expect(fetched).toContain(tile.countField);
    }

    // And nothing is counted that no tile displays.
    expect(fetched).toHaveLength(SITE_SUMMARY_TILES.length);
  });

  describe("what each tile does when it is activated", () => {
    /*
     * The total is not a subset — activating it means "show me everything
     * again", which is the only sensible drill-down for a total and doubles as a
     * second way out of a filtered view.
     */
    test("exactly one tile clears the chips, and it is the total", () => {
      expect(
        SITE_SUMMARY_TILES.filter((tile: SiteSummaryTile) => {
          return tile.action === SiteSummaryTileAction.ClearFilters;
        }),
      ).toEqual([TOTAL_TILE]);
      expect(TOTAL_TILE.statusFilter).toBeUndefined();
    });

    /*
     * This is the tile that counts something the sites table cannot show. Wired
     * to FilterSites it would carry no statusFilter, and the click would clear
     * the chips instead of opening the rows it counted.
     */
    test("exactly one tile leaves for the device list", () => {
      expect(
        SITE_SUMMARY_TILES.filter((tile: SiteSummaryTile) => {
          return tile.action === SiteSummaryTileAction.ShowUnassignedDevices;
        }),
      ).toEqual([UNASSIGNED_DEVICES_TILE]);
      expect(UNASSIGNED_DEVICES_TILE.statusFilter).toBeUndefined();
    });

    test("the two site counts move a chip on this page", () => {
      expect(UNHEALTHY_TILE.action).toBe(SiteSummaryTileAction.FilterSites);
      expect(UNHEALTHY_TILE.statusFilter).toBe(
        SiteSummaryStatusFilter.Unhealthy,
      );

      expect(NO_DATA_TILE.action).toBe(SiteSummaryTileAction.FilterSites);
      expect(NO_DATA_TILE.statusFilter).toBe(SiteSummaryStatusFilter.NoData);
    });

    /*
     * A FilterSites tile with no statusFilter falls off the end of
     * getSiteFacetSelectionForTile and returns null, which renders the tile
     * inert — a count nobody can open, with nothing on screen to say why.
     */
    test("every FilterSites tile carries a real status filter", () => {
      const filters: Array<SiteSummaryStatusFilter> = [];

      for (const tile of SITE_SUMMARY_TILES) {
        if (tile.action !== SiteSummaryTileAction.FilterSites) {
          continue;
        }

        expect(tile.statusFilter).toBeDefined();
        expect(Object.values(SiteSummaryStatusFilter)).toContain(
          tile.statusFilter!,
        );
        filters.push(tile.statusFilter!);
      }

      expect(filters).toHaveLength(2);
      // Two tiles on one filter would light together on one click.
      expect(new Set(filters).size).toBe(filters.length);
    });

    test("every tile declares a known action, so none is silently inert", () => {
      const actions: Array<string> = Object.values(SiteSummaryTileAction);

      for (const tile of SITE_SUMMARY_TILES) {
        expect(actions).toContain(tile.action);
      }
    });
  });
});

describe("getSiteFacetSelectionForTile", () => {
  /*
   * `facetKey: null` is the bar-wide instruction — applyFacetTileSelection reads
   * it as "clear every chip" rather than as a chip to set. A key here instead
   * would turn the total into just another filter.
   */
  test("the total clears every chip", () => {
    expect(getSiteFacetSelectionForTile(TOTAL_TILE, CONTEXT)).toEqual({
      facetKey: null,
      values: [],
      operator: "is",
    });
  });

  /*
   * "Sites Without Data" are the sites with no rolled-up status at all, and
   * there is no value to select for "nothing" — the chip's `is empty` operator
   * is the whole selection, and it is what asks currentMonitorStatusId for NULL.
   * An "is" with no values would be an unconstrained chip over the full list.
   */
  test("Sites Without Data is the Status chip on 'is empty'", () => {
    expect(getSiteFacetSelectionForTile(NO_DATA_TILE, CONTEXT)).toEqual({
      facetKey: SITE_STATUS_FACET_KEY,
      values: [],
      operator: "is_empty",
    });
  });

  /*
   * The unhealthy chip selects exactly the statuses behind the number on the
   * tile — the ones the counted sites were actually rolling up, resolved from
   * the same response the count came out of — not every non-operational status
   * the project happens to define.
   */
  test("Unhealthy Sites selects the statuses the count came from", () => {
    const selection: FacetTileSelection | null = getSiteFacetSelectionForTile(
      UNHEALTHY_TILE,
      CONTEXT,
    );

    expect(selection).not.toBeNull();
    expect(selection!.facetKey).toBe(SITE_STATUS_FACET_KEY);
    expect(selection!.operator).toBe("is");
    expect(new Set(selection!.values)).toEqual(
      new Set(CONTEXT.unhealthyStatusIds),
    );
    expect(selection!.values).toHaveLength(CONTEXT.unhealthyStatusIds.length);
  });

  test("a single unhealthy status is still an 'is' selection, not a shortcut", () => {
    expect(
      getSiteFacetSelectionForTile(UNHEALTHY_TILE, {
        unhealthyStatusIds: [OFFLINE_STATUS_ID],
      }),
    ).toEqual({
      facetKey: SITE_STATUS_FACET_KEY,
      values: [OFFLINE_STATUS_ID],
      operator: "is",
    });
  });

  /*
   * The one that matters most here. The status ids are empty until the counts
   * land, and stay empty for a fleet that is entirely healthy. Returning an
   * empty selection would clear the chip and show every site under a lit
   * "Unhealthy" tile — a worse lie than the click doing nothing, which is what
   * null buys: the page leaves the tile inert.
   */
  describe("Unhealthy Sites with no status ids yet", () => {
    test("an empty list is no selection at all", () => {
      expect(
        getSiteFacetSelectionForTile(UNHEALTHY_TILE, {
          unhealthyStatusIds: [],
        }),
      ).toBeNull();
    });

    /*
     * The context is assembled from component state, but a caller that forgets
     * the field, or an older build's shape, must not reach the bar as a chip
     * selecting `undefined`.
     */
    test.each([
      ["a missing field", {}],
      ["an explicit undefined", { unhealthyStatusIds: undefined }],
      ["a null", { unhealthyStatusIds: null }],
    ])("%s is no selection either", (_label: string, context: unknown) => {
      expect(
        getSiteFacetSelectionForTile(
          UNHEALTHY_TILE,
          context as SiteSummaryTileContext,
        ),
      ).toBeNull();
    });
  });

  /*
   * The rows behind this count are devices; this page lists sites. Null is how
   * the tile says "I have no chip here" — the page then navigates instead, and a
   * selection returned here would narrow the sites table by a device predicate
   * that empties it.
   */
  test("the Unassigned Devices tile has no chip on this page", () => {
    expect(
      getSiteFacetSelectionForTile(UNASSIGNED_DEVICES_TILE, CONTEXT),
    ).toBeNull();
  });

  /*
   * Whatever a tile returns has to name a chip the sites bar actually renders.
   * A device facet key would sail through applyFacetTileSelection, write a
   * selection no chip displays, and narrow the list with nothing to explain it.
   */
  test("never names a chip this page does not have", () => {
    for (const tile of SITE_SUMMARY_TILES) {
      const selection: FacetTileSelection | null = getSiteFacetSelectionForTile(
        tile,
        CONTEXT,
      );

      if (!selection || selection.facetKey === null) {
        continue;
      }

      expect(SITE_FACET_KEYS).toContain(selection.facetKey);
    }
  });

  /*
   * The strip calls this on every render, and the page memoises nothing over it.
   * Nothing here reads the clock or a counter, so the same tile and the same
   * context always produce the same selection — which is what keeps the pressed
   * state stable between renders.
   */
  test("the same tile and context always produce the same selection", () => {
    for (const tile of SITE_SUMMARY_TILES) {
      expect(JSON.stringify(getSiteFacetSelectionForTile(tile, CONTEXT))).toBe(
        JSON.stringify(getSiteFacetSelectionForTile(tile, CONTEXT)),
      );
    }
  });
});

/*
 * The invariant that keeps the lit tile and the visible chips agreeing: apply
 * what a tile describes to the bar, and that tile — and only that tile — reads
 * as applied. isFacetTileSelectionApplied drives both the pressed state and the
 * toggle-off, so a disagreement here is a tile that looks lit but that a second
 * click cannot turn off.
 */
describe("round-tripping the tiles through isFacetTileSelectionApplied", () => {
  interface SelectableTile {
    tile: SiteSummaryTile;
    selection: FacetTileSelection;
  }

  function selectableTiles(): Array<SelectableTile> {
    const selectable: Array<SelectableTile> = [];

    for (const tile of SITE_SUMMARY_TILES) {
      const selection: FacetTileSelection | null = getSiteFacetSelectionForTile(
        tile,
        CONTEXT,
      );

      if (selection) {
        selectable.push({ tile: tile, selection: selection });
      }
    }

    return selectable;
  }

  test("the three site tiles are the ones with a chip to move", () => {
    expect(
      selectableTiles().map((entry: SelectableTile) => {
        return entry.tile.key;
      }),
    ).toEqual(["total-sites", "unhealthy-sites", "sites-no-data"]);
  });

  test("applying a tile's selection lights that tile and no other", () => {
    for (const applied of selectableTiles()) {
      const state: FacetState = facetStateFor(applied.selection);

      for (const other of selectableTiles()) {
        expect(
          isFacetTileSelectionApplied(
            other.selection,
            state.facetSelections,
            state.facetOperators,
          ),
        ).toBe(other.tile.key === applied.tile.key);
      }
    }
  });

  /*
   * The bar as the user first meets it. The total is "everything", so it is the
   * one that reads as applied on an untouched page — otherwise a fresh list
   * would show no tile lit and the strip would look inert.
   */
  test("an untouched bar lights the total, and only the total", () => {
    for (const entry of selectableTiles()) {
      expect(isFacetTileSelectionApplied(entry.selection, {}, {})).toBe(
        entry.tile.key === "total-sites",
      );
    }
  });

  /*
   * The chip stores the order the user clicked in; a tile hands over whatever
   * order the count response produced. If order mattered, selecting the same two
   * statuses by hand would leave the Unhealthy tile dark.
   */
  test("the Unhealthy tile stays lit whatever order the chip holds", () => {
    const selection: FacetTileSelection = getSiteFacetSelectionForTile(
      UNHEALTHY_TILE,
      CONTEXT,
    )!;

    expect(
      isFacetTileSelectionApplied(
        selection,
        { [SITE_STATUS_FACET_KEY]: [...selection.values].reverse() },
        { [SITE_STATUS_FACET_KEY]: "is" },
      ),
    ).toBe(true);
  });

  /*
   * A duplicate can reach the tile from the count response only through a bug,
   * but both sides are normalised before comparison, so it cannot leave the tile
   * dark over a chip that is in fact showing what it describes.
   */
  test("a duplicated status id does not unlight the tile", () => {
    const selection: FacetTileSelection = {
      facetKey: SITE_STATUS_FACET_KEY,
      values: [DEGRADED_STATUS_ID, DEGRADED_STATUS_ID],
      operator: "is",
    };

    expect(
      isFacetTileSelectionApplied(
        selection,
        { [SITE_STATUS_FACET_KEY]: [DEGRADED_STATUS_ID] },
        { [SITE_STATUS_FACET_KEY]: "is" },
      ),
    ).toBe(true);
  });

  /*
   * "These two statuses" is not applied while only one of them is selected, and
   * not applied with a third added — the tile counted a specific set, and a lit
   * tile over a wider or narrower chip would misreport what the list is showing.
   */
  describe("the value set has to match exactly", () => {
    const selection: FacetTileSelection = getSiteFacetSelectionForTile(
      UNHEALTHY_TILE,
      CONTEXT,
    )!;

    test("a subset does not light it", () => {
      expect(
        isFacetTileSelectionApplied(
          selection,
          { [SITE_STATUS_FACET_KEY]: [DEGRADED_STATUS_ID] },
          { [SITE_STATUS_FACET_KEY]: "is" },
        ),
      ).toBe(false);
    });

    test("an extra status does not light it", () => {
      expect(
        isFacetTileSelectionApplied(
          selection,
          {
            [SITE_STATUS_FACET_KEY]: [
              ...selection.values,
              NEVER_COUNTED_STATUS_ID,
            ],
          },
          { [SITE_STATUS_FACET_KEY]: "is" },
        ),
      ).toBe(false);
    });

    /*
     * Same chip, same (empty) values, different operator: "no rolled-up status"
     * and "any of these statuses" are different row sets, so the operator alone
     * has to be able to tell the two tiles apart.
     */
    test("the same chip on the other operator does not light it", () => {
      expect(
        isFacetTileSelectionApplied(
          getSiteFacetSelectionForTile(NO_DATA_TILE, CONTEXT)!,
          { [SITE_STATUS_FACET_KEY]: [] },
          { [SITE_STATUS_FACET_KEY]: "is" },
        ),
      ).toBe(false);
    });
  });

  /*
   * A chip the tiles know nothing about — the site Type chip, say — still counts
   * as filtering, so the total must not claim the list is unfiltered while a
   * different chip is narrowing it.
   */
  test("another chip's selection unlights the total", () => {
    expect(
      isFacetTileSelectionApplied(
        getSiteFacetSelectionForTile(TOTAL_TILE, CONTEXT)!,
        { [SITE_TYPE_FACET_KEY]: ["some-site-type-id"] },
        {},
      ),
    ).toBe(false);
  });
});

describe("UNASSIGNED_DEVICES_FACET_SELECTION", () => {
  /*
   * The hand-off between the two pages. The Sites page counts unassigned devices
   * and links to the device list; the device list has to come up showing exactly
   * the rows behind that count. Re-exporting the device page's own selection —
   * rather than restating it here — is what stops the two definitions of
   * "unassigned" from drifting into a link that lands on an unfiltered fleet.
   */
  test("is the very selection the device page defines", () => {
    expect(UNASSIGNED_DEVICES_FACET_SELECTION).toBe(
      DEVICE_FACETS_UNASSIGNED_DEVICES_FACET_SELECTION,
    );
    expect(UNASSIGNED_DEVICES_FACET_SELECTION).toEqual(
      DEVICE_FACETS_UNASSIGNED_DEVICES_FACET_SELECTION,
    );
  });

  /*
   * "Assigned to no site at all" is the Site chip's `is empty` — the only form
   * that finds devices with no site row to join against. Values with it would be
   * a contradiction the bar cannot show.
   */
  test("is the device Site chip on 'is empty'", () => {
    expect(UNASSIGNED_DEVICES_FACET_SELECTION).toEqual({
      facetKey: DEVICE_SITE_FACET_KEY,
      values: [],
      operator: "is_empty",
    });
  });

  /*
   * It addresses the device table's bar, not this one. Applied here it would set
   * a chip the sites page never renders.
   */
  test("names a device chip, not a site chip", () => {
    expect(SITE_FACET_KEYS).not.toContain(
      UNASSIGNED_DEVICES_FACET_SELECTION.facetKey,
    );
  });
});
