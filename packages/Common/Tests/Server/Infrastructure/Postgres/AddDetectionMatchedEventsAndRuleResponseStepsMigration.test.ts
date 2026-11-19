import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDetectionMatchedEventsAndRuleResponseSteps1809185220000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185220000-AddDetectionMatchedEventsAndRuleResponseSteps";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a detection that keeps the events it matched
 * (#9619) and a rule that carries its own response steps (#9621).
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): one jsonb
 * column on each table, no default, no index, no key, nothing backfilled.
 * A server of the release before ignores them; a detection that fired
 * before keeps nothing, and a library rule added before reads its steps
 * from the library. The migration has to be registered, named for its class
 * and ordered after every migration before it, or it never runs; the schema
 * drift check holds its statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1809185220000";
const MIGRATION_BASE_NAME: string =
  "AddDetectionMatchedEventsAndRuleResponseSteps";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "DropIncidentTemplateOwnerNotifiedFlag1809185210000";
const PREVIOUS_TIMESTAMP: number = 1809185210000;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddDetectionMatchedEventsAndRuleResponseSteps1809185220000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDetectionMatchedEventsAndRuleResponseSteps1809185220000", () => {
  test("adds a rule's response steps and a detection's kept events, each a nullable jsonb column", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DetectionRule" ADD "responseSteps" jsonb`,
      `ALTER TABLE "SecurityDetection" ADD "matchedEvents" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "(DetectionRule|SecurityDetection)" ADD /,
      );
    }
  });

  test("down drops the columns up added, in the reverse order, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "SecurityDetection" DROP COLUMN "matchedEvents"`,
      `ALTER TABLE "DetectionRule" DROP COLUMN "responseSteps"`,
    ]);
  });

  test("a rule's response steps are JSON its own editors write and its readers read", () => {
    const model: DetectionRule = new DetectionRule();
    const column: string = "responseSteps";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();

    for (const access of ["create", "read", "update"] as const) {
      expect(model.getColumnAccessControlFor(column)?.[access]).toEqual(
        model.getColumnAccessControlFor("sigmaRuleYaml")?.[access],
      );
    }
  });

  test("a detection's kept events are JSON nobody reads or writes through the API", () => {
    const model: SecurityDetection = new SecurityDetection();
    const column: string = "matchedEvents";

    expect(model.getTableColumns().columns).toContain(column);
    expect(model.getTableColumnMetadata(column).type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata(column).required).toBeFalsy();

    /*
     * A Security role scoped to some sources reads a case's detections,
     * not every source's events: only OneUptime reads the column, and shows
     * a kept event only to a reader of its source.
     */
    expect(model.getColumnAccessControlFor(column)?.read).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
    expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    expect(
      model.getTableColumnMetadata(column).canReadOnRelationQuery,
    ).toBeFalsy();
  });

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
      new AddDetectionMatchedEventsAndRuleResponseSteps1809185220000().name,
    ).toBe(MIGRATION_CLASS_NAME);

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= PREVIOUS_TIMESTAMP;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
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
