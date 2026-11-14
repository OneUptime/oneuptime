/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  getDateTimeOptions,
  getHourOption,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import { DASHBOARD_LANGUAGES } from "../Helpers/TranslatedLanguages";

/*
 * A 12-HOUR TIME HAS NO LEADING ZERO, IN ANY LANGUAGE (issue #7279).
 *
 * On a 12-hour clock English wrote "5:14 AM", but every other language kept
 * the zero of a 24-hour time: "오전 05:14", "上午05:14", "05:14 am", "05:14
 * ص". None of them writes a 12-hour time so. Every localized date asked
 * Intl for a two-digit hour on both clocks (DateLanguage's
 * getDateTimeOptions); it asks for "numeric" on a 12-hour clock now
 * (getHourOption), and keeps "2-digit" on a 24-hour one, where the zero
 * belongs ("05:14").
 *
 * The time range button, its list of windows, a table's dates and their
 * tooltips, an on-call shift, a chart's day and time and an incident's
 * Started tile all write their times through these helpers. The process
 * runs in UTC (the docblock above) and the reader's zone is UTC too.
 */

// The issue's time: 5:14 in the morning.
const MORNING: Date = new Date("2025-11-05T05:14:00.000Z");

// Each time of day a text holds: its hour and its minutes, as written.
const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;
const DIGIT: RegExp = /\p{Nd}/gu;

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

// Persian's and Arabic's digits as Latin ones, so one pattern reads them all.
const inLatinDigits: (text: string) => string = (text: string): string => {
  return text.replace(DIGIT, (digit: string): string => {
    const code: number = digit.codePointAt(0) || 0;

    // EXTENDED ARABIC-INDIC DIGIT ZERO (Persian) to NINE.
    if (code >= 0x06f0 && code <= 0x06f9) {
      return String(code - 0x06f0);
    }

    // ARABIC-INDIC DIGIT ZERO to NINE.
    if (code >= 0x0660 && code <= 0x0669) {
      return String(code - 0x0660);
    }

    return digit;
  });
};

// The hours of a text's times of day, as written: ["5"] or ["05"].
const hoursOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
};

interface Writer {
  name: string;
  write: (use12HourFormat: boolean) => string;
}

/*
 * Every OneUptimeDate helper that writes a time of day in the reader's
 * language, on the clock asked for.
 */
const WRITERS: Array<Writer> = [
  {
    // The time range button and its list (getTimeRangeButtonLabel).
    name: "getDateAsLocalShortDateTimeString",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsLocalShortDateTimeString(MORNING, {
        use12HourFormat,
      });
    },
  },
  {
    name: "getDateAsLocalShortDateTimeString with its year",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsLocalShortDateTimeString(MORNING, {
        use12HourFormat,
        showYear: true,
      });
    },
  },
  {
    // A table's date cell.
    name: "getDateAsCompactLocalString",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsCompactLocalString(MORNING, {
        use12HourFormat,
        now: new Date("2025-12-01T00:00:00.000Z"),
      });
    },
  },
  {
    // The cell's tooltip, and every whole date with its zone.
    name: "getDateAsLocalFormattedString",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(
        MORNING,
        false,
        use12HourFormat,
      );
    },
  },
  {
    name: "getDateAsLocalFormattedString with seconds",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(
        MORNING,
        false,
        use12HourFormat,
        true,
      );
    },
  },
  {
    // On-call shifts and hand-offs.
    name: "getDateAsFormattedStringInTimezone",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: MORNING,
        timezone: Timezone.UTC,
        use12HourFormat,
      });
    },
  },
  {
    name: "getDateAsFormattedStringInTimezone with its weekday",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: MORNING,
        timezone: Timezone.UTC,
        showWeekday: true,
        hideYear: true,
        hideZone: true,
        use12HourFormat,
      });
    },
  },
  {
    name: "getDateAsLocalDayMonthTimeString",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsLocalDayMonthTimeString(MORNING, {
        use12HourFormat,
      });
    },
  },
  {
    name: "getDateAsFormattedArrayInMultipleTimezones",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
        date: MORNING,
        timezones: [Timezone.UTC],
        use12HourFormat,
      }).join(" | ");
    },
  },
  {
    name: "getDateAsFormattedString",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsFormattedString(MORNING, {
        use12HourFormat,
      });
    },
  },
  {
    // An incident's Started tile writes its time from this pattern.
    name: "the custom pattern hh:mm A, or HH:mm",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: MORNING,
        format: use12HourFormat ? "hh:mm A" : "HH:mm",
        timezone: Timezone.UTC,
      });
    },
  },
  {
    name: "the custom pattern h:mm A, or HH:mm",
    write: (use12HourFormat: boolean): string => {
      return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: MORNING,
        format: use12HourFormat ? "h:mm A" : "HH:mm",
        timezone: Timezone.UTC,
      });
    },
  },
];

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("the hour Intl is asked for", () => {
  test("numeric on a 12-hour clock, two digits on a 24-hour one", () => {
    expect(getHourOption(true)).toBe("numeric");
    expect(getHourOption(false)).toBe("2-digit");
    expect(getHourOption(undefined)).toBe("2-digit");
  });

  test("a date's shape asks for it, with the clock", () => {
    expect(getDateTimeOptions({ use12HourFormat: true })).toEqual(
      expect.objectContaining({ hour: "numeric", hour12: true }),
    );
    expect(getDateTimeOptions({ use12HourFormat: false })).toEqual(
      expect.objectContaining({ hour: "2-digit", hour12: false }),
    );
    expect(getDateTimeOptions({})).toEqual(
      expect.objectContaining({ hour: "2-digit", hour12: false }),
    );
    // A date alone asks for no hour at all.
    expect(getDateTimeOptions({ onlyShowDate: true }).hour).toBeUndefined();
  });
});

describe("the issue's languages, word for word", () => {
  test.each<[string, string, string]>([
    ["ko", "2025년 11월 5일 오전 5:14", "2025년 11월 5일 05:14"],
    ["zh-TW", "2025年11月5日 上午5:14", "2025年11月5日 05:14"],
    ["hi", "5 नव॰ 2025, 5:14 am", "5 नव॰ 2025, 05:14"],
    ["ar", "5 نوفمبر 2025، 5:14 ص", "5 نوفمبر 2025، 05:14"],
  ])(
    "%s: %s on a 12-hour clock, %s on a 24-hour one",
    (language: string, twelveHour: string, twentyFourHour: string) => {
      setDateDisplayLanguage(language);

      expect(
        spaced(
          OneUptimeDate.getDateAsLocalShortDateTimeString(MORNING, {
            use12HourFormat: true,
            showYear: true,
          }),
        ),
      ).toBe(twelveHour);
      expect(
        spaced(
          OneUptimeDate.getDateAsLocalShortDateTimeString(MORNING, {
            use12HourFormat: false,
            showYear: true,
          }),
        ),
      ).toBe(twentyFourHour);
    },
  );

  test("a table date's tooltip in Korean: the day keeps its two digits, the 12-hour hour has none", () => {
    setDateDisplayLanguage("ko");

    expect(
      spaced(OneUptimeDate.getDateAsLocalFormattedString(MORNING, false, true)),
    ).toBe("2025년 11월 05일 오전 5:14 UTC");
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalFormattedString(MORNING, false, false),
      ),
    ).toBe("2025년 11월 05일 05:14 UTC");
  });

  test("an hour of two digits is written whole: 오전 10:05, 오후 12:30", () => {
    setDateDisplayLanguage("ko");

    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date("2025-11-05T10:05:00.000Z"),
          { use12HourFormat: true },
        ),
      ),
    ).toBe("11월 5일 오전 10:05");
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date("2025-11-05T12:30:00.000Z"),
          { use12HourFormat: true },
        ),
      ),
    ).toBe("11월 5일 오후 12:30");
  });
});

describe("English is as it was", () => {
  test.each<[string, string, string]>([
    ["getDateAsLocalShortDateTimeString", "Nov 5, 5:14 AM", "Nov 5, 05:14"],
    // English's own pattern for a whole date keeps its zero ("hh").
    [
      "getDateAsLocalFormattedString",
      "Nov 05 2025, 05:14 AM UTC",
      "Nov 05 2025, 05:14 UTC",
    ],
    ["the custom pattern hh:mm A, or HH:mm", "05:14 AM", "05:14"],
    ["the custom pattern h:mm A, or HH:mm", "5:14 AM", "05:14"],
  ])(
    "%s: %s and %s",
    (name: string, twelveHour: string, twentyFourHour: string) => {
      const writer: Writer | undefined = WRITERS.find((each: Writer) => {
        return each.name === name;
      });

      expect(writer).toBeDefined();
      expect(spaced(writer!.write(true))).toBe(twelveHour);
      expect(spaced(writer!.write(false))).toBe(twentyFourHour);
    },
  );
});

describe.each(
  DASHBOARD_LANGUAGES.map((code: string): [string] => {
    return [code];
  }),
)("in %s", (language: string) => {
  test.each(
    WRITERS.map((writer: Writer) => {
      return [writer.name, writer];
    }),
  )(
    "%s: no zero on a 12-hour clock, the zero on a 24-hour one",
    (_name: unknown, writer: unknown) => {
      const { write } = writer as Writer;

      setDateDisplayLanguage(language);

      const twelveHour: string = write(true);
      const twentyFourHour: string = write(false);

      expect({ twelveHour, hours: hoursOf(twelveHour) }).toEqual({
        twelveHour,
        hours: ["5"],
      });
      expect({ twentyFourHour, hours: hoursOf(twentyFourHour) }).toEqual({
        twentyFourHour,
        hours: ["05"],
      });
    },
  );
});

describe("the hours reader, on texts it must tell apart", () => {
  test.each<[string, Array<string>]>([
    ["오전 05:14", ["05"]],
    ["오전 5:14", ["5"]],
    ["۰۵:۱۴", ["05"]],
    ["۵:۱۴ ق.ظ.", ["5"]],
    ["5. nov. 2025, 05.14", ["05"]],
    ["5. nov. 2025, 5.14 AM", ["5"]],
    ["5 نوفمبر 2025، 05:14 ص", ["05"]],
    ["Nov 5, 2025", []],
  ])("%p reads %p", (text: string, hours: Array<string>) => {
    expect(hoursOf(text)).toEqual(hours);
  });

  test("every Dashboard language is read", () => {
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
    expect(DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["ko", "zh-TW", "hi", "ar", "fa", "da", "ja"]),
    );
  });
});
