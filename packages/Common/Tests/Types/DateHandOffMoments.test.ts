/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";

/*
 * A MOMENT IN A LIST THAT SAYS ITS ZONE ONCE, AND IS OF THIS YEAR.
 *
 * An on-call schedule's upcoming hand-offs said each moment in full - "Tue,
 * Oct 6, 2026, 5:05 AM EDT -> Tue, Oct 13, 2026, 5:05 AM EDT" - and a
 * phone's row took three lines for it. The list says its zone once, and its
 * moments are of this year, so getDateAsFormattedStringInTimezone can leave
 * either out (hideYear, hideZone), in English and in the reader's own
 * language; isSameYearInTimezone says whether a moment is of the year
 * another is, as a clock in a zone reads both.
 *
 * The instant is 09:05:07 UTC: 05:05 in New York (EDT), 10:05 in London
 * (BST), the viewer's zone here.
 */

const INSTANT: Date = new Date("2026-10-06T09:05:07Z");

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

function moment(options: {
  hideYear?: boolean;
  hideZone?: boolean;
  timezone?: string;
  onlyShowDate?: boolean;
}): string {
  return spaced(
    OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: INSTANT,
      showWeekday: true,
      use12HourFormat: true,
      ...(options.timezone ? { timezone: options.timezone } : {}),
      ...(options.hideYear ? { hideYear: true } : {}),
      ...(options.hideZone ? { hideZone: true } : {}),
      ...(options.onlyShowDate ? { onlyShowDate: true } : {}),
    }),
  );
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
});

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

describe("in English", () => {
  const NEW_YORK: string = Timezone.AmericaNew_York;

  test("as it always was, with neither left out", () => {
    expect(moment({ timezone: NEW_YORK })).toBe(
      "Tue, Oct 6, 2026, 5:05 AM EDT",
    );
  });

  test("without its year", () => {
    expect(moment({ timezone: NEW_YORK, hideYear: true })).toBe(
      "Tue, Oct 6, 5:05 AM EDT",
    );
  });

  test("without its zone", () => {
    expect(moment({ timezone: NEW_YORK, hideZone: true })).toBe(
      "Tue, Oct 6, 2026, 5:05 AM",
    );
  });

  test("without either: a hand-off's moment", () => {
    expect(moment({ timezone: NEW_YORK, hideYear: true, hideZone: true })).toBe(
      "Tue, Oct 6, 5:05 AM",
    );
  });

  test("in the viewer's own zone, without a zone given", () => {
    expect(moment({ hideYear: true, hideZone: true })).toBe(
      "Tue, Oct 6, 10:05 AM",
    );
    expect(moment({})).toBe("Tue, Oct 6, 2026, 10:05 AM BST");
  });

  test("a day alone, without its year", () => {
    expect(
      moment({ timezone: NEW_YORK, onlyShowDate: true, hideYear: true }),
    ).toBe("Tue, Oct 6");
  });
});

describe("in the reader's own language", () => {
  test("German leaves out its year and its zone the same way", () => {
    setDateDisplayLanguage("de");

    const full: string = moment({ timezone: Timezone.AmericaNew_York });
    const handOff: string = moment({
      timezone: Timezone.AmericaNew_York,
      hideYear: true,
      hideZone: true,
    });

    expect(full).toContain("Di., 6. Okt. 2026");
    expect(full).toContain("EDT");
    expect(handOff).toContain("Di., 6. Okt.");
    expect(handOff).not.toContain("2026");
    expect(handOff).not.toContain("EDT");
    // Only the year and the zone: the time of day is the full one's.
    expect(full.startsWith(handOff.split(",")[0]!)).toBe(true);
    expect(full).toContain(handOff.split(", ").pop()!);
  });

  test("and remembers its English, which a sentence still in English reads", () => {
    setDateDisplayLanguage("de");

    const text: string = OneUptimeDate.getDateAsFormattedStringInTimezone({
      date: INSTANT,
      timezone: Timezone.AmericaNew_York,
      showWeekday: true,
      use12HourFormat: true,
      hideYear: true,
      hideZone: true,
    });

    expect(getEnglishOf(text)).toBe("Tue, Oct 6, 5:05 AM");
  });
});

describe("whether two moments are of the same year", () => {
  test("as a clock in the zone reads them: New Year's Eve in New York is New Year's Day in Tokyo", () => {
    // 2026-12-31 20:00 in New York = 2027-01-01 10:00 in Tokyo.
    const eve: Date = new Date("2027-01-01T01:00:00Z");
    const earlierThatYear: Date = new Date("2026-06-01T12:00:00Z");

    expect(
      OneUptimeDate.isSameYearInTimezone(
        eve,
        earlierThatYear,
        Timezone.AmericaNew_York,
      ),
    ).toBe(true);
    expect(
      OneUptimeDate.isSameYearInTimezone(
        eve,
        earlierThatYear,
        Timezone.AsiaTokyo,
      ),
    ).toBe(false);
  });

  test("in the viewer's own zone without one", () => {
    // 2026-12-31 23:30 UTC is 2026 in London, the viewer's zone here.
    expect(
      OneUptimeDate.isSameYearInTimezone(
        new Date("2026-12-31T23:30:00Z"),
        INSTANT,
      ),
    ).toBe(true);
    expect(
      OneUptimeDate.isSameYearInTimezone(
        new Date("2027-01-01T00:30:00Z"),
        INSTANT,
      ),
    ).toBe(false);
  });

  test("reads a moment given as text too", () => {
    expect(
      OneUptimeDate.isSameYearInTimezone(
        "2026-03-01T00:00:00Z",
        INSTANT,
        Timezone.UTC,
      ),
    ).toBe(true);
  });
});
