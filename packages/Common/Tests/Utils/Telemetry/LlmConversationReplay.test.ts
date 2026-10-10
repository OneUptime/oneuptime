import { describe, expect, test } from "@jest/globals";
import LlmConversationReplay, {
  IDLE_GAP_THRESHOLD_MS,
  LlmReplayTimeline,
  REPLAY_SPEEDS,
  REPLAY_TAIL_MS,
  SKIPPED_GAP_MS,
} from "../../../Utils/Telemetry/LlmConversationReplay";

/*
 * The replay clock: where play starts, what Next and Previous do at the
 * edges, how a long silence is shortened and what the scrubber shows. The
 * player is a thin shell over these functions.
 */

const T0: number = Date.UTC(2026, 9, 10, 9, 0, 0);

// Question, answer 2 s later, a two-minute silence, a question, answer 1 s later.
const STEPS: Array<{ atMs: number }> = [
  { atMs: T0 },
  { atMs: T0 + 2000 },
  { atMs: T0 + 122_000 },
  { atMs: T0 + 123_000 },
];

function timeline(skipWaiting: boolean): LlmReplayTimeline {
  return LlmConversationReplay.buildTimeline(STEPS, { skipWaiting });
}

describe("buildTimeline", () => {
  test("in real time every step sits at its real offset", () => {
    const real: LlmReplayTimeline = timeline(false);

    expect(real.points).toEqual([0, 2000, 122_000, 123_000]);
    expect(real.durationMs).toBe(123_000 + REPLAY_TAIL_MS);
    expect(real.realDurationMs).toBe(123_000);
    expect(real.hasSkippedGaps).toBe(false);
  });

  test("skip waiting shortens only the gaps longer than the threshold", () => {
    const skipped: LlmReplayTimeline = timeline(true);

    expect(skipped.points).toEqual([
      0,
      2000,
      2000 + SKIPPED_GAP_MS,
      2000 + SKIPPED_GAP_MS + 1000,
    ]);
    expect(skipped.hasSkippedGaps).toBe(true);
    // The real duration is still reported.
    expect(skipped.realDurationMs).toBe(123_000);
  });

  test("a gap exactly at the threshold is kept", () => {
    const exact: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
      [{ atMs: T0 }, { atMs: T0 + IDLE_GAP_THRESHOLD_MS }],
      { skipWaiting: true },
    );

    expect(exact.points).toEqual([0, IDLE_GAP_THRESHOLD_MS]);
    expect(exact.hasSkippedGaps).toBe(false);
  });

  test("a step stamped before the previous one (clock skew) never runs backwards", () => {
    const skewed: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
      [{ atMs: T0 + 5000 }, { atMs: T0 + 4000 }, { atMs: T0 + 6000 }],
      { skipWaiting: false },
    );

    expect(skewed.points).toEqual([0, 0, 2000]);
  });

  test("no steps is a zero-length timeline", () => {
    const empty: LlmReplayTimeline = LlmConversationReplay.buildTimeline([], {
      skipWaiting: true,
    });

    expect(empty.points).toEqual([]);
    expect(empty.durationMs).toBe(0);
    expect(LlmConversationReplay.visibleCount(empty, 100)).toBe(0);
    expect(LlmConversationReplay.progress(empty, 100)).toBe(0);
    expect(LlmConversationReplay.realTimeAt(empty, 100)).toBe(0);
  });
});

describe("what is on screen", () => {
  const real: LlmReplayTimeline = timeline(false);

  test("a step appears the moment the clock reaches it", () => {
    expect(LlmConversationReplay.visibleCount(real, 0)).toBe(1);
    expect(LlmConversationReplay.visibleCount(real, 1999)).toBe(1);
    expect(LlmConversationReplay.visibleCount(real, 2000)).toBe(2);
    expect(LlmConversationReplay.visibleCount(real, 999_999)).toBe(4);
  });

  test("currentIndex is the newest visible step", () => {
    expect(LlmConversationReplay.currentIndex(real, 0)).toBe(0);
    expect(LlmConversationReplay.currentIndex(real, 122_500)).toBe(2);
  });
});

describe("Next and Previous", () => {
  const real: LlmReplayTimeline = timeline(false);

  test("Next goes to the next hidden step, and to the end after the last", () => {
    expect(LlmConversationReplay.nextStepTime(real, 0)).toBe(2000);
    expect(LlmConversationReplay.nextStepTime(real, 2000)).toBe(122_000);
    expect(LlmConversationReplay.nextStepTime(real, 123_000)).toBe(
      real.durationMs,
    );
  });

  test("Next to the last message finishes the replay, so it reads as finished", () => {
    expect(LlmConversationReplay.nextStepTime(real, 122_000)).toBe(real.durationMs);
    expect(LlmConversationReplay.nextStepTime(real, 122_500)).toBe(real.durationMs);
  });

  test("Next finishes the replay when the last messages share a moment", () => {
    const shared: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
      [{ atMs: T0 }, { atMs: T0 + 1000 }, { atMs: T0 + 1000 }],
      { skipWaiting: false },
    );

    expect(LlmConversationReplay.nextStepTime(shared, 0)).toBe(shared.durationMs);
  });

  test("Previous shows one step fewer, and stays at the start from the first", () => {
    expect(LlmConversationReplay.previousStepTime(real, 123_000)).toBe(122_000);
    expect(LlmConversationReplay.previousStepTime(real, 122_500)).toBe(2000);
    expect(LlmConversationReplay.previousStepTime(real, 2000)).toBe(0);
    expect(LlmConversationReplay.previousStepTime(real, 0)).toBe(0);
  });

  test("Previous skips steps that share a time (an answer and its tool call)", () => {
    const shared: LlmReplayTimeline = LlmConversationReplay.buildTimeline(
      [{ atMs: T0 }, { atMs: T0 + 1000 }, { atMs: T0 + 1000 }],
      { skipWaiting: false },
    );

    expect(LlmConversationReplay.previousStepTime(shared, 1000)).toBe(0);
  });

  test("timeOfStep clamps to the timeline", () => {
    expect(LlmConversationReplay.timeOfStep(real, -5)).toBe(0);
    expect(LlmConversationReplay.timeOfStep(real, 2)).toBe(122_000);
    expect(LlmConversationReplay.timeOfStep(real, 99)).toBe(123_000);
  });
});

describe("play, speed and the scrubber", () => {
  const skipped: LlmReplayTimeline = timeline(true);

  test("play resumes where the clock is, and starts over from the end", () => {
    expect(LlmConversationReplay.playFrom(skipped, 1500)).toBe(1500);
    expect(LlmConversationReplay.playFrom(skipped, skipped.durationMs)).toBe(0);
    expect(LlmConversationReplay.playFrom(skipped, skipped.durationMs + 5)).toBe(
      0,
    );
    expect(LlmConversationReplay.playFrom(skipped, -10)).toBe(0);
  });

  test("speed cycles 1x, 2x, 4x, 8x and back", () => {
    expect(REPLAY_SPEEDS).toEqual([1, 2, 4, 8]);
    expect(LlmConversationReplay.nextSpeed(1)).toBe(2);
    expect(LlmConversationReplay.nextSpeed(2)).toBe(4);
    expect(LlmConversationReplay.nextSpeed(4)).toBe(8);
    expect(LlmConversationReplay.nextSpeed(8)).toBe(1);
    expect(LlmConversationReplay.nextSpeed(3)).toBe(1);
  });

  test("progress and clockAtProgress are inverses, clamped to 0..1", () => {
    const half: number = skipped.durationMs / 2;

    expect(LlmConversationReplay.progress(skipped, half)).toBeCloseTo(0.5, 10);
    expect(LlmConversationReplay.clockAtProgress(skipped, 0.5)).toBeCloseTo(
      half,
      10,
    );
    expect(LlmConversationReplay.progress(skipped, -1)).toBe(0);
    expect(LlmConversationReplay.progress(skipped, 1e12)).toBe(1);
    expect(LlmConversationReplay.clockAtProgress(skipped, 2)).toBe(
      skipped.durationMs,
    );
  });
});

describe("real time during a replay", () => {
  test("waiting for an answer counts up in real seconds", () => {
    const real: LlmReplayTimeline = timeline(false);

    expect(LlmConversationReplay.realTimeAt(real, 0)).toBe(T0);
    expect(LlmConversationReplay.realTimeAt(real, 1000)).toBe(T0 + 1000);
    expect(LlmConversationReplay.realTimeAt(real, 2000)).toBe(T0 + 2000);
  });

  test("inside a shortened gap the real clock moves through the whole real gap", () => {
    const skipped: LlmReplayTimeline = timeline(true);
    const midGap: number = 2000 + SKIPPED_GAP_MS / 2;

    expect(LlmConversationReplay.realTimeAt(skipped, midGap)).toBe(
      T0 + 2000 + 60_000,
    );
  });

  test("past the last step the real clock stops at the tail", () => {
    const real: LlmReplayTimeline = timeline(false);

    expect(LlmConversationReplay.realTimeAt(real, 10_000_000)).toBe(
      T0 + 123_000 + REPLAY_TAIL_MS,
    );
  });
});

describe("switching skip waiting keeps the same messages on screen", () => {
  test("mid-conversation", () => {
    const from: LlmReplayTimeline = timeline(false);
    const to: LlmReplayTimeline = timeline(true);

    // Three steps visible, 300 ms after the third.
    const carried: number = LlmConversationReplay.carryOver({
      from: from,
      to: to,
      clockMs: 122_300,
    });

    expect(LlmConversationReplay.visibleCount(to, carried)).toBe(3);
    expect(carried).toBe(2000 + SKIPPED_GAP_MS + 300);
  });

  test("inside a long gap: the offset never carries past the next step", () => {
    const from: LlmReplayTimeline = timeline(false);
    const to: LlmReplayTimeline = timeline(true);

    // Two steps visible, a minute into the two-minute silence.
    const carried: number = LlmConversationReplay.carryOver({
      from: from,
      to: to,
      clockMs: 62_000,
    });

    expect(LlmConversationReplay.visibleCount(to, carried)).toBe(2);
  });

  test("at the end stays at the end", () => {
    const from: LlmReplayTimeline = timeline(true);
    const to: LlmReplayTimeline = timeline(false);

    expect(
      LlmConversationReplay.carryOver({
        from: from,
        to: to,
        clockMs: from.durationMs,
      }),
    ).toBe(to.durationMs);
  });
});
