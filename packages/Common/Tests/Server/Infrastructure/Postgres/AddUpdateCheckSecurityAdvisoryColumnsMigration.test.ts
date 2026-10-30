import { AddUpdateCheckSecurityAdvisoryColumns1808510000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808510000000-AddUpdateCheckSecurityAdvisoryColumns";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind the daily security advisory check: five nullable
 * columns on the one GlobalConfig row - the advisories as last read, when
 * they were read, which were emailed, when GitHub was last asked and why that
 * failed. Adding a nullable column without a default rewrites nothing and
 * waits on nothing; no index, no foreign key, nothing to backfill.
 */

const NAME: string = "AddUpdateCheckSecurityAdvisoryColumns1808510000000";

const runMigration: (
  direction: "up" | "down",
) => Promise<Array<string>> = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql).trim());
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddUpdateCheckSecurityAdvisoryColumns1808510000000()[direction](
    runner,
  );

  return statements;
};

describe(NAME, () => {
  test("adds five nullable columns to GlobalConfig, and nothing else", async () => {
    expect(await runMigration("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisories" jsonb`,
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisoriesCheckedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "GlobalConfig" ADD "securityAdvisoriesEmailed" jsonb`,
      `ALTER TABLE "GlobalConfig" ADD "updateCheckLastAttemptAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "GlobalConfig" ADD "updateCheckLastFailure" character varying(100)`,
    ]);
  });

  test("builds no index and adds no foreign key, so it needs no online DDL", async () => {
    for (const statement of await runMigration("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL/,
      );
    }
  });

  test("down drops exactly those columns, in reverse", async () => {
    expect(await runMigration("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "updateCheckLastFailure"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "updateCheckLastAttemptAt"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisoriesEmailed"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisoriesCheckedAt"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "securityAdvisories"`,
    ]);
  });

  test("is registered, after the migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(names).toContain(NAME);
    expect(names.indexOf(NAME)).toBeGreaterThan(
      names.indexOf("AddCloudAccountFeed1808480000000"),
    );
    expect(new AddUpdateCheckSecurityAdvisoryColumns1808510000000().name).toBe(
      NAME,
    );
  });
});
