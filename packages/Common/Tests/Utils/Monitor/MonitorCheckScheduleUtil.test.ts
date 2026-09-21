import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCheckScheduleUtil, {
  MonitorCheckFreshness,
  MonitorCheckFreshnessResult,
} from "../../../Utils/Monitor/MonitorCheckScheduleUtil";
import { describe, expect, it } from "@jest/globals";

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
