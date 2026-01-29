import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import EvaluateOverTime from "./EvaluateOverTime";
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
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;
    let overTimeValue: Array<number | boolean> | number | boolean | undefined =
      undefined;

    if (
      input.criteriaFilter.evaluateOverTime &&
      input.criteriaFilter.evaluateOverTimeOptions
    ) {
      try {
        overTimeValue = await EvaluateOverTime.getValueOverTime({
          projectId: (input.dataToProcess as ServerMonitorResponse).projectId,
          monitorId: input.dataToProcess.monitorId!,
          evaluateOverTimeOptions: input.criteriaFilter.evaluateOverTimeOptions,
          metricType: input.criteriaFilter.checkOn,
          miscData: input.criteriaFilter.serverMonitorOptions as JSONObject,
        });

        if (Array.isArray(overTimeValue) && overTimeValue.length === 0) {
          overTimeValue = undefined;
        }
      } catch (err) {
        logger.error(
          `Error in getting over time value for ${input.criteriaFilter.checkOn}`,
        );
        logger.error(err);
        overTimeValue = undefined;
      }
    }

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
        (overTimeValue as Array<boolean>) || false; // false because no request receieved in the last 2 minutes

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
        (overTimeValue as Array<boolean>) || true; // true because request receieved in the last 2 minutes

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
        (overTimeValue as Array<number>) ||
        (input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.cpuMetrics.percentUsed ||
        0;

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
        (overTimeValue as Array<number>) ||
        (input.dataToProcess as ServerMonitorResponse)
          .basicInfrastructureMetrics?.memoryMetrics.percentUsed ||
        0;

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

      const diskMetric: BasicDiskMetrics | undefined = (
        input.dataToProcess as ServerMonitorResponse
      ).basicInfrastructureMetrics?.diskMetrics.find(
        (item: BasicDiskMetrics) => {
          return normalizeDiskPath(item.diskPath) === normalizedDiskPath;
        },
      );

      const diskUsagePercent: number =
        diskMetric?.percentUsed ?? diskMetric?.percentFree ?? 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: diskUsagePercent,
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
