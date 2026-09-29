import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSeverityAndStateToNotificationEmailRollup1791900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791900000000-AddSeverityAndStateToNotificationEmailRollup";

type RecordedQueries = {
  runner: QueryRunner;
  statements: Array<string>;
};

function recordQueries(): RecordedQueries {
  const statements: Array<string> = [];

  return {
    statements,
    runner: {
      query: async (statement: string): Promise<void> => {
        statements.push(statement);
      },
    } as QueryRunner,
  };
}

describe("notification email rollup metadata migration", () => {
  test("adds only the severity and state snapshot columns", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateToNotificationEmailRollup1791900000000().up(
      runner,
    );

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(
      /^ALTER TABLE "UserNotificationEmailRollupItem" ADD "severity" /,
    );
    expect(statements[1]).toMatch(
      /^ALTER TABLE "UserNotificationEmailRollupItem" ADD "currentState" /,
    );
  });

  test("keeps existing queued notifications valid without inventing metadata", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateToNotificationEmailRollup1791900000000().up(
      runner,
    );

    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DELETE |DROP /);
    }
  });

  test("rollback removes only the added metadata and leaves queue records intact", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateToNotificationEmailRollup1791900000000().down(
      runner,
    );

    expect(statements).toEqual([
      'ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "currentState"',
      'ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "severity"',
    ]);
  });

  test("registers the generated migration exactly once so it runs on startup", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return (
          migration ===
          AddSeverityAndStateToNotificationEmailRollup1791900000000
        );
      }),
    ).toHaveLength(1);
  });

  test("uses a stable name for TypeORM migration accounting", () => {
    const migration: AddSeverityAndStateToNotificationEmailRollup1791900000000 =
      new AddSeverityAndStateToNotificationEmailRollup1791900000000();

    expect(migration.name).toBe(
      AddSeverityAndStateToNotificationEmailRollup1791900000000.name,
    );
  });
});
