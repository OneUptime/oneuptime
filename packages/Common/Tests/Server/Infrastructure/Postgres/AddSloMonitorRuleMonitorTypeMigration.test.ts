import { AddSloMonitorRuleMonitorType1794200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794200000000-AddSloMonitorRuleMonitorType";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of "monitor type" as an SLO monitor rule criterion: one
 * nullable column on a table 1793100000000-SloProductOverhaul created.
 *
 * SloProductOverhaul has shipped, so its CREATE TABLE is never edited to carry
 * the column; that migration's own test accepts a column a later registered
 * migration adds, and this is the later migration's test. It pins that the
 * column is added exactly as the model declares it (a mismatch is a green
 * deploy followed by a red Schema Drift job), that existing rules stay valid
 * without a backfill, and that down() undoes up().
 *
 * Fake QueryRunner only. Applying it to Postgres and re-running the Schema
 * Drift check to "No schema drift." is how it was verified.
 */

const OWN_CLASS_NAME: string = "AddSloMonitorRuleMonitorType1794200000000";

const TABLE_CREATED_BY: string = "SloProductOverhaul1793100000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1794200000000-AddSloMonitorRuleMonitorType.ts",
);

type TimestampOfClassNameFunction = (className: string) => number | null;

// The timestamp TypeORM sorts by and records: the one in the CLASS name.
const timestampOfClassName: TimestampOfClassNameFunction = (
  className: string,
): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddSloMonitorRuleMonitorType1794200000000()[direction](queryRunner);

  return statements;
};

describe("AddSloMonitorRuleMonitorType migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddSloMonitorRuleMonitorType1794200000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered, so the column actually reaches every database", () => {
    expect(registeredNames).toContain(OWN_CLASS_NAME);
  });

  /*
   * Not "is registered last": that claim is falsified by whichever migration
   * lands next, without it going anywhere near this column. What matters is
   * the queue this one must not jump - see SchemaMigrationsOrdering for the
   * registry-wide guard on the newest entry.
   */
  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    // indexOf -1 would make the slice below empty and this test vacuous.
    expect(ownIndex).toBeGreaterThan(0);

    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });

  test("runs after the migration that creates the table it alters", () => {
    expect(registeredNames.indexOf(TABLE_CREATED_BY)).toBeGreaterThan(-1);
    expect(registeredNames.indexOf(TABLE_CREATED_BY)).toBeLessThan(
      registeredNames.indexOf(OWN_CLASS_NAME),
    );
    expect(timestampOfClassName(TABLE_CREATED_BY)!).toBeLessThan(
      timestampOfClassName(OWN_CLASS_NAME)!,
    );
  });
});

describe("AddSloMonitorRuleMonitorType migration - up()", () => {
  /*
   * Nullable with no default and no backfill: every rule saved before this
   * column existed reads as "no type filter", which is what it meant.
   */
  test("adds exactly the nullable monitorType column and nothing else", async () => {
    expect(await recordQueries("up")).toEqual([
      'ALTER TABLE "ServiceLevelObjectiveMonitorRule" ADD "monitorType" character varying(100)',
    ]);
  });

  test("matches the column the model declares, so the Schema Drift job stays green", () => {
    const declared: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (column: ColumnMetadataArgs): boolean => {
          return (
            column.target === ServiceLevelObjectiveMonitorRule &&
            column.propertyName === "monitorType"
          );
        },
      );

    expect(declared).toBeDefined();
    expect(declared!.options.name).toBeUndefined();
    expect(declared!.options.type).toBe(ColumnType.ShortText);
    expect(declared!.options.length).toBe(ColumnLength.ShortText);
    expect(declared!.options.nullable).toBe(true);
    expect(declared!.options.default).toBeUndefined();

    // ColumnType.ShortText is varchar, which Postgres spells character varying.
    expect(ColumnType.ShortText).toBe("varchar");
    expect(ColumnLength.ShortText).toBe(100);
  });
});

describe("AddSloMonitorRuleMonitorType migration - down()", () => {
  test("drops exactly the column up() added", async () => {
    expect(await recordQueries("down")).toEqual([
      'ALTER TABLE "ServiceLevelObjectiveMonitorRule" DROP COLUMN "monitorType"',
    ]);
  });
});
