import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddProjectRequireUniqueNames1809187550000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187550000-AddProjectRequireUniqueNames";
import { AddUniqueNameIndexes1809187560000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187560000-AddUniqueNameIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../../Types/Database/UniqueName";
import { getUniqueNameWhenRequiredColumn } from "../../../../Types/Database/UniqueNameWhenRequired";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * THE MIGRATIONS BEHIND REQUIRE UNIQUE NAMES (#10761).
 *
 *   1809187550000-AddProjectRequireUniqueNames: Project
 *     "requireUniqueNames", NOT NULL DEFAULT false - every project that
 *     exists keeps letting names repeat after an upgrade; new projects are
 *     switched on by ProjectService, never by this default.
 *   1809187560000-AddUniqueNameIndexes: for every kind the setting holds,
 *     an index on its project and its name as Postgres reads it - the
 *     expression findWithSameName compares - of the records in service,
 *     built online, outside a transaction.
 *
 * The column is generated, and the drift check proves it matches the
 * model; the indexes are written by hand. What this pins is what neither
 * could catch: the default existing projects get, every index's exact
 * expression - its white space pattern is a copy, frozen as it was when the
 * migration ran, so a change to NAME_WHITE_SPACE_RUN_PATTERN fails here
 * until a migration builds the indexes again - and the order they run in.
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

// The kinds the setting holds, with the column each is known by.
const HELD: Array<{ tableName: string; column: string }> = AllModelTypes.map(
  (modelType: { new (): BaseModel }) => {
    const model: BaseModel = new modelType();
    const column: string | null = getUniqueNameWhenRequiredColumn(model);

    return column ? { tableName: model.tableName || "", column: column } : null;
  },
).filter((held: { tableName: string; column: string } | null) => {
  return held !== null;
}) as Array<{ tableName: string; column: string }>;

const expectedIndex: (held: { tableName: string; column: string }) => string = (
  held: { tableName: string; column: string },
): string => {
  return `CREATE INDEX "IDX_${held.tableName.toUpperCase()}_PROJECT_NAME_KEY" ON "${held.tableName}" ("projectId", LOWER(BTRIM(REGEXP_REPLACE("${held.column}", '${NAME_WHITE_SPACE_RUN_PATTERN}', ' ', 'g')))) WHERE "deletedAt" IS NULL`;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Project requireUniqueNames", () => {
  test("is added off for every project that exists, without rewriting a row", async () => {
    const { queryRunner, statements } = recordingQueryRunner();

    await new AddProjectRequireUniqueNames1809187550000().up(queryRunner);

    expect(statements).toEqual([
      `ALTER TABLE "Project" ADD "requireUniqueNames" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("is taken away again by down()", async () => {
    const { queryRunner, statements } = recordingQueryRunner();

    await new AddProjectRequireUniqueNames1809187550000().down(queryRunner);

    expect(statements).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "requireUniqueNames"`,
    ]);
  });

  test("is what the model declares: a switch, NOT NULL, off by default", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
        return (
          args.target === Project && args.propertyName === "requireUniqueNames"
        );
      });

    expect(column?.options.nullable).toBe(false);
    expect(column?.options.default).toBe(false);

    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      new Project().getTableColumnMetadata("requireUniqueNames");

    expect(metadata?.type).toBe(TableColumnType.Boolean);
    expect(metadata?.defaultValue).toBe(false);
  });
});

describe("the indexes of the names a project requires unique", () => {
  test("build one index per kind the setting holds, online, each exactly the expression the lookup reads", async () => {
    const built: Array<string> = [];

    getJestSpyOn(OnlineDdl, "createIndex").mockImplementation((async (
      _queryRunner: QueryRunner,
      statement: string,
    ): Promise<void> => {
      built.push(statement);
    }) as never);

    const { queryRunner, statements } = recordingQueryRunner();

    await new AddUniqueNameIndexes1809187560000().up(queryRunner);

    // Nothing but the online builds.
    expect(statements).toEqual([]);
    expect(HELD.length).toBeGreaterThan(40);
    expect([...built].sort()).toEqual(HELD.map(expectedIndex).sort());
  });

  test("hold the white space pattern as the lookup sends it today", async () => {
    const built: Array<string> = [];

    getJestSpyOn(OnlineDdl, "createIndex").mockImplementation((async (
      _queryRunner: QueryRunner,
      statement: string,
    ): Promise<void> => {
      built.push(statement);
    }) as never);

    await new AddUniqueNameIndexes1809187560000().up(
      recordingQueryRunner().queryRunner,
    );

    for (const statement of built) {
      expect(statement).toContain(`'${NAME_WHITE_SPACE_RUN_PATTERN}'`);
    }
  });

  test("run outside a transaction, as an online build must", () => {
    expect(new AddUniqueNameIndexes1809187560000().transaction).toBe(false);
  });

  test("are dropped again by down(), online where they can be, last built first", async () => {
    const built: Array<string> = [];
    const dropped: Array<string> = [];

    getJestSpyOn(OnlineDdl, "createIndex").mockImplementation((async (
      _queryRunner: QueryRunner,
      statement: string,
    ): Promise<void> => {
      built.push(statement);
    }) as never);

    getJestSpyOn(OnlineDdl, "dropIndex").mockImplementation((async (
      _queryRunner: QueryRunner,
      statement: string,
    ): Promise<void> => {
      dropped.push(statement);
    }) as never);

    const migration: AddUniqueNameIndexes1809187560000 =
      new AddUniqueNameIndexes1809187560000();

    await migration.up(recordingQueryRunner().queryRunner);
    await migration.down(recordingQueryRunner().queryRunner);

    expect(dropped).toEqual(
      built
        .map((statement: string): string => {
          const name: string = statement.match(/CREATE INDEX "([^"]+)"/)![1]!;
          return `DROP INDEX "public"."${name}"`;
        })
        .reverse(),
    );
  });
});

describe("the order they run in", () => {
  test("the column, then its indexes, each registered once, after every migration before them", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return migration.name;
      },
    );

    const column: number = names.indexOf(
      AddProjectRequireUniqueNames1809187550000.name,
    );
    const indexes: number = names.indexOf(
      AddUniqueNameIndexes1809187560000.name,
    );

    expect(column).toBeGreaterThan(-1);
    expect(indexes).toBe(column + 1);
    expect(
      names.filter((name: string): boolean => {
        return (
          name === AddProjectRequireUniqueNames1809187550000.name ||
          name === AddUniqueNameIndexes1809187560000.name
        );
      }),
    ).toHaveLength(2);

    // Numbered after every migration registered before them.
    const numberOf: (name: string) => number = (name: string): number => {
      return Number(name.match(/(\d{13})$/)?.[1] || 0);
    };

    for (const name of names.slice(0, column)) {
      expect({ name, before: numberOf(name) < 1809187550000 }).toEqual({
        name,
        before: true,
      });
    }

    expect(new AddProjectRequireUniqueNames1809187550000().name).toBe(
      "AddProjectRequireUniqueNames1809187550000",
    );
    expect(new AddUniqueNameIndexes1809187560000().name).toBe(
      "AddUniqueNameIndexes1809187560000",
    );
  });
});
