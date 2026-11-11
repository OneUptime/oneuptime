import { AddRumApplicationProductAnalyticsEvents1809096444000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809096444000-AddRumApplicationProductAnalyticsEvents";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The Postgres half of product analytics events (#6444, part two): two
 * RumApplication columns.
 *
 *  - isProductAnalyticsEnabled: off for every application that exists, so
 *    none starts sending a new stream of data until an admin turns it on.
 *    RumApplicationService turns it on for an application created from
 *    now on (RumApplicationProductAnalyticsSettings.test.ts).
 *  - productAnalyticsUserPropertyKeys: the identify() traits events may
 *    carry, an allow-list that starts empty.
 *
 * Both NOT NULL with a constant default, which Postgres 11 and later add
 * without rewriting a row. Fake QueryRunner only - the Schema Drift job
 * migrates a real Postgres and compares it with the model.
 */

const OWN_CLASS_NAME: string =
  "AddRumApplicationProductAnalyticsEvents1809096444000";

const MIGRATION_FILE_NAME: string =
  "1809096444000-AddRumApplicationProductAnalyticsEvents.ts";

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

const ADD_SWITCH: string = `ALTER TABLE "RumApplication" ADD "isProductAnalyticsEnabled" boolean NOT NULL DEFAULT false`;

const ADD_TRAIT_KEYS: string = `ALTER TABLE "RumApplication" ADD "productAnalyticsUserPropertyKeys" jsonb NOT NULL DEFAULT '[]'`;

const DROP_TRAIT_KEYS: string = `ALTER TABLE "RumApplication" DROP COLUMN "productAnalyticsUserPropertyKeys"`;

const DROP_SWITCH: string = `ALTER TABLE "RumApplication" DROP COLUMN "isProductAnalyticsEnabled"`;

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

  await new AddRumApplicationProductAnalyticsEvents1809096444000()[direction](
    queryRunner,
  );

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

type DeclaredColumnFunction = (
  propertyName: string,
) => ColumnMetadataArgs | undefined;

const declaredColumn: DeclaredColumnFunction = (
  propertyName: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === RumApplication && column.propertyName === propertyName
      );
    },
  );
};

describe("AddRumApplicationProductAnalyticsEvents migration - identity and registration", () => {
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
      new AddRumApplicationProductAnalyticsEvents1809096444000().name,
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

    // After the migration that made the table, which every column needs.
    const tableIndex: number = registeredNames.indexOf(
      "AddRumApplicationTables1780936579718",
    );
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(ownIndex).toBeGreaterThan(tableIndex);
  });

  test("no other migration file adds either column", () => {
    expect(
      fs
        .readdirSync(MIGRATIONS_DIRECTORY)
        .filter((fileName: string): boolean => {
          if (fileName === MIGRATION_FILE_NAME) {
            return false;
          }

          const source: string = fs.readFileSync(
            path.join(MIGRATIONS_DIRECTORY, fileName),
            "utf8",
          );

          return (
            source.includes(`ADD "isProductAnalyticsEnabled"`) ||
            source.includes(`ADD "productAnalyticsUserPropertyKeys"`)
          );
        }),
    ).toEqual([]);
  });
});

describe("AddRumApplicationProductAnalyticsEvents migration - up()", () => {
  test("adds the two columns, and does nothing else", async () => {
    expect(await recordQueries("up")).toEqual([ADD_SWITCH, ADD_TRAIT_KEYS]);
  });

  test("adds the switch as the model declares it: boolean, not null, off", () => {
    const declared: ColumnMetadataArgs | undefined = declaredColumn(
      "isProductAnalyticsEnabled",
    );

    expect(declared?.options.type).toBe(ColumnType.Boolean);
    expect(ColumnType.Boolean).toBe("boolean");
    expect(declared?.options.nullable).toBe(false);
    expect(declared?.options.default).toBe(false);
  });

  test("adds the trait keys as the model declares them: jsonb, not null, an empty list", () => {
    const declared: ColumnMetadataArgs | undefined = declaredColumn(
      "productAnalyticsUserPropertyKeys",
    );

    expect(declared?.options.type).toBe(ColumnType.JSON);
    expect(ColumnType.JSON).toBe("jsonb");
    expect(declared?.options.nullable).toBe(false);

    const defaultValue: unknown = declared?.options.default;
    expect(typeof defaultValue).toBe("function");
    expect((defaultValue as () => string)()).toBe("'[]'");
  });

  test("every column comes with a constant default: no row is rewritten, read or locked for long", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(
        /^ALTER TABLE "RumApplication" ADD "[A-Za-z]+" (boolean|jsonb) NOT NULL DEFAULT (false|'\[\]')$/,
      );
      expect(statement).not.toMatch(/UPDATE|INDEX|VALIDATE|now\(\)/i);
    }
  });

  test("existing applications start with events off", async () => {
    // What every row that is there when the migration runs reads back.
    const addsTheSwitch: Array<string> = (await recordQueries("up")).filter(
      (statement: string): boolean => {
        return statement.includes(`ADD "isProductAnalyticsEnabled"`);
      },
    );

    expect(addsTheSwitch).toHaveLength(1);
    expect(addsTheSwitch[0]).toMatch(/ DEFAULT false$/);
  });
});

describe("AddRumApplicationProductAnalyticsEvents migration - down()", () => {
  test("drops the two columns, the last one added first, and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([DROP_TRAIT_KEYS, DROP_SWITCH]);
  });
});
