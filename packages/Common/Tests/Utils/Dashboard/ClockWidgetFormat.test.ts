/** @timezone UTC */

import {
  ClockWidgetFace,
  ClockWidgetHourFormat,
} from "../../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  ClockContentBox,
  ClockHandAngles,
  ClockWidgetDisplay,
  CLOCK_SECONDARY_FONT_SCALE,
  getCityFromTimezone,
  getClockAnalogDialSizeInPx,
  getClockCaptionLineCount,
  getClockContentBox,
  getClockDigitalFontSizeInPx,
  getClockGmtOffsetText,
  getClockHandAngles,
  getClockLabel,
  getClockTimeWidthInFontUnits,
  getClockWidgetDisplay,
  getMillisecondsUntilNextClockTick,
  isClockTimezoneFallback,
  isDaytimeAtClock,
  isSupportedClockTimezone,
  resolveClockFace,
  resolveClockTimezone,
  resolveUse12HourFormat,
} from "../../../Utils/Dashboard/ClockWidgetFormat";

/*
 * A Monday afternoon in UTC, deliberately picked so the same instant lands on
 * three different calendar behaviours: still Monday in the Americas, late
 * Monday night in India, and already Tuesday in Sydney.
 */
const INSTANT: Date = new Date("2026-08-03T18:07:09.500Z");

/** The minimum/maximum the digital font sizer is allowed to return. */
const MIN_FONT_SIZE_IN_PX: number = 14;
const MAX_FONT_SIZE_IN_PX: number = 64;
const MIN_DIAL_SIZE_IN_PX: number = 48;

/** Mirrors the sizer's own reserved space, so the tests can predict it. */
const SECONDARY_LINE_HEIGHT_IN_PX: number = 16;
const HORIZONTAL_PADDING_IN_PX: number = 8;
const VERTICAL_PADDING_IN_PX: number = 4;

/*
 * The padding DashboardBaseComponent puts around every widget. The canvas
 * hands the widget its OUTER tile size, so the sizers have to subtract this
 * before doing anything else.
 */
const CHROME_HORIZONTAL_IN_PX: number = 24;
const CHROME_VERTICAL_IN_PX: number = 24;
const CHROME_VERTICAL_EDIT_MODE_IN_PX: number = 40;

/** The renderer's `gap-1` and the time row's line-height. */
const ROW_GAP_IN_PX: number = 4;
const TIME_LINE_HEIGHT_RATIO: number = 1.05;

/**
 * The height the widget actually occupies at a given font size — the same
 * stack the renderer builds. Used to assert it fits rather than restating
 * the sizer's own arithmetic back at it.
 */
function renderedStackHeightInPx(
  display: ClockWidgetDisplay,
  fontSizeInPx: number,
): number {
  const captionLines: number = getClockCaptionLineCount(display);

  return (
    fontSizeInPx * TIME_LINE_HEIGHT_RATIO +
    captionLines * (SECONDARY_LINE_HEIGHT_IN_PX + ROW_GAP_IN_PX)
  );
}

function makeDisplay(
  overrides: Partial<ClockWidgetDisplay> = {},
): ClockWidgetDisplay {
  return {
    label: "London",
    time: "18:07",
    seconds: null,
    meridiem: null,
    dateText: "Mon, Aug 3",
    zoneAbbreviation: "UTC",
    timezone: "UTC",
    isFallbackTimezone: false,
    ...overrides,
  };
}

describe("ClockWidgetFormat", () => {
  afterEach(() => {
    // setUserTimezone is process-wide static state — never leak it between tests.
    OneUptimeDate.setUserTimezone(null);
    jest.restoreAllMocks();
  });

  describe("isSupportedClockTimezone", () => {
    it("accepts the IANA names the timezone dropdown offers", () => {
      expect(isSupportedClockTimezone("America/New_York")).toBe(true);
      expect(isSupportedClockTimezone("Asia/Kolkata")).toBe(true);
      expect(isSupportedClockTimezone("UTC")).toBe(true);
      expect(isSupportedClockTimezone("Australia/Sydney")).toBe(true);
    });

    it("accepts a name with stray whitespace around it", () => {
      expect(isSupportedClockTimezone("  Europe/London  ")).toBe(true);
    });

    it("rejects an empty or whitespace-only value", () => {
      expect(isSupportedClockTimezone("")).toBe(false);
      expect(isSupportedClockTimezone("   ")).toBe(false);
    });

    it("rejects null and undefined", () => {
      expect(isSupportedClockTimezone(null)).toBe(false);
      expect(isSupportedClockTimezone(undefined)).toBe(false);
    });

    it("rejects a zone that does not exist, rather than trusting the config", () => {
      expect(isSupportedClockTimezone("Mars/Olympus_Mons")).toBe(false);
      expect(isSupportedClockTimezone("America/Not_A_City")).toBe(false);
    });

    it("rejects a non-string smuggled in by a hand-edited config", () => {
      expect(isSupportedClockTimezone(42 as unknown as string)).toBe(false);
      expect(isSupportedClockTimezone({} as unknown as string)).toBe(false);
    });
  });

  describe("resolveClockTimezone", () => {
    it("uses the configured zone when it is one moment knows", () => {
      expect(resolveClockTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    });

    it("trims the configured zone so a padded value still resolves", () => {
      expect(resolveClockTimezone("  Asia/Tokyo  ")).toBe("Asia/Tokyo");
    });

    it("falls back to the viewer's own zone when nothing is configured", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(resolveClockTimezone("")).toBe(
        Timezone.AmericaNew_York.toString(),
      );
      expect(resolveClockTimezone(undefined)).toBe(
        Timezone.AmericaNew_York.toString(),
      );
    });

    it("falls back rather than throwing when the saved zone no longer exists", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(resolveClockTimezone("Mars/Olympus_Mons")).toBe(
        Timezone.AmericaNew_York.toString(),
      );
    });
  });

  describe("isClockTimezoneFallback", () => {
    it("does not flag a blank zone, which is how you ask for the viewer's own", () => {
      expect(isClockTimezoneFallback("")).toBe(false);
      expect(isClockTimezoneFallback("   ")).toBe(false);
      expect(isClockTimezoneFallback(undefined)).toBe(false);
      expect(isClockTimezoneFallback(null)).toBe(false);
    });

    it("does not flag a zone that resolves", () => {
      expect(isClockTimezoneFallback("Europe/Berlin")).toBe(false);
    });

    it("flags a zone that was configured but cannot be resolved", () => {
      expect(isClockTimezoneFallback("Mars/Olympus_Mons")).toBe(true);
    });
  });

  describe("getCityFromTimezone", () => {
    it("takes the city out of a two-part IANA name", () => {
      expect(getCityFromTimezone("America/New_York")).toBe("New York");
      expect(getCityFromTimezone("Europe/London")).toBe("London");
    });

    it("takes the city out of a three-part name", () => {
      expect(getCityFromTimezone("America/Argentina/Buenos_Aires")).toBe(
        "Buenos Aires",
      );
      expect(getCityFromTimezone("America/Indiana/Indianapolis")).toBe(
        "Indianapolis",
      );
    });

    it("replaces every underscore, not just the first", () => {
      expect(getCityFromTimezone("America/Port_of_Spain")).toBe(
        "Port of Spain",
      );
    });

    it("leaves a single-segment zone alone", () => {
      expect(getCityFromTimezone("UTC")).toBe("UTC");
      expect(getCityFromTimezone("GMT")).toBe("GMT");
    });

    it("keeps the offset readable for an Etc zone", () => {
      expect(getCityFromTimezone("Etc/GMT+5")).toBe("GMT+5");
    });

    it("ignores empty segments from a stray trailing slash", () => {
      expect(getCityFromTimezone("Europe/Paris/")).toBe("Paris");
    });
  });

  describe("getClockLabel", () => {
    it("prefers the label the author wrote", () => {
      expect(
        getClockLabel({ label: "Sydney Office", timezone: "Australia/Sydney" }),
      ).toBe("Sydney Office");
    });

    it("trims the author's label", () => {
      expect(
        getClockLabel({ label: "  NOC  ", timezone: "Australia/Sydney" }),
      ).toBe("NOC");
    });

    it("falls back to the city when no label was written", () => {
      expect(getClockLabel({ timezone: "Australia/Sydney" })).toBe("Sydney");
      expect(getClockLabel({ label: "", timezone: "Asia/Kolkata" })).toBe(
        "Kolkata",
      );
    });

    it("falls back when the label is only whitespace", () => {
      expect(getClockLabel({ label: "   ", timezone: "Europe/Lisbon" })).toBe(
        "Lisbon",
      );
    });
  });

  describe("resolveUse12HourFormat", () => {
    it("honours an explicit 12-hour choice", () => {
      expect(resolveUse12HourFormat(ClockWidgetHourFormat.TwelveHour)).toBe(
        true,
      );
    });

    it("honours an explicit 24-hour choice", () => {
      expect(resolveUse12HourFormat(ClockWidgetHourFormat.TwentyFourHour)).toBe(
        false,
      );
    });

    it("defers to the viewer's locale on Auto", () => {
      const spy: jest.SpyInstance = jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      expect(resolveUse12HourFormat(ClockWidgetHourFormat.Auto)).toBe(true);

      spy.mockReturnValue(false);

      expect(resolveUse12HourFormat(ClockWidgetHourFormat.Auto)).toBe(false);
    });

    it("defers to the viewer's locale for a config saved before this setting existed", () => {
      const spy: jest.SpyInstance = jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      expect(resolveUse12HourFormat(undefined)).toBe(true);
      expect(resolveUse12HourFormat(null)).toBe(true);
      expect(
        resolveUse12HourFormat("Whatever" as unknown as ClockWidgetHourFormat),
      ).toBe(true);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("getClockWidgetDisplay", () => {
    it("reads the instant in the configured zone, not the viewer's", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "America/New_York",
        hourFormat: ClockWidgetHourFormat.TwentyFourHour,
      });

      expect(display.time).toBe("14:07");
      expect(display.timezone).toBe("America/New_York");
    });

    it("renders 24-hour time with a zero-padded hour", () => {
      expect(
        getClockWidgetDisplay({
          date: new Date("2026-08-03T06:05:00.000Z"),
          timezone: "UTC",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        }).time,
      ).toBe("06:05");
    });

    it("renders 12-hour time without padding the hour, plus a meridiem", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "America/New_York",
        hourFormat: ClockWidgetHourFormat.TwelveHour,
      });

      expect(display.time).toBe("2:07");
      expect(display.meridiem).toBe("PM");
    });

    it("has no meridiem at all in 24-hour mode", () => {
      expect(
        getClockWidgetDisplay({
          date: INSTANT,
          timezone: "UTC",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        }).meridiem,
      ).toBeNull();
    });

    it("shows midnight as 12 AM rather than 0 AM", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: new Date("2026-08-03T00:00:00.000Z"),
        timezone: "UTC",
        hourFormat: ClockWidgetHourFormat.TwelveHour,
      });

      expect(display.time).toBe("12:00");
      expect(display.meridiem).toBe("AM");
    });

    it("shows noon as 12 PM rather than 0 PM", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: new Date("2026-08-03T12:00:00.000Z"),
        timezone: "UTC",
        hourFormat: ClockWidgetHourFormat.TwelveHour,
      });

      expect(display.time).toBe("12:00");
      expect(display.meridiem).toBe("PM");
    });

    it("shows midnight as 00:00 in 24-hour mode", () => {
      expect(
        getClockWidgetDisplay({
          date: new Date("2026-08-03T00:00:00.000Z"),
          timezone: "UTC",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        }).time,
      ).toBe("00:00");
    });

    it("handles a half-hour zone offset", () => {
      expect(
        getClockWidgetDisplay({
          date: INSTANT,
          timezone: "Asia/Kolkata",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        }).time,
      ).toBe("23:37");
    });

    it("handles a quarter-hour zone offset", () => {
      expect(
        getClockWidgetDisplay({
          date: INSTANT,
          timezone: "Asia/Kathmandu",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        }).time,
      ).toBe("23:52");
    });

    it("handles a zone that is already on the next calendar day", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "Australia/Sydney",
        hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        showDate: true,
      });

      expect(display.time).toBe("04:07");
      expect(display.dateText).toBe("Tue, Aug 4");
    });

    it("omits the seconds unless the widget asked for them", () => {
      expect(
        getClockWidgetDisplay({ date: INSTANT, timezone: "UTC" }).seconds,
      ).toBeNull();
    });

    it("zero-pads the seconds so the digits never reflow", () => {
      expect(
        getClockWidgetDisplay({
          date: new Date("2026-08-03T18:07:09.500Z"),
          timezone: "UTC",
          showSeconds: true,
        }).seconds,
      ).toBe("09");
    });

    it("never carries the seconds inside the time string", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "UTC",
        hourFormat: ClockWidgetHourFormat.TwentyFourHour,
        showSeconds: true,
      });

      expect(display.time).toBe("18:07");
      expect(display.seconds).toBe("09");
    });

    it("omits the date and the zone abbreviation unless asked for them", () => {
      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "UTC",
      });

      expect(display.dateText).toBeNull();
      expect(display.zoneAbbreviation).toBeNull();
    });

    it("renders the date with the weekday, so a day-ahead zone is obvious", () => {
      expect(
        getClockWidgetDisplay({
          date: INSTANT,
          timezone: "UTC",
          showDate: true,
        }).dateText,
      ).toBe("Mon, Aug 3");
    });

    it("labels the clock from the zone when no label was configured", () => {
      expect(
        getClockWidgetDisplay({ date: INSTANT, timezone: "Asia/Kolkata" })
          .label,
      ).toBe("Kolkata");
    });

    it("keeps the author's label when there is one", () => {
      expect(
        getClockWidgetDisplay({
          date: INSTANT,
          timezone: "Asia/Kolkata",
          label: "Bangalore Team",
        }).label,
      ).toBe("Bangalore Team");
    });

    it("falls back to the viewer's zone and flags it when the saved zone is gone", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      const display: ClockWidgetDisplay = getClockWidgetDisplay({
        date: INSTANT,
        timezone: "Mars/Olympus_Mons",
        hourFormat: ClockWidgetHourFormat.TwentyFourHour,
      });

      expect(display.timezone).toBe(Timezone.UTC.toString());
      expect(display.time).toBe("18:07");
      expect(display.isFallbackTimezone).toBe(true);
    });

    it("does not flag a fallback when the author simply left the zone blank", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      expect(
        getClockWidgetDisplay({ date: INSTANT, timezone: "" })
          .isFallbackTimezone,
      ).toBe(false);
    });

    describe("zone abbreviation", () => {
      it("reports the standard-time abbreviation in winter", () => {
        expect(
          getClockWidgetDisplay({
            date: new Date("2026-01-15T12:00:00.000Z"),
            timezone: "America/New_York",
            showTimezoneAbbreviation: true,
          }).zoneAbbreviation,
        ).toBe("EST");
      });

      it("reports the daylight-time abbreviation in summer", () => {
        expect(
          getClockWidgetDisplay({
            date: INSTANT,
            timezone: "America/New_York",
            showTimezoneAbbreviation: true,
          }).zoneAbbreviation,
        ).toBe("EDT");
      });

      it("prefixes GMT for a zone whose abbreviation is a bare offset", () => {
        expect(
          getClockWidgetDisplay({
            date: INSTANT,
            timezone: "Asia/Kathmandu",
            showTimezoneAbbreviation: true,
          }).zoneAbbreviation,
        ).toBe("GMT+0545");
      });
    });

    describe("across a daylight-saving transition", () => {
      it("jumps from 1:59 to 3:00 when the clocks spring forward", () => {
        const before: ClockWidgetDisplay = getClockWidgetDisplay({
          date: new Date("2026-03-08T06:59:00.000Z"),
          timezone: "America/New_York",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
          showTimezoneAbbreviation: true,
        });
        const after: ClockWidgetDisplay = getClockWidgetDisplay({
          date: new Date("2026-03-08T07:00:00.000Z"),
          timezone: "America/New_York",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
          showTimezoneAbbreviation: true,
        });

        expect(before.time).toBe("01:59");
        expect(before.zoneAbbreviation).toBe("EST");
        expect(after.time).toBe("03:00");
        expect(after.zoneAbbreviation).toBe("EDT");
      });

      it("shows 1:00 twice with different zones when the clocks fall back", () => {
        const firstOnePm: ClockWidgetDisplay = getClockWidgetDisplay({
          date: new Date("2026-11-01T05:00:00.000Z"),
          timezone: "America/New_York",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
          showTimezoneAbbreviation: true,
        });
        const secondOnePm: ClockWidgetDisplay = getClockWidgetDisplay({
          date: new Date("2026-11-01T06:00:00.000Z"),
          timezone: "America/New_York",
          hourFormat: ClockWidgetHourFormat.TwentyFourHour,
          showTimezoneAbbreviation: true,
        });

        expect(firstOnePm.time).toBe("01:00");
        expect(secondOnePm.time).toBe("01:00");
        expect(firstOnePm.zoneAbbreviation).toBe("EDT");
        expect(secondOnePm.zoneAbbreviation).toBe("EST");
      });
    });
  });

  describe("getClockGmtOffsetText", () => {
    it("reports a whole-hour offset without minutes", () => {
      expect(
        getClockGmtOffsetText({ date: INSTANT, timezone: "America/New_York" }),
      ).toBe("GMT-4");
    });

    it("reports a half-hour offset", () => {
      expect(
        getClockGmtOffsetText({ date: INSTANT, timezone: "Asia/Kolkata" }),
      ).toBe("GMT+5:30");
    });

    it("reports a quarter-hour offset", () => {
      expect(
        getClockGmtOffsetText({ date: INSTANT, timezone: "Asia/Kathmandu" }),
      ).toBe("GMT+5:45");
    });

    it("reports UTC as a zero offset", () => {
      expect(getClockGmtOffsetText({ date: INSTANT, timezone: "UTC" })).toBe(
        "GMT+0",
      );
    });

    it("uses the offset in force at that instant, not the one in force today", () => {
      const winter: string = getClockGmtOffsetText({
        date: new Date("2026-01-15T12:00:00.000Z"),
        timezone: "America/New_York",
      });
      const summer: string = getClockGmtOffsetText({
        date: INSTANT,
        timezone: "America/New_York",
      });

      expect(winter).toBe("GMT-5");
      expect(summer).toBe("GMT-4");
    });
  });

  describe("getClockHandAngles", () => {
    function anglesAt(isoString: string): ClockHandAngles {
      return getClockHandAngles({
        date: new Date(isoString),
        timezone: "UTC",
      });
    }

    it("points every hand straight up at midnight", () => {
      const angles: ClockHandAngles = anglesAt("2026-08-03T00:00:00.000Z");

      expect(angles.hourAngleInDegrees).toBeCloseTo(0);
      expect(angles.minuteAngleInDegrees).toBeCloseTo(0);
      expect(angles.secondAngleInDegrees).toBeCloseTo(0);
    });

    it("puts the hour hand at a right angle at 3 o'clock", () => {
      expect(
        anglesAt("2026-08-03T03:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(90);
    });

    it("puts the hour hand straight down at 6 o'clock", () => {
      expect(
        anglesAt("2026-08-03T06:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(180);
    });

    it("puts the hour hand at three quarters at 9 o'clock", () => {
      expect(
        anglesAt("2026-08-03T09:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(270);
    });

    it("wraps a 12-hour dial back to the top at noon", () => {
      expect(
        anglesAt("2026-08-03T12:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(0);
    });

    it("treats the afternoon as its morning equivalent on a 12-hour dial", () => {
      expect(
        anglesAt("2026-08-03T15:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(90);
      expect(
        anglesAt("2026-08-03T21:00:00.000Z").hourAngleInDegrees,
      ).toBeCloseTo(270);
    });

    it("carries the hour hand half-way between the hours at half past", () => {
      const angles: ClockHandAngles = anglesAt("2026-08-03T01:30:00.000Z");

      expect(angles.hourAngleInDegrees).toBeCloseTo(45);
      expect(angles.minuteAngleInDegrees).toBeCloseTo(180);
    });

    it("creeps the minute hand forward with the seconds", () => {
      const angles: ClockHandAngles = anglesAt("2026-08-03T00:00:30.000Z");

      expect(angles.minuteAngleInDegrees).toBeCloseTo(3);
      expect(angles.secondAngleInDegrees).toBeCloseTo(180);
    });

    it("creeps the hour hand forward with the seconds too", () => {
      expect(
        anglesAt("2026-08-03T00:00:30.000Z").hourAngleInDegrees,
      ).toBeCloseTo(0.25);
    });

    it("moves the second hand six degrees per second", () => {
      expect(
        anglesAt("2026-08-03T00:00:01.000Z").secondAngleInDegrees,
      ).toBeCloseTo(6);
      expect(
        anglesAt("2026-08-03T00:00:59.000Z").secondAngleInDegrees,
      ).toBeCloseTo(354);
    });

    it("ignores sub-second time so the second hand ticks rather than sweeps", () => {
      expect(
        anglesAt("2026-08-03T00:00:01.900Z").secondAngleInDegrees,
      ).toBeCloseTo(6);
    });

    it("keeps every hand inside a single turn at any instant of the day", () => {
      for (let hour: number = 0; hour < 24; hour++) {
        const angles: ClockHandAngles = anglesAt(
          `2026-08-03T${String(hour).padStart(2, "0")}:59:59.000Z`,
        );

        for (const angle of [
          angles.hourAngleInDegrees,
          angles.minuteAngleInDegrees,
          angles.secondAngleInDegrees,
        ]) {
          expect(angle).toBeGreaterThanOrEqual(0);
          expect(angle).toBeLessThan(360);
        }
      }
    });

    it("reads the hands in the configured zone, not the viewer's", () => {
      const utc: ClockHandAngles = getClockHandAngles({
        date: INSTANT,
        timezone: "UTC",
      });
      const kolkata: ClockHandAngles = getClockHandAngles({
        date: INSTANT,
        timezone: "Asia/Kolkata",
      });

      // 18:07 UTC is 23:37 in Kolkata — a different dial position entirely.
      expect(utc.hourAngleInDegrees).not.toBeCloseTo(
        kolkata.hourAngleInDegrees,
      );
      expect(kolkata.minuteAngleInDegrees).toBeCloseTo((37 + 9 / 60) * 6);
    });

    it("offsets the hour hand by the half hour on a half-hour zone", () => {
      const angles: ClockHandAngles = getClockHandAngles({
        date: new Date("2026-08-03T06:30:00.000Z"),
        timezone: "Asia/Kolkata",
      });

      // 06:30 UTC is 12:00 in Kolkata — straight up.
      expect(angles.hourAngleInDegrees).toBeCloseTo(0);
      expect(angles.minuteAngleInDegrees).toBeCloseTo(0);
    });
  });

  describe("getMillisecondsUntilNextClockTick", () => {
    it("waits only the remainder of the current second when showing seconds", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:09.500Z"),
          showSeconds: true,
        }),
      ).toBe(500);
    });

    it("waits a single millisecond at the very end of a second", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:09.999Z"),
          showSeconds: true,
        }),
      ).toBe(1);
    });

    it("waits a whole second when landing exactly on a second boundary", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:09.000Z"),
          showSeconds: true,
        }),
      ).toBe(1000);
    });

    it("waits for the next minute boundary when seconds are hidden", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:09.500Z"),
          showSeconds: false,
        }),
      ).toBe(50500);
    });

    it("waits a whole minute when landing exactly on a minute boundary", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:00.000Z"),
          showSeconds: false,
        }),
      ).toBe(60000);
    });

    it("treats an absent showSeconds as minute cadence", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("2026-08-03T18:07:09.500Z"),
        }),
      ).toBe(50500);
    });

    it("stays positive for an instant before 1970, where the remainder is negative", () => {
      const delay: number = getMillisecondsUntilNextClockTick({
        date: new Date("1969-07-20T20:17:40.500Z"),
        showSeconds: true,
      });

      expect(delay).toBe(500);
    });

    it("never returns zero, so the caller can never schedule a spinning timer", () => {
      for (let ms: number = 0; ms < 1000; ms += 37) {
        const delay: number = getMillisecondsUntilNextClockTick({
          date: new Date(Date.UTC(2026, 7, 3, 18, 7, 9, ms)),
          showSeconds: true,
        });

        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    it("keeps the minute cadence inside one minute for every second of it", () => {
      for (let second: number = 0; second < 60; second++) {
        const delay: number = getMillisecondsUntilNextClockTick({
          date: new Date(Date.UTC(2026, 7, 3, 18, 7, second, 250)),
          showSeconds: false,
        });

        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(60000);
      }
    });

    it("falls back to a full period for an Invalid Date instead of a NaN delay", () => {
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("not a date"),
          showSeconds: true,
        }),
      ).toBe(1000);
      expect(
        getMillisecondsUntilNextClockTick({
          date: new Date("not a date"),
          showSeconds: false,
        }),
      ).toBe(60000);
    });

    it("lands exactly on the boundary when the delay is applied", () => {
      const start: Date = new Date("2026-08-03T18:07:09.123Z");
      const delay: number = getMillisecondsUntilNextClockTick({
        date: start,
        showSeconds: true,
      });

      expect(new Date(start.getTime() + delay).toISOString()).toBe(
        "2026-08-03T18:07:10.000Z",
      );
    });
  });

  describe("isDaytimeAtClock", () => {
    it("calls 06:00 the start of the day", () => {
      expect(
        isDaytimeAtClock({
          date: new Date("2026-08-03T06:00:00.000Z"),
          timezone: "UTC",
        }),
      ).toBe(true);
    });

    it("still calls 05:59 night", () => {
      expect(
        isDaytimeAtClock({
          date: new Date("2026-08-03T05:59:59.000Z"),
          timezone: "UTC",
        }),
      ).toBe(false);
    });

    it("still calls 17:59 day", () => {
      expect(
        isDaytimeAtClock({
          date: new Date("2026-08-03T17:59:59.000Z"),
          timezone: "UTC",
        }),
      ).toBe(true);
    });

    it("calls 18:00 the start of the night", () => {
      expect(
        isDaytimeAtClock({
          date: new Date("2026-08-03T18:00:00.000Z"),
          timezone: "UTC",
        }),
      ).toBe(false);
    });

    it("answers differently for two zones at the same instant", () => {
      // 18:07 UTC: afternoon in New York, the small hours in Sydney.
      expect(
        isDaytimeAtClock({ date: INSTANT, timezone: "America/New_York" }),
      ).toBe(true);
      expect(
        isDaytimeAtClock({ date: INSTANT, timezone: "Australia/Sydney" }),
      ).toBe(false);
    });

    it("falls back to the viewer's zone for an unusable one", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      expect(
        isDaytimeAtClock({ date: INSTANT, timezone: "Mars/Olympus_Mons" }),
      ).toBe(false);
    });
  });

  describe("resolveClockFace", () => {
    it("keeps an explicit analog choice", () => {
      expect(resolveClockFace(ClockWidgetFace.Analog)).toBe(
        ClockWidgetFace.Analog,
      );
    });

    it("keeps an explicit digital choice", () => {
      expect(resolveClockFace(ClockWidgetFace.Digital)).toBe(
        ClockWidgetFace.Digital,
      );
    });

    it("defaults to digital for a config that predates the setting", () => {
      expect(resolveClockFace(undefined)).toBe(ClockWidgetFace.Digital);
      expect(resolveClockFace(null)).toBe(ClockWidgetFace.Digital);
    });

    it("defaults to digital rather than rendering nothing for a junk value", () => {
      expect(resolveClockFace("Sundial" as unknown as ClockWidgetFace)).toBe(
        ClockWidgetFace.Digital,
      );
    });
  });

  describe("getClockTimeWidthInFontUnits", () => {
    it("charges full width for the digits themselves", () => {
      expect(
        getClockTimeWidthInFontUnits(makeDisplay({ time: "18:07" })),
      ).toBeCloseTo(5 * 0.62);
    });

    it("charges a longer time string more", () => {
      expect(
        getClockTimeWidthInFontUnits(makeDisplay({ time: "9:07" })),
      ).toBeLessThan(
        getClockTimeWidthInFontUnits(makeDisplay({ time: "18:07" })),
      );
    });

    it("charges seconds and the meridiem at the reduced size", () => {
      const bare: number = getClockTimeWidthInFontUnits(
        makeDisplay({ seconds: null, meridiem: null }),
      );
      const withSeconds: number = getClockTimeWidthInFontUnits(
        makeDisplay({ seconds: "09", meridiem: null }),
      );

      // ":" + "09" = 3 characters, charged at the secondary scale.
      expect(withSeconds - bare).toBeCloseTo(
        3 * CLOCK_SECONDARY_FONT_SCALE * 0.62,
      );
    });

    it("charges for both the seconds and the meridiem when both are shown", () => {
      const bare: number = getClockTimeWidthInFontUnits(
        makeDisplay({ seconds: null, meridiem: null }),
      );
      const both: number = getClockTimeWidthInFontUnits(
        makeDisplay({ seconds: "09", meridiem: "PM" }),
      );

      expect(both).toBeGreaterThan(bare);
    });
  });

  describe("getClockDigitalFontSizeInPx", () => {
    it("fills a generous tile up to the maximum size", () => {
      expect(
        getClockDigitalFontSizeInPx({
          widthInPx: 400,
          heightInPx: 400,
          display: makeDisplay(),
        }),
      ).toBe(MAX_FONT_SIZE_IN_PX);
    });

    it("never exceeds the maximum however large the tile is", () => {
      expect(
        getClockDigitalFontSizeInPx({
          widthInPx: 4000,
          heightInPx: 4000,
          display: makeDisplay(),
        }),
      ).toBe(MAX_FONT_SIZE_IN_PX);
    });

    it("never drops below the readable minimum however small the tile is", () => {
      expect(
        getClockDigitalFontSizeInPx({
          widthInPx: 10,
          heightInPx: 10,
          display: makeDisplay(),
        }),
      ).toBe(MIN_FONT_SIZE_IN_PX);
    });

    it("survives a zero-sized tile during the first layout pass", () => {
      expect(
        getClockDigitalFontSizeInPx({
          widthInPx: 0,
          heightInPx: 0,
          display: makeDisplay(),
        }),
      ).toBe(MIN_FONT_SIZE_IN_PX);
    });

    it("shrinks the digits when the tile gets narrower", () => {
      const wide: number = getClockDigitalFontSizeInPx({
        widthInPx: 240,
        heightInPx: 240,
        display: makeDisplay(),
      });
      const narrow: number = getClockDigitalFontSizeInPx({
        widthInPx: 120,
        heightInPx: 240,
        display: makeDisplay(),
      });

      expect(narrow).toBeLessThan(wide);
    });

    it("shrinks the digits when the tile gets shorter", () => {
      const tall: number = getClockDigitalFontSizeInPx({
        widthInPx: 400,
        heightInPx: 120,
        display: makeDisplay(),
      });
      const short: number = getClockDigitalFontSizeInPx({
        widthInPx: 400,
        heightInPx: 70,
        display: makeDisplay(),
      });

      expect(short).toBeLessThan(tall);
    });

    it("leaves less room for the digits as more caption lines are switched on", () => {
      /*
       * Height 110 keeps all three variants strictly between the 14px floor
       * and the 64px ceiling, so the caption lines are what actually decides
       * the size. Outside that band a clamp would make the comparison pass
       * vacuously.
       */
      const bare: number = getClockDigitalFontSizeInPx({
        widthInPx: 400,
        heightInPx: 110,
        display: makeDisplay({ dateText: null, zoneAbbreviation: null }),
      });
      const withDate: number = getClockDigitalFontSizeInPx({
        widthInPx: 400,
        heightInPx: 110,
        display: makeDisplay({ zoneAbbreviation: null }),
      });
      const withBoth: number = getClockDigitalFontSizeInPx({
        widthInPx: 400,
        heightInPx: 110,
        display: makeDisplay(),
      });

      expect(bare).toBeLessThan(MAX_FONT_SIZE_IN_PX);
      expect(withBoth).toBeGreaterThan(MIN_FONT_SIZE_IN_PX);

      /*
       * Each caption costs its own line plus the gap above it, and the time
       * row is line-height taller than its font size — so the font gives up
       * (line + gap) / lineHeight per caption.
       */
      const stepInPx: number =
        (SECONDARY_LINE_HEIGHT_IN_PX + ROW_GAP_IN_PX) / TIME_LINE_HEIGHT_RATIO;

      expect(withDate).toBeCloseTo(bare - stepInPx);
      expect(withBoth).toBeCloseTo(withDate - stepInPx);
    });

    it("shrinks the digits once seconds are added to a width-bound tile", () => {
      const withoutSeconds: number = getClockDigitalFontSizeInPx({
        widthInPx: 150,
        heightInPx: 400,
        display: makeDisplay({ seconds: null }),
      });
      const withSeconds: number = getClockDigitalFontSizeInPx({
        widthInPx: 150,
        heightInPx: 400,
        display: makeDisplay({ seconds: "09" }),
      });

      expect(withSeconds).toBeLessThan(withoutSeconds);
    });

    it("keeps the rendered time inside the tile width whenever it is not clamped", () => {
      const displays: Array<ClockWidgetDisplay> = [
        makeDisplay(),
        makeDisplay({ seconds: "09" }),
        makeDisplay({ time: "11:52", seconds: "09", meridiem: "PM" }),
        makeDisplay({ time: "9:07", meridiem: "AM" }),
      ];

      for (const display of displays) {
        for (const widthInPx of [120, 180, 240, 320, 480]) {
          const fontSizeInPx: number = getClockDigitalFontSizeInPx({
            widthInPx: widthInPx,
            heightInPx: 400,
            display: display,
          });

          if (fontSizeInPx <= MIN_FONT_SIZE_IN_PX) {
            // Legibility wins over fitting; the renderer truncates instead.
            continue;
          }

          const renderedWidthInPx: number =
            fontSizeInPx * getClockTimeWidthInFontUnits(display);

          expect(renderedWidthInPx).toBeLessThanOrEqual(
            widthInPx - CHROME_HORIZONTAL_IN_PX - HORIZONTAL_PADDING_IN_PX,
          );
        }
      }
    });

    it("keeps the digits inside the height left over by the caption lines", () => {
      const display: ClockWidgetDisplay = makeDisplay();
      const heightInPx: number = 160;

      const fontSizeInPx: number = getClockDigitalFontSizeInPx({
        widthInPx: 4000,
        heightInPx: heightInPx,
        display: display,
      });

      expect(
        renderedStackHeightInPx(display, fontSizeInPx),
      ).toBeLessThanOrEqual(heightInPx - CHROME_VERTICAL_IN_PX);
    });

    /*
     * The invariant that matters: whatever the tile size, the stack the
     * renderer builds has to fit the padded content box, or the tile's
     * overflow-hidden silently eats the bottom line. The MIN clamp is the one
     * documented exception — below that we keep the digits legible and let
     * the caller truncate instead.
     */
    it("never builds a stack taller than the content box it has to fit", () => {
      const displays: Array<ClockWidgetDisplay> = [
        makeDisplay(),
        makeDisplay({ dateText: null }),
        makeDisplay({ dateText: null, zoneAbbreviation: null }),
        makeDisplay({ seconds: "09", meridiem: "PM" }),
        makeDisplay({ isFallbackTimezone: true }),
        makeDisplay({
          seconds: "09",
          meridiem: "PM",
          isFallbackTimezone: true,
        }),
      ];

      for (const display of displays) {
        for (const heightInPx of [60, 80, 100, 140, 200, 260, 360, 520]) {
          for (const isEditMode of [false, true]) {
            const fontSizeInPx: number = getClockDigitalFontSizeInPx({
              widthInPx: 540,
              heightInPx: heightInPx,
              display: display,
              isEditMode: isEditMode,
            });

            if (fontSizeInPx <= MIN_FONT_SIZE_IN_PX) {
              continue;
            }

            const contentHeightInPx: number =
              heightInPx -
              (isEditMode
                ? CHROME_VERTICAL_EDIT_MODE_IN_PX
                : CHROME_VERTICAL_IN_PX);

            expect(
              renderedStackHeightInPx(display, fontSizeInPx),
            ).toBeLessThanOrEqual(contentHeightInPx);
          }
        }
      }
    });

    /*
     * The canvas reports the OUTER tile size while the widget draws inside
     * DashboardBaseComponent's padding. Sizing against the outer box pushed
     * the last caption line past the tile's overflow-hidden edge — most
     * visible on a short, wide strip.
     */
    it("sizes against the padded content box, not the outer tile", () => {
      const display: ClockWidgetDisplay = makeDisplay();
      // 130 keeps the result off both clamps so the arithmetic is observable.
      const heightInPx: number = 130;

      const outerSized: number = getClockDigitalFontSizeInPx({
        widthInPx: 4000,
        heightInPx: heightInPx,
        display: display,
      });
      const asIfNoChrome: number = getClockDigitalFontSizeInPx({
        widthInPx: 4000,
        heightInPx: heightInPx + CHROME_VERTICAL_IN_PX,
        display: display,
      });

      // The chrome costs exactly its own height, no more and no less.
      expect(asIfNoChrome).toBeGreaterThan(outerSized);
      expect(renderedStackHeightInPx(display, outerSized)).toBeLessThanOrEqual(
        heightInPx - CHROME_VERTICAL_IN_PX,
      );
    });

    it("gives up more height in edit mode, where the drag handle sits", () => {
      const display: ClockWidgetDisplay = makeDisplay();

      const viewing: number = getClockDigitalFontSizeInPx({
        widthInPx: 4000,
        heightInPx: 130,
        display: display,
      });
      const editing: number = getClockDigitalFontSizeInPx({
        widthInPx: 4000,
        heightInPx: 130,
        display: display,
        isEditMode: true,
      });

      expect(viewing).toBeLessThan(MAX_FONT_SIZE_IN_PX);
      expect(viewing - editing).toBeCloseTo(
        (CHROME_VERTICAL_EDIT_MODE_IN_PX - CHROME_VERTICAL_IN_PX) /
          TIME_LINE_HEIGHT_RATIO,
      );
    });

    it("fits everything a 6x1 strip has to show without clipping a line", () => {
      /*
       * The regression this guards: a 540x80 strip showing label + time +
       * zone had its zone line clipped, because the digits were sized as if
       * the full 80px were available and as if the time row were exactly its
       * font size tall.
       */
      const display: ClockWidgetDisplay = makeDisplay({ dateText: null });

      const fontSizeInPx: number = getClockDigitalFontSizeInPx({
        widthInPx: 540,
        heightInPx: 80,
        display: display,
      });

      expect(
        renderedStackHeightInPx(display, fontSizeInPx),
      ).toBeLessThanOrEqual(80 - CHROME_VERTICAL_IN_PX);
    });
  });

  describe("getClockContentBox", () => {
    it("subtracts the widget chrome from the outer tile", () => {
      expect(getClockContentBox({ widthInPx: 300, heightInPx: 200 })).toEqual({
        widthInPx: 300 - CHROME_HORIZONTAL_IN_PX,
        heightInPx: 200 - CHROME_VERTICAL_IN_PX,
      });
    });

    it("subtracts the taller chrome in edit mode, where the drag handle sits", () => {
      expect(
        getClockContentBox({
          widthInPx: 300,
          heightInPx: 200,
          isEditMode: true,
        }),
      ).toEqual({
        widthInPx: 300 - CHROME_HORIZONTAL_IN_PX,
        heightInPx: 200 - CHROME_VERTICAL_EDIT_MODE_IN_PX,
      });
    });

    it("never reports a negative box for a tile smaller than its own chrome", () => {
      const box: ClockContentBox = getClockContentBox({
        widthInPx: 4,
        heightInPx: 4,
        isEditMode: true,
      });

      expect(box.widthInPx).toBe(0);
      expect(box.heightInPx).toBe(0);
    });

    it("survives a zero-sized tile during the first layout pass", () => {
      expect(getClockContentBox({ widthInPx: 0, heightInPx: 0 })).toEqual({
        widthInPx: 0,
        heightInPx: 0,
      });
    });
  });

  describe("getClockAnalogDialSizeInPx", () => {
    it("fits the dial to the shorter side of the tile", () => {
      expect(
        getClockAnalogDialSizeInPx({
          widthInPx: 400,
          heightInPx: 200,
          display: makeDisplay({ dateText: null, zoneAbbreviation: null }),
        }),
      ).toBe(
        200 -
          CHROME_VERTICAL_IN_PX -
          (SECONDARY_LINE_HEIGHT_IN_PX + ROW_GAP_IN_PX) -
          VERTICAL_PADDING_IN_PX,
      );
    });

    it("is bound by the width on a wide-but-short tile's narrow sibling", () => {
      expect(
        getClockAnalogDialSizeInPx({
          widthInPx: 120,
          heightInPx: 400,
          display: makeDisplay({ dateText: null, zoneAbbreviation: null }),
        }),
      ).toBe(120 - CHROME_HORIZONTAL_IN_PX - HORIZONTAL_PADDING_IN_PX);
    });

    it("shrinks the dial in edit mode, where the drag handle takes the top", () => {
      const viewing: number = getClockAnalogDialSizeInPx({
        widthInPx: 400,
        heightInPx: 300,
        display: makeDisplay(),
      });
      const editing: number = getClockAnalogDialSizeInPx({
        widthInPx: 400,
        heightInPx: 300,
        display: makeDisplay(),
        isEditMode: true,
      });

      expect(viewing - editing).toBe(
        CHROME_VERTICAL_EDIT_MODE_IN_PX - CHROME_VERTICAL_IN_PX,
      );
    });

    it("gives back the height taken by each caption line", () => {
      const bare: number = getClockAnalogDialSizeInPx({
        widthInPx: 400,
        heightInPx: 300,
        display: makeDisplay({ dateText: null, zoneAbbreviation: null }),
      });
      const withBoth: number = getClockAnalogDialSizeInPx({
        widthInPx: 400,
        heightInPx: 300,
        display: makeDisplay(),
      });

      expect(bare - withBoth).toBe(
        2 * (SECONDARY_LINE_HEIGHT_IN_PX + ROW_GAP_IN_PX),
      );
    });

    it("never collapses below a legible dial on a tiny tile", () => {
      expect(
        getClockAnalogDialSizeInPx({
          widthInPx: 20,
          heightInPx: 20,
          display: makeDisplay(),
        }),
      ).toBe(MIN_DIAL_SIZE_IN_PX);
    });

    it("survives a zero-sized tile during the first layout pass", () => {
      expect(
        getClockAnalogDialSizeInPx({
          widthInPx: 0,
          heightInPx: 0,
          display: makeDisplay(),
        }),
      ).toBe(MIN_DIAL_SIZE_IN_PX);
    });
  });
});
