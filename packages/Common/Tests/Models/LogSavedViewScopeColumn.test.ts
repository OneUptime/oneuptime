/**
 * LogSavedView.scope column contract (issue #5549).
 *
 * A saved log view is listed only on the page it was saved on, and the page
 * is this column. So:
 * - it is optional: a view made with none is the Logs page's, as is every
 *   view saved before the column existed - the column is nullable, with no
 *   default, so those rows keep none;
 * - whoever may save a view may say which page it is for, and whoever may
 *   read views may read it, exactly as for the view's name;
 * - nobody may change it: a view does not move to another page, and an
 *   update that tries is refused (ProjectDefaultRowWrites.test.ts drives it);
 * - it is as long as a scope may be (Utils/Telemetry/SavedViewScope).
 */

import LogSavedView from "../../Models/DatabaseModels/LogSavedView";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { SAVED_VIEW_SCOPE_MAX_LENGTH } from "../../Utils/Telemetry/SavedViewScope";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "scope";

function metadata(): TableColumnMetadata {
  return new LogSavedView().getTableColumnMetadata(COLUMN);
}

function accessControl(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | null =
    new LogSavedView().getColumnAccessControlFor(column);

  expect(control).not.toBeNull();

  return control as ColumnAccessControl;
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === LogSavedView && column.propertyName === COLUMN;
  });
}

function sorted(permissions: Array<Permission> | undefined): Array<string> {
  return [...(permissions || [])].map(String).sort();
}

describe("LogSavedView.scope", () => {
  test("is an optional long text column, read on relation queries", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.LongText);
    expect(Boolean(metadata().required)).toBe(false);
    expect(metadata().canReadOnRelationQuery).toBe(true);
    expect(metadata().title).toBe("Scope");
  });

  test("its description says where a view with no scope is listed", () => {
    expect(metadata().description).toContain("empty for the Logs page");
    expect(metadata().description).toContain("kubernetes-cluster:");
  });

  test("is nullable in Postgres, with no default, as long as a scope may be", () => {
    const column: ColumnMetadataArgs | undefined = typeOrmColumn();

    expect(column).toBeDefined();
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
    expect(column?.options.type).toBe(ColumnType.LongText);
    expect(column?.options.length).toBe(ColumnLength.LongText);
    expect(column?.options.length).toBe(SAVED_VIEW_SCOPE_MAX_LENGTH);
  });

  test("whoever may save a view may give it its page", () => {
    expect(sorted(accessControl(COLUMN).create)).toEqual(
      sorted(accessControl("name").create),
    );
    expect(accessControl(COLUMN).create).toContain(Permission.TelemetryMember);
    expect(accessControl(COLUMN).create).not.toContain(
      Permission.TelemetryViewer,
    );
  });

  test("whoever may read views may read their page", () => {
    expect(sorted(accessControl(COLUMN).read)).toEqual(
      sorted(accessControl("name").read),
    );
    expect(accessControl(COLUMN).read).toContain(Permission.TelemetryViewer);
  });

  test("nobody may move a view to another page", () => {
    expect(accessControl(COLUMN).update).toEqual([]);
  });
});
