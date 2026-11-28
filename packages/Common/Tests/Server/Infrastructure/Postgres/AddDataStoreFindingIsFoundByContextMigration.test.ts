import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { AddDataStoreFindingIsFoundByContext1809187821502 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187821502-AddDataStoreFindingIsFoundByContext";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * A FINDING SAYS IT WAS FOUND ONLY WITH WHAT IS AROUND IT (#11502).
 *
 * "DataStoreFinding" gains isFoundByContext: whether some of a finding's
 * values were found only beside the words that name their type, or under a
 * location whose name names it - which a Custom Regex rule of the type's
 * shapes keeps, so Data Security's coverage does not count one for it. A
 * busy table - every scan writes it - so nothing is rewritten: the column
 * is nullable with no default, and a finding written before says nothing
 * (null) until its next scan, which coverage reads as found so where its
 * type can be. Pure SQL-contract assertions against a fake QueryRunner;
 * the schema drift check holds the statement to the model.
 */

const MIGRATIONS_FOLDER: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

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

describe("AddDataStoreFindingIsFoundByContext1809187821502", () => {
  test("adds the one column, as TypeORM writes it", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingIsFoundByContext1809187821502().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "DataStoreFinding" ADD "isFoundByContext" boolean`,
    ]);
  });

  test("never rewrites the table: no default, no NOT NULL and no update of the findings there", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddDataStoreFindingIsFoundByContext1809187821502().up(runner);
    })) {
      expect(statement.startsWith(`ALTER TABLE "DataStoreFinding" ADD`)).toBe(
        true,
      );
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("UPDATE");
    }
  });

  test("down() takes back exactly what up() made", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreFindingIsFoundByContext1809187821502().down(
          runner,
        );
      }),
    ).toEqual([`ALTER TABLE "DataStoreFinding" DROP COLUMN "isFoundByContext"`]);
  });

  test("is registered once, after the migrations made before it, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf(
      "AddDataStoreFindingIsFoundByContext1809187821502",
    );

    expect(index).toBeGreaterThan(-1);

    // After the column it sits beside, and the migration made just before it.
    for (const before of [
      "AddDataSecurityNamesAndAddressesModel1809187540373",
      "AddVMwareHealthSettingsAndSwapRates1809187811157",
    ]) {
      expect(names.indexOf(before)).toBeGreaterThan(-1);
      expect(index).toBeGreaterThan(names.indexOf(before));
    }

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddDataStoreFindingIsFoundByContext1809187821502;
      }),
    ).toHaveLength(1);
    expect(new AddDataStoreFindingIsFoundByContext1809187821502().name).toBe(
      "AddDataStoreFindingIsFoundByContext1809187821502",
    );
  });

  test("is backed by exactly one file", () => {
    expect(
      fs.readdirSync(MIGRATIONS_FOLDER).filter((file: string): boolean => {
        return file.startsWith("1809187821502-");
      }),
    ).toEqual(["1809187821502-AddDataStoreFindingIsFoundByContext.ts"]);
  });
});

describe("the model says the same", () => {
  test("the column is the finding's, a nullable boolean with no default", () => {
    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter((args: ColumnMetadataArgs) => {
        return (
          args.target === DataStoreFinding &&
          args.propertyName === "isFoundByContext"
        );
      });

    expect(columns).toHaveLength(1);
    expect(columns[0]!.options.nullable).toBe(true);
    expect(columns[0]!.options.default).toBeUndefined();
    expect(getTableColumns(new DataStoreFinding())["isFoundByContext"]).toEqual(
      expect.objectContaining({
        type: TableColumnType.Boolean,
        required: false,
      }),
    );
  });

  test("is written by OneUptime alone, and read by whoever may read the finding", () => {
    const finding: DataStoreFinding = new DataStoreFinding();
    const access: {
      create: Array<unknown>;
      read: Array<unknown>;
      update: Array<unknown>;
    } | null = finding.getColumnAccessControlFor("isFoundByContext") as {
      create: Array<unknown>;
      read: Array<unknown>;
      update: Array<unknown>;
    } | null;
    // As isFoundByModel, the column it sits beside.
    const beside: {
      read: Array<unknown>;
    } | null = finding.getColumnAccessControlFor("isFoundByModel") as {
      read: Array<unknown>;
    } | null;

    expect(access).not.toBeNull();
    expect(access!.create).toEqual([]);
    expect(access!.update).toEqual([]);
    expect(access!.read.length).toBeGreaterThan(0);
    expect(access!.read).toEqual(beside!.read);
  });
});
