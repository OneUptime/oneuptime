import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import {
  MaintenanceWindow,
  getDefaultMaintenanceWindow,
} from "../../../Types/ScheduledMaintenance/MaintenanceWindow";
import MaintenanceTemplateSchedule, {
  MaintenanceTemplateScheduleColumns,
} from "../../../Types/ScheduledMaintenance/MaintenanceTemplateSchedule";
import Timezone from "../../../Types/Timezone";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * MAINTENANCE WINDOWS AND SCHEDULES IN BRITISH COLUMBIA ACROSS 2026-11-01
 * (issue #9999).
 *
 * British Columbia stayed on UTC-7 when the rest of the Pacific zone fell
 * back on 2026-11-01 (tzdata 2026b). With tzdata 2024b OneUptime read it
 * as UTC-8 from that night, so a maintenance window typed as 02:00 was
 * saved as 03:00 on British Columbia's clocks, and one already saved read
 * an hour early.
 *
 *   - A scheduled maintenance event typed in British Columbia is the
 *     instant its wall clock names there (OneUptimeDate's datetime-local
 *     bridge), and reads back as typed.
 *   - A recurring maintenance template steps whole days and weeks of its
 *     own time zone's calendar (MaintenanceTemplateSchedule, #10037):
 *     British Columbia keeps one offset now, so every occurrence of a 02:00
 *     window is 02:00 there, as it is in a zone that still changes its
 *     clocks.
 *   - A schedule stepped in calendar units in a zone (status page reports,
 *     workspace summaries: Recurring.getNextDateAfter) keeps its wall clock:
 *     09:00 in Vancouver is 16:00 UTC on either side of 1 November, and
 *     09:00 in Los Angeles, which still falls back, moves to 17:00 UTC.
 *   - A new event's default window starts at the next full hour of the
 *     reader's clock.
 */

const VANCOUVER: Timezone = Timezone.AmericaVancouver;
const CANADA_PACIFIC: Timezone = Timezone.CanadaPacific;
const LOS_ANGELES: Timezone = Timezone.AmericaLos_Angeles;
const TIJUANA: Timezone = Timezone.AmericaTijuana;

function recurring(
  intervalType: EventInterval,
  intervalCount: number = 1,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  });
}

function at(wallClock: string, zone: string): Date {
  return moment.tz(wallClock, zone).toDate();
}

function wallClockOf(instant: Date, zone: string): string {
  return moment.tz(instant, zone).format("YYYY-MM-DD HH:mm z");
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.useRealTimers();
});

describe.each([VANCOUVER, CANADA_PACIFIC])(
  "a maintenance window typed in %s",
  (zone: Timezone) => {
    test("from 02:00 to 04:00 on 2026-12-01 is 09:00 to 11:00 UTC, and reads back as typed", () => {
      OneUptimeDate.setUserTimezone(zone);

      const startsAt: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-12-01T02:00");
      const endsAt: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-12-01T04:00");

      // tzdata 2024b saved these as 10:00 and 12:00 UTC: 03:00 to 05:00 there.
      expect(startsAt.toISOString()).toBe("2026-12-01T09:00:00.000Z");
      expect(endsAt.toISOString()).toBe("2026-12-01T11:00:00.000Z");

      expect(OneUptimeDate.toDateTimeLocalString(startsAt)).toBe(
        "2026-12-01T02:00:00",
      );
      expect(OneUptimeDate.toDateTimeLocalString(endsAt)).toBe(
        "2026-12-01T04:00:00",
      );
      expect(OneUptimeDate.getDateAsLocalFormattedString(startsAt)).toContain(
        "02:00 MST",
      );
    });

    test("across the night of 2026-11-01, 01:00 to 03:00 lasts two hours, not three", () => {
      OneUptimeDate.setUserTimezone(zone);

      const startsAt: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-11-01T01:00");
      const endsAt: Date =
        OneUptimeDate.fromDateTimeLocalString("2026-11-01T03:00");

      expect(endsAt.getTime() - startsAt.getTime()).toBe(2 * 60 * 60 * 1000);
    });
  },
);

describe("a recurring maintenance template's next event in British Columbia", () => {
  // A template whose first event is created at `first`, in `zone`.
  function template(
    first: Date,
    zone: Timezone,
    interval: EventInterval,
  ): MaintenanceTemplateScheduleColumns {
    return {
      firstEventScheduledAt: first,
      firstEventStartsAt: new Date(first.getTime() + 60 * 60 * 1000),
      firstEventEndsAt: new Date(first.getTime() + 2 * 60 * 60 * 1000),
      recurringInterval: recurring(interval),
      timezone: zone,
    };
  }

  test.each([VANCOUVER, CANADA_PACIFIC])(
    "a daily 02:00 window in %s, first on 2026-10-28, is next at 02:00 on 2026-11-20",
    (zone: Timezone) => {
      const next: Date = MaintenanceTemplateSchedule.getNextEventAt(
        template(at("2026-10-28 02:00", zone), zone, EventInterval.Day),
        new Date("2026-11-19T12:00:00.000Z"),
      )!;

      expect(next.toISOString()).toBe("2026-11-20T09:00:00.000Z");
      expect(wallClockOf(next, zone)).toBe("2026-11-20 02:00 MST");
    },
  );

  test.each([VANCOUVER, CANADA_PACIFIC])(
    "a weekly Tuesday 22:00 window in %s, first on 2026-10-27, is next at 22:00 on Tuesday 2026-11-24",
    (zone: Timezone) => {
      const next: Date = MaintenanceTemplateSchedule.getNextEventAt(
        template(at("2026-10-27 22:00", zone), zone, EventInterval.Week),
        new Date("2026-11-19T12:00:00.000Z"),
      )!;

      expect(wallClockOf(next, zone)).toBe("2026-11-24 22:00 MST");
      expect(moment.tz(next, zone).day()).toBe(2);
    },
  );

  // Los Angeles still falls back: the same window keeps 02:00 there, at 10:00 UTC.
  test("a daily 02:00 window in Los Angeles, first on 2026-10-28, is next at 02:00 PST on 2026-11-20", () => {
    const next: Date = MaintenanceTemplateSchedule.getNextEventAt(
      template(
        at("2026-10-28 02:00", LOS_ANGELES),
        LOS_ANGELES,
        EventInterval.Day,
      ),
      new Date("2026-11-19T12:00:00.000Z"),
    )!;

    expect(next.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(wallClockOf(next, LOS_ANGELES)).toBe("2026-11-20 02:00 PST");
  });

  test("every daily occurrence from October 2026 to March 2027 is at 02:00 in Vancouver", () => {
    const first: Date = at("2026-10-15 02:00", VANCOUVER);
    const wallClocks: Set<string> = new Set<string>();

    for (let day: number = 1; day <= 160; day++) {
      const occurrence: Date = Recurring.getNextDateInterval(
        first,
        recurring(EventInterval.Day, day),
      );

      wallClocks.add(moment.tz(occurrence, VANCOUVER).format("HH:mm"));
    }

    expect([...wallClocks]).toEqual(["02:00"]);
  });
});

describe("a schedule stepped in calendar days and weeks in its zone (reports, summaries)", () => {
  test.each([VANCOUVER, CANADA_PACIFIC])(
    "a weekly Monday 09:00 schedule in %s is next at 09:00 on 2026-11-02: 16:00 UTC, as before 1 November",
    (zone: Timezone) => {
      const next: Date = Recurring.getNextDateAfter({
        startDate: at("2026-10-26 09:00", zone),
        recurring: recurring(EventInterval.Week),
        afterDate: new Date("2026-11-01T12:00:00.000Z"),
        timezone: zone,
      });

      expect(next.toISOString()).toBe("2026-11-02T16:00:00.000Z");
      expect(at("2026-10-26 09:00", zone).toISOString()).toBe(
        "2026-10-26T16:00:00.000Z",
      );
    },
  );

  test.each([LOS_ANGELES, TIJUANA])(
    "a weekly Monday 09:00 schedule in %s, which still falls back, is next at 09:00 on 2026-11-02: 17:00 UTC",
    (zone: Timezone) => {
      const next: Date = Recurring.getNextDateAfter({
        startDate: at("2026-10-26 09:00", zone),
        recurring: recurring(EventInterval.Week),
        afterDate: new Date("2026-11-01T12:00:00.000Z"),
        timezone: zone,
      });

      expect(next.toISOString()).toBe("2026-11-02T17:00:00.000Z");
      expect(wallClockOf(next, zone)).toBe("2026-11-02 09:00 PST");
    },
  );

  test("a daily 09:00 schedule in Vancouver runs at 16:00 UTC every day across 2026-11-01", () => {
    const start: Date = at("2026-10-28 09:00", VANCOUVER);
    const runs: Array<string> = [];
    let after: Date = start;

    for (let i: number = 0; i < 8; i++) {
      after = Recurring.getNextDateAfter({
        startDate: start,
        recurring: recurring(EventInterval.Day),
        afterDate: after,
        timezone: VANCOUVER,
      });
      runs.push(after.toISOString().slice(11, 16));
    }

    expect(runs).toEqual(new Array(8).fill("16:00"));
  });
});

describe("a new maintenance event's default window", () => {
  test.each([VANCOUVER, CANADA_PACIFIC])(
    "starts at the next full hour of %s's clock, for an hour",
    (zone: Timezone) => {
      const window: MaintenanceWindow = getDefaultMaintenanceWindow({
        // 09:20 in British Columbia.
        now: new Date("2026-11-19T16:20:00.000Z"),
        timezone: zone,
      });

      expect(wallClockOf(window.startsAt, zone)).toBe("2026-11-19 10:00 MST");
      expect(wallClockOf(window.endsAt, zone)).toBe("2026-11-19 11:00 MST");
    },
  );
});
