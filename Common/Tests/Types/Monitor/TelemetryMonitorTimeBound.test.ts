import InBetween from "../../../Types/BaseDatabase/InBetween";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProfileMonitor";
import {
  DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
  MAX_TELEMETRY_MONITOR_WINDOW_SECONDS,
} from "../../../Types/Monitor/TelemetryMonitorWindow";

/**
 * Width (in whole seconds) of an InBetween<Date> window. Allows a 2s slack so
 * the assertion is not flaky against the wall-clock time spent inside toQuery.
 */
const windowSeconds: (value: unknown) => number = (value: unknown): number => {
  expect(value).toBeInstanceOf(InBetween);
  const between: InBetween<Date> = value as InBetween<Date>;
  const start: Date = between.startValue as Date;
  const end: Date = between.endValue as Date;
  return Math.round((end.getTime() - start.getTime()) / 1000);
};

const expectWindowApprox: (value: unknown, expectedSeconds: number) => void = (
  value: unknown,
  expectedSeconds: number,
): void => {
  const seconds: number = windowSeconds(value);
  expect(Math.abs(seconds - expectedSeconds)).toBeLessThanOrEqual(2);
};

describe("Telemetry monitor toQuery always applies a bounded time window", () => {
  describe("Logs", () => {
    test("honors a valid configured window", () => {
      const step: MonitorStepLogMonitor =
        MonitorStepLogMonitorUtil.getDefault();
      step.lastXSecondsOfLogs = 300;
      expectWindowApprox(MonitorStepLogMonitorUtil.toQuery(step).time, 300);
    });

    test("bounds the query even when the window is 0 (defeated-bound bug)", () => {
      const step: MonitorStepLogMonitor =
        MonitorStepLogMonitorUtil.getDefault();
      step.lastXSecondsOfLogs = 0;
      const time: unknown = MonitorStepLogMonitorUtil.toQuery(step).time;
      expect(time).toBeInstanceOf(InBetween);
      expectWindowApprox(time, DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS);
    });

    test("bounds the query when the window is undefined", () => {
      const step: MonitorStepLogMonitor =
        MonitorStepLogMonitorUtil.getDefault();
      step.lastXSecondsOfLogs = undefined as unknown as number;
      expectWindowApprox(
        MonitorStepLogMonitorUtil.toQuery(step).time,
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });

    test("caps an absurdly large window", () => {
      const step: MonitorStepLogMonitor =
        MonitorStepLogMonitorUtil.getDefault();
      step.lastXSecondsOfLogs = 999999999;
      expectWindowApprox(
        MonitorStepLogMonitorUtil.toQuery(step).time,
        MAX_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });

    test("fromJSON re-defaults a missing window so it can never deserialize to 0", () => {
      const step: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.fromJSON({
        telemetryServiceIds: [],
      });
      expect(step.lastXSecondsOfLogs).toBe(
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });
  });

  describe("Traces", () => {
    test("honors a valid configured window", () => {
      const step: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.getDefault();
      step.lastXSecondsOfSpans = 120;
      expectWindowApprox(
        MonitorStepTraceMonitorUtil.toQuery(step).startTime,
        120,
      );
    });

    test("bounds the query when the window is 0", () => {
      const step: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.getDefault();
      step.lastXSecondsOfSpans = 0;
      expectWindowApprox(
        MonitorStepTraceMonitorUtil.toQuery(step).startTime,
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });

    test("fromJSON re-defaults a missing window", () => {
      const step: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.fromJSON({ telemetryServiceIds: [] });
      expect(step.lastXSecondsOfSpans).toBe(
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });
  });

  describe("Exceptions", () => {
    test("honors a valid configured window", () => {
      const step: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.getDefault();
      step.lastXSecondsOfExceptions = 600;
      expectWindowApprox(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery(step).time,
        600,
      );
    });

    test("bounds the query when the window is 0", () => {
      const step: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.getDefault();
      step.lastXSecondsOfExceptions = 0;
      expectWindowApprox(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery(step).time,
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });
  });

  describe("Profiles", () => {
    test("honors a valid configured window", () => {
      const step: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.getDefault();
      step.lastXSecondsOfProfiles = 90;
      expectWindowApprox(
        MonitorStepProfileMonitorUtil.toQuery(step).startTime,
        90,
      );
    });

    test("bounds the query when the window is 0", () => {
      const step: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.getDefault();
      step.lastXSecondsOfProfiles = 0;
      expectWindowApprox(
        MonitorStepProfileMonitorUtil.toQuery(step).startTime,
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });

    test("fromJSON re-defaults a missing window", () => {
      const step: MonitorStepProfileMonitor =
        MonitorStepProfileMonitorUtil.fromJSON({ telemetryServiceIds: [] });
      expect(step.lastXSecondsOfProfiles).toBe(
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
      );
    });
  });
});
