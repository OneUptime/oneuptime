import { BackfillFileOwners1797900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797900000000-BackfillFileOwners";
import { StartFileUploadsPrivate1798000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798000000000-StartFileUploadsPrivate";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import FileModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * Every upload starts private (FileService), and the column default
 * follows: StartFileUploadsPrivate1798000000000 changes "File"."isPublic"'s
 * default to false, and nothing else. Existing files keep the visibility
 * they have - a public one may be an image a published note or a status
 * page shows, and nothing in a migration can tell which - so it must never
 * write a row.
 */

function run(
  migrate: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: (sql: string): Promise<unknown> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  return migrate(runner).then((): Array<string> => {
    return statements;
  });
}

describe("StartFileUploadsPrivate1798000000000", () => {
  test("up: a row written without isPublic starts private - one catalog change", async () => {
    const migration: StartFileUploadsPrivate1798000000000 =
      new StartFileUploadsPrivate1798000000000();

    expect(
      await run((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT false`]);
  });

  test("down: the default goes back to public", async () => {
    const migration: StartFileUploadsPrivate1798000000000 =
      new StartFileUploadsPrivate1798000000000();

    expect(
      await run((runner: QueryRunner) => {
        return migration.down(runner);
      }),
    ).toEqual([`ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT true`]);
  });

  test("never writes a row: existing files keep their visibility", async () => {
    const migration: StartFileUploadsPrivate1798000000000 =
      new StartFileUploadsPrivate1798000000000();

    const statements: Array<string> = [
      ...(await run((runner: QueryRunner) => {
        return migration.up(runner);
      })),
      ...(await run((runner: QueryRunner) => {
        return migration.down(runner);
      })),
    ];

    for (const statement of statements) {
      expect(statement).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
      expect(statement).not.toMatch(/\bDROP COLUMN\b/i);
    }
  });

  test("matches the model, so the schema drift check has nothing to generate", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.propertyName === "isPublic" &&
            (candidate.target as unknown) === FileModel
          );
        },
      );

    expect(column?.options.default).toBe(false);
    expect(column?.options.nullable).toBe(false);
  });

  test("is registered once, after BackfillFileOwners, under its own name", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const index: number = registered.indexOf(
      StartFileUploadsPrivate1798000000000,
    );

    expect(index).toBeGreaterThan(-1);
    expect(
      registered.filter((migration: unknown): boolean => {
        return migration === StartFileUploadsPrivate1798000000000;
      }),
    ).toHaveLength(1);
    expect(index).toBeGreaterThan(
      registered.indexOf(BackfillFileOwners1797900000000),
    );
    expect(new StartFileUploadsPrivate1798000000000().name).toBe(
      "StartFileUploadsPrivate1798000000000",
    );
  });
});
