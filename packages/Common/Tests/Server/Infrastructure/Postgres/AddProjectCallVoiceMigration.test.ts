import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectCallVoice1809187801300 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187801300-AddProjectCallVoice";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../../Models/DatabaseModels/Project";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";

/*
 * AddProjectCallVoice (#11065): the voice a project chose for its calls
 * through the server's Twilio account, and the master admin's switch that
 * lets projects choose one. A nullable column with no default, and a
 * boolean whose default is a constant: Postgres adds both without
 * rewriting a row, and nothing is backfilled - no project has a voice and
 * the switch is off, so every call speaks exactly as it did.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

// The column as TypeORM maps it: what the generator compares the database with.
function typeOrmColumn(
  model: { new (): unknown },
  propertyName: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .filterColumns(model)
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === propertyName;
    });

  expect(column).toBeDefined();

  return column!;
}

describe("AddProjectCallVoice1809187801300", () => {
  test("adds the project's voice and the server's switch, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectCallVoice1809187801300().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "Project" ADD "callVoice" character varying(100)`,
      `ALTER TABLE "GlobalConfig" ADD "letProjectsChooseCallVoice" boolean DEFAULT false`,
    ]);
  });

  test("no NOT NULL, no index, no key, no row rewritten: the switch's only default is the constant false", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddProjectCallVoice1809187801300().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toMatch(
        /NOT NULL|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |now\(\)|uuid/i,
      );
    }

    expect(statements[0]).not.toMatch(/DEFAULT/);
    expect(statements[1]).toMatch(/ DEFAULT false$/);
  });

  test("the project's voice is the model's: a short text TypeORM maps as a nullable varchar(100), so the drift check finds nothing", () => {
    const column: ColumnMetadataArgs = typeOrmColumn(Project, "callVoice");

    expect(column.options.type).toBe(ColumnType.ShortText);
    expect(column.options.length).toBe(ColumnLength.ShortText);
    expect(String(ColumnLength.ShortText)).toBe("100");
    expect(column.options.nullable).toBe(true);
    expect(column.options.default).toBeUndefined();
  });

  test("the switch is the model's: a nullable boolean, false by default", () => {
    const column: ColumnMetadataArgs = typeOrmColumn(
      GlobalConfig,
      "letProjectsChooseCallVoice",
    );

    expect(column.options.type).toBe(ColumnType.Boolean);
    expect(column.options.nullable).toBe(true);
    expect(column.options.default).toBe(false);
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProjectCallVoice1809187801300().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "letProjectsChooseCallVoice"`,
      `ALTER TABLE "Project" DROP COLUMN "callVoice"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProjectCallVoice1809187801300;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProjectCallVoice1809187801300,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddProjectCallVoice1809187801300));
    expect(new AddProjectCallVoice1809187801300().name).toBe(
      "AddProjectCallVoice1809187801300",
    );
  });
});
