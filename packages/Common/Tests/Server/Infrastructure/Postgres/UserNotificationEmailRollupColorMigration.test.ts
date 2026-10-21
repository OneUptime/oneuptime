import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSeverityAndStateToNotificationEmailRollup1791900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791900000000-AddSeverityAndStateToNotificationEmailRollup";
import { AddSeverityAndStateColorsToNotificationEmailRollup1797600000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797600000000-AddSeverityAndStateColorsToNotificationEmailRollup";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The rollup queue snapshots each notification's severity and state colour
 * beside their names, so the one email that stands in for forty paints its
 * chips the way those forty would have. The columns are added to a live
 * queue: rows already waiting have no colour, and must keep being sent.
 */

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

describe("notification email rollup colour migration", () => {
  test("adds only the two colour snapshot columns, sized for a colour", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateColorsToNotificationEmailRollup1797600000000().up(
      runner,
    );

    expect(statements).toEqual([
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "severityColor" character varying(${ColumnLength.Color})`,
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD "currentStateColor" character varying(${ColumnLength.Color})`,
    ]);
  });

  test("keeps queued notifications valid without inventing colours", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateColorsToNotificationEmailRollup1797600000000().up(
      runner,
    );

    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|UPDATE |DELETE |DROP /);
    }
  });

  test("rollback removes only the colour columns, in reverse order", async () => {
    const { runner, statements } = recordQueries();

    await new AddSeverityAndStateColorsToNotificationEmailRollup1797600000000().down(
      runner,
    );

    expect(statements).toEqual([
      'ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "currentStateColor"',
      'ALTER TABLE "UserNotificationEmailRollupItem" DROP COLUMN "severityColor"',
    ]);
  });

  test("is registered exactly once, after the migration that added the names", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const colourIndex: number = registered.indexOf(
      AddSeverityAndStateColorsToNotificationEmailRollup1797600000000,
    );

    expect(
      registered.filter((migration: unknown): boolean => {
        return (
          migration ===
          AddSeverityAndStateColorsToNotificationEmailRollup1797600000000
        );
      }),
    ).toHaveLength(1);
    expect(colourIndex).toBeGreaterThan(
      registered.indexOf(
        AddSeverityAndStateToNotificationEmailRollup1791900000000,
      ),
    );
  });

  test("uses a stable name for TypeORM migration accounting", () => {
    const migration: AddSeverityAndStateColorsToNotificationEmailRollup1797600000000 =
      new AddSeverityAndStateColorsToNotificationEmailRollup1797600000000();

    expect(migration.name).toBe(
      AddSeverityAndStateColorsToNotificationEmailRollup1797600000000.name,
    );
  });

  test.each(["severityColor", "currentStateColor"])(
    "the model declares %s as an optional Color column, as the migration creates it",
    (columnName: string) => {
      const item: UserNotificationEmailRollupItem =
        new UserNotificationEmailRollupItem();

      expect(item.getTableColumnMetadata(columnName).type).toBe(
        TableColumnType.Color,
      );
      expect(item.getTableColumnMetadata(columnName).required).toBeFalsy();
    },
  );
});
