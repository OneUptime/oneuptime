import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import DataToProcess from "./DataToProcess";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse, {
  ServerProcess,
} from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import BasicInfrastructureMetrics from "../../../Types/Infrastructure/BasicMetrics";
import Typeof from "../../../Types/Typeof";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";

export default class MonitorCriteriaMessageBuilder {
  public static buildCriteriaFilterMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    didMeetCriteria: boolean;
    matchMessage: string | null;
  }): string {
    if (input.matchMessage) {
      return input.matchMessage;
    }

    if (input.didMeetCriteria) {
      const description: string =
        MonitorCriteriaMessageBuilder.getCriteriaFilterDescription(
          input.criteriaFilter,
        );

      return `${description} condition met.`;
    }

    const failureMessage: string | null =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterFailureMessage({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (failureMessage) {
      return failureMessage;
    }

    const description: string =
      MonitorCriteriaMessageBuilder.getCriteriaFilterDescription(
        input.criteriaFilter,
      );

    return `${description} condition was not met.`;
  }

  private static getCriteriaFilterDescription(
    criteriaFilter: CriteriaFilter,
  ): string {
    const parts: Array<string> = [criteriaFilter.checkOn];

    if (criteriaFilter.filterType) {
      parts.push(criteriaFilter.filterType);
    }

    if (criteriaFilter.value !== undefined && criteriaFilter.value !== null) {
      parts.push(String(criteriaFilter.value));
    }

    return parts.join(" ").trim();
  }

  private static buildCriteriaFilterFailureMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const expectation: string | null =
      MonitorCriteriaMessageBuilder.describeCriteriaExpectation(
        input.criteriaFilter,
      );

    const observation: string | null =
      MonitorCriteriaMessageBuilder.describeFilterObservation({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (observation) {
      if (expectation) {
        return `${observation} (expected ${expectation}).`;
      }

      return `${observation}; configured filter was not met.`;
    }

    if (expectation) {
      const description: string =
        MonitorCriteriaMessageBuilder.getCriteriaFilterDescription(
          input.criteriaFilter,
        );

      return `${description} did not satisfy the configured condition (${expectation}).`;
    }

    return null;
  }

  private static describeCriteriaExpectation(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    if (!criteriaFilter.filterType) {
      return null;
    }

    let expectation: string;

    const value: string | number | undefined = criteriaFilter.value;

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        expectation = `to be greater than ${value}`;
        break;
      case FilterType.GreaterThanOrEqualTo:
        expectation = `to be greater than or equal to ${value}`;
        break;
      case FilterType.LessThan:
        expectation = `to be less than ${value}`;
        break;
      case FilterType.LessThanOrEqualTo:
        expectation = `to be less than or equal to ${value}`;
        break;
      case FilterType.EqualTo:
        expectation = `to equal ${value}`;
        break;
      case FilterType.NotEqualTo:
        expectation = `to not equal ${value}`;
        break;
      case FilterType.Contains:
        expectation = `to contain ${value}`;
        break;
      case FilterType.NotContains:
        expectation = `to not contain ${value}`;
        break;
      case FilterType.StartsWith:
        expectation = `to start with ${value}`;
        break;
      case FilterType.EndsWith:
        expectation = `to end with ${value}`;
        break;
      case FilterType.IsEmpty:
        expectation = "to be empty";
        break;
      case FilterType.IsNotEmpty:
        expectation = "to not be empty";
        break;
      case FilterType.True:
        expectation = "to be true";
        break;
      case FilterType.False:
        expectation = "to be false";
        break;
      case FilterType.IsExecuting:
        expectation = "to be executing";
        break;
      case FilterType.IsNotExecuting:
        expectation = "to not be executing";
        break;
      case FilterType.RecievedInMinutes:
        expectation = value
          ? `to receive a heartbeat within ${value} minutes`
          : "to receive a heartbeat within the configured window";
        break;
      case FilterType.NotRecievedInMinutes:
        expectation = value
          ? `to miss a heartbeat for at least ${value} minutes`
          : "to miss a heartbeat within the configured window";
        break;
      case FilterType.EvaluatesToTrue:
        expectation = "to evaluate to true";
        break;
      default:
        expectation = `${criteriaFilter.filterType}${value ? ` ${value}` : ""}`;
        break;
    }

    const evaluationWindow: string | null =
      MonitorCriteriaMessageBuilder.getEvaluationWindowDescription(
        criteriaFilter,
      );

    if (evaluationWindow) {
      expectation += ` ${evaluationWindow}`;
    }

    return expectation.trim();
  }

  private static getEvaluationWindowDescription(
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const parts: Array<string> = [];

    if (
      criteriaFilter.eveluateOverTime &&
      criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
    ) {
      parts.push(
        `over the last ${criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes} minutes`,
      );
    }

    const aggregation: string | undefined =
      criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
      criteriaFilter.metricMonitorOptions?.metricAggregationType;

    if (aggregation) {
      parts.push(`using ${aggregation.toLowerCase()}`);
    }

    if (!parts.length) {
      return null;
    }

    return parts.join(" ");
  }

  private static describeFilterObservation(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const { criteriaFilter } = input;

    switch (criteriaFilter.checkOn) {
      case CheckOn.ResponseTime:
        return MonitorCriteriaMessageBuilder.describeResponseTimeObservation(
          input,
        );
      case CheckOn.ResponseStatusCode:
        return MonitorCriteriaMessageBuilder.describeResponseStatusCodeObservation(
          input,
        );
      case CheckOn.ResponseHeader:
        return MonitorCriteriaMessageBuilder.describeResponseHeaderObservation(
          input,
        );
      case CheckOn.ResponseHeaderValue:
        return MonitorCriteriaMessageBuilder.describeResponseHeaderValueObservation(
          input,
        );
      case CheckOn.ResponseBody:
        return MonitorCriteriaMessageBuilder.describeResponseBodyObservation(
          input,
        );
      case CheckOn.IsOnline:
        return MonitorCriteriaMessageBuilder.describeIsOnlineObservation(
          input,
        );
      case CheckOn.IsRequestTimeout:
        return MonitorCriteriaMessageBuilder.describeIsTimeoutObservation(
          input,
        );
      case CheckOn.IncomingRequest:
        return MonitorCriteriaMessageBuilder.describeIncomingRequestObservation(
          input,
        );
      case CheckOn.RequestBody:
        return MonitorCriteriaMessageBuilder.describeRequestBodyObservation(
          input,
        );
      case CheckOn.RequestHeader:
        return MonitorCriteriaMessageBuilder.describeRequestHeaderObservation(
          input,
        );
      case CheckOn.RequestHeaderValue:
        return MonitorCriteriaMessageBuilder.describeRequestHeaderValueObservation(
          input,
        );
      case CheckOn.JavaScriptExpression:
        return MonitorCriteriaMessageBuilder.describeJavaScriptExpressionObservation(
          input,
        );
      case CheckOn.CPUUsagePercent:
        return MonitorCriteriaMessageBuilder.describeCpuUsageObservation(input);
      case CheckOn.MemoryUsagePercent:
        return MonitorCriteriaMessageBuilder.describeMemoryUsageObservation(
          input,
        );
      case CheckOn.DiskUsagePercent:
        return MonitorCriteriaMessageBuilder.describeDiskUsageObservation(input);
      case CheckOn.ServerProcessName:
        return MonitorCriteriaMessageBuilder.describeServerProcessNameObservation(
          input,
        );
      case CheckOn.ServerProcessPID:
        return MonitorCriteriaMessageBuilder.describeServerProcessPidObservation(
          input,
        );
      case CheckOn.ServerProcessCommand:
        return MonitorCriteriaMessageBuilder.describeServerProcessCommandObservation(
          input,
        );
      case CheckOn.ExpiresInHours:
        return MonitorCriteriaMessageBuilder.describeCertificateExpiresInHoursObservation(
          input,
        );
      case CheckOn.ExpiresInDays:
        return MonitorCriteriaMessageBuilder.describeCertificateExpiresInDaysObservation(
          input,
        );
      case CheckOn.IsSelfSignedCertificate:
        return MonitorCriteriaMessageBuilder.describeIsSelfSignedObservation(
          input,
        );
      case CheckOn.IsExpiredCertificate:
        return MonitorCriteriaMessageBuilder.describeIsExpiredObservation(
          input,
        );
      case CheckOn.IsValidCertificate:
        return MonitorCriteriaMessageBuilder.describeIsValidObservation(input);
      case CheckOn.IsNotAValidCertificate:
        return MonitorCriteriaMessageBuilder.describeIsInvalidObservation(input);
      case CheckOn.ResultValue:
        return MonitorCriteriaMessageBuilder.describeResultValueObservation(
          input,
        );
      case CheckOn.Error:
        return MonitorCriteriaMessageBuilder.describeErrorObservation(input);
      case CheckOn.ExecutionTime:
        return MonitorCriteriaMessageBuilder.describeExecutionTimeObservation(
          input,
        );
      case CheckOn.ScreenSizeType:
        return MonitorCriteriaMessageBuilder.describeScreenSizeObservation(
          input,
        );
      case CheckOn.BrowserType:
        return MonitorCriteriaMessageBuilder.describeBrowserObservation(input);
      case CheckOn.LogCount:
        return MonitorCriteriaMessageBuilder.describeLogCountObservation(input);
      case CheckOn.SpanCount:
        return MonitorCriteriaMessageBuilder.describeSpanCountObservation(input);
      case CheckOn.MetricValue:
        return MonitorCriteriaMessageBuilder.describeMetricValueObservation(
          input,
        );
      default:
        return null;
    }
  }

  private static describeResponseTimeObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return null;
    }

    const responseTime: number | undefined =
      probeResponse.responseTimeInMs ?? undefined;

    if (responseTime === undefined || responseTime === null) {
      return "Response time metric was not recorded";
    }

    const formatted: string | null =
      MonitorCriteriaMessageBuilder.formatNumber(responseTime, {
        maximumFractionDigits: 2,
      });

    const evaluationWindow: string | null =
      MonitorCriteriaMessageBuilder.getEvaluationWindowDescription(
        input.criteriaFilter,
      );

    let message: string = `Response Time (in ms) was ${formatted ?? responseTime} ms`;

    if (evaluationWindow) {
      message += ` ${evaluationWindow}`;
    }

    return message;
  }

  private static describeResponseStatusCodeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return null;
    }

    if (probeResponse.responseCode === undefined) {
      return "Response status code was not recorded";
    }

    return `Response Status Code was ${probeResponse.responseCode}.`;
  }

  private static describeResponseHeaderObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return null;
    }

    const headers: Array<string> = Object.keys(
      probeResponse.responseHeaders || {},
    ).map((header: string) => {
      return header.toLowerCase();
    });

    if (!headers.length) {
      return "Response headers were empty.";
    }

    return `Response headers present: ${MonitorCriteriaMessageBuilder.formatList(headers)}.`;
  }

  private static describeResponseHeaderValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return null;
    }

    const headerValues: Array<string> = Object.values(
      probeResponse.responseHeaders || {},
    ).map((value: string) => {
      return value.toLowerCase();
    });

    if (!headerValues.length) {
      return "Response header values were empty.";
    }

    return `Response header values: ${MonitorCriteriaMessageBuilder.formatList(headerValues)}.`;
  }

  private static describeResponseBodyObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return null;
    }

    if (!probeResponse.responseBody) {
      return "Response body was empty.";
    }

    let bodyAsString: string;

    if (typeof probeResponse.responseBody === Typeof.Object) {
      try {
        bodyAsString = JSON.stringify(probeResponse.responseBody);
      } catch (err) {
        logger.error(err);
        bodyAsString = "[object]";
      }
    } else {
      bodyAsString = probeResponse.responseBody as string;
    }

    return `Response body sample: ${MonitorCriteriaMessageBuilder.formatSnippet(bodyAsString)}.`;
  }

  private static describeIsOnlineObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (probeResponse && probeResponse.isOnline !== undefined) {
      return `Monitor reported ${
        probeResponse.isOnline ? "online" : "offline"
      } status at ${OneUptimeDate.getDateAsLocalFormattedString(
        probeResponse.monitoredAt,
      )}.`;
    }

    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (serverResponse) {
      const lastHeartbeat: Date = serverResponse.requestReceivedAt;
      const timeNow: Date =
        serverResponse.timeNow || OneUptimeDate.getCurrentDate();
      const minutesSinceHeartbeat: number =
        OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, timeNow);

      const formattedMinutes: string | null =
        MonitorCriteriaMessageBuilder.formatNumber(minutesSinceHeartbeat, {
          maximumFractionDigits: 2,
        });

      return `Server heartbeat last received ${
        formattedMinutes ?? minutesSinceHeartbeat
      } minutes ago.`;
    }

    return null;
  }

  private static describeIsTimeoutObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (probeResponse && probeResponse.isTimeout !== undefined) {
      return probeResponse.isTimeout
        ? "Request timed out."
        : "Request completed before timeout.";
    }

    return "Timeout information was unavailable.";
  }

  private static describeIncomingRequestObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorCriteriaMessageBuilder.getIncomingMonitorRequest(
        input.dataToProcess,
      );

    if (!incomingRequest) {
      return null;
    }

    const lastHeartbeat: Date = incomingRequest.incomingRequestReceivedAt;
    const checkedAt: Date =
      incomingRequest.checkedAt || OneUptimeDate.getCurrentDate();

    const minutesSinceHeartbeat: number =
      OneUptimeDate.getDifferenceInMinutes(lastHeartbeat, checkedAt);

    const formattedMinutes: string | null =
      MonitorCriteriaMessageBuilder.formatNumber(minutesSinceHeartbeat, {
        maximumFractionDigits: 2,
      });

    return `Last incoming request was ${
      formattedMinutes ?? minutesSinceHeartbeat
    } minutes ago (checked at ${OneUptimeDate.getDateAsLocalFormattedString(
      checkedAt,
    )}).`;
  }

  private static describeRequestBodyObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorCriteriaMessageBuilder.getIncomingMonitorRequest(
        input.dataToProcess,
      );

    if (!incomingRequest) {
      return null;
    }

    const requestBody: string | JSONObject | undefined =
      incomingRequest.requestBody;

    if (!requestBody) {
      return "Request body was empty.";
    }

    let requestBodyAsString: string;

    if (typeof requestBody === Typeof.Object) {
      try {
        requestBodyAsString = JSON.stringify(requestBody);
      } catch (err) {
        logger.error(err);
        requestBodyAsString = "[object]";
      }
    } else {
      requestBodyAsString = requestBody as string;
    }

    return `Request body sample: ${MonitorCriteriaMessageBuilder.formatSnippet(requestBodyAsString)}.`;
  }

  private static describeRequestHeaderObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorCriteriaMessageBuilder.getIncomingMonitorRequest(
        input.dataToProcess,
      );

    if (!incomingRequest) {
      return null;
    }

    const headers: Array<string> = Object.keys(
      incomingRequest.requestHeaders || {},
    ).map((header: string) => {
      return header.toLowerCase();
    });

    if (!headers.length) {
      return "Request headers were empty.";
    }

    return `Request headers present: ${MonitorCriteriaMessageBuilder.formatList(headers)}.`;
  }

  private static describeRequestHeaderValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const incomingRequest: IncomingMonitorRequest | null =
      MonitorCriteriaMessageBuilder.getIncomingMonitorRequest(
        input.dataToProcess,
      );

    if (!incomingRequest) {
      return null;
    }

    const headerValues: Array<string> = Object.values(
      incomingRequest.requestHeaders || {},
    ).map((value: string) => {
      return value.toLowerCase();
    });

    if (!headerValues.length) {
      return "Request header values were empty.";
    }

    return `Request header values: ${MonitorCriteriaMessageBuilder.formatList(headerValues)}.`;
  }

  private static describeJavaScriptExpressionObservation(input: {
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!input.criteriaFilter.value) {
      return "JavaScript expression evaluated to false.";
    }

    return `JavaScript expression "${input.criteriaFilter.value}" evaluated to false.`;
  }

  private static describeCpuUsageObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const cpuMetrics: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!cpuMetrics || !cpuMetrics.cpuMetrics) {
      return "CPU usage metrics were unavailable.";
    }

    const cpuPercent: string | null =
      MonitorCriteriaMessageBuilder.formatPercentage(
        cpuMetrics.cpuMetrics.percentUsed,
      );

    const coreInfo: string = cpuMetrics.cpuMetrics.cores
      ? ` across ${cpuMetrics.cpuMetrics.cores} core${
          cpuMetrics.cpuMetrics.cores > 1 ? "s" : ""
        }`
      : "";

    return `CPU Usage (in %) was ${cpuPercent ?? "unavailable"}${coreInfo}.`;
  }

  private static describeMemoryUsageObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const memoryMetrics: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!memoryMetrics || !memoryMetrics.memoryMetrics) {
      return "Memory usage metrics were unavailable.";
    }

    const percentUsed: string | null =
      MonitorCriteriaMessageBuilder.formatPercentage(
        memoryMetrics.memoryMetrics.percentUsed,
      );

    const used: string | null = MonitorCriteriaMessageBuilder.formatBytes(
      memoryMetrics.memoryMetrics.used,
    );
    const total: string | null = MonitorCriteriaMessageBuilder.formatBytes(
      memoryMetrics.memoryMetrics.total,
    );

    return `Memory Usage (in %) was ${percentUsed ?? "unavailable"} (${used ?? "?"} used of ${total ?? "?"}).`;
  }

  private static describeDiskUsageObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const diskPath: string =
      input.criteriaFilter.serverMonitorOptions?.diskPath || "/";

    const diskMetric: BasicInfrastructureMetrics | undefined =
      serverResponse.basicInfrastructureMetrics;

    if (!diskMetric || !diskMetric.diskMetrics?.length) {
      return `Disk metrics for path ${diskPath} were unavailable.`;
    }

    const matchedDisk = diskMetric.diskMetrics.find((disk) => {
      return disk.diskPath.trim().toLowerCase() === diskPath.trim().toLowerCase();
    });

    if (!matchedDisk) {
      return `Disk metrics did not include path ${diskPath}.`;
    }

    const percentUsedValue: number | null =
      MonitorCriteriaMessageBuilder.computeDiskUsagePercent(matchedDisk);
    const percentUsed: string | null =
      MonitorCriteriaMessageBuilder.formatPercentage(percentUsedValue ?? undefined);

    const used: string | null =
      MonitorCriteriaMessageBuilder.formatBytes(matchedDisk.used);
    const total: string | null =
      MonitorCriteriaMessageBuilder.formatBytes(matchedDisk.total);
    const free: string | null =
      MonitorCriteriaMessageBuilder.formatBytes(matchedDisk.free);

    return `Disk Usage (in %) on disk ${diskPath} was ${
      percentUsed ?? "unavailable"
    } (${used ?? "?"} used of ${total ?? "?"}, free ${free ?? "?"}).`;
  }

  private static describeServerProcessNameObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const thresholdName: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.name.trim().toLowerCase() === thresholdName;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.name} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorCriteriaMessageBuilder.describeProcesses(processes);

    if (processSummary) {
      return `Process ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process ${input.criteriaFilter.value} was not running.`;
  }

  private static describeServerProcessPidObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const thresholdPid: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.pid.toString().trim().toLowerCase() === thresholdPid;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.name} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process with PID ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorCriteriaMessageBuilder.describeProcesses(processes);

    if (processSummary) {
      return `Process with PID ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process with PID ${input.criteriaFilter.value} was not running.`;
  }

  private static describeServerProcessCommandObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
  }): string | null {
    const serverResponse: ServerMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getServerMonitorResponse(
        input.dataToProcess,
      );

    if (!serverResponse) {
      return null;
    }

    const thresholdCommand: string =
      (input.criteriaFilter.value ?? "").toString().trim().toLowerCase();

    const processes: Array<ServerProcess> = serverResponse.processes || [];

    const matchingProcesses: Array<ServerProcess> = processes.filter(
      (process: ServerProcess) => {
        return process.command.trim().toLowerCase() === thresholdCommand;
      },
    );

    if (matchingProcesses.length > 0) {
      const summary: string = matchingProcesses
        .map((process: ServerProcess) => {
          return `${process.command} (pid ${process.pid})`;
        })
        .join(", ");

      return `Process with command ${input.criteriaFilter.value} is running (${summary}).`;
    }

    const processSummary: string | null =
      MonitorCriteriaMessageBuilder.describeProcesses(processes);

    if (processSummary) {
      return `Process with command ${input.criteriaFilter.value} was not running. Active processes: ${processSummary}.`;
    }

    return `Process with command ${input.criteriaFilter.value} was not running.`;
  }

  private static describeCertificateExpiresInHoursObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const hoursRemaining: number = OneUptimeDate.getHoursBetweenTwoDates(
      OneUptimeDate.getCurrentDate(),
      sslResponse.expiresAt,
    );

    const formattedHours: string | null =
      MonitorCriteriaMessageBuilder.formatNumber(hoursRemaining, {
        maximumFractionDigits: 2,
      });

    return `SSL certificate expires at ${
      OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)
    } (${formattedHours ?? hoursRemaining} hours remaining).`;
  }

  private static describeCertificateExpiresInDaysObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const daysRemaining: number = OneUptimeDate.getDaysBetweenTwoDates(
      OneUptimeDate.getCurrentDate(),
      sslResponse.expiresAt,
    );

    const formattedDays: string | null =
      MonitorCriteriaMessageBuilder.formatNumber(daysRemaining, {
        maximumFractionDigits: 2,
      });

    return `SSL certificate expires at ${
      OneUptimeDate.getDateAsLocalFormattedString(sslResponse.expiresAt)
    } (${formattedDays ?? daysRemaining} days remaining).`;
  }

  private static describeIsSelfSignedObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getSslResponse(input.dataToProcess);

    if (!sslResponse || sslResponse.isSelfSigned === undefined) {
      return "SSL certificate self-signed status was unavailable.";
    }

    return sslResponse.isSelfSigned
      ? "SSL certificate is self signed."
      : "SSL certificate is not self signed.";
  }

  private static describeIsExpiredObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const sslResponse: SslMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getSslResponse(input.dataToProcess);

    if (!sslResponse || !sslResponse.expiresAt) {
      return "SSL certificate expiration time was unavailable.";
    }

    const isExpired: boolean = OneUptimeDate.isBefore(
      sslResponse.expiresAt,
      OneUptimeDate.getCurrentDate(),
    );

    return isExpired
      ? "SSL certificate is expired."
      : "SSL certificate is not expired.";
  }

  private static describeIsValidObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    const sslResponse: SslMonitorResponse | undefined =
      probeResponse?.sslResponse;

    const isValid: boolean = Boolean(
      sslResponse &&
        probeResponse?.isOnline &&
        sslResponse.expiresAt &&
        !sslResponse.isSelfSigned &&
        OneUptimeDate.isAfter(
          sslResponse.expiresAt,
          OneUptimeDate.getCurrentDate(),
        ),
    );

    if (!sslResponse) {
      return "SSL certificate details were unavailable.";
    }

    return isValid
      ? "SSL certificate is valid."
      : "SSL certificate is not valid.";
  }

  private static describeIsInvalidObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(
        input.dataToProcess,
      );

    const sslResponse: SslMonitorResponse | undefined =
      probeResponse?.sslResponse;

    const isInvalid: boolean =
      !sslResponse ||
      !probeResponse?.isOnline ||
      Boolean(
        sslResponse &&
          sslResponse.expiresAt &&
          (sslResponse.isSelfSigned ||
            OneUptimeDate.isBefore(
              sslResponse.expiresAt,
              OneUptimeDate.getCurrentDate(),
            )),
      );

    if (!sslResponse) {
      return "SSL certificate details were unavailable.";
    }

    return isInvalid
      ? "SSL certificate is not valid."
      : "SSL certificate is valid.";
  }

  private static describeExecutionTimeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorCriteriaMessageBuilder.getSyntheticMonitorResponses(
        input.dataToProcess,
      );

    const executionTimes: Array<number> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return response.executionTimeInMS;
      })
      .filter((value: number) => {
        return typeof value === "number" && !isNaN(value);
      });

    if (executionTimes.length > 0) {
      const summary: string | null =
        MonitorCriteriaMessageBuilder.summarizeNumericSeries(executionTimes);

      if (summary) {
        return `Execution Time (in ms) recorded ${summary}.`;
      }
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getCustomCodeMonitorResponse(
        input.dataToProcess,
      );

    if (customCodeResponse) {
      const formatted: string | null =
        MonitorCriteriaMessageBuilder.formatNumber(
          customCodeResponse.executionTimeInMS,
          { maximumFractionDigits: 2 },
        );

      return `Execution Time (in ms) was ${
        formatted ?? customCodeResponse.executionTimeInMS
      } ms.`;
    }

    return "Execution time was unavailable.";
  }

  private static describeResultValueObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorCriteriaMessageBuilder.getSyntheticMonitorResponses(
        input.dataToProcess,
      );

    const resultValues: Array<string> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return MonitorCriteriaMessageBuilder.formatResultValue(response.result);
      })
      .filter((value: string) => {
        return value !== "undefined";
      });

    if (resultValues.length > 0) {
      const uniqueResults: Array<string> = Array.from(new Set(resultValues));

      return `Result Value samples: ${MonitorCriteriaMessageBuilder.formatList(uniqueResults)}.`;
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getCustomCodeMonitorResponse(
        input.dataToProcess,
      );

    if (customCodeResponse && customCodeResponse.result !== undefined) {
      const formatted: string = MonitorCriteriaMessageBuilder.formatResultValue(
        customCodeResponse.result,
      );

      return `Result Value was ${MonitorCriteriaMessageBuilder.formatSnippet(formatted)}.`;
    }

    return "Result value was unavailable.";
  }

  private static describeErrorObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorCriteriaMessageBuilder.getSyntheticMonitorResponses(
        input.dataToProcess,
      );

    const errors: Array<string> = syntheticResponses
      .map((response: SyntheticMonitorResponse) => {
        return response.scriptError;
      })
      .filter((value: string | undefined): value is string => {
        return Boolean(value);
      })
      .map((error: string) => {
        return MonitorCriteriaMessageBuilder.formatSnippet(error, 80);
      });

    if (errors.length > 0) {
      return `Script errors: ${MonitorCriteriaMessageBuilder.formatList(errors)}.`;
    }

    const customCodeResponse: CustomCodeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getCustomCodeMonitorResponse(
        input.dataToProcess,
      );

    if (customCodeResponse?.scriptError) {
      return `Script error: ${MonitorCriteriaMessageBuilder.formatSnippet(customCodeResponse.scriptError, 80)}.`;
    }

    if (customCodeResponse?.logMessages?.length) {
      return `Script log messages: ${MonitorCriteriaMessageBuilder.formatList(customCodeResponse.logMessages)}.`;
    }

    return "No script errors were reported.";
  }

  private static describeScreenSizeObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorCriteriaMessageBuilder.getSyntheticMonitorResponses(
        input.dataToProcess,
      );

    if (!syntheticResponses.length) {
      return "Synthetic monitor results were unavailable.";
    }

    const screenSizes: Array<string> = Array.from(
      new Set(
        syntheticResponses.map((response: SyntheticMonitorResponse) => {
          return response.screenSizeType;
        }),
      ),
    );

    return `Synthetic monitor screen sizes: ${MonitorCriteriaMessageBuilder.formatList(screenSizes)}.`;
  }

  private static describeBrowserObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const syntheticResponses: Array<SyntheticMonitorResponse> =
      MonitorCriteriaMessageBuilder.getSyntheticMonitorResponses(
        input.dataToProcess,
      );

    if (!syntheticResponses.length) {
      return "Synthetic monitor results were unavailable.";
    }

    const browsers: Array<string> = Array.from(
      new Set(
        syntheticResponses.map((response: SyntheticMonitorResponse) => {
          return response.browserType;
        }),
      ),
    );

    return `Synthetic monitor browsers: ${MonitorCriteriaMessageBuilder.formatList(browsers)}.`;
  }

  private static describeLogCountObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const logResponse: LogMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getLogMonitorResponse(input.dataToProcess);

    if (!logResponse) {
      return null;
    }

    return `Log count was ${logResponse.logCount}.`;
  }

  private static describeSpanCountObservation(input: {
    dataToProcess: DataToProcess;
  }): string | null {
    const traceResponse: TraceMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getTraceMonitorResponse(
        input.dataToProcess,
      );

    if (!traceResponse) {
      return null;
    }

    return `Span count was ${traceResponse.spanCount}.`;
  }

  private static describeMetricValueObservation(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    const metricValues = MonitorCriteriaMessageBuilder.extractMetricValues({
      criteriaFilter: input.criteriaFilter,
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
    });

    if (!metricValues) {
      return null;
    }

    if (!metricValues.values.length) {
      return `Metric Value${
        metricValues.alias ? ` (${metricValues.alias})` : ""
      } returned no data points.`;
    }

    const summary: string | null =
      MonitorCriteriaMessageBuilder.summarizeNumericSeries(
        metricValues.values,
      );

    if (!summary) {
      return null;
    }

    return `Metric Value${
      metricValues.alias ? ` (${metricValues.alias})` : ""
    } recorded ${summary}.`;
  }

  private static getProbeMonitorResponse(
    dataToProcess: DataToProcess,
  ): ProbeMonitorResponse | null {
    if ((dataToProcess as ProbeMonitorResponse).monitorStepId) {
      return dataToProcess as ProbeMonitorResponse;
    }

    return null;
  }

  private static getServerMonitorResponse(
    dataToProcess: DataToProcess,
  ): ServerMonitorResponse | null {
    if ((dataToProcess as ServerMonitorResponse).hostname) {
      return dataToProcess as ServerMonitorResponse;
    }

    return null;
  }

  private static getIncomingMonitorRequest(
    dataToProcess: DataToProcess,
  ): IncomingMonitorRequest | null {
    if (
      (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt !==
      undefined
    ) {
      return dataToProcess as IncomingMonitorRequest;
    }

    return null;
  }

  private static getLogMonitorResponse(
    dataToProcess: DataToProcess,
  ): LogMonitorResponse | null {
    if ((dataToProcess as LogMonitorResponse).logCount !== undefined) {
      return dataToProcess as LogMonitorResponse;
    }

    return null;
  }

  private static getTraceMonitorResponse(
    dataToProcess: DataToProcess,
  ): TraceMonitorResponse | null {
    if ((dataToProcess as TraceMonitorResponse).spanCount !== undefined) {
      return dataToProcess as TraceMonitorResponse;
    }

    return null;
  }

  private static getMetricMonitorResponse(
    dataToProcess: DataToProcess,
  ): MetricMonitorResponse | null {
    if ((dataToProcess as MetricMonitorResponse).metricResult !== undefined) {
      return dataToProcess as MetricMonitorResponse;
    }

    return null;
  }

  private static getCustomCodeMonitorResponse(
    dataToProcess: DataToProcess,
  ): CustomCodeMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.customCodeMonitorResponse) {
      return probeResponse.customCodeMonitorResponse;
    }

    return null;
  }

  private static getSyntheticMonitorResponses(
    dataToProcess: DataToProcess,
  ): Array<SyntheticMonitorResponse> {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(dataToProcess);

    return probeResponse?.syntheticMonitorResponse || [];
  }

  private static getSslResponse(
    dataToProcess: DataToProcess,
  ): SslMonitorResponse | null {
    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getProbeMonitorResponse(dataToProcess);

    if (probeResponse?.sslResponse) {
      return probeResponse.sslResponse;
    }

    return null;
  }

  private static formatNumber(
    value: number | null | undefined,
    options?: { maximumFractionDigits?: number },
  ): string | null {
    if (value === null || value === undefined || isNaN(value)) {
      return null;
    }

    const fractionDigits: number =
      options?.maximumFractionDigits !== undefined
        ? options.maximumFractionDigits
        : Math.abs(value) < 10
          ? 2
          : Math.abs(value) < 100
            ? 1
            : 0;

    return value.toFixed(fractionDigits);
  }

  private static formatPercentage(
    value: number | null | undefined,
  ): string | null {
    const formatted: string | null = MonitorCriteriaMessageBuilder.formatNumber(
      value,
      {
        maximumFractionDigits:
          value !== null && value !== undefined && Math.abs(value) < 100 ? 1 : 0,
      },
    );

    if (!formatted) {
      return null;
    }

    return `${formatted}%`;
  }

  private static formatBytes(
    bytes: number | null | undefined,
  ): string | null {
    if (bytes === null || bytes === undefined || isNaN(bytes)) {
      return null;
    }

    const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
    let value: number = bytes;
    let index: number = 0;

    while (value >= 1024 && index < units.length - 1) {
      value = value / 1024;
      index++;
    }

    const formatted: string | null = MonitorCriteriaMessageBuilder.formatNumber(
      value,
      {
        maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
      },
    );

    if (!formatted) {
      return null;
    }

    return `${formatted} ${units[index]}`;
  }

  private static formatList(
    items: Array<string>,
    maxItems: number = 5,
  ): string {
    if (!items.length) {
      return "";
    }

    const trimmedItems: Array<string> = items.slice(0, maxItems);
    const suffix: string =
      items.length > maxItems ? `, +${items.length - maxItems} more` : "";

    return `${trimmedItems.join(", ")} ${suffix}`.trim();
  }

  private static formatSnippet(text: string, maxLength: number = 120): string {
    const sanitized: string = text.replace(/\s+/g, " ").trim();

    if (sanitized.length <= maxLength) {
      return sanitized;
    }

    return `${sanitized.slice(0, maxLength)}…`;
  }

  private static describeProcesses(
    processes: Array<ServerProcess>,
  ): string | null {
    if (!processes.length) {
      return null;
    }

    const processSummaries: Array<string> = processes.map(
      (process: ServerProcess) => {
        return `${process.name} (pid ${process.pid})`;
      },
    );

    return MonitorCriteriaMessageBuilder.formatList(processSummaries);
  }

  private static computeDiskUsagePercent(
    diskMetric: BasicInfrastructureMetrics["diskMetrics"][number],
  ): number | null {
    if (!diskMetric) {
      return null;
    }

    if (
      diskMetric.percentUsed !== undefined &&
      diskMetric.percentUsed !== null &&
      !isNaN(diskMetric.percentUsed)
    ) {
      return diskMetric.percentUsed;
    }

    if (
      diskMetric.percentFree !== undefined &&
      diskMetric.percentFree !== null &&
      !isNaN(diskMetric.percentFree)
    ) {
      return 100 - diskMetric.percentFree;
    }

    if (diskMetric.total && diskMetric.used && diskMetric.total > 0) {
      return (diskMetric.used / diskMetric.total) * 100;
    }

    return null;
  }

  private static extractMetricValues(input: {
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): { alias: string | null; values: Array<number> } | null {
    const metricResponse: MetricMonitorResponse | null =
      MonitorCriteriaMessageBuilder.getMetricMonitorResponse(
        input.dataToProcess,
      );

    if (!metricResponse) {
      return null;
    }

    const aggregatedResults: Array<AggregatedResult> =
      metricResponse.metricResult || [];

    if (!aggregatedResults.length) {
      return {
        alias: input.criteriaFilter.metricMonitorOptions?.metricAlias || null,
        values: [],
      };
    }

    let alias: string | null =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || null;

    let result: AggregatedResult | undefined;

    if (alias) {
      const queryConfigs: Array<MetricQueryConfigData> =
        input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs ||
        [];

      let aliasIndex: number = queryConfigs.findIndex(
        (queryConfig: MetricQueryConfigData) => {
          return queryConfig.metricAliasData?.metricVariable === alias;
        },
      );

      if (aliasIndex < 0) {
        const formulaConfigs: Array<MetricFormulaConfigData> =
          input.monitorStep.data?.metricMonitor?.metricViewConfig
            ?.formulaConfigs || [];

        const formulaIndex: number = formulaConfigs.findIndex(
          (formulaConfig: MetricFormulaConfigData) => {
            return formulaConfig.metricAliasData?.metricVariable === alias;
          },
        );

        if (formulaIndex >= 0) {
          aliasIndex = queryConfigs.length + formulaIndex;
        }
      }

      if (aliasIndex >= 0 && aliasIndex < aggregatedResults.length) {
        result = aggregatedResults[aliasIndex];
      }
    }

    if (!result) {
      result = aggregatedResults[0];
      if (!alias) {
        const defaultAlias: string | undefined =
          input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs?.[0]?.metricAliasData?.metricVariable;
        alias = defaultAlias || null;
      }
    }

    if (!result) {
      return {
        alias: alias,
        values: [],
      };
    }

    const values: Array<number> = result.data
      .map((entry: AggregateModel) => {
        return entry.value;
      })
      .filter((value: number) => {
        return typeof value === "number" && !isNaN(value);
      });

    return {
      alias: alias,
      values: values,
    };
  }

  private static summarizeNumericSeries(values: Array<number>): string | null {
    if (!values.length) {
      return null;
    }

    const latest: number | undefined = values[values.length - 1];

    if (latest === undefined) {
      return null;
    }
    const latestFormatted: string | null =
      MonitorCriteriaMessageBuilder.formatNumber(latest, {
        maximumFractionDigits: 2,
      });

    let summary: string = `latest ${latestFormatted ?? latest}`;

    if (values.length > 1) {
      const min: number = Math.min(...values);
      const max: number = Math.max(...values);

      const minFormatted: string | null =
        MonitorCriteriaMessageBuilder.formatNumber(min, {
          maximumFractionDigits: 2,
        });
      const maxFormatted: string | null =
        MonitorCriteriaMessageBuilder.formatNumber(max, {
          maximumFractionDigits: 2,
        });

      summary += ` (min ${minFormatted ?? min}, max ${maxFormatted ?? max})`;
    }

    summary += ` across ${values.length} data point${
      values.length === 1 ? "" : "s"
    }`;

    return summary;
  }

  private static formatResultValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "undefined";
    }

    if (typeof value === Typeof.Object) {
      try {
        return JSON.stringify(value);
      } catch (err) {
        logger.error(err);
        return "[object]";
      }
    }

    return value.toString();
  }
}
