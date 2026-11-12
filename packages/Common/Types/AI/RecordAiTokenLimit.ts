/*
 * An incident's or alert's own daily AI token limit (issue #7157), in the
 * words every message about it shares.
 *
 * Each kind of record has a limit of its own for automatic AI work: the
 * Daily Incident AI Token Limit and the Daily Alert AI Token Limit, under
 * Incidents (Alerts) → AI → Settings → More settings. It counts every
 * incident's (alert's) automatic AI work together, over the UTC day. Once
 * the work used it up, the next model call is refused until midnight UTC,
 * or until someone raises the limit. A limit of 0 (or below) is a pause
 * instead: waiting does not lift it, only raising it above 0 or clearing
 * it does.
 *
 * These are not the project's own daily AI limits (Project Settings → AI →
 * AI Features → More settings), which stop all AI work of the project and
 * have words of their own (Types/AI/ProjectAiDailyLimits).
 *
 * The run's error (AIService), Try again and Investigate now on an
 * investigation, Try again on an AI fix, and Ask AI's start_investigation
 * say the stop in these words. The Dashboard holds the same sentences as
 * translation keys (AiRunFailureWords, RemediationStepCopy), and tests hold
 * the two to each other, so a sentence changed here is changed there too.
 */

export type RecordAiTokenLimitKind = "incident" | "alert";

export const RECORD_AI_TOKEN_LIMIT_KINDS: ReadonlyArray<RecordAiTokenLimitKind> =
  ["incident", "alert"];

// Where a kind's limit stands, as the server reads it before a model call.
export interface RecordAiTokenLimitState {
  // Null when the project set no limit, which nothing stops.
  limitInTokens: number | null;
  // Today's automatic AI work of that kind, in tokens.
  usedTokensToday: number;
}

export interface RecordAiTokenLimitWords {
  // The field's name, as the AI settings page titles it.
  limitName: string;
  // Where the field is, as the side menu and the page name it.
  location: string;
  // The limit is 0 or below: what happened, then what to do.
  paused: string;
  pausedStep: string;
  // Today's work used the limit up: what happened, then what to do.
  usedUp: string;
  usedUpStep: string;
}

/*
 * Every sentence whole, for each kind, so a language words each one its
 * own way (the Dashboard's keys are these very sentences).
 */
export const RECORD_AI_TOKEN_LIMIT_WORDS: Readonly<
  Record<RecordAiTokenLimitKind, RecordAiTokenLimitWords>
> = {
  incident: {
    limitName: "Daily Incident AI Token Limit",
    location: "Incidents → AI → Settings → More settings",
    paused:
      "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents.",
    pausedStep:
      "Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
    usedUp:
      "Automatic AI work for incidents used up today's Daily Incident AI Token Limit.",
    usedUpStep:
      "Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  },
  alert: {
    limitName: "Daily Alert AI Token Limit",
    location: "Alerts → AI → Settings → More settings",
    paused:
      "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts.",
    pausedStep:
      "Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
    usedUp:
      "Automatic AI work for alerts used up today's Daily Alert AI Token Limit.",
    usedUpStep:
      "Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  },
};

/*
 * A limit of 0, or below, pauses the work rather than running out: the safe
 * reading of "0 tokens allowed", which the AI card and the server's reasons
 * read the same way. No limit (null) never stops anything.
 */
export function isRecordAiTokenLimitPaused(
  limitInTokens: number | null | undefined,
): boolean {
  return (
    typeof limitInTokens === "number" &&
    !Number.isNaN(limitInTokens) &&
    limitInTokens <= 0
  );
}

/*
 * What stopped the work, and what to do, as one message with no numbers:
 * Try again's and Investigate now's refusals, and a refused AI fix.
 * Without a state, the limit is taken as used up - the only way the work
 * stops when the limit could not be read back.
 */
export function getRecordAiTokenLimitMessage(
  kind: RecordAiTokenLimitKind,
  state?: Pick<RecordAiTokenLimitState, "limitInTokens"> | null | undefined,
): string {
  const words: RecordAiTokenLimitWords = RECORD_AI_TOKEN_LIMIT_WORDS[kind];

  return isRecordAiTokenLimitPaused(state?.limitInTokens)
    ? `${words.paused} ${words.pausedStep}`
    : `${words.usedUp} ${words.usedUpStep}`;
}

/*
 * The error a model call is refused with (AIService), which becomes the
 * run's error: the paused message as it is, and a used-up limit with how
 * much of it today's work used - "Automatic AI work for incidents used
 * 1,200 of its Daily Incident AI Token Limit of 1,000 tokens today." - for
 * whoever reads the API or the AI Logs. Numbers in English, as every other
 * server message writes them.
 */
export function getRecordAiTokenLimitRunError(
  kind: RecordAiTokenLimitKind,
  state: RecordAiTokenLimitState,
): string {
  const words: RecordAiTokenLimitWords = RECORD_AI_TOKEN_LIMIT_WORDS[kind];

  if (isRecordAiTokenLimitPaused(state.limitInTokens)) {
    return `${words.paused} ${words.pausedStep}`;
  }

  const used: string = Math.max(0, state.usedTokensToday).toLocaleString(
    "en-US",
  );
  const limit: string = (state.limitInTokens || 0).toLocaleString("en-US");
  const records: string = kind === "incident" ? "incidents" : "alerts";

  return `Automatic AI work for ${records} used ${used} of its ${words.limitName} of ${limit} tokens today. ${words.usedUpStep}`;
}

/*
 * The run errors a record's limit stopped, read back: the words above, and
 * the words a run failed with before them, which runs already stored keep.
 * Each pattern is a fixed phrase around one bounded run of digits, so
 * reading an error takes time in step with its length.
 *
 *   - "The Daily Incident AI Token Limit is set to 0, ..." (paused)
 *   - "Automatic AI work for incidents used up today's Daily Incident AI
 *     Token Limit." and "... used 1,200 of its Daily Incident AI Token
 *     Limit of 1,000 tokens today." (used up)
 *   - Before: "Daily autonomous AI token budget exhausted (0 of 0 tokens
 *     used today). Autonomous AI requests resume tomorrow (UTC) — raise or
 *     unset the limit under Incidents > AI > Settings." A limit of 0 or
 *     below was a pause then too, whatever the words said. The oldest of
 *     them named no record ("in the AI settings pages"): those are read as
 *     no record's limit.
 */
const PAUSED_PATTERN: RegExp =
  /\bDaily (Incident|Alert) AI Token Limit is set to 0\b/i;
const USED_UP_PATTERN: RegExp =
  /\bused (?:up today's|[\d,]{1,20} of its) Daily (Incident|Alert) AI Token Limit\b/i;
const OLD_BUDGET_PATTERN: RegExp =
  /\btoken budget exhausted \(-?[\d,.]{1,20} of (-?[\d,.]{1,20}) tokens used today\)/i;
const OLD_SETTINGS_PATTERN: RegExp =
  /\bunder (Incidents|Alerts) > AI > Settings\b/i;
const NOT_A_DIGIT: RegExp = /\D/g;

export const RECORD_AI_TOKEN_LIMIT_PATTERNS: ReadonlyArray<RegExp> = [
  PAUSED_PATTERN,
  USED_UP_PATTERN,
  OLD_BUDGET_PATTERN,
  OLD_SETTINGS_PATTERN,
];

export interface RecordAiTokenLimitStop {
  kind: RecordAiTokenLimitKind;
  isPaused: boolean;
}

function toKind(word: string | undefined): RecordAiTokenLimitKind {
  return (word || "").toLowerCase().startsWith("alert") ? "alert" : "incident";
}

/*
 * Which record's limit stopped a run, and whether it was paused, read from
 * the run's error. Null for any other error - the project's own daily AI
 * limits among them, and the oldest budget errors that name no record.
 */
export function readRecordAiTokenLimitStop(
  message: string | null | undefined,
): RecordAiTokenLimitStop | null {
  // What decides it is at an error's start.
  const text: string = (message || "").substring(0, 2000);

  const paused: RegExpExecArray | null = PAUSED_PATTERN.exec(text);

  if (paused) {
    return { kind: toKind(paused[1]), isPaused: true };
  }

  const usedUp: RegExpExecArray | null = USED_UP_PATTERN.exec(text);

  if (usedUp) {
    return { kind: toKind(usedUp[1]), isPaused: false };
  }

  const oldBudget: RegExpExecArray | null = OLD_BUDGET_PATTERN.exec(text);
  const oldSettings: RegExpExecArray | null = OLD_SETTINGS_PATTERN.exec(text);

  if (!oldBudget || !oldSettings) {
    return null;
  }

  const limitText: string = oldBudget[1] || "";
  const limitDigits: string = limitText.replace(NOT_A_DIGIT, "");
  const limit: number =
    (limitText.startsWith("-") ? -1 : 1) * Number(limitDigits || "0");

  return {
    kind: toKind(oldSettings[1]),
    isPaused: isRecordAiTokenLimitPaused(limit),
  };
}
