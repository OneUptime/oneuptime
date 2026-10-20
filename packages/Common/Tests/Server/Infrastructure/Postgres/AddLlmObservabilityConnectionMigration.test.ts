import { AddLlmObservabilityConnection1804450000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804450000000-AddLlmObservabilityConnection";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import LlmCostBudget from "../../../../Models/DatabaseModels/LlmCostBudget";
import LlmObservabilityConnection from "../../../../Models/DatabaseModels/LlmObservabilityConnection";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import LlmBudgetSpendSource from "../../../../Types/LlmObservability/LlmBudgetSpendSource";
import LlmConversationReaders from "../../../../Types/LlmObservability/LlmConversationReaders";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * AI connections add one table, LlmObservabilityConnection (AI provider
 * accounts and company AI tools, read on a schedule), and one column,
 * LlmCostBudget.spendSource. The table is new, so its indexes and keys are
 * built on an empty table; the column has a constant default, so adding it
 * rewrites nothing. Renumbered past master's
 * AddFixProductionVerification1804400000000, which took this number first.
 */

const MIGRATION_NAME: string = "AddLlmObservabilityConnection1804450000000";

// A migration's timestamp: the 13 digits its name ends in.
function timestampOf(name: string): number {
  const match: RegExpMatchArray | null = name.match(/(\d{13})$/);

  return match ? parseInt(match[1]!, 10) : 0;
}

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddLlmObservabilityConnection1804450000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

// The columns a CREATE TABLE statement lists, constraints left out.
function columnsOf(createTable: string): Array<string> {
  const list: string = createTable.slice(
    createTable.indexOf("(") + 1,
    createTable.lastIndexOf(")"),
  );

  return list
    .split(", ")
    .filter((part: string): boolean => {
      return part.startsWith('"');
    })
    .map((part: string): string => {
      return part.slice(1, part.indexOf('"', 1));
    });
}

// The model's columns kept in its own table: relations are other tables' rows.
function storedColumnsOf(
  columns: Dictionary<TableColumnMetadata>,
): Array<string> {
  return Object.keys(columns).filter((key: string): boolean => {
    return (
      columns[key]!.type !== TableColumnType.Entity &&
      columns[key]!.type !== TableColumnType.EntityArray
    );
  });
}

function quotedNamesAfter(
  statements: Array<string>,
  marker: string,
): Array<string> {
  return statements
    .filter((statement: string): boolean => {
      return statement.includes(marker);
    })
    .map((statement: string): string => {
      const start: number = statement.indexOf(marker) + marker.length;

      return statement.slice(start, statement.indexOf('"', start));
    })
    .sort();
}

describe("AddLlmObservabilityConnection1804450000000", () => {
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
    expect(at).toBeGreaterThan(
      names.indexOf("AddFixProductionVerification1804400000000"),
    );
    for (const name of names.slice(0, at)) {
      expect(timestampOf(name)).toBeLessThan(timestampOf(MIGRATION_NAME));
    }
    expect(new AddLlmObservabilityConnection1804450000000().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("creates the connections table with exactly the columns the model declares", async () => {
    const statements: Array<string> = await record("up");
    const createTable: string = statements[0]!;

    expect(createTable).toContain('CREATE TABLE "LlmObservabilityConnection"');
    expect(columnsOf(createTable).sort()).toEqual(
      storedColumnsOf(getTableColumns(new LlmObservabilityConnection())).sort(),
    );
  });

  test("keeps the secrets in one column the model encrypts, never empty", async () => {
    const createTable: string = (await record("up"))[0]!;

    expect(createTable).toContain('"secrets" text NOT NULL');
    expect(
      getTableColumns(new LlmObservabilityConnection())["secrets"]!.encrypted,
    ).toBe(true);
    expect(
      columnsOf(createTable).filter((column: string): boolean => {
        return column.toLowerCase().includes("secret");
      }),
    ).toEqual(["secrets"]);
  });

  test("a company AI tool's chats default to owners and admins, and existing budgets keep counting app calls", async () => {
    const statements: Array<string> = await record("up");

    expect(statements[0]).toContain(
      `"conversationReaders" character varying(100) NOT NULL DEFAULT '${LlmConversationReaders.Admins}'`,
    );
    expect(statements).toContain(
      `ALTER TABLE "LlmCostBudget" ADD "spendSource" character varying(100) NOT NULL DEFAULT '${LlmBudgetSpendSource.Calls}'`,
    );
    expect(Object.keys(getTableColumns(new LlmCostBudget()))).toContain(
      "spendSource",
    );
  });

  test("down takes away every index, key, column and table up adds, the table last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(quotedNamesAfter(down, 'DROP INDEX "public"."')).toEqual(
      quotedNamesAfter(up, 'CREATE INDEX "'),
    );
    expect(quotedNamesAfter(down, 'DROP CONSTRAINT "')).toEqual(
      quotedNamesAfter(up, 'ADD CONSTRAINT "'),
    );
    expect(down).toContain(
      'ALTER TABLE "LlmCostBudget" DROP COLUMN "spendSource"',
    );
    expect(down[down.length - 1]).toBe(
      'DROP TABLE "LlmObservabilityConnection"',
    );
    expect(quotedNamesAfter(up, 'CREATE INDEX "')).toHaveLength(5);
    expect(quotedNamesAfter(up, 'ADD CONSTRAINT "')).toHaveLength(4);
  });
});
