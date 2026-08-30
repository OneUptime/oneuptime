/**
 * The compact "Mar 1, 2:30 PM" label the metrics / traces / logs time range
 * picker puts on its button once a custom window is applied.
 *
 * The bug these lock in: the picker read the digits straight off the Date
 * (`date.getHours().padStart(2, "0")`), so the label was always on a 24-hour
 * clock and always in whatever zone the browser process happened to be in. A
 * user whose computer is set to AM/PM picked "1 Mar, 2:30 PM" and got back a
 * button reading "Mar 1, 14:30" — and a user who had set a different timezone
 * in User Settings got a label that disagreed with every other date on screen.
 *
 * Every case here pins the timezone explicitly and passes `use12HourFormat`
 * rather than letting the host machine decide, so the assertions hold under
 * whatever TZ and locale the suite runs in. Detection of the machine's own
 * preference is covered separately in DateUserPrefers12HourFormat.test.ts.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const UTC: Timezone = Timezone.UTC;
const NEW_YORK: Timezone = Timezone.AmericaNew_York;
const KOLKATA: Timezone = Timezone.AsiaKolkata;

type FormatFunction = (
  isoString: string,
  options?: {
    use12HourFormat?: boolean | undefined;
    includeSeconds?: boolean | undefined;
  },
) => string;

const format: FormatFunction = (
  isoString: string,
  options?: {
    use12HourFormat?: boolean | undefined;
    includeSeconds?: boolean | undefined;
  },
): string => {
  return OneUptimeDate.getDateAsLocalShortDateTimeString(
    new Date(isoString),
    options,
  );
};

describe("OneUptimeDate.getDateAsLocalShortDateTimeString", () => {
  afterEach(() => {
    // Never leak a pinned zone or a mocked preference into the rest of the suite.
    OneUptimeDate.setUserTimezone(null);
    jest.restoreAllMocks();
  });

  describe("12-hour clock", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("writes an afternoon time with a PM marker", () => {
      expect(
        format("2024-03-01T14:30:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 2:30 PM");
    });

    it("writes a morning time with an AM marker", () => {
      expect(
        format("2024-03-01T09:05:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 9:05 AM");
    });

    it("writes midnight as 12 AM rather than 0 AM", () => {
      expect(
        format("2024-03-01T00:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 12:00 AM");
    });

    it("keeps the minute after midnight in the AM half", () => {
      expect(
        format("2024-03-01T00:01:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 12:01 AM");
    });

    it("writes noon as 12 PM rather than 0 PM", () => {
      expect(
        format("2024-03-01T12:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 12:00 PM");
    });

    it("keeps the last minute before 1 PM in the 12 PM hour", () => {
      expect(
        format("2024-03-01T12:59:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 12:59 PM");
    });

    it("rolls 13:00 over to 1 PM", () => {
      expect(
        format("2024-03-01T13:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 1:00 PM");
    });

    it("writes the last minute of the day as 11:59 PM", () => {
      expect(
        format("2024-03-01T23:59:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 11:59 PM");
    });

    it("leaves a single-digit hour unpadded", () => {
      /*
       * "09:05 AM" is not how a 12-hour clock is written; the padding only
       * belongs on the 24-hour form, where it keeps the column aligned.
       */
      const label: string = format("2024-03-01T09:05:00.000Z", {
        use12HourFormat: true,
      });

      expect(label).toBe("Mar 1, 9:05 AM");
      expect(label).not.toContain("09:05");
    });

    it("covers every hour of the day with an AM or PM marker", () => {
      const markers: Array<string> = [];

      for (let hour: number = 0; hour < 24; hour++) {
        const isoHour: string = hour.toString().padStart(2, "0");
        const label: string = format(`2024-03-01T${isoHour}:00:00.000Z`, {
          use12HourFormat: true,
        });

        expect(label).toMatch(/^Mar 1, (1[0-2]|[1-9]):00 (AM|PM)$/);
        markers.push(label.slice(-2));
      }

      // Twelve of each, and never a bare 24-hour reading.
      expect(
        markers.filter((marker: string) => {
          return marker === "AM";
        }),
      ).toHaveLength(12);
      expect(
        markers.filter((marker: string) => {
          return marker === "PM";
        }),
      ).toHaveLength(12);
    });
  });

  describe("24-hour clock", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("writes an afternoon time on the 24-hour clock with no marker", () => {
      const label: string = format("2024-03-01T14:30:00.000Z", {
        use12HourFormat: false,
      });

      expect(label).toBe("Mar 1, 14:30");
      expect(label).not.toMatch(/AM|PM/);
    });

    it("pads a single-digit hour", () => {
      expect(
        format("2024-03-01T09:05:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 09:05");
    });

    it("writes midnight as 00:00", () => {
      expect(
        format("2024-03-01T00:00:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 00:00");
    });

    it("writes noon as 12:00", () => {
      expect(
        format("2024-03-01T12:00:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 12:00");
    });

    it("writes the last minute of the day as 23:59", () => {
      expect(
        format("2024-03-01T23:59:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 23:59");
    });

    it("never emits a day period on any hour of the day", () => {
      for (let hour: number = 0; hour < 24; hour++) {
        const isoHour: string = hour.toString().padStart(2, "0");
        const label: string = format(`2024-03-01T${isoHour}:00:00.000Z`, {
          use12HourFormat: false,
        });

        expect(label).toBe(`Mar 1, ${isoHour}:00`);
      }
    });
  });

  describe("seconds", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("is omitted by default", () => {
      expect(
        format("2024-03-01T14:30:45.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 14:30");
    });

    it("sits before the day period on a 12-hour clock", () => {
      expect(
        format("2024-03-01T14:30:45.000Z", {
          use12HourFormat: true,
          includeSeconds: true,
        }),
      ).toBe("Mar 1, 2:30:45 PM");
    });

    it("is appended to a 24-hour clock", () => {
      expect(
        format("2024-03-01T14:30:45.000Z", {
          use12HourFormat: false,
          includeSeconds: true,
        }),
      ).toBe("Mar 1, 14:30:45");
    });

    it("pads a single-digit second", () => {
      expect(
        format("2024-03-01T14:30:05.000Z", {
          use12HourFormat: false,
          includeSeconds: true,
        }),
      ).toBe("Mar 1, 14:30:05");
    });
  });

  describe("the date half", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("leaves the day of the month unpadded", () => {
      expect(
        format("2024-03-01T14:30:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 14:30");
    });

    it("writes a two-digit day as-is", () => {
      expect(
        format("2024-03-21T14:30:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 21, 14:30");
    });

    it("abbreviates every month", () => {
      const months: Array<string> = [];

      for (let month: number = 1; month <= 12; month++) {
        const isoMonth: string = month.toString().padStart(2, "0");
        months.push(
          format(`2024-${isoMonth}-15T12:00:00.000Z`, {
            use12HourFormat: false,
          }),
        );
      }

      expect(months).toEqual([
        "Jan 15, 12:00",
        "Feb 15, 12:00",
        "Mar 15, 12:00",
        "Apr 15, 12:00",
        "May 15, 12:00",
        "Jun 15, 12:00",
        "Jul 15, 12:00",
        "Aug 15, 12:00",
        "Sep 15, 12:00",
        "Oct 15, 12:00",
        "Nov 15, 12:00",
        "Dec 15, 12:00",
      ]);
    });

    it("carries no year, which is what keeps the label short", () => {
      expect(
        format("2024-03-01T14:30:00.000Z", { use12HourFormat: false }),
      ).not.toMatch(/2024/);
    });
  });

  describe("timezone", () => {
    it("reads the wall clock in the timezone the user configured", () => {
      OneUptimeDate.setUserTimezone(NEW_YORK);

      // 02:30 UTC on 1 Mar is 21:30 the previous evening in New York (EST).
      expect(
        format("2024-03-01T02:30:00.000Z", { use12HourFormat: true }),
      ).toBe("Feb 29, 9:30 PM");
    });

    it("moves the date as well as the time when the zone crosses midnight", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      // 20:00 UTC is 01:30 the next morning at +05:30.
      expect(
        format("2024-03-01T20:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 2, 1:30 AM");
    });

    it("gives a different label for the same instant in a different zone", () => {
      const instant: string = "2024-03-01T20:00:00.000Z";

      OneUptimeDate.setUserTimezone(UTC);
      const inUtc: string = format(instant, { use12HourFormat: false });

      OneUptimeDate.setUserTimezone(KOLKATA);
      const inKolkata: string = format(instant, { use12HourFormat: false });

      expect(inUtc).toBe("Mar 1, 20:00");
      expect(inKolkata).toBe("Mar 2, 01:30");
    });

    it("follows a zone change without the instant moving", () => {
      const instant: Date = new Date("2024-07-04T16:00:00.000Z");

      OneUptimeDate.setUserTimezone(UTC);
      expect(
        OneUptimeDate.getDateAsLocalShortDateTimeString(instant, {
          use12HourFormat: true,
        }),
      ).toBe("Jul 4, 4:00 PM");

      OneUptimeDate.setUserTimezone(NEW_YORK);
      expect(
        OneUptimeDate.getDateAsLocalShortDateTimeString(instant, {
          use12HourFormat: true,
        }),
      ).toBe("Jul 4, 12:00 PM");

      // The Date itself was never mutated.
      expect(instant.toISOString()).toBe("2024-07-04T16:00:00.000Z");
    });

    it("falls back to the zone the browser reports when none is configured", () => {
      OneUptimeDate.setUserTimezone(null);

      /*
       * The digits depend on the zone the suite runs under, so derive the
       * expectation the same way - anchored to moment.tz.guess() rather than
       * to a literal. A shape-only regex would have accepted a hardcoded UTC,
       * which is the mistake this guards.
       */
      const instant: string = "2024-03-01T14:30:00.000Z";
      const expected: string = moment(new Date(instant))
        .tz(moment.tz.guess())
        .format("MMM D, HH:mm");

      expect(format(instant, { use12HourFormat: false })).toBe(expected);
    });

    it("does not silently render in UTC when no zone is configured", () => {
      /*
       * Pin the fallback against the specific wrong answer: hardcoding UTC
       * passes every other case in this file, because they all set a zone.
       */
      OneUptimeDate.setUserTimezone(null);

      const instant: string = "2024-03-01T14:30:00.000Z";
      const inUtc: string = moment(new Date(instant))
        .tz("UTC")
        .format("MMM D, HH:mm");
      const inGuessedZone: string = moment(new Date(instant))
        .tz(moment.tz.guess())
        .format("MMM D, HH:mm");

      if (inGuessedZone === inUtc) {
        /*
         * The suite is running on a zone that agrees with UTC at this instant,
         * so it cannot tell the two apart. Assert against a zone that never
         * does instead.
         */
        OneUptimeDate.setUserTimezone(KOLKATA);
        expect(format(instant, { use12HourFormat: false })).not.toBe(inUtc);
        return;
      }

      expect(format(instant, { use12HourFormat: false })).toBe(inGuessedZone);
      expect(format(instant, { use12HourFormat: false })).not.toBe(inUtc);
    });
  });

  describe("daylight saving", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(NEW_YORK);
    });

    it("reads the minute before a spring-forward jump on standard time", () => {
      expect(
        format("2024-03-10T06:59:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 10, 1:59 AM");
    });

    it("skips the hour that does not exist on the spring-forward day", () => {
      // 07:00 UTC is 03:00 EDT - 02:00 never happens in New York that day.
      expect(
        format("2024-03-10T07:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 10, 3:00 AM");
    });

    it("writes both halves of the repeated fall-back hour on the same clock", () => {
      /*
       * 05:00 and 06:00 UTC are two different instants that both read 01:00 in
       * New York on the day the clocks go back. Both are correct - the label is
       * a wall clock, and this pins that it does not silently offset one.
       */
      expect(
        format("2024-11-03T05:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Nov 3, 1:00 AM");
      expect(
        format("2024-11-03T06:00:00.000Z", { use12HourFormat: true }),
      ).toBe("Nov 3, 1:00 AM");
    });
  });

  describe("input handling", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("accepts an ISO string as well as a Date", () => {
      expect(
        OneUptimeDate.getDateAsLocalShortDateTimeString(
          "2024-03-01T14:30:00.000Z",
          { use12HourFormat: true },
        ),
      ).toBe("Mar 1, 2:30 PM");
    });

    it("gives the same answer for a Date and its ISO string", () => {
      const instant: Date = new Date("2024-03-01T14:30:00.000Z");

      expect(
        OneUptimeDate.getDateAsLocalShortDateTimeString(instant, {
          use12HourFormat: true,
        }),
      ).toBe(
        OneUptimeDate.getDateAsLocalShortDateTimeString(instant.toISOString(), {
          use12HourFormat: true,
        }),
      );
    });
  });

  describe("defaulting to the machine's preference", () => {
    beforeEach(() => {
      OneUptimeDate.setUserTimezone(UTC);
    });

    it("uses a 12-hour clock when the machine is on one", () => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      expect(format("2024-03-01T14:30:00.000Z")).toBe("Mar 1, 2:30 PM");
    });

    it("uses a 24-hour clock when the machine is on one", () => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(false);

      expect(format("2024-03-01T14:30:00.000Z")).toBe("Mar 1, 14:30");
    });

    it("lets an explicit 24-hour caller override a 12-hour machine", () => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      expect(
        format("2024-03-01T14:30:00.000Z", { use12HourFormat: false }),
      ).toBe("Mar 1, 14:30");
    });

    it("lets an explicit 12-hour caller override a 24-hour machine", () => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(false);

      expect(
        format("2024-03-01T14:30:00.000Z", { use12HourFormat: true }),
      ).toBe("Mar 1, 2:30 PM");
    });

    it("asks the machine once per call rather than caching an answer", () => {
      /*
       * The preference can change under a running tab - the user flips their
       * OS clock setting and comes back. Nothing may hold a stale copy.
       */
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(false);

      expect(format("2024-03-01T14:30:00.000Z")).toBe("Mar 1, 14:30");

      // The same tab, after the user flips their OS clock setting.
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(true);

      expect(format("2024-03-01T14:30:00.000Z")).toBe("Mar 1, 2:30 PM");
    });
  });
});
