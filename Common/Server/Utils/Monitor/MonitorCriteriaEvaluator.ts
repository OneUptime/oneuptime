import logger, { LogAttributes } from "../Logger";
import LogAggregationService from "../../Services/LogAggregationService";
import VMUtil from "../VM/VMAPI";
import APIRequestCriteria from "./Criteria/APIRequestCriteria";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import IncomingEmailCriteria from "./Criteria/IncomingEmailCriteria";
import IncomingRequestCriteria from "./Criteria/IncomingRequestCriteria";
import SSLMonitorCriteria from "./Criteria/SSLMonitorCriteria";
import ServerMonitorCriteria from "./Criteria/ServerMonitorCriteria";
import SyntheticMonitoringCriteria from "./Criteria/SyntheticMonitor";
import LogMonitorCriteria from "./Criteria/LogMonitorCriteria";
import MetricMonitorCriteria from "./Criteria/MetricMonitorCriteria";
import TraceMonitorCriteria from "./Criteria/TraceMonitorCriteria";
import ExceptionMonitorCriteria from "./Criteria/ExceptionMonitorCriteria";
import ProfileMonitorCriteria from "./Criteria/ProfileMonitorCriteria";
import SnmpMonitorCriteria from "./Criteria/SnmpMonitorCriteria";
import DnsMonitorCriteria from "./Criteria/DnsMonitorCriteria";
import DomainMonitorCriteria from "./Criteria/DomainMonitorCriteria";
import ExternalStatusPageMonitorCriteria from "./Criteria/ExternalStatusPageMonitorCriteria";
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
import { DashboardClientUrl } from "../../EnvironmentConfig";
import MetricMonitorResponse, {
  KubernetesAffectedResource,
  KubernetesResourceBreakdown,
} from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricCriteriaContext, {
  MetricBreachingSample,
} from "../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MonitorStepDockerMonitor from "../../../Types/Monitor/MonitorStepDockerMonitor";

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

        const contextBlock: string | null =
          await MonitorCriteriaEvaluator.buildRootCauseContext({
            dataToProcess: input.dataToProcess,
            monitorStep: input.monitorStep,
            monitor: input.monitor,
            criteriaInstance: criteriaInstance,
          });

        /*
         * For metric monitors, render the metric identity (name, unit,
         * filter attrs, breaching series) before the comparison line so
         * the reader has context when they reach "Filter Conditions Met".
         */
        const isMetricMonitor: boolean =
          input.monitor.monitorType === MonitorType.Metrics;

        if (contextBlock && isMetricMonitor) {
          input.probeApiIngestResponse.rootCause += `
${contextBlock}
`;
        }

        input.probeApiIngestResponse.rootCause += `
**Filter Conditions Met**: ${rootCause}
`;

        if (contextBlock && !isMetricMonitor) {
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
          logger.error(err, {
            projectId: input.monitor.projectId?.toString(),
          });
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
        logger.error(err, {
          projectId: input.monitor.projectId?.toString(),
        });
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

    if (input.monitor.monitorType === MonitorType.IncomingEmail) {
      const incomingEmailResult: string | null =
        await IncomingEmailCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (incomingEmailResult) {
        return incomingEmailResult;
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

    if (
      input.monitor.monitorType === MonitorType.Metrics ||
      input.monitor.monitorType === MonitorType.Kubernetes ||
      input.monitor.monitorType === MonitorType.Docker
    ) {
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

    if (input.monitor.monitorType === MonitorType.Profiles) {
      const profileMonitorResult: string | null =
        await ProfileMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (profileMonitorResult) {
        return profileMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.SNMP) {
      const snmpMonitorResult: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (snmpMonitorResult) {
        return snmpMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.DNS) {
      const dnsMonitorResult: string | null =
        await DnsMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (dnsMonitorResult) {
        return dnsMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.Domain) {
      const domainMonitorResult: string | null =
        await DomainMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (domainMonitorResult) {
        return domainMonitorResult;
      }
    }

    if (input.monitor.monitorType === MonitorType.ExternalStatusPage) {
      const externalStatusPageResult: string | null =
        await ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
          {
            dataToProcess: input.dataToProcess,
            criteriaFilter: input.criteriaFilter,
          },
        );

      if (externalStatusPageResult) {
        return externalStatusPageResult;
      }
    }

    return null;
  }

  private static async buildRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    criteriaInstance?: MonitorCriteriaInstance;
  }): Promise<string | null> {
    // Handle Kubernetes monitors with rich resource context
    if (input.monitor.monitorType === MonitorType.Kubernetes) {
      return await MonitorCriteriaEvaluator.buildKubernetesRootCauseContext(
        input,
      );
    }

    // Handle Docker monitors with resource context
    if (input.monitor.monitorType === MonitorType.Docker) {
      return MonitorCriteriaEvaluator.buildDockerRootCauseContext(input);
    }

    // Handle generic Metric monitors with metric identity + breaching series
    if (
      input.monitor.monitorType === MonitorType.Metrics &&
      input.criteriaInstance
    ) {
      return MonitorCriteriaEvaluator.buildMetricRootCauseContext({
        criteriaInstance: input.criteriaInstance,
        monitor: input.monitor,
      });
    }

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

  private static buildMetricRootCauseContext(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
  }): string | null {
    /*
     * Pick the first populated metric context across the instance's filters.
     * Only metric-value filters populate this at evaluation time, so this
     * effectively returns the context for the filter that ran.
     */
    const ctx: MetricCriteriaContext | undefined = (
      input.criteriaInstance.data?.filters || []
    )
      .map((f: CriteriaFilter) => {
        return f.metricCriteriaContext;
      })
      .find(
        (c: MetricCriteriaContext | undefined): c is MetricCriteriaContext => {
          return Boolean(c);
        },
      );

    if (!ctx) {
      return null;
    }

    const lines: Array<string> = [];
    lines.push(`- Metric: \`${ctx.metricName}\``);
    if (ctx.alias) {
      lines.push(`- Alias: \`${ctx.alias}\``);
    }
    if (ctx.unit) {
      lines.push(`- Unit: ${ctx.unit}`);
    }
    if (ctx.aggregationType) {
      lines.push(`- Aggregation: ${ctx.aggregationType}`);
    }
    if (ctx.isFormula && ctx.formulaExpression) {
      lines.push(`- Formula: \`${ctx.formulaExpression}\``);
    }
    if (ctx.timeWindowMinutes) {
      lines.push(`- Time Window: last ${ctx.timeWindowMinutes} minutes`);
    }

    const filterKeys: Array<string> = Object.keys(ctx.filterAttributes || {});
    if (filterKeys.length > 0) {
      const filterLines: Array<string> = filterKeys.map((k: string) => {
        const v: unknown = (ctx.filterAttributes as Record<string, unknown>)[k];
        return `  - \`${k}\` = \`${String(v)}\``;
      });
      lines.push(`- Filters:\n${filterLines.join("\n")}`);
    }

    if (ctx.groupBy.length > 0) {
      lines.push(
        `- Grouped By: ${ctx.groupBy
          .map((g: string) => {
            return `\`${g}\``;
          })
          .join(", ")}`,
      );
    }

    const sections: Array<string> = [`**Metric Details**\n${lines.join("\n")}`];

    const breachingSamples: Array<MetricBreachingSample> =
      ctx.breachingSamples && ctx.breachingSamples.length > 0
        ? ctx.breachingSamples
        : ctx.breachingSample
          ? [ctx.breachingSample]
          : [];

    if (breachingSamples.length > 0) {
      sections.push(
        `\n\n${MonitorCriteriaEvaluator.formatBreachingSamplesSection({
          samples: breachingSamples,
          totalSamples: ctx.totalSamplesInWindow,
          unit: ctx.unit,
          metricName: ctx.metricName,
          alias: ctx.alias,
        })}`,
      );
    }

    const deepLink: string | null =
      MonitorCriteriaEvaluator.buildMetricExplorerDeepLink({
        monitor: input.monitor,
        ctx,
      });

    if (deepLink) {
      sections.push(`\n\n[Open metric in dashboard](${deepLink})`);
    }

    return sections.join("\n");
  }

  /**
   * Build the **Breaching Samples** markdown section — a table of
   * timestamps, values, and any group-by attributes. Caps the row count
   * so a 30-minute window at 1-second granularity doesn't dump thousands
   * of lines onto the root-cause page; the caller can always drill in
   * via the metric explorer link.
   *
   * Timestamps are emitted as inline code wrapping ISO 8601 strings so
   * the client-side markdown viewer can localize them to the viewer's
   * timezone (without losing the canonical instant).
   */
  private static formatBreachingSamplesSection(input: {
    samples: Array<MetricBreachingSample>;
    totalSamples?: number | undefined;
    unit: string | null;
    metricName: string;
    alias: string;
  }): string {
    const MAX_ROWS: number = 20;

    // Sort chronologically and de-duplicate any accidental repeats
    const sorted: Array<MetricBreachingSample> = [...input.samples].sort(
      (a: MetricBreachingSample, b: MetricBreachingSample) => {
        return (
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      },
    );

    const displayedSamples: Array<MetricBreachingSample> = sorted.slice(
      0,
      MAX_ROWS,
    );

    // Collect attribute keys that appear on any displayed sample
    const attrKeySet: Set<string> = new Set<string>();
    for (const s of displayedSamples) {
      for (const k of Object.keys(s.attributes || {})) {
        attrKeySet.add(k);
      }
    }
    const attrKeys: Array<string> = Array.from(attrKeySet);

    /*
     * Columns are fixed up-front: Timestamp, Metric, Alias, Value, plus
     * any per-sample group-by attributes. Metric and Alias are redundant
     * for a single-criterion evaluation today, but they keep the table
     * self-contained (useful when copy/pasting into Slack or tickets)
     * and future-proof against multi-metric criteria.
     */
    const headerCells: Array<string> = [
      "Timestamp",
      "Metric",
      "Alias",
      "Value",
    ];
    headerCells.push(...attrKeys);

    const unitSuffix: string = input.unit ? ` ${input.unit}` : "";

    const headerRow: string = `| ${headerCells.join(" | ")} |`;
    const dividerRow: string = `| ${headerCells
      .map(() => {
        return "---";
      })
      .join(" | ")} |`;

    /*
     * Escape pipe characters that could appear in the metric display
     * name (formulas like "a | b" are unlikely but possible) so they
     * don't break GitHub-flavored-markdown tables.
     */
    const escapeCell: (value: string) => string = (value: string): string => {
      return value.replace(/\|/g, "\\|");
    };

    const metricCell: string = `\`${escapeCell(input.metricName)}\``;
    const aliasCell: string = input.alias
      ? `\`${escapeCell(input.alias)}\``
      : "-";

    const dataRows: Array<string> = displayedSamples.map(
      (s: MetricBreachingSample) => {
        const timestampIso: string = new Date(s.timestamp).toISOString();
        const cells: Array<string> = [
          `\`${timestampIso}\``,
          metricCell,
          aliasCell,
          `${MonitorCriteriaEvaluator.formatNumberForDisplay(s.value)}${unitSuffix}`,
        ];
        for (const k of attrKeys) {
          const v: unknown = (s.attributes as Record<string, unknown>)[k];
          cells.push(v === undefined || v === null ? "-" : String(v));
        }
        return `| ${cells.join(" | ")} |`;
      },
    );

    const lines: Array<string> = [
      `**Breaching Samples**`,
      MonitorCriteriaEvaluator.formatBreachingSamplesSummary({
        breachingCount: sorted.length,
        totalSamples: input.totalSamples,
      }),
      "",
      headerRow,
      dividerRow,
      ...dataRows,
    ];

    if (sorted.length > displayedSamples.length) {
      lines.push(
        `\n_Showing the first ${displayedSamples.length} of ${sorted.length} breaching samples._`,
      );
    }

    return lines.join("\n");
  }

  private static formatBreachingSamplesSummary(input: {
    breachingCount: number;
    totalSamples?: number | undefined;
  }): string {
    if (
      typeof input.totalSamples === "number" &&
      input.totalSamples > 0 &&
      input.totalSamples >= input.breachingCount
    ) {
      return `${input.breachingCount} of ${input.totalSamples} samples breached the threshold.`;
    }
    return `${input.breachingCount} sample${input.breachingCount === 1 ? "" : "s"} breached the threshold.`;
  }

  private static formatNumberForDisplay(value: number): string {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return Number(value.toFixed(2)).toString();
  }

  private static buildMetricExplorerDeepLink(input: {
    monitor: Monitor;
    ctx: MetricCriteriaContext;
  }): string | null {
    const projectId: string | undefined = input.monitor.projectId?.toString();

    if (!projectId) {
      return null;
    }

    /*
     * Metric explorer expects a JSON-encoded `metricQueries` param plus
     * optional start/end times. The shape is documented by
     * MetricExplorer.getMetricQueriesFromQuery(): it reads metricName,
     * attributes, and aggregationType (correctly spelled, unlike the
     * internal persisted field).
     */
    const aggregationType: string | undefined =
      input.ctx.aggregationType || undefined;

    const query: {
      metricName: string;
      attributes: JSONObject;
      aggregationType?: string;
    } = {
      metricName: input.ctx.metricName,
      attributes: input.ctx.filterAttributes || {},
      ...(aggregationType ? { aggregationType } : {}),
    };

    // Time window: breach moment +- 15 minutes (or fall back to last hour).
    const now: Date = OneUptimeDate.getCurrentDate();
    const breachTime: Date | undefined = input.ctx.breachingSample?.timestamp;
    const startTime: Date = breachTime
      ? OneUptimeDate.addRemoveMinutes(breachTime, -30)
      : OneUptimeDate.addRemoveHours(now, -1);
    const endTime: Date = breachTime
      ? OneUptimeDate.addRemoveMinutes(breachTime, 15)
      : now;

    const params: URLSearchParams = new URLSearchParams();
    params.set("metricQueries", JSON.stringify([query]));
    params.set("startTime", OneUptimeDate.toString(startTime));
    params.set("endTime", OneUptimeDate.toString(endTime));

    /*
     * The route that actually reads these URL params is the metric
     * explorer at /metrics/view — the /metrics index is the metric list.
     */
    return `${DashboardClientUrl.toString()}/${projectId}/metrics/view?${params.toString()}`;
  }

  private static async buildKubernetesRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): Promise<string | null> {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const breakdown: KubernetesResourceBreakdown | undefined =
      metricResponse.kubernetesResourceBreakdown;

    if (!breakdown) {
      return null;
    }

    const sections: Array<string> = [];

    // Cluster context
    const clusterDetails: Array<string> = [];
    clusterDetails.push(`- Cluster: ${breakdown.clusterName}`);
    clusterDetails.push(
      `- Metric: ${breakdown.metricFriendlyName} (\`${breakdown.metricName}\`)`,
    );

    if (breakdown.attributes["k8s.namespace.name"]) {
      clusterDetails.push(
        `- Namespace: ${breakdown.attributes["k8s.namespace.name"]}`,
      );
    }

    sections.push(
      `**Kubernetes Cluster Details**\n${clusterDetails.join("\n")}`,
    );

    // Affected resources
    if (breakdown.affectedResources && breakdown.affectedResources.length > 0) {
      const resourceLines: Array<string> = [];

      // Sort by metric value descending (worst first) and filter out zero-value resources
      const sortedResources: Array<KubernetesAffectedResource> = [
        ...breakdown.affectedResources,
      ]
        .filter((r: KubernetesAffectedResource) => {
          return r.metricValue > 0;
        })
        .sort(
          (a: KubernetesAffectedResource, b: KubernetesAffectedResource) => {
            return b.metricValue - a.metricValue;
          },
        );

      if (sortedResources.length === 0) {
        return sections.join("\n");
      }

      // Show top 10 affected resources
      const resourcesToShow: Array<KubernetesAffectedResource> =
        sortedResources.slice(0, 10);

      // Determine which columns are present across all resources
      const hasNamespace: boolean = resourcesToShow.some(
        (r: KubernetesAffectedResource) => {
          return r.namespace;
        },
      );
      const hasWorkload: boolean = resourcesToShow.some(
        (r: KubernetesAffectedResource) => {
          return r.workloadType && r.workloadName;
        },
      );
      const hasPod: boolean = resourcesToShow.some(
        (r: KubernetesAffectedResource) => {
          return r.podName;
        },
      );
      const hasContainer: boolean = resourcesToShow.some(
        (r: KubernetesAffectedResource) => {
          return r.containerName;
        },
      );
      const hasNode: boolean = resourcesToShow.some(
        (r: KubernetesAffectedResource) => {
          return r.nodeName;
        },
      );

      // Build table header
      const headerCells: Array<string> = [];
      if (hasNamespace) {
        headerCells.push("Namespace");
      }
      if (hasWorkload) {
        headerCells.push("Workload Type");
        headerCells.push("Workload");
      }
      if (hasPod) {
        headerCells.push("Pod");
      }
      if (hasContainer) {
        headerCells.push("Container");
      }
      if (hasNode) {
        headerCells.push("Node");
      }
      headerCells.push("Value");

      const headerRow: string = `| ${headerCells.join(" | ")} |`;
      const separatorRow: string = `| ${headerCells
        .map(() => {
          return "---";
        })
        .join(" | ")} |`;

      resourceLines.push(headerRow);
      resourceLines.push(separatorRow);

      for (const resource of resourcesToShow) {
        const cells: Array<string> = [];

        if (hasNamespace) {
          cells.push(resource.namespace ? `\`${resource.namespace}\`` : "-");
        }
        if (hasWorkload) {
          cells.push(resource.workloadType ? `${resource.workloadType}` : "-");
          cells.push(
            resource.workloadName ? `\`${resource.workloadName}\`` : "-",
          );
        }
        if (hasPod) {
          cells.push(resource.podName ? `\`${resource.podName}\`` : "-");
        }
        if (hasContainer) {
          cells.push(
            resource.containerName ? `\`${resource.containerName}\`` : "-",
          );
        }
        if (hasNode) {
          cells.push(resource.nodeName ? `\`${resource.nodeName}\`` : "-");
        }

        cells.push(`**${resource.metricValue}**`);

        resourceLines.push(`| ${cells.join(" | ")} |`);
      }

      if (sortedResources.length > 10) {
        resourceLines.push(
          `\n*... and ${sortedResources.length - 10} more affected resources*`,
        );
      }

      sections.push(
        `\n\n**Affected Resources** (${sortedResources.length} total)\n\n${resourceLines.join("\n")}`,
      );

      // Add root cause analysis based on metric type
      const analysis: string | null =
        MonitorCriteriaEvaluator.buildKubernetesRootCauseAnalysis({
          breakdown: breakdown,
          topResource: resourcesToShow[0]!,
        });

      if (analysis) {
        sections.push(`\n\n**Root Cause Analysis**\n${analysis}`);
      }

      // Fetch recent container logs for the top affected resource during CrashLoopBackOff
      if (
        (breakdown.metricName === "k8s.container.restarts" ||
          breakdown.metricName.includes("restart")) &&
        input.monitor.projectId
      ) {
        const topResource: KubernetesAffectedResource = resourcesToShow[0]!;

        try {
          const logAttributes: Record<string, string> = {};

          if (breakdown.clusterName) {
            logAttributes["resource.k8s.cluster.name"] = breakdown.clusterName;
          }

          if (topResource.podName) {
            logAttributes["resource.k8s.pod.name"] = topResource.podName;
          }

          if (topResource.containerName) {
            logAttributes["resource.k8s.container.name"] =
              topResource.containerName;
          }

          if (topResource.namespace) {
            logAttributes["resource.k8s.namespace.name"] =
              topResource.namespace;
          }

          const now: Date = OneUptimeDate.getCurrentDate();
          const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
            now,
            -15,
          );

          const logs: Array<JSONObject> =
            await LogAggregationService.getExportLogs({
              projectId: input.monitor.projectId,
              startTime: fifteenMinutesAgo,
              endTime: now,
              limit: 50,
              attributes: logAttributes,
            });

          if (logs.length > 0) {
            const logLines: Array<string> = logs.map((log: JSONObject) => {
              const timestamp: string = log["time"] ? String(log["time"]) : "";
              const severity: string = log["severityText"]
                ? String(log["severityText"])
                : "INFO";
              const body: string = log["body"] ? String(log["body"]) : "";
              return `\`${timestamp}\` **${severity}** ${body}`;
            });

            sections.push(
              `\n\n**Recent Container Logs** (${topResource.podName || "unknown pod"} / ${topResource.containerName || "unknown container"}, last 15 minutes)\n\n${logLines.join("\n\n")}`,
            );
          }
        } catch (err) {
          const k8sLogAttributes: LogAttributes = {
            projectId: input.monitor.projectId?.toString(),
          };
          logger.error(
            "Failed to fetch container logs for root cause context",
            k8sLogAttributes,
          );
          logger.error(err, k8sLogAttributes);
        }
      }
    }

    return sections.join("\n");
  }

  private static buildDockerRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const sections: Array<string> = [];

    // Docker host context
    const dockerMonitor: MonitorStepDockerMonitor | undefined =
      input.monitorStep.data?.dockerMonitor;

    if (dockerMonitor) {
      const hostDetails: Array<string> = [];
      hostDetails.push(`- Host: ${dockerMonitor.hostIdentifier || "Unknown"}`);

      if (dockerMonitor.containerFilters?.containerName) {
        hostDetails.push(
          `- Container Name Filter: ${dockerMonitor.containerFilters.containerName}`,
        );
      }

      if (dockerMonitor.containerFilters?.containerImage) {
        hostDetails.push(
          `- Container Image Filter: ${dockerMonitor.containerFilters.containerImage}`,
        );
      }

      // Add metric name from the query config
      if (
        dockerMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        dockerMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = dockerMonitor.metricViewConfig
          .queryConfigs[0].metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          hostDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      sections.push(`**Docker Host Details**\n${hostDetails.join("\n")}`);
    }

    // Metric results summary
    if (metricResponse.metricResult && metricResponse.metricResult.length > 0) {
      const resultDetails: Array<string> = [];

      for (const result of metricResponse.metricResult) {
        if (result.data && result.data.length > 0) {
          resultDetails.push(
            `- ${result.data.length} metric data point(s) returned`,
          );
        }
      }

      if (resultDetails.length > 0) {
        sections.push(`\n\n**Metric Summary**\n${resultDetails.join("\n")}`);
      }
    }

    return sections.length > 0 ? sections.join("\n") : null;
  }

  private static buildKubernetesRootCauseAnalysis(input: {
    breakdown: KubernetesResourceBreakdown;
    topResource: KubernetesAffectedResource;
  }): string | null {
    const { breakdown, topResource } = input;
    const metricName: string = breakdown.metricName;
    const lines: Array<string> = [];

    if (
      metricName === "k8s.container.restarts" ||
      metricName.includes("restart")
    ) {
      lines.push(
        `Container restart count is elevated, indicating a potential CrashLoopBackOff condition.`,
      );
      if (topResource.containerName) {
        lines.push(
          `The container \`${topResource.containerName}\` in pod \`${topResource.podName || "unknown"}\` has restarted **${topResource.metricValue}** times.`,
        );
      }
      lines.push(
        `Common causes: application crash on startup, misconfigured environment variables, missing dependencies, OOM (Out of Memory) kills, failed health checks, or missing config maps/secrets.`,
      );
      lines.push(
        `Recommended actions: Check container logs with \`kubectl logs ${topResource.podName || "<pod-name>"} -c ${topResource.containerName || "<container>"} --previous\` and inspect events with \`kubectl describe pod ${topResource.podName || "<pod-name>"}\`.`,
      );
    } else if (
      metricName === "k8s.pod.phase" &&
      breakdown.attributes["k8s.pod.phase"] === "Pending"
    ) {
      lines.push(`Pods are stuck in Pending phase and unable to be scheduled.`);
      lines.push(
        `Common causes: insufficient CPU/memory resources on nodes, node affinity/taint restrictions preventing scheduling, PersistentVolumeClaim pending, or resource quota exceeded.`,
      );
      if (topResource.podName) {
        lines.push(
          `Recommended actions: Check scheduling events with \`kubectl describe pod ${topResource.podName}\` and verify node resources with \`kubectl describe nodes\`.`,
        );
      }
    } else if (
      metricName === "k8s.node.condition_ready" ||
      (metricName.includes("node") && metricName.includes("condition"))
    ) {
      lines.push(`One or more nodes have transitioned to a NotReady state.`);
      if (topResource.nodeName) {
        lines.push(
          `Node \`${topResource.nodeName}\` is reporting NotReady (value: ${topResource.metricValue}).`,
        );
      }
      lines.push(
        `Common causes: kubelet process failure, node resource exhaustion (disk pressure, memory pressure, PID pressure), network connectivity issues, or underlying VM/hardware failure.`,
      );
      lines.push(
        `Recommended actions: Check node conditions with \`kubectl describe node ${topResource.nodeName || "<node-name>"}\` and verify kubelet status on the node.`,
      );
    } else if (
      metricName === "k8s.node.cpu.utilization" ||
      (metricName.includes("cpu") && metricName.includes("utilization"))
    ) {
      lines.push(`Node CPU utilization has exceeded the configured threshold.`);
      if (topResource.nodeName) {
        lines.push(
          `Node \`${topResource.nodeName}\` is at **${topResource.metricValue.toFixed(1)}%** CPU utilization.`,
        );
      }
      lines.push(
        `Common causes: resource-intensive workloads, insufficient resource limits on pods, noisy neighbor pods consuming excessive CPU, or insufficient cluster capacity.`,
      );
      lines.push(
        `Recommended actions: Identify top CPU consumers with \`kubectl top pods --all-namespaces --sort-by=cpu\` and consider scaling the cluster or adjusting pod resource limits.`,
      );
    } else if (
      metricName === "k8s.node.memory.usage" ||
      (metricName.includes("memory") && metricName.includes("usage"))
    ) {
      lines.push(
        `Node memory utilization has exceeded the configured threshold.`,
      );
      if (topResource.nodeName) {
        lines.push(
          `Node \`${topResource.nodeName}\` memory usage is at **${topResource.metricValue.toFixed(1)}%**.`,
        );
      }
      lines.push(
        `Common causes: memory leaks in applications, insufficient memory limits on pods, too many pods scheduled on the node, or growing dataset sizes.`,
      );
      lines.push(
        `Recommended actions: Check memory consumers with \`kubectl top pods --all-namespaces --sort-by=memory\` and review pod memory limits. Consider scaling the cluster or adding nodes with more memory.`,
      );
    } else if (
      metricName === "k8s.deployment.unavailable_replicas" ||
      metricName.includes("unavailable")
    ) {
      lines.push(
        `Deployment has unavailable replicas, indicating a mismatch between desired and available replicas.`,
      );
      if (topResource.workloadName) {
        lines.push(
          `${topResource.workloadType || "Deployment"} \`${topResource.workloadName}\` has **${topResource.metricValue}** unavailable replica(s).`,
        );
      }
      lines.push(
        `Common causes: failed rolling update, image pull errors (wrong image tag or missing registry credentials), pod crash loops, insufficient cluster resources to schedule new pods, or PodDisruptionBudget blocking updates.`,
      );
      lines.push(
        `Recommended actions: Check deployment rollout status with \`kubectl rollout status deployment/${topResource.workloadName || "<deployment>"}\` and inspect pod events.`,
      );
    } else if (
      metricName === "k8s.job.failed_pods" ||
      (metricName.includes("job") && metricName.includes("fail"))
    ) {
      lines.push(`Kubernetes Job has failed pods.`);
      if (topResource.workloadName) {
        lines.push(
          `Job \`${topResource.workloadName}\` has **${topResource.metricValue}** failed pod(s).`,
        );
      }
      lines.push(
        `Common causes: application error or non-zero exit code, resource limits exceeded (OOMKilled), misconfigured command or arguments, missing environment variables, or timeout exceeded.`,
      );
      lines.push(
        `Recommended actions: Check job status with \`kubectl describe job ${topResource.workloadName || "<job-name>"}\` and review pod logs for the failed pod(s).`,
      );
    } else if (
      metricName === "k8s.node.filesystem.usage" ||
      metricName.includes("disk") ||
      metricName.includes("filesystem")
    ) {
      lines.push(
        `Node disk/filesystem usage has exceeded the configured threshold.`,
      );
      if (topResource.nodeName) {
        lines.push(
          `Node \`${topResource.nodeName}\` filesystem usage is at **${topResource.metricValue.toFixed(1)}%**.`,
        );
      }
      lines.push(
        `Common causes: container image layers consuming disk space, excessive logging, large emptyDir volumes, or accumulation of unused container images.`,
      );
      lines.push(
        `Recommended actions: Clean up unused images with \`docker system prune\` or \`crictl rmi --prune\`, check for large log files, and review PersistentVolumeClaim usage.`,
      );
    } else if (
      metricName === "k8s.daemonset.misscheduled_nodes" ||
      metricName.includes("daemonset")
    ) {
      lines.push(`DaemonSet has misscheduled or unavailable nodes.`);
      if (topResource.workloadName) {
        lines.push(
          `DaemonSet \`${topResource.workloadName}\` has **${topResource.metricValue}** misscheduled node(s).`,
        );
      }
      lines.push(
        `Common causes: node taints preventing scheduling, incorrect node selectors, or node affinity rules excluding certain nodes.`,
      );
      lines.push(
        `Recommended actions: Check DaemonSet status with \`kubectl describe daemonset ${topResource.workloadName || "<daemonset>"}\` and verify node labels and taints.`,
      );
    } else {
      // Generic Kubernetes context
      lines.push(
        `Kubernetes metric \`${metricName}\` (${breakdown.metricFriendlyName}) has breached the configured threshold.`,
      );
      if (topResource.podName) {
        lines.push(`Most affected pod: \`${topResource.podName}\``);
      }
      if (topResource.nodeName) {
        lines.push(`Most affected node: \`${topResource.nodeName}\``);
      }
      lines.push(
        `Recommended actions: Investigate the affected resources using \`kubectl describe\` and \`kubectl logs\` commands.`,
      );
    }

    return lines.join("\n");
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
