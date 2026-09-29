import { AddMasterPasswordSalt1786400000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786400000000-AddMasterPasswordSalt";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";

/*
 * Dashboard and status-page master passwords are upgraded from a legacy
 * unsalted digest to salted scrypt after this migration runs. The salt column
 * therefore has two unusual requirements:
 *
 *   - it must start nullable, because existing hashes have no salt until their
 *     next successful verification; and
 *   - it must not be removed while any scrypt hash remains, because a scrypt
 *     hash cannot be verified without its per-row salt.
 *
 * These tests pin that SQL contract without requiring Postgres. In particular,
 * the rollback tests model each table independently so a future edit cannot
 * check one table, drop a column, and only then discover that the other table
 * still contains scrypt credentials.
 */

const MIGRATION_TIMESTAMP: number = 1786400000000;
const MIGRATION_FILENAME: string = "1786400000000-AddMasterPasswordSalt.ts";
const DROP_COLUMN_PATTERN: RegExp = /\bDROP COLUMN\b/i;
const SELECT_EXISTS_PATTERN: RegExp = /^SELECT EXISTS/i;
const MIGRATION_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  MIGRATION_FILENAME,
);

type TableWithMasterPassword = "Dashboard" | "StatusPage";

type ExistingScryptRows = Record<TableWithMasterPassword, boolean>;

const UNSAFE_ROLLBACK_CASES: Array<[string, ExistingScryptRows]> = [
  ["Dashboard", { Dashboard: true, StatusPage: false }],
  ["StatusPage", { Dashboard: false, StatusPage: true }],
  ["both tables", { Dashboard: true, StatusPage: true }],
];

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

const makeQueryRunner: (
  existingScryptRows?: ExistingScryptRows,
) => MakeQueryRunnerResult = (
  existingScryptRows: ExistingScryptRows = {
    Dashboard: false,
    StatusPage: false,
  },
): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<unknown> = (
    ...args: Array<unknown>
  ): Promise<unknown> => {
    const statement: string = String(args[0]);
    statements.push(statement);

    for (const table of ["Dashboard", "StatusPage"] as const) {
      if (statement.includes(`FROM "${table}"`)) {
        return Promise.resolve([{ exists: existingScryptRows[table] }]);
      }
    }

    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

const dropsFrom: (statements: Array<string>) => Array<string> = (
  statements: Array<string>,
): Array<string> => {
  return statements.filter((statement: string) => {
    return DROP_COLUMN_PATTERN.test(statement);
  });
};

const optionalTrailingTimestampFrom: (value: string) => number | null = (
  value: string,
): number | null => {
  const timestamp: string | undefined = value.match(/(\d+)(?:\.ts)?$/)?.[1];

  return timestamp ? Number(timestamp) : null;
};

const timestampFrom: (value: string) => number = (value: string): number => {
  const timestamp: number | null = optionalTrailingTimestampFrom(value);

  if (timestamp === null) {
    throw new Error(`Expected a trailing migration timestamp in: ${value}`);
  }

  return timestamp;
};

const timestampFromFilename: (value: string) => number = (
  value: string,
): number => {
  const match: RegExpMatchArray | null = value.match(/^(\d+)-/);

  if (!match?.[1]) {
    throw new Error(`Expected a leading migration timestamp in: ${value}`);
  }

  return Number(match[1]);
};

describe("AddMasterPasswordSalt1786400000000 - up SQL contract", () => {
  test("adds only the dashboard and status-page salt columns", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMasterPasswordSalt1786400000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPage" ADD "masterPasswordSalt" character varying(100)`,
      `ALTER TABLE "Dashboard" ADD "masterPasswordSalt" character varying(100)`,
    ]);
  });

  test("keeps both columns nullable and does not backfill a fake salt", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMasterPasswordSalt1786400000000().up(runner);

    expect(statements).toHaveLength(2);

    for (const statement of statements) {
      expect(statement).toMatch(
        /^ALTER TABLE "(?:Dashboard|StatusPage)" ADD "masterPasswordSalt" character varying\(\d+\)$/,
      );
      expect(statement).not.toMatch(/NOT NULL/i);
      expect(statement).not.toMatch(/DEFAULT/i);
      expect(statement).not.toMatch(/\bUPDATE\b/i);
      expect(statement).not.toMatch(/\bINSERT\b/i);
    }
  });

  test("allocates enough space for the generated 64-character salts", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMasterPasswordSalt1786400000000().up(runner);

    for (const statement of statements) {
      const width: RegExpMatchArray | null = statement.match(
        /character varying\((\d+)\)/,
      );

      expect(width).not.toBeNull();
      expect(Number(width?.[1])).toBeGreaterThanOrEqual(64);
    }
  });
});

describe("AddMasterPasswordSalt1786400000000 - safe rollback", () => {
  test("checks both master-password tables before the first DROP", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMasterPasswordSalt1786400000000().down(runner);

    const firstDropIndex: number = statements.findIndex((statement: string) => {
      return DROP_COLUMN_PATTERN.test(statement);
    });
    const dashboardCheckIndex: number = statements.findIndex(
      (statement: string) => {
        return (
          statement.includes(`FROM "Dashboard"`) &&
          statement.includes(`"masterPassword" LIKE 'scrypt$%'`)
        );
      },
    );
    const statusPageCheckIndex: number = statements.findIndex(
      (statement: string) => {
        return (
          statement.includes(`FROM "StatusPage"`) &&
          statement.includes(`"masterPassword" LIKE 'scrypt$%'`)
        );
      },
    );

    expect(dashboardCheckIndex).toBeGreaterThanOrEqual(0);
    expect(statusPageCheckIndex).toBeGreaterThanOrEqual(0);
    expect(firstDropIndex).toBeGreaterThan(dashboardCheckIndex);
    expect(firstDropIndex).toBeGreaterThan(statusPageCheckIndex);
  });

  test.each(UNSAFE_ROLLBACK_CASES)(
    "refuses to drop either salt when %s still has a scrypt hash",
    async (_scenario: string, existingScryptRows: ExistingScryptRows) => {
      const { runner, statements } = makeQueryRunner(existingScryptRows);

      await expect(
        new AddMasterPasswordSalt1786400000000().down(runner),
      ).rejects.toThrow(
        "Cannot remove master-password salt columns while scrypt master-password hashes exist.",
      );

      expect(dropsFrom(statements)).toEqual([]);
      expect(
        statements.filter((statement: string) => {
          return SELECT_EXISTS_PATTERN.test(statement);
        }),
      ).toHaveLength(2);
    },
  );

  test("drops both exact salt columns when neither table has scrypt hashes", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMasterPasswordSalt1786400000000().down(runner);

    expect(dropsFrom(statements)).toEqual([
      `ALTER TABLE "Dashboard" DROP COLUMN "masterPasswordSalt"`,
      `ALTER TABLE "StatusPage" DROP COLUMN "masterPasswordSalt"`,
    ]);
  });
});

describe("AddMasterPasswordSalt1786400000000 - identity and registration", () => {
  test("filename, exported class, and TypeORM name carry one timestamp", () => {
    const migration: AddMasterPasswordSalt1786400000000 =
      new AddMasterPasswordSalt1786400000000();

    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(path.basename(MIGRATION_PATH)).toBe(MIGRATION_FILENAME);
    expect(timestampFromFilename(MIGRATION_FILENAME)).toBe(MIGRATION_TIMESTAMP);
    expect(timestampFrom(AddMasterPasswordSalt1786400000000.name)).toBe(
      MIGRATION_TIMESTAMP,
    );
    expect(timestampFrom(migration.name)).toBe(MIGRATION_TIMESTAMP);
    expect(migration.name).toBe("AddMasterPasswordSalt1786400000000");
  });

  /*
   * Registration is the invariant that matters — an unregistered migration
   * never runs. Being LAST is not: it was true the day this landed and every
   * migration added since has appended after it, so pinning it here would
   * fail the next person's unrelated PR rather than catch a real defect.
   */
  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === AddMasterPasswordSalt1786400000000;
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  test("has a timestamp strictly after every previously registered migration", () => {
    const migrationIndex: number = SchemaMigrations.indexOf(
      AddMasterPasswordSalt1786400000000,
    );

    expect(migrationIndex).toBeGreaterThan(-1);

    for (const earlierMigration of SchemaMigrations.slice(0, migrationIndex)) {
      const earlierTimestamp: number | null = optionalTrailingTimestampFrom(
        earlierMigration.name,
      );

      // The original `InitialMigration` is the sole pre-timestamp convention.
      if (earlierTimestamp !== null) {
        expect(earlierTimestamp).toBeLessThan(MIGRATION_TIMESTAMP);
      }
    }
  });
});
