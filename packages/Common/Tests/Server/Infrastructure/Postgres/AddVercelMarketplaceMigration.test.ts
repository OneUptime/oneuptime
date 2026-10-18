import { AddVercelMarketplace1803700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1803700000000-AddVercelMarketplace";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind Vercel Marketplace: two new tables -
 * "VercelMarketplaceInstallation" (a Vercel team, its token and where its
 * invoices stand) and "VercelMarketplaceConnection" (a Vercel project
 * connected to a resource, and its monitor) - and indexes on them. Nothing
 * existing is touched, so it takes no lock anyone else is waiting on.
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

  await new AddVercelMarketplace1803700000000()[direction](runner);

  return statements;
};

const NEW_TABLES: Array<string> = [
  "VercelMarketplaceInstallation",
  "VercelMarketplaceConnection",
];

const INDEX_PATTERN: RegExp =
  /^CREATE (UNIQUE )?INDEX "(IDX_[0-9a-f]+)" ON "([A-Za-z]+)" \(([^)]+)\)$/;

describe("AddVercelMarketplace1803700000000", () => {
  test("creates the two tables and indexes on them, and nothing else", async () => {
    const statements: Array<string> = await runMigration("up");

    const created: Array<string> = statements
      .map((statement: string): string | undefined => {
        return statement.match(/^CREATE TABLE "([A-Za-z]+)" \(/)?.[1];
      })
      .filter((table: string | undefined): table is string => {
        return Boolean(table);
      });

    expect(created).toEqual(NEW_TABLES);

    for (const statement of statements) {
      if (statement.startsWith("CREATE TABLE")) {
        continue;
      }

      const index: RegExpMatchArray | null = statement.match(INDEX_PATTERN);
      expect(index).not.toBeNull();
      expect(NEW_TABLES).toContain(index![3]);
    }
  });

  test("makes an installation unique by Vercel's ID, and a Vercel project unique per resource", async () => {
    const unique: Array<string> = (await runMigration("up"))
      .map((statement: string): RegExpMatchArray | null => {
        return statement.match(INDEX_PATTERN);
      })
      .filter((index: RegExpMatchArray | null): index is RegExpMatchArray => {
        return Boolean(index && index[1]);
      })
      .map((index: RegExpMatchArray): string => {
        return `${index[3]}: ${index[4]}`;
      });

    expect(unique.sort()).toEqual(
      [
        `VercelMarketplaceInstallation: "installationId"`,
        `VercelMarketplaceConnection: "marketplaceSubscriptionId", "vercelProjectId"`,
      ].sort(),
    );
  });

  test("keeps the access token as text, to be encrypted, and requires a status", async () => {
    const table: string = (await runMigration("up"))[0]!;

    expect(table).toContain(`"accessToken" text`);
    expect(table).toContain(`"status" character varying(100) NOT NULL`);
    expect(table).toContain(`"installationId" character varying(100) NOT NULL`);
  });

  test("drops exactly what it made", async () => {
    const down: Array<string> = await runMigration("down");

    expect(
      down.filter((statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      }),
    ).toEqual([
      `DROP TABLE "VercelMarketplaceConnection"`,
      `DROP TABLE "VercelMarketplaceInstallation"`,
    ]);
    expect(
      down.filter((statement: string): boolean => {
        return statement.startsWith("DROP INDEX");
      }),
    ).toHaveLength(
      (await runMigration("up")).filter((statement: string): boolean => {
        return statement.includes(" INDEX ");
      }).length,
    );
  });

  test("is registered, last", () => {
    const last: unknown = SchemaMigrations[SchemaMigrations.length - 1];
    expect(last).toBe(AddVercelMarketplace1803700000000);
  });
});
