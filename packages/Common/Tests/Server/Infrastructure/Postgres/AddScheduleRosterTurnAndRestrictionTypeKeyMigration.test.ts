import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getMetadataArgsStorage,
  MigrationInterface,
  QueryRunner,
} from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddScheduleRosterTurnAndRestrictionTypeKey1809187791269 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791269-AddScheduleRosterTurnAndRestrictionTypeKey";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import RestrictionTimes from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";

/*
 * The migration behind #11270 and #11269:
 *
 *   - OnCallDutyPolicySchedule.rosterTurnKey, the rotation turn a roster is
 *     in, kept between the windows of a layer's active hours so a turn is
 *     announced once: nullable, no default - empty for every schedule until
 *     its roster next moves, which is what "told as before" needs;
 *   - the default restriction times of a new layer, stored with the type
 *     under restrictionType, as RestrictionTimes stores every layer's now.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Neither rewrites a row, builds an index or adds a key
 * (Docs/migrations/README.md). The migration has to be registered, named
 * for its class and ordered after every migration before it, or it never
 * runs; the schema drift check holds its statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1809187791269";
const MIGRATION_BASE_NAME: string =
  "AddScheduleRosterTurnAndRestrictionTypeKey";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

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
    new AddScheduleRosterTurnAndRestrictionTypeKey1809187791269();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddScheduleRosterTurnAndRestrictionTypeKey1809187791269", () => {
  test("adds rosterTurnKey to the schedule, and stores a new layer's default type under restrictionType", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "rosterTurnKey" character varying(500)`,
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restrictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    ]);
  });

  test("builds no index, adds no key, rewrites no row and makes nothing required", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "OnCallDutyPolicySchedule(Layer)?" /,
      );
    }
  });

  test("down puts back what up changed, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "rosterTurnKey"`,
    ]);
  });

  test("the schedule model declares the column: long text, not required, nobody's to read or write through the API", () => {
    const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();

    expect(model.getTableColumns().columns).toContain("rosterTurnKey");
    expect(model.getTableColumnMetadata("rosterTurnKey").type).toBe(
      TableColumnType.LongText,
    );
    expect(model.getTableColumnMetadata("rosterTurnKey").required).toBeFalsy();
    expect(model.getColumnAccessControlFor("rosterTurnKey")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });

  test("the layer model's default is the one the migration sets: the stored form, under restrictionType", () => {
    const column: { options: { default?: unknown } } | undefined =
      getMetadataArgsStorage().columns.find(
        (entry: { target: unknown; propertyName: string }): boolean => {
          return (
            entry.target === OnCallDutyPolicyScheduleLayer &&
            entry.propertyName === "restrictionTimes"
          );
        },
      ) as { options: { default?: unknown } } | undefined;

    expect(column).toBeDefined();
    expect(column!.options.default).toEqual(
      RestrictionTimes.getDefault().toDatabaseJSON(),
    );
    expect(JSON.stringify(column!.options.default)).toBe(
      '{"_type":"RestrictionTimes","value":{"restrictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}',
    );
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
      new AddScheduleRosterTurnAndRestrictionTypeKey1809187791269().name,
    ).toBe(MIGRATION_CLASS_NAME);

    // Every migration registered before it is numbered below it.
    const before: Array<number> = names
      .slice(0, names.indexOf(MIGRATION_CLASS_NAME))
      .map((name: string): number => {
        return Number(name.slice(-13));
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(before.length).toBeGreaterThan(0);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(Math.max(...before));
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
