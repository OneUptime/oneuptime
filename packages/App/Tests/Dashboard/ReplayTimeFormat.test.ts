import { describe, expect, test } from "@jest/globals";
import {
  formatReplayClock,
  formatReplayDelta,
  formatReplayDuration,
  formatReplayOffset,
  formatReplayOffsetPrecise,
  formatReplayWallClock,
  toReplayUrlSeconds,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeFormat";

/*
 * One formatter for every replay offset. The scrubber used to round and
 * the rail used to floor (finding scrubber-devtools-13), so the same
 * event read "0:03" in one place and "0:02" in the other; neither drew
 * hours. These tests pin floor semantics and the hour form.
 */

describe("formatReplayOffset", () => {
  test("floors to the second so 2,500ms reads 0:02, never 0:03", () => {
    expect(formatReplayOffset(2500)).toBe("0:02");
    expect(formatReplayOffset(2999)).toBe("0:02");
    expect(formatReplayOffset(3000)).toBe("0:03");
  });

  test("renders hours as h:mm:ss once the offset reaches an hour", () => {
    expect(formatReplayOffset(65 * 60 * 1000)).toBe("1:05:00");
    expect(formatReplayOffset(3600 * 1000 + 7 * 1000)).toBe("1:00:07");
    expect(formatReplayOffset(59 * 60 * 1000 + 59 * 1000)).toBe("59:59");
  });

  test("never prints NaN or a negative time", () => {
    expect(formatReplayOffset(Number.NaN)).toBe("0:00");
    expect(formatReplayOffset(-4000)).toBe("0:00");
    expect(formatReplayOffset(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatReplayOffsetPrecise", () => {
  test("adds a floored tenth of a second", () => {
    expect(formatReplayOffsetPrecise(62340)).toBe("1:02.3");
    expect(formatReplayOffsetPrecise(62399)).toBe("1:02.3");
    expect(formatReplayOffsetPrecise(0)).toBe("0:00.0");
  });
});

describe("formatReplayClock", () => {
  test("shows tenths only while paused", () => {
    expect(formatReplayClock(12345, 600000, true)).toBe("0:12.3 / 10:00");
    expect(formatReplayClock(12345, 600000, false)).toBe("0:12 / 10:00");
  });
});

describe("formatReplayDuration", () => {
  test("uses the largest two units and rounds to the second", () => {
    expect(formatReplayDuration(18000)).toBe("18s");
    expect(formatReplayDuration(72000)).toBe("1m 12s");
    expect(formatReplayDuration(120000)).toBe("2m");
    expect(formatReplayDuration(2 * 3600 * 1000 + 5 * 60 * 1000)).toBe("2h 5m");
    expect(formatReplayDuration(3600 * 1000)).toBe("1h");
  });

  test("a sub-second gap is '<1s', never '0s'", () => {
    expect(formatReplayDuration(400)).toBe("<1s");
    expect(formatReplayDuration(0)).toBe("0s");
    expect(formatReplayDuration(-5)).toBe("0s");
  });
});

describe("formatReplayDelta", () => {
  test("carries the sign", () => {
    expect(formatReplayDelta(10000)).toBe("+10s");
    expect(formatReplayDelta(-30000)).toBe("-30s");
    expect(formatReplayDelta(0)).toBe("0s");
  });
});

describe("formatReplayWallClock", () => {
  test("adds the offset to the session start and prints local HH:MM:SS", () => {
    const start: Date = new Date(2026, 7, 14, 10, 0, 0);

    expect(formatReplayWallClock(start.getTime(), 92000)).toBe("10:01:32");
  });

  test("returns null rather than 'Invalid Date' without a start", () => {
    expect(formatReplayWallClock(null, 1000)).toBeNull();
    expect(formatReplayWallClock(undefined, 1000)).toBeNull();
    expect(formatReplayWallClock(Number.NaN, 1000)).toBeNull();
  });
});

describe("toReplayUrlSeconds", () => {
  test("writes whole seconds, floored, so a link lands before the moment", () => {
    expect(toReplayUrlSeconds(2999)).toBe(2);
    expect(toReplayUrlSeconds(-1)).toBe(0);
  });
});
