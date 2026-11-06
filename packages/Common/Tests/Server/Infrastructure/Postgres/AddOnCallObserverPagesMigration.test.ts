import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddOnCallObserverPages1808995200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808995200000-AddOnCallObserverPages";
import AlertEpisodeOnCallRule from "../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOnCallRule from "../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import OnCallPageAs from "../../../../Types/OnCallDutyPolicy/OnCallPageAs";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind paging people as observers (OnCallObserverPage): on
 * each of the four on-call rules, what it pages its policies as (pageAs); on
 * an execution log, whether it pages its people as observers
 * (isObserverPage).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Nothing is backfilled: every rule
 * that exists starts on Responders - how every rule pages today - and every
 * run as false; a NOT NULL column with a constant default rewrites no row.
 * Beyond the SQL, the migration has to be registered, named consistently and
 * ordered after every migration already registered, or it silently never
 * runs. (The statements were generated with npm run
 * generate-postgres-migration.)
 */

const MIGRATION_TIMESTAMP: string = "1808995200000";
const MIGRATION_BASE_NAME: string = "AddOnCallObserverPages";
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
    new AddOnCallObserverPages1808995200000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddOnCallObserverPages1808995200000", () => {
  test("adds what each on-call rule pages its policies as, starting on Responders", async () => {
    const up: Array<string> = await statementsOf("up");

    for (const table of RULE_TABLES) {
      expect(up).toContain(
        `ALTER TABLE "${table}" ADD "pageAs" character varying(100) NOT NULL DEFAULT '${OnCallPageAs.Responders}'`,
      );
    }
  });

  test("adds whether a run pages observers to the execution log, false for every run there is", async () => {
    expect(await statementsOf("up")).toContain(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "isObserverPage" boolean NOT NULL DEFAULT false`,
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
    expect(down).toHaveLength(5);
  });

  test("is registered last, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddOnCallObserverPages1808995200000().name).toBe(
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
      expect(rule.getTableColumnMetadata("pageAs").type).toBe(
        TableColumnType.ShortText,
      );
      expect(rule.getTableColumnMetadata("pageAs").defaultValue).toBe(
        OnCallPageAs.Responders,
      );
      expect(rule.getTableColumnMetadata("pageAs").allowedValues).toEqual(
        Object.values(OnCallPageAs),
      );
      // Whoever may write the rule may say what it pages as.
      expect(rule.getColumnAccessControlFor("pageAs")).toEqual({
        create: rule.getCreatePermissions(),
        read: rule.getReadPermissions(),
        update: rule.getUpdatePermissions(),
      });
    }

    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    expect(log.getTableColumnMetadata("isObserverPage").type).toBe(
      TableColumnType.Boolean,
    );
    expect(log.getTableColumnMetadata("isObserverPage").defaultValue).toBe(
      false,
    );
    /*
     * Whoever may run a policy on a record may ask for observers (Execute
     * On-Call Policy, the API); nobody changes it afterwards.
     */
    expect(log.getColumnAccessControlFor("isObserverPage")?.create).toContain(
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    );
    expect(log.getColumnAccessControlFor("isObserverPage")?.update).toEqual([]);
  });
});
