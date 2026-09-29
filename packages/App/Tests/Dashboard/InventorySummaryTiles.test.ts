import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import {
  InventoryLiveness,
  getInventoryLivenessSql,
} from "Common/Types/Telemetry/InventoryLiveness";
import { AggregateColumn } from "Common/Server/Types/Database/AggregateBy";
import {
  INVENTORY_OVERVIEW_SELECT,
  InventoryOverviewCounts,
  readInventoryOverviewGroups,
} from "Common/Server/Utils/Inventory/InventoryOverviewAggregation";
import {
  EMPTY_INVENTORY_SUMMARY_COUNTS,
  INVENTORY_SUMMARY_TILES,
  InventorySummaryCounts,
  InventorySummaryTile,
  getInventoryTileCount,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";
import {
  InventoryScope,
  buildInventoryScopeQueryString,
  parseInventoryScope,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryScope";

/*
 * The invariant worth protecting here is that a tile's number and the list a
 * click on it opens describe the same rows. The number is counted in Postgres
 * (InventoryItemService.getOverviewCounts); the list is the Items page's query
 * for the tile's `scope`. So these tests find, for each tile, the server
 * column its number is read from, and check that column filters on exactly
 * what the tile's scope narrows the list by. InventoryOverviewPostgres.test.ts
 * runs both queries against a real database; this half needs none, so it
 * runs everywhere.
 */

describe("the tile definitions", () => {
  test("there is at least one tile", () => {
    expect(INVENTORY_SUMMARY_TILES.length).toBeGreaterThan(0);
  });

  test("tile keys are unique — they are React keys and test ids", () => {
    const keys: Array<string> = INVENTORY_SUMMARY_TILES.map(
      (tile: InventorySummaryTile): string => {
        return tile.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile is fully described",
    (tile: InventorySummaryTile) => {
      expect(tile.label.length).toBeGreaterThan(0);
      expect(tile.caption.length).toBeGreaterThan(0);
      expect(tile.attentionClassName.length).toBeGreaterThan(0);
    },
  );

  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile reads a real count field",
    (tile: InventorySummaryTile) => {
      expect(Object.keys(EMPTY_INVENTORY_SUMMARY_COUNTS)).toContain(
        tile.countField,
      );
    },
  );

  test("exactly one tile is the unscoped total", () => {
    const unscoped: Array<InventorySummaryTile> =
      INVENTORY_SUMMARY_TILES.filter((tile: InventorySummaryTile): boolean => {
        return (
          !tile.scope.entityType && !tile.scope.source && !tile.scope.staleOnly
        );
      });

    expect(unscoped.length).toBe(1);
    expect(unscoped[0]!.countField).toBe("total");
  });
});

/*
 * Which server column feeds a counts field, found by feeding the server's own
 * fold one column at a time — so the mapping under test is the one the
 * endpoint really uses, not a copy of it written into this file.
 */
function columnFeeding(field: keyof InventorySummaryCounts): AggregateColumn {
  const feeding: Array<AggregateColumn> = INVENTORY_OVERVIEW_SELECT.filter(
    (column: AggregateColumn): boolean => {
      const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
        { entityType: null, [column.alias]: "1" },
      ]);
      return counts[field] === 1;
    },
  );

  expect(feeding).toHaveLength(1);
  return feeding[0]!;
}

// What the Items list filters on for a scope, as the FILTER a count must apply.
function expectedCountExpression(scope: InventoryScope): string {
  if (scope.staleOnly) {
    /*
     * The Stale facet filters on the status column, and that column's SQL
     * says "not tracked" for anything that is not discovered — so the stale
     * count needs no source clause, and a stale scope is only meaningful on
     * discovered rows.
     */
    expect(scope.source).toBe(EntitySource.Discovered);

    return `COUNT(*) FILTER (WHERE (${getInventoryLivenessSql(`"InventoryItem"`)}) = '${InventoryLiveness.Stale}')`;
  }

  if (scope.source) {
    return `COUNT(*) FILTER (WHERE "InventoryItem"."source" = '${scope.source}')`;
  }

  return "COUNT(*)";
}

describe("each tile's number is counted with its drill-down's own filter", () => {
  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile's count filters on exactly its scope",
    (tile: InventorySummaryTile) => {
      // No tile narrows by type; the server counts tiles across every type.
      expect(tile.scope.entityType).toBeUndefined();

      expect(columnFeeding(tile.countField).expression).toBe(
        expectedCountExpression(tile.scope),
      );
    },
  );

  test("every counts field has a tile, and every server column feeds one", () => {
    const tileFields: Array<string> = INVENTORY_SUMMARY_TILES.map(
      (tile: InventorySummaryTile): string => {
        return tile.countField;
      },
    ).sort();

    expect(tileFields).toEqual(
      Object.keys(EMPTY_INVENTORY_SUMMARY_COUNTS).sort(),
    );
    expect(INVENTORY_OVERVIEW_SELECT).toHaveLength(tileFields.length);
  });

  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile's scope survives the URL it links through",
    (tile: InventorySummaryTile) => {
      /*
       * The tile navigates, so the scope is only as good as its round trip. A
       * scope that half-survives opens a differently-filtered list under a
       * banner describing the original.
       */
      const searchParams: URLSearchParams = new URLSearchParams(
        buildInventoryScopeQueryString(tile.scope),
      );

      const parsed: InventoryScope = parseInventoryScope(
        (paramName: string): string | null => {
          return searchParams.get(paramName);
        },
      );

      expect(parsed).toEqual(tile.scope);
    },
  );
});

describe("getInventoryTileCount", () => {
  test("reads zero while the counts are still loading", () => {
    for (const tile of INVENTORY_SUMMARY_TILES) {
      expect(getInventoryTileCount(tile, null)).toBe(0);
    }
  });

  test("each tile reads its own field", () => {
    const counts: InventorySummaryCounts = {
      total: 48213,
      discovered: 47000,
      mirrored: 1100,
      manual: 113,
      stale: 3210,
    };

    for (const tile of INVENTORY_SUMMARY_TILES) {
      expect(getInventoryTileCount(tile, counts)).toBe(counts[tile.countField]);
    }
  });
});
