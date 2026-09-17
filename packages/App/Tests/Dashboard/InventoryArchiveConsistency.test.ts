import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import fs from "fs";
import path from "path";
import {
  INVENTORY_SUMMARY_TILES,
  InventorySummaryCounts,
  InventorySummaryRow,
  getInventoryTileCount,
  rowMatchesScope,
  summarizeInventory,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";

/*
 * Adding archiving split the product's rows into two disjoint halves, and
 * introduced a way for its two summaries to disagree that no existing test
 * could see.
 *
 * The Overview counts rows it fetches itself; the list the tiles drill into
 * fetches its own. Those are two queries against one table, written in two
 * files, and nothing tied them together — so the Overview counted archived
 * rows while the list excluded them. "Total Items: 100" landing on a list of
 * 95, with no error anywhere.
 *
 * The existing summary-tile test could not catch it: it exercises the pure
 * fold, which is handed rows and never sees a query. So this checks the
 * queries themselves, at source level, which is the only place the two are
 * comparable — plus the fold's behaviour on archived rows, so the two halves
 * of the guarantee are both pinned.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

describe("the Overview and the list count the same rows", () => {
  const overview: string = readCode("Pages", "Inventory", "Overview.tsx");
  const table: string = readCode(
    "Components",
    "Inventory",
    "InventoryTable.tsx",
  );

  test("the Overview excludes archived rows", () => {
    /*
     * The bug this exists for. Without it every tile overstates the estate by
     * however many rows someone has archived, and each one drills into a
     * shorter list than its own number.
     */
    expect(overview).toContain("isArchived: false");
  });

  test("the list excludes archived rows too, on its live view", () => {
    expect(table).toContain("isArchived: isArchivedView");
  });

  test("both scope by project", () => {
    // The tenant boundary is not optional on either.
    expect(overview).toContain("projectId");
    expect(table).toContain("ProjectUtil.getCurrentProjectId()!");
  });

  test("the Overview reads one snapshot, so its sections cannot disagree", () => {
    expect((overview.match(/ModelAPI\.getList/g) || []).length).toBe(1);
  });

  test("the archived page is the only surface that asks for archived rows", () => {
    /*
     * If a second page grew its own `isArchived: true` query it would be a
     * second definition of "archived", free to drift from this one.
     */
    const archived: string = readCode("Pages", "Inventory", "Archived.tsx");

    expect(archived).toContain("archivedOnly={true}");
    expect(archived).not.toContain("isArchived:");
  });
});

describe("the fold is unaffected by archiving", () => {
  /*
   * The complement of the query test: archiving is enforced by the query, so
   * the fold must NOT also filter on it. If it did, the archived list — which
   * runs no fold at all — would still be right, but any future caller folding
   * archived rows would silently get zeroes.
   */
  const NOW: Date = new Date("2026-08-13T12:00:00.000Z");

  interface ArchivableRow extends InventorySummaryRow {
    isArchived?: boolean;
  }

  const ROWS: Array<ArchivableRow> = [
    { source: EntitySource.Discovered, lastSeenAt: NOW, isArchived: false },
    { source: EntitySource.Discovered, lastSeenAt: NOW, isArchived: true },
    { source: EntitySource.Manual, lastSeenAt: undefined, isArchived: true },
  ];

  test("it counts whatever rows it is handed", () => {
    expect(summarizeInventory(ROWS, NOW).total).toBe(ROWS.length);
  });

  test("it does not silently drop archived rows", () => {
    /*
     * Stated as an explicit expectation rather than left implicit: the fold's
     * contract is "count these", and the caller decides which these are.
     */
    const withoutArchived: Array<ArchivableRow> = ROWS.filter(
      (row: ArchivableRow): boolean => {
        return !row.isArchived;
      },
    );

    expect(summarizeInventory(withoutArchived, NOW).total).toBe(1);
    expect(summarizeInventory(ROWS, NOW).total).toBe(3);
  });

  test("every tile still agrees with its own scope over these rows", () => {
    /*
     * The invariant from InventorySummaryTiles, re-checked with archived rows
     * in the mix, since that is the input shape that changed.
     */
    const counts: InventorySummaryCounts = summarizeInventory(ROWS, NOW);

    for (const tile of INVENTORY_SUMMARY_TILES) {
      const matching: number = ROWS.filter((row: ArchivableRow): boolean => {
        return rowMatchesScope(row, tile.scope, NOW);
      }).length;

      expect(matching).toBe(getInventoryTileCount(tile, counts));
    }
  });

  test("no tile scopes on archived, which the query already handles", () => {
    /*
     * A tile carrying an archived scope would be narrowing rows the query has
     * already removed, and the number would silently be zero.
     */
    for (const tile of INVENTORY_SUMMARY_TILES) {
      expect(Object.keys(tile.scope)).not.toContain("isArchived");
    }
  });
});

describe("the drill-down target respects archiving", () => {
  test("every tile links to the live list, not the archived one", () => {
    /*
     * Tiles count live rows, so they must land on the live list. A tile
     * pointing at the archived route would show none of what it counted.
     */
    const cards: string = readCode(
      "Components",
      "Inventory",
      "InventorySummaryCards.tsx",
    );

    expect(cards).toContain("RouteMap[PageMap.INVENTORY_ITEMS]");
    expect(cards).not.toContain("INVENTORY_ARCHIVED");
  });

  test("the category breakdown links to the live list too", () => {
    const breakdown: string = readCode(
      "Components",
      "Inventory",
      "InventoryBreakdown.tsx",
    );

    expect(breakdown).toContain("RouteMap[PageMap.INVENTORY_ITEMS]");
    expect(breakdown).not.toContain("INVENTORY_ARCHIVED");
  });
});
