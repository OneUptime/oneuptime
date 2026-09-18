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
} from "Common/Utils/Rum/SessionReplayHealth";

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
 */

export type HealthTone = "ok" | "warning" | "error" | "neutral";

export type RecordingPipelineStageKey =
  | "recorder"
  | "policy"
  | "uploads"
  | "sessions";

export interface RecordingPipelineStage {
  key: RecordingPipelineStageKey;
  label: string;
  /* The one big value: "2m ago", "143", "Off". */
  value: string;
  /* One quiet line that says what the value means. */
  caption: string;
  tone: HealthTone;
}

const CAPTURE_TRIGGER_SHORT_LABELS: Record<string, string> = {
  [SessionReplayCaptureTrigger.Always]: "Always",
  [SessionReplayCaptureTrigger.OnErrorOrFrustration]: "On error or frustration",
};

function describeTrigger(captureTrigger: string): string {
  return CAPTURE_TRIGGER_SHORT_LABELS[captureTrigger] ?? "Uploads";
}

/* Stage 1: has a page on the customer's site loaded the recorder lately? */
function buildRecorderStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
): RecordingPipelineStage {
  const label: string = "Recorder loaded";

  if (status.lastConfigFetchAt === null) {
    if (status.lastChunkReceivedAt !== null) {
      return {
        key: "recorder",
        label,
        value: "not reported",
        caption:
          "This server does not report policy fetches, but a chunk has arrived, so a recorder has loaded.",
        tone: "neutral",
      };
    }

    return {
      key: "recorder",
      label,
      value: "Never",
      caption: "No page has fetched this application's replay policy yet.",
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
      value: "unknown",
      caption: "The server sent a policy-fetch time that could not be read.",
      tone: "neutral",
    };
  }

  const ageMs: number = nowUnixMs - fetchedAtUnixMs;

  if (ageMs > SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS) {
    return {
      key: "recorder",
      label,
      value: formatRelativeAge(fetchedAtUnixMs, nowUnixMs),
      caption: `No page has loaded the recorder for ${formatDurationForCopy(ageMs)}.`,
      tone: "warning",
    };
  }

  return {
    key: "recorder",
    label,
    value: formatRelativeAge(fetchedAtUnixMs, nowUnixMs),
    caption: "Last time a page on your site fetched the replay policy.",
    tone: "ok",
  };
}

/* Stage 2: does the policy that recorder fetched let it record at all? */
function buildPolicyStage(
  status: RecordingHealthStatus,
  diagnosis: RecordingHealthDiagnosis,
): RecordingPipelineStage {
  const label: string = "Recording allowed";
  const { policy } = status;

  if (!policy.isProjectEnabled) {
    return {
      key: "policy",
      label,
      value: "Off",
      caption: "Session replay is switched off for the whole project.",
      tone: "error",
    };
  }

  if (!policy.isApplicationEnabled) {
    return {
      key: "policy",
      label,
      value: "Off",
      caption: "Session replay is switched off for this application.",
      tone: "error",
    };
  }

  if (diagnosis.state === "budget-paused") {
    return {
      key: "policy",
      label,
      value: "Paused",
      caption: "The upload budget is spent, so recorders are told to stop.",
      tone: "error",
    };
  }

  if (policy.samplePercentage <= 0) {
    return {
      key: "policy",
      label,
      value: "0% sampled",
      caption: "A sample percentage of 0% records no session at all.",
      tone: "error",
    };
  }

  const consentCopy: string =
    policy.consentMode === SessionReplayConsentMode.RequireExplicit
      ? "uploads wait for grantConsent()"
      : "no consent prompt required";

  return {
    key: "policy",
    label,
    value: `${policy.samplePercentage}% sampled`,
    caption: `${describeTrigger(policy.captureTrigger)}; ${consentCopy}.`,
    tone: "ok",
  };
}

/* Stage 3: are chunks from that recorder reaching this server? */
function buildUploadsStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
): RecordingPipelineStage {
  const label: string = "Chunks received";

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

    return {
      key: "uploads",
      label,
      value: `${formatCountForCopy(total)} refused`,
      caption: `In the last 24h, mostly ${
        describeRefusalReason(topRefusal.reason) ?? topRefusal.reason
      }.`,
      tone: "warning",
    };
  }

  if (status.lastChunkReceivedAt === null) {
    const hasLoaded: boolean = status.lastConfigFetchAt !== null;

    return {
      key: "uploads",
      label,
      value: "Never",
      caption: hasLoaded
        ? "The recorder loaded, but no chunk has reached this server."
        : "Nothing can arrive until a page loads the recorder.",
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
      value: "unknown",
      caption: "The server sent a last-chunk time that could not be read.",
      tone: "neutral",
    };
  }

  const ageMs: number = nowUnixMs - chunkAtUnixMs;

  if (ageMs > SESSION_REPLAY_STALE_CHUNK_MS) {
    return {
      key: "uploads",
      label,
      value: formatRelativeAge(chunkAtUnixMs, nowUnixMs),
      caption: `No chunk has arrived for ${formatDurationForCopy(ageMs)}.`,
      tone: "warning",
    };
  }

  return {
    key: "uploads",
    label,
    value: formatRelativeAge(chunkAtUnixMs, nowUnixMs),
    caption:
      "The end-to-end proof: a recorder on your site reached this server.",
    tone: "ok",
  };
}

/* Stage 4: did those chunks become sessions someone can watch? */
function buildSessionsStage(
  status: RecordingHealthStatus,
  nowUnixMs: number,
): RecordingPipelineStage {
  const label: string = "Sessions in 24h";

  if (status.sessionsLast24h === null) {
    return {
      key: "sessions",
      label,
      value: "unknown",
      caption: "The session count could not be read.",
      tone: "neutral",
    };
  }

  if (status.sessionsLast24h === 0) {
    return {
      key: "sessions",
      label,
      value: "0",
      caption: "No session started in the last 24 hours.",
      tone: "neutral",
    };
  }

  if (status.playableSessionsLast24h === 0) {
    return {
      key: "sessions",
      label,
      value: formatCountForCopy(status.sessionsLast24h),
      caption: "None of them has playable footage yet.",
      tone: "warning",
    };
  }

  const startedAtUnixMs: number | null = parseHealthTimestamp(
    status.lastSessionStartedAt,
  );
  const lastStartedCopy: string =
    startedAtUnixMs === null
      ? ""
      : `; the newest started ${formatRelativeAge(startedAtUnixMs, nowUnixMs)}`;

  return {
    key: "sessions",
    label,
    value: formatCountForCopy(status.sessionsLast24h),
    caption:
      status.playableSessionsLast24h === null
        ? `Playable count not reported${lastStartedCopy}.`
        : `${formatCountForCopy(status.playableSessionsLast24h)} playable${lastStartedCopy}.`,
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
): Array<RecordingPipelineStage> {
  return [
    buildRecorderStage(status, nowUnixMs),
    buildPolicyStage(status, diagnosis),
    buildUploadsStage(status, nowUnixMs),
    buildSessionsStage(status, nowUnixMs),
  ];
}

export interface HealthCounterRow {
  reason: string;
  /* Human copy for a known refusal reason; null for an open-vocabulary one. */
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
          label: describeRefusalReason(entry.reason),
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

/* Bytes against a ceiling; a missing or non-positive ceiling is "no limit". */
export function buildUsageMeter(
  usedBytes: number | null,
  limitBytes: number | null,
): UsageMeter {
  if (usedBytes === null || !Number.isFinite(usedBytes)) {
    return { kind: "unknown" };
  }

  const usedCopy: string = formatBytesForCopy(Math.max(0, usedBytes));

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
    limitCopy: formatBytesForCopy(limitBytes),
    percent,
    tone,
  };
}

/* "every minute", "every 10s": how often the page reads the status again. */
export function describePollInterval(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return "manually";
  }

  if (intervalMs === 60 * 1000) {
    return "every minute";
  }

  return `every ${formatDurationForCopy(intervalMs)}`;
}
