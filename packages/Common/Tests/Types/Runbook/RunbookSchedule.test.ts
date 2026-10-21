import {
  DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
  DEFAULT_RUNBOOK_SCHEDULE_CRON,
  RUNBOOK_SCHEDULE_DAY_ORDER,
  RUNBOOK_SCHEDULE_HOUR_INTERVALS,
  RUNBOOK_SCHEDULE_MAX_CRON_LENGTH,
  RUNBOOK_SCHEDULE_MINUTE_INTERVALS,
  RUNBOOK_SCHEDULE_REPEATS,
  RUNBOOK_SCHEDULE_WEEKDAYS,
  RUNBOOK_SCHEDULE_WEEKEND_DAYS,
  RunbookScheduleChoice,
  RunbookScheduleRepeat,
  getNextRunbookRun,
  getNextRunbookRuns,
  getRunbookScheduleChoice,
  getRunbookScheduleChoiceError,
  getRunbookScheduleCron,
  getRunbookScheduleCronError,
  isValidRunbookScheduleTimezone,
  normalizeRunbookScheduleCron,
} from "../../../Types/Runbook/RunbookSchedule";
import CronTab, { CronExpressionFields } from "../../../Utils/CronTab";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A runbook's schedule: the five plain choices the dialog offers and the
 * cron each stands for, what is refused, and when the schedule runs next on
 * the wall clock of its time zone - through daylight saving time changes,
 * whose two nights a year are where a scheduler double-starts or drops runs.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

const iso: (date: Date | null) => string | null = (
  date: Date | null,
): string | null => {
  return date ? date.toISOString() : null;
};

const choice: (
  overrides: Partial<RunbookScheduleChoice>,
) => RunbookScheduleChoice = (
  overrides: Partial<RunbookScheduleChoice>,
): RunbookScheduleChoice => {
  return {
    ...DEFAULT_RUNBOOK_SCHEDULE_CHOICE,
    days: [...DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days],
    ...overrides,
  };
};

const nextRuns: (data: {
  cron: string;
  timezone: string;
  after: string;
  count: number;
}) => Array<string> = (data: {
  cron: string;
  timezone: string;
  after: string;
  count: number;
}): Array<string> => {
  return getNextRunbookRuns({
    cron: data.cron,
    timezone: data.timezone,
    after: at(data.after),
    count: data.count,
  }).map((date: Date) => {
    return date.toISOString();
  });
};

// Whether the zone's wall clock at `instant` is a time the cron runs at.
const wallClockMatches: (
  fields: CronExpressionFields,
  timezone: string,
  instant: number,
) => boolean = (
  fields: CronExpressionFields,
  timezone: string,
  instant: number,
): boolean => {
  const wall: moment.Moment = moment.tz(instant, timezone);

  const dayOfMonthMatches: boolean = fields.dayOfMonth.values.includes(
    wall.date(),
  );
  const dayOfWeekMatches: boolean = fields.dayOfWeek.values.includes(
    wall.day(),
  );
  const dayMatches: boolean =
    !fields.dayOfMonth.isWildcard && !fields.dayOfWeek.isWildcard
      ? dayOfMonthMatches || dayOfWeekMatches
      : dayOfMonthMatches && dayOfWeekMatches;

  return (
    wall.seconds() === 0 &&
    fields.minute.values.includes(wall.minutes()) &&
    fields.hour.values.includes(wall.hours()) &&
    fields.month.values.includes(wall.month() + 1) &&
    dayMatches
  );
};

describe("the cron each choice stands for", () => {
  it("writes every few minutes as a step, and every minute as a bare star", () => {
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 1 }),
      ),
    ).toBe("* * * * *");
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 15 }),
      ),
    ).toBe("*/15 * * * *");
  });

  it("writes every few hours at a minute past the hour", () => {
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 1, minute: 0 }),
      ),
    ).toBe("0 * * * *");
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 6, minute: 30 }),
      ),
    ).toBe("30 */6 * * *");
  });

  it("writes a time of day, and the days of a week in order without repeats", () => {
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Daily, hour: 23, minute: 5 }),
      ),
    ).toBe("5 23 * * *");
    expect(
      getRunbookScheduleCron(
        choice({
          repeat: RunbookScheduleRepeat.Weekly,
          hour: 9,
          minute: 0,
          days: [5, 1, 3, 1],
        }),
      ),
    ).toBe("0 9 * * 1,3,5");
  });

  it("keeps a cron of your own as typed, with its fields one space apart", () => {
    expect(
      getRunbookScheduleCron(
        choice({ repeat: RunbookScheduleRepeat.Cron, cron: "  0  9 1 *   * " }),
      ),
    ).toBe("0 9 1 * *");
  });

  it("starts a new schedule at 09:00 on weekdays, and its cron says so", () => {
    expect(DEFAULT_RUNBOOK_SCHEDULE_CHOICE.repeat).toBe(
      RunbookScheduleRepeat.Weekly,
    );
    expect(DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days).toEqual([1, 2, 3, 4, 5]);
    expect(getRunbookScheduleCron(DEFAULT_RUNBOOK_SCHEDULE_CHOICE)).toBe(
      DEFAULT_RUNBOOK_SCHEDULE_CRON,
    );
    expect(getRunbookScheduleCronError(DEFAULT_RUNBOOK_SCHEDULE_CRON)).toBe(
      null,
    );
  });

  it("offers the five choices in the dialog's order, and steps that divide an hour and a day", () => {
    expect(RUNBOOK_SCHEDULE_REPEATS).toEqual([
      RunbookScheduleRepeat.Minutes,
      RunbookScheduleRepeat.Hours,
      RunbookScheduleRepeat.Daily,
      RunbookScheduleRepeat.Weekly,
      RunbookScheduleRepeat.Cron,
    ]);

    for (const every of RUNBOOK_SCHEDULE_MINUTE_INTERVALS) {
      expect(60 % every).toBe(0);
    }

    for (const every of RUNBOOK_SCHEDULE_HOUR_INTERVALS) {
      expect(24 % every).toBe(0);
    }

    expect(RUNBOOK_SCHEDULE_WEEKDAYS).toEqual([1, 2, 3, 4, 5]);
    expect(RUNBOOK_SCHEDULE_WEEKEND_DAYS).toEqual([0, 6]);
    expect([...RUNBOOK_SCHEDULE_DAY_ORDER].sort()).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(RUNBOOK_SCHEDULE_DAY_ORDER[0]).toBe(1);
  });
});

describe("the choice a cron came from", () => {
  it("gives back every plain choice it was written from", () => {
    const choices: Array<RunbookScheduleChoice> = [];

    for (const every of RUNBOOK_SCHEDULE_MINUTE_INTERVALS) {
      choices.push(choice({ repeat: RunbookScheduleRepeat.Minutes, every }));
    }

    for (const every of RUNBOOK_SCHEDULE_HOUR_INTERVALS) {
      for (const minute of [0, 1, 30, 59]) {
        choices.push(
          choice({ repeat: RunbookScheduleRepeat.Hours, every, minute }),
        );
      }
    }

    for (const [hour, minute] of [
      [0, 0],
      [9, 0],
      [9, 30],
      [23, 59],
    ] as Array<[number, number]>) {
      choices.push(
        choice({ repeat: RunbookScheduleRepeat.Daily, hour, minute }),
      );

      for (const days of [
        [1, 2, 3, 4, 5],
        [0, 6],
        [3],
        [0, 1, 2, 3, 4, 5, 6],
      ]) {
        choices.push(
          choice({ repeat: RunbookScheduleRepeat.Weekly, hour, minute, days }),
        );
      }
    }

    for (const original of choices) {
      const cron: string = getRunbookScheduleCron(original);
      const back: RunbookScheduleChoice = getRunbookScheduleChoice(cron);

      expect(back.repeat).toBe(original.repeat);
      expect(getRunbookScheduleCron(back)).toBe(cron);

      if (original.repeat === RunbookScheduleRepeat.Minutes) {
        expect(back.every).toBe(original.every);
      }

      if (original.repeat === RunbookScheduleRepeat.Hours) {
        expect([back.every, back.minute]).toEqual([
          original.every,
          original.minute,
        ]);
      }

      if (
        original.repeat === RunbookScheduleRepeat.Daily ||
        original.repeat === RunbookScheduleRepeat.Weekly
      ) {
        expect([back.hour, back.minute]).toEqual([
          original.hour,
          original.minute,
        ]);
      }

      if (original.repeat === RunbookScheduleRepeat.Weekly) {
        expect(back.days).toEqual(original.days);
      }
    }
  });

  it("reads the other ways of writing the same schedule as the plain choice", () => {
    expect(getRunbookScheduleChoice("*/1 * * * *")).toMatchObject({
      repeat: RunbookScheduleRepeat.Minutes,
      every: 1,
    });
    expect(getRunbookScheduleChoice("0 */1 * * *")).toMatchObject({
      repeat: RunbookScheduleRepeat.Hours,
      every: 1,
      minute: 0,
    });
    expect(getRunbookScheduleChoice("0 9 * * 1-5")).toMatchObject({
      repeat: RunbookScheduleRepeat.Weekly,
      hour: 9,
      minute: 0,
      days: [1, 2, 3, 4, 5],
    });
    expect(getRunbookScheduleChoice("0 9 * * MON-FRI")).toMatchObject({
      repeat: RunbookScheduleRepeat.Weekly,
      days: [1, 2, 3, 4, 5],
    });
    // 7 is Sunday too.
    expect(getRunbookScheduleChoice("15 8 * * 6,7")).toMatchObject({
      repeat: RunbookScheduleRepeat.Weekly,
      hour: 8,
      minute: 15,
      days: [0, 6],
    });
  });

  it("opens a cron no plain choice writes as a cron of your own, as typed", () => {
    for (const cron of [
      "0 9 1 * *",
      "*/7 * * * *",
      "0 1-23/2 * * *",
      "*/45 * * * *",
      "0,30 9 * * *",
      "0 9-17 * * 1-5",
      "0 */5 * * *",
      "0 0 1 1 *",
      "0 9 * 1 *",
      "* 9 * * *",
      "0 0 9 * * *",
      "not a cron",
      "",
    ]) {
      const back: RunbookScheduleChoice = getRunbookScheduleChoice(cron);

      expect(back.repeat).toBe(RunbookScheduleRepeat.Cron);
      expect(back.cron).toBe(normalizeRunbookScheduleCron(cron));
    }
  });

  it("keeps the rest of the choice at its defaults, so switching choices in the dialog starts somewhere sensible", () => {
    const back: RunbookScheduleChoice =
      getRunbookScheduleChoice("*/10 * * * *");

    expect(back.hour).toBe(DEFAULT_RUNBOOK_SCHEDULE_CHOICE.hour);
    expect(back.days).toEqual(DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days);
    expect(back.days).not.toBe(DEFAULT_RUNBOOK_SCHEDULE_CHOICE.days);
  });
});

describe("what a schedule refuses", () => {
  it("asks for a cron when there is none", () => {
    for (const cron of ["", "   ", undefined, null, 42]) {
      expect(getRunbookScheduleCronError(cron)).toBe(
        'Enter a cron expression, such as "0 9 * * 1-5" (09:00 on weekdays).',
      );
    }
  });

  it("refuses a cron longer than anyone writes", () => {
    const cron: string = `0 9 * * ${"1,".repeat(RUNBOOK_SCHEDULE_MAX_CRON_LENGTH)}1`;

    expect(getRunbookScheduleCronError(cron)).toBe(
      `A cron expression is at most ${RUNBOOK_SCHEDULE_MAX_CRON_LENGTH} characters long.`,
    );
  });

  it("refuses a seconds field and a missing field, saying there are five", () => {
    expect(getRunbookScheduleCronError("0 0 9 * * *")).toContain(
      "this one has 6",
    );
    expect(getRunbookScheduleCronError("0 9 * *")).toContain("this one has 4");
    expect(getRunbookScheduleCronError("0 9 * *")).toContain(
      "minute, hour, day of month, month and day of week",
    );
  });

  it("refuses a field out of range in the cron parser's words", () => {
    expect(getRunbookScheduleCronError("61 9 * * *")).toBe(
      CronTab.getValidationError("61 9 * * *"),
    );
    expect(getRunbookScheduleCronError("0 25 * * *")).toContain("hour");
  });

  it("refuses a schedule no date matches", () => {
    expect(getRunbookScheduleCronError("0 0 31 2 *")).toBe(
      "This schedule never runs: no date matches it, such as the 31st of February.",
    );
    expect(getRunbookScheduleCronError("0 0 30 2 *")).not.toBe(null);
  });

  it("takes a schedule that runs rarely, such as the 29th of February", () => {
    expect(getRunbookScheduleCronError("0 12 29 2 *")).toBe(null);
  });

  it("checks each plain choice's own fields", () => {
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 7 }),
      ),
    ).toContain("minutes apart");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Minutes, every: 15 }),
      ),
    ).toBe(null);
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 5 }),
      ),
    ).toContain("hours apart");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Hours, every: 2, minute: 60 }),
      ),
    ).toBe("Pick the minute past the hour, from 0 to 59.");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Daily, hour: 24 }),
      ),
    ).toBe("Pick the time of day the runbook runs at.");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Daily, minute: 1.5 }),
      ),
    ).toBe("Pick the time of day the runbook runs at.");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Weekly, days: [] }),
      ),
    ).toBe("Pick at least one day.");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Weekly, days: [9] }),
      ),
    ).toBe("Pick at least one day.");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: RunbookScheduleRepeat.Cron, cron: "0 0 31 2 *" }),
      ),
    ).toContain("never runs");
    expect(
      getRunbookScheduleChoiceError(
        choice({ repeat: "Monthly" as RunbookScheduleRepeat }),
      ),
    ).toBe("Pick how often the runbook runs.");
  });

  it("knows a time zone from a word", () => {
    for (const timezone of [
      "UTC",
      "Europe/London",
      "America/New_York",
      "Asia/Kolkata",
      "Australia/Lord_Howe",
      " Europe/Berlin ",
    ]) {
      expect(isValidRunbookScheduleTimezone(timezone)).toBe(true);
    }

    for (const timezone of [
      "",
      "Mars/Olympus_Mons",
      "Europe/Londonn",
      "GMT+25",
      undefined,
      null,
      12,
    ]) {
      expect(isValidRunbookScheduleTimezone(timezone)).toBe(false);
    }
  });
});

describe("when the schedule runs next", () => {
  it("runs every few minutes from the top of the hour, strictly after the moment asked about", () => {
    expect(
      nextRuns({
        cron: "*/15 * * * *",
        timezone: "UTC",
        after: "2026-10-15T09:07:30.000Z",
        count: 3,
      }),
    ).toEqual([
      "2026-10-15T09:15:00.000Z",
      "2026-10-15T09:30:00.000Z",
      "2026-10-15T09:45:00.000Z",
    ]);

    expect(
      iso(
        getNextRunbookRun({
          cron: "*/15 * * * *",
          timezone: "UTC",
          after: at("2026-10-15T09:15:00.000Z"),
        }),
      ),
    ).toBe("2026-10-15T09:30:00.000Z");
  });

  it("runs every minute on the next whole minute", () => {
    expect(
      iso(
        getNextRunbookRun({
          cron: "* * * * *",
          timezone: "Europe/London",
          after: at("2026-10-15T09:07:59.999Z"),
        }),
      ),
    ).toBe("2026-10-15T09:08:00.000Z");
  });

  it("reads 09:00 on the time zone's own clock, winter and summer", () => {
    // London is on GMT in January and on BST (UTC+1) in July.
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * *",
          timezone: "Europe/London",
          after: at("2026-01-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-01-15T09:00:00.000Z");
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * *",
          timezone: "Europe/London",
          after: at("2026-07-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-07-15T08:00:00.000Z");

    // New York: EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: at("2026-01-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-01-15T14:00:00.000Z");
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * *",
          timezone: "America/New_York",
          after: at("2026-07-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("reads zones whose offset is not whole hours", () => {
    // India is UTC+05:30 and Nepal UTC+05:45, all year.
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * *",
          timezone: "Asia/Kolkata",
          after: at("2026-10-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-10-15T03:30:00.000Z");
    expect(
      nextRuns({
        cron: "*/30 * * * *",
        timezone: "Asia/Kathmandu",
        after: "2026-10-15T00:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-10-15T00:15:00.000Z", "2026-10-15T00:45:00.000Z"]);
  });

  it("takes the day of the week on the zone's clock, not UTC's", () => {
    /*
     * 2026-10-16 is a Friday. At 23:30 UTC on Thursday it is already Friday
     * 09:30 in Sydney (UTC+11 in October), past 09:00, so the next weekday
     * 09:00 there is Monday's: Sunday 22:00 UTC.
     */
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 9 * * 1-5",
          timezone: "Australia/Sydney",
          after: at("2026-10-15T23:30:00.000Z"),
        }),
      ),
    ).toBe("2026-10-18T22:00:00.000Z");
  });

  it("skips from Friday to Monday for a weekday schedule", () => {
    expect(
      nextRuns({
        cron: "0 9 * * 1,2,3,4,5",
        timezone: "UTC",
        after: "2026-10-16T10:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-10-19T09:00:00.000Z", "2026-10-20T09:00:00.000Z"]);
  });

  it("runs on either day when both day of month and day of week are given, as cron does", () => {
    // The 1st of each month, or any Monday: 2026-11-01 is a Sunday.
    expect(
      nextRuns({
        cron: "0 6 1 * 1",
        timezone: "UTC",
        after: "2026-10-27T00:00:00.000Z",
        count: 3,
      }),
    ).toEqual([
      "2026-11-01T06:00:00.000Z",
      "2026-11-02T06:00:00.000Z",
      "2026-11-09T06:00:00.000Z",
    ]);
  });

  it("finds the 29th of February years ahead, and nothing for a date that never comes", () => {
    expect(
      iso(
        getNextRunbookRun({
          cron: "0 12 29 2 *",
          timezone: "UTC",
          after: at("2026-10-15T00:00:00.000Z"),
        }),
      ),
    ).toBe("2028-02-29T12:00:00.000Z");
    expect(
      getNextRunbookRun({
        cron: "0 0 31 2 *",
        timezone: "UTC",
        after: at("2026-10-15T00:00:00.000Z"),
      }),
    ).toBe(null);
    expect(
      getNextRunbookRuns({
        cron: "0 0 31 2 *",
        timezone: "UTC",
        after: at("2026-10-15T00:00:00.000Z"),
        count: 3,
      }),
    ).toEqual([]);
  });

  it("refuses a time zone it does not know and a seconds field", () => {
    expect(() => {
      getNextRunbookRun({
        cron: "0 9 * * *",
        timezone: "Mars/Olympus_Mons",
        after: at("2026-10-15T00:00:00.000Z"),
      });
    }).toThrow('"Mars/Olympus_Mons" is not a time zone.');
    expect(() => {
      getNextRunbookRun({
        cron: "0 0 9 * * *",
        timezone: "UTC",
        after: at("2026-10-15T00:00:00.000Z"),
      });
    }).toThrow("five fields");
  });
});

describe("daylight saving time", () => {
  /*
   * Berlin goes forward at 02:00 CET (01:00 UTC) on 2026-03-29 - the wall
   * clock jumps from 02:00 to 03:00 - and back at 03:00 CEST (01:00 UTC) on
   * 2026-10-25, so 02:00-02:59 comes round twice.
   */
  const ZONE: string = "Europe/Berlin";

  it("runs a time the clocks skip once, as late as the jump made it", () => {
    expect(
      nextRuns({
        cron: "30 2 * * *",
        timezone: ZONE,
        after: "2026-03-28T12:00:00.000Z",
        count: 2,
      }),
    ).toEqual([
      // 03:30 CEST: 02:30 never came.
      "2026-03-29T01:30:00.000Z",
      // 02:30 CEST the next night.
      "2026-03-30T00:30:00.000Z",
    ]);
  });

  it("runs a time the clocks pass twice only the first time", () => {
    expect(
      nextRuns({
        cron: "30 2 * * *",
        timezone: ZONE,
        after: "2026-10-24T12:00:00.000Z",
        count: 2,
      }),
    ).toEqual([
      // 02:30 CEST, the first time round.
      "2026-10-25T00:30:00.000Z",
      // Not 02:30 CET an hour later: 02:30 CET the next night.
      "2026-10-26T01:30:00.000Z",
    ]);
  });

  it("keeps a 09:00 schedule at 09:00 on both sides of each change", () => {
    expect(
      nextRuns({
        cron: "0 9 * * *",
        timezone: ZONE,
        after: "2026-03-28T00:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z"]);
    expect(
      nextRuns({
        cron: "0 9 * * *",
        timezone: ZONE,
        after: "2026-10-24T00:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z"]);
  });

  type SpacingCase = {
    name: string;
    cron: string;
    after: string;
    until: string;
    spacingInMs: number;
  };

  const SPACING_CASES: Array<SpacingCase> = [
    {
      name: "every 15 minutes through the hour the clocks skip",
      cron: "*/15 * * * *",
      after: "2026-03-28T23:00:00.000Z",
      until: "2026-03-29T03:00:00.000Z",
      spacingInMs: 15 * MINUTE,
    },
    {
      name: "every 15 minutes through the hour that comes round twice",
      cron: "*/15 * * * *",
      after: "2026-10-24T23:00:00.000Z",
      until: "2026-10-25T03:00:00.000Z",
      spacingInMs: 15 * MINUTE,
    },
    {
      name: "every hour at :30 through the hour the clocks skip",
      cron: "30 * * * *",
      after: "2026-03-28T22:00:00.000Z",
      until: "2026-03-29T04:00:00.000Z",
      spacingInMs: HOUR,
    },
    {
      name: "every hour at :30 through the hour that comes round twice",
      cron: "30 * * * *",
      after: "2026-10-24T22:00:00.000Z",
      until: "2026-10-25T04:00:00.000Z",
      spacingInMs: HOUR,
    },
    {
      name: "every minute through the hour that comes round twice",
      cron: "* * * * *",
      after: "2026-10-25T00:50:00.000Z",
      until: "2026-10-25T01:10:00.000Z",
      spacingInMs: MINUTE,
    },
  ];

  for (const spacingCase of SPACING_CASES) {
    it(`keeps a schedule that runs every hour evenly spaced in real time: ${spacingCase.name}`, () => {
      const runs: Array<Date> = getNextRunbookRuns({
        cron: spacingCase.cron,
        timezone: ZONE,
        after: at(spacingCase.after),
        count: 500,
      }).filter((run: Date) => {
        return run.getTime() <= at(spacingCase.until).getTime();
      });

      expect(runs.length).toBeGreaterThan(3);

      for (let i: number = 1; i < runs.length; i++) {
        expect(runs[i]!.getTime() - runs[i - 1]!.getTime()).toBe(
          spacingCase.spacingInMs,
        );
      }
    });
  }

  it("does the same for a zone whose clocks move by half an hour", () => {
    // Lord Howe Island moves from UTC+10:30 to UTC+11 on 2026-10-04.
    const runs: Array<Date> = getNextRunbookRuns({
      cron: "*/30 * * * *",
      timezone: "Australia/Lord_Howe",
      after: at("2026-10-03T13:00:00.000Z"),
      count: 12,
    });

    for (let i: number = 1; i < runs.length; i++) {
      expect(runs[i]!.getTime() - runs[i - 1]!.getTime()).toBe(30 * MINUTE);
    }
  });
});

describe("the next runs agree with the cron, minute by minute", () => {
  /*
   * In weeks with no clock change, the runs are exactly the minutes whose
   * wall-clock time the cron matches: none missed, none extra. Choices and
   * zones are drawn from a seeded stream, so a failure can be run again.
   */
  const ZONES: Array<{ timezone: string; weekStart: string }> = [
    { timezone: "UTC", weekStart: "2026-10-12T00:00:00.000Z" },
    { timezone: "Asia/Kolkata", weekStart: "2026-10-12T00:00:00.000Z" },
    { timezone: "Asia/Tokyo", weekStart: "2026-10-12T00:00:00.000Z" },
    { timezone: "America/New_York", weekStart: "2026-01-12T00:00:00.000Z" },
    { timezone: "Europe/London", weekStart: "2026-07-13T00:00:00.000Z" },
    { timezone: "Australia/Sydney", weekStart: "2026-01-12T00:00:00.000Z" },
  ];

  const drawChoice: (random: SeededRandom) => RunbookScheduleChoice = (
    random: SeededRandom,
  ): RunbookScheduleChoice => {
    const repeat: RunbookScheduleRepeat = [
      RunbookScheduleRepeat.Minutes,
      RunbookScheduleRepeat.Hours,
      RunbookScheduleRepeat.Daily,
      RunbookScheduleRepeat.Weekly,
    ][random(4)]!;

    const days: Array<number> = [0, 1, 2, 3, 4, 5, 6].filter(() => {
      return random(2) === 1;
    });

    return choice({
      repeat,
      every:
        repeat === RunbookScheduleRepeat.Minutes
          ? RUNBOOK_SCHEDULE_MINUTE_INTERVALS[
              random(RUNBOOK_SCHEDULE_MINUTE_INTERVALS.length)
            ]!
          : RUNBOOK_SCHEDULE_HOUR_INTERVALS[
              random(RUNBOOK_SCHEDULE_HOUR_INTERVALS.length)
            ]!,
      minute: random(60),
      hour: random(24),
      days: days.length > 0 ? days : [random(7)],
    });
  };

  it("for every drawn schedule and zone", () => {
    const random: SeededRandom = seededRandom(20261015);

    for (let round: number = 0; round < 36; round++) {
      const drawn: RunbookScheduleChoice = drawChoice(random);
      const cron: string = getRunbookScheduleCron(drawn);
      const zone: { timezone: string; weekStart: string } =
        ZONES[random(ZONES.length)]!;
      const fields: CronExpressionFields = CronTab.parseFields(cron);

      const start: number = at(zone.weekStart).getTime();
      // Two days for the frequent ones, a week for the rest.
      const windowInMs: number =
        drawn.repeat === RunbookScheduleRepeat.Minutes ||
        drawn.repeat === RunbookScheduleRepeat.Hours
          ? 2 * 24 * HOUR
          : 7 * 24 * HOUR;
      const end: number = start + windowInMs;

      const expected: Array<number> = [];

      for (
        let instant: number = start + MINUTE;
        instant <= end;
        instant += MINUTE
      ) {
        if (wallClockMatches(fields, zone.timezone, instant)) {
          expected.push(instant);
        }
      }

      const actual: Array<number> = getNextRunbookRuns({
        cron,
        timezone: zone.timezone,
        after: new Date(start),
        count: expected.length + 1,
      })
        .map((date: Date) => {
          return date.getTime();
        })
        .filter((instant: number) => {
          return instant <= end;
        });

      expect({ cron, timezone: zone.timezone, runs: actual }).toEqual({
        cron,
        timezone: zone.timezone,
        runs: expected,
      });
    }
  });
});
