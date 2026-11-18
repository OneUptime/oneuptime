import { AddRumApplicationProductAnalyticsRetention1809183906630 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183906630-AddRumApplicationProductAnalyticsRetention";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ColumnType from "../../../../Types/Database/ColumnType";
import { DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS } from "../../../../Types/Rum/ProductAnalytics";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * How long product analytics keeps a RUM application's numbers and events
 * (#6626): one integer column on RumApplication, NOT NULL with a constant
 * default of 13 - the 13 months every application kept before it could
 * choose - which Postgres 11 and later add without rewriting a row. So
 * nothing an application already keeps changes until someone chooses.
 * Fake QueryRunner only - the Schema Drift job migrates a real Postgres and
 * compares it with the model.
 */

const OWN_CLASS_NAME: string =
  "AddRumApplicationProductAnalyticsRetention1809183906630";

const MIGRATION_FILE_NAME: string =
  "1809183906630-AddRumApplicationProductAnalyticsRetention.ts";

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

const ADD_COLUMN: string = `ALTER TABLE "RumApplication" ADD "productAnalyticsRetentionInMonths" integer NOT NULL DEFAULT '13'`;

const DROP_COLUMN: string = `ALTER TABLE "RumApplication" DROP COLUMN "productAnalyticsRetentionInMonths"`;

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new AddRumApplicationProductAnalyticsRetention1809183906630()[
    direction
  ](queryRunner);

  return statements;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type TimestampOfFunction = (className: string) => number | null;

const timestampOf: TimestampOfFunction = (className: string): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

const declaredColumn: ColumnMetadataArgs | undefined =
  getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === RumApplication &&
        column.propertyName === "productAnalyticsRetentionInMonths"
      );
    },
  );

describe("AddRumApplicationProductAnalyticsRetention migration - identity and registration", () => {
  test("lives at its stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, MIGRATION_FILE_NAME),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    // However prettier wraps it.
    expect(source).toMatch(
      new RegExp(`public name: string =\\s*"${OWN_CLASS_NAME}";`),
    );
    expect(
      new AddRumApplicationProductAnalyticsRetention1809183906630().name,
    ).toBe(OWN_CLASS_NAME);
  });

  test("is registered exactly once", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after every migration registered before it, and before every one registered after it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOf(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);

    expect(
      registeredNames.slice(ownIndex + 1).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp === null || timestamp <= ownTimestamp;
      }),
    ).toEqual([]);

    // After the migration that made the table.
    const tableIndex: number = registeredNames.indexOf(
      "AddRumApplicationTables1780936579718",
    );
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(ownIndex).toBeGreaterThan(tableIndex);
  });

  test("no other migration file adds the column", () => {
    expect(
      fs
        .readdirSync(MIGRATIONS_DIRECTORY)
        .filter((fileName: string): boolean => {
          if (fileName === MIGRATION_FILE_NAME) {
            return false;
          }

          return fs
            .readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), "utf8")
            .includes(`ADD "productAnalyticsRetentionInMonths"`);
        }),
    ).toEqual([]);
  });
});

describe("AddRumApplicationProductAnalyticsRetention migration - up()", () => {
  test("adds the column, and does nothing else", async () => {
    expect(await recordQueries("up")).toEqual([ADD_COLUMN]);
  });

  test("adds it as the model declares it: integer, not null, 13", () => {
    expect(declaredColumn?.options.type).toBe(ColumnType.Number);
    expect(ColumnType.Number).toBe("integer");
    expect(declaredColumn?.options.nullable).toBe(false);
    expect(declaredColumn?.options.default).toBe(
      DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS,
    );
    expect(DEFAULT_PRODUCT_ANALYTICS_RETENTION_MONTHS).toBe(13);
  });

  test("a constant default: no row is rewritten, and every application keeps the 13 months it kept", async () => {
    const [statement] = await recordQueries("up");

    expect(statement).toMatch(/ NOT NULL DEFAULT '13'$/);
    expect(statement).not.toMatch(/UPDATE|INDEX|VALIDATE|now\(\)/i);
  });
});

describe("AddRumApplicationProductAnalyticsRetention migration - down()", () => {
  test("drops the column, and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([DROP_COLUMN]);
  });
});
