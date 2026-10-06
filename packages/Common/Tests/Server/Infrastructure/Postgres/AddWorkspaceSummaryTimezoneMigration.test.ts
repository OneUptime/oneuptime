import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkspaceSummaryTimezone1798900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798900000000-AddWorkspaceSummaryTimezone";
import WorkspaceNotificationSummary from "../../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Permission from "../../../../Types/Permission";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The migration behind WorkspaceNotificationSummary.timezone: the time zone
 * a workspace summary's schedule is read in, so it goes out at the same time
 * of day all year (WorkspaceSummaryScheduleUtil). Stepped in UTC, a summary
 * set for 09:00 in Berlin went out at 08:00 there once the clocks went back.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. The column is nullable with no
 * default and nothing is backfilled here: a summary without one is read in
 * UTC, as every summary was, and the worker's data migration
 * SetWorkspaceSummaryTimezones gives existing ones their creator's time zone
 * outside this statement's lock on the table. Beyond the SQL, the migration
 * has to be registered, named consistently and ordered after every migration
 * already registered, or it silently never runs. (The statement was
 * generated with npm run generate-postgres-migration, and the schema drift
 * check finds nothing left to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1798900000000";

const MIGRATION_BASE_NAME: string = "AddWorkspaceSummaryTimezone";

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
  await new AddWorkspaceSummaryTimezone1798900000000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddWorkspaceSummaryTimezone1798900000000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the one nullable text column, as long as a time zone name may be", async () => {
    expect(await upStatements()).toEqual([
      `ALTER TABLE "WorkspaceNotificationSummary" ADD "timezone" character varying(100)`,
    ]);
  });

  test("down() drops exactly that column", async () => {
    expect(await downStatements()).toEqual([
      `ALTER TABLE "WorkspaceNotificationSummary" DROP COLUMN "timezone"`,
    ]);
  });

  /*
   * No backfill and no default here: an existing summary keeps reading in
   * UTC until the data migration gives it its creator's time zone, and no
   * UPDATE of the whole table holds ADD COLUMN's lock.
   */
  test("it does not backfill, set a default, move a next send or build an index", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("nextSendAt");
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
      new AddWorkspaceSummaryTimezone1798900000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddWorkspaceSummaryTimezone1798900000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the column it adds", () => {
  const metadata: TableColumnMetadata =
    new WorkspaceNotificationSummary().getTableColumnMetadata("timezone");

  function columnArgs(propertyName: string): ColumnMetadataArgs | undefined {
    return getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return (
          column.target === WorkspaceNotificationSummary &&
          column.propertyName === propertyName
        );
      },
    );
  }

  test("is the model's nullable short text column, as the migration makes it", () => {
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBeFalsy();

    const args: ColumnMetadataArgs | undefined = columnArgs("timezone");
    expect(args?.options.nullable).toBe(true);
    expect(args?.options.length).toBe(ColumnLength.ShortText);
    expect(ColumnLength.ShortText).toBe(100);
    expect(args?.options.default).toBeUndefined();
  });

  test("tells API readers what it is and what it defaults to", () => {
    expect(metadata.title).toBe("Timezone");
    expect(metadata.description).toContain("IANA time zone");
    expect(metadata.description).toContain("same time of day");
    expect(metadata.description).toContain("creator's profile");
    expect(metadata.description).toContain("UTC");
    expect(metadata.example).toBe("Europe/Berlin");
  });

  /*
   * Whoever may set or change the summary's schedule may set or change its
   * time zone, and whoever may read the schedule may read it: the same lists
   * as How Often.
   */
  test("is read, created and changed by exactly who reads, creates and changes how often a summary goes out", () => {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();

    const accessOf: (
      column: string,
    ) => Record<string, Array<Permission> | undefined> = (
      column: string,
    ): Record<string, Array<Permission> | undefined> => {
      const access: {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      } = summary.getColumnAccessControlFor(column) || {};

      return {
        create: [...(access.create || [])].sort(),
        read: [...(access.read || [])].sort(),
        update: [...(access.update || [])].sort(),
      };
    };

    expect(accessOf("timezone")).toEqual(accessOf("recurringInterval"));
    expect(accessOf("timezone")["update"]).toContain(
      Permission.EditWorkspaceNotificationSummary,
    );
    expect(accessOf("timezone")["read"]).toContain(
      Permission.ReadWorkspaceNotificationSummary,
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
      AddWorkspaceSummaryTimezone1798900000000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddWorkspaceSummaryTimezone1798900000000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddWorkspaceSummaryTimezone1798900000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddWorkspaceSummaryTimezone1798900000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddWorkspaceSummaryTimezone1798900000000.name.match(CLASS_TIMESTAMP)?.[1],
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
      AddWorkspaceSummaryTimezone1798900000000,
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
