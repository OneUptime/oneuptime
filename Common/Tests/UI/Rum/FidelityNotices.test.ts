import { describe, expect, it } from "@jest/globals";
import { SessionReplayFidelityNotice } from "../../../Types/Rum/SessionReplay";
import {
  FidelityNoticeCopy,
  getFidelityNoticeCopy,
  getFidelityNoticeSeverity,
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
});
