import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSamlSingleLogout1809186200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186200000-AddSamlSingleLogout";
import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import InstanceSamlSigningKey from "../../../../Models/DatabaseModels/InstanceSamlSigningKey";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind SAML Single Logout (#9603): the installation's SAML
 * signing key pair gets a table of its own, InstanceSamlSigningKey, empty
 * until a process needs it; ProjectSSO and GlobalSSO get the identity
 * provider's Sign Out URL, singleLogoutURL, nullable, and the switch,
 * signOutOfIdentityProvider, off by default.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive (Docs/migrations/README.md): a new table, two
 * booleans with a constant default and two nullable columns - no index on
 * a table that holds data, no key, nothing backfilled. Every SAML provider
 * there is keeps signing people out of OneUptime alone, as before. The
 * schema drift check holds the statements to the models; it found no drift
 * against a fresh Postgres with every migration applied.
 */

const MIGRATION_TIMESTAMP: string = "1809186200000";
const MIGRATION_BASE_NAME: string = "AddSamlSingleLogout";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddComplianceSettingNamespace1809186100000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddSamlSingleLogout1809186200000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddSamlSingleLogout1809186200000", () => {
  test("creates the signing key table, and adds the Sign Out URL and the switch, off, to both SAML provider tables", async () => {
    expect(await statementsOf("up")).toEqual([
      `CREATE TABLE "InstanceSamlSigningKey" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "privateKey" text NOT NULL, "certificate" text NOT NULL, CONSTRAINT "PK_3f0ac336cb8159663e3413d31cb" PRIMARY KEY ("_id"))`,
      `ALTER TABLE "ProjectSSO" ADD "singleLogoutURL" text`,
      `ALTER TABLE "ProjectSSO" ADD "signOutOfIdentityProvider" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "GlobalSSO" ADD "singleLogoutURL" text`,
      `ALTER TABLE "GlobalSSO" ADD "signOutOfIdentityProvider" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing, and writes no row", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |INSERT |DEFAULT true/i,
      );
    }
  });

  test("the Sign Out URL has no default: a provider there is has none until an admin enters it", async () => {
    for (const statement of (await statementsOf("up")).filter(
      (candidate: string): boolean => {
        return candidate.includes('"singleLogoutURL"');
      },
    )) {
      expect(statement).not.toMatch(/DEFAULT|NOT NULL/);
    }
  });

  test("down drops what up added, and nothing else, the table last", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "GlobalSSO" DROP COLUMN "signOutOfIdentityProvider"`,
      `ALTER TABLE "GlobalSSO" DROP COLUMN "singleLogoutURL"`,
      `ALTER TABLE "ProjectSSO" DROP COLUMN "signOutOfIdentityProvider"`,
      `ALTER TABLE "ProjectSSO" DROP COLUMN "singleLogoutURL"`,
      `DROP TABLE "InstanceSamlSigningKey"`,
    ]);
  });

  test("the models declare the columns it adds", () => {
    for (const model of [new ProjectSSO(), new GlobalSSO()]) {
      expect(model.getTableColumns().columns).toEqual(
        expect.arrayContaining([
          "singleLogoutURL",
          "signOutOfIdentityProvider",
        ]),
      );
      expect(model.getTableColumnMetadata("singleLogoutURL").type).toBe(
        TableColumnType.LongURL,
      );
      expect(
        model.getTableColumnMetadata("singleLogoutURL").required,
      ).toBeFalsy();
      expect(
        model.getTableColumnMetadata("signOutOfIdentityProvider").type,
      ).toBe(TableColumnType.Boolean);
      expect(
        model.getTableColumnMetadata("signOutOfIdentityProvider").defaultValue,
      ).toBe(false);
    }

    const key: InstanceSamlSigningKey = new InstanceSamlSigningKey();

    expect(key.tableName).toBe("InstanceSamlSigningKey");
    expect(key.getTableColumnMetadata("privateKey").type).toBe(
      TableColumnType.VeryLongText,
    );
    expect(key.getTableColumnMetadata("certificate").type).toBe(
      TableColumnType.VeryLongText,
    );
  });

  /*
   * A project's SAML provider's switch is set as the OIDC provider's is
   * (#9535): by whoever may create or edit the provider, and read by whoever
   * reads its settings - not by the sign-in page. The instance-wide one is a
   * master admin's alone.
   */
  test("the switch and the Sign Out URL are set as the OIDC provider's switch is", () => {
    const project: ProjectSSO = new ProjectSSO();
    const oidc: ProjectOIDC = new ProjectOIDC();

    for (const column of ["signOutOfIdentityProvider", "singleLogoutURL"]) {
      const access: ReturnType<typeof project.getColumnAccessControlFor> =
        project.getColumnAccessControlFor(column);
      const oidcAccess: ReturnType<typeof oidc.getColumnAccessControlFor> =
        oidc.getColumnAccessControlFor("signOutOfIdentityProvider");

      expect(access?.create).toEqual(
        project.getColumnAccessControlFor("signOnURL")?.create,
      );
      expect(access?.update).toEqual(
        project.getColumnAccessControlFor("signOnURL")?.update,
      );
      expect(access?.read).toEqual(
        project.getColumnAccessControlFor("isTested")?.read,
      );
      expect(access?.read?.length).toBe(oidcAccess?.read?.length);

      expect(new GlobalSSO().getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    }
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddSamlSingleLogout1809186200000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);

    const files: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(files).toEqual([`${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`]);
  });
});
