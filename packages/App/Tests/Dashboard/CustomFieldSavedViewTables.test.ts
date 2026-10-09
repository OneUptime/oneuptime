import {
  CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS,
  getCustomFieldSavedViewTableIds,
} from "Common/Types/CustomField/CustomFieldSavedViews";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Renaming a dropdown option (#4564) rewrites the saved views that filter by
 * it - a view whose chip selected "Facility A" would otherwise filter for an
 * option nobody holds any more. Which views those are is
 * CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS, by the definition table: a view is
 * known only by the tableId its table saved it under. So every table that
 * draws a resource's custom field chips and saves views must be listed for
 * that resource, and no other. This reads the Dashboard's sources:
 *
 *   - the resource tables (IncidentsTable, AlertsTable, MonitorTable,
 *     ScheduledMaintenancesTable): every page that renders one with saved
 *     views, by the tableId it passes;
 *   - the pages that draw a resource's chips themselves
 *     (useCustomFieldFacets) on their own ModelTable, by theirs;
 *   - the inventory table, by its default ids and any tableKey it is given.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSourceFiles(dir: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

const FILES: Array<{ file: string; source: string }> = listSourceFiles(
  DASHBOARD_SRC,
).map((file: string) => {
  return {
    file: path.relative(DASHBOARD_SRC, file),
    source: fs.readFileSync(file, "utf8"),
  };
});

function readSource(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

// A string constant a page names a table by, from the file that exports it.
function constantValue(name: string): string {
  for (const { source } of FILES) {
    const match: RegExpMatchArray | null = source.match(
      new RegExp(`export const ${name}: string = "([^"]+)"`),
    );

    if (match) {
      return match[1]!;
    }
  }

  throw new Error(`No exported string constant ${name}`);
}

const TABLE_ID: RegExp =
  /saveFilterProps=\{\{\s*tableId:\s*(?:"([^"]+)"|([A-Z_][A-Z0-9_]*))/;

function tableIdOf(match: RegExpMatchArray): string {
  return match[1] !== undefined ? match[1] : constantValue(match[2]!);
}

// Every saved-view tableId passed to `<component ...>` across the Dashboard.
function tableIdsPassedTo(component: string): Array<string> {
  const ids: Array<string> = [];

  for (const { source } of FILES) {
    let from: number = source.indexOf(`<${component}`);

    while (from !== -1) {
      const end: number = source.indexOf("/>", from);
      const element: string = source.slice(from, end === -1 ? undefined : end);
      const match: RegExpMatchArray | null = element.match(TABLE_ID);

      if (match) {
        ids.push(tableIdOf(match));
      }

      from = source.indexOf(`<${component}`, from + 1);
    }
  }

  return ids;
}

const RESOURCE_TABLES: Array<{ component: string; definition: string }> = [
  { component: "IncidentsTable", definition: "IncidentCustomField" },
  { component: "AlertsTable", definition: "AlertCustomField" },
  { component: "MonitorTable", definition: "MonitorCustomField" },
  {
    component: "ScheduledMaintenancesTable",
    definition: "ScheduledMaintenanceCustomField",
  },
];

describe("the saved views a renamed option is rewritten in", () => {
  test.each(RESOURCE_TABLES)(
    "every $component with saved views is listed for $definition",
    ({ component, definition }: { component: string; definition: string }) => {
      const ids: Array<string> = tableIdsPassedTo(component);

      // Each resource's main list saves views today.
      expect(ids.length).toBeGreaterThan(0);

      for (const id of ids) {
        expect(getCustomFieldSavedViewTableIds(definition)).toContain(id);
      }
    },
  );

  test("every page drawing a resource's chips on its own table is listed for that resource", () => {
    const pages: Array<{
      file: string;
      definition: string;
      ids: Array<string>;
    }> = [];

    for (const { file, source } of FILES) {
      const facets: RegExpMatchArray | null = source.match(
        /useCustomFieldFacets\(\{\s*customFieldsModelType:\s*([A-Za-z]+)/,
      );

      // The resource tables are read above, by what their pages pass.
      if (!facets || file.startsWith(`Components${path.sep}`)) {
        continue;
      }

      const ids: Array<string> = [];
      const pattern: RegExp = new RegExp(TABLE_ID.source, "g");
      let match: RegExpExecArray | null = pattern.exec(source);

      while (match) {
        ids.push(tableIdOf(match));
        match = pattern.exec(source);
      }

      pages.push({ file, definition: facets[1]!, ids });
    }

    expect(
      pages
        .map((page: { definition: string }) => {
          return page.definition;
        })
        .sort(),
    ).toEqual([
      "OnCallDutyPolicyCustomField",
      "StatusPageCustomField",
      "TeamCustomField",
    ]);

    for (const page of pages) {
      expect(page.ids.length).toBeGreaterThan(0);

      for (const id of page.ids) {
        expect(getCustomFieldSavedViewTableIds(page.definition)).toContain(id);
      }
    }
  });

  test("the inventory table's views are listed for inventory items, the default ids and every one it is given", () => {
    const inventory: string = readSource(
      "Components",
      "Inventory",
      "InventoryTable.tsx",
    );

    expect(inventory).toContain("INVENTORY_ITEMS_TABLE_ID");
    expect(inventory).toContain("INVENTORY_ARCHIVED_TABLE_ID");

    const ids: Array<string> = [
      constantValue("INVENTORY_ITEMS_TABLE_ID"),
      constantValue("INVENTORY_ARCHIVED_TABLE_ID"),
    ];

    for (const { source } of FILES) {
      let from: number = source.indexOf("<InventoryTable");

      while (from !== -1) {
        const end: number = source.indexOf("/>", from);
        const element: string = source.slice(
          from,
          end === -1 ? undefined : end,
        );
        const match: RegExpMatchArray | null =
          element.match(/tableKey="([^"]+)"/);

        if (match) {
          ids.push(match[1]!);
        }

        from = source.indexOf("<InventoryTable", from + 1);
      }
    }

    for (const id of ids) {
      expect(
        getCustomFieldSavedViewTableIds("InventoryItemCustomField"),
      ).toContain(id);
    }
  });

  test("a table listed for a resource is one the Dashboard has", () => {
    const allSources: string = FILES.map((entry: { source: string }) => {
      return entry.source;
    }).join("\n");

    for (const ids of Object.values(CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS)) {
      for (const id of ids) {
        const named: boolean =
          allSources.includes(`"${id}"`) ||
          FILES.some((entry: { source: string }) => {
            return entry.source.includes(`= "${id}"`);
          });

        expect(named).toBe(true);
      }
    }
  });
});
