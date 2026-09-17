import { describe, expect, it } from "@jest/globals";
import {
  ReplayClockParts,
  formatReplayClock,
  formatReplayOffset,
  formatReplayOffsetPrecise,
  splitReplayClock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeFormat";

/*
 * The clock, as its two halves.
 *
 * splitReplayClock exists because the redesigned transport row weights
 * the elapsed time and mutes the total, which needs the halves
 * separately - and the one thing that must not happen is the halves
 * drifting from the joined string that the E2E suite and every existing
 * caller still read. formatReplayClock is now defined IN TERMS of the
 * split, and these tests hold the two together.
 */

describe("splitReplayClock", () => {
  it("agrees with formatReplayClock, character for character", () => {
    const cases: Array<[number, number, boolean]> = [
      [0, 0, true],
      [0, 0, false],
      [12_000, 600_000, false],
      [12_345, 600_000, true],
      [62_300, 252_000, true],
      [3_661_000, 7_200_000, false],
      [-5_000, 90_000, false],
      [Number.NaN, 90_000, true],
    ];

    cases.forEach(
      ([currentTimeMs, durationMs, isPaused]: [
        number,
        number,
        boolean,
      ]): void => {
        const parts: ReplayClockParts = splitReplayClock(
          currentTimeMs,
          durationMs,
          isPaused,
        );

        expect(`${parts.current} / ${parts.total}`).toBe(
          formatReplayClock(currentTimeMs, durationMs, isPaused),
        );
      },
    );
  });

  /*
   * Tenths only while paused: at 1x a decimal would flicker ten times a
   * second and read as noise, and while paused a viewer stepping frame
   * by frame needs the readout to move at all.
   */
  it("carries tenths only while paused", () => {
    expect(splitReplayClock(62_300, 252_000, true).current).toBe("1:02.3");
    expect(splitReplayClock(62_300, 252_000, false).current).toBe("1:02");
  });

  it("never shows tenths on the total, paused or not", () => {
    expect(splitReplayClock(62_300, 252_400, true).total).toBe("4:12");
    expect(splitReplayClock(62_300, 252_400, false).total).toBe("4:12");
  });

  it("renders hours on both halves once a session is long enough", () => {
    const parts: ReplayClockParts = splitReplayClock(
      3_661_000,
      7_200_000,
      false,
    );

    expect(parts.current).toBe("1:01:01");
    expect(parts.total).toBe("2:00:00");
  });

  /* A bad manifest must reach the screen as "0:00", never as "NaN:NaN". */
  it("floors a garbage offset to zero instead of printing NaN", () => {
    expect(splitReplayClock(Number.NaN, 90_000, false).current).toBe("0:00");
    expect(splitReplayClock(-5_000, 90_000, false).current).toBe("0:00");
    expect(
      splitReplayClock(10_000, Number.POSITIVE_INFINITY, false).total,
    ).toBe("0:00");
  });

  it("floors rather than rounds, so a link never lands after its event", () => {
    /* 2,900ms is still inside second two on every surface of the player. */
    expect(splitReplayClock(2_900, 60_000, false).current).toBe("0:02");
    expect(formatReplayOffset(2_900)).toBe("0:02");
    expect(formatReplayOffsetPrecise(2_900)).toBe("0:02.9");
  });
});
