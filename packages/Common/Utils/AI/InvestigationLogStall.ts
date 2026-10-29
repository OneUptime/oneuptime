import { JSONObject } from "../../Types/JSON";

/*
 * AN INVESTIGATION THAT COULD NOT TELL THE CAUSE FOR LACK OF LOGS (the
 * follow-up of #5242 that #5273 listed): it says so, and offers a way
 * forward.
 *
 * Whether the logs stood in the way is decided from what the server knows,
 * never from what the model wrote (every lane's rule: no LLM decides what is
 * a problem):
 *
 *  - the investigation could not tell the cause - a positive inconclusive
 *    verdict (AIConfidenceSignal.shouldEnqueueInstrumentationTask: the
 *    evidence floor, or the constrained classification), never a failed
 *    classification;
 *  - none of its log searches found a line - its own server-minted
 *    citations of search_logs and log_histogram, rows and all;
 *  - and either no log reached OneUptime for the project from the hour
 *    before the incident or alert started until the investigation ran
 *    (NoLogs: there was nothing to read), or some did and its searches still
 *    found nothing (NoMatchingLogs: nothing about this one).
 *
 * An investigation that found a log line, or found the cause, or never
 * searched the logs of a project that has them, is not stalled for lack of
 * logs and says nothing of the kind.
 *
 * Pure: the server decides with it, the Dashboard reads what the run
 * recorded with it, and the tests and docs suites hold both to it.
 */

export enum InvestigationLogStallReason {
  // No log reached OneUptime around the record: nothing to read.
  NoLogs = "NoLogs",
  // Logs reached OneUptime, and none of the investigation's searches found a line.
  NoMatchingLogs = "NoMatchingLogs",
}

// The toolbox's log reads: a citation of either is a search of the logs.
export const INVESTIGATION_LOG_TOOL_NAMES: ReadonlyArray<string> = [
  "search_logs",
  "log_histogram",
];

/*
 * How far before the record started the logs are looked for: an hour, the
 * window an investigation reads first.
 */
export const INVESTIGATION_LOG_WINDOW_MINUTES_BEFORE: number = 60;

export interface InvestigationLogStall {
  reason: InvestigationLogStallReason;
  // How many times the investigation searched the logs, and found nothing.
  logSearchCount: number;
  // The window that was checked for logs, as ISO timestamps.
  windowStart: string;
  windowEnd: string;
}

// A citation as the investigation minted it: which tool, how many rows.
export interface InvestigationLogCitation {
  toolName: string;
  rowCount: number;
}

export interface InvestigationLogSearches {
  // Log searches the investigation ran.
  searchCount: number;
  // Of them, the ones that found at least one line.
  searchesWithLines: number;
}

export function isInvestigationLogTool(toolName: string): boolean {
  return INVESTIGATION_LOG_TOOL_NAMES.includes((toolName || "").trim());
}

// What the investigation's log searches found, from its citations.
export function getInvestigationLogSearches(
  citations: ReadonlyArray<InvestigationLogCitation>,
): InvestigationLogSearches {
  let searchCount: number = 0;
  let searchesWithLines: number = 0;

  for (const citation of citations) {
    if (!citation || !isInvestigationLogTool(citation.toolName)) {
      continue;
    }

    searchCount++;

    if (
      typeof citation.rowCount === "number" &&
      Number.isFinite(citation.rowCount) &&
      citation.rowCount > 0
    ) {
      searchesWithLines++;
    }
  }

  return { searchCount, searchesWithLines };
}

/*
 * Whether, and why, the logs stood in the investigation's way. `hasLogs` is
 * whether any log reached OneUptime in the window, or null when that could
 * not be read - then only the investigation's own searches speak: searched
 * and found nothing is NoMatchingLogs, never searched is nothing to say.
 */
export function decideInvestigationLogStall(input: {
  isInconclusive: boolean;
  searches: InvestigationLogSearches;
  hasLogs: boolean | null;
}): InvestigationLogStallReason | null {
  if (!input.isInconclusive || input.searches.searchesWithLines > 0) {
    return null;
  }

  if (input.hasLogs === false) {
    return InvestigationLogStallReason.NoLogs;
  }

  return input.searches.searchCount > 0
    ? InvestigationLogStallReason.NoMatchingLogs
    : null;
}

// The window an investigation's logs are looked for in.
export function getInvestigationLogWindow(data: {
  subjectStartedAt: Date | null | undefined;
  now: Date;
}): { startTime: Date; endTime: Date } {
  const startedAt: Date =
    data.subjectStartedAt &&
    Number.isFinite(data.subjectStartedAt.getTime()) &&
    data.subjectStartedAt.getTime() <= data.now.getTime()
      ? data.subjectStartedAt
      : data.now;

  return {
    startTime: new Date(
      startedAt.getTime() - INVESTIGATION_LOG_WINDOW_MINUTES_BEFORE * 60 * 1000,
    ),
    endTime: data.now,
  };
}

export function investigationLogStallToJSON(
  stall: InvestigationLogStall,
): JSONObject {
  return {
    reason: stall.reason,
    logSearchCount: stall.logSearchCount,
    windowStart: stall.windowStart,
    windowEnd: stall.windowEnd,
  };
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

/*
 * Reads what a run recorded (the InvestigationStalled event's
 * resultSummary.logStall). Anything that does not hold together - an
 * unknown reason, a count that is no count, a window that is no window -
 * reads as no stall, so the card never says what the run did not record.
 */
export function parseInvestigationLogStall(
  value: unknown,
): InvestigationLogStall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const reason: unknown = record["reason"];

  if (
    reason !== InvestigationLogStallReason.NoLogs &&
    reason !== InvestigationLogStallReason.NoMatchingLogs
  ) {
    return null;
  }

  const count: unknown = record["logSearchCount"];

  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    (reason === InvestigationLogStallReason.NoMatchingLogs && count === 0)
  ) {
    return null;
  }

  const windowStart: string | null = readTimestamp(record["windowStart"]);
  const windowEnd: string | null = readTimestamp(record["windowEnd"]);

  if (!windowStart || !windowEnd) {
    return null;
  }

  return {
    reason: reason as InvestigationLogStallReason,
    logSearchCount: count,
    windowStart,
    windowEnd,
  };
}

/*
 * The line the run's own record says it in, in English (the AIRunEvent's
 * message): what an API reader or a support engineer reads. The card words
 * it in the reader's language from the structured fields.
 */
export function describeInvestigationLogStall(
  stall: InvestigationLogStall,
  subjectType: "incident" | "alert",
): string {
  if (stall.reason === InvestigationLogStallReason.NoLogs) {
    return `No logs reached OneUptime from the hour before this ${subjectType} started, so OneUptime AI had none to read.`;
  }

  return `OneUptime AI searched the logs ${
    stall.logSearchCount === 1 ? "once" : `${stall.logSearchCount} times`
  } and found nothing about this ${subjectType}.`;
}
