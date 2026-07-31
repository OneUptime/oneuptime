import { SessionReplayFidelityNotice } from "Common/Types/Rum/SessionReplay";

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
   * Emitted by the recorder when a session hits the per-session chunk cap.
   * Deliberately not (yet) a SessionReplayFidelityNotice member — see the
   * recorder README — but the copy must exist regardless.
   */
  truncated: {
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
