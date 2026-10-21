import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddOnCallRuleWorkingHours1805000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805000000000-AddOnCallRuleWorkingHours";
import AlertEpisodeOnCallRule from "../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOnCallRule from "../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import OnCallRuleWhenToPage from "../../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";

/*
 * The migration behind holding an on-call rule's page until working hours:
 * on each of the four on-call rules, when it pages (whenToPage), its working
 * hours and their time zone; on an execution log, when a run that waits
 * starts paging (pagingStartsAt).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Nothing is backfilled: every
 * rule that exists starts on Right Away - how every rule pages today - and
 * a NOT NULL column with a constant default rewrites no row; the rest are
 * nullable and empty. Beyond the SQL, the migration has to be registered,
 * named consistently and ordered after every migration already registered,
 * or it silently never runs. (The statements were generated with npm run
 * generate-postgres-migration, and the schema drift check finds nothing
 * left to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1805000000000";
const MIGRATION_BASE_NAME: string = "AddOnCallRuleWorkingHours";
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
    new AddOnCallRuleWorkingHours1805000000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddOnCallRuleWorkingHours1805000000000", () => {
  test("adds when to page, working hours and their time zone to each on-call rule", async () => {
    const up: Array<string> = await statementsOf("up");

    for (const table of RULE_TABLES) {
      expect(up).toContain(
        `ALTER TABLE "${table}" ADD "whenToPage" character varying(100) NOT NULL DEFAULT '${OnCallRuleWhenToPage.RightAway}'`,
      );
      expect(up).toContain(`ALTER TABLE "${table}" ADD "workingHours" jsonb`);
      expect(up).toContain(
        `ALTER TABLE "${table}" ADD "workingHoursTimezone" character varying(100)`,
      );
    }
  });

  test("adds when a run that waits starts paging to the execution log", async () => {
    expect(await statementsOf("up")).toContain(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pagingStartsAt" TIMESTAMP WITH TIME ZONE`,
    );
  });

  test("adds why a run that waited started early to the execution log", async () => {
    expect(await statementsOf("up")).toContain(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pagingStartedEarlyReason" character varying(500)`,
    );
  });

  test("builds no index and adds no key: nothing holds a table's writers for a scan", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/i);
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
    expect(down).toHaveLength(14);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddOnCallRuleWorkingHours1805000000000().name).toBe(
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

  test("matches the models it was generated from", () => {
    const rules: Array<BaseModel> = [
      new AlertOnCallRule(),
      new AlertEpisodeOnCallRule(),
      new IncidentOnCallRule(),
      new IncidentEpisodeOnCallRule(),
    ];

    for (const rule of rules) {
      expect(rule.getTableColumnMetadata("whenToPage").type).toBe(
        TableColumnType.ShortText,
      );
      expect(rule.getTableColumnMetadata("whenToPage").defaultValue).toBe(
        OnCallRuleWhenToPage.RightAway,
      );
      expect(rule.getTableColumnMetadata("workingHours").type).toBe(
        TableColumnType.JSON,
      );
      expect(rule.getTableColumnMetadata("workingHoursTimezone").type).toBe(
        TableColumnType.ShortText,
      );
      // Whoever may write the rule may say when it pages.
      expect(rule.getColumnAccessControlFor("whenToPage")).toEqual({
        create: rule.getCreatePermissions(),
        read: rule.getReadPermissions(),
        update: rule.getUpdatePermissions(),
      });
    }

    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    expect(log.getTableColumnMetadata("pagingStartsAt").type).toBe(
      TableColumnType.Date,
    );
    // OneUptime holds and starts a run; no caller writes when it pages.
    expect(log.getColumnAccessControlFor("pagingStartsAt")?.create).toEqual([]);
    expect(log.getColumnAccessControlFor("pagingStartsAt")?.update).toEqual([]);
    expect(log.getTableColumnMetadata("pagingStartedEarlyReason").type).toBe(
      TableColumnType.LongText,
    );
    expect(
      log.getColumnAccessControlFor("pagingStartedEarlyReason")?.create,
    ).toEqual([]);
    expect(
      log.getColumnAccessControlFor("pagingStartedEarlyReason")?.update,
    ).toEqual([]);
  });
});
