import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddScheduledMaintenanceTemplateTimezone1809186700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186700000-AddScheduledMaintenanceTemplateTimezone";
import ScheduledMaintenanceTemplate from "../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Permission from "../../../../Types/Permission";
import Timezone from "../../../../Types/Timezone";
import MaintenanceTemplateSchedule from "../../../../Types/ScheduledMaintenance/MaintenanceTemplateSchedule";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The migration behind ScheduledMaintenanceTemplate.timezone: the time zone
 * a recurring template's schedule is read on, so its events keep their time
 * of day and their day of the month (MaintenanceTemplateSchedule, #10037).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. The column is NOT NULL with the
 * default 'UTC', so every template saved before it reads UTC - the clock its
 * events were stepped on until now, so no hourly, daily or weekly template's
 * next event moves - and Postgres writes no row to add it (a constant
 * default is kept in the catalogue). Nothing else is touched: no next event
 * time is moved. AddScheduledMaintenanceTemplateTimezonePostgres runs it on
 * real rows. Beyond the SQL, the migration has to be registered, named
 * consistently and ordered after every migration already registered, or it
 * silently never runs. (The statement was generated with npm run
 * generate-postgres-migration, and the schema drift check finds nothing
 * left to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1809186700000";

const MIGRATION_BASE_NAME: string = "AddScheduledMaintenanceTemplateTimezone";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
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
  await new AddScheduledMaintenanceTemplateTimezone1809186700000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddScheduledMaintenanceTemplateTimezone1809186700000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the one text column, as long as a time zone name may be, UTC for every template already saved", async () => {
    expect(await upStatements()).toEqual([
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "timezone" character varying(100) NOT NULL DEFAULT 'UTC'`,
    ]);
  });

  test("down() drops exactly that column", async () => {
    expect(await downStatements()).toEqual([
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "timezone"`,
    ]);
  });

  /*
   * No UPDATE of the table under ADD COLUMN's lock, no index, and no next
   * event time moved: a template's next event stays where it was, and the
   * job reads it on the template's clock from then on.
   */
  test("it rewrites no row, builds no index and moves no next event", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("scheduleNextEventAt");
      expect(statement).not.toContain("firstEvent");
    }
  });

  test("its default is the zone every template saved before was stepped on", async () => {
    expect((await upStatements())[0]).toContain(
      `DEFAULT '${MaintenanceTemplateSchedule.DEFAULT_TIMEZONE}'`,
    );
    expect(MaintenanceTemplateSchedule.DEFAULT_TIMEZONE).toBe(Timezone.UTC);
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
      new AddScheduledMaintenanceTemplateTimezone1809186700000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddScheduledMaintenanceTemplateTimezone1809186700000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the column it adds", () => {
  const metadata: TableColumnMetadata =
    new ScheduledMaintenanceTemplate().getTableColumnMetadata("timezone");

  function columnArgs(propertyName: string): ColumnMetadataArgs | undefined {
    return getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return (
          column.target === ScheduledMaintenanceTemplate &&
          column.propertyName === propertyName
        );
      },
    );
  }

  test("is the model's NOT NULL short text column defaulting to UTC, as the migration makes it", () => {
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBeFalsy();

    const args: ColumnMetadataArgs | undefined = columnArgs("timezone");
    expect(args?.options.nullable).toBe(false);
    expect(args?.options.length).toBe(ColumnLength.ShortText);
    expect(ColumnLength.ShortText).toBe(100);
    expect(args?.options.default).toBe(Timezone.UTC);
  });

  test("tells API readers what it is, what a new template gets, and what older ones read", () => {
    expect(metadata.title).toBe("Timezone");
    expect(metadata.description).toContain("IANA time zone");
    expect(metadata.description).toContain("time of day");
    expect(metadata.description).toContain("daylight saving time");
    expect(metadata.description).toContain("day of the month");
    expect(metadata.description).toContain("creator's profile");
    expect(metadata.description).toContain("UTC");
    expect(metadata.example).toBe("Europe/Berlin");
  });

  /*
   * Whoever may set or change the template's schedule may set or change its
   * time zone, and whoever may read the schedule may read it: the same lists
   * as How Often.
   */
  test("is read, created and changed by exactly who reads, creates and changes how often a template recurs", () => {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    const accessOf: (
      column: string,
    ) => Record<string, Array<Permission> | undefined> = (
      column: string,
    ): Record<string, Array<Permission> | undefined> => {
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = template.getColumnAccessControlFor(column) || {};

      return {
        create: [...(access.create || [])].sort(),
        read: [...(access.read || [])].sort(),
        update: [...(access.update || [])].sort(),
      };
    };

    expect(accessOf("timezone")).toEqual(accessOf("recurringInterval"));
    expect(accessOf("timezone")["update"]).toContain(
      Permission.EditScheduledMaintenanceTemplate,
    );
    expect(accessOf("timezone")["read"]).toContain(
      Permission.ReadScheduledMaintenanceTemplate,
    );
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
    expect(SchemaMigrations).toContain(
      AddScheduledMaintenanceTemplateTimezone1809186700000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return (
          migration === AddScheduledMaintenanceTemplateTimezone1809186700000
        );
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(
      new AddScheduledMaintenanceTemplateTimezone1809186700000().name,
    ).toBe(MIGRATION_CLASS_NAME);
    expect(AddScheduledMaintenanceTemplateTimezone1809186700000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddScheduledMaintenanceTemplateTimezone1809186700000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
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
      AddScheduledMaintenanceTemplateTimezone1809186700000,
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
