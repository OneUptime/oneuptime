import { describe, expect, it } from "@jest/globals";
import {
  SessionReplayFidelityNotice,
  SessionReplaySealedReason,
} from "../../../Types/Rum/SessionReplay";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  FidelityNoticeCopy,
  SealedReasonCopy,
  TRUNCATED_NOTICE_CODE,
  getFidelityNoticeCopy,
  getSealedReasonCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/FidelityNoticeCopy";

/*
 * What the player, its notes and the Details panel say about what a
 * recording could not capture and why it ended, in the reader's language
 * (#6369). Each title and description is looked up whole with the
 * translator it is asked for with; an unknown notice keeps the recorder's
 * code, an unknown reason the finalizer's token, as values. Without a
 * translator the copy is the English it always was: keys a drawer may look
 * up itself.
 */

const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

describe("getFidelityNoticeCopy in the reader's language", () => {
  it("looks every notice's title and description up whole", () => {
    const codes: Array<string> = [
      ...Object.values(SessionReplayFidelityNotice),
      TRUNCATED_NOTICE_CODE,
    ];

    for (const code of codes) {
      const english: FidelityNoticeCopy = getFidelityNoticeCopy(code);
      const marked: FidelityNoticeCopy = getFidelityNoticeCopy(code, MARKING);

      expect(marked.title).toBe(`⟦${english.title}⟧`);
      expect(marked.description).toBe(`⟦${english.description}⟧`);
    }
  });

  it("keeps an unknown notice's code as the recorder wrote it, and words why", () => {
    expect(getFidelityNoticeCopy("future-notice", MARKING)).toEqual({
      title: "future-notice",
      description:
        "⟦Part of this session could not be captured. This notice code is newer than this Dashboard's copy for it.⟧",
    });
  });

  it("writes the English word for word without a translator", () => {
    expect(
      getFidelityNoticeCopy(SessionReplayFidelityNotice.CanvasNotRecorded)
        .title,
    ).toBe("Canvas not recorded");
    expect(getFidelityNoticeCopy("future-notice").description).toBe(
      "Part of this session could not be captured. This notice code is newer than this Dashboard's copy for it.",
    );
  });
});

describe("getSealedReasonCopy in the reader's language", () => {
  it("looks every reason's title and description up whole, keeping its severity", () => {
    for (const reason of Object.values(SessionReplaySealedReason)) {
      const english: SealedReasonCopy | null = getSealedReasonCopy(reason);
      const marked: SealedReasonCopy | null = getSealedReasonCopy(
        reason,
        MARKING,
      );

      expect(marked?.title).toBe(`⟦${english?.title}⟧`);
      expect(marked?.description).toBe(`⟦${english?.description}⟧`);
      expect(marked?.severity).toBe(english?.severity);
    }
  });

  it("words an unknown reason as one sentence, the finalizer's token in place", () => {
    expect(getSealedReasonCopy("budget-v2", MARKING)).toEqual({
      title: "⟦Recording ended: Budget V2⟧",
      description:
        "⟦The recording was sealed for a reason newer than this Dashboard's copy for it. Everything that was received plays normally.⟧",
      severity: "info",
    });
  });

  it("writes the English word for word without a translator, and nothing for a blank reason", () => {
    expect(getSealedReasonCopy("budget-v2")?.title).toBe(
      "Recording ended: Budget V2",
    );
    expect(
      getSealedReasonCopy(SessionReplaySealedReason.IdleTimeout)?.title,
    ).toBe("Recording ended after inactivity");
    expect(getSealedReasonCopy("  ", MARKING)).toBeNull();
  });
});
