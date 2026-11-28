import DayOfWeek from "../../../Types/Day/DayOfWeek";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays, {
  EARLIEST_ZONE_OFFSET_MINUTES,
  LATEST_ZONE_OFFSET_MINUTES,
  StoredWindowRepair,
  StoredWindowState,
  StoredWindowsRepair,
  WindowEnd,
  WindowEndReading,
  WindowToCheck,
} from "../../../Types/OnCallDutyPolicy/WeeklyWindowDays";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * THE DAYS OF A WEEKLY WINDOW ARE THE DAYS IT NAMES (#11455): the rules a
 * write, a stored window and a change of time zone are held to, on their
 * own. The service, the API, the migration and the engine have suites of
 * their own; every one of them reads these.
 *
 * Dates used throughout: 2026-01-05 is a Monday, 2026-01-07 a Wednesday.
 * Europe/Warsaw is UTC+1 in winter and UTC+2 from 2026-03-29 to 2026-10-25;
 * America/New_York is UTC-5 in winter and UTC-4 from 2026-03-08 to
 * 2026-11-01. Every zone is named: none of these depends on the zone the
 * tests run in (WeeklyWindowDaysServerZone holds that one).
 */

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

const ALL_DAYS: Array<DayOfWeek> = [
  DayOfWeek.Sunday,
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
];

function at(iso: string): Date {
  return new Date(iso);
}

function dateTime(iso: string): JSONObject {
  return { _type: ObjectType.DateTime, value: iso };
}

// A wall clock in a zone, as an instant.
function wall(text: string, zone: string): Date {
  return moment.tz(text, "YYYY-MM-DD HH:mm", zone).toDate();
}

function clockOf(date: Date, zone: string): string {
  return moment.tz(date, zone).format("dddd HH:mm");
}

function weekly(windows: Array<unknown>): RestrictionTimes {
  const restriction: RestrictionTimes = new RestrictionTimes();
  restriction.restrictionType = RestrictionType.Weekly;
  restriction.weeklyRestrictionTimes = windows as Array<WeeklyResctriction>;
  return restriction;
}

function windowOf(data: {
  startDay?: unknown;
  endDay?: unknown;
  startTime: unknown;
  endTime: unknown;
}): WeeklyResctriction {
  const window: Record<string, unknown> = {
    startTime: data.startTime,
    endTime: data.endTime,
  };

  if ("startDay" in data) {
    window["startDay"] = data.startDay;
  }

  if ("endDay" in data) {
    window["endDay"] = data.endDay;
  }

  return window as unknown as WeeklyResctriction;
}

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("Expected a refusal, and the write was taken.");
}

// The fixed-offset zones from UTC-12 to UTC+14 (Etc/GMT's signs are reversed).
const FIXED_ZONES: Array<string> = [];
for (let hours: number = -12; hours <= 14; hours++) {
  FIXED_ZONES.push(
    hours === 0
      ? "Etc/UTC"
      : `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`,
  );
}

describe("WeeklyWindowDays.readDay and readStoredDay", () => {
  test.each(ALL_DAYS)("a write's day is read exactly: %s", (day: DayOfWeek) => {
    expect(WeeklyWindowDays.readDay(day)).toBe(day);
    expect(WeeklyWindowDays.readStoredDay(day)).toBe(day);
  });

  test.each([
    ["monday", DayOfWeek.Monday],
    ["MONDAY", DayOfWeek.Monday],
    [" Friday ", DayOfWeek.Friday],
    ["sUnDaY", DayOfWeek.Sunday],
  ])(
    "a stored day is read however it is cased or spaced, a write's is not: %j",
    (value: string, day: DayOfWeek) => {
      expect(WeeklyWindowDays.readDay(value)).toBeNull();
      expect(WeeklyWindowDays.readStoredDay(value)).toBe(day);
    },
  );

  test.each([
    ["Mon"],
    ["Mo"],
    [""],
    ["Funday"],
    [1],
    [0],
    [null],
    [undefined],
    [{ day: "Monday" }],
    [["Monday"]],
  ])("no day at all: %j", (value: unknown) => {
    expect(WeeklyWindowDays.readDay(value)).toBeNull();
    expect(WeeklyWindowDays.readStoredDay(value)).toBeNull();
  });
});

describe("WeeklyWindowDays.getDayOf", () => {
  test("the day a time falls on is the day in the zone it is read in", () => {
    // Monday 23:30 UTC is Tuesday 00:30 in Warsaw and Monday 18:30 in New York.
    const time: Date = at("2026-01-05T23:30:00.000Z");

    expect(WeeklyWindowDays.getDayOf(time, "Etc/UTC")).toBe(DayOfWeek.Monday);
    expect(WeeklyWindowDays.getDayOf(time, WARSAW)).toBe(DayOfWeek.Tuesday);
    expect(WeeklyWindowDays.getDayOf(time, NEW_YORK)).toBe(DayOfWeek.Monday);
  });

  test("a blank zone is no zone, as a schedule without one", () => {
    const time: Date = at("2026-01-07T12:00:00.000Z");

    expect(WeeklyWindowDays.getDayOf(time, "  ")).toBe(
      WeeklyWindowDays.getDayOf(time, null),
    );
  });
});

describe("WeeklyWindowDays.canFallOnDayInSomeTimezone", () => {
  test("the day in UTC is always a day it falls on", () => {
    for (let minute: number = 0; minute < 7 * 24 * 60; minute += 30) {
      const time: Date = new Date(Date.UTC(2026, 0, 4, 0, minute));
      const day: DayOfWeek = ALL_DAYS[time.getUTCDay()]!;
      expect(WeeklyWindowDays.canFallOnDayInSomeTimezone(time, day)).toBe(true);
    }
  });

  test("the day after, once UTC+14 reaches it: from 10:00 UTC", () => {
    const monday: DayOfWeek = DayOfWeek.Monday;
    const tuesday: DayOfWeek = DayOfWeek.Tuesday;

    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T09:59:00.000Z"),
        tuesday,
      ),
    ).toBe(false);
    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T10:00:00.000Z"),
        tuesday,
      ),
    ).toBe(true);
    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T23:59:00.000Z"),
        tuesday,
      ),
    ).toBe(true);
    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T10:00:00.000Z"),
        monday,
      ),
    ).toBe(true);
  });

  test("the day before, while UTC-12 still reaches it: until 12:00 UTC", () => {
    const sunday: DayOfWeek = DayOfWeek.Sunday;

    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T11:59:00.000Z"),
        sunday,
      ),
    ).toBe(true);
    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        at("2026-01-05T12:00:00.000Z"),
        sunday,
      ),
    ).toBe(false);
  });

  test("two days away, never: a Monday is no Wednesday anywhere", () => {
    for (let hour: number = 0; hour < 24; hour++) {
      const wednesday: Date = new Date(Date.UTC(2026, 0, 7, hour, 0));

      expect(
        WeeklyWindowDays.canFallOnDayInSomeTimezone(
          wednesday,
          DayOfWeek.Monday,
        ),
      ).toBe(false);
      expect(
        WeeklyWindowDays.canFallOnDayInSomeTimezone(
          wednesday,
          DayOfWeek.Friday,
        ),
      ).toBe(false);
    }
  });

  test("the offsets it allows are UTC-12 to UTC+14", () => {
    expect(EARLIEST_ZONE_OFFSET_MINUTES).toBe(-720);
    expect(LATEST_ZONE_OFFSET_MINUTES).toBe(840);
  });

  test("it agrees with the real zones from UTC-12 to UTC+14, every quarter hour of a week, for every day", () => {
    for (let quarter: number = 0; quarter < 7 * 24 * 4; quarter++) {
      const time: Date = new Date(Date.UTC(2026, 0, 4, 0, quarter * 15));

      for (const day of ALL_DAYS) {
        const inSomeZone: boolean = FIXED_ZONES.some(
          (zone: string): boolean => {
            return WeeklyWindowDays.getDayOf(time, zone) === day;
          },
        );

        expect({
          time: time.toISOString(),
          day: day,
          falls: WeeklyWindowDays.canFallOnDayInSomeTimezone(time, day),
        }).toEqual({ time: time.toISOString(), day: day, falls: inSomeZone });
      }
    }
  });

  test("an invalid date falls on no day", () => {
    expect(
      WeeklyWindowDays.canFallOnDayInSomeTimezone(
        new Date("not a date"),
        DayOfWeek.Monday,
      ),
    ).toBe(false);
  });
});

describe("WeeklyWindowDays.moveOntoDay", () => {
  test("the issue's time: a Wednesday 09:00 in Warsaw moved onto Monday is Monday 09:00 there", () => {
    const moved: Date = WeeklyWindowDays.moveOntoDay(
      at("2026-01-07T08:00:00.000Z"),
      DayOfWeek.Monday,
      WARSAW,
    );

    expect(clockOf(moved, WARSAW)).toBe("Monday 09:00");
    expect(moved.toISOString()).toBe("2026-01-05T08:00:00.000Z");
  });

  test("a time already on the day stays as it is", () => {
    const time: Date = at("2026-01-05T08:00:00.000Z");

    expect(
      WeeklyWindowDays.moveOntoDay(time, DayOfWeek.Monday, WARSAW).getTime(),
    ).toBe(time.getTime());
  });

  test.each([WARSAW, NEW_YORK, "Asia/Kolkata", "Pacific/Auckland", "Etc/UTC"])(
    "every day and every hour keeps its time of day in %s",
    (zone: string) => {
      for (let hour: number = 0; hour < 24; hour++) {
        const time: Date = wall(
          `2026-01-07 ${String(hour).padStart(2, "0")}:15`,
          zone,
        );

        for (const day of ALL_DAYS) {
          const moved: Date = WeeklyWindowDays.moveOntoDay(time, day, zone);

          expect(clockOf(moved, zone)).toBe(
            `${day} ${String(hour).padStart(2, "0")}:15`,
          );
        }
      }
    },
  );

  test("across the change to summer time in Warsaw, the time of day is kept", () => {
    // Wednesday 2026-03-25 18:00 CET onto Sunday: the Sunday of the change.
    const moved: Date = WeeklyWindowDays.moveOntoDay(
      wall("2026-03-25 18:00", WARSAW),
      DayOfWeek.Sunday,
      WARSAW,
    );

    expect(clockOf(moved, WARSAW)).toBe("Sunday 18:00");
  });

  test("a time the clock skips on that day is taken on that day in another week: 02:30 on the Sunday Warsaw springs forward", () => {
    // 02:30 does not exist in Warsaw on 2026-03-29.
    const moved: Date = WeeklyWindowDays.moveOntoDay(
      wall("2026-03-25 02:30", WARSAW),
      DayOfWeek.Sunday,
      WARSAW,
    );

    expect(clockOf(moved, WARSAW)).toBe("Sunday 02:30");
    expect(moment.tz(moved, WARSAW).format("YYYY-MM-DD")).not.toBe(
      "2026-03-29",
    );
  });

  test("the same in New York: 02:30 on the Sunday it springs forward", () => {
    const moved: Date = WeeklyWindowDays.moveOntoDay(
      wall("2026-03-04 02:30", NEW_YORK),
      DayOfWeek.Sunday,
      NEW_YORK,
    );

    expect(clockOf(moved, NEW_YORK)).toBe("Sunday 02:30");
    expect(moment.tz(moved, NEW_YORK).format("YYYY-MM-DD")).not.toBe(
      "2026-03-08",
    );
  });

  test("every quarter hour of the weeks around each change, onto every day, in Warsaw and New York", () => {
    const starts: Array<[string, string]> = [
      [WARSAW, "2026-03-23"],
      [WARSAW, "2026-10-19"],
      [NEW_YORK, "2026-03-02"],
      [NEW_YORK, "2026-10-26"],
    ];

    for (const [zone, monday] of starts) {
      const first: moment.Moment = moment.tz(`${monday} 00:00`, zone);

      for (let quarter: number = 0; quarter < 7 * 24 * 4; quarter += 3) {
        const time: Date = first
          .clone()
          .add(quarter * 15, "minutes")
          .toDate();
        const timeOfDay: string = moment.tz(time, zone).format("HH:mm");

        for (const day of ALL_DAYS) {
          expect(
            clockOf(WeeklyWindowDays.moveOntoDay(time, day, zone), zone),
          ).toBe(`${day} ${timeOfDay}`);
        }
      }
    }
  });
});

describe("WeeklyWindowDays.readEnd and readEnds", () => {
  test("a window's two ends, read in the schedule's zone", () => {
    const [start, end]: [WindowEndReading, WindowEndReading] =
      WeeklyWindowDays.readEnds(
        windowOf({
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Friday,
          startTime: dateTime("2026-01-07T08:00:00.000Z"),
          endTime: dateTime("2026-01-09T16:00:00.000Z"),
        }),
        WARSAW,
      );

    expect(start).toEqual(
      expect.objectContaining({
        end: WindowEnd.Start,
        dayKey: "startDay",
        timeKey: "startTime",
        hasDay: true,
        day: DayOfWeek.Monday,
        dayAsRead: DayOfWeek.Monday,
        fallsOn: DayOfWeek.Wednesday,
        agrees: false,
        couldBeDatedInAnotherZone: false,
      }),
    );
    expect(end).toEqual(
      expect.objectContaining({
        end: WindowEnd.End,
        dayKey: "endDay",
        timeKey: "endTime",
        day: DayOfWeek.Friday,
        fallsOn: DayOfWeek.Friday,
        agrees: true,
      }),
    );
  });

  test.each([
    ["a DateTime", dateTime("2026-01-05T08:00:00.000Z")],
    ["an ISO text", "2026-01-05T08:00:00.000Z"],
    ["a Date", at("2026-01-05T08:00:00.000Z")],
  ])("a time as %s", (_name: string, value: unknown) => {
    const reading: WindowEndReading = WeeklyWindowDays.readEnd(
      { startDay: "Monday", startTime: value },
      WindowEnd.Start,
      WARSAW,
    );

    expect(reading.moment?.toISOString()).toBe("2026-01-05T08:00:00.000Z");
    expect(reading.agrees).toBe(true);
  });

  test("a day left out, or null, is no day; a time that is no date and time falls on no day", () => {
    const leftOut: WindowEndReading = WeeklyWindowDays.readEnd(
      { startTime: dateTime("2026-01-05T08:00:00.000Z") },
      WindowEnd.Start,
      WARSAW,
    );
    expect(leftOut.hasDay).toBe(false);
    expect(leftOut.dayAsRead).toBeNull();
    expect(leftOut.fallsOn).toBe(DayOfWeek.Monday);
    expect(leftOut.agrees).toBe(false);

    const nulled: WindowEndReading = WeeklyWindowDays.readEnd(
      { endDay: null, endTime: "09:00" },
      WindowEnd.End,
      WARSAW,
    );
    expect(nulled.hasDay).toBe(false);
    expect(nulled.moment).toBeNull();
    expect(nulled.fallsOn).toBeNull();
  });

  test("not a window at all reads as nothing", () => {
    for (const value of [null, undefined, "window", 3, ["Monday"]]) {
      const reading: WindowEndReading = WeeklyWindowDays.readEnd(
        value,
        WindowEnd.Start,
        WARSAW,
      );
      expect(reading.moment).toBeNull();
      expect(reading.hasDay).toBe(false);
    }
  });
});

describe("WeeklyWindowDays.isSameWindow", () => {
  const stored: JSONObject = {
    startDay: "Monday",
    endDay: "Friday",
    startTime: dateTime("2026-01-05T08:00:00.000Z"),
    endTime: dateTime("2026-01-09T16:00:00.000Z"),
  };

  test("the same days and the same instants, however the times are written", () => {
    expect(
      WeeklyWindowDays.isSameWindow(
        {
          startDay: "Monday",
          endDay: "Friday",
          startTime: "2026-01-05T09:00:00+01:00",
          endTime: at("2026-01-09T16:00:00.000Z"),
        },
        stored,
      ),
    ).toBe(true);
  });

  test("another day, another instant, a missing time: another window", () => {
    expect(
      WeeklyWindowDays.isSameWindow({ ...stored, startDay: "Tuesday" }, stored),
    ).toBe(false);
    expect(
      WeeklyWindowDays.isSameWindow(
        { ...stored, endTime: dateTime("2026-01-09T16:01:00.000Z") },
        stored,
      ),
    ).toBe(false);
    expect(
      WeeklyWindowDays.isSameWindow({ ...stored, startTime: null }, stored),
    ).toBe(false);
    expect(WeeklyWindowDays.isSameWindow(null, stored)).toBe(false);
    expect(WeeklyWindowDays.isSameWindow(stored, "window")).toBe(false);
  });

  test("a day spelled otherwise is another window: the write is judged", () => {
    expect(
      WeeklyWindowDays.isSameWindow({ ...stored, startDay: "monday" }, stored),
    ).toBe(false);
  });
});

describe("WeeklyWindowDays.checkWrittenWindows: a write", () => {
  test("a restriction that is not Weekly is not read", () => {
    const daily: RestrictionTimes = new RestrictionTimes();
    daily.restrictionType = RestrictionType.Daily;
    daily.dayRestrictionTimes = {
      startTime: at("2026-01-07T08:00:00.000Z"),
      endTime: at("2026-01-07T16:00:00.000Z"),
    };
    // A Daily restriction's weekly list is never read by the engine either.
    daily.weeklyRestrictionTimes = [
      windowOf({
        startDay: "Monday",
        endDay: "Monday",
        startTime: at("2026-01-07T08:00:00.000Z"),
        endTime: at("2026-01-07T16:00:00.000Z"),
      }),
    ];

    expect(
      WeeklyWindowDays.checkWrittenWindows(daily, { timezone: WARSAW }),
    ).toBe(daily);

    const none: RestrictionTimes = new RestrictionTimes();
    expect(
      WeeklyWindowDays.checkWrittenWindows(none, { timezone: WARSAW }),
    ).toBe(none);
  });

  test("windows dated on the days they name are taken as they are, in Warsaw and New York", () => {
    for (const zone of [WARSAW, NEW_YORK]) {
      const written: RestrictionTimes = weekly(
        [
          ["2026-01-05", DayOfWeek.Monday],
          ["2026-01-06", DayOfWeek.Tuesday],
          ["2026-01-07", DayOfWeek.Wednesday],
          ["2026-01-08", DayOfWeek.Thursday],
          ["2026-01-09", DayOfWeek.Friday],
        ].map(([date, day]: Array<string>) => {
          return windowOf({
            startDay: day,
            endDay: day,
            startTime: dateTime(wall(`${date} 09:00`, zone).toISOString()),
            endTime: dateTime(wall(`${date} 17:00`, zone).toISOString()),
          });
        }),
      );

      const checked: RestrictionTimes = WeeklyWindowDays.checkWrittenWindows(
        written,
        { timezone: zone },
      );

      expect(checked.weeklyRestrictionTimes).toEqual(
        written.weeklyRestrictionTimes,
      );
      expect(checked.restrictionType).toBe(RestrictionType.Weekly);
    }
  });

  test("REGRESSION #11455: Monday with a Wednesday-dated startTime is refused, naming the window, the day it falls on and a Monday to send", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-07T08:00:00.000Z"),
            endTime: dateTime("2026-01-05T16:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW },
      );
    });

    expect(refusal).toBe(
      "restrictionTimes.value.weeklyRestrictionTimes[0].startTime is 2026-01-07T08:00:00.000Z, a Wednesday in Europe/Warsaw, the schedule's time zone, but its startDay is Monday. A window is on call on the days it names: date its startTime on a Monday, such as 2026-01-05T08:00:00.000Z, or set its startDay to Wednesday.",
    );
  });

  test("an endTime on another day than its endDay is refused for the end", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Friday",
            endDay: "Monday",
            startTime: dateTime("2026-01-09T16:00:00.000Z"),
            endTime: dateTime("2026-01-13T07:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW },
      );
    });

    expect(refusal).toContain(
      "restrictionTimes.value.weeklyRestrictionTimes[0].endTime is 2026-01-13T07:00:00.000Z, a Tuesday in Europe/Warsaw",
    );
    expect(refusal).toContain("but its endDay is Monday");
    expect(refusal).toContain("such as 2026-01-12T07:00:00.000Z");
    expect(refusal).toContain("or set its endDay to Tuesday");
  });

  test("the window named is the first one that is wrong, by its place", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-05T08:00:00.000Z"),
            endTime: dateTime("2026-01-05T16:00:00.000Z"),
          }),
          windowOf({
            startDay: "Tuesday",
            endDay: "Tuesday",
            startTime: dateTime("2026-01-06T08:00:00.000Z"),
            endTime: dateTime("2026-01-06T16:00:00.000Z"),
          }),
          windowOf({
            startDay: "Thursday",
            endDay: "Thursday",
            startTime: dateTime("2026-01-07T08:00:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW },
      );
    });

    expect(
      refusal.startsWith(
        "restrictionTimes.value.weeklyRestrictionTimes[2].startTime",
      ),
    ).toBe(true);
  });

  test("a field named by the caller is named in the refusal", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-07T08:00:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW, fieldName: "layer.restrictionTimes" },
      );
    });

    expect(
      refusal.startsWith(
        "layer.restrictionTimes.value.weeklyRestrictionTimes[0]",
      ),
    ).toBe(true);
  });

  test("Terraform's placeholder dates: five weekday windows all dated on one Wednesday are refused at the first that is not a Wednesday", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly(
          ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
            (day: string) => {
              return windowOf({
                startDay: day,
                endDay: day,
                startTime: dateTime("2026-01-07T09:00:00Z"),
                endTime: dateTime("2026-01-07T17:00:00Z"),
              });
            },
          ),
        ),
        { timezone: "UTC" },
      );
    });

    expect(refusal).toContain("weeklyRestrictionTimes[0].startTime");
    expect(refusal).toContain("a Wednesday in UTC");
    expect(refusal).toContain("such as 2026-01-05T09:00:00.000Z");
  });

  test("a time a day off near midnight is refused in a schedule with a zone: it is on call on the day it falls on there", () => {
    // Monday 23:30 UTC is a Tuesday in Warsaw.
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Tuesday",
            startTime: dateTime("2026-01-05T23:30:00.000Z"),
            endTime: dateTime("2026-01-06T07:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW },
      );
    });

    expect(refusal).toContain("a Tuesday in Europe/Warsaw");
    expect(refusal).toContain("such as 2026-01-04T23:30:00.000Z");
  });

  test("a day left out is filled in from its time, as the engine always read it", () => {
    const checked: RestrictionTimes = WeeklyWindowDays.checkWrittenWindows(
      weekly([
        windowOf({
          startTime: dateTime("2026-01-09T16:00:00.000Z"),
          endTime: dateTime("2026-01-12T07:00:00.000Z"),
        }),
        windowOf({
          startDay: null,
          endDay: "Thursday",
          startTime: dateTime("2026-01-07T23:30:00.000Z"),
          endTime: dateTime("2026-01-07T23:45:00.000Z"),
        }),
      ]),
      { timezone: WARSAW },
    );

    expect(checked.weeklyRestrictionTimes[0]!.startDay).toBe(DayOfWeek.Friday);
    expect(checked.weeklyRestrictionTimes[0]!.endDay).toBe(DayOfWeek.Monday);
    // 23:30 UTC on a Wednesday is Thursday 00:30 in Warsaw: the day it pages.
    expect(checked.weeklyRestrictionTimes[1]!.startDay).toBe(
      DayOfWeek.Thursday,
    );
    expect(checked.weeklyRestrictionTimes[1]!.endDay).toBe(DayOfWeek.Thursday);
  });

  test("the written value is not changed in place", () => {
    const window: WeeklyResctriction = windowOf({
      startTime: dateTime("2026-01-09T16:00:00.000Z"),
      endTime: dateTime("2026-01-12T07:00:00.000Z"),
    });
    const written: RestrictionTimes = weekly([window]);

    WeeklyWindowDays.checkWrittenWindows(written, { timezone: WARSAW });

    expect("startDay" in window).toBe(false);
    expect(written.weeklyRestrictionTimes[0]).toBe(window);
  });

  test.each([
    ["monday", '"monday"'],
    ["Mon", '"Mon"'],
    ["", '""'],
    [1, '"1"'],
    [{ day: "Monday" }, '"{"day":"Monday"}"'],
  ])(
    "a day that is not a day of the week is refused: %j",
    (day: unknown, shown: string) => {
      const refusal: string = refusalOf(() => {
        return WeeklyWindowDays.checkWrittenWindows(
          weekly([
            windowOf({
              startDay: day,
              endDay: "Monday",
              startTime: dateTime("2026-01-05T08:00:00.000Z"),
              endTime: dateTime("2026-01-05T16:00:00.000Z"),
            }),
          ]),
          { timezone: WARSAW },
        );
      });

      expect(refusal).toBe(
        `restrictionTimes.value.weeklyRestrictionTimes[0].startDay is ${shown}, which is not a day of the week. Write Monday, Tuesday, Wednesday, Thursday, Friday, Saturday or Sunday.`,
      );
    },
  );

  test("a window the layer holds, sent back as it is, is not judged again - even one whose days disagree", () => {
    const stored: JSONObject = {
      startDay: "Monday",
      endDay: "Monday",
      startTime: dateTime("2026-01-07T08:00:00.000Z"),
      endTime: dateTime("2026-01-07T16:00:00.000Z"),
    };

    const checked: RestrictionTimes = WeeklyWindowDays.checkWrittenWindows(
      weekly([
        windowOf({
          startDay: "Monday",
          endDay: "Monday",
          // The same instants, written another way.
          startTime: "2026-01-07T09:00:00+01:00",
          endTime: at("2026-01-07T16:00:00.000Z"),
        }),
      ]),
      { timezone: WARSAW, storedWindows: [stored] },
    );

    expect(checked.weeklyRestrictionTimes[0]!.startDay).toBe("Monday");
  });

  test("a window changed by a minute is judged as any write is", () => {
    const stored: JSONObject = {
      startDay: "Monday",
      endDay: "Monday",
      startTime: dateTime("2026-01-07T08:00:00.000Z"),
      endTime: dateTime("2026-01-07T16:00:00.000Z"),
    };

    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-07T08:01:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          }),
        ]),
        { timezone: WARSAW, storedWindows: [stored] },
      );
    });

    expect(refusal).toContain("weeklyRestrictionTimes[0].startTime");
  });

  test("a schedule without a zone takes a time a day off that some zone puts on its day, as the Dashboard dates it there", () => {
    // Monday 00:30 in Warsaw, written from there: Sunday 23:30 UTC.
    const checked: RestrictionTimes = WeeklyWindowDays.checkWrittenWindows(
      weekly([
        windowOf({
          startDay: "Monday",
          endDay: "Monday",
          startTime: dateTime("2026-01-04T23:30:00.000Z"),
          endTime: dateTime("2026-01-05T07:00:00.000Z"),
        }),
      ]),
      { timezone: null },
    );

    expect(checked.weeklyRestrictionTimes[0]!.startDay).toBe("Monday");
  });

  test("a schedule without a zone refuses a Monday dated on a Wednesday: no zone puts it on a Monday", () => {
    const refusal: string = refusalOf(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Wednesday",
            startTime: dateTime("2026-01-07T12:00:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          }),
        ]),
        { timezone: undefined },
      );
    });

    expect(refusal).toContain(
      "on the server's clock (the schedule has no time zone), and a Monday in no time zone, but its startDay is Monday",
    );
  });

  test("a blank zone is a schedule without one", () => {
    expect(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-04T23:30:00.000Z"),
            endTime: dateTime("2026-01-05T07:00:00.000Z"),
          }),
        ]),
        { timezone: "   " },
      );
    }).not.toThrow();
  });

  test("windows dated in summer time and in winter time are both taken, in Warsaw and New York", () => {
    for (const zone of [WARSAW, NEW_YORK]) {
      for (const date of [
        "2026-01-05",
        "2026-06-01",
        "2026-03-30",
        "2026-11-02",
      ]) {
        expect(() => {
          return WeeklyWindowDays.checkWrittenWindows(
            weekly([
              windowOf({
                startDay: "Monday",
                endDay: "Monday",
                startTime: dateTime(wall(`${date} 00:00`, zone).toISOString()),
                endTime: dateTime(wall(`${date} 23:59`, zone).toISOString()),
              }),
            ]),
            { timezone: zone },
          );
        }).not.toThrow();
      }
    }
  });

  test("a sweep: every hour of a week, named every day, is taken exactly when it falls on its day in the zone", () => {
    for (const zone of [WARSAW, NEW_YORK]) {
      for (let hour: number = 0; hour < 7 * 24; hour++) {
        const time: Date = moment
          .tz("2026-01-04 00:00", zone)
          .add(hour, "hours")
          .toDate();

        for (const day of ALL_DAYS) {
          let isTaken: boolean = true;

          try {
            WeeklyWindowDays.checkWrittenWindows(
              weekly([
                windowOf({
                  startDay: day,
                  endDay: WeeklyWindowDays.getDayOf(time, zone),
                  startTime: time,
                  endTime: time,
                }),
              ]),
              { timezone: zone },
            );
          } catch {
            isTaken = false;
          }

          expect(isTaken).toBe(WeeklyWindowDays.getDayOf(time, zone) === day);
        }
      }
    }
  });
});

describe("WeeklyWindowDays.getStoredWindowRepair: a stored window", () => {
  function repairOf(
    window: WeeklyResctriction,
    zone: string | null,
  ): StoredWindowRepair {
    return WeeklyWindowDays.getStoredWindowRepair(window, zone);
  }

  test("a window whose times fall on its days is left as it is", () => {
    const window: WeeklyResctriction = windowOf({
      startDay: "Monday",
      endDay: "Friday",
      startTime: dateTime("2026-01-05T08:00:00.000Z"),
      endTime: dateTime("2026-01-09T16:00:00.000Z"),
    });
    const repair: StoredWindowRepair = repairOf(window, WARSAW);

    expect(repair.state).toBe(StoredWindowState.Agrees);
    expect(repair.isChanged).toBe(false);
    expect(repair.window).toBe(window);
  });

  test("a day left out is filled in from its time: it pages as before", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startTime: dateTime("2026-01-09T16:00:00.000Z"),
        endTime: dateTime("2026-01-12T07:00:00.000Z"),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.DaysFilledIn);
    expect(repair.isChanged).toBe(true);
    expect(repair.window.startDay).toBe(DayOfWeek.Friday);
    expect(repair.window.endDay).toBe(DayOfWeek.Monday);
    expect(repair.window.startTime).toEqual(
      dateTime("2026-01-09T16:00:00.000Z"),
    );
  });

  test("a day written another way is written as a day is", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startDay: " monday",
        endDay: "FRIDAY",
        startTime: dateTime("2026-01-05T08:00:00.000Z"),
        endTime: dateTime("2026-01-09T16:00:00.000Z"),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.DaysFilledIn);
    expect(repair.window.startDay).toBe(DayOfWeek.Monday);
    expect(repair.window.endDay).toBe(DayOfWeek.Friday);
  });

  test("a day that is no day at all is filled in from its time", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startDay: "Mon",
        endDay: 5,
        startTime: dateTime("2026-01-05T08:00:00.000Z"),
        endTime: dateTime("2026-01-09T16:00:00.000Z"),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.DaysFilledIn);
    expect(repair.window.startDay).toBe(DayOfWeek.Monday);
    expect(repair.window.endDay).toBe(DayOfWeek.Friday);
  });

  test("REGRESSION #11455: a Monday dated on a Wednesday is moved onto Monday, at the same time of day", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startDay: "Monday",
        endDay: "Monday",
        startTime: dateTime("2026-01-07T08:00:00.000Z"),
        endTime: dateTime("2026-01-07T16:00:00.000Z"),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.MovedOntoItsDays);
    expect(clockOf(repair.window.startTime, WARSAW)).toBe("Monday 09:00");
    expect(clockOf(repair.window.endTime, WARSAW)).toBe("Monday 17:00");
    expect(repair.window.startDay).toBe(DayOfWeek.Monday);
    expect(repair.window.endDay).toBe(DayOfWeek.Monday);
  });

  test("a Dashboard default whose day was kept and whose time was never touched: Sunday 00:00 dated on the day it was made is moved onto Sunday", () => {
    // Made on a Wednesday: From kept at Sunday 00:00, To set to Monday 08:00.
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startDay: "Sunday",
        endDay: "Monday",
        startTime: dateTime(wall("2026-01-07 00:00", WARSAW).toISOString()),
        endTime: dateTime(wall("2026-01-05 08:00", WARSAW).toISOString()),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.MovedOntoItsDays);
    expect(clockOf(repair.window.startTime, WARSAW)).toBe("Sunday 00:00");
    // The end was on its day already: kept as it was.
    expect(repair.window.endTime).toEqual(
      dateTime(wall("2026-01-05 08:00", WARSAW).toISOString()),
    );
  });

  test("a window whose days a change of zone moved - Monday 01:00 in Warsaw, read in New York as Sunday 19:00 - is left as it pages, to be checked", () => {
    const window: WeeklyResctriction = windowOf({
      startDay: "Monday",
      endDay: "Monday",
      startTime: dateTime(wall("2026-01-05 01:00", WARSAW).toISOString()),
      endTime: dateTime(wall("2026-01-05 09:00", WARSAW).toISOString()),
    });
    const repair: StoredWindowRepair = repairOf(window, NEW_YORK);

    expect(repair.state).toBe(StoredWindowState.ToCheck);
    expect(repair.isChanged).toBe(false);
    expect(repair.window).toBe(window);
    expect(repair.start.fallsOn).toBe(DayOfWeek.Sunday);
    expect(repair.end.fallsOn).toBe(DayOfWeek.Monday);
  });

  test("a window to check still has a day left out filled in", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        startDay: "Monday",
        startTime: dateTime(wall("2026-01-05 01:00", WARSAW).toISOString()),
        endTime: dateTime(wall("2026-01-05 09:00", WARSAW).toISOString()),
      }),
      NEW_YORK,
    );

    expect(repair.state).toBe(StoredWindowState.ToCheck);
    expect(repair.isChanged).toBe(true);
    expect(repair.window.endDay).toBe(DayOfWeek.Monday);
    expect(repair.window.startDay).toBe("Monday");
  });

  test("one end a zone could explain and one no zone can: the window was dated wrong, and both are moved", () => {
    const repair: StoredWindowRepair = repairOf(
      windowOf({
        // Tuesday 00:30 in Warsaw: a Monday in UTC.
        startDay: "Monday",
        // A Wednesday: a Friday nowhere.
        endDay: "Friday",
        startTime: dateTime("2026-01-05T23:30:00.000Z"),
        endTime: dateTime("2026-01-07T16:00:00.000Z"),
      }),
      WARSAW,
    );

    expect(repair.state).toBe(StoredWindowState.MovedOntoItsDays);
    expect(clockOf(repair.window.startTime, WARSAW)).toBe("Monday 00:30");
    expect(clockOf(repair.window.endTime, WARSAW)).toBe("Friday 17:00");
  });

  test("a schedule without a zone: a time a zone could put on its day is as such a schedule's windows are", () => {
    const window: WeeklyResctriction = windowOf({
      startDay: "Monday",
      endDay: "Monday",
      startTime: dateTime("2026-01-04T23:30:00.000Z"),
      endTime: dateTime("2026-01-05T07:00:00.000Z"),
    });

    const repair: StoredWindowRepair = repairOf(window, null);

    expect(repair.state).toBe(StoredWindowState.Agrees);
    expect(repair.window).toBe(window);
  });

  test("times that are no dates and times are left: there is no day to read", () => {
    const window: WeeklyResctriction = windowOf({
      startDay: "Monday",
      endDay: "Monday",
      startTime: "09:00",
      endTime: dateTime("2026-01-05T16:00:00.000Z"),
    });
    const repair: StoredWindowRepair = repairOf(window, WARSAW);

    expect(repair.state).toBe(StoredWindowState.Unreadable);
    expect(repair.window).toBe(window);
    expect(repair.isChanged).toBe(false);
  });

  test("a sweep: every repair leaves every window it changes on its days, and moves no time of day", () => {
    const random: SeededRandom = seededRandom(11455);

    for (let draw: number = 0; draw < 2000; draw++) {
      const zone: string = [WARSAW, NEW_YORK, "Asia/Kolkata", "UTC"][
        random(4)
      ]!;
      const startDay: DayOfWeek = ALL_DAYS[random(7)]!;
      const endDay: DayOfWeek = ALL_DAYS[random(7)]!;
      const start: Date = new Date(
        Date.UTC(2026, random(12), 1 + random(28), random(24), random(4) * 15),
      );
      const end: Date = new Date(
        start.getTime() + (1 + random(7 * 24 * 4)) * 15 * 60 * 1000,
      );

      const repair: StoredWindowRepair = repairOf(
        windowOf({
          startDay: startDay,
          endDay: endDay,
          startTime: start,
          endTime: end,
        }),
        zone,
      );

      if (repair.state === StoredWindowState.MovedOntoItsDays) {
        for (const [time, was] of [
          [repair.window.startTime, start],
          [repair.window.endTime, end],
        ] as Array<[Date, Date]>) {
          expect(moment.tz(time, zone).format("HH:mm")).toBe(
            moment.tz(was, zone).format("HH:mm"),
          );
        }

        expect(WeeklyWindowDays.getDayOf(repair.window.startTime, zone)).toBe(
          startDay,
        );
        expect(WeeklyWindowDays.getDayOf(repair.window.endTime, zone)).toBe(
          endDay,
        );
      }

      if (repair.state === StoredWindowState.Agrees) {
        expect(WeeklyWindowDays.getDayOf(start, zone)).toBe(startDay);
        expect(WeeklyWindowDays.getDayOf(end, zone)).toBe(endDay);
      }

      if (repair.state === StoredWindowState.ToCheck) {
        expect(repair.window.startTime).toBe(start);
        expect(repair.window.endTime).toBe(end);
      }

      // Read again, a repaired window has nothing more to repair.
      const again: StoredWindowRepair = repairOf(repair.window, zone);
      if (repair.state !== StoredWindowState.ToCheck) {
        expect(again.state).toBe(StoredWindowState.Agrees);
      } else {
        expect(again.state).toBe(StoredWindowState.ToCheck);
        expect(again.isChanged).toBe(false);
      }
    }
  });
});

describe("WeeklyWindowDays.getStoredWindowsRepair", () => {
  test("a restriction that is not Weekly has nothing to repair", () => {
    const repair: StoredWindowsRepair = WeeklyWindowDays.getStoredWindowsRepair(
      new RestrictionTimes(),
      WARSAW,
    );

    expect(repair).toEqual({
      windows: [],
      repairs: [],
      isChanged: false,
      pagesOtherwise: false,
    });
  });

  test("windows read together: what changes, and whether anything pages otherwise", () => {
    const agreeing: WeeklyResctriction = windowOf({
      startDay: "Monday",
      endDay: "Monday",
      startTime: dateTime("2026-01-05T08:00:00.000Z"),
      endTime: dateTime("2026-01-05T16:00:00.000Z"),
    });
    const leftOut: WeeklyResctriction = windowOf({
      startTime: dateTime("2026-01-06T08:00:00.000Z"),
      endTime: dateTime("2026-01-06T16:00:00.000Z"),
    });
    const datedWrong: WeeklyResctriction = windowOf({
      startDay: "Friday",
      endDay: "Friday",
      startTime: dateTime("2026-01-07T08:00:00.000Z"),
      endTime: dateTime("2026-01-07T16:00:00.000Z"),
    });

    const onlyFilled: StoredWindowsRepair =
      WeeklyWindowDays.getStoredWindowsRepair(
        weekly([agreeing, leftOut]),
        WARSAW,
      );
    expect(onlyFilled.isChanged).toBe(true);
    expect(onlyFilled.pagesOtherwise).toBe(false);
    expect(onlyFilled.windows[0]).toBe(agreeing);
    expect(onlyFilled.windows[1]!.startDay).toBe(DayOfWeek.Tuesday);

    const moved: StoredWindowsRepair = WeeklyWindowDays.getStoredWindowsRepair(
      weekly([agreeing, datedWrong]),
      WARSAW,
    );
    expect(moved.isChanged).toBe(true);
    expect(moved.pagesOtherwise).toBe(true);
    expect(clockOf(moved.windows[1]!.startTime, WARSAW)).toBe("Friday 09:00");

    const nothing: StoredWindowsRepair =
      WeeklyWindowDays.getStoredWindowsRepair(weekly([agreeing]), WARSAW);
    expect(nothing.isChanged).toBe(false);
    expect(nothing.pagesOtherwise).toBe(false);
  });
});

describe("WeeklyWindowDays.getWindowsToCheck", () => {
  test("only the windows whose times fall on other days than they name, with both", () => {
    const toCheck: Array<WindowToCheck> = WeeklyWindowDays.getWindowsToCheck(
      weekly([
        windowOf({
          startDay: "Monday",
          endDay: "Monday",
          startTime: dateTime("2026-01-05T08:00:00.000Z"),
          endTime: dateTime("2026-01-05T16:00:00.000Z"),
        }),
        // Moved by a change of zone: Monday 01:00 Warsaw is Sunday 19:00 in New York.
        windowOf({
          startDay: "Monday",
          endDay: "Monday",
          startTime: dateTime(wall("2026-01-05 01:00", WARSAW).toISOString()),
          endTime: dateTime(wall("2026-01-05 09:00", WARSAW).toISOString()),
        }),
        // Dated wrong: not moved by the migration yet.
        windowOf({
          startDay: "Friday",
          endDay: "Friday",
          startTime: dateTime("2026-01-07T13:00:00.000Z"),
          endTime: dateTime("2026-01-07T21:00:00.000Z"),
        }),
      ]),
      NEW_YORK,
    );

    expect(toCheck).toEqual([
      {
        index: 1,
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Monday,
        startsOn: DayOfWeek.Sunday,
        endsOn: DayOfWeek.Monday,
      },
      {
        index: 2,
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Friday,
        startsOn: DayOfWeek.Wednesday,
        endsOn: DayOfWeek.Wednesday,
      },
    ]);
  });

  test("nothing to check for no restriction, or one that is not Weekly", () => {
    expect(WeeklyWindowDays.getWindowsToCheck(null, WARSAW)).toEqual([]);
    expect(WeeklyWindowDays.getWindowsToCheck(undefined, WARSAW)).toEqual([]);
    expect(
      WeeklyWindowDays.getWindowsToCheck(new RestrictionTimes(), WARSAW),
    ).toEqual([]);
  });

  test("a schedule without a zone shows only what no zone explains", () => {
    expect(
      WeeklyWindowDays.getWindowsToCheck(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-04T23:30:00.000Z"),
            endTime: dateTime("2026-01-05T07:00:00.000Z"),
          }),
        ]),
        null,
      ),
    ).toEqual([]);

    expect(
      WeeklyWindowDays.getWindowsToCheck(
        weekly([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: dateTime("2026-01-07T12:00:00.000Z"),
            endTime: dateTime("2026-01-07T16:00:00.000Z"),
          }),
        ]),
        null,
      ),
    ).toHaveLength(1);
  });
});

describe("WeeklyWindowDays.withDaysOfTheirTimes", () => {
  test("a window shown to be checked is saved with the days it pages on, so a save pages as before", () => {
    const written: RestrictionTimes = weekly([
      windowOf({
        startDay: "Monday",
        endDay: "Monday",
        startTime: dateTime(wall("2026-01-05 01:00", WARSAW).toISOString()),
        endTime: dateTime(wall("2026-01-05 09:00", WARSAW).toISOString()),
      }),
    ]);

    const stamped: RestrictionTimes = WeeklyWindowDays.withDaysOfTheirTimes(
      written,
      NEW_YORK,
    );

    expect(stamped).not.toBe(written);
    expect(stamped.weeklyRestrictionTimes[0]!.startDay).toBe(DayOfWeek.Sunday);
    expect(stamped.weeklyRestrictionTimes[0]!.endDay).toBe(DayOfWeek.Monday);
    expect(stamped.weeklyRestrictionTimes[0]!.startTime).toBe(
      written.weeklyRestrictionTimes[0]!.startTime,
    );
    // The value it was made from is as it was.
    expect(written.weeklyRestrictionTimes[0]!.startDay).toBe("Monday");

    // Saved so, it is taken by the server's check in that zone.
    expect(() => {
      return WeeklyWindowDays.checkWrittenWindows(stamped, {
        timezone: NEW_YORK,
      });
    }).not.toThrow();
  });

  test("windows on their days are the same object", () => {
    const written: RestrictionTimes = weekly([
      windowOf({
        startDay: "Monday",
        endDay: "Monday",
        startTime: dateTime("2026-01-05T08:00:00.000Z"),
        endTime: dateTime("2026-01-05T16:00:00.000Z"),
      }),
    ]);

    expect(WeeklyWindowDays.withDaysOfTheirTimes(written, WARSAW)).toBe(
      written,
    );
    expect(
      WeeklyWindowDays.withDaysOfTheirTimes(new RestrictionTimes(), WARSAW),
    ).toBeInstanceOf(RestrictionTimes);
  });
});

describe("a schedule's time zone changes: every time stays on the clock", () => {
  test("a rotation start and hand-off keep their date and time of day", () => {
    const handOff: Date = wall("2026-11-30 09:00", WARSAW);
    const moved: Date = WeeklyWindowDays.moveMomentToTimezone(
      handOff,
      WARSAW,
      NEW_YORK,
    );

    expect(moment.tz(moved, NEW_YORK).format("YYYY-MM-DD HH:mm")).toBe(
      "2026-11-30 09:00",
    );
    expect(moved.toISOString()).toBe("2026-11-30T14:00:00.000Z");
  });

  test("a Monday 01:00 window stays Monday 01:00, where its moment read in New York would be Sunday 19:00", () => {
    const start: Date = wall("2026-01-05 01:00", WARSAW);

    expect(clockOf(start, NEW_YORK)).toBe("Sunday 19:00");

    const moved: Date = WeeklyWindowDays.moveWindowTimeToTimezone(
      start,
      WARSAW,
      NEW_YORK,
    );

    expect(clockOf(moved, NEW_YORK)).toBe("Monday 01:00");
  });

  test("a window's time the new zone's clock skips on its date keeps its time of day on another week", () => {
    // 02:30 on 2026-03-08 does not exist in New York.
    const moved: Date = WeeklyWindowDays.moveWindowTimeToTimezone(
      wall("2026-03-08 02:30", WARSAW),
      WARSAW,
      NEW_YORK,
    );

    expect(clockOf(moved, NEW_YORK)).toBe("Sunday 02:30");
  });

  test("a whole restriction: every window keeps its days and hours, and agrees with its days in the new zone", () => {
    const original: RestrictionTimes = weekly([
      windowOf({
        startDay: "Monday",
        endDay: "Monday",
        startTime: dateTime(wall("2026-01-05 01:00", WARSAW).toISOString()),
        endTime: dateTime(wall("2026-01-05 09:00", WARSAW).toISOString()),
      }),
      windowOf({
        startDay: "Friday",
        endDay: "Monday",
        startTime: dateTime(wall("2026-01-09 22:00", WARSAW).toISOString()),
        endTime: dateTime(wall("2026-01-12 06:00", WARSAW).toISOString()),
      }),
    ]);

    const moved: RestrictionTimes = WeeklyWindowDays.moveWindowsToTimezone(
      original,
      WARSAW,
      NEW_YORK,
    );

    expect(moved.restrictionType).toBe(RestrictionType.Weekly);
    expect(
      moved.weeklyRestrictionTimes.map((window: WeeklyResctriction) => {
        return [
          window.startDay,
          clockOf(window.startTime, NEW_YORK),
          window.endDay,
          clockOf(window.endTime, NEW_YORK),
        ];
      }),
    ).toEqual([
      ["Monday", "Monday 01:00", "Monday", "Monday 09:00"],
      ["Friday", "Friday 22:00", "Monday", "Monday 06:00"],
    ]);

    expect(WeeklyWindowDays.getWindowsToCheck(moved, NEW_YORK)).toEqual([]);
  });

  test("a Daily restriction keeps its hours; None stays None", () => {
    const daily: RestrictionTimes = new RestrictionTimes();
    daily.restrictionType = RestrictionType.Daily;
    daily.dayRestrictionTimes = {
      startTime: wall("2026-01-05 17:00", WARSAW),
      endTime: wall("2026-01-06 07:00", WARSAW),
    };

    const moved: RestrictionTimes = WeeklyWindowDays.moveWindowsToTimezone(
      daily,
      WARSAW,
      NEW_YORK,
    );

    expect(moved.restrictionType).toBe(RestrictionType.Daily);
    expect(
      moment.tz(moved.dayRestrictionTimes!.startTime, NEW_YORK).format("HH:mm"),
    ).toBe("17:00");
    expect(
      moment.tz(moved.dayRestrictionTimes!.endTime, NEW_YORK).format("HH:mm"),
    ).toBe("07:00");

    const none: RestrictionTimes = WeeklyWindowDays.moveWindowsToTimezone(
      new RestrictionTimes(),
      WARSAW,
      NEW_YORK,
    );
    expect(none.restrictionType).toBe(RestrictionType.None);
    expect(none.dayRestrictionTimes).toBeNull();
    expect(none.weeklyRestrictionTimes).toEqual([]);
  });

  test("a time that is no date and time is kept as it is", () => {
    const moved: RestrictionTimes = WeeklyWindowDays.moveWindowsToTimezone(
      weekly([
        windowOf({
          startDay: "Monday",
          endDay: "Monday",
          startTime: "09:00",
          endTime: dateTime(wall("2026-01-05 17:00", WARSAW).toISOString()),
        }),
      ]),
      WARSAW,
      NEW_YORK,
    );

    expect(moved.weeklyRestrictionTimes[0]!.startTime).toBe("09:00");
    expect(clockOf(moved.weeklyRestrictionTimes[0]!.endTime, NEW_YORK)).toBe(
      "Monday 17:00",
    );
  });

  test("a sweep: every quarter hour of a week, moved from each zone to another and back, keeps its day and time of day", () => {
    const zones: Array<string> = [
      WARSAW,
      NEW_YORK,
      "Asia/Kolkata",
      "Pacific/Auckland",
      "UTC",
    ];

    for (const from of zones) {
      for (const to of zones) {
        if (from === to) {
          continue;
        }

        for (let quarter: number = 0; quarter < 7 * 24 * 4; quarter += 5) {
          const time: Date = moment
            .tz("2026-03-02 00:00", from)
            .add(quarter * 15, "minutes")
            .toDate();

          const moved: Date = WeeklyWindowDays.moveWindowTimeToTimezone(
            time,
            from,
            to,
          );

          expect(clockOf(moved, to)).toBe(clockOf(time, from));

          const back: Date = WeeklyWindowDays.moveWindowTimeToTimezone(
            moved,
            to,
            from,
          );

          expect(clockOf(back, from)).toBe(clockOf(time, from));
        }
      }
    }
  });
});
