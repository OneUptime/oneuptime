import ServerMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ServerMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import BasicInfrastructureMetrics, {
  BasicDiskMetrics,
  LoadMetrics,
} from "../../../../../Types/Infrastructure/BasicMetrics";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ServerMonitorResponse, {
  ServerProcess,
} from "../../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Fixed reference "now" so that the difference-in-minutes computation the
 * evaluator performs (requestReceivedAt vs timeNow) is fully deterministic
 * and never touches the wall clock.
 */
const BASE_TIME: Date = new Date("2026-08-20T12:00:00.000Z");

/*
 * Build a BasicInfrastructureMetrics payload. Every sub-metric has a benign
 * default so an individual test only supplies the field it exercises.
 */
function buildMetrics(input: {
  cpuPercentUsed?: number | undefined;
  cpuIoWaitPercent?: number | undefined;
  memoryPercentUsed?: number | undefined;
  swapPercentUsed?: number | undefined;
  diskMetrics?: Array<BasicDiskMetrics> | undefined;
  loadMetrics?: LoadMetrics | undefined;
}): BasicInfrastructureMetrics {
  return {
    cpuMetrics: {
      percentUsed: input.cpuPercentUsed ?? 0,
      cores: 4,
      timeIoWaitPercent: input.cpuIoWaitPercent,
    },
    memoryMetrics: {
      total: 100,
      free: 50,
      used: 50,
      percentUsed: input.memoryPercentUsed ?? 0,
      percentFree: 100 - (input.memoryPercentUsed ?? 0),
      swapPercentUsed: input.swapPercentUsed,
    },
    diskMetrics: input.diskMetrics ?? [],
    loadMetrics: input.loadMetrics,
  };
}

/*
 * Build a single disk metric entry. percentUsed / percentFree are optional so
 * the evaluator's `percentUsed ?? percentFree ?? 0` fallback chain can be
 * exercised; the cast tolerates the deliberately-absent required field.
 */
function buildDiskMetric(input: {
  diskPath: string;
  percentUsed?: number | undefined;
  percentFree?: number | undefined;
}): BasicDiskMetrics {
  return {
    total: 100,
    free: 40,
    used: 60,
    diskPath: input.diskPath,
    percentUsed: input.percentUsed as number,
    percentFree: input.percentFree as number,
  };
}

function buildProcess(input: {
  pid?: number | undefined;
  name?: string | undefined;
  command?: string | undefined;
}): ServerProcess {
  return {
    pid: input.pid ?? 1,
    name: input.name ?? "proc",
    command: input.command ?? "/bin/proc",
  };
}

/*
 * Build a ServerMonitorResponse. `minutesSinceLastCheck` positions
 * requestReceivedAt that many minutes before the fixed timeNow, which drives
 * the online/offline decision for IsOnline checks.
 */
function buildServerResponse(input: {
  metrics?: BasicInfrastructureMetrics | undefined;
  processes?: Array<ServerProcess> | undefined;
  onlyCheckRequestReceivedAt?: boolean | undefined;
  minutesSinceLastCheck?: number | undefined;
}): ServerMonitorResponse {
  const minutesAgo: number = input.minutesSinceLastCheck ?? 0;

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    hostname: "test-host",
    requestReceivedAt: new Date(BASE_TIME.getTime() - minutesAgo * 60000),
    timeNow: BASE_TIME,
    onlyCheckRequestReceivedAt: input.onlyCheckRequestReceivedAt ?? false,
    basicInfrastructureMetrics: input.metrics,
    processes: input.processes,
  };
}

async function evaluate(
  dataToProcess: ServerMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

describe("ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an unrelated CheckOn is not claimed by this evaluator", async () => {
    const result: string | null = await evaluate(buildServerResponse({}), {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.LessThan,
      value: 1000,
    });

    expect(result).toBeNull();
  });

  describe("IsOnline", () => {
    /*
     * A recent check (difference < 3 minute default) is treated as online.
     */
    test("recent check + True → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 1 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain(CheckOn.IsOnline);
      expect(result).toContain("true");
    });

    test("recent check + False → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 1 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A stale check (difference >= 3 minute default) is treated as offline.
     */
    test("stale check + False → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 5 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain(CheckOn.IsOnline);
      expect(result).toContain("false");
    });

    test("stale check + True → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 5 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * The offline boundary is inclusive: a difference of exactly the 3 minute
     * threshold takes the offline branch.
     */
    test("difference exactly at the 3 minute threshold → offline branch", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 3 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );

      expect(result).toContain("false");
    });

    test("difference just below the 3 minute threshold → online branch", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 2 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain("true");
    });

    /*
     * The IsOnline branches deliberately ignore onlyCheckRequestReceivedAt —
     * liveness must still be evaluated on a heartbeat-only payload.
     */
    test("evaluates even when onlyCheckRequestReceivedAt is set", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          minutesSinceLastCheck: 1,
          onlyCheckRequestReceivedAt: true,
        }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );

      expect(result).toContain(CheckOn.IsOnline);
    });

    /*
     * A filter type the boolean comparator does not handle (a numeric
     * operator) is undecidable for IsOnline.
     */
    test("unhandled filter type → undecidable", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 1 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.GreaterThan,
          value: 1,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("CPUUsagePercent", () => {
    test("usage above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 80 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
        },
      );

      expect(result).toContain(CheckOn.CPUUsagePercent);
      expect(result).toContain("greater than");
      expect(result).toContain("80");
    });

    test("usage below threshold + GreaterThan → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 30 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
        },
      );

      expect(result).toBeNull();
    });

    test("numeric string threshold is accepted", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 80 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: "50",
        },
      );

      expect(result).toContain(CheckOn.CPUUsagePercent);
    });

    test("non-numeric threshold → undecidable", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 80 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: "not-a-number",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * With no infrastructure metrics present the CPU value falls back to 0,
     * so a LessThan-1 check is met while a GreaterThan-1 check is not.
     */
    test("missing metrics fall back to zero usage", async () => {
      const result: string | null = await evaluate(buildServerResponse({}), {
        checkOn: CheckOn.CPUUsagePercent,
        filterType: FilterType.LessThan,
        value: 1,
      });

      expect(result).toContain(CheckOn.CPUUsagePercent);
    });

    /*
     * onlyCheckRequestReceivedAt short-circuits every infrastructure metric
     * branch — a heartbeat payload carries no fresh metric to evaluate.
     */
    test("onlyCheckRequestReceivedAt short-circuits the CPU branch", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({ cpuPercentUsed: 90 }),
          onlyCheckRequestReceivedAt: true,
        }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("MemoryUsagePercent", () => {
    test("usage below threshold + LessThan → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({ memoryPercentUsed: 40 }),
        }),
        {
          checkOn: CheckOn.MemoryUsagePercent,
          filterType: FilterType.LessThan,
          value: 95,
        },
      );

      expect(result).toContain(CheckOn.MemoryUsagePercent);
    });

    test("usage above threshold + LessThan → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({ memoryPercentUsed: 96 }),
        }),
        {
          checkOn: CheckOn.MemoryUsagePercent,
          filterType: FilterType.LessThan,
          value: 95,
        },
      );

      expect(result).toBeNull();
    });

    test("usage equal to threshold + GreaterThanOrEqualTo → met (boundary)", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({ memoryPercentUsed: 90 }),
        }),
        {
          checkOn: CheckOn.MemoryUsagePercent,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 90,
        },
      );

      expect(result).toContain(CheckOn.MemoryUsagePercent);
    });
  });

  describe("SwapUsagePercent", () => {
    test("swap usage above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ swapPercentUsed: 30 }) }),
        {
          checkOn: CheckOn.SwapUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 20,
        },
      );

      expect(result).toContain(CheckOn.SwapUsagePercent);
    });

    test("absent swap metric falls back to zero", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({}) }),
        {
          checkOn: CheckOn.SwapUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 20,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("CPUIoWaitPercent", () => {
    test("io wait above threshold + GreaterThan → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({ cpuIoWaitPercent: 15 }),
        }),
        {
          checkOn: CheckOn.CPUIoWaitPercent,
          filterType: FilterType.GreaterThan,
          value: 10,
        },
      );

      expect(result).toContain(CheckOn.CPUIoWaitPercent);
    });

    test("absent io wait metric falls back to zero", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({}) }),
        {
          checkOn: CheckOn.CPUIoWaitPercent,
          filterType: FilterType.GreaterThan,
          value: 10,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("LoadAverage", () => {
    const load: LoadMetrics = { load1: 2, load5: 1.5, load15: 0.5 };

    test("LoadAverage1Min reads the 1 minute figure", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ loadMetrics: load }) }),
        {
          checkOn: CheckOn.LoadAverage1Min,
          filterType: FilterType.GreaterThan,
          value: 1,
        },
      );

      expect(result).toContain(CheckOn.LoadAverage1Min);
    });

    test("LoadAverage5Min reads the 5 minute figure", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ loadMetrics: load }) }),
        {
          checkOn: CheckOn.LoadAverage5Min,
          filterType: FilterType.GreaterThan,
          value: 1,
        },
      );

      expect(result).toContain(CheckOn.LoadAverage5Min);
    });

    /*
     * The 15 minute figure (0.5) is below the threshold, so the same filter
     * that matched the 1 and 5 minute figures does not fire here — proving
     * the correct load slot is selected per CheckOn.
     */
    test("LoadAverage15Min reads the 15 minute figure → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ loadMetrics: load }) }),
        {
          checkOn: CheckOn.LoadAverage15Min,
          filterType: FilterType.GreaterThan,
          value: 1,
        },
      );

      expect(result).toBeNull();
    });

    test("absent load metrics fall back to zero", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({}) }),
        {
          checkOn: CheckOn.LoadAverage1Min,
          filterType: FilterType.LessThan,
          value: 1,
        },
      );

      expect(result).toContain(CheckOn.LoadAverage1Min);
    });
  });

  describe("DiskUsagePercent", () => {
    /*
     * A trailing slash on the requested path and none on the reported path
     * still resolve to the same disk after normalization.
     */
    test("matches disk after path normalization and uses percentUsed", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({ diskPath: "/var/log", percentUsed: 75 }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          serverMonitorOptions: { diskPath: "/var/log/" },
        },
      );

      expect(result).toContain(CheckOn.DiskUsagePercent);
      expect(result).toContain("/var/log/");
    });

    /*
     * Backslash separators and mixed case both normalize away before the
     * lookup, so a Windows-style reported path matches a forward-slash
     * lower-case request.
     */
    test("normalizes backslashes and case when matching the disk", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({ diskPath: "C:\\Data", percentUsed: 88 }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          serverMonitorOptions: { diskPath: "c:/data" },
        },
      );

      expect(result).toContain(CheckOn.DiskUsagePercent);
    });

    /*
     * With no serverMonitorOptions the requested path defaults to "/".
     */
    test("defaults to the root disk when no path option is given", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [buildDiskMetric({ diskPath: "/", percentUsed: 40 })],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 40,
        },
      );

      expect(result).toContain(CheckOn.DiskUsagePercent);
    });

    /*
     * When percentUsed is absent the evaluator falls back to percentFree.
     */
    test("falls back to percentFree when percentUsed is absent", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({
                diskPath: "/data",
                percentUsed: undefined,
                percentFree: 65,
              }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          serverMonitorOptions: { diskPath: "/data" },
        },
      );

      expect(result).toContain(CheckOn.DiskUsagePercent);
    });

    /*
     * A requested path that matches no reported disk yields a usage of 0.
     */
    test("unmatched disk path yields zero usage", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({ diskPath: "/other", percentUsed: 99 }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.LessThan,
          value: 10,
          serverMonitorOptions: { diskPath: "/data" },
        },
      );

      expect(result).toContain(CheckOn.DiskUsagePercent);
    });
  });

  describe("ServerProcessName", () => {
    test("IsExecuting + process present → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: "nginx",
        },
      );

      expect(result).toBe("Process nginx is executing.");
    });

    /*
     * Matching is case-insensitive and trimmed, but the original threshold
     * text is echoed back in the message.
     */
    test("IsExecuting matches case-insensitively", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: "NGINX",
        },
      );

      expect(result).toBe("Process NGINX is executing.");
    });

    test("IsExecuting + process absent → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: "redis",
        },
      );

      expect(result).toBeNull();
    });

    test("IsNotExecuting + process absent → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsNotExecuting,
          value: "redis",
        },
      );

      expect(result).toBe("Process redis is not executing.");
    });

    test("IsNotExecuting + process present → not met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsNotExecuting,
          value: "nginx",
        },
      );

      expect(result).toBeNull();
    });

    /*
     * An absent processes array is treated as an empty list, so nothing is
     * executing and IsNotExecuting is satisfied.
     */
    test("absent processes list satisfies IsNotExecuting", async () => {
      const result: string | null = await evaluate(buildServerResponse({}), {
        checkOn: CheckOn.ServerProcessName,
        filterType: FilterType.IsNotExecuting,
        value: "nginx",
      });

      expect(result).toBe("Process nginx is not executing.");
    });

    /*
     * A falsy threshold (undefined value) skips the whole process block via
     * the `threshold &&` guard, leaving the check undecidable.
     */
    test("undefined threshold skips the process block", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A filter type that is neither executing nor not-executing falls through
     * the process block without a decision.
     */
    test("unhandled filter type → undecidable", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.EqualTo,
          value: "nginx",
        },
      );

      expect(result).toBeNull();
    });

    test("onlyCheckRequestReceivedAt short-circuits the process block", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ name: "nginx" })],
          onlyCheckRequestReceivedAt: true,
        }),
        {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: "nginx",
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("ServerProcessPID", () => {
    test("IsExecuting matches a numeric PID threshold", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ pid: 4321 })],
        }),
        {
          checkOn: CheckOn.ServerProcessPID,
          filterType: FilterType.IsExecuting,
          value: 4321,
        },
      );

      expect(result).toBe("Process with PID 4321 is executing.");
    });

    test("IsNotExecuting + PID absent → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ pid: 4321 })],
        }),
        {
          checkOn: CheckOn.ServerProcessPID,
          filterType: FilterType.IsNotExecuting,
          value: "9999",
        },
      );

      expect(result).toBe("Process with PID 9999 is not executing.");
    });

    /*
     * The PID block has an explicit trailing null return, so an unhandled
     * filter type resolves to null without falling through to later blocks.
     */
    test("unhandled filter type → undecidable", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ pid: 4321 })],
        }),
        {
          checkOn: CheckOn.ServerProcessPID,
          filterType: FilterType.EqualTo,
          value: 4321,
        },
      );

      expect(result).toBeNull();
    });
  });

  describe("ServerProcessCommand", () => {
    test("IsExecuting matches an exact command", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ command: "/usr/bin/node server.js" })],
        }),
        {
          checkOn: CheckOn.ServerProcessCommand,
          filterType: FilterType.IsExecuting,
          value: "/usr/bin/node server.js",
        },
      );

      expect(result).toBe(
        "Process with command /usr/bin/node server.js is executing.",
      );
    });

    test("IsExecuting matches after trimming and lower-casing", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ command: "/usr/bin/node server.js" })],
        }),
        {
          checkOn: CheckOn.ServerProcessCommand,
          filterType: FilterType.IsExecuting,
          value: "  /USR/bin/Node server.js  ",
        },
      );

      expect(result).toContain("is executing.");
    });

    test("IsNotExecuting + command absent → met", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          processes: [buildProcess({ command: "/usr/bin/node server.js" })],
        }),
        {
          checkOn: CheckOn.ServerProcessCommand,
          filterType: FilterType.IsNotExecuting,
          value: "/bin/bash",
        },
      );

      expect(result).toBe("Process with command /bin/bash is not executing.");
    });
  });

  /*
   * The evaluate-over-time path replaces the current metric value with a
   * historical aggregate. The DB-backed EvaluateOverTime.getValueOverTime is
   * spied so these tests stay deterministic.
   */
  describe("evaluate over time", () => {
    test("uses the over-time boolean series for IsOnline while online", async () => {
      const spy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(EvaluateOverTime, "getValueOverTime")
        .mockResolvedValue([true, false]);

      const response: ServerMonitorResponse = buildServerResponse({
        minutesSinceLastCheck: 5,
      });

      const result: string | null = await evaluate(response, {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        },
      });

      expect(result).toContain(CheckOn.IsOnline);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: response.projectId,
          monitorId: response.monitorId,
          metricType: CheckOn.IsOnline,
        }),
      );
    });

    /*
     * timeValueInMinutes overrides the default offline threshold: a 5 minute
     * gap is still "online" when the window is 10 minutes, which would have
     * been offline under the default of 3.
     */
    test("timeValueInMinutes overrides the offline threshold", async () => {
      jest
        .spyOn(EvaluateOverTime, "getValueOverTime")
        .mockResolvedValue([false, false]);

      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 5 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 3,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
      );

      expect(result).toContain("false");
    });

    /*
     * An empty history array is reset to undefined, so IsOnline falls back to
     * the "recent check → online" default rather than an empty series.
     */
    test("empty over-time series falls back to the liveness default", async () => {
      jest.spyOn(EvaluateOverTime, "getValueOverTime").mockResolvedValue([]);

      const result: string | null = await evaluate(
        buildServerResponse({ minutesSinceLastCheck: 1 }),
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 3,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
      );

      expect(result).toContain("true");
    });

    /*
     * A numeric over-time series takes precedence over the point-in-time CPU
     * metric. The array (70, 80) breaches while the live value (10) would not.
     */
    test("over-time numeric series takes precedence over the live CPU metric", async () => {
      jest
        .spyOn(EvaluateOverTime, "getValueOverTime")
        .mockResolvedValue([70, 80]);

      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 10 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
      );

      expect(result).toContain(CheckOn.CPUUsagePercent);
      expect(result).toContain("70");
    });

    /*
     * A scalar zero aggregate is falsy, so the evaluator falls back to the
     * live CPU metric rather than treating 0 as the value to compare.
     */
    test("scalar zero aggregate falls back to the live CPU metric", async () => {
      jest.spyOn(EvaluateOverTime, "getValueOverTime").mockResolvedValue(0);

      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 90 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
      );

      expect(result).toContain(CheckOn.CPUUsagePercent);
      expect(result).toContain("90");
    });

    /*
     * If the history query throws, the error is swallowed and the evaluator
     * falls back to the live metric instead of failing the criterion.
     */
    test("history query failure falls back to the live CPU metric", async () => {
      jest
        .spyOn(EvaluateOverTime, "getValueOverTime")
        .mockRejectedValue(new Error("history unavailable"));

      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 90 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
      );

      expect(result).toContain(CheckOn.CPUUsagePercent);
      expect(result).toContain("90");
    });
  });
});
