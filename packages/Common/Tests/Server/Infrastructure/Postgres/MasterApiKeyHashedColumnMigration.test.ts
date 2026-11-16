import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MasterApiKeyHashedColumn1809180790100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180790100-MasterApiKeyHashedColumn";
import ColumnLength from "../../../../Types/Database/ColumnLength";

/*
 * THE MASTER API KEY'S COLUMN HOLDS ITS HASH (#7901): the migration behind
 * GlobalConfig.masterApiKey becoming a HashedString column.
 *
 *  - the uuid column becomes a varchar of a HashedString's length, in
 *    place (ALTER COLUMN TYPE): the key stored stays, as its text, for the
 *    HashMasterApiKey data migration to hash - and for the lookup to take
 *    until it does - where the generator's DROP COLUMN + ADD COLUMN would
 *    throw it away and break every script that uses it;
 *  - its unique constraint stays, by the name every installation's
 *    migrations gave it: a hash of a unique key is unique too;
 *  - down() puts the uuid column back, clearing a hash - no uuid, and no
 *    way back to the key - and keeping a key not hashed yet;
 *  - it is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * MasterApiKeyPostgres.test.ts runs it against a real Postgres.
 */

const MIGRATION_TIMESTAMP: string = "1809180790100";
const MIGRATION_BASE_NAME: string = "MasterApiKeyHashedColumn";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const MIGRATION_SOURCE_FILE: RegExp = /^\d{13}-.*\.ts$/;

const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new MasterApiKeyHashedColumn1809180790100()[step](runner);

  return statements;
}

function masterApiKeyColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return (
        entry.target === GlobalConfig && entry.propertyName === "masterApiKey"
      );
    },
  );
}

describe("executing it", () => {
  test("up() turns the uuid column into a varchar in place, keeping the key stored", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "masterApiKey" TYPE character varying(255)`,
    ]);
  });

  test("up() drops no column, adds none and keeps the unique constraint", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/DROP COLUMN|ADD "|ADD COLUMN|CONSTRAINT/);
    }
  });

  test("the varchar is as long as the model's HashedString column", async () => {
    const column: ColumnMetadataArgs | undefined = masterApiKeyColumn();

    expect(column?.options.type).toBe("varchar");
    expect(column?.options.length).toBe(ColumnLength.HashedString);
    expect((await statementsOf("up"))[0]).toContain(
      `character varying(${ColumnLength.HashedString})`,
    );
  });

  test("the unique constraint it keeps is the model's, made by the first migration", () => {
    const constraint: string = new DefaultNamingStrategy().uniqueConstraintName(
      "GlobalConfig",
      ["masterApiKey"],
    );

    expect(constraint).toBe("UQ_117d0b6a9f6c32be770c07f1cf6");
    expect(masterApiKeyColumn()?.options.unique).toBe(true);

    const made: RegExp = new RegExp(
      `CONSTRAINT "${constraint}" UNIQUE \\("masterApiKey"\\)`,
    );
    const earlier: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return (
          MIGRATION_SOURCE_FILE.test(file) &&
          Number(file.slice(0, 13)) < Number(MIGRATION_TIMESTAMP)
        );
      })
      .filter((file: string): boolean => {
        return made.test(
          fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8"),
        );
      });

    expect(earlier).toEqual(["1717605043663-InitialMigration.ts"]);
  });

  test("down() puts the uuid column back, clearing a hash and keeping a key not hashed yet", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "masterApiKey" TYPE uuid USING (CASE WHEN "masterApiKey" ~* '${UUID_PATTERN}' THEN "masterApiKey"::uuid ELSE NULL END)`,
    ]);
  });

  test("builds no index and adds no foreign key, so no online DDL is owed", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY/);
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new MasterApiKeyHashedColumn1809180790100().name).toBe(
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
