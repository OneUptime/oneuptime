import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import PerEntityCriteriaFanOut from "../PerEntityCriteriaFanOut";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import OneUptimeDate from "../../../../Types/Date";
import { BasicDiskMetrics } from "../../../../Types/Infrastructure/BasicMetrics";
import { JSONObject } from "../../../../Types/JSON";
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

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;
    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: (input.dataToProcess as ServerMonitorResponse).projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        /*
         * Only the disk-usage series carries a diskPath attribute, so
         * scoping any other series by it would filter against an attribute
         * no row has - and an empty window now means "cannot judge yet"
         * rather than "compare the live value", which would silence the
         * filter outright.
         */
        miscData:
          input.criteriaFilter.checkOn === CheckOn.DiskUsagePercent
            ? (input.criteriaFilter.serverMonitorOptions as JSONObject)
            : undefined,
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

    const lastCheckTime: Date = (input.dataToProcess as ServerMonitorResponse)
      .requestReceivedAt;

    const timeNow: Date =
      (input.dataToProcess as ServerMonitorResponse).timeNow ||
      OneUptimeDate.getCurrentDate();

    const differenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
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

    logger.debug("Server Monitor Criteria Filter");
    logger.debug(`Monitor ID: ${input.dataToProcess.monitorId}`);
    logger.debug(`Check On: ${input.criteriaFilter.checkOn}`);
    logger.debug(`Difference in Minutes: ${differenceInMinutes}`);
    logger.debug(
      `Offline if not checked in minutes: ${offlineIfNotCheckedInMinutes}`,
    );

    const normalizeDiskPath: (value: string | undefined | null) => string = (
      value: string | undefined | null,
    ): string => {
      let normalized: string = (value || "").trim().toLowerCase();

      if (normalized === "/") {
        return normalized;
      }

      normalized = normalized.replace(/\\/g, "/");
      normalized = normalized.replace(/\/+$/g, "");

      if (normalized === "") {
        return "/";
      }

      return normalized;
    };

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

    if (
      input.criteriaFilter.checkOn === CheckOn.CPUUsagePercent &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentCpuPercent: number | Array<number> =
        (overTimeValue as Array<number>) ??
        ((input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.cpuMetrics.percentUsed ||
          0);

      return CompareCriteria.compareCriteriaNumbers({
        value: currentCpuPercent,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.MemoryUsagePercent &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const memoryPercent: number | Array<number> =
        (overTimeValue as Array<number>) ??
        ((input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.memoryMetrics.percentUsed ||
          0);

      return CompareCriteria.compareCriteriaNumbers({
        value: memoryPercent,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.DiskUsagePercent &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const diskPath: string =
        input.criteriaFilter.serverMonitorOptions?.diskPath || "/";

      const normalizedDiskPath: string = normalizeDiskPath(diskPath);

      const allDiskMetrics: Array<BasicDiskMetrics> =
        (input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.diskMetrics || [];

      /*
       * "*" means every disk the agent reported. The criteria is met
       * when ANY of them breaches, mirroring how a grouped metric
       * monitor's criteria is met when any series breaches. The
       * per-entity pass then re-runs this filter once per disk to work
       * out which ones, so each full mount gets its own alert instead
       * of the first one silencing the rest.
       */
      if (PerEntityCriteriaFanOut.isWildcard(diskPath)) {
        for (const candidateDisk of allDiskMetrics) {
          const candidateUsage: number =
            candidateDisk.percentUsed ?? candidateDisk.percentFree ?? 0;

          const candidateResult: string | null =
            CompareCriteria.compareCriteriaNumbers({
              value: candidateUsage,
              threshold: threshold as number,
              criteriaFilter: input.criteriaFilter,
            });

          if (candidateResult) {
            return `Disk ${candidateDisk.diskPath} - ${candidateResult}`;
          }
        }

        return null;
      }

      const diskMetric: BasicDiskMetrics | undefined = allDiskMetrics.find(
        (item: BasicDiskMetrics) => {
          return normalizeDiskPath(item.diskPath) === normalizedDiskPath;
        },
      );

      const diskUsagePercent: number =
        diskMetric?.percentUsed ?? diskMetric?.percentFree ?? 0;

      /*
       * Disk usage was the one server metric that computed its over-time
       * window and then threw it away, comparing the reading from this check
       * instead - so "evaluate over time" was a no-op here.
       */
      const value: number | Array<number> =
        (overTimeValue as Array<number>) ?? diskUsagePercent;

      return CompareCriteria.compareCriteriaNumbers({
        value: value,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      !(input.dataToProcess as ServerMonitorResponse)
        .onlyCheckRequestReceivedAt &&
      (input.criteriaFilter.checkOn === CheckOn.LoadAverage1Min ||
        input.criteriaFilter.checkOn === CheckOn.LoadAverage5Min ||
        input.criteriaFilter.checkOn === CheckOn.LoadAverage15Min)
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const loadMetrics:
        | { load1: number; load5: number; load15: number }
        | undefined = (input.dataToProcess as ServerMonitorResponse)
        .basicInfrastructureMetrics?.loadMetrics;

      let currentLoad: number | undefined = undefined;
      if (input.criteriaFilter.checkOn === CheckOn.LoadAverage1Min) {
        currentLoad = loadMetrics?.load1;
      } else if (input.criteriaFilter.checkOn === CheckOn.LoadAverage5Min) {
        currentLoad = loadMetrics?.load5;
      } else if (input.criteriaFilter.checkOn === CheckOn.LoadAverage15Min) {
        currentLoad = loadMetrics?.load15;
      }

      const value: number | Array<number> =
        (overTimeValue as Array<number>) ?? (currentLoad || 0);

      return CompareCriteria.compareCriteriaNumbers({
        value: value,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.SwapUsagePercent &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const swapPercent: number | Array<number> =
        (overTimeValue as Array<number>) ??
        ((input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.memoryMetrics?.swapPercentUsed ||
          0);

      return CompareCriteria.compareCriteriaNumbers({
        value: swapPercent,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.CPUIoWaitPercent &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const ioWaitPercent: number | Array<number> =
        (overTimeValue as Array<number>) ??
        ((input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.cpuMetrics?.timeIoWaitPercent ||
          0);

      return CompareCriteria.compareCriteriaNumbers({
        value: ioWaitPercent,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.ServerProcessName &&
      threshold &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      const thresholdProcessName: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        const processNames: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.name.trim().toLowerCase();
            },
          ) || [];

        if (processNames.includes(thresholdProcessName)) {
          return `Process ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        const processNames: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.name.trim().toLowerCase();
            },
          ) || [];

        if (!processNames.includes(thresholdProcessName)) {
          return `Process ${threshold} is not executing.`;
        }

        return null;
      }
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.ServerProcessPID &&
      threshold &&
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      const thresholdProcessPID: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        const processPIDs: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.pid.toString().trim().toLowerCase();
            },
          ) || [];

        if (processPIDs.includes(thresholdProcessPID)) {
          return `Process with PID ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        const processPIDs: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.pid.toString().trim().toLowerCase();
            },
          ) || [];

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
      !(input.dataToProcess as ServerMonitorResponse).onlyCheckRequestReceivedAt
    ) {
      const thresholdProcessCommand: string = threshold
        .toString()
        .trim()
        .toLowerCase();

      if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
        const processCommands: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.command.trim().toLowerCase();
            },
          ) || [];

        if (processCommands.includes(thresholdProcessCommand)) {
          return `Process with command ${threshold} is executing.`;
        }

        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
        const processCommands: Array<string> =
          (input.dataToProcess as ServerMonitorResponse)?.processes?.map(
            (item: ServerProcess) => {
              return item.command.trim().toLowerCase();
            },
          ) || [];

        if (!processCommands.includes(thresholdProcessCommand)) {
          return `Process with command ${threshold} is not executing.`;
        }

        return null;
      }

      return null;
    }

    return null;
  }
}
