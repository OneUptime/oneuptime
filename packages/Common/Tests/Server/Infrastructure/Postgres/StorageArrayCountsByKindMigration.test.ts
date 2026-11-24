import { AddStorageArrayCountsByKind1809187661000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187661000-AddStorageArrayCountsByKind";
import { AddUniqueNameIndexes1809187640010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187640010-AddUniqueNameIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import StorageArray from "../../../../Models/DatabaseModels/StorageArray";
import StorageArrayPlatformRegistry from "../../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../Types/StorageArray/StorageSystem";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * THE MIGRATION BEHIND STORAGEARRAY.COUNTSBYKIND (#11000).
 *
 * The column is generated, and the drift check proves it matches the
 * model. What this pins is what the drift check cannot see: the backfill
 * written by hand - which arrays get counts, from which columns, as which
 * kinds - and where the migration runs.
 */

const recordingQueryRunner: () => {
  queryRunner: QueryRunner;
  statements: Array<string>;
} = (): { queryRunner: QueryRunner; statements: Array<string> } => {
  const statements: Array<string> = [];

  return {
    statements: statements,
    queryRunner: {
      query: async (sql: string): Promise<[]> => {
        statements.push(sql);
        return [];
      },
    } as unknown as QueryRunner,
  };
};

async function upStatements(): Promise<Array<string>> {
  const { queryRunner, statements } = recordingQueryRunner();
  await new AddStorageArrayCountsByKind1809187661000().up(queryRunner);
  return statements;
}

// The kinds a backfill UPDATE writes, in order, with the column each reads.
function backfilledKinds(statement: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const pattern: RegExp = /'([A-Za-z]+)', "([A-Za-z]+)"/g;
  let match: RegExpExecArray | null = pattern.exec(statement);
  while (match) {
    pairs.push([match[1]!, match[2]!]);
    match = pattern.exec(statement);
  }
  return pairs;
}

describe("AddStorageArrayCountsByKind", () => {
  test("adds one nullable jsonb column with no default, so no row is rewritten", async () => {
    const statements: Array<string> = await upStatements();
    expect(statements[0]).toBe(
      `ALTER TABLE "StorageArray" ADD "countsByKind" jsonb`,
    );
  });

  test("then fills it for each platform that has count columns, and nothing else", async () => {
    const statements: Array<string> = await upStatements();
    expect(statements).toHaveLength(3);

    const flashArray: string = statements[1]!;
    const flashBlade: string = statements[2]!;

    expect(flashArray).toContain(
      `WHERE "storageSystem" = '${StorageSystem.PureStorageFlashArray}' AND "countsByKind" IS NULL`,
    );
    expect(flashBlade).toContain(
      `WHERE "storageSystem" = '${StorageSystem.PureStorageFlashBlade}' AND "countsByKind" IS NULL`,
    );

    expect(backfilledKinds(flashArray)).toEqual([
      ["Volume", "volumeCount"],
      ["Host", "hostCount"],
      ["Pod", "podCount"],
      ["Hardware", "hardwareComponentCount"],
    ]);
    expect(backfilledKinds(flashBlade)).toEqual([
      ["FileSystem", "fileSystemCount"],
      ["Bucket", "bucketCount"],
      ["Hardware", "hardwareComponentCount"],
    ]);

    // A NULL column leaves its kind out rather than writing a null count.
    for (const statement of [flashArray, flashBlade]) {
      expect(statement).toContain(
        `SET "countsByKind" = jsonb_strip_nulls(jsonb_build_object(`,
      );
    }
  });

  test("each platform gets only kinds its definition reports, as the ingest writes them", async () => {
    const statements: Array<string> = await upStatements();
    for (const [statement, system] of [
      [statements[1]!, StorageSystem.PureStorageFlashArray],
      [statements[2]!, StorageSystem.PureStorageFlashBlade],
    ] as Array<[string, StorageSystem]>) {
      const kinds: ReadonlyArray<string> =
        StorageArrayPlatformRegistry.getPlatform(system)!.kinds;
      for (const [kind] of backfilledKinds(statement)) {
        expect({ system, kind, reported: kinds.includes(kind) }).toEqual({
          system,
          kind,
          reported: true,
        });
        expect(Object.values(StorageArrayResourceKind)).toContain(kind);
      }
    }
  });

  test("a re-run never overwrites counts the ingest already merged", async () => {
    for (const statement of (await upStatements()).slice(1)) {
      expect(statement).toContain(`AND "countsByKind" IS NULL`);
    }
  });

  test("down() drops the column again", async () => {
    const { queryRunner, statements } = recordingQueryRunner();
    await new AddStorageArrayCountsByKind1809187661000().down(queryRunner);
    expect(statements).toEqual([
      `ALTER TABLE "StorageArray" DROP COLUMN "countsByKind"`,
    ]);
  });

  test("is registered, after the unique name indexes it was numbered after", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return migration.name;
      },
    );
    const own: number = names.indexOf(
      AddStorageArrayCountsByKind1809187661000.name,
    );
    expect(own).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(
      names.indexOf(AddUniqueNameIndexes1809187640010.name),
    );
    expect(new AddStorageArrayCountsByKind1809187661000().name).toBe(
      "AddStorageArrayCountsByKind1809187661000",
    );
  });

  test("matches the model: a nullable jsonb column the server alone writes", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((candidate: ColumnMetadataArgs): boolean => {
        return candidate.target === StorageArray;
      })
      .find((candidate: ColumnMetadataArgs): boolean => {
        return candidate.propertyName === "countsByKind";
      });
    expect(column).toBeDefined();
    expect(column!.options.type).toBe("jsonb");
    expect(column!.options.nullable).toBe(true);
    expect(column!.options.default).toBeUndefined();
  });
});
