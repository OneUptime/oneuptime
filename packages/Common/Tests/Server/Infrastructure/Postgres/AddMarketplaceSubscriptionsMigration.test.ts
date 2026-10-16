import { AddMarketplaceSubscriptions1803000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1803000000000-AddMarketplaceSubscriptions";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind cloud marketplace purchases: two new tables
 * (MarketplaceSubscription, MarketplaceUsageReport) and one nullable column
 * on Project.
 *
 * What the feature depends on the database for, and so what is pinned here:
 *
 *   - a purchase is unique per (marketplace, externalSubscriptionId). The
 *     landing page and the marketplace's own notification for one purchase
 *     arrive within a second of each other; the unique index is what lets
 *     only one of them create the row.
 *   - Project gains billingMarketplace without a default or NOT NULL, so
 *     Postgres adds it without rewriting or scanning the table - Project is
 *     read on every request.
 *   - no plaintext claim token is ever stored, only its hash.
 *
 * Pure SQL-contract assertions against a fake QueryRunner.
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

  await new AddMarketplaceSubscriptions1803000000000()[direction](runner);

  return statements;
};

const NEW_TABLES: Array<string> = [
  "MarketplaceSubscription",
  "MarketplaceUsageReport",
];

const CREATE_TABLE_PATTERN: RegExp = /^CREATE TABLE "([A-Za-z]+)" \(/;
const CREATE_INDEX_PATTERN: RegExp =
  /^CREATE (UNIQUE )?INDEX "(IDX_[0-9a-f]+)" ON "([A-Za-z]+)" \(([^)]+)\)$/;
const DROP_INDEX_PATTERN: RegExp = /^DROP INDEX "public"\."(IDX_[0-9a-f]+)"$/;
const DROP_TABLE_PATTERN: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ROW_WRITING_STATEMENT_PATTERN: RegExp =
  /^\s*(UPDATE|INSERT|DELETE|TRUNCATE)\b/i;
const MIGRATION_TIMESTAMP_PATTERN: RegExp = /(\d{13})$/;

describe("AddMarketplaceSubscriptions1803000000000", () => {
  describe("up()", () => {
    test("creates the two tables, and touches only Project among existing ones", async () => {
      const statements: Array<string> = await runMigration("up");

      const created: Array<string> = statements
        .map((statement: string): string | undefined => {
          return statement.match(CREATE_TABLE_PATTERN)?.[1];
        })
        .filter((table: string | undefined): table is string => {
          return Boolean(table);
        });

      expect(created).toEqual(NEW_TABLES);

      for (const statement of statements) {
        const createTable: RegExpMatchArray | null =
          statement.match(CREATE_TABLE_PATTERN);
        const createIndex: RegExpMatchArray | null =
          statement.match(CREATE_INDEX_PATTERN);

        if (createTable) {
          continue;
        }

        if (createIndex) {
          // Indexes only on the new tables, which nobody else is using yet.
          expect(NEW_TABLES).toContain(createIndex[3]);
          continue;
        }

        expect(statement).toBe(
          `ALTER TABLE "Project" ADD "billingMarketplace" character varying(100)`,
        );
      }
    });

    test("adds Project.billingMarketplace without a default or NOT NULL", async () => {
      const projectStatements: Array<string> = (
        await runMigration("up")
      ).filter((statement: string): boolean => {
        return statement.includes(`"Project"`);
      });

      expect(projectStatements).toHaveLength(1);
      expect(projectStatements[0]).not.toMatch(/DEFAULT|NOT NULL/i);
    });

    test("makes a purchase unique per marketplace and external ID", async () => {
      const statements: Array<string> = await runMigration("up");

      const unique: Array<RegExpMatchArray> = statements
        .map((statement: string): RegExpMatchArray | null => {
          return statement.match(CREATE_INDEX_PATTERN);
        })
        .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
          return Boolean(match && match[1]);
        });

      expect(unique).toHaveLength(1);
      expect(unique[0]![3]).toBe("MarketplaceSubscription");
      expect(unique[0]![4]).toBe(`"marketplace", "externalSubscriptionId"`);
    });

    test("indexes the columns the lookups and the jobs filter on", async () => {
      const statements: Array<string> = await runMigration("up");

      const indexed: Array<string> = statements
        .map((statement: string): string | null => {
          const match: RegExpMatchArray | null =
            statement.match(CREATE_INDEX_PATTERN);
          return match && !match[1] ? `${match[3]}.${match[4]}` : null;
        })
        .filter((value: string | null): value is string => {
          return Boolean(value);
        })
        .sort();

      expect(indexed).toEqual(
        [
          `MarketplaceSubscription."claimTokenHash"`,
          `MarketplaceSubscription."externalCustomerId"`,
          `MarketplaceSubscription."externalEntitlementId"`,
          `MarketplaceSubscription."projectId"`,
          `MarketplaceSubscription."status"`,
          `MarketplaceUsageReport."marketplaceSubscriptionId"`,
          `MarketplaceUsageReport."projectId"`,
          `MarketplaceUsageReport."status"`,
        ].sort(),
      );
    });

    test("stores only the claim token's hash", async () => {
      const subscriptionTable: string = (await runMigration("up")).find(
        (statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "MarketplaceSubscription"`);
        },
      )!;

      expect(subscriptionTable).toContain(`"claimTokenHash" character varying`);
      expect(subscriptionTable).not.toMatch(/"claimToken" /);
    });

    test("never writes or rewrites rows", async () => {
      for (const statement of await runMigration("up")) {
        expect(statement).not.toMatch(ROW_WRITING_STATEMENT_PATTERN);
      }
    });
  });

  describe("down()", () => {
    test("drops exactly what up() created", async () => {
      const up: Array<string> = await runMigration("up");
      const down: Array<string> = await runMigration("down");

      const createdIndexes: Array<string> = up
        .map((statement: string): string | undefined => {
          return statement.match(CREATE_INDEX_PATTERN)?.[2];
        })
        .filter((name: string | undefined): name is string => {
          return Boolean(name);
        })
        .sort();

      const droppedIndexes: Array<string> = down
        .map((statement: string): string | undefined => {
          return statement.match(DROP_INDEX_PATTERN)?.[1];
        })
        .filter((name: string | undefined): name is string => {
          return Boolean(name);
        })
        .sort();

      expect(droppedIndexes).toEqual(createdIndexes);

      const droppedTables: Array<string> = down
        .map((statement: string): string | undefined => {
          return statement.match(DROP_TABLE_PATTERN)?.[1];
        })
        .filter((name: string | undefined): name is string => {
          return Boolean(name);
        })
        .sort();

      expect(droppedTables).toEqual([...NEW_TABLES].sort());
      expect(down).toContain(
        `ALTER TABLE "Project" DROP COLUMN "billingMarketplace"`,
      );
      expect(down).toHaveLength(createdIndexes.length + NEW_TABLES.length + 1);
    });
  });

  test("is registered last, after every migration it was numbered after", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    const index: number = names.indexOf(
      "AddMarketplaceSubscriptions1803000000000",
    );

    expect(index).toBeGreaterThanOrEqual(0);

    const timestamp: number = Number(
      "AddMarketplaceSubscriptions1803000000000".match(
        MIGRATION_TIMESTAMP_PATTERN,
      )![1],
    );

    for (const name of names.slice(0, index)) {
      const earlier: RegExpMatchArray | null = name.match(
        MIGRATION_TIMESTAMP_PATTERN,
      );

      if (earlier) {
        expect([name, Number(earlier[1]) < timestamp]).toEqual([name, true]);
      }
    }
  });
});
