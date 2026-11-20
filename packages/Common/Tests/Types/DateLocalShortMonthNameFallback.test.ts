/**
 * The short month name in the date helpers - chart axes, "Oct 2026" - is
 * worked out on OneUptime's own clock (#10038).
 *
 * It was the browser's Intl, asked for the CURRENT zone name, so an engine
 * with tzdata older than 2022b threw for "Europe/Kyiv" and the helpers
 * retried each legacy spelling ("Europe/Kiev") before falling back to
 * moment. Now Intl is never handed a zone at all: moment-timezone works the
 * wall clock out in the zone, and Intl writes only the month's word, at
 * UTC (DateLanguage's getDateTimeFormat). An English page takes moment's
 * own word, as every other English date does.
 *
 * So these lock in that the month is the one the zone decides - in a zone
 * only moment knows too - and that it is in the reader's words. Every
 * instant sits right next to a month boundary, so a month computed in the
 * wrong zone fails loudly, whatever TZ the suite runs in.
 */
import OneUptimeDate from "../../Types/Date";
import {
  getDateLocale,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";

const KYIV: Timezone = Timezone.EuropeKyiv;

// 22:30 UTC on Jun 30 is already 01:30 on Jul 1 in Kyiv (UTC+3 in summer).
const JUNE_30_LATE_UTC: Date = new Date("2026-06-30T22:30:00Z");

// 22:30 UTC on Dec 31 is already 00:30 on Jan 1 2027 in Kyiv (UTC+2).
const NEW_YEARS_EVE_LATE_UTC: Date = new Date("2026-12-31T22:30:00Z");

/*
 * A zone only moment's data holds: Kyiv's rules under a name no Intl
 * knows. Before #10038 the helpers asked Intl for it, were refused, and
 * fell back to moment's English month even on a German page.
 */
const MOMENT_ONLY_ZONE: string = "Test/OneUptimeOnly_Kyiv";

/*
 * Kyiv is read first, so moment holds it as a zone of its own: its packed
 * data may hold it as a link, which a second link of the same name would
 * replace.
 */
moment.tz.zone(KYIV);
moment.tz.link(`${KYIV}|${MOMENT_ONLY_ZONE}`);

type MonthReadings = {
  month: string;
  dayMonth: string;
  monthYear: string;
};

// Every public helper that goes through getLocalShortMonthName.
const readMonthHelpers: (instant: Date) => MonthReadings = (
  instant: Date,
): MonthReadings => {
  return {
    month: OneUptimeDate.getLocalShortMonthNameFromDate(instant),
    dayMonth: OneUptimeDate.getDateAsLocalDayMonthString(instant),
    monthYear: OneUptimeDate.getDateAsLocalMonthYearString(instant),
  };
};

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage("en");
});

describe("the month is the zone's, on OneUptime's own clock", () => {
  test("Intl knows no such zone, and the month is still the zone's", () => {
    expect((): Intl.DateTimeFormat => {
      return new Intl.DateTimeFormat("de", { timeZone: MOMENT_ONLY_ZONE });
    }).toThrow(RangeError);
    expect(moment.tz.zone(MOMENT_ONLY_ZONE)).not.toBeNull();

    OneUptimeDate.setUserTimezone(MOMENT_ONLY_ZONE as Timezone);

    expect(readMonthHelpers(JUNE_30_LATE_UTC)).toEqual({
      month: "Jul",
      dayMonth: "01 Jul",
      monthYear: "Jul 2026",
    });
  });

  test("in German, a zone only moment knows reads German's month, not moment's English", () => {
    // 22:30 UTC on Sep 30 is already 01:30 on Oct 1 in Kyiv.
    const october: Date = new Date("2026-09-30T22:30:00Z");

    OneUptimeDate.setUserTimezone(MOMENT_ONLY_ZONE as Timezone);
    setDateDisplayLanguage("de");

    expect(OneUptimeDate.getLocalShortMonthNameFromDate(october)).toBe("Okt");
    expect(OneUptimeDate.getDateAsLocalMonthYearString(october)).toBe(
      "Okt. 2026",
    );
    expect(OneUptimeDate.getDateAsLocalDayMonthString(october)).toBe("1. Okt.");
  });

  test("Intl is never handed the zone: only UTC", () => {
    OneUptimeDate.setUserTimezone(KYIV);
    setDateDisplayLanguage("fr");
    // The locale first: the stand-in below has no supportedLocalesOf.
    getDateLocale("fr");

    const RealDateTimeFormat: typeof Intl.DateTimeFormat = Intl.DateTimeFormat;
    const zonesAsked: Array<string | undefined> = [];

    jest
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(
        (
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ): Intl.DateTimeFormat => {
          zonesAsked.push(options?.timeZone);

          return new RealDateTimeFormat(locales, options);
        },
      );

    // A shape no other test asked for, so a formatter is built here.
    expect(
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: JUNE_30_LATE_UTC,
        format: "MMMM YYYY",
      }),
    ).toBe("juillet 2026");
    expect(OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC)).toBe(
      "juil.",
    );

    for (const zone of zonesAsked) {
      expect([undefined, "UTC"]).toContain(zone);
    }
  });

  /*
   * The zone decides the month: the same instant is Jul in Kyiv and
   * Kolkata but still Jun in UTC and New York.
   */
  test.each([
    [KYIV, JUNE_30_LATE_UTC, "Jul", "01 Jul", "Jul 2026"],
    [Timezone.AsiaKolkata, JUNE_30_LATE_UTC, "Jul", "01 Jul", "Jul 2026"],
    [Timezone.UTC, JUNE_30_LATE_UTC, "Jun", "30 Jun", "Jun 2026"],
    [Timezone.AmericaNew_York, JUNE_30_LATE_UTC, "Jun", "30 Jun", "Jun 2026"],
    [KYIV, NEW_YEARS_EVE_LATE_UTC, "Jan", "01 Jan", "Jan 2027"],
    // 05:00 UTC on Mar 1 is still 21:00 on Feb 28 in Los Angeles.
    [
      Timezone.AmericaLos_Angeles,
      new Date("2026-03-01T05:00:00Z"),
      "Feb",
      "28 Feb",
      "Feb 2026",
    ],
  ])(
    "names the month of the instant in %s",
    (
      timezone: Timezone,
      instant: Date,
      month: string,
      dayMonth: string,
      monthYear: string,
    ) => {
      OneUptimeDate.setUserTimezone(timezone);

      expect(readMonthHelpers(instant)).toEqual({
        month,
        dayMonth,
        monthYear,
      });
    },
  );

  test("the browser's own zone, read as its current name, when no user zone is set", () => {
    jest.spyOn(moment.tz, "guess").mockReturnValue("Europe/Kiev");

    expect(OneUptimeDate.getUserTimezone()).toBeNull();
    expect(OneUptimeDate.getCurrentTimezone()).toBe(KYIV);
    expect(readMonthHelpers(JUNE_30_LATE_UTC)).toEqual({
      month: "Jul",
      dayMonth: "01 Jul",
      monthYear: "Jul 2026",
    });
  });

  test("accepts the instant as an ISO string as well as a Date", () => {
    OneUptimeDate.setUserTimezone(KYIV);

    expect(
      OneUptimeDate.getLocalShortMonthNameFromDate(
        JUNE_30_LATE_UTC.toISOString(),
      ),
    ).toBe("Jul");
  });

  /*
   * An English page wrote the browser's own month: "Sept" in an en-GB
   * browser beside every tooltip's "Sep", and "Okt." in a German browser
   * beside an English table's "Oct". English is moment's word now.
   */
  test("English is moment's word, whatever the browser's own language", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);
    setDateDisplayLanguage("en-GB");

    const september: Date = new Date("2026-09-14T12:00:00Z");

    expect(OneUptimeDate.getLocalShortMonthNameFromDate(september)).toBe("Sep");
    expect(OneUptimeDate.getDateAsLocalDayMonthString(september)).toBe(
      "14 Sep",
    );
  });
});
