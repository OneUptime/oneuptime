/**
 * The user's profile timezone (User Settings > Timezone) — not the zone the
 * browser reports — decides which wall clock OneUptimeDate reads and writes.
 *
 * The bug these lock in: a user in America/New_York whose browser reported
 * America/Adak was told "your local timezone - HDT" on every date field, and
 * had to enter Hawaii-Aleutian times for their events to land correctly. The
 * profile timezone was stored but never consulted by the UI.
 *
 * Every assertion is expressed in explicit-zone wall-clock (or absolute
 * milliseconds) so it holds under whatever TZ the suite runs in.
 */
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import moment from "moment-timezone";

const NY: Timezone = Timezone.AmericaNew_York;
const ADAK: Timezone = Timezone.AmericaAdak;
const KOLKATA: Timezone = Timezone.AsiaKolkata;

describe("OneUptimeDate user timezone", () => {
  afterEach(() => {
    // Never leak an override into the rest of the suite.
    OneUptimeDate.setUserTimezone(null);
  });

  describe("setUserTimezone / getCurrentTimezone", () => {
    it("falls back to the browser / process zone when no user timezone is set", () => {
      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        moment.tz.guess(),
      );
    });

    it("prefers the user timezone over the browser / process zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      expect(OneUptimeDate.getCurrentTimezone()).toBe(NY);
      expect(OneUptimeDate.getUserTimezone()).toBe(NY);
    });

    it("reports the abbreviation of the user timezone, DST aware", () => {
      OneUptimeDate.setUserTimezone(NY);

      // The bug reported "HDT" (America/Adak) for a New York user.
      expect(OneUptimeDate.getCurrentTimezoneString()).not.toBe("HDT");
      expect(["EST", "EDT"]).toContain(
        OneUptimeDate.getCurrentTimezoneString(),
      );
    });

    it("clears back to the browser / process zone when set to null", () => {
      OneUptimeDate.setUserTimezone(NY);
      OneUptimeDate.setUserTimezone(null);

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        moment.tz.guess(),
      );
    });

    it("ignores a value moment does not recognise as a zone rather than breaking every date", () => {
      OneUptimeDate.setUserTimezone("Not/AZone" as Timezone);

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      expect(OneUptimeDate.getCurrentTimezone().toString()).toBe(
        moment.tz.guess(),
      );
      // Formatting still works.
      expect(
        OneUptimeDate.toDateTimeLocalString(new Date("2026-07-09T13:00:00Z")),
      ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("datetime-local round trip", () => {
    it("renders a stored instant as its wall-clock in the user timezone", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 17:00 UTC on 2026-07-09 is 13:00 in New York (EDT).
      expect(
        OneUptimeDate.toDateTimeLocalString(new Date("2026-07-09T17:00:00Z")),
      ).toBe("2026-07-09T13:00:00");
    });

    it("resolves a typed wall-clock in the user timezone, not the browser zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      expect(typed.toISOString()).toBe("2026-07-09T17:00:00.000Z");
    });

    it("round trips what the user typed back into the picker unchanged", () => {
      OneUptimeDate.setUserTimezone(NY);

      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-01-15T09:30");

      expect(OneUptimeDate.toDateTimeLocalString(typed)).toBe(
        "2026-01-15T09:30:00",
      );
    });

    it("stores different instants for the same wall-clock in different user timezones", () => {
      OneUptimeDate.setUserTimezone(NY);
      const inNY: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      OneUptimeDate.setUserTimezone(ADAK);
      const inAdak: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T13:00");

      // Adak is 5 hours behind New York in July.
      expect(inAdak.getTime() - inNY.getTime()).toBe(5 * 60 * 60 * 1000);
    });

    it("honours the user timezone's DST offset for a winter instant", () => {
      OneUptimeDate.setUserTimezone(NY);

      // 09:00 EST is 14:00 UTC in January.
      expect(
        OneUptimeDate.fromDateTimeLocalString("2026-01-15T09:00").toISOString(),
      ).toBe("2026-01-15T14:00:00.000Z");
    });
  });

  describe("display helpers", () => {
    it("formats an instant in the user timezone with its abbreviation", () => {
      OneUptimeDate.setUserTimezone(NY);

      const formatted: string = OneUptimeDate.getDateAsLocalFormattedString(
        new Date("2026-07-09T17:00:00Z"),
      );

      expect(formatted).toContain("Jul 09 2026");
      expect(formatted).toContain("13:00");
      expect(formatted).toContain("EDT");
    });

    it("reads the hour and minute of an instant in the user timezone", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      const instant: Date = new Date("2026-07-09T17:00:00Z");

      // 17:00 UTC is 22:30 in Kolkata (UTC+5:30).
      expect(OneUptimeDate.getLocalHours(instant)).toBe(22);
      expect(OneUptimeDate.getLocalMinutes(instant)).toBe(30);
      expect(OneUptimeDate.getLocalTimeString(instant)).toBe("22:30");
    });

    it("rolls the calendar day when the user timezone puts the instant on another date", () => {
      OneUptimeDate.setUserTimezone(KOLKATA);

      // 23:00 UTC on Jul 9 is already 04:30 on Jul 10 in Kolkata.
      const instant: Date = new Date("2026-07-09T23:00:00Z");

      expect(OneUptimeDate.asDateForDatabaseQuery(instant)).toBe("2026-07-10");
      expect(OneUptimeDate.getDateAsLocalDayMonthString(instant)).toBe(
        "10 Jul",
      );
      expect(OneUptimeDate.getDateAsLocalMonthYearString(instant)).toBe(
        "Jul 2026",
      );
    });
  });

  describe("schedule-zone wall-clock bridge", () => {
    it("reads the entered wall-clock in the user timezone before anchoring it to the schedule zone", () => {
      OneUptimeDate.setUserTimezone(NY);

      // The admin typed 09:00 while working in New York.
      const typed: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-07-09T09:00");

      const stored: Date = OneUptimeDate.getInstantFromLocalWallClockInTimezone(
        typed,
        KOLKATA.toString(),
      );

      // ...and the schedule enforces 09:00 in Kolkata.
      expect(moment.tz(stored, KOLKATA.toString()).format("HH:mm")).toBe(
        "09:00",
      );
    });

    it("redisplays a stored schedule-zone time as the same wall-clock in the picker", () => {
      OneUptimeDate.setUserTimezone(NY);

      const stored: Date = moment
        .tz("2026-07-09 09:00", KOLKATA.toString())
        .toDate();

      const forPicker: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
        stored,
        KOLKATA.toString(),
      );

      expect(OneUptimeDate.toDateTimeLocalString(forPicker)).toBe(
        "2026-07-09T09:00:00",
      );
    });
  });
});
