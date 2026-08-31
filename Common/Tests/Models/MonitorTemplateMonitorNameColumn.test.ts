/**
 * MonitorTemplate.monitorName column contract (issue #3486).
 *
 * A Network Device auto-import rule names every monitor it provisions
 * "<device> - <this column>". While the column was required there was nothing
 * an operator could type that would not become a suffix on every device the
 * rule imported: a router already called UN0660WANRTR01 came back as
 * "UN0660WANRTR01 - Unit Router", for the whole estate, because the field
 * refused to be left empty.
 *
 * The properties pinned below are the ones that, quietly changed, put that
 * wall back:
 *
 *   - OPTIONAL, at BOTH layers. `TableColumn.required` is what
 *     DatabaseService.checkRequiredFields reads on create, and `Column.nullable`
 *     is the physical constraint. Either one alone still refuses the write.
 *   - NOT DEFAULTED and not backfilled. A default would hand the same invented
 *     suffix back to every template that never asked for one, and would rename
 *     nothing that already exists.
 *   - STILL UPDATABLE, and still a ShortText of the same width. The point of
 *     the change is that the box can be emptied, which needs an update
 *     permission; ModelForm drops a field whose column grants none.
 *
 * The migration half of the contract is pinned here too, because a model that
 * says nullable over a column that is still NOT NULL fails at the database
 * rather than in review — and because the Postgres schema-drift job only
 * catches that when the migration is REGISTERED, not merely written.
 */

import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "monitorName";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_CLASS: string =
  "AllowNullMonitorNameOnMonitorTemplate1790200000000";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1790200000000-AllowNullMonitorNameOnMonitorTemplate.ts",
);

function metadata(): TableColumnMetadata {
  return new MonitorTemplate().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === MonitorTemplate && column.propertyName === COLUMN;
  });
}

describe("MonitorTemplate.monitorName", () => {
  test("exists as a ShortText column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.ShortText);
    expect(metadata().title).toBe("Monitor Name");
  });

  /*
   * The whole point of the change. Both halves are asserted because they are
   * enforced in different places and either one alone still rejects a
   * template with no default monitor name: `required` by
   * DatabaseService.checkRequiredFields on create, `nullable` by Postgres.
   */
  test("is optional at the API layer, so a template can be created without one", () => {
    expect(metadata().required).toBeFalsy();
  });

  test("is nullable in the database, so the column can actually hold no name", () => {
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.nullable).toBe(true);
  });

  test("still stores at the width the monitor name column itself allows", () => {
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
  });

  /*
   * A default is the failure mode this issue is about, wearing a different
   * hat: it would suffix every template that never asked to be suffixed, and
   * it would do so invisibly, since nothing surfaces a defaulted value as
   * "unset".
   */
  test("has no default value", () => {
    expect(typeOrmColumn()?.options.default).toBeUndefined();
    expect(new MonitorTemplate().isDefaultValueColumn(COLUMN)).toBe(false);
  });

  test("is not unique - a default name is a label, not a key", () => {
    expect(typeOrmColumn()?.options.unique).toBeFalsy();

    const uniqueColumns: Columns = new MonitorTemplate().getUniqueColumns();

    expect(uniqueColumns.columns).not.toContain(COLUMN);
  });

  /*
   * The template's OWN name is what is slugged. Slugging the default monitor
   * name would make an optional field decide a URL.
   */
  test("is not the slugified column", () => {
    expect(new MonitorTemplate().getSlugifyColumn()).toBe("templateName");
  });

  test("its description tells the operator what leaving it blank does", () => {
    expect(metadata().description).toContain("Leave it blank");
  });
});

describe("MonitorTemplate.monitorName access control", () => {
  const CREATORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.CreateMonitorTemplate,
  ];

  const READERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.MonitorViewer,
    Permission.ReadMonitorTemplate,
  ];

  const EDITORS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.EditMonitorTemplate,
  ];

  test("is set by whoever may create a template", () => {
    expect(
      new MonitorTemplate().getColumnAccessControlFor(COLUMN)?.create,
    ).toEqual(CREATORS);
  });

  test("is read by everyone who may read a template, viewers included", () => {
    expect(
      new MonitorTemplate().getColumnAccessControlFor(COLUMN)?.read,
    ).toEqual(READERS);
  });

  /*
   * Load-bearing for the fix, not incidental. Making the field optional is
   * only half of it - an operator with an existing template needs to be able
   * to CLEAR the name they were forced to invent, and ModelForm drops a field
   * whose column grants no update permission, which would leave the Edit
   * dialog unable to save the one thing it edits.
   */
  test("can be cleared by whoever may edit the template", () => {
    expect(
      new MonitorTemplate().getColumnAccessControlFor(COLUMN)?.update,
    ).toEqual(EDITORS);

    const tableUpdatePermissions: Array<Permission> =
      new MonitorTemplate().getUpdatePermissions();

    for (const permission of EDITORS) {
      expect(tableUpdatePermissions).toContain(permission);
    }
  });
});

describe("MonitorTemplate.monitorName migration", () => {
  test("drops NOT NULL without backfilling existing templates", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "${COLUMN}" DROP NOT NULL`,
    );

    /*
     * Every template that already exists keeps the name it was created with,
     * so nothing about an existing project's monitor naming changes when this
     * ships. The only UPDATE in the file belongs to down().
     */
    const up: string = migration.slice(
      migration.indexOf("public async up("),
      migration.indexOf("public async down("),
    );

    expect(up).not.toContain("UPDATE");
    expect(up).not.toContain("DEFAULT");
    expect(up).not.toContain("SET NOT NULL");
  });

  /*
   * A rollback restores NOT NULL, which fails on every template written while
   * the column was nullable unless those rows are given a value first.
   * "Monitor" is the exact string the pre-#3486 code substituted for a blank
   * name, so it reconstructs the old behaviour instead of inventing one.
   */
  test("its down() makes the column non-null again, and can actually run", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");
    const down: string = migration.slice(
      migration.indexOf("public async down("),
    );

    expect(down).toContain(
      `UPDATE "MonitorTemplate" SET "${COLUMN}" = 'Monitor' WHERE "${COLUMN}" IS NULL`,
    );
    expect(down).toContain(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "${COLUMN}" SET NOT NULL`,
    );
    expect(down.indexOf("UPDATE")).toBeLessThan(down.indexOf("SET NOT NULL"));
  });

  /*
   * TypeORM records a migration under its `public name` property, not its
   * class name. A rename that updates one and forgets the other leaves the
   * deployed identity on the old value.
   */
  test("its class name, file name and recorded name all agree", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(`export class ${MIGRATION_CLASS}`);
    expect(migration).toContain(`public name: string = "${MIGRATION_CLASS}"`);
  });

  test("is registered, so the column is actually nullable at runtime", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
  });
});
