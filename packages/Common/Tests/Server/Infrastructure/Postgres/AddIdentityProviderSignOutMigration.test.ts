import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIdentityProviderSignOut1809184710000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184710000-AddIdentityProviderSignOut";
import GlobalOIDC from "../../../../Models/DatabaseModels/GlobalOidc";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import UserSession from "../../../../Models/DatabaseModels/UserSession";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind "Sign out of the identity provider too" (#9535):
 * ProjectOIDC and GlobalOIDC get the switch, signOutOfIdentityProvider, off
 * by default; UserSession gets identityProviderSignOut, where a sign-in
 * through a provider with it on keeps what its sign-out at the provider
 * needs, the ID token encrypted.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive (Docs/migrations/README.md): two booleans with a
 * constant default and a nullable JSON column, no index, no key, nothing
 * backfilled. Every provider there is keeps signing people out of OneUptime
 * alone, as before, and every session there is keeps nothing. The schema
 * drift check holds the statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1809184710000";
const MIGRATION_BASE_NAME: string = "AddIdentityProviderSignOut";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddDataStoreFindingSampleRecords1809184700000";

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
  const migration: MigrationInterface =
    new AddIdentityProviderSignOut1809184710000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddIdentityProviderSignOut1809184710000", () => {
  test("adds the switch to both OIDC provider tables, off, and the session's record, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "ProjectOIDC" ADD "signOutOfIdentityProvider" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "GlobalOIDC" ADD "signOutOfIdentityProvider" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "UserSession" ADD "identityProviderSignOut" jsonb`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |DEFAULT true/i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "(ProjectOIDC|GlobalOIDC|UserSession)" ADD /,
      );
    }
  });

  // A default a server of the release before would read differently is the only way an add could change anything.
  test("the session's column has no default: a session there is reads as one that keeps nothing", async () => {
    const sessionStatement: string = (await statementsOf("up")).find(
      (statement: string): boolean => {
        return statement.includes('"UserSession"');
      },
    )!;

    expect(sessionStatement).not.toMatch(/DEFAULT|NOT NULL/);
  });

  test("down drops the columns up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "UserSession" DROP COLUMN "identityProviderSignOut"`,
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "signOutOfIdentityProvider"`,
      `ALTER TABLE "ProjectOIDC" DROP COLUMN "signOutOfIdentityProvider"`,
    ]);
  });

  test("the models declare the columns it adds", () => {
    for (const model of [new ProjectOIDC(), new GlobalOIDC()]) {
      expect(model.getTableColumns().columns).toContain(
        "signOutOfIdentityProvider",
      );
      expect(
        model.getTableColumnMetadata("signOutOfIdentityProvider").type,
      ).toBe(TableColumnType.Boolean);
      expect(
        model.getTableColumnMetadata("signOutOfIdentityProvider").defaultValue,
      ).toBe(false);
    }

    const session: UserSession = new UserSession();

    expect(session.getTableColumns().columns).toContain(
      "identityProviderSignOut",
    );
    expect(session.getTableColumnMetadata("identityProviderSignOut").type).toBe(
      TableColumnType.JSON,
    );
    expect(
      session.getTableColumnMetadata("identityProviderSignOut").required,
    ).toBeFalsy();
  });

  /*
   * A project's provider is turned on and changed by whoever may turn it on
   * (isEnabled), and read by whoever reads its settings (isTested) - not by
   * the sign-in page, which needs only whether a provider is on. The
   * instance-wide one is a master admin's alone.
   */
  test("the switch is set as the rest of each provider is", () => {
    const project: ProjectOIDC = new ProjectOIDC();
    const access: ReturnType<typeof project.getColumnAccessControlFor> =
      project.getColumnAccessControlFor("signOutOfIdentityProvider");

    expect(access?.create).toEqual(
      project.getColumnAccessControlFor("isEnabled")?.create,
    );
    expect(access?.update).toEqual(
      project.getColumnAccessControlFor("isEnabled")?.update,
    );
    expect(access?.read).toEqual(
      project.getColumnAccessControlFor("isTested")?.read,
    );
    expect(
      new GlobalOIDC().getColumnAccessControlFor("signOutOfIdentityProvider"),
    ).toEqual({ create: [], read: [], update: [] });
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
    expect(new AddIdentityProviderSignOut1809184710000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809184700000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
