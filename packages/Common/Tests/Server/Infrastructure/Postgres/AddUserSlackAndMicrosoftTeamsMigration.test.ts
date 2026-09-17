import { AddUserSlackAndMicrosoftTeams1789000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1789000000000-AddUserSlackAndMicrosoftTeams";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The guard that lets this migration run twice.
 *
 * It shipped as AddUserSlackAndMicrosoftTeams1788800000000 and was renumbered
 * to 1789000000000 to clear a timestamp collision. TypeORM records a migration
 * by class NAME, so the rename made it pending again on every database that
 * had already run it, and `CREATE TABLE "UserSlack"` failed on its own table —
 * which stops the runner, leaving this and every later migration pending on
 * every boot until it is fixed.
 *
 * So there are two databases to satisfy, and both are asserted below: one that
 * has never seen this migration must get the whole schema, and one that
 * already carries it must get no DDL at all.
 *
 * The statements are inspected rather than executed — these tests run without
 * a database, and what can go wrong here is which statements are issued, not
 * whether Postgres understands them.
 */

const MIGRATION_NAME: string = "AddUserSlackAndMicrosoftTeams1789000000000";

const SUPERSEDED_MIGRATION_NAME: string =
  "AddUserSlackAndMicrosoftTeams1788800000000";

const MIGRATION_TIMESTAMP: string = "1789000000000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

/*
 * Every statement `up` issues after the probe. The count is asserted rather
 * than sampled: the risk the guard introduces is an early return that swallows
 * work a fresh install needs, and only a total catches a statement going
 * missing from the middle.
 */
const STATEMENTS_IN_UP: number = 30;

type CapturedQueryRunner = {
  runner: QueryRunner;
  queries: Array<string>;
};

type IsProbeFunction = (sql: string) => boolean;

/*
 * The one read `up` makes: does "UserSlack" already exist? Matched on shape
 * rather than on the exact string so reformatting the SQL does not fail these.
 */
const isProbe: IsProbeFunction = (sql: string): boolean => {
  return (
    sql.includes("information_schema.tables") && sql.includes("'UserSlack'")
  );
};

type MockQueryRunnerFunction = (
  userSlackTableExists: boolean,
) => CapturedQueryRunner;

const mockQueryRunner: MockQueryRunnerFunction = (
  userSlackTableExists: boolean,
): CapturedQueryRunner => {
  const queries: Array<string> = [];

  return {
    queries: queries,
    runner: {
      query: async (sql: string): Promise<unknown> => {
        queries.push(sql);

        if (isProbe(sql)) {
          return [{ exists: userSlackTableExists }];
        }

        return undefined;
      },
    } as unknown as QueryRunner,
  };
};

const migration: AddUserSlackAndMicrosoftTeams1789000000000 =
  new AddUserSlackAndMicrosoftTeams1789000000000();

describe("AddUserSlackAndMicrosoftTeams migration", () => {
  /*
   * TypeORM matches migrations by this name. A mismatch between the class name
   * and the `name` property makes the migration run again on every boot.
   */
  test("names itself consistently so it is recorded as run", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
    expect(AddUserSlackAndMicrosoftTeams1789000000000.name).toBe(
      MIGRATION_NAME,
    );
  });

  describe("registration", () => {
    test("it is registered exactly once", () => {
      const occurrences: number = SchemaMigrations.filter(
        (registered: new () => MigrationInterface): boolean => {
          return registered.name === MIGRATION_NAME;
        },
      ).length;

      expect(occurrences).toBe(1);
    });

    /*
     * The old number belongs to DropMarketingConversionAddEnterpriseLicenseEmail
     * now. Registering both names would run the same DDL twice under two
     * records, which is the failure this migration already had once.
     */
    test("no longer registers the timestamp it was renamed away from", () => {
      const names: Array<string> = SchemaMigrations.map(
        (registered: new () => MigrationInterface): string => {
          return registered.name;
        },
      );

      expect(names).not.toContain(SUPERSEDED_MIGRATION_NAME);
    });

    test("exactly one file on disk carries its timestamp, and it is this one", () => {
      const matching: Array<string> = fs
        .readdirSync(MIGRATION_DIRECTORY)
        .filter((file: string): boolean => {
          return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
        });

      expect(matching).toEqual([
        `${MIGRATION_TIMESTAMP}-AddUserSlackAndMicrosoftTeams.ts`,
      ]);
    });
  });

  describe("on a database that has never run it", () => {
    test("checks for the table before touching anything", async () => {
      const up: CapturedQueryRunner = mockQueryRunner(false);

      await migration.up(up.runner);

      expect(isProbe(up.queries[0]!)).toBe(true);
    });

    test("creates the whole schema, unchanged by the guard", async () => {
      const up: CapturedQueryRunner = mockQueryRunner(false);

      await migration.up(up.runner);

      const statements: Array<string> = up.queries.filter(
        (sql: string): boolean => {
          return !isProbe(sql);
        },
      );

      expect(statements.length).toBe(STATEMENTS_IN_UP);
    });

    test("creates both method tables and their notification wiring", async () => {
      const up: CapturedQueryRunner = mockQueryRunner(false);

      await migration.up(up.runner);

      const sql: string = up.queries.join("\n");

      expect(sql).toContain(`CREATE TABLE "UserSlack"`);
      expect(sql).toContain(`CREATE TABLE "UserMicrosoftTeams"`);
      expect(sql).toContain(
        `ALTER TABLE "UserNotificationRule" ADD "userSlackId" uuid`,
      );
      expect(sql).toContain(
        `ALTER TABLE "UserNotificationRule" ADD "userMicrosoftTeamsId" uuid`,
      );
      expect(sql).toContain(
        `ALTER TABLE "UserNotificationSetting" ADD "alertBySlack" boolean NOT NULL DEFAULT false`,
      );
      expect(sql).toContain(
        `ALTER TABLE "UserNotificationSetting" ADD "alertByMicrosoftTeams" boolean NOT NULL DEFAULT false`,
      );
    });
  });

  describe("on a database that already ran it under its old name", () => {
    /*
     * The whole point. Migrations run one transaction each, so a recorded run
     * committed all 30 statements or none of them — the table being there means
     * the schema is there, and re-issuing any of it can only fail.
     */
    test("issues nothing but the probe", async () => {
      const up: CapturedQueryRunner = mockQueryRunner(true);

      await migration.up(up.runner);

      expect(up.queries.length).toBe(1);
      expect(isProbe(up.queries[0]!)).toBe(true);
    });

    test("never re-runs the CREATE TABLE that was failing", async () => {
      const up: CapturedQueryRunner = mockQueryRunner(true);

      await migration.up(up.runner);

      const sql: string = up.queries.join("\n");

      expect(sql).not.toContain(`CREATE TABLE "UserSlack"`);
      expect(sql).not.toContain(`CREATE TABLE "UserMicrosoftTeams"`);
      expect(sql).not.toContain("ADD CONSTRAINT");
    });
  });

  /*
   * `down` is deliberately NOT guarded. It reverses the schema whichever name
   * recorded it, and a rollback that finds the tables missing has bigger
   * problems than a failed DROP.
   */
  describe("down", () => {
    test("drops both method tables", async () => {
      const down: CapturedQueryRunner = mockQueryRunner(true);

      await migration.down(down.runner);

      const sql: string = down.queries.join("\n");

      expect(sql).toContain(`DROP TABLE "UserSlack"`);
      expect(sql).toContain(`DROP TABLE "UserMicrosoftTeams"`);
      expect(down.queries.length).toBe(STATEMENTS_IN_UP);
    });
  });
});
