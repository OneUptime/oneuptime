import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import ProxmoxResource from "../../../../Models/DatabaseModels/ProxmoxResource";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProxmoxGuestPowerTask1809186941017 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186941017-AddProxmoxGuestPowerTask";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind ProxmoxResource.lastPowerTask* and powerTaskReadAt
 * (#10017): a stopped guest's last power task from the cluster's task log,
 * as the Proxmox AI agent reads it, so a guest that should be running says
 * who or what stopped it, and when.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently, and ordered after every migration
 * already registered, or it silently never runs. The model's columns are
 * held to what the migration made: optional, read like the inventory's other
 * columns, and written by nobody but OneUptime's ingest
 * (ProxmoxResourceService.recordGuestPowerTasks).
 */

const MIGRATION_TIMESTAMP: string = "1809186941017";

const MIGRATION_BASE_NAME: string = "AddProxmoxGuestPowerTask";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskType" character varying(100)`,
  `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskUser" character varying(100)`,
  `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskStatus" character varying(500)`,
  `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskAt" TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE "ProxmoxResource" ADD "powerTaskReadAt" TIMESTAMP WITH TIME ZONE`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "ProxmoxResource" DROP COLUMN "powerTaskReadAt"`,
  `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskAt"`,
  `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskStatus"`,
  `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskUser"`,
  `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskType"`,
];

const COLUMNS: Array<[string, TableColumnType]> = [
  ["lastPowerTaskType", TableColumnType.ShortText],
  ["lastPowerTaskUser", TableColumnType.ShortText],
  ["lastPowerTaskStatus", TableColumnType.LongText],
  ["lastPowerTaskAt", TableColumnType.Date],
  ["powerTaskReadAt", TableColumnType.Date],
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
  await new AddProxmoxGuestPowerTask1809186941017().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddProxmoxGuestPowerTask1809186941017().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the five columns and does nothing else", async () => {
    expect(await upStatements()).toEqual(UP_SQL);
  });

  test("down() drops exactly those columns, in reverse", async () => {
    expect(await downStatements()).toEqual(DOWN_SQL);
  });

  // Additive and nullable: no backfill, no default, no NOT NULL, no index or key.
  test("it does not backfill, require a value, or build an index or a key", async () => {
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

    expect(statements).toHaveLength(10);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddProxmoxGuestPowerTask1809186941017();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProxmoxGuestPowerTask1809186941017.prototype,
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
    expect(SchemaMigrations).toContain(AddProxmoxGuestPowerTask1809186941017);
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddProxmoxGuestPowerTask1809186941017;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddProxmoxGuestPowerTask1809186941017().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddProxmoxGuestPowerTask1809186941017.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddProxmoxGuestPowerTask1809186941017.name.match(CLASS_TIMESTAMP)?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddProxmoxGuestPowerTask1809186941017,
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

    // Math.max() of an empty list is -Infinity; prove the list was read.
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});

describe("the model's columns", () => {
  const resource: ProxmoxResource = new ProxmoxResource();
  // The inventory's other columns, which these are read beside.
  const lastBackup: ColumnAccessControl | null =
    resource.getColumnAccessControlFor("lastBackupStatus");

  test.each(COLUMNS)(
    "%s is read like the rest of the inventory, and written by nobody but OneUptime",
    (column: string) => {
      const control: ColumnAccessControl | null =
        resource.getColumnAccessControlFor(column);

      expect(control).not.toBeNull();
      expect(control?.create).toEqual([]);
      expect(control?.update).toEqual([]);
      expect(control?.read).toEqual(lastBackup?.read);
      expect(control?.read?.length).toBeGreaterThan(0);
    },
  );

  test.each(COLUMNS)(
    "%s is optional, of the type the migration makes",
    (column: string, type: TableColumnType) => {
      const metadata: ReturnType<ProxmoxResource["getTableColumnMetadata"]> =
        resource.getTableColumnMetadata(column);

      expect(metadata.type).toBe(type);
      expect(metadata.required).toBeFalsy();
      expect(metadata.canReadOnRelationQuery).toBe(true);
    },
  );
});
