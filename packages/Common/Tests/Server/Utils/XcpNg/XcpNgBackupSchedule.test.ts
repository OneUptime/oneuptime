import {
  XCP_NG_BACKUP_MIN_GRACE_SECONDS,
  XcpNgCronSpec,
  getXcpNgBackupGraceSeconds,
  getXcpNgBackupJobIntervalSeconds,
  isXcpNgVmBackupOverdue,
  listXcpNgScheduleRuns,
  parseXcpNgCron,
} from "../../../../Server/Utils/XcpNg/XcpNgBackupSchedule";
import { XcpNgBackupSchedule } from "../../../../Types/XcpNg/XcpNgPoolEvents";
import CronParser, { CronExpression } from "cron-parser";
import { describe, expect, test } from "@jest/globals";

/*
 * How late a VM's backup may be (XcpNgBackupSchedule): the longest gap
 * between two runs of its jobs' enabled schedules, in their zones - and
 * the grace on top of it. The runs are worked out without cron-parser (a
 * year of a nightly job took it seconds); they are held to cron-parser's
 * here, run for run.
 */

const HOUR: number = 3600;
const DAY: number = 24 * HOUR;
// Wednesday 18 November 2026, 11:06:40 UTC: the lab's clock.
const NOW: Date = new Date(1795000000 * 1000);

function schedule(
  cron: string,
  timezone?: string,
  enabled: boolean = true,
): XcpNgBackupSchedule {
  const entry: XcpNgBackupSchedule = {
    scheduleId: cron,
    cron: cron,
    enabled: enabled,
  };
  if (timezone) {
    entry.timezone = timezone;
  }
  return entry;
}

function interval(...schedules: Array<XcpNgBackupSchedule>): number | null {
  return getXcpNgBackupJobIntervalSeconds({ schedules: schedules, now: NOW });
}

describe("the interval of a job", () => {
  test("every night: a day", () => {
    expect(interval(schedule("0 10 * * *", "UTC"))).toBe(DAY);
  });

  test("weekdays only: the weekend's three days", () => {
    expect(interval(schedule("0 2 * * 1-5", "UTC"))).toBe(3 * DAY);
  });

  test("once a week, every hour, every minute", () => {
    expect(interval(schedule("0 11 * * 3", "UTC"))).toBe(7 * DAY);
    expect(interval(schedule("0 * * * *", "UTC"))).toBe(HOUR);
    expect(interval(schedule("* * * * *"))).toBe(60);
  });

  test("monthly: the longest month", () => {
    expect(interval(schedule("0 0 1 * *", "UTC"))).toBe(31 * DAY);
  });

  test("daylight saving's long night counts as it falls", () => {
    // Europe/Paris goes back an hour once a year: a 25-hour night.
    expect(interval(schedule("0 10 * * *", "Europe/Paris"))).toBe(DAY + HOUR);
  });

  test("several schedules of one job are read together", () => {
    expect(
      interval(schedule("0 10 * * *", "UTC"), schedule("0 22 * * *", "UTC")),
    ).toBe(12 * HOUR);
    // A frequent schedule beside a daily one: the frequent one decides.
    expect(
      interval(schedule("*/5 * * * *", "UTC"), schedule("0 10 * * *", "UTC")),
    ).toBe(5 * 60);
  });

  test("disabled, broken or absent schedules give no interval", () => {
    expect(interval(schedule("0 10 * * *", "UTC", false))).toBeNull();
    expect(interval(schedule("not a cron"))).toBeNull();
    expect(interval(schedule("0 10 * * *", "Not/AZone"))).toBeNull();
    expect(interval()).toBeNull();
    expect(
      interval(schedule("0 10 * * *", "UTC", false), schedule("nope")),
    ).toBeNull();
  });

  test("a broken schedule beside a good one leaves the good one's", () => {
    expect(interval(schedule("nope"), schedule("0 10 * * *", "UTC"))).toBe(DAY);
  });

  test("a schedule that runs once in the horizon has no gap to read", () => {
    expect(interval(schedule("0 0 29 2 *", "UTC"))).toBeNull();
  });
});

describe("overdue", () => {
  test("grace: a quarter of the interval, at least an hour", () => {
    expect(XCP_NG_BACKUP_MIN_GRACE_SECONDS).toBe(HOUR);
    expect(getXcpNgBackupGraceSeconds(DAY)).toBe(6 * HOUR);
    expect(getXcpNgBackupGraceSeconds(HOUR)).toBe(HOUR);
    expect(getXcpNgBackupGraceSeconds(7 * DAY)).toBe(42 * HOUR);
  });

  test("a nightly job's VM is overdue after 30 hours, not before", () => {
    const at: (hoursAgo: number) => Date = (hoursAgo: number): Date => {
      return new Date(NOW.getTime() - hoursAgo * HOUR * 1000);
    };
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: at(29),
        watchedSince: at(1000),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: at(30),
        watchedSince: at(1000),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: at(30.01),
        watchedSince: at(1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("with no success on record, the clock starts when OneUptime started reading", () => {
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: null,
        watchedSince: new Date(NOW.getTime() - 2 * HOUR * 1000),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: null,
        watchedSince: new Date(NOW.getTime() - 31 * HOUR * 1000),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: null,
        watchedSince: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a VM no scheduled job backs up is never overdue", () => {
    for (const intervalSeconds of [null, undefined, 0, -5, Number.NaN]) {
      expect(
        isXcpNgVmBackupOverdue({
          intervalSeconds: intervalSeconds,
          lastSuccessfulBackupAt: new Date(0),
          watchedSince: new Date(0),
          now: NOW,
        }),
      ).toBe(false);
    }
  });

  test("an invalid date is no reference", () => {
    expect(
      isXcpNgVmBackupOverdue({
        intervalSeconds: DAY,
        lastSuccessfulBackupAt: new Date("nope"),
        watchedSince: null,
        now: NOW,
      }),
    ).toBe(false);
  });
});

// cron-parser's runs of a cron after `now`, as the reference.
function cronParserRuns(
  cron: string,
  timezone: string | undefined,
  count: number,
): Array<number> {
  const expression: CronExpression = CronParser.parseExpression(cron, {
    currentDate: NOW,
    ...(timezone ? { tz: timezone } : {}),
  });
  const runs: Array<number> = [];
  while (runs.length < count) {
    runs.push(expression.next().toDate().getTime());
  }
  return runs;
}

function ownRuns(
  cron: string,
  timezone: string | undefined,
  count: number,
): Array<number> {
  const listed: { runs: Array<number>; reachedEnd: boolean } | null =
    listXcpNgScheduleRuns({
      cron: cron,
      timezone: timezone,
      nowMs: NOW.getTime(),
      // Far enough that `count` ends them, as it ends cron-parser's.
      horizonMs: 3650 * DAY * 1000,
      max: count,
    });
  expect([cron, listed]).toEqual([cron, expect.anything()]);
  return (listed as { runs: Array<number> }).runs;
}

describe("a schedule's runs, as cron-parser has them", () => {
  // Crons as Xen Orchestra's schedule editor writes them, and harder ones.
  const CRONS: Array<string> = [
    "0 10 * * *",
    "30 22 * * *",
    "0 2 * * 1-5",
    "0 11 * * 3",
    "*/15 * * * *",
    "0 */6 * * *",
    "5,35 8-18 * * *",
    "0 0 1 * *",
    "0 3 1,15 * *",
    "0 4 * * 0",
    "0 4 * * 7",
    "0 1 * * sun",
    "0 1 * jan,jul *",
    "15 3 * * MON-FRI",
    "0 0 13 * 5",
    "0 12 */2 * *",
    "10/20 * * * *",
    "0 9-17/2 * * 1-5",
    "0 0 31 * *",
    "0 6 * 2 *",
  ];

  test.each(CRONS)("%s in UTC: the same runs", (cron: string) => {
    expect(ownRuns(cron, "UTC", 60)).toEqual(cronParserRuns(cron, "UTC", 60));
  });

  test.each(["0 10 * * *", "0 2 * * 1-5", "*/30 * * * *", "0 0 1 * *"])(
    "%s in Asia/Kolkata and America/New_York: the same runs",
    (cron: string) => {
      for (const zone of ["Asia/Kolkata", "America/New_York"]) {
        expect([zone, ownRuns(cron, zone, 40)]).toEqual([
          zone,
          cronParserRuns(cron, zone, 40),
        ]);
      }
    },
  );

  test("across Europe/Paris's year of daylight saving, a nightly job's runs fall as cron-parser's", () => {
    // 400 nights: both of next year's changes of the clocks.
    expect(ownRuns("0 10 * * *", "Europe/Paris", 400)).toEqual(
      cronParserRuns("0 10 * * *", "Europe/Paris", 400),
    );
  });

  test("a whole year of a nightly job takes milliseconds, not seconds", () => {
    const startedAt: number = Date.now();
    for (let index: number = 0; index < 20; index++) {
      listXcpNgScheduleRuns({
        cron: "0 10 * * *",
        timezone: "Europe/Paris",
        nowMs: NOW.getTime() + index * HOUR * 1000,
      });
    }
    // Twenty years' worth in well under the two seconds one took before.
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("runs stop at the horizon, or at the most asked for", () => {
    const daily: { runs: Array<number>; reachedEnd: boolean } | null =
      listXcpNgScheduleRuns({
        cron: "0 10 * * *",
        nowMs: NOW.getTime(),
        horizonMs: 3 * DAY * 1000,
      });
    expect(daily).toEqual({
      runs: [1, 2, 3].map((days: number): number => {
        return Date.UTC(2026, 10, 18 + days, 10, 0);
      }),
      reachedEnd: true,
    });

    const minutely: { runs: Array<number>; reachedEnd: boolean } | null =
      listXcpNgScheduleRuns({
        cron: "* * * * *",
        nowMs: NOW.getTime(),
        max: 5,
      });
    expect(minutely?.runs).toHaveLength(5);
    expect(minutely?.reachedEnd).toBe(false);
    // Strictly after now: 11:06:40 is followed by 11:07.
    expect(minutely?.runs[0]).toBe(Date.UTC(2026, 10, 18, 11, 7));
  });
});

describe("reading a cron", () => {
  test("the five fields, with ranges, steps, lists and names", () => {
    const spec: XcpNgCronSpec | null = parseXcpNgCron(
      "5,10-20/5 */8 1 jan-mar mon,FRI",
    );
    expect(spec).toEqual({
      minutes: [5, 10, 15, 20],
      hours: [0, 8, 16],
      daysOfMonth: new Set<number>([1]),
      months: new Set<number>([1, 2, 3]),
      daysOfWeek: new Set<number>([1, 5]),
      anyDayOfMonth: false,
      anyDayOfWeek: false,
    });
    expect(parseXcpNgCron("0 0 * * 7")?.daysOfWeek).toEqual(
      new Set<number>([0]),
    );
    expect(parseXcpNgCron("0 0 * * 0-7")?.anyDayOfWeek).toBe(true);
    expect(parseXcpNgCron("  0   0 * * *  ")?.anyDayOfMonth).toBe(true);
  });

  test("what is not a five-field cron is not read", () => {
    for (const cron of [
      "",
      "not a cron",
      "0 0 * *",
      "0 0 0 * * *",
      "60 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * 32 * *",
      "* * * 13 *",
      "* * * * 8",
      "5-2 * * * *",
      "*/0 * * * *",
      "*/x * * * *",
      "1,,2 * * * *",
      "1/2/3 * * * *",
      "0 0 L * *",
      "0 0 ? * *",
      "0 0 * * 1#2",
      "0 0 * smarch *",
    ]) {
      expect([cron, parseXcpNgCron(cron)]).toEqual([cron, null]);
    }
  });

  test("an unknown zone gives no runs", () => {
    expect(
      listXcpNgScheduleRuns({
        cron: "0 10 * * *",
        timezone: "Not/AZone",
        nowMs: NOW.getTime(),
      }),
    ).toBeNull();
  });

  test("the same schedules in the same hour are worked out once, and changed ones again", () => {
    const nightly: Array<XcpNgBackupSchedule> = [schedule("0 10 * * *", "UTC")];
    const first: number | null = getXcpNgBackupJobIntervalSeconds({
      schedules: nightly,
      now: NOW,
    });
    const startedAt: number = Date.now();
    for (let index: number = 0; index < 1000; index++) {
      getXcpNgBackupJobIntervalSeconds({ schedules: nightly, now: NOW });
    }
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(first).toBe(DAY);
    expect(
      getXcpNgBackupJobIntervalSeconds({
        schedules: [schedule("0 10 * * 1-5", "UTC")],
        now: NOW,
      }),
    ).toBe(3 * DAY);
  });
});
