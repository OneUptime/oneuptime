import { describe, expect, it } from "@jest/globals";
import {
  ReplayClockParts,
  formatReplayClock,
  formatReplayClockInLanguage,
  formatReplayOffset,
  formatReplayOffsetInLanguage,
  formatReplayOffsetPrecise,
  formatReplayOffsetPreciseInLanguage,
  formatReplayWallClock,
  formatReplayWallClockInLanguage,
  splitReplayClock,
  splitReplayClockInLanguage,
  toReplayUrlSeconds,
  writeReplayFigureInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimeFormat";
import {
  REPLAY_SPEEDS,
  formatReplaySpeed,
  formatReplaySpeedInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayControls";

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

/*
 * EVERY FIGURE THE PLAYER DRAWS, IN THE READER'S DIGITS (#7318).
 *
 * The play clock, its paused tenths, the header's wall clock, the rail's
 * offsets, the timeline's hover time and the speed were written in Latin
 * digits on a Persian page whose every other number is in Persian ones.
 * Each has an InLanguage twin now. Only the digits change - and, beside
 * Persian digits, the decimal point, which next to Persian's zero ("۰", a
 * dot) read as one more digit: "۱:۰۲٫۳". Arabic keeps Latin digits, as
 * OneUptime writes Arabic everywhere; German and English read as before.
 */

// Persian's digits back to Latin ones, and its decimal sign back to a point.
function inLatin(text: string): string {
  return text
    .replace(PERSIAN_DIGITS, (digit: string): string => {
      return String((digit.codePointAt(0) as number) - 0x06f0);
    })
    .split("٫")
    .join(".");
}

const LATIN_DIGIT: RegExp = /[0-9]/;

const LATIN_DIGIT_LANGUAGES: ReadonlyArray<string> = [
  "en",
  "de",
  "ar",
  "fr",
  "ja",
  "zh-CN",
];

const OFFSETS_MS: ReadonlyArray<number> = [
  0,
  700,
  2_900,
  12_345,
  59_999,
  62_300,
  600_000,
  3_661_000,
  3_734_500,
  -5_000,
  Number.NaN,
  Number.POSITIVE_INFINITY,
];

describe("writeReplayFigureInLanguage", () => {
  it("writes a figure the player wrote in Persian digits", () => {
    expect(writeReplayFigureInLanguage("1200x760", "fa")).toBe("۱۲۰۰x۷۶۰");
    expect(writeReplayFigureInLanguage("13:47:53", "fa")).toBe("۱۳:۴۷:۵۳");
    expect(writeReplayFigureInLanguage("0:00", "fa")).toBe("۰:۰۰");
  });

  it("takes Persian's own decimal sign: a point beside ۰ reads as a zero", () => {
    expect(writeReplayFigureInLanguage("1:02.3", "fa")).toBe("۱:۰۲٫۳");
    expect(writeReplayFigureInLanguage("0:00.0", "fa")).toBe("۰:۰۰٫۰");
    expect(writeReplayFigureInLanguage("0:00.0", "fa")).not.toContain(".");
  });

  it("leaves every language that writes Latin digits as it is, its point too", () => {
    for (const language of LATIN_DIGIT_LANGUAGES) {
      expect(writeReplayFigureInLanguage("1:02.3", language)).toBe("1:02.3");
      expect(writeReplayFigureInLanguage("1200x760", language)).toBe(
        "1200x760",
      );
    }
  });

  it("with no language, or a text with no digit, changes nothing", () => {
    expect(writeReplayFigureInLanguage("1:02.3", undefined)).toBe("1:02.3");
    expect(writeReplayFigureInLanguage("1:02.3", "")).toBe("1:02.3");
    expect(writeReplayFigureInLanguage("x.y", "fa")).toBe("x.y");
    expect(writeReplayFigureInLanguage("", "fa")).toBe("");
  });

  it("knows Persian by its region too", () => {
    expect(writeReplayFigureInLanguage("1:02.3", "fa-IR")).toBe("۱:۰۲٫۳");
  });
});

describe("formatReplayOffsetPreciseInLanguage", () => {
  it("writes the paused clock in Persian digits with Persian's decimal sign", () => {
    expect(formatReplayOffsetPreciseInLanguage(62_300, "fa")).toBe("۱:۰۲٫۳");
    expect(formatReplayOffsetPreciseInLanguage(700, "fa")).toBe("۰:۰۰٫۷");
    expect(formatReplayOffsetPreciseInLanguage(3_734_500, "fa")).toBe(
      "۱:۰۲:۱۴٫۵",
    );
  });

  it("a bad offset is a Persian zero, never NaN", () => {
    expect(formatReplayOffsetPreciseInLanguage(Number.NaN, "fa")).toBe(
      "۰:۰۰٫۰",
    );
    expect(formatReplayOffsetPreciseInLanguage(-5_000, "fa")).toBe("۰:۰۰٫۰");
  });

  it("floors as formatReplayOffsetPrecise does, digit for digit", () => {
    for (const offsetMs of OFFSETS_MS) {
      expect(inLatin(formatReplayOffsetPreciseInLanguage(offsetMs, "fa"))).toBe(
        formatReplayOffsetPrecise(offsetMs),
      );
    }
  });

  it("is formatReplayOffsetPrecise in every language with Latin digits, and with none", () => {
    for (const offsetMs of OFFSETS_MS) {
      for (const language of [...LATIN_DIGIT_LANGUAGES, undefined]) {
        expect(formatReplayOffsetPreciseInLanguage(offsetMs, language)).toBe(
          formatReplayOffsetPrecise(offsetMs),
        );
      }
    }
  });
});

describe("splitReplayClockInLanguage and formatReplayClockInLanguage", () => {
  it("writes both halves in Persian digits, tenths only while paused", () => {
    expect(splitReplayClockInLanguage(700, 30_000, true, "fa")).toEqual({
      current: "۰:۰۰٫۷",
      total: "۰:۳۰",
    });
    expect(splitReplayClockInLanguage(700, 30_000, false, "fa")).toEqual({
      current: "۰:۰۰",
      total: "۰:۳۰",
    });
    expect(formatReplayClockInLanguage(1_000, 30_000, false, "fa")).toBe(
      "۰:۰۱ / ۰:۳۰",
    );
    expect(formatReplayClockInLanguage(700, 30_000, true, "fa")).toBe(
      "۰:۰۰٫۷ / ۰:۳۰",
    );
  });

  it("renders hours on both halves in Persian too", () => {
    expect(
      splitReplayClockInLanguage(3_661_000, 7_200_000, false, "fa"),
    ).toEqual({ current: "۱:۰۱:۰۱", total: "۲:۰۰:۰۰" });
  });

  it("agrees with splitReplayClock in every language, digit for digit", () => {
    for (const offsetMs of OFFSETS_MS) {
      for (const isPaused of [true, false]) {
        const english: ReplayClockParts = splitReplayClock(
          offsetMs,
          252_000,
          isPaused,
        );
        const persian: ReplayClockParts = splitReplayClockInLanguage(
          offsetMs,
          252_000,
          isPaused,
          "fa",
        );

        expect({
          current: inLatin(persian.current),
          total: inLatin(persian.total),
        }).toEqual(english);

        for (const language of [...LATIN_DIGIT_LANGUAGES, undefined]) {
          expect(
            splitReplayClockInLanguage(offsetMs, 252_000, isPaused, language),
          ).toEqual(english);
          expect(
            formatReplayClockInLanguage(offsetMs, 252_000, isPaused, language),
          ).toBe(formatReplayClock(offsetMs, 252_000, isPaused));
        }
      }
    }
  });

  it("the joined clock is its two halves, as formatReplayClock is", () => {
    const parts: ReplayClockParts = splitReplayClockInLanguage(
      62_300,
      252_000,
      true,
      "fa",
    );

    expect(formatReplayClockInLanguage(62_300, 252_000, true, "fa")).toBe(
      `${parts.current} / ${parts.total}`,
    );
  });
});

describe("formatReplayWallClockInLanguage", () => {
  const START_UNIX_MS: number = new Date(2026, 8, 4, 13, 47, 12, 0).getTime();

  it("writes the wall clock in Persian digits, still HH:MM:SS", () => {
    const persian: string | null = formatReplayWallClockInLanguage(
      START_UNIX_MS,
      41_200,
      "fa",
    );

    expect(persian).toBe("۱۳:۴۷:۵۳");
    expect(persian).not.toMatch(LATIN_DIGIT);
  });

  it("pads the early hours as the English clock does", () => {
    const early: number = new Date(2026, 8, 4, 9, 5, 7, 0).getTime();

    expect(formatReplayWallClockInLanguage(early, 0, "fa")).toBe("۰۹:۰۵:۰۷");
    expect(formatReplayWallClockInLanguage(early, 0, "en")).toBe("09:05:07");
  });

  it("is null wherever the English one is", () => {
    for (const start of [null, undefined, Number.NaN]) {
      expect(formatReplayWallClockInLanguage(start, 1_000, "fa")).toBeNull();
    }

    expect(
      formatReplayWallClockInLanguage(START_UNIX_MS, Number.NaN, "fa"),
    ).toBeNull();
  });

  it("is formatReplayWallClock in every language with Latin digits, and with none", () => {
    for (const language of [...LATIN_DIGIT_LANGUAGES, undefined]) {
      expect(
        formatReplayWallClockInLanguage(START_UNIX_MS, 41_200, language),
      ).toBe(formatReplayWallClock(START_UNIX_MS, 41_200));
    }
  });
});

describe("formatReplayOffsetInLanguage keeps no decimal point it never had", () => {
  it("an offset has no tenths, in Persian either", () => {
    for (const offsetMs of OFFSETS_MS) {
      expect(formatReplayOffsetInLanguage(offsetMs, "fa")).not.toMatch(/[.٫]/);
    }
  });
});

/*
 * A copied link keeps ASCII digits: it is read by machines, pasted into
 * other tools. Only what is drawn is in the reader's digits.
 */
describe("toReplayUrlSeconds", () => {
  it("is a number, never written in a language's digits", () => {
    expect(toReplayUrlSeconds(62_300)).toBe(62);
    expect(String(toReplayUrlSeconds(62_300))).toBe("62");
  });
});

describe("formatReplaySpeedInLanguage", () => {
  it("writes the speed in Persian digits, with Persian's decimal sign", () => {
    expect(formatReplaySpeedInLanguage(1, "fa")).toBe("۱x");
    expect(formatReplaySpeedInLanguage(1.5, "fa")).toBe("۱٫۵x");
    expect(formatReplaySpeedInLanguage(0.25, "fa")).toBe("۰٫۲۵x");
    expect(formatReplaySpeedInLanguage(8, "fa")).toBe("۸x");
  });

  it("writes German's decimal comma, as every German figure does", () => {
    expect(formatReplaySpeedInLanguage(1.5, "de")).toBe("1,5x");
    expect(formatReplaySpeedInLanguage(0.25, "de")).toBe("0,25x");
    expect(formatReplaySpeedInLanguage(2, "de")).toBe("2x");
  });

  it("keeps Latin digits and a point in Arabic", () => {
    expect(formatReplaySpeedInLanguage(1.5, "ar")).toBe("1.5x");
    expect(formatReplaySpeedInLanguage(0.25, "ar")).toBe("0.25x");
  });

  it("reads in English, and with no language, exactly as it always did", () => {
    for (const speed of REPLAY_SPEEDS) {
      expect(formatReplaySpeedInLanguage(speed, "en")).toBe(
        formatReplaySpeed(speed),
      );
      expect(formatReplaySpeedInLanguage(speed, undefined)).toBe(
        formatReplaySpeed(speed),
      );
    }
  });

  it("every listed speed in Persian has no Latin digit", () => {
    for (const speed of REPLAY_SPEEDS) {
      expect(formatReplaySpeedInLanguage(speed, "fa")).not.toMatch(LATIN_DIGIT);
    }
  });
});
