import { AddSessionReplayPageRulesAndReadableEventProperties1809184961000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184961000-AddSessionReplayPageRulesAndReadableEventProperties";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * Three lists on a RUM application's replay policy: the pages a recording
 * may hold (Record only these pages, Never record these pages, #7502) and
 * the readable event properties (#7501). Each a jsonb column, NOT NULL
 * with a constant default of an empty list, which Postgres 11 and later
 * add without rewriting a row - so every application keeps recording
 * every page and masking every property value until someone fills a list
 * in. Fake QueryRunner only - the Schema Drift job migrates a real
 * Postgres and compares it with the model.
 */

const OWN_CLASS_NAME: string =
  "AddSessionReplayPageRulesAndReadableEventProperties1809184961000";

const MIGRATION_FILE_NAME: string =
  "1809184961000-AddSessionReplayPageRulesAndReadableEventProperties.ts";

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

const COLUMNS: ReadonlyArray<string> = [
  "sessionReplayRecordOnlyPages",
  "sessionReplayNeverRecordPages",
  "sessionReplayReadableEventProperties",
];

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

  await new AddSessionReplayPageRulesAndReadableEventProperties1809184961000()[
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

function declaredColumn(name: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === RumApplication && column.propertyName === name;
    },
  );
}

describe("AddSessionReplayPageRulesAndReadableEventProperties migration - identity and registration", () => {
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
      new AddSessionReplayPageRulesAndReadableEventProperties1809184961000()
        .name,
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

  test("no other migration file adds the columns", () => {
    for (const column of COLUMNS) {
      expect({
        column,
        files: fs
          .readdirSync(MIGRATIONS_DIRECTORY)
          .filter((fileName: string): boolean => {
            if (fileName === MIGRATION_FILE_NAME) {
              return false;
            }

            return fs
              .readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), "utf8")
              .includes(`ADD "${column}"`);
          }),
      }).toEqual({ column, files: [] });
    }
  });
});

describe("AddSessionReplayPageRulesAndReadableEventProperties migration - up()", () => {
  test("adds the three columns, and does nothing else", async () => {
    expect(await recordQueries("up")).toEqual(
      COLUMNS.map((column: string): string => {
        return `ALTER TABLE "RumApplication" ADD "${column}" jsonb NOT NULL DEFAULT '[]'`;
      }),
    );
  });

  test("adds each as the model declares it: JSON, not null, an empty list", () => {
    for (const column of COLUMNS) {
      const declared: ColumnMetadataArgs | undefined = declaredColumn(column);

      expect({ column, type: declared?.options.type }).toEqual({
        column,
        type: ColumnType.JSON,
      });
      expect(declared?.options.nullable).toBe(false);
      expect((declared?.options.default as () => string)()).toBe("'[]'");
    }
  });

  test("a constant default: no row is rewritten, and every application keeps what it recorded and masked", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(/ NOT NULL DEFAULT '\[\]'$/);
      expect(statement).not.toMatch(/UPDATE|INDEX|VALIDATE|now\(\)/i);
    }
  });
});

describe("AddSessionReplayPageRulesAndReadableEventProperties migration - down()", () => {
  test("drops the three columns, and nothing else", async () => {
    expect(await recordQueries("down")).toEqual(
      [...COLUMNS].reverse().map((column: string): string => {
        return `ALTER TABLE "RumApplication" DROP COLUMN "${column}"`;
      }),
    );
  });
});
