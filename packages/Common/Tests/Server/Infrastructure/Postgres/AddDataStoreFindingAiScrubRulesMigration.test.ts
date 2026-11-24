import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { AddDataStoreFindingAiScrubRules1809187530752 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187530752-AddDataStoreFindingAiScrubRules";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI WRITES A PLACE'S SCRUB RULE ONCE (#10752).
 *
 * "DataStoreFinding" gains what OneUptime AI was told when it last wrote a
 * scrub rule for the place, hashed, and what it wrote. A busy table - every
 * scan writes it - so nothing is rewritten: both columns are nullable with
 * no default. Pure SQL-contract assertions against a fake QueryRunner; the
 * schema drift check holds the statements to the model.
 */

const COLUMNS: Array<string> = ["aiScrubRuleInputHash", "aiScrubRules"];

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

describe("AddDataStoreFindingAiScrubRules1809187530752", () => {
  test("adds the two columns, as TypeORM writes them", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingAiScrubRules1809187530752().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "DataStoreFinding" ADD "aiScrubRuleInputHash" character varying(100)`,
      `ALTER TABLE "DataStoreFinding" ADD "aiScrubRules" jsonb`,
    ]);
  });

  test("never rewrites the table: no default, and no update", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddDataStoreFindingAiScrubRules1809187530752().up(runner);
    })) {
      expect(statement.startsWith(`ALTER TABLE "DataStoreFinding" ADD`)).toBe(
        true,
      );
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
    }
  });

  test("down() takes back exactly what up() made, in reverse", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingAiScrubRules1809187530752().down(runner);
      }),
    ).toEqual(
      [...COLUMNS].reverse().map((column: string): string => {
        return `ALTER TABLE "DataStoreFinding" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("is registered once, after the finding's verdicts, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf(
      "AddDataStoreFindingAiScrubRules1809187530752",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddDataStoreFindingAiVerdicts1809187520372"),
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddDataStoreFindingAiScrubRules1809187530752;
      }),
    ).toHaveLength(1);
    expect(new AddDataStoreFindingAiScrubRules1809187530752().name).toBe(
      "AddDataStoreFindingAiScrubRules1809187530752",
    );
  });
});

describe("the model says the same", () => {
  test("each column is the finding's, and nullable", () => {
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
      expect({
        column: args.propertyName,
        nullable: args.options.nullable,
      }).toEqual({ column: args.propertyName, nullable: true });
    }
  });

  test("neither is read through a route: OneUptime's own", () => {
    const finding: DataStoreFinding = new DataStoreFinding();

    for (const column of COLUMNS) {
      const access: {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } | null = finding.getColumnAccessControlFor(column) as {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } | null;

      expect(access).not.toBeNull();
      expect({
        column,
        create: access!.create,
        read: access!.read,
        update: access!.update,
      }).toEqual({ column, create: [], read: [], update: [] });
    }
  });
});
