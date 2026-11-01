/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";

/*
 * A date as a list's cell writes it (OneUptimeDate.getDateAsCompactLocalString,
 * Table/TableDate): "Oct 22, 7:25 AM" - a date of this year without its year
 * and without the zone - or "Oct 22, 2025", the date alone, for another year.
 *
 * "Oct 22 2026, 07:25 AM BST" took some 180px in every table's date column,
 * the widest value left in the lists that still ran past their card at a
 * laptop's width (the incidents and alerts lists, the on-call logs). The
 * whole date - year, time and zone - stays under the pointer.
 */

// Wednesday 22 October 2026, 06:25 UTC: 07:25 in London (BST).
const NOW: Date = new Date("2026-10-22T06:25:00Z");

// An instant of this year: 7 October 2026, 13:05 UTC (14:05 in London).
const THIS_YEAR: Date = new Date("2026-10-07T13:05:00Z");

// An instant of last year: 30 December 2025, 22:10 UTC (GMT in London).
const LAST_YEAR: Date = new Date("2025-12-30T22:10:00Z");

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

// Persian digits (U+06F0-U+06F9), and the Latin ones.
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const LATIN_DIGIT: RegExp = /\d/;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
});

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

describe("a date of this year", () => {
  test("is its month, its day and its time: no year, no zone", () => {
    expect(
      OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR, {
        now: NOW,
        use12HourFormat: true,
      }),
    ).toBe("Oct 7, 2:05 PM");
    expect(
      OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR, {
        now: NOW,
        use12HourFormat: false,
      }),
    ).toBe("Oct 7, 14:05");
  });

  test("is a third of the whole date's length, or less", () => {
    const compact: string = OneUptimeDate.getDateAsCompactLocalString(
      THIS_YEAR,
      { now: NOW, use12HourFormat: true },
    );
    const whole: string = OneUptimeDate.getDateAsLocalFormattedString(
      THIS_YEAR,
      false,
      true,
    );

    expect(whole).toBe("Oct 07 2026, 02:05 PM BST");
    expect(compact.length).toBeLessThan(whole.length * 0.7);
    expect(compact).not.toContain("2026");
    expect(compact).not.toContain("BST");
  });

  test("without its time: the month and the day", () => {
    expect(
      OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR, {
        now: NOW,
        onlyShowDate: true,
      }),
    ).toBe("Oct 7");
  });

  test("is read in the person's own timezone, as every local date is", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    // 13:05 UTC is 18:35 in Kolkata.
    expect(
      OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR, {
        now: NOW,
        use12HourFormat: false,
      }),
    ).toBe("Oct 7, 18:35");
  });
});

describe("a date of another year", () => {
  test("is the date alone, with its year", () => {
    expect(
      OneUptimeDate.getDateAsCompactLocalString(LAST_YEAR, {
        now: NOW,
        use12HourFormat: true,
      }),
    ).toBe("Dec 30, 2025");
    expect(
      OneUptimeDate.getDateAsCompactLocalString(LAST_YEAR, {
        now: NOW,
        onlyShowDate: true,
      }),
    ).toBe("Dec 30, 2025");
  });

  test("a date to come, in a year to come, says its year too", () => {
    expect(
      OneUptimeDate.getDateAsCompactLocalString(
        new Date("2027-03-01T09:00:00Z"),
        { now: NOW },
      ),
    ).toBe("Mar 1, 2027");
  });

  test("the year turns where the person is, not in UTC", () => {
    // 23:30 UTC on 31 December 2025 is already 2026 in Tokyo.
    const newYearsEve: Date = new Date("2025-12-31T23:30:00Z");
    const january: Date = new Date("2026-01-15T00:00:00Z");

    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);
    expect(
      OneUptimeDate.getDateAsCompactLocalString(newYearsEve, {
        now: january,
        use12HourFormat: false,
      }),
    ).toBe("Jan 1, 08:30");

    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    expect(
      OneUptimeDate.getDateAsCompactLocalString(newYearsEve, {
        now: january,
        use12HourFormat: false,
      }),
    ).toBe("Dec 31, 2025");
  });

  test("this year is now's, unless a caller says", () => {
    const realNow: number = new Date().getFullYear();
    const thisYearDate: Date = new Date(Date.UTC(realNow, 5, 1, 12, 0, 0));

    expect(
      OneUptimeDate.getDateAsCompactLocalString(thisYearDate, {
        use12HourFormat: false,
      }),
    ).toBe("Jun 1, 13:00");
  });
});

describe("in the reader's language", () => {
  test("German writes the day first and its own month, without year or zone", () => {
    setDateDisplayLanguage("de");

    const text: string = spaced(
      OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR, {
        now: NOW,
        use12HourFormat: false,
      }),
    );

    expect(text).toContain("7.");
    expect(text).toContain("Okt");
    expect(text).toContain("14:05");
    expect(text).not.toContain("2026");
    expect(text).not.toContain("BST");

    const lastYear: string = spaced(
      OneUptimeDate.getDateAsCompactLocalString(LAST_YEAR, {
        now: NOW,
      }),
    );

    expect(lastYear).toContain("30.");
    expect(lastYear).toContain("Dez");
    expect(lastYear).toContain("2025");
  });

  test("Japanese and Persian write it their own way too", () => {
    setDateDisplayLanguage("ja");

    const japanese: string = OneUptimeDate.getDateAsCompactLocalString(
      THIS_YEAR,
      { now: NOW, use12HourFormat: false },
    );

    expect(japanese).toContain("10月7日");
    expect(japanese).not.toContain("2026");

    setDateDisplayLanguage("fa");

    const persian: string = OneUptimeDate.getDateAsCompactLocalString(
      THIS_YEAR,
      { now: NOW, use12HourFormat: false },
    );

    // Persian digits, as every date on a Persian page.
    expect(persian).toMatch(PERSIAN_DIGIT);
    expect(persian).not.toMatch(LATIN_DIGIT);
  });
});
