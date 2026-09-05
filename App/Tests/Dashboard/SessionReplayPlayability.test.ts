import { describe, expect, test } from "@jest/globals";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  describeTriggerReason,
  formatExpiry,
  formatIdleShare,
  formatSessionDuration,
  getSessionReplayPlayability,
  SESSION_REPLAY_ESTIMATED_CHUNK_SECONDS,
  SessionReplayPlayability,
  SessionReplayPlayabilityInput,
  TRIGGER_REASON_LABELS,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayability";

/*
 * The Recording badge: five honest states, each with the copy the list
 * shows, and Watch offered only where the player has something to show.
 */

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function input(
  overrides?: Partial<SessionReplayPlayabilityInput>,
): SessionReplayPlayabilityInput {
  return {
    isFinalized: true,
    sealedReason: "",
    chunkCount: 12,
    missingChunkCount: 0,
    expiresAtUnixMs: NOW + 6 * DAY_MS + 3600 * 1000,
    ...overrides,
  };
}

describe("getSessionReplayPlayability", () => {
  test("a provisional header is 'Recording now', watchable, and honest about counts", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ isFinalized: false, chunkCount: 0 }),
      NOW,
    );

    expect(result.kind).toBe("recording");
    expect(result.text).toBe("Recording now");
    expect(result.severity).toBe("info");
    expect(result.isWatchable).toBe(true);
    expect(result.tooltip).toContain("not been finalized");
    expect(result.tooltip).toContain("10 minutes");
  });

  test("playable footage says when it expires", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input(),
      NOW,
    );

    expect(result.kind).toBe("playable");
    expect(result.text).toBe("Playable");
    expect(result.detail).toBe("expires in 6d");
    expect(result.tooltip).toContain("expires in 6d");
    expect(result.isWatchable).toBe(true);
  });

  test("without an expiry from the server, no expiry is claimed", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ expiresAtUnixMs: undefined }),
      NOW,
    );

    expect(result.detail).toBeNull();
    expect(result.tooltip).not.toContain("expires");
  });

  test("a finalized row with no chunks is metadata only and not watchable", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ chunkCount: 0 }),
      NOW,
    );

    expect(result.kind).toBe("metadata-only");
    expect(result.text).toBe("Metadata only");
    expect(result.isWatchable).toBe(false);
  });

  /*
   * ux-09: RumSession derives retentionDate from the session start and
   * "keeps the header's retentionDate equal to its chunks'", so a row and
   * its footage expire on the same day. No state may tell the viewer that
   * the metadata outlived the recording.
   */
  test("no state claims the row outlived its footage", () => {
    const metadataOnly: SessionReplayPlayability = getSessionReplayPlayability(
      input({ chunkCount: 0 }),
      NOW,
    );

    expect(metadataOnly.tooltip).toContain("expires together with its footage");
    expect(metadataOnly.tooltip).not.toContain("no longer stored");
    expect(metadataOnly.tooltip).toMatch(/never uploaded|refused/);

    const lost: SessionReplayPlayability = getSessionReplayPlayability(
      input({ sealedReason: "recording-lost" }),
      NOW,
    );

    expect(lost.tooltip).not.toContain("expired");

    const playable: SessionReplayPlayability = getSessionReplayPlayability(
      input(),
      NOW,
    );

    expect(playable.tooltip).toContain("this row expires with it");
  });

  test("recording-lost wins over everything and is not watchable", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ sealedReason: "recording-lost", isFinalized: false }),
      NOW,
    );

    expect(result.kind).toBe("lost");
    expect(result.text).toBe("Recording lost");
    expect(result.severity).toBe("danger");
    expect(result.isWatchable).toBe(false);
  });

  test("missing chunks make a Partial recording with an estimated gap", () => {
    const result: SessionReplayPlayability = getSessionReplayPlayability(
      input({ missingChunkCount: 3 }),
      NOW,
    );

    expect(result.kind).toBe("partial");
    expect(result.text).toBe("Partial");
    expect(result.detail).toBe(
      `about ${3 * SESSION_REPLAY_ESTIMATED_CHUNK_SECONDS}s missing - expires in 6d`,
    );
    expect(result.tooltip).toContain("3 chunks");
    expect(result.isWatchable).toBe(true);
  });

  test("one missing chunk is singular", () => {
    expect(
      getSessionReplayPlayability(
        input({ missingChunkCount: 1, expiresAtUnixMs: undefined }),
        NOW,
      ).tooltip,
    ).toContain("1 chunk of footage");
  });
});

describe("formatExpiry", () => {
  test("days, hours, within the hour, expired, unknown", () => {
    expect(formatExpiry(NOW + 6 * DAY_MS + 1, NOW)).toBe("expires in 6d");
    expect(formatExpiry(NOW + 5 * 3600 * 1000, NOW)).toBe("expires in 5h");
    expect(formatExpiry(NOW + 10 * 60 * 1000, NOW)).toBe(
      "expires within the hour",
    );
    expect(formatExpiry(NOW - 1, NOW)).toBe("expired");
    expect(formatExpiry(undefined, NOW)).toBeNull();
    expect(formatExpiry(0, NOW)).toBeNull();
  });
});

describe("formatSessionDuration", () => {
  test("shows hours once a session crosses one", () => {
    expect(formatSessionDuration(90 * 60 * 1000)).toBe("1h 30m");
    expect(formatSessionDuration(2 * 3600 * 1000 + 5 * 60 * 1000)).toBe(
      "2h 05m",
    );
  });

  test("minutes and seconds below an hour, seconds below a minute", () => {
    expect(formatSessionDuration(12 * 60 * 1000 + 5000)).toBe("12m 05s");
    expect(formatSessionDuration(45_000)).toBe("45s");
  });

  test("zero or unknown is a dash, never 0s", () => {
    expect(formatSessionDuration(0)).toBe("—");
    expect(formatSessionDuration(NaN)).toBe("—");
    expect(formatSessionDuration(-5)).toBe("—");
  });
});

describe("describeTriggerReason", () => {
  test("'sampled' under 100% is always-on, not 'sampled'", () => {
    expect(describeTriggerReason("sampled", 100)).toBe("Always-on");
    expect(describeTriggerReason("sampled", undefined)).toBe("Always-on");
    expect(describeTriggerReason("sampled", 25)).toBe("Sampled (25%)");
  });

  test("every enum value has a human label, and the dropdown uses the same words", () => {
    for (const reason of Object.values(SessionReplayTriggerReason)) {
      expect(describeTriggerReason(reason, 50)).not.toBe(reason);
      expect(TRIGGER_REASON_LABELS[reason].length).toBeGreaterThan(0);
    }

    expect(describeTriggerReason("performance")).toBe("Slow page");
    expect(describeTriggerReason("error")).toBe("On error");
    expect(describeTriggerReason("")).toBe("Trigger not recorded");
  });
});

describe("formatIdleShare", () => {
  test("says idle N% only when active time was measured", () => {
    expect(formatIdleShare(60_000, 100_000)).toBe("idle 40%");
    expect(formatIdleShare(undefined, 100_000)).toBeNull();
    expect(formatIdleShare(0, 100_000)).toBeNull();
    expect(formatIdleShare(99_000, 100_000)).toBeNull();
    expect(formatIdleShare(60_000, 0)).toBeNull();
  });
});
