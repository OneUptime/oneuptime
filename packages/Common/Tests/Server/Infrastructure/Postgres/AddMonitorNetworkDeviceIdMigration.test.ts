import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddMonitorNetworkDeviceId1809184900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184900000-AddMonitorNetworkDeviceId";
import { AddMonitorNetworkDeviceIdIndexAndKey1809184900100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184900100-AddMonitorNetworkDeviceIdIndexAndKey";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migrations behind Monitor.networkDeviceId (OneUptime issue #9545): the
 * network device a monitor a person made checks, so the duplicate check
 * imports run and the device's pages see it.
 *
 *   - AddMonitorNetworkDeviceId adds the column: nullable, no default, so
 *     adding it rewrites nothing.
 *   - AddMonitorNetworkDeviceIdIndexAndKey builds the partial index the tied
 *     monitors are read by, and the key ON DELETE SET NULL - both online,
 *     outside a transaction, because "Monitor" is written by every probe
 *     result (Docs/migrations/README.md).
 *
 * The statements run against a fake QueryRunner, OnlineDdl's own steps
 * stubbed, so what each migration hands it is told apart from what it runs
 * itself. The names are the model's, so the drift check finds nothing to
 * change; both migrations are registered once, in order.
 */

const TABLE: string = "Monitor";
const INDEX_NAME: string = "IDX_monitor_network_device";
const KEY_NAME: string = "FK_monitor_network_device";
const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const INDEX_STATEMENT: string = `CREATE INDEX "${INDEX_NAME}" ON "${TABLE}" ("networkDeviceId") WHERE "networkDeviceId" IS NOT NULL`;

const KEY_STATEMENT: string = `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${KEY_NAME}" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

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

describe("AddMonitorNetworkDeviceId1809184900000: the column", () => {
  test("adds networkDeviceId to Monitor, a nullable uuid, and nothing else", async () => {
    const migration: AddMonitorNetworkDeviceId1809184900000 =
      new AddMonitorNetworkDeviceId1809184900000();

    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`ALTER TABLE "${TABLE}" ADD "networkDeviceId" uuid`]);
  });

  test("builds no index, adds no key or default, and backfills nothing in the schema migration", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddMonitorNetworkDeviceId1809184900000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddMonitorNetworkDeviceId1809184900000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "${TABLE}" DROP COLUMN "networkDeviceId"`]);
  });
});

describe("AddMonitorNetworkDeviceIdIndexAndKey1809184900100: the index and the key", () => {
  test("the model declares the partial index under its name, and the key's SET NULL to NetworkDevice", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === Monitor && index.name === INDEX_NAME;
        },
      );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.columns).toEqual(["networkDeviceId"]);
    expect(indexes[0]!.where).toBe('"networkDeviceId" IS NOT NULL');

    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === Monitor &&
            candidate.propertyName === "networkDevice"
          );
        },
      );

    // A person made the monitor: the device going unties it, nothing more.
    expect(relation?.options?.onDelete).toBe("SET NULL");
    expect((relation?.type as () => unknown)()).toBe(NetworkDevice);
  });

  test("builds the index, then adds the key - both online, outside a transaction", async () => {
    const migration: AddMonitorNetworkDeviceIdIndexAndKey1809184900100 =
      new AddMonitorNetworkDeviceIdIndexAndKey1809184900100();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${INDEX_STATEMENT}`, `online: ${KEY_STATEMENT}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(INDEX_STATEMENT);

    expect(parsed.name).toBe(INDEX_NAME);
    expect(parsed.quotedTable).toBe(`"${TABLE}"`);
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX_NAME}" ON "${TABLE}" ("networkDeviceId") WHERE "networkDeviceId" IS NOT NULL`,
    );
  });

  test("OnlineDdl adds the key NOT VALID, then validates it on its own", () => {
    const parsed: ReturnType<typeof OnlineDdl.parseAddForeignKey> =
      OnlineDdl.parseAddForeignKey(KEY_STATEMENT);

    expect(parsed.addNotValid).toBe(`${KEY_STATEMENT} NOT VALID`);
    expect(parsed.validate).toBe(
      `ALTER TABLE "${TABLE}" VALIDATE CONSTRAINT "${KEY_NAME}"`,
    );
  });

  test("down() drops the key, then the index", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddMonitorNetworkDeviceIdIndexAndKey1809184900100().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT "${KEY_NAME}"`,
      `online: DROP INDEX "public"."${INDEX_NAME}"`,
    ]);
  });
});

describe("both are registered", () => {
  test("once each, the column before its index and key, each numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddMonitorNetworkDeviceId1809184900000,
      AddMonitorNetworkDeviceIdIndexAndKey1809184900100,
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
      registered.indexOf(AddMonitorNetworkDeviceId1809184900000),
    ).toBeLessThan(
      registered.indexOf(AddMonitorNetworkDeviceIdIndexAndKey1809184900100),
    );
    expect(new AddMonitorNetworkDeviceId1809184900000().name).toBe(
      "AddMonitorNetworkDeviceId1809184900000",
    );
    expect(new AddMonitorNetworkDeviceIdIndexAndKey1809184900100().name).toBe(
      "AddMonitorNetworkDeviceIdIndexAndKey1809184900100",
    );
  });
});

describe("the model declares the tie", () => {
  test("an id column and its relation, read on a relation query", () => {
    const monitor: Monitor = new Monitor();

    expect(monitor.getTableColumns().columns).toContain("networkDeviceId");
    expect(monitor.getTableColumnMetadata("networkDeviceId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(
      monitor.getTableColumnMetadata("networkDeviceId").canReadOnRelationQuery,
    ).toBe(true);
    expect(monitor.getTableColumnMetadata("networkDevice").type).toBe(
      TableColumnType.Entity,
    );
  });

  test("whoever may create or edit monitors may set it, and a monitor's readers read it", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      (new Monitor().getColumnAccessControlFor(
        "networkDeviceId",
      ) as unknown as {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      }) || {};

    expect(access.create).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.CreateProjectMonitor,
      ]),
    );
    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.EditProjectMonitor,
      ]),
    );
    expect(access.read).toEqual(
      expect.arrayContaining([
        Permission.Viewer,
        Permission.ReadProjectMonitor,
      ]),
    );
  });
});
