import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
  SessionReplayRefusalCount,
} from "Common/Types/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
  SESSION_REPLAY_STALE_CHUNK_MS,
  describeRefusalReason,
  formatBytesForCopy,
  formatCountForCopy,
  formatDurationForCopy,
  formatRelativeAge,
  getTopRefusal,
  parseHealthTimestamp,
} from "Common/Utils/SessionReplay/SessionReplayHealth";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * The Replay Health page's reading of one status, as data.
 *
 * React-free on purpose: every branch here decides what colour a stage is
 * or what a meter says, and each of those is a node test with a fixed clock
 * (App/Tests/Dashboard/RecordingHealthModel.test.ts). The view in
 * RecordingHealthDashboard.tsx only lays the answers out.
 *
 * The rules are the diagnosis's rules, applied per stage: a counter that was
 * not read says "unknown" and is neutral rather than green, and a stage is
 * only amber or red when the status actually shows something wrong with it.
 *
 * Every value and caption is in the language of the Translator the page
 * hands in (useTranslator()), each sentence looked up whole with its ages,
 * durations and counts in place; without one it is English, word for word
 * as it always was, which is what the node tests read.
 */

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A fixed word or sentence in the translator's language.
function translateLine(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

// An age ("5m ago") in the language of the sentence it goes into.
function ageIn(fromUnixMs: number, nowUnixMs: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatRelativeAge(fromUnixMs, nowUnixMs, sentence);
  });
}

// A duration ("7h") in the language of the sentence it goes into.
function durationIn(durationMs: number): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatDurationForCopy(durationMs, sentence);
  });
}

export type HealthTone = "ok" | "warning" | "error" | "neutral";

export type RecordingPipelineStageKey =
  | "recorder"
  | "policy"
  | "uploads"
  | "sessions";

export interface RecordingPipelineStage {
  key: RecordingPipelineStageKey;
  /*
   * The stage's name as its English key: the view looks it up where it
   * draws it, and hands it as it is to the (i) beside it, which looks it up
   * itself.
   */
  label: string;
  /* The one big value: "2m ago", "143", "Off". */
  value: string;
  /* One quiet line that says what the value means. */
  caption: string;
  tone: HealthTone;
}

/*
 * The capture trigger by the words the settings page gives it, put into the
 * policy stage's caption with the sentence (translatableTerm).
 */
const CAPTURE_TRIGGER_SHORT_LABELS: Record<string, string> = {
  [SessionReplayCaptureTrigger.Always]: translationKey("Always"),
  [SessionReplayCaptureTrigger.OnErrorOrFrustration]: translationKey(
    "On error or frustration",
  ),
};

function describeTrigger(captureTrigger: string): string {
  return (
    CAPTURE_TRIGGER_SHORT_LABELS[captureTrigger] ?? translationKey("Uploads")
  );
}

/* Stage 1: has a page on the customer's site loaded the recorder lately? */
function buildRecorderStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
  translator: Translator,
): RecordingPipelineStage {
  const label: string = translationKey("Recorder loaded");

  if (status.lastConfigFetchAt === null) {
    if (status.lastChunkReceivedAt !== null) {
      return {
        key: "recorder",
        label,
        value: translateLine("not reported", translator),
        caption: translateLine(
          "This server does not report policy fetches, but a chunk has arrived, so a recorder has loaded.",
          translator,
        ),
        tone: "neutral",
      };
    }

    return {
      key: "recorder",
      label,
      value: translateLine("Never", translator),
      caption: translateLine(
        "No page has fetched this application's replay policy yet.",
        translator,
      ),
      tone: "warning",
    };
  }

  const fetchedAtUnixMs: number | null = parseHealthTimestamp(
    status.lastConfigFetchAt,
  );

  if (fetchedAtUnixMs === null) {
    return {
      key: "recorder",
      label,
      value: translateLine("unknown", translator),
      caption: translateLine(
        "The server sent a policy-fetch time that could not be read.",
        translator,
      ),
      tone: "neutral",
    };
  }

  const ageMs: number = nowUnixMs - fetchedAtUnixMs;

  if (ageMs > SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS) {
    return {
      key: "recorder",
      label,
      value: formatRelativeAge(fetchedAtUnixMs, nowUnixMs, translator),
      caption: translator.translateTemplate(
        "No page has loaded the recorder for {{duration}}.",
        { duration: durationIn(ageMs) },
      ),
      tone: "warning",
    };
  }

  return {
    key: "recorder",
    label,
    value: formatRelativeAge(fetchedAtUnixMs, nowUnixMs, translator),
    caption: translateLine(
      "Last time a page on your site fetched the replay policy.",
      translator,
    ),
    tone: "ok",
  };
}

/* Stage 2: does the policy that recorder fetched let it record at all? */
function buildPolicyStage(
  status: RecordingHealthStatus,
  diagnosis: RecordingHealthDiagnosis,
  translator: Translator,
): RecordingPipelineStage {
  const label: string = translationKey("Recording allowed");
  const { policy } = status;

  if (!policy.isProjectEnabled) {
    return {
      key: "policy",
      label,
      value: translateLine("Off", translator),
      caption: translateLine(
        "Session replay is switched off for the whole project.",
        translator,
      ),
      tone: "error",
    };
  }

  if (!policy.isApplicationEnabled) {
    return {
      key: "policy",
      label,
      value: translateLine("Off", translator),
      caption: translateLine(
        "Session replay is switched off for this application.",
        translator,
      ),
      tone: "error",
    };
  }

  if (diagnosis.state === "budget-paused") {
    return {
      key: "policy",
      label,
      value: translateLine("Paused", translator),
      caption: translateLine(
        "The upload budget is spent, so recorders are told to stop.",
        translator,
      ),
      tone: "error",
    };
  }

  /*
   * The share as the sentence's language writes a number ("12.5", "12,5");
   * at or below zero it reads 0, as it always did.
   */
  const sampled: number = Math.max(0, policy.samplePercentage);
  const percent: ComposedValue = composedValue(
    (sentence: Translator): string => {
      return sentence.formatNumber(sampled);
    },
  );

  if (policy.samplePercentage <= 0) {
    return {
      key: "policy",
      label,
      value: translator.translateTemplate("{{percent}}% sampled", {
        percent: percent,
      }),
      caption: translateLine(
        "A sample percentage of 0% records no session at all.",
        translator,
      ),
      tone: "error",
    };
  }

  return {
    key: "policy",
    label,
    value: translator.translateTemplate("{{percent}}% sampled", {
      percent: percent,
    }),
    caption: translator.translateTemplate(
      policy.consentMode === SessionReplayConsentMode.RequireExplicit
        ? "{{trigger}}; uploads wait for grantConsent()."
        : "{{trigger}}; no consent prompt required.",
      { trigger: translatableTerm(describeTrigger(policy.captureTrigger)) },
    ),
    tone: "ok",
  };
}

/* Stage 3: are chunks from that recorder reaching this server? */
function buildUploadsStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
  translator: Translator,
): RecordingPipelineStage {
  const label: string = translationKey("Chunks received");

  const topRefusal: SessionReplayRefusalCount | null = getTopRefusal(
    status.refusalsLast24h,
  );

  if (
    topRefusal !== null &&
    topRefusal.count >= SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD
  ) {
    const total: number = (status.refusalsLast24h ?? []).reduce(
      (sum: number, entry: SessionReplayRefusalCount): number => {
        return sum + entry.count;
      },
      0,
    );
    const topReason: string = topRefusal.reason;

    return {
      key: "uploads",
      label,
      value: translator.translatePlural(
        { one: "{{count}} refused", other: "{{count}} refused" },
        total,
        { count: formatCountForCopy(total, translator) },
      ),
      caption: translator.translateTemplate(
        "In the last 24h, mostly {{reason}}.",
        {
          reason: composedValue((sentence: Translator): string => {
            return describeRefusalReason(topReason, sentence) ?? topReason;
          }),
        },
      ),
      tone: "warning",
    };
  }

  if (status.lastChunkReceivedAt === null) {
    const hasLoaded: boolean = status.lastConfigFetchAt !== null;

    return {
      key: "uploads",
      label,
      value: translateLine("Never", translator),
      caption: translateLine(
        hasLoaded
          ? "The recorder loaded, but no chunk has reached this server."
          : "Nothing can arrive until a page loads the recorder.",
        translator,
      ),
      tone: hasLoaded ? "warning" : "neutral",
    };
  }

  const chunkAtUnixMs: number | null = parseHealthTimestamp(
    status.lastChunkReceivedAt,
  );

  if (chunkAtUnixMs === null) {
    return {
      key: "uploads",
      label,
      value: translateLine("unknown", translator),
      caption: translateLine(
        "The server sent a last-chunk time that could not be read.",
        translator,
      ),
      tone: "neutral",
    };
  }

  const ageMs: number = nowUnixMs - chunkAtUnixMs;

  if (ageMs > SESSION_REPLAY_STALE_CHUNK_MS) {
    return {
      key: "uploads",
      label,
      value: formatRelativeAge(chunkAtUnixMs, nowUnixMs, translator),
      caption: translator.translateTemplate(
        "No chunk has arrived for {{duration}}.",
        { duration: durationIn(ageMs) },
      ),
      tone: "warning",
    };
  }

  return {
    key: "uploads",
    label,
    value: formatRelativeAge(chunkAtUnixMs, nowUnixMs, translator),
    caption: translateLine(
      "The end-to-end proof: a recorder on your site reached this server.",
      translator,
    ),
    tone: "ok",
  };
}

/*
 * Stage 4's caption: how many of the sessions are playable, and when the
 * newest started - one whole sentence for each of the four cases.
 */
function describePlayable(
  status: RecordingHealthStatus,
  nowUnixMs: number,
  translator: Translator,
): string {
  const startedAtUnixMs: number | null = parseHealthTimestamp(
    status.lastSessionStartedAt,
  );
  const playable: number | null = status.playableSessionsLast24h;

  if (playable === null) {
    return startedAtUnixMs === null
      ? translateLine("Playable count not reported.", translator)
      : translator.translateTemplate(
          "Playable count not reported; the newest started {{age}}.",
          { age: ageIn(startedAtUnixMs, nowUnixMs) },
        );
  }

  const count: string = formatCountForCopy(playable, translator);

  if (startedAtUnixMs === null) {
    return translator.translatePlural(
      { one: "{{count}} playable.", other: "{{count}} playable." },
      playable,
      { count: count },
    );
  }

  return translator.translatePlural(
    {
      one: "{{count}} playable; the newest started {{age}}.",
      other: "{{count}} playable; the newest started {{age}}.",
    },
    playable,
    { count: count, age: ageIn(startedAtUnixMs, nowUnixMs) },
  );
}

/* Stage 4: did those chunks become sessions someone can watch? */
function buildSessionsStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
  translator: Translator,
): RecordingPipelineStage {
  const label: string = translationKey("Sessions in 24h");

  if (status.sessionsLast24h === null) {
    return {
      key: "sessions",
      label,
      value: translateLine("unknown", translator),
      caption: translateLine(
        "The session count could not be read.",
        translator,
      ),
      tone: "neutral",
    };
  }

  if (status.sessionsLast24h === 0) {
    return {
      key: "sessions",
      label,
      value: formatCountForCopy(0, translator),
      caption: translateLine(
        "No session started in the last 24 hours.",
        translator,
      ),
      tone: "neutral",
    };
  }

  if (status.playableSessionsLast24h === 0) {
    return {
      key: "sessions",
      label,
      value: formatCountForCopy(status.sessionsLast24h, translator),
      caption: translateLine(
        "None of them has playable footage yet.",
        translator,
      ),
      tone: "warning",
    };
  }

  return {
    key: "sessions",
    label,
    value: formatCountForCopy(status.sessionsLast24h, translator),
    caption: describePlayable(status, nowUnixMs, translator),
    tone: "ok",
  };
}

/*
 * The four stages a recording passes through, in order: the recorder loads,
 * its policy lets it record, its chunks arrive, and they become sessions.
 * Reading left to right, the first amber or red stage is where to look.
 */
export function buildRecordingPipeline(
  status: RecordingHealthStatus,
  diagnosis: RecordingHealthDiagnosis,
  nowUnixMs: number,
  translator: Translator = ENGLISH,
): Array<RecordingPipelineStage> {
  return [
    buildRecorderStage(status, nowUnixMs, translator),
    buildPolicyStage(status, diagnosis, translator),
    buildUploadsStage(status, nowUnixMs, translator),
    buildSessionsStage(status, nowUnixMs, translator),
  ];
}

export interface HealthCounterRow {
  reason: string;
  /*
   * Human copy for a known refusal reason, in the translator's language;
   * null for an open-vocabulary one.
   */
  label: string | null;
  count: number;
  /* 0-100, of the largest row, for the bar. */
  sharePercent: number;
}

export type HealthCounterBreakdown =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "list"; total: number; rows: Array<HealthCounterRow> };

/* Refusals or drops by reason: largest first, unknown kept apart from none. */
export function buildCounterBreakdown(
  entries: Array<{ reason: string; count: number }> | null | undefined,
  translator: Translator = ENGLISH,
): HealthCounterBreakdown {
  if (entries === null || entries === undefined) {
    return { kind: "unknown" };
  }

  const counted: Array<{ reason: string; count: number }> = entries.filter(
    (entry: { reason: string; count: number }): boolean => {
      return Number.isFinite(entry.count) && entry.count > 0;
    },
  );

  if (counted.length === 0) {
    return { kind: "none" };
  }

  const sorted: Array<{ reason: string; count: number }> = [...counted].sort(
    (
      a: { reason: string; count: number },
      b: { reason: string; count: number },
    ): number => {
      return b.count - a.count || a.reason.localeCompare(b.reason);
    },
  );

  const largest: number = sorted[0]!.count;

  return {
    kind: "list",
    total: sorted.reduce((sum: number, entry: { count: number }): number => {
      return sum + entry.count;
    }, 0),
    rows: sorted.map(
      (entry: { reason: string; count: number }): HealthCounterRow => {
        return {
          reason: entry.reason,
          label: describeRefusalReason(entry.reason, translator),
          count: entry.count,
          sharePercent: Math.max(2, Math.round((entry.count / largest) * 100)),
        };
      },
    ),
  };
}

export const USAGE_WARNING_PERCENT: number = 80;

export type UsageMeter =
  | { kind: "unknown" }
  | { kind: "unlimited"; usedCopy: string }
  | {
      kind: "limited";
      usedCopy: string;
      limitCopy: string;
      /* 0-100, clamped, for the bar width. */
      percent: number;
      tone: HealthTone;
    };

/*
 * Bytes against a ceiling; a missing or non-positive ceiling is "no limit".
 * The figures are written as the translator's language writes a number
 * ("2,5 GB" in German).
 */
export function buildUsageMeter(
  usedBytes: number | null,
  limitBytes: number | null,
  translator: Translator = ENGLISH,
): UsageMeter {
  if (usedBytes === null || !Number.isFinite(usedBytes)) {
    return { kind: "unknown" };
  }

  const usedCopy: string = formatBytesForCopy(
    Math.max(0, usedBytes),
    translator,
  );

  if (limitBytes === null || !Number.isFinite(limitBytes) || limitBytes <= 0) {
    return { kind: "unlimited", usedCopy };
  }

  const rawPercent: number = (Math.max(0, usedBytes) / limitBytes) * 100;
  const percent: number = Math.min(100, Math.round(rawPercent));

  let tone: HealthTone = "ok";

  if (rawPercent >= 100) {
    tone = "error";
  } else if (rawPercent >= USAGE_WARNING_PERCENT) {
    tone = "warning";
  }

  return {
    kind: "limited",
    usedCopy,
    limitCopy: formatBytesForCopy(limitBytes, translator),
    percent,
    tone,
  };
}

/*
 * "refreshes every minute", "refreshes every 10s": how often the page reads
 * the status again, as the whole phrase the Health page's header draws
 * after the time it was last read.
 */
export function describePollInterval(
  intervalMs: number,
  translator: Translator = ENGLISH,
): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return translateLine("refreshes manually", translator);
  }

  if (intervalMs === 60 * 1000) {
    return translateLine("refreshes every minute", translator);
  }

  return translator.translateTemplate("refreshes every {{duration}}", {
    duration: durationIn(intervalMs),
  });
}
