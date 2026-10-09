import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddLlmProviderHasAdditionalParams1801000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1801000000000-AddLlmProviderHasAdditionalParams";
import ColumnType from "../../../../Types/Database/ColumnType";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind LlmProvider.hasAdditionalParams: whether a provider
 * has Additional Parameters saved, for the members who read the provider but
 * not its parameters (read by the project's owners and admins alone, like the
 * API key).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. The column is NOT NULL with a
 * constant default, so adding it touches only the catalog, and one UPDATE
 * fills it in for the providers that have parameters, by the rule
 * LlmProviderService.hasAdditionalParams applies to every later write. (That
 * the SQL and the rule agree on every shape of stored parameters is proved
 * against Postgres in AddLlmProviderHasAdditionalParamsPostgres.test.ts.)
 * Beyond the SQL, the migration has to be registered, named consistently and
 * ordered after every migration already registered, or it silently never
 * runs.
 */

const MIGRATION_TIMESTAMP: string = "1801000000000";

const MIGRATION_BASE_NAME: string = "AddLlmProviderHasAdditionalParams";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: (...args: Array<unknown>): Promise<undefined> => {
      statements.push(String(args[0]));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddLlmProviderHasAdditionalParams1801000000000()[step](runner);

  return statements;
}

describe("executing it", () => {
  test("up() adds the column, then fills it in for the providers with parameters", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe(
      `ALTER TABLE "LlmProvider" ADD "hasAdditionalParams" boolean NOT NULL DEFAULT false`,
    );
    expect(statements[1]).toMatch(
      /^UPDATE "LlmProvider" SET "hasAdditionalParams" = true WHERE "additionalParams" IS NOT NULL AND /,
    );
  });

  test("the backfill only ever turns it on, and only for rows with parameters", async () => {
    const backfill: string = (await statementsOf("up"))[1]!;

    expect(backfill).not.toContain("= false WHERE");
    expect(backfill).toContain(`"additionalParams" IS NOT NULL`);
    // Each JSON shape the rule tells apart.
    expect(backfill).toContain(`WHEN 'null' THEN false`);
    expect(backfill).toContain(
      `WHEN 'object' THEN "additionalParams" <> '{}'::jsonb`,
    );
    expect(backfill).toContain(
      `WHEN 'array' THEN jsonb_array_length("additionalParams") > 0`,
    );
    expect(backfill).toContain(
      `WHEN 'string' THEN ("additionalParams" #>> '{}') ~ '[^[:space:]]'`,
    );
    expect(backfill).toContain("ELSE true END");
  });

  test("down() drops exactly that column", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "LlmProvider" DROP COLUMN "hasAdditionalParams"`,
    ]);
  });

  test("each statement is one statement on one line", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement).not.toContain("INDEX");
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddLlmProviderHasAdditionalParams1801000000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddLlmProviderHasAdditionalParams1801000000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the column it adds is the one the model names", () => {
  test("LlmProvider.hasAdditionalParams is a required boolean that starts off", () => {
    const provider: LlmProvider = new LlmProvider();

    const tableColumn: {
      type?: TableColumnType;
      required?: boolean;
      defaultValue?: unknown;
      isDefaultValueColumn?: boolean;
      computed?: boolean;
    } = provider.getTableColumnMetadata("hasAdditionalParams") as {
      type?: TableColumnType;
      required?: boolean;
      defaultValue?: unknown;
      isDefaultValueColumn?: boolean;
      computed?: boolean;
    };

    expect(tableColumn.type).toBe(TableColumnType.Boolean);
    expect(tableColumn.required).toBe(true);
    expect(tableColumn.defaultValue).toBe(false);
    expect(tableColumn.isDefaultValueColumn).toBe(true);
    expect(ColumnType.Boolean).toBe("boolean");
  });

  test("no caller writes it: OneUptime computes it", () => {
    expect(
      new LlmProvider().getColumnAccessControlFor("hasAdditionalParams"),
    ).toEqual(expect.objectContaining({ create: [], update: [] }));
    expect(
      new LlmProvider().getTableColumnMetadata("hasAdditionalParams")?.computed,
    ).toBe(true);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddLlmProviderHasAdditionalParams1801000000000;
      }),
    ).toHaveLength(1);
  });

  // TypeORM records applied migrations by `name`: a mismatch re-runs it.
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddLlmProviderHasAdditionalParams1801000000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddLlmProviderHasAdditionalParams1801000000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddLlmProviderHasAdditionalParams1801000000000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddLlmProviderHasAdditionalParams1801000000000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    expect(earlierTimestamps.length).toBeGreaterThan(100);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});
