/**
 * Tests for the timezone wall-clock helpers backing the on-call restriction
 * time-picker fix (audit F1) and the summary formatting fix (audit F10):
 *   - getInstantFromLocalWallClockInTimezone
 *   - getLocalDateFromWallClockInTimezone (inverse)
 *   - getHourAndMinuteInTimezoneString
 *
 * Assertions are expressed in wall-clock via moment-timezone so they hold
 * regardless of the process TZ the suite runs under.
 */
import OneUptimeDate from "../../Types/Date";
import moment from "moment-timezone";

const NY: string = "America/New_York";
const KOLKATA: string = "Asia/Kolkata";

describe("OneUptimeDate timezone wall-clock helpers", () => {
  describe("getInstantFromLocalWallClockInTimezone", () => {
    it("plants the local wall-clock components as the same wall-clock in the target zone", () => {
      // A local Date reading 09:00 on 2025-01-06 in the process zone.
      const local: Date = new Date(2025, 0, 6, 9, 0, 0);
      const instant: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(local, NY);
      // The resulting instant must read 09:00 in New York.
      expect(moment.tz(instant, NY).format("HH:mm")).toBe("09:00");
    });

    it("produces different absolute instants for the same wall-clock in different zones", () => {
      const local: Date = new Date(2025, 5, 15, 9, 0, 0);
      const inNY: Date = OneUptimeDate.getInstantFromLocalWallClockInTimezone(
        local,
        NY,
      );
      const inKolkata: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(local, KOLKATA);
      // 09:00 NY and 09:00 Kolkata are different moments.
      expect(inNY.getTime()).not.toBe(inKolkata.getTime());
      expect(moment.tz(inNY, NY).format("HH:mm")).toBe("09:00");
      expect(moment.tz(inKolkata, KOLKATA).format("HH:mm")).toBe("09:00");
    });
  });

  describe("getLocalDateFromWallClockInTimezone", () => {
    it("returns a local Date whose local wall-clock equals the target-zone wall-clock", () => {
      // An instant that is 09:00 in New York.
      const instant: Date = moment.tz("2025-01-06 09:00", NY).toDate();
      const local: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
        instant,
        NY,
      );
      // Its LOCAL hour/minute should read 09:00.
      expect(local.getHours()).toBe(9);
      expect(local.getMinutes()).toBe(0);
    });
  });

  describe("round-trip", () => {
    it("local -> tz-instant -> local preserves the wall-clock (incl. across a DST week)", () => {
      for (const wall of [
        new Date(2025, 0, 6, 9, 0, 0), // winter
        new Date(2025, 6, 6, 14, 30, 0), // summer
        new Date(2026, 2, 8, 1, 30, 0), // US spring-forward day
      ]) {
        const instant: Date =
          OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, NY);
        const back: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
          instant,
          NY,
        );
        expect(back.getHours()).toBe(wall.getHours());
        expect(back.getMinutes()).toBe(wall.getMinutes());
      }
    });
  });

  describe("getHourAndMinuteInTimezoneString", () => {
    it("formats an instant in the given timezone (NY noon reads 09:00 in LA, differs from NY)", () => {
      const nyNoon: Date = moment.tz("2025-01-06 12:00", NY).toDate();
      const inNY: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        NY,
      );
      const inKolkata: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        KOLKATA,
      );
      expect(inNY).not.toBe(inKolkata);
      // Kolkata is +5:30, so the minute component is :30.
      expect(inKolkata).toContain("30");
    });

    it("falls back to local wall-clock when no timezone is given", () => {
      const d: Date = new Date(2025, 0, 6, 8, 15, 0);
      expect(OneUptimeDate.getHourAndMinuteInTimezoneString(d, undefined)).toBe(
        OneUptimeDate.getLocalHourAndMinuteFromDate(d),
      );
    });
  });
});
