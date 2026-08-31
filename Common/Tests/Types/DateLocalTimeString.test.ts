/** @timezone America/Los_Angeles */
/**
 * The clock reading behind every timestamp on the Logs / Traces / Metrics
 * explorers - histogram x-axis ticks, histogram tooltips, span rows.
 *
 * Those sites used to call `date.toLocaleTimeString([], { hour12: false })`
 * directly, which pinned them to a 24-hour clock and to the zone the browser
 * process happens to run in. So a user whose computer keeps an AM/PM clock
 * read "14:30" off a chart, and a user who had set a timezone in User
 * Settings read a chart that disagreed with the log rows underneath it - in
 * one Logs explorer the table's Time column and the histogram directly above
 * it were formatted by two different rules.
 *
 * The docblock above pins the *browser* zone to Los Angeles and every case
 * below configures a different zone, so a helper that quietly fell back to the
 * process zone fails rather than passing by coincidence.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const UTC: Timezone = Timezone.UTC;
const NEW_YORK: Timezone = Timezone.AmericaNew_York;
const KOLKATA: Timezone = Timezone.AsiaKolkata;

/** 14:30 UTC - an afternoon, so a 12-hour clock has real work to do. */
const AFTERNOON: Date = new Date("2024-03-01T14:30:45.000Z");

type Options = {
  includeMinutes?: boolean;
  includeSeconds?: boolean;
  use12HourFormat?: boolean | undefined;
};

function format(date: Date, options?: Options): string {
  return OneUptimeDate.getLocalTimeString(date, options);
}

afterEach(() => {
  // Never leak a pinned zone or a mocked preference into the rest of the suite.
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("OneUptimeDate.getLocalTimeString", () => {
  /*
   * The chart x-axes in UI/Components/Charts/Utils/XAxis.ts label ticks with
   * this helper and are laid out for the fixed width of a 24-hour reading.
   * They pass no preference, so the default has to stay where it was - these
   * two cases are what makes the new option opt-in rather than a behaviour
   * change for all nine of its existing callers.
   */
  describe("with no preference passed", () => {
    it("keeps the 24-hour reading it has always produced", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(format(AFTERNOON)).toBe("14:30");
    });

    it("does not consult the machine's clock preference at all", () => {
      OneUptimeDate.setUserTimezone(UTC);

      jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat");

      format(AFTERNOON);

      expect(OneUptimeDate.getUserPrefers12HourFormat).not.toHaveBeenCalled();
    });

    it("zero-pads the hour so ticks stay the same width", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(format(new Date("2024-03-01T09:05:00.000Z"))).toBe("09:05");
      expect(format(new Date("2024-03-01T00:00:00.000Z"))).toBe("00:00");
    });

    it("appends seconds only when asked", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(format(AFTERNOON, { includeSeconds: true })).toBe("14:30:45");
    });

    it("returns the bare hour when minutes are turned off", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(format(AFTERNOON, { includeMinutes: false })).toBe("14");
    });
  });

  describe("on a 12-hour clock", () => {
    it("marks an afternoon time PM", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(format(AFTERNOON, { use12HourFormat: true })).toBe("2:30 PM");
    });

    it("marks a morning time AM", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        format(new Date("2024-03-01T09:05:00.000Z"), {
          use12HourFormat: true,
        }),
      ).toBe("9:05 AM");
    });

    // The two readings a naive `hours % 12` gets wrong.
    it("writes midnight as 12 AM rather than 0 AM", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        format(new Date("2024-03-01T00:00:00.000Z"), {
          use12HourFormat: true,
        }),
      ).toBe("12:00 AM");
    });

    it("writes noon as 12 PM rather than 0 PM", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        format(new Date("2024-03-01T12:00:00.000Z"), {
          use12HourFormat: true,
        }),
      ).toBe("12:00 PM");
    });

    it("keeps the marker after the seconds", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        format(AFTERNOON, { use12HourFormat: true, includeSeconds: true }),
      ).toBe("2:30:45 PM");
    });

    it("keeps the marker on a bare hour", () => {
      OneUptimeDate.setUserTimezone(UTC);

      expect(
        format(AFTERNOON, { use12HourFormat: true, includeMinutes: false }),
      ).toBe("2 PM");
    });
  });

  /*
   * The browser here is in Los Angeles (see the docblock). None of the
   * readings below are the Los Angeles ones, which is the point.
   */
  describe("reading the configured timezone rather than the browser's", () => {
    it("shifts a whole-hour offset", () => {
      OneUptimeDate.setUserTimezone(NEW_YORK);

      expect(format(AFTERNOON)).toBe("09:30");
      expect(format(AFTERNOON, { use12HourFormat: true })).toBe("9:30 AM");
    });

    it("shifts a half-hour offset", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      expect(format(AFTERNOON)).toBe("20:00");
      expect(format(AFTERNOON, { use12HourFormat: true })).toBe("8:00 PM");
    });

    it("crosses the date line into the next day", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      // 23:00 UTC is already 04:30 the following morning in Kolkata.
      expect(format(new Date("2024-03-01T23:00:00.000Z"))).toBe("04:30");
    });

    it("falls back to the browser zone when nothing is configured", () => {
      OneUptimeDate.setUserTimezone(null);

      // 14:30 UTC is 06:30 in Los Angeles on a March morning (PST, UTC-8).
      expect(format(AFTERNOON)).toBe("06:30");
    });
  });
});

/*
 * "Is this bucket today?" is what the histogram tooltips ask before deciding
 * whether a timestamp needs its date spelled out. They used to ask it with
 * `date.toDateString() === now.toDateString()`, which compares calendar days
 * in the browser's zone - so within a few hours of midnight in the configured
 * zone the date got dropped from buckets that needed it and added to buckets
 * that did not.
 */
describe("OneUptimeDate.areOnTheSameLocalDay", () => {
  const BEFORE_MIDNIGHT_IN_KOLKATA: Date = new Date("2024-03-01T18:00:00.000Z");
  const AFTER_MIDNIGHT_IN_KOLKATA: Date = new Date("2024-03-01T19:00:00.000Z");

  it("separates two instants that straddle midnight in the configured zone", () => {
    OneUptimeDate.setUserTimezone(KOLKATA);

    /*
     * 23:30 and 00:30 in Kolkata - two different days there, one hour apart.
     * Both are still the same Friday morning in Los Angeles, which is exactly
     * the disagreement the browser-zone comparison could not see.
     */
    expect(
      OneUptimeDate.areOnTheSameLocalDay(
        BEFORE_MIDNIGHT_IN_KOLKATA,
        AFTER_MIDNIGHT_IN_KOLKATA,
      ),
    ).toBe(false);

    expect(
      OneUptimeDate.areOnTheSameDay(
        BEFORE_MIDNIGHT_IN_KOLKATA,
        AFTER_MIDNIGHT_IN_KOLKATA,
      ),
    ).toBe(true);
  });

  it("joins two instants the browser's zone splits across midnight", () => {
    OneUptimeDate.setUserTimezone(KOLKATA);

    // 07:30 and 21:30 on the same Kolkata day; Feb 29 and Mar 1 in Los Angeles.
    const morning: Date = new Date("2024-03-01T02:00:00.000Z");
    const evening: Date = new Date("2024-03-01T16:00:00.000Z");

    expect(OneUptimeDate.areOnTheSameLocalDay(morning, evening)).toBe(true);
    expect(OneUptimeDate.areOnTheSameDay(morning, evening)).toBe(false);
  });

  it("accepts the string form the histogram buckets arrive as", () => {
    OneUptimeDate.setUserTimezone(UTC);

    expect(
      OneUptimeDate.areOnTheSameLocalDay(
        "2024-03-01T00:30:00.000Z",
        "2024-03-01T23:30:00.000Z",
      ),
    ).toBe(true);
  });

  it("falls back to the browser zone when nothing is configured", () => {
    OneUptimeDate.setUserTimezone(null);

    /*
     * 16:00 and 20:00 UTC are 08:00 and 12:00 the same Los Angeles day, but
     * two different UTC-relative readings - the browser's zone is the one
     * that gets to answer when the user has configured none.
     */
    expect(
      OneUptimeDate.areOnTheSameLocalDay(
        new Date("2024-03-01T16:00:00.000Z"),
        new Date("2024-03-01T20:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      OneUptimeDate.areOnTheSameLocalDay(
        new Date("2024-03-01T02:00:00.000Z"),
        new Date("2024-03-01T16:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
