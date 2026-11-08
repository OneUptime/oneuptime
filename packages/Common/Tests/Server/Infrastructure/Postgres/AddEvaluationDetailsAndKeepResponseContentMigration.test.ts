import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddEvaluationDetailsAndKeepResponseContent1808997300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808997300000-AddEvaluationDetailsAndKeepResponseContent";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind an incident's and an alert's evaluation details
 * (issue #5774): Incident.evaluationDetails and Alert.evaluationDetails,
 * what the check that opened them found, and Monitor.keepResponseContent,
 * whether a monitor's incidents and alerts keep the response content of
 * that check.
 *
 * The statements are executed against a fake QueryRunner, so up() and
 * down() are told apart. Every ADD is one Postgres makes without rewriting
 * the table: the jsonb columns are nullable with no default, and the
 * boolean's default is a constant, which Postgres 11 and later keep in the
 * catalog for the rows already there - every existing monitor keeps its
 * response content, as before, and nothing is backfilled. The migration has
 * to be registered, named for its class and ordered after every migration
 * before it, or it never runs; the schema drift check holds its statements
 * to the models.
 */

const MIGRATION_TIMESTAMP: string = "1808997300000";
const MIGRATION_BASE_NAME: string =
  "AddEvaluationDetailsAndKeepResponseContent";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP: Array<string> = [
  `ALTER TABLE "Monitor" ADD "keepResponseContent" boolean NOT NULL DEFAULT true`,
  `ALTER TABLE "Incident" ADD "evaluationDetails" jsonb`,
  `ALTER TABLE "Alert" ADD "evaluationDetails" jsonb`,
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddEvaluationDetailsAndKeepResponseContent1808997300000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddEvaluationDetailsAndKeepResponseContent1808997300000", () => {
  test("adds the monitor's switch, on, and the incident's and the alert's evaluation details", async () => {
    expect(await statementsOf("up")).toEqual(UP);
  });

  test("rewrites no table: nullable jsonb with no default, and a boolean whose default is a constant", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |now\(\)|uuid_generate|gen_random/i,
      );
    }

    const [monitor, incident, alert] = await statementsOf("up");

    // Every existing monitor keeps its response content, as before.
    expect(monitor).toMatch(/ boolean NOT NULL DEFAULT true$/);
    expect(incident).not.toMatch(/DEFAULT|NOT NULL/);
    expect(alert).not.toMatch(/DEFAULT|NOT NULL/);
  });

  test("down drops every column up added, in reverse, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Alert" DROP COLUMN "evaluationDetails"`,
      `ALTER TABLE "Incident" DROP COLUMN "evaluationDetails"`,
      `ALTER TABLE "Monitor" DROP COLUMN "keepResponseContent"`,
    ]);
  });

  test("the Monitor model declares the switch: a required boolean, true to start", () => {
    const monitor: Monitor = new Monitor();

    expect(monitor.getTableColumns().columns).toContain("keepResponseContent");
    expect(monitor.getTableColumnMetadata("keepResponseContent").type).toBe(
      TableColumnType.Boolean,
    );
    expect(monitor.getTableColumnMetadata("keepResponseContent").required).toBe(
      true,
    );
    expect(
      monitor.getTableColumnMetadata("keepResponseContent").defaultValue,
    ).toBe(true);
    expect(
      monitor.getTableColumnMetadata("keepResponseContent")
        .isDefaultValueColumn,
    ).toBe(true);

    // The monitor's editors write it, as they write the rest of the monitor.
    const access: ColumnAccessControl | undefined =
      monitor.getColumnAccessControlFor("keepResponseContent");

    expect((access?.create || []).length).toBeGreaterThan(0);
    expect((access?.update || []).length).toBeGreaterThan(0);
  });

  test.each([
    ["Incident", new Incident()],
    ["Alert", new Alert()],
  ] as Array<[string, BaseModel]>)(
    "the %s model declares its evaluation details as JSON, optional, written by OneUptime only",
    (_name: string, model: BaseModel) => {
      expect(model.getTableColumns().columns).toContain("evaluationDetails");
      expect(model.getTableColumnMetadata("evaluationDetails").type).toBe(
        TableColumnType.JSON,
      );
      expect(model.getTableColumnMetadata("evaluationDetails").required).toBe(
        false,
      );

      // No API writes it: the monitor writes it when it opens the record.
      const access: ColumnAccessControl | undefined =
        model.getColumnAccessControlFor("evaluationDetails");

      expect(access?.create).toEqual([]);
      expect(access?.update).toEqual([]);
      expect((access?.read || []).length).toBeGreaterThan(0);
    },
  );

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(
      new AddEvaluationDetailsAndKeepResponseContent1808997300000().name,
    ).toBe(MIGRATION_CLASS_NAME);

    // Listed after every migration with an earlier timestamp.
    const index: number = names.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of names.slice(0, index)) {
      const timestamp: number = Number(earlier.match(/(\d{13})$/)?.[1] || 0);

      expect({
        earlier,
        before: timestamp < Number(MIGRATION_TIMESTAMP),
      }).toEqual({ earlier, before: true });
    }

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(
      Number(MIGRATION_TIMESTAMP),
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
