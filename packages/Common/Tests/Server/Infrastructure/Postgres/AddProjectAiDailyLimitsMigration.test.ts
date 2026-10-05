import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectAiDailyLimits1798200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798200000000-AddProjectAiDailyLimits";

/*
 * The migration behind Project.aiDailyTokenLimit and
 * Project.aiDailySpendLimitInUSD: a project's own daily AI limits (Project
 * Settings → AI Features → More settings).
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Both columns are nullable with no
 * default and nothing is backfilled: every project, existing or new, starts
 * with no limit, so nothing changes for anyone until a project sets one.
 * Beyond the SQL, the migration has to be registered, named consistently and
 * ordered after every migration already registered, or it silently never
 * runs. (The statements were generated with npm run
 * generate-postgres-migration, and the schema drift check finds nothing left
 * to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1798200000000";

const MIGRATION_BASE_NAME: string = "AddProjectAiDailyLimits";

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
  await new AddProjectAiDailyLimits1798200000000().up(runner);
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddProjectAiDailyLimits1798200000000().down(runner);
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the two nullable integer columns", async () => {
    expect(await upStatements()).toEqual([
      `ALTER TABLE "Project" ADD "aiDailyTokenLimit" integer`,
      `ALTER TABLE "Project" ADD "aiDailySpendLimitInUSD" integer`,
    ]);
  });

  test("down() drops exactly those columns, in reverse", async () => {
    expect(await downStatements()).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "aiDailySpendLimitInUSD"`,
      `ALTER TABLE "Project" DROP COLUMN "aiDailyTokenLimit"`,
    ]);
  });

  /*
   * No backfill and no default: an existing project gets no limit - NULL,
   * which ADD COLUMN without a default already gives it - and the legacy
   * aiDailyAutonomousTokenLimit (no longer enforced) is not copied in, so a
   * value saved long ago cannot start limiting a project unasked.
   */
  test("it does not backfill, set a default, or build an index", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("aiDailyAutonomousTokenLimit");
    }
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
      new AddProjectAiDailyLimits1798200000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProjectAiDailyLimits1798200000000.prototype,
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
    expect(SchemaMigrations).toContain(AddProjectAiDailyLimits1798200000000);
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddProjectAiDailyLimits1798200000000;
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddProjectAiDailyLimits1798200000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddProjectAiDailyLimits1798200000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddProjectAiDailyLimits1798200000000.name.match(CLASS_TIMESTAMP)?.[1],
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
      AddProjectAiDailyLimits1798200000000,
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
