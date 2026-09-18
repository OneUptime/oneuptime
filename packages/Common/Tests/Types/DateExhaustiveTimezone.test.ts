/**
 * EXHAUSTIVE timezone / DST coverage for the OneUptimeDate helpers that back the
 * on-call scheduling & restriction-time machinery. These lock in the CORRECT
 * (post-audit-fix) behavior of:
 *
 *   - getInstantFromLocalWallClockInTimezone / getLocalDateFromWallClockInTimezone
 *     (audit F1: time-picker captured in browser zone, stored in schedule zone)
 *   - getHourAndMinuteInTimezoneString (audit F10: show hours in schedule zone)
 *   - moveDateToTheDayOfWeek WITH a timezone across spring-forward & fall-back
 *     (audit F9: final day-shift must stay timezone-aware)
 *   - addRemoveDays / addRemoveWeeks / addRemoveMonths / addRemoveYears WITH a
 *     timezone preserving wall-clock across DST
 *   - keepTimeButMoveDay across DST
 *   - getDayOfWeek / geyDayOfWeekAsNumber in a timezone
 *
 * Assertions are expressed in SCHEDULE-ZONE wall-clock via moment-timezone (or in
 * absolute milliseconds) so they hold regardless of the process TZ the suite runs
 * under. Run under TZ=UTC as well to model a UTC server whose zone differs from
 * the schedule zone.
 */
import OneUptimeDate from "../../Types/Date";
import DayOfWeek from "../../Types/Day/DayOfWeek";
import moment from "moment-timezone";

const NY: string = "America/New_York";
const LONDON: string = "Europe/London";
const SYDNEY: string = "Australia/Sydney";
const KOLKATA: string = "Asia/Kolkata";
const UTC: string = "UTC";

const ALL_ZONES: string[] = [NY, LONDON, SYDNEY, KOLKATA, UTC];

// Format an instant's wall-clock in a given zone.
function hhmm(d: Date, tz: string): string {
  return moment.tz(d, tz).format("HH:mm");
}

function ymd(d: Date, tz: string): string {
  return moment.tz(d, tz).format("YYYY-MM-DD");
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/*
 * A Date whose PROCESS-local wall-clock is exactly the given components. moment
 * in local mode reads these back identically regardless of the process zone.
 */
function localDate(
  y: number,
  monthIndex: number,
  day: number,
  h: number,
  min: number,
  s: number,
): Date {
  return new Date(y, monthIndex, day, h, min, s);
}

const ONE_HOUR_MS: number = 60 * 60 * 1000;
const ONE_DAY_MS: number = 24 * ONE_HOUR_MS;

/*
 * The 12/24-hour choice getHourAndMinuteInTimezoneString makes is environment
 * dependent, so derive the same format the code will use and match against it.
 */
const TZ_TIME_FORMAT: string = OneUptimeDate.getUserPrefers12HourFormat()
  ? "h:mm A"
  : "HH:mm";

interface DstDay {
  zone: string;
  // A Sunday on which the transition occurs (all these zones transition on Sun).
  transitionSundayYmd: string;
  springForward: boolean; // true = clocks jump forward (23h day)
}

// Verified against moment-timezone tz data (2026).
const DST_DAYS: DstDay[] = [
  { zone: NY, transitionSundayYmd: "2026-03-08", springForward: true },
  { zone: NY, transitionSundayYmd: "2026-11-01", springForward: false },
  { zone: LONDON, transitionSundayYmd: "2026-03-29", springForward: true },
  { zone: LONDON, transitionSundayYmd: "2026-10-25", springForward: false },
  // Southern hemisphere: transitions are reversed relative to the north.
  { zone: SYDNEY, transitionSundayYmd: "2026-10-04", springForward: true },
  { zone: SYDNEY, transitionSundayYmd: "2026-04-05", springForward: false },
];

describe("OneUptimeDate exhaustive timezone / DST helpers", () => {
  describe("getInstantFromLocalWallClockInTimezone", () => {
    it("plants the local wall-clock as the same wall-clock in the target zone (winter & summer, all zones)", () => {
      const walls: Date[] = [
        localDate(2026, 0, 6, 9, 0, 0), // winter 09:00
        localDate(2026, 6, 6, 14, 30, 0), // summer 14:30
        localDate(2026, 10, 20, 23, 45, 0), // late evening
        localDate(2026, 3, 1, 0, 1, 0), // just after midnight
      ];
      for (const wall of walls) {
        for (const zone of ALL_ZONES) {
          const instant: Date =
            OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, zone);
          expect(hhmm(instant, zone)).toBe(
            `${pad(wall.getHours())}:${pad(wall.getMinutes())}`,
          );
        }
      }
    });

    it("produces distinct absolute instants for the same wall-clock in different zones", () => {
      const wall: Date = localDate(2026, 5, 15, 9, 0, 0);
      const inNY: Date = OneUptimeDate.getInstantFromLocalWallClockInTimezone(
        wall,
        NY,
      );
      const inKolkata: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, KOLKATA);
      const inSydney: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, SYDNEY);
      expect(inNY.getTime()).not.toBe(inKolkata.getTime());
      expect(inNY.getTime()).not.toBe(inSydney.getTime());
      expect(inKolkata.getTime()).not.toBe(inSydney.getTime());
      expect(hhmm(inNY, NY)).toBe("09:00");
      expect(hhmm(inKolkata, KOLKATA)).toBe("09:00");
      expect(hhmm(inSydney, SYDNEY)).toBe("09:00");
    });

    it("honors the half-hour Kolkata offset (09:00 IST is xx:30 UTC)", () => {
      const wall: Date = localDate(2026, 5, 15, 9, 0, 0);
      const instant: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, KOLKATA);
      expect(moment.utc(instant).format("mm")).toBe("30");
      expect(moment.utc(instant).format("HH")).toBe("03"); // 09:00 - 5:30
    });

    it("preserves wall-clock on each zone's own spring-forward & fall-back Sunday at 09:00", () => {
      for (const d of DST_DAYS) {
        const [y, m, day]: number[] = d.transitionSundayYmd
          .split("-")
          .map((x: string): number => {
            return parseInt(x, 10);
          }) as number[];
        const wall: Date = localDate(y!, m! - 1, day!, 9, 0, 0);
        const instant: Date =
          OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, d.zone);
        expect(hhmm(instant, d.zone)).toBe("09:00");
        expect(ymd(instant, d.zone)).toBe(d.transitionSundayYmd);
      }
    });

    it("accepts a string input via fromString (equivalent to the Date input)", () => {
      const wall: Date = localDate(2026, 5, 15, 9, 0, 0);
      const fromDate: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, NY);
      // Its UTC-marked ISO string parses back to the identical instant.
      const fromString: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(
          wall.toISOString(),
          NY,
        );
      expect(fromString.getTime()).toBe(fromDate.getTime());
    });

    it("NOTE: current behavior - a nonexistent spring-forward gap wall-clock normalizes forward", () => {
      // 02:30 on 2026-03-08 does not exist in NY (02:00 jumps to 03:00).
      const wall: Date = localDate(2026, 2, 8, 2, 30, 0);
      const instant: Date =
        OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, NY);
      // moment-timezone shifts the gap time forward by the DST offset.
      expect(hhmm(instant, NY)).toBe("03:30");
    });
  });

  describe("getLocalDateFromWallClockInTimezone", () => {
    it("returns a local Date whose local wall-clock equals the target-zone wall-clock (all zones)", () => {
      for (const zone of ALL_ZONES) {
        const instant: Date = moment.tz("2026-01-06 09:00", zone).toDate();
        const local: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
          instant,
          zone,
        );
        expect(local.getHours()).toBe(9);
        expect(local.getMinutes()).toBe(0);
      }
    });

    it("honors the half-hour Kolkata offset", () => {
      const instant: Date = moment.tz("2026-06-15 09:15", KOLKATA).toDate();
      const local: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
        instant,
        KOLKATA,
      );
      expect(local.getHours()).toBe(9);
      expect(local.getMinutes()).toBe(15);
    });

    it("reflects the zone's summer vs winter offset for a fixed UTC instant", () => {
      // 2026-07-01 12:00 UTC is 08:00 in NY (EDT, -4).
      const summer: Date = moment.utc("2026-07-01 12:00").toDate();
      const localSummer: Date =
        OneUptimeDate.getLocalDateFromWallClockInTimezone(summer, NY);
      expect(localSummer.getHours()).toBe(8);
      // 2026-01-01 12:00 UTC is 07:00 in NY (EST, -5).
      const winter: Date = moment.utc("2026-01-01 12:00").toDate();
      const localWinter: Date =
        OneUptimeDate.getLocalDateFromWallClockInTimezone(winter, NY);
      expect(localWinter.getHours()).toBe(7);
    });
  });

  describe("round-trip preservation", () => {
    it("local -> tz-instant -> local preserves wall-clock across winter/summer/DST-day for every zone", () => {
      const walls: Date[] = [
        localDate(2026, 0, 6, 9, 0, 0), // winter
        localDate(2026, 6, 6, 14, 30, 0), // summer
        localDate(2026, 2, 8, 1, 30, 0), // NY spring-forward day (pre-gap, valid everywhere)
        localDate(2026, 10, 1, 23, 15, 0), // NY fall-back day (post-fold, valid everywhere)
      ];
      for (const wall of walls) {
        for (const zone of ALL_ZONES) {
          const instant: Date =
            OneUptimeDate.getInstantFromLocalWallClockInTimezone(wall, zone);
          const back: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
            instant,
            zone,
          );
          expect(back.getHours()).toBe(wall.getHours());
          expect(back.getMinutes()).toBe(wall.getMinutes());
          expect(back.getSeconds()).toBe(wall.getSeconds());
        }
      }
    });

    it("tz-instant -> local -> tz-instant preserves the exact instant (unambiguous wall-clocks)", () => {
      for (const zone of ALL_ZONES) {
        const instants: Date[] = [
          moment.tz("2026-06-15 09:00", zone).toDate(),
          moment.tz("2026-01-15 14:30", zone).toDate(),
        ];
        for (const instant0 of instants) {
          const local: Date = OneUptimeDate.getLocalDateFromWallClockInTimezone(
            instant0,
            zone,
          );
          const instant1: Date =
            OneUptimeDate.getInstantFromLocalWallClockInTimezone(local, zone);
          expect(instant1.getTime()).toBe(instant0.getTime());
        }
      }
    });
  });

  describe("getHourAndMinuteInTimezoneString", () => {
    it("formats an instant in the requested zone (matches moment format) for every zone", () => {
      const instant: Date = moment.utc("2026-01-06 17:00").toDate();
      for (const zone of ALL_ZONES) {
        const actual: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
          instant,
          zone,
        );
        expect(actual).toBe(moment.tz(instant, zone).format(TZ_TIME_FORMAT));
      }
    });

    it("differs across zones for the same instant", () => {
      const nyNoon: Date = moment.tz("2026-01-06 12:00", NY).toDate();
      const inNY: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        NY,
      );
      const inKolkata: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        KOLKATA,
      );
      const inSydney: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        SYDNEY,
      );
      expect(inNY).not.toBe(inKolkata);
      expect(inNY).not.toBe(inSydney);
      expect(inKolkata).not.toBe(inSydney);
    });

    it("shows the Kolkata half-hour minute component", () => {
      const nyNoon: Date = moment.tz("2026-01-06 12:00", NY).toDate();
      const inKolkata: string = OneUptimeDate.getHourAndMinuteInTimezoneString(
        nyNoon,
        KOLKATA,
      );
      // NY 12:00 EST = 17:00 UTC = 22:30 IST -> minute is 30.
      expect(inKolkata).toContain("30");
      expect(inKolkata).toBe(moment.tz(nyNoon, KOLKATA).format(TZ_TIME_FORMAT));
    });

    it("applies the correct offset in summer vs winter (same wall-clock string, different UTC instant)", () => {
      // Both instants read 12:00 in NY: one in EDT, one in EST.
      const summerInstant: Date = moment.utc("2026-07-01 16:00").toDate(); // NY 12:00 EDT
      const winterInstant: Date = moment.utc("2026-01-01 17:00").toDate(); // NY 12:00 EST
      const expected: string = moment
        .tz(summerInstant, NY)
        .format(TZ_TIME_FORMAT);
      expect(
        OneUptimeDate.getHourAndMinuteInTimezoneString(summerInstant, NY),
      ).toBe(expected);
      expect(
        OneUptimeDate.getHourAndMinuteInTimezoneString(winterInstant, NY),
      ).toBe(moment.tz(winterInstant, NY).format(TZ_TIME_FORMAT));
      // Both are NY noon.
      expect(hhmm(summerInstant, NY)).toBe("12:00");
      expect(hhmm(winterInstant, NY)).toBe("12:00");
    });

    it("falls back to the local wall-clock when no timezone is given", () => {
      const d: Date = localDate(2026, 0, 6, 8, 15, 0);
      expect(OneUptimeDate.getHourAndMinuteInTimezoneString(d, undefined)).toBe(
        OneUptimeDate.getLocalHourAndMinuteFromDate(d),
      );
    });

    it("NOTE: current behavior - an empty-string timezone is falsy so it falls back to local", () => {
      const d: Date = localDate(2026, 0, 6, 8, 15, 0);
      expect(OneUptimeDate.getHourAndMinuteInTimezoneString(d, "")).toBe(
        OneUptimeDate.getLocalHourAndMinuteFromDate(d),
      );
    });
  });

  describe("moveDateToTheDayOfWeek WITH a timezone", () => {
    const ORDERED_DAYS: DayOfWeek[] = [
      DayOfWeek.Sunday,
      DayOfWeek.Monday,
      DayOfWeek.Tuesday,
      DayOfWeek.Wednesday,
      DayOfWeek.Thursday,
      DayOfWeek.Friday,
      DayOfWeek.Saturday,
    ];

    it("lands on the requested weekday AND preserves wall-clock for all 7 targets across every DST week", () => {
      for (const d of DST_DAYS) {
        const y: number = parseInt(d.transitionSundayYmd.split("-")[0]!, 10);
        /*
         * moveToWeek = the Wednesday of the Sunday-anchored week containing the
         * transition Sunday, so all 7 targets fall inside the transition week.
         */
        const moveToWeek: Date = moment
          .tz(d.transitionSundayYmd, d.zone)
          .add(3, "days")
          .set({ hour: 12 })
          .toDate();

        for (const targetDay of ORDERED_DAYS) {
          // An authored restriction at 09:00 wall-clock in the schedule zone.
          const restriction: Date = moment
            .tz(`${y}-01-07 09:00`, d.zone)
            .toDate();
          const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
            restriction,
            moveToWeek,
            targetDay,
            d.zone,
          );
          expect(OneUptimeDate.getDayOfWeek(moved, d.zone)).toBe(targetDay);
          expect(hhmm(moved, d.zone)).toBe("09:00");
        }
      }
    });

    it("preserves a late-evening wall-clock (23:30) across the NY spring-forward week for all 7 targets", () => {
      const moveToWeek: Date = moment
        .tz("2026-03-08", NY)
        .add(3, "days")
        .set({ hour: 12 })
        .toDate();
      for (const targetDay of ORDERED_DAYS) {
        const restriction: Date = moment.tz("2026-01-07 23:30", NY).toDate();
        const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
          restriction,
          moveToWeek,
          targetDay,
          NY,
        );
        expect(OneUptimeDate.getDayOfWeek(moved, NY)).toBe(targetDay);
        expect(hhmm(moved, NY)).toBe("23:30");
      }
    });

    it("keeps a Sunday 01:00 boundary at 01:00 when moved into the NY spring-forward week (gap is at 02:00, F9 boundary)", () => {
      const restriction: Date = moment.tz("2026-01-04 01:00", NY).toDate(); // a Sunday 01:00
      const moveToWeek: Date = moment.tz("2026-03-11 12:00", NY).toDate(); // Wed of NY SF week
      const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        restriction,
        moveToWeek,
        DayOfWeek.Sunday,
        NY,
      );
      expect(OneUptimeDate.getDayOfWeek(moved, NY)).toBe(DayOfWeek.Sunday);
      expect(hhmm(moved, NY)).toBe("01:00");
    });

    it("keeps a Sunday 01:30 boundary at 01:30 when moved into the NY fall-back week (ambiguous folded hour)", () => {
      // 01:30 occurs twice on 2026-11-01 (NY fall-back). Wall-clock must still read 01:30.
      const restriction: Date = moment.tz("2026-01-04 01:30", NY).toDate();
      const moveToWeek: Date = moment.tz("2026-11-04 12:00", NY).toDate(); // Wed of NY FB week
      const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        restriction,
        moveToWeek,
        DayOfWeek.Sunday,
        NY,
      );
      expect(OneUptimeDate.getDayOfWeek(moved, NY)).toBe(DayOfWeek.Sunday);
      expect(ymd(moved, NY)).toBe("2026-11-01");
      expect(hhmm(moved, NY)).toBe("01:30");
    });

    it("NOTE: current behavior - a Sunday 01:00 boundary lands in London's spring-forward gap and normalizes to 02:00", () => {
      /*
       * London jumps 01:00 -> 02:00 on 2026-03-29, so the 01:00 wall-clock does
       * not exist on that Sunday and moment-timezone shifts it forward.
       */
      const restriction: Date = moment.tz("2026-01-04 01:00", LONDON).toDate(); // a Sunday 01:00
      const moveToWeek: Date = moment.tz("2026-04-01 12:00", LONDON).toDate(); // Wed of London SF week
      const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        restriction,
        moveToWeek,
        DayOfWeek.Sunday,
        LONDON,
      );
      expect(OneUptimeDate.getDayOfWeek(moved, LONDON)).toBe(DayOfWeek.Sunday);
      expect(ymd(moved, LONDON)).toBe("2026-03-29");
      expect(hhmm(moved, LONDON)).toBe("02:00");
    });

    it("returns the same day (no shift) when the target equals moveToWeek's weekday", () => {
      // moveToWeek is a Wednesday; targeting Wednesday must not shift.
      const moveToWeek: Date = moment.tz("2026-03-11 12:00", NY).toDate(); // Wednesday
      const restriction: Date = moment.tz("2026-01-07 09:00", NY).toDate();
      const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        restriction,
        moveToWeek,
        DayOfWeek.Wednesday,
        NY,
      );
      expect(ymd(moved, NY)).toBe("2026-03-11");
      expect(hhmm(moved, NY)).toBe("09:00");
    });
  });

  describe("addRemoveDays WITH a timezone across DST", () => {
    it("+1 day across spring-forward keeps wall-clock (23h absolute jump)", () => {
      const start: Date = moment.tz("2026-03-07 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveDays(start, 1, NY);
      expect(hhmm(next, NY)).toBe("09:00");
      expect(ymd(next, NY)).toBe("2026-03-08");
      expect(next.getTime() - start.getTime()).toBe(23 * ONE_HOUR_MS);
    });

    it("+1 day across fall-back keeps wall-clock (25h absolute jump)", () => {
      const start: Date = moment.tz("2026-10-31 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveDays(start, 1, NY);
      expect(hhmm(next, NY)).toBe("09:00");
      expect(ymd(next, NY)).toBe("2026-11-01");
      expect(next.getTime() - start.getTime()).toBe(25 * ONE_HOUR_MS);
    });

    it("-1 day back across spring-forward keeps wall-clock", () => {
      const start: Date = moment.tz("2026-03-08 09:00", NY).toDate();
      const prev: Date = OneUptimeDate.addRemoveDays(start, -1, NY);
      expect(hhmm(prev, NY)).toBe("09:00");
      expect(ymd(prev, NY)).toBe("2026-03-07");
      expect(start.getTime() - prev.getTime()).toBe(23 * ONE_HOUR_MS);
    });

    it("preserves wall-clock across every zone's spring-forward and fall-back", () => {
      for (const d of DST_DAYS) {
        const before: Date = moment
          .tz(d.transitionSundayYmd, d.zone)
          .subtract(1, "days")
          .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
          .toDate();
        const after: Date = OneUptimeDate.addRemoveDays(before, 1, d.zone);
        expect(hhmm(after, d.zone)).toBe("09:00");
        const absHours: number =
          (after.getTime() - before.getTime()) / ONE_HOUR_MS;
        expect(absHours).toBe(d.springForward ? 23 : 25);
      }
    });

    it("Kolkata (no DST) advances by exactly 24h", () => {
      const start: Date = moment.tz("2026-03-08 09:00", KOLKATA).toDate();
      const next: Date = OneUptimeDate.addRemoveDays(start, 1, KOLKATA);
      expect(hhmm(next, KOLKATA)).toBe("09:00");
      expect(next.getTime() - start.getTime()).toBe(ONE_DAY_MS);
    });

    it("samples a long horizon: adding k days keeps 09:00 across many DST crossings", () => {
      const start: Date = moment.tz("2026-01-01 09:00", NY).toDate();
      for (let k: number = 0; k <= 730; k += 10) {
        const moved: Date = OneUptimeDate.addRemoveDays(start, k, NY);
        expect(hhmm(moved, NY)).toBe("09:00");
      }
    });
  });

  describe("addRemoveWeeks WITH a timezone across DST", () => {
    it("+1 week across spring-forward keeps wall-clock (167h absolute span)", () => {
      const start: Date = moment.tz("2026-03-01 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveWeeks(start, 1, NY);
      expect(hhmm(next, NY)).toBe("09:00");
      expect(ymd(next, NY)).toBe("2026-03-08");
      expect(next.getTime() - start.getTime()).toBe(167 * ONE_HOUR_MS);
    });

    it("+1 week across fall-back keeps wall-clock (span is not 168h)", () => {
      const start: Date = moment.tz("2026-10-25 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveWeeks(start, 1, NY);
      expect(hhmm(next, NY)).toBe("09:00");
      expect(ymd(next, NY)).toBe("2026-11-01");
      const absHours: number = (next.getTime() - start.getTime()) / ONE_HOUR_MS;
      expect(absHours).toBe(169);
    });

    it("samples multiple weeks in every zone keeping wall-clock", () => {
      for (const zone of ALL_ZONES) {
        const start: Date = moment.tz("2026-02-01 09:00", zone).toDate();
        for (let w: number = 0; w <= 40; w += 4) {
          const moved: Date = OneUptimeDate.addRemoveWeeks(start, w, zone);
          expect(hhmm(moved, zone)).toBe("09:00");
        }
      }
    });
  });

  describe("addRemoveMonths WITH a timezone across DST", () => {
    it("+1 month across spring-forward keeps wall-clock and calendar day", () => {
      const start: Date = moment.tz("2026-02-15 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveMonths(start, 1, NY);
      expect(ymd(next, NY)).toBe("2026-03-15");
      expect(hhmm(next, NY)).toBe("09:00");
    });

    it("+1 month across fall-back keeps wall-clock", () => {
      const start: Date = moment.tz("2026-10-15 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveMonths(start, 1, NY);
      expect(ymd(next, NY)).toBe("2026-11-15");
      expect(hhmm(next, NY)).toBe("09:00");
    });

    it("clamps a month-end overflow (Jan 31 + 1 month -> last day of Feb) keeping wall-clock", () => {
      const start: Date = moment.tz("2027-01-31 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveMonths(start, 1, NY);
      expect(ymd(next, NY)).toBe("2027-02-28"); // 2027 is not a leap year
      expect(hhmm(next, NY)).toBe("09:00");
    });

    it("samples 24 forward months in every zone keeping wall-clock", () => {
      for (const zone of ALL_ZONES) {
        const start: Date = moment.tz("2026-01-10 09:00", zone).toDate();
        for (let mo: number = 0; mo <= 24; mo += 2) {
          const moved: Date = OneUptimeDate.addRemoveMonths(start, mo, zone);
          expect(hhmm(moved, zone)).toBe("09:00");
        }
      }
    });
  });

  describe("addRemoveYears WITH a timezone across DST", () => {
    it("+1 year keeps wall-clock (offset EST vs EST at the same date)", () => {
      const start: Date = moment.tz("2026-01-15 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveYears(start, 1, NY);
      expect(ymd(next, NY)).toBe("2027-01-15");
      expect(hhmm(next, NY)).toBe("09:00");
    });

    it("clamps Feb-29 leap-day overflow (+1 year -> Feb 28) keeping wall-clock", () => {
      const start: Date = moment.tz("2028-02-29 09:00", NY).toDate();
      const next: Date = OneUptimeDate.addRemoveYears(start, 1, NY);
      expect(ymd(next, NY)).toBe("2029-02-28");
      expect(hhmm(next, NY)).toBe("09:00");
    });

    it("samples several years in every zone keeping wall-clock", () => {
      for (const zone of ALL_ZONES) {
        const start: Date = moment.tz("2026-07-15 09:00", zone).toDate();
        for (let yr: number = 0; yr <= 6; yr += 1) {
          const moved: Date = OneUptimeDate.addRemoveYears(start, yr, zone);
          expect(hhmm(moved, zone)).toBe("09:00");
        }
      }
    });
  });

  describe("keepTimeButMoveDay across DST", () => {
    it("timezone-aware: keeps the schedule-zone wall-clock on each zone's transition Sunday", () => {
      for (const d of DST_DAYS) {
        // keepTimeFor authored at 14:37:45 wall-clock in the schedule zone.
        const keepTimeFor: Date = moment
          .tz("2026-01-02 14:37:45", d.zone)
          .toDate();
        const moveDayTo: Date = moment
          .tz(`${d.transitionSundayYmd} 00:00`, d.zone)
          .toDate();
        const result: Date = OneUptimeDate.keepTimeButMoveDay(
          keepTimeFor,
          moveDayTo,
          d.zone,
        );
        expect(ymd(result, d.zone)).toBe(d.transitionSundayYmd);
        expect(moment.tz(result, d.zone).format("HH:mm:ss")).toBe("14:37:45");
      }
    });

    it("timezone-aware: keeps wall-clock when the destination day is the fall-back day and time is the folded hour edge", () => {
      // 09:00 is unambiguous; verify placement onto the fall-back day.
      const keepTimeFor: Date = moment.tz("2026-06-01 09:00", NY).toDate();
      const moveDayTo: Date = moment.tz("2026-11-01 18:00", NY).toDate();
      const result: Date = OneUptimeDate.keepTimeButMoveDay(
        keepTimeFor,
        moveDayTo,
        NY,
      );
      expect(ymd(result, NY)).toBe("2026-11-01");
      expect(hhmm(result, NY)).toBe("09:00");
    });

    it("no-timezone: keeps the process-local wall-clock and moves to the destination calendar day", () => {
      const keepTimeFor: Date = localDate(2026, 0, 1, 14, 37, 45);
      const moveDayTo: Date = localDate(2026, 5, 20, 3, 0, 0);
      const result: Date = OneUptimeDate.keepTimeButMoveDay(
        keepTimeFor,
        moveDayTo,
      );
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(5);
      expect(result.getDate()).toBe(20);
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(37);
      expect(result.getSeconds()).toBe(45);
    });
  });

  describe("getDayOfWeek / geyDayOfWeekAsNumber in a timezone", () => {
    // 2026-01-05 is a Monday. Noon-UTC anchors avoid any cross-zone day flip.
    const WEEK: Array<{ ymd: string; day: DayOfWeek; iso: number }> = [
      { ymd: "2026-01-05", day: DayOfWeek.Monday, iso: 1 },
      { ymd: "2026-01-06", day: DayOfWeek.Tuesday, iso: 2 },
      { ymd: "2026-01-07", day: DayOfWeek.Wednesday, iso: 3 },
      { ymd: "2026-01-08", day: DayOfWeek.Thursday, iso: 4 },
      { ymd: "2026-01-09", day: DayOfWeek.Friday, iso: 5 },
      { ymd: "2026-01-10", day: DayOfWeek.Saturday, iso: 6 },
      { ymd: "2026-01-11", day: DayOfWeek.Sunday, iso: 7 },
    ];

    it("maps every isoWeekday to the correct DayOfWeek enum (UTC noon anchors)", () => {
      for (const entry of WEEK) {
        const instant: Date = moment.utc(`${entry.ymd} 12:00`).toDate();
        expect(OneUptimeDate.getDayOfWeek(instant, UTC)).toBe(entry.day);
        expect(OneUptimeDate.geyDayOfWeekAsNumber(instant, UTC)).toBe(
          entry.iso,
        );
      }
    });

    it("resolves the same UTC-noon instant to the same weekday in NY and Kolkata (no flip)", () => {
      for (const entry of WEEK) {
        const instant: Date = moment.utc(`${entry.ymd} 12:00`).toDate();
        expect(OneUptimeDate.getDayOfWeek(instant, NY)).toBe(entry.day);
        expect(OneUptimeDate.getDayOfWeek(instant, KOLKATA)).toBe(entry.day);
      }
    });

    it("flips the weekday across zones for a late-evening UTC instant", () => {
      // 2026-01-05 23:00 UTC: NY 18:00 Mon, Kolkata 04:30 Tue.
      const instant: Date = moment.utc("2026-01-05 23:00").toDate();
      expect(OneUptimeDate.getDayOfWeek(instant, NY)).toBe(DayOfWeek.Monday);
      expect(OneUptimeDate.getDayOfWeek(instant, KOLKATA)).toBe(
        DayOfWeek.Tuesday,
      );
      expect(OneUptimeDate.getDayOfWeek(instant, UTC)).toBe(DayOfWeek.Monday);
    });

    it("flips the weekday the other direction for an early-UTC instant (NY still on the previous day)", () => {
      // 2026-01-06 02:00 UTC: NY 21:00 Mon Jan 5, Kolkata 07:30 Tue Jan 6.
      const instant: Date = moment.utc("2026-01-06 02:00").toDate();
      expect(OneUptimeDate.getDayOfWeek(instant, NY)).toBe(DayOfWeek.Monday);
      expect(OneUptimeDate.getDayOfWeek(instant, KOLKATA)).toBe(
        DayOfWeek.Tuesday,
      );
    });

    it("reports the correct weekday on each zone's transition Sunday", () => {
      for (const d of DST_DAYS) {
        const noon: Date = moment
          .tz(`${d.transitionSundayYmd} 12:00`, d.zone)
          .toDate();
        expect(OneUptimeDate.getDayOfWeek(noon, d.zone)).toBe(DayOfWeek.Sunday);
      }
    });
  });
});
