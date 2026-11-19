import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import ManagedDevice from "../../../../Models/DatabaseModels/ManagedDevice";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddManagedDevicePlatform1809186720000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186720000-AddManagedDevicePlatform";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { MANAGED_DEVICE_PLATFORMS } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";

/*
 * The migration behind ManagedDevice.platform (#9837): what an imported
 * device runs, now that an Esper connection imports Apple devices beside
 * Android ones.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently and ordered after every migration
 * already registered, or it silently never runs. The model's column is held
 * to what the migration made: nullable text, written by OneUptime only.
 */

const MIGRATION_TIMESTAMP: string = "1809186720000";

const MIGRATION_BASE_NAME: string = "AddManagedDevicePlatform";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "ManagedDevice" ADD "platform" character varying(100)`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "ManagedDevice" DROP COLUMN "platform"`,
];

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

const makeQueryRunner: () => MakeQueryRunnerResult =
  (): MakeQueryRunnerResult => {
    const statements: Array<string> = [];

    const query: (...args: Array<unknown>) => Promise<undefined> = (
      ...args: Array<unknown>
    ): Promise<undefined> => {
      statements.push(String(args[0]));
      return Promise.resolve(undefined);
    };

    return {
      runner: { query } as unknown as QueryRunner,
      statements,
    };
  };

async function upStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddManagedDevicePlatform1809186720000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddManagedDevicePlatform1809186720000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the one column and does nothing else", async () => {
    expect(await upStatements()).toEqual(UP_SQL);
  });

  test("down() drops exactly that column", async () => {
    expect(await downStatements()).toEqual(DOWN_SQL);
  });

  /*
   * Additive and nullable, with no default: nothing is rewritten and
   * nothing blocks. A row read before it has no platform, which reads as
   * Android, and its connection's next read writes it.
   */
  test("it does not backfill, require a value, default one, or build an index or a key", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("CONSTRAINT");
      expect(statement).not.toContain("FOREIGN KEY");
    }
  });

  test("every statement is a complete, single statement", async () => {
    const statements: Array<string> = [
      ...(await upStatements()),
      ...(await downStatements()),
    ];

    expect(statements).toHaveLength(2);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddManagedDevicePlatform1809186720000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddManagedDevicePlatform1809186720000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddManagedDevicePlatform1809186720000;
      }),
    ).toHaveLength(1);
  });

  // TypeORM records applied migrations by `name`: a mismatch re-runs it on every boot.
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddManagedDevicePlatform1809186720000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddManagedDevicePlatform1809186720000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddManagedDevicePlatform1809186720000.name.match(CLASS_TIMESTAMP)?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddManagedDevicePlatform1809186720000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    expect(earlierTimestamps.length).toBeGreaterThan(100);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});

describe("the model's column", () => {
  const device: ManagedDevice = new ManagedDevice();

  test("is written by OneUptime only, and read by whoever reads the device", () => {
    const control: ColumnAccessControl | null =
      device.getColumnAccessControlFor("platform");
    const osVersion: ColumnAccessControl | null =
      device.getColumnAccessControlFor("osVersion");

    expect(control).not.toBeNull();
    expect(control?.create).toEqual([]);
    expect(control?.update).toEqual([]);
    expect([...(control?.read || [])].sort()).toEqual(
      [...(osVersion?.read || [])].sort(),
    );
  });

  test("is optional text, one of the platforms OneUptime names", () => {
    const metadata: ReturnType<ManagedDevice["getTableColumnMetadata"]> =
      device.getTableColumnMetadata("platform");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(false);
    expect(metadata.allowedValues).toEqual([...MANAGED_DEVICE_PLATFORMS]);
  });
});
