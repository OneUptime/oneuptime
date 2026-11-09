import { AddProjectAiRunLimits1809080210000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080210000-AddProjectAiRunLimits";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import { PROJECT_AI_RUN_LIMIT_COLUMNS } from "../../../../Types/AI/ProjectAiRunLimits";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind a project's own limits on each AI run (issue
 * #6440): four nullable integer columns on "Project". No default and no NOT
 * NULL: adding them rewrites no row, and every project - existing or new -
 * reads as having set none, so no run is capped until someone sets a cap.
 * The limits runs had before were constants in the code, never stored, so
 * nothing is carried over: no stored value equals an old fixed limit.
 *
 * Statements are recorded against a fake QueryRunner.
 */

const NAME: string = "AddProjectAiRunLimits1809080210000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
const ADDED_COLUMN: RegExp = /ADD "([^"]+)"/;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  const migration: AddProjectAiRunLimits1809080210000 =
    new AddProjectAiRunLimits1809080210000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddProjectAiRunLimits1809080210000", () => {
  test("adds the four nullable integer columns, and nothing else", async () => {
    expect(await record("up")).toEqual([
      `ALTER TABLE "Project" ADD "aiRunMaxModelCalls" integer`,
      `ALTER TABLE "Project" ADD "aiRunMaxToolCalls" integer`,
      `ALTER TABLE "Project" ADD "aiRunMaxTokens" integer`,
      `ALTER TABLE "Project" ADD "aiRunTimeLimitInMinutes" integer`,
    ]);
  });

  test("they are the model's columns, the same four the settings card writes", async () => {
    const added: Array<string> = (await record("up")).map(
      (statement: string): string => {
        return ADDED_COLUMN.exec(statement)![1]!;
      },
    );

    expect(added).toEqual([...PROJECT_AI_RUN_LIMIT_COLUMNS]);

    const project: Project = new Project();

    for (const column of added) {
      expect(project.getTableColumnMetadata(column)).toBeDefined();
    }
  });

  test("down drops them, in the reverse order", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "aiRunTimeLimitInMinutes"`,
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxTokens"`,
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxToolCalls"`,
      `ALTER TABLE "Project" DROP COLUMN "aiRunMaxModelCalls"`,
    ]);
  });

  test("no column is NOT NULL or has a default: no row is rewritten, no project starts capped", async () => {
    for (const statement of await record("up")) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
      // Nothing is copied in: no UPDATE writes an old fixed limit.
      expect(statement).not.toMatch(/^UPDATE/i);
    }
  });

  test("its name carries its timestamp, in the range this change was given", () => {
    const migration: AddProjectAiRunLimits1809080210000 =
      new AddProjectAiRunLimits1809080210000();

    expect(migration.name).toBe(NAME);

    const timestamp: number = Number(TRAILING_TIMESTAMP.exec(NAME)![1]);
    expect(timestamp).toBeGreaterThanOrEqual(1809080200000);
    expect(timestamp).toBeLessThanOrEqual(1809080299999);
  });

  test("it is registered, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return new migration().name || migration.name;
      },
    );

    expect(names).toContain(NAME);

    const timestamps: Array<number> = names.map((name: string): number => {
      const match: RegExpExecArray | null = TRAILING_TIMESTAMP.exec(name);
      return match ? Number(match[1]) : 0;
    });
    const own: number = timestamps[names.indexOf(NAME)]!;

    expect(
      timestamps.slice(0, names.indexOf(NAME)).filter((timestamp: number) => {
        return timestamp > own;
      }),
    ).toEqual([]);
  });
});
