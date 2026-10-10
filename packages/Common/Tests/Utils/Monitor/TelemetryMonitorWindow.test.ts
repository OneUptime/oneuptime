import TelemetryMonitorWindow, {
  DEFAULT_TELEMETRY_MONITOR_WINDOW_MS,
} from "../../../Utils/Monitor/TelemetryMonitorWindow";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepProfileMonitorUtil } from "../../../Types/Monitor/MonitorStepProfileMonitor";
import { MonitorStepSecurityEventsMonitorUtil } from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #2825: before a telemetry check runs, the worker asks whether its
 * window holds time OneUptime was not receiving - so it needs the window's
 * length, exactly as the check reads it. And while the ingest queue is
 * behind, every check's window can end earlier than now.
 */

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

function windowOf(monitorType: MonitorType, step: MonitorStep): number {
  return TelemetryMonitorWindow.getWindowInMs({
    monitorType,
    monitorStep: step,
  });
}

describe("TelemetryMonitorWindow.getWindowInMs", () => {
  test("lookback checks use their seconds", () => {
    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      lastXSecondsOfLogs: 300,
    });
    expect(windowOf(MonitorType.Logs, step)).toBe(5 * MINUTE);

    step.setTraceMonitor({
      ...MonitorStepTraceMonitorUtil.getDefault(),
      lastXSecondsOfSpans: 120,
    });
    expect(windowOf(MonitorType.Traces, step)).toBe(2 * MINUTE);

    step.setExceptionMonitor({
      ...MonitorStepExceptionMonitorUtil.getDefault(),
      lastXSecondsOfExceptions: 900,
    });
    expect(windowOf(MonitorType.Exceptions, step)).toBe(15 * MINUTE);

    step.setProfileMonitor({
      ...MonitorStepProfileMonitorUtil.getDefault(),
      lastXSecondsOfProfiles: 30,
    });
    expect(windowOf(MonitorType.Profiles, step)).toBe(30 * SECOND);

    step.setSecurityEventsMonitor({
      ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
      lastXSecondsOfEvents: 3600,
    });
    expect(windowOf(MonitorType.SecurityEvents, step)).toBe(60 * MINUTE);
  });

  test("rolling-time checks use their rolling time", () => {
    const step: MonitorStep = new MonitorStep();
    step.setHostMonitor({
      ...MonitorStepHostMonitorUtil.getDefault(),
      rollingTime: RollingTime.Past5Minutes,
    });
    expect(windowOf(MonitorType.Host, step)).toBe(5 * MINUTE);

    step.setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      rollingTime: RollingTime.Past7Days,
    });
    expect(windowOf(MonitorType.Metrics, step)).toBe(7 * DAY);
  });

  test("every infrastructure check reads its own step", () => {
    const cases: Array<[MonitorType, keyof NonNullable<MonitorStep["data"]>]> =
      [
        [MonitorType.Kubernetes, "kubernetesMonitor"],
        [MonitorType.Docker, "dockerMonitor"],
        [MonitorType.Host, "hostMonitor"],
        [MonitorType.Podman, "podmanMonitor"],
        [MonitorType.Proxmox, "proxmoxMonitor"],
        [MonitorType.VMware, "vmwareMonitor"],
        [MonitorType.DockerSwarm, "dockerSwarmMonitor"],
        [MonitorType.Ceph, "cephMonitor"],
        [MonitorType.StorageArray, "storageArrayMonitor"],
        [MonitorType.IoTDevice, "iotMonitor"],
      ];

    for (const [monitorType, field] of cases) {
      const step: MonitorStep = new MonitorStep();
      (step.data as unknown as Record<string, unknown>)[field] = {
        rollingTime: RollingTime.Past30Minutes,
      };
      expect([monitorType, windowOf(monitorType, step)]).toEqual([
        monitorType,
        30 * MINUTE,
      ]);
    }
  });

  test("a step saved without a window reads as the last minute, as the checks do", () => {
    const empty: MonitorStep = new MonitorStep();
    expect(windowOf(MonitorType.Logs, empty)).toBe(
      DEFAULT_TELEMETRY_MONITOR_WINDOW_MS,
    );
    expect(windowOf(MonitorType.Host, empty)).toBe(MINUTE);
    expect(
      TelemetryMonitorWindow.getWindowInMs({
        monitorType: MonitorType.Metrics,
        monitorStep: undefined,
      }),
    ).toBe(MINUTE);

    const zero: MonitorStep = new MonitorStep();
    zero.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      lastXSecondsOfLogs: 0,
    });
    expect(windowOf(MonitorType.Logs, zero)).toBe(MINUTE);
  });

  test("a non-telemetry monitor type falls back to a minute", () => {
    expect(windowOf(MonitorType.Website, new MonitorStep())).toBe(MINUTE);
  });
});

describe("RollingTimeUtil", () => {
  test("getWindowInMs is the length of every rolling time", () => {
    expect(RollingTimeUtil.getWindowInMs(RollingTime.Past1Minute)).toBe(MINUTE);
    expect(RollingTimeUtil.getWindowInMs(RollingTime.Past1Hours)).toBe(DAY);
    expect(RollingTimeUtil.getWindowInMs(RollingTime.Past365Days)).toBe(
      365 * DAY,
    );
    for (const rollingTime of Object.values(RollingTime)) {
      expect(RollingTimeUtil.getWindowInMs(rollingTime)).toBeGreaterThan(0);
    }
  });

  test("a window can end earlier than now, and keeps its length", () => {
    const endDate: Date = new Date("2026-10-09T11:55:00.000Z");
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      endDate,
    );
    expect(window.endValue).toEqual(endDate);
    expect(window.startValue).toEqual(new Date("2026-10-09T11:50:00.000Z"));
  });

  test("without an end the window still ends now", () => {
    const before: number = Date.now();
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past10Minutes,
    );
    expect((window.endValue as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(
      (window.endValue as Date).getTime() -
        (window.startValue as Date).getTime(),
    ).toBe(10 * MINUTE);
  });
});

describe("Every lookback query can end earlier than now", () => {
  const END: Date = new Date("2026-10-09T11:50:00.000Z");

  function range(value: unknown): [number, number] {
    const between: InBetween<Date> = value as InBetween<Date>;
    return [
      (between.startValue as Date).getTime(),
      (between.endValue as Date).getTime(),
    ];
  }

  test("logs, traces, exceptions, profiles and security events", () => {
    expect(
      range(
        MonitorStepLogMonitorUtil.toQuery(
          { ...MonitorStepLogMonitorUtil.getDefault(), lastXSecondsOfLogs: 60 },
          END,
        ).time,
      ),
    ).toEqual([END.getTime() - MINUTE, END.getTime()]);

    expect(
      range(
        MonitorStepTraceMonitorUtil.toQuery(
          {
            ...MonitorStepTraceMonitorUtil.getDefault(),
            lastXSecondsOfSpans: 120,
          },
          END,
        ).startTime,
      ),
    ).toEqual([END.getTime() - 2 * MINUTE, END.getTime()]);

    expect(
      range(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery(
          {
            ...MonitorStepExceptionMonitorUtil.getDefault(),
            lastXSecondsOfExceptions: 60,
          },
          END,
        ).time,
      ),
    ).toEqual([END.getTime() - MINUTE, END.getTime()]);

    expect(
      range(
        MonitorStepProfileMonitorUtil.toQuery(
          {
            ...MonitorStepProfileMonitorUtil.getDefault(),
            lastXSecondsOfProfiles: 60,
          },
          END,
        ).startTime,
      ),
    ).toEqual([END.getTime() - MINUTE, END.getTime()]);

    expect(
      range(
        MonitorStepSecurityEventsMonitorUtil.toQuery(
          {
            ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
            lastXSecondsOfEvents: 60,
          },
          END,
        ).time,
      ),
    ).toEqual([END.getTime() - MINUTE, END.getTime()]);
  });

  test("without an end every lookback still ends now", () => {
    const before: number = Date.now();
    const [, end] = range(
      MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 60,
      }).time,
    );
    expect(end).toBeGreaterThanOrEqual(before);
  });
});
