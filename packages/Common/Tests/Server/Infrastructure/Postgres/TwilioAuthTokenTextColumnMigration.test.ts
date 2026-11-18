import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import ProjectCallSMSConfig from "../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { TwilioAuthTokenTextColumn1809182960000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182960000-TwilioAuthTokenTextColumn";

/*
 * A PROJECT'S TWILIO AUTH TOKEN GETS ROOM FOR ITS CIPHERTEXT (#9267).
 *
 *  - ProjectCallSMSConfig.twilioAuthToken, a varchar(500), becomes text, in
 *    place (ALTER COLUMN TYPE): every stored token stays, where the
 *    generator's DROP COLUMN + ADD COLUMN would throw it away;
 *  - down() puts back the varchar(500) the earlier migrations made;
 *  - the model agrees: an encrypted text column, still held to 500
 *    characters as written;
 *  - it is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809182960000";
const MIGRATION_BASE_NAME: string = "TwilioAuthTokenTextColumn";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const MIGRATION_SOURCE_FILE: RegExp = /^\d{13}-.*\.ts$/;

const WIDEN: string = `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE text`;
const PUT_BACK: string = `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(500)`;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new TwilioAuthTokenTextColumn1809182960000()[step](runner);

  return statements;
}

// Every earlier migration's source, to find what made the column.
function earlierMigrationSources(): string {
  return fs
    .readdirSync(MIGRATION_DIRECTORY)
    .filter((file: string): boolean => {
      return (
        MIGRATION_SOURCE_FILE.test(file) &&
        Number(file.slice(0, 13)) < Number(MIGRATION_TIMESTAMP)
      );
    })
    .map((file: string): string => {
      return fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8");
    })
    .join("\n");
}

describe("executing it", () => {
  test("up() widens the Twilio auth token to text, in place", async () => {
    expect(await statementsOf("up")).toEqual([WIDEN]);
  });

  test("up() keeps every stored token: no column is dropped or added", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/DROP COLUMN|ADD "|ADD COLUMN/);
    }
  });

  test("the column was the varchar(500) down() puts back", async () => {
    // 1801800000000-TwilioAuthTokenEncryptedColumn made it so.
    expect(earlierMigrationSources()).toContain(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(500)`,
    );
    expect(await statementsOf("down")).toEqual([PUT_BACK]);
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

describe("the column it leaves", () => {
  test("is an encrypted text column of the model, nullable and not unique", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (entry: ColumnMetadataArgs): boolean => {
          return (
            entry.target === ProjectCallSMSConfig &&
            entry.propertyName === "twilioAuthToken"
          );
        },
      );

    expect([
      new ProjectCallSMSConfig().getTableColumnMetadata("twilioAuthToken")
        .encrypted,
      column?.options.type,
      column?.options.length,
      column?.options.nullable,
      Boolean(column?.options.unique),
    ]).toEqual([true, "text", undefined, true, false]);
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new TwilioAuthTokenTextColumn1809182960000().name).toBe(
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
