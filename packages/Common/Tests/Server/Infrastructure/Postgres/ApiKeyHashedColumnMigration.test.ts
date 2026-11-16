import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ApiKeyHashedColumn1809180790200 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180790200-ApiKeyHashedColumn";
import { AddMasterApiKeyCreatedByAndHint1809180790300 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180790300-AddMasterApiKeyCreatedByAndHint";
import ColumnLength from "../../../../Types/Database/ColumnLength";

/*
 * A PROJECT'S API KEY'S COLUMN HOLDS ITS HASH (#8902), and the master key's
 * settings say which key it is (#8903): the two migrations behind them.
 *
 * ApiKeyHashedColumn:
 *  - the uuid column becomes a varchar of a HashedString's length, in
 *    place (ALTER COLUMN TYPE): every key stored stays, as its text, for
 *    the HashProjectApiKeys data migration to hash - and for the lookup to
 *    take until it does - where the generator's DROP COLUMN + ADD COLUMN
 *    would throw every key away and break every script, integration and
 *    Terraform configuration that uses one;
 *  - its index stays, by the name every installation's migrations gave it:
 *    a key is looked up by its hash through it;
 *  - the hint gets a nullable column, as the model declares it;
 *  - down() puts the uuid column back - NOT NULL, so a hashed key, no uuid
 *    and no way back to the key, becomes a new random one, as a reset
 *    would - and keeps a key not hashed yet.
 *
 * AddMasterApiKeyCreatedByAndHint adds three nullable columns to the
 * server's settings, as the model declares them, with no foreign key.
 *
 * Both are registered once, in order, or they silently never run.
 * HashProjectApiKeysPostgres.test.ts runs them against a real Postgres.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const MIGRATION_SOURCE_FILE: RegExp = /^\d{13}-.*\.ts$/;

const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

interface Step {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
}

async function statementsOf(
  migration: Step,
  step: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await migration[step](runner);

  return statements;
}

function columnOf(
  target: unknown,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === target && entry.propertyName === propertyName;
    },
  );
}

function expectRegisteredInOrder(className: string): void {
  const names: Array<string> = SchemaMigrations.map(
    (migration: unknown): string => {
      return (migration as { name: string }).name;
    },
  );
  const position: number = names.indexOf(className);
  const timestamp: string = className.match(CLASS_TIMESTAMP)![1]!;

  expect(position).toBeGreaterThan(-1);
  expect(names.lastIndexOf(className)).toBe(position);

  for (const earlier of names.slice(0, position)) {
    const earlierTimestamp: string | undefined =
      earlier.match(CLASS_TIMESTAMP)?.[1];

    if (earlierTimestamp) {
      expect([earlier, Number(earlierTimestamp) < Number(timestamp)]).toEqual([
        earlier,
        true,
      ]);
    }
  }
}

describe("ApiKeyHashedColumn", () => {
  const migration: ApiKeyHashedColumn1809180790200 =
    new ApiKeyHashedColumn1809180790200();

  test("up() turns the uuid column into a varchar in place, keeping every key, and adds the hint", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "ApiKey" ALTER COLUMN "apiKey" TYPE character varying(255)`,
      `ALTER TABLE "ApiKey" ADD "apiKeyHint" character varying(100)`,
    ]);
  });

  test("up() drops no column, and leaves the key column's index as it is", async () => {
    for (const statement of await statementsOf(migration, "up")) {
      expect(statement).not.toMatch(/DROP|INDEX|CONSTRAINT/);
    }
  });

  test("the columns are as the model declares them", async () => {
    const apiKey: ColumnMetadataArgs | undefined = columnOf(ApiKey, "apiKey");
    const hint: ColumnMetadataArgs | undefined = columnOf(ApiKey, "apiKeyHint");

    expect(apiKey?.options.type).toBe("varchar");
    expect(apiKey?.options.length).toBe(ColumnLength.HashedString);
    expect(apiKey?.options.nullable).toBe(false);
    expect(hint?.options.type).toBe("varchar");
    expect(hint?.options.length).toBe(ColumnLength.ShortText);
    expect(hint?.options.nullable).toBe(true);

    const [alter, add] = await statementsOf(migration, "up");

    expect(alter).toContain(`character varying(${ColumnLength.HashedString})`);
    expect(add).toContain(`character varying(${ColumnLength.ShortText})`);
  });

  test("the index it keeps is the model's, made before it", () => {
    const index: string = new DefaultNamingStrategy().indexName("ApiKey", [
      "apiKey",
    ]);

    expect(index).toBe("IDX_17bec9c02846cdf64b5d6bb71f");
    expect(
      getMetadataArgsStorage().indices.some(
        (entry: IndexMetadataArgs): boolean => {
          return (
            entry.target === ApiKey &&
            (entry.columns as Array<string> | undefined)?.length === 1 &&
            (entry.columns as Array<string>)[0] === "apiKey"
          );
        },
      ) ||
        getMetadataArgsStorage().indices.some(
          (entry: IndexMetadataArgs): boolean => {
            return (
              entry.target === ApiKey &&
              (entry as unknown as { propertyName?: string }).propertyName ===
                "apiKey"
            );
          },
        ),
    ).toBe(true);

    const made: RegExp = new RegExp(
      `CREATE INDEX "${index}" ON "ApiKey" \\("apiKey"\\)`,
    );
    const earlier: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return (
          MIGRATION_SOURCE_FILE.test(file) &&
          Number(file.slice(0, 13)) < 1809180790200
        );
      })
      .filter((file: string): boolean => {
        return made.test(
          fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8"),
        );
      });

    expect(earlier.length).toBeGreaterThan(0);
  });

  test("down() puts the uuid column back: a hashed key becomes a new random key, a key not hashed yet stays", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "ApiKey" DROP COLUMN "apiKeyHint"`,
      `ALTER TABLE "ApiKey" ALTER COLUMN "apiKey" TYPE uuid USING (CASE WHEN "apiKey" ~* '${UUID_PATTERN}' THEN "apiKey"::uuid ELSE gen_random_uuid() END)`,
    ]);
  });

  test("it is named after its file and registered once, in order", () => {
    expect(
      fs.existsSync(
        path.join(MIGRATION_DIRECTORY, "1809180790200-ApiKeyHashedColumn.ts"),
      ),
    ).toBe(true);
    expect(migration.name).toBe("ApiKeyHashedColumn1809180790200");
    expectRegisteredInOrder("ApiKeyHashedColumn1809180790200");
  });
});

describe("AddMasterApiKeyCreatedByAndHint", () => {
  const migration: AddMasterApiKeyCreatedByAndHint1809180790300 =
    new AddMasterApiKeyCreatedByAndHint1809180790300();

  test("up() adds when the key was made, by whom and its hint: nullable, with no foreign key", async () => {
    const statements: Array<string> = await statementsOf(migration, "up");

    expect(statements).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyCreatedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyCreatedByUserId" uuid`,
      `ALTER TABLE "GlobalConfig" ADD "masterApiKeyHint" character varying(100)`,
    ]);

    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|FOREIGN KEY|INDEX/);
    }
  });

  test("the columns are as the model declares them", () => {
    expect(columnOf(GlobalConfig, "masterApiKeyCreatedAt")?.options).toEqual(
      expect.objectContaining({ nullable: true }),
    );
    expect(
      columnOf(GlobalConfig, "masterApiKeyCreatedByUserId")?.options,
    ).toEqual(expect.objectContaining({ type: "uuid", nullable: true }));
    expect(columnOf(GlobalConfig, "masterApiKeyHint")?.options).toEqual(
      expect.objectContaining({
        type: "varchar",
        length: ColumnLength.ShortText,
        nullable: true,
      }),
    );
  });

  test("down() drops them again", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyHint"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyCreatedByUserId"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "masterApiKeyCreatedAt"`,
    ]);
  });

  test("it is named after its file and registered once, after the key's column migration", () => {
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          "1809180790300-AddMasterApiKeyCreatedByAndHint.ts",
        ),
      ),
    ).toBe(true);
    expect(migration.name).toBe("AddMasterApiKeyCreatedByAndHint1809180790300");
    expectRegisteredInOrder("AddMasterApiKeyCreatedByAndHint1809180790300");
  });
});
