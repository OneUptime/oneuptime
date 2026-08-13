import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  MANUAL_ENTITY_TYPES,
} from "Common/Types/Telemetry/EntityTypeGroups";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The inventory list is the only surface that creates manual items, and the
 * shape of that form is load-bearing:
 *
 *   - Offering a discovered or inventory-mirrored type in the dropdown
 *     produces a form that always fails, because the service rejects those
 *     (see InventoryItemManualCreate.test.ts).
 *   - Offering `entityKey` as a field would let a user set an identity that
 *     does not match what the server derives.
 *   - Losing the Source column makes the three kinds of row visually
 *     indistinguishable, which matters because only manual ones are really
 *     deletable — the others come back.
 *
 * On top of those (inherited from the table's previous life as
 * EntitiesTable), this pins the presentation rules the overhaul introduced:
 * no cell shows a raw wire value, and the columns a user identifies a row by
 * cannot be customized away.
 *
 * The App suite runs in a plain Node environment with no React renderer, so
 * this pins the JSX wiring at source level, following the same invariant
 * pattern as EmptyResourceInventoryPages.test.ts. Whitespace is squashed so
 * Prettier can reflow props without making the test brittle.
 */

const INVENTORY_TABLE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Inventory",
  "InventoryTable.tsx",
);

function readSource(): string {
  return fs.readFileSync(INVENTORY_TABLE, "utf8");
}

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(): string {
  return squash(stripComments(readSource()));
}

/** All whitespace removed, for assertions Prettier would otherwise reflow. */
function readCodeDense(): string {
  return stripComments(readSource()).replace(/\s+/g, "");
}

/** Everything between `formFields={[` and the filters that follow it. */
function formSection(): string {
  const code: string = readCode();

  return code.slice(code.indexOf("formFields={["), code.indexOf("filters={["));
}

function filterSection(): string {
  const code: string = readCode();

  return code.slice(code.indexOf("filters={["), code.indexOf("columns={["));
}

function columnSection(): string {
  const code: string = readCode();

  return code.slice(code.indexOf("columns={["));
}

describe("the inventory table file exists where the test expects it", () => {
  test("reads", () => {
    expect(fs.existsSync(INVENTORY_TABLE)).toBe(true);
  });

  test("the sections the rest of this file slices are all present", () => {
    // A rename that loses one would make every slice below vacuously pass.
    expect(formSection().length).toBeGreaterThan(0);
    expect(filterSection().length).toBeGreaterThan(0);
    expect(columnSection().length).toBeGreaterThan(0);
  });
});

describe("manual creation is offered", () => {
  test("the table is creatable", () => {
    expect(readCode()).toContain("isCreateable={true}");
  });

  test("the create form is wired", () => {
    expect(readCode()).toContain("formFields={[");
  });

  test("the type dropdown is built from MANUAL_ENTITY_TYPES", () => {
    const code: string = readCode();

    expect(code).toContain("MANUAL_ENTITY_TYPES");
    expect(code).toContain("manualEntityTypeOptions");
  });

  test("the dropdown is not built from the full EntityType vocabulary", () => {
    /*
     * `Object.values(EntityType)` is correct for the FILTER (you filter by
     * any type) and wrong for the form (you create only manual ones).
     */
    expect(formSection()).not.toContain("Object.values(EntityType)");
  });

  test("name and description are collected", () => {
    const code: string = readCode();

    expect(code).toContain("displayName: true");
    expect(code).toContain("description: true");
  });

  test("the entity key is never a form field", () => {
    /*
     * It is derived server-side from (project, type, name); a user-supplied
     * value would disagree with it.
     */
    expect(formSection()).not.toContain("entityKey: true");
  });

  test("the source is never a form field", () => {
    // Assigned by the service, and immutable after create.
    expect(formSection()).not.toContain("source: true");
  });
});

describe("the three row sources stay distinguishable", () => {
  test("Source is a column", () => {
    expect(columnSection()).toContain("source: true");
  });

  test("Source is filterable", () => {
    expect(filterSection()).toContain("source: true");
  });

  test("the source filter offers every EntitySource", () => {
    expect(filterSection()).toContain("sourceFilterOptions");
    expect(readCodeDense()).toContain("Object.values(EntitySource,)");
  });

  test("the type filter offers every EntityType", () => {
    expect(filterSection()).toContain("allEntityTypeFilterOptions");
    expect(readCodeDense()).toContain("Object.values(EntityType,)");
  });
});

describe("no cell renders a raw wire value", () => {
  const code: string = readCode();

  test("the type column renders through the badge, not as text", () => {
    /*
     * `k8s.pod` in a table cell is the single most visible symptom of the
     * old page. The badge renders the catalog's label and its icon.
     */
    expect(code).toContain(
      "<InventoryTypeBadge entityType={item.entityType} />",
    );
  });

  test("the source column renders through the badge", () => {
    expect(code).toContain("<InventorySourceBadge source={item.source} />");
  });

  test("there is a derived status column, not just a bare timestamp", () => {
    expect(code).toContain("<InventoryLivenessBadge");
    expect(columnSection()).toContain('id: "inventory-status"');
  });

  test("the status column is fed the row's source, not only its date", () => {
    /*
     * Ageing a mirrored or manual row is what produces a red badge on every
     * network device in the project. The badge needs the source to refuse.
     */
    const statusColumn: string = columnSection().slice(
      columnSection().indexOf('id: "inventory-status"'),
    );

    expect(statusColumn).toContain("source={item.source}");
  });

  test("the whole table renders against one clock", () => {
    /*
     * Reading the clock per cell lets two rows in one render be aged against
     * different instants — invisible until it puts a row either side of a
     * threshold.
     */
    expect(code).toContain("const now: Date = new Date();");
    expect(code).toContain("now={now}");
  });

  test("the CSV export does not fall back to raw values for badge columns", () => {
    // A badge column with no getExportValue exports a UUID or nothing.
    expect(code).toContain(
      "getExportValue: (item: InventoryItem): string =>",
    );
    expect(code).toContain("getInventoryTypeLabel(item.entityType");
    expect(code).toContain("getInventorySourceLabel(item.source)");
  });
});

describe("the list is usable at estate scale", () => {
  const code: string = readCode();

  test("there is an inline search box", () => {
    expect(code).toContain("searchableFields={[");
    expect(code).toContain('"displayName"');
  });

  test("the name column cannot be customized away", () => {
    // A table customized into anonymity is unusable.
    const nameColumn: string = columnSection().slice(
      0,
      columnSection().indexOf('title: "Type"'),
    );

    expect(nameColumn).toContain("isNotCustomizable: true");
  });

  test("the identity key is available but not shown by default", () => {
    /*
     * A 16-hex hash earns no width in the default view, but it is what
     * support asks for, so it stays one click away rather than being cut.
     */
    expect(columnSection()).toContain("entityKey: true");
    expect(columnSection()).toContain("isHiddenByDefault: true");
  });

  test("rows sort by recency by default", () => {
    expect(code).toContain('sortBy="lastSeenAt"');
    expect(code).toContain("sortOrder={SortOrder.Descending}");
  });

  test("the empty state offers a way forward rather than a bare sentence", () => {
    expect(code).toContain("<EmptyState");
    expect(code).toContain("RouteMap[PageMap.INVENTORY_DOCUMENTATION]");
  });

  test("rows open the inventory detail page", () => {
    expect(code).toContain("isViewable={true}");
    expect(code).toContain("RouteMap[PageMap.INVENTORY_VIEW_ROOT]");
  });

  test("the table accepts a page-supplied scope", () => {
    // This is how the Overview's drill-downs narrow the list.
    expect(code).toContain("...(props.query || {})");
  });

  test("the scoped and unscoped mounts can hold different preferences", () => {
    /*
     * Two tables sharing a userPreferencesKey share their URL state and page
     * size — paging one repaginates the other.
     */
    expect(code).toContain("props.tableKey ||");
    expect(code).toContain("userPreferencesKey={tableKey}");
  });
});

describe("the vocabularies the table relies on", () => {
  test("the manual set is non-empty, or the create form offers nothing", () => {
    expect(MANUAL_ENTITY_TYPES.size).toBeGreaterThan(0);
  });

  test("it offers no type the server would reject", () => {
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(INVENTORY_ENTITY_TYPES.has(entityType)).toBe(false);
      expect(entityType).not.toBe(EntityType.Service);
    }
  });

  test("EntitySource has values for the filter to offer", () => {
    expect(Object.values(EntitySource).length).toBeGreaterThan(1);
  });
});

describe("the pages that mount the table", () => {
  const PAGES: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "Inventory",
  );

  function readPage(name: string): string {
    return squash(
      stripComments(fs.readFileSync(path.join(PAGES, name), "utf8")),
    );
  }

  test("the Items page parses its scope out of the live location", () => {
    /*
     * A query-string-only change does not remount the page, so a scope
     * captured at first render leaves the table showing the previous scope
     * under the new banner.
     */
    const items: string = readPage("Items.tsx");

    expect(items).toContain("useLocation()");
    expect(items).toContain("parseInventoryScope");
  });

  test("the Items page always explains a scope it is under", () => {
    const items: string = readPage("Items.tsx");

    expect(items).toContain("describeInventoryScope");
    expect(items).toContain('dataTestId="inventory-scope-banner"');
  });

  test("the banner clears the scope", () => {
    const items: string = readPage("Items.tsx");

    expect(items).toContain("onClose=");
    expect(items).toContain("RouteMap[PageMap.INVENTORY_ITEMS] as Route");
  });

  test("the Overview folds one snapshot into both the tiles and the breakdown", () => {
    /*
     * Two fetches would let the strip and the breakdown be snapshots of
     * different instants, and a per-tile count endpoint cannot express
     * staleness at all.
     */
    const overview: string = readPage("Overview.tsx");

    expect(overview).toContain("summarizeInventory");
    expect(overview).toContain("buildInventoryBreakdown");
    expect((overview.match(/ModelAPI\.getList/g) || []).length).toBe(1);
  });

  test("the Overview offers a way forward when the estate is empty", () => {
    const overview: string = readPage("Overview.tsx");

    expect(overview).toContain("<EmptyState");
    expect(overview).toContain("RouteMap[PageMap.INVENTORY_DOCUMENTATION]");
  });
});
