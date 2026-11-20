/** @timezone UTC */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DateRange, Formats, momentLocalizer } from "react-big-calendar";
import moment from "moment-timezone";
import { getCalendarFormats } from "../../../../UI/Components/Calendar/Calendar";
import OneUptimeDate from "../../../../Types/Date";
import {
  setDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import { DASHBOARD_LANGUAGES } from "../../../Helpers/TranslatedLanguages";

/*
 * A CALENDAR'S HOURS ON THE READER'S CLOCK, WITHOUT A 12-HOUR ZERO (#7651).
 *
 * The on-call and maintenance calendars write the hours down the side of a
 * week's grid, an event's times and the agenda's times in the reader's
 * language. They followed that language's own clock, not the reader's 12-
 * or 24-hour one (OneUptimeDate.getUserPrefers12HourFormat): a German
 * reader on a 12-hour clock read "17:14" down the side beside every
 * table's "5:14 PM", and an English one on a 24-hour clock "5 PM" - English
 * kept react-big-calendar's own "LT", always 12-hour. They follow the
 * reader's clock in every language now, and a 12-hour time has no zero
 * (#7279).
 */

const MORNING: Date = new Date(2026, 9, 15, 8, 0);
const LATE_MORNING: Date = new Date(2026, 9, 15, 9, 30);

const ANY_SPACE: RegExp = /\s/g;
const TIME_OF_DAY: RegExp = /(\p{Nd}{1,2})[:.]\p{Nd}{2}/gu;

const localizer: ReturnType<typeof momentLocalizer> = momentLocalizer(moment);

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

// A format as react-big-calendar calls it: a moment pattern, or a function.
function format(formats: Formats, name: keyof Formats, date: Date): string {
  const shape: unknown = formats[name];

  if (typeof shape === "string") {
    return spaced(localizer.format(date, shape, "en"));
  }

  return spaced(
    (
      shape as (
        date: Date,
        culture?: string,
        local?: typeof localizer,
      ) => string
    )(date, "en", localizer),
  );
}

function formatRange(
  formats: Formats,
  name: keyof Formats,
  range: DateRange,
): string {
  return spaced(
    (
      formats[name] as (
        range: DateRange,
        culture?: string,
        local?: typeof localizer,
      ) => string
    )(range, "en", localizer),
  );
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

afterEach(() => {
  jest.restoreAllMocks();
  setDateDisplayLanguage("en");
});

describe("a calendar's hours on the reader's clock", () => {
  // The issue's readers: a German and a Japanese one on a 12-hour clock.
  test.each<[string, string, string]>([
    ["de", "8:00 AM", "8:00 AM – 9:30 AM"],
    ["ja", "午前8:00", "午前8:00 – 午前9:30"],
    ["ko", "오전 8:00", "오전 8:00 – 오전 9:30"],
    ["ar", "8:00 ص", "8:00 ص – 9:30 ص"],
    ["en", "8:00 AM", "8:00 AM – 9:30 AM"],
  ])(
    "%s, on a 12-hour clock: %s, never with a zero",
    (language: string, hour: string, range: string) => {
      const formats: Formats = getCalendarFormats(language, true);

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
        formatRange(formats, "selectRangeFormat", {
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

  // And an American and a Korean one on a 24-hour clock.
  test.each<[string, string, string]>([
    ["en", "08:00", "08:00 – 09:30"],
    ["en-US", "08:00", "08:00 – 09:30"],
    ["ko", "08:00", "08:00 – 09:30"],
    ["de", "08:00", "08:00 – 09:30"],
    ["ja", "08:00", "08:00 – 09:30"],
    ["da", "08.00", "08.00 – 09.30"],
    ["fa", "۰۸:۰۰", "۰۸:۰۰ – ۰۹:۳۰"],
  ])(
    "%s, on a 24-hour clock, keeps the zero: %s",
    (language: string, hour: string, range: string) => {
      const formats: Formats = getCalendarFormats(language, false);

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
    },
  );

  test("no choice is the browser's clock, read as every table's is", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    expect(
      format(getCalendarFormats("ko"), "timeGutterFormat", MORNING),
    ).toBe("08:00");
    expect(
      format(getCalendarFormats("en"), "timeGutterFormat", MORNING),
    ).toBe("08:00");

    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(
      format(getCalendarFormats("de"), "timeGutterFormat", MORNING),
    ).toBe("8:00 AM");
    expect(
      format(getCalendarFormats("en"), "timeGutterFormat", MORNING),
    ).toBe("8:00 AM");
  });

  test("an hour of two digits is written whole, on either clock", () => {
    const evening: Date = new Date(2026, 9, 15, 22, 5);
    const midnight: Date = new Date(2026, 9, 15, 0, 0);

    expect(
      format(getCalendarFormats("ko", true), "timeGutterFormat", evening),
    ).toBe("오후 10:05");
    expect(
      format(getCalendarFormats("de", false), "timeGutterFormat", evening),
    ).toBe("22:05");
    expect(
      format(getCalendarFormats("en", false), "timeGutterFormat", evening),
    ).toBe("22:05");
    // Midnight on a 12-hour clock is 12, not 0 or 00.
    expect(
      format(getCalendarFormats("ko", true), "timeGutterFormat", midnight),
    ).toBe("오전 12:00");
    expect(
      format(getCalendarFormats("en", true), "timeGutterFormat", midnight),
    ).toBe("12:00 AM");
    expect(
      format(getCalendarFormats("de", false), "timeGutterFormat", midnight),
    ).toBe("00:00");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on a 12-hour clock, the zero on a 24-hour one",
    (language: string) => {
      for (const twelveHour of [true, false]) {
        const formats: Formats = getCalendarFormats(language, twelveHour);
        const gutter: string = format(formats, "timeGutterFormat", MORNING);
        const event: string = formatRange(formats, "eventTimeRangeFormat", {
          start: MORNING,
          end: LATE_MORNING,
        });

        // One digit for 8 on a 12-hour clock, two ("08", "۰۸") on a 24-hour one.
        expect({ gutter, hours: hoursOf(gutter).map(length) }).toEqual({
          gutter,
          hours: [twelveHour ? 1 : 2],
        });
        expect({ event, hours: hoursOf(event).map(length) }).toEqual({
          event,
          hours: twelveHour ? [1, 1] : [2, 2],
        });
      }
    },
  );

  /*
   * The calendar's gutter, its events and its agenda say a time as a table
   * date on the same page does, for the same reader: the clock and the
   * marks of a table's "Oct 15, 8:00 AM".
   */
  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: the calendar's times read as a table's on the same page",
    (language: string) => {
      for (const twelveHour of [true, false]) {
        const table: string = spaced(
          withDateDisplayLanguage(language, (): string => {
            return OneUptimeDate.getLocalTimeString(MORNING, {
              use12HourFormat: twelveHour,
            });
          }),
        );
        const formats: Formats = getCalendarFormats(language, twelveHour);

        expect(format(formats, "timeGutterFormat", MORNING)).toBe(table);
        expect(format(formats, "agendaTimeFormat", MORNING)).toBe(table);
      }
    },
  );
});
