import { AddMonitorStatusTimelineIsMonitoringOff1809122600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809122600000-AddMonitorStatusTimelineIsMonitoringOff";
import { AddProductFeedback1809123000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123000000-AddProductFeedback";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ProductFeedback from "../../../../Models/DatabaseModels/ProductFeedback";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind asking people (issue #6832): the new ProductFeedback
 * table with its index on (kind, createdAt), the person's two columns on
 * User (their switch, and the questions they were asked) and the server's
 * switch on GlobalConfig. The table is new, so its index is built on no
 * rows; the three added columns are nullable, with a constant default, so
 * no row is rewritten. Statements are recorded against a fake QueryRunner;
 * the schema drift check runs it on Postgres against the models.
 */

const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddProductFeedback1809123000000 =
    new AddProductFeedback1809123000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddProductFeedback1809123000000", () => {
  test("creates the table with every column of the model, and nothing about a person or a project", async () => {
    const steps: Array<string> = await record("up");
    const create: string | undefined = steps.find((step: string) => {
      return step.startsWith(`CREATE TABLE "ProductFeedback" `);
    });

    expect(create).toBeDefined();

    const created: Array<string> = Array.from(
      create!.matchAll(CREATED_COLUMN),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    const modelColumns: Array<string> = Object.keys(
      getTableColumns(new ProductFeedback()),
    );

    for (const column of modelColumns) {
      expect(created).toContain(column);
    }

    for (const column of [
      "kind",
      "topic",
      "score",
      "isPositive",
      "details",
      "page",
      "productVersion",
    ]) {
      expect(created).toContain(column);
    }

    expect(created.join(",")).not.toMatch(/projectId|userId|email|url/i);
  });

  test("indexes the table by kind and when, and adds the switches as nullable columns with a default", async () => {
    const steps: Array<string> = await record("up");

    expect(steps).toContain(
      `CREATE INDEX "IDX_a0cba8a4e43aff85ac6cc9bcdc" ON "ProductFeedback" ("kind", "createdAt") `,
    );
    expect(steps).toContain(
      `ALTER TABLE "User" ADD "disableFeedbackQuestions" boolean DEFAULT false`,
    );
    expect(steps).toContain(
      `ALTER TABLE "User" ADD "feedbackQuestionsAsked" jsonb`,
    );
    expect(steps).toContain(
      `ALTER TABLE "GlobalConfig" ADD "disableProductFeedback" boolean DEFAULT false`,
    );
    // No existing row is read or written.
    expect(
      steps.filter((step: string): boolean => {
        return ROW_STATEMENT.test(step);
      }),
    ).toEqual([]);
  });

  test("down undoes up, in the reverse order", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "disableProductFeedback"`,
      `ALTER TABLE "User" DROP COLUMN "feedbackQuestionsAsked"`,
      `ALTER TABLE "User" DROP COLUMN "disableFeedbackQuestions"`,
      `DROP INDEX "public"."IDX_a0cba8a4e43aff85ac6cc9bcdc"`,
      `DROP TABLE "ProductFeedback"`,
    ]);
  });

  test("is registered once, after the migration before it", () => {
    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;
    const index: number = migrations.indexOf(AddProductFeedback1809123000000);

    expect(index).toBeGreaterThan(-1);
    expect(
      migrations.filter((migration: unknown): boolean => {
        return migration === AddProductFeedback1809123000000;
      }).length,
    ).toBe(1);
    expect(index).toBeGreaterThan(
      migrations.indexOf(AddMonitorStatusTimelineIsMonitoringOff1809122600000),
    );
  });
});
