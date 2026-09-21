import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import CronTab from "../../../Utils/CronTab";
import MonitorCheckScheduleUtil, {
  MonitorCheckFreshness,
  MonitorCheckFreshnessResult,
} from "../../../Utils/Monitor/MonitorCheckScheduleUtil";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * "Last checked 20 minutes ago" is only alarming if the monitor was meant to
 * run every 5 minutes. These pin how the overview reads the cadence (the same
 * way the scheduler does) and when it calls a check overdue.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const freshness: (data: {
  isScheduled?: boolean;
  isKnown?: boolean;
  lastResultAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  cadenceSeconds?: number;
  createdAt?: Date | undefined;
}) => MonitorCheckFreshnessResult = (data: {
  isScheduled?: boolean;
  isKnown?: boolean;
  lastResultAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  cadenceSeconds?: number;
  createdAt?: Date | undefined;
}): MonitorCheckFreshnessResult => {
  return MonitorCheckScheduleUtil.getCheckFreshness({
    isScheduled: data.isScheduled ?? true,
    isKnown: data.isKnown ?? true,
    lastResultAt: data.lastResultAt,
    nextCheckAt: data.nextCheckAt,
    cadenceSeconds: data.cadenceSeconds ?? 300,
    createdAt: data.createdAt,
    now: NOW,
  });
};

describe("MonitorCheckScheduleUtil cadence", () => {
  it("cadence of */5 is 300 and of * * * * * is 60", () => {
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "*/5 * * * *",
        from: NOW,
      }),
    ).toBe(300);
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "* * * * *",
        from: NOW,
      }),
    ).toBe(60);
  });

  it("a custom cron gets its real cadence", () => {
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "0 */6 * * *",
        from: NOW,
      }),
    ).toBe(6 * 3600);
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "30 2 * * *",
        from: NOW,
      }),
    ).toBe(86400);
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "*/15 * * * *",
        from: NOW,
      }),
    ).toBe(900);
  });

  it('empty, garbage and legacy "5m" values resolve like the server (null or normalised, fallback 60)', () => {
    for (const unreadable of [undefined, null, "", "   ", "whenever"]) {
      expect(
        MonitorCheckScheduleUtil.getCadenceSeconds({
          monitoringInterval: unreadable,
          from: NOW,
        }),
      ).toBeNull();
      expect(
        MonitorCheckScheduleUtil.resolveCadenceSeconds({
          monitoringInterval: unreadable,
          from: NOW,
        }),
      ).toBe(60);
    }

    // Legacy human cadences are read the way the scheduler reads them.
    expect(
      MonitorCheckScheduleUtil.resolveCadenceSeconds({
        monitoringInterval: "5m",
        from: NOW,
      }),
    ).toBe(300);
    expect(
      MonitorCheckScheduleUtil.resolveCadenceSeconds({
        monitoringInterval: "Every 10 minutes",
        from: NOW,
      }),
    ).toBe(600);
    expect(MonitorCheckScheduleUtil.DEFAULT_CADENCE_SECONDS).toBe(60);
  });

  it('describeInterval falls back to "Every minute"', () => {
    expect(MonitorCheckScheduleUtil.describeInterval(undefined)).toBe(
      "Every minute",
    );
    expect(MonitorCheckScheduleUtil.describeInterval("")).toBe("Every minute");
    expect(MonitorCheckScheduleUtil.describeInterval("whenever")).toBe(
      "Every minute",
    );
  });

  it("describeInterval describes readable schedules, legacy values included", () => {
    expect(MonitorCheckScheduleUtil.describeInterval("*/5 * * * *")).toBe(
      "Every 5 minutes",
    );
    expect(MonitorCheckScheduleUtil.describeInterval("5m")).toBe(
      "Every 5 minutes",
    );
    expect(MonitorCheckScheduleUtil.describeInterval("* * * * *")).toBe(
      "Every minute",
    );
    expect(MonitorCheckScheduleUtil.describeInterval("0 */6 * * *")).toBe(
      "Every 6 hours",
    );
  });

  it("grace is max(300, 2 × cadence)", () => {
    expect(MonitorCheckScheduleUtil.getGraceSeconds(60)).toBe(300);
    expect(MonitorCheckScheduleUtil.getGraceSeconds(150)).toBe(300);
    expect(MonitorCheckScheduleUtil.getGraceSeconds(300)).toBe(600);
    expect(MonitorCheckScheduleUtil.getGraceSeconds(3600)).toBe(7200);
    expect(MonitorCheckScheduleUtil.getGraceSeconds(Number.NaN)).toBe(300);
  });
});

describe("MonitorCheckScheduleUtil.getCheckFreshness", () => {
  it("fresh", () => {
    expect(
      freshness({
        lastResultAt: secondsAgo(200),
        nextCheckAt: secondsAgo(-100),
      }),
    ).toEqual({
      freshness: MonitorCheckFreshness.Fresh,
      overdueSeconds: null,
      resultAgeSeconds: 200,
    });
  });

  it("fresh right up to cadence plus grace", () => {
    // Every 5 minutes: 300 + 600 grace.
    expect(freshness({ lastResultAt: secondsAgo(900) }).freshness).toBe(
      MonitorCheckFreshness.Fresh,
    );
    expect(freshness({ lastResultAt: secondsAgo(901) }).freshness).toBe(
      MonitorCheckFreshness.Stale,
    );
  });

  it("stale by result age", () => {
    expect(freshness({ lastResultAt: secondsAgo(1000) })).toEqual({
      freshness: MonitorCheckFreshness.Stale,
      overdueSeconds: 700,
      resultAgeSeconds: 1000,
    });
  });

  it("stale by overdue next check", () => {
    // Hourly: the last result is recent enough, but the next run is 2h+ late.
    expect(
      freshness({
        cadenceSeconds: 3600,
        lastResultAt: secondsAgo(3000),
        nextCheckAt: secondsAgo(7300),
      }),
    ).toEqual({
      freshness: MonitorCheckFreshness.Stale,
      overdueSeconds: 7300,
      resultAgeSeconds: 3000,
    });

    // Inside the grace it is still fresh.
    expect(
      freshness({
        cadenceSeconds: 3600,
        lastResultAt: secondsAgo(3000),
        nextCheckAt: secondsAgo(7100),
      }).freshness,
    ).toBe(MonitorCheckFreshness.Fresh);
  });

  it("awaiting inside grace", () => {
    expect(freshness({ createdAt: secondsAgo(600) })).toEqual({
      freshness: MonitorCheckFreshness.AwaitingFirstResult,
      overdueSeconds: null,
      resultAgeSeconds: null,
    });
    // With no creation time there is nothing to call it late against.
    expect(freshness({}).freshness).toBe(
      MonitorCheckFreshness.AwaitingFirstResult,
    );
  });

  it("stale when never reported after grace", () => {
    expect(freshness({ createdAt: secondsAgo(3600) })).toEqual({
      freshness: MonitorCheckFreshness.Stale,
      overdueSeconds: 3300,
      resultAgeSeconds: null,
    });
  });

  it("not scheduled", () => {
    expect(
      freshness({ isScheduled: false, lastResultAt: secondsAgo(86400) }),
    ).toEqual({
      freshness: MonitorCheckFreshness.NotScheduled,
      overdueSeconds: null,
      resultAgeSeconds: 86400,
    });
  });

  it("unknown", () => {
    expect(
      freshness({ isKnown: false, createdAt: secondsAgo(86400) }).freshness,
    ).toBe(MonitorCheckFreshness.Unknown);
  });

  it("not scheduled wins over unknown", () => {
    expect(freshness({ isScheduled: false, isKnown: false }).freshness).toBe(
      MonitorCheckFreshness.NotScheduled,
    );
  });

  it("a future monitoredAt counts as age 0", () => {
    expect(freshness({ lastResultAt: secondsAgo(-120) })).toEqual({
      freshness: MonitorCheckFreshness.Fresh,
      overdueSeconds: null,
      resultAgeSeconds: 0,
    });
  });
});

describe("MonitorCheckScheduleUtil schedules with gaps", () => {
  // Every 5 minutes, 09:00 to 17:55 UTC, Monday to Friday.
  const BUSINESS_HOURS: string = "*/5 9-17 * * 1-5";
  // The last check of the week: Friday 18 September 2026, 17:55 UTC.
  const FRIDAY_LAST_RUN: Date = new Date("2026-09-18T17:55:00.000Z");

  const judge: (data: {
    now: string;
    lastResultAt?: Date | undefined;
    createdAt?: Date | undefined;
    monitoringInterval?: string | undefined;
  }) => MonitorCheckFreshnessResult = (data: {
    now: string;
    lastResultAt?: Date | undefined;
    createdAt?: Date | undefined;
    monitoringInterval?: string | undefined;
  }): MonitorCheckFreshnessResult => {
    const now: Date = new Date(data.now);

    return MonitorCheckScheduleUtil.getCheckFreshness({
      isScheduled: true,
      isKnown: true,
      lastResultAt: data.lastResultAt,
      nextCheckAt: undefined,
      // What a caller measures around "now": still five minutes at night.
      cadenceSeconds: MonitorCheckScheduleUtil.resolveCadenceSeconds({
        monitoringInterval: data.monitoringInterval,
        from: now,
      }),
      createdAt: data.createdAt,
      now: now,
      monitoringInterval: data.monitoringInterval,
    });
  };

  it("the next run after a time, and the spacing there", () => {
    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: BUSINESS_HOURS,
        after: FRIDAY_LAST_RUN,
      }),
    ).toEqual({
      runAt: new Date("2026-09-21T09:00:00.000Z"),
      spacingSeconds: 300,
    });
    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: "whenever",
        after: FRIDAY_LAST_RUN,
      }),
    ).toBeNull();
  });

  it("is not overdue through the night or the weekend", () => {
    for (const now of [
      "2026-09-18T20:00:00.000Z",
      "2026-09-19T20:00:00.000Z",
      "2026-09-21T08:59:00.000Z",
      "2026-09-21T09:09:00.000Z",
    ]) {
      expect({
        now: now,
        freshness: judge({
          now: now,
          lastResultAt: FRIDAY_LAST_RUN,
          monitoringInterval: BUSINESS_HOURS,
        }).freshness,
      }).toEqual({ now: now, freshness: MonitorCheckFreshness.Fresh });
    }
  });

  it("is overdue once Monday's first run is further back than the grace", () => {
    // Due at 09:00, five-minute spacing, so ten minutes of grace.
    expect(
      judge({
        now: "2026-09-21T09:12:00.000Z",
        lastResultAt: FRIDAY_LAST_RUN,
        monitoringInterval: BUSINESS_HOURS,
      }),
    ).toEqual({
      freshness: MonitorCheckFreshness.Stale,
      overdueSeconds: 720,
      resultAgeSeconds: 3 * 86400 - 17 * 3600 - 55 * 60 + 9 * 3600 + 12 * 60,
    });
  });

  it("a monitor created out of hours is still waiting, not overdue", () => {
    expect(
      judge({
        now: "2026-09-19T23:00:00.000Z",
        createdAt: new Date("2026-09-19T20:00:00.000Z"),
        monitoringInterval: BUSINESS_HOURS,
      }).freshness,
    ).toBe(MonitorCheckFreshness.AwaitingFirstResult);

    expect(
      judge({
        now: "2026-09-21T09:30:00.000Z",
        createdAt: new Date("2026-09-19T20:00:00.000Z"),
        monitoringInterval: BUSINESS_HOURS,
      }),
    ).toEqual({
      freshness: MonitorCheckFreshness.Stale,
      overdueSeconds: 1800,
      resultAgeSeconds: null,
    });
  });

  it("a uniform schedule is judged as one cadence after the result", () => {
    const withInterval: (age: number) => MonitorCheckFreshnessResult = (
      age: number,
    ): MonitorCheckFreshnessResult => {
      return judge({
        now: NOW.toISOString(),
        lastResultAt: secondsAgo(age),
        monitoringInterval: "*/5 * * * *",
      });
    };

    for (const age of [60, 840, 899, 900, 901, 930, 1000, 7200]) {
      expect({ age: age, freshness: withInterval(age).freshness }).toEqual({
        age: age,
        freshness: freshness({ lastResultAt: secondsAgo(age) }).freshness,
      });
    }

    // For a result on a run, "overdue by" is the same number too.
    for (const age of [300, 900, 1200, 7200]) {
      expect({ age: age, result: withInterval(age) }).toEqual({
        age: age,
        result: freshness({ lastResultAt: secondsAgo(age) }),
      });
    }
  });

  it("without a readable interval, lateness is the age less one cadence", () => {
    expect(
      MonitorCheckScheduleUtil.getResultLateness({
        lastResultAt: secondsAgo(1000),
        monitoringInterval: undefined,
        cadenceSeconds: 300,
        now: NOW,
      }),
    ).toEqual({ lateSeconds: 700, graceSeconds: 600 });

    // A result from the future is just now, not "early".
    expect(
      MonitorCheckScheduleUtil.getResultLateness({
        lastResultAt: secondsAgo(-120),
        cadenceSeconds: 60,
        now: NOW,
      }),
    ).toEqual({ lateSeconds: -60, graceSeconds: 300 });
  });
});

/*
 * CronTab accepts a day no allowed month has, like the 30th of February,
 * and then walks a million-step search (over a second) before it finds no
 * run. The overview asks for a next run once per probe and again for
 * freshness on every render, so such a schedule must never reach that
 * search, and must read as the every-minute schedule the scheduler gives
 * it.
 */
describe("MonitorCheckScheduleUtil schedules that never run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("never searches for the 30th of February, and falls back to every minute", () => {
    const search: MockInstance<typeof CronTab.getNextExecutionTimes> =
      jest.spyOn(CronTab, "getNextExecutionTimes");

    for (const impossible of [
      "0 0 30 2 *",
      "0 0 31 4 *",
      "0 0 31 4,6,9,11 *",
      "0 0 30-31 feb *",
      "0 0 0 30 2 *",
      /*
       * One month without the day: the scheduler's cron-parser throws on
       * these whatever the day of the week, and runs the monitor every
       * minute.
       */
      "0 0 30 2 1",
      "0 0 31 4 1-5",
    ]) {
      // Twice: the second read must be as cheap as the first.
      for (let read: number = 0; read < 2; read++) {
        expect({
          impossible: impossible,
          nextRun: MonitorCheckScheduleUtil.getNextRunAfter({
            monitoringInterval: impossible,
            after: NOW,
          }),
          cadence: MonitorCheckScheduleUtil.getCadenceSeconds({
            monitoringInterval: impossible,
            from: NOW,
          }),
          resolved: MonitorCheckScheduleUtil.resolveCadenceSeconds({
            monitoringInterval: impossible,
            from: NOW,
          }),
          description: MonitorCheckScheduleUtil.describeInterval(impossible),
          // The uniform-cadence path: due one (fallback) cadence after it.
          lateness: MonitorCheckScheduleUtil.getResultLateness({
            lastResultAt: secondsAgo(30),
            monitoringInterval: impossible,
            cadenceSeconds: 60,
            now: NOW,
          }),
        }).toEqual({
          impossible: impossible,
          nextRun: null,
          cadence: null,
          resolved: 60,
          description: "Every minute",
          lateness: { lateSeconds: -30, graceSeconds: 300 },
        });
      }
    }

    expect(search).not.toHaveBeenCalled();
  });

  it("still finds the runs of schedules that only look impossible", () => {
    // The 29th of February comes round in 2028.
    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: "0 0 29 2 *",
        after: NOW,
      }),
    ).toMatchObject({ runAt: new Date("2028-02-29T00:00:00.000Z") });

    /*
     * Over several months a day of the week is ORed with the day of the
     * month, by cron-parser as by CronTab: Mondays in February and April.
     */
    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: "0 0 31 2,4 1",
        after: NOW,
      }),
    ).toMatchObject({ runAt: new Date("2027-02-01T00:00:00.000Z") });

    // January has a 31st, even if February does not.
    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: "0 0 31 1-2 *",
        after: NOW,
      }),
    ).toMatchObject({ runAt: new Date("2027-01-31T00:00:00.000Z") });

    expect(MonitorCheckScheduleUtil.describeInterval("0 0 29 2 *")).not.toBe(
      "Every minute",
    );
  });

  it("remembers a schedule CronTab found no run for, and does not search it again", () => {
    // A schedule the day-field check cannot see through, standing in for one.
    const search: MockInstance<typeof CronTab.getNextExecutionTimes> = jest
      .spyOn(CronTab, "getNextExecutionTimes")
      .mockReturnValue([]);
    const cron: string = "13 3 * * *";

    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: cron,
        after: NOW,
      }),
    ).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);

    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: cron,
        after: secondsAgo(3600),
      }),
    ).toBeNull();
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: cron,
        from: NOW,
      }),
    ).toBeNull();
    expect(MonitorCheckScheduleUtil.describeInterval(cron)).toBe(
      "Every minute",
    );
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("an Invalid Date is never handed to CronTab, whose month search would not end", () => {
    const search: MockInstance<typeof CronTab.getNextExecutionTimes> = jest
      .spyOn(CronTab, "getNextExecutionTimes")
      .mockReturnValue([]);

    expect(
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: "*/5 * * * *",
        after: new Date(Number.NaN),
      }),
    ).toBeNull();
    expect(
      MonitorCheckScheduleUtil.getCadenceSeconds({
        monitoringInterval: "*/5 * * * *",
        from: new Date(Number.NaN),
      }),
    ).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("MonitorCheckScheduleUtil.getLatestSignalAt", () => {
  it("picks the newest signal across families", () => {
    const monitor: Monitor = new Monitor();
    monitor.incomingMonitorRequest = {
      incomingRequestReceivedAt: secondsAgo(500),
    } as IncomingMonitorRequest;
    monitor.incomingEmailMonitorLastEmailReceivedAt = secondsAgo(30);
    monitor.serverMonitorRequestReceivedAt = secondsAgo(900);
    monitor.telemetryMonitorLastMonitorAt = secondsAgo(60);

    expect(
      MonitorCheckScheduleUtil.getLatestSignalAt({
        monitor: monitor,
        probeLastResultAt: secondsAgo(45),
      })?.toISOString(),
    ).toBe(secondsAgo(30).toISOString());

    expect(
      MonitorCheckScheduleUtil.getLatestSignalAt({
        monitor: monitor,
        probeLastResultAt: secondsAgo(5),
      })?.toISOString(),
    ).toBe(secondsAgo(5).toISOString());
  });

  it("reads a heartbeat time stored as a string in the JSON column", () => {
    const monitor: Monitor = new Monitor();
    monitor.incomingMonitorRequest = {
      incomingRequestReceivedAt: "2026-09-21T11:59:00.000Z",
    } as unknown as IncomingMonitorRequest;

    expect(
      MonitorCheckScheduleUtil.getLatestSignalAt({
        monitor: monitor,
        probeLastResultAt: undefined,
      })?.toISOString(),
    ).toBe("2026-09-21T11:59:00.000Z");
  });

  it("is undefined when nothing has ever reported", () => {
    expect(
      MonitorCheckScheduleUtil.getLatestSignalAt({
        monitor: new Monitor(),
        probeLastResultAt: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("MonitorCheckScheduleUtil.parseDate", () => {
  it("reads a Date, an ISO string and a typed envelope", () => {
    expect(MonitorCheckScheduleUtil.parseDate(NOW)).toBe(NOW);
    expect(
      MonitorCheckScheduleUtil.parseDate(
        "2026-09-21T12:00:00.000Z",
      )?.toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
    expect(
      MonitorCheckScheduleUtil.parseDate({
        _type: "DateTime",
        value: "2026-09-21T12:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
  });

  it("is undefined for anything unreadable, never an Invalid Date", () => {
    expect(MonitorCheckScheduleUtil.parseDate(undefined)).toBeUndefined();
    expect(MonitorCheckScheduleUtil.parseDate(null)).toBeUndefined();
    expect(MonitorCheckScheduleUtil.parseDate("")).toBeUndefined();
    expect(MonitorCheckScheduleUtil.parseDate({ nope: 1 })).toBeUndefined();
    expect(
      MonitorCheckScheduleUtil.parseDate(new Date("garbage")),
    ).toBeUndefined();
    expect(MonitorCheckScheduleUtil.parseDate(true)).toBeUndefined();
  });
});
