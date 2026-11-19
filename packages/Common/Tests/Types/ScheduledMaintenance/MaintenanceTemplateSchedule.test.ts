import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import MaintenanceTemplateSchedule, {
  MaintenanceTemplateDueEvent,
  MaintenanceTemplateEvent,
  MaintenanceTemplateScheduleColumns,
  MaintenanceTemplateScheduleData,
} from "../../../Types/ScheduledMaintenance/MaintenanceTemplateSchedule";
import Timezone from "../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A RECURRING MAINTENANCE TEMPLATE'S EVENTS KEEP THEIR WALL CLOCK (#10037).
 *
 * Every event of a template is its first event moved on whole days, weeks,
 * months or years of the template's own clock (MaintenanceTemplateSchedule,
 * Recurring.getOccurrence). Until #10037 the next event was the one before
 * plus fixed milliseconds - a day of 24 hours, a month of 30.4375 days - so
 * a daily 02:00 window in Los Angeles ran at 01:00 there all winter, and a
 * monthly window on the 1st walked to 31 January and 2 March.
 *
 * The sweeps below walk more than two years of events of daily, weekly and
 * monthly templates in New York, Berlin, Sydney, Vancouver and UTC, and
 * check every time of every event against an oracle that reads the tz
 * database's offsets itself - never moment's own parsing or stepping - with
 * the rules the schedule promises:
 *
 *   - the date moves on whole calendar units from the first event's, and a
 *     day of the month a month does not have is its last day;
 *   - the time of day is the first event's;
 *   - a time the clocks skip is moved on by the jump; a time they pass
 *     twice is the first of the two.
 *
 * The edge cases are named on their own after the sweeps: month ends,
 * skipped and doubled hours on either side of the change, a zone that
 * stopped changing its clocks (British Columbia), elapsed hours, a window
 * whose start the clocks skip past its end, the job's due event, and the
 * templates saved before they had a time zone.
 */

const NEW_YORK: Timezone = Timezone.AmericaNew_York;
const BERLIN: Timezone = Timezone.EuropeBerlin;
const SYDNEY: Timezone = Timezone.AustraliaSydney;
const VANCOUVER: Timezone = Timezone.AmericaVancouver;
const LOS_ANGELES: Timezone = Timezone.AmericaLos_Angeles;
const UTC: Timezone = Timezone.UTC;

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

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

// An instant from a wall clock in a zone, as a person types it.
function at(wallClock: string, zone: string): Date {
  return moment.tz(wallClock, "YYYY-MM-DD HH:mm", true, zone).toDate();
}

function wallClockOf(instant: Date, zone: string): string {
  return moment.tz(instant, zone).format("YYYY-MM-DD HH:mm");
}

/*
 * THE ORACLE. A wall clock - year, month, day, hour, minute - read on a
 * zone's clock with the tz database's own offsets: the one instant that
 * reads it there; of two, the first; of none (the clocks skipped it), the
 * instant it would be with the offset of the hours before the jump, which
 * is the wall clock moved on by the jump.
 */
interface WallClock {
  year: number;
  // 0 to 11, as Date.UTC takes it.
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function offsetInMs(zone: string, instant: number): number {
  // moment's utcOffset of a zone is minutes WEST of UTC.
  return -moment.tz.zone(zone)!.utcOffset(instant) * MINUTE_IN_MS;
}

function readsAs(zone: string, instant: number, wallClock: number): boolean {
  return instant + offsetInMs(zone, instant) === wallClock;
}

function resolve(wallClock: WallClock, zone: string): Date {
  const asUtc: number = Date.UTC(
    wallClock.year,
    wallClock.month,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
  );

  // Every offset the zone has around that day.
  const offsets: Set<number> = new Set<number>();

  for (let hours: number = -36; hours <= 36; hours += 1) {
    offsets.add(offsetInMs(zone, asUtc + hours * HOUR_IN_MS));
  }

  const readings: Array<number> = [...offsets]
    .map((offset: number): number => {
      return asUtc - offset;
    })
    .filter((instant: number): boolean => {
      return readsAs(zone, instant, asUtc);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  if (readings.length > 0) {
    return new Date(readings[0]!);
  }

  // Skipped: read with the offset of the day before.
  return new Date(asUtc - offsetInMs(zone, asUtc - DAY_IN_MS));
}

function wallClockIn(instant: Date, zone: string): WallClock {
  const local: moment.Moment = moment.tz(instant, zone);

  return {
    year: local.year(),
    month: local.month(),
    day: local.date(),
    hour: local.hour(),
    minute: local.minute(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// The first event's wall clock moved on whole calendar units, its day clamped.
function stepWallClock(
  first: WallClock,
  intervalType: EventInterval,
  units: number,
): WallClock {
  if (intervalType === EventInterval.Month) {
    const months: number = first.year * 12 + first.month + units;
    const year: number = Math.floor(months / 12);
    const month: number = months % 12;

    return {
      ...first,
      year: year,
      month: month,
      day: Math.min(first.day, daysInMonth(year, month)),
    };
  }

  if (intervalType === EventInterval.Year) {
    const year: number = first.year + units;

    return {
      ...first,
      year: year,
      day: Math.min(first.day, daysInMonth(year, first.month)),
    };
  }

  const days: number = intervalType === EventInterval.Week ? units * 7 : units;
  const date: Date = new Date(
    Date.UTC(first.year, first.month, first.day + days),
  );

  return {
    ...first,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

function schedule(data: {
  zone: Timezone;
  scheduledAt: string;
  startsAt: string;
  endsAt: string;
  intervalType: EventInterval;
  intervalCount?: number | undefined;
}): MaintenanceTemplateScheduleData {
  return MaintenanceTemplateSchedule.read({
    firstEventScheduledAt: at(data.scheduledAt, data.zone),
    firstEventStartsAt: at(data.startsAt, data.zone),
    firstEventEndsAt: at(data.endsAt, data.zone),
    recurringInterval: recurring(data.intervalType, data.intervalCount),
    timezone: data.zone,
  })!;
}

// The instant's offset differs from the one a day earlier: a change day.
function isNearAClockChange(zone: string, instant: Date): boolean {
  return (
    offsetInMs(zone, instant.getTime()) !==
      offsetInMs(zone, instant.getTime() - DAY_IN_MS) ||
    offsetInMs(zone, instant.getTime()) !==
      offsetInMs(zone, instant.getTime() + DAY_IN_MS)
  );
}

interface SweepCase {
  name: string;
  zone: Timezone;
  intervalType: EventInterval;
  // How many events: more than two years of them.
  events: number;
  scheduledAt: string;
  startsAt: string;
  endsAt: string;
  // How many events land on a day the clocks change, at least.
  minimumChangeDays: number;
}

/*
 * Windows that sit on the hours the clocks change in each zone, so the
 * sweeps meet skipped and doubled times: in New York and Vancouver (whose
 * clocks change at 02:00) 01:30 to 02:30 - a start the clocks pass twice
 * in November, an end they skip in March; in Berlin and Sydney (whose
 * clocks change between 02:00 and 03:00) 02:15 to 04:00 - a start skipped
 * in spring and passed twice in autumn. Each is created the evening
 * before; a monthly one, on the 31st itself, so every time of it moves to
 * the same last day of a shorter month.
 */
interface SweepZone {
  zone: Timezone;
  // The first day of the daily and weekly sweeps, and of the monthly one.
  firstDay: string;
  firstMonthlyDay: string;
  startsAt: string;
  endsAt: string;
  // Days the clocks change that the daily sweep crosses, at least.
  changeDays: number;
}

const SWEEP_ZONES: Array<SweepZone> = [
  {
    zone: NEW_YORK,
    firstDay: "2026-06-02",
    firstMonthlyDay: "2026-07-31",
    startsAt: "01:30",
    endsAt: "02:30",
    changeDays: 4,
  },
  {
    zone: BERLIN,
    firstDay: "2026-06-02",
    firstMonthlyDay: "2026-07-31",
    startsAt: "02:15",
    endsAt: "04:00",
    changeDays: 4,
  },
  {
    zone: SYDNEY,
    firstDay: "2026-06-02",
    firstMonthlyDay: "2026-07-31",
    startsAt: "02:15",
    endsAt: "04:00",
    changeDays: 4,
  },
  {
    // From before British Columbia's last change, on 8 March 2026.
    zone: VANCOUVER,
    firstDay: "2026-02-02",
    firstMonthlyDay: "2026-01-31",
    startsAt: "01:30",
    endsAt: "02:30",
    changeDays: 1,
  },
  {
    zone: UTC,
    firstDay: "2026-06-02",
    firstMonthlyDay: "2026-07-31",
    startsAt: "01:30",
    endsAt: "02:30",
    changeDays: 0,
  },
];

function dayBefore(day: string): string {
  return moment
    .utc(day, "YYYY-MM-DD", true)
    .subtract(1, "day")
    .format("YYYY-MM-DD");
}

const SWEEPS: Array<SweepCase> = SWEEP_ZONES.flatMap(
  (zone: SweepZone): Array<SweepCase> => {
    return [
      {
        name: `daily in ${zone.zone}`,
        zone: zone.zone,
        intervalType: EventInterval.Day,
        events: 800,
        scheduledAt: `${dayBefore(zone.firstDay)} 22:30`,
        startsAt: `${zone.firstDay} ${zone.startsAt}`,
        endsAt: `${zone.firstDay} ${zone.endsAt}`,
        minimumChangeDays: zone.changeDays,
      },
      {
        name: `weekly in ${zone.zone}`,
        zone: zone.zone,
        intervalType: EventInterval.Week,
        events: 120,
        scheduledAt: `${dayBefore(zone.firstDay)} 22:30`,
        startsAt: `${zone.firstDay} ${zone.startsAt}`,
        endsAt: `${zone.firstDay} ${zone.endsAt}`,
        minimumChangeDays: 0,
      },
      {
        name: `monthly on the 31st in ${zone.zone}`,
        zone: zone.zone,
        intervalType: EventInterval.Month,
        events: 30,
        scheduledAt: `${zone.firstMonthlyDay} 00:15`,
        startsAt: `${zone.firstMonthlyDay} ${zone.startsAt}`,
        endsAt: `${zone.firstMonthlyDay} ${zone.endsAt}`,
        minimumChangeDays: 0,
      },
    ];
  },
);

describe("two years of events keep the first event's wall clock", () => {
  test.each(
    SWEEPS.map((sweep: SweepCase) => {
      return [sweep.name, sweep];
    }),
  )("%s", (_name: string, sweep: SweepCase) => {
    const data: MaintenanceTemplateScheduleData = schedule(sweep);
    const firstWallClocks: Array<WallClock> = [
      wallClockIn(data.firstEventScheduledAt, sweep.zone),
      wallClockIn(data.firstEventStartsAt, sweep.zone),
      wallClockIn(data.firstEventEndsAt, sweep.zone),
    ];

    let changeDays: number = 0;
    let previousScheduledAt: number = -Infinity;

    for (let index: number = 0; index < sweep.events; index++) {
      const event: MaintenanceTemplateEvent =
        MaintenanceTemplateSchedule.getEvent(data, index);
      const times: Array<Date> = [
        event.scheduledAt,
        event.startsAt,
        event.endsAt,
      ];

      times.forEach((time: Date, which: number) => {
        const expected: Date = resolve(
          stepWallClock(firstWallClocks[which]!, sweep.intervalType, index),
          sweep.zone,
        );

        expect([index, which, time.toISOString()]).toEqual([
          index,
          which,
          expected.toISOString(),
        ]);
      });

      // In order, and later than the event before.
      expect(event.scheduledAt.getTime()).toBeLessThan(
        event.startsAt.getTime(),
      );
      expect(event.startsAt.getTime()).toBeLessThan(event.endsAt.getTime());
      expect(event.scheduledAt.getTime()).toBeGreaterThan(previousScheduledAt);
      previousScheduledAt = event.scheduledAt.getTime();

      if (isNearAClockChange(sweep.zone, event.startsAt)) {
        changeDays++;
      }
    }

    // The sweep met the days the clocks change, where they change.
    expect(changeDays).toBeGreaterThanOrEqual(sweep.minimumChangeDays);

    // And it ran for more than two years.
    const last: MaintenanceTemplateEvent = MaintenanceTemplateSchedule.getEvent(
      data,
      sweep.events - 1,
    );

    expect(
      last.startsAt.getTime() - data.firstEventStartsAt.getTime(),
    ).toBeGreaterThan(2 * 365 * DAY_IN_MS);
  });
});

describe("a daily window in a zone that changes its clocks", () => {
  test("02:00 in Los Angeles, first on 2026-10-30, stays at 02:00 after 1 November: 10:00 UTC, not 09:00", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: LOS_ANGELES,
      scheduledAt: "2026-10-29 09:00",
      startsAt: "2026-10-30 02:00",
      endsAt: "2026-10-30 04:00",
      intervalType: EventInterval.Day,
    });

    const novemberSecond: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 3);

    expect(novemberSecond.startsAt.toISOString()).toBe(
      "2026-11-02T10:00:00.000Z",
    );
    expect(wallClockOf(novemberSecond.startsAt, LOS_ANGELES)).toBe(
      "2026-11-02 02:00",
    );
    expect(wallClockOf(novemberSecond.endsAt, LOS_ANGELES)).toBe(
      "2026-11-02 04:00",
    );
    expect(wallClockOf(novemberSecond.scheduledAt, LOS_ANGELES)).toBe(
      "2026-11-01 09:00",
    );

    // The old steps: three days of 24 hours after 09:00 UTC is 09:00 UTC, 01:00 PST.
    expect(
      new Date(data.firstEventStartsAt.getTime() + 3 * DAY_IN_MS).toISOString(),
    ).toBe("2026-11-02T09:00:00.000Z");
  });

  test.each([
    [NEW_YORK, "2027-03-13 02:00", "2027-03-15 02:00"],
    [BERLIN, "2027-03-27 02:00", "2027-03-29 02:00"],
    [SYDNEY, "2026-10-03 02:00", "2026-10-05 02:00"],
  ])(
    "in %s every day around the spring change starts at 02:00, the night it does not exist at 03:00",
    (zone: Timezone, before: string, after: string) => {
      const data: MaintenanceTemplateScheduleData = schedule({
        zone: zone,
        scheduledAt: `${before.slice(0, 10)} 00:30`,
        startsAt: before,
        endsAt: `${before.slice(0, 10)} 05:00`,
        intervalType: EventInterval.Day,
      });

      expect(
        [0, 1, 2].map((index: number): string => {
          return wallClockOf(
            MaintenanceTemplateSchedule.getEvent(data, index).startsAt,
            zone,
          );
        }),
      ).toEqual([
        before,
        `${moment
          .tz(before, "YYYY-MM-DD HH:mm", zone)
          .add(1, "day")
          .format("YYYY-MM-DD")} 03:00`,
        after,
      ]);
    },
  );
});

describe("a time the clocks pass twice is the first of the two", () => {
  test.each([
    ["an anchor in summer time", "2026-10-30 01:30", 2],
    ["an anchor in winter time", "2026-01-01 01:30", 304],
  ])(
    "01:30 in New York on 2026-11-01, from %s, is 01:30 EDT (05:30 UTC)",
    (_side: string, first: string, index: number) => {
      const data: MaintenanceTemplateScheduleData = schedule({
        zone: NEW_YORK,
        scheduledAt: `${first.slice(0, 10)} 00:30`,
        startsAt: first,
        endsAt: `${first.slice(0, 10)} 03:00`,
        intervalType: EventInterval.Day,
      });

      const event: MaintenanceTemplateEvent =
        MaintenanceTemplateSchedule.getEvent(data, index);

      expect(event.startsAt.toISOString()).toBe("2026-11-01T05:30:00.000Z");
      expect(moment.tz(event.startsAt, NEW_YORK).format("HH:mm z")).toBe(
        "01:30 EDT",
      );
    },
  );

  test("a monthly window anchored in winter on the 1st at 01:30 is the first 01:30 on 2026-11-01 too", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2026-01-01 00:00",
      startsAt: "2026-01-01 01:30",
      endsAt: "2026-01-01 03:00",
      intervalType: EventInterval.Month,
    });

    expect(
      MaintenanceTemplateSchedule.getEvent(data, 10).startsAt.toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  test.each([
    [BERLIN, "2026-10-24 02:30", "2026-10-25T00:30:00.000Z"],
    [SYDNEY, "2027-04-03 02:30", "2027-04-03T15:30:00.000Z"],
  ])(
    "in %s, 02:30 on the night the clocks go back is the first 02:30",
    (zone: Timezone, first: string, expected: string) => {
      const data: MaintenanceTemplateScheduleData = schedule({
        zone: zone,
        scheduledAt: `${first.slice(0, 10)} 00:00`,
        startsAt: first,
        endsAt: `${first.slice(0, 10)} 05:00`,
        intervalType: EventInterval.Day,
      });

      expect(
        MaintenanceTemplateSchedule.getEvent(data, 1).startsAt.toISOString(),
      ).toBe(expected);
    },
  );

  /*
   * 01:00 to 03:00 on the night New York goes back is three hours long: it
   * starts at the first 01:00 and ends at the one 03:00.
   */
  test("a window across the doubled hour keeps its wall clock, three hours long that night", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2026-10-30 00:00",
      startsAt: "2026-10-31 01:00",
      endsAt: "2026-10-31 03:00",
      intervalType: EventInterval.Day,
    });

    const event: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 1);

    expect(wallClockOf(event.startsAt, NEW_YORK)).toBe("2026-11-01 01:00");
    expect(wallClockOf(event.endsAt, NEW_YORK)).toBe("2026-11-01 03:00");
    expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(
      3 * HOUR_IN_MS,
    );
  });
});

describe("a time the clocks skip is moved on by the jump", () => {
  test("02:30 in New York on 2027-03-14 is 03:30 EDT, and 02:30 again the day after", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2027-03-12 22:00",
      startsAt: "2027-03-13 02:30",
      endsAt: "2027-03-13 05:00",
      intervalType: EventInterval.Day,
    });

    expect(
      [1, 2].map((index: number): string => {
        return moment
          .tz(
            MaintenanceTemplateSchedule.getEvent(data, index).startsAt,
            NEW_YORK,
          )
          .format("YYYY-MM-DD HH:mm z");
      }),
    ).toEqual(["2027-03-14 03:30 EDT", "2027-03-15 02:30 EDT"]);
  });

  test("a monthly window on the 14th at 02:30, anchored in summer, meets the skipped hour the same way", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2026-08-13 22:00",
      startsAt: "2026-08-14 02:30",
      endsAt: "2026-08-14 05:00",
      intervalType: EventInterval.Month,
    });

    expect(
      wallClockOf(
        MaintenanceTemplateSchedule.getEvent(data, 7).startsAt,
        NEW_YORK,
      ),
    ).toBe("2027-03-14 03:30");
  });

  /*
   * 02:30 to 03:15 on a night that has no 02:00 to 03:00: the start moves on
   * to 03:30, past an end the clocks did not skip. The end then keeps the
   * window's 45 minutes from the start, to 04:15.
   */
  test("a window whose start the jump moves past its end keeps the first event's length from its start", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2027-03-13 01:45",
      startsAt: "2027-03-13 02:30",
      endsAt: "2027-03-13 03:15",
      intervalType: EventInterval.Day,
    });

    const event: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 1);

    expect(wallClockOf(event.scheduledAt, NEW_YORK)).toBe("2027-03-14 01:45");
    expect(wallClockOf(event.startsAt, NEW_YORK)).toBe("2027-03-14 03:30");
    expect(wallClockOf(event.endsAt, NEW_YORK)).toBe("2027-03-14 04:15");
    expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(
      45 * MINUTE_IN_MS,
    );

    // The day after, the window is back as it was typed.
    const next: MaintenanceTemplateEvent = MaintenanceTemplateSchedule.getEvent(
      data,
      2,
    );

    expect(wallClockOf(next.scheduledAt, NEW_YORK)).toBe("2027-03-15 01:45");
    expect(wallClockOf(next.startsAt, NEW_YORK)).toBe("2027-03-15 02:30");
    expect(wallClockOf(next.endsAt, NEW_YORK)).toBe("2027-03-15 03:15");
  });

  /*
   * Created at 02:30 for a start at 03:00: the night the clocks skip 02:00
   * to 03:00, the creation moves on to 03:30, after the start. It is then
   * created as long before the start as the first one was - 30 minutes, at
   * 01:30 EST, the last half hour before the jump.
   */
  test("a creation time the jump moves past the start is as long before it as the first event's", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2027-03-13 02:30",
      startsAt: "2027-03-13 03:00",
      endsAt: "2027-03-13 04:00",
      intervalType: EventInterval.Day,
    });

    const event: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 1);

    expect(moment.tz(event.scheduledAt, NEW_YORK).format("HH:mm z")).toBe(
      "01:30 EST",
    );
    expect(moment.tz(event.startsAt, NEW_YORK).format("HH:mm z")).toBe(
      "03:00 EDT",
    );
    expect(event.startsAt.getTime() - event.scheduledAt.getTime()).toBe(
      30 * MINUTE_IN_MS,
    );
  });
});

describe("a monthly window on a day some months do not have", () => {
  test("on the 31st, it is on each month's last day, and back on the 31st after a short month", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: BERLIN,
      scheduledAt: "2027-01-30 09:00",
      startsAt: "2027-01-31 02:00",
      endsAt: "2027-01-31 04:00",
      intervalType: EventInterval.Month,
    });

    expect(
      [0, 1, 2, 3, 4, 13].map((index: number): string => {
        return wallClockOf(
          MaintenanceTemplateSchedule.getEvent(data, index).startsAt,
          BERLIN,
        );
      }),
    ).toEqual([
      "2027-01-31 02:00",
      "2027-02-28 02:00",
      "2027-03-31 02:00",
      "2027-04-30 02:00",
      "2027-05-31 02:00",
      // February 2028 has a 29th.
      "2028-02-29 02:00",
    ]);
  });

  /*
   * Created at 09:00 on the 30th for 02:00 on the 31st: in February both
   * would be the 28th, the creation after the start. The event is then
   * created as long before it starts as the first one was - 17 hours, at
   * 09:00 on the 27th - and in March it is back on the 30th.
   */
  test("created the day before the 31st, in a shorter month it is still created the day before its start", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: BERLIN,
      scheduledAt: "2027-01-30 09:00",
      startsAt: "2027-01-31 02:00",
      endsAt: "2027-01-31 04:00",
      intervalType: EventInterval.Month,
    });

    const february: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 1);

    expect(wallClockOf(february.scheduledAt, BERLIN)).toBe("2027-02-27 09:00");
    expect(wallClockOf(february.startsAt, BERLIN)).toBe("2027-02-28 02:00");
    expect(february.startsAt.getTime() - february.scheduledAt.getTime()).toBe(
      17 * HOUR_IN_MS,
    );

    const march: MaintenanceTemplateEvent =
      MaintenanceTemplateSchedule.getEvent(data, 2);

    expect(wallClockOf(march.scheduledAt, BERLIN)).toBe("2027-03-30 09:00");
    expect(wallClockOf(march.startsAt, BERLIN)).toBe("2027-03-31 02:00");
  });

  test("a yearly window on 29 February is on 28 February in other years, and on the 29th in leap years", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: UTC,
      scheduledAt: "2028-02-28 09:00",
      startsAt: "2028-02-29 02:00",
      endsAt: "2028-02-29 04:00",
      intervalType: EventInterval.Year,
    });

    expect(
      [1, 2, 3, 4].map((index: number): string => {
        return wallClockOf(
          MaintenanceTemplateSchedule.getEvent(data, index).startsAt,
          UTC,
        );
      }),
    ).toEqual([
      "2029-02-28 02:00",
      "2030-02-28 02:00",
      "2031-02-28 02:00",
      "2032-02-29 02:00",
    ]);
  });

  test("the old steps of 30.4375 days walked a window on the 1st to 31 January and 2 March; now it stays on the 1st", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: UTC,
      scheduledAt: "2026-01-01 00:00",
      startsAt: "2026-01-01 02:00",
      endsAt: "2026-01-01 04:00",
      intervalType: EventInterval.Month,
    });

    const oldSteps: Array<string> = [1, 2].map((months: number): string => {
      return wallClockOf(
        new Date(data.firstEventScheduledAt.getTime() + months * 2629800000),
        UTC,
      );
    });

    expect(oldSteps).toEqual(["2026-01-31 10:30", "2026-03-02 21:00"]);

    expect(
      [1, 2, 3].map((index: number): string => {
        return wallClockOf(
          MaintenanceTemplateSchedule.getEvent(data, index).scheduledAt,
          UTC,
        );
      }),
    ).toEqual(["2026-02-01 00:00", "2026-03-01 00:00", "2026-04-01 00:00"]);
  });
});

describe("a zone that stopped changing its clocks: British Columbia, on UTC-7 since 2026", () => {
  test("a daily 01:30 window in Vancouver is one 01:30 on 2026-11-01, and 08:30 UTC every day after", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: VANCOUVER,
      scheduledAt: "2026-10-29 22:00",
      startsAt: "2026-10-30 01:30",
      endsAt: "2026-10-30 03:00",
      intervalType: EventInterval.Day,
    });

    const starts: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      starts.push(
        MaintenanceTemplateSchedule.getEvent(data, index)
          .startsAt.toISOString()
          .slice(11, 16),
      );
    }

    expect([...new Set(starts)]).toEqual(["08:30"]);
  });

  test("Los Angeles, which still falls back, moves the same window to 09:30 UTC from 1 November", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: LOS_ANGELES,
      scheduledAt: "2026-10-29 22:00",
      startsAt: "2026-10-30 01:30",
      endsAt: "2026-10-30 03:00",
      intervalType: EventInterval.Day,
    });

    expect(
      [0, 1, 2, 3].map((index: number): string => {
        return MaintenanceTemplateSchedule.getEvent(data, index)
          .startsAt.toISOString()
          .slice(11, 16);
      }),
    ).toEqual(["08:30", "08:30", "08:30", "09:30"]);
  });

  test("a window first typed in winter 2026 in Vancouver (PST) keeps 02:00 through the last spring change, and on UTC-7 from then on", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: VANCOUVER,
      scheduledAt: "2026-01-14 22:00",
      startsAt: "2026-01-15 02:00",
      endsAt: "2026-01-15 04:00",
      intervalType: EventInterval.Month,
    });

    expect(
      [0, 2, 10, 12, 14].map((index: number): string => {
        return moment
          .tz(
            MaintenanceTemplateSchedule.getEvent(data, index).startsAt,
            VANCOUVER,
          )
          .format("YYYY-MM-DD HH:mm Z");
      }),
    ).toEqual([
      "2026-01-15 02:00 -08:00",
      "2026-03-15 02:00 -07:00",
      "2026-11-15 02:00 -07:00",
      "2027-01-15 02:00 -07:00",
      "2027-03-15 02:00 -07:00",
    ]);
  });
});

describe("hours are hours of elapsed time", () => {
  test("every 12 hours in New York stays 12 hours apart across the night the clocks go back", () => {
    const data: MaintenanceTemplateScheduleData = schedule({
      zone: NEW_YORK,
      scheduledAt: "2026-10-31 11:00",
      startsAt: "2026-10-31 12:00",
      endsAt: "2026-10-31 13:00",
      intervalType: EventInterval.Hour,
      intervalCount: 12,
    });

    for (let index: number = 1; index < 10; index++) {
      expect(
        MaintenanceTemplateSchedule.getEvent(data, index).startsAt.getTime() -
          MaintenanceTemplateSchedule.getEvent(
            data,
            index - 1,
          ).startsAt.getTime(),
      ).toBe(12 * HOUR_IN_MS);
    }

    // So the wall clock moves an hour, as a span of hours does.
    expect(
      wallClockOf(
        MaintenanceTemplateSchedule.getEvent(data, 2).startsAt,
        NEW_YORK,
      ),
    ).toBe("2026-11-01 11:00");
  });
});

describe("when a template creates its next event", () => {
  const data: MaintenanceTemplateScheduleColumns = {
    firstEventScheduledAt: at("2026-10-26 09:00", BERLIN),
    firstEventStartsAt: at("2026-10-27 02:00", BERLIN),
    firstEventEndsAt: at("2026-10-27 04:00", BERLIN),
    recurringInterval: recurring(EventInterval.Week),
    timezone: BERLIN,
  };

  test("its first event, while that is still ahead", () => {
    expect(
      MaintenanceTemplateSchedule.getNextEventAt(
        data,
        new Date("2026-10-20T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe(at("2026-10-26 09:00", BERLIN).toISOString());
  });

  test("else the schedule's first event after now, on the template's clock: no burst of the events that went by", () => {
    expect(
      wallClockOf(
        MaintenanceTemplateSchedule.getNextEventAt(
          data,
          new Date("2027-04-01T00:00:00.000Z"),
        )!,
        BERLIN,
      ),
    ).toBe("2027-04-05 09:00");
  });

  test("strictly after now: at the very moment of an event, the next one", () => {
    expect(
      wallClockOf(
        MaintenanceTemplateSchedule.getNextEventAt(
          data,
          at("2026-11-02 09:00", BERLIN),
        )!,
        BERLIN,
      ),
    ).toBe("2026-11-09 09:00");
  });

  test("nothing while a part of the schedule is missing, or the interval cannot be read", () => {
    expect(
      MaintenanceTemplateSchedule.getNextEventAt({
        ...data,
        firstEventEndsAt: null,
      }),
    ).toBeUndefined();
    expect(
      MaintenanceTemplateSchedule.getNextEventAt({
        ...data,
        recurringInterval: {
          _type: "Recurring",
          value: { intervalType: "Fortnight" },
        },
      }),
    ).toBeUndefined();
  });

  test("the events after a time, in order", () => {
    expect(
      MaintenanceTemplateSchedule.getEventsAfter(data, {
        after: at("2026-10-27 00:00", BERLIN),
        count: 3,
      }).map((event: MaintenanceTemplateEvent): string => {
        return `${event.index}: ${wallClockOf(event.startsAt, BERLIN)}`;
      }),
    ).toEqual([
      "1: 2026-11-03 02:00",
      "2: 2026-11-10 02:00",
      "3: 2026-11-17 02:00",
    ]);
  });
});

describe("the event the job creates when a template's time comes", () => {
  const firstScheduledAt: Date = new Date("2026-01-01T00:00:00.000Z");
  const columns: MaintenanceTemplateScheduleColumns = {
    firstEventScheduledAt: firstScheduledAt,
    firstEventStartsAt: new Date("2026-01-01T02:00:00.000Z"),
    firstEventEndsAt: new Date("2026-01-01T04:00:00.000Z"),
    recurringInterval: recurring(EventInterval.Month),
    timezone: UTC,
  };

  test("a time on the schedule is its event, and the template then waits for the next one", () => {
    const due: MaintenanceTemplateDueEvent =
      MaintenanceTemplateSchedule.getDueEvent({
        columns: columns,
        dueAt: new Date("2026-11-01T00:00:00.000Z"),
        now: new Date("2026-11-01T00:00:30.000Z"),
      })!;

    expect(due.event).toEqual({
      scheduledAt: new Date("2026-11-01T00:00:00.000Z"),
      startsAt: new Date("2026-11-01T02:00:00.000Z"),
      endsAt: new Date("2026-11-01T04:00:00.000Z"),
    });
    expect(due.nextEventAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  /*
   * The old steps put a monthly template's next time a little off its day:
   * 2 March 21:00 for a window on the 1st. Its event on the calendar, 1
   * March, has passed: the event is created at the time it held, as before
   * the upgrade, and the template is on the 1st from then on.
   */
  test("a time the old steps held after its event's day: created at that time, as before, and on the calendar from then on", () => {
    const due: MaintenanceTemplateDueEvent =
      MaintenanceTemplateSchedule.getDueEvent({
        columns: columns,
        dueAt: new Date("2026-03-02T21:00:00.000Z"),
        now: new Date("2026-03-02T21:00:30.000Z"),
      })!;

    expect(due.event).toEqual({
      scheduledAt: new Date("2026-03-02T21:00:00.000Z"),
      startsAt: new Date("2026-03-02T23:00:00.000Z"),
      endsAt: new Date("2026-03-03T01:00:00.000Z"),
    });
    expect(due.nextEventAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  /*
   * 31 January 10:30 for a window on the 1st: its event on the calendar, 1
   * February, is still to come. Nothing is created now; the next time
   * moves to 1 February, when that event is created - once.
   */
  test("a time the old steps held before its event's day: nothing now, and the event on its day", () => {
    const due: MaintenanceTemplateDueEvent =
      MaintenanceTemplateSchedule.getDueEvent({
        columns: columns,
        dueAt: new Date("2026-01-31T10:30:00.000Z"),
        now: new Date("2026-01-31T10:30:30.000Z"),
      })!;

    expect(due.event).toBeNull();
    expect(due.nextEventAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");

    const then: MaintenanceTemplateDueEvent =
      MaintenanceTemplateSchedule.getDueEvent({
        columns: columns,
        dueAt: due.nextEventAt,
        now: new Date("2026-02-01T00:00:30.000Z"),
      })!;

    expect(then.event?.startsAt.toISOString()).toBe("2026-02-01T02:00:00.000Z");
    expect(then.nextEventAt.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  test("a worker that was down creates the event that was due once, then waits for the next one after now", () => {
    const due: MaintenanceTemplateDueEvent =
      MaintenanceTemplateSchedule.getDueEvent({
        columns: {
          ...columns,
          recurringInterval: recurring(EventInterval.Day),
        },
        dueAt: new Date("2026-03-10T00:00:00.000Z"),
        now: new Date("2026-03-13T12:00:00.000Z"),
      })!;

    expect(due.event?.startsAt.toISOString()).toBe("2026-03-10T02:00:00.000Z");
    expect(due.nextEventAt.toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });

  test("nothing at all for a template without a complete schedule", () => {
    expect(
      MaintenanceTemplateSchedule.getDueEvent({
        columns: { ...columns, firstEventStartsAt: undefined },
        dueAt: new Date("2026-03-10T00:00:00.000Z"),
      }),
    ).toBeUndefined();
  });

  /*
   * A template whose times were all worked out by this file, walked by the
   * job minute by minute over a year: every event is created once, at its
   * own time, with its own window.
   */
  test("walked by the job, a Sydney template creates each event once, on its wall clock", () => {
    const sydney: MaintenanceTemplateScheduleColumns = {
      firstEventScheduledAt: at("2026-03-01 18:00", SYDNEY),
      firstEventStartsAt: at("2026-03-02 02:30", SYDNEY),
      firstEventEndsAt: at("2026-03-02 05:00", SYDNEY),
      recurringInterval: recurring(EventInterval.Week),
      timezone: SYDNEY,
    };

    let dueAt: Date = MaintenanceTemplateSchedule.getNextEventAt(
      sydney,
      new Date("2026-02-01T00:00:00.000Z"),
    )!;
    const created: Array<string> = [];

    for (let week: number = 0; week < 60; week++) {
      const due: MaintenanceTemplateDueEvent =
        MaintenanceTemplateSchedule.getDueEvent({
          columns: sydney,
          dueAt: dueAt,
          // The job runs within the minute.
          now: new Date(dueAt.getTime() + 20 * 1000),
        })!;

      expect(due.event).not.toBeNull();
      created.push(
        `${wallClockOf(due.event!.scheduledAt, SYDNEY).slice(11)} ${wallClockOf(due.event!.startsAt, SYDNEY).slice(11)}`,
      );
      expect(due.nextEventAt.getTime() - dueAt.getTime()).toBeGreaterThan(
        6 * DAY_IN_MS,
      );
      dueAt = due.nextEventAt;
    }

    expect([...new Set(created)]).toEqual(["18:00 02:30"]);
  });
});

describe("templates saved before they had a time zone read UTC, and their hourly, daily and weekly events do not move", () => {
  // Recurring.getNextDate as it was: the last time plus fixed milliseconds.
  function oldNextDate(startDate: Date, intervalInMs: number, now: Date): Date {
    if (startDate.getTime() > now.getTime()) {
      return startDate;
    }

    const intervals: number = Math.ceil(
      (now.getTime() - startDate.getTime()) / intervalInMs,
    );

    return new Date(startDate.getTime() + intervals * intervalInMs);
  }

  test.each([
    [EventInterval.Hour, 6, 6 * HOUR_IN_MS],
    [EventInterval.Day, 1, DAY_IN_MS],
    [EventInterval.Day, 3, 3 * DAY_IN_MS],
    [EventInterval.Week, 1, 7 * DAY_IN_MS],
    [EventInterval.Week, 2, 14 * DAY_IN_MS],
  ])(
    "every %s x%s: the next time and every event's window are the old ones, for two years",
    (intervalType: EventInterval, count: number, intervalInMs: number) => {
      // Typed in Los Angeles in summer: the old steps' window moved there; in UTC it never did.
      const firstScheduledAt: Date = at("2026-07-01 09:00", LOS_ANGELES);
      const firstStartsAt: Date = at("2026-07-04 02:00", LOS_ANGELES);
      const firstEndsAt: Date = at("2026-07-04 04:00", LOS_ANGELES);
      const columns: MaintenanceTemplateScheduleColumns = {
        firstEventScheduledAt: firstScheduledAt,
        firstEventStartsAt: firstStartsAt,
        firstEventEndsAt: firstEndsAt,
        recurringInterval: recurring(intervalType, count),
        // What the migration gives every template saved before.
        timezone: "UTC",
      };

      /*
       * Probed every 11 hours 17 minutes and a few seconds: never on a whole
       * minute, so never at an event's own time - where the old steps
       * answered that very time and the schedule answers the next one, a
       * tie that cannot come up between the job's runs.
       */
      for (
        let now: number = firstScheduledAt.getTime() - DAY_IN_MS + 7123;
        now < firstScheduledAt.getTime() + 2 * 365 * DAY_IN_MS;
        now += 11 * HOUR_IN_MS + 17 * MINUTE_IN_MS + 13789
      ) {
        const oldNext: Date = oldNextDate(
          firstScheduledAt,
          intervalInMs,
          new Date(now),
        );
        const newNext: Date = MaintenanceTemplateSchedule.getNextEventAt(
          columns,
          new Date(now),
        )!;

        expect(newNext.toISOString()).toBe(oldNext.toISOString());

        const due: MaintenanceTemplateDueEvent =
          MaintenanceTemplateSchedule.getDueEvent({
            columns: columns,
            dueAt: oldNext,
            now: oldNext,
          })!;

        // The old job: fixed minutes after the time the event is created.
        expect(due.event?.startsAt.toISOString()).toBe(
          new Date(
            oldNext.getTime() +
              (firstStartsAt.getTime() - firstScheduledAt.getTime()),
          ).toISOString(),
        );
        expect(due.event?.endsAt.toISOString()).toBe(
          new Date(
            oldNext.getTime() +
              (firstEndsAt.getTime() - firstScheduledAt.getTime()),
          ).toISOString(),
        );
      }
    },
  );

  test("a template with no time zone at all reads UTC too", () => {
    expect(MaintenanceTemplateSchedule.getTimezone(undefined)).toBe(UTC);
    expect(MaintenanceTemplateSchedule.getTimezone(null)).toBe(UTC);
    expect(MaintenanceTemplateSchedule.getTimezone("")).toBe(UTC);
    expect(MaintenanceTemplateSchedule.getTimezone("Not/AZone")).toBe(UTC);
    expect(
      MaintenanceTemplateSchedule.read({
        firstEventScheduledAt: new Date("2026-07-01T09:00:00.000Z"),
        firstEventStartsAt: new Date("2026-07-01T10:00:00.000Z"),
        firstEventEndsAt: new Date("2026-07-01T11:00:00.000Z"),
        recurringInterval: recurring(EventInterval.Day),
      })?.timezone,
    ).toBe(UTC);
  });
});

describe("the time zone a template is read in", () => {
  test.each([
    ["Europe/Berlin", "Europe/Berlin"],
    [" europe/berlin ", "Europe/Berlin"],
    ["US/Eastern", "US/Eastern"],
    ["Asia/Calcutta", "Asia/Calcutta"],
    ["UTC", "UTC"],
    ["America/Vancouver", "America/Vancouver"],
  ])("%j is the time zone %j", (value: string, expected: string) => {
    expect(MaintenanceTemplateSchedule.toTimezone(value)).toBe(expected);
    expect(MaintenanceTemplateSchedule.isTimezoneWritable(value)).toBe(true);
  });

  test.each([["Europe/Atlantis"], ["GMT+25"], ["   "], [42], [{}]])(
    "%j is not a time zone",
    (value: unknown) => {
      expect(MaintenanceTemplateSchedule.toTimezone(value)).toBeUndefined();
    },
  );

  test("a write may leave it out or send nothing, which reads UTC, but not a name that is no time zone", () => {
    expect(MaintenanceTemplateSchedule.isTimezoneWritable(undefined)).toBe(
      true,
    );
    expect(MaintenanceTemplateSchedule.isTimezoneWritable(null)).toBe(true);
    expect(MaintenanceTemplateSchedule.isTimezoneWritable("")).toBe(true);
    expect(
      MaintenanceTemplateSchedule.isTimezoneWritable("Europe/Atlantis"),
    ).toBe(false);
    expect(MaintenanceTemplateSchedule.isTimezoneWritable(42)).toBe(false);
  });

  test("a time zone OneUptime fills in itself is named as the picker offers it", () => {
    expect(MaintenanceTemplateSchedule.toCurrentTimezone("Asia/Calcutta")).toBe(
      "Asia/Kolkata",
    );
    expect(MaintenanceTemplateSchedule.toCurrentTimezone("US/Pacific")).toBe(
      "America/Los_Angeles",
    );
    expect(
      MaintenanceTemplateSchedule.toCurrentTimezone("Not/AZone"),
    ).toBeUndefined();
  });

  test("a legacy name and the name it stands for step the same", () => {
    const columns: MaintenanceTemplateScheduleColumns = {
      firstEventScheduledAt: at("2026-10-29 22:00", NEW_YORK),
      firstEventStartsAt: at("2026-10-30 02:00", NEW_YORK),
      firstEventEndsAt: at("2026-10-30 04:00", NEW_YORK),
      recurringInterval: recurring(EventInterval.Day),
    };

    for (const now of [
      new Date("2026-11-05T00:00:00.000Z"),
      new Date("2027-03-20T00:00:00.000Z"),
    ]) {
      expect(
        MaintenanceTemplateSchedule.getNextEventAt(
          { ...columns, timezone: "US/Eastern" },
          now,
        )?.toISOString(),
      ).toBe(
        MaintenanceTemplateSchedule.getNextEventAt(
          { ...columns, timezone: NEW_YORK },
          now,
        )?.toISOString(),
      );
    }
  });
});
