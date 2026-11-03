/**
 * The columns behind a private status page's sign-in links (#5600).
 *
 * StatusPage.enableMagicLinkLogin - "on unless the page's team turns it off"
 * - is carried by three things that are easy to confuse, so all three are
 * pinned:
 * - NEW rows get true from the Postgres column default (@Column default);
 * - EXISTING rows got true from the migration's NOT NULL DEFAULT true;
 * - @TableColumn defaultValue is documentation only (the API schema).
 * Flipping any one of them silently changes how every reader may sign in.
 *
 * StatusPagePrivateUser.magicLinkToken and magicLinkExpires hold a bearer
 * credential: nobody reads or writes them through the API, and the token is
 * a secret column - only its hash is ever stored (Identity's
 * /send-magic-link). And lastActive, which says a reader has signed in, is
 * readable by whoever may read the reader, and writable by nobody.
 */

import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1808920000000-AddStatusPageMagicLinkLogin.ts",
);

const MIGRATIONS_INDEX_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "Index.ts",
);

function typeOrmColumn(
  target: ColumnMetadataArgs["target"],
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === target && column.propertyName === propertyName;
  });
}

describe("StatusPage.enableMagicLinkLogin", () => {
  const COLUMN: string = "enableMagicLinkLogin";

  const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
    return new StatusPage().getTableColumnMetadata(COLUMN);
  };

  test("is a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("a new status page takes sign-in links: the Postgres default is true, and the column is never null", () => {
    expect(typeOrmColumn(StatusPage, COLUMN)?.options.default).toBe(true);
    expect(typeOrmColumn(StatusPage, COLUMN)?.options.nullable).toBe(false);
  });

  test("every status page made before it takes them too: the migration adds it NOT NULL DEFAULT true", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      `ALTER TABLE "StatusPage" ADD "${COLUMN}" boolean NOT NULL DEFAULT true`,
    );
  });

  test("is documented as on, and may be left out of a create", () => {
    expect(metadata().defaultValue).toBe(true);
    expect(new StatusPage().isDefaultValueColumn(COLUMN)).toBe(true);
    expect(metadata().required).toBeFalsy();
  });

  test("is readable by whoever may read the page, and editable by its editors only", () => {
    const access: { read?: Array<Permission>; update?: Array<Permission> } =
      new StatusPage().getColumnAccessControlFor(COLUMN) || {};

    expect(access.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.StatusPageAdmin,
        Permission.StatusPageViewer,
        Permission.ReadProjectStatusPage,
      ]),
    );
    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.StatusPageAdmin,
        Permission.EditProjectStatusPage,
      ]),
    );
    expect(access.update).not.toContain(Permission.Viewer);
    expect(access.update).not.toContain(Permission.StatusPageViewer);
  });

  test("is not read by the public: the status page app is told whether links are offered, worked out on the server", () => {
    expect(
      new StatusPage().getColumnAccessControlFor(COLUMN)?.read,
    ).not.toContain(Permission.Public);
  });
});

describe("StatusPagePrivateUser's sign-in link columns", () => {
  test.each(["magicLinkToken", "magicLinkExpires"])(
    "%s is read and written by nobody through the API",
    (column: string) => {
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = new StatusPagePrivateUser().getColumnAccessControlFor(column) || {};

      expect(access.create).toEqual([]);
      expect(access.read).toEqual([]);
      expect(access.update).toEqual([]);
    },
  );

  test("the token is a secret column, empty until a link is asked for", () => {
    expect(
      new StatusPagePrivateUser().getTableColumnMetadata("magicLinkToken")
        .secret,
    ).toBe(true);
    expect(
      typeOrmColumn(StatusPagePrivateUser, "magicLinkToken")?.options.nullable,
    ).toBe(true);
    expect(
      typeOrmColumn(StatusPagePrivateUser, "magicLinkExpires")?.options
        .nullable,
    ).toBe(true);
  });

  test("the migration adds both, empty, and drops them again on the way down", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      'ALTER TABLE "StatusPagePrivateUser" ADD "magicLinkToken" character varying(100)',
    );
    expect(migration).toContain(
      'ALTER TABLE "StatusPagePrivateUser" ADD "magicLinkExpires" TIMESTAMP WITH TIME ZONE',
    );
    expect(migration).not.toContain(
      '"magicLinkToken" character varying(100) NOT NULL',
    );

    for (const column of [
      "magicLinkExpires",
      "magicLinkToken",
      "enableMagicLinkLogin",
    ]) {
      expect(migration).toContain(`DROP COLUMN "${column}"`);
    }
  });

  test("the migration is registered, so it runs", () => {
    const index: string = fs.readFileSync(MIGRATIONS_INDEX_PATH, "utf8");

    expect(index).toContain(
      'import { AddStatusPageMagicLinkLogin1808920000000 } from "./1808920000000-AddStatusPageMagicLinkLogin";',
    );
    expect(index).toMatch(/\n {2}AddStatusPageMagicLinkLogin1808920000000,\n/);
  });
});

describe("StatusPagePrivateUser.lastActive", () => {
  test("is readable by whoever may read the reader, so the list can say who has signed in", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      new StatusPagePrivateUser().getColumnAccessControlFor("lastActive") || {};
    const emailRead: Array<Permission> | undefined =
      new StatusPagePrivateUser().getColumnAccessControlFor("email")?.read;

    expect(access.read).toEqual(emailRead);
  });

  test("is written by sign-in alone, never through the API", () => {
    const access: {
      create?: Array<Permission>;
      update?: Array<Permission>;
    } =
      new StatusPagePrivateUser().getColumnAccessControlFor("lastActive") || {};

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });
});
