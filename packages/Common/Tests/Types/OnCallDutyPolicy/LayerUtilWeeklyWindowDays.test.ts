import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import EventInterval from "../../../Types/Events/EventInterval";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleResolution from "../../../Types/OnCallDutyPolicy/ScheduleResolution";
import ScheduleRoster, {
  ScheduleRosterState,
} from "../../../Types/OnCallDutyPolicy/ScheduleRoster";
import WeeklyWindowDays, {
  StoredWindowState,
  StoredWindowsRepair,
} from "../../../Types/OnCallDutyPolicy/WeeklyWindowDays";
import { rotation, tzInstant, user } from "./CalendarFeedTestFixtures";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A WEEKLY WINDOW PAGES ON THE DAYS IT NAMES, IN EUROPE/WARSAW AND
 * AMERICA/NEW_YORK, ON EITHER SIDE OF EVERY CHANGE OF THE CLOCKS (#11455).
 *
 * The engine reads a window's days from its times, so what pages depends
 * on how the times are dated. Through ScheduleResolution - what the roster,
 * the timeline and paging read - over February to November 2026, which
 * holds both clock changes in both zones (Warsaw: 29 March, 25 October; New
 * York: 8 March, 1 November):
 *
 *   - a window written as the Dashboard and the write check now have it,
 *     dated on its days, pages on those days at its hours, every week;
 *   - the issue's window, stored before - named Monday, dated on a
 *     Wednesday - paged on Wednesdays and on no Monday; repaired by the
 *     data migration's rule, it pages on Mondays;
 *   - a schedule moved from Warsaw to New York keeps its windows on their
 *     days and hours there.
 */

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

const ALICE: User = user("alice");
const BOB: User = user("bob");

const HOUR_MS: number = 60 * 60 * 1000;

const RANGE_START: string = "2026-02-23 00:00";
const RANGE_END: string = "2026-11-16 00:00";

function weekly(windows: Array<WeeklyResctriction>): RestrictionTimes {
  const restriction: RestrictionTimes = new RestrictionTimes();
  restriction.restrictionType = RestrictionType.Weekly;
  restriction.weeklyRestrictionTimes = windows;
  return restriction;
}

function windowIn(
  zone: string,
  data: {
    startDay: DayOfWeek;
    start: string;
    endDay: DayOfWeek;
    end: string;
  },
): WeeklyResctriction {
  return {
    startDay: data.startDay,
    endDay: data.endDay,
    startTime: tzInstant(data.start, zone),
    endTime: tzInstant(data.end, zone),
  };
}

function layerOf(zone: string, restrictionTimes: RestrictionTimes): LayerProps {
  return {
    users: [ALICE, BOB],
    startDateTimeOfLayer: tzInstant("2026-01-05 09:00", zone),
    handOffTime: tzInstant("2026-01-12 09:00", zone),
    rotation: rotation(EventInterval.Week, 1),
    restrictionTimes: restrictionTimes,
    timezone: zone,
    layerId: "layer",
  };
}

function shiftsOf(zone: string, layer: LayerProps): Array<CalendarEvent> {
  return ScheduleResolution.resolve({
    layers: [layer],
    calendarStartDate: tzInstant(RANGE_START, zone),
    calendarEndDate: tzInstant(RANGE_END, zone),
    overrides: [],
  }).events;
}

function describeShift(shift: CalendarEvent, zone: string): string {
  return `${moment.tz(shift.start, zone).format("dddd HH:mm")} - ${moment
    .tz(shift.end, zone)
    .format("dddd HH:mm")}`;
}

// Every date in the range that falls on `day`, as YYYY-MM-DD in the zone.
function datesOf(day: DayOfWeek, zone: string): Array<string> {
  const dates: Array<string> = [];
  const cursor: moment.Moment = moment.tz(RANGE_START, zone);
  const end: moment.Moment = moment.tz(RANGE_END, zone);

  while (cursor.isBefore(end)) {
    if (cursor.format("dddd") === day) {
      dates.push(cursor.format("YYYY-MM-DD"));
    }
    cursor.add(1, "day");
  }

  return dates;
}

function isCovered(shifts: Array<CalendarEvent>, instant: Date): boolean {
  return shifts.some((shift: CalendarEvent): boolean => {
    return (
      shift.start.getTime() <= instant.getTime() &&
      instant.getTime() < shift.end.getTime()
    );
  });
}

describe.each([WARSAW, NEW_YORK])(
  "in %s, over both changes of the clocks",
  (zone: string) => {
    const mondays: Array<string> = datesOf(DayOfWeek.Monday, zone);

    test("a Monday 09:00 to 17:00 window, dated on its Monday, pages every Monday at 09:00 to 17:00 and on no other day", () => {
      const shifts: Array<CalendarEvent> = shiftsOf(
        zone,
        layerOf(
          zone,
          weekly([
            windowIn(zone, {
              startDay: DayOfWeek.Monday,
              start: "2026-01-05 09:00",
              endDay: DayOfWeek.Monday,
              end: "2026-01-05 17:00",
            }),
          ]),
        ),
      );

      expect(
        Array.from(
          new Set(
            shifts.map((shift: CalendarEvent) => {
              return describeShift(shift, zone);
            }),
          ),
        ),
      ).toEqual(["Monday 09:00 - Monday 17:00"]);

      expect(
        shifts.map((shift: CalendarEvent) => {
          return moment.tz(shift.start, zone).format("YYYY-MM-DD");
        }),
      ).toEqual(mondays);
    });

    test("REGRESSION #11455: the issue's window, named Monday and dated on a Wednesday, pages Wednesdays and no Monday - and pages every Monday once repaired", () => {
      const asStored: RestrictionTimes = weekly([
        windowIn(zone, {
          startDay: DayOfWeek.Monday,
          start: "2026-01-07 09:00",
          endDay: DayOfWeek.Monday,
          end: "2026-01-07 17:00",
        }),
      ]);

      // What the engine made of it: Wednesdays, and nobody on any Monday.
      const before: Array<CalendarEvent> = shiftsOf(
        zone,
        layerOf(zone, asStored),
      );
      expect(
        Array.from(
          new Set(
            before.map((shift: CalendarEvent) => {
              return describeShift(shift, zone);
            }),
          ),
        ),
      ).toEqual(["Wednesday 09:00 - Wednesday 17:00"]);
      for (const monday of mondays) {
        expect(isCovered(before, tzInstant(`${monday} 12:00`, zone))).toBe(
          false,
        );
      }

      // The write check refuses it, and the migration's rule moves it.
      expect(() => {
        return WeeklyWindowDays.checkWrittenWindows(asStored, {
          timezone: zone,
        });
      }).toThrow("but its startDay is Monday");

      const repair: StoredWindowsRepair =
        WeeklyWindowDays.getStoredWindowsRepair(asStored, zone);
      expect(repair.repairs[0]!.state).toBe(StoredWindowState.MovedOntoItsDays);

      const after: Array<CalendarEvent> = shiftsOf(
        zone,
        layerOf(zone, weekly(repair.windows)),
      );
      expect(
        Array.from(
          new Set(
            after.map((shift: CalendarEvent) => {
              return describeShift(shift, zone);
            }),
          ),
        ),
      ).toEqual(["Monday 09:00 - Monday 17:00"]);
      expect(
        after.map((shift: CalendarEvent) => {
          return moment.tz(shift.start, zone).format("YYYY-MM-DD");
        }),
      ).toEqual(mondays);
    });

    test("a weekend window, Friday 22:00 to Monday 06:00, pages from each Friday night to Monday morning, the weekends of the changes too", () => {
      const shifts: Array<CalendarEvent> = shiftsOf(
        zone,
        layerOf(
          zone,
          weekly([
            windowIn(zone, {
              startDay: DayOfWeek.Friday,
              start: "2026-01-09 22:00",
              endDay: DayOfWeek.Monday,
              end: "2026-01-12 06:00",
            }),
          ]),
        ),
      );

      const fridays: Array<string> = datesOf(DayOfWeek.Friday, zone);

      for (const friday of fridays) {
        const saturday: string = moment
          .tz(friday, zone)
          .add(1, "day")
          .format("YYYY-MM-DD");
        const sunday: string = moment
          .tz(friday, zone)
          .add(2, "days")
          .format("YYYY-MM-DD");
        const monday: string = moment
          .tz(friday, zone)
          .add(3, "days")
          .format("YYYY-MM-DD");

        if (
          !moment
            .tz(`${monday} 06:00`, zone)
            .isBefore(moment.tz(RANGE_END, zone))
        ) {
          continue;
        }

        expect(isCovered(shifts, tzInstant(`${friday} 21:59`, zone))).toBe(
          false,
        );
        expect(isCovered(shifts, tzInstant(`${friday} 22:00`, zone))).toBe(
          true,
        );
        expect(isCovered(shifts, tzInstant(`${saturday} 12:00`, zone))).toBe(
          true,
        );
        expect(isCovered(shifts, tzInstant(`${sunday} 12:00`, zone))).toBe(
          true,
        );
        expect(isCovered(shifts, tzInstant(`${monday} 05:59`, zone))).toBe(
          true,
        );
        expect(isCovered(shifts, tzInstant(`${monday} 06:00`, zone))).toBe(
          false,
        );
      }
    });

    /*
     * At half past each hour: a turn begins a second after its hand-off
     * (the engine's seam), and this layer hands off at Monday 09:00.
     */
    test("hour by hour through the weeks of both changes, someone is on call exactly in Monday's hours", () => {
      const shifts: Array<CalendarEvent> = shiftsOf(
        zone,
        layerOf(
          zone,
          weekly([
            windowIn(zone, {
              startDay: DayOfWeek.Monday,
              start: "2026-01-05 09:00",
              endDay: DayOfWeek.Monday,
              end: "2026-01-05 17:00",
            }),
          ]),
        ),
      );

      const weeksOfChanges: Array<string> =
        zone === WARSAW
          ? ["2026-03-23", "2026-03-30", "2026-10-19", "2026-10-26"]
          : ["2026-03-02", "2026-03-09", "2026-10-26", "2026-11-02"];

      for (const monday of weeksOfChanges) {
        const first: Date = tzInstant(`${monday} 00:30`, zone);

        for (let hour: number = 0; hour < 7 * 24; hour++) {
          const instant: Date = new Date(first.getTime() + hour * HOUR_MS);
          const clock: moment.Moment = moment.tz(instant, zone);
          const isMondayHours: boolean =
            clock.format("dddd") === DayOfWeek.Monday &&
            clock.hour() >= 9 &&
            clock.hour() < 17;

          expect({
            at: clock.format("ddd YYYY-MM-DD HH:mm"),
            onCall: isCovered(shifts, instant),
          }).toEqual({
            at: clock.format("ddd YYYY-MM-DD HH:mm"),
            onCall: isMondayHours,
          });
        }
      }
    });

    test("the roster, asked on the Monday after each change, has the turn's person on call until 17:00", () => {
      const layer: LayerProps = layerOf(
        zone,
        weekly([
          windowIn(zone, {
            startDay: DayOfWeek.Monday,
            start: "2026-01-05 09:00",
            endDay: DayOfWeek.Monday,
            end: "2026-01-05 17:00",
          }),
        ]),
      );

      const mondaysAfterChanges: Array<string> =
        zone === WARSAW
          ? ["2026-03-30", "2026-10-26"]
          : ["2026-03-09", "2026-11-02"];

      for (const monday of mondaysAfterChanges) {
        const now: Date = tzInstant(`${monday} 10:00`, zone);
        const windowEnd: Date = new Date(now.getTime() + 30 * 24 * HOUR_MS);
        const roster: ScheduleRosterState = ScheduleRoster.getRoster({
          segments: ScheduleResolution.resolve({
            layers: [layer],
            calendarStartDate: new Date(now.getTime() - 14 * 24 * HOUR_MS),
            calendarEndDate: windowEnd,
            overrides: [],
          }).events,
          now: now,
          windowEnd: windowEnd,
        });

        expect(roster.current).not.toBeNull();
        expect(moment.tz(roster.current!.end, zone).format("dddd HH:mm")).toBe(
          "Monday 17:00",
        );
        expect(moment.tz(roster.next!.start, zone).format("dddd HH:mm")).toBe(
          "Monday 09:00",
        );
      }
    });
  },
);

describe("a schedule moved from Warsaw to New York pages on the same days and hours there", () => {
  test("Monday 01:00 to 09:00, set in Warsaw, pages Monday 01:00 to 09:00 in New York - not from Sunday 19:00", () => {
    const set: RestrictionTimes = weekly([
      windowIn(WARSAW, {
        startDay: DayOfWeek.Monday,
        start: "2026-01-05 01:00",
        endDay: DayOfWeek.Monday,
        end: "2026-01-05 09:00",
      }),
    ]);

    /*
     * Its moments read in New York, as before #11455: from Sunday 19:00 (the
     * first shift is cut at the range's start, so the second is read).
     */
    const unmoved: Array<CalendarEvent> = shiftsOf(
      NEW_YORK,
      layerOf(NEW_YORK, set),
    );
    expect(describeShift(unmoved[1]!, NEW_YORK)).toBe(
      "Sunday 19:00 - Monday 03:00",
    );

    const moved: RestrictionTimes = WeeklyWindowDays.moveWindowsToTimezone(
      set,
      WARSAW,
      NEW_YORK,
    );
    const shifts: Array<CalendarEvent> = shiftsOf(
      NEW_YORK,
      layerOf(NEW_YORK, moved),
    );

    expect(
      Array.from(
        new Set(
          shifts.map((shift: CalendarEvent) => {
            return describeShift(shift, NEW_YORK);
          }),
        ),
      ),
    ).toEqual(["Monday 01:00 - Monday 09:00"]);
    expect(
      shifts.map((shift: CalendarEvent) => {
        return moment.tz(shift.start, NEW_YORK).format("YYYY-MM-DD");
      }),
    ).toEqual(datesOf(DayOfWeek.Monday, NEW_YORK));
  });

  test("the hand-off moves with the zone: 09:00 in Warsaw is 09:00 in New York", () => {
    const handOff: Date = WeeklyWindowDays.moveMomentToTimezone(
      tzInstant("2026-01-12 09:00", WARSAW),
      WARSAW,
      NEW_YORK,
    );

    expect(moment.tz(handOff, NEW_YORK).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-01-12 09:00",
    );
  });
});
