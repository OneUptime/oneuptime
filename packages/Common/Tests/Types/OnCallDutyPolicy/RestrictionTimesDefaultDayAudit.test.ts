import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * Audit M4: getDefaultWeeklyRestrictionTIme() built startTime/endTime with
 * getDateWithCustomTime(), which stamps TODAY's date. The rotation engine derives
 * the ENFORCED weekday purely from the timestamp (getDayOfWeek(startTime)), not
 * from the startDay/endDay enum the dropdown displays — so an untouched default
 * enforced coverage on TODAY's weekday while still showing "Sunday -> Monday".
 * The fix anchors the default timestamps onto the named weekday so the enforced
 * day matches the displayed day.
 */

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

describe("RestrictionTimes audit M4: default weekly restriction weekday", () => {
  test("default startTime falls on Sunday and endTime on Monday (matches the enum)", () => {
    const def: WeeklyResctriction =
      RestrictionTimes.getDefaultWeeklyRestrictionTIme();

    expect(def.startDay).toBe(DayOfWeek.Sunday);
    expect(def.endDay).toBe(DayOfWeek.Monday);

    /*
     * The TIMESTAMP's weekday — what the engine actually enforces — matches the
     * enum. Before the fix this was TODAY's weekday.
     */
    expect(OneUptimeDate.getDayOfWeek(def.startTime)).toBe(DayOfWeek.Sunday);
    expect(OneUptimeDate.getDayOfWeek(def.endTime)).toBe(DayOfWeek.Monday);
  });

  test("default preserves the intended times of day (00:00 start, 01:00 end)", () => {
    const def: WeeklyResctriction =
      RestrictionTimes.getDefaultWeeklyRestrictionTIme();

    expect(new Date(def.startTime).getHours()).toBe(0);
    expect(new Date(def.endTime).getHours()).toBe(1);
  });

  test("engine enforces the default weekly restriction on Sunday, not today", () => {
    /*
     * Wednesday 2025-06-04 — the layer/window start deliberately falls on a
     * non-Sunday to prove enforcement follows the restriction weekday, not the
     * start day.
     */
    const anchor: Date = new Date(Date.UTC(2025, 5, 4, 0, 0, 0));

    const rt: RestrictionTimes = new RestrictionTimes();
    rt.restictionType = RestrictionType.Weekly;
    rt.weeklyRestrictionTimes = [
      RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
    ];

    const r: Recurring = new Recurring();
    r.intervalType = EventInterval.Week;
    r.intervalCount = new PositiveNumber(1);

    /*
     * Expand in the SAME zone the Common default was built in (server-local, i.e.
     * timezone undefined). getDefaultWeeklyRestrictionTIme lands the timestamp on
     * Sunday in server-local time; enforcing and reading the weekday in that same
     * zone keeps the assertion independent of the CI machine's timezone (the
     * frontend reconciles the default to the schedule zone separately).
     */
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: rt,
      rotation: r,
      timezone: undefined,
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      calendarStartDate: anchor,
      calendarEndDate: new Date(Date.UTC(2025, 5, 18, 0, 0, 0)),
    });

    expect(events.length).toBeGreaterThan(0);

    /*
     * Every emitted covered segment must start on Sunday (the restriction window
     * is Sunday 00:00 -> Monday 01:00). Before the fix the default landed on the
     * current weekday, so coverage appeared mid-week instead. Monday is allowed
     * only as the continuation edge; no segment may start Tue-Sat.
     */
    for (const e of events) {
      const startDow: DayOfWeek = OneUptimeDate.getDayOfWeek(new Date(e.start));
      expect([DayOfWeek.Sunday, DayOfWeek.Monday]).toContain(startDow);
    }
  });
});
