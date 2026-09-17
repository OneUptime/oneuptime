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
import { AddCustomFieldValueMapping1791600000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791600000000-AddCustomFieldValueMapping";
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
  "1791600000000-AddCustomFieldValueMapping.ts",
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

/*
 * The timestamp read off the CLASS name, which is what TypeORM actually sorts
 * by and what the migrations table records. Null for the one registered class
 * that predates the convention (InitialMigration).
 */
const MIGRATION_CLASS_TIMESTAMP: RegExp = /(\d{10,})$/;

const OWN_CLASS_NAME: string = "AddCustomFieldValueMapping1791600000000";

type TimestampOfClassNameFunction = (className: string) => number | null;

const timestampOfClassName: TimestampOfClassNameFunction = (
  className: string,
): number | null => {
  const match: RegExpExecArray | null =
    MIGRATION_CLASS_TIMESTAMP.exec(className);

  return match ? parseInt(match[1]!, 10) : null;
};

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
    expect(SchemaMigrations).toContain(AddCustomFieldValueMapping1791600000000);
  });

  test("its class name matches the `name` TypeORM records in the migrations table", () => {
    expect(new AddCustomFieldValueMapping1791600000000().name).toBe(
      "AddCustomFieldValueMapping1791600000000",
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
   * position in SchemaMigrations/Index.ts. A timestamp BELOW one already
   * registered would run this migration ahead of migrations that shipped
   * before it — against a schema that does not yet have the columns those
   * migrations added.
   *
   * This used to assert the timestamp was the newest in the whole DIRECTORY,
   * which is a claim any later migration falsifies: the next one to land
   * (AddMacAddressToNetworkDevice, 1791700000000) turned it red without going
   * anywhere near the value-mapping columns it guards. The migrations
   * registered AFTER this one run after it whichever way round they are, and
   * are none of this test's business; the ones registered BEFORE it are the
   * queue it must not jump.
   *
   * Note this is deliberately not a claim that the whole registry is
   * monotonic. It is not — eleven adjacent pairs are already inverted, from
   * branches that landed out of order — and asserting otherwise here would be
   * failing this suite for somebody else's history.
   */
  test("its timestamp keeps it behind every migration registered before it", () => {
    const registered: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    const ownIndex: number = registered.indexOf(OWN_CLASS_NAME);

    /*
     * Asserted rather than assumed: indexOf returning -1 would silently make
     * the slice below empty and the whole test vacuous. Registration itself
     * has its own test above; this is about the failure MODE of this one.
     */
    expect(ownIndex).toBeGreaterThan(0);

    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const laterThanUs: Array<string> = registered
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);

        return timestamp !== null && timestamp >= ownTimestamp;
      });

    // Named, not counted, so a failure says which migration it would jump.
    expect(laterThanUs).toEqual([]);
  });
});
