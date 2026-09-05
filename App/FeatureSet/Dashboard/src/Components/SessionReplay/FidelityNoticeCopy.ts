import {
  SessionReplayFidelityNotice,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import Text from "Common/Types/Text";

/*
 * Human copy for the machine-readable fidelity notices.
 *
 * The feature's design promise is honest degradation: "a viewer sees
 * 'this was not recorded' rather than an unexplained blank". Rendering
 * the raw codes ("adopted-stylesheet") delivered only half of that — a
 * support engineer saw jargon, not an explanation. The explanations here
 * are the ones the design doc's fidelity table gives for each gap.
 *
 * Unknown codes fall back to the raw string: a newer recorder must be
 * able to report a notice this Dashboard has not heard of yet, and an
 * unknown code is still more honest than dropping it.
 */

export interface FidelityNoticeCopy {
  title: string;
  description: string;
}

/*
 * How loudly a notice should be shown.
 *
 * Every notice used to be stacked into one amber warning block above the
 * picture, which meant a perfectly good recording of a perfectly ordinary
 * page opened behind a wall of alarm - "a stylesheet could not be read",
 * "web fonts not captured" - and taught people to ignore the block that
 * sometimes contains "a stretch of this timeline is unplayable".
 *
 * The split is by consequence, not by cause:
 *
 *   Playback — there is footage you cannot watch, or the timeline is not
 *   what it claims. Worth interrupting for.
 *
 *   Fidelity — everything IS playable, it just does not look pixel-exact:
 *   a system font instead of a web font, an unstyled region, a black box
 *   where a payment iframe was. These are permanent, deliberate properties
 *   of how the recorder works and appear on a large share of recordings,
 *   so they belong in a quiet, expandable note rather than a warning.
 */
export type FidelityNoticeSeverity = "playback" | "fidelity";

/*
 * The recorder reports the chunk cap as a fidelity notice spelled exactly
 * like the header's sealedReason, so the two are kept from drifting apart
 * by reading the value off the shared enum.
 */
export const TRUNCATED_NOTICE_CODE: string =
  SessionReplaySealedReason.Truncated;

const PLAYBACK_AFFECTING: Set<string> = new Set<string>([
  SessionReplayFidelityNotice.SnapshotTooLarge,
  SessionReplayFidelityNotice.BufferOverflow,
  TRUNCATED_NOTICE_CODE,
]);

export function getFidelityNoticeSeverity(
  code: string,
): FidelityNoticeSeverity {
  /*
   * An unknown code is treated as a fidelity note rather than as a playback
   * problem. A newer recorder must be able to report something this
   * Dashboard has not heard of, and guessing "this recording is broken"
   * about a notice we cannot read would be a worse lie than guessing
   * "this recording looks slightly different".
   */
  return PLAYBACK_AFFECTING.has(code) ? "playback" : "fidelity";
}

const COPY: Record<string, FidelityNoticeCopy> = {
  [SessionReplayFidelityNotice.CanvasNotRecorded]: {
    title: "Canvas not recorded",
    description:
      "Canvas and WebGL contents are not captured unless canvas recording is enabled for the application — capture is expensive on the end user's device and canvases routinely render content text masking cannot reach.",
  },
  [SessionReplayFidelityNotice.CrossOriginIframe]: {
    title: "Cross-origin iframe not recorded",
    description:
      "Frames from other origins (payment providers, embedded widgets) stay black boxes. This is deliberate: recording inside them would require injecting the recorder into a third party's page.",
  },
  [SessionReplayFidelityNotice.ClosedShadowRoot]: {
    title: "Closed shadow root not recorded",
    description:
      "A closed shadow root cannot be traversed, so its contents are omitted rather than captured unmasked.",
  },
  [SessionReplayFidelityNotice.StylesheetInaccessible]: {
    title: "A stylesheet could not be read",
    description:
      'A cross-origin stylesheet without crossorigin="anonymous" cannot be read by the recorder, so parts of this recording may play back unstyled.',
  },
  [SessionReplayFidelityNotice.AdoptedStylesheet]: {
    title: "Adopted stylesheets partially captured",
    description:
      "Styles applied through adoptedStyleSheets (common in web components) may be missing, so some elements can render unstyled.",
  },
  [SessionReplayFidelityNotice.FontsOmitted]: {
    title: "Web fonts not captured",
    description:
      "Font files are large and are not recorded; playback uses a system font stack, so text metrics can differ slightly from what the user saw.",
  },
  [SessionReplayFidelityNotice.MediaNotReplayable]: {
    title: "Video/audio not replayable",
    description:
      "Media elements are shown as labelled placeholders: their sources are often signed URLs that expire, and playback position cannot be synchronized.",
  },
  [SessionReplayFidelityNotice.SnapshotTooLarge]: {
    title: "A snapshot was too large to store",
    description:
      "One full-page snapshot exceeded the size cap and was dropped. The recording continues from the next snapshot, so a stretch of the timeline may be unplayable.",
  },
  [SessionReplayFidelityNotice.BufferOverflow]: {
    title: "Pre-error buffer overflowed",
    description:
      "The page produced events faster than the rolling pre-error buffer could hold, so the earliest part of the run-up to the trigger was dropped.",
  },
  [SessionReplayFidelityNotice.BfcacheRestore]: {
    title: "Restored from back/forward cache",
    description:
      "The page was restored from the browser's back/forward cache mid-session; the recording resumes from a fresh snapshot at that point.",
  },
  [SessionReplayFidelityNotice.IgnorePatternsDiscarded]: {
    title: "Some ignored-error patterns could not be applied",
    description:
      "One or more of the application's ignored error patterns was invalid or over the limit, so error triggering may be noisier than the settings intend.",
  },
  /*
   * The footage is complete; only the rail is cut short. Deliberately a
   * quiet note rather than a playback warning: nothing the viewer scrubs to
   * is missing, and the rail itself marks where the cap hit.
   */
  [SessionReplayFidelityNotice.SignalCapReached]: {
    title: "Some signals after a point were not recorded",
    description:
      "Some errors, console output or route changes after this point were not recorded - the per-session cap was reached. The footage itself is complete; only the rail is truncated past the cap marker.",
  },
  /*
   * Emitted by the recorder when a session hits the per-session chunk cap.
   * Deliberately not (yet) a SessionReplayFidelityNotice member — see the
   * recorder README — but the copy must exist regardless.
   */
  [TRUNCATED_NOTICE_CODE]: {
    title: "Recording truncated",
    description:
      "This session reached the maximum recording length, so the recorder stopped. Everything up to that point plays normally.",
  },
};

export function getFidelityNoticeCopy(code: string): FidelityNoticeCopy {
  return (
    COPY[code] ?? {
      title: code,
      description:
        "Part of this session could not be captured. This notice code is newer than this Dashboard's copy for it.",
    }
  );
}

/*
 * Why a recording ENDED, from the header's sealedReason.
 *
 * Every reason the finalizer can write has copy here, because "the picture
 * just stops" is the ended-early half of the complaint that nothing in the
 * UI explains why a recording is the length it is. `severity` says whether
 * the end is worth a warning: a normal final chunk is a fact, a budget
 * stop is something the viewer can change.
 */
export type SealedReasonSeverity = "info" | "warn";

export interface SealedReasonCopy {
  title: string;
  description: string;
  severity: SealedReasonSeverity;
}

const SEALED_REASON_COPY: Record<string, SealedReasonCopy> = {
  [SessionReplaySealedReason.FinalChunk]: {
    title: "Recording ended normally",
    description:
      "The recorder sent its final chunk when the page was closed or the session ended, so the recording is complete.",
    severity: "info",
  },
  [SessionReplaySealedReason.IdleTimeout]: {
    title: "Recording ended after inactivity",
    description:
      "No chunk arrived for the idle window, so the session was sealed where the last chunk ended. Anything the user did after that was not recorded.",
    severity: "info",
  },
  [SessionReplaySealedReason.DurationCap]: {
    title: "Recording reached the maximum length",
    description:
      "Sessions are capped at the maximum recording duration; the recorder stopped at the cap. Everything up to that point plays normally.",
    severity: "info",
  },
  [SessionReplaySealedReason.Budget]: {
    title: "Recording stopped: upload budget exhausted",
    description:
      "The application's replay budget ran out during this session, so later chunks were refused. Raise the budget in the application's session replay settings to record longer sessions.",
    severity: "warn",
  },
  [SessionReplaySealedReason.Truncated]: {
    title: "Recording reached the chunk cap",
    description:
      "This session hit the per-session chunk cap, so the recorder stopped. Everything up to that point plays normally.",
    severity: "info",
  },
  [SessionReplaySealedReason.RecordingLost]: {
    title: "Recording lost",
    description:
      "A recording existed but its chunks never landed, or expired before it could be finalized. Nothing from this session is playable.",
    severity: "warn",
  },
};

/*
 * Null for a blank reason (the session is still open, or predates the
 * column); an unknown reason from a newer finalizer is humanised rather
 * than shown as its machine token.
 */
export function getSealedReasonCopy(
  reason: string | null | undefined,
): SealedReasonCopy | null {
  const trimmed: string = (reason || "").trim();

  if (trimmed.length === 0) {
    return null;
  }

  return (
    SEALED_REASON_COPY[trimmed] ?? {
      title: `Recording ended: ${Text.fromDashesToPascalCase(trimmed)}`,
      description:
        "The recording was sealed for a reason newer than this Dashboard's copy for it. Everything that was received plays normally.",
      severity: "info",
    }
  );
}
