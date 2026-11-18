import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import Project from "../../../../Models/DatabaseModels/Project";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectDefaultPagingLadder1809183250000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183250000-AddProjectDefaultPagingLadder";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind Project.defaultPagingLadder and
 * Project.requirePhoneMethodForOnCall (a project's default ladder and its
 * ask for a phone method, #7449).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Beyond the SQL, the migration has
 * to be registered, named consistently, and ordered after every migration
 * already registered, or it silently never runs. The model's columns are
 * held to what the migration made: nullable, the boolean false by default,
 * read by the project and set by its owners and admins.
 */

const MIGRATION_TIMESTAMP: string = "1809183250000";

const MIGRATION_BASE_NAME: string = "AddProjectDefaultPagingLadder";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP_SQL: Array<string> = [
  `ALTER TABLE "Project" ADD "defaultPagingLadder" jsonb`,
  `ALTER TABLE "Project" ADD "requirePhoneMethodForOnCall" boolean DEFAULT false`,
];

const DOWN_SQL: Array<string> = [
  `ALTER TABLE "Project" DROP COLUMN "requirePhoneMethodForOnCall"`,
  `ALTER TABLE "Project" DROP COLUMN "defaultPagingLadder"`,
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
  await new AddProjectDefaultPagingLadder1809183250000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddProjectDefaultPagingLadder1809183250000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the two columns and does nothing else", async () => {
    expect(await upStatements()).toEqual(UP_SQL);
  });

  test("down() drops exactly those columns, in the reverse order", async () => {
    expect(await downStatements()).toEqual(DOWN_SQL);
  });

  /*
   * Additive and nullable: no backfill, no NOT NULL, no index or key. Every
   * existing project has no default and asks for no phone, which is what
   * NULL and the boolean's constant default already say - and a constant
   * default is kept in the catalog, so nothing is rewritten.
   */
  test("it does not backfill, require a value, or build an index or a key", async () => {
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
        return statement.includes("DEFAULT");
      }),
    ).toEqual([
      `ALTER TABLE "Project" ADD "requirePhoneMethodForOnCall" boolean DEFAULT false`,
    ]);
  });

  test("every statement is a complete, single statement", async () => {
    const statements: Array<string> = [
      ...(await upStatements()),
      ...(await downStatements()),
    ];

    expect(statements).toHaveLength(4);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddProjectDefaultPagingLadder1809183250000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProjectDefaultPagingLadder1809183250000.prototype,
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
      AddProjectDefaultPagingLadder1809183250000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddProjectDefaultPagingLadder1809183250000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddProjectDefaultPagingLadder1809183250000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddProjectDefaultPagingLadder1809183250000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddProjectDefaultPagingLadder1809183250000.name.match(
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
      AddProjectDefaultPagingLadder1809183250000,
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

  test.each(["defaultPagingLadder", "requirePhoneMethodForOnCall"])(
    "%s is read by the project, set by its owners and admins, and never at create",
    (column: string) => {
      const control: ColumnAccessControl | null =
        project.getColumnAccessControlFor(column);

      expect(control).not.toBeNull();
      expect([...(control?.read || [])].sort()).toEqual([...READERS].sort());
      expect(control?.update).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
      expect(control?.create).toEqual([]);
    },
  );

  test("a new project has no default ladder and asks for no phone", () => {
    expect(new Project().defaultPagingLadder).toBeUndefined();
    expect(new Project().requirePhoneMethodForOnCall).toBeUndefined();
  });
});
