import { describe, expect, it } from "@jest/globals";
import {
  SessionReplayFidelityNotice,
  SessionReplaySealedReason,
} from "../../../Types/Rum/SessionReplay";
import {
  FidelityNoticeCopy,
  SealedReasonCopy,
  TRUNCATED_NOTICE_CODE,
  getFidelityNoticeCopy,
  getFidelityNoticeSeverity,
  getSealedReasonCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/FidelityNoticeCopy";

/*
 * How loudly the player is allowed to shout about what it could not capture.
 *
 * From github.com/OneUptime/oneuptime/issues/3601, whose screenshots show a
 * recording opening behind "A stylesheet could not be read" and "Web fonts
 * not captured" — both permanent, deliberate properties of how the recorder
 * works, both present on a large share of recordings, and neither of them
 * anything the viewer can act on or that stops the recording playing.
 *
 * Grouping those with the notices that DO mean footage is missing trained
 * people to skim the whole block, which is the failure mode that matters:
 * the next time the block says a stretch of the timeline is unplayable,
 * nobody reads it.
 */

describe("getFidelityNoticeSeverity", () => {
  /*
   * Enumerated rather than spot-checked, so a notice added to the enum
   * without a decision about how it is shown fails here.
   */
  const PLAYBACK: Array<string> = [
    SessionReplayFidelityNotice.SnapshotTooLarge,
    SessionReplayFidelityNotice.BufferOverflow,
    "truncated",
    /*
     * The recorder swallowed repeated rrweb errors so the host page kept
     * working, but the events around them are missing or reordered: the
     * picture itself can skip or freeze, which is a playback claim.
     */
    SessionReplayFidelityNotice.RecorderError,
  ];

  const FIDELITY: Array<string> = [
    SessionReplayFidelityNotice.CanvasNotRecorded,
    SessionReplayFidelityNotice.CrossOriginIframe,
    SessionReplayFidelityNotice.ClosedShadowRoot,
    SessionReplayFidelityNotice.StylesheetInaccessible,
    SessionReplayFidelityNotice.AdoptedStylesheet,
    SessionReplayFidelityNotice.FontsOmitted,
    SessionReplayFidelityNotice.MediaNotReplayable,
    SessionReplayFidelityNotice.BfcacheRestore,
    SessionReplayFidelityNotice.IgnorePatternsDiscarded,
    /*
     * The footage is complete when a signal cap is hit; only the rail is cut
     * short. Shouting "playback problem" would be the wrong claim.
     */
    SessionReplayFidelityNotice.SignalCapReached,
  ];

  it.each(PLAYBACK)("treats %s as a playback problem", (code: string) => {
    expect(getFidelityNoticeSeverity(code)).toBe("playback");
  });

  it.each(FIDELITY)("treats %s as a quiet capture note", (code: string) => {
    expect(getFidelityNoticeSeverity(code)).toBe("fidelity");
  });

  it("covers every notice the wire type can carry", () => {
    const classified: Set<string> = new Set<string>([...PLAYBACK, ...FIDELITY]);

    for (const code of Object.values(SessionReplayFidelityNotice)) {
      expect(classified.has(code)).toBe(true);
    }
  });

  it("treats a notice code it has never heard of as a capture note", () => {
    /*
     * A newer recorder must be able to report something this Dashboard
     * cannot read. Guessing "this recording is broken" about an unknown
     * code is a worse lie than guessing "it looks slightly different", and
     * the raw code is still rendered either way.
     */
    expect(getFidelityNoticeSeverity("some-notice-from-a-newer-recorder")).toBe(
      "fidelity",
    );
  });
});

describe("getFidelityNoticeCopy", () => {
  it("gives every known notice a title and an explanation", () => {
    for (const code of Object.values(SessionReplayFidelityNotice)) {
      const copy: FidelityNoticeCopy = getFidelityNoticeCopy(code);

      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      /* Never the raw machine code, which is jargon to the reader. */
      expect(copy.title).not.toBe(code);
    }
  });

  it("falls back to the raw code rather than dropping an unknown notice", () => {
    const copy: FidelityNoticeCopy = getFidelityNoticeCopy("brand-new-code");

    expect(copy.title).toBe("brand-new-code");
    expect(copy.description.length).toBeGreaterThan(0);
  });

  it("explains the signal cap as a rail truncation, not missing footage", () => {
    const copy: FidelityNoticeCopy = getFidelityNoticeCopy(
      SessionReplayFidelityNotice.SignalCapReached,
    );

    expect(copy.description).toContain("per-session cap was reached");
    expect(copy.description).toMatch(/errors, console output or route changes/);
    expect(copy.description).toContain("footage itself is complete");
  });

  it("spells the recorder's truncation notice exactly like the sealed reason", () => {
    /*
     * The recorder and the finalizer both say "truncated"; the copy table
     * reads the value off the shared enum so the two cannot drift apart.
     */
    expect(TRUNCATED_NOTICE_CODE).toBe(SessionReplaySealedReason.Truncated);
    expect(getFidelityNoticeCopy(TRUNCATED_NOTICE_CODE).title).not.toBe(
      TRUNCATED_NOTICE_CODE,
    );
  });
});

/*
 * scrubber-devtools-16: why a recording ENDED had no copy at all - a
 * session sealed by budget or idle-timeout just stopped. Every member of
 * SessionReplaySealedReason must explain itself.
 */
describe("getSealedReasonCopy", () => {
  it("gives every sealed reason a title, an explanation and a severity", () => {
    for (const reason of Object.values(SessionReplaySealedReason)) {
      const copy: SealedReasonCopy | null = getSealedReasonCopy(reason);

      expect(copy).not.toBeNull();
      expect(copy!.title.length).toBeGreaterThan(0);
      expect(copy!.description.length).toBeGreaterThan(0);
      expect(copy!.title).not.toBe(reason);
      expect(["info", "warn"]).toContain(copy!.severity);
    }
  });

  it("warns only for the reasons the viewer can act on or that lost footage", () => {
    expect(
      getSealedReasonCopy(SessionReplaySealedReason.Budget)!.severity,
    ).toBe("warn");
    expect(
      getSealedReasonCopy(SessionReplaySealedReason.RecordingLost)!.severity,
    ).toBe("warn");
    expect(
      getSealedReasonCopy(SessionReplaySealedReason.FinalChunk)!.severity,
    ).toBe("info");
    expect(
      getSealedReasonCopy(SessionReplaySealedReason.IdleTimeout)!.severity,
    ).toBe("info");
  });

  it("names the cause and offers the one action for a budget stop", () => {
    const copy: SealedReasonCopy = getSealedReasonCopy(
      SessionReplaySealedReason.Budget,
    )!;

    expect(copy.title).toContain("budget");
    expect(copy.description).toContain("Raise the budget");
  });

  it("is null for a blank reason and humanises an unknown one", () => {
    expect(getSealedReasonCopy("")).toBeNull();
    expect(getSealedReasonCopy(null)).toBeNull();
    expect(getSealedReasonCopy(undefined)).toBeNull();
    expect(getSealedReasonCopy("   ")).toBeNull();

    const unknown: SealedReasonCopy = getSealedReasonCopy("brand-new-reason")!;

    expect(unknown.title).toBe("Recording ended: Brand New Reason");
    expect(unknown.severity).toBe("info");
  });
});
