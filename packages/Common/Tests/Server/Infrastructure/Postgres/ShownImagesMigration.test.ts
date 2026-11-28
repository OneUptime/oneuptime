import { AddShownImages1809187821478 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187821478-AddShownImages";
import {
  BACKFILL_SHOWN_IMAGES_SQL,
  BackfillShownImages1809187821479,
  getShownImageSourceSql,
  SHOWN_IMAGE_SOURCES,
  SHOWN_IMAGE_TOKEN_PATTERN,
  ShownImageSource,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187821479-BackfillShownImages";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { INLINE_IMAGE_TOKEN_PATTERN } from "../../../../Server/Utils/File/PublishedImages";
import { RECORD_SHOWN_IMAGES_SQL } from "../../../../Server/Utils/File/ShownImages";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ShownImage from "../../../../Models/DatabaseModels/ShownImage";
import {
  canShowImages,
  getImageColumns,
} from "../../../../Types/File/MarkdownRecords";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AddShownImages1809187821478 and BackfillShownImages1809187821479
 * (#11478): the table of which records show each inline image, and the
 * records written before it, read into it once.
 *
 * The table was generated against the model and checked against a real
 * database; the backfill is run against real rows, over HTTP, by
 * Tests/Server/API/FileImageRecordAccessPostgres.test.ts. What this pins
 * with a fake QueryRunner: their place, their statements, and that the
 * backfill reads every table whose records can show images - taken from the
 * models, so none is left out - but the feeds and the state and status
 * timelines.
 */

interface Statement {
  sql: string;
  parameters: Array<unknown> | undefined;
}

/*
 * Columns that can show images added to the models after this migration,
 * as `Table.column`: a record written with one is recorded as it is
 * written (ShownImages), so it needs no backfill.
 */
const IMAGE_COLUMNS_ADDED_LATER: Array<string> = [];

// The tables a backfill leaves out: OneUptime writes most of them itself, and they are the largest.
const isFeedOrTimeline: (tableName: string) => boolean = (
  tableName: string,
): boolean => {
  return (
    tableName.endsWith("Feed") ||
    tableName.endsWith("StateTimeline") ||
    tableName.endsWith("StatusTimeline")
  );
};

const MODELS: Array<BaseModel> = AllModelTypes.map(
  (modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  },
);

async function statementsFor(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push({ sql, parameters });
    },
  } as unknown as QueryRunner;

  await migration[direction](runner);

  return statements;
}

const registeredNames: () => Array<string> = (): Array<string> => {
  return SchemaMigrations.map(
    (migration: { new (): MigrationInterface }): string => {
      return migration.name;
    },
  );
};

const timestampOf: (name: string) => number = (name: string): number => {
  return Number(name.match(/(\d{13})$/)?.[1] || 0);
};

describe("AddShownImages1809187821478", () => {
  test("is registered once, after every migration before it, and the backfill right after it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf("AddShownImages1809187821478");

    expect(
      names.filter((name: string): boolean => {
        return name === "AddShownImages1809187821478";
      }),
    ).toHaveLength(1);
    expect(
      names.slice(0, ownIndex).every((name: string): boolean => {
        return timestampOf(name) < 1809187821478;
      }),
    ).toBe(true);
    expect(names[ownIndex + 1]).toBe("BackfillShownImages1809187821479");
  });

  test("makes the table the model declares, its unique key, and its project's cascade", async () => {
    const statements: Array<Statement> = await statementsFor(
      new AddShownImages1809187821478(),
      "up",
    );
    const sql: Array<string> = statements.map((statement: Statement) => {
      return statement.sql;
    });

    expect(sql).toHaveLength(4);
    expect(sql[0]).toContain('CREATE TABLE "ShownImage"');

    for (const column of [
      "projectId",
      "fileId",
      "recordTableName",
      "recordId",
    ]) {
      expect(new ShownImage().getTableColumns().columns).toContain(column);
      expect(sql[0]).toContain(`"${column}"`);
    }

    expect(sql[0]).toContain('"fileId" uuid NOT NULL');
    expect(sql[0]).toContain('"recordId" uuid NOT NULL');
    expect(sql[0]).toContain(
      '"recordTableName" character varying(100) NOT NULL',
    );
    expect(sql[1]).toBe(
      'CREATE INDEX "IDX_ad84889ec971f228dc046e8070" ON "ShownImage" ("projectId") ',
    );
    expect(sql[2]).toBe(
      'CREATE UNIQUE INDEX "IDX_196cb8103e0203f8143122afd4" ON "ShownImage" ("fileId", "recordTableName", "recordId") ',
    );
    expect(sql[3]).toContain('REFERENCES "Project"("_id") ON DELETE CASCADE');
  });

  test("names no file relation: the table is none of the records FileOwnership holds to their owner", async () => {
    const statements: Array<Statement> = await statementsFor(
      new AddShownImages1809187821478(),
      "up",
    );

    expect(
      statements.some((statement: Statement): boolean => {
        return statement.sql.includes('REFERENCES "File"');
      }),
    ).toBe(false);
  });

  test("down() drops what up() made, in reverse", async () => {
    const statements: Array<Statement> = await statementsFor(
      new AddShownImages1809187821478(),
      "down",
    );

    expect(
      statements.map((statement: Statement): string => {
        return statement.sql;
      }),
    ).toEqual([
      'ALTER TABLE "ShownImage" DROP CONSTRAINT "FK_ad84889ec971f228dc046e80700"',
      'DROP INDEX "public"."IDX_196cb8103e0203f8143122afd4"',
      'DROP INDEX "public"."IDX_ad84889ec971f228dc046e8070"',
      'DROP TABLE "ShownImage"',
    ]);
  });
});

describe("BackfillShownImages1809187821479", () => {
  test("is registered once, after every migration before it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf("BackfillShownImages1809187821479");

    expect(
      names.filter((name: string): boolean => {
        return name === "BackfillShownImages1809187821479";
      }),
    ).toHaveLength(1);
    expect(
      names.slice(0, ownIndex).every((name: string): boolean => {
        return timestampOf(name) < 1809187821479;
      }),
    ).toBe(true);
  });

  test("up() runs the backfill, once; down() removes every row", async () => {
    expect(
      await statementsFor(new BackfillShownImages1809187821479(), "up"),
    ).toEqual([{ sql: BACKFILL_SHOWN_IMAGES_SQL, parameters: undefined }]);
    expect(
      await statementsFor(new BackfillShownImages1809187821479(), "down"),
    ).toEqual([{ sql: 'DELETE FROM "ShownImage"', parameters: undefined }]);
  });

  test("reads every table whose records can show images, every column of it, but the feeds and the timelines", () => {
    const listed: Set<string> = new Set<string>();

    for (const source of SHOWN_IMAGE_SOURCES) {
      for (const column of source.columns) {
        listed.add(`${source.table}.${column}`);
      }
    }

    const missing: Array<string> = [];

    for (const model of MODELS) {
      if (!canShowImages(model) || isFeedOrTimeline(model.tableName!)) {
        continue;
      }

      for (const column of getImageColumns(model)) {
        const key: string = `${model.tableName}.${column}`;

        if (!listed.has(key) && !IMAGE_COLUMNS_ADDED_LATER.includes(key)) {
          missing.push(key);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("leaves out every feed and every state and status timeline", () => {
    for (const source of SHOWN_IMAGE_SOURCES) {
      expect([source.table, isFeedOrTimeline(source.table)]).toEqual([
        source.table,
        false,
      ]);
    }

    // There are such tables, and they can show images: left out on purpose.
    expect(
      MODELS.filter((model: BaseModel): boolean => {
        return canShowImages(model) && isFeedOrTimeline(model.tableName!);
      }).length,
    ).toBeGreaterThan(20);
  });

  test("every table and column it names is a model's, one that can show images there, with its project column", () => {
    for (const source of SHOWN_IMAGE_SOURCES) {
      const model: BaseModel | undefined = MODELS.find(
        (candidate: BaseModel): boolean => {
          return candidate.tableName === source.table;
        },
      );

      expect([source.table, Boolean(model && canShowImages(model))]).toEqual([
        source.table,
        true,
      ]);
      expect([source.table, source.tenantColumn || "projectId"]).toEqual([
        source.table,
        model!.getTenantColumn(),
      ]);

      for (const column of source.columns) {
        expect([
          source.table,
          column,
          getImageColumns(model!).includes(column),
        ]).toEqual([source.table, column, true]);
      }
    }
  });

  test("each table once", () => {
    const tables: Array<string> = SHOWN_IMAGE_SOURCES.map(
      (source: ShownImageSource): string => {
        return source.table;
      },
    );

    expect(new Set(tables).size).toBe(tables.length);
  });

  test("reads an image's address as every other reader does", () => {
    expect(SHOWN_IMAGE_TOKEN_PATTERN).toBe(INLINE_IMAGE_TOKEN_PATTERN);
  });

  test("each table is read once, its columns side by side, only the rows that hold an address and are not deleted", () => {
    const sql: string = getShownImageSourceSql({
      table: "Incident",
      columns: ["description", "customFields"],
    });

    expect(sql).toBe(
      `SELECT "projectId" AS "projectId", 'Incident'::text AS "recordTableName", "_id" AS "recordId", (regexp_matches(concat_ws(' ', "description"::text, "customFields"::text), '${INLINE_IMAGE_TOKEN_PATTERN}', 'g'))[1] AS "token" FROM "Incident" WHERE "deletedAt" IS NULL AND concat_ws(' ', "description"::text, "customFields"::text) LIKE '%/file/image/access-token/%'`,
    );
  });

  test("a project's own record names its project by its id", () => {
    expect(
      getShownImageSourceSql({
        table: "Project",
        columns: ["aiContext"],
        tenantColumn: "_id",
      }),
    ).toContain(`SELECT "_id" AS "projectId", 'Project'::text`);
  });

  test("matches each address to a file of the record's own project, not deleted, and writes a row once", () => {
    expect(BACKFILL_SHOWN_IMAGES_SQL).toContain(
      'INNER JOIN "File" AS "file" ON "file"."imageAccessToken" = "shown"."token" AND "file"."projectId" = "shown"."projectId" AND "file"."deletedAt" IS NULL',
    );
    expect(BACKFILL_SHOWN_IMAGES_SQL).toContain(
      'ON CONFLICT ("fileId", "recordTableName", "recordId") DO NOTHING',
    );
    expect(
      BACKFILL_SHOWN_IMAGES_SQL.startsWith('INSERT INTO "ShownImage"'),
    ).toBe(true);

    for (const source of SHOWN_IMAGE_SOURCES) {
      expect(BACKFILL_SHOWN_IMAGES_SQL).toContain(
        `FROM "${source.table}" WHERE`,
      );
    }
  });

  test("writes rows by the same key DatabaseService's writes do", () => {
    expect(RECORD_SHOWN_IMAGES_SQL).toContain(
      'ON CONFLICT ("fileId", "recordTableName", "recordId") DO NOTHING',
    );
    expect(RECORD_SHOWN_IMAGES_SQL).toContain(
      '"file"."projectId" = "record"."projectId"',
    );
    expect(RECORD_SHOWN_IMAGES_SQL).toContain('"file"."deletedAt" IS NULL');
  });
});
