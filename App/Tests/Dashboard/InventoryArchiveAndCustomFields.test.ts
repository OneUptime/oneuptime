import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Archiving, custom fields, and the four new item subpages.
 *
 * The invariants worth pinning are the ones whose failure looks like ordinary
 * behaviour:
 *
 *   - If the list forgets `isArchived`, archived rows come back to the main
 *     list and the archive button reads as broken.
 *   - If the two views share a table key they share URL state and page size,
 *     so paging one repaginates the other.
 *   - If the archived view stays editable, a user can act on a row they have
 *     already put out of sight.
 *   - If audit logging is left at its defaults, ingest's per-entity creates
 *     flood the log — the reason the model turns `create` off explicitly.
 *
 * Source-level, as the rest of this suite is: the App tests run in plain Node
 * with no React renderer.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_SRC: string = path.join(__dirname, "..", "..", "..", "Common");

type ReadCodeFunction = (root: string, ...segments: Array<string>) => string;

const readCode: ReadCodeFunction = (
  root: string,
  ...segments: Array<string>
): string => {
  return fs
    .readFileSync(path.join(root, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
};

describe("archiving", () => {
  const table: string = readCode(
    DASHBOARD_SRC,
    "Components",
    "Inventory",
    "InventoryTable.tsx",
  );

  test("the list splits on isArchived rather than showing everything", () => {
    expect(table).toContain("isArchived: isArchivedView");
  });

  test("the two views cannot share saved state", () => {
    /*
     * A shared userPreferencesKey means shared URL state and page size — the
     * archived list would repaginate the live one.
     */
    const facets: string = readCode(
      DASHBOARD_SRC,
      "Components",
      "Inventory",
      "InventoryFacets.ts",
    );

    expect(facets).toContain(
      'INVENTORY_ARCHIVED_TABLE_ID: string = "inventory-archived-table"',
    );
    expect(facets).toContain(
      'INVENTORY_ITEMS_TABLE_ID: string = "inventory-items-table"',
    );
    expect(table).toContain(
      "isArchivedView ? INVENTORY_ARCHIVED_TABLE_ID : INVENTORY_ITEMS_TABLE_ID",
    );
    expect(table).toContain("userPreferencesKey={tableKey}");
  });

  test("row actions are view-only, with creation disabled only in the archive", () => {
    expect(table).toContain("isDeleteable={false}");
    expect(table).toContain("isEditable={false}");
    expect(table).toContain("isCreateable={!isArchivedView}");
    expect(table).toContain("isViewable={true}");
  });

  test("each view offers the action that applies to it", () => {
    expect(table).toContain("useBulkArchiveActions");
    expect(table).toContain("unarchiveBulkActions");
    expect(table).toContain("archiveBulkActions");
  });

  test("the archived page explains that archiving is not decommissioning", () => {
    /*
     * The single most likely misreading of this page: archived rows keep
     * their identity and keep collecting telemetry.
     */
    const page: string = readCode(
      DASHBOARD_SRC,
      "Pages",
      "Inventory",
      "Archived.tsx",
    );

    expect(page).toContain('dataTestId="inventory-archived-banner"');
    expect(page).toContain("archivedOnly={true}");
    expect(page.toLowerCase()).toContain("keep collecting telemetry");
  });

  test("the model carries the whole archive column set", () => {
    const model: string = readCode(
      COMMON_SRC,
      "Models",
      "DatabaseModels",
      "InventoryItem.ts",
    );

    for (const column of [
      "public isArchived?",
      "public archivedAt?",
      "public archivedByUser?",
      "public archivedByUserId?",
    ]) {
      expect(model).toContain(column);
    }
  });

  test("the archive bookkeeping columns are server-stamped, not client-set", () => {
    const model: string = readCode(
      COMMON_SRC,
      "Models",
      "DatabaseModels",
      "InventoryItem.ts",
    );

    const archivedAtBlock: string = model.slice(
      model.indexOf("Archived At"),
      model.indexOf("public archivedAt?"),
    );

    expect(archivedAtBlock.length).toBeGreaterThan(0);
    // create: [] / update: [] on the preceding ColumnAccessControl.
    const precedingAccessControl: string = model.slice(
      model.lastIndexOf("@ColumnAccessControl", model.indexOf("Archived At")),
      model.indexOf("Archived At"),
    );

    expect(precedingAccessControl).toContain("create: []");
    expect(precedingAccessControl).toContain("update: []");
  });

  test("isArchived is indexed with the tenant column", () => {
    const model: string = readCode(
      COMMON_SRC,
      "Models",
      "DatabaseModels",
      "InventoryItem.ts",
    );

    expect(model).toContain('@Index(["projectId", "isArchived"])');
  });
});

describe("audit logging is scoped to what a person did", () => {
  const model: string = readCode(
    COMMON_SRC,
    "Models",
    "DatabaseModels",
    "InventoryItem.ts",
  );

  test("it is enabled at all", () => {
    expect(model).toContain("@EnableAuditLog(");
  });

  test("create is off, because ingest creates one row per discovered entity", () => {
    /*
     * Left on, a churning Kubernetes estate writes an audit row per pod, and
     * the log stops being readable. `firstSeenAt` already records the same
     * fact.
     */
    expect(model).toContain("create: false");
  });

  test("update and delete are on", () => {
    // Neither ingest nor the prune sweep reaches the audit hook.
    expect(model).toContain("update: true");
    expect(model).toContain("delete: true");
  });

  test("the audit page says automatic changes are not recorded", () => {
    const page: string = readCode(
      DASHBOARD_SRC,
      "Pages",
      "Inventory",
      "View",
      "AuditLogs.tsx",
    );

    expect(page).toContain('resourceType="Inventory Item"');
    expect(page.toLowerCase()).toContain("not recorded");
  });
});

describe("custom fields", () => {
  test("the definitions model exists and is project-scoped", () => {
    const model: string = readCode(
      COMMON_SRC,
      "Models",
      "DatabaseModels",
      "InventoryItemCustomField.ts",
    );

    expect(model).toContain(
      "export default class InventoryItemCustomField extends BaseModel",
    );
    expect(model).toContain('tableName: "InventoryItemCustomField"');
    expect(model).toContain('@TenantColumn("projectId")');
    expect(model).toContain('new Route("/inventory-item-custom-field")');
  });

  test("it reuses the telemetry permission family rather than minting one", () => {
    /*
     * A new permission family would have to be granted separately everywhere
     * before anyone could see a field they had just defined.
     */
    const model: string = readCode(
      COMMON_SRC,
      "Models",
      "DatabaseModels",
      "InventoryItemCustomField.ts",
    );

    expect(model).toContain("Permission.CreateTelemetryService");
    expect(model).toContain("Permission.ReadTelemetryService");
    expect(model).not.toContain("ScheduledMaintenance");
  });

  test("the item carries a customFields bag", () => {
    expect(
      readCode(COMMON_SRC, "Models", "DatabaseModels", "InventoryItem.ts"),
    ).toContain("public customFields?");
  });

  test("the list table offers them as optional columns", () => {
    expect(
      readCode(DASHBOARD_SRC, "Components", "Inventory", "InventoryTable.tsx"),
    ).toContain("customFieldsModelType={InventoryItemCustomField}");
  });

  test("both the definitions page and the per-item page exist", () => {
    const definitions: string = readCode(
      DASHBOARD_SRC,
      "Pages",
      "Inventory",
      "Settings",
      "CustomFields.tsx",
    );
    const perItem: string = readCode(
      DASHBOARD_SRC,
      "Pages",
      "Inventory",
      "View",
      "CustomFields.tsx",
    );

    expect(definitions).toContain("CustomFieldsPageBase");
    expect(definitions).toContain("modelType={InventoryItemCustomField}");
    expect(perItem).toContain("CustomFieldsDetail");
    expect(perItem).toContain("customFieldType={InventoryItemCustomField}");
  });

  test("the model and service are registered, or nothing serves them", () => {
    expect(
      readCode(COMMON_SRC, "Models", "DatabaseModels", "Index.ts"),
    ).toContain("InventoryItemCustomField,");
    expect(readCode(COMMON_SRC, "Server", "Services", "Index.ts")).toContain(
      "InventoryItemCustomFieldService,",
    );
  });
});

describe("the operations subpages read through the typed row", () => {
  const PAGES: ReadonlyArray<[string, string]> = [
    ["Incidents.tsx", "IncidentsTable"],
    ["Alerts.tsx", "AlertsTable"],
    ["ScheduledMaintenance.tsx", "ScheduledMaintenancesTable"],
  ];

  test.each(PAGES)(
    "%s resolves through InventoryLinkedResource",
    (file: string, table: string) => {
      const page: string = readCode(
        DASHBOARD_SRC,
        "Pages",
        "Inventory",
        "View",
        file,
      );

      expect(page).toContain("<InventoryLinkedResource");
      expect(page).toContain("buildLinkedResourceQuery(resource)");
      expect(page).toContain(`<${table}`);
    },
  );

  test.each(PAGES)(
    "%s scopes to the project as well as the resource",
    (file: string) => {
      /*
       * The relation alone is not a tenant boundary; every table query in this
       * product carries projectId.
       */
      const page: string = readCode(
        DASHBOARD_SRC,
        "Pages",
        "Inventory",
        "View",
        file,
      );

      expect(page).toContain("ProjectUtil.getCurrentProjectId()!");
    },
  );

  test("the shared component explains rather than rendering an empty table", () => {
    const shared: string = readCode(
      DASHBOARD_SRC,
      "Components",
      "Inventory",
      "InventoryLinkedResource.tsx",
    );

    expect(shared).toContain("<EmptyState");
    expect(shared).toContain("describeMissingLink");
  });

  test("the shared component prefers the stamped pointer over a lookup", () => {
    // A stored (resourceType, resourceId) is exact; the fallback is a guess.
    expect(
      readCode(
        DASHBOARD_SRC,
        "Components",
        "Inventory",
        "InventoryLinkedResource.tsx",
      ),
    ).toContain("item.resourceType === kind && item.resourceId");
  });
});
