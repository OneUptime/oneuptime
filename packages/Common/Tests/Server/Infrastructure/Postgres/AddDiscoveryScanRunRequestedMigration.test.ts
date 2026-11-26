import NetworkDeviceDiscoveryScan from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import User from "../../../../Models/DatabaseModels/User";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddDiscoveryScanRunRequested1809187450000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187450000-AddDiscoveryScanRunRequested";
import { AddDiscoveryScanRunRequestedByUserKey1809187450010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187450010-AddDiscoveryScanRunRequestedByUserKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnType from "../../../../Types/Database/ColumnType";
import Permission from "../../../../Types/Permission";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHO RAN A DISCOVERY SCAN AGAIN, AND WHEN (#10334).
 *
 * NetworkDeviceDiscoveryScan.runRequestedAt and runRequestedByUserId: Run
 * Again keeps on the scan who asked for the run on it and when, for every
 * edition. Two nullable columns with no default, so no row is rewritten and
 * every scan saved before reads as one whose run started by itself; and a
 * foreign key to "User", named as TypeORM names it so the schema drift check
 * finds nothing to change, added online in a migration of its own outside a
 * transaction - "User" is written at every sign-in. A deleted user leaves
 * the scan, with nobody named (ON DELETE SET NULL).
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

const FOREIGN_KEY: string = naming.foreignKeyName(
  "NetworkDeviceDiscoveryScan",
  ["runRequestedByUserId"],
  "User",
  ["_id"],
);

const UPDATE_STATEMENT: RegExp = /^UPDATE/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
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

function columnArgs(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return (
        args.target === NetworkDeviceDiscoveryScan &&
        args.propertyName === propertyName
      );
    })
    .pop();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddDiscoveryScanRunRequested1809187450000", () => {
  test("adds the two columns - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDiscoveryScanRunRequested1809187450000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "runRequestedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "runRequestedByUserId" uuid`,
    ]);
  });

  test("never rewrites the table: both columns are nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddDiscoveryScanRunRequested1809187450000().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(UPDATE_STATEMENT);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDiscoveryScanRunRequested1809187450000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "runRequestedByUserId"`,
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "runRequestedAt"`,
    ]);
  });

  test("is registered after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf(
      "AddDiscoveryScanRunRequested1809187450000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddSecurityBlocklistFeeds1809187440000"),
    );
    expect(new AddDiscoveryScanRunRequested1809187450000().name).toBe(
      "AddDiscoveryScanRunRequested1809187450000",
    );
  });
});

describe("AddDiscoveryScanRunRequestedByUserKey1809187450010", () => {
  test("the key is named as TypeORM names it: the drift check finds nothing", () => {
    expect(FOREIGN_KEY).toBe("FK_2983705c44fc5403d90f47ee14b");
  });

  test("adds the key online, outside a transaction; a deleted user leaves the scan", async () => {
    const migration: AddDiscoveryScanRunRequestedByUserKey1809187450010 =
      new AddDiscoveryScanRunRequestedByUserKey1809187450010();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: ALTER TABLE "NetworkDeviceDiscoveryScan" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("runRequestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the key away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDiscoveryScanRunRequestedByUserKey1809187450010().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP CONSTRAINT "${FOREIGN_KEY}"`,
    ]);
  });

  test("is registered right after the columns' migration, once, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddDiscoveryScanRunRequested1809187450000,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddDiscoveryScanRunRequestedByUserKey1809187450010,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddDiscoveryScanRunRequestedByUserKey1809187450010;
      }),
    ).toHaveLength(1);
    expect(new AddDiscoveryScanRunRequestedByUserKey1809187450010().name).toBe(
      "AddDiscoveryScanRunRequestedByUserKey1809187450010",
    );
  });
});

describe("the scan model says the same", () => {
  test("two nullable columns: when, and who", () => {
    expect(columnArgs("runRequestedAt")?.options).toMatchObject({
      nullable: true,
      type: ColumnType.Date,
    });
    expect(columnArgs("runRequestedByUserId")?.options).toMatchObject({
      nullable: true,
      type: ColumnType.ObjectID,
    });
  });

  test("who is a user, and a deleted user leaves the scan with nobody named", () => {
    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return (
          args.target === NetworkDeviceDiscoveryScan &&
          args.propertyName === "runRequestedByUser"
        );
      })
      .pop();

    expect(relation?.relationType).toBe("many-to-one");
    expect(relation?.options.onDelete).toBe("SET NULL");
    expect(relation?.options.nullable).toBe(true);
    expect((relation?.type as () => unknown)()).toBe(User);
  });

  test("only the server writes them, and whoever reads the scan reads them", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    const access: Record<
      string,
      {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      }
    > = scan.getColumnAccessControlForAllColumns() as never;

    for (const column of [
      "runRequestedAt",
      "runRequestedByUserId",
      "runRequestedByUser",
    ]) {
      expect(access[column]?.create).toEqual([]);
      expect(access[column]?.update).toEqual([]);
      // As every column of the scan that says what it reported.
      expect(access[column]?.read).toEqual(access["completedAt"]?.read);
    }

    expect(access["runRequestedAt"]?.read).toContain(Permission.Viewer);
  });
});
