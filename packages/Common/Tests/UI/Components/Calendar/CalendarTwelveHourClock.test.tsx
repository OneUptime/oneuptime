/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import { DateRange, Formats } from "react-big-calendar";
import { getCalendarFormats } from "../../../../UI/Components/Calendar/Calendar";
import { getNumberLocale } from "../../../../Types/DateLanguage";
import { DASHBOARD_LANGUAGES } from "../../../Helpers/TranslatedLanguages";

/*
 * A CALENDAR'S HOURS ON THE LANGUAGE'S OWN CLOCK, WITHOUT A 12-HOUR ZERO.
 *
 * The on-call and maintenance calendars write the hours down the side of a
 * week's grid, an event's times and the agenda's times in the reader's
 * language, on that language's own clock. They asked Intl for a two-digit
 * hour, which a German or Japanese grid wants ("08:00") but which wrote a
 * Korean, Traditional Chinese, Hindi or Arabic grid "오전 08:00", "上午08:00",
 * "08:00 am", "08:00 ص" - no reader of those languages writes a 12-hour time
 * with its zero (issue #7279).
 */

const MORNING: Date = new Date(2026, 9, 15, 8, 0);
const LATE_MORNING: Date = new Date(2026, 9, 15, 9, 30);

// The languages whose own clock is a 12-hour one, in Intl.
const TWELVE_HOUR_LANGUAGES: ReadonlyArray<string> = [
  "ar",
  "hi",
  "ko",
  "zh-TW",
];

const ANY_SPACE: RegExp = /\s/g;
const TIME_OF_DAY: RegExp = /(\p{Nd}{1,2})[:.]\p{Nd}{2}/gu;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

function format(formats: Formats, name: keyof Formats, date: Date): string {
  return spaced((formats[name] as (date: Date) => string)(date));
}

function formatRange(
  formats: Formats,
  name: keyof Formats,
  range: DateRange,
): string {
  return spaced((formats[name] as (range: DateRange) => string)(range));
}

// The hours of the text's times, as written: ["8"], ["08"], ["۰۸"].
function hoursOf(text: string): Array<string> {
  return Array.from(text.matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

// How many digits a written hour has.
function length(text: string): number {
  return Array.from(text).length;
}

describe("a calendar's hours in the reader's language", () => {
  test.each<[string, string, string]>([
    ["ko", "오전 8:00", "오전 8:00 – 오전 9:30"],
    ["zh-TW", "上午8:00", "上午8:00 – 上午9:30"],
    ["hi", "8:00 am", "8:00 am – 9:30 am"],
    ["ar", "8:00 ص", "8:00 ص – 9:30 ص"],
  ])(
    "%s, on a 12-hour clock: %s, never with a zero",
    (language: string, hour: string, range: string) => {
      const formats: Formats = getCalendarFormats(language);

      expect(format(formats, "timeGutterFormat", MORNING)).toBe(hour);
      expect(format(formats, "agendaTimeFormat", MORNING)).toBe(hour);
      expect(
        formatRange(formats, "eventTimeRangeFormat", {
          start: MORNING,
          end: LATE_MORNING,
        }),
      ).toBe(range);
      expect(
        formatRange(formats, "agendaTimeRangeFormat", {
          start: MORNING,
          end: LATE_MORNING,
        }),
      ).toBe(range);
      expect(
        formatRange(formats, "eventTimeRangeEndFormat", {
          start: MORNING,
          end: LATE_MORNING,
        }),
      ).toBe(` – ${range.split(" – ")[1]}`);
    },
  );

  test.each<[string, string, string]>([
    ["de", "08:00", "08:00 – 09:30"],
    ["ja", "08:00", "08:00 – 09:30"],
    ["fr", "08:00", "08:00 – 09:30"],
    ["zh-CN", "08:00", "08:00 – 09:30"],
    ["da", "08.00", "08.00 – 09.30"],
    ["fa", "۰۸:۰۰", "۰۸:۰۰ – ۰۹:۳۰"],
  ])(
    "%s, on a 24-hour clock, keeps the zero: %s",
    (language: string, hour: string, range: string) => {
      const formats: Formats = getCalendarFormats(language);

      expect(format(formats, "timeGutterFormat", MORNING)).toBe(hour);
      expect(
        formatRange(formats, "eventTimeRangeFormat", {
          start: MORNING,
          end: LATE_MORNING,
        }),
      ).toBe(range);
    },
  );

  test("an hour of two digits is written whole, on either clock", () => {
    const evening: Date = new Date(2026, 9, 15, 22, 5);

    expect(format(getCalendarFormats("ko"), "timeGutterFormat", evening)).toBe(
      "오후 10:05",
    );
    expect(format(getCalendarFormats("de"), "timeGutterFormat", evening)).toBe(
      "22:05",
    );
    // Midnight on a 12-hour clock is 12, not 0 or 00.
    expect(
      format(
        getCalendarFormats("ko"),
        "timeGutterFormat",
        new Date(2026, 9, 15, 0, 0),
      ),
    ).toBe("오전 12:00");
    expect(
      format(
        getCalendarFormats("de"),
        "timeGutterFormat",
        new Date(2026, 9, 15, 0, 0),
      ),
    ).toBe("00:00");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on a 12-hour clock, the zero on a 24-hour one",
    (language: string) => {
      const formats: Formats = getCalendarFormats(language);
      const gutter: string = format(formats, "timeGutterFormat", MORNING);
      const event: string = formatRange(formats, "eventTimeRangeFormat", {
        start: MORNING,
        end: LATE_MORNING,
      });
      const twelveHour: boolean = TWELVE_HOUR_LANGUAGES.includes(language);

      // One digit for 8 on a 12-hour clock, two ("08", "۰۸") on a 24-hour one.
      expect({ gutter, hours: hoursOf(gutter).map(length) }).toEqual({
        gutter,
        hours: [twelveHour ? 1 : 2],
      });
      expect({ event, hours: hoursOf(event).map(length) }).toEqual({
        event,
        hours: twelveHour ? [1, 1] : [2, 2],
      });
    },
  );

  test("the 12-hour languages are the ones whose own clock Intl keeps on 12 hours", () => {
    const twelveHour: Array<string> = DASHBOARD_LANGUAGES.filter(
      (language: string): boolean => {
        return Boolean(
          new Intl.DateTimeFormat(getNumberLocale(language), {
            hour: "numeric",
          }).resolvedOptions().hour12,
        );
      },
    );

    expect(twelveHour.sort()).toEqual([...TWELVE_HOUR_LANGUAGES].sort());
  });

  test("English keeps react-big-calendar's own hours: 8:00 AM", () => {
    // Moment's own formats, which already write no zero.
    expect(getCalendarFormats("en").timeGutterFormat).toBeUndefined();
  });
});
