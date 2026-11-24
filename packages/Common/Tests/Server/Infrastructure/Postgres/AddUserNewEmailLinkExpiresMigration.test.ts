import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import User from "../../../../Models/DatabaseModels/User";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddUserNewEmailLinkExpires1809186930000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186930000-AddUserNewEmailLinkExpires";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind User.newUnverifiedTemporaryEmailExpires (#9908):
 * when the link that confirms a waiting change of email address stops
 * working, kept beside the waiting address so User Profile can say the
 * link has expired.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently, and ordered after every migration
 * already registered, or it silently never runs. The model's column is held
 * to what the migration made: an optional moment, which its owner reads and
 * nobody writes - OneUptime writes it with the waiting address
 * (UserService.onUpdatePermitted).
 */

const MIGRATION_TIMESTAMP: string = "1809186930000";

const MIGRATION_BASE_NAME: string = "AddUserNewEmailLinkExpires";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "User" ADD "newUnverifiedTemporaryEmailExpires" TIMESTAMP WITH TIME ZONE`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "User" DROP COLUMN "newUnverifiedTemporaryEmailExpires"`,
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
  await new AddUserNewEmailLinkExpires1809186930000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddUserNewEmailLinkExpires1809186930000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the one column and does nothing else", async () => {
    expect(await upStatements()).toEqual(UP_SQL);
  });

  test("down() drops exactly that column", async () => {
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

    expect(statements).toHaveLength(2);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddUserNewEmailLinkExpires1809186930000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddUserNewEmailLinkExpires1809186930000.prototype,
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
    expect(SchemaMigrations).toContain(AddUserNewEmailLinkExpires1809186930000);
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddUserNewEmailLinkExpires1809186930000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddUserNewEmailLinkExpires1809186930000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddUserNewEmailLinkExpires1809186930000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddUserNewEmailLinkExpires1809186930000.name.match(CLASS_TIMESTAMP)?.[1],
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
      AddUserNewEmailLinkExpires1809186930000,
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

describe("the model's column", () => {
  const user: User = new User();

  test("is read by the account's owner, and written by nobody but OneUptime", () => {
    const control: ColumnAccessControl | null = user.getColumnAccessControlFor(
      "newUnverifiedTemporaryEmailExpires",
    );

    expect(control).not.toBeNull();
    expect(control?.create).toEqual([]);
    expect(control?.update).toEqual([]);
    expect(control?.read).toEqual([Permission.CurrentUser]);
  });

  test("is an optional moment, as the migration makes it", () => {
    const metadata: ReturnType<User["getTableColumnMetadata"]> =
      user.getTableColumnMetadata("newUnverifiedTemporaryEmailExpires");

    expect(metadata.type).toBe(TableColumnType.Date);
    expect(metadata.required).toBeFalsy();
  });

  test("sits beside the waiting address it describes, which its owner reads too", () => {
    const pending: ColumnAccessControl | null = user.getColumnAccessControlFor(
      "newUnverifiedTemporaryEmail",
    );

    expect(pending?.read).toEqual([Permission.CurrentUser]);
  });
});
