/**
 * UserPush.isCriticalAlertEnabled column contract.
 *
 * This is the one stored preference in the product whose purpose is to DEFEAT
 * a choice the user made with a physical switch on their phone. Everything
 * below pins a property that, quietly changed, either wakes people who did not
 * ask to be woken or - far worse for an on-call product - stops waking people
 * who did.
 *
 * The three "default" mechanisms are separate and easy to confuse:
 * - NEW rows get false from the Postgres column default (@Column default)
 * - EXISTING rows got false from the migration's NOT NULL DEFAULT false
 * - @TableColumn defaultValue is documentation for the generated API schema
 *   and forms; it defaults nothing at runtime
 */

import UserPush from "../../Models/DatabaseModels/UserPush";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "isCriticalAlertEnabled";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_CLASS: string = "MigrationName1787156982416";

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIR,
  "1787156982416-MigrationName.ts",
);

function metadata(): TableColumnMetadata {
  return new UserPush().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === UserPush && column.propertyName === COLUMN;
  });
}

describe("UserPush.isCriticalAlertEnabled", () => {
  test("exists as a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("a newly registered device does NOT override silent mode", () => {
    /*
     * The single most important assertion in this file. Overriding a silenced
     * phone is opted into, never inherited: a responder who installs the app
     * has not asked to be woken by it, and a default of true would make every
     * existing user's phone start ringing through Do Not Disturb on upgrade.
     */
    expect(typeOrmColumn()).toBeDefined();
    expect(typeOrmColumn()?.options.default).toBe(false);
  });

  test("every device that existed before this feature was backfilled as off", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('ALTER TABLE "UserPush"');
    expect(migration).toContain(
      `ADD "${COLUMN}" boolean NOT NULL DEFAULT false`,
    );
  });

  test("the migration is registered, so the column actually exists at runtime", () => {
    /*
     * A migration file missing from Index.ts never runs. The column would then
     * be absent from Postgres while every select in the paging path asks for
     * it, which fails the query that sends the page.
     */
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    // Imported AND listed in the exported array - the import alone does nothing.
    expect(index.match(new RegExp(MIGRATION_CLASS, "g"))?.length).toBe(2);
  });

  test("the migration's down() removes the column", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      `ALTER TABLE "UserPush" DROP COLUMN "${COLUMN}"`,
    );
  });

  test("is a default-value column, so existing create calls keep working", () => {
    expect(new UserPush().isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata().required).toBeFalsy();
  });

  test("is documented as defaulting to off", () => {
    expect(metadata().defaultValue).toBe(false);
  });
});

describe("UserPush.isCriticalAlertEnabled access control", () => {
  /*
   * UserPush is an owner-only table: its table-level `read` names
   * Permission.CurrentUser and nothing else, which is what scopes every read
   * to the caller's own rows. A new column has to keep that shape or it
   * becomes the exception that widens the table.
   */
  test("is readable only by the responder it belongs to", () => {
    const read: Array<Permission> | undefined =
      new UserPush().getColumnAccessControlFor(COLUMN)?.read;

    expect(read).toEqual([Permission.CurrentUser]);
  });

  test("is settable at registration by the responder", () => {
    const create: Array<Permission> | undefined =
      new UserPush().getColumnAccessControlFor(COLUMN)?.create;

    expect(create).toEqual([Permission.CurrentUser]);
  });

  test("cannot be written through the generic CRUD update surface", () => {
    /*
     * Every column on this model has an empty update list; writes go through
     * the dedicated routes that check row ownership first and then act as
     * root. Granting update here would let the flag be flipped by any path
     * that can PUT the model, which is a wider surface than "the phone that
     * owns this row".
     */
    const update: Array<Permission> | undefined =
      new UserPush().getColumnAccessControlFor(COLUMN)?.update;

    expect(update).toEqual([]);
  });

  test("does not widen the table's owner-only read scope", () => {
    /*
     * isAccessGrantedOnlyByCurrentUser is true exactly while the TABLE read
     * list holds nothing but CurrentUser, and that is what stamps
     * `userId = me` onto every read of this table. Adding a column must not
     * disturb it.
     */
    expect(new UserPush().getReadPermissions()).toEqual([
      Permission.CurrentUser,
    ]);
  });

  test("is not marked readable through relation queries", () => {
    /*
     * canReadOnRelationQuery makes a column readable from a nested select on a
     * model whose own read is admin-wide, skipping this table's column check
     * entirely. isVerified - the column this one sits beside and is read
     * alongside - does not set it, and neither does this: the paging path
     * reads both as root, so nothing needs the flag.
     */
    expect(metadata().canReadOnRelationQuery).toBeFalsy();
  });
});
