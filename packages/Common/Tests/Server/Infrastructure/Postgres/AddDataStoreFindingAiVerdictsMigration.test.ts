import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { AddDataStoreFindingAiVerdicts1809187472372 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187472372-AddDataStoreFindingAiVerdicts";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI'S VERDICTS ON FINDINGS (#10372).
 *
 * "DataStoreFinding" gains the verdict, its reason and precedent, when it
 * was written and what it was written from, whether OneUptime AI confirmed
 * the finding on its own, and when it was decided. A busy table - every
 * scan writes it - so nothing is rewritten: each column is nullable with
 * no default, but "isConfirmedByAi", whose default is a constant Postgres
 * keeps in its catalog. Pure SQL-contract assertions against a fake
 * QueryRunner; the schema drift check holds the statements to the model.
 */

const COLUMNS: Array<string> = [
  "aiVerdict",
  "aiVerdictAnalysis",
  "aiVerdictAt",
  "aiVerdictInputHash",
  "isConfirmedByAi",
  "decidedAt",
];

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

describe("AddDataStoreFindingAiVerdicts1809187472372", () => {
  test("adds the six columns, as TypeORM writes them", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingAiVerdicts1809187472372().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdict" character varying(100)`,
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictAnalysis" jsonb`,
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "DataStoreFinding" ADD "aiVerdictInputHash" character varying(100)`,
      `ALTER TABLE "DataStoreFinding" ADD "isConfirmedByAi" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "DataStoreFinding" ADD "decidedAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("never rewrites the table: only a constant default, and no update", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddDataStoreFindingAiVerdicts1809187472372().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement.startsWith(`ALTER TABLE "DataStoreFinding" ADD`)).toBe(
        true,
      );

      if (statement.includes("DEFAULT")) {
        expect(statement).toContain(`"isConfirmedByAi" boolean NOT NULL DEFAULT false`);
      }
    }
  });

  test("down() takes back exactly what up() made, in reverse", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingAiVerdicts1809187472372().down(runner);
      }),
    ).toEqual(
      [...COLUMNS].reverse().map((column: string): string => {
        return `ALTER TABLE "DataStoreFinding" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("is registered once, last of the migrations before it, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown): string => {
      return (migration as { name: string }).name;
    });
    const index: number = names.indexOf(
      "AddDataStoreFindingAiVerdicts1809187472372",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddCodeRepositoryProductionReviewFailOnLeak1809187470500"),
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddDataStoreFindingAiVerdicts1809187472372;
      }),
    ).toHaveLength(1);
    expect(new AddDataStoreFindingAiVerdicts1809187472372().name).toBe(
      "AddDataStoreFindingAiVerdicts1809187472372",
    );
  });
});

describe("the model says the same", () => {
  test("each column is the finding's, nullable but the one with a default", () => {
    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter((args: ColumnMetadataArgs) => {
        return (
          args.target === DataStoreFinding &&
          COLUMNS.includes(args.propertyName)
        );
      });

    expect(
      columns
        .map((args: ColumnMetadataArgs): string => {
          return args.propertyName;
        })
        .sort(),
    ).toEqual([...COLUMNS].sort());

    for (const args of columns) {
      if (args.propertyName === "isConfirmedByAi") {
        expect(args.options.nullable).toBe(false);
        expect(args.options.default).toBe(false);
      } else {
        expect({
          column: args.propertyName,
          nullable: args.options.nullable,
        }).toEqual({ column: args.propertyName, nullable: true });
      }
    }
  });
});
