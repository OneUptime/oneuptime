/**
 * StatusPage.enableMcpServer column contract.
 *
 * The feature's headline promise is "MCP stays on unless the owner turns it
 * off", and that promise lives entirely in this column's metadata:
 * - defaultValue true is what makes every existing and new status page keep
 *   working
 * - isDefaultValueColumn true is what keeps the column optional on create; with
 *   required: true instead, DatabaseService rejects any create that omits it
 *
 * These are cheap guards on a contract that is otherwise only expressed in
 * decorators, where a one-word edit silently flips the default for everyone.
 */

import StatusPage from "../../Models/DatabaseModels/StatusPage";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

const COLUMN: string = "enableMcpServer";

function metadata(): TableColumnMetadata {
  return new StatusPage().getTableColumnMetadata(COLUMN);
}

describe("StatusPage.enableMcpServer", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("defaults to enabled", () => {
    // The whole feature rests on this: status pages are MCP-readable unless
    // their owner opts out.
    expect(metadata().defaultValue).toBe(true);
  });

  test("is a default-value column, so create may omit it", () => {
    expect(new StatusPage().isDefaultValueColumn(COLUMN)).toBe(true);
  });

  test("is not required, so existing create calls keep working", () => {
    expect(metadata().required).toBeFalsy();
  });

  test("is readable by status page viewers", () => {
    const accessControl: Array<Permission> | undefined =
      new StatusPage().getColumnAccessControlFor(COLUMN)?.read;

    expect(accessControl).toContain(Permission.ProjectMember);
    expect(accessControl).toContain(Permission.StatusPageAdmin);
  });

  test("is editable by status page editors", () => {
    const accessControl: Array<Permission> | undefined =
      new StatusPage().getColumnAccessControlFor(COLUMN)?.update;

    expect(accessControl).toContain(Permission.EditProjectStatusPage);
    expect(accessControl).toContain(Permission.StatusPageAdmin);
  });

  test("is not editable by a read-only viewer", () => {
    const accessControl: Array<Permission> | undefined =
      new StatusPage().getColumnAccessControlFor(COLUMN)?.update;

    expect(accessControl).not.toContain(Permission.Viewer);
    expect(accessControl).not.toContain(Permission.StatusPageViewer);
  });
});
