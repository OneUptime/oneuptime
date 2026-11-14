import { JSONObject } from "../JSON";
import {
  readRecordAiTokenLimitStop,
  RecordAiTokenLimitKind,
  RecordAiTokenLimitStop,
} from "./RecordAiTokenLimit";

/*
 * How an attempt of a durable AI run ended, and why (issues #6437, #6438).
 *
 * An incident's or alert's investigation, an AI insight's triage and the
 * other runs of the investigation queue are tried more than once when an
 * attempt fails for a reason a later attempt can get past. The server says
 * how each attempt ended on the run's AttemptEnded and RunFailed events
 * (Server/Utils/AI/AIRunRetryPolicy), and the dashboard words it in the
 * reader's language: what happened, how many times OneUptime tried, and
 * what the reader can do about it.
 */

// Why an attempt failed, as the thing a person can act on.
export enum AIRunFailureKind {
  // The LLM provider did not answer within its response timeout.
  ProviderTimeout = "ProviderTimeout",
  // The LLM provider could not be reached, was overloaded or rate limited.
  ProviderUnavailable = "ProviderUnavailable",
  /*
   * The LLM provider refused the request: its key, its model or its access,
   * the provider account's quota or credit among it.
   */
  ProviderRejected = "ProviderRejected",
  // The request no longer fitted in the model's context window.
  ContextWindow = "ContextWindow",
  // There is no LLM provider to use, or the provider is not set up.
  NotConfigured = "NotConfigured",
  // One of the project's own daily AI limits was reached.
  LimitReached = "LimitReached",
  /*
   * The incident's (alert's) own daily AI token limit (issue #7157,
   * Types/AI/RecordAiTokenLimit): set to 0, which pauses the work until
   * someone raises it, or used up today, until midnight UTC. Not the
   * project's daily AI limits above, which are another setting.
   */
  IncidentTokenLimitPaused = "IncidentTokenLimitPaused",
  IncidentTokenLimitUsedUp = "IncidentTokenLimitUsedUp",
  AlertTokenLimitPaused = "AlertTokenLimitPaused",
  AlertTokenLimitUsedUp = "AlertTokenLimitUsedUp",
  // The project's OneUptime AI credits are used up.
  CreditsUsedUp = "CreditsUsedUp",
  // The server running it shut down, or the attempt stopped reporting.
  ServerStopped = "ServerStopped",
  // Anything else.
  Other = "Other",
}

// How an attempt ended.
export enum AIRunAttemptOutcome {
  // It failed, and the run is tried again when nextAttemptAt comes.
  WillRetry = "WillRetry",
  // It failed, and the run is not tried again by itself.
  GaveUp = "GaveUp",
  // The server running it shut down and handed the run back to the queue.
  HandedBack = "HandedBack",
  // It stopped reporting progress, and the stale sweep requeued the run.
  Stalled = "Stalled",
}

export interface AIRunAttemptEnd {
  outcome: AIRunAttemptOutcome;
  failureKind?: AIRunFailureKind | undefined;
  // The attempt that ended, counted from 1 (hand-backs do not count).
  attempt?: number | undefined;
  // How many attempts the run gets by itself, for this kind of failure.
  maxAttempts?: number | undefined;
  // When the next attempt is due (ISO 8601), for WillRetry.
  nextAttemptAt?: string | undefined;
  // ProviderTimeout: the response timeout the provider missed, in seconds.
  timeoutInSeconds?: number | undefined;
}

const ATTEMPT_OUTCOMES: ReadonlyArray<string> =
  Object.values(AIRunAttemptOutcome);
const FAILURE_KINDS: ReadonlyArray<string> = Object.values(AIRunFailureKind);

const readPositiveInteger: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value < 1000000
    ? value
    : undefined;
};

/*
 * An event's attemptEnd as the dashboard may trust it: the outcome and the
 * kind are ones it knows, the numbers are whole and positive, and the time
 * is a time. Null for anything else, an older event included.
 */
export const parseAIRunAttemptEnd: (
  value: unknown,
) => AIRunAttemptEnd | null = (value: unknown): AIRunAttemptEnd | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (
    typeof json["outcome"] !== "string" ||
    !ATTEMPT_OUTCOMES.includes(json["outcome"])
  ) {
    return null;
  }

  const attemptEnd: AIRunAttemptEnd = {
    outcome: json["outcome"] as AIRunAttemptOutcome,
  };

  if (
    typeof json["failureKind"] === "string" &&
    FAILURE_KINDS.includes(json["failureKind"])
  ) {
    attemptEnd.failureKind = json["failureKind"] as AIRunFailureKind;
  }

  const attempt: number | undefined = readPositiveInteger(json["attempt"]);
  const maxAttempts: number | undefined = readPositiveInteger(
    json["maxAttempts"],
  );
  const timeoutInSeconds: number | undefined = readPositiveInteger(
    json["timeoutInSeconds"],
  );

  if (attempt !== undefined) {
    attemptEnd.attempt = attempt;
  }

  if (maxAttempts !== undefined) {
    attemptEnd.maxAttempts = maxAttempts;
  }

  if (timeoutInSeconds !== undefined) {
    attemptEnd.timeoutInSeconds = timeoutInSeconds;
  }

  if (
    typeof json["nextAttemptAt"] === "string" &&
    json["nextAttemptAt"].length <= 40 &&
    !isNaN(new Date(json["nextAttemptAt"]).getTime())
  ) {
    attemptEnd.nextAttemptAt = json["nextAttemptAt"];
  }

  return attemptEnd;
};

/*
 * The words a run's failure says, matched to a kind. Every pattern is a
 * plain alternation of fixed phrases (no nested repetition), so matching an
 * error a provider wrote takes time in step with its length.
 */
const TIMEOUT_SECONDS_PATTERN: RegExp =
  /did not respond within (\d{1,6}) second/i;
const TIMEOUT_PATTERN: RegExp =
  /did not respond in time|did not respond within|timed out|timeout of \d+ ?ms exceeded|gateway timeout|ETIMEDOUT/i;
/*
 * A request too long for the model, in each provider's words: OneUptime's
 * own, OpenAI's ("maximum context length", context_length_exceeded),
 * Anthropic's ("prompt is too long", "exceed context limit"), Bedrock's
 * ("input is too long") and Gemini's ("exceeds the maximum number of
 * tokens").
 */
const CONTEXT_WINDOW_PATTERN: RegExp =
  /larger than the model's context window|context length|context window|context_length_exceeded|prompt is too long|input is too long|exceeds? (?:the )?context limit|exceeds the maximum number of tokens/i;
/*
 * No provider: AIService's own words, and "no AI provider" in the errors
 * older runs failed with, which they keep. "There is no LLM provider ..." is
 * a sentence the Dashboard says, never a run's error.
 */
const NOT_CONFIGURED_PATTERN: RegExp =
  /no llm provider configured|llm provider type is not configured|no ai provider/i;
/*
 * The project's own daily AI limits (AIService), and the record's daily
 * token limit in the words of the oldest runs, which named no record. A
 * record's limit is read first, by readRecordAiTokenLimitStop.
 */
const LIMIT_PATTERN: RegExp =
  /token budget exhausted|reached its daily AI (?:token|spend) limit/i;

// The failure kind of a record's daily AI token limit, by record and state.
const RECORD_TOKEN_LIMIT_KINDS: Readonly<
  Record<
    RecordAiTokenLimitKind,
    { paused: AIRunFailureKind; usedUp: AIRunFailureKind }
  >
> = {
  incident: {
    paused: AIRunFailureKind.IncidentTokenLimitPaused,
    usedUp: AIRunFailureKind.IncidentTokenLimitUsedUp,
  },
  alert: {
    paused: AIRunFailureKind.AlertTokenLimitPaused,
    usedUp: AIRunFailureKind.AlertTokenLimitUsedUp,
  },
};

export const RECORD_TOKEN_LIMIT_FAILURE_KINDS: ReadonlyArray<AIRunFailureKind> =
  [
    AIRunFailureKind.IncidentTokenLimitPaused,
    AIRunFailureKind.IncidentTokenLimitUsedUp,
    AIRunFailureKind.AlertTokenLimitPaused,
    AIRunFailureKind.AlertTokenLimitUsedUp,
  ];

// Whether a failure is an incident's or alert's own daily AI token limit.
export function isRecordTokenLimitFailureKind(
  failureKind: AIRunFailureKind | null | undefined,
): boolean {
  return Boolean(
    failureKind && RECORD_TOKEN_LIMIT_FAILURE_KINDS.includes(failureKind),
  );
}

// The failure kind of a record's limit that stopped a run.
export function getRecordTokenLimitFailureKind(
  stop: RecordAiTokenLimitStop,
): AIRunFailureKind {
  const kinds: { paused: AIRunFailureKind; usedUp: AIRunFailureKind } =
    RECORD_TOKEN_LIMIT_KINDS[stop.kind];

  return stop.isPaused ? kinds.paused : kinds.usedUp;
}
/*
 * The project's OneUptime AI credits (Utils/Project/ProjectBalance,
 * AIService), and the words an older run failed with.
 */
const CREDITS_PATTERN: RegExp =
  /AI credits are used up|AI credit balance is used up|out of AI credits|insufficient AI balance/i;
const SERVER_STOPPED_PATTERN: RegExp =
  /stopped reporting progress|handed back to the queue|server running it shut down/i;
/*
 * The provider's refusal: its key, its model, its access - and its own
 * account's quota or credit, which no retry gets past either.
 */
const REJECTED_PATTERN: RegExp =
  /invalid[ _]api[ _]key|incorrect api key|invalid x-api-key|unauthori[sz]ed|authentication_error|permission_denied|model_not_found|model not found|does not exist or you do not have access|insufficient_quota|exceeded your current quota|insufficient balance|not enough balance/i;
const UNAVAILABLE_PATTERN: RegExp =
  /rate[ _]limit|too many requests|overloaded|service unavailable|bad gateway|internal server error|server_error|could not be reached|refused the connection|closed the connection|could not be resolved|secure connection to the LLM provider|ECONNREFUSED|ECONNRESET|socket hang up/i;

/*
 * A run's failure, as the kind a person can act on, read from the message
 * the run failed with. The server reads the error it caught the same way
 * (AIRunRetryPolicy), and the dashboard reads a run's errorMessage with it,
 * so a run that failed before attempts recorded their end is worded too.
 */
export const classifyAIRunFailureMessage: (message: string) => {
  failureKind: AIRunFailureKind;
  timeoutInSeconds?: number | undefined;
} = (
  message: string,
): {
  failureKind: AIRunFailureKind;
  timeoutInSeconds?: number | undefined;
} => {
  // A provider's error can be long: what decides the kind is at its start.
  const text: string = (message || "").substring(0, 2000);

  if (NOT_CONFIGURED_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.NotConfigured };
  }

  const recordTokenLimit: RecordAiTokenLimitStop | null =
    readRecordAiTokenLimitStop(text);

  if (recordTokenLimit) {
    return {
      failureKind: getRecordTokenLimitFailureKind(recordTokenLimit),
    };
  }

  if (LIMIT_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.LimitReached };
  }

  if (CREDITS_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.CreditsUsedUp };
  }

  if (CONTEXT_WINDOW_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.ContextWindow };
  }

  if (SERVER_STOPPED_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.ServerStopped };
  }

  const timeoutSeconds: RegExpExecArray | null =
    TIMEOUT_SECONDS_PATTERN.exec(text);

  if (timeoutSeconds) {
    return {
      failureKind: AIRunFailureKind.ProviderTimeout,
      timeoutInSeconds: Number(timeoutSeconds[1]),
    };
  }

  if (TIMEOUT_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.ProviderTimeout };
  }

  if (REJECTED_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.ProviderRejected };
  }

  if (UNAVAILABLE_PATTERN.test(text)) {
    return { failureKind: AIRunFailureKind.ProviderUnavailable };
  }

  return { failureKind: AIRunFailureKind.Other };
};
