/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";
import OneUptimeDate from "../../Types/Date";
import {
  ReaderDateTimeFormat,
  getDateLocale,
  getDateTimeFormat,
  getZoneAbbreviation,
  setDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import { DASHBOARD_LANGUAGES } from "../Helpers/TranslatedLanguages";

/*
 * A DATE IN THE READER'S LANGUAGE READS ONEUPTIME'S TIME ZONE DATA (#10038).
 *
 * OneUptime works every wall clock out with moment-timezone's data (IANA
 * 2026f, checked every week), but a date in a language other than English
 * was written by Intl with a timeZone, so its hour came from the runtime's
 * own tz data: the browser's on a page, Node.js's ICU on the server. When
 * the two disagree, a German reader saw another hour than an English one -
 * an hour early in Vancouver from 1 November 2026 in a browser older than
 * tzdata 2026b - and Intl named British Columbia's time "PDT" where every
 * other date said "MST".
 *
 * This runtime has such a disagreement of its own: Node.js 26.13.1 carries
 * tzdata 2026e, which lacks 2026f's change for Cuba, so its Intl puts
 * Havana an hour behind moment from 1 November 2026. Every language reads
 * moment's hour now.
 */

// 12:00 UTC on 20 November 2026: 08:00 in Havana by 2026f (CDT, UTC-4).
const HAVANA_NOON_UTC: Date = new Date("2026-11-20T12:00:00Z");

// 12:00 UTC on 20 November 2026: 05:00 MST in Vancouver (UTC-7 all year).
const VANCOUVER_NOON_UTC: Date = new Date("2026-11-20T12:00:00Z");

// A zone only moment's data holds: Havana's rules under a name no Intl knows.
const MOMENT_ONLY_ZONE: string = "Test/OneUptimeOnly_Havana";

moment.tz.zone("America/Havana");
moment.tz.link(`America/Havana|${MOMENT_ONLY_ZONE}`);

// The hour a text says, in Latin digits.
const hourOf: (text: string) => string = (text: string): string => {
  const latin: string = text.replace(/\p{Nd}/gu, (digit: string): string => {
    const code: number = digit.codePointAt(0) || 0;

    if (code >= 0x06f0 && code <= 0x06f9) {
      return String(code - 0x06f0);
    }

    return digit;
  });

  return (latin.match(/(\d{1,2})[:.]\d{2}/) || [])[1] || "";
};

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage("en");
});

describe("the wall clock is moment's in every language", () => {
  test("this runtime's own Intl disagrees with moment about Havana", () => {
    // If this fails, Node.js caught up with 2026f: the cases below still hold.
    const intl: string = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Havana",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(HAVANA_NOON_UTC);

    expect(moment(HAVANA_NOON_UTC).tz("America/Havana").format("HH:mm")).toBe(
      "08:00",
    );
    expect(["07:00", "08:00"]).toContain(intl);
  });

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: a reader in Havana reads moment's 08:00, as an English reader does",
    (language: string) => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaHavana);

      const english: string = withDateDisplayLanguage("en", (): string => {
        return OneUptimeDate.getDateAsLocalFormattedString(
          HAVANA_NOON_UTC,
          false,
          false,
        );
      });

      setDateDisplayLanguage(language);

      expect(hourOf(english)).toBe("08");
      expect(
        hourOf(
          OneUptimeDate.getDateAsLocalFormattedString(
            HAVANA_NOON_UTC,
            false,
            false,
          ),
        ),
      ).toBe("08");
      expect(
        hourOf(
          OneUptimeDate.getDateAsLocalShortDateTimeString(HAVANA_NOON_UTC, {
            use12HourFormat: false,
          }),
        ),
      ).toBe("08");
      expect(
        hourOf(
          OneUptimeDate.getLocalTimeString(HAVANA_NOON_UTC, {
            use12HourFormat: true,
          }),
        ),
      ).toBe("8");
      expect(
        hourOf(
          OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
            date: HAVANA_NOON_UTC,
            format: "HH:mm",
          }),
        ),
      ).toBe("08");
    },
  );

  test("a zone only moment knows is written in the reader's language", () => {
    expect((): Intl.DateTimeFormat => {
      return new Intl.DateTimeFormat("de", { timeZone: MOMENT_ONLY_ZONE });
    }).toThrow(RangeError);

    setDateDisplayLanguage("de");

    expect(
      OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: HAVANA_NOON_UTC,
        timezone: MOMENT_ONLY_ZONE,
        showWeekday: true,
        use12HourFormat: false,
      }),
    ).toBe("Fr., 20. Nov. 2026, 08:00 CDT");
  });

  test("a formatter reads its wall clock in the first zone moment knows", () => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: getDateLocale("fr"),
      timezones: ["Not/AZone", "America/Havana"],
      options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    });

    expect(format).not.toBeNull();
    expect(format!.format(HAVANA_NOON_UTC)).toBe("08:00");
    expect(format!.resolvedOptions().timeZone).toBe("America/Havana");
  });

  test("a zone nobody knows gives no formatter, so the caller writes English", () => {
    expect(
      getDateTimeFormat({
        locale: getDateLocale("de"),
        timezones: ["Not/AZone"],
        options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      }),
    ).toBeNull();
  });

  test("a zone the options name is not read: only the zones asked for are", () => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: getDateLocale("de"),
      timezones: ["America/Havana"],
      options: {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      },
    });

    expect(format!.format(HAVANA_NOON_UTC)).toBe("08:00");
  });

  test("no zone at all is the runtime's own clock, as a Date reads it", () => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: getDateLocale("de"),
      timezones: [],
      options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    });
    const local: Date = new Date(2026, 10, 20, 9, 41);

    expect(format!.format(local)).toBe("09:41");
  });

  test("formatToParts and formatRange read the same wall clock", () => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: getDateLocale("de"),
      timezones: ["America/Havana"],
      options: { day: "numeric", month: "short", year: "numeric" },
    });
    // 03:00 UTC on 21 November is still 20 November in Havana.
    const lateEvening: Date = new Date("2026-11-21T03:00:00Z");

    expect(
      format!
        .formatToParts(lateEvening)
        .find((part: Intl.DateTimeFormatPart): boolean => {
          return part.type === "day";
        })?.value,
    ).toBe("20");
    expect(format!.formatRange(HAVANA_NOON_UTC, lateEvening)).toBe(
      "20. Nov. 2026",
    );
  });
});

describe("a zone's name is moment's, never Intl's", () => {
  test("Intl in US English calls British Columbia's winter time PDT, moment MST", () => {
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Vancouver",
        timeZoneName: "short",
        hour: "numeric",
      }).format(VANCOUVER_NOON_UTC),
    ).toContain("PDT");
    expect(getZoneAbbreviation("America/Vancouver", VANCOUVER_NOON_UTC)).toBe(
      "MST",
    );
  });

  test.each<[string]>([["en-US"], ["de"], ["fa"]])(
    "%s: a formatter asked for the zone's name writes moment's",
    (language: string) => {
      const format: ReaderDateTimeFormat | null = getDateTimeFormat({
        locale: getDateLocale(language),
        timezones: ["America/Vancouver"],
        options: { hour: "numeric", hour12: true, timeZoneName: "short" },
      });
      const parts: Array<Intl.DateTimeFormatPart> =
        format!.formatToParts(VANCOUVER_NOON_UTC);

      expect(
        parts.find((part: Intl.DateTimeFormatPart): boolean => {
          return part.type === "timeZoneName";
        })?.value,
      ).toBe("MST");
      expect(format!.format(VANCOUVER_NOON_UTC)).toContain("MST");
      expect(format!.format(VANCOUVER_NOON_UTC)).not.toContain("PDT");
    },
  );

  test("an offset with no abbreviation is written in the reader's digits", () => {
    const format: ReaderDateTimeFormat | null = getDateTimeFormat({
      locale: getDateLocale("fa"),
      timezones: ["Asia/Tehran"],
      options: { hour: "2-digit", hourCycle: "h23", timeZoneName: "short" },
    });

    expect(format!.format(VANCOUVER_NOON_UTC)).toContain("GMT+۰۳۳۰");
  });

  test("every writer of a whole date names Vancouver's zone MST in every language", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaVancouver);

    for (const language of DASHBOARD_LANGUAGES) {
      setDateDisplayLanguage(language);

      const text: string = OneUptimeDate.getDateAsLocalFormattedString(
        VANCOUVER_NOON_UTC,
        false,
        true,
      );

      expect({ language, text, hour: hourOf(text) }).toEqual({
        language,
        text,
        hour: "5",
      });
      expect(text).toContain("MST");
    }
  });
});

describe("a daylight saving change, on moment's clock", () => {
  /*
   * New York falls back at 02:00 EDT on 1 November 2026: 05:30 UTC is 01:30
   * EDT and 06:30 UTC is 01:30 EST, the same wall clock twice. Each is
   * written with the zone it is in, so the two read apart.
   */
  const FIRST: Date = new Date("2026-11-01T05:30:00Z");
  const SECOND: Date = new Date("2026-11-01T06:30:00Z");

  test.each<[string, string, string]>([
    ["en", "Nov 1, 2026, 01:30 EDT", "Nov 1, 2026, 01:30 EST"],
    ["de", "1. Nov. 2026, 01:30 EDT", "1. Nov. 2026, 01:30 EST"],
    ["ja", "2026年11月1日 01:30 EDT", "2026年11月1日 01:30 EST"],
  ])(
    "%s: the two 01:30s, named apart",
    (language: string, first: string, second: string) => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
      setDateDisplayLanguage(language);

      expect(
        OneUptimeDate.getDateAsLocalFormattedString(FIRST, false, false),
      ).toBe(first);
      expect(
        OneUptimeDate.getDateAsLocalFormattedString(SECOND, false, false),
      ).toBe(second);
    },
  );

  test("the spring-forward hour that does not exist is never written", () => {
    // 07:00 UTC on 8 March 2026 is 03:00 EDT: 02:00 to 03:00 is skipped.
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    setDateDisplayLanguage("de");

    expect(
      OneUptimeDate.getLocalTimeString(new Date("2026-03-08T07:00:00Z")),
    ).toBe("03:00");
    expect(
      OneUptimeDate.getLocalTimeString(new Date("2026-03-08T06:59:00Z")),
    ).toBe("01:59");
  });
});
