import { AddEnterpriseMarketplaceBilling1803300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1803300000000-AddEnterpriseMarketplaceBilling";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind billing self-hosted Enterprise installations through
 * a cloud marketplace: one nullable JSON column on the GlobalConfig row.
 * Adding a nullable column without a default rewrites nothing and waits on
 * nothing, and no existing installation has a value for it.
 */

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

  await new AddEnterpriseMarketplaceBilling1803300000000()[direction](runner);

  return statements;
};

describe("AddEnterpriseMarketplaceBilling1803300000000", () => {
  test("adds one nullable jsonb column to GlobalConfig, and nothing else", async () => {
    expect(await runMigration("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "enterpriseMarketplaceBilling" jsonb`,
    ]);
  });

  test("down drops exactly that column", async () => {
    expect(await runMigration("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseMarketplaceBilling"`,
    ]);
  });

  test("is registered, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(names).toContain("AddEnterpriseMarketplaceBilling1803300000000");
    expect(
      names.indexOf("AddEnterpriseMarketplaceBilling1803300000000"),
    ).toBeGreaterThan(names.indexOf("AddStatusPageTheme1803250000000"));
    expect(new AddEnterpriseMarketplaceBilling1803300000000().name).toBe(
      "AddEnterpriseMarketplaceBilling1803300000000",
    );
  });
});
