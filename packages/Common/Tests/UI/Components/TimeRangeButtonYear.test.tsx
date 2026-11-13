/** @timezone UTC */
/**
 * A CUSTOM RANGE ON THE TIME RANGE BUTTON SAYS ITS YEARS WHEN IT IS NOT ALL
 * IN THIS YEAR (issue #7124).
 *
 * Every explorer - Logs, Traces, Metrics, Product Analytics, RUM, the
 * resource overviews - shares one time range button, and it wrote a custom
 * range's two ends without their year. A range of exactly a year, from 12
 * Nov last year to 12 Nov this year, read "Nov 12, 9:49 AM – Nov 12, 9:49
 * AM", as if it were no time at all; a range across New Year, or in an
 * earlier year, did not say which year it was.
 *
 * Now both ends carry their year whenever the range is not all in this year,
 * read on the reader's calendar (the timezone they configured); a range in
 * this year keeps the short label it always had. The process runs in UTC
 * (the docblock above), and "now" is pinned in every test that depends on it.
 */
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import {
  forgetRememberedDateTexts,
  getHourOption,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import Timezone from "../../../Types/Timezone";
import TimeRangePickerDropdown, {
  getTimeRangeButtonLabel,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// The moment these are read at: 12 Nov 2026, 10:00 UTC.
const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const PREFIX: string = "year-range-picker";

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;
const LATIN_DIGIT: RegExp = /[0-9]/;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

function custom(start: string, end: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(start), new Date(end)),
  };
}

// The issue's range: exactly a year, from 12 Nov last year to 12 Nov this year.
const A_YEAR: RangeStartAndEndDateTime = custom(
  "2025-11-12T09:49:00.000Z",
  "2026-11-12T09:49:00.000Z",
);

const ACROSS_NEW_YEAR: RangeStartAndEndDateTime = custom(
  "2025-12-20T09:00:00.000Z",
  "2026-01-05T17:00:00.000Z",
);

const LAST_YEAR: RangeStartAndEndDateTime = custom(
  "2025-03-01T10:00:00.000Z",
  "2025-03-02T13:30:00.000Z",
);

const THIS_YEAR: RangeStartAndEndDateTime = custom(
  "2026-03-01T10:00:00.000Z",
  "2026-03-02T13:30:00.000Z",
);

function pin(use12HourFormat: boolean): void {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(use12HourFormat);
}

function pinNow(now: Date): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
}

function label(value: RangeStartAndEndDateTime, now: Date = NOW): string {
  return spaced(getTimeRangeButtonLabel(value, now));
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("a custom range's label on a 12-hour machine", () => {
  test("within this year: the short label, as before", () => {
    pin(true);

    expect(label(THIS_YEAR)).toBe("Mar 1, 10:00 AM – Mar 2, 1:30 PM");
  });

  test("exactly a year: both ends say their year, so it no longer reads as no time at all", () => {
    pin(true);

    expect(label(A_YEAR)).toBe("Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM");
  });

  test("across New Year: both ends say their year", () => {
    pin(true);

    expect(label(ACROSS_NEW_YEAR)).toBe(
      "Dec 20, 2025, 9:00 AM – Jan 5, 2026, 5:00 PM",
    );
  });

  test("in last year: both ends say it, though they share it", () => {
    pin(true);

    expect(label(LAST_YEAR)).toBe(
      "Mar 1, 2025, 10:00 AM – Mar 2, 2025, 1:30 PM",
    );
  });

  test("in a year still to come: both ends say it too", () => {
    pin(true);

    expect(
      label(custom("2027-01-02T08:00:00.000Z", "2027-01-03T08:00:00.000Z")),
    ).toBe("Jan 2, 2027, 8:00 AM – Jan 3, 2027, 8:00 AM");
  });

  test("from this year into the next: both ends say their year", () => {
    pin(true);

    expect(
      label(custom("2026-12-31T20:00:00.000Z", "2027-01-01T04:00:00.000Z")),
    ).toBe("Dec 31, 2026, 8:00 PM – Jan 1, 2027, 4:00 AM");
  });
});

describe("a custom range's label on a 24-hour machine", () => {
  test("within this year: the short label, as before", () => {
    pin(false);

    expect(label(THIS_YEAR)).toBe("Mar 1, 10:00 – Mar 2, 13:30");
  });

  test("exactly a year: both ends say their year", () => {
    pin(false);

    expect(label(A_YEAR)).toBe("Nov 12, 2025, 09:49 – Nov 12, 2026, 09:49");
  });

  test("across New Year: both ends say their year", () => {
    pin(false);

    expect(label(ACROSS_NEW_YEAR)).toBe(
      "Dec 20, 2025, 09:00 – Jan 5, 2026, 17:00",
    );
  });

  test("in last year: both ends say it", () => {
    pin(false);

    expect(label(LAST_YEAR)).toBe("Mar 1, 2025, 10:00 – Mar 2, 2025, 13:30");
  });
});

describe("the year is the reader's", () => {
  // The first hours of 2026 in Auckland are the last of 2025 in UTC.
  const AUCKLAND_NEW_YEAR: RangeStartAndEndDateTime = custom(
    "2025-12-31T11:30:00.000Z",
    "2025-12-31T13:00:00.000Z",
  );

  test("read in Auckland, the first hours of 2026 there are this year's: no year", () => {
    pin(false);
    OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

    expect(label(AUCKLAND_NEW_YEAR, new Date("2026-06-01T00:00:00.000Z"))).toBe(
      "Jan 1, 00:30 – Jan 1, 02:00",
    );
  });

  test("read in UTC, the same instants are last year's: both ends say 2025", () => {
    pin(false);
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(label(AUCKLAND_NEW_YEAR, new Date("2026-06-01T00:00:00.000Z"))).toBe(
      "Dec 31, 2025, 11:30 – Dec 31, 2025, 13:00",
    );
  });

  test("now is read there too: at 01:00 on New Year's Day in Auckland, the new year's first hour is this year's", () => {
    pin(false);
    OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

    // 12:00 UTC on 31 Dec 2025 is 01:00 on 1 Jan 2026 in Auckland.
    const newYearInAuckland: Date = new Date("2025-12-31T12:00:00.000Z");

    expect(
      label(
        custom("2025-12-31T11:00:00.000Z", "2025-12-31T11:45:00.000Z"),
        newYearInAuckland,
      ),
    ).toBe("Jan 1, 00:00 – Jan 1, 00:45");
  });

  test("and in UTC, where it is still 2025, the same range is this year's too", () => {
    pin(false);
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    expect(
      label(
        custom("2025-12-31T11:00:00.000Z", "2025-12-31T11:45:00.000Z"),
        new Date("2025-12-31T12:00:00.000Z"),
      ),
    ).toBe("Dec 31, 11:00 – Dec 31, 11:45");
  });
});

describe("a custom range's label in the reader's language", () => {
  test("German, on a 24-hour clock: the year where German writes it", () => {
    pin(false);
    setDateDisplayLanguage("de");

    expect(label(A_YEAR)).toBe("12. Nov. 2025, 09:49 – 12. Nov. 2026, 09:49");
  });

  test("German, within this year: no year, as before", () => {
    pin(false);
    setDateDisplayLanguage("de");

    expect(label(THIS_YEAR)).toBe("1. März, 10:00 – 2. März, 13:30");
  });

  test("Japanese: the year first, as Japanese writes a date", () => {
    pin(false);
    setDateDisplayLanguage("ja");

    expect(label(ACROSS_NEW_YEAR)).toBe(
      "2025年12月20日 09:00 – 2026年1月5日 17:00",
    );
  });

  test("Persian: both years in Persian digits, and no Latin digit left", () => {
    pin(false);
    setDateDisplayLanguage("fa");

    const persian: string = label(A_YEAR);

    expect(persian).toContain("۲۰۲۵");
    expect(persian).toContain("۲۰۲۶");
    expect(persian).not.toMatch(LATIN_DIGIT);
  });

  test("Persian, within this year: no year", () => {
    pin(false);
    setDateDisplayLanguage("fa");

    const persian: string = label(THIS_YEAR);

    expect(persian).not.toContain("۲۰۲۶");
    expect(persian).not.toMatch(LATIN_DIGIT);
  });
});

describe("this year is the one the clock is in, unless the caller says", () => {
  test("left out, now is the clock's: a range in last year says its years", () => {
    pin(true);
    pinNow(NOW);

    expect(spaced(getTimeRangeButtonLabel(LAST_YEAR))).toBe(
      "Mar 1, 2025, 10:00 AM – Mar 2, 2025, 1:30 PM",
    );
  });

  test("left out, and the clock in 2025: the same range is this year's", () => {
    pin(true);
    pinNow(new Date("2025-06-01T00:00:00.000Z"));

    expect(spaced(getTimeRangeButtonLabel(LAST_YEAR))).toBe(
      "Mar 1, 10:00 AM – Mar 2, 1:30 PM",
    );
  });

  test("a preset is named by its preset, whatever the year", () => {
    pinNow(NOW);

    expect(getTimeRangeButtonLabel({ range: TimeRange.PAST_ONE_DAY })).toBe(
      "Past 1 Day",
    );
    expect(
      getTimeRangeButtonLabel(
        { range: TimeRange.PAST_ONE_MONTH },
        new Date("2020-01-01T00:00:00.000Z"),
      ),
    ).toBe("Past 1 Month");
  });
});

describe("the button", () => {
  function renderButton(value: RangeStartAndEndDateTime): HTMLElement {
    render(
      <TimeRangePickerDropdown
        value={value}
        onChange={() => {
          // The label under test does not depend on the change handler.
        }}
        dataTestIdPrefix={PREFIX}
        dropdownWidthInPx={288}
      />,
    );

    return screen.getByTestId(`${PREFIX}-button`);
  }

  test("names a range of a year by both its years", () => {
    pin(true);
    pinNow(NOW);

    expect(spaced(renderButton(A_YEAR).textContent || "")).toBe(
      "Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM",
    );
  });

  test("holds the whole label, years included, as its tooltip", () => {
    pin(true);
    pinNow(NOW);

    expect(spaced(renderButton(A_YEAR).getAttribute("title") || "")).toBe(
      "Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM",
    );
  });

  test("on a phone, the longer label is cut short inside the button rather than pushing it off the screen", () => {
    /*
     * jsdom lays nothing out, so this pins the classes that do it: the
     * button and its box are no wider than their row (max-w-full, min-w-0),
     * and the label's span may shrink (min-w-0) and ends in an ellipsis
     * (truncate) where the row is narrower than the label, with the whole
     * label in the tooltip above.
     */
    pin(true);
    pinNow(NOW);

    const button: HTMLElement = renderButton(A_YEAR);
    const labelSpan: HTMLElement | null = button.querySelector("span");

    expect(button).toHaveClass("max-w-full");
    expect(button.parentElement).toHaveClass("min-w-0", "max-w-full");
    expect(labelSpan).not.toBeNull();
    expect(labelSpan).toHaveClass("min-w-0", "truncate");
    expect(spaced(labelSpan?.textContent || "")).toBe(
      "Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49 AM",
    );
  });

  test("a range within this year keeps its short label on the button", () => {
    pin(false);
    pinNow(NOW);

    expect(spaced(renderButton(THIS_YEAR).textContent || "")).toBe(
      "Mar 1, 10:00 – Mar 2, 13:30",
    );
  });
});

describe("OneUptimeDate.isWindowInTheCurrentYear", () => {
  test("both ends in this year: in it", () => {
    expect(
      OneUptimeDate.isWindowInTheCurrentYear({
        start: new Date("2026-01-01T00:00:00.000Z"),
        end: new Date("2026-12-31T23:59:59.999Z"),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("an end in another year, or both: not in it", () => {
    const windows: Array<[string, string]> = [
      // From last year's last millisecond.
      ["2025-12-31T23:59:59.999Z", "2026-06-01T00:00:00.000Z"],
      // Into next year's first millisecond.
      ["2026-06-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
      // All in last year, or all in next year.
      ["2025-03-01T00:00:00.000Z", "2025-03-02T00:00:00.000Z"],
      ["2027-03-01T00:00:00.000Z", "2027-03-02T00:00:00.000Z"],
    ];

    for (const [start, end] of windows) {
      expect(
        OneUptimeDate.isWindowInTheCurrentYear({
          start: new Date(start),
          end: new Date(end),
          now: NOW,
        }),
      ).toBe(false);
    }
  });

  test("read on the reader's calendar: New Year in Auckland is eleven hours before UTC's", () => {
    const window: { start: Date; end: Date; now: Date } = {
      start: new Date("2025-12-31T11:00:00.000Z"),
      end: new Date("2025-12-31T12:00:00.000Z"),
      now: new Date("2026-06-01T00:00:00.000Z"),
    };

    OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);
    expect(OneUptimeDate.isWindowInTheCurrentYear(window)).toBe(true);

    OneUptimeDate.setUserTimezone(Timezone.UTC);
    expect(OneUptimeDate.isWindowInTheCurrentYear(window)).toBe(false);
  });

  test("now is the clock's, unless the caller says", () => {
    const window: { start: Date; end: Date } = {
      start: new Date("2025-03-01T00:00:00.000Z"),
      end: new Date("2025-03-02T00:00:00.000Z"),
    };

    pinNow(new Date("2025-06-01T00:00:00.000Z"));
    expect(OneUptimeDate.isWindowInTheCurrentYear(window)).toBe(true);

    pinNow(NOW);
    expect(OneUptimeDate.isWindowInTheCurrentYear(window)).toBe(false);
  });
});

describe("OneUptimeDate.getDateAsLocalShortDateTimeString with its year", () => {
  const INSTANT: Date = new Date("2025-11-12T09:49:05.000Z");

  test("in English, on either clock, seconds or not", () => {
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          showYear: true,
          use12HourFormat: true,
        }),
      ),
    ).toBe("Nov 12, 2025, 9:49 AM");
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          showYear: true,
          use12HourFormat: false,
        }),
      ),
    ).toBe("Nov 12, 2025, 09:49");
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          showYear: true,
          use12HourFormat: false,
          includeSeconds: true,
        }),
      ),
    ).toBe("Nov 12, 2025, 09:49:05");
  });

  test("without it, as it always was", () => {
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          use12HourFormat: true,
        }),
      ),
    ).toBe("Nov 12, 9:49 AM");
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          showYear: false,
          use12HourFormat: false,
        }),
      ),
    ).toBe("Nov 12, 09:49");
  });

  test("its year is the configured zone's: 23:30 UTC on New Year's Eve is 2026 in Auckland", () => {
    OneUptimeDate.setUserTimezone(Timezone.PacificAuckland);

    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          new Date("2025-12-31T23:30:00.000Z"),
          { showYear: true, use12HourFormat: false },
        ),
      ),
    ).toBe("Jan 1, 2026, 12:30");
  });

  test.each([
    ["de", "12. Nov. 2025, 09:49"],
    ["fr", "12 nov. 2025, 09:49"],
    ["ja", "2025年11月12日 09:49"],
  ])("%s: %s", (language: string, expected: string) => {
    setDateDisplayLanguage(language);

    expect(
      spaced(
        OneUptimeDate.getDateAsLocalShortDateTimeString(INSTANT, {
          showYear: true,
          use12HourFormat: false,
        }),
      ),
    ).toBe(expected);
  });
});

/*
 * A 12-HOUR TIME HAS NO LEADING ZERO IN ANY LANGUAGE (issue #7279).
 *
 * English wrote "5:14 AM" on a 12-hour clock, but every other language kept
 * the zero a 24-hour time has: "오전 05:14", "上午05:14", "05:14 am", "05:14
 * ص". None of them writes a 12-hour time that way. The hour of a 12-hour
 * time has no zero now, in every language, and a 24-hour time keeps its
 * zero ("05:14"), as it always did.
 */
describe("a 12-hour time in the reader's language has no leading zero", () => {
  // The issue's window: 5:14 to 6:14 in the morning, last year.
  const MORNING: RangeStartAndEndDateTime = custom(
    "2025-11-05T05:14:00.000Z",
    "2025-11-05T06:14:00.000Z",
  );

  // Each time of day a label holds: its hour and its minutes, as written.
  const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;
  const DIGIT: RegExp = /\p{Nd}/gu;

  // Persian's digits as Latin ones, so one pattern reads every language.
  function inLatinDigits(text: string): string {
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
  }

  // The hours of the label's times of day, as written: ["5", "6"].
  function hoursOf(text: string): Array<string> {
    return Array.from(inLatinDigits(text).matchAll(TIME_OF_DAY)).map(
      (match: RegExpMatchArray): string => {
        return match[1] || "";
      },
    );
  }

  test.each<[string, string]>([
    ["ko", "2025년 11월 5일 오전 5:14 – 2025년 11월 5일 오전 6:14"],
    ["zh-TW", "2025年11月5日 上午5:14 – 2025年11月5日 上午6:14"],
    ["hi", "5 नव॰ 2025, 5:14 am – 5 नव॰ 2025, 6:14 am"],
    ["ar", "5 نوفمبر 2025، 5:14 ص – 5 نوفمبر 2025، 6:14 ص"],
    ["ja", "2025年11月5日 午前5:14 – 2025年11月5日 午前6:14"],
    ["zh-CN", "2025年11月5日 上午5:14 – 2025年11月5日 上午6:14"],
    ["de", "5. Nov. 2025, 5:14 AM – 5. Nov. 2025, 6:14 AM"],
    ["fa", "۵ نوامبر ۲۰۲۵، ۵:۱۴ ق.ظ. – ۵ نوامبر ۲۰۲۵، ۶:۱۴ ق.ظ."],
  ])("%s on a 12-hour clock: %s", (language: string, expected: string) => {
    pin(true);
    setDateDisplayLanguage(language);

    expect(label(MORNING)).toBe(expected);
  });

  test.each<[string, string]>([
    ["ko", "2025년 11월 5일 05:14 – 2025년 11월 5일 06:14"],
    ["zh-TW", "2025年11月5日 05:14 – 2025年11月5日 06:14"],
    ["hi", "5 नव॰ 2025, 05:14 – 5 नव॰ 2025, 06:14"],
    ["ar", "5 نوفمبر 2025، 05:14 – 5 نوفمبر 2025، 06:14"],
    ["de", "5. Nov. 2025, 05:14 – 5. Nov. 2025, 06:14"],
    ["fa", "۵ نوامبر ۲۰۲۵، ۰۵:۱۴ – ۵ نوامبر ۲۰۲۵، ۰۶:۱۴"],
  ])(
    "%s on a 24-hour clock keeps the zero: %s",
    (language: string, expected: string) => {
      pin(false);
      setDateDisplayLanguage(language);

      expect(label(MORNING)).toBe(expected);
    },
  );

  test("English is as it was: 5:14 AM, and 05:14 on a 24-hour clock", () => {
    pin(true);
    expect(label(MORNING)).toBe("Nov 5, 2025, 5:14 AM – Nov 5, 2025, 6:14 AM");

    pin(false);
    expect(label(MORNING)).toBe("Nov 5, 2025, 05:14 – Nov 5, 2025, 06:14");
  });

  test("an hour of two digits is written whole on either clock: 10:05 AM, 10:05", () => {
    const LATE_MORNING: RangeStartAndEndDateTime = custom(
      "2025-11-05T10:05:00.000Z",
      "2025-11-05T11:30:00.000Z",
    );

    pin(true);
    setDateDisplayLanguage("ko");
    expect(label(LATE_MORNING)).toBe(
      "2025년 11월 5일 오전 10:05 – 2025년 11월 5일 오전 11:30",
    );

    pin(false);
    expect(label(LATE_MORNING)).toBe(
      "2025년 11월 5일 10:05 – 2025년 11월 5일 11:30",
    );
  });

  test("the reader's own helper says so: numeric on a 12-hour clock, two digits on a 24-hour one", () => {
    expect(getHourOption(true)).toBe("numeric");
    expect(getHourOption(false)).toBe("2-digit");
    expect(getHourOption(undefined)).toBe("2-digit");
  });

  describe.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )("in %s", (language: string) => {
    test("on a 12-hour clock, neither end's hour has a zero", () => {
      pin(true);
      setDateDisplayLanguage(language);

      expect(hoursOf(label(MORNING))).toEqual(["5", "6"]);
    });

    test("on a 24-hour clock, both ends' hours keep theirs", () => {
      pin(false);
      setDateDisplayLanguage(language);

      expect(hoursOf(label(MORNING))).toEqual(["05", "06"]);
    });
  });

  test("every Dashboard language is read here, and the reader of hours finds two times in each", () => {
    // A negative control: the pattern reads a zero where there is one.
    expect(hoursOf("오전 05:14 – 오전 06:14")).toEqual(["05", "06"]);
    expect(hoursOf("۰۵:۱۴ – ۰۶:۱۴")).toEqual(["05", "06"]);
    expect(hoursOf("5. nov. 2025, 05.14")).toEqual(["05"]);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
    expect(DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["ko", "zh-TW", "hi", "ar", "fa", "da"]),
    );
  });

  test("the windows under 'Around the start' read the same in the list", () => {
    pin(true);
    pinNow(NOW);
    setDateDisplayLanguage("ko");

    render(
      <TimeRangePickerDropdown
        value={MORNING}
        onChange={() => {
          // The list under test does not depend on the change handler.
        }}
        dataTestIdPrefix={PREFIX}
        dropdownWidthInPx={288}
        moments={{
          heading: "Around this incident",
          presetsHeading: "Relative to now",
          options: [
            {
              id: "start",
              label: "Around the start",
              detail: getTimeRangeButtonLabel(MORNING, NOW),
            },
          ],
          selectedId: null,
          onSelect: () => {
            // Picking is not under test.
          },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId(`${PREFIX}-button`));

    const moment: HTMLElement = screen.getByTestId(`${PREFIX}-moment-start`);

    expect(spaced(moment.textContent || "")).toBe(
      "Around the start2025년 11월 5일 오전 5:14 – 2025년 11월 5일 오전 6:14",
    );
    expect(moment.textContent).not.toContain("05:14");
  });
});
