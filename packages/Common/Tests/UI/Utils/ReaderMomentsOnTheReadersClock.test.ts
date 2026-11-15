/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getReaderDateLocale,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import Timezone from "../../../Types/Timezone";
import {
  writeReaderDay,
  writeReaderMoment,
  writeReaderTimeOfDay,
} from "../../../UI/Utils/ReaderMoments";
import { formatHealthDateTime } from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/HealthTime";
import MicrosoftTeamsTimezone from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTimezone";
import { formatToolImportDate } from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE TIMES THE BROWSER WROTE ON ITS OWN, WRITTEN FOR THE READER (#8231).
 *
 * The edition dialog's license expiry, its last update check and its last
 * usage report, Topology's and Network Discovery's "Last refreshed",
 * Discovery's scan start, a BI dashboard's last sync, OpenStack spend's
 * CloudKitty read, and the Admin Dashboard's migration and health log
 * times were written by Date.prototype.toLocaleString or
 * toLocaleTimeString with only a locale: in the browser's zone, not the
 * one the reader picked; on the language's own clock, not theirs; with
 * seconds. A German page in a US browser read "5.11.2026, 05:14:00" there
 * and "5. Nov. 2026, 5:14 AM" in every table. They write through
 * Common/UI/Utils/ReaderMoments now, and DatesOnTheReadersClockGuard keeps
 * the browser's writing out.
 *
 * The process runs in UTC (the docblock): the browser's zone. Each reader
 * picked another - New York, west of UTC; Kolkata, half an hour off the
 * hour; Kathmandu, 45 minutes off it - and each writer is read in every
 * Dashboard language and English, on both clocks, before noon and after
 * it, and near midnight, where the reader's day is not UTC's. The wall
 * clock and the day a text should name are the platform's own (Intl), not
 * the code under test's.
 */

// 5:14:07 in the morning and in the afternoon, UTC.
const MORNING: Date = new Date("2026-11-05T05:14:07.000Z");
const AFTERNOON: Date = new Date("2026-11-05T17:14:07.000Z");
// 22:30 the evening before in New York.
const EARLY: Date = new Date("2026-11-05T03:30:07.000Z");
// Five past midnight the next day in Kathmandu, 23:50 in Kolkata.
const LATE: Date = new Date("2026-11-05T18:20:07.000Z");

const MOMENTS: Array<Date> = [MORNING, AFTERNOON, EARLY, LATE];

const READER_ZONES: Array<Timezone> = [
  Timezone.AmericaNew_York,
  Timezone.AsiaKolkata,
  Timezone.AsiaKathmandu,
];

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

const DIGIT: RegExp = /\p{Nd}/gu;
const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/g;
const NUMBER: RegExp = /\d+/g;

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

interface TimeOfDay {
  hour: string;
  minute: string;
  second: string | undefined;
}

// The times of day a text holds, as written.
function timesOf(text: string): Array<TimeOfDay> {
  return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): TimeOfDay => {
      return { hour: match[1]!, minute: match[2]!, second: match[3] };
    },
  );
}

// The numbers a text holds that are not part of a time of day: its date's.
function dateNumbersOf(text: string): Array<number> {
  return (
    inLatinDigits(text).replace(TIME_OF_DAY, " ").match(NUMBER) || []
  ).map(Number);
}

interface WallClock {
  day: number;
  hour24: number;
  minute: number;
  second: number;
}

// The wall clock of `date` in `timezone`, as the platform reads it.
function wallClock(date: Date, timezone: string): WallClock {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date);
  const part: (type: string) => number = (type: string): number => {
    return Number(
      parts.find((item: Intl.DateTimeFormatPart): boolean => {
        return item.type === type;
      })!.value,
    );
  };

  return {
    day: part("day"),
    hour24: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

// The hour a clock writes: two digits on a 24-hour one, 1 to 12 on a 12-hour one.
function hourOnTheClock(clock: WallClock, use12HourClock: boolean): string {
  if (!use12HourClock) {
    return String(clock.hour24).padStart(2, "0");
  }

  return String(clock.hour24 % 12 === 0 ? 12 : clock.hour24 % 12);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

let prefers12Hour: SpyInstance<() => boolean>;

function readAs(data: {
  language: string;
  zone: Timezone;
  use12HourClock: boolean;
}): void {
  setDateDisplayLanguage(data.language);
  OneUptimeDate.setUserTimezone(data.zone);
  prefers12Hour.mockReturnValue(data.use12HourClock);
  forgetRememberedDateTexts();
}

beforeEach(() => {
  prefers12Hour = jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat");
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
  jest.restoreAllMocks();
});

const CASES: Array<[string, Timezone]> = LANGUAGES.flatMap(
  (language: string): Array<[string, Timezone]> => {
    return READER_ZONES.map((zone: Timezone): [string, Timezone] => {
      return [language, zone];
    });
  },
);

describe.each(CASES)(
  "in %s, read in %s",
  (language: string, zone: Timezone) => {
    test("a moment: the reader's wall clock and day, their clock's hour, the year, no seconds", () => {
      for (const use12HourClock of [true, false]) {
        readAs({ language, zone, use12HourClock });

        for (const date of MOMENTS) {
          const text: string = writeReaderMoment(date);
          const clock: WallClock = wallClock(date, zone);
          const times: Array<TimeOfDay> = timesOf(text);

          expect(times).toHaveLength(1);
          expect(times[0]!.hour).toBe(hourOnTheClock(clock, use12HourClock));
          expect(times[0]!.minute).toBe(twoDigits(clock.minute));
          expect(times[0]!.second).toBeUndefined();
          // The reader's day, and the year: a sentence has no "this year".
          expect(dateNumbersOf(text)).toContain(clock.day);
          expect(dateNumbersOf(text)).toContain(2026);
          // As a table writes the same moment for the same reader.
          expect(text).toBe(
            OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
              showYear: true,
            }),
          );
        }
      }
    });

    test("a moment to the second: the reader's wall clock with its seconds", () => {
      for (const use12HourClock of [true, false]) {
        readAs({ language, zone, use12HourClock });

        for (const date of MOMENTS) {
          const clock: WallClock = wallClock(date, zone);
          const times: Array<TimeOfDay> = timesOf(
            writeReaderMoment(date, { includeSeconds: true }),
          );

          expect(times).toHaveLength(1);
          expect(times[0]!.hour).toBe(hourOnTheClock(clock, use12HourClock));
          expect(times[0]!.second).toBe(twoDigits(clock.second));
        }
      }
    });

    test("a time of day: the reader's wall clock to the second, the same time a table writes", () => {
      for (const use12HourClock of [true, false]) {
        readAs({ language, zone, use12HourClock });

        for (const date of MOMENTS) {
          const clock: WallClock = wallClock(date, zone);
          const text: string = writeReaderTimeOfDay(date);
          const times: Array<TimeOfDay> = timesOf(text);

          expect(times).toEqual([
            {
              hour: hourOnTheClock(clock, use12HourClock),
              minute: twoDigits(clock.minute),
              second: twoDigits(clock.second),
            },
          ]);
          // No date: it is today's time, read while the page refreshes.
          expect(dateNumbersOf(text)).toEqual([]);
          expect(times).toEqual(
            timesOf(
              OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
                includeSeconds: true,
              }),
            ),
          );
        }
      }
    });

    test("a day: the reader's, which near midnight is not UTC's", () => {
      readAs({ language, zone, use12HourClock: true });

      for (const date of MOMENTS) {
        const clock: WallClock = wallClock(date, zone);
        const numbers: Array<number> = dateNumbersOf(writeReaderDay(date));

        expect(timesOf(writeReaderDay(date))).toEqual([]);
        expect(numbers).toContain(clock.day);
        expect(numbers).toContain(2026);

        if (clock.day !== date.getUTCDate()) {
          expect(numbers).not.toContain(date.getUTCDate());
        }
      }
    });

    test("the browser's own writing, as these were written, named another time or another day for this reader", () => {
      readAs({ language, zone, use12HourClock: true });

      // Kolkata and Kathmandu read the morning 5h30 and 5h45 on; New York the evening 5h back.
      const date: Date = zone === Timezone.AmericaNew_York ? EARLY : MORNING;
      const browser: string = date.toLocaleTimeString(getReaderDateLocale());
      const reader: string = writeReaderTimeOfDay(date);

      expect(
        timesOf(browser)[0]!.minute === timesOf(reader)[0]!.minute &&
          timesOf(browser)[0]!.hour === timesOf(reader)[0]!.hour,
      ).toBe(false);
    });
  },
);

describe("word for word", () => {
  test.each<[string, Timezone, boolean, Date, string, string, string]>([
    [
      "en",
      Timezone.AmericaNew_York,
      true,
      MORNING,
      "Nov 5, 2026, 12:14 AM",
      "12:14:07 AM",
      "Nov 5, 2026",
    ],
    [
      "en",
      Timezone.AmericaNew_York,
      false,
      EARLY,
      "Nov 4, 2026, 22:30",
      "22:30:07",
      "Nov 4, 2026",
    ],
    [
      "de",
      Timezone.AmericaNew_York,
      false,
      MORNING,
      "5. Nov. 2026, 00:14",
      "00:14:07",
      "5. Nov. 2026",
    ],
    [
      "de",
      Timezone.AsiaKathmandu,
      true,
      LATE,
      "6. Nov. 2026, 12:05 AM",
      "12:05:07 AM",
      "6. Nov. 2026",
    ],
    [
      "ko",
      Timezone.AsiaKolkata,
      true,
      AFTERNOON,
      "2026년 11월 5일 오후 10:44",
      "오후 10:44:07",
      "2026년 11월 5일",
    ],
    [
      "ko",
      Timezone.AsiaKathmandu,
      false,
      LATE,
      "2026년 11월 6일 00:05",
      "00:05:07",
      "2026년 11월 6일",
    ],
    [
      "ar",
      Timezone.AsiaKolkata,
      true,
      MORNING,
      "5 نوفمبر 2026، 10:44 ص",
      "10:44:07 ص",
      "5 نوفمبر 2026",
    ],
    [
      "fa",
      Timezone.AsiaKathmandu,
      false,
      AFTERNOON,
      "۵ نوامبر ۲۰۲۶، ۲۲:۵۹",
      "۲۲:۵۹:۰۷",
      "۵ نوامبر ۲۰۲۶",
    ],
    [
      "ja",
      Timezone.AmericaNew_York,
      true,
      AFTERNOON,
      "2026年11月5日 午後12:14",
      "午後12:14:07",
      "2026年11月5日",
    ],
  ])(
    "%s in %s, 12-hour %s, %s: %s, %s, %s",
    (
      language: string,
      zone: Timezone,
      use12HourClock: boolean,
      date: Date,
      moment: string,
      timeOfDay: string,
      day: string,
    ) => {
      readAs({ language, zone, use12HourClock });

      expect(writeReaderMoment(date)).toBe(moment);
      expect(writeReaderTimeOfDay(date)).toBe(timeOfDay);
      expect(writeReaderDay(date)).toBe(day);
    },
  );
});

describe("the Admin Dashboard's health times (HealthTime)", () => {
  test("a migration's or a log's time is the reader's moment, to the second", () => {
    readAs({
      language: "de",
      zone: Timezone.AmericaNew_York,
      use12HourClock: false,
    });

    expect(formatHealthDateTime(MORNING.toISOString())).toBe(
      "5. Nov. 2026, 00:14:07",
    );

    readAs({
      language: "en",
      zone: Timezone.AsiaKathmandu,
      use12HourClock: true,
    });

    expect(formatHealthDateTime(LATE.toISOString())).toBe(
      "Nov 6, 2026, 12:05:07 AM",
    );
  });

  test("nothing reads as a dash, and what is no date as it came", () => {
    expect(formatHealthDateTime(undefined)).toBe("—");
    expect(formatHealthDateTime(null)).toBe("—");
    expect(formatHealthDateTime("")).toBe("—");
    expect(formatHealthDateTime("not a date")).toBe("not a date");
  });
});

describe("a Microsoft Teams record's details (MicrosoftTeamsTimezone.formatForActivity)", () => {
  /*
   * "Created At" in the bot's reply was the server's toLocaleString: UTC in
   * the containers, and not named. It is written in the zone of whoever
   * asked, and names it.
   */
  test.each<[string, unknown, string]>([
    [
      "the asker's zone, from the activity",
      { localTimezone: "America/New_York" },
      "Nov 5, 2026, 00:14 (America/New_York)",
    ],
    [
      "the asker's zone, from the client's entity",
      {
        entities: [{ type: "clientInfo", timezone: "Asia/Kathmandu" }],
      },
      "Nov 5, 2026, 10:59 (Asia/Kathmandu)",
    ],
    [
      "only the offset of the asker's local timestamp",
      { rawLocalTimestamp: "2026-11-05T10:44:07.000+05:30" },
      "Nov 5, 2026, 10:44 (UTC+05:30)",
    ],
    ["nothing about the asker: UTC, named", {}, "Nov 5, 2026, 05:14 (UTC)"],
    ["no activity at all: UTC, named", undefined, "Nov 5, 2026, 05:14 (UTC)"],
  ])("%s", (_name: string, activity: unknown, expected: string) => {
    expect(MicrosoftTeamsTimezone.formatForActivity(MORNING, activity)).toBe(
      expected,
    );
    expect(
      MicrosoftTeamsTimezone.formatForActivity(MORNING.toISOString(), activity),
    ).toBe(expected);
  });
});

describe("a tool import's dates (formatToolImportDate)", () => {
  /*
   * When a layer of a PagerDuty or incident.io schedule starts or ends: an
   * instant, written by the browser in its own zone, with options but no
   * timeZone. It is the reader's day now, in the sentence's language.
   */
  test.each<[string, Timezone, string]>([
    ["en", Timezone.AmericaNew_York, "Dec 30, 2026"],
    ["en", Timezone.AsiaTokyo, "Dec 31, 2026"],
    ["de", Timezone.AmericaNew_York, "30. Dez. 2026"],
    ["ko", Timezone.AsiaKathmandu, "2026년 12월 31일"],
  ])(
    "in %s, read in %s: %s",
    (language: string, zone: Timezone, expected: string) => {
      readAs({ language: "en", zone, use12HourClock: true });

      expect(formatToolImportDate("2026-12-31T02:00:00.000Z", language)).toBe(
        expected,
      );
    },
  );

  test("what is no date is shown as it came", () => {
    expect(formatToolImportDate("soon", "en")).toBe("soon");
  });
});
