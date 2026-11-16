import { describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  getEnglishOf,
  withDateDisplayLanguage,
} from "../../Types/DateLanguage";
import ScheduleTimelineLayout from "../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import { createTranslator, Translator } from "../../Types/Translator";
import { dashboardTranslator } from "../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../Helpers/IsolateMarks";

/*
 * A SPAN'S DURATION AND A SHIFT'S LENGTH, IN THE READER'S LANGUAGE (#8617).
 *
 * Two helpers in Common/Types built their compact durations by hand, and a
 * Dashboard page drew both: a span's humanized duration ("2h 5m", "1.72 s")
 * - its unit symbols English in every language, only its decimal point the
 * reader's - and the on-call schedule timeline's bars and legend ("3d
 * 12h"), English letters and Latin digits for every reader. Handed the
 * reader's Translator, each is written with the Dashboard's units and
 * compact keys now, each figure the reader's. English reads exactly as it
 * always did, and without a translator the humanized duration reads as it
 * did too.
 */

const NB: string = String.fromCharCode(0x00a0);

const EN: Translator = createTranslator(undefined, "en");

const translators: Record<string, Translator> = {
  en: dashboardTranslator("en"),
  de: dashboardTranslator("de"),
  fr: dashboardTranslator("fr"),
  ar: dashboardTranslator("ar"),
  fa: dashboardTranslator("fa"),
};

const LATIN: RegExp = /[0-9A-Za-z]/;

const LATIN_LETTER: RegExp = /[A-Za-z]/;

const LATIN_DIGIT: RegExp = /[0-9]/;

const SECOND: number = 1e9;

// The humanized duration of `nanoseconds` in `language`, its isolating marks left out.
const humanized: (
  language: string,
  nanoseconds: number,
  maxParts?: number,
) => string = (
  language: string,
  nanoseconds: number,
  maxParts?: number,
): string => {
  return withoutIsolateMarks(
    OneUptimeDate.getHumanizedDurationFromNanoseconds({
      nanoseconds,
      // Left out, as the call reads it, when the test gives none.
      ...(maxParts === undefined ? {} : { maxParts }),
      translator: translators[language],
    }),
  );
};

/*
 * getHumanizedDurationFromNanoseconds's English as it was written before
 * #8617, word for word: the reference every English reading is held to,
 * each figure held to its unit by a no-break space since #8826.
 */
const formatDurationValueBefore: (value: number) => string = (
  value: number,
): string => {
  if (Math.abs(value) >= 100) {
    return Math.round(value).toString();
  }

  return value
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?[1-9])0+$/, "$1");
};

const englishBefore: (nanosecondsIn: number, maxPartsIn?: number) => string = (
  nanosecondsIn: number,
  maxPartsIn?: number,
): string => {
  let nanoseconds: number = nanosecondsIn;
  const maxParts: number = maxPartsIn ?? 2;

  if (!Number.isFinite(nanoseconds)) {
    return "-";
  }

  if (nanoseconds === 0) {
    return "0\u00A0ms";
  }

  const sign: string = nanoseconds < 0 ? "-" : "";
  nanoseconds = Math.abs(nanoseconds);

  if (nanoseconds < 1000) {
    return sign + Math.round(nanoseconds).toString() + "\u00A0ns";
  }

  if (nanoseconds / 1000 < 1000) {
    return sign + formatDurationValueBefore(nanoseconds / 1000) + "\u00A0μs";
  }

  if (nanoseconds / 1000000 < 1000) {
    return sign + formatDurationValueBefore(nanoseconds / 1000000) + "\u00A0ms";
  }

  const seconds: number = nanoseconds / 1000000000;

  if (seconds < 60) {
    return sign + formatDurationValueBefore(seconds) + "\u00A0s";
  }

  const units: Array<{ label: string; seconds: number }> = [
    { label: "d", seconds: 86400 },
    { label: "h", seconds: 3600 },
    { label: "m", seconds: 60 },
    { label: "s", seconds: 1 },
  ];
  let remainingSeconds: number = Math.floor(seconds);
  const parts: Array<string> = [];

  for (const unit of units) {
    if (parts.length >= maxParts) {
      break;
    }

    if (remainingSeconds < unit.seconds) {
      continue;
    }

    const value: number = Math.floor(remainingSeconds / unit.seconds);

    if (value > 0) {
      parts.push(String(value) + unit.label);
      remainingSeconds -= value * unit.seconds;
    }
  }

  const leftoverSeconds: number =
    remainingSeconds + (seconds - Math.floor(seconds));

  if (leftoverSeconds > 0) {
    if (parts.length === 0) {
      parts.push(formatDurationValueBefore(leftoverSeconds) + "s");
    } else if (parts[parts.length - 1]?.endsWith("s")) {
      const updated: number =
        parseFloat(parts[parts.length - 1]!.slice(0, -1)) + leftoverSeconds;
      parts[parts.length - 1] = formatDurationValueBefore(updated) + "s";
    } else if (parts.length < maxParts) {
      parts.push(formatDurationValueBefore(leftoverSeconds) + "s");
    }
  }

  if (parts.length === 0) {
    return sign + formatDurationValueBefore(seconds) + "\u00A0s";
  }

  const trimmed: Array<string> = parts.slice(0, maxParts);

  if (sign) {
    trimmed[0] = sign + trimmed[0];
  }

  return trimmed.join(" ");
};

// Durations across every branch: ns, μs, ms, s, and the compact parts.
const SWEEP: ReadonlyArray<number> = [
  0,
  1,
  499.4,
  999,
  1000,
  1500,
  99_994,
  350_000,
  999_999,
  1e6,
  2.4e6,
  99.996e6,
  716e6,
  999.5e6,
  1e9,
  1.72e9,
  59.999e9,
  60e9,
  65.5e9,
  125e9,
  125.5e9,
  3599e9,
  3600e9,
  3600.25e9,
  7500e9,
  86400e9,
  90_061e9,
  90_061.75e9,
  1_000_000e9,
  -500,
  -3.5e9,
  -125e9,
  -90_061e9,
  NaN,
  Infinity,
];

describe("a span's duration in English: exactly as it was written before", () => {
  test.each([1, 2, 3, 4])("with at most %d parts", (maxParts: number) => {
    for (const nanoseconds of SWEEP) {
      const before: string = englishBefore(nanoseconds, maxParts);

      for (const translator of [EN, translators["en"]!, undefined]) {
        expect({
          nanoseconds,
          maxParts,
          said: OneUptimeDate.getHumanizedDurationFromNanoseconds({
            nanoseconds,
            maxParts,
            translator,
          }),
        }).toEqual({ nanoseconds, maxParts, said: before });
      }
    }
  });

  test("English is never remembered: there is nothing to put back", () => {
    expect(
      getEnglishOf(
        OneUptimeDate.getHumanizedDurationFromNanoseconds({
          nanoseconds: 125 * SECOND,
          translator: EN,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("a span's duration in the reader's language", () => {
  test("one unit: the Dashboard's spaced units, each figure the reader's", () => {
    expect(humanized("de", 500)).toBe(`500${NB}ns`);
    expect(humanized("de", 2.4e6)).toBe(`2,4${NB}ms`);
    expect(humanized("de", 1.72 * SECOND)).toBe(`1,72${NB}Sek.`);
    expect(humanized("de", 0)).toBe(`0${NB}ms`);
    expect(humanized("ar", 1.72 * SECOND)).toBe(`1.72${NB}ث`);
    expect(humanized("fa", 1.72 * SECOND)).toBe(`۱٫۷۲${NB}ثانیه`);
    expect(humanized("fa", 716e6)).toBe(`۷۱۶${NB}میلی‌ثانیه`);
    expect(humanized("fr", 1.5 * SECOND)).toMatch(/^1,5[\u00A0\u202F]s$/);
  });

  test("from a minute up: the Dashboard's compact keys", () => {
    expect(humanized("de", 125 * SECOND)).toBe(`2${NB}Min. 5${NB}s`);
    expect(humanized("de", 7500 * SECOND)).toBe(`2${NB}Std. 5${NB}Min.`);
    expect(humanized("de", 90_061 * SECOND)).toBe(`1${NB}T. 1${NB}Std.`);
    expect(humanized("ar", 125.5 * SECOND)).toBe(`2${NB}د 5.5${NB}ث`);
    expect(humanized("fa", 125.5 * SECOND)).toBe(`۲${NB}دقیقه ۵٫۵${NB}ثانیه`);
    expect(humanized("fa", 7500 * SECOND)).toBe(`۲${NB}ساعت ۵${NB}دقیقه`);
    // Three parts asked for: each unit's own words, in order.
    expect(humanized("de", 90_061 * SECOND, 3)).toBe(
      `1${NB}Tg. 1${NB}Std. 1${NB}Min.`,
    );
  });

  test("a Persian duration holds no Latin digit or letter; an Arabic one no Latin letter", () => {
    /*
     * Microseconds aside: both languages abbreviate them "μs", as Intl's
     * own data does ("۱μs"), and formatDurationInUnit writes Intl's unit.
     */
    const isMicroseconds: (nanoseconds: number) => boolean = (
      nanoseconds: number,
    ): boolean => {
      return Math.abs(nanoseconds) >= 1000 && Math.abs(nanoseconds) < 1e6;
    };

    for (const nanoseconds of SWEEP.filter((value: number): boolean => {
      return Number.isFinite(value) && !isMicroseconds(value);
    })) {
      const persian: string = humanized("fa", nanoseconds);
      const arabic: string = humanized("ar", nanoseconds);

      expect({ nanoseconds, persian, latin: LATIN.test(persian) }).toEqual({
        nanoseconds,
        persian,
        latin: false,
      });
      expect({ nanoseconds, arabic, latin: LATIN_LETTER.test(arabic) }).toEqual(
        { nanoseconds, arabic, latin: false },
      );
    }

    // Microseconds in Persian digits all the same.
    expect(humanized("fa", 350_000)).toMatch(/^۳۵۰/);
    expect(LATIN_DIGIT.test(humanized("fa", 350_000))).toBe(false);
  });

  test("a negative one keeps its sign", () => {
    expect(humanized("de", -3.5 * SECOND)).toBe(`-3,5${NB}Sek.`);
    expect(humanized("de", -125 * SECOND)).toBe(`-2${NB}Min. 5${NB}s`);
  });

  test("not a number is a dash in every language", () => {
    expect(humanized("fa", NaN)).toBe("-");
    expect(humanized("de", Infinity)).toBe("-");
  });

  test("it is remembered with its English, for a sentence the language has not worded", () => {
    const persian: string = OneUptimeDate.getHumanizedDurationFromNanoseconds({
      nanoseconds: 125 * SECOND,
      translator: translators["fa"],
    });

    expect(getEnglishOf(persian)).toBe("2m 5s");

    const silent: Translator = createTranslator((): string | undefined => {
      return undefined;
    }, "fa");

    expect(
      withoutIsolateMarks(
        silent.translateTemplate("Took {{duration}}", { duration: persian }),
      ),
    ).toBe("Took 2m 5s");
  });

  test("without a translator it reads as before: English symbols, the display language's decimal point", () => {
    withDateDisplayLanguage("de", (): void => {
      expect(
        OneUptimeDate.getHumanizedDurationFromNanoseconds({
          nanoseconds: 1.72 * SECOND,
        }),
      ).toBe("1,72\u00A0s");
      expect(
        OneUptimeDate.getHumanizedDurationFromNanoseconds({
          nanoseconds: 125.5 * SECOND,
        }),
      ).toBe("2m 5,5s");
    });
  });
});

describe("the on-call schedule timeline's lengths", () => {
  const MINUTE: number = 60_000;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  const length: (language: string, milliseconds: number) => string = (
    language: string,
    milliseconds: number,
  ): string => {
    return withoutIsolateMarks(
      ScheduleTimelineLayout.formatDuration(
        milliseconds,
        translators[language],
      ),
    );
  };

  test("English reads exactly as before, with a translator or without", () => {
    for (const [milliseconds, expected] of [
      [7 * DAY, "7d"],
      [3 * DAY + 12 * HOUR, "3d 12h"],
      [8 * HOUR, "8h"],
      [8 * HOUR + 30 * MINUTE, "8h 30m"],
      [45 * MINUTE, "45m"],
      [30_000, "<1m"],
      [NaN, "<1m"],
    ] as Array<[number, string]>) {
      expect(ScheduleTimelineLayout.formatDuration(milliseconds)).toBe(
        expected,
      );
      expect(length("en", milliseconds)).toBe(expected);
    }
  });

  test("German, French, Arabic and Persian say it their way", () => {
    expect(length("de", 3 * DAY + 12 * HOUR)).toBe(`3${NB}T. 12${NB}Std.`);
    expect(length("de", 8 * HOUR + 30 * MINUTE)).toBe(`8${NB}Std. 30${NB}Min.`);
    expect(length("de", 7 * DAY)).toBe(`7${NB}Tg.`);
    expect(length("fr", 45 * MINUTE)).toBe(`45${NB}min`);
    expect(length("ar", 3 * DAY + 12 * HOUR)).toBe(`3${NB}ي 12${NB}س`);
    expect(length("fa", 8 * HOUR + 30 * MINUTE)).toBe(
      `۸${NB}ساعت ۳۰${NB}دقیقه`,
    );
    expect(length("fa", 30_000)).toBe(`<۱${NB}دقیقه`);
    expect(LATIN.test(length("fa", 3 * DAY + 12 * HOUR))).toBe(false);
  });
});
