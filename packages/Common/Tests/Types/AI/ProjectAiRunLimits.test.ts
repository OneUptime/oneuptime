import Project from "../../../Models/DatabaseModels/Project";
import {
  MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
  MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
} from "../../../Types/AI/AIAgentRunLimits";
import { PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS } from "../../../Types/AI/ProjectAiDailyLimits";
import ProjectAiRunLimits, {
  PROJECT_AI_RUN_LIMIT_BOUNDS,
  PROJECT_AI_RUN_LIMIT_COLUMNS,
  PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS,
  PROJECT_AI_RUN_MAX_MODEL_CALLS_COLUMN,
  PROJECT_AI_RUN_MAX_TOKENS_COLUMN,
  PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN,
  PROJECT_AI_RUN_TIME_LIMIT_COLUMN,
  ProjectAiRunLimitColumn,
  ProjectAiRunLimitValues,
} from "../../../Types/AI/ProjectAiRunLimits";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A project's own limits on each AI run (issue #6440): four opt-in columns
 * on Project - model calls, tool calls and tokens per run, and a time limit.
 * These pin that they are unset for every project (no stored value equals an
 * old fixed limit, since none was ever stored), how a stored value is read,
 * what a write may hold, and who may change them.
 */

describe("the columns", () => {
  test("are the four limits, in the card's order", () => {
    expect(PROJECT_AI_RUN_LIMIT_COLUMNS).toEqual([
      "aiRunMaxModelCalls",
      "aiRunMaxToolCalls",
      "aiRunMaxTokens",
      "aiRunTimeLimitInMinutes",
    ]);
    expect(PROJECT_AI_RUN_MAX_MODEL_CALLS_COLUMN).toBe("aiRunMaxModelCalls");
    expect(PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN).toBe("aiRunMaxToolCalls");
    expect(PROJECT_AI_RUN_MAX_TOKENS_COLUMN).toBe("aiRunMaxTokens");
    expect(PROJECT_AI_RUN_TIME_LIMIT_COLUMN).toBe("aiRunTimeLimitInMinutes");
  });

  test("exist on Project as optional numbers: no project starts with a limit", () => {
    const project: Project = new Project();

    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect(project.getTableColumnMetadata(column)?.type).toBe(
        TableColumnType.Number,
      );
      expect(project.getTableColumnMetadata(column)?.required).toBe(false);
      // Nothing is written to a new project.
      expect((project as unknown as Record<string, unknown>)[column]).toBe(
        undefined,
      );
    }
  });

  test("a new project holds no limit", () => {
    const project: Project = new Project();

    expect(ProjectAiRunLimits.getLimits(project)).toEqual({
      maxModelCalls: null,
      maxToolCalls: null,
      maxTokens: null,
      timeLimitInMinutes: null,
    });
  });

  test("only the people who may change the daily limits may change them", () => {
    expect(PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS).toEqual(
      PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
    );
    expect(PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ManageProjectBilling,
      ]),
    );
  });

  test("each column's update permissions are exactly those, and the project's members may read them", () => {
    const project: Project = new Project();

    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect(project.getColumnAccessControlFor(column)?.update).toEqual(
        PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS,
      );
      // Set only on the settings page, never when a project is created.
      expect(project.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(project.getColumnAccessControlFor(column)?.read).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
        ]),
      );
    }
  });

  test("read by the same people who read the daily limits", () => {
    const project: Project = new Project();

    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect(project.getColumnAccessControlFor(column)?.read).toEqual(
        project.getColumnAccessControlFor("aiDailyTokenLimit")?.read,
      );
    }
  });
});

describe("ProjectAiRunLimits.getLimit", () => {
  test.each([
    [null],
    [undefined],
    [0],
    [-10],
    [0.9],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [""],
    ["  "],
    ["ten"],
    [false],
    [{}],
  ])("%p is no limit", (value: unknown) => {
    expect(ProjectAiRunLimits.getLimit(value)).toBeNull();
  });

  test("a whole number is the limit; a numeric string too (a bigint column reads back as one)", () => {
    expect(ProjectAiRunLimits.getLimit(1)).toBe(1);
    expect(ProjectAiRunLimits.getLimit(250)).toBe(250);
    expect(ProjectAiRunLimits.getLimit("2000000")).toBe(2_000_000);
  });

  test("a fraction is rounded down", () => {
    expect(ProjectAiRunLimits.getLimit(7.8)).toBe(7);
  });
});

describe("ProjectAiRunLimits.getLimits and countSet", () => {
  test("reads each column", () => {
    const limits: ProjectAiRunLimitValues = ProjectAiRunLimits.getLimits({
      aiRunMaxModelCalls: 50,
      aiRunMaxToolCalls: 200,
      aiRunMaxTokens: "3000000",
      aiRunTimeLimitInMinutes: 30,
    });

    expect(limits).toEqual({
      maxModelCalls: 50,
      maxToolCalls: 200,
      maxTokens: 3_000_000,
      timeLimitInMinutes: 30,
    });
    expect(ProjectAiRunLimits.countSet(limits)).toBe(4);
  });

  test("no project, or one with nothing set, has none", () => {
    expect(ProjectAiRunLimits.getLimits(null)).toEqual({
      maxModelCalls: null,
      maxToolCalls: null,
      maxTokens: null,
      timeLimitInMinutes: null,
    });
    expect(
      ProjectAiRunLimits.countSet(ProjectAiRunLimits.getLimits(null)),
    ).toBe(0);
  });

  test("counts only what is set", () => {
    expect(
      ProjectAiRunLimits.countSet(
        ProjectAiRunLimits.getLimits({
          aiRunMaxToolCalls: 100,
          aiRunTimeLimitInMinutes: 0,
        }),
      ),
    ).toBe(1);
  });
});

describe("the bounds", () => {
  test("every limit is at least 1 and has a ceiling", () => {
    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      const bounds: { min: number; max: number } =
        PROJECT_AI_RUN_LIMIT_BOUNDS[column];

      expect(bounds.min).toBeGreaterThanOrEqual(1);
      expect(bounds.max).toBeGreaterThan(bounds.min);
      // Inside a Postgres integer, so the database never refuses one.
      expect(bounds.max).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  test("the time limit runs from 1 minute to a day", () => {
    expect(PROJECT_AI_RUN_LIMIT_BOUNDS.aiRunTimeLimitInMinutes).toEqual({
      min: MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
      max: MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
    });
  });

  test("tokens start at 1,000: fewer is not one model call", () => {
    expect(PROJECT_AI_RUN_LIMIT_BOUNDS.aiRunMaxTokens.min).toBe(1_000);
  });
});

describe("ProjectAiRunLimits.getWriteError", () => {
  const NAMES: Record<ProjectAiRunLimitColumn, string> = {
    aiRunMaxModelCalls: "The limit of model calls per run",
    aiRunMaxToolCalls: "The limit of tool calls per run",
    aiRunMaxTokens: "The limit of tokens per run",
    aiRunTimeLimitInMinutes: "The time limit per run",
  };

  test.each(PROJECT_AI_RUN_LIMIT_COLUMNS.map((column: string) => {
    return [column];
  }))("%s may be cleared", (column: string) => {
    expect(
      ProjectAiRunLimits.getWriteError(column as ProjectAiRunLimitColumn, null),
    ).toBeNull();
    expect(
      ProjectAiRunLimits.getWriteError(
        column as ProjectAiRunLimitColumn,
        undefined,
      ),
    ).toBeNull();
  });

  test.each(PROJECT_AI_RUN_LIMIT_COLUMNS.map((column: string) => {
    return [column];
  }))("%s takes a whole number at its bounds", (column: string) => {
    const bounds: { min: number; max: number } =
      PROJECT_AI_RUN_LIMIT_BOUNDS[column as ProjectAiRunLimitColumn];

    expect(
      ProjectAiRunLimits.getWriteError(
        column as ProjectAiRunLimitColumn,
        bounds.min,
      ),
    ).toBeNull();
    expect(
      ProjectAiRunLimits.getWriteError(
        column as ProjectAiRunLimitColumn,
        bounds.max,
      ),
    ).toBeNull();
  });

  test.each(PROJECT_AI_RUN_LIMIT_COLUMNS.map((column: string) => {
    return [column];
  }))(
    "%s refuses a value outside its bounds, a fraction and a text",
    (column: string) => {
      const typed: ProjectAiRunLimitColumn = column as ProjectAiRunLimitColumn;
      const bounds: { min: number; max: number } =
        PROJECT_AI_RUN_LIMIT_BOUNDS[typed];

      for (const value of [
        bounds.min - 1,
        bounds.max + 1,
        0,
        -5,
        2.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "50",
        "",
        true,
        {},
      ]) {
        const error: string | null = ProjectAiRunLimits.getWriteError(
          typed,
          value,
        );

        expect(error).not.toBeNull();
        expect(error).toContain(NAMES[typed]);
        expect(error).toContain(
          `must be a whole number from ${bounds.min.toLocaleString("en-US")} to ${bounds.max.toLocaleString("en-US")}.`,
        );
      }
    },
  );

  test("the refusal says what leaving it empty means", () => {
    expect(
      ProjectAiRunLimits.getWriteError(PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN, 0),
    ).toBe(
      "The limit of tool calls per run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
    );
    expect(
      ProjectAiRunLimits.getWriteError(PROJECT_AI_RUN_TIME_LIMIT_COLUMN, 0),
    ).toBe(
      "The time limit per run must be a whole number from 1 to 1,440. Leave it empty for the default.",
    );
    expect(
      ProjectAiRunLimits.getWriteError(PROJECT_AI_RUN_MAX_TOKENS_COLUMN, 999),
    ).toBe(
      "The limit of tokens per run must be a whole number from 1,000 to 2,000,000,000. Leave it empty for no limit.",
    );
  });

  test("no refusal speaks of a budget", () => {
    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      expect(ProjectAiRunLimits.getWriteError(column, -1)).not.toMatch(
        /budget/i,
      );
    }
  });
});
