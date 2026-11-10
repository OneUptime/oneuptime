import { describe, expect, test } from "@jest/globals";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  describeTriggerReason,
  formatExpiry,
  formatIdleShare,
  getSessionReplayPlayability,
  SessionReplayPlayability,
  SessionReplayPlayabilityInput,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayability";

/*
 * The session list's Recording badge in the reader's language (#6369): its
 * word, its tooltip, the facts under it (how much footage is missing, when
 * it expires, finalizing, live) and why the session was uploaded. Each
 * sentence is looked up whole with the translator the helpers are given -
 * the missing chunks are the tooltip's plural, the expiry has a sentence
 * of its own for each way it can expire - and without one every word is
 * the English it always was.
 */

const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

function input(
  overrides?: Partial<SessionReplayPlayabilityInput>,
): SessionReplayPlayabilityInput {
  return {
    isFinalized: true,
    sealedReason: "",
    chunkCount: 12,
    missingChunkCount: 0,
    expiresAtUnixMs: NOW + 6 * DAY_MS + HOUR_MS,
    ...overrides,
  };
}

describe("getSessionReplayPlayability in the reader's language", () => {
  test("words a playable session's badge, tooltip and expiry, the days in place", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input(),
      NOW,
      MARKING,
    );

    expect(result.text).toBe("⟦Playable⟧");
    expect(result.tooltip).toBe(
      "⟦Footage is stored and can be played back; it expires in 6d under this application's retention, and this row expires with it.⟧",
    );
    expect(result.detail).toBe("⟦expires in 6d⟧");
    expect(result.detailLines).toEqual(["⟦expires in 6d⟧"]);
  });

  test("words each way the footage can expire as a whole sentence", () => {
    expect(
      getSessionReplayPlayability(
        input({ expiresAtUnixMs: NOW + 5 * HOUR_MS }),
        NOW,
        MARKING,
      ).tooltip,
    ).toBe(
      "⟦Footage is stored and can be played back; it expires in 5h under this application's retention, and this row expires with it.⟧",
    );
    expect(
      getSessionReplayPlayability(
        input({ expiresAtUnixMs: NOW + 10 * 60 * 1000 }),
        NOW,
        MARKING,
      ).tooltip,
    ).toBe(
      "⟦Footage is stored and can be played back; it expires within the hour under this application's retention, and this row expires with it.⟧",
    );
    expect(
      getSessionReplayPlayability(
        input({ expiresAtUnixMs: NOW - 1 }),
        NOW,
        MARKING,
      ).tooltip,
    ).toBe(
      "⟦Footage is stored and can be played back; it expired under this application's retention, and this row expires with it.⟧",
    );
    expect(
      getSessionReplayPlayability(
        input({ expiresAtUnixMs: undefined }),
        NOW,
        MARKING,
      ).tooltip,
    ).toBe("⟦Footage is stored and can be played back.⟧");
  });

  test("words the missing footage as the tooltip's plural, the seconds in place", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ missingChunkCount: 3 }),
      NOW,
      MARKING,
    );

    expect(result.text).toBe("⟦Partial⟧");
    expect(result.tooltip).toBe(
      "⟦3 chunks of footage never arrived (about 45s). The player skips the gaps and marks them on the timeline.⟧",
    );
    expect(result.detailLines).toEqual([
      "⟦about 45s missing⟧",
      "⟦expires in 6d⟧",
    ]);
    expect(result.detail).toBe("⟦about 45s missing⟧ - ⟦expires in 6d⟧");
  });

  test("words the unfinished, lost and empty states", () => {
    const ended: SessionReplayPlayability = getSessionReplayPlayability(
      input({ isFinalized: false, hasRecordingEnded: true }),
      NOW,
      MARKING,
    );
    const recording: SessionReplayPlayability = getSessionReplayPlayability(
      input({ isFinalized: false }),
      NOW,
      MARKING,
    );
    const lost: SessionReplayPlayability = getSessionReplayPlayability(
      input({ sealedReason: "recording-lost" }),
      NOW,
      MARKING,
    );
    const empty: SessionReplayPlayability = getSessionReplayPlayability(
      input({ chunkCount: 0 }),
      NOW,
      MARKING,
    );

    expect(ended.text).toBe("⟦Recording ended⟧");
    expect(ended.detailLines).toEqual(["⟦finalizing⟧"]);
    expect(ended.tooltip).toMatch(/^⟦Every tab of this session has closed/);
    expect(recording.text).toBe("⟦Recording now⟧");
    expect(recording.detail).toBe("⟦live⟧");
    expect(recording.tooltip).toMatch(/^⟦This session has not been finalized/);
    expect(lost.text).toBe("⟦Recording lost⟧");
    expect(lost.tooltip).toMatch(/^⟦A session header was received/);
    expect(empty.text).toBe("⟦Metadata only⟧");
    expect(empty.tooltip).toMatch(/^⟦No footage was stored for this session/);
  });

  test("writes the English word for word without a translator", () => {
    const one: SessionReplayPlayability = getSessionReplayPlayability(
      input({ missingChunkCount: 1 }),
      NOW,
    );

    expect(one.tooltip).toBe(
      "1 chunk of footage never arrived (about 15s). The player skips the gaps and marks them on the timeline.",
    );
    expect(one.detail).toBe("about 15s missing - expires in 6d");
    expect(getSessionReplayPlayability(input(), NOW).tooltip).toBe(
      "Footage is stored and can be played back; it expires in 6d under this application's retention, and this row expires with it.",
    );
  });
});

describe("the badge's facts in the reader's language", () => {
  test("formatExpiry looks each fact up whole", () => {
    expect(formatExpiry(NOW + 6 * DAY_MS + 1, NOW, MARKING)).toBe(
      "⟦expires in 6d⟧",
    );
    expect(formatExpiry(NOW + 5 * HOUR_MS, NOW, MARKING)).toBe(
      "⟦expires in 5h⟧",
    );
    expect(formatExpiry(NOW + 10 * 60 * 1000, NOW, MARKING)).toBe(
      "⟦expires within the hour⟧",
    );
    expect(formatExpiry(NOW - 1, NOW, MARKING)).toBe("⟦expired⟧");
    expect(formatExpiry(undefined, NOW, MARKING)).toBeNull();
  });

  test("describeTriggerReason words each reason, the sample's share in place", () => {
    expect(
      describeTriggerReason(SessionReplayTriggerReason.Error, undefined, MARKING),
    ).toBe("⟦On error⟧");
    expect(
      describeTriggerReason(
        SessionReplayTriggerReason.Frustration,
        undefined,
        MARKING,
      ),
    ).toBe("⟦On frustration⟧");
    expect(
      describeTriggerReason(
        SessionReplayTriggerReason.Performance,
        undefined,
        MARKING,
      ),
    ).toBe("⟦Slow page⟧");
    expect(
      describeTriggerReason(SessionReplayTriggerReason.Manual, undefined, MARKING),
    ).toBe("⟦Manual⟧");
    expect(
      describeTriggerReason(SessionReplayTriggerReason.Sampled, 100, MARKING),
    ).toBe("⟦Always-on⟧");
    expect(
      describeTriggerReason(SessionReplayTriggerReason.Sampled, 25, MARKING),
    ).toBe("⟦Sampled (25%)⟧");
    expect(describeTriggerReason("", undefined, MARKING)).toBe(
      "⟦Trigger not recorded⟧",
    );
    // A reason this Dashboard has no words for is the recorder's own token.
    expect(describeTriggerReason("future-reason", undefined, MARKING)).toBe(
      "future-reason",
    );
    expect(describeTriggerReason(SessionReplayTriggerReason.Sampled, 25)).toBe(
      "Sampled (25%)",
    );
  });

  test("formatIdleShare words the share, its percentage in place", () => {
    expect(formatIdleShare(60_000, 100_000, MARKING)).toBe("⟦idle 40%⟧");
    expect(formatIdleShare(60_000, 100_000)).toBe("idle 40%");
    expect(formatIdleShare(undefined, 100_000, MARKING)).toBeNull();
  });
});
