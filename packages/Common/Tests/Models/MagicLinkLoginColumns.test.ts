/**
 * The columns behind signing in to OneUptime with an emailed link
 * (Types/Accounts/MagicLink).
 *
 * User.magicLinkToken and magicLinkExpires hold a bearer credential for the
 * account: nobody reads or writes them through the API, the token is a
 * secret column - only its hash is ever stored (Identity's
 * /send-magic-link) - and both are empty until a link is asked for.
 *
 * GlobalConfig.disableMagicLinkLogin - "on unless a master admin turns them
 * off" - is carried by three things that are easy to confuse, so all three
 * are pinned: the Postgres column default for a new row, the migration's
 * default for the row that exists, and the documented default.
 */

import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import User from "../../Models/DatabaseModels/User";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_PATH: string = path.join(
  SCHEMA_MIGRATIONS_DIRECTORY,
  "1808992650000-AddMagicLinkLogin.ts",
);

const MIGRATIONS_INDEX_PATH: string = path.join(
  SCHEMA_MIGRATIONS_DIRECTORY,
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

// The migration's up() and down(), apart.
function migrationHalves(): { up: string; down: string } {
  const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");
  const downAt: number = migration.indexOf("public async down(");

  expect(downAt).toBeGreaterThan(0);

  return {
    up: migration.slice(0, downAt),
    down: migration.slice(downAt),
  };
}

describe("User's sign-in link columns", () => {
  test.each(["magicLinkToken", "magicLinkExpires"])(
    "%s is read and written by nobody through the API",
    (column: string) => {
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = new User().getColumnAccessControlFor(column) || {};

      expect(access.create).toEqual([]);
      expect(access.read).toEqual([]);
      expect(access.update).toEqual([]);
    },
  );

  test("the token is a secret column, kept out of the API's documentation", () => {
    const metadata: TableColumnMetadata = new User().getTableColumnMetadata(
      "magicLinkToken",
    );

    expect(metadata.secret).toBe(true);
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(
      new User().getTableColumnMetadata("magicLinkExpires")
        .hideColumnInDocumentation,
    ).toBe(true);
  });

  test("the expiry is a date", () => {
    expect(new User().getTableColumnMetadata("magicLinkExpires").type).toBe(
      TableColumnType.Date,
    );
  });

  test("both are empty until a link is asked for", () => {
    expect(typeOrmColumn(User, "magicLinkToken")?.options.nullable).toBe(true);
    expect(typeOrmColumn(User, "magicLinkExpires")?.options.nullable).toBe(
      true,
    );
    expect(typeOrmColumn(User, "magicLinkToken")?.options.default).toBe(
      undefined,
    );
  });

  test("are held like the password reset columns beside them", () => {
    expect(new User().getColumnAccessControlFor("magicLinkToken")).toEqual(
      new User().getColumnAccessControlFor("resetPasswordToken"),
    );
    expect(typeOrmColumn(User, "magicLinkToken")?.options.length).toBe(
      typeOrmColumn(User, "resetPasswordToken")?.options.length,
    );
  });
});

describe("GlobalConfig.disableMagicLinkLogin", () => {
  const COLUMN: string = "disableMagicLinkLogin";

  const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
    return new GlobalConfig().getTableColumnMetadata(COLUMN);
  };

  test("is a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("a new server takes sign-in links: the Postgres default is false", () => {
    expect(typeOrmColumn(GlobalConfig, COLUMN)?.options.default).toBe(false);
  });

  test("the server that exists takes them too: the migration adds it DEFAULT false", () => {
    expect(migrationHalves().up).toContain(
      `ALTER TABLE "GlobalConfig" ADD "${COLUMN}" boolean DEFAULT false`,
    );
  });

  test("is documented as off - links on - and may be left out of a write, as the switches beside it", () => {
    expect(metadata().defaultValue).toBe(false);
    expect(metadata().required).toBeFalsy();
    expect(new GlobalConfig().isDefaultValueColumn(COLUMN)).toBe(
      new GlobalConfig().isDefaultValueColumn("disableSignup"),
    );
  });

  test("is read and written by master admins alone, as the switches beside it are", () => {
    expect(new GlobalConfig().getColumnAccessControlFor(COLUMN)).toEqual(
      new GlobalConfig().getColumnAccessControlFor("disableSignup"),
    );
    expect(
      new GlobalConfig().getColumnAccessControlFor(COLUMN)?.read,
    ).not.toContain(Permission.Public);
  });
});

describe("the AddMagicLinkLogin migration", () => {
  test("adds the three columns, the two of User empty", () => {
    const { up } = migrationHalves();

    expect(up).toContain(
      'ALTER TABLE "User" ADD "magicLinkToken" character varying(100)',
    );
    expect(up).toContain(
      'ALTER TABLE "User" ADD "magicLinkExpires" TIMESTAMP WITH TIME ZONE',
    );
    expect(up).not.toContain("NOT NULL");
  });

  test("builds no index and adds no foreign key, which would hold the User table's writers", () => {
    const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).not.toMatch(/CREATE (UNIQUE )?INDEX/);
    expect(migration).not.toContain("FOREIGN KEY");
  });

  test("drops all three again on the way down", () => {
    const { down } = migrationHalves();

    for (const column of [
      "disableMagicLinkLogin",
      "magicLinkExpires",
      "magicLinkToken",
    ]) {
      expect(down).toContain(`DROP COLUMN "${column}"`);
    }
  });

  test("is registered, so it runs", () => {
    const index: string = fs.readFileSync(MIGRATIONS_INDEX_PATH, "utf8");

    expect(index).toContain(
      'import { AddMagicLinkLogin1808992650000 } from "./1808992650000-AddMagicLinkLogin";',
    );
    expect(index).toMatch(/\n {2}AddMagicLinkLogin1808992650000,\n/);
  });
});
