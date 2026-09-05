import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { SESSION_REPLAY_FLUSH_INTERVAL_MS } from "Common/Types/Rum/SessionReplay";

/*
 * Can this session be watched, and what does the viewer need to know
 * before they click? Pure, so the badge copy is pinned by tests that need
 * no React, and shared by the list and anything else that has to decide
 * whether "Watch" is an honest button.
 *
 * "recording-lost" (sealed by the never-finalized sweep) and a finalized
 * zero chunk count both mean there is nothing to watch - sending someone
 * into the player to find that out is the dishonesty this module removes.
 *
 * The chunkCount test is gated on isFinalized: the PROVISIONAL header is
 * deliberately written with chunkCount 0 (aggregates are the finalizer's
 * job), so an unfinalized row's zero means "not counted yet", not "no
 * footage" - and unfinalized rows sit at the top of a newest-first list
 * during a live incident.
 */

export type SessionReplayPlayabilityKind =
  | "recording"
  | "playable"
  | "partial"
  | "metadata-only"
  | "lost";

/* Mapped onto StatusBadgeType by the UI; kept UI-free here. */
export type SessionReplayPlayabilitySeverity =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral";

export interface SessionReplayPlayability {
  kind: SessionReplayPlayabilityKind;
  /* The badge word. */
  text: string;
  severity: SessionReplayPlayabilitySeverity;
  /* Why, in one or two sentences; reachable by keyboard as the badge's label. */
  tooltip: string;
  /* A short fact under the badge ("expires in 6d", "3 chunks missing"), or null. */
  detail: string | null;
  /* Whether the player has anything to show. Watch is offered only when true. */
  isWatchable: boolean;
}

export interface SessionReplayPlayabilityInput {
  isFinalized: boolean;
  sealedReason: string;
  chunkCount: number;
  missingChunkCount: number;
  /* argMax(retentionDate) as unix ms; undefined on an older server. */
  expiresAtUnixMs?: number | undefined;
}

/*
 * A chunk is flushed every SESSION_REPLAY_FLUSH_INTERVAL_MS, so a missing
 * chunk is roughly that much footage. An estimate, and labelled as one.
 */
export const SESSION_REPLAY_ESTIMATED_CHUNK_SECONDS: number = Math.round(
  SESSION_REPLAY_FLUSH_INTERVAL_MS / 1000,
);

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * "expires in 6d", "expires in 3h", "expires within the hour", "expired" -
 * or null when the server did not say. Never "expires in 0d": a recording
 * that expires today is about to disappear and the copy has to say so.
 */
export function formatExpiry(
  expiresAtUnixMs: number | undefined,
  nowUnixMs: number,
): string | null {
  if (
    expiresAtUnixMs === undefined ||
    !Number.isFinite(expiresAtUnixMs) ||
    expiresAtUnixMs <= 0
  ) {
    return null;
  }

  const remainingMs: number = expiresAtUnixMs - nowUnixMs;

  if (remainingMs <= 0) {
    return "expired";
  }

  if (remainingMs < HOUR_MS) {
    return "expires within the hour";
  }

  if (remainingMs < DAY_MS) {
    return `expires in ${Math.floor(remainingMs / HOUR_MS)}h`;
  }

  return `expires in ${Math.floor(remainingMs / DAY_MS)}d`;
}

export function getSessionReplayPlayability(
  row: SessionReplayPlayabilityInput,
  nowUnixMs: number,
): SessionReplayPlayability {
  const isLost: boolean = row.sealedReason === "recording-lost";

  if (isLost) {
    return {
      kind: "lost",
      text: "Recording lost",
      severity: "danger",
      tooltip:
        "A session header was received but its footage never arrived, so the never-finalized sweep sealed the session. The signals and counts here are still accurate; there is nothing to play.",
      detail: null,
      isWatchable: false,
    };
  }

  if (!row.isFinalized) {
    return {
      kind: "recording",
      text: "Recording now",
      severity: "info",
      tooltip:
        "This session has not been finalized yet: footage plays as it arrives, and duration, pages and signals are counted when it closes (about 10 minutes after the last chunk).",
      detail: "live",
      isWatchable: true,
    };
  }

  /*
   * A finalized session with no chunks never had footage stored - it is
   * NOT a recording whose footage aged out. RumSession derives
   * retentionDate from the clamped session start, "keeps the header's
   * retentionDate equal to its chunks'", so a header and its footage TTL
   * out on the same day and an expired session leaves no row behind. Copy
   * that implies metadata outlives the recording is a promise the model
   * does not keep (ux-09).
   */
  if (row.chunkCount === 0) {
    return {
      kind: "metadata-only",
      text: "Metadata only",
      severity: "warning",
      tooltip:
        "No footage was stored for this session: its chunks were never uploaded, or they were refused before they could be saved. A session row expires together with its footage, so this is not an expired recording - the signals, device and page list here are accurate.",
      detail: null,
      isWatchable: false,
    };
  }

  const expiry: string | null = formatExpiry(row.expiresAtUnixMs, nowUnixMs);

  if (row.missingChunkCount > 0) {
    const missingSeconds: number =
      row.missingChunkCount * SESSION_REPLAY_ESTIMATED_CHUNK_SECONDS;
    const chunkWord: string = row.missingChunkCount === 1 ? "chunk" : "chunks";

    return {
      kind: "partial",
      text: "Partial",
      severity: "warning",
      tooltip: `${row.missingChunkCount} ${chunkWord} of footage never arrived (about ${missingSeconds}s). The player skips the gaps and marks them on the timeline.`,
      detail: `about ${missingSeconds}s missing${expiry ? ` - ${expiry}` : ""}`,
      isWatchable: true,
    };
  }

  return {
    kind: "playable",
    text: "Playable",
    severity: "success",
    tooltip: expiry
      ? `Footage is stored and can be played back; it ${expiry} under this application's retention, and this row expires with it.`
      : "Footage is stored and can be played back.",
    detail: expiry,
    isWatchable: true,
  };
}

/*
 * "45s", "12m 05s", "1h 30m". Hours are shown once a session crosses one:
 * sessions may run up to SESSION_REPLAY_MAX_SESSION_MS, and "90m 00s" is
 * harder to scan than "1h 30m". Zero or unknown is a dash, never "0s" - a
 * provisional header has not measured anything yet.
 */
export function formatSessionDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "—";
  }

  const totalSeconds: number = Math.round(durationMs / 1000);
  const hours: number = Math.floor(totalSeconds / 3600);
  const minutes: number = Math.floor((totalSeconds % 3600) / 60);
  const seconds: number = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/*
 * The trigger reason as a person would say it. Under the default policy
 * (Always, 100%) the recorder still writes "sampled", and printing that
 * word on every row told people they were only getting a sample - the
 * misunderstanding behind issue #3601.
 */
export function describeTriggerReason(
  reason: string,
  samplePercentageAtCapture?: number | undefined,
): string {
  switch (reason) {
    case SessionReplayTriggerReason.Error:
      return "On error";
    case SessionReplayTriggerReason.Frustration:
      return "On frustration";
    case SessionReplayTriggerReason.Performance:
      return "Slow page";
    case SessionReplayTriggerReason.Manual:
      return "Manual";
    case SessionReplayTriggerReason.Sampled:
      if (
        samplePercentageAtCapture === undefined ||
        !Number.isFinite(samplePercentageAtCapture) ||
        samplePercentageAtCapture >= 100
      ) {
        return "Always-on";
      }

      return `Sampled (${samplePercentageAtCapture}%)`;
    case "":
      return "Trigger not recorded";
    default:
      return reason;
  }
}

/* The same words, for the trigger dropdown and the search grammar. */
export const TRIGGER_REASON_LABELS: Record<SessionReplayTriggerReason, string> =
  {
    [SessionReplayTriggerReason.Error]: "On error",
    [SessionReplayTriggerReason.Frustration]: "On frustration",
    [SessionReplayTriggerReason.Performance]: "Slow page",
    [SessionReplayTriggerReason.Sampled]: "Sampled or always-on",
    [SessionReplayTriggerReason.Manual]: "Manual",
  };

/*
 * "idle 40%" when the finalizer measured active time; null when it did
 * not (provisional rows, older servers) or when the share would round to
 * nothing worth saying. Never "idle 0%": an unmeasured session is not an
 * attentive one.
 */
export function formatIdleShare(
  activeMs: number | undefined,
  durationMs: number,
): string | null {
  if (
    activeMs === undefined ||
    !Number.isFinite(activeMs) ||
    activeMs <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }

  const idleShare: number = Math.round(
    (Math.max(0, durationMs - activeMs) / durationMs) * 100,
  );

  if (idleShare < 5) {
    return null;
  }

  return `idle ${Math.min(99, idleShare)}%`;
}
