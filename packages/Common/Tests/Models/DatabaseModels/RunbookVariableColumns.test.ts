import RunbookVariable from "../../../Models/DatabaseModels/RunbookVariable";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO MAY READ AND WRITE A RUNBOOK VARIABLE, column by column.
 *
 *   - a secret's value (secretValue) is encrypted at rest and NOBODY reads
 *     it through the API: its read list is empty, which is the whole of what
 *     keeps it from being served back in plaintext;
 *   - whether a variable is a secret is fixed when it is made;
 *   - the project's admins and the Runbook Variable permissions write them;
 *     a Runbook Admin reads them, to name them in the steps it writes; a
 *     Project Member, a Viewer, a Runbook Member or Viewer do not.
 */

const model: RunbookVariable = new RunbookVariable();

function access(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined =
    model.getColumnAccessControlFor(column) || undefined;

  expect(control).toBeDefined();
  return control!;
}

const NEVER_READERS: Array<Permission> = [
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.RunbookMember,
  Permission.RunbookViewer,
];

describe("the secret value", () => {
  test("nobody reads it through the API", () => {
    expect(access("secretValue").read).toEqual([]);
  });

  test("it is encrypted at rest", () => {
    const metadata: { encrypted?: boolean; type: TableColumnType } =
      model.getTableColumnMetadata("secretValue") as {
        encrypted?: boolean;
        type: TableColumnType;
      };

    expect(metadata.encrypted).toBe(true);
    expect(model.getEncryptedColumns().columns).toContain("secretValue");
  });

  test("whoever makes or edits variables writes it - a replacement only", () => {
    expect(access("secretValue").create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ]);
    expect(access("secretValue").update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ]);
  });
});

describe("whether it is a secret", () => {
  test("is set when the variable is made, and never changed", () => {
    expect(access("isSecret").update).toEqual([]);
    expect(access("isSecret").create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ]);
  });
});

describe("the table", () => {
  test("is read by the project's admins, Read Runbook Variable and Runbook Admin - no one else", () => {
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadRunbookSecret,
      Permission.RunbookAdmin,
    ]);

    for (const permission of NEVER_READERS) {
      expect({
        permission,
        reads: model.getReadPermissions().includes(permission),
      }).toEqual({ permission, reads: false });
    }
  });

  test("is written by the project's admins and the Runbook Variable permissions only", () => {
    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookSecret,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DeleteRunbookSecret,
    ]);
  });

  test.each(["name", "value", "runners", "isAvailableToGlobalRunners"])(
    "%s is read by whoever reads the table",
    (column: string) => {
      expect(access(column).read).toEqual(model.getReadPermissions());
    },
  );

  test("a variable belongs to the project, or to one runbook, for good", () => {
    expect(access("runbookId").update).toEqual([]);
    expect(access("runbook").update).toEqual([]);
    expect(access("projectId").update).toEqual([]);
  });

  /*
   * The permissions kept their keys - roles and API keys that hold them
   * keep them - and are titled for what they are now.
   */
  test("the permissions it uses are titled for variables", () => {
    expect(
      [
        Permission.CreateRunbookSecret,
        Permission.EditRunbookSecret,
        Permission.DeleteRunbookSecret,
        Permission.ReadRunbookSecret,
      ].map((permission: Permission): string => {
        return PermissionHelper.getTitle(permission);
      }),
    ).toEqual([
      "Create Runbook Variable",
      "Edit Runbook Variable",
      "Delete Runbook Variable",
      "Read Runbook Variable",
    ]);
  });
});
