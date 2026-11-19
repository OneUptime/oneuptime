import { AddProjectAiRunCommandTimeLimit1809186466000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186466000-AddProjectAiRunCommandTimeLimit";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
import {
  PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN,
  PROJECT_AI_RUN_LIMIT_COLUMNS,
} from "../../../../Types/AI/ProjectAiRunLimits";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind a project's Time Limit per Command (issue #6532): how
 * long one command of a code task may run on a Runner of the project's own.
 * One nullable integer column on "Project", with no default and no NOT
 * NULL: adding it rewrites no row, and every project - existing or new -
 * reads as having set none, so every command keeps the ten minutes it had.
 *
 * Statements are recorded against a fake QueryRunner.
 */

const NAME: string = "AddProjectAiRunCommandTimeLimit1809186466000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  const migration: AddProjectAiRunCommandTimeLimit1809186466000 =
    new AddProjectAiRunCommandTimeLimit1809186466000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddProjectAiRunCommandTimeLimit1809186466000", () => {
  test("adds the one nullable integer column, and nothing else", async () => {
    expect(await record("up")).toEqual([
      `ALTER TABLE "Project" ADD "aiRunCommandTimeLimitInMinutes" integer`,
    ]);
  });

  test("it is the model's column, the one the Limits per run card writes last", () => {
    const project: Project = new Project();

    expect(PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN).toBe(
      "aiRunCommandTimeLimitInMinutes",
    );
    expect(PROJECT_AI_RUN_LIMIT_COLUMNS).toContain(
      PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN,
    );
    expect(
      project.getTableColumnMetadata(PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN)
        ?.type,
    ).toBe(TableColumnType.Number);
    expect(
      project.getTableColumnMetadata(PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN)
        ?.required,
    ).toBe(false);
  });

  test("the people who change the run's other limits change it, and no one sets it at creation", () => {
    const access: { create?: Array<Permission>; update?: Array<Permission> } =
      new Project().getColumnAccessControlFor(
        PROJECT_AI_RUN_COMMAND_TIME_LIMIT_COLUMN,
      ) as { create?: Array<Permission>; update?: Array<Permission> };

    expect(access.update).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
    expect(access.create).toEqual([]);
  });

  test("down drops it", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "aiRunCommandTimeLimitInMinutes"`,
    ]);
  });

  test("it is not NOT NULL and has no default: no row is rewritten, no command is held to a new limit", async () => {
    for (const statement of await record("up")) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toMatch(/^UPDATE/i);
    }
  });

  test("its name carries its timestamp, and it is registered after every migration before it", () => {
    expect(new AddProjectAiRunCommandTimeLimit1809186466000().name).toBe(NAME);

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
