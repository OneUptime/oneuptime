import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddOnCallFireDrillResults1809183100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183100000-AddOnCallFireDrillResults";
import { AddOnCallFireDrillResultsIndexAndKey1809183110000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183110000-AddOnCallFireDrillResultsIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE MIGRATIONS BEHIND A FIRE DRILL'S KEPT RESULTS (#9386): each policy's
 * test a monitor's fire drill starts keeps the drill, the monitor and the
 * failure it rehearsed (OnCallDutyPolicyExecutionLog.testPageFireDrill*).
 *
 *   - AddOnCallFireDrillResults adds the three columns: nullable, with no
 *     default - nothing rewritten, nothing blocked, every run there was no
 *     fire drill's - in an ordinary migration.
 *   - AddOnCallFireDrillResultsIndexAndKey builds the index a monitor's last
 *     drill is read by, and the key to the monitor, online and outside a
 *     transaction: the table holds every page there ever was, and is written
 *     on every page (Docs/migrations/README.md).
 *
 * Pure SQL-contract assertions against a fake QueryRunner, OnlineDdl's steps
 * recorded as "online: <statement>". The names are TypeORM's own, so the
 * drift check finds nothing to change; OnCallFireDrillPostgres runs both on
 * a migrated Postgres.
 */

const TABLE: string = "OnCallDutyPolicyExecutionLog";

// The 13-digit timestamp a migration class is named with.
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const MONITOR_INDEX: string = namingStrategy.indexName(
  TABLE,
  ["testPageFireDrillMonitorId", "createdAt"],
  '"testPageFireDrillMonitorId" IS NOT NULL',
);

const MONITOR_KEY: string = namingStrategy.foreignKeyName(
  TABLE,
  ["testPageFireDrillMonitorId"],
  "Monitor",
  ["_id"],
);

const COLUMNS_UP: Array<string> = [
  `ALTER TABLE "${TABLE}" ADD "testPageFireDrillId" uuid`,
  `ALTER TABLE "${TABLE}" ADD "testPageFireDrillMonitorId" uuid`,
  `ALTER TABLE "${TABLE}" ADD "testPageFireDrillFailure" jsonb`,
];

const INDEX_STATEMENT: string = `CREATE INDEX "${MONITOR_INDEX}" ON "${TABLE}" ("testPageFireDrillMonitorId", "createdAt") WHERE "testPageFireDrillMonitorId" IS NOT NULL`;

const KEY_STATEMENT: string = `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${MONITOR_KEY}" FOREIGN KEY ("testPageFireDrillMonitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean } = { isTransactionActive: false },
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
    isTransactionActive: options.isTransactionActive,
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

describe("AddOnCallFireDrillResults1809183100000: the columns", () => {
  test("adds the three nullable columns, with no default and no index or key", async () => {
    const migration: AddOnCallFireDrillResults1809183100000 =
      new AddOnCallFireDrillResults1809183100000();

    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual(COLUMNS_UP);
    // An ordinary migration: adding a nullable column takes an instant.
    expect(
      (migration as MigrationInterface & { transaction?: boolean }).transaction,
    ).toBeUndefined();
  });

  test("down() drops them again, in the reverse order", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddOnCallFireDrillResults1809183100000().down(runner);
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `ALTER TABLE "${TABLE}" DROP COLUMN "testPageFireDrillFailure"`,
      `ALTER TABLE "${TABLE}" DROP COLUMN "testPageFireDrillMonitorId"`,
      `ALTER TABLE "${TABLE}" DROP COLUMN "testPageFireDrillId"`,
    ]);
  });

  test("the model has them, nullable and of the types the columns are", () => {
    const model: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    expect(model.getTableColumnMetadata("testPageFireDrillId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(
      model.getTableColumnMetadata("testPageFireDrillMonitorId").type,
    ).toBe(TableColumnType.ObjectID);
    expect(model.getTableColumnMetadata("testPageFireDrillFailure").type).toBe(
      TableColumnType.JSON,
    );

    for (const column of [
      "testPageFireDrillId",
      "testPageFireDrillMonitorId",
      "testPageFireDrillFailure",
    ]) {
      const declared: { options: { nullable?: boolean } } | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: { target: unknown; propertyName: string }): boolean => {
            return (
              candidate.target === OnCallDutyPolicyExecutionLog &&
              candidate.propertyName === column
            );
          },
        ) as { options: { nullable?: boolean } } | undefined;

      expect({ column, nullable: declared?.options.nullable }).toEqual({
        column,
        nullable: true,
      });
    }
  });
});

describe("AddOnCallFireDrillResultsIndexAndKey1809183110000: the index and the key", () => {
  test("they are named as TypeORM names them", () => {
    expect(MONITOR_INDEX).toBe("IDX_4820183028729f3fceae04dafd");
    expect(MONITOR_KEY).toBe("FK_d75b2b6de2c8cf161836d749833");
  });

  test("the model declares the partial index, the monitor's column first, and the key's SET NULL", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === OnCallDutyPolicyExecutionLog &&
            JSON.stringify(index.columns) ===
              JSON.stringify(["testPageFireDrillMonitorId", "createdAt"])
          );
        },
      );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.where).toBe('"testPageFireDrillMonitorId" IS NOT NULL');

    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === OnCallDutyPolicyExecutionLog &&
            candidate.propertyName === "testPageFireDrillMonitor"
          );
        },
      );

    // The policy's tests stay in its history when the monitor goes.
    expect(relation?.options?.onDelete).toBe("SET NULL");
  });

  test("builds the index, then adds the key - both online, outside a transaction", async () => {
    const migration: AddOnCallFireDrillResultsIndexAndKey1809183110000 =
      new AddOnCallFireDrillResultsIndexAndKey1809183110000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${INDEX_STATEMENT}`, `online: ${KEY_STATEMENT}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(INDEX_STATEMENT);

    expect(parsed.name).toBe(MONITOR_INDEX);
    expect(parsed.quotedTable).toBe(`"${TABLE}"`);
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${MONITOR_INDEX}" ON "${TABLE}" ("testPageFireDrillMonitorId", "createdAt") WHERE "testPageFireDrillMonitorId" IS NOT NULL`,
    );
  });

  test("OnlineDdl adds the key NOT VALID, then validates it on its own", () => {
    const parsed: ReturnType<typeof OnlineDdl.parseAddForeignKey> =
      OnlineDdl.parseAddForeignKey(KEY_STATEMENT);

    expect(parsed.addNotValid).toBe(`${KEY_STATEMENT} NOT VALID`);
    expect(parsed.validate).toBe(
      `ALTER TABLE "${TABLE}" VALIDATE CONSTRAINT "${MONITOR_KEY}"`,
    );
  });

  test("down() drops the key, then the index", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddOnCallFireDrillResultsIndexAndKey1809183110000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT "${MONITOR_KEY}"`,
      `online: DROP INDEX "public"."${MONITOR_INDEX}"`,
    ]);
  });
});

describe("both are registered", () => {
  test("once each, the columns before the index and the key, each numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddOnCallFireDrillResults1809183100000,
      AddOnCallFireDrillResultsIndexAndKey1809183110000,
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
      registered.indexOf(AddOnCallFireDrillResults1809183100000),
    ).toBeLessThan(
      registered.indexOf(AddOnCallFireDrillResultsIndexAndKey1809183110000),
    );
    expect(new AddOnCallFireDrillResults1809183100000().name).toBe(
      "AddOnCallFireDrillResults1809183100000",
    );
    expect(new AddOnCallFireDrillResultsIndexAndKey1809183110000().name).toBe(
      "AddOnCallFireDrillResultsIndexAndKey1809183110000",
    );
  });
});
