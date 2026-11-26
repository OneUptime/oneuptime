import {
  XCP_NG_BACKUP_MIN_GRACE_SECONDS,
  getXcpNgBackupGraceSeconds,
  getXcpNgBackupJobIntervalSeconds,
  isXcpNgVmBackupOverdue,
} from "../../../../Server/Utils/XcpNg/XcpNgBackupSchedule";
import { XcpNgBackupSchedule } from "../../../../Types/XcpNg/XcpNgPoolEvents";
import { describe, expect, test } from "@jest/globals";

/*
 * How late a VM's backup may be (XcpNgBackupSchedule): the longest gap
 * between two runs of its jobs' enabled schedules, in their zones, read
 * with cron-parser - and the grace on top of it.
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
