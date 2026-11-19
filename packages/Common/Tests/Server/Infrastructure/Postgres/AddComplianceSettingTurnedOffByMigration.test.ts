import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddComplianceSettingTurnedOffBy1809184940000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184940000-AddComplianceSettingTurnedOffBy";
import { AddComplianceSettingTurnedOffByKey1809184940100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184940100-AddComplianceSettingTurnedOffByKey";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import User from "../../../../Models/DatabaseModels/User";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migrations behind who last turned a compliance framework or
 * requirement off for a resource, and when (#9629):
 *
 *   - AddComplianceSettingTurnedOffBy adds turnedOffByUserId and
 *     turnedOffAt: nullable, no default, so adding them rewrites nothing.
 *   - AddComplianceSettingTurnedOffByKey adds the key to the user ON DELETE
 *     SET NULL, online and outside a transaction: a key added to a table
 *     that holds rows locks "User" too while every row is checked
 *     (Docs/migrations/README.md).
 *
 * The statements run against a fake QueryRunner, OnlineDdl's own steps
 * stubbed, so what each migration hands it is told apart from what it runs
 * itself. The key's name is the one the generator gave it, so the drift
 * check finds nothing to change; both are registered once, in order.
 */

const TABLE: string = "DataSecurityComplianceSetting";
const KEY_NAME: string = "FK_71bfa8bb0d9ac1d8d57f7cf4bb2";
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const KEY_STATEMENT: string = `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${KEY_NAME}" FOREIGN KEY ("turnedOffByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex", "addForeignKey"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddComplianceSettingTurnedOffBy1809184940000: the columns", () => {
  test("adds turnedOffByUserId and turnedOffAt, nullable, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddComplianceSettingTurnedOffBy1809184940000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD "turnedOffByUserId" uuid`,
      `ALTER TABLE "${TABLE}" ADD "turnedOffAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("adds no key, index, default or backfill in the schema migration", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddComplianceSettingTurnedOffBy1809184940000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops both columns up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddComplianceSettingTurnedOffBy1809184940000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" DROP COLUMN "turnedOffAt"`,
      `ALTER TABLE "${TABLE}" DROP COLUMN "turnedOffByUserId"`,
    ]);
  });
});

describe("AddComplianceSettingTurnedOffByKey1809184940100: the key", () => {
  test("the model declares the key's SET NULL to User", () => {
    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === DataSecurityComplianceSetting &&
            candidate.propertyName === "turnedOffByUser"
          );
        },
      );

    // The person going leaves the setting, saying nobody turned it off.
    expect(relation?.options?.onDelete).toBe("SET NULL");
    expect((relation?.type as () => unknown)()).toBe(User);
  });

  test("adds the key online, outside a transaction", async () => {
    const migration: AddComplianceSettingTurnedOffByKey1809184940100 =
      new AddComplianceSettingTurnedOffByKey1809184940100();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${KEY_STATEMENT}`]);
  });

  test("OnlineDdl adds the key NOT VALID, then validates it on its own", () => {
    const parsed: ReturnType<typeof OnlineDdl.parseAddForeignKey> =
      OnlineDdl.parseAddForeignKey(KEY_STATEMENT);

    expect(parsed.addNotValid).toBe(`${KEY_STATEMENT} NOT VALID`);
    expect(parsed.validate).toBe(
      `ALTER TABLE "${TABLE}" VALIDATE CONSTRAINT "${KEY_NAME}"`,
    );
  });

  test("down drops the key", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddComplianceSettingTurnedOffByKey1809184940100().down(
          runner,
        );
      }),
    ).toEqual([`ALTER TABLE "${TABLE}" DROP CONSTRAINT "${KEY_NAME}"`]);
  });
});

describe("both are registered", () => {
  test("once each, the columns before their key, each numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddComplianceSettingTurnedOffBy1809184940000,
      AddComplianceSettingTurnedOffByKey1809184940100,
    ]) {
      expect(
        registered.filter((candidate: unknown): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);

      const position: number = registered.indexOf(migration);
      const timestamps: Array<number> = registered
        .slice(0, position)
        .map(timestampOf);

      expect(Math.max(...timestamps)).toBeLessThan(timestampOf(migration));
    }

    expect(
      registered.indexOf(AddComplianceSettingTurnedOffBy1809184940000),
    ).toBeLessThan(
      registered.indexOf(AddComplianceSettingTurnedOffByKey1809184940100),
    );
    expect(new AddComplianceSettingTurnedOffBy1809184940000().name).toBe(
      "AddComplianceSettingTurnedOffBy1809184940000",
    );
    expect(new AddComplianceSettingTurnedOffByKey1809184940100().name).toBe(
      "AddComplianceSettingTurnedOffByKey1809184940100",
    );
  });
});

describe("the model declares who and when", () => {
  test("a user's id and relation, and a time, each nullable", () => {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();

    expect(setting.getTableColumnMetadata("turnedOffByUserId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(setting.getTableColumnMetadata("turnedOffByUser").type).toBe(
      TableColumnType.Entity,
    );
    expect(setting.getTableColumnMetadata("turnedOffAt").type).toBe(
      TableColumnType.Date,
    );

    for (const column of ["turnedOffByUserId", "turnedOffAt"]) {
      const args: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: ColumnMetadataArgs): boolean => {
            return (
              candidate.target === DataSecurityComplianceSetting &&
              candidate.propertyName === column
            );
          },
        );

      expect([column, args?.options.nullable]).toEqual([column, true]);
    }
  });

  test("only OneUptime writes them, and whoever reads the setting reads them", () => {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();

    for (const column of [
      "turnedOffByUserId",
      "turnedOffByUser",
      "turnedOffAt",
    ]) {
      const access: {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      } =
        (setting.getColumnAccessControlFor(column) as unknown as {
          create?: Array<unknown>;
          read?: Array<unknown>;
          update?: Array<unknown>;
        }) || {};

      expect([column, access.create]).toEqual([column, []]);
      expect([column, access.update]).toEqual([column, []]);
      expect([column, access.read]).toEqual([
        column,
        (
          setting.getColumnAccessControlFor("note") as unknown as {
            read?: Array<unknown>;
          }
        ).read,
      ]);
    }
  });
});
