import ServerMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ServerMonitorCriteria";
import EvaluateOverTime, {
  OverTimeCriteriaValue,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import { JSONObject } from "../../../../../Types/JSON";
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
      expect(result).toContain("above the 50 threshold");
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
     * A report without CPU metrics says nothing about the CPU. It used to
     * read as 0%, so "CPU Usage less than 1" fired on every such report.
     */
    test("a report without metrics matches nothing, rather than reading as 0%", async () => {
      for (const filterType of [FilterType.LessThan, FilterType.GreaterThan]) {
        const result: string | null = await evaluate(buildServerResponse({}), {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: filterType,
          value: 1,
        });

        expect({ filterType, result }).toEqual({ filterType, result: null });
      }
    });

    /*
     * The macOS agent, built without cgo, sent "cpuMetrics": null with
     * every report. Reading percentUsed of null threw, the report was never
     * saved, and the server was marked offline although it reported every
     * 30 seconds.
     */
    test("a report whose cpuMetrics is null (the macOS agent) matches nothing and does not throw", async () => {
      const metrics: BasicInfrastructureMetrics = {
        ...buildMetrics({ memoryPercentUsed: 40 }),
        cpuMetrics: null,
      } as unknown as BasicInfrastructureMetrics;

      for (const checkOn of [
        CheckOn.CPUUsagePercent,
        CheckOn.CPUIoWaitPercent,
      ]) {
        for (const filterType of [
          FilterType.LessThan,
          FilterType.GreaterThan,
        ]) {
          const result: string | null = await evaluate(
            buildServerResponse({ metrics: metrics }),
            { checkOn: checkOn, filterType: filterType, value: 1 },
          );

          expect({ checkOn, filterType, result }).toEqual({
            checkOn,
            filterType,
            result: null,
          });
        }
      }

      // The rest of the report is still judged.
      expect(
        await evaluate(buildServerResponse({ metrics: metrics }), {
          checkOn: CheckOn.MemoryUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 30,
        }),
      ).toContain(CheckOn.MemoryUsagePercent);
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

    // The agent sends "memoryMetrics": null when it cannot read memory.
    test("a report whose memoryMetrics is null matches nothing and does not throw", async () => {
      const metrics: BasicInfrastructureMetrics = {
        ...buildMetrics({ cpuPercentUsed: 40 }),
        memoryMetrics: null,
      } as unknown as BasicInfrastructureMetrics;

      for (const checkOn of [
        CheckOn.MemoryUsagePercent,
        CheckOn.SwapUsagePercent,
      ]) {
        for (const filterType of [
          FilterType.LessThan,
          FilterType.GreaterThan,
        ]) {
          const result: string | null = await evaluate(
            buildServerResponse({ metrics: metrics }),
            { checkOn: checkOn, filterType: filterType, value: 1 },
          );

          expect({ checkOn, filterType, result }).toEqual({
            checkOn,
            filterType,
            result: null,
          });
        }
      }
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

    /*
     * The agent leaves a zero out of the CPU it reports, so CPU metrics
     * without I/O wait say 0% - unlike a report with no CPU metrics at all.
     */
    test("io wait left out of the CPU metrics is a zero the agent did not send", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({ metrics: buildMetrics({}) }),
        {
          checkOn: CheckOn.CPUIoWaitPercent,
          filterType: FilterType.LessThan,
          value: 1,
        },
      );

      expect(result).toContain(CheckOn.CPUIoWaitPercent);
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

    /*
     * An agent that could not read the load average leaves it out. That
     * says nothing about the load: it used to read as 0, so "Load Average
     * less than 1" fired on every report.
     */
    test("absent load metrics match nothing, rather than reading as 0", async () => {
      for (const checkOn of [
        CheckOn.LoadAverage1Min,
        CheckOn.LoadAverage5Min,
        CheckOn.LoadAverage15Min,
      ]) {
        const result: string | null = await evaluate(
          buildServerResponse({ metrics: buildMetrics({}) }),
          {
            checkOn: checkOn,
            filterType: FilterType.LessThan,
            value: 1,
          },
        );

        expect({ checkOn, result }).toEqual({ checkOn, result: null });
      }
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
     * Free space is not usage. Without percentUsed the evaluator used to
     * compare percentFree as the usage, so a disk 65% free read as 65% full.
     * Usage is 100 - percentFree.
     */
    test("reads a disk without percentUsed as 100 - percentFree, never free space as usage", async () => {
      const response: ServerMonitorResponse = buildServerResponse({
        metrics: buildMetrics({
          diskMetrics: [
            buildDiskMetric({
              diskPath: "/data",
              percentUsed: undefined,
              percentFree: 65,
            }),
          ],
        }),
      });

      expect(
        await evaluate(response, {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          serverMonitorOptions: { diskPath: "/data" },
        }),
      ).toBeNull();

      const result: string | null = await evaluate(response, {
        checkOn: CheckOn.DiskUsagePercent,
        filterType: FilterType.LessThan,
        value: 50,
        serverMonitorOptions: { diskPath: "/data" },
      });

      expect(result).toContain(CheckOn.DiskUsagePercent);
      expect(result).toContain("35");
    });

    /*
     * A path that names no disk the agent reported used to read as 0%
     * full, silently: "less than 10%" fired, and "more than 90%" never
     * could. It matches nothing now.
     */
    test("a path that names no reported disk matches nothing, rather than reading as 0%", async () => {
      for (const filterType of [FilterType.LessThan, FilterType.GreaterThan]) {
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
            filterType: filterType,
            value: 10,
            serverMonitorOptions: { diskPath: "/data" },
          },
        );

        expect({ filterType, result }).toEqual({ filterType, result: null });
      }
    });

    test("a disk whose usage the agent did not report matches nothing", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              {
                diskPath: "/data",
                percentUsed: null,
                percentFree: null,
              } as unknown as BasicDiskMetrics,
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

      expect(result).toBeNull();
    });

    // The Windows agent reports its drives as "C:", which people type "C:\".
    test("C:\\ names the C: drive the Windows agent reports", async () => {
      for (const typed of ["C:\\", "c:\\", "C:", "c:/", " C:\\ "]) {
        const result: string | null = await evaluate(
          buildServerResponse({
            metrics: buildMetrics({
              diskMetrics: [
                buildDiskMetric({ diskPath: "C:", percentUsed: 91 }),
                buildDiskMetric({ diskPath: "D:", percentUsed: 10 }),
              ],
            }),
          }),
          {
            checkOn: CheckOn.DiskUsagePercent,
            filterType: FilterType.GreaterThan,
            value: 90,
            serverMonitorOptions: { diskPath: typed },
          },
        );

        expect({ typed, met: Boolean(result) }).toEqual({ typed, met: true });
      }
    });

    /*
     * The form offers device names ("/dev/sda1"), which used to match no
     * disk: the agent reports each disk by where it is mounted. A device
     * names the disk on it.
     */
    test("a device name names the disk on that device", async () => {
      const response: ServerMonitorResponse = buildServerResponse({
        metrics: buildMetrics({
          diskMetrics: [
            {
              ...buildDiskMetric({ diskPath: "/", percentUsed: 30 }),
              device: "/dev/sda1",
            },
            {
              ...buildDiskMetric({
                diskPath: "/var/lib/data",
                percentUsed: 95,
              }),
              device: "/dev/sdb1",
            },
          ],
        }),
      });

      const result: string | null = await evaluate(response, {
        checkOn: CheckOn.DiskUsagePercent,
        filterType: FilterType.GreaterThan,
        value: 90,
        serverMonitorOptions: { diskPath: "/dev/sdb1" },
      });

      expect(result).toContain("95");
      expect(
        await evaluate(response, {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "/dev/sda1" },
        }),
      ).toBeNull();
    });

    // A mount path wins over a device of the same name.
    test("a disk mounted at the path is chosen before a device named the same", async () => {
      expect(
        ServerMonitorCriteria.findDiskMetric({
          diskMetrics: [
            { ...buildDiskMetric({ diskPath: "/srv" }), device: "/data" },
            { ...buildDiskMetric({ diskPath: "/data" }), device: "/dev/sdb1" },
          ],
          diskPath: "/data/",
        })?.device,
      ).toBe("/dev/sdb1");
    });

    test("normalizes a Disk Path the way the criteria and the window compare it", () => {
      for (const [typed, normalized] of [
        ["/", "/"],
        ["", "/"],
        ["   ", "/"],
        ["//", "/"],
        ["/mnt/data/", "/mnt/data"],
        ["/MNT/Data", "/mnt/data"],
        ["C:\\", "c:"],
        ["C:", "c:"],
        ["\\\\server\\share\\", "//server/share"],
      ] as Array<[string, string]>) {
        expect({
          typed,
          normalized: ServerMonitorCriteria.normalizeDiskPath(typed),
        }).toEqual({ typed, normalized });
      }

      expect(ServerMonitorCriteria.normalizeDiskPath(undefined)).toBe("/");
    });

    test("writes a Disk Path the way the agent writes the disk's path", () => {
      for (const [typed, agentPath] of [
        ["", "/"],
        ["/", "/"],
        ["/mnt/data/", "/mnt/data"],
        ["c:\\", "C:"],
        ["C:/", "C:"],
        ["d:", "D:"],
      ] as Array<[string, string]>) {
        expect({
          typed,
          agentPath: ServerMonitorCriteria.toAgentDiskPath(typed),
        }).toEqual({ typed, agentPath });
      }
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
     * An agent that could not list the processes sends no list (an older
     * one sent null). That used to read as "nothing is running", so every
     * "Is Not Executing" criteria fired at once. No list says nothing about
     * any process; nor does an empty one, since a server always runs some.
     */
    test("a report without a process list matches neither Is Executing nor Is Not Executing", async () => {
      const checks: Array<{ checkOn: CheckOn; value: string | number }> = [
        { checkOn: CheckOn.ServerProcessName, value: "nginx" },
        { checkOn: CheckOn.ServerProcessPID, value: 4321 },
        { checkOn: CheckOn.ServerProcessCommand, value: "/usr/sbin/nginx" },
      ];

      for (const processes of [
        undefined,
        null as unknown as Array<ServerProcess>,
        [],
      ]) {
        for (const check of checks) {
          for (const filterType of [
            FilterType.IsExecuting,
            FilterType.IsNotExecuting,
          ]) {
            const result: string | null = await evaluate(
              buildServerResponse({ processes: processes }),
              {
                checkOn: check.checkOn,
                filterType: filterType,
                value: check.value,
              },
            );

            expect({ processes, check, filterType, result }).toEqual({
              processes,
              check,
              filterType,
              result: null,
            });
          }
        }
      }
    });

    /*
     * A process the agent could not read the command line of (a protected
     * Windows process) is reported with its name and an empty command.
     */
    test("a process reported with an empty command is still running by its name", async () => {
      const response: ServerMonitorResponse = buildServerResponse({
        processes: [
          buildProcess({ name: "nginx" }),
          buildProcess({ pid: 640, name: "lsass.exe", command: "" }),
        ],
      });

      expect(
        await evaluate(response, {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsNotExecuting,
          value: "lsass.exe",
        }),
      ).toBeNull();
      expect(
        await evaluate(response, {
          checkOn: CheckOn.ServerProcessName,
          filterType: FilterType.IsExecuting,
          value: "LSASS.EXE",
        }),
      ).toBe("Process LSASS.EXE is executing.");
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
   * The evaluate-over-time path replaces the current metric value with the
   * window recorded for the monitor. The DB-backed lookup is spied so these
   * tests stay deterministic.
   */
  describe("evaluate over time", () => {
    /** The window produced a usable value. */
    function usable(
      value: Array<number | boolean> | number | boolean,
    ): OverTimeCriteriaValue {
      return { earlyReturn: null, value: value };
    }

    /** The window could not back the filter, so nothing is compared. */
    function noUsableWindow(): OverTimeCriteriaValue {
      return { earlyReturn: { result: null }, value: undefined };
    }

    function mockOverTime(
      result: OverTimeCriteriaValue,
    ): ReturnType<typeof jest.spyOn> {
      return jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockResolvedValue(result) as ReturnType<typeof jest.spyOn>;
    }

    test("uses the over-time boolean series for IsOnline while online", async () => {
      const spy: ReturnType<typeof jest.spyOn> = mockOverTime(
        usable([true, false]),
      );

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
          criteriaFilter: expect.objectContaining({
            checkOn: CheckOn.IsOnline,
          }),
        }),
      );
    });

    /*
     * timeValueInMinutes overrides the default offline threshold: a 5 minute
     * gap is still "online" when the window is 10 minutes, which would have
     * been offline under the default of 3.
     */
    test("timeValueInMinutes overrides the offline threshold", async () => {
      mockOverTime(usable([false, false]));

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
     * "Is Online" is the one filter that keeps its fallback: for a server
     * monitor the absence of data IS the signal, and the last-check-in
     * arithmetic above already implements the "wait this long" behaviour. So
     * an unusable window still falls back to the "recent check -> online"
     * default rather than declining to evaluate.
     */
    test("empty over-time series falls back to the liveness default", async () => {
      mockOverTime(noUsableWindow());

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
      mockOverTime(usable([70, 80]));

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
     * Only the disk-usage series carries a diskPath attribute. Scoping any
     * other series by it would filter against an attribute no row has, and
     * an unusable window now means the filter waits rather than comparing
     * the live value - so the stray option would silence it outright.
     */
    test("scopes the window by disk path only for disk usage", async () => {
      const spy: ReturnType<typeof jest.spyOn> = mockOverTime(usable([95]));

      await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({ diskPath: "/data", percentUsed: 95 }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "/data" },
        },
      );

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ miscData: { diskPath: "/data" } }),
      );
    });

    /*
     * The window is read by the diskPath the agent stores each disk's rows
     * under, which is an exact match. It used to be read by the path as
     * typed, so "C:\" (stored "C:"), a trailing slash, a different case or
     * a device name found no rows and the filter never fired; and an empty
     * path scoped nothing, mixing every disk's rows into one window.
     */
    test("reads a disk's window by the path the agent reports it under, whatever was typed", async () => {
      const response: ServerMonitorResponse = buildServerResponse({
        metrics: buildMetrics({
          diskMetrics: [
            {
              ...buildDiskMetric({ diskPath: "/", percentUsed: 40 }),
              device: "/dev/sda1",
            },
            buildDiskMetric({ diskPath: "/mnt/Data", percentUsed: 95 }),
            buildDiskMetric({ diskPath: "C:", percentUsed: 95 }),
          ],
        }),
      });

      const cases: Array<{ typed: string | undefined; read: string }> = [
        { typed: "C:\\", read: "C:" },
        { typed: "c:", read: "C:" },
        { typed: "/mnt/data/", read: "/mnt/Data" },
        { typed: "/dev/sda1", read: "/" },
        { typed: "", read: "/" },
        { typed: undefined, read: "/" },
        // Not in this report: written as the agent writes it.
        { typed: "d:\\", read: "D:" },
        { typed: "/backup/", read: "/backup" },
      ];

      for (const entry of cases) {
        const spy: ReturnType<typeof jest.spyOn> = mockOverTime(usable([95]));

        await evaluate(response, {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          ...(entry.typed === undefined
            ? {}
            : { serverMonitorOptions: { diskPath: entry.typed } }),
        });

        expect({
          typed: entry.typed,
          read: spy.mock.calls.map((call: Array<unknown>): unknown => {
            return (call[0] as { miscData: unknown }).miscData;
          }),
        }).toEqual({ typed: entry.typed, read: [{ diskPath: entry.read }] });

        spy.mockRestore();
      }
    });

    /*
     * "*" is no disk's path, so a window read for it held nothing: with the
     * default no-data policy "any disk over 90% for 5 minutes" never fired.
     * Each disk the agent reported is judged on its own window.
     */
    test('judges each disk on its own window for a "*" Disk Path', async () => {
      const spy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockImplementation(
          async (data: {
            miscData?: JSONObject | undefined;
          }): Promise<OverTimeCriteriaValue> => {
            return usable(
              data.miscData?.["diskPath"] === "/data" ? [96, 97] : [10],
            );
          },
        ) as ReturnType<typeof jest.spyOn>;

      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [
              buildDiskMetric({ diskPath: "/", percentUsed: 10 }),
              buildDiskMetric({ diskPath: "/data", percentUsed: 10 }),
            ],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "*" },
        },
      );

      expect(result).toContain("Disk /data - ");
      expect(
        spy.mock.calls.map((call: Array<unknown>): unknown => {
          return (call[0] as { miscData: unknown }).miscData;
        }),
      ).toEqual([{ diskPath: "/" }, { diskPath: "/data" }]);
    });

    test("does not scope a CPU window by a stray disk path", async () => {
      const spy: ReturnType<typeof jest.spyOn> = mockOverTime(usable([70, 80]));

      await evaluate(
        buildServerResponse({ metrics: buildMetrics({ cpuPercentUsed: 75 }) }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 50,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "/" },
        },
      );

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ miscData: undefined }),
      );
    });

    /*
     * Disk usage read its over-time window and then threw the result away,
     * comparing the reading from this check instead - so "evaluate over
     * time" on a disk filter did nothing at all.
     */
    test("disk usage compares the over-time window, not just this check", async () => {
      mockOverTime(usable([95, 96, 97]));

      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [buildDiskMetric({ diskPath: "/", percentUsed: 10 })],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "/" },
        },
      );

      expect(result).toBe(
        "Disk Usage (in %) on disk / over the last 5 minutes ranged from 95 to 97 across all 3 readings, above the 90 threshold.",
      );
    });

    test("disk usage does not fire while its window is unusable", async () => {
      mockOverTime(noUsableWindow());

      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [buildDiskMetric({ diskPath: "/", percentUsed: 99 })],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
          serverMonitorOptions: { diskPath: "/" },
        },
      );

      expect(result).toBeNull();
    });

    /*
     * A disk filter that does NOT evaluate over time keeps comparing the
     * reading from this check.
     */
    test("disk usage without over-time still compares this check", async () => {
      const result: string | null = await evaluate(
        buildServerResponse({
          metrics: buildMetrics({
            diskMetrics: [buildDiskMetric({ diskPath: "/", percentUsed: 99 })],
          }),
        }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "/" },
        },
      );

      expect(result).toContain("99");
    });

    /*
     * An average of exactly zero is a real measurement, not a missing one.
     * It used to be swallowed by a truthiness check and replaced with the
     * live CPU reading, so "average CPU over 5 minutes above 50%" could fire
     * on a single busy sample while the average itself was 0.
     */
    test("a zero aggregate is compared as zero, not replaced by the live metric", async () => {
      mockOverTime(usable(0));

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

      expect(result).toBeNull();
    });

    /*
     * A window that could not be read says nothing about the last five
     * minutes, so the filter waits rather than firing off the single live
     * reading that happens to have arrived with this check.
     */
    test("an unreadable window does not fire off the live CPU metric", async () => {
      mockOverTime(noUsableWindow());

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

      expect(result).toBeNull();
    });
  });
});

/*
 * What the evaluation summary says a server criteria saw when it was not met:
 * the root cause someone reads to find out why nothing fired. It finds the
 * disk and the processes the way the criteria does.
 */
describe("the observation a Server / VM criteria is explained with", () => {
  function observe(
    dataToProcess: ServerMonitorResponse,
    criteriaFilter: CriteriaFilter,
  ): string | null {
    return MonitorCriteriaObservationBuilder.describeFilterObservation({
      monitor: new Monitor(),
      criteriaFilter: criteriaFilter,
      dataToProcess: dataToProcess,
      monitorStep: new MonitorStep(),
    });
  }

  const disks: Array<BasicDiskMetrics> = [
    {
      ...buildDiskMetric({ diskPath: "/", percentUsed: 40 }),
      device: "/dev/sda1",
    },
    buildDiskMetric({ diskPath: "/data", percentUsed: 85 }),
  ];

  test("names the disks the agent reported when the Disk Path names none of them", () => {
    expect(
      observe(
        buildServerResponse({ metrics: buildMetrics({ diskMetrics: disks }) }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "/backup" },
        },
      ),
    ).toBe(
      "Disk metrics did not include path /backup: no disk the agent reported is mounted there or is that device. It reported /, /data.",
    );
  });

  test("describes the disk a device name or a differently written path names", () => {
    for (const typed of ["/dev/sda1", "/data/"]) {
      const observation: string | null = observe(
        buildServerResponse({ metrics: buildMetrics({ diskMetrics: disks }) }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: typed },
        },
      );

      expect(observation).toContain(`on disk ${typed} was`);
      expect(observation).toContain(typed === "/data/" ? "85" : "40");
    }
  });

  test('describes the fullest disk for a "*" Disk Path', () => {
    expect(
      observe(
        buildServerResponse({ metrics: buildMetrics({ diskMetrics: disks }) }),
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
          serverMonitorOptions: { diskPath: "*" },
        },
      ),
    ).toContain(
      "of the fullest of the 2 disk(s) the agent reported, /data, was 85",
    );
  });

  test("says the CPU metrics were unavailable when the report's are null", () => {
    expect(
      observe(
        buildServerResponse({
          metrics: {
            ...buildMetrics({}),
            cpuMetrics: null,
          } as unknown as BasicInfrastructureMetrics,
        }),
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ),
    ).toBe("CPU usage metrics were unavailable.");
  });

  test("says the process list was missing rather than that the process was not running", () => {
    for (const checkOn of [
      CheckOn.ServerProcessName,
      CheckOn.ServerProcessPID,
      CheckOn.ServerProcessCommand,
    ]) {
      const observation: string | null = observe(buildServerResponse({}), {
        checkOn: checkOn,
        filterType: FilterType.IsNotExecuting,
        value: "nginx",
      });

      expect(observation).toContain("The agent's report had no process list");
      expect(observation).not.toContain("was not running");
    }
  });
});
