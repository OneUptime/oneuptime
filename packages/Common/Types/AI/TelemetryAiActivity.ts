import { JSONObject } from "../JSON";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
  isTelemetryAiLane,
} from "./TelemetryAi";

/*
 * WHAT A TELEMETRY PRODUCT'S AI SECTION READS FROM THE SERVER
 * (Server/API/TelemetryAiAPI): whether OneUptime AI can work on the lane's
 * problems now, and if not what to do first (its Settings page), and the
 * record of what OneUptime AI did with them (its Logs page). The wire
 * shapes, their paths and the readers the Dashboard parses them with -
 * defensively: whatever does not hold together reads as nothing.
 */

export const TELEMETRY_AI_READINESS_PATH: string = "/telemetry-ai/readiness";

export const TELEMETRY_AI_LOGS_PATH: string = "/telemetry-ai/logs";

/*
 * "Fix with AI" on a lane's finding (Utils/Suggestions/TelemetryAi
 * FixSuggestion): what it offers, and the pull request it starts. Traces'
 * findings first; the Profiler's keep the Profiler's own Fix with AI.
 */
export const TELEMETRY_AI_FIX_SUGGESTION_PATH: string =
  "/telemetry-ai/fix-suggestion";

export const TELEMETRY_AI_FIX_PATH: string = "/telemetry-ai/fix";

// The most entries one page of a lane's logs holds.
export const TELEMETRY_AI_LOGS_PAGE_SIZE: number = 20;

// The most recent problems a lane's logs are read for.
export const TELEMETRY_AI_LOGS_MAX_PROBLEMS: number = 1000;

/*
 * What stands between a lane and its first pull request, in the order a
 * person fixes them: Enable AI and the lane's switch (the page's own
 * switches say those), a repository connected in Code, and what Code's own
 * gate says for it (the plan, AI credits, a Runner online).
 */
export interface TelemetryAiReadinessBlockerJSON {
  type: string;
  message: string;
  repositoryId?: string | undefined;
  runnerName?: string | undefined;
}

export interface TelemetryAiReadinessJSON {
  lane: TelemetryAiLane;
  isAiEnabled: boolean;
  isLaneOn: boolean;
  // Repositories OneUptime reaches, which a fix can open in.
  connectedRepositoryCount: number;
  /*
   * What Code's gate says for the first of them, when it says anything:
   * its type (CodeTaskBlockerType), its words, the repository it was asked
   * about (for a fix in the repository's settings - its Runner) and the
   * Runner it names. Null when OneUptime AI can work in it now, or there is
   * no repository to ask about.
   */
  blocker: TelemetryAiReadinessBlockerJSON | null;
  // Pull requests OneUptime opened on its own today, and the most a day.
  automaticFixesToday: number;
  maxAutomaticFixesPerDay: number;
}

// The one step to take before OneUptime AI can open pull requests, or none.
export enum TelemetryAiReadinessStep {
  ConnectRepository = "ConnectRepository",
  ClearCodeBlocker = "ClearCodeBlocker",
}

/*
 * The steps a readiness says are missing, first to fix first. Enable AI
 * and the lane's switch are not among them: the page draws those itself.
 */
export function getTelemetryAiReadinessSteps(
  readiness: TelemetryAiReadinessJSON,
): Array<TelemetryAiReadinessStep> {
  if (readiness.connectedRepositoryCount <= 0) {
    return [TelemetryAiReadinessStep.ConnectRepository];
  }

  if (readiness.blocker) {
    return [TelemetryAiReadinessStep.ClearCodeBlocker];
  }

  return [];
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseTelemetryAiReadiness(
  value: unknown,
): TelemetryAiReadinessJSON | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    !isTelemetryAiLane(record["lane"]) ||
    typeof record["isAiEnabled"] !== "boolean" ||
    typeof record["isLaneOn"] !== "boolean" ||
    !isFiniteCount(record["connectedRepositoryCount"]) ||
    !isFiniteCount(record["automaticFixesToday"])
  ) {
    return null;
  }

  const blockerRecord: unknown = record["blocker"];
  let blocker: TelemetryAiReadinessJSON["blocker"] = null;

  if (
    blockerRecord &&
    typeof blockerRecord === "object" &&
    !Array.isArray(blockerRecord)
  ) {
    const type: string = readText((blockerRecord as JSONObject)["type"]);
    const message: string = readText((blockerRecord as JSONObject)["message"]);

    if (type && message) {
      blocker = { type, message };

      const repositoryId: string = readText(
        (blockerRecord as JSONObject)["repositoryId"],
      );
      const runnerName: string = readText(
        (blockerRecord as JSONObject)["runnerName"],
      );

      if (repositoryId) {
        blocker.repositoryId = repositoryId;
      }

      if (runnerName) {
        blocker.runnerName = runnerName;
      }
    }
  }

  return {
    lane: record["lane"] as TelemetryAiLane,
    isAiEnabled: record["isAiEnabled"] as boolean,
    isLaneOn: record["isLaneOn"] as boolean,
    connectedRepositoryCount: Math.floor(
      record["connectedRepositoryCount"] as number,
    ),
    blocker,
    automaticFixesToday: Math.floor(record["automaticFixesToday"] as number),
    maxAutomaticFixesPerDay: isFiniteCount(record["maxAutomaticFixesPerDay"])
      ? Math.floor(record["maxAutomaticFixesPerDay"] as number)
      : TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  };
}

// What one entry of a lane's logs is about.
export enum TelemetryAiLogKind {
  // OneUptime AI looked into a problem: the insight's triage.
  Investigation = "Investigation",
  // OneUptime AI was asked to open a pull request: a Code task.
  PullRequest = "PullRequest",
}

// How an entry stands, in the words its row says.
export enum TelemetryAiLogState {
  Waiting = "Waiting",
  Working = "Working",
  Done = "Done",
  NothingToChange = "NothingToChange",
  WaitingForYou = "WaitingForYou",
  Failed = "Failed",
  Stopped = "Stopped",
}

export interface TelemetryAiLogPullRequestJSON {
  number?: number | undefined;
  url?: string | undefined;
  // PullRequestState: "open", "closed" or "merged".
  state: string;
}

export interface TelemetryAiLogEntryJSON {
  runId: string;
  kind: TelemetryAiLogKind;
  // ISO-8601: when it started.
  at: string;
  state: TelemetryAiLogState;
  /*
   * The problem it was about, and its kind (AIInsightType): an
   * investigation's verdict is said in its kind's words.
   */
  insight: {
    id: string;
    title: string;
    serviceName?: string | undefined;
    type?: string | undefined;
  };
  // A person asked for it (on the insight); otherwise OneUptime did, itself.
  requestedBy?: string | undefined;
  // PullRequest: the Code task, its repository and its pull request.
  taskId?: string | undefined;
  repositoryName?: string | undefined;
  /*
   * Where that repository is hosted (CodeRepositoryType), which says how
   * its pull request is drawn: a merge request, "!12", on GitLab.
   */
  repositoryHostedAt?: string | undefined;
  pullRequest?: TelemetryAiLogPullRequestJSON | undefined;
  // Investigation: the verdict it ended with (ExceptionAIClassification).
  classification?: string | undefined;
}

export interface TelemetryAiLogsJSON {
  entries: Array<TelemetryAiLogEntryJSON>;
  totalCount: number;
}

const LOG_KINDS: ReadonlyArray<string> = Object.values(TelemetryAiLogKind);
const LOG_STATES: ReadonlyArray<string> = Object.values(TelemetryAiLogState);

function parseEntry(value: unknown): TelemetryAiLogEntryJSON | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const insight: unknown = record["insight"];

  if (
    !readText(record["runId"]) ||
    !LOG_KINDS.includes(readText(record["kind"])) ||
    !LOG_STATES.includes(readText(record["state"])) ||
    !readText(record["at"]) ||
    !insight ||
    typeof insight !== "object" ||
    Array.isArray(insight) ||
    !readText((insight as JSONObject)["id"])
  ) {
    return null;
  }

  const entry: TelemetryAiLogEntryJSON = {
    runId: readText(record["runId"]),
    kind: readText(record["kind"]) as TelemetryAiLogKind,
    at: readText(record["at"]),
    state: readText(record["state"]) as TelemetryAiLogState,
    insight: {
      id: readText((insight as JSONObject)["id"]),
      title: readText((insight as JSONObject)["title"]),
    },
  };

  const serviceName: string = readText((insight as JSONObject)["serviceName"]);

  if (serviceName) {
    entry.insight.serviceName = serviceName;
  }

  const insightType: string = readText((insight as JSONObject)["type"]);

  if (insightType) {
    entry.insight.type = insightType;
  }

  for (const key of [
    "requestedBy",
    "taskId",
    "repositoryName",
    "repositoryHostedAt",
    "classification",
  ] as const) {
    const text: string = readText(record[key]);

    if (text) {
      entry[key] = text;
    }
  }

  const pullRequest: unknown = record["pullRequest"];

  if (
    pullRequest &&
    typeof pullRequest === "object" &&
    !Array.isArray(pullRequest) &&
    readText((pullRequest as JSONObject)["state"])
  ) {
    const parsed: TelemetryAiLogPullRequestJSON = {
      state: readText((pullRequest as JSONObject)["state"]),
    };
    const number: unknown = (pullRequest as JSONObject)["number"];
    const url: string = readText((pullRequest as JSONObject)["url"]);

    if (typeof number === "number" && Number.isInteger(number) && number > 0) {
      parsed.number = number;
    }

    if (url) {
      parsed.url = url;
    }

    entry.pullRequest = parsed;
  }

  return entry;
}

export function parseTelemetryAiLogs(
  value: unknown,
): TelemetryAiLogsJSON | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    !Array.isArray(record["entries"]) ||
    !isFiniteCount(record["totalCount"])
  ) {
    return null;
  }

  const entries: Array<TelemetryAiLogEntryJSON> = [];

  for (const item of record["entries"] as Array<unknown>) {
    const entry: TelemetryAiLogEntryJSON | null = parseEntry(item);

    if (entry) {
      entries.push(entry);
    }
  }

  return {
    entries,
    totalCount: Math.floor(record["totalCount"] as number),
  };
}
