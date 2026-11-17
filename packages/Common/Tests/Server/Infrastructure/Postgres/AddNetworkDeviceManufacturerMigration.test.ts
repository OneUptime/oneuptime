import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../../../Types/Permission";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkDeviceManufacturer1809182980000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182980000-AddNetworkDeviceManufacturer";

/*
 * THE MAKER A DEVICE IS LISTED UNDER (OneUptime issue #9363): the migration
 * that adds NetworkDevice.manufacturer, the maker the Devices list's Vendor /
 * Model column, the device's page and its Inventory item show, kept on the
 * device so the lists' Vendor filter and sort find it under that maker.
 *
 *  - nullable, with no default and no index: adding it rewrites no row and
 *    blocks no poll, and NULL reads as "no maker" until the backfill
 *    (BackfillNetworkDeviceManufacturer) or the device's next write fills it
 *    in;
 *  - as wide as the vendor it is most often taken from;
 *  - nobody writes it but the server; whoever reads a device's vendor reads
 *    it, which is what the Vendor filter and sort are held to;
 *  - the migration is registered, named consistently and ordered after
 *    every migration registered before it, or it silently never runs and
 *    every write of a device's details fails on a missing column.
 */

const MIGRATION_TIMESTAMP: string = "1809182980000";
const MIGRATION_BASE_NAME: string = "AddNetworkDeviceManufacturer";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const COLUMN: string = "manufacturer";

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

  await new AddNetworkDeviceManufacturer1809182980000()[step](runner);

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
      `ALTER TABLE "NetworkDevice" ADD "${COLUMN}" character varying(100)`,
    ]);
  });

  test("down() takes it back", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "NetworkDevice" DROP COLUMN "${COLUMN}"`,
    ]);
  });

  /*
   * The lists filter by it with ILIKE, which no B-tree serves, and sort a
   * project's devices by it as they sorted by the vendor, which has none
   * either. No index, so no online DDL is owed.
   */
  test("adds no index, default or foreign key, so no online DDL is owed", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/INDEX|DEFAULT|NOT NULL|FOREIGN KEY/);
    }
  });
});

describe("the column it makes", () => {
  test("matches the model: a nullable short text as wide as the vendor", () => {
    const column: ColumnMetadataArgs | undefined = columnOf(COLUMN);
    const vendor: ColumnMetadataArgs | undefined = columnOf("vendor");

    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
    expect(column?.options.type).toBe(vendor?.options.type);
    expect(column?.options.length).toBe(vendor?.options.length);
  });

  test("nobody writes it but the server; whoever reads the vendor reads it", () => {
    const access: ColumnAccess = accessOf(COLUMN);

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect([...access.read].sort()).toEqual(
      [...accessOf("vendor").read].sort(),
    );
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddNetworkDeviceManufacturer1809182980000().name).toBe(
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
