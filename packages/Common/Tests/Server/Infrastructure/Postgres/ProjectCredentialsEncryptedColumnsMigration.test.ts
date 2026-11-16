import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSmtpConfig from "../../../../Models/DatabaseModels/ProjectSmtpConfig";
import UserWebhook from "../../../../Models/DatabaseModels/UserWebhook";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ProjectCredentialsEncryptedColumns1809181400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181400000-ProjectCredentialsEncryptedColumns";

/*
 * A PROJECT'S CREDENTIALS GET ROOM FOR THEIR CIPHERTEXT (#8989): the
 * migration behind a project's SMTP password and its members' webhook
 * signing secrets becoming encrypted.
 *
 *  - each column that was a varchar becomes text, in place (ALTER COLUMN
 *    TYPE): the value stored stays for the EncryptProjectCredentials data
 *    migration to encrypt, where the generator's DROP COLUMN + ADD COLUMN
 *    would throw it away;
 *  - every other column made encrypted was text already, so nothing else
 *    changes;
 *  - down() puts back what was there, in the opposite order;
 *  - it is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809181400000";
const MIGRATION_BASE_NAME: string = "ProjectCredentialsEncryptedColumns";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const ALTER_TYPE: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ALTER COLUMN "([A-Za-z]+)" TYPE (.+)$/;

type ModelType = { new (): DatabaseBaseModel };

// What each column was, as the earlier migrations made it.
const WIDENED: Array<{
  table: string;
  modelType: ModelType;
  column: string;
  was: string;
}> = [
  {
    table: "ProjectSMTPConfig",
    modelType: ProjectSmtpConfig,
    column: "password",
    was: "character varying(500)",
  },
  {
    table: "UserWebhook",
    modelType: UserWebhook,
    column: "secret",
    was: "character varying(100)",
  },
];

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new ProjectCredentialsEncryptedColumns1809181400000()[step](runner);

  return statements;
}

function columnOf(
  modelType: ModelType,
  column: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === modelType && entry.propertyName === column;
    },
  );
}

// Every earlier migration's source, to find what made each column.
function earlierMigrationSources(): string {
  return fs
    .readdirSync(MIGRATION_DIRECTORY)
    .filter((file: string): boolean => {
      return (
        /^\d{13}-.*\.ts$/.test(file) &&
        Number(file.slice(0, 13)) < Number(MIGRATION_TIMESTAMP)
      );
    })
    .map((file: string): string => {
      return fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8");
    })
    .join("\n");
}

describe("executing it", () => {
  test("up() widens the SMTP password and the webhook signing secret to text, in place", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "password" TYPE text`,
      `ALTER TABLE "UserWebhook" ALTER COLUMN "secret" TYPE text`,
    ]);
  });

  test("up() keeps every stored value: no column is dropped or added", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/DROP COLUMN|ADD "|ADD COLUMN/);
      expect(ALTER_TYPE.test(statement)).toBe(true);
    }
  });

  test("each column it widens was the varchar it puts back", () => {
    const sources: string = earlierMigrationSources();

    for (const widened of WIDENED) {
      expect([
        widened.column,
        sources.includes(`"${widened.column}" ${widened.was}`),
      ]).toEqual([widened.column, true]);
    }
  });

  test("down() puts back each type, in the opposite order", async () => {
    expect(await statementsOf("down")).toEqual(
      [...WIDENED].reverse().map((widened: (typeof WIDENED)[number]) => {
        return `ALTER TABLE "${widened.table}" ALTER COLUMN "${widened.column}" TYPE ${widened.was}`;
      }),
    );
  });

  test("builds no index, adds no constraint and no foreign key, so no online DDL is owed", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY|CONSTRAINT|UNIQUE/);
    }
  });
});

describe("the columns it leaves", () => {
  test("each column it widens is an encrypted text column of its model, not unique", () => {
    for (const widened of WIDENED) {
      const column: ColumnMetadataArgs | undefined = columnOf(
        widened.modelType,
        widened.column,
      );

      expect([
        widened.column,
        new widened.modelType().getTableColumnMetadata(widened.column)
          .encrypted,
        column?.options.type,
        column?.options.length,
        Boolean(column?.options.unique),
      ]).toEqual([widened.column, true, "text", undefined, false]);
    }
  });

  test("every encrypted column of a project's SMTP config is text", () => {
    for (const column of new ProjectSmtpConfig().getEncryptedColumns()
      .columns) {
      expect([
        column,
        columnOf(ProjectSmtpConfig, column)?.options.type,
      ]).toEqual([column, "text"]);
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new ProjectCredentialsEncryptedColumns1809181400000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered once, after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);
    expect(names.lastIndexOf(MIGRATION_CLASS_NAME)).toBe(position);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });
});
