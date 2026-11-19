import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import Project from "../../../../Models/DatabaseModels/Project";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectDetectVoicemailOnCalls1809186500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186500000-AddProjectDetectVoicemailOnCalls";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind Project.detectVoicemailOnCalls (#6594): whether each
 * on-call call the project's members get through Twilio asks Twilio who
 * answered it, so a call that voicemail answered counts as not answered.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently, and ordered after every migration
 * already registered, or it silently never runs. The model's column is held
 * to what the migration made: nullable, on by default - every project,
 * existing ones too, detects voicemail - read by the project and set by its
 * owners and admins.
 */

const MIGRATION_TIMESTAMP: string = "1809186500000";

const MIGRATION_BASE_NAME: string = "AddProjectDetectVoicemailOnCalls";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "Project" ADD "detectVoicemailOnCalls" boolean DEFAULT true`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "Project" DROP COLUMN "detectVoicemailOnCalls"`,
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
  await new AddProjectDetectVoicemailOnCalls1809186500000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddProjectDetectVoicemailOnCalls1809186500000().down(runner);
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
   * Additive and nullable: no backfill, no NOT NULL, no index or key. A
   * constant default is kept in the catalog, so nothing is rewritten, and
   * every existing project reads it as on.
   */
  test("it does not backfill, require a value, or build an index or a key - and is on by default", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("CONSTRAINT");
      expect(statement).not.toContain("FOREIGN KEY");
    }

    expect(
      (await upStatements()).filter((statement: string): boolean => {
        return statement.includes("DEFAULT true");
      }),
    ).toEqual(UP_SQL);
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
      new AddProjectDetectVoicemailOnCalls1809186500000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProjectDetectVoicemailOnCalls1809186500000.prototype,
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
    expect(SchemaMigrations).toContain(
      AddProjectDetectVoicemailOnCalls1809186500000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddProjectDetectVoicemailOnCalls1809186500000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddProjectDetectVoicemailOnCalls1809186500000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddProjectDetectVoicemailOnCalls1809186500000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddProjectDetectVoicemailOnCalls1809186500000.name.match(
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
      AddProjectDetectVoicemailOnCalls1809186500000,
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
  const project: Project = new Project();

  const READERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.UnAuthorizedSsoUser,
    Permission.ProjectUser,
  ];

  test("is read by the project, set by its owners and admins, and never at create", () => {
    const control: ColumnAccessControl | null =
      project.getColumnAccessControlFor("detectVoicemailOnCalls");

    expect(control).not.toBeNull();
    expect([...(control?.read || [])].sort()).toEqual([...READERS].sort());
    expect(control?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(control?.create).toEqual([]);
  });

  test("is a boolean, on by default, as the migration makes it", () => {
    const metadata: ReturnType<Project["getTableColumnMetadata"]> =
      project.getTableColumnMetadata("detectVoicemailOnCalls");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.required).toBe(false);
  });

  test("a new project's model leaves it unset: the database's default applies", () => {
    expect(new Project().detectVoicemailOnCalls).toBeUndefined();
  });
});
