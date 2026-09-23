/**
 * The short month name in the date helpers comes from the browser's Intl,
 * so that it is in the reader's own language. Intl only knows the zone
 * names in the tzdata the browser was built with, and the zone
 * OneUptimeDate asks it about is the CURRENT name: a browser that reports
 * "Europe/Kiev" is read as "Europe/Kyiv" (see TimezoneAlias). An engine with
 * tzdata older than 2022b throws a RangeError for "Europe/Kyiv", which used
 * to take every chart axis and date label that shows a month down with it.
 *
 * These lock in the fallback order: the current name, then each legacy
 * spelling of it (which such an engine does know), then moment, which
 * carries its own zone data — and that the month is always the one the
 * zone decides, not the machine's or UTC's.
 *
 * Every instant sits right next to a month boundary, so a month computed in
 * the wrong zone fails loudly, whatever TZ the suite runs in.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";
import moment from "moment-timezone";

const KYIV: Timezone = Timezone.EuropeKyiv;

// 22:30 UTC on Jun 30 is already 01:30 on Jul 1 in Kyiv (UTC+3 in summer).
const JUNE_30_LATE_UTC: Date = new Date("2026-06-30T22:30:00Z");

// 22:30 UTC on Dec 31 is already 00:30 on Jan 1 2027 in Kyiv (UTC+2).
const NEW_YEARS_EVE_LATE_UTC: Date = new Date("2026-12-31T22:30:00Z");

type ToLocaleStringFunction = (
  this: Date,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) => string;

/*
 * Captured before any stub is installed, so a stub can delegate to the real
 * Intl for the zones it pretends the engine knows, and afterEach can check
 * that the real one is back in place.
 */
const realToLocaleString: ToLocaleStringFunction =
  Date.prototype.toLocaleString;

type IsZoneKnownFunction = (timeZone: string | undefined) => boolean;

type StubIntlZoneSupportFunction = (
  isZoneKnown: IsZoneKnownFunction,
) => Array<string | undefined>;

/*
 * Make Date.prototype.toLocaleString behave like an engine whose Intl knows
 * only the zones `isZoneKnown` accepts: an unknown zone throws the
 * RangeError V8 throws, a known one is formatted by the real Intl. Returns
 * the list of timeZone options it was called with, in order, so a case can
 * assert which spellings were tried.
 */
const stubIntlZoneSupport: StubIntlZoneSupportFunction = (
  isZoneKnown: IsZoneKnownFunction,
): Array<string | undefined> => {
  const attemptedTimeZones: Array<string | undefined> = [];

  jest.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    attemptedTimeZones.push(options?.timeZone);

    if (!isZoneKnown(options?.timeZone)) {
      throw new RangeError(`Invalid time zone specified: ${options?.timeZone}`);
    }

    return realToLocaleString.call(this, locales, options);
  });

  return attemptedTimeZones;
};

// The engine the bug report came from: everything but the renamed zone.
const allButKyiv: IsZoneKnownFunction = (
  timeZone: string | undefined,
): boolean => {
  return timeZone !== KYIV.toString();
};

// An engine whose Intl rejects every zone — only moment is left.
const noZones: IsZoneKnownFunction = (): boolean => {
  return false;
};

type MonthReadings = {
  month: string;
  dayMonth: string;
  monthYear: string;
};

type ReadMonthHelpersFunction = (instant: Date) => MonthReadings;

// Every public helper that goes through getLocalShortMonthName.
const readMonthHelpers: ReadMonthHelpersFunction = (
  instant: Date,
): MonthReadings => {
  return {
    month: OneUptimeDate.getLocalShortMonthNameFromDate(instant),
    dayMonth: OneUptimeDate.getDateAsLocalDayMonthString(instant),
    monthYear: OneUptimeDate.getDateAsLocalMonthYearString(instant),
  };
};

describe("OneUptimeDate short month name when Intl does not know the zone", () => {
  afterEach(() => {
    // Never leak a stubbed Intl, a pinned guess or an override.
    jest.restoreAllMocks();
    OneUptimeDate.setUserTimezone(null);

    expect(Date.prototype.toLocaleString).toBe(realToLocaleString);
    expect(OneUptimeDate.getUserTimezone()).toBeNull();
  });

  describe("an engine that knows the legacy spelling but not the current name", () => {
    it("names the month through the legacy spelling of the user's zone", () => {
      OneUptimeDate.setUserTimezone(KYIV);
      const attemptedTimeZones: Array<string | undefined> =
        stubIntlZoneSupport(allButKyiv);

      expect(readMonthHelpers(JUNE_30_LATE_UTC)).toEqual({
        month: "Jul",
        dayMonth: "01 Jul",
        monthYear: "Jul 2026",
      });

      /*
       * Each helper asked for the current name first, was refused, and got
       * its answer from the first legacy spelling — never falling through
       * to moment, whose month names are not in the reader's language.
       */
      const firstLegacyName: Timezone | undefined =
        TimezoneAlias.getLegacyNamesOf(KYIV)[0];

      expect(firstLegacyName).toBe(Timezone.EuropeKiev);
      expect(attemptedTimeZones).toEqual([
        KYIV.toString(),
        firstLegacyName,
        KYIV.toString(),
        firstLegacyName,
        KYIV.toString(),
        firstLegacyName,
      ]);
    });

    it("gives the month Intl reports for the legacy spelling itself", () => {
      OneUptimeDate.setUserTimezone(KYIV);

      const viaLegacyName: string = realToLocaleString.call(
        JUNE_30_LATE_UTC,
        "default",
        { month: "short", timeZone: Timezone.EuropeKiev.toString() },
      );

      stubIntlZoneSupport(allButKyiv);

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe(viaLegacyName);
    });

    it("rolls into the new year in the zone, not in UTC", () => {
      OneUptimeDate.setUserTimezone(KYIV);
      stubIntlZoneSupport(allButKyiv);

      expect(readMonthHelpers(NEW_YEARS_EVE_LATE_UTC)).toEqual({
        month: "Jan",
        dayMonth: "01 Jan",
        monthYear: "Jan 2027",
      });
    });

    it("accepts the instant as an ISO string as well as a Date", () => {
      OneUptimeDate.setUserTimezone(KYIV);
      stubIntlZoneSupport(allButKyiv);

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(
          JUNE_30_LATE_UTC.toISOString(),
        ),
      ).toBe("Jul");
    });

    /*
     * The case the fallback was written for: no profile zone, and a browser
     * that reports "Europe/Kiev". getCurrentTimezone hands back
     * "Europe/Kyiv", which that same browser's Intl then rejects.
     */
    it("survives a browser that reports Europe/Kiev and cannot format Europe/Kyiv", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("Europe/Kiev");
      const attemptedTimeZones: Array<string | undefined> =
        stubIntlZoneSupport(allButKyiv);

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone()).toBe(KYIV);
      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe("Jul");
      expect(attemptedTimeZones).toEqual([
        KYIV.toString(),
        Timezone.EuropeKiev.toString(),
      ]);
    });

    it("tries every legacy spelling in turn until the engine knows one", () => {
      OneUptimeDate.setUserTimezone(KYIV);

      const legacyNames: Array<Timezone> = TimezoneAlias.getLegacyNamesOf(KYIV);

      // Kiev, Uzhgorod and Zaporozhye all merged into Kyiv in 2022b.
      expect(legacyNames.length).toBeGreaterThan(1);

      // An engine that knows only the last of them.
      const onlyKnownName: string =
        legacyNames[legacyNames.length - 1]!.toString();

      const attemptedTimeZones: Array<string | undefined> = stubIntlZoneSupport(
        (timeZone: string | undefined): boolean => {
          return timeZone === onlyKnownName;
        },
      );

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe("Jul");
      expect(attemptedTimeZones).toEqual([
        KYIV.toString(),
        ...legacyNames.map((name: Timezone): string => {
          return name.toString();
        }),
      ]);
    });
  });

  describe("an engine whose Intl knows none of the spellings", () => {
    it("falls back to moment after trying the current name and every legacy spelling once", () => {
      OneUptimeDate.setUserTimezone(KYIV);
      const attemptedTimeZones: Array<string | undefined> =
        stubIntlZoneSupport(noZones);

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe("Jul");
      expect(attemptedTimeZones).toEqual([
        KYIV.toString(),
        ...TimezoneAlias.getLegacyNamesOf(KYIV).map(
          (name: Timezone): string => {
            return name.toString();
          },
        ),
      ]);
    });

    /*
     * The zone decides the month even with no Intl at all: the same instant
     * is Jul in Kyiv and Kolkata but still Jun in UTC and New York.
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
      "names the month of the instant in %s via moment",
      (
        timezone: Timezone,
        instant: Date,
        month: string,
        dayMonth: string,
        monthYear: string,
      ) => {
        OneUptimeDate.setUserTimezone(timezone);
        stubIntlZoneSupport(noZones);

        expect(readMonthHelpers(instant)).toEqual({
          month,
          dayMonth,
          monthYear,
        });
      },
    );

    it("falls back to moment for a zone that has no legacy spellings", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaKuala_Lumpur);
      expect(TimezoneAlias.getLegacyNamesOf(Timezone.AsiaKuala_Lumpur)).toEqual(
        [],
      );

      const attemptedTimeZones: Array<string | undefined> =
        stubIntlZoneSupport(noZones);

      // 16:30 UTC on Jun 30 is 00:30 on Jul 1 in Kuala Lumpur (UTC+8).
      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(
          new Date("2026-06-30T16:30:00Z"),
        ),
      ).toBe("Jul");
      expect(attemptedTimeZones).toEqual([
        Timezone.AsiaKuala_Lumpur.toString(),
      ]);
    });

    it("falls back to moment for the browser's own zone when no user zone is set", () => {
      jest.spyOn(moment.tz, "guess").mockReturnValue("Europe/Kiev");
      stubIntlZoneSupport(noZones);

      expect(readMonthHelpers(JUNE_30_LATE_UTC)).toEqual({
        month: "Jul",
        dayMonth: "01 Jul",
        monthYear: "Jul 2026",
      });
    });
  });

  describe("an engine that knows the current name", () => {
    /*
     * The path every up-to-date browser takes must be exactly what it was
     * before the fallback: one Intl call, in the current name.
     */
    test.each([
      KYIV,
      Timezone.AsiaKolkata,
      Timezone.UTC,
      Timezone.AmericaNew_York,
    ])("returns what Intl reports for %s itself", (timezone: Timezone) => {
      OneUptimeDate.setUserTimezone(timezone);

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe(
        JUNE_30_LATE_UTC.toLocaleString("default", {
          month: "short",
          timeZone: timezone.toString(),
        }),
      );
    });

    it("asks Intl once, in the current name, and never tries a legacy spelling", () => {
      OneUptimeDate.setUserTimezone(KYIV);
      const attemptedTimeZones: Array<string | undefined> = stubIntlZoneSupport(
        (): boolean => {
          return true;
        },
      );

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe("Jul");
      expect(attemptedTimeZones).toEqual([KYIV.toString()]);
    });

    it("gives the month in Intl's language, not moment's", () => {
      OneUptimeDate.setUserTimezone(KYIV);

      /*
       * Proof that a successful Intl call is the answer rather than a
       * fallback: whatever Intl says is what the helper returns, even a
       * string moment would never produce.
       */
      jest
        .spyOn(Date.prototype, "toLocaleString")
        .mockImplementation((): string => {
          return "лип.";
        });

      expect(
        OneUptimeDate.getLocalShortMonthNameFromDate(JUNE_30_LATE_UTC),
      ).toBe("лип.");
      expect(
        OneUptimeDate.getDateAsLocalMonthYearString(JUNE_30_LATE_UTC),
      ).toBe("лип. 2026");
    });
  });
});
