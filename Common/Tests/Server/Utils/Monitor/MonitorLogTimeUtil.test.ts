import MonitorLogTimeUtil, {
  MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS,
  MAX_MONITOR_LOG_LAG_IN_MS,
} from "../../../../Server/Utils/Monitor/MonitorLogTimeUtil";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, it } from "@jest/globals";

/*
 * The "Monitored At" column of a monitor log used to be the server's ingest
 * time. That is fine while a monitor is healthy, but a failing check spends
 * its retry budget before reporting, so the row landed noticeably after the
 * check actually ran — a 1-minute Ping monitor looked like it had skipped
 * three intervals. These tests cover reading the check's own timestamp off
 * the payload, and the clock-skew guards that keep a misconfigured probe from
 * writing rows into the future or into a long-past ClickHouse partition.
 */

const NOW: Date = new Date(Date.UTC(2026, 6, 24, 13, 14, 0));

function probeResponse(monitoredAt: unknown): DataToProcess {
  return {
    projectId: new ObjectID("100000000000000000000001"),
    monitorId: new ObjectID("100000000000000000000002"),
    monitorStepId: new ObjectID("100000000000000000000003"),
    probeId: new ObjectID("100000000000000000000004"),
    failureCause: "",
    monitoredAt: monitoredAt,
  } as unknown as ProbeMonitorResponse;
}

describe("MonitorLogTimeUtil.getMonitorLogTime", () => {
  it("uses the check's own monitoredAt when it is a Date", () => {
    const monitoredAt: Date = new Date(NOW.getTime() - 45000);

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(monitoredAt), NOW),
    ).toEqual(monitoredAt);
  });

  it("parses monitoredAt when it arrived as an ISO string", () => {
    const monitoredAt: Date = new Date(NOW.getTime() - 45000);

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(
        probeResponse(monitoredAt.toISOString()),
        NOW,
      ),
    ).toEqual(monitoredAt);
  });

  it("parses monitoredAt when it arrived as an epoch number", () => {
    const monitoredAt: Date = new Date(NOW.getTime() - 45000);

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(
        probeResponse(monitoredAt.getTime()),
        NOW,
      ),
    ).toEqual(monitoredAt);
  });

  it("keeps a slow failing check's timestamp rather than the ingest time", () => {
    /*
     * The regression this fixes: the check ran at 13:12 and only reported at
     * 13:14, and the log claimed 13:14.
     */
    const monitoredAt: Date = new Date(NOW.getTime() - 2 * 60 * 1000);

    const logTime: Date = MonitorLogTimeUtil.getMonitorLogTime(
      probeResponse(monitoredAt),
      NOW,
    );

    expect(logTime).toEqual(monitoredAt);
    expect(logTime).not.toEqual(NOW);
  });

  it("falls back to server time when the payload has no monitoredAt", () => {
    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(undefined), NOW),
    ).toEqual(NOW);

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(null), NOW),
    ).toEqual(NOW);

    expect(
      MonitorLogTimeUtil.getMonitorLogTime({} as DataToProcess, NOW),
    ).toEqual(NOW);
  });

  it("falls back to server time when the payload itself is missing", () => {
    expect(MonitorLogTimeUtil.getMonitorLogTime(undefined, NOW)).toEqual(NOW);
  });

  it("falls back to server time for an unparseable monitoredAt", () => {
    for (const badValue of [
      "not-a-date",
      "",
      NaN,
      new Date("nonsense"),
      {},
      [],
      true,
    ]) {
      expect(
        MonitorLogTimeUtil.getMonitorLogTime(probeResponse(badValue), NOW),
      ).toEqual(NOW);
    }
  });

  it("accepts a check timestamp within the allowed forward skew", () => {
    const monitoredAt: Date = new Date(
      NOW.getTime() + MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS - 1000,
    );

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(monitoredAt), NOW),
    ).toEqual(monitoredAt);
  });

  it("rejects a check timestamp from a probe whose clock runs ahead", () => {
    const monitoredAt: Date = new Date(
      NOW.getTime() + MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS + 1000,
    );

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(monitoredAt), NOW),
    ).toEqual(NOW);
  });

  it("accepts a check timestamp within the allowed lag", () => {
    const monitoredAt: Date = new Date(
      NOW.getTime() - MAX_MONITOR_LOG_LAG_IN_MS + 1000,
    );

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(monitoredAt), NOW),
    ).toEqual(monitoredAt);
  });

  it("rejects a check timestamp that is implausibly stale", () => {
    const monitoredAt: Date = new Date(
      NOW.getTime() - MAX_MONITOR_LOG_LAG_IN_MS - 1000,
    );

    expect(
      MonitorLogTimeUtil.getMonitorLogTime(probeResponse(monitoredAt), NOW),
    ).toEqual(NOW);
  });

  it("never returns a time outside the accepted window", () => {
    const offsetsInMs: Array<number> = [
      -10 * 24 * 60 * 60 * 1000,
      -MAX_MONITOR_LOG_LAG_IN_MS - 1,
      -60000,
      0,
      MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS + 1,
      10 * 24 * 60 * 60 * 1000,
    ];

    for (const offsetInMs of offsetsInMs) {
      const logTime: Date = MonitorLogTimeUtil.getMonitorLogTime(
        probeResponse(new Date(NOW.getTime() + offsetInMs)),
        NOW,
      );

      const skewInMs: number = logTime.getTime() - NOW.getTime();

      expect(skewInMs).toBeLessThanOrEqual(MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS);
      expect(-skewInMs).toBeLessThanOrEqual(MAX_MONITOR_LOG_LAG_IN_MS);
    }
  });
});
