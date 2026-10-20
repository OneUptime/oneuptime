import { AddFixProductionVerification1804400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804400000000-AddFixProductionVerification";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * Fix verified in production adds eight nullable columns to the AI fix pull
 * request table: the merge, and what production showed. Nothing is
 * indexed, keyed, defaulted or required, so the migration takes no lock
 * longer than a catalog update on a table every fix writes to.
 */

const MIGRATION_NAME: string = "AddFixProductionVerification1804400000000";

// A migration's timestamp: the 13 digits its name ends in.
function timestampOf(name: string): number {
  const match: RegExpMatchArray | null = name.match(/(\d{13})$/);

  return match ? parseInt(match[1]!, 10) : 0;
}

const NEW_COLUMNS: Array<string> = [
  "mergeCommitSha",
  "mergedAt",
  "productionStatus",
  "productionStatusAt",
  "deployedAt",
  "deployedVersion",
  "deployedCommitSha",
  "productionSummary",
];

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddFixProductionVerification1804400000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddFixProductionVerification1804400000000", () => {
  test("is registered once, after every older migration", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface) => {
        return migration.name;
      },
    );
    const at: number = names.indexOf(MIGRATION_NAME);

    expect(
      names.filter((name: string) => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    // Renumbered past the last migration registered when it was generated.
    expect(at).toBeGreaterThan(
      names.indexOf("AddCodeRepositoryRunnerIndexAndKey1804350000000"),
    );
    for (const name of names.slice(0, at)) {
      expect(timestampOf(name)).toBeLessThan(timestampOf(MIGRATION_NAME));
    }
    expect(new AddFixProductionVerification1804400000000().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("adds the eight columns, each nullable, with nothing else", async () => {
    const statements: Array<string> = await record("up");

    expect(statements).toEqual([
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "mergeCommitSha" character varying(100)',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "mergedAt" TIMESTAMP WITH TIME ZONE',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "productionStatus" character varying(100)',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "productionStatusAt" TIMESTAMP WITH TIME ZONE',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedAt" TIMESTAMP WITH TIME ZONE',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedVersion" character varying(100)',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedCommitSha" character varying(100)',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "productionSummary" character varying(500)',
    ]);
    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|INDEX|REFERENCES/);
    }
  });

  test("down drops them, newest first", async () => {
    expect(await record("down")).toEqual(
      [...NEW_COLUMNS].reverse().map((column: string) => {
        return `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("adds exactly the columns the model declares", () => {
    const declared: Array<string> = Object.keys(
      getTableColumns(new AIAgentTaskPullRequest()),
    );

    for (const column of NEW_COLUMNS) {
      expect(declared).toContain(column);
    }
  });
});
