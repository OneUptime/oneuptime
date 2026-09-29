/**
 * StatusPage.enableSearchEngineIndexing column contract.
 *
 * The promise is "status pages stay indexable unless the owner turns indexing
 * off". Three separate mechanisms carry that promise, and they are easy to
 * confuse:
 * - NEW rows get true from the Postgres column default, declared by
 *   @Column({ default: true }) and stored in TypeORM's metadata
 * - EXISTING rows got true from the migration's NOT NULL DEFAULT true
 * - @TableColumn({ defaultValue: true }) is documentation only - it feeds the
 *   generated API schema and form metadata, and defaults nothing at runtime
 *
 * All three are pinned below, because a one-word edit to any of them silently
 * flips the default for everyone - and this is a default nobody notices going
 * wrong until their status page has dropped out of Google.
 */

import StatusPage from "../../Models/DatabaseModels/StatusPage";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { SEARCH_ENGINE_INDEXING_FLAG_NAME } from "../../Types/StatusPage/SearchEngineIndexing";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "enableSearchEngineIndexing";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1787500000000-AddEnableSearchEngineIndexingToStatusPage.ts",
);

function metadata(): TableColumnMetadata {
  return new StatusPage().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === StatusPage && column.propertyName === COLUMN;
  });
}

describe("StatusPage.enableSearchEngineIndexing", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("is named exactly what the API and the template look for", () => {
    expect(COLUMN).toBe(SEARCH_ENGINE_INDEXING_FLAG_NAME);
  });

  test("a newly created status page is indexable", () => {
    /*
     * This is the assertion that actually protects new status pages: the
     * Postgres column default. Nothing else populates the column when a
     * create omits it, and every create in the product omits it.
     */
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.default).toBe(true);
  });

  test("the column is NOT NULL, so no row can be ambiguous", () => {
    expect(typeOrmColumn()?.options.nullable).toBe(false);
  });

  test("every pre-existing status page was backfilled as indexable", () => {
    /*
     * The migration is the only thing that decided the value for status pages
     * that existed before this feature shipped. DEFAULT true in the same
     * statement fills every existing row, so no page silently loses its search
     * traffic on upgrade.
     */
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('ALTER TABLE "StatusPage"');
    expect(migration).toContain(
      `ADD "${COLUMN}" boolean NOT NULL DEFAULT true`,
    );
  });

  test("the migration is registered, so it actually runs on boot", () => {
    /*
     * A migration file that is not in Index.ts is dead code: the column never
     * appears in Postgres, and every read of it fails at runtime rather than
     * at compile time.
     */
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      "AddEnableSearchEngineIndexingToStatusPage1787500000000",
    );
    /* Imported AND listed in the exported array - the import alone does nothing. */
    expect(
      index.match(/AddEnableSearchEngineIndexingToStatusPage1787500000000/g)
        ?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("is documented as defaulting to enabled", () => {
    /*
     * Feeds the generated API schema and the dashboard form metadata.
     * Documentation only - see the tests above for the defaults that actually
     * apply.
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
    expect(accessControl).toContain(Permission.ReadProjectStatusPage);
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
