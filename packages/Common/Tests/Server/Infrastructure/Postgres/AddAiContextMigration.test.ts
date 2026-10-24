import { AddAiContext1807100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807100000000-AddAiContext";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind the AI context (issue #5198): a nullable text column
 * on "Project" (the project's notes) and on "AutoRemediationRule" (an AI
 * rule's). No default, no index, no key: adding one rewrites no row, every
 * existing project and rule reads as having no AI context, and a run reads
 * exactly what it read before.
 *
 * Statements are recorded against a fake QueryRunner.
 */

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddAiContext1807100000000", () => {
  test("adds the two nullable text columns, and nothing else", async () => {
    expect(await record(new AddAiContext1807100000000(), "up")).toEqual([
      `ALTER TABLE "Project" ADD "aiContext" text`,
      `ALTER TABLE "AutoRemediationRule" ADD "aiContext" text`,
    ]);
  });

  test("down drops them, in the reverse order", async () => {
    expect(await record(new AddAiContext1807100000000(), "down")).toEqual([
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "aiContext"`,
      `ALTER TABLE "Project" DROP COLUMN "aiContext"`,
    ]);
  });

  test("no column is NOT NULL or has a default: an existing row is never rewritten", async () => {
    for (const statement of await record(
      new AddAiContext1807100000000(),
      "up",
    )) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    }
  });

  test("its name carries its timestamp", () => {
    const migration: AddAiContext1807100000000 =
      new AddAiContext1807100000000();

    expect(migration.name).toBe("AddAiContext1807100000000");
    expect(TRAILING_TIMESTAMP.exec(migration.name)![1]).toBe("1807100000000");
  });

  test("it is registered, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return new migration().name || migration.name;
      },
    );

    expect(names).toContain("AddAiContext1807100000000");

    const timestamps: Array<number> = names.map((name: string): number => {
      const match: RegExpExecArray | null = TRAILING_TIMESTAMP.exec(name);
      return match ? Number(match[1]) : 0;
    });
    const own: number = timestamps[names.indexOf("AddAiContext1807100000000")]!;

    // Every migration registered before it ran before it.
    expect(
      timestamps
        .slice(0, names.indexOf("AddAiContext1807100000000"))
        .filter((timestamp: number) => {
          return timestamp > own;
        }),
    ).toEqual([]);
  });
});
