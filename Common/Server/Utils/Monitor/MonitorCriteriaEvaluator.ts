import logger, { LogAttributes } from "../Logger";
import LogAggregationService from "../../Services/LogAggregationService";
import VMUtil from "../VM/VMAPI";
import APIRequestCriteria from "./Criteria/APIRequestCriteria";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import IncomingEmailCriteria from "./Criteria/IncomingEmailCriteria";
import IncomingRequestCriteria from "./Criteria/IncomingRequestCriteria";
import IncomingRequestIncidentGrouping from "./IncomingRequestIncidentGrouping";
import SSLMonitorCriteria from "./Criteria/SSLMonitorCriteria";
import ServerMonitorCriteria from "./Criteria/ServerMonitorCriteria";
import SyntheticMonitoringCriteria from "./Criteria/SyntheticMonitor";
import LogMonitorCriteria from "./Criteria/LogMonitorCriteria";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "./Criteria/MetricMonitorCriteria";
import TraceMonitorCriteria from "./Criteria/TraceMonitorCriteria";
import ExceptionMonitorCriteria from "./Criteria/ExceptionMonitorCriteria";
import ProfileMonitorCriteria from "./Criteria/ProfileMonitorCriteria";
import SnmpMonitorCriteria from "./Criteria/SnmpMonitorCriteria";
import DnsMonitorCriteria from "./Criteria/DnsMonitorCriteria";
import DomainMonitorCriteria from "./Criteria/DomainMonitorCriteria";
import DnssecMonitorCriteria from "./Criteria/DnssecMonitorCriteria";
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
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../Types/Probe/ProbeApiIngestResponse";
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
  ProxmoxAffectedResource,
  ProxmoxResourceBreakdown,
  CephAffectedResource,
  CephResourceBreakdown,
  DockerSwarmAffectedResource,
  DockerSwarmResourceBreakdown,
} from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricCriteriaContext, {
  MetricBreachingSample,
  MetricComponent,
  MetricComponentValue,
} from "../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MonitorStepDockerMonitor from "../../../Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepHostMonitor from "../../../Types/Monitor/MonitorStepHostMonitor";
import MonitorStepPodmanMonitor from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepCephMonitor from "../../../Types/Monitor/MonitorStepCephMonitor";
import MonitorStepDockerSwarmMonitor from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepIoTMonitor from "../../../Types/Monitor/MonitorStepIoTMonitor";
import { IoTFleetNameLabelKeys } from "./SeriesResourceLabels";

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
      /*
       * Record disabled criteria in the summary (so the user can see why
       * nothing happened) but skip evaluation, status changes, incidents,
       * and alerts.
       */
      if (criteriaInstance.data?.isEnabled === false) {
        const skipReason: string =
          "This criteria is disabled and was not evaluated.";
        const skippedCriteriaResult: MonitorEvaluationCriteriaResult = {
          criteriaId: criteriaInstance.data?.id,
          criteriaName: criteriaInstance.data?.name,
          filterCondition:
            criteriaInstance.data?.filterCondition || FilterCondition.All,
          met: false,
          message: skipReason,
          filters: [],
          skipped: true,
          skipReason: skipReason,
        };

        input.evaluationSummary.criteriaResults.push(skippedCriteriaResult);
        continue;
      }

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

        /*
         * When this is a metric-style monitor with per-series results,
         * compute the per-series match list so MonitorResource can fan
         * out one incident per affected series. We do this *after* the
         * scalar criteriaMetId/rootCause is populated so legacy readers
         * still see a usable response if perSeriesMatches is ignored.
         */
        const perSeriesMatches: Array<PerSeriesCriteriaMatch> =
          await MonitorCriteriaEvaluator.collectPerSeriesMatches({
            dataToProcess: input.dataToProcess,
            monitor: input.monitor,
            monitorStep: input.monitorStep,
            criteriaInstance,
          });

        if (perSeriesMatches.length > 0) {
          input.probeApiIngestResponse.perSeriesMatches = perSeriesMatches;
        } else if (
          input.monitor.monitorType === MonitorType.IncomingRequest &&
          IncomingRequestIncidentGrouping.isGroupingConfigured(criteriaInstance)
        ) {
          /*
           * Grouped incoming-request criteria that produced no firing key
           * (e.g. a pure "resolved" webhook). Force per-series mode with an
           * empty set so the create path does NOT fall back to opening a
           * single whole-monitor incident.
           */
          input.probeApiIngestResponse.perSeriesMatches = [];
        }

        break;
      }
    }

    return input.probeApiIngestResponse;
  }

  /**
   * For metric-backed monitors (Metrics/Kubernetes/Docker/Proxmox/Ceph)
   * with per-series aggregated results, re-evaluate the matched criteria
   * once per series and return one entry per series that breached.
   * Returns an empty array when the monitor is not series-aware or
   * no series matched — the caller falls back to the single-incident
   * path in that case.
   */
  private static async collectPerSeriesMatches(input: {
    dataToProcess: DataToProcess;
    monitor: Monitor;
    monitorStep: MonitorStep;
    criteriaInstance: MonitorCriteriaInstance;
  }): Promise<Array<PerSeriesCriteriaMatch>> {
    /*
     * Incoming Request / webhook monitors fan out per payload-derived key
     * (e.g. one incident per Grafana alert name) when incidentGrouping is
     * configured. No-op (returns []) when grouping is not configured, so
     * existing incoming-request monitors keep their single-incident
     * behaviour.
     */
    if (input.monitor.monitorType === MonitorType.IncomingRequest) {
      return IncomingRequestIncidentGrouping.collectFiringMatches({
        dataToProcess: input.dataToProcess,
        criteriaInstance: input.criteriaInstance,
      });
    }

    if (
      input.monitor.monitorType !== MonitorType.Metrics &&
      input.monitor.monitorType !== MonitorType.Kubernetes &&
      input.monitor.monitorType !== MonitorType.Docker &&
      input.monitor.monitorType !== MonitorType.Host &&
      input.monitor.monitorType !== MonitorType.Podman &&
      input.monitor.monitorType !== MonitorType.DockerSwarm &&
      input.monitor.monitorType !== MonitorType.Proxmox &&
      input.monitor.monitorType !== MonitorType.Ceph &&
      input.monitor.monitorType !== MonitorType.IoTDevice
    ) {
      return [];
    }

    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const seriesBreakdown: Array<MetricSeriesResult> | undefined =
      metricResponse.seriesBreakdown;

    if (!seriesBreakdown || seriesBreakdown.length === 0) {
      return [];
    }

    const criteriaId: string | undefined = input.criteriaInstance.data?.id;
    if (!criteriaId) {
      return [];
    }

    const filterCondition: FilterCondition =
      input.criteriaInstance.data?.filterCondition || FilterCondition.All;

    const filters: Array<CriteriaFilter> =
      input.criteriaInstance.data?.filters || [];

    /*
     * Evaluate every metric-value filter against every series. We only
     * handle CheckOn.MetricValue for now — the criteria evaluator's
     * other filter types don't carry series information.
     */
    const metricFilters: Array<CriteriaFilter> = filters.filter(
      (f: CriteriaFilter) => {
        return f.checkOn === CheckOn.MetricValue;
      },
    );

    if (metricFilters.length === 0) {
      return [];
    }

    /*
     * Key: fingerprint. Value: results of each metric filter for that
     * series, tracked so we can apply FilterCondition.All/Any per series.
     */
    const resultsByFingerprint: Map<
      string,
      {
        labels: JSONObject;
        filterResults: Array<MetricSeriesEvaluationResult>;
      }
    > = new Map();

    for (const criteriaFilter of metricFilters) {
      const evaluations: Array<MetricSeriesEvaluationResult> =
        await MetricMonitorCriteria.evaluateAllSeries({
          dataToProcess: input.dataToProcess,
          criteriaFilter,
          monitorStep: input.monitorStep,
        });

      for (const evaluation of evaluations) {
        const fingerprint: string | undefined = evaluation.fingerprint;
        if (!fingerprint) {
          continue;
        }

        const existing:
          | {
              labels: JSONObject;
              filterResults: Array<MetricSeriesEvaluationResult>;
            }
          | undefined = resultsByFingerprint.get(fingerprint);

        if (existing) {
          existing.filterResults.push(evaluation);
        } else {
          resultsByFingerprint.set(fingerprint, {
            labels: evaluation.labels,
            filterResults: [evaluation],
          });
        }
      }
    }

    const matches: Array<PerSeriesCriteriaMatch> = [];

    for (const [fingerprint, entry] of resultsByFingerprint) {
      // Were all/any of the metric filters met for this series?
      const matched: Array<MetricSeriesEvaluationResult> =
        entry.filterResults.filter((r: MetricSeriesEvaluationResult) => {
          return r.rootCause !== null;
        });

      const seriesMatched: boolean =
        filterCondition === FilterCondition.All
          ? matched.length === entry.filterResults.length &&
            entry.filterResults.length > 0
          : matched.length > 0;

      if (!seriesMatched) {
        continue;
      }

      /*
       * For the per-series rootCause, concatenate the matched filter
       * messages so the incident message reflects exactly what
       * breached on this specific series.
       */
      const rootCauseLines: Array<string> = matched.map(
        (r: MetricSeriesEvaluationResult) => {
          return `- ${r.rootCause}`;
        },
      );

      matches.push({
        criteriaMetId: criteriaId,
        fingerprint,
        labels: MonitorCriteriaEvaluator.stampIoTFleetLabelOnSeriesLabels({
          monitorType: input.monitor.monitorType,
          monitorStep: input.monitorStep,
          labels: entry.labels,
        }),
        rootCause: rootCauseLines.join("\n"),
        metricContext: matched[0]?.context,
      });
    }

    return matches;
  }

  /**
   * Shipped IoT alert templates group by the `device.id` datapoint
   * label, so their series labels do NOT carry the `iot.fleet.name`
   * resource attribute. Fleet-scoped scheduled-maintenance suppression
   * matches series by that label (see SeriesResourceLabels /
   * MonitorMaintenanceSuppression), so without it a fleet maintenance
   * window would never suppress the fleet's device series. The monitor
   * step's `fleetIdentifier` is the deterministic source of the fleet
   * every series of an IoT monitor belongs to (same reasoning as
   * MonitorClusterContext), so stamp it onto the series labels when the
   * series doesn't already carry a fleet label. Returns a new object
   * when stamping — the input labels are shared with the series
   * breakdown on the response and must not be mutated.
   */
  public static stampIoTFleetLabelOnSeriesLabels(input: {
    monitorType: MonitorType | undefined;
    monitorStep: MonitorStep;
    labels: JSONObject;
  }): JSONObject {
    if (input.monitorType !== MonitorType.IoTDevice) {
      return input.labels;
    }

    const fleetIdentifier: string | undefined =
      input.monitorStep.data?.iotMonitor?.fleetIdentifier?.trim();

    if (!fleetIdentifier) {
      return input.labels;
    }

    const hasFleetLabel: boolean = IoTFleetNameLabelKeys.some((key: string) => {
      const value: unknown = input.labels[key];
      return typeof value === "string" && value.length > 0;
    });

    if (hasFleetLabel) {
      return input.labels;
    }

    return { ...input.labels, "iot.fleet.name": fleetIdentifier };
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
      input.monitor.monitorType === MonitorType.Docker ||
      input.monitor.monitorType === MonitorType.Host ||
      input.monitor.monitorType === MonitorType.Podman ||
      input.monitor.monitorType === MonitorType.DockerSwarm ||
      input.monitor.monitorType === MonitorType.Proxmox ||
      input.monitor.monitorType === MonitorType.Ceph ||
      input.monitor.monitorType === MonitorType.IoTDevice
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

    if (input.monitor.monitorType === MonitorType.DNSSEC) {
      const dnssecMonitorResult: string | null =
        await DnssecMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: input.dataToProcess,
          criteriaFilter: input.criteriaFilter,
        });

      if (dnssecMonitorResult) {
        return dnssecMonitorResult;
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

    // Handle Host monitors with resource context
    if (input.monitor.monitorType === MonitorType.Host) {
      return MonitorCriteriaEvaluator.buildHostRootCauseContext(input);
    }

    // Handle Podman monitors with resource context
    if (input.monitor.monitorType === MonitorType.Podman) {
      return MonitorCriteriaEvaluator.buildPodmanRootCauseContext(input);
    }

    // Handle Proxmox monitors with resource context
    if (input.monitor.monitorType === MonitorType.Proxmox) {
      return MonitorCriteriaEvaluator.buildProxmoxRootCauseContext(input);
    }

    // Handle Docker Swarm monitors with resource context
    if (input.monitor.monitorType === MonitorType.DockerSwarm) {
      return MonitorCriteriaEvaluator.buildDockerSwarmRootCauseContext(input);
    }

    // Handle Ceph monitors with resource context
    if (input.monitor.monitorType === MonitorType.Ceph) {
      return MonitorCriteriaEvaluator.buildCephRootCauseContext(input);
    }

    // Handle IoT Device monitors with device/fleet context
    if (input.monitor.monitorType === MonitorType.IoTDevice) {
      return MonitorCriteriaEvaluator.buildIoTRootCauseContext(input);
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

    /*
     * For formulas, enumerate the underlying variables so the on-call
     * engineer can trace `c = a + b` back to "a is container.cpu.time,
     * b is container.memory.usage in bytes" without clicking away.
     */
    if (ctx.components && ctx.components.length > 0) {
      const componentLines: Array<string> = ctx.components.map(
        (component: MetricComponent) => {
          const unitSuffix: string = component.unit
            ? ` — unit: ${component.unit}`
            : "";
          const typeSuffix: string = component.isFormula ? " (formula)" : "";
          return `  - \`${component.alias}\` = \`${component.name}\`${typeSuffix}${unitSuffix}`;
        },
      );
      lines.push(`- Components:\n${componentLines.join("\n")}`);
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
          components: ctx.components || [],
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
    components: Array<MetricComponent>;
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
     * Escape pipe characters that could appear in the metric display
     * name (formulas like "a | b" are unlikely but possible) so they
     * don't break GitHub-flavored-markdown tables.
     */
    const escapeCell: (value: string) => string = (value: string): string => {
      return value.replace(/\|/g, "\\|");
    };

    /*
     * Column layout:
     *   Timestamp | Metric | Alias | Value | <component_1> | ... | <attr_1> | ...
     *
     * The component columns let the reader see what each variable of a
     * formula resolved to at the breach time — e.g. "when c = a + b
     * breached 100, a was 55, b was 46". They are omitted for plain
     * metric criteria.
     */
    const headerCells: Array<string> = [
      "Timestamp",
      "Metric",
      "Alias",
      "Value",
    ];

    for (const component of input.components) {
      const label: string = component.unit
        ? `${component.alias} (${component.unit})`
        : component.alias;
      headerCells.push(label);
    }

    headerCells.push(...attrKeys);

    const unitSuffix: string = input.unit ? ` ${input.unit}` : "";

    const headerRow: string = `| ${headerCells.join(" | ")} |`;
    const dividerRow: string = `| ${headerCells
      .map(() => {
        return "---";
      })
      .join(" | ")} |`;

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

        for (const component of input.components) {
          const match: MetricComponentValue | undefined = (
            s.componentValues || []
          ).find((cv: MetricComponentValue) => {
            return cv.alias === component.alias;
          });
          if (match && typeof match.value === "number") {
            const componentUnitSuffix: string = component.unit
              ? ` ${component.unit}`
              : "";
            cells.push(
              `${MonitorCriteriaEvaluator.formatNumberForDisplay(match.value)}${componentUnitSuffix}`,
            );
          } else {
            cells.push("-");
          }
        }

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

  private static buildHostRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const sections: Array<string> = [];

    // Host context
    const hostMonitor: MonitorStepHostMonitor | undefined =
      input.monitorStep.data?.hostMonitor;

    if (hostMonitor) {
      const hostDetails: Array<string> = [];
      hostDetails.push(`- Host: ${hostMonitor.hostIdentifier || "Unknown"}`);

      // Add metric name from the query config
      if (
        hostMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        hostMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = hostMonitor.metricViewConfig.queryConfigs[0]
          .metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          hostDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      sections.push(`**Host Details**\n${hostDetails.join("\n")}`);
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

  private static buildPodmanRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const sections: Array<string> = [];

    // Podman host context
    const podmanMonitor: MonitorStepPodmanMonitor | undefined =
      input.monitorStep.data?.podmanMonitor;

    if (podmanMonitor) {
      const hostDetails: Array<string> = [];
      hostDetails.push(`- Host: ${podmanMonitor.hostIdentifier || "Unknown"}`);

      if (podmanMonitor.containerFilters?.containerName) {
        hostDetails.push(
          `- Container Name Filter: ${podmanMonitor.containerFilters.containerName}`,
        );
      }

      if (podmanMonitor.containerFilters?.containerImage) {
        hostDetails.push(
          `- Container Image Filter: ${podmanMonitor.containerFilters.containerImage}`,
        );
      }

      // Add metric name from the query config
      if (
        podmanMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        podmanMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = podmanMonitor.metricViewConfig
          .queryConfigs[0].metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          hostDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      sections.push(`**Podman Host Details**\n${hostDetails.join("\n")}`);
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

  private static buildProxmoxRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const breakdown: ProxmoxResourceBreakdown | undefined =
      metricResponse.proxmoxResourceBreakdown;

    const sections: Array<string> = [];

    // Proxmox cluster context
    const proxmoxMonitor: MonitorStepProxmoxMonitor | undefined =
      input.monitorStep.data?.proxmoxMonitor;

    if (proxmoxMonitor || breakdown) {
      const clusterDetails: Array<string> = [];
      clusterDetails.push(
        `- Cluster: ${breakdown?.clusterName || proxmoxMonitor?.clusterIdentifier || "Unknown"}`,
      );

      if (breakdown) {
        clusterDetails.push(
          `- Metric: ${breakdown.metricFriendlyName} (\`${breakdown.metricName}\`)`,
        );
      } else if (
        proxmoxMonitor &&
        proxmoxMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        proxmoxMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = proxmoxMonitor.metricViewConfig
          .queryConfigs[0].metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          clusterDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      if (proxmoxMonitor?.resourceFilters?.scope) {
        clusterDetails.push(
          `- Scope Filter: ${proxmoxMonitor.resourceFilters.scope}`,
        );
      }

      if (proxmoxMonitor?.resourceFilters?.pveId) {
        clusterDetails.push(
          `- Resource ID Filter: ${proxmoxMonitor.resourceFilters.pveId}`,
        );
      }

      if (proxmoxMonitor?.resourceFilters?.nodeName) {
        clusterDetails.push(
          `- Node Filter: ${proxmoxMonitor.resourceFilters.nodeName}`,
        );
      }

      if (proxmoxMonitor?.resourceFilters?.guestId) {
        clusterDetails.push(
          `- Guest ID Filter: ${proxmoxMonitor.resourceFilters.guestId}`,
        );
      }

      sections.push(
        `**Proxmox Cluster Details**\n${clusterDetails.join("\n")}`,
      );
    }

    // Affected resources (Resource / Type / Node / Value)
    let renderedBreakdownTable: boolean = false;

    if (breakdown && breakdown.affectedResources.length > 0) {
      /*
       * K8s-parity render: drop zero-value rows, worst (highest)
       * first, top 10. Note that for availability metrics (pve_up)
       * zero-valued rows ARE the down resources — those still drive
       * alerting through the per-series criteria evaluation; this
       * table is supplementary context only.
       */
      const sortedResources: Array<ProxmoxAffectedResource> = [
        ...breakdown.affectedResources,
      ]
        .filter((r: ProxmoxAffectedResource) => {
          return r.metricValue > 0;
        })
        .sort((a: ProxmoxAffectedResource, b: ProxmoxAffectedResource) => {
          return b.metricValue - a.metricValue;
        });

      /*
       * Skip the table when no row carries any identity label
       * (cluster-wide series) — it would add nothing.
       */
      const hasIdentity: boolean = sortedResources.some(
        (r: ProxmoxAffectedResource) => {
          return r.resourceId || r.resourceName || r.nodeName;
        },
      );

      if (sortedResources.length > 0 && hasIdentity) {
        const resourcesToShow: Array<ProxmoxAffectedResource> =
          sortedResources.slice(0, 10);

        const resourceLines: Array<string> = [];
        resourceLines.push(`| Resource | Type | Node | Value |`);
        resourceLines.push(`| --- | --- | --- | --- |`);

        for (const resource of resourcesToShow) {
          let resourceCell: string = "-";
          if (resource.resourceName && resource.resourceId) {
            resourceCell = `\`${resource.resourceName}\` (\`${resource.resourceId}\`)`;
          } else if (resource.resourceId) {
            resourceCell = `\`${resource.resourceId}\``;
          } else if (resource.resourceName) {
            resourceCell = `\`${resource.resourceName}\``;
          }

          const typeCell: string =
            resource.resourceType || resource.scope || "-";
          const nodeCell: string = resource.nodeName
            ? `\`${resource.nodeName}\``
            : "-";

          resourceLines.push(
            `| ${resourceCell} | ${typeCell} | ${nodeCell} | **${resource.metricValue}** |`,
          );
        }

        if (sortedResources.length > 10) {
          resourceLines.push(
            `\n*... and ${sortedResources.length - 10} more affected resources*`,
          );
        }

        sections.push(
          `\n\n**Affected Resources** (${sortedResources.length} total)\n\n${resourceLines.join("\n")}`,
        );
        renderedBreakdownTable = true;
      }
    }

    // Metric results summary (fallback context when no table rendered)
    if (
      !renderedBreakdownTable &&
      metricResponse.metricResult &&
      metricResponse.metricResult.length > 0
    ) {
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

  private static buildDockerSwarmRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const breakdown: DockerSwarmResourceBreakdown | undefined =
      metricResponse.dockerSwarmResourceBreakdown;

    const sections: Array<string> = [];

    // Docker Swarm cluster context
    const dockerSwarmMonitor: MonitorStepDockerSwarmMonitor | undefined =
      input.monitorStep.data?.dockerSwarmMonitor;

    if (dockerSwarmMonitor || breakdown) {
      const clusterDetails: Array<string> = [];
      clusterDetails.push(
        `- Cluster: ${breakdown?.clusterName || dockerSwarmMonitor?.clusterIdentifier || "Unknown"}`,
      );

      if (breakdown) {
        clusterDetails.push(
          `- Metric: ${breakdown.metricFriendlyName} (\`${breakdown.metricName}\`)`,
        );
      } else if (
        dockerSwarmMonitor &&
        dockerSwarmMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        dockerSwarmMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = dockerSwarmMonitor.metricViewConfig
          .queryConfigs[0].metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          clusterDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      if (dockerSwarmMonitor?.resourceFilters?.serviceName) {
        clusterDetails.push(
          `- Service Filter: ${dockerSwarmMonitor.resourceFilters.serviceName}`,
        );
      }

      if (dockerSwarmMonitor?.resourceFilters?.nodeName) {
        clusterDetails.push(
          `- Node Filter: ${dockerSwarmMonitor.resourceFilters.nodeName}`,
        );
      }

      if (dockerSwarmMonitor?.resourceFilters?.containerName) {
        clusterDetails.push(
          `- Container Name Filter: ${dockerSwarmMonitor.resourceFilters.containerName}`,
        );
      }

      if (dockerSwarmMonitor?.resourceFilters?.containerImage) {
        clusterDetails.push(
          `- Container Image Filter: ${dockerSwarmMonitor.resourceFilters.containerImage}`,
        );
      }

      sections.push(
        `**Docker Swarm Cluster Details**\n${clusterDetails.join("\n")}`,
      );
    }

    // Affected resources (Task / Service / Node / Value)
    let renderedBreakdownTable: boolean = false;

    if (breakdown && breakdown.affectedResources.length > 0) {
      /*
       * K8s/Proxmox-parity render: drop zero-value rows, worst (highest)
       * first, top 10. For the task-down template the breaching rows ARE
       * the zero-uptime ones — those still drive alerting through the
       * per-series criteria evaluation; this table is supplementary
       * context only.
       */
      const sortedResources: Array<DockerSwarmAffectedResource> = [
        ...breakdown.affectedResources,
      ]
        .filter((r: DockerSwarmAffectedResource) => {
          return r.metricValue > 0;
        })
        .sort(
          (a: DockerSwarmAffectedResource, b: DockerSwarmAffectedResource) => {
            return b.metricValue - a.metricValue;
          },
        );

      /*
       * Skip the table when no row carries any identity label
       * (cluster-wide series) — it would add nothing.
       */
      const hasIdentity: boolean = sortedResources.some(
        (r: DockerSwarmAffectedResource) => {
          return r.containerName || r.serviceName || r.nodeName;
        },
      );

      if (sortedResources.length > 0 && hasIdentity) {
        const resourcesToShow: Array<DockerSwarmAffectedResource> =
          sortedResources.slice(0, 10);

        const resourceLines: Array<string> = [];
        resourceLines.push(`| Task / Container | Service | Node | Value |`);
        resourceLines.push(`| --- | --- | --- | --- |`);

        for (const resource of resourcesToShow) {
          const taskCell: string = resource.containerName
            ? `\`${resource.containerName}\``
            : "-";
          const serviceCell: string = resource.serviceName
            ? `\`${resource.serviceName}\``
            : "-";
          const nodeCell: string = resource.nodeName
            ? `\`${resource.nodeName}\``
            : "-";

          resourceLines.push(
            `| ${taskCell} | ${serviceCell} | ${nodeCell} | **${resource.metricValue}** |`,
          );
        }

        if (sortedResources.length > 10) {
          resourceLines.push(
            `\n*... and ${sortedResources.length - 10} more affected tasks*`,
          );
        }

        sections.push(
          `\n\n**Affected Tasks** (${sortedResources.length} total)\n\n${resourceLines.join("\n")}`,
        );
        renderedBreakdownTable = true;
      }
    }

    // Metric results summary (fallback context when no table rendered)
    if (
      !renderedBreakdownTable &&
      metricResponse.metricResult &&
      metricResponse.metricResult.length > 0
    ) {
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

  private static buildCephRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const breakdown: CephResourceBreakdown | undefined =
      metricResponse.cephResourceBreakdown;

    const sections: Array<string> = [];

    // Ceph cluster context
    const cephMonitor: MonitorStepCephMonitor | undefined =
      input.monitorStep.data?.cephMonitor;

    if (cephMonitor || breakdown) {
      const clusterDetails: Array<string> = [];
      clusterDetails.push(
        `- Cluster: ${breakdown?.clusterName || cephMonitor?.clusterIdentifier || "Unknown"}`,
      );

      if (breakdown) {
        clusterDetails.push(
          `- Metric: ${breakdown.metricFriendlyName} (\`${breakdown.metricName}\`)`,
        );
      } else if (
        cephMonitor &&
        cephMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        cephMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = cephMonitor.metricViewConfig.queryConfigs[0]
          .metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          clusterDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      if (cephMonitor?.resourceFilters?.osdId) {
        clusterDetails.push(
          `- OSD Filter: ${cephMonitor.resourceFilters.osdId}`,
        );
      }

      if (cephMonitor?.resourceFilters?.poolId) {
        clusterDetails.push(
          `- Pool ID Filter: ${cephMonitor.resourceFilters.poolId}`,
        );
      }

      sections.push(`**Ceph Cluster Details**\n${clusterDetails.join("\n")}`);
    }

    // Affected resources (Daemon / Pool / Host / Value)
    let renderedBreakdownTable: boolean = false;

    if (breakdown && breakdown.affectedResources.length > 0) {
      /*
       * K8s-parity render: drop zero-value rows, worst (highest)
       * first, top 10. Note that for availability metrics
       * (ceph_osd_up / ceph_osd_in / ceph_mon_quorum_status)
       * zero-valued rows ARE the down resources — those still drive
       * alerting through the per-series criteria evaluation; this
       * table is supplementary context only.
       */
      const sortedResources: Array<CephAffectedResource> = [
        ...breakdown.affectedResources,
      ]
        .filter((r: CephAffectedResource) => {
          return r.metricValue > 0;
        })
        .sort((a: CephAffectedResource, b: CephAffectedResource) => {
          return b.metricValue - a.metricValue;
        });

      /*
       * Skip the table when no row carries any identity label
       * (cluster-wide series like ceph_health_status) — it would add
       * nothing.
       */
      const hasIdentity: boolean = sortedResources.some(
        (r: CephAffectedResource) => {
          return r.daemon || r.poolId || r.poolName || r.hostname;
        },
      );

      if (sortedResources.length > 0 && hasIdentity) {
        const resourcesToShow: Array<CephAffectedResource> =
          sortedResources.slice(0, 10);

        const resourceLines: Array<string> = [];
        resourceLines.push(`| Daemon | Pool | Host | Value |`);
        resourceLines.push(`| --- | --- | --- | --- |`);

        for (const resource of resourcesToShow) {
          const daemonCell: string = resource.daemon
            ? `\`${resource.daemon}\``
            : "-";

          let poolCell: string = "-";
          if (resource.poolName && resource.poolId) {
            poolCell = `\`${resource.poolName}\` (\`${resource.poolId}\`)`;
          } else if (resource.poolName) {
            poolCell = `\`${resource.poolName}\``;
          } else if (resource.poolId) {
            poolCell = `\`${resource.poolId}\``;
          }

          const hostCell: string = resource.hostname
            ? `\`${resource.hostname}\``
            : "-";

          resourceLines.push(
            `| ${daemonCell} | ${poolCell} | ${hostCell} | **${resource.metricValue}** |`,
          );
        }

        if (sortedResources.length > 10) {
          resourceLines.push(
            `\n*... and ${sortedResources.length - 10} more affected resources*`,
          );
        }

        sections.push(
          `\n\n**Affected Resources** (${sortedResources.length} total)\n\n${resourceLines.join("\n")}`,
        );
        renderedBreakdownTable = true;
      }
    }

    // Metric results summary (fallback context when no table rendered)
    if (
      !renderedBreakdownTable &&
      metricResponse.metricResult &&
      metricResponse.metricResult.length > 0
    ) {
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

  /**
   * Device-aware root cause context for IoT Device monitors. Derives
   * identity strictly from data already in scope — the fired filter's
   * series labels / breaching-sample attributes (stamped by the IoT
   * agent on every datapoint) and the monitor step config — never from
   * a database lookup, since this runs inside the probe/telemetry
   * ingest hot path.
   */
  private static buildIoTRootCauseContext(input: {
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    monitor: Monitor;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
  }): string | null {
    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const sections: Array<string> = [];

    const iotMonitor: MonitorStepIoTMonitor | undefined =
      input.monitorStep.data?.iotMonitor;

    /*
     * Series identity for the filter that fired. Only metric-value
     * filters populate metricCriteriaContext at evaluation time, so
     * the first populated context belongs to the filter that ran
     * (same extraction as buildMetricRootCauseContext).
     */
    const ctx: MetricCriteriaContext | undefined = (
      input.criteriaInstance?.data?.filters || []
    )
      .map((f: CriteriaFilter) => {
        return f.metricCriteriaContext;
      })
      .find(
        (c: MetricCriteriaContext | undefined): c is MetricCriteriaContext => {
          return Boolean(c);
        },
      );

    const seriesLabels: JSONObject = ctx?.seriesLabels || {};
    const sampleAttributes: JSONObject = ctx?.breachingSample?.attributes || {};

    /*
     * The group-by identity rides the series labels; the agent-stamped
     * iot.device.* attributes ride every datapoint, so fall back to the
     * breaching sample's attributes for keys the monitor didn't group by.
     */
    const labelValue: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const fromLabels: unknown = seriesLabels[key];
      if (typeof fromLabels === "string" && fromLabels.length > 0) {
        return fromLabels;
      }
      const fromSample: unknown = sampleAttributes[key];
      if (typeof fromSample === "string" && fromSample.length > 0) {
        return fromSample;
      }
      return null;
    };

    const deviceId: string | null =
      labelValue("device.id") || iotMonitor?.resourceFilters?.deviceId || null;
    const fleetName: string | null =
      labelValue("iot.fleet.name") ||
      labelValue("resource.iot.fleet.name") ||
      iotMonitor?.fleetIdentifier ||
      null;
    const deviceType: string | null =
      labelValue("iot.device.type") ||
      iotMonitor?.resourceFilters?.deviceType ||
      null;
    const firmware: string | null = labelValue("iot.device.firmware");

    if (iotMonitor || deviceId || fleetName) {
      const deviceDetails: Array<string> = [];

      deviceDetails.push(`- Fleet: ${fleetName || "Unknown"}`);

      if (deviceId) {
        deviceDetails.push(`- Device ID: \`${deviceId}\``);
      }

      if (deviceType) {
        deviceDetails.push(`- Device Type: ${deviceType}`);
      }

      if (firmware) {
        deviceDetails.push(`- Firmware: ${firmware}`);
      }

      // Add metric name from the query config
      if (
        iotMonitor &&
        iotMonitor.metricViewConfig?.queryConfigs?.length > 0 &&
        iotMonitor.metricViewConfig.queryConfigs[0]
      ) {
        const metricName: string = iotMonitor.metricViewConfig.queryConfigs[0]
          .metricQueryData?.filterData?.metricName as string;
        if (metricName) {
          deviceDetails.push(`- Metric: \`${metricName}\``);
        }
      }

      if (iotMonitor?.resourceFilters?.scope) {
        deviceDetails.push(
          `- Scope Filter: ${iotMonitor.resourceFilters.scope}`,
        );
      }

      sections.push(`**IoT Device Details**\n${deviceDetails.join("\n")}`);
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
      /*
       * The k8s_cluster receiver encodes the phase in the metric VALUE
       * (1 = Pending) and emits no phase attribute, so the pod-pending
       * template — the only user of this metric — keys on the metric
       * name alone.
       */
      metricName === "k8s.pod.phase"
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
      /*
       * The replica-mismatch template queries k8s.deployment.desired /
       * k8s.deployment.available (the k8s_cluster receiver has no
       * unavailable_replicas metric) and the breakdown is built from the
       * first query, so the stored metric name is k8s.deployment.desired.
       */
      metricName === "k8s.deployment.desired" ||
      metricName.includes("unavailable")
    ) {
      lines.push(
        `Deployment has unavailable replicas, indicating a mismatch between desired and available replicas.`,
      );
      /*
       * For the desired-replicas breakdown, metricValue is the desired
       * count (deployments are ranked by size, not by mismatch), so a
       * per-workload unavailable claim would be misleading.
       */
      if (topResource.workloadName && metricName !== "k8s.deployment.desired") {
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
