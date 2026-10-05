import {
  BACKFILL_FILE_PROJECT_SQL,
  BACKFILL_FILE_UPLOADER_SQL,
  BackfillFileOwners1797900000000,
  FILE_PROJECT_REFERENCES,
  FileProjectReference,
  getFileProjectReferenceSql,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797900000000-BackfillFileOwners";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import FileOwnership, {
  FileReferenceColumn,
} from "../../../../Server/Utils/File/FileOwnership";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../../Models/DatabaseModels/File";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * BackfillFileOwners1797900000000: files learn who uploaded them, and files
 * uploaded before files recorded their project take the project of the
 * records that point at them - when those records are all of one project -
 * so existing status pages, dashboards and notes keep showing their images
 * under the rule that a record shows only its own files.
 *
 * The column was generated against the model and checked against a real
 * database with the schema drift script; the backfill is run against real
 * rows by BackfillFileOwnersPostgres.test.ts. What this pins with a fake
 * QueryRunner: its place, its statements, and that the backfill reads every
 * place a project's record points at a file - taken from the models' own
 * metadata, so none is left out.
 */

interface Statement {
  sql: string;
  parameters: Array<unknown> | undefined;
}

async function statementsFor(
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push({ sql, parameters });
    },
  } as unknown as QueryRunner;

  await new BackfillFileOwners1797900000000()[direction](runner);

  return statements;
}

// Where a model's File relation keeps its file ids, as TypeORM maps it.
function referencesOf(modelType: { new (): BaseModel }): Array<{
  table: string;
  fileIdColumn: string;
  owner?: { table: string; idColumn: string } | undefined;
}> {
  const model: BaseModel = new modelType();

  return FileOwnership.getFileReferenceColumns(model).map(
    (column: FileReferenceColumn) => {
      if (!column.isList) {
        return { table: model.tableName!, fileIdColumn: column.idColumn! };
      }

      const joinTable: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (args: JoinTableMetadataArgs): boolean => {
            return (
              args.target === modelType &&
              args.propertyName === column.relationColumn
            );
          },
        );

      expect(joinTable).toBeDefined();

      return {
        table: joinTable!.name!,
        fileIdColumn: joinTable!.inverseJoinColumns![0]!.name!,
        owner: {
          table: model.tableName!,
          idColumn: joinTable!.joinColumns![0]!.name!,
        },
      };
    },
  );
}

function keyOf(reference: FileProjectReference): string {
  return JSON.stringify({
    table: reference.table,
    fileIdColumn: reference.fileIdColumn,
    owner: reference.owner || null,
  });
}

describe("BackfillFileOwners1797900000000", () => {
  test("is registered once, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === "BackfillFileOwners1797900000000";
      }),
    ).toHaveLength(1);

    const timestamps: Array<number> = names.map((name: string): number => {
      return Number(name.match(/(\d{13})$/)?.[1] || 0);
    });

    const ownIndex: number = names.indexOf("BackfillFileOwners1797900000000");

    expect(
      timestamps.slice(0, ownIndex).every((timestamp: number): boolean => {
        return timestamp < 1797900000000;
      }),
    ).toBe(true);
  });

  test("adds the uploader column, then gives files their project, then their uploader", async () => {
    const statements: Array<Statement> = await statementsFor("up");

    expect(
      statements.map((statement: Statement): string => {
        return statement.sql;
      }),
    ).toEqual([
      `ALTER TABLE "File" ADD "createdByUserId" uuid`,
      BACKFILL_FILE_PROJECT_SQL,
      BACKFILL_FILE_UPLOADER_SQL,
    ]);
  });

  test("the column is the one the model declares", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
        return args.target === File && args.propertyName === "createdByUserId";
      });

    expect(column?.options).toMatchObject({ type: "uuid", nullable: true });
  });

  test("down() drops the column, and keeps the projects files were given", async () => {
    expect(await statementsFor("down")).toEqual([
      {
        sql: `ALTER TABLE "File" DROP COLUMN "createdByUserId"`,
        parameters: undefined,
      },
    ]);
  });

  test("reads every place a project's record points at a file, from the models' metadata", () => {
    const fromModels: Array<string> = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return new modelType().getTenantColumn() === "projectId";
      },
    )
      .flatMap(referencesOf)
      .map(keyOf)
      .sort();

    expect(fromModels.length).toBeGreaterThan(0);
    expect(FILE_PROJECT_REFERENCES.map(keyOf).sort()).toEqual(fromModels);
  });

  test("a list's files take the project of the record the list belongs to", () => {
    expect(
      getFileProjectReferenceSql({
        table: "IncidentPublicNoteFile",
        fileIdColumn: "fileId",
        owner: {
          table: "IncidentPublicNote",
          idColumn: "incidentPublicNoteId",
        },
      }),
    ).toBe(
      `SELECT "link"."fileId" AS "fileId", "owner"."projectId" AS "projectId" FROM "IncidentPublicNoteFile" AS "link" INNER JOIN "IncidentPublicNote" AS "owner" ON "owner"."_id" = "link"."incidentPublicNoteId"`,
    );

    expect(
      getFileProjectReferenceSql({
        table: "StatusPage",
        fileIdColumn: "logoFileId",
      }),
    ).toBe(
      `SELECT "logoFileId" AS "fileId", "projectId" AS "projectId" FROM "StatusPage"`,
    );
  });

  test("a file takes a project only when one project's records point at it, and only if it has none", () => {
    for (const reference of FILE_PROJECT_REFERENCES) {
      expect(BACKFILL_FILE_PROJECT_SQL).toContain(
        getFileProjectReferenceSql(reference),
      );
    }

    expect(BACKFILL_FILE_PROJECT_SQL).toMatch(
      /^UPDATE "File" AS "file" SET "projectId" = /,
    );
    expect(BACKFILL_FILE_PROJECT_SQL).toContain(
      `HAVING COUNT(DISTINCT "reference"."projectId") = 1`,
    );
    expect(BACKFILL_FILE_PROJECT_SQL).toContain(
      `"reference"."projectId" IS NOT NULL`,
    );
    expect(BACKFILL_FILE_PROJECT_SQL).toMatch(
      /AND "file"\."projectId" IS NULL$/,
    );
    // It writes File and nothing else.
    expect(BACKFILL_FILE_PROJECT_SQL.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(BACKFILL_FILE_PROJECT_SQL).not.toMatch(
      /\b(DELETE|INSERT|DROP|ALTER|TRUNCATE)\b/,
    );
  });

  test("a profile picture takes its user when only one user has it, and only if it has no uploader", () => {
    expect(BACKFILL_FILE_UPLOADER_SQL).toMatch(
      /^UPDATE "File" AS "file" SET "createdByUserId" = /,
    );
    expect(BACKFILL_FILE_UPLOADER_SQL).toContain(
      `FROM "User" WHERE "profilePictureId" IS NOT NULL GROUP BY "profilePictureId" HAVING COUNT(*) = 1`,
    );
    expect(BACKFILL_FILE_UPLOADER_SQL).toMatch(
      /AND "file"\."createdByUserId" IS NULL$/,
    );
    expect(BACKFILL_FILE_UPLOADER_SQL).not.toMatch(
      /\b(DELETE|INSERT|DROP|ALTER|TRUNCATE)\b/,
    );
  });
});
