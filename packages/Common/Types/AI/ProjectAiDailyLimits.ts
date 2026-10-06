/*
 * A project's own daily limits on OneUptime AI (Project Settings → AI
 * Features → More settings): the most tokens it may use each day and - where
 * OneUptime bills AI, on OneUptime Cloud - the most AI credits it may spend
 * each day, whatever the AI is doing: Ask AI, investigations, postmortem
 * drafts, fix pull requests, insight triage, workflows, runbooks and
 * Slack or Microsoft Teams questions alike.
 *
 * They are a ceiling above every other AI limit. The incident and alert
 * daily limits (Incidents or Alerts → AI → Settings) still apply under them,
 * and AI work stops at whichever is reached first.
 *
 * Unset means no limit, as for every other AI limit. A set limit is a whole
 * number, at least 1: turning OneUptime AI off is Enable AI's job - the
 * project's one AI switch - so a limit of 0 is not a second way to do it.
 *
 * A day is a UTC day, like the incident and alert limits: what the project
 * used is counted from midnight UTC, and the count starts again at the next
 * midnight UTC. The check is made before each call, so the call that
 * crosses a limit finishes; nothing new starts after it.
 *
 * Tokens are every token a call used (input and output), through any LLM
 * provider. Spend is what was billed to the project's AI credits: only calls
 * through the OneUptime-hosted provider are billed, so a spend limit never
 * stops a call through the project's own provider, and on a server that does
 * not bill AI (self-hosted) there is no spend limit at all.
 *
 * The first time a limit stops OneUptime AI on a UTC day, the project's
 * owners are emailed (Server/Utils/AI/ProjectAiDailyLimitOwnerNotice), once
 * a day for each limit. Incidents and alerts not investigated because a
 * limit was reached are investigated once it no longer stops AI - after the
 * reset, or as soon as the limit is raised or removed - if they are still
 * open (Server/Utils/AI/SRE/InvestigationLimitCatchUp).
 *
 * Shared by the server, which enforces the limits and refuses a write
 * outside them, and the dashboard, which offers them, so both read a stored
 * value the same way. Kept free of React and of server code.
 */

import Permission from "../Permission";

// The Project columns that hold the limits.
export type ProjectAiDailyTokenLimitColumn = "aiDailyTokenLimit";
export type ProjectAiDailySpendLimitColumn = "aiDailySpendLimitInUSD";

export type ProjectAiDailyLimitColumn =
  | ProjectAiDailyTokenLimitColumn
  | ProjectAiDailySpendLimitColumn;

export const PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN: ProjectAiDailyTokenLimitColumn =
  "aiDailyTokenLimit";

export const PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN: ProjectAiDailySpendLimitColumn =
  "aiDailySpendLimitInUSD";

/*
 * The bounds of a limit a project sets. The lower one is 1 (see above). The
 * upper ones are far above any real day of AI work and well inside the
 * integer columns that hold them, so a typing slip is refused with a
 * sentence rather than by the database.
 */
export const MIN_PROJECT_AI_DAILY_TOKEN_LIMIT: number = 1;
export const MAX_PROJECT_AI_DAILY_TOKEN_LIMIT: number = 2_000_000_000;
export const MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD: number = 1;
export const MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD: number = 1_000_000;

// Which of the two limits stops new AI work.
export enum ProjectAiDailyLimit {
  Tokens = "Tokens",
  Spend = "Spend",
}

/*
 * The Project columns that say when each limit last stopped OneUptime AI:
 * the moment of the first time on the latest UTC day it did. Written once a
 * day per limit, by the same conditional UPDATE that decides the owners are
 * told (so they are told once a day for each limit), and read to find the
 * projects whose skipped incidents and alerts may be waiting for the reset.
 * Internal: no one reads or writes them through the API.
 */
export type ProjectAiDailyLimitReachedAtColumn =
  | "aiDailyTokenLimitReachedAt"
  | "aiDailySpendLimitReachedAt";

export const PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS: Readonly<
  Record<ProjectAiDailyLimit, ProjectAiDailyLimitReachedAtColumn>
> = {
  [ProjectAiDailyLimit.Tokens]: "aiDailyTokenLimitReachedAt",
  [ProjectAiDailyLimit.Spend]: "aiDailySpendLimitReachedAt",
};

/*
 * Where the limits are changed, as every sentence about them names it.
 */
export const PROJECT_AI_DAILY_LIMITS_LOCATION: string =
  "Project Settings → AI Features → More settings";

/*
 * Who may change the limits: the update permissions of both limit columns
 * (a test holds them to the Project model) - the same people who may turn
 * OneUptime AI off. Not a project admin: the limits decide what AI may cost.
 */
export const PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ManageProjectBilling];

// The people PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS let in, in words.
export const WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS: string =
  "a project owner or someone with Manage Billing";

// What the project has used since midnight UTC.
export interface ProjectAiDailyUsage {
  usedTokensToday: number;
  // Billed to the project's AI credits, in US cents.
  spentTodayInUSDCents: number;
}

export interface ProjectAiDailyLimitValues {
  // Null when there is no token limit.
  tokenLimit: number | null;
  // Null when there is no spend limit, or AI is not billed on this server.
  spendLimitInUSD: number | null;
}

const MILLISECONDS_IN_A_DAY: number = 24 * 60 * 60 * 1000;

const TOKEN_LIMIT_ERROR: string = `The daily AI token limit must be a whole number from ${MIN_PROJECT_AI_DAILY_TOKEN_LIMIT} to ${MAX_PROJECT_AI_DAILY_TOKEN_LIMIT.toLocaleString("en-US")}. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.`;

const SPEND_LIMIT_ERROR: string = `The daily AI spend limit must be a whole number of US dollars from ${MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD} to ${MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD.toLocaleString("en-US")}. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.`;

export default class ProjectAiDailyLimits {
  /*
   * The limit a stored value sets, or null for none. Unset, empty and
   * anything that is not a number are no limit. A number is kept as a whole
   * number; one below 1 cannot be saved, but if a row ever held one it
   * would read as reached at once (nothing allowed), never as no limit - a
   * ceiling that cannot be read is not waved through.
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

    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.max(0, Math.floor(parsed));
  }

  /*
   * The limits a project row holds, read the way the server enforces them:
   * the spend limit only counts where AI is billed.
   */
  public static getLimits(data: {
    project: Partial<Record<ProjectAiDailyLimitColumn, unknown>> | null;
    isBillingEnabled: boolean;
  }): ProjectAiDailyLimitValues {
    const tokenLimit: number | null = this.getLimit(
      data.project?.[PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN],
    );

    const spendLimitInUSD: number | null = data.isBillingEnabled
      ? this.getLimit(data.project?.[PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN])
      : null;

    return { tokenLimit, spendLimitInUSD };
  }

  // Whether either limit is set.
  public static hasLimit(limits: ProjectAiDailyLimitValues): boolean {
    return limits.tokenLimit !== null || limits.spendLimitInUSD !== null;
  }

  /*
   * Which limit stops new AI work, or null when neither does. Tokens first:
   * they apply to every call. Spend only when it counts for the work being
   * asked about - a call billed to the project's AI credits.
   */
  public static getReachedLimit(data: {
    limits: ProjectAiDailyLimitValues;
    usage: ProjectAiDailyUsage;
    isSpendCounted: boolean;
  }): ProjectAiDailyLimit | null {
    if (
      data.limits.tokenLimit !== null &&
      data.usage.usedTokensToday >= data.limits.tokenLimit
    ) {
      return ProjectAiDailyLimit.Tokens;
    }

    if (
      data.isSpendCounted &&
      data.limits.spendLimitInUSD !== null &&
      data.usage.spentTodayInUSDCents >= data.limits.spendLimitInUSD * 100
    ) {
      return ProjectAiDailyLimit.Spend;
    }

    return null;
  }

  // Midnight UTC at the start of the day `now` is in.
  public static getDayStart(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  // The next midnight UTC: when the count starts again.
  public static getNextReset(now: Date): Date {
    return new Date(this.getDayStart(now).getTime() + MILLISECONDS_IN_A_DAY);
  }

  /*
   * Whether `at` - when a limit last stopped AI, as a ...ReachedAt column
   * holds it - falls on the UTC day `now` is in. Never, or a value that is
   * not a date, is not today.
   */
  public static isToday(
    at: Date | string | null | undefined,
    now: Date,
  ): boolean {
    if (at === null || at === undefined) {
      return false;
    }

    const time: number = new Date(at).getTime();

    if (!Number.isFinite(time)) {
      return false;
    }

    return (
      time >= this.getDayStart(now).getTime() &&
      time < this.getNextReset(now).getTime()
    );
  }

  /*
   * The first sentence of everything that says a limit stopped OneUptime
   * AI - a refusal, the owners' email: which limit, and how much of it the
   * project used today. "This project has reached its daily AI token limit:
   * 5,000 of 5,000 tokens used today." Its first words are what the
   * investigation engine recognises a refusal by (AIService's
   * PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN), so they stay as they are.
   */
  public static getReachedSentence(status: {
    reachedLimit: ProjectAiDailyLimit | null;
    tokenLimit: number | null;
    spendLimitInUSD: number | null;
    usage: ProjectAiDailyUsage;
  }): string {
    if (status.reachedLimit === ProjectAiDailyLimit.Spend) {
      return `This project has reached its daily AI spend limit: ${this.formatUsd(
        status.usage.spentTodayInUSDCents,
      )} of ${this.formatUsd((status.spendLimitInUSD || 0) * 100)} spent today.`;
    }

    return `This project has reached its daily AI token limit: ${status.usage.usedTokensToday.toLocaleString(
      "en-US",
    )} of ${(status.tokenLimit || 0).toLocaleString("en-US")} tokens used today.`;
  }

  /*
   * Who can change the limits, and where, as the sentence that follows one
   * saying a limit stopped AI - for whoever reads it, who may or may not be
   * one of them: "A project owner or someone with Manage Billing can raise
   * or remove the limit in Project Settings → AI Features → More settings."
   */
  public static getWhoCanChangeSentence(): string {
    const who: string = WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS;

    return `${who.charAt(0).toUpperCase()}${who.slice(1)} can raise or remove the limit in ${PROJECT_AI_DAILY_LIMITS_LOCATION}.`;
  }

  /*
   * Why a value cannot be saved to a limit column, or null when it can.
   * Null (or nothing) clears the limit. Anything else must be a whole
   * number within the column's bounds, given as a number: the API and the
   * dashboard both turn a typed "200000" into one before a hook reads it
   * (Types/Database/NumericColumnValue).
   */
  public static getWriteError(
    column: ProjectAiDailyLimitColumn,
    value: unknown,
  ): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const isTokens: boolean = column === PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN;

    const min: number = isTokens
      ? MIN_PROJECT_AI_DAILY_TOKEN_LIMIT
      : MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD;
    const max: number = isTokens
      ? MAX_PROJECT_AI_DAILY_TOKEN_LIMIT
      : MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD;

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      return isTokens ? TOKEN_LIMIT_ERROR : SPEND_LIMIT_ERROR;
    }

    return null;
  }

  /*
   * A dollar amount the way OneUptime writes AI credits: "$25" for whole
   * dollars, "$3.20" otherwise.
   */
  public static formatUsd(amountInUSDCents: number): string {
    const cents: number = Math.max(0, Math.round(amountInUSDCents));

    if (cents % 100 === 0) {
      return `$${(cents / 100).toLocaleString("en-US")}`;
    }

    return `$${(cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
