import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import Project from "../../../../Models/DatabaseModels/Project";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectAiDailyLimitReachedAt1799000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799000000000-AddProjectAiDailyLimitReachedAt";
import {
  PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS,
  ProjectAiDailyLimit,
} from "../../../../Types/AI/ProjectAiDailyLimits";
import ColumnType from "../../../../Types/Database/ColumnType";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind Project.aiDailyTokenLimitReachedAt and
 * Project.aiDailySpendLimitReachedAt: when each of a project's own daily AI
 * limits last stopped OneUptime AI. The conditional UPDATE that writes one
 * once a day decides the owners are emailed; the investigation catch-up
 * reads them to find the projects whose skipped records may be waiting.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Both columns are nullable with no
 * default and nothing is backfilled: every project starts as "never
 * reached". Beyond the SQL, the migration has to be registered, named
 * consistently and ordered after every migration already registered, or it
 * silently never runs. (Generated with npm run generate-postgres-migration;
 * the schema drift check finds nothing left to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1799000000000";

const MIGRATION_BASE_NAME: string = "AddProjectAiDailyLimitReachedAt";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: (...args: Array<unknown>): Promise<undefined> => {
      statements.push(String(args[0]));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddProjectAiDailyLimitReachedAt1799000000000()[step](runner);

  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the two nullable timestamp columns", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Project" ADD "aiDailyTokenLimitReachedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Project" ADD "aiDailySpendLimitReachedAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down() drops exactly those columns, in reverse", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "aiDailySpendLimitReachedAt"`,
      `ALTER TABLE "Project" DROP COLUMN "aiDailyTokenLimitReachedAt"`,
    ]);
  });

  test("it does not backfill, set a default, or build an index: every project starts as never reached", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddProjectAiDailyLimitReachedAt1799000000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProjectAiDailyLimitReachedAt1799000000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the columns it adds are the ones the model and the code name", () => {
  test("one per limit, as Types/AI/ProjectAiDailyLimits maps them", async () => {
    const added: Array<string> = (await statementsOf("up")).map(
      (statement: string): string => {
        return statement.match(/ADD "(\w+)"/)![1]!;
      },
    );

    expect(added).toEqual([
      PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS[ProjectAiDailyLimit.Tokens],
      PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS[ProjectAiDailyLimit.Spend],
    ]);
  });

  test.each([
    "aiDailyTokenLimitReachedAt",
    "aiDailySpendLimitReachedAt",
  ] as const)(
    "Project.%s is an internal, nullable date column: no one reads or writes it through the API",
    (column: "aiDailyTokenLimitReachedAt" | "aiDailySpendLimitReachedAt") => {
      const project: Project = new Project();

      expect(project.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });

      const tableColumn: { type?: TableColumnType; required?: boolean } =
        project.getTableColumnMetadata(column) as {
          type?: TableColumnType;
          required?: boolean;
        };

      expect(tableColumn.type).toBe(TableColumnType.Date);
      expect(tableColumn.required).toBe(false);
      expect(ColumnType.Date).toBe("timestamptz");
    },
  );
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
        return migration === AddProjectAiDailyLimitReachedAt1799000000000;
      }),
    ).toHaveLength(1);
  });

  // TypeORM records applied migrations by `name`: a mismatch re-runs it.
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddProjectAiDailyLimitReachedAt1799000000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddProjectAiDailyLimitReachedAt1799000000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddProjectAiDailyLimitReachedAt1799000000000.name.match(
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
      AddProjectAiDailyLimitReachedAt1799000000000,
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
