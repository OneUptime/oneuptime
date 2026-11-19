import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddComplianceSettingNamespace1809186000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186000000-AddComplianceSettingNamespace";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind the namespace a compliance setting is for (#9627):
 * a Kubernetes cluster turns its own frameworks, or one of their controls,
 * off for one namespace. One nullable column with no default, so adding it
 * rewrites nothing; registered once, after every migration before it, and
 * the column the model declares.
 */

const TABLE: string = "DataSecurityComplianceSetting";
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
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

describe("AddComplianceSettingNamespace1809186000000", () => {
  test("adds the namespace column, nullable, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddComplianceSettingNamespace1809186000000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD "namespace" character varying(100)`,
    ]);
  });

  test("adds no key, index, default or backfill", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddComplianceSettingNamespace1809186000000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddComplianceSettingNamespace1809186000000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "${TABLE}" DROP COLUMN "namespace"`]);
  });

  test("is registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const position: number = registered.indexOf(
      AddComplianceSettingNamespace1809186000000,
    );

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddComplianceSettingNamespace1809186000000;
      }),
    ).toHaveLength(1);
    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddComplianceSettingNamespace1809186000000));
    expect(new AddComplianceSettingNamespace1809186000000().name).toBe(
      "AddComplianceSettingNamespace1809186000000",
    );
  });

  test("the model declares the column it adds: short text, nullable", () => {
    const args: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === DataSecurityComplianceSetting &&
            candidate.propertyName === "namespace"
          );
        },
      );

    expect(args?.options.nullable).toBe(true);
    expect(args?.options.length).toBe(ColumnLength.ShortText);
    expect(
      new DataSecurityComplianceSetting().getTableColumnMetadata("namespace")
        .type,
    ).toBe(TableColumnType.ShortText);
  });
});
