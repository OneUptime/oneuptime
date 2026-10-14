import { describe, expect, test } from "@jest/globals";
import { seededRandom, SeededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  formatRelativeTime,
  getRelativeTimeParts,
  isJustNow,
  JUST_NOW_THRESHOLD_IN_SECONDS,
  RelativeTimeParts,
  toDate,
} from "../../FeatureSet/Dashboard/src/Components/Home/HomeRelativeTime";

/*
 * The times Home puts beside an incident, a maintenance window and the last
 * refresh (HomeRelativeTime.ts): "12 minutes ago", "in 2 days", in the
 * reader's language through Intl.RelativeTimeFormat, with no translation
 * keys of its own.
 */

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function at(offset: number): Date {
  return new Date(NOW.getTime() + offset);
}

function parts(offset: number): RelativeTimeParts {
  return getRelativeTimeParts({ date: at(offset), now: NOW });
}

function english(offset: number): string {
  return formatRelativeTime({ date: at(offset), now: NOW, language: "en" });
}

describe("the unit a time is said in", () => {
  test("under the threshold, a time is now, past or future", () => {
    expect(parts(0)).toEqual({ value: 0, unit: "second" });
    expect(parts(-10 * SECOND)).toEqual({ value: 0, unit: "second" });
    expect(parts(30 * SECOND)).toEqual({ value: 0, unit: "second" });
    expect(parts(-(JUST_NOW_THRESHOLD_IN_SECONDS - 1) * SECOND).value).toBe(0);
  });

  test("minutes below the hour, rounded, never zero", () => {
    expect(parts(-JUST_NOW_THRESHOLD_IN_SECONDS * SECOND)).toEqual({
      value: -1,
      unit: "minute",
    });
    expect(parts(-12 * MINUTE)).toEqual({ value: -12, unit: "minute" });
    expect(parts(-12 * MINUTE - 40 * SECOND)).toEqual({
      value: -13,
      unit: "minute",
    });
    expect(parts(40 * MINUTE)).toEqual({ value: 40, unit: "minute" });
  });

  test("whole hours below the day", () => {
    expect(parts(-HOUR)).toEqual({ value: -1, unit: "hour" });
    expect(parts(-(3 * HOUR + 59 * MINUTE))).toEqual({
      value: -3,
      unit: "hour",
    });
    expect(parts(23 * HOUR)).toEqual({ value: 23, unit: "hour" });
  });

  test("whole days below the month, then months, then years", () => {
    expect(parts(-DAY)).toEqual({ value: -1, unit: "day" });
    expect(parts(2 * DAY)).toEqual({ value: 2, unit: "day" });
    expect(parts(-29 * DAY)).toEqual({ value: -29, unit: "day" });
    expect(parts(-45 * DAY)).toEqual({ value: -1, unit: "month" });
    expect(parts(400 * DAY)).toEqual({ value: 1, unit: "year" });
  });

  test("a date that is not a time reads as now, never NaN", () => {
    expect(
      getRelativeTimeParts({ date: new Date("not a date"), now: NOW }),
    ).toEqual({ value: 0, unit: "second" });
  });
});

describe("the words", () => {
  test("English, past and future", () => {
    expect(english(0)).toBe("now");
    expect(english(-12 * MINUTE)).toBe("12 minutes ago");
    expect(english(-MINUTE)).toBe("1 minute ago");
    expect(english(-3 * HOUR)).toBe("3 hours ago");
    expect(english(40 * MINUTE)).toBe("in 40 minutes");
    expect(english(2 * DAY)).toBe("in 2 days");
    // numeric: "auto" says the day by its name.
    expect(english(-DAY)).toBe("yesterday");
    expect(english(DAY)).toBe("tomorrow");
  });

  test("the reader's language, with its own words and plurals", () => {
    expect(
      formatRelativeTime({ date: at(-2 * HOUR), now: NOW, language: "de" }),
    ).toBe("vor 2 Stunden");
    expect(
      formatRelativeTime({ date: at(3 * DAY), now: NOW, language: "fr" }),
    ).toBe("dans 3 jours");
    expect(
      formatRelativeTime({ date: at(-5 * MINUTE), now: NOW, language: "es" }),
    ).toBe("hace 5 minutos");
  });

  test("a language tag Intl rejects falls back to English instead of failing the card", () => {
    expect(
      formatRelativeTime({
        date: at(-2 * HOUR),
        now: NOW,
        language: "not a language!",
      }),
    ).toBe("2 hours ago");
  });

  test("no language is English", () => {
    expect(formatRelativeTime({ date: at(-2 * HOUR), now: NOW })).toBe(
      "2 hours ago",
    );
  });

  test("just now is exactly the times said as now", () => {
    expect(isJustNow({ date: at(-5 * SECOND), now: NOW })).toBe(true);
    expect(isJustNow({ date: at(-2 * MINUTE), now: NOW })).toBe(false);
  });
});

describe("any time, any language", () => {
  test("never throws, never says NaN, and says the past as the past", () => {
    const random: SeededRandom = seededRandom(1013);
    const languages: Array<string> = [
      "en",
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
    ];

    for (let draw: number = 0; draw < 3000; draw++) {
      // Up to two years either side of now.
      const magnitude: number = random(2 * 365) * DAY + random(DAY);
      const offset: number = random(2) === 0 ? -magnitude : magnitude;
      const language: string = languages[random(languages.length)]!;
      const text: string = formatRelativeTime({
        date: at(offset),
        now: NOW,
        language,
      });
      const drawn: RelativeTimeParts = parts(offset);

      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("NaN");

      if (drawn.value !== 0) {
        expect(Math.sign(drawn.value)).toBe(Math.sign(offset));
      }
    }
  });
});

describe("reading a date off the API", () => {
  test("a Date, its string and its number are the same moment", () => {
    expect(toDate(NOW)?.getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.toISOString())?.getTime()).toBe(NOW.getTime());
    expect(toDate(NOW.getTime())?.getTime()).toBe(NOW.getTime());
  });

  test("nothing, or not a moment, is undefined", () => {
    expect(toDate(undefined)).toBeUndefined();
    expect(toDate(null)).toBeUndefined();
    expect(toDate("")).toBeUndefined();
    expect(toDate("yesterday-ish")).toBeUndefined();
    expect(toDate(new Date(Number.NaN))).toBeUndefined();
  });
});
