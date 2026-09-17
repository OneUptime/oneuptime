import { describe, expect, test } from "@jest/globals";
import { getColumnAccessControlForAllColumns } from "../../Types/Database/AccessControl/ColumnAccessControl";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Permission from "../../Types/Permission";
import TableColumnType from "../../Types/Database/TableColumnType";
import InventoryItem from "../../Models/DatabaseModels/InventoryItem";
import InventoryItemCustomField from "../../Models/DatabaseModels/InventoryItemCustomField";

/*
 * The InventoryItem model, checked through the metadata its decorators
 * actually produce rather than through the text of the file.
 *
 * The dashboard suite already pins this file at source level, which is what
 * it can do from a Node environment with no renderer. That catches a deleted
 * line; it does not catch a decorator that is present but wrong — a
 * `@ColumnAccessControl` whose arrays were filled in from the wrong constant,
 * an `@EnableAuditLog` whose argument object never reaches the prototype, a
 * column typed Boolean in the comment and ShortText in the decorator. Those
 * all read correctly and behave incorrectly, so they are worth reaching the
 * real metadata for.
 */

const item: InventoryItem = new InventoryItem();

const ACCESS_CONTROL: Record<string, ColumnAccessControl> =
  getColumnAccessControlForAllColumns(item);

describe("audit logging is configured, not merely mentioned", () => {
  test("the decorator reaches the prototype", () => {
    /*
     * The source-level test asserts the literal `create: false` appears in
     * the file. This asserts the value the service layer actually reads.
     */
    expect(item.enableAuditLogOn).toEqual({
      create: false,
      update: true,
      delete: true,
    });
  });

  test("create stays off, whatever the decorator's defaults are", () => {
    /*
     * EnableAuditLog defaults every flag to true when omitted, so passing the
     * object wrongly - or dropping it - silently turns ingest's per-entity
     * creates into an audit-log flood.
     */
    expect(item.enableAuditLogOn?.create).toBe(false);
  });
});

describe("the archive columns behave as the UI assumes", () => {
  test("isArchived is a boolean that defaults to false", () => {
    /*
     * A nullable or defaulted-true column would make `isArchived: false` -
     * the query behind the main list - select nothing on rows that predate
     * the migration.
     */
    const metadata: { type: TableColumnType; defaultValue?: unknown } =
      item.getTableColumnMetadata("isArchived");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(false);
  });

  test("a user may set isArchived, or the archive button cannot work", () => {
    // The bulk action sends `{ isArchived: true }` as an ordinary update.
    const control: ColumnAccessControl = ACCESS_CONTROL["isArchived"]!;

    expect(control.update.length).toBeGreaterThan(0);
    expect(control.update).toContain(Permission.ProjectOwner);
  });

  test.each(["archivedAt", "archivedByUserId"])(
    "%s is server-stamped, never client-set",
    (columnName: string) => {
      /*
       * These are filled in by sanitizeCreateOrUpdate from the isArchived
       * write. A client-writable archivedAt would let the audit trail be
       * back-dated.
       */
      const control: ColumnAccessControl = ACCESS_CONTROL[columnName]!;

      expect(control.create).toEqual([]);
      expect(control.update).toEqual([]);
      expect(control.read.length).toBeGreaterThan(0);
    },
  );

  test("archivedByUser is readable, so the archived list can name them", () => {
    expect(ACCESS_CONTROL["archivedByUserId"]!.read).toContain(
      Permission.ProjectOwner,
    );
  });
});

describe("the identity columns stay immutable", () => {
  /*
   * entityType and entityKey are what telemetry is matched against. Making
   * either updatable re-identifies the row and strands every relationship
   * edge pointing at the old key - which nothing would report, because the
   * edges remain valid rows pointing at a key that no longer resolves.
   */
  test.each(["entityType", "entityKey", "source"])(
    "%s cannot be updated",
    (columnName: string) => {
      expect(ACCESS_CONTROL[columnName]!.update).toEqual([]);
    },
  );

  test("displayName and description remain editable", () => {
    // The two fields the Settings page offers.
    expect(ACCESS_CONTROL["displayName"]!.update.length).toBeGreaterThan(0);
    expect(ACCESS_CONTROL["description"]!.update.length).toBeGreaterThan(0);
  });
});

describe("custom fields", () => {
  test("the bag is JSON, as CustomFieldsDetail expects", () => {
    expect(item.getTableColumnMetadata("customFields").type).toBe(
      TableColumnType.JSON,
    );
  });

  test("a user may write it", () => {
    expect(ACCESS_CONTROL["customFields"]!.update.length).toBeGreaterThan(0);
  });

  test("the definitions model is tenant-scoped", () => {
    /*
     * Without the tenant column a project would see every other project's
     * field definitions.
     */
    expect(new InventoryItemCustomField().getTenantColumn()).toBe("projectId");
  });

  test("its permissions are real, and it grants read to project members", () => {
    const definitionAccess: Record<string, ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new InventoryItemCustomField());

    expect(definitionAccess["name"]!.read).toContain(Permission.ProjectMember);
    expect(definitionAccess["name"]!.create.length).toBeGreaterThan(0);
  });

  test("every permission it names exists in the Permission enum", () => {
    /*
     * This model was derived from ScheduledMaintenanceCustomField by
     * substituting a permission family. A typo there produces `undefined` in
     * an access-control array, which fails open or closed depending on the
     * caller rather than erroring.
     */
    const definitionAccess: Record<string, ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new InventoryItemCustomField());

    const known: Set<string> = new Set<string>(Object.values(Permission));

    for (const control of Object.values(definitionAccess)) {
      for (const permission of [
        ...control.create,
        ...control.read,
        ...control.update,
      ]) {
        expect(permission).toBeDefined();
        expect(known.has(permission)).toBe(true);
      }
    }
  });
});

describe("the tenant boundary", () => {
  test("InventoryItem is project-scoped", () => {
    // Every query in the product relies on this being enforced server-side.
    expect(item.getTenantColumn()).toBe("projectId");
  });
});
