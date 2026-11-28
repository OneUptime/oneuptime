import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTwilioCallVoice1809187620948 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187620948-AddTwilioCallVoice";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";

/*
 * AddTwilioCallVoice (#10948): the voice the calls through a project's own
 * Twilio config, and through the server's own account, speak with. Nullable
 * columns with no default: Postgres adds them without rewriting a row, and
 * nothing is backfilled - empty is the account's default voice, so every
 * call speaks exactly as it did until an admin chooses one.
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
function typeOrmColumn(model: { new (): unknown }): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .filterColumns(model)
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === "twilioCallVoice";
    });

  expect(column).toBeDefined();

  return column!;
}

describe("AddTwilioCallVoice1809187620948", () => {
  test("adds the one column to each table, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTwilioCallVoice1809187620948().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioCallVoice" character varying(100)`,
      `ALTER TABLE "GlobalConfig" ADD "twilioCallVoice" character varying(100)`,
    ]);
  });

  test("nullable, no default, no index, no key, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddTwilioCallVoice1809187620948().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("each statement is the model's: a short text TypeORM maps as a nullable varchar(100), so the drift check finds nothing", () => {
    for (const model of [ProjectCallSMSConfig, GlobalConfig]) {
      const column: ColumnMetadataArgs = typeOrmColumn(model);

      expect(column.options.type).toBe(ColumnType.ShortText);
      expect(column.options.length).toBe(ColumnLength.ShortText);
      expect(String(ColumnLength.ShortText)).toBe("100");
      expect(column.options.nullable).toBe(true);
      expect(column.options.default).toBeUndefined();
    }
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTwilioCallVoice1809187620948().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioCallVoice"`,
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioCallVoice"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddTwilioCallVoice1809187620948;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddTwilioCallVoice1809187620948,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddTwilioCallVoice1809187620948));
    expect(new AddTwilioCallVoice1809187620948().name).toBe(
      "AddTwilioCallVoice1809187620948",
    );
  });
});
