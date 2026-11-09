/*
 * A project's own limits on each OneUptime AI run (Project Settings → AI →
 * AI Features → More settings → Limits per run, issue #6440): the most model
 * calls, tool calls and tokens one run may use, and its time limit.
 *
 * One setting for every kind of run - an incident or alert investigation,
 * an Ask AI answer, a Slack or Microsoft Teams answer, a security case or
 * insight triage, a remediation plan and its execution, a code task on a
 * Runner. The incident and alert investigation time limits (Incidents or
 * Alerts → AI → Settings) stay the one override: an investigation of a lane
 * that set one uses it instead of the project's.
 *
 * The caps are unset by default, and unset means no cap: a run makes as many
 * calls and uses as many tokens as its work needs, and is stopped only by
 * its time limit and by loop detection (Types/AI/AIAgentRunLimits). The time
 * limit is unset by default too, which means
 * DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES: every run has one, so none runs
 * forever.
 *
 * Nothing was stored for the old limits - they were constants in the code -
 * so no project starts with a cap: they apply only once someone sets one.
 *
 * Shared by the server, which enforces the limits and refuses a write
 * outside their bounds, and the dashboard, which offers them. Kept free of
 * React and of server code.
 */

import Permission from "../Permission";
import {
  MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
  MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
} from "./AIAgentRunLimits";
import { PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS } from "./ProjectAiDailyLimits";

// The Project columns that hold the limits.
export type ProjectAiRunLimitColumn =
  | "aiRunMaxModelCalls"
  | "aiRunMaxToolCalls"
  | "aiRunMaxTokens"
  | "aiRunTimeLimitInMinutes";

export const PROJECT_AI_RUN_MAX_MODEL_CALLS_COLUMN: ProjectAiRunLimitColumn =
  "aiRunMaxModelCalls";
export const PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN: ProjectAiRunLimitColumn =
  "aiRunMaxToolCalls";
export const PROJECT_AI_RUN_MAX_TOKENS_COLUMN: ProjectAiRunLimitColumn =
  "aiRunMaxTokens";
export const PROJECT_AI_RUN_TIME_LIMIT_COLUMN: ProjectAiRunLimitColumn =
  "aiRunTimeLimitInMinutes";

// In the order the card shows them.
export const PROJECT_AI_RUN_LIMIT_COLUMNS: ReadonlyArray<ProjectAiRunLimitColumn> =
  [
    PROJECT_AI_RUN_MAX_MODEL_CALLS_COLUMN,
    PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN,
    PROJECT_AI_RUN_MAX_TOKENS_COLUMN,
    PROJECT_AI_RUN_TIME_LIMIT_COLUMN,
  ];

/*
 * The bounds of a limit a project sets: at least 1 (a run that may make no
 * call is AI turned off, which is Enable AI's job), and far above any real
 * run, inside the integer columns that hold them - so a typing slip is
 * refused with a sentence rather than by the database.
 */
export const PROJECT_AI_RUN_LIMIT_BOUNDS: Readonly<
  Record<ProjectAiRunLimitColumn, { min: number; max: number }>
> = {
  aiRunMaxModelCalls: { min: 1, max: 100_000 },
  aiRunMaxToolCalls: { min: 1, max: 100_000 },
  aiRunMaxTokens: { min: 1_000, max: 2_000_000_000 },
  aiRunTimeLimitInMinutes: {
    min: MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
    max: MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
  },
};

/*
 * Who may change them: the people who may change the daily limits and turn
 * AI off - a project owner, or someone with Manage Billing - since they
 * decide what a run may cost. A test holds the columns to it.
 */
export const PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS: ReadonlyArray<Permission> =
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS;

// What each limit is, in the words of its refusal.
const LIMIT_NAMES: Readonly<Record<ProjectAiRunLimitColumn, string>> = {
  aiRunMaxModelCalls: "The limit of model calls per run",
  aiRunMaxToolCalls: "The limit of tool calls per run",
  aiRunMaxTokens: "The limit of tokens per run",
  aiRunTimeLimitInMinutes: "The time limit per run",
};

export interface ProjectAiRunLimitValues {
  maxModelCalls: number | null;
  maxToolCalls: number | null;
  maxTokens: number | null;
  // Null: the default (DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES).
  timeLimitInMinutes: number | null;
}

export default class ProjectAiRunLimits {
  /*
   * A stored value as a limit, or null for none: unset, empty and anything
   * that is not a number at least 1 are no limit - the limits are opt-in,
   * so a value the server would never have saved does not stop a run.
   */
  public static getLimit(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    let parsed: number = Number.NaN;

    if (typeof value === "number") {
      parsed = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      parsed = Number(value.trim());
    }

    if (!Number.isFinite(parsed) || parsed < 1) {
      return null;
    }

    return Math.floor(parsed);
  }

  // The limits a project row holds.
  public static getLimits(
    project: Partial<Record<ProjectAiRunLimitColumn, unknown>> | null,
  ): ProjectAiRunLimitValues {
    return {
      maxModelCalls: this.getLimit(
        project?.[PROJECT_AI_RUN_MAX_MODEL_CALLS_COLUMN],
      ),
      maxToolCalls: this.getLimit(
        project?.[PROJECT_AI_RUN_MAX_TOOL_CALLS_COLUMN],
      ),
      maxTokens: this.getLimit(project?.[PROJECT_AI_RUN_MAX_TOKENS_COLUMN]),
      timeLimitInMinutes: this.getLimit(
        project?.[PROJECT_AI_RUN_TIME_LIMIT_COLUMN],
      ),
    };
  }

  // How many of the four are set.
  public static countSet(limits: ProjectAiRunLimitValues): number {
    return [
      limits.maxModelCalls,
      limits.maxToolCalls,
      limits.maxTokens,
      limits.timeLimitInMinutes,
    ].filter((value: number | null): boolean => {
      return value !== null;
    }).length;
  }

  /*
   * Why a value cannot be saved to a limit column, or null when it can.
   * Null (or nothing) clears the limit. Anything else must be a whole
   * number within the column's bounds, given as a number: the API and the
   * dashboard both turn a typed "50" into one before a hook reads it
   * (Types/Database/NumericColumnValue).
   */
  public static getWriteError(
    column: ProjectAiRunLimitColumn,
    value: unknown,
  ): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const bounds: { min: number; max: number } =
      PROJECT_AI_RUN_LIMIT_BOUNDS[column];

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < bounds.min ||
      value > bounds.max
    ) {
      const empty: string =
        column === PROJECT_AI_RUN_TIME_LIMIT_COLUMN
          ? "Leave it empty for the default."
          : "Leave it empty for no limit.";

      return `${LIMIT_NAMES[column]} must be a whole number from ${bounds.min.toLocaleString("en-US")} to ${bounds.max.toLocaleString("en-US")}. ${empty}`;
    }

    return null;
  }
}
