import DayOfWeek from "../../../Types/Day/DayOfWeek";
import { JSONObject } from "../../../Types/JSON";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE,
  WORKING_HOURS_NOT_SET_MESSAGE,
  WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE,
  WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE,
  WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/WorkingHours";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * WORKING HOURS: IS A MOMENT INSIDE THEM, AND WHEN DO THEY NEXT BEGIN.
 *
 * An on-call rule that pages only during working hours holds the runs it
 * starts outside them until they begin. The hours are a schedule layer's
 * restriction times read on the clock of the rule's time zone, so every
 * fixture here is built and every answer checked on an explicit zone's clock
 * (moment.tz): the tests hold whatever zone the machine running them is in.
 */

// A moment on a zone's clock: "2026-10-20 02:00" in Europe/London.
function at(wallClock: string, timezone: string): Date {
  return moment.tz(wallClock, "YYYY-MM-DD HH:mm:ss", timezone).toDate();
}

// The same moment as the zone's clock shows it, to read an answer.
function onClock(date: Date | null, timezone: string): string | null {
  return date ? moment.tz(date, timezone).format("ddd YYYY-MM-DD HH:mm") : null;
}

// A daily window from one time to another, stored the way the editor stores it.
function daily(data: {
  from: string;
  to: string;
  timezone: string;
  // The day the times were typed on: their wall clock is what counts.
  typedOn?: string | undefined;
}): RestrictionTimes {
  const day: string = data.typedOn || "2026-01-15";
  const hours: RestrictionTimes = new RestrictionTimes();

  hours.restictionType = RestrictionType.Daily;
  hours.dayRestrictionTimes = {
    startTime: at(`${day} ${data.from}:00`, data.timezone),
    endTime: at(`${day} ${data.to}:00`, data.timezone),
  };
  hours.weeklyRestrictionTimes = [];

  return hours;
}

// A day of the week in January 2026, whose 5th is a Monday.
const JANUARY_2026_DAY: Record<DayOfWeek, string> = {
  [DayOfWeek.Monday]: "2026-01-05",
  [DayOfWeek.Tuesday]: "2026-01-06",
  [DayOfWeek.Wednesday]: "2026-01-07",
  [DayOfWeek.Thursday]: "2026-01-08",
  [DayOfWeek.Friday]: "2026-01-09",
  [DayOfWeek.Saturday]: "2026-01-10",
  [DayOfWeek.Sunday]: "2026-01-11",
};

interface WeeklyWindow {
  fromDay: DayOfWeek;
  from: string;
  toDay: DayOfWeek;
  to: string;
}

// Weekly windows, each time stamped on its own weekday in the zone.
function weekly(
  windows: Array<WeeklyWindow>,
  timezone: string,
): RestrictionTimes {
  const hours: RestrictionTimes = new RestrictionTimes();

  hours.restictionType = RestrictionType.Weekly;
  hours.dayRestrictionTimes = null;
  hours.weeklyRestrictionTimes = windows.map(
    (window: WeeklyWindow): WeeklyResctriction => {
      return {
        startDay: window.fromDay,
        endDay: window.toDay,
        startTime: at(
          `${JANUARY_2026_DAY[window.fromDay]} ${window.from}:00`,
          timezone,
        ),
        endTime: at(
          `${JANUARY_2026_DAY[window.toDay]} ${window.to}:00`,
          timezone,
        ),
      };
    },
  );

  return hours;
}

// Monday to Friday, 09:00 to 17:00: five windows.
function workingWeek(timezone: string): RestrictionTimes {
  return weekly(
    [
      DayOfWeek.Monday,
      DayOfWeek.Tuesday,
      DayOfWeek.Wednesday,
      DayOfWeek.Thursday,
      DayOfWeek.Friday,
    ].map((day: DayOfWeek): WeeklyWindow => {
      return { fromDay: day, from: "09:00", toDay: day, to: "17:00" };
    }),
    timezone,
  );
}

function nextStart(
  hours: RestrictionTimes | JSONObject | null,
  timezone: string,
  moment: Date,
): Date | null {
  return WorkingHours.getNextStart({ hours, timezone, at: moment });
}

const LONDON: string = "Europe/London";
const NEW_YORK: string = "America/New_York";

describe("a daily window", () => {
  const hours: RestrictionTimes = daily({
    from: "09:00",
    to: "17:00",
    timezone: LONDON,
  });

  test("raised at 2am, pages at 9am the same morning", () => {
    const raised: Date = at("2026-10-20 02:00:00", LONDON);

    expect(WorkingHours.isWithin({ hours, timezone: LONDON, at: raised })).toBe(
      false,
    );
    expect(onClock(nextStart(hours, LONDON, raised), LONDON)).toBe(
      "Tue 2026-10-20 09:00",
    );
  });

  test("inside the window, pages at once: the moment itself", () => {
    const raised: Date = at("2026-10-20 10:30:00", LONDON);

    expect(WorkingHours.isWithin({ hours, timezone: LONDON, at: raised })).toBe(
      true,
    );
    expect(nextStart(hours, LONDON, raised)).toEqual(raised);
  });

  test("opens at its start and closes at its end", () => {
    const opens: Date = at("2026-10-20 09:00:00", LONDON);
    const lastSecond: Date = at("2026-10-20 16:59:59", LONDON);
    const closes: Date = at("2026-10-20 17:00:00", LONDON);

    expect(WorkingHours.isWithin({ hours, timezone: LONDON, at: opens })).toBe(
      true,
    );
    expect(
      WorkingHours.isWithin({ hours, timezone: LONDON, at: lastSecond }),
    ).toBe(true);
    expect(WorkingHours.isWithin({ hours, timezone: LONDON, at: closes })).toBe(
      false,
    );
    expect(onClock(nextStart(hours, LONDON, closes), LONDON)).toBe(
      "Wed 2026-10-21 09:00",
    );
  });

  test("after the window, pages the next morning", () => {
    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-20 23:15:00", LONDON)),
        LONDON,
      ),
    ).toBe("Wed 2026-10-21 09:00");
  });

  test("opens every day, the weekend too", () => {
    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-24 03:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Sat 2026-10-24 09:00");
  });

  test("that runs past midnight is inside late at night and early in the morning", () => {
    const night: RestrictionTimes = daily({
      from: "22:00",
      to: "06:00",
      timezone: LONDON,
    });

    for (const inside of [
      "2026-10-20 22:00:00",
      "2026-10-20 23:59:00",
      "2026-10-21 00:00:00",
      "2026-10-21 05:59:00",
    ]) {
      expect(
        WorkingHours.isWithin({
          hours: night,
          timezone: LONDON,
          at: at(inside, LONDON),
        }),
      ).toBe(true);
    }

    expect(
      onClock(
        nextStart(night, LONDON, at("2026-10-21 06:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Wed 2026-10-21 22:00");
    expect(
      onClock(
        nextStart(night, LONDON, at("2026-10-21 12:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Wed 2026-10-21 22:00");
  });
});

describe("the rule's time zone, not the server's", () => {
  test("09:00 in New York is 13:00 UTC in the summer and 14:00 UTC in the winter", () => {
    const hours: RestrictionTimes = daily({
      from: "09:00",
      to: "17:00",
      timezone: NEW_YORK,
    });

    expect(
      nextStart(
        hours,
        NEW_YORK,
        new Date("2026-07-01T06:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-07-01T13:00:00.000Z");
    expect(
      nextStart(
        hours,
        NEW_YORK,
        new Date("2026-01-14T06:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-01-14T14:00:00.000Z");
  });

  test("a zone half an hour off UTC: 09:00 in Kolkata is 03:30 UTC", () => {
    const kolkata: string = "Asia/Kolkata";
    const hours: RestrictionTimes = daily({
      from: "09:00",
      to: "17:00",
      timezone: kolkata,
    });

    expect(
      nextStart(
        hours,
        kolkata,
        new Date("2026-10-20T01:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-10-20T03:30:00.000Z");
  });

  test("a zone three quarters of an hour off: 09:00 in Kathmandu is 03:15 UTC", () => {
    const kathmandu: string = "Asia/Kathmandu";
    const hours: RestrictionTimes = daily({
      from: "09:00",
      to: "17:00",
      timezone: kathmandu,
    });

    expect(
      nextStart(
        hours,
        kathmandu,
        new Date("2026-10-20T01:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-10-20T03:15:00.000Z");
  });

  test("a moment that is still yesterday in UTC is already today in Tokyo", () => {
    const tokyo: string = "Asia/Tokyo";
    const hours: RestrictionTimes = workingWeek(tokyo);

    // Sunday 23:30 UTC is Monday 08:30 in Tokyo: Monday's window opens at 09:00.
    expect(
      onClock(nextStart(hours, tokyo, new Date("2026-10-18T23:30:00Z")), tokyo),
    ).toBe("Mon 2026-10-19 09:00");
  });

  test("hours typed in the winter keep their clock in the summer", () => {
    // 09:00 typed on a January day, when London is on UTC.
    const hours: RestrictionTimes = daily({
      from: "09:00",
      to: "17:00",
      timezone: LONDON,
      typedOn: "2026-01-15",
    });

    // In July London is an hour ahead of UTC: 09:00 there is 08:00 UTC.
    expect(
      nextStart(hours, LONDON, new Date("2026-07-01T05:00:00Z"))!.toISOString(),
    ).toBe("2026-07-01T08:00:00.000Z");
  });
});

describe("the clocks changing", () => {
  const hours: RestrictionTimes = daily({
    from: "09:00",
    to: "17:00",
    timezone: LONDON,
  });

  test("on the morning they spring forward, 09:00 is 09:00 on the new clock", () => {
    // London goes from 01:00 GMT to 02:00 BST on 29 March 2026.
    expect(
      nextStart(hours, LONDON, new Date("2026-03-29T00:30:00Z"))!.toISOString(),
    ).toBe("2026-03-29T08:00:00.000Z");
  });

  test("on the night they fall back, 09:00 is 09:00 on the new clock", () => {
    // London goes from 02:00 BST back to 01:00 GMT on 25 October 2026.
    expect(
      nextStart(hours, LONDON, new Date("2026-10-25T00:30:00Z"))!.toISOString(),
    ).toBe("2026-10-25T09:00:00.000Z");
  });

  test("from the evening before the change, the next morning is on the new clock", () => {
    expect(
      nextStart(hours, LONDON, new Date("2026-03-28T20:00:00Z"))!.toISOString(),
    ).toBe("2026-03-29T08:00:00.000Z");
    expect(
      nextStart(hours, LONDON, new Date("2026-10-24T20:00:00Z"))!.toISOString(),
    ).toBe("2026-10-25T09:00:00.000Z");
  });

  test("a window that opens in the hour that is skipped opens when the clock comes back to it", () => {
    const early: RestrictionTimes = daily({
      from: "01:30",
      to: "04:00",
      timezone: LONDON,
    });

    // 01:30 does not happen on 29 March in London: 02:30 BST, 01:30 UTC.
    expect(
      nextStart(early, LONDON, new Date("2026-03-29T00:10:00Z"))!.toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
  });

  test("a time that comes twice opens at the first of the two", () => {
    const early: RestrictionTimes = daily({
      from: "01:30",
      to: "04:00",
      timezone: LONDON,
    });

    // 01:30 happens at 00:30 UTC (BST) and again at 01:30 UTC (GMT).
    expect(
      nextStart(early, LONDON, new Date("2026-10-24T23:00:00Z"))!.toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
  });

  test("New York's working week starts at 09:00 on the Monday after the clocks spring forward", () => {
    const week: RestrictionTimes = workingWeek(NEW_YORK);

    // New York springs forward on Sunday 8 March 2026: 09:00 EDT is 13:00 UTC.
    expect(
      nextStart(
        week,
        NEW_YORK,
        new Date("2026-03-08T16:00:00Z"),
      )!.toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
  });
});

describe("weekly windows", () => {
  const week: RestrictionTimes = workingWeek(LONDON);

  test("Friday evening waits for Monday morning", () => {
    expect(
      onClock(
        nextStart(week, LONDON, at("2026-10-23 18:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Mon 2026-10-26 09:00");
  });

  test("the weekend waits for Monday morning", () => {
    expect(
      onClock(
        nextStart(week, LONDON, at("2026-10-24 02:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Mon 2026-10-26 09:00");
    expect(
      onClock(
        nextStart(week, LONDON, at("2026-10-25 23:59:00", LONDON)),
        LONDON,
      ),
    ).toBe("Mon 2026-10-26 09:00");
  });

  test("a weekday night waits for the morning", () => {
    expect(
      onClock(
        nextStart(week, LONDON, at("2026-10-21 02:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Wed 2026-10-21 09:00");
  });

  test("a weekday afternoon pages at once", () => {
    const afternoon: Date = at("2026-10-21 14:00:00", LONDON);

    expect(nextStart(week, LONDON, afternoon)).toEqual(afternoon);
  });

  test("a window over the weekend - Friday 20:00 to Monday 08:00 - holds across the week's end", () => {
    const weekend: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Friday,
          from: "20:00",
          toDay: DayOfWeek.Monday,
          to: "08:00",
        },
      ],
      LONDON,
    );

    for (const inside of [
      "2026-10-23 20:00:00",
      "2026-10-24 12:00:00",
      "2026-10-25 23:30:00",
      "2026-10-26 07:59:00",
    ]) {
      expect(
        WorkingHours.isWithin({
          hours: weekend,
          timezone: LONDON,
          at: at(inside, LONDON),
        }),
      ).toBe(true);
    }

    expect(
      onClock(
        nextStart(weekend, LONDON, at("2026-10-26 08:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Fri 2026-10-30 20:00");
    expect(
      onClock(
        nextStart(weekend, LONDON, at("2026-10-21 12:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Fri 2026-10-23 20:00");
  });

  test("of several windows, the one that opens first", () => {
    const hours: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Saturday,
          from: "10:00",
          toDay: DayOfWeek.Saturday,
          to: "12:00",
        },
        {
          fromDay: DayOfWeek.Thursday,
          from: "13:00",
          toDay: DayOfWeek.Thursday,
          to: "14:00",
        },
      ],
      LONDON,
    );

    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-21 12:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Thu 2026-10-22 13:00");
    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-22 15:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Sat 2026-10-24 10:00");
  });

  test("a window that opened earlier today and is over opens again a week later", () => {
    const hours: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Wednesday,
          from: "09:00",
          toDay: DayOfWeek.Wednesday,
          to: "10:00",
        },
      ],
      LONDON,
    );

    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-21 11:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Wed 2026-10-28 09:00");
  });

  test("a window's weekday is its time's weekday on the zone's clock", () => {
    const tokyo: string = "Asia/Tokyo";
    // Monday 00:30 in Tokyo is Sunday 15:30 in UTC.
    const hours: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Monday,
          from: "00:30",
          toDay: DayOfWeek.Monday,
          to: "02:00",
        },
      ],
      tokyo,
    );

    expect(
      onClock(nextStart(hours, tokyo, new Date("2026-10-20T00:00:00Z")), tokyo),
    ).toBe("Mon 2026-10-26 00:30");
  });
});

describe("hours that never open hold nothing", () => {
  const now: Date = new Date("2026-10-20T01:00:00Z");

  test("none set, no restriction, or an unknown time zone: no start, and why", () => {
    const none: RestrictionTimes = new RestrictionTimes();

    expect(nextStart(null, LONDON, now)).toBeNull();
    expect(nextStart(none, LONDON, now)).toBeNull();
    expect(
      nextStart(
        daily({ from: "09:00", to: "17:00", timezone: LONDON }),
        "Mars/Olympus_Mons",
        now,
      ),
    ).toBeNull();

    expect(WorkingHours.getProblem({ hours: null, timezone: LONDON })).toBe(
      WORKING_HOURS_NOT_SET_MESSAGE,
    );
    expect(WorkingHours.getProblem({ hours: none, timezone: LONDON })).toBe(
      WORKING_HOURS_NOT_SET_MESSAGE,
    );
    expect(
      WorkingHours.getProblem({
        hours: daily({ from: "09:00", to: "17:00", timezone: LONDON }),
        timezone: "",
      }),
    ).toBe(WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE);
  });

  test("a daily window that ends when it starts", () => {
    const empty: RestrictionTimes = daily({
      from: "09:00",
      to: "09:00",
      timezone: LONDON,
    });

    expect(nextStart(empty, LONDON, now)).toBeNull();
    expect(WorkingHours.getProblem({ hours: empty, timezone: LONDON })).toBe(
      WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE,
    );
  });

  test("weekly hours with no window, or one that ends when it starts", () => {
    const noWindows: RestrictionTimes = weekly([], LONDON);
    const emptyWindow: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Monday,
          from: "09:00",
          toDay: DayOfWeek.Monday,
          to: "09:00",
        },
      ],
      LONDON,
    );

    expect(nextStart(noWindows, LONDON, now)).toBeNull();
    expect(nextStart(emptyWindow, LONDON, now)).toBeNull();
    expect(
      WorkingHours.getProblem({ hours: noWindows, timezone: LONDON }),
    ).toBe(WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE);
    expect(
      WorkingHours.getProblem({ hours: emptyWindow, timezone: LONDON }),
    ).toBe(WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE);
  });

  test("hours that open say nothing is wrong", () => {
    expect(
      WorkingHours.getProblem({
        hours: daily({ from: "22:00", to: "06:00", timezone: LONDON }),
        timezone: LONDON,
      }),
    ).toBeNull();
    expect(
      WorkingHours.getProblem({ hours: workingWeek(LONDON), timezone: LONDON }),
    ).toBeNull();
  });
});

describe("hours as a column stores them", () => {
  test("read back from JSON, they open at the same moment", () => {
    const hours: RestrictionTimes = workingWeek(LONDON);
    const stored: JSONObject = JSON.parse(
      JSON.stringify(hours.toJSON()),
    ) as JSONObject;
    const raised: Date = at("2026-10-24 02:00:00", LONDON);

    expect(nextStart(stored, LONDON, raised)).toEqual(
      nextStart(hours, LONDON, raised),
    );
    expect(WorkingHours.getProblem({ hours: stored, timezone: LONDON })).toBe(
      null,
    );
  });

  test("anything that is not restriction times is no hours", () => {
    expect(WorkingHours.toRestrictionTimes({ not: "hours" })).toBeNull();
    expect(
      nextStart(
        { not: "hours" } as JSONObject,
        LONDON,
        new Date("2026-10-20T01:00:00Z"),
      ),
    ).toBeNull();
  });
});

describe("the hours a rule starts with", () => {
  test("are Monday to Friday, 09:00 to 17:00, on the zone's clock", () => {
    const hours: RestrictionTimes = WorkingHours.getDefaultHours({
      timezone: NEW_YORK,
      now: new Date("2026-10-20T12:00:00Z"),
    });

    expect(hours.restictionType).toBe(RestrictionType.Weekly);
    expect(hours.weeklyRestrictionTimes).toHaveLength(5);
    expect(
      hours.weeklyRestrictionTimes.map((window: WeeklyResctriction): string => {
        return `${window.startDay} ${moment
          .tz(window.startTime, NEW_YORK)
          .format("ddd HH:mm")}-${moment
          .tz(window.endTime, NEW_YORK)
          .format("ddd HH:mm")}`;
      }),
    ).toEqual([
      "Monday Mon 09:00-Mon 17:00",
      "Tuesday Tue 09:00-Tue 17:00",
      "Wednesday Wed 09:00-Wed 17:00",
      "Thursday Thu 09:00-Thu 17:00",
      "Friday Fri 09:00-Fri 17:00",
    ]);
    expect(WorkingHours.getProblem({ hours, timezone: NEW_YORK })).toBeNull();
  });

  test("are made the same in the week the clocks change", () => {
    // The week of Sunday 8 March 2026 in New York.
    const hours: RestrictionTimes = WorkingHours.getDefaultHours({
      timezone: NEW_YORK,
      now: new Date("2026-03-06T12:00:00Z"),
    });

    expect(
      onClock(
        nextStart(hours, NEW_YORK, new Date("2026-03-07T12:00:00Z")),
        NEW_YORK,
      ),
    ).toBe("Mon 2026-03-09 09:00");
  });

  test("in a zone OneUptime does not know, are on UTC's clock", () => {
    const hours: RestrictionTimes = WorkingHours.getDefaultHours({
      timezone: "Nowhere/Nothing",
      now: new Date("2026-10-20T12:00:00Z"),
    });

    expect(
      moment
        .tz(hours.weeklyRestrictionTimes[0]!.startTime, "UTC")
        .format("ddd HH:mm"),
    ).toBe("Mon 09:00");
  });
});

describe("moving the hours to another zone", () => {
  test("keeps their clock: 09:00 to 17:00 in London is 09:00 to 17:00 in New York", () => {
    const moved: RestrictionTimes | null = WorkingHours.moveToTimezone({
      hours: daily({ from: "09:00", to: "17:00", timezone: LONDON }),
      fromTimezone: LONDON,
      toTimezone: NEW_YORK,
    });

    expect(
      moment
        .tz(moved!.dayRestrictionTimes!.startTime, NEW_YORK)
        .format("HH:mm"),
    ).toBe("09:00");
    expect(
      moment.tz(moved!.dayRestrictionTimes!.endTime, NEW_YORK).format("HH:mm"),
    ).toBe("17:00");
  });

  test("keeps each weekly window on its days", () => {
    const tokyo: string = "Asia/Tokyo";
    const moved: RestrictionTimes | null = WorkingHours.moveToTimezone({
      hours: workingWeek(LONDON),
      fromTimezone: LONDON,
      toTimezone: tokyo,
    });

    expect(
      onClock(nextStart(moved, tokyo, at("2026-10-24 02:00:00", tokyo)), tokyo),
    ).toBe("Mon 2026-10-26 09:00");
    expect(
      moved!.weeklyRestrictionTimes.map(
        (window: WeeklyResctriction): string => {
          return moment.tz(window.startTime, tokyo).format("ddd HH:mm");
        },
      ),
    ).toEqual([
      "Mon 09:00",
      "Tue 09:00",
      "Wed 09:00",
      "Thu 09:00",
      "Fri 09:00",
    ]);
  });

  test("leaves the hours as they are when either zone is unknown", () => {
    const hours: RestrictionTimes = workingWeek(LONDON);

    expect(
      WorkingHours.moveToTimezone({
        hours,
        fromTimezone: LONDON,
        toTimezone: "Nowhere/Nothing",
      }),
    ).toBe(hours);
  });
});

describe("when paging starts, in words", () => {
  test("names the day of the week, the time and the zone", () => {
    expect(
      WorkingHours.describeMoment({
        at: at("2026-10-20 09:00:00", LONDON),
        timezone: LONDON,
        now: at("2026-10-20 02:00:00", LONDON),
      }),
    ).toBe("Tue 09:00 (Europe/London)");
  });

  test("a later day in the week is named by its day of the week alone", () => {
    expect(
      WorkingHours.describeMoment({
        at: at("2026-10-26 09:00:00", LONDON),
        timezone: LONDON,
        now: at("2026-10-23 18:00:00", LONDON),
      }),
    ).toBe("Mon 09:00 (Europe/London)");
  });

  test("a week or more away names its date, so the day of the week is not today's", () => {
    // Monday 09:30: the next Monday 09:00 is not this morning's.
    expect(
      WorkingHours.describeMoment({
        at: at("2026-10-26 09:00:00", LONDON),
        timezone: LONDON,
        now: at("2026-10-19 09:30:00", LONDON),
      }),
    ).toBe("Mon, Oct 26 09:00 (Europe/London)");
  });

  test("into another year within the week, still the day of the week alone", () => {
    expect(
      WorkingHours.describeMoment({
        at: at("2027-01-04 09:00:00", LONDON),
        timezone: LONDON,
        now: at("2026-12-31 22:00:00", LONDON),
      }),
    ).toBe("Mon 09:00 (Europe/London)");
  });

  test("a date in another year names the year", () => {
    expect(
      WorkingHours.describeMoment({
        at: at("2027-01-11 09:00:00", LONDON),
        timezone: LONDON,
        now: at("2026-12-31 22:00:00", LONDON),
      }),
    ).toBe("Mon, Jan 11, 2027 09:00 (Europe/London)");
  });

  test("is the day on the zone's clock, not UTC's", () => {
    // 23:30 UTC on Monday the 19th is Tuesday the 20th in Tokyo.
    expect(
      WorkingHours.describeMoment({
        at: new Date("2026-10-20T00:00:00Z"),
        timezone: "Asia/Tokyo",
        now: new Date("2026-10-19T23:30:00Z"),
      }),
    ).toBe("Tue 09:00 (Asia/Tokyo)");
  });

  test("with no zone OneUptime knows, is told in UTC", () => {
    expect(
      WorkingHours.describeMoment({
        at: new Date("2026-10-20T09:00:00Z"),
        timezone: "Nowhere/Nothing",
        now: new Date("2026-10-20T02:00:00Z"),
      }),
    ).toBe("Tue 09:00 (UTC)");
  });

  test("is in English whatever language moment was last set to", () => {
    moment.locale("de");

    try {
      expect(
        WorkingHours.describeMoment({
          at: at("2026-10-20 09:00:00", LONDON),
          timezone: LONDON,
          now: at("2026-10-20 02:00:00", LONDON),
        }),
      ).toBe("Tue 09:00 (Europe/London)");
    } finally {
      moment.locale("en");
    }
  });
});

describe("the same hours on the days picked", () => {
  test("Monday to Friday, 09:00 to 17:00, is the days and the two times", () => {
    expect(
      WorkingHours.toSimpleHours({
        hours: workingWeek(LONDON),
        timezone: LONDON,
      }),
    ).toEqual({ days: [0, 1, 2, 3, 4], from: "09:00", to: "17:00" });
  });

  test("the hours a rule starts with read back as Monday to Friday, 09:00 to 17:00", () => {
    expect(
      WorkingHours.toSimpleHours({
        hours: WorkingHours.getDefaultHours({ timezone: NEW_YORK }),
        timezone: NEW_YORK,
      }),
    ).toEqual({ days: [0, 1, 2, 3, 4], from: "09:00", to: "17:00" });
  });

  test("one window every day is every day", () => {
    expect(
      WorkingHours.toSimpleHours({
        hours: daily({ from: "08:30", to: "18:00", timezone: LONDON }),
        timezone: LONDON,
      }),
    ).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], from: "08:30", to: "18:00" });
  });

  test("hours that end the next morning are the days they begin on", () => {
    const nights: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Friday,
          from: "22:00",
          toDay: DayOfWeek.Saturday,
          to: "06:00",
        },
        {
          fromDay: DayOfWeek.Sunday,
          from: "22:00",
          toDay: DayOfWeek.Monday,
          to: "06:00",
        },
      ],
      LONDON,
    );

    expect(
      WorkingHours.toSimpleHours({ hours: nights, timezone: LONDON }),
    ).toEqual({ days: [4, 6], from: "22:00", to: "06:00" });
  });

  test("different hours on different days are not the same hours", () => {
    const shortFriday: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Thursday,
          from: "09:00",
          toDay: DayOfWeek.Thursday,
          to: "17:00",
        },
        {
          fromDay: DayOfWeek.Friday,
          from: "09:00",
          toDay: DayOfWeek.Friday,
          to: "15:00",
        },
      ],
      LONDON,
    );

    expect(
      WorkingHours.toSimpleHours({ hours: shortFriday, timezone: LONDON }),
    ).toBeNull();
  });

  test("hours over a weekend are not the same hours on each day", () => {
    const weekend: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Friday,
          from: "17:00",
          toDay: DayOfWeek.Monday,
          to: "09:00",
        },
      ],
      LONDON,
    );

    expect(
      WorkingHours.toSimpleHours({ hours: weekend, timezone: LONDON }),
    ).toBeNull();
  });

  test("hours that never open, or no zone, are not hours at all", () => {
    expect(
      WorkingHours.toSimpleHours({ hours: null, timezone: LONDON }),
    ).toBeNull();
    expect(
      WorkingHours.toSimpleHours({
        hours: workingWeek(LONDON),
        timezone: null,
      }),
    ).toBeNull();
  });

  test("are kept as one window a day on the zone's clock, and read back the same", () => {
    const tokyo: string = "Asia/Tokyo";
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [0, 2, 4],
      from: "08:30",
      to: "18:00",
      timezone: tokyo,
    });

    expect(hours.restictionType).toBe(RestrictionType.Weekly);
    expect(
      hours.weeklyRestrictionTimes.map((window: WeeklyResctriction): string => {
        return `${window.startDay} ${moment
          .tz(window.startTime, tokyo)
          .format("ddd HH:mm")}-${window.endDay} ${moment
          .tz(window.endTime, tokyo)
          .format("ddd HH:mm")}`;
      }),
    ).toEqual([
      "Monday Mon 08:30-Monday Mon 18:00",
      "Wednesday Wed 08:30-Wednesday Wed 18:00",
      "Friday Fri 08:30-Friday Fri 18:00",
    ]);
    expect(WorkingHours.getProblem({ hours, timezone: tokyo })).toBeNull();
    expect(WorkingHours.toSimpleHours({ hours, timezone: tokyo })).toEqual({
      days: [0, 2, 4],
      from: "08:30",
      to: "18:00",
    });
  });

  test("an end before the start is the next morning - Sunday night into Monday", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [6],
      from: "22:00",
      to: "06:00",
      timezone: LONDON,
    });

    expect(hours.weeklyRestrictionTimes[0]!.endDay).toBe(DayOfWeek.Monday);
    expect(
      onClock(
        nextStart(hours, LONDON, at("2026-10-25 12:00:00", LONDON)),
        LONDON,
      ),
    ).toBe("Sun 2026-10-25 22:00");
    expect(
      WorkingHours.isWithin({
        hours,
        timezone: LONDON,
        at: at("2026-10-26 05:59:00", LONDON),
      }),
    ).toBe(true);
    expect(
      WorkingHours.isWithin({
        hours,
        timezone: LONDON,
        at: at("2026-10-26 06:00:00", LONDON),
      }),
    ).toBe(false);
  });

  test("no day picked is refused as no hours; an end at the start, as hours that never open", () => {
    expect(
      WorkingHours.getProblem({
        hours: WorkingHours.fromSimpleHours({
          days: [],
          from: "09:00",
          to: "17:00",
          timezone: LONDON,
        }),
        timezone: LONDON,
      }),
    ).toBe(WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE);
    expect(
      WorkingHours.getProblem({
        hours: WorkingHours.fromSimpleHours({
          days: [0, 1],
          from: "09:00",
          to: "09:00",
          timezone: LONDON,
        }),
        timezone: LONDON,
      }),
    ).toBe(WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE);
  });

  test("days out of range, or twice, are left out", () => {
    const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
      days: [4, 0, 4, 9, -1],
      from: "09:00",
      to: "17:00",
      timezone: LONDON,
    });

    expect(
      hours.weeklyRestrictionTimes.map(
        (window: WeeklyResctriction): DayOfWeek => {
          return window.startDay;
        },
      ),
    ).toEqual([DayOfWeek.Monday, DayOfWeek.Friday]);
  });
});

describe("the same hours on the days picked, kept and read back", () => {
  const ZONES: Array<string> = [
    LONDON,
    NEW_YORK,
    "Asia/Kolkata",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "UTC",
  ];

  /*
   * Whatever days and times are picked, in whatever zone, the rule keeps
   * hours that read back as exactly what was picked.
   */
  test("read back as they were picked, in any zone, in any week", () => {
    const random: SeededRandom = seededRandom(20261020);

    for (let draw: number = 0; draw < 400; draw++) {
      const timezone: string = ZONES[random(ZONES.length)]!;
      const days: Array<number> = [0, 1, 2, 3, 4, 5, 6].filter(() => {
        return random(2) === 1;
      });
      const from: number = random(24 * 4) * 15;
      let to: number = random(24 * 4) * 15;

      if (to === from) {
        to = (from + 60) % (24 * 60);
      }

      const clock: (minute: number) => string = (minute: number): string => {
        return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
          minute % 60,
        ).padStart(2, "0")}`;
      };
      const picked: { days: Array<number>; from: string; to: string } = {
        days,
        from: clock(from),
        to: clock(to),
      };
      const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
        ...picked,
        timezone,
      });

      if (days.length === 0) {
        expect(WorkingHours.toSimpleHours({ hours, timezone })).toBeNull();
        continue;
      }

      expect(WorkingHours.toSimpleHours({ hours, timezone })).toEqual(picked);
      expect(WorkingHours.getProblem({ hours, timezone })).toBeNull();
    }
  });

  test("a time the clocks skip this week is kept as picked: 01:30 on Sunday in London", () => {
    // Picked on Sunday 29 March 2026, the morning London's clocks go forward.
    jest.useFakeTimers({ now: new Date("2026-03-29T00:30:00Z") });

    try {
      const hours: RestrictionTimes = WorkingHours.fromSimpleHours({
        days: [6],
        from: "01:30",
        to: "05:00",
        timezone: LONDON,
      });

      expect(WorkingHours.toSimpleHours({ hours, timezone: LONDON })).toEqual({
        days: [6],
        from: "01:30",
        to: "05:00",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("a stored time reads as its day and time of day on the zone's clock", () => {
    // 23:30 UTC on Monday 19 October is Tuesday 08:30 in Tokyo.
    expect(
      WorkingHours.readClock(new Date("2026-10-19T23:30:00Z"), "Asia/Tokyo"),
    ).toEqual({ day: 1, clock: "08:30" });
    expect(
      WorkingHours.readClock(
        new Date("2026-10-19T23:30:00Z"),
        "Nowhere/Nothing",
      ),
    ).toBeNull();
    expect(WorkingHours.readClock(null, LONDON)).toBeNull();
  });
});

describe("the hours, in as few groups as they allow", () => {
  test("days alike are one group, in the order the week opens them", () => {
    const hours: RestrictionTimes = weekly(
      [
        DayOfWeek.Monday,
        DayOfWeek.Tuesday,
        DayOfWeek.Wednesday,
        DayOfWeek.Thursday,
      ]
        .map((day: DayOfWeek): WeeklyWindow => {
          return { fromDay: day, from: "08:30", toDay: day, to: "18:00" };
        })
        .concat([
          {
            fromDay: DayOfWeek.Friday,
            from: "08:30",
            toDay: DayOfWeek.Friday,
            to: "15:00",
          },
        ]),
      LONDON,
    );

    expect(WorkingHours.getSpans({ hours, timezone: LONDON })).toEqual([
      { days: [0, 1, 2, 3], from: "08:30", to: "18:00", endsDaysLater: 0 },
      { days: [4], from: "08:30", to: "15:00", endsDaysLater: 0 },
    ]);
    expect(WorkingHours.getStartTime({ hours, timezone: LONDON })).toBe(
      "08:30",
    );
  });

  test("hours over a weekend end days later", () => {
    const hours: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Friday,
          from: "17:00",
          toDay: DayOfWeek.Monday,
          to: "09:00",
        },
      ],
      LONDON,
    );

    expect(WorkingHours.getSpans({ hours, timezone: LONDON })).toEqual([
      { days: [4], from: "17:00", to: "09:00", endsDaysLater: 3 },
    ]);
  });

  test("days that begin at different times have no one start time", () => {
    const hours: RestrictionTimes = weekly(
      [
        {
          fromDay: DayOfWeek.Monday,
          from: "09:00",
          toDay: DayOfWeek.Monday,
          to: "17:00",
        },
        {
          fromDay: DayOfWeek.Tuesday,
          from: "10:00",
          toDay: DayOfWeek.Tuesday,
          to: "17:00",
        },
      ],
      LONDON,
    );

    expect(WorkingHours.getStartTime({ hours, timezone: LONDON })).toBeNull();
  });

  test("hours that never open have no groups and no start", () => {
    expect(WorkingHours.getSpans({ hours: null, timezone: LONDON })).toEqual(
      [],
    );
    expect(
      WorkingHours.getStartTime({ hours: null, timezone: LONDON }),
    ).toBeNull();
  });

  test("a time is minutes after midnight; anything else is not a time", () => {
    expect(WorkingHours.parseClock("09:30")).toBe(570);
    expect(WorkingHours.parseClock("9:30")).toBe(570);
    expect(WorkingHours.parseClock("23:59")).toBe(1439);
    expect(WorkingHours.parseClock("24:00")).toBeNull();
    expect(WorkingHours.parseClock("9.30")).toBeNull();
    expect(WorkingHours.parseClock("")).toBeNull();
    expect(WorkingHours.parseClock(undefined)).toBeNull();
  });
});

/*
 * Whatever the moment, the start is the first moment from it that is inside
 * the hours: inside itself, and with nothing between the moment and it
 * inside. Every window here opens on the hour - on either side of a clock
 * change too - so a quarter-hour walk from the moment finds any earlier
 * opening. Moments are drawn across the year, both clock changes included,
 * in zones whose offsets differ.
 */
interface HoursCase {
  name: string;
  timezone: string;
  hours: RestrictionTimes;
}

describe("the next start is the first moment inside the hours", () => {
  const CASES: Array<HoursCase> = [
    {
      name: "a working week in London",
      timezone: LONDON,
      hours: workingWeek(LONDON),
    },
    {
      name: "a night window in New York",
      timezone: NEW_YORK,
      hours: daily({ from: "22:00", to: "06:00", timezone: NEW_YORK }),
    },
    {
      name: "a weekend window in Sydney",
      timezone: "Australia/Sydney",
      hours: weekly(
        [
          {
            fromDay: DayOfWeek.Friday,
            from: "20:00",
            toDay: DayOfWeek.Monday,
            to: "08:00",
          },
        ],
        "Australia/Sydney",
      ),
    },
  ];

  test.each(CASES)("$name", (testCase: HoursCase) => {
    const { timezone, hours } = testCase;
    const random: SeededRandom = seededRandom(20261020);
    const yearStart: number = new Date("2026-01-01T00:00:00Z").getTime();
    const year: number = 365 * 24 * 60;

    for (let sample: number = 0; sample < 12; sample++) {
      const raised: Date = new Date(yearStart + random(year) * 60_000);
      const start: Date | null = nextStart(hours, timezone, raised);

      expect(start).not.toBeNull();
      expect(start!.getTime()).toBeGreaterThanOrEqual(raised.getTime());
      expect(WorkingHours.isWithin({ hours, timezone, at: start! })).toBe(true);

      // No quarter hour before it, from the moment on, is inside.
      const quarterHour: number = 15 * 60_000;
      const firstStep: number =
        Math.ceil(raised.getTime() / quarterHour) * quarterHour;

      for (
        let step: number = firstStep;
        step < start!.getTime();
        step += quarterHour
      ) {
        expect(
          WorkingHours.isWithin({ hours, timezone, at: new Date(step) }),
        ).toBe(false);
      }
    }
  });
});
