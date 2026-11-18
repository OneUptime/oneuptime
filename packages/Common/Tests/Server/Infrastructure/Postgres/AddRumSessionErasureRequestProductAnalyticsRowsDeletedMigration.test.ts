import { AddRumSessionErasureRequestProductAnalyticsRowsDeleted1809183906628 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183906628-AddRumSessionErasureRequestProductAnalyticsRowsDeleted";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RumSessionErasureRequest from "../../../../Models/DatabaseModels/RumSessionErasureRequest";
import ColumnType from "../../../../Types/Database/ColumnType";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A session replay erasure request says how many product analytics rows it
 * removed (#6628): one bigint column on RumSessionErasureRequest, NOT NULL
 * with a constant default of 0, which Postgres 11 and later add without
 * rewriting a row. A bigint because an application's erasure can remove
 * more events than an integer holds, and an overflowing counter would fail
 * the request it reports on. Fake QueryRunner only - the Schema Drift job
 * migrates a real Postgres and compares it with the model.
 */

const OWN_CLASS_NAME: string =
  "AddRumSessionErasureRequestProductAnalyticsRowsDeleted1809183906628";

const MIGRATION_FILE_NAME: string =
  "1809183906628-AddRumSessionErasureRequestProductAnalyticsRowsDeleted.ts";

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

const ADD_COLUMN: string = `ALTER TABLE "RumSessionErasureRequest" ADD "productAnalyticsRowsDeleted" bigint NOT NULL DEFAULT '0'`;

const DROP_COLUMN: string = `ALTER TABLE "RumSessionErasureRequest" DROP COLUMN "productAnalyticsRowsDeleted"`;

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

  await new AddRumSessionErasureRequestProductAnalyticsRowsDeleted1809183906628()[
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
        column.target === RumSessionErasureRequest &&
        column.propertyName === "productAnalyticsRowsDeleted"
      );
    },
  );

describe("AddRumSessionErasureRequestProductAnalyticsRowsDeleted migration - identity and registration", () => {
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
      new AddRumSessionErasureRequestProductAnalyticsRowsDeleted1809183906628()
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
      "AddSessionReplay1785417351021",
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
            .includes(`ADD "productAnalyticsRowsDeleted"`);
        }),
    ).toEqual([]);
  });
});

describe("AddRumSessionErasureRequestProductAnalyticsRowsDeleted migration - up()", () => {
  test("adds the column, and does nothing else", async () => {
    expect(await recordQueries("up")).toEqual([ADD_COLUMN]);
  });

  test("adds it as the model declares it: bigint, not null, 0", () => {
    expect(declaredColumn?.options.type).toBe(ColumnType.BigPositiveNumber);
    expect(ColumnType.BigPositiveNumber).toBe("bigint");
    expect(declaredColumn?.options.nullable).toBe(false);
    expect(declaredColumn?.options.default).toBe(0);
  });

  test("a constant default: no row is rewritten, read or locked for long, and a request that finished before reads 0", async () => {
    const [statement] = await recordQueries("up");

    expect(statement).toMatch(/ NOT NULL DEFAULT '0'$/);
    expect(statement).not.toMatch(/UPDATE|INDEX|VALIDATE|now\(\)/i);
  });

  test("the worker writes it as root, and no requester can set it", () => {
    const model: RumSessionErasureRequest = new RumSessionErasureRequest();
    const column: { type: TableColumnType } | null =
      model.getTableColumnMetadata("productAnalyticsRowsDeleted") as {
        type: TableColumnType;
      } | null;

    expect(column?.type).toBe(TableColumnType.BigPositiveNumber);
    expect(
      model.getColumnAccessControlForAllColumns()["productAnalyticsRowsDeleted"]
        ?.create || [],
    ).toEqual([]);
    expect(
      model.getColumnAccessControlForAllColumns()["productAnalyticsRowsDeleted"]
        ?.update || [],
    ).toEqual([]);
  });
});

describe("AddRumSessionErasureRequestProductAnalyticsRowsDeleted migration - down()", () => {
  test("drops the column, and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([DROP_COLUMN]);
  });
});
