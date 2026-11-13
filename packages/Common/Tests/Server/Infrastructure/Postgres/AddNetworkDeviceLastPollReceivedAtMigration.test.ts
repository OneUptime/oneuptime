import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../../../Types/Permission";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkDeviceLastPollReceivedAt1809123800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123800000-AddNetworkDeviceLastPollReceivedAt";

/*
 * THE GUARD COLUMN OF A DEVICE'S POLL VERDICT (OneUptime issue #7389): the
 * migration that adds NetworkDevice.lastPollReceivedAt, when OneUptime
 * received the poll whose verdict the row holds. The verdict is written only
 * by a poll received after it, so an older poll processed after a newer one
 * no longer overwrites the newer one's reachability.
 *
 *  - nullable, with no default: adding it rewrites no row, and NULL means
 *    no verdict carries a receipt time yet - the next poll writes one;
 *  - nobody writes it but the poll pipeline; whoever reads the device's
 *    lastPolledAt reads it too;
 *  - the migration is registered, named consistently and ordered after
 *    every migration registered before it, or it silently never runs and
 *    every poll's verdict write fails on a missing column.
 */

const MIGRATION_TIMESTAMP: string = "1809123800000";
const MIGRATION_BASE_NAME: string = "AddNetworkDeviceLastPollReceivedAt";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const COLUMN: string = "lastPollReceivedAt";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

interface ColumnAccess {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
}

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddNetworkDeviceLastPollReceivedAt1809123800000()[step](runner);

  return statements;
}

function columnOf(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === NetworkDevice && column.propertyName === propertyName
      );
    },
  );
}

function accessOf(propertyName: string): ColumnAccess {
  return new NetworkDevice().getColumnAccessControlFor(
    propertyName,
  ) as unknown as ColumnAccess;
}

describe("executing it", () => {
  test("up() adds the column, nullable and with no default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "NetworkDevice" ADD "${COLUMN}" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down() takes it back", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "NetworkDevice" DROP COLUMN "${COLUMN}"`,
    ]);
  });

  // The guard reads one row by its primary key: no index is owed.
  test("adds no index, default or foreign key, so no online DDL is owed", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/INDEX|DEFAULT|NOT NULL|FOREIGN KEY/);
    }
  });
});

describe("the column it makes", () => {
  test("matches the model: a nullable time with a zone, like lastPolledAt", () => {
    const column: ColumnMetadataArgs | undefined = columnOf(COLUMN);
    const lastPolledAt: ColumnMetadataArgs | undefined =
      columnOf("lastPolledAt");

    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
    expect(column?.options.type).toBe(lastPolledAt?.options.type);
  });

  test("nobody writes it but the poll pipeline; whoever reads lastPolledAt reads it", () => {
    const access: ColumnAccess = accessOf(COLUMN);

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect([...access.read].sort()).toEqual(
      [...accessOf("lastPolledAt").read].sort(),
    );
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddNetworkDeviceLastPollReceivedAt1809123800000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered once, after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);
    expect(names.lastIndexOf(MIGRATION_CLASS_NAME)).toBe(position);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });
});
