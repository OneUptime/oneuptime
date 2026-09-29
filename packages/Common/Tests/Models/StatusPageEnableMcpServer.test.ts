/**
 * StatusPage.enableMcpServer column contract.
 *
 * The feature's headline promise is "MCP stays on unless the owner turns it
 * off". Three separate mechanisms carry that promise, and they are easy to
 * confuse:
 * - NEW rows get true from the Postgres column default, declared by
 *   @Column({ default: true }) and stored in TypeORM's metadata
 * - EXISTING rows got true from the migration's NOT NULL DEFAULT true
 * - @TableColumn({ defaultValue: true }) is documentation only — it feeds the
 *   generated API schema and form metadata, and defaults nothing at runtime
 *
 * All three are pinned below, because a one-word edit to any of them silently
 * flips the default for everyone. Asserting only the @TableColumn metadata
 * would be a guard that catches nothing: flipping @Column to default: false
 * leaves that assertion green while every new status page ships with MCP off.
 *
 * isDefaultValueColumn is pinned too: it keeps the column optional on create,
 * where required: true would make DatabaseService reject creates that omit it.
 */

import StatusPage from "../../Models/DatabaseModels/StatusPage";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "enableMcpServer";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1784137457184-AddEnableMcpServerToStatusPage.ts",
);

function metadata(): TableColumnMetadata {
  return new StatusPage().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === StatusPage && column.propertyName === COLUMN;
  });
}

describe("StatusPage.enableMcpServer", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("a newly created status page has MCP enabled", () => {
    /*
     * This is the assertion that actually protects new status pages: the
     * Postgres column default. Nothing else populates the column when a create
     * omits it.
     */
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.default).toBe(true);
  });

  test("every pre-existing status page was backfilled as enabled", () => {
    /*
     * The migration is the only thing that decided the value for status pages
     * that existed before this feature. Because isMcpServerEnabled queries
     * `enableMcpServer: true`, losing this default would silently gate every
     * status page created before the migration ran.
     */
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('ALTER TABLE "StatusPage"');
    expect(migration).toContain(
      `ADD "${COLUMN}" boolean NOT NULL DEFAULT true`,
    );
  });

  test("is documented as defaulting to enabled", () => {
    /*
     * Feeds the generated API schema and form metadata. Documentation only —
     * see the tests above for the defaults that actually apply.
     */
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
