import { AddFixProductionCheck1804900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804900000000-AddFixProductionCheck";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
import { getColumnAccessControlForAllColumns } from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * Every kind of AI fix verified in production adds two nullable columns to
 * the AI fix pull request table: which check watches a merged fix, and what
 * that check measured before the merge. Nothing is indexed, keyed,
 * defaulted or required, so the migration takes no lock longer than a
 * catalog update on a table every fix writes to. The baseline holds span
 * names and log bodies, so nobody but the server reads it.
 */

const MIGRATION_NAME: string = "AddFixProductionCheck1804900000000";

// A migration's timestamp: the 13 digits its name ends in.
function timestampOf(name: string): number {
  const match: RegExpMatchArray | null = name.match(/(\d{13})$/);

  return match ? parseInt(match[1]!, 10) : 0;
}

const NEW_COLUMNS: Array<string> = ["productionCheck", "productionBaseline"];

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddFixProductionCheck1804900000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddFixProductionCheck1804900000000", () => {
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
    // After the migration that added the production watch it extends.
    expect(at).toBeGreaterThan(
      names.indexOf("AddFixProductionVerification1804400000000"),
    );
    for (const name of names.slice(0, at)) {
      expect(timestampOf(name)).toBeLessThan(timestampOf(MIGRATION_NAME));
    }
    expect(new AddFixProductionCheck1804900000000().name).toBe(MIGRATION_NAME);
  });

  test("adds the two columns, each nullable, with nothing else", async () => {
    const statements: Array<string> = await record("up");

    expect(statements).toEqual([
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "productionCheck" character varying(100)',
      'ALTER TABLE "AIAgentTaskPullRequest" ADD "productionBaseline" jsonb',
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
    const declared: Record<string, { type: TableColumnType }> = getTableColumns(
      new AIAgentTaskPullRequest(),
    ) as unknown as Record<string, { type: TableColumnType }>;

    for (const column of NEW_COLUMNS) {
      expect(Object.keys(declared)).toContain(column);
    }
    expect(declared["productionCheck"]!.type).toBe(TableColumnType.ShortText);
    expect(declared["productionBaseline"]!.type).toBe(TableColumnType.JSON);
  });

  test("the check is read like the production status, and the baseline by nobody", () => {
    const access: ReturnType<typeof getColumnAccessControlForAllColumns> =
      getColumnAccessControlForAllColumns(new AIAgentTaskPullRequest());

    expect(access["productionCheck"]!.read).toEqual(
      access["productionStatus"]!.read,
    );
    expect(access["productionCheck"]!.read).toContain(
      Permission.ReadProjectAIAgentTask,
    );
    expect(access["productionBaseline"]!.read).toEqual([]);

    for (const column of NEW_COLUMNS) {
      expect(access[column]!.create).toEqual([]);
      expect(access[column]!.update).toEqual([]);
    }
  });
});
