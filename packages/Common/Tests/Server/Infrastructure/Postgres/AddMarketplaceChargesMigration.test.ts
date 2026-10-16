import { AddMarketplaceCharges1803050000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1803050000000-AddMarketplaceCharges";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind billing balance top-ups through a cloud marketplace:
 * one new table, "MarketplaceCharge", and indexes on it - nothing existing is
 * touched, so it takes no lock anyone else is waiting on.
 *
 * Pinned: the lookups the hourly report makes (a purchase's charges no report
 * has taken: marketplaceSubscriptionId, marketplaceUsageReportId) and the
 * project's are indexed; the amount is required and exact (numeric).
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

  await new AddMarketplaceCharges1803050000000()[direction](runner);

  return statements;
};

const CREATE_INDEX_PATTERN: RegExp =
  /^CREATE INDEX "(IDX_[0-9a-f]+)" ON "([A-Za-z]+)" \(([^)]+)\)$/;
const DROP_INDEX_PATTERN: RegExp = /^DROP INDEX "public"\."(IDX_[0-9a-f]+)"$/;
const ROW_WRITING_STATEMENT_PATTERN: RegExp =
  /^\s*(UPDATE|INSERT|DELETE|TRUNCATE|ALTER)\b/i;

describe("AddMarketplaceCharges1803050000000", () => {
  test("creates the MarketplaceCharge table and indexes on it, and nothing else", async () => {
    const statements: Array<string> = await runMigration("up");

    expect(statements[0]).toMatch(/^CREATE TABLE "MarketplaceCharge" \(/);

    for (const statement of statements.slice(1)) {
      const index: RegExpMatchArray | null =
        statement.match(CREATE_INDEX_PATTERN);

      expect(index).not.toBeNull();
      expect(index![2]).toBe("MarketplaceCharge");
    }

    for (const statement of statements) {
      expect(statement).not.toMatch(ROW_WRITING_STATEMENT_PATTERN);
    }
  });

  test("indexes the purchase, the project and the billing report", async () => {
    const indexed: Array<string> = (await runMigration("up"))
      .map((statement: string): string | undefined => {
        return statement.match(CREATE_INDEX_PATTERN)?.[3];
      })
      .filter((column: string | undefined): column is string => {
        return Boolean(column);
      })
      .sort();

    expect(indexed).toEqual(
      [
        `"marketplaceSubscriptionId"`,
        `"projectId"`,
        `"marketplaceUsageReportId"`,
      ].sort(),
    );
  });

  test("stores the amount exactly, required, and the report as optional", async () => {
    const table: string = (await runMigration("up"))[0]!;

    expect(table).toContain(`"amountInUSD" numeric NOT NULL`);
    expect(table).toContain(`"balanceType" character varying(100) NOT NULL`);
    expect(table).toContain(`"isAutomatic" boolean NOT NULL DEFAULT false`);
    expect(table).toMatch(/"marketplaceUsageReportId" uuid(,|\))/);
  });

  test("down() drops exactly what up() created", async () => {
    const up: Array<string> = await runMigration("up");
    const down: Array<string> = await runMigration("down");

    const created: Array<string> = up
      .map((statement: string): string | undefined => {
        return statement.match(CREATE_INDEX_PATTERN)?.[1];
      })
      .filter((name: string | undefined): name is string => {
        return Boolean(name);
      })
      .sort();

    const dropped: Array<string> = down
      .map((statement: string): string | undefined => {
        return statement.match(DROP_INDEX_PATTERN)?.[1];
      })
      .filter((name: string | undefined): name is string => {
        return Boolean(name);
      })
      .sort();

    expect(dropped).toEqual(created);
    expect(down[down.length - 1]).toBe(`DROP TABLE "MarketplaceCharge"`);
    expect(down).toHaveLength(created.length + 1);
  });

  test("is registered right after the marketplace subscriptions migration", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(names.indexOf("AddMarketplaceCharges1803050000000")).toBe(
      names.indexOf("AddMarketplaceSubscriptions1803000000000") + 1,
    );
  });
});
