import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import APIRequestCriteria from "./Criteria/APIRequestCriteria";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import IncomingRequestCriteria from "./Criteria/IncomingRequestCriteria";
import SSLMonitorCriteria from "./Criteria/SSLMonitorCriteria";
import ServerMonitorCriteria from "./Criteria/ServerMonitorCriteria";
import SyntheticMonitoringCriteria from "./Criteria/SyntheticMonitor";
import LogMonitorCriteria from "./Criteria/LogMonitorCriteria";
import MetricMonitorCriteria from "./Criteria/MetricMonitorCriteria";
import TraceMonitorCriteria from "./Criteria/TraceMonitorCriteria";
import ExceptionMonitorCriteria from "./Criteria/ExceptionMonitorCriteria";
import MonitorCriteriaMessageBuilder from "./MonitorCriteriaMessageBuilder";
import MonitorCriteriaDataExtractor from "./MonitorCriteriaDataExtractor";
import MonitorCriteriaMessageFormatter from "./MonitorCriteriaMessageFormatter";
import DataToProcess from "./DataToProcess";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationEvent,
  MonitorEvaluationFilterResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import ProbeApiIngestResponse from "../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import RequestFailedDetails from "../../../Types/Probe/RequestFailedDetails";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Typeof from "../../../Types/Typeof";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import Hostname from "../../../Types/API/Hostname";
import Port from "../../../Types/Port";

export default class MonitorCriteriaEvaluator {
  public static async processMonitorStep(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    evaluationSummary: MonitorEvaluationSummary;
  }): Promise<ProbeApiIngestResponse> {
    const criteria: MonitorCriteria | undefined =
      input.monitorStep.data?.monitorCriteria;

    if (!criteria || !criteria.data) {
      return input.probeApiIngestResponse;
    }

    for (const criteriaInstance of criteria.data.monitorCriteriaInstanceArray) {
      const criteriaResult: MonitorEvaluationCriteriaResult = {
        criteriaId: criteriaInstance.data?.id,
        criteriaName: criteriaInstance.data?.name,
        filterCondition:
          criteriaInstance.data?.filterCondition || FilterCondition.All,
        met: false,
        message: "",
        filters: [],
      };

      input.evaluationSummary.criteriaResults.push(criteriaResult);

      const rootCause: string | null =
        await MonitorCriteriaEvaluator.processMonitorCriteriaInstance({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: criteriaInstance,
          criteriaResult: criteriaResult,
        });

      if (!criteriaResult.message) {
        criteriaResult.message = criteriaResult.met
          ? "Criteria met."
          : "Criteria was not met.";
      }

      const criteriaEvent: MonitorEvaluationEvent = {
        type: criteriaResult.met ? "criteria-met" : "criteria-not-met",
        title: `${criteriaResult.met ? "Criteria met" : "Criteria not met"}: ${criteriaResult.criteriaName || "Unnamed criteria"}`,
        message: criteriaResult.message,
        relatedCriteriaId: criteriaResult.criteriaId,
        at: OneUptimeDate.getCurrentDate(),
      };

      input.evaluationSummary.events.push(criteriaEvent);

      if (rootCause) {
        input.probeApiIngestResponse.criteriaMetId = criteriaInstance.data?.id;
        input.probeApiIngestResponse.rootCause = `
**Created because the following criteria was met**: 

**Criteria Name**: ${criteriaInstance.data?.name}
`;

        input.probeApiIngestResponse.rootCause += `
**Filter Conditions Met**: ${rootCause}
`;

        const contextBlock: string | null =
          MonitorCriteriaEvaluator.buildRootCauseContext({
            dataToProcess: input.dataToProcess,
            monitorStep: input.monitorStep,
            monitor: input.monitor,
          });

        if (contextBlock) {
          input.probeApiIngestResponse.rootCause += `
${contextBlock}
`;
        }

        if ((input.dataToProcess as ProbeMonitorResponse).failureCause) {
          input.probeApiIngestResponse.rootCause += `
**Cause**: ${(input.dataToProcess as ProbeMonitorResponse).failureCause || ""}
`;
        }
        break;
      }
    }

    return input.probeApiIngestResponse;
  }

  private static async processMonitorCriteriaInstance(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaResult: MonitorEvaluationCriteriaResult;
  }): Promise<string | null> {
    return MonitorCriteriaEvaluator.isMonitorInstanceCriteriaFiltersMet({
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
      monitor: input.monitor,
      probeApiIngestResponse: input.probeApiIngestResponse,
      criteriaInstance: input.criteriaInstance,
      criteriaResult: input.criteriaResult,
    });
  }

  private static async isMonitorInstanceCriteriaFiltersMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaResult: MonitorEvaluationCriteriaResult;
  }): Promise<string | null> {
    const filterCondition: FilterCondition =
      input.criteriaInstance.data?.filterCondition || FilterCondition.All;

    const matchedFilterMessages: Array<string> = [];
    let hasMatch: boolean = false;
    let allFiltersMet: boolean = true;

    for (const criteriaFilter of input.criteriaInstance.data?.filters || []) {
      const rootCause: string | null =
        await MonitorCriteriaEvaluator.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: input.probeApiIngestResponse,
          criteriaInstance: input.criteriaInstance,
          criteriaFilter: criteriaFilter,
        });

      const didMeetCriteria: boolean = Boolean(rootCause);

      const filterMessage: string =
        MonitorCriteriaMessageBuilder.buildCriteriaFilterMessage({
          monitor: input.monitor,
          criteriaFilter: criteriaFilter,
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          didMeetCriteria: didMeetCriteria,
          matchMessage: rootCause,
        });

      const filterSummary: MonitorEvaluationFilterResult = {
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
        value: criteriaFilter.value,
        met: didMeetCriteria,
        message: filterMessage,
      };

      input.criteriaResult.filters.push(filterSummary);

      if (didMeetCriteria) {
        hasMatch = true;
        matchedFilterMessages.push(filterMessage);
      } else if (filterCondition === FilterCondition.All) {
        allFiltersMet = false;
      }
    }

    if (filterCondition === FilterCondition.All) {
      if (allFiltersMet && input.criteriaResult.filters.length > 0) {
        let message: string = "All filters met.";

        if (matchedFilterMessages.length > 0) {
          message += matchedFilterMessages
            .map((item: string) => {
              return `\n- ${item}`;
            })
            .join("");
        }

        input.criteriaResult.met = true;
        input.criteriaResult.message = message;

        return message;
      }

      input.criteriaResult.met = false;
      input.criteriaResult.message =
        "One or more filters did not meet the configured conditions.";

      return null;
    }

    if (filterCondition === FilterCondition.Any) {
      if (hasMatch) {
        const firstMatch: string =
          matchedFilterMessages[0] ||
          "At least one filter met the configured condition.";

        input.criteriaResult.met = true;
        input.criteriaResult.message = firstMatch;

        return firstMatch;
      }

      input.criteriaResult.met = false;
      input.criteriaResult.message =
        "No filters met the configured conditions.";

      return null;
    }

    return null;
  }

  private static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: ProbeApiIngestResponse;
    criteriaInstance: MonitorCriteriaInstance;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    if (input.criteriaFilter.checkOn === CheckOn.JavaScriptExpression) {
      let storageMap: JSONObject = {};

      if (
        input.monitor.monitorType === MonitorType.API ||
        input.monitor.monitorType === MonitorType.Website
      ) {
        let responseBody: JSONObject | null = null;
        try {
          responseBody = JSON.parse(
            ((input.dataToProcess as ProbeMonitorResponse)
              .responseBody as string) || "{}",
          );
        } catch (err) {
          logger.error(err);
          responseBody = (input.dataToProcess as ProbeMonitorResponse)
            .responseBody as JSONObject;
        }

        if (
          typeof responseBody === Typeof.String &&
          responseBody?.toString() === ""
        ) {
          responseBody = {};
        }

        storageMap = {
          responseBody: responseBody,
          responseHeaders: (input.dataToProcess as ProbeMonitorResponse)
            .responseHeaders,
          responseStatusCode: (input.dataToProcess as ProbeMonitorResponse)
            .responseCode,
          responseTimeInMs: (input.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
        };
      }

      if (input.monitor.monitorType === MonitorType.IncomingRequest) {
        storageMap = {
          requestBody: (input.dataToProcess as IncomingMonitorRequest)
            .requestBody,
          requestHeaders: (input.dataToProcess as IncomingMonitorRequest)
            .requestHeaders,
        };
      }

      let expression: string = input.criteriaFilter.value as string;
      expression = VMUtil.replaceValueInPlace(storageMap, expression, false);

      const code: string = `return Boolean(${expression});`;
      let result: ReturnResult | null = null;

      try {
        result = await VMUtil.runCodeInSandbox({
          code: code,
          options: {
            args: {},
          },
        });
      } catch (err) {
        logger.error(err);
        return null;
      }

      if (result && result.returnValue) {
        return `JavaScript Expression - ${expression} - evaluated to true.`;
      }

      return null;
    }

    if (
      input.monitor.monitorType === MonitorType.API ||
      input.monitor.monitorType === MonitorType.Website ||
      input.monitor.monitorType === MonitorType.IP ||
      input.monitor.monitorType === MonitorType.Ping ||
      input.monitor.monitorType === MonitorType.Port
    ) {
      const apiRequestCriteriaResult: string | null =
        await APIRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (apiRequestCriteriaResult) {
        return apiRequestCriteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.CustomJavaScriptCode &&
      (input.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
    ) {
      const criteriaResult: string | null =
        await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse: (input.dataToProcess as ProbeMonitorResponse)
            .customCodeMonitorResponse!,
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (
      input.monitor.monitorType === MonitorType.SyntheticMonitor &&
      (input.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse
    ) {
      const criteriaResult: string | null =
        await SyntheticMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          monitorResponse:
            (input.dataToProcess as ProbeMonitorResponse)
              .syntheticMonitorResponse || [],
          criteriaFilter: input.criteriaFilter,
        });

      if (criteriaResult) {
        return criteriaResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.IncomingRequest) {
      const incomingRequestResult: string | null =
        await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (incomingRequestResult) {
        return incomingRequestResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.SSLCertificate) {
      const sslMonitorResult: string | null =
        await SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (sslMonitorResult) {
        return sslMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Server) {
      const serverMonitorResult: string | null =
        await ServerMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (serverMonitorResult) {
        return serverMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Logs) {
      const logMonitorResult: string | null =
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (logMonitorResult) {
        return logMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Metrics) {
      const metricMonitorResult: string | null =
        await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
          monitorStep: input.monitorStep,
        });

      if (metricMonitorResult) {
        return metricMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Traces) {
      const traceMonitorResult: string | null =
        await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (traceMonitorResult) {
        return traceMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Exceptions) {
      const exceptionMonitorResult: string | null =
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (exceptionMonitorResult) {
        return exceptionMonitorResult;
      }
    }

    return null;
  }

  private static buildRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const requestDetails: Array<string> = [];
    const responseDetails: Array<string> = [];
    const failureDetails: Array<string> = [];

    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(input.dataToProcess);

    const destination: string | null =
      MonitorCriteriaEvaluator.getMonitorDestinationString({
        monitorStep: input.monitorStep,
        probeResponse: probeResponse,
      });

    if (destination) {
      requestDetails.push(`- Destination: ${destination}`);
    }

    const port: string | null = MonitorCriteriaEvaluator.getMonitorPortString({
      monitorStep: input.monitorStep,
      probeResponse: probeResponse,
    });

    if (port) {
      requestDetails.push(`- Destination Port: ${port}`);
    }

    const requestMethod: string | null =
      MonitorCriteriaEvaluator.getRequestMethodString({
        monitor: input.monitor,
        monitorStep: input.monitorStep,
      });

    if (requestMethod) {
      requestDetails.push(`- Request Method: ${requestMethod}`);
    }

    if (probeResponse?.responseCode !== undefined) {
      responseDetails.push(
        `- Response Status Code: ${probeResponse.responseCode}`,
      );
    }

    const responseTime: string | null =
      MonitorCriteriaEvaluator.formatMilliseconds(
        probeResponse?.responseTimeInMs,
      );

    if (responseTime) {
      responseDetails.push(`- Response Time: ${responseTime}`);
    }

    if (probeResponse?.isTimeout !== undefined) {
      responseDetails.push(
        `- Timed Out: ${probeResponse.isTimeout ? "Yes" : "No"}`,
      );
    }

    // Add Request Failed Details if available
    if (probeResponse?.requestFailedDetails) {
      const requestFailedDetails: RequestFailedDetails =
        probeResponse.requestFailedDetails;

      if (requestFailedDetails.failedPhase) {
        failureDetails.push(
          `- Failed Phase: ${requestFailedDetails.failedPhase}`,
        );
      }

      if (requestFailedDetails.errorCode) {
        failureDetails.push(`- Error Code: ${requestFailedDetails.errorCode}`);
      }

      if (requestFailedDetails.errorDescription) {
        failureDetails.push(
          `- Error Description: ${requestFailedDetails.errorDescription}`,
        );
      }

      if (requestFailedDetails.rawErrorMessage) {
        failureDetails.push(
          `- Raw Error Message: ${requestFailedDetails.rawErrorMessage}`,
        );
      }
    }

    const sections: Array<string> = [];

    if (requestDetails.length > 0) {
      sections.push(`**Request Details**\n${requestDetails.join("\n")}`);
    }

    if (responseDetails.length > 0) {
      sections.push(`\n\n**Response Snapshot**\n${responseDetails.join("\n")}`);
    }

    if (failureDetails.length > 0) {
      sections.push(
        `\n\n**Request Failed Details**\n${failureDetails.join("\n")}`,
      );
    }

    if (!sections.length) {
      return null;
    }

    return sections.join("\n");
  }

  private static getMonitorDestinationString(input: {
    monitorStep: MonitorStep;
    probeResponse: ProbeMonitorResponse | null;
  }): string | null {
    if (input.probeResponse?.monitorDestination) {
      return MonitorCriteriaEvaluator.stringifyValue(
        input.probeResponse.monitorDestination,
      );
    }

    if (input.monitorStep.data?.monitorDestination) {
      return MonitorCriteriaEvaluator.stringifyValue(
        input.monitorStep.data.monitorDestination,
      );
    }

    return null;
  }

  private static getMonitorPortString(input: {
    monitorStep: MonitorStep;
    probeResponse: ProbeMonitorResponse | null;
  }): string | null {
    if (input.probeResponse?.monitorDestinationPort) {
      return MonitorCriteriaEvaluator.stringifyValue(
        input.probeResponse.monitorDestinationPort,
      );
    }

    if (input.monitorStep.data?.monitorDestinationPort) {
      return MonitorCriteriaEvaluator.stringifyValue(
        input.monitorStep.data.monitorDestinationPort,
      );
    }

    return null;
  }

  private static getRequestMethodString(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
  }): string | null {
    if (
      input.monitor.monitorType === MonitorType.API &&
      input.monitorStep.data
    ) {
      return `${input.monitorStep.data.requestType}`;
    }

    return null;
  }

  private static formatMilliseconds(value?: number): string | null {
    if (value === undefined || value === null || isNaN(value)) {
      return null;
    }

    const formatted: string | null =
      MonitorCriteriaMessageFormatter.formatNumber(value, {
        maximumFractionDigits: value < 100 ? 2 : value < 1000 ? 1 : 0,
      });

    return `${formatted ?? value} ms`;
  }

  private static stringifyValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    try {
      // Handle primitive types directly
      if (typeof value === "string") {
        return value.trim();
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }

      // Handle class instances with custom toString method (like URL, IP, Hostname)
      if (
        value instanceof URL ||
        value instanceof IP ||
        value instanceof Hostname ||
        value instanceof Port
      ) {
        return value.toString().trim();
      }

      /*
       * Handle JSON representations of URL, IP, Hostname, Port (e.g., { _type: "URL", value: "https://..." })
       * This can happen when the value wasn't properly deserialized from JSON
       */
      if (typeof value === "object" && value !== null && "_type" in value) {
        const typedValue: { _type: string; value?: unknown } = value as {
          _type: string;
          value?: unknown;
        };
        if (
          (typedValue._type === "URL" ||
            typedValue._type === "IP" ||
            typedValue._type === "Hostname" ||
            typedValue._type === "Port") &&
          typeof typedValue.value === "string"
        ) {
          return typedValue.value.trim();
        }
      }

      return String(value).trim();
    } catch (err) {
      logger.error(err);
      return null;
    }
  }
}
