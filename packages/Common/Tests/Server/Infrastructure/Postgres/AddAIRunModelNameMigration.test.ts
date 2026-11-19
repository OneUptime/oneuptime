import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddAIRunModelName1809185800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185800000-AddAIRunModelName";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import ColumnLength from "../../../../Types/Database/ColumnLength";

/*
 * AddAIRunModelName (OneUptime issue #7762): AIRun.modelName and
 * AIRun.llmProviderType, the model that wrote a completed run's answer and
 * its provider's type, for AI Results to count investigations and fixes by
 * model. Nullable with no default: Postgres adds them to "AIRun", which
 * every AI run writes, without rewriting it, and every run from before has
 * none - nothing is backfilled.
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

describe("AddAIRunModelName1809185800000", () => {
  test("adds the two columns to AIRun, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddAIRunModelName1809185800000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "AIRun" ADD "modelName" character varying(100)`,
      `ALTER TABLE "AIRun" ADD "llmProviderType" character varying(100)`,
    ]);
  });

  test("nullable, no default, no index, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddAIRunModelName1809185800000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("the columns are the model's: short text, as long as the migration makes them", () => {
    const run: AIRun = new AIRun();

    for (const column of ["modelName", "llmProviderType"]) {
      expect(run.getTableColumnMetadata(column)).toBeDefined();
      expect(run.getTableColumnMetadata(column).required).toBe(false);
    }

    expect(ColumnLength.ShortText).toBe(100);
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddAIRunModelName1809185800000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "AIRun" DROP COLUMN "llmProviderType"`,
      `ALTER TABLE "AIRun" DROP COLUMN "modelName"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddAIRunModelName1809185800000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(AddAIRunModelName1809185800000);

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddAIRunModelName1809185800000));
    expect(new AddAIRunModelName1809185800000().name).toBe(
      "AddAIRunModelName1809185800000",
    );
  });
});
