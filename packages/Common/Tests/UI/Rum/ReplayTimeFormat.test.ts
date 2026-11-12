import { describe, expect, it } from "@jest/globals";
import {
  ReplayClockParts,
  formatReplayClock,
  formatReplayOffset,
  formatReplayOffsetInLanguage,
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

// A Persian digit, ۰ to ۹.
const PERSIAN_DIGITS: RegExp = /[\u{06F0}-\u{06F9}]/gu;

/*
 * The session clock in the reader's digits (#7098): a tab's "opened 2:14"
 * read "2:14" on a Persian page whose every other number is in Persian
 * digits. Only the digits change; the shape and the floor are
 * formatReplayOffset's.
 */
describe("formatReplayOffsetInLanguage", () => {
  it("writes Persian digits in Persian, keeping m:ss and h:mm:ss", () => {
    expect(formatReplayOffsetInLanguage(134_000, "fa")).toBe("۲:۱۴");
    expect(formatReplayOffsetInLanguage(3_734_000, "fa")).toBe("۱:۰۲:۱۴");
    expect(formatReplayOffsetInLanguage(0, "fa")).toBe("۰:۰۰");
    expect(formatReplayOffsetInLanguage(Number.NaN, "fa")).toBe("۰:۰۰");
  });

  it("floors as formatReplayOffset does, digit for digit", () => {
    for (const offsetMs of [0, 999, 2_900, 59_999, 60_000, 3_599_999]) {
      expect(
        formatReplayOffsetInLanguage(offsetMs, "fa").replace(
          PERSIAN_DIGITS,
          (digit: string): string => {
            return String((digit.codePointAt(0) as number) - 0x06f0);
          },
        ),
      ).toBe(formatReplayOffset(offsetMs));
    }
  });

  it("keeps Latin digits in every other language, Arabic included", () => {
    for (const language of ["en", "de", "ar", "ja", "hi", "zh-CN"]) {
      expect(formatReplayOffsetInLanguage(134_000, language)).toBe("2:14");
    }
  });

  it("with no language, is formatReplayOffset", () => {
    expect(formatReplayOffsetInLanguage(3_734_000, undefined)).toBe(
      formatReplayOffset(3_734_000),
    );
  });
});
