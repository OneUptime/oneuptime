import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import PerEntityCriteriaFanOut from "../PerEntityCriteriaFanOut";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import MonitorCriteriaMessageFormatter from "../MonitorCriteriaMessageFormatter";
import OneUptimeDate from "../../../../Types/Date";
import BasicInfrastructureMetrics, {
  BasicDiskMetrics,
  CPUMetrics,
  LoadMetrics,
  MemoryMetrics,
} from "../../../../Types/Infrastructure/BasicMetrics";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ServerMonitorResponse, {
  ServerProcess,
} from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ReceivingSilence from "../ReceivingSilence";
import { withoutTrailingSlashes } from "../../../../Utils/TrailingRuns";

/*
 * A Windows drive as the agent names it: its letter and a colon ("C:").
 */
const WINDOWS_DRIVE: RegExp = /^[a-z]:$/i;

export default class ServerMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold, so a
     * monitor that has only just started is not mistaken for one whose
     * whole window is breaching.
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    // Server Monitoring Checks

    const serverResponse: ServerMonitorResponse =
      input.dataToProcess as ServerMonitorResponse;

    /*
     * Disk usage names one disk, or every disk ("*"), so the disk is found
     * in the report before its over-time window is read: the window is read
     * for the path the agent reports the disk under, never for what was
     * typed.
     */
    if (input.criteriaFilter.checkOn === CheckOn.DiskUsagePercent) {
      return await ServerMonitorCriteria.isDiskUsageCriteriaFilterMet({
        serverResponse: serverResponse,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });
    }

    const threshold: number | string | undefined = input.criteriaFilter.value;
    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: serverResponse.projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        /*
         * Only the disk-usage series carries a diskPath attribute, so no
         * other series is scoped by one: it would filter against an
         * attribute no row has - and an empty window means "cannot judge
         * yet" rather than "compare the live value", which would silence
         * the filter outright.
         */
        miscData: undefined,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter, so the no-data policy
     * has already decided it - do not fall through to the value that arrived
     * with this one check.
     *
     * "Is Online" is exempt: for a server monitor the absence of data IS the
     * signal, and the differenceInMinutes check below already implements the
     * "wait this long before calling it offline" behaviour off the agent's
     * last check-in time. Letting it fall through preserves that.
     */
    if (
      overTime.earlyReturn &&
      input.criteriaFilter.checkOn !== CheckOn.IsOnline
    ) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    const lastCheckTime: Date = serverResponse.requestReceivedAt;

    const timeNow: Date =
      serverResponse.timeNow || OneUptimeDate.getCurrentDate();

    let differenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
      lastCheckTime,
      timeNow,
    );

    let offlineIfNotCheckedInMinutes: number = 3;

    // check evaluate  over time.
    if (
      input.criteriaFilter.evaluateOverTime &&
      input.criteriaFilter.evaluateOverTimeOptions
    ) {
      offlineIfNotCheckedInMinutes =
        input.criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes || 3;
    }

    /*
     * An agent cannot check in while OneUptime itself is not receiving - a
     * restart, an upgrade, a backed-up ingest queue - so that time is not
     * silence the server is blamed for (issue #2825): it is offline once it
     * has been silent for the threshold while OneUptime was receiving. With
     * no such time the two are the same number.
     */
    if (input.criteriaFilter.checkOn === CheckOn.IsOnline) {
      differenceInMinutes = (
        await ReceivingSilence.measure({
          lastHeardAt: lastCheckTime,
          now: timeNow,
          thresholdInMinutes: offlineIfNotCheckedInMinutes,
        })
      ).receivingMinutes;
    }

    logger.debug("Server Monitor Criteria Filter");
    logger.debug(`Monitor ID: ${input.dataToProcess.monitorId}`);
    logger.debug(`Check On: ${input.criteriaFilter.checkOn}`);
    logger.debug(`Difference in Minutes: ${differenceInMinutes}`);
    logger.debug(
      `Offline if not checked in minutes: ${offlineIfNotCheckedInMinutes}`,
    );

    if (
      input.criteriaFilter.checkOn === CheckOn.IsOnline &&
      differenceInMinutes >= offlineIfNotCheckedInMinutes
    ) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ?? false; // false because no request receieved in the last 2 minutes

      logger.debug(`Current Is Online: ${currentIsOnline}`);

      const criteria: string | null = CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });

      logger.debug(`Criteria: ${criteria}`);

      return criteria;
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.IsOnline &&
      differenceInMinutes < offlineIfNotCheckedInMinutes
    ) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ?? true; // true because request receieved in the last 2 minutes

      logger.debug(`Current Is Online: ${currentIsOnline}`);

      const criteria: string | null = CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });

      logger.debug(`Criteria: ${criteria}`);

      return criteria;
    }

    /*
     * The agent sends null for an area it could not read - a macOS agent
     * built without cgo sent "cpuMetrics": null with every report - and
     * leaves out one an older agent does not collect. Each is read through
     * an optional chain: reading a field of null threw, the report was
     * never saved, and the server was marked offline. A metric the report
     * does not have matches nothing; it is not 0.
     */
    const metrics: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;
    const cpuMetrics: CPUMetrics | null | undefined = metrics?.cpuMetrics;
    const memoryMetrics: MemoryMetrics | null | undefined =
      metrics?.memoryMetrics;
    const loadMetrics: LoadMetrics | null | undefined = metrics?.loadMetrics;

    if (
      input.criteriaFilter.checkOn === CheckOn.CPUUsagePercent &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      return ServerMonitorCriteria.compareReading({
        overTimeValue: overTimeValue,
        reading: ServerMonitorCriteria.reportedNumber(cpuMetrics?.percentUsed),
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.MemoryUsagePercent &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      return ServerMonitorCriteria.compareReading({
        overTimeValue: overTimeValue,
        reading: ServerMonitorCriteria.reportedNumber(
          memoryMetrics?.percentUsed,
        ),
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      !serverResponse.onlyCheckRequestReceivedAt &&
      (input.criteriaFilter.checkOn === CheckOn.LoadAverage1Min ||
        input.criteriaFilter.checkOn === CheckOn.LoadAverage5Min ||
        input.criteriaFilter.checkOn === CheckOn.LoadAverage15Min)
    ) {
      let currentLoad: number | undefined = undefined;
      if (input.criteriaFilter.checkOn === CheckOn.LoadAverage1Min) {
        currentLoad = loadMetrics?.load1;
      } else if (input.criteriaFilter.checkOn === CheckOn.LoadAverage5Min) {
        currentLoad = loadMetrics?.load5;
      } else if (input.criteriaFilter.checkOn === CheckOn.LoadAverage15Min) {
        currentLoad = loadMetrics?.load15;
      }

      return ServerMonitorCriteria.compareReading({
        overTimeValue: overTimeValue,
        reading: ServerMonitorCriteria.reportedNumber(currentLoad),
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.SwapUsagePercent &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      /*
       * The agent leaves a zero out of the memory it reports, so a memory
       * reading without swap usage says 0%. No memory reading says nothing.
       */
      return ServerMonitorCriteria.compareReading({
        overTimeValue: overTimeValue,
        reading: memoryMetrics
          ? ServerMonitorCriteria.reportedNumber(
              memoryMetrics.swapPercentUsed,
            ) ?? 0
          : undefined,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.CPUIoWaitPercent &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      // As for swap: the agent leaves a zero out of the CPU it reports.
      return ServerMonitorCriteria.compareReading({
        overTimeValue: overTimeValue,
        reading: cpuMetrics
          ? ServerMonitorCriteria.reportedNumber(
              cpuMetrics.timeIoWaitPercent,
            ) ?? 0
          : undefined,
        criteriaFilter: input.criteriaFilter,
      });
    }

    /*
     * The three process checks below need the report's process list. An
     * agent that could not list the processes sends none, and no list says
     * nothing about any process: "Is Not Executing" must not fire for every
     * process because the list could not be read.
     */
    const processes: Array<ServerProcess> | undefined =
      ServerMonitorCriteria.reportedProcesses(serverResponse);

    if (
      input.criteriaFilter.checkOn === CheckOn.ServerProcessName &&
      threshold &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      if (!processes) {
        return null;
      }

      const thresholdProcessName: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      const processNames: Array<string> = processes.map(
        (item: ServerProcess) => {
          return (item.name || "").trim().toLowerCase();
        },
      );

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        if (processNames.includes(thresholdProcessName)) {
          return `Process ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        if (!processNames.includes(thresholdProcessName)) {
          return `Process ${threshold} is not executing.`;
        }

        return null;
      }
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.ServerProcessPID &&
      threshold &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      if (!processes) {
        return null;
      }

      const thresholdProcessPID: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      const processPIDs: Array<string> = processes.map(
        (item: ServerProcess) => {
          return String(item.pid ?? "")
            .trim()
            .toLowerCase();
        },
      );

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        if (processPIDs.includes(thresholdProcessPID)) {
          return `Process with PID ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        if (!processPIDs.includes(thresholdProcessPID)) {
          return `Process with PID ${threshold} is not executing.`;
        }

        return null;
      }

      return null;
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.ServerProcessCommand &&
      threshold &&
      !serverResponse.onlyCheckRequestReceivedAt
    ) {
      if (!processes) {
        return null;
      }

      const thresholdProcessCommand: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      const processCommands: Array<string> = processes.map(
        (item: ServerProcess) => {
          return (item.command || "").trim().toLowerCase();
        },
      );

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        if (processCommands.includes(thresholdProcessCommand)) {
          return `Process with command ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        if (!processCommands.includes(thresholdProcessCommand)) {
          return `Process with command ${threshold} is not executing.`;
        }

        return null;
      }

      return null;
    }

    return null;
  }

  /*
   * A Disk Path written the one way both sides are compared in: trimmed,
   * lower case, "\" as "/", and without the "/" that ends it - so "C:\" is
   * the "C:" the agent reports, and "/mnt/data/" and "/MNT/DATA" are its
   * "/mnt/data". An empty path is the root disk, "/".
   */
  public static normalizeDiskPath(value: string | undefined | null): string {
    let normalized: string = (value || "").trim().toLowerCase();

    if (normalized === "/") {
      return normalized;
    }

    normalized = normalized.replace(/\\/g, "/");
    normalized = withoutTrailingSlashes(normalized);

    if (normalized === "") {
      return "/";
    }

    return normalized;
  }

  /*
   * The disk a Disk Path names in a report: the disk mounted at that path
   * or, when none is, the disk on that device ("/dev/sda1"), both compared
   * as normalizeDiskPath writes them. Undefined when the report has neither.
   */
  public static findDiskMetric(data: {
    diskMetrics: Array<BasicDiskMetrics> | undefined | null;
    diskPath: string | undefined | null;
  }): BasicDiskMetrics | undefined {
    const wanted: string = ServerMonitorCriteria.normalizeDiskPath(
      data.diskPath,
    );
    const disks: Array<BasicDiskMetrics> = (data.diskMetrics || []).filter(
      (disk: BasicDiskMetrics | null | undefined): boolean => {
        return Boolean(disk);
      },
    );

    return (
      disks.find((disk: BasicDiskMetrics): boolean => {
        return (
          Boolean((disk.diskPath || "").trim()) &&
          ServerMonitorCriteria.normalizeDiskPath(disk.diskPath) === wanted
        );
      }) ||
      disks.find((disk: BasicDiskMetrics): boolean => {
        return (
          Boolean((disk.device || "").trim()) &&
          ServerMonitorCriteria.normalizeDiskPath(disk.device) === wanted
        );
      })
    );
  }

  /*
   * A Disk Path written the way the agent writes the path of the disk it
   * names: the over-time window is read for that, when the report does not
   * have the disk to take its path from. "C:\" and "c:" are the agent's
   * "C:", "/mnt/data/" is its "/mnt/data", and an empty path is "/".
   */
  public static toAgentDiskPath(value: string | undefined | null): string {
    const path: string =
      withoutTrailingSlashes((value || "").trim().replace(/\\/g, "/")) || "/";

    if (WINDOWS_DRIVE.test(path)) {
      return path.toUpperCase();
    }

    return path;
  }

  /*
   * Disk usage: the disk the Disk Path names, or with "*" every disk the
   * agent reported.
   */
  private static async isDiskUsageCriteriaFilterMet(input: {
    serverResponse: ServerMonitorResponse;
    criteriaFilter: CriteriaFilter;
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    const diskPath: string | undefined =
      input.criteriaFilter.serverMonitorOptions?.diskPath;

    const allDiskMetrics: Array<BasicDiskMetrics> = (
      input.serverResponse.basicInfrastructureMetrics?.diskMetrics || []
    ).filter((disk: BasicDiskMetrics | null | undefined): boolean => {
      return Boolean(disk);
    });

    /*
     * "*" means every disk the agent reported. The criteria is met when
     * ANY of them breaches, mirroring how a grouped metric monitor's
     * criteria is met when any series breaches. The per-entity pass then
     * re-runs this filter once per disk to work out which ones, so each
     * full mount gets its own alert instead of the first one silencing the
     * rest. Each disk is judged on its own window too: "*" is never a path
     * the agent reports, so a window read for it held nothing.
     */
    if (PerEntityCriteriaFanOut.isWildcard(diskPath)) {
      for (const candidateDisk of allDiskMetrics) {
        const candidateResult: string | null =
          await ServerMonitorCriteria.isOneDiskUsageMet({
            serverResponse: input.serverResponse,
            criteriaFilter: input.criteriaFilter,
            monitoringInterval: input.monitoringInterval,
            agentDiskPath: candidateDisk.diskPath,
            disk: candidateDisk,
          });

        if (candidateResult) {
          return `Disk ${candidateDisk.diskPath} - ${candidateResult}`;
        }
      }

      return null;
    }

    const diskMetric: BasicDiskMetrics | undefined =
      ServerMonitorCriteria.findDiskMetric({
        diskMetrics: allDiskMetrics,
        diskPath: diskPath,
      });

    return await ServerMonitorCriteria.isOneDiskUsageMet({
      serverResponse: input.serverResponse,
      criteriaFilter: input.criteriaFilter,
      monitoringInterval: input.monitoringInterval,
      agentDiskPath:
        diskMetric?.diskPath || ServerMonitorCriteria.toAgentDiskPath(diskPath),
      disk: diskMetric,
    });
  }

  /*
   * One disk's usage against the filter: over its window when the filter
   * evaluates over time, else the reading in this report. A disk the report
   * does not have has no reading, and matches nothing - not 0% - so a path
   * that names no disk never passes for an empty one.
   */
  private static async isOneDiskUsageMet(input: {
    serverResponse: ServerMonitorResponse;
    criteriaFilter: CriteriaFilter;
    monitoringInterval?: string | undefined;
    // The path the agent reports the disk under, which its window is read by.
    agentDiskPath: string;
    disk: BasicDiskMetrics | undefined;
  }): Promise<string | null> {
    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: input.serverResponse.projectId,
        monitorId: input.serverResponse.monitorId,
        criteriaFilter: input.criteriaFilter,
        miscData: { diskPath: input.agentDiskPath },
        monitoringInterval: input.monitoringInterval,
      });

    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    if (input.serverResponse.onlyCheckRequestReceivedAt) {
      return null;
    }

    /*
     * Usage is percentUsed. Free space is not usage: the percentFree the
     * comparison used to fall back to read an empty disk as a full one.
     */
    return ServerMonitorCriteria.compareReading({
      overTimeValue: overTime.value,
      reading: input.disk
        ? MonitorCriteriaMessageFormatter.computeDiskUsagePercent(input.disk) ??
          undefined
        : undefined,
      criteriaFilter: input.criteriaFilter,
    });
  }

  /*
   * Compare a numeric filter: the over-time window's value when there is
   * one, else this report's reading. With neither there is nothing to
   * compare, and the filter is not met.
   */
  private static compareReading(input: {
    overTimeValue: Array<number | boolean> | number | boolean | undefined;
    reading: number | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    const value: Array<number> | number | undefined =
      (input.overTimeValue as Array<number> | number | undefined) ??
      input.reading;

    if (value === undefined || value === null) {
      return null;
    }

    const threshold: number | null = CompareCriteria.convertToNumber(
      input.criteriaFilter.value,
    );

    return CompareCriteria.compareCriteriaNumbers({
      value: value,
      threshold: threshold as number,
      criteriaFilter: input.criteriaFilter,
    });
  }

  // A number the agent reported, or undefined for one it did not.
  private static reportedNumber(value: unknown): number | undefined {
    if (typeof value !== "number" || isNaN(value)) {
      return undefined;
    }

    return value;
  }

  /*
   * The report's processes, or undefined when it has none to judge: an
   * agent that could not list them sends no list (an older one sent null),
   * and a server is never without a process, so an empty list was not read
   * either.
   */
  public static reportedProcesses(
    serverResponse: ServerMonitorResponse,
  ): Array<ServerProcess> | undefined {
    const processes: Array<ServerProcess> = Array.isArray(
      serverResponse.processes,
    )
      ? serverResponse.processes.filter(
          (process: ServerProcess | null | undefined): boolean => {
            return Boolean(process);
          },
        )
      : [];

    return processes.length > 0 ? processes : undefined;
  }
}
