import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import HostLogSession from "../../../../Models/DatabaseModels/HostLogSession";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddHostLogSessionNote1809186900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186900000-AddHostLogSessionNote";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { HOST_LOG_SESSION_NOTE_MAX_LENGTH } from "../../../../Types/Host/HostLogSession";
import { MAX_KEPT_NOTE_LENGTH } from "../../../../Utils/Host/HostLogSessionNote";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind HostLogSession.note (#9966): why a log session is
 * asked for, in the requester's words, which the person at the Android
 * device reads under the request.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently, and ordered after every migration
 * already registered, or it silently never runs. The model's column is held
 * to what the migration made: nullable text the length a kept note can be,
 * written by the requester when they ask, and never changed after.
 */

const MIGRATION_TIMESTAMP: string = "1809186900000";

const MIGRATION_BASE_NAME: string = "AddHostLogSessionNote";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "HostLogSession" ADD "note" character varying(500)`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "HostLogSession" DROP COLUMN "note"`,
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
  await new AddHostLogSessionNote1809186900000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddHostLogSessionNote1809186900000().down(runner);
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
      new AddHostLogSessionNote1809186900000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddHostLogSessionNote1809186900000.prototype,
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
    expect(SchemaMigrations).toContain(AddHostLogSessionNote1809186900000);
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddHostLogSessionNote1809186900000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddHostLogSessionNote1809186900000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddHostLogSessionNote1809186900000.name).toBe(MIGRATION_CLASS_NAME);
    expect(
      AddHostLogSessionNote1809186900000.name.match(CLASS_TIMESTAMP)?.[1],
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
      AddHostLogSessionNote1809186900000,
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
  const session: HostLogSession = new HostLogSession();

  test("is written by whoever may ask for a session, when they ask, and never changed after", () => {
    const control: ColumnAccessControl | null =
      session.getColumnAccessControlFor("note");

    expect(control).not.toBeNull();
    expect([...(control?.create || [])].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.EditHost,
      ].sort(),
    );
    expect(control?.update).toEqual([]);
    expect([...(control?.read || [])].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadHost,
      ].sort(),
    );
  });

  test("is optional text as long as the migration makes it, room for a redacted note", () => {
    const metadata: ReturnType<HostLogSession["getTableColumnMetadata"]> =
      session.getTableColumnMetadata("note");

    expect(metadata.type).toBe(TableColumnType.LongText);
    expect(metadata.required).toBeFalsy();
    expect(ColumnLength.LongText).toBe(500);
    expect(MAX_KEPT_NOTE_LENGTH).toBe(ColumnLength.LongText);
    // What a person may type fits with room for what redaction adds.
    expect(HOST_LOG_SESSION_NOTE_MAX_LENGTH).toBeLessThan(MAX_KEPT_NOTE_LENGTH);
  });
});
