import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddServerEmailLog1809183300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183300000-AddServerEmailLog";
import ServerEmailLog from "../../../../Models/DatabaseModels/ServerEmailLog";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind the server's own email log (#6878): one new table,
 * ServerEmailLog, with the two indexes its list sorts by - every email
 * newest first, and the failed ones newest first.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. A new table (Docs/migrations/README.md): it is empty while
 * its indexes are built, so they are built in the migration as generated;
 * no other table is touched, no foreign key ties a row to a project (a
 * row outlives its project for the log's retention, and no project reads
 * it by its key), and a server of the release before never reads it. The
 * migration has to be registered, named for its class and ordered after
 * every migration before it, or it never runs; the schema drift check
 * holds its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809183300000";
const MIGRATION_BASE_NAME: string = "AddServerEmailLog";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddBackupScriptLastRun1809183200000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddServerEmailLog1809183300000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddServerEmailLog1809183300000", () => {
  test("creates the ServerEmailLog table, then its two indexes", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE TABLE "ServerEmailLog" \(/);
    expect(statements[1]).toBe(
      `CREATE INDEX "IDX_c96f1586cc4957746bae4011e6" ON "ServerEmailLog" ("status", "createdAt") `,
    );
    expect(statements[2]).toBe(
      `CREATE INDEX "IDX_0d2976fa945e500101c4d5ed27" ON "ServerEmailLog" ("createdAt") `,
    );
  });

  test("its columns: to whom, the subject, the template, how it went, the answer and the project - never a body", async () => {
    const create: string = (await statementsOf("up"))[0]!;

    for (const column of [
      `"toEmail" character varying(100) NOT NULL`,
      `"subject" character varying(500)`,
      `"templateType" character varying(100)`,
      `"status" character varying(100) NOT NULL`,
      `"statusMessage" character varying(500)`,
      `"projectId" uuid`,
    ]) {
      expect(create).toContain(column);
    }

    expect(create).not.toMatch(/"(body|html|text|vars|message)"/i);
  });

  test("touches no other table, and ties no row to a project by a key", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/FOREIGN KEY|REFERENCES|ALTER TABLE/i);
      expect(statement).toMatch(/"ServerEmailLog"/);
    }
  });

  test("down drops the indexes and the table up made, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `DROP INDEX "public"."IDX_0d2976fa945e500101c4d5ed27"`,
      `DROP INDEX "public"."IDX_c96f1586cc4957746bae4011e6"`,
      `DROP TABLE "ServerEmailLog"`,
    ]);
  });

  test("the model declares the columns it adds, nobody's to read or write through the API", () => {
    const model: ServerEmailLog = new ServerEmailLog();

    expect(model.getTableColumnMetadata("toEmail").type).toBe(
      TableColumnType.Email,
    );
    expect(model.getTableColumnMetadata("toEmail").required).toBe(true);
    expect(model.getTableColumnMetadata("subject").required).toBeFalsy();
    expect(model.getTableColumnMetadata("projectId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("projectId").required).toBeFalsy();

    for (const column of [
      "toEmail",
      "subject",
      "templateType",
      "status",
      "statusMessage",
      "projectId",
    ]) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    }
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddServerEmailLog1809183300000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809183200000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
