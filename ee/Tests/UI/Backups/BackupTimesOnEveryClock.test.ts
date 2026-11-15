import { describe, expect, test } from "@jest/globals";
import {
  describeUtcHourOption,
  formatBackupDateTime,
  getLocalTimeOfUtcHour,
} from "../../../AdminDashboard/Backups/BackupFormat";
import { FeedClock } from "Common/UI/Components/Feed/FeedTime";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A BACKUP'S TIMES, ON A 12-HOUR CLOCK AND ON A 24-HOUR ONE (#7649).
 *
 * The Backups page asked Intl for a numeric hour on both clocks, and on a
 * 24-hour clock Intl drops the zero in German, French, Japanese, Russian
 * and most others: a backup taken at 04:00 read "24. Okt. 2026, 4:00", and
 * the time dropdown "02:00 UTC (4:00 Ihre Zeit)", beside the Admin
 * Dashboard's tables writing "04:00". The hour follows the clock now
 * (getHourOption): two digits on a 24-hour clock, none on a 12-hour one.
 *
 * Each language is read on both clocks and on its own - US English, Korean
 * and Arabic read a 12-hour clock, German, French and Russian a 24-hour
 * one - before noon and after it.
 */

// 05:14 and 17:14 in UTC.
const MORNING: Date = new Date("2026-11-05T05:14:00.000Z");
const AFTERNOON: Date = new Date("2026-11-05T17:14:00.000Z");

const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;
const DIGIT: RegExp = /\p{Nd}/gu;
const ANY_SPACE: RegExp = /\s/g;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

// Persian's and Arabic's digits as Latin ones, so one pattern reads them all.
function inLatinDigits(text: string): string {
  return text.replace(DIGIT, (digit: string): string => {
    const code: number = digit.codePointAt(0) || 0;

    if (code >= 0x06f0 && code <= 0x06f9) {
      return String(code - 0x06f0);
    }

    if (code >= 0x0660 && code <= 0x0669) {
      return String(code - 0x0660);
    }

    return digit;
  });
}

// The hours of a text's times of day, as written: ["5"] or ["05"].
function hoursOf(text: string): Array<string> {
  return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

function clock(data: Partial<FeedClock> = {}): FeedClock {
  return {
    timezone: "UTC",
    language: "en",
    use12HourClock: false,
    now: new Date("2026-11-05T12:00:00Z"),
    ...data,
  };
}

const LANGUAGES: Array<string> = [
  "en",
  "ko",
  "ar",
  "de",
  "fr",
  "ru",
  "ja",
  "es",
  "fa",
  "da",
  "zh-CN",
];

describe("a backup's date and time", () => {
  test.each(LANGUAGES)(
    "in %s: the zero on a 24-hour clock, none on a 12-hour one",
    (language: string) => {
      const morning24: string = formatBackupDateTime(
        MORNING,
        clock({ language }),
      );
      const afternoon24: string = formatBackupDateTime(
        AFTERNOON,
        clock({ language }),
      );
      const morning12: string = formatBackupDateTime(
        MORNING,
        clock({ language, use12HourClock: true }),
      );
      const afternoon12: string = formatBackupDateTime(
        AFTERNOON,
        clock({ language, use12HourClock: true }),
      );

      expect({ morning24, hours: hoursOf(morning24) }).toEqual({
        morning24,
        hours: ["05"],
      });
      expect({ afternoon24, hours: hoursOf(afternoon24) }).toEqual({
        afternoon24,
        hours: ["17"],
      });
      expect({ morning12, hours: hoursOf(morning12) }).toEqual({
        morning12,
        hours: ["5"],
      });
      expect({ afternoon12, hours: hoursOf(afternoon12) }).toEqual({
        afternoon12,
        hours: ["5"],
      });
      expect(morning12).not.toBe(afternoon12);
    },
  );

  test.each<[string, boolean, string, string]>([
    ["en", true, "Nov 5, 2026, 5:14 AM", "Nov 5, 2026, 5:14 PM"],
    ["ko", true, "2026년 11월 5일 오전 5:14", "2026년 11월 5일 오후 5:14"],
    ["ar", true, "5 نوفمبر 2026، 5:14 ص", "5 نوفمبر 2026، 5:14 م"],
    ["de", false, "5. Nov. 2026, 05:14", "5. Nov. 2026, 17:14"],
    ["fr", false, "5 nov. 2026, 05:14", "5 nov. 2026, 17:14"],
    ["ru", false, "5 нояб. 2026 г., 05:14", "5 нояб. 2026 г., 17:14"],
  ])(
    "in %s, on its own clock (12-hour: %p): %p and %p",
    (
      language: string,
      use12HourClock: boolean,
      morning: string,
      afternoon: string,
    ) => {
      expect(
        spaced(
          formatBackupDateTime(MORNING, clock({ language, use12HourClock })),
        ),
      ).toBe(morning);
      expect(
        spaced(
          formatBackupDateTime(AFTERNOON, clock({ language, use12HourClock })),
        ),
      ).toBe(afternoon);
    },
  );
});

describe("the time dropdown's own time beside a UTC hour", () => {
  // 02:00 UTC is 03:00 in Berlin in November, 11:00 in Tokyo.
  const berlin: Partial<FeedClock> = { timezone: "Europe/Berlin" };
  const tokyo: Partial<FeedClock> = { timezone: "Asia/Tokyo" };

  test.each<[string, Partial<FeedClock>, boolean, string]>([
    ["de", berlin, false, "03:00"],
    ["fr", berlin, false, "03:00"],
    ["ru", berlin, false, "03:00"],
    ["ja", berlin, false, "03:00"],
    ["fa", berlin, false, "۰۳:۰۰"],
    ["da", berlin, false, "03.00"],
    ["en", berlin, true, "3:00 AM"],
    ["ko", berlin, true, "오전 3:00"],
    ["ar", berlin, true, "3:00 ص"],
    // After noon.
    ["de", tokyo, false, "11:00"],
    ["en", tokyo, true, "11:00 AM"],
  ])(
    "in %s, %j, 12-hour %p: %p",
    (
      language: string,
      zone: Partial<FeedClock>,
      use12HourClock: boolean,
      expected: string,
    ) => {
      expect(
        spaced(
          getLocalTimeOfUtcHour({
            hour: 2,
            clock: clock({ ...zone, language, use12HourClock }),
          }),
        ),
      ).toBe(expected);
    },
  );

  test("an afternoon hour on both clocks", () => {
    // 14:00 UTC is 15:00 in Berlin.
    expect(
      spaced(
        getLocalTimeOfUtcHour({
          hour: 14,
          clock: clock({ ...berlin, language: "de" }),
        }),
      ),
    ).toBe("15:00");
    expect(
      spaced(
        getLocalTimeOfUtcHour({
          hour: 14,
          clock: clock({ ...berlin, language: "en", use12HourClock: true }),
        }),
      ),
    ).toBe("3:00 PM");
  });

  test("the option reads its two times the same way", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(
      describeUtcHourOption({
        hour: 2,
        clock: clock({ ...berlin, language: "de" }),
        translator: english,
      }),
    ).toBe("02:00 UTC (03:00 your time)");
  });
});
