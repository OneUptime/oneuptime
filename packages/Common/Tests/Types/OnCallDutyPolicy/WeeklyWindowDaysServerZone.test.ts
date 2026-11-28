/** @timezone Pacific/Auckland */

import DayOfWeek from "../../../Types/Day/DayOfWeek";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays, {
  StoredWindowRepair,
  StoredWindowState,
} from "../../../Types/OnCallDutyPolicy/WeeklyWindowDays";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A SCHEDULE WITHOUT A TIME ZONE READS ITS WINDOWS ON THE SERVER'S CLOCK
 * (#11455), and so do the rules its windows are held to: the day a left-out
 * day is filled in with, and the day a time is moved onto. Run on a server
 * in Auckland - UTC+13 in January, far from the UTC CI runs in - so a rule
 * that read UTC instead would be seen to.
 */

function dateTime(iso: string): JSONObject {
  return { _type: ObjectType.DateTime, value: iso };
}

function weekly(windows: Array<unknown>): RestrictionTimes {
  const restriction: RestrictionTimes = new RestrictionTimes();
  restriction.restrictionType = RestrictionType.Weekly;
  restriction.weeklyRestrictionTimes = windows as Array<WeeklyResctriction>;
  return restriction;
}

describe("the server's clock, for a schedule without a zone", () => {
  test("the zone took: Auckland, UTC+13 in January", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Pacific/Auckland",
    );
    expect(new Date("2026-01-05T00:00:00.000Z").getTimezoneOffset()).toBe(
      -13 * 60,
    );
  });

  test("a day left out is the day its time falls on in Auckland, as the engine reads it", () => {
    // Sunday 20:00 UTC is Monday 09:00 in Auckland.
    const checked: RestrictionTimes = WeeklyWindowDays.checkWrittenWindows(
      weekly([
        {
          startTime: dateTime("2026-01-04T20:00:00.000Z"),
          endTime: dateTime("2026-01-05T04:00:00.000Z"),
        },
      ]),
      { timezone: null },
    );

    expect(checked.weeklyRestrictionTimes[0]!.startDay).toBe(DayOfWeek.Monday);
    expect(checked.weeklyRestrictionTimes[0]!.endDay).toBe(DayOfWeek.Monday);
  });

  test("a time dated wrong is moved onto its day on Auckland's clock, at its time of day there", () => {
    // Wednesday 09:00 in Auckland, named Friday: no zone puts it on a Friday.
    const repair: StoredWindowRepair = WeeklyWindowDays.getStoredWindowRepair(
      {
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Friday,
        startTime: moment.tz("2026-01-07 09:00", "Pacific/Auckland").toDate(),
        endTime: moment.tz("2026-01-07 17:00", "Pacific/Auckland").toDate(),
      },
      null,
    );

    expect(repair.state).toBe(StoredWindowState.MovedOntoItsDays);
    expect(
      moment
        .tz(repair.window.startTime, "Pacific/Auckland")
        .format("dddd HH:mm"),
    ).toBe("Friday 09:00");
    expect(
      moment.tz(repair.window.endTime, "Pacific/Auckland").format("dddd HH:mm"),
    ).toBe("Friday 17:00");
  });

  test("the engine, with no zone, puts a moved window on its day on the server's clock", () => {
    const repair: StoredWindowRepair = WeeklyWindowDays.getStoredWindowRepair(
      {
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Friday,
        startTime: moment.tz("2026-01-07 09:00", "Pacific/Auckland").toDate(),
        endTime: moment.tz("2026-01-07 17:00", "Pacific/Auckland").toDate(),
      },
      null,
    );

    const restriction: RestrictionTimes = weekly([repair.window]);
    const layer: LayerUtil = new LayerUtil();

    const windows: Array<StartAndEndTime> = layer.getEventsByWeeklyRestriction({
      eventStartTime: moment
        .tz("2026-01-11 00:00", "Pacific/Auckland")
        .toDate(),
      eventEndTime: moment.tz("2026-01-25 00:00", "Pacific/Auckland").toDate(),
      restrictionTimes: restriction,
    });

    expect(
      windows.map((window: StartAndEndTime): string => {
        return `${moment
          .tz(window.startTime, "Pacific/Auckland")
          .format("ddd YYYY-MM-DD HH:mm")} - ${moment
          .tz(window.endTime, "Pacific/Auckland")
          .format("HH:mm")}`;
      }),
    ).toEqual(["Fri 2026-01-16 09:00 - 17:00", "Fri 2026-01-23 09:00 - 17:00"]);
  });
});
