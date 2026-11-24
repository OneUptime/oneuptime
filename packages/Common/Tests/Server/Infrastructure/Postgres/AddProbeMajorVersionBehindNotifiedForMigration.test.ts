import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProbeMajorVersionBehindNotifiedFor1809187560000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187560000-AddProbeMajorVersionBehindNotifiedFor";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ColumnType from "../../../../Types/Database/ColumnType";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * AddProbeMajorVersionBehindNotifiedFor (OneUptime issue #9977):
 * Probe.majorVersionBehindNotifiedFor, the major release of OneUptime a
 * custom probe's owners were last told it is behind. A nullable integer
 * with no default: Postgres adds it to "Probe" without rewriting a row,
 * and nothing is backfilled - no probe's owners were ever told before.
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
function typeOrmColumn(): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .filterColumns(Probe)
    .find((candidate: ColumnMetadataArgs): boolean => {
      return candidate.propertyName === "majorVersionBehindNotifiedFor";
    });

  expect(column).toBeDefined();

  return column!;
}

describe("AddProbeMajorVersionBehindNotifiedFor1809187560000", () => {
  test("adds the one column to Probe, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProbeMajorVersionBehindNotifiedFor1809187560000().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "Probe" ADD "majorVersionBehindNotifiedFor" integer`,
    ]);
  });

  test("nullable, no default, no index, no key, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddProbeMajorVersionBehindNotifiedFor1809187560000().up(
        runner,
      );
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("the statement is the model's: an integer TypeORM maps as nullable, so the drift check finds nothing", () => {
    const column: ColumnMetadataArgs = typeOrmColumn();

    expect(column.options.type).toBe(ColumnType.Number);
    expect(ColumnType.Number).toBe("integer");
    expect(column.options.nullable).toBe(true);
    expect(column.options.default).toBeUndefined();
  });

  test("the column is a number nobody is required to give, kept by OneUptime alone", () => {
    const probe: Probe = new Probe();

    expect(
      probe.getTableColumnMetadata("majorVersionBehindNotifiedFor"),
    ).toBeDefined();
    expect(
      probe.getTableColumnMetadata("majorVersionBehindNotifiedFor").required,
    ).toBe(false);
    expect(
      probe.getTableColumnMetadata("majorVersionBehindNotifiedFor").type,
    ).toBe(TableColumnType.Number);
    expect(
      probe.getTableColumnMetadata("majorVersionBehindNotifiedFor").computed,
    ).toBe(true);
  });

  test("nobody writes it, and whoever reads the probe's release reads it", () => {
    const probe: Probe = new Probe();
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = probe.getColumnAccessControlFor(
      "majorVersionBehindNotifiedFor",
    )! as never;
    const release: { read: Array<Permission> } =
      probe.getColumnAccessControlFor("reportedVersion")! as never;

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect([...access.read].sort()).toEqual([...release.read].sort());
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProbeMajorVersionBehindNotifiedFor1809187560000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "Probe" DROP COLUMN "majorVersionBehindNotifiedFor"`,
    ]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProbeMajorVersionBehindNotifiedFor1809187560000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProbeMajorVersionBehindNotifiedFor1809187560000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(
      timestampOf(AddProbeMajorVersionBehindNotifiedFor1809187560000),
    );
    expect(new AddProbeMajorVersionBehindNotifiedFor1809187560000().name).toBe(
      "AddProbeMajorVersionBehindNotifiedFor1809187560000",
    );
  });
});
