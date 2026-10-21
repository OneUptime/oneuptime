import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { INVENTORY_SUMMARY_TILES } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySummaryTiles";

/*
 * Adding archiving split the product's rows into two disjoint halves, and
 * introduced a way for its two summaries to disagree that no existing test
 * could see.
 *
 * The Overview's numbers come from one query; the list the tiles drill into
 * runs its own. Those are two queries against one table, written in two
 * places, and nothing tied them together — so the Overview once counted
 * archived rows while the list excluded them. "Total Items: 100" landing on a
 * list of 95, with no error anywhere.
 *
 * The Overview's query now runs on the server (InventoryItemService's
 * getOverviewCounts, plus the "Recently added" read in the Overview
 * endpoint), so this reads those sources beside the list's, at source level,
 * which is the only place the two are comparable.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const OVERVIEW_ENDPOINT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "BaseAPI",
  "API",
  "InventoryOverview.ts",
);

const INVENTORY_SERVICE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Services",
  "InventoryItemService.ts",
);

type ReadCodeFunction = (...segments: Array<string>) => string;

type SquashFileFunction = (filePath: string) => string;

const squashFile: SquashFileFunction = (filePath: string): string => {
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

const readCode: ReadCodeFunction = (...segments: Array<string>): string => {
  return squashFile(path.join(DASHBOARD_SRC, ...segments));
};

// Just the counting method, so a match elsewhere in the service cannot satisfy these.
const readOverviewCountsMethod: () => string = (): string => {
  const service: string = squashFile(INVENTORY_SERVICE);
  const start: number = service.indexOf("public async getOverviewCounts(");
  const end: number = service.indexOf(
    "return readInventoryOverviewGroups(rows);",
    start,
  );

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return service.slice(start, end);
};

describe("the Overview and the list count the same rows", () => {
  const overview: string = readCode("Pages", "Inventory", "Overview.tsx");
  const counting: string = readOverviewCountsMethod();
  const endpoint: string = squashFile(OVERVIEW_ENDPOINT);
  const table: string = readCode(
    "Components",
    "Inventory",
    "InventoryTable.tsx",
  );

  test("the Overview's counts exclude archived rows", () => {
    /*
     * The bug this exists for. Without it every tile overstates the estate by
     * however many rows someone has archived, and each one drills into a
     * shorter list than its own number.
     */
    expect(counting).toContain("isArchived: false");
  });

  test("its recently added rows exclude them too", () => {
    expect(endpoint).toContain("isArchived: false");
  });

  test("the list excludes archived rows too, on its live view", () => {
    expect(table).toContain("isArchived: isArchivedView");
  });

  test("both scope by project", () => {
    // The tenant boundary is not optional on either.
    expect(counting).toContain("projectId: data.projectId");
    expect(endpoint).toContain("const projectId: ObjectID = props.tenantId;");
    expect(table).toContain("ProjectUtil.getCurrentProjectId()!");
  });

  test("the Overview makes one request, so its sections cannot disagree", () => {
    expect((overview.match(/fetchInventoryOverview\(\)/g) || []).length).toBe(
      1,
    );
    expect(overview).not.toContain("ModelAPI");
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

describe("the tiles leave archiving to the query", () => {
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
