import {
  BACKFILL_FILE_PROJECT_SQL,
  BACKFILL_FILE_UPLOADER_SQL,
  BackfillFileOwners1797900000000,
  FILE_PROJECT_REFERENCES,
  FileProjectReference,
  INLINE_IMAGE_TOKEN_PATTERN,
  MARKDOWN_IMAGE_REFERENCES,
  MarkdownImageReference,
  getFileProjectReferenceSql,
  getMarkdownImageReferenceSql,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797900000000-BackfillFileOwners";
import { extractImageAccessTokens } from "../../../../Server/Utils/InlineImageAccessTokenSync";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import FileOwnership, {
  FileReferenceColumn,
} from "../../../../Server/Utils/File/FileOwnership";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../../Models/DatabaseModels/File";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
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

/*
 * File references and markdown columns added to the models after this
 * migration, as `{"table","fileIdColumn","owner"}` keys / `Table.column`:
 * they need no backfill, as their files are uploaded with their project.
 */
const FILE_REFERENCES_ADDED_LATER: Array<string> = [
  // A packet capture's pcap file is stored with the capture's project.
  '{"table":"PacketCapture","fileIdColumn":"fileId","owner":null}',
];
const MARKDOWN_COLUMNS_ADDED_LATER: Array<string> = [];

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

  /*
   * A File column added after this migration needs no backfill - its files
   * are uploaded with their project - so it goes in
   * FILE_REFERENCES_ADDED_LATER.
   */
  test("reads every place a project's record points at a file, from the models' metadata", () => {
    const fromModels: Array<string> = AllModelTypes.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return new modelType().getTenantColumn() === "projectId";
      },
    )
      .flatMap(referencesOf)
      .map(keyOf)
      .sort();

    const listed: Array<string> = FILE_PROJECT_REFERENCES.map(keyOf).sort();

    expect(fromModels.length).toBeGreaterThan(0);

    // Each place it reads is one the models have.
    for (const reference of listed) {
      expect(fromModels).toContain(reference);
    }

    expect(
      fromModels.filter((reference: string): boolean => {
        return !FILE_REFERENCES_ADDED_LATER.includes(reference);
      }),
    ).toEqual(listed);
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

  /*
   * Every markdown column people write in, and every custom fields column,
   * of every project's model - from the models' metadata. The feeds and the
   * state timelines are left out (OneUptime writes them). A column added
   * after this migration needs no backfill - its images are uploaded with
   * their project - so it goes in MARKDOWN_COLUMNS_ADDED_LATER.
   */
  test("reads the inline images of every markdown column people write in", () => {
    const listed: Array<string> = MARKDOWN_IMAGE_REFERENCES.flatMap(
      (reference: MarkdownImageReference): Array<string> => {
        return reference.columns.map((column: string): string => {
          return `${reference.table}.${column}`;
        });
      },
    ).sort();

    const fromModels: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();
      const table: string = model.tableName || "";

      if (
        model.getTenantColumn() !== "projectId" ||
        table.endsWith("Feed") ||
        table.endsWith("Timeline")
      ) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata | undefined =
          model.getTableColumnMetadata(column);

        if (
          metadata?.type === TableColumnType.Markdown ||
          (column === "customFields" && metadata?.type === TableColumnType.JSON)
        ) {
          fromModels.push(`${table}.${column}`);
        }
      }
    }

    // Each column it reads is one the models have.
    for (const column of listed) {
      expect(fromModels).toContain(column);
    }

    expect(
      fromModels
        .filter((column: string): boolean => {
          return !MARKDOWN_COLUMNS_ADDED_LATER.includes(column);
        })
        .sort(),
    ).toEqual(listed);

    for (const reference of MARKDOWN_IMAGE_REFERENCES) {
      expect(BACKFILL_FILE_PROJECT_SQL).toContain(
        getMarkdownImageReferenceSql(reference),
      );
    }
  });

  test("reads a table's markdown once, its columns side by side, with its record's project", () => {
    expect(
      getMarkdownImageReferenceSql({
        table: "StatusPage",
        columns: ["overviewPageDescription", "customFields"],
      }),
    ).toBe(
      `SELECT "file"."_id" AS "fileId", "markdown"."projectId" AS "projectId" FROM (SELECT "projectId", (regexp_matches(concat_ws(' ', "overviewPageDescription"::text, "customFields"::text), '/file/image/access-token/([a-fA-F0-9]+)', 'g'))[1] AS "token" FROM "StatusPage" WHERE concat_ws(' ', "overviewPageDescription"::text, "customFields"::text) LIKE '%/file/image/access-token/%') AS "markdown" INNER JOIN "File" AS "file" ON "file"."imageAccessToken" = "markdown"."token"`,
    );
  });

  test("finds the tokens the inline image sync finds", () => {
    const markdown: string = [
      "![a](https://oneuptime.example/file/image/access-token/abc123DEF)",
      "and ![b](https://oneuptime.example/file/image/access-token/0f0f0f)",
      "but not ![c](https://oneuptime.example/file/image/abc999)",
    ].join(" ");

    const found: Array<string> = [];

    for (const match of markdown.matchAll(
      new RegExp(INLINE_IMAGE_TOKEN_PATTERN, "g"),
    )) {
      found.push(match[1]!);
    }

    expect(found).toEqual(extractImageAccessTokens(markdown));
    expect(found).toEqual(["abc123DEF", "0f0f0f"]);
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
