import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT ONEUPTIME AI READ IN A CALL'S TRANSCRIPT (issue #4875).
 *
 * When an incident call has a transcript, OneUptime AI reads it and says
 * what the call says about the incident: the cause it points at, if it
 * points at one, and what was found, tried, decided and left to do. It is
 * a reading, not a record:
 *
 *   - The cause is a SUGGESTION until a person accepts it. Nothing is
 *     written to the incident's root cause before someone clicks Use as
 *     root cause (and can edit it first); Dismiss sets it aside.
 *   - "The call did not discuss the cause enough" is an answer of its own
 *     (NotEnoughDiscussion), never a guess dressed up as one.
 *   - Every point carries the transcript lines it rests on, copied from
 *     the transcript by OneUptime - the model names lines (L12), it never
 *     quotes them - so a citation cannot say what nobody said. A cause no
 *     line supports is not suggested at all.
 *   - A finding a participant said they checked is Confirmed; anything
 *     guessed, suspected or proposed is a Hypothesis, and so is a confirmed
 *     finding no line supports.
 *
 * Stored on the call (IncidentVideoCall.callSummary) by the server, read by
 * the dashboard through readCallSummary, which keeps only what is well
 * formed: the JSON is OneUptime's own, but a column is never trusted to be.
 */

export enum CallSummaryStatus {
  // OneUptime AI is reading the transcript.
  Pending = "Pending",
  Ready = "Ready",
  // The reading stopped: the AI provider refused, a limit was reached...
  Failed = "Failed",
  // Not read: AI is off for the project.
  Skipped = "Skipped",
}

export enum RootCauseSuggestionStatus {
  // Waiting for a person.
  Suggested = "Suggested",
  // A person used it as the incident's root cause.
  Accepted = "Accepted",
  // A person set it aside.
  Dismissed = "Dismissed",
}

export enum CallSummaryRootCauseOutcome {
  Suggested = "Suggested",
  NotEnoughDiscussion = "NotEnoughDiscussion",
}

// Where the suggested cause comes from.
export enum CallSummaryBasis {
  // A participant said the cause was found, or confirmed it.
  StatedOnCall = "StatedOnCall",
  // OneUptime AI's reading of the discussion.
  Inferred = "Inferred",
}

export enum CallSummaryFindingKind {
  // A participant said they checked or saw it.
  Confirmed = "Confirmed",
  // Guessed, suspected or proposed.
  Hypothesis = "Hypothesis",
}

// One transcript line a point rests on, copied from the transcript.
export interface CallSummaryCitation {
  // The line's number in the transcript, from 1.
  line: number;
  // HH:MM:SS into the call, when the transcript has times.
  time?: string | undefined;
  speaker?: string | undefined;
  text: string;
}

export interface CallSummaryPoint {
  text: string;
  citations: Array<CallSummaryCitation>;
}

export interface CallSummaryFinding extends CallSummaryPoint {
  kind: CallSummaryFindingKind;
}

export interface CallSummaryAction extends CallSummaryPoint {
  // Who took it on, when the call says.
  owner?: string | undefined;
}

export interface CallSummaryRootCause {
  outcome: CallSummaryRootCauseOutcome;
  // One or two sentences; empty when the call did not discuss it enough.
  summary?: string | undefined;
  basis?: CallSummaryBasis | undefined;
  citations: Array<CallSummaryCitation>;
}

export interface CallSummary {
  version: number;
  // The reading this is: a newer one replaces it.
  runId: string;
  // ISO 8601.
  generatedAt: string;
  rootCause: CallSummaryRootCause;
  findings: Array<CallSummaryFinding>;
  stepsTried: Array<CallSummaryPoint>;
  decisions: Array<CallSummaryPoint>;
  actions: Array<CallSummaryAction>;
  openQuestions: Array<CallSummaryPoint>;
  // How many lines of the transcript OneUptime AI read, in how many parts.
  linesRead: number;
  partsRead: number;
}

export const CALL_SUMMARY_VERSION: number = 1;

// The most points of each kind a summary keeps.
export const MAX_CALL_SUMMARY_POINTS: number = 12;

// The most lines one point cites.
export const MAX_CALL_SUMMARY_CITATIONS: number = 5;

// The longest a cause, and any other point, may be written.
export const MAX_CALL_SUMMARY_ROOT_CAUSE_LENGTH: number = 1_200;
export const MAX_CALL_SUMMARY_POINT_LENGTH: number = 600;
export const MAX_CALL_SUMMARY_CITATION_LENGTH: number = 2_000;
export const MAX_CALL_SUMMARY_OWNER_LENGTH: number = 120;

/*
 * A reading still Pending this long after it started stopped somewhere -
 * the server restarted mid-way - and is offered again (Try again).
 */
export const CALL_SUMMARY_STALE_AFTER_MS: number = 15 * 60 * 1000;

export function isCallSummaryStatus(value: unknown): value is CallSummaryStatus {
  return (
    typeof value === "string" &&
    (Object.values(CallSummaryStatus) as Array<string>).includes(value)
  );
}

export function isRootCauseSuggestionStatus(
  value: unknown,
): value is RootCauseSuggestionStatus {
  return (
    typeof value === "string" &&
    (Object.values(RootCauseSuggestionStatus) as Array<string>).includes(value)
  );
}

// Whether a Pending reading has been going for too long to still be running.
export function isCallSummaryStale(data: {
  status: CallSummaryStatus | string | undefined | null;
  updatedAt: Date | string | undefined | null;
  now?: Date | undefined;
}): boolean {
  if (data.status !== CallSummaryStatus.Pending) {
    return false;
  }

  if (!data.updatedAt) {
    return true;
  }

  const startedAt: number =
    data.updatedAt instanceof Date
      ? data.updatedAt.getTime()
      : Date.parse(data.updatedAt);

  if (!Number.isFinite(startedAt)) {
    return true;
  }

  return (
    (data.now || new Date()).getTime() - startedAt > CALL_SUMMARY_STALE_AFTER_MS
  );
}

// How many points the summary has besides its cause.
export function getCallSummaryPointCount(summary: CallSummary): number {
  return (
    summary.findings.length +
    summary.stepsTried.length +
    summary.decisions.length +
    summary.actions.length +
    summary.openQuestions.length
  );
}

/*
 * A summary as stored, read defensively: anything that is not well formed
 * is left out, and a value with no cause at all is no summary (null).
 */
export function readCallSummary(value: unknown): CallSummary | null {
  const json: JSONObject | null = asObject(value);

  if (!json) {
    return null;
  }

  const rootCause: CallSummaryRootCause | null = readRootCause(
    json["rootCause"],
  );

  if (!rootCause) {
    return null;
  }

  return {
    version:
      typeof json["version"] === "number"
        ? json["version"]
        : CALL_SUMMARY_VERSION,
    runId: typeof json["runId"] === "string" ? json["runId"] : "",
    generatedAt:
      typeof json["generatedAt"] === "string" ? json["generatedAt"] : "",
    rootCause,
    findings: readPoints(json["findings"]).map(
      (point: ReadPoint): CallSummaryFinding => {
        return {
          text: point.text,
          citations: point.citations,
          kind:
            point.raw["kind"] === CallSummaryFindingKind.Confirmed &&
            point.citations.length > 0
              ? CallSummaryFindingKind.Confirmed
              : CallSummaryFindingKind.Hypothesis,
        };
      },
    ),
    stepsTried: toPoints(readPoints(json["stepsTried"])),
    decisions: toPoints(readPoints(json["decisions"])),
    actions: readPoints(json["actions"]).map(
      (point: ReadPoint): CallSummaryAction => {
        const owner: string = readText(
          point.raw["owner"],
          MAX_CALL_SUMMARY_OWNER_LENGTH,
        );

        const action: CallSummaryAction = {
          text: point.text,
          citations: point.citations,
        };

        if (owner) {
          action.owner = owner;
        }

        return action;
      },
    ),
    openQuestions: toPoints(readPoints(json["openQuestions"])),
    linesRead: readCount(json["linesRead"]),
    partsRead: readCount(json["partsRead"]),
  };
}

function readRootCause(value: JSONValue | undefined): CallSummaryRootCause | null {
  const json: JSONObject | null = asObject(value);

  if (!json) {
    return null;
  }

  const citations: Array<CallSummaryCitation> = readCitations(
    json["citations"],
  );
  const summary: string = readText(
    json["summary"],
    MAX_CALL_SUMMARY_ROOT_CAUSE_LENGTH,
  );

  /*
   * A suggested cause has words and at least one line under it; anything
   * less is the call not having said enough.
   */
  if (
    json["outcome"] !== CallSummaryRootCauseOutcome.Suggested ||
    !summary ||
    citations.length === 0
  ) {
    return {
      outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
      citations: [],
    };
  }

  return {
    outcome: CallSummaryRootCauseOutcome.Suggested,
    summary,
    basis:
      json["basis"] === CallSummaryBasis.StatedOnCall
        ? CallSummaryBasis.StatedOnCall
        : CallSummaryBasis.Inferred,
    citations,
  };
}

interface ReadPoint extends CallSummaryPoint {
  raw: JSONObject;
}

function readPoints(value: JSONValue | undefined): Array<ReadPoint> {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: Array<ReadPoint> = [];

  for (const item of value) {
    const json: JSONObject | null = asObject(item);

    if (!json) {
      continue;
    }

    const text: string = readText(json["text"], MAX_CALL_SUMMARY_POINT_LENGTH);

    if (!text) {
      continue;
    }

    points.push({
      text,
      citations: readCitations(json["citations"]),
      raw: json,
    });

    if (points.length >= MAX_CALL_SUMMARY_POINTS) {
      break;
    }
  }

  return points;
}

function toPoints(points: Array<ReadPoint>): Array<CallSummaryPoint> {
  return points.map((point: ReadPoint): CallSummaryPoint => {
    return { text: point.text, citations: point.citations };
  });
}

function readCitations(
  value: JSONValue | undefined,
): Array<CallSummaryCitation> {
  if (!Array.isArray(value)) {
    return [];
  }

  const citations: Array<CallSummaryCitation> = [];

  for (const item of value) {
    const json: JSONObject | null = asObject(item);

    if (!json) {
      continue;
    }

    const line: JSONValue | undefined = json["line"];
    const text: string = readText(
      json["text"],
      MAX_CALL_SUMMARY_CITATION_LENGTH,
    );

    if (
      typeof line !== "number" ||
      !Number.isInteger(line) ||
      line < 1 ||
      !text
    ) {
      continue;
    }

    const citation: CallSummaryCitation = { line, text };
    const time: string = readText(json["time"], 16);
    const speaker: string = readText(json["speaker"], 120);

    if (time) {
      citation.time = time;
    }

    if (speaker) {
      citation.speaker = speaker;
    }

    citations.push(citation);

    if (citations.length >= MAX_CALL_SUMMARY_CITATIONS) {
      break;
    }
  }

  return citations;
}

function readText(value: JSONValue | undefined, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed: string = value.trim();

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
    : trimmed;
}

function readCount(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function asObject(value: unknown): JSONObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JSONObject;
}
