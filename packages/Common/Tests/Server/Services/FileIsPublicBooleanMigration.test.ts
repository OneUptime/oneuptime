import { MigrationName1786446545142 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786446545142-MigrationName";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import { getTableColumn } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ColumnType from "../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * "File"."isPublic" backs a `boolean` field but was created as varchar, so
 * every row held the STRING 'true'/'false'. 'false' is truthy in JS, which
 * silently disabled every server-side `!file.isPublic` gate. This migration
 * converts the column to a real boolean.
 *
 * The failure mode these tests exist to prevent is regeneration: TypeORM's
 * own output for this model change is DROP COLUMN + ADD COLUMN, which throws
 * away every stored value and re-defaults the whole table to public — the
 * exact opposite of the fix, and completely silent. So the SQL contract is
 * pinned here rather than left to whatever the generator emits next time.
 */

const MIGRATION_TIMESTAMP: number = 1786446545142;
const DROP_COLUMN_PATTERN: RegExp = /\bDROP COLUMN\b/i;
const TO_BOOLEAN_PATTERN: RegExp = /ALTER COLUMN "isPublic" TYPE boolean/i;
const TO_VARCHAR_PATTERN: RegExp =
  /ALTER COLUMN "isPublic" TYPE character varying/i;
const BACKFILL_PATTERN: RegExp = /^UPDATE "File"/i;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

const makeQueryRunner: () => MakeQueryRunnerResult =
  (): MakeQueryRunnerResult => {
    const statements: Array<string> = [];

    const query: (...args: Array<unknown>) => Promise<unknown> = (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      statements.push(String(args[0]));
      return Promise.resolve(undefined);
    };

    return {
      runner: { query } as unknown as QueryRunner,
      statements,
    };
  };

const indexOfMatch: (statements: Array<string>, pattern: RegExp) => number = (
  statements: Array<string>,
  pattern: RegExp,
): number => {
  return statements.findIndex((statement: string) => {
    return pattern.test(statement);
  });
};

describe("File.isPublic boolean migration - up SQL contract", () => {
  test("never drops the column, which would discard every stored value", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    expect(
      statements.filter((statement: string) => {
        return DROP_COLUMN_PATTERN.test(statement);
      }),
    ).toEqual([]);
  });

  test("converts the column in place to boolean", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    const alterIndex: number = indexOfMatch(
      statements,
      /ALTER TABLE "File" ALTER COLUMN "isPublic" TYPE boolean/i,
    );

    expect(alterIndex).toBeGreaterThanOrEqual(0);
  });

  test("carries the existing strings across with a USING clause", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    const conversion: string | undefined = statements.find(
      (statement: string) => {
        return TO_BOOLEAN_PATTERN.test(statement);
      },
    );

    expect(conversion).toBeDefined();
    expect(conversion).toMatch(/USING/i);
    // The stored values are the strings written by the old varchar column.
    expect(conversion).toMatch(/'true'/);
  });

  test("restores the default so new rows still default to public", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    expect(
      indexOfMatch(statements, /ALTER COLUMN "isPublic" SET DEFAULT true/i),
    ).toBeGreaterThanOrEqual(0);
  });

  /*
   * Probe and AI agent icons are the only readers of the id-based image
   * route, which serves public files only. Both upload through the file
   * picker, which marks uploads private — so without this backfill every
   * icon attached before the migration 404s the moment the gate works.
   */
  test("backfills probe and AI agent icons to public", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    const backfill: string | undefined = statements.find(
      (statement: string) => {
        return BACKFILL_PATTERN.test(statement);
      },
    );

    expect(backfill).toBeDefined();
    expect(backfill).toMatch(/"isPublic" = true/i);
    expect(backfill).toMatch(/FROM "Probe"/i);
    expect(backfill).toMatch(/FROM "AIAgent"/i);
  });

  test("backfills only after the column is a boolean", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().up(runner);

    const conversionIndex: number = indexOfMatch(
      statements,
      /ALTER COLUMN "isPublic" TYPE boolean/i,
    );
    const backfillIndex: number = indexOfMatch(statements, /^UPDATE "File"/i);

    expect(conversionIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(conversionIndex);
  });
});

describe("File.isPublic boolean migration - down SQL contract", () => {
  test("never drops the column", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().down(runner);

    expect(
      statements.filter((statement: string) => {
        return DROP_COLUMN_PATTERN.test(statement);
      }),
    ).toEqual([]);
  });

  test("converts back to varchar preserving true/false as strings", async () => {
    const { runner, statements } = makeQueryRunner();

    await new MigrationName1786446545142().down(runner);

    const conversion: string | undefined = statements.find(
      (statement: string) => {
        return TO_VARCHAR_PATTERN.test(statement);
      },
    );

    expect(conversion).toBeDefined();
    expect(conversion).toMatch(/USING/i);
    expect(conversion).toMatch(/'true'/);
    expect(conversion).toMatch(/'false'/);
  });
});

describe("File.isPublic boolean migration - registration", () => {
  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === MigrationName1786446545142;
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  test("carries one consistent timestamp", () => {
    const migration: MigrationName1786446545142 =
      new MigrationName1786446545142();

    expect(migration.name).toBe(`MigrationName${MIGRATION_TIMESTAMP}`);
    expect(MigrationName1786446545142.name).toBe(
      `MigrationName${MIGRATION_TIMESTAMP}`,
    );
  });
});

/*
 * The migration only helps if the model agrees. If this column ever drifts
 * back to a varchar type the schema-drift job would happily migrate it back
 * and every isPublic gate would silently go dead again.
 */
describe("FileModel.isPublic column type", () => {
  test("is declared as a boolean, not a string type", () => {
    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter((column: ColumnMetadataArgs) => {
        return (
          column.propertyName === "isPublic" &&
          (column.target as unknown) === FileModel
        );
      });

    expect(columns).toHaveLength(1);
    expect(columns[0]?.options.type).toBe(ColumnType.Boolean);
    expect(columns[0]?.options.type).not.toBe(ColumnType.Slug);
  });

  test("declares a Boolean TableColumn so the API layer treats it as one", () => {
    expect(getTableColumn(new FileModel(), "isPublic").type).toBe(
      TableColumnType.Boolean,
    );
  });

  test("has no varchar length, which only applies to string columns", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find((candidate: ColumnMetadataArgs) => {
        return (
          candidate.propertyName === "isPublic" &&
          (candidate.target as unknown) === FileModel
        );
      });

    expect(column?.options.length).toBeUndefined();
  });
});
