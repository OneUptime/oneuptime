import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddOnCallAiFirstResponder1808110000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808110000000-AddOnCallAiFirstResponder";
import AlertEpisodeOnCallRule from "../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOnCallRule from "../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind letting OneUptime AI respond first
 * (OnCallPolicyAiHold): on each of the four on-call rules, how long AI may
 * hold a page (aiHoldTimeInMinutes); on an execution log, how its hold ended
 * (aiHoldOutcome).
 *
 * The statements are executed against a fake QueryRunner, so up() and down()
 * are told apart. Nothing is backfilled - both columns are nullable, empty
 * being the default hold time and no hold - and nothing scans a table. The
 * migration has to be registered, named for its class and ordered after every
 * migration before it, or it never runs; the schema drift check holds its
 * statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1808110000000";
const MIGRATION_BASE_NAME: string = "AddOnCallAiFirstResponder";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const RULE_TABLES: Array<string> = [
  "AlertOnCallRule",
  "AlertEpisodeOnCallRule",
  "IncidentOnCallRule",
  "IncidentEpisodeOnCallRule",
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddOnCallAiFirstResponder1808110000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddOnCallAiFirstResponder1808110000000", () => {
  test("adds how long OneUptime AI may hold a page to each on-call rule", async () => {
    const up: Array<string> = await statementsOf("up");

    for (const table of RULE_TABLES) {
      expect(up).toContain(
        `ALTER TABLE "${table}" ADD "aiHoldTimeInMinutes" integer`,
      );
    }
  });

  test("adds how a hold ended to the execution log", async () => {
    expect(await statementsOf("up")).toContain(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "aiHoldOutcome" character varying(100)`,
    );
  });

  test("adds only nullable columns, builds no index and adds no key", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/i);
      expect(statement).not.toMatch(/NOT NULL|DEFAULT/i);
      expect(statement).toMatch(/^ALTER TABLE "[A-Za-z]+" ADD "[A-Za-z]+" /);
    }
  });

  test("down drops every column up added, and nothing else", async () => {
    const up: Array<string> = await statementsOf("up");
    const down: Array<string> = await statementsOf("down");

    const added: Array<string> = up.map((statement: string): string => {
      return statement.replace(
        /^(ALTER TABLE "[^"]+") ADD ("[^"]+").*$/,
        "$1 DROP COLUMN $2",
      );
    });

    expect([...down].sort()).toEqual([...added].sort());
    expect(down).toHaveLength(5);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddOnCallAiFirstResponder1808110000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    const timestamps: Array<number> = registered.map((name: string): number => {
      const match: RegExpMatchArray | null = name.match(/(\d{13})$/);
      return match ? parseInt(match[1]!, 10) : 0;
    });
    const at: number = registered.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of timestamps.slice(0, at)) {
      expect(earlier).toBeLessThan(parseInt(MIGRATION_TIMESTAMP, 10));
    }
  });

  test("matches the models it was written for", () => {
    const rules: Array<BaseModel> = [
      new AlertOnCallRule(),
      new AlertEpisodeOnCallRule(),
      new IncidentOnCallRule(),
      new IncidentEpisodeOnCallRule(),
    ];

    for (const rule of rules) {
      expect(rule.getTableColumnMetadata("aiHoldTimeInMinutes").type).toBe(
        TableColumnType.Number,
      );
      // Whoever may write the rule may say how long AI holds its page.
      expect(rule.getColumnAccessControlFor("aiHoldTimeInMinutes")).toEqual({
        create: rule.getCreatePermissions(),
        read: rule.getReadPermissions(),
        update: rule.getUpdatePermissions(),
      });
    }

    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    expect(log.getTableColumnMetadata("aiHoldOutcome").type).toBe(
      TableColumnType.ShortText,
    );
    // OneUptime holds a run and ends its hold; no caller writes how.
    expect(log.getColumnAccessControlFor("aiHoldOutcome")?.create).toEqual([]);
    expect(log.getColumnAccessControlFor("aiHoldOutcome")?.update).toEqual([]);
  });
});
