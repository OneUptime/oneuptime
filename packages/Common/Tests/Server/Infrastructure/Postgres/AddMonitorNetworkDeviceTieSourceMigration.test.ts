import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddMonitorNetworkDeviceTieSource1809186700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186700000-AddMonitorNetworkDeviceTieSource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind Monitor.networkDeviceTieSource (OneUptime issue
 * #9904): who set a monitor's Network Device, OneUptime or a person, so
 * OneUptime works its own tie out again when the monitor's probes change and
 * never changes a person's.
 *
 * One nullable column with no default: adding it to "Monitor", which every
 * probe result writes, rewrites nothing and reads no row, so it needs none of
 * OnlineDdl. It has no index: it is only read with its monitor. The
 * statements run against a fake QueryRunner; the name is the model's, so the
 * drift check finds nothing to change.
 */

const TABLE: string = "Monitor";
const COLUMN: string = "networkDeviceTieSource";
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

describe("AddMonitorNetworkDeviceTieSource1809186700000", () => {
  test("adds the column to Monitor, nullable short text, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddMonitorNetworkDeviceTieSource1809186700000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD "${COLUMN}" character varying(${ColumnLength.ShortText})`,
    ]);
  });

  test("sets no default, no NOT NULL, no index and writes no row", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddMonitorNetworkDeviceTieSource1809186700000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddMonitorNetworkDeviceTieSource1809186700000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "${TABLE}" DROP COLUMN "${COLUMN}"`]);
  });

  test("is registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddMonitorNetworkDeviceTieSource1809186700000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddMonitorNetworkDeviceTieSource1809186700000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddMonitorNetworkDeviceTieSource1809186700000));
    expect(new AddMonitorNetworkDeviceTieSource1809186700000().name).toBe(
      "AddMonitorNetworkDeviceTieSource1809186700000",
    );
  });
});

describe("the model declares the column the migration adds", () => {
  test("a nullable short text column, read on a relation query", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === Monitor && candidate.propertyName === COLUMN
          );
        },
      );

    expect(column?.options?.nullable).toBe(true);
    expect(column?.options?.length).toBe(ColumnLength.ShortText);
    expect(column?.options?.default).toBeUndefined();

    const monitor: Monitor = new Monitor();
    expect(monitor.getTableColumnMetadata(COLUMN).type).toBe(
      TableColumnType.ShortText,
    );
    expect(monitor.getTableColumnMetadata(COLUMN).canReadOnRelationQuery).toBe(
      true,
    );

    // No index names it: it is only read with its monitor.
    expect(
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === Monitor &&
            Array.isArray(index.columns) &&
            index.columns.includes(COLUMN)
          );
        },
      ),
    ).toEqual([]);
  });

  test("is OneUptime's alone to write, and a monitor's readers read it", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      (new Monitor().getColumnAccessControlFor(COLUMN) as unknown as {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      }) || {};

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadProjectMonitor,
      ]),
    );
  });
});
