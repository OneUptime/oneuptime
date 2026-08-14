import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import {
  EMPTY_INVENTORY_SUMMARY_COUNTS,
  INVENTORY_SUMMARY_TILES,
  InventorySummaryCounts,
  InventorySummaryRow,
  InventorySummaryTile,
  getInventoryTileCount,
  rowMatchesScope,
  summarizeInventory,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";
import {
  InventoryScope,
  buildInventoryScopeQueryString,
  parseInventoryScope,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryScope";
import { INVENTORY_STALE_AFTER_MINUTES } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";

/*
 * The invariant worth protecting here is that a tile's number and the list a
 * click on it opens describe the same rows. Both come from `scope`: the fold
 * produces the number, the Items page turns the same scope into its query. So
 * these tests walk each tile's scope back through `rowMatchesScope` over a
 * fixture estate and check the two agree — rather than comparing the tile
 * against a literal copied out of the module, which would pass even if both
 * were wrong.
 */

const NOW: Date = new Date("2026-08-13T12:00:00.000Z");

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

const FRESH: Date = minutesAgo(5);
const STALE: Date = minutesAgo(INVENTORY_STALE_AFTER_MINUTES + 60);

/*
 * A deliberately awkward estate: live and stale discovered rows, mirrored and
 * manual rows whose ancient timestamps must not count as stale, a discovered
 * row that has never reported, and a row whose source this build has never
 * heard of.
 */
const ESTATE: Array<InventorySummaryRow> = [
  { source: EntitySource.Discovered, lastSeenAt: FRESH },
  { source: EntitySource.Discovered, lastSeenAt: FRESH },
  { source: EntitySource.Discovered, lastSeenAt: STALE },
  { source: EntitySource.Discovered, lastSeenAt: STALE },
  { source: EntitySource.Discovered, lastSeenAt: STALE },
  { source: EntitySource.Discovered, lastSeenAt: undefined },
  { source: EntitySource.Inventory, lastSeenAt: STALE },
  { source: EntitySource.Inventory, lastSeenAt: undefined },
  { source: EntitySource.Manual, lastSeenAt: STALE },
  { source: "some-future-source", lastSeenAt: STALE },
];

describe("summarizeInventory", () => {
  test("an empty estate is all zeroes", () => {
    expect(summarizeInventory([], NOW)).toEqual(EMPTY_INVENTORY_SUMMARY_COUNTS);
  });

  test("the total counts every row, including unknown sources", () => {
    /*
     * The total is what a user reads as "how much do I own". Skipping rows we
     * cannot categorise would understate it.
     */
    expect(summarizeInventory(ESTATE, NOW).total).toBe(ESTATE.length);
  });

  test("rows are counted into their source bucket", () => {
    const counts: InventorySummaryCounts = summarizeInventory(ESTATE, NOW);

    expect(counts.discovered).toBe(6);
    expect(counts.mirrored).toBe(2);
    expect(counts.manual).toBe(1);
  });

  test("only discovered rows can be stale", () => {
    /*
     * The mirrored and manual rows in the fixture are far older than the
     * cutoff. Counting them would put every network device in the project
     * under a red "Gone Quiet" number.
     */
    expect(summarizeInventory(ESTATE, NOW).stale).toBe(3);
  });

  test("a discovered row that never reported is not counted stale", () => {
    expect(
      summarizeInventory(
        [{ source: EntitySource.Discovered, lastSeenAt: undefined }],
        NOW,
      ).stale,
    ).toBe(0);
  });

  test("a row with an unknown source is never counted stale", () => {
    expect(
      summarizeInventory(
        [{ source: "some-future-source", lastSeenAt: STALE }],
        NOW,
      ).stale,
    ).toBe(0);
  });

  test("the fold does not mutate the shared empty-counts constant", () => {
    summarizeInventory(ESTATE, NOW);

    expect(EMPTY_INVENTORY_SUMMARY_COUNTS).toEqual({
      total: 0,
      discovered: 0,
      mirrored: 0,
      manual: 0,
      stale: 0,
    });
  });

  test("the source buckets never exceed the total", () => {
    const counts: InventorySummaryCounts = summarizeInventory(ESTATE, NOW);

    expect(
      counts.discovered + counts.mirrored + counts.manual,
    ).toBeLessThanOrEqual(counts.total);
  });
});

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

describe("each tile's scope selects exactly the rows its count counted", () => {
  const counts: InventorySummaryCounts = summarizeInventory(ESTATE, NOW);

  test.each(INVENTORY_SUMMARY_TILES)(
    "the $key tile's number matches its drill-down",
    (tile: InventorySummaryTile) => {
      const matching: number = ESTATE.filter(
        (row: InventorySummaryRow): boolean => {
          return rowMatchesScope(row, tile.scope, NOW);
        },
      ).length;

      expect(matching).toBe(getInventoryTileCount(tile, counts));
    },
  );

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

  test("the stale tile counts strictly fewer rows than the discovered tile", () => {
    // Sanity on the fixture itself: a degenerate estate would pass vacuously.
    expect(counts.stale).toBeGreaterThan(0);
    expect(counts.stale).toBeLessThan(counts.discovered);
  });
});

describe("rowMatchesScope", () => {
  test("the empty scope matches everything", () => {
    for (const row of ESTATE) {
      expect(rowMatchesScope(row, {}, NOW)).toBe(true);
    }
  });

  test("a source scope excludes other sources", () => {
    expect(
      rowMatchesScope(
        { source: EntitySource.Manual, lastSeenAt: FRESH },
        { source: EntitySource.Discovered },
        NOW,
      ),
    ).toBe(false);
  });

  test("staleOnly excludes a live discovered row", () => {
    expect(
      rowMatchesScope(
        { source: EntitySource.Discovered, lastSeenAt: FRESH },
        { staleOnly: true },
        NOW,
      ),
    ).toBe(false);
  });

  test("staleOnly excludes an ancient mirrored row", () => {
    expect(
      rowMatchesScope(
        { source: EntitySource.Inventory, lastSeenAt: STALE },
        { staleOnly: true },
        NOW,
      ),
    ).toBe(false);
  });

  test("staleOnly includes a stale discovered row", () => {
    expect(
      rowMatchesScope(
        { source: EntitySource.Discovered, lastSeenAt: STALE },
        { staleOnly: true },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("getInventoryTileCount", () => {
  test("reads zero while the counts are still loading", () => {
    for (const tile of INVENTORY_SUMMARY_TILES) {
      expect(getInventoryTileCount(tile, null)).toBe(0);
    }
  });
});
