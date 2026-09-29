/**
 * REGRESSION SUITE for the restricted-rotation post-window-gap off-by-one fix
 * (audit F2).
 *
 * When the roster is resolved partway through a rotation period, AFTER that
 * period's restriction window has already closed (the live "who is on call
 * now / next" path resolving in a daily or weekend off-hours gap), the windowed
 * expansion used to carry the current period's user into the next period,
 * paging/notifying the WRONG "next" user for every subsequent shift.
 *
 * The fix decides the first-period rotation advance on the period's FULL span
 * rather than the clamped [now, periodEnd] slice. These tests lock in that
 * behavior AND assert the #2413 "fully-restricted period keeps its turn skipped"
 * behavior is preserved (the guard the fix touches).
 */
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import DayOfWeek from "../../../Types/Day/DayOfWeek";

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

function dailyRestriction(sh: number, eh: number): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: sh,
      minutes: 0,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: eh,
      minutes: 0,
      seconds: 0,
    }),
  };
  return r;
}

function dailyLayer(data: {
  users: string[];
  intervalCount: number;
  restriction: RestrictionTimes;
  start: Date;
}): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = EventInterval.Day;
  rot.intervalCount = new PositiveNumber(data.intervalCount);
  return {
    users: data.users.map(user),
    startDateTimeOfLayer: data.start,
    restrictionTimes: data.restriction,
    handOffTime: Recurring.getNextDateInterval(data.start, rot),
    rotation: rot,
    timezone: undefined,
  };
}

/*
 * Who does the LIVE roster path (windowed, getNumberOfEvents:1) resolve as the
 * first covered event at instant `at`.
 */
function windowedNextAt(
  layer: LayerProps,
  at: Date,
): CalendarEvent | undefined {
  const util: LayerUtil = new LayerUtil();
  return util.getMultiLayerEvents(
    {
      layers: [layer],
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 20),
    },
    { getNumberOfEvents: 1 },
  )[0];
}

// Ground-truth covering (or next) user from a full expansion.
function fullExpand(
  layer: LayerProps,
  from: Date,
  to: Date,
): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();
  return util.getEvents({
    ...layer,
    calendarStartDate: from,
    calendarEndDate: to,
  });
}

const MON_JAN6: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z");

describe("F2 fix: daily rotation post-window gap resolves the correct next user", () => {
  test("x1 daily, [A,B], 09-17: evening gaps never go off-by-one over 10 days", () => {
    const layer: LayerProps = dailyLayer({
      users: ["A", "B"],
      intervalCount: 1,
      restriction: dailyRestriction(9, 17),
      start: MON_JAN6,
    });

    const full: Array<CalendarEvent> = fullExpand(
      layer,
      MON_JAN6,
      OneUptimeDate.addRemoveDays(MON_JAN6, 12),
    );

    /*
     * For each day, the evening (post-17:00) gap query's "next" must equal the
     * NEXT day's covered user in the full expansion.
     */
    for (let day: number = 0; day < 9; day++) {
      const eveningGap: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.addRemoveDays(MON_JAN6, day),
        20, // 20:00, after the 09-17 window closed
      );
      const nextCovered: CalendarEvent | undefined = full.find(
        (e: CalendarEvent) => {
          return OneUptimeDate.isAfter(e.start, eveningGap);
        },
      );
      const windowed: CalendarEvent | undefined = windowedNextAt(
        layer,
        eveningGap,
      );
      expect(windowed?.title).toBe(nextCovered?.title);
    }
  });

  test("x1 daily, 3 users [A,B,C], 09-17: evening gap next-user matches calendar", () => {
    const layer: LayerProps = dailyLayer({
      users: ["A", "B", "C"],
      intervalCount: 1,
      restriction: dailyRestriction(9, 17),
      start: MON_JAN6,
    });
    const full: Array<CalendarEvent> = fullExpand(
      layer,
      MON_JAN6,
      OneUptimeDate.addRemoveDays(MON_JAN6, 12),
    );
    for (let day: number = 0; day < 9; day++) {
      const eveningGap: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.addRemoveDays(MON_JAN6, day),
        20,
      );
      const nextCovered: CalendarEvent | undefined = full.find(
        (e: CalendarEvent) => {
          return OneUptimeDate.isAfter(e.start, eveningGap);
        },
      );
      expect(windowedNextAt(layer, eveningGap)?.title).toBe(nextCovered?.title);
    }
  });

  test("x2 daily, [A,B], 09-17: last-day evening gap advances to next user", () => {
    const layer: LayerProps = dailyLayer({
      users: ["A", "B"],
      intervalCount: 2,
      restriction: dailyRestriction(9, 17),
      start: MON_JAN6,
    });
    /*
     * Period 1 = [Jan6,Jan8) = A (covers Jan6 & Jan7). Period 2 = [Jan8,Jan10) = B.
     * Querying on Jan7 evening (last covered day of period 1, after 17:00) must
     * resolve the NEXT covered shift = Jan8 = B, not A.
     */
    const jan7evening: Date = OneUptimeDate.fromString(
      "2025-01-07T20:00:00.000Z",
    );
    const next: CalendarEvent | undefined = windowedNextAt(layer, jan7evening);
    expect(next?.title).toBe("B");
    expect(next?.start.getUTCDate()).toBe(8);

    // Querying on Jan6 evening (still period 1, Jan7 window ahead) resolves A/Jan7.
    const jan6evening: Date = OneUptimeDate.fromString(
      "2025-01-06T20:00:00.000Z",
    );
    const next2: CalendarEvent | undefined = windowedNextAt(layer, jan6evening);
    expect(next2?.title).toBe("A");
    expect(next2?.start.getUTCDate()).toBe(7);
  });
});

describe("F2 fix preserves #2413: fully-restricted periods still skip their turn", () => {
  test("daily [A,B], Mon-Fri only (weekend fully off): weekend query resolves next Monday's user", () => {
    /*
     * Restriction Mon 00:00 -> Sat 00:00 via a weekly restriction => Sat & Sun
     * are fully restricted (no coverage). Rotation must NOT advance across the
     * dead weekend, so the sequence of covered days stays a clean A,B,A,B...
     */
    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Saturday,
      startTime: OneUptimeDate.fromString("2025-01-06T00:00:00.000Z"),
      endTime: OneUptimeDate.fromString("2025-01-11T00:00:00.000Z"),
    };
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    r.weeklyRestrictionTimes = [weekly];

    const rot: Recurring = new Recurring();
    rot.intervalType = EventInterval.Day;
    rot.intervalCount = new PositiveNumber(1);
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: MON_JAN6,
      restrictionTimes: r,
      handOffTime: Recurring.getNextDateInterval(MON_JAN6, rot),
      rotation: rot,
      timezone: undefined,
    };

    const full: Array<CalendarEvent> = fullExpand(
      layer,
      MON_JAN6,
      OneUptimeDate.addRemoveDays(MON_JAN6, 14),
    );

    /*
     * A Saturday-gap query (Jan 11) must resolve to the next covered day
     * (Monday Jan 13) with the SAME user the calendar assigns it.
     */
    const saturdayGap: Date = OneUptimeDate.fromString(
      "2025-01-11T12:00:00.000Z",
    );
    const nextCovered: CalendarEvent | undefined = full.find(
      (e: CalendarEvent) => {
        return OneUptimeDate.isAfter(e.start, saturdayGap);
      },
    );
    expect(nextCovered).toBeTruthy();
    expect(windowedNextAt(layer, saturdayGap)?.title).toBe(nextCovered?.title);
  });
});
