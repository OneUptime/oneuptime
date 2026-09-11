import { AddConfigurableRuleCriteria1792400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1792400000000-AddConfigurableRuleCriteria";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../../Types/Rules/RuleCriteriaFieldRegistry";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

const REMINDER_TABLES: ReadonlyArray<string> = [
  "AlertReminderRule",
  "IncidentReminderRule",
  "ScheduledMaintenanceReminderRule",
];

async function queriesFor(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  const migration: AddConfigurableRuleCriteria1792400000000 =
    new AddConfigurableRuleCriteria1792400000000();
  await migration[direction](queryRunner);

  return statements;
}

function tablesMatching(
  statements: ReadonlyArray<string>,
  expression: RegExp,
): Array<string> {
  return statements.flatMap((statement: string): Array<string> => {
    const match: RegExpMatchArray | null = statement.match(expression);
    return match?.[1] ? [match[1]] : [];
  });
}

describe("AddConfigurableRuleCriteria migration", () => {
  test("adds and removes criteria for every registered rule model exactly once", async () => {
    const upStatements: Array<string> = await queriesFor("up");
    const downStatements: Array<string> = await queriesFor("down");
    const registeredModels: Array<string> = Object.keys(
      RULE_CRITERIA_FIELDS_BY_MODEL,
    ).sort();

    const addedTables: Array<string> = tablesMatching(
      upStatements,
      /^ALTER TABLE "([^"]+)" ADD "criteria" jsonb$/,
    );
    const removedTables: Array<string> = tablesMatching(
      downStatements,
      /^ALTER TABLE "([^"]+)" DROP COLUMN "criteria"$/,
    );

    expect(addedTables).toHaveLength(registeredModels.length);
    expect(removedTables).toHaveLength(registeredModels.length);
    expect([...addedTables].sort()).toEqual(registeredModels);
    expect([...removedTables].sort()).toEqual(registeredModels);
  });

  test("restores enabled reminder rows before making legacy columns required", async () => {
    const statements: Array<string> = await queriesFor("down");

    for (const tableName of REMINDER_TABLES) {
      const dropCheckIndex: number = statements.findIndex(
        (statement: string): boolean => {
          return (
            statement.startsWith(
              `ALTER TABLE "${tableName}" DROP CONSTRAINT`,
            ) && statement.includes("CHK_")
          );
        },
      );
      const backfillIndex: number = statements.indexOf(
        `UPDATE "${tableName}" SET "isEnabled" = true WHERE "isEnabled" IS NULL`,
      );
      const requireEnabledIndex: number = statements.indexOf(
        `ALTER TABLE "${tableName}" ALTER COLUMN "isEnabled" SET NOT NULL`,
      );
      const dropCriteriaIndex: number = statements.indexOf(
        `ALTER TABLE "${tableName}" DROP COLUMN "criteria"`,
      );

      expect(dropCheckIndex).toBeGreaterThanOrEqual(0);
      expect(backfillIndex).toBeGreaterThan(dropCheckIndex);
      expect(requireEnabledIndex).toBeGreaterThan(backfillIndex);
      expect(dropCriteriaIndex).toBeGreaterThan(requireEnabledIndex);
    }
  });
});
