/**
 * NetworkDevice.discoveredName and NetworkDevice.discoveredNameSource
 * (OneUptime issue #4518).
 *
 * The name a discovery scan gave a device, and where it came from. A later
 * scan renames a device only while its name is still exactly the discovered
 * one, and only to a name from a better source — so a name a person typed is
 * never touched. What is pinned here:
 *
 *   - NOT REQUIRED, NULLABLE, NO DEFAULT. Every device made by hand, and every
 *     device imported before #4518, has neither — and that is what keeps an
 *     upgrade from renaming anything: NULL reads as "discovery did not name
 *     this device".
 *   - CREATED AND READ LIKE `name`, UPDATED BY NOBODY. The Review dialog
 *     imports with the operator's own permissions, and the create hook
 *     writes discoveredName beside the name before column permissions are
 *     checked; a narrower create rule would refuse the operator's import.
 *     After create only the server writes them (the rename pass, as root):
 *     a user who could would be able to mark a name they typed as
 *     discovered, and a later scan would rename it.
 *   - LEFT OUT OF THE TERRAFORM CONFIGURATION the dashboard writes: it is the
 *     server's record, not a setting a configuration should pin.
 *   - THE MIGRATION adds exactly these two nullable columns, and drops them.
 */

import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import {
  SERVER_MANAGED_COLUMNS_BY_TABLE,
  isServerManagedColumn,
} from "../../Utils/DeveloperDocs/TerraformSchema";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkDeviceDiscoveredName1800900000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1800900000000-AddNetworkDeviceDiscoveredName";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const NAME_COLUMN: string = "discoveredName";

// The 13-digit timestamp a migration class name ends with.
const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const SOURCE_COLUMN: string = "discoveredNameSource";

function metadata(column: string): TableColumnMetadata {
  return new NetworkDevice().getTableColumnMetadata(column);
}

function typeOrmColumn(column: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
    return args.target === NetworkDevice && args.propertyName === column;
  });
}

function accessControlFor(column: string): ColumnAccessControl | null {
  return new NetworkDevice().getColumnAccessControlFor(column);
}

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

function makeQueryRunner(): MakeQueryRunnerResult {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements: statements,
  };
}

describe.each([NAME_COLUMN, SOURCE_COLUMN])(
  "NetworkDevice.%s",
  (column: string) => {
    test("is an optional short-text column", () => {
      expect(metadata(column).type).toBe(TableColumnType.ShortText);
      expect(metadata(column).required).toBeFalsy();
      expect(typeOrmColumn(column)?.options.type).toBe(ColumnType.ShortText);
      expect(typeOrmColumn(column)?.options.length).toBe(
        ColumnLength.ShortText,
      );
    });

    test("is nullable with no default, so every existing device reads as not named by discovery", () => {
      expect(typeOrmColumn(column)?.options.nullable).toBe(true);
      expect(typeOrmColumn(column)?.options.default).toBeUndefined();
      expect(metadata(column).defaultValue).toBeUndefined();
      expect(
        (new NetworkDevice() as unknown as Record<string, unknown>)[column],
      ).toBeUndefined();
    });

    test("is created and read with exactly the device name's permissions", () => {
      const access: ColumnAccessControl | null = accessControlFor(column);
      const nameAccess: ColumnAccessControl | null = accessControlFor("name");

      expect(nameAccess?.create.length).toBeGreaterThan(0);
      expect(access?.create).toEqual(nameAccess?.create);
      expect(access?.read).toEqual(nameAccess?.read);
    });

    test("is never updated by a user, however much of the device they may edit", () => {
      expect(accessControlFor(column)?.update).toEqual([]);
      // ...while the name beside it stays editable.
      expect(accessControlFor("name")?.update.length).toBeGreaterThan(0);
    });

    test("is readable in relation queries, like the name beside it", () => {
      expect(metadata(column).canReadOnRelationQuery).toBe(true);
    });

    test("is left out of the Terraform configuration as server-managed", () => {
      expect(SERVER_MANAGED_COLUMNS_BY_TABLE["NetworkDevice"]).toContain(
        column,
      );
      expect(isServerManagedColumn("NetworkDevice", column)).toBe(true);
    });
  },
);

describe("what the columns say about themselves", () => {
  test("the discovered name is titled and described for the API and the docs", () => {
    expect(metadata(NAME_COLUMN).title).toBe("Discovered Name");

    const description: string = metadata(NAME_COLUMN).description ?? "";

    expect(description).toContain("discovery scan");
    expect(description).toContain("better name");
    expect(description).toContain("Rename the device yourself");
  });

  test("the source's description lists every stored spelling", () => {
    expect(metadata(SOURCE_COLUMN).title).toBe("Discovered Name Source");

    const description: string = metadata(SOURCE_COLUMN).description ?? "";

    for (const source of Object.values(DeviceNameSource)) {
      expect(description).toContain(source);
    }
  });

  test("the source's example is a real stored spelling", () => {
    expect(Object.values(DeviceNameSource)).toContain(
      metadata(SOURCE_COLUMN).example,
    );
  });

  test("the discovered name's example fits the column", () => {
    expect(String(metadata(NAME_COLUMN).example).length).toBeLessThanOrEqual(
      100,
    );
  });
});

describe("the migration", () => {
  const migration: AddNetworkDeviceDiscoveredName1800900000000 =
    new AddNetworkDeviceDiscoveredName1800900000000();

  test("up adds the two nullable varchar(100) columns, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkDevice" ADD "discoveredName" character varying(100)`,
      `ALTER TABLE "NetworkDevice" ADD "discoveredNameSource" character varying(100)`,
    ]);

    for (const statement of statements) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    }
  });

  test("down drops them again, in reverse order", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkDevice" DROP COLUMN "discoveredNameSource"`,
      `ALTER TABLE "NetworkDevice" DROP COLUMN "discoveredName"`,
    ]);
  });

  test("is named after its class and timestamp", () => {
    expect(migration.name).toBe("AddNetworkDeviceDiscoveredName1800900000000");
  });

  test("is registered, and runs after every migration before it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<new () => MigrationInterface>
    ).map((type: new () => MigrationInterface): string => {
      return type.name;
    });

    expect(names).toContain("AddNetworkDeviceDiscoveredName1800900000000");

    const own: number = 1800900000000;
    const index: number = names.indexOf(
      "AddNetworkDeviceDiscoveredName1800900000000",
    );

    // Every migration registered before it is older; every one after, newer.
    names.forEach((name: string, position: number): void => {
      const match: RegExpMatchArray | null = name.match(CLASS_TIMESTAMP);

      if (!match || position === index) {
        return;
      }

      if (position < index) {
        expect(Number(match[1])).toBeLessThan(own);
      } else {
        expect(Number(match[1])).toBeGreaterThan(own);
      }
    });
  });
});
