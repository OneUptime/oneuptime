import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../../Models/DatabaseModels/TeamMemberCustomField";
import { AddCustomFieldValueMapping1790900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790900000000-AddCustomFieldValueMapping";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";

/*
 * The value-mapping columns, and the two ways a migration silently fails to
 * ship them.
 *
 * The first is the one AGENTS.md calls out: a migration file that exists but
 * is never added to SchemaMigrations/Index.ts does not run, so the column is
 * simply missing in production while every local database that was migrated by
 * hand looks fine. The second is a column added to a model but not to the
 * migration (or vice versa) — that is a green deploy followed by a red Schema
 * Drift job.
 *
 * Both are checked against the models' own decorator metadata and the
 * filesystem rather than a list written out twice.
 */

const MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_PATH: string = path.join(
  MIGRATIONS_DIRECTORY,
  "1790900000000-AddCustomFieldValueMapping.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

const MODELS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Models",
  "DatabaseModels",
);

const MAPPING_COLUMNS: ReadonlyArray<string> = [
  "mapFromResourceType",
  "mapFromCustomFieldName",
];

/** The `<timestamp>-<Name>.ts` prefix TypeORM orders migrations by. */
const MIGRATION_TIMESTAMP_PREFIX: RegExp = /^(\d+)-/;

/*
 * What TypeORM's metadata storage keys entities by: the class itself. Only
 * ever compared by identity against `column.target`, so `unknown` states the
 * requirement exactly — and avoids `Function`/`object`, both of which this
 * repo's eslint config bans.
 */
type ModelClass = unknown;

const DEFINITION_MODELS: Record<string, ModelClass> = {
  AlertCustomField: AlertCustomField,
  IncidentCustomField: IncidentCustomField,
  InventoryItemCustomField: InventoryItemCustomField,
  MonitorCustomField: MonitorCustomField,
  OnCallDutyPolicyCustomField: OnCallDutyPolicyCustomField,
  ScheduledMaintenanceCustomField: ScheduledMaintenanceCustomField,
  StatusPageCustomField: StatusPageCustomField,
  TeamCustomField: TeamCustomField,
  TeamMemberCustomField: TeamMemberCustomField,
};

/*
 * The definition tables as they exist on disk, so a tenth one added later
 * fails this suite rather than quietly shipping without the columns.
 */
const DEFINITION_TABLES: Array<string> = fs
  .readdirSync(MODELS_DIRECTORY)
  .filter((fileName: string) => {
    return fileName.endsWith("CustomField.ts");
  })
  .map((fileName: string) => {
    return fileName.replace(/\.ts$/, "");
  })
  .sort();

type DeclaredColumnsFunction = (modelType: ModelClass) => Array<string>;

const getDeclaredColumns: DeclaredColumnsFunction = (
  modelType: ModelClass,
): Array<string> => {
  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === modelType;
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    });
};

describe("the value-mapping migration", () => {
  test("the file the rest of this suite reads exists, and every definition table is covered", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(SOURCE.length).toBeGreaterThan(0);
    expect(DEFINITION_TABLES.length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(DEFINITION_MODELS).sort()).toEqual(DEFINITION_TABLES);
  });

  /*
   * Registration is the step with no feedback: an unregistered migration
   * throws no error, logs nothing and simply never runs.
   */
  test("is registered in SchemaMigrations/Index.ts so it actually runs", () => {
    expect(SchemaMigrations).toContain(AddCustomFieldValueMapping1790900000000);
  });

  test("its class name matches the `name` TypeORM records in the migrations table", () => {
    expect(new AddCustomFieldValueMapping1790900000000().name).toBe(
      "AddCustomFieldValueMapping1790900000000",
    );
  });

  test.each(DEFINITION_TABLES)(
    "adds both mapping columns to %s",
    (tableName: string) => {
      for (const column of MAPPING_COLUMNS) {
        expect(SOURCE).toContain(
          `ALTER TABLE "${tableName}" ADD "${column}" character varying(100)`,
        );
      }
    },
  );

  test.each(DEFINITION_TABLES)(
    "drops both mapping columns from %s on the way down",
    (tableName: string) => {
      for (const column of MAPPING_COLUMNS) {
        expect(SOURCE).toContain(
          `ALTER TABLE "${tableName}" DROP COLUMN "${column}"`,
        );
      }
    },
  );

  test.each(DEFINITION_TABLES)(
    "%s declares both mapping columns on the model, so the schema and the entities agree",
    (tableName: string) => {
      const declared: Array<string> = getDeclaredColumns(
        DEFINITION_MODELS[tableName],
      );

      for (const column of MAPPING_COLUMNS) {
        expect(declared).toContain(column);
      }
    },
  );

  /*
   * TypeORM orders migrations by the timestamp in the class name, not by the
   * order of the array. A timestamp below one already registered would run
   * this migration before migrations that shipped earlier — harmless here, but
   * the convention in this directory is a monotonic timestamp and breaking it
   * makes the ordering unreadable.
   */
  test("its timestamp is the newest in the directory", () => {
    const timestamps: Array<number> = fs
      .readdirSync(MIGRATIONS_DIRECTORY)
      .map((fileName: string) => {
        return MIGRATION_TIMESTAMP_PREFIX.exec(fileName);
      })
      .filter((match: RegExpExecArray | null): match is RegExpExecArray => {
        return Boolean(match);
      })
      .map((match: RegExpExecArray) => {
        return parseInt(match[1]!, 10);
      });

    expect(Math.max(...timestamps)).toBe(1790900000000);
  });
});
