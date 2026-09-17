import { describe, expect, test } from "@jest/globals";
import {
  applySloStatusSummaryTile,
  getSloListBaseQuery,
  getSloListStatusKind,
  getSloStatusSummaryTileColor,
  getSloStatusSummaryTileQuery,
  getSloStatusSummaryTileSelections,
  isSloStatusSummaryTileApplied,
  SLO_ENABLED_FACET_KEY,
  SLO_FACET_QUERY_FIELDS,
  SLO_LIST_FACETS,
  SLO_STATUS_FACET_KEY,
  SLO_STATUS_SUMMARY_TILES,
  SLOS_TABLE_ID,
  SloEnabledFacetValue,
  SloListStatusKind,
  SloStatusSummaryTile,
  SloStatusSummaryTileKey,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryTiles";
import {
  buildFacetColumnQuery,
  FacetColumnQuery,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import {
  FacetOperatorMap,
  FacetSelectionMap,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import Includes from "Common/Types/BaseDatabase/Includes";
import { Gray500 } from "Common/Types/BrandColors";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import { getSloStatusColor } from "Common/Utils/Slo/SloStatusColor";

/*
 * The SLO list's summary strip is only worth having if three things agree:
 * the number on a tile, the rows its click puts on screen, and the pill each
 * of those rows wears. They are built in three different places (a COUNT in
 * SloStatusSummaryCards, the facet bar's query on the SLOs page, the Status
 * column's getElement), all from the definitions in SloStatusSummaryTiles, so
 * that module is what these tests pin - with every combination of the two
 * lifecycle flags and every status, rather than a hand-picked few.
 */

interface SloRow {
  isArchived: boolean;
  isEnabled: boolean;
  sloStatus: SloStatus | null;
}

const ALL_ROWS: Array<SloRow> = [];

for (const isArchived of [false, true]) {
  for (const isEnabled of [true, false]) {
    for (const sloStatus of [...Object.values(SloStatus), null]) {
      ALL_ROWS.push({
        isArchived: isArchived,
        isEnabled: isEnabled,
        sloStatus: sloStatus,
      });
    }
  }
}

// Plain equality on every key the query names - all a count query uses.
function rowMatchesQuery(row: SloRow, query: Record<string, unknown>): boolean {
  return Object.keys(query).every((key: string): boolean => {
    return (row as unknown as Record<string, unknown>)[key] === query[key];
  });
}

function tilesCounting(row: SloRow): Array<SloStatusSummaryTile> {
  return SLO_STATUS_SUMMARY_TILES.filter(
    (tile: SloStatusSummaryTile): boolean => {
      return rowMatchesQuery(
        row,
        getSloStatusSummaryTileQuery(tile) as Record<string, unknown>,
      );
    },
  );
}

function tileByKey(key: SloStatusSummaryTileKey): SloStatusSummaryTile {
  const tile: SloStatusSummaryTile | undefined = SLO_STATUS_SUMMARY_TILES.find(
    (candidate: SloStatusSummaryTile): boolean => {
      return candidate.key === key;
    },
  );

  if (!tile) {
    throw new Error(`No summary tile ${key}`);
  }

  return tile;
}

/*
 * A stand-in for useResourceOwners' facet state. Like the hook, a change is not
 * visible to the handler that made it until the next render - the maps a click
 * handler was given are a snapshot.
 */
interface FakeFacetBar {
  selections: FacetSelectionMap;
  operators: FacetOperatorMap;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
}

function makeFacetBar(
  selections: FacetSelectionMap = {},
  operators: FacetOperatorMap = {},
): FakeFacetBar {
  const bar: FakeFacetBar = {
    selections: { ...selections },
    operators: { ...operators },
    setFacetSelection: (): void => {},
  };

  bar.setFacetSelection = (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ): void => {
    bar.selections = { ...bar.selections, [facetKey]: values };
    bar.operators = { ...bar.operators, [facetKey]: operator || "is" };
  };

  return bar;
}

function clickTile(bar: FakeFacetBar, key: SloStatusSummaryTileKey): void {
  applySloStatusSummaryTile({
    tile: tileByKey(key),
    facetSelections: bar.selections,
    facetOperators: bar.operators,
    setFacetSelection: bar.setFacetSelection,
  });
}

function isApplied(bar: FakeFacetBar, key: SloStatusSummaryTileKey): boolean {
  return isSloStatusSummaryTileApplied(
    tileByKey(key),
    bar.selections,
    bar.operators,
  );
}

function facetByKey(key: string): ResourceFacet {
  const facet: ResourceFacet | undefined = SLO_LIST_FACETS.find(
    (candidate: ResourceFacet): boolean => {
      return candidate.key === key;
    },
  );

  if (!facet) {
    throw new Error(`No facet ${key}`);
  }

  return facet;
}

/*
 * What the facet bar would send for the given chips, on top of the live list's
 * base query - the same per-chip builder useResourceOwners' merge runs.
 */
function queryFromChips(bar: FakeFacetBar): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(getSloListBaseQuery() as Record<string, unknown>),
  };

  for (const facet of SLO_LIST_FACETS) {
    const field: string = facet.queryField || facet.key;
    const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
      facet: facet,
      operator: bar.operators[facet.key] || "is",
      values: bar.selections[facet.key] || [],
      existingValue: merged[field],
    });

    if (columnQuery) {
      merged[columnQuery.field] = columnQuery.value;
    }
  }

  return merged;
}

describe("the live SLO list's base query", () => {
  test("leaves archived SLOs out", () => {
    expect(getSloListBaseQuery()).toEqual({ isArchived: false });
  });

  test("is a fresh object on every call, so no caller can mutate another's", () => {
    expect(getSloListBaseQuery()).not.toBe(getSloListBaseQuery());
  });

  test("keeps the table id users' saved preferences and URLs are stored under", () => {
    expect(SLOS_TABLE_ID).toBe("slos-table");
  });
});

describe("how an SLO row reads", () => {
  test("Archived outranks Disabled, and Disabled outranks the measured status", () => {
    expect(getSloListStatusKind({ isArchived: true, isEnabled: false })).toBe(
      SloListStatusKind.Archived,
    );
    expect(getSloListStatusKind({ isArchived: true, isEnabled: true })).toBe(
      SloListStatusKind.Archived,
    );
    expect(getSloListStatusKind({ isArchived: false, isEnabled: false })).toBe(
      SloListStatusKind.Disabled,
    );
    expect(getSloListStatusKind({ isArchived: false, isEnabled: true })).toBe(
      SloListStatusKind.Measured,
    );
  });

  test("a row whose flags were not selected reads as measured rather than inventing a state", () => {
    expect(getSloListStatusKind({})).toBe(SloListStatusKind.Measured);
  });
});

describe("the summary tiles", () => {
  test("are the six statuses a live SLO can be in, in severity-reading order", () => {
    expect(
      SLO_STATUS_SUMMARY_TILES.map((tile: SloStatusSummaryTile): string => {
        return tile.label;
      }),
    ).toEqual([
      "Healthy",
      "At Risk",
      "Budget Exhausted",
      "Misconfigured",
      "Paused",
      "Disabled",
    ]);

    const keys: Array<string> = SLO_STATUS_SUMMARY_TILES.map(
      (tile: SloStatusSummaryTile): string => {
        return tile.key;
      },
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every SLO status has its own tile", () => {
    const statuses: Array<SloStatus | null> = SLO_STATUS_SUMMARY_TILES.map(
      (tile: SloStatusSummaryTile): SloStatus | null => {
        return tile.sloStatus;
      },
    );

    for (const status of Object.values(SloStatus)) {
      expect(statuses).toContain(status);
    }
  });

  test("every count query starts from the live list's base query", () => {
    for (const tile of SLO_STATUS_SUMMARY_TILES) {
      expect(getSloStatusSummaryTileQuery(tile)).toEqual(
        expect.objectContaining(getSloListBaseQuery()),
      );
    }
  });

  test("a status tile counts that status among enabled SLOs; the Disabled tile counts every disabled SLO", () => {
    expect(
      getSloStatusSummaryTileQuery(tileByKey(SloStatusSummaryTileKey.AtRisk)),
    ).toEqual({
      isArchived: false,
      isEnabled: true,
      sloStatus: SloStatus.AtRisk,
    });

    expect(
      getSloStatusSummaryTileQuery(tileByKey(SloStatusSummaryTileKey.Disabled)),
    ).toEqual({
      isArchived: false,
      isEnabled: false,
    });
  });

  test("no SLO is ever counted by two tiles", () => {
    for (const row of ALL_ROWS) {
      expect(tilesCounting(row).length).toBeLessThanOrEqual(1);
    }
  });

  test("an archived SLO is counted by no tile at all", () => {
    for (const row of ALL_ROWS.filter((candidate: SloRow): boolean => {
      return candidate.isArchived;
    })) {
      expect(tilesCounting(row)).toEqual([]);
    }
  });

  test("every live SLO is counted by exactly the tile its Status pill names", () => {
    for (const row of ALL_ROWS) {
      if (row.isArchived) {
        continue;
      }

      const counted: Array<SloStatusSummaryTile> = tilesCounting(row);
      const kind: SloListStatusKind = getSloListStatusKind(row);

      if (kind === SloListStatusKind.Disabled) {
        // Whatever stale status it kept, the pill says Disabled - and so does the tile.
        expect(
          counted.map((tile: SloStatusSummaryTile): string => {
            return tile.key;
          }),
        ).toEqual([SloStatusSummaryTileKey.Disabled]);
        continue;
      }

      if (row.sloStatus === null) {
        // Never evaluated yet: no status to count it under.
        expect(counted).toEqual([]);
        continue;
      }

      expect(counted).toHaveLength(1);
      expect(counted[0]!.sloStatus).toBe(row.sloStatus);
      expect(counted[0]!.isEnabled).toBe(true);
    }
  });

  test("the dot beside each caption is the colour of the status pills it counts", () => {
    for (const tile of SLO_STATUS_SUMMARY_TILES) {
      const expected: string = tile.sloStatus
        ? getSloStatusColor(tile.sloStatus).toString()
        : Gray500.toString();

      expect(getSloStatusSummaryTileColor(tile).toString()).toBe(expected);
    }
  });
});

describe("the facet bar the tiles move", () => {
  test("offers a multi-select Status chip over sloStatus, with every status and its colour", () => {
    const status: ResourceFacet = facetByKey(SLO_STATUS_FACET_KEY);

    expect(status.queryField).toBe(SLO_FACET_QUERY_FIELDS.status);
    expect(SLO_FACET_QUERY_FIELDS.status).toBe("sloStatus");
    expect(status.isMultiSelect).toBe(true);
    expect(status.options).toEqual(
      Object.values(SloStatus).map(
        (value: SloStatus): { value: string; label: string; color: string } => {
          return {
            value: value,
            label: value,
            color: getSloStatusColor(value).toString(),
          };
        },
      ),
    );
  });

  test("offers an Enabled chip over isEnabled that writes real booleans and no empty operators", () => {
    const enabled: ResourceFacet = facetByKey(SLO_ENABLED_FACET_KEY);

    expect(enabled.queryField).toBe(SLO_FACET_QUERY_FIELDS.enabled);
    expect(SLO_FACET_QUERY_FIELDS.enabled).toBe("isEnabled");
    expect(enabled.supportedOperators).toEqual(["is", "is_not"]);
    expect(enabled.toQueryValue!([SloEnabledFacetValue.Enabled], "is")).toBe(
      true,
    );
    expect(enabled.toQueryValue!([SloEnabledFacetValue.Disabled], "is")).toBe(
      false,
    );
  });

  test("never lets a chip write isArchived, so no chip can pull archived SLOs back into the list", () => {
    for (const facet of SLO_LIST_FACETS) {
      expect(facet.queryField || facet.key).not.toBe("isArchived");
    }
  });

  type TileCase = [string, SloStatusSummaryTileKey];

  const TILE_CASES: Array<TileCase> = SLO_STATUS_SUMMARY_TILES.map(
    (tile: SloStatusSummaryTile): TileCase => {
      return [tile.label, tile.key];
    },
  );

  test.each(TILE_CASES)(
    "the %s tile's chips ask for exactly the rows it counts",
    (_label: string, key: SloStatusSummaryTileKey) => {
      const bar: FakeFacetBar = makeFacetBar();
      clickTile(bar, key);

      const fromChips: Record<string, unknown> = queryFromChips(bar);
      const counted: Record<string, unknown> = getSloStatusSummaryTileQuery(
        tileByKey(key),
      ) as Record<string, unknown>;

      expect(fromChips["isArchived"]).toBe(counted["isArchived"]);
      expect(fromChips["isEnabled"]).toBe(counted["isEnabled"]);

      if (counted["sloStatus"] === undefined) {
        expect(fromChips["sloStatus"]).toBeUndefined();
      } else {
        expect(fromChips["sloStatus"]).toBeInstanceOf(Includes);
        expect((fromChips["sloStatus"] as Includes).values).toEqual([
          counted["sloStatus"],
        ]);
      }
    },
  );
});

describe("activating a tile", () => {
  test("sets both chips it stands for and lights up", () => {
    const bar: FakeFacetBar = makeFacetBar();

    clickTile(bar, SloStatusSummaryTileKey.Healthy);

    expect(bar.selections).toEqual({
      [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Enabled],
      [SLO_STATUS_FACET_KEY]: [SloStatus.Healthy],
    });
    expect(isApplied(bar, SloStatusSummaryTileKey.Healthy)).toBe(true);
    expect(isApplied(bar, SloStatusSummaryTileKey.AtRisk)).toBe(false);
  });

  test("a second click on a lit tile clears exactly what it set", () => {
    const bar: FakeFacetBar = makeFacetBar();

    clickTile(bar, SloStatusSummaryTileKey.BudgetExhausted);
    clickTile(bar, SloStatusSummaryTileKey.BudgetExhausted);

    expect(bar.selections[SLO_ENABLED_FACET_KEY]).toEqual([]);
    expect(bar.selections[SLO_STATUS_FACET_KEY]).toEqual([]);
    expect(isApplied(bar, SloStatusSummaryTileKey.BudgetExhausted)).toBe(false);
  });

  test("clicking another tile moves the bar rather than stacking statuses", () => {
    const bar: FakeFacetBar = makeFacetBar();

    clickTile(bar, SloStatusSummaryTileKey.Healthy);
    clickTile(bar, SloStatusSummaryTileKey.AtRisk);

    expect(bar.selections[SLO_STATUS_FACET_KEY]).toEqual([SloStatus.AtRisk]);
    expect(isApplied(bar, SloStatusSummaryTileKey.AtRisk)).toBe(true);
    expect(isApplied(bar, SloStatusSummaryTileKey.Healthy)).toBe(false);
  });

  test("the Disabled tile clears a leftover Status chip that would narrow it to rows it never counted", () => {
    const bar: FakeFacetBar = makeFacetBar();

    clickTile(bar, SloStatusSummaryTileKey.Healthy);
    clickTile(bar, SloStatusSummaryTileKey.Disabled);

    expect(bar.selections).toEqual({
      [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Disabled],
      [SLO_STATUS_FACET_KEY]: [],
    });
    expect(isApplied(bar, SloStatusSummaryTileKey.Disabled)).toBe(true);
  });

  test("the Disabled tile is not lit while a Status chip is still narrowing the disabled rows", () => {
    const bar: FakeFacetBar = makeFacetBar({
      [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Disabled],
      [SLO_STATUS_FACET_KEY]: [SloStatus.Paused],
    });

    expect(isApplied(bar, SloStatusSummaryTileKey.Disabled)).toBe(false);
  });

  test("leaves every chip it does not own alone, so drilling in keeps the owner already picked", () => {
    const bar: FakeFacetBar = makeFacetBar({ owner: ["user:1"] });

    clickTile(bar, SloStatusSummaryTileKey.Misconfigured);
    clickTile(bar, SloStatusSummaryTileKey.Misconfigured);

    expect(bar.selections["owner"]).toEqual(["user:1"]);
  });

  test("a status tile is not lit when the chip holds that status plus another", () => {
    const bar: FakeFacetBar = makeFacetBar({
      [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Enabled],
      [SLO_STATUS_FACET_KEY]: [SloStatus.Healthy, SloStatus.AtRisk],
    });

    expect(isApplied(bar, SloStatusSummaryTileKey.Healthy)).toBe(false);
    expect(isApplied(bar, SloStatusSummaryTileKey.AtRisk)).toBe(false);
  });

  test("a status tile is not lit when the chip excludes that status instead", () => {
    const bar: FakeFacetBar = makeFacetBar(
      {
        [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Enabled],
        [SLO_STATUS_FACET_KEY]: [SloStatus.Healthy],
      },
      { [SLO_STATUS_FACET_KEY]: "is_not" },
    );

    expect(isApplied(bar, SloStatusSummaryTileKey.Healthy)).toBe(false);

    // and activating it replaces the exclusion with the inclusion it counts.
    clickTile(bar, SloStatusSummaryTileKey.Healthy);
    expect(bar.operators[SLO_STATUS_FACET_KEY]).toBe("is");
    expect(bar.selections[SLO_STATUS_FACET_KEY]).toEqual([SloStatus.Healthy]);
  });

  test("a status tile is not lit without the Enabled chip: those rows would include disabled SLOs", () => {
    const bar: FakeFacetBar = makeFacetBar({
      [SLO_STATUS_FACET_KEY]: [SloStatus.Healthy],
    });

    expect(isApplied(bar, SloStatusSummaryTileKey.Healthy)).toBe(false);
  });

  test("every tile names both chips, so none of them leaves the other one stale", () => {
    for (const tile of SLO_STATUS_SUMMARY_TILES) {
      expect(
        getSloStatusSummaryTileSelections(tile)
          .map((selection: { facetKey: string | null }): string | null => {
            return selection.facetKey;
          })
          .sort(),
      ).toEqual([SLO_ENABLED_FACET_KEY, SLO_STATUS_FACET_KEY].sort());
    }
  });
});
