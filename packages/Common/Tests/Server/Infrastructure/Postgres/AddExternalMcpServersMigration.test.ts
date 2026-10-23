import { AddFixProductionCheck1804950000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804950000000-AddFixProductionCheck";
import { AddExternalMcpServers1805000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805000000000-AddExternalMcpServers";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind external MCP servers: the servers' own table, the
 * two join tables an investigation rule and an auto remediation rule name
 * their servers in, and the column a fix's tool calls are kept in.
 *
 * Every table is new, so its indexes are built and its keys checked on no
 * rows; the one column added to an existing table is nullable with no
 * default, so Postgres adds it without rewriting the table. No existing row
 * is read or written. Statements are recorded against a fake QueryRunner;
 * the schema drift check runs the migration on Postgres against the models.
 */

const MIGRATION_NAME: string = "AddExternalMcpServers1805000000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const DROP_TABLE: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const CREATE_INDEX: RegExp = /^CREATE INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddExternalMcpServers1805000000000 =
    new AddExternalMcpServers1805000000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

// What each statement names, by the pattern that finds it.
function named(steps: Array<string>, pattern: RegExp): Array<string> {
  return steps.flatMap((step: string): Array<string> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match ? [match[1]!] : [];
  });
}

function createStatement(steps: Array<string>, table: string): string {
  const statement: string | undefined = steps.find((step: string) => {
    return step.startsWith(`CREATE TABLE "${table}" `);
  });

  expect({ table, created: statement !== undefined }).toEqual({
    table,
    created: true,
  });

  return statement!;
}

function columnsCreated(statement: string): Array<string> {
  return Array.from(statement.matchAll(CREATED_COLUMN))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

describe("the External MCP Servers migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddExternalMcpServers1805000000000().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, after master's newest (AddFixProductionCheck), above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddExternalMcpServers1805000000000);

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddExternalMcpServers1805000000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddFixProductionCheck1804950000000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddExternalMcpServers1805000000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddExternalMcpServers1805000000000)}-`,
        );
      }),
    ).toEqual(["1805000000000-AddExternalMcpServers.ts"]);
  });

  test("creates the servers' table with every column the model stores", async () => {
    const server: ExternalMcpServer = new ExternalMcpServer();
    /*
     * Relations are stored as their ids; the header names are worked out
     * by Postgres from the stored headers on every read, never stored.
     */
    const stored: Array<string> = Object.keys(getTableColumns(server))
      .filter((column: string): boolean => {
        return !server.isEntityColumn(column) && column !== "headerNames";
      })
      .sort();

    expect(
      columnsCreated(createStatement(await record("up"), "ExternalMcpServer")),
    ).toEqual(stored);
  });

  test("creates the two tables the rules name their servers in, keyed on both sides", async () => {
    const steps: Array<string> = await record("up");

    expect(
      columnsCreated(
        createStatement(steps, "AutoRemediationRuleExternalMcpServer"),
      ),
    ).toEqual(["autoRemediationRuleId", "externalMcpServerId"]);
    expect(
      columnsCreated(
        createStatement(steps, "AIInvestigationRuleExternalMcpServer"),
      ),
    ).toEqual(["aiInvestigationRuleId", "externalMcpServerId"]);

    // A rule or a server deleted takes its rows with it.
    for (const [table, column, target] of [
      [
        "AutoRemediationRuleExternalMcpServer",
        "autoRemediationRuleId",
        "AutoRemediationRule",
      ],
      [
        "AutoRemediationRuleExternalMcpServer",
        "externalMcpServerId",
        "ExternalMcpServer",
      ],
      [
        "AIInvestigationRuleExternalMcpServer",
        "aiInvestigationRuleId",
        "AIInvestigationRule",
      ],
      [
        "AIInvestigationRuleExternalMcpServer",
        "externalMcpServerId",
        "ExternalMcpServer",
      ],
    ] as Array<[string, string, string]>) {
      expect(
        steps.filter((step: string): boolean => {
          return (
            step.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT `) &&
            step.includes(
              `FOREIGN KEY ("${column}") REFERENCES "${target}"("_id") ON DELETE CASCADE`,
            )
          );
        }),
      ).toHaveLength(1);
    }
  });

  test("a deleted project takes its servers with it; a deleted user leaves them", async () => {
    const steps: Array<string> = await record("up");
    const keyOf: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return steps.find((step: string): boolean => {
        return (
          step.startsWith(`ALTER TABLE "ExternalMcpServer" ADD CONSTRAINT `) &&
          step.includes(`FOREIGN KEY ("${column}")`)
        );
      });
    };

    expect(keyOf("projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(keyOf("createdByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
    expect(keyOf("deletedByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
  });

  test("adds a fix's tool calls as a nullable column with no default: no table rewrite", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.filter((step: string): boolean => {
        return step.startsWith(`ALTER TABLE "AutoRemediationSuggestion"`);
      }),
    ).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" ADD "mcpToolCallPlan" jsonb`,
    ]);
  });

  test("reads and writes no existing row", async () => {
    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i);
    }
  });

  test("down drops exactly what up made, keys first and tables last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_TABLE).sort()).toEqual(
      named(up, CREATE_TABLE).sort(),
    );
    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX).sort()).toEqual(
      named(up, CREATE_INDEX).sort(),
    );
    expect(down).toContain(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "mcpToolCallPlan"`,
    );

    const lastKey: number = Math.max(
      ...down.map((step: string, index: number): number => {
        return DROP_CONSTRAINT.test(step) ? index : -1;
      }),
    );
    const firstTable: number = down.findIndex((step: string): boolean => {
      return DROP_TABLE.test(step);
    });

    expect(lastKey).toBeLessThan(firstTable);
    expect(down[down.length - 1]).toBe(`DROP TABLE "ExternalMcpServer"`);
  });

  /*
   * The investigation rules' list is left in the database, unread: the
   * investigation rules moved into the AI rules, servers and all
   * (MergeInvestigationRulesIntoAiRules), and have no model any more.
   */
  test("the models match: the AI rules name their servers, and a suggestion keeps the plan", () => {
    expect(Object.keys(getTableColumns(new AutoRemediationRule()))).toContain(
      "externalMcpServers",
    );
    expect(
      Object.keys(getTableColumns(new AutoRemediationSuggestion())),
    ).toContain("mcpToolCallPlan");
  });
});
