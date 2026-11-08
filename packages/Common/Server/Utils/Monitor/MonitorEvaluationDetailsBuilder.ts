import Monitor from "../../../Models/DatabaseModels/Monitor";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationDetailsVersion,
  MonitorEvaluationFilterDetails,
  MonitorEvaluationRequest,
  MonitorEvaluationResponse,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationFilterResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import DataToProcess from "./DataToProcess";
import MonitorCriteriaDataExtractor from "./MonitorCriteriaDataExtractor";
import MonitorEvaluationEvidence, {
  MonitorEvaluationFilterEvidence,
} from "./MonitorEvaluationEvidence";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";
import MonitorRecordEvidence from "./MonitorRecordEvidence";

/*
 * BUILDS THE EVALUATION DETAILS STORED ON AN INCIDENT OR AN ALERT.
 *
 * From the check that opened it, the criteria that matched and the
 * evaluation summary the evaluator wrote while it judged them: which
 * criteria, how its filters combine, each filter with its own sentence and -
 * for a filter that matched - what it found and where
 * (MonitorEvaluationEvidence), when, from which probe, the request the check
 * made and what came back. Redacted (MonitorEvidenceRedaction) and bounded
 * (MonitorEvaluationDetailsLimits) before anything is returned.
 */

// The request methods a check can make, as an API monitor names them.
const HTTP_METHODS: ReadonlyArray<string> = Object.values(HTTPMethod);

// Monitor types whose step names a host rather than a URL.
const HOST_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
  MonitorType.DNS,
  MonitorType.DNSSEC,
  MonitorType.Domain,
  MonitorType.NTP,
];

// Monitor types whose step names a URL.
const URL_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
  MonitorType.ExternalStatusPage,
];

// What a probe reports of the response, for the types that make one.
const RESPONSE_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
];

export default class MonitorEvaluationDetailsBuilder {
  /*
   * The details for the criteria that matched, or null when this check's
   * evaluation did not match it - an incident a probe agreement opened from
   * another probe's check, say - since then this check says nothing about
   * why it opened.
   */
  public static async build(input: {
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    dataToProcess: DataToProcess;
    probeName?: string | undefined;
  }): Promise<MonitorEvaluationDetails | null> {
    const monitorType: MonitorType | undefined = input.monitor.monitorType;

    if (!monitorType || !input.evaluationSummary) {
      return null;
    }

    const criteriaId: string | undefined = input.criteriaInstance.data?.id
      ? input.criteriaInstance.data.id.toString()
      : undefined;

    const criteriaResult: MonitorEvaluationCriteriaResult | undefined =
      MonitorEvaluationDetailsBuilder.findCriteriaResult({
        evaluationSummary: input.evaluationSummary,
        criteriaId: criteriaId,
        criteriaName: input.criteriaInstance.data?.name,
      });

    if (!criteriaResult || !criteriaResult.met || criteriaResult.skipped) {
      return null;
    }

    const includeResponseContent: boolean =
      MonitorRecordEvidence.keepsResponseContent(input.monitor);

    const configuredFilters: Array<CriteriaFilter> =
      input.criteriaInstance.data?.filters || [];

    const filterResults: Array<MonitorEvaluationFilterResult> =
      criteriaResult.filters.slice(0, MonitorEvaluationDetailsLimits.filters);

    const filters: Array<MonitorEvaluationFilterDetails> = [];

    for (let index: number = 0; index < filterResults.length; index++) {
      const result: MonitorEvaluationFilterResult = filterResults[index]!;

      const configured: CriteriaFilter | undefined =
        configuredFilters[index] &&
        configuredFilters[index]!.checkOn === result.checkOn
          ? configuredFilters[index]
          : configuredFilters.find((filter: CriteriaFilter) => {
              return filter.checkOn === result.checkOn;
            });

      const filter: MonitorEvaluationFilterDetails = {
        checkOn: result.checkOn,
        met: Boolean(result.met),
        message: MonitorEvaluationEvidence.bound(
          result.message || "",
          MonitorEvaluationDetailsLimits.messageChars,
        ),
      };

      if (result.filterType) {
        filter.filterType = result.filterType;
      }

      if (result.value !== undefined && result.value !== null) {
        filter.value =
          typeof result.value === "number"
            ? result.value
            : MonitorEvaluationEvidence.bound(String(result.value));
      }

      /*
       * Only for the filters that matched: a filter that did not is said by
       * its sentence ("Response Status Code was 200...").
       */
      if (filter.met && configured) {
        const evidence: MonitorEvaluationFilterEvidence =
          await MonitorEvaluationEvidence.read({
            monitorType: monitorType,
            criteriaFilter: configured,
            dataToProcess: input.dataToProcess,
            includeResponseContent: includeResponseContent,
          });

        Object.assign(filter, evidence);
      }

      filters.push(filter);
    }

    if (filters.length === 0) {
      return null;
    }

    const details: MonitorEvaluationDetails = {
      version: MonitorEvaluationDetailsVersion,
      monitorType: monitorType,
      evaluatedAt:
        input.evaluationSummary.evaluatedAt || OneUptimeDate.getCurrentDate(),
      filterCondition: criteriaResult.filterCondition || FilterCondition.All,
      filters: filters,
    };

    if (criteriaResult.filters.length > filterResults.length) {
      details.areFiltersTruncated = true;
    }

    if (criteriaId) {
      details.criteriaId = criteriaId;
    }

    const criteriaName: string | undefined =
      criteriaResult.criteriaName || input.criteriaInstance.data?.name;

    if (criteriaName) {
      details.criteriaName = MonitorEvaluationEvidence.bound(criteriaName);
    }

    if (input.probeName) {
      details.probeName = MonitorEvaluationEvidence.bound(input.probeName, 100);
    }

    const steps: Array<MonitorStep> =
      input.monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

    if (input.monitorStep && steps.length > 1) {
      const stepIndex: number = steps.findIndex((step: MonitorStep) => {
        return step.id?.toString() === input.monitorStep!.id?.toString();
      });

      if (stepIndex !== -1) {
        details.stepNumber = stepIndex + 1;
        details.stepCount = steps.length;
      }
    }

    const request: MonitorEvaluationRequest | undefined =
      MonitorEvaluationDetailsBuilder.readRequest({
        monitorType: monitorType,
        monitorStep: input.monitorStep,
        dataToProcess: input.dataToProcess,
      });

    if (request) {
      details.request = request;
    }

    const response: MonitorEvaluationResponse | undefined =
      MonitorEvaluationDetailsBuilder.readResponse({
        monitorType: monitorType,
        dataToProcess: input.dataToProcess,
      });

    if (response) {
      details.response = response;
    }

    if (!includeResponseContent) {
      details.areResponseExcerptsOff = true;
    }

    return MonitorEvaluationDetailsBuilder.fitToSizeLimit(details);
  }

  /*
   * Keeps the record within MonitorEvaluationDetailsLimits.maxSizeInBytes,
   * shedding what costs the most and explains the least first: excerpts,
   * then field values, then the sentences' length, then filters past the
   * first five.
   */
  public static fitToSizeLimit(
    details: MonitorEvaluationDetails,
    maxSizeInBytes: number = MonitorEvaluationDetailsLimits.maxSizeInBytes,
  ): MonitorEvaluationDetails {
    if (MonitorEvaluationDetailsBuilder.sizeOf(details) <= maxSizeInBytes) {
      return details;
    }

    const steps: Array<(filter: MonitorEvaluationFilterDetails) => void> = [
      (filter: MonitorEvaluationFilterDetails): void => {
        delete filter.excerpt;
      },
      (filter: MonitorEvaluationFilterDetails): void => {
        delete filter.fieldValues;
        delete filter.areFieldValuesTruncated;
      },
      (filter: MonitorEvaluationFilterDetails): void => {
        filter.message = MonitorEvaluationEvidence.bound(filter.message, 200);

        if (filter.actual) {
          filter.actual = MonitorEvaluationEvidence.bound(filter.actual, 100);
        }
      },
    ];

    for (const step of steps) {
      details.filters.forEach(step);
      details.isTrimmedToSizeLimit = true;

      if (MonitorEvaluationDetailsBuilder.sizeOf(details) <= maxSizeInBytes) {
        return details;
      }
    }

    details.filters = details.filters.slice(0, 5);
    details.areFiltersTruncated = true;

    return details;
  }

  private static sizeOf(details: MonitorEvaluationDetails): number {
    try {
      return Buffer.byteLength(JSON.stringify(details), "utf8");
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  /*
   * This check's result for the criteria: by its id, or - for a criteria
   * saved without one - by its name.
   */
  private static findCriteriaResult(input: {
    evaluationSummary: MonitorEvaluationSummary;
    criteriaId: string | undefined;
    criteriaName: string | undefined;
  }): MonitorEvaluationCriteriaResult | undefined {
    const results: Array<MonitorEvaluationCriteriaResult> =
      input.evaluationSummary.criteriaResults || [];

    for (let index: number = results.length - 1; index >= 0; index--) {
      const result: MonitorEvaluationCriteriaResult = results[index]!;

      if (input.criteriaId) {
        if (result.criteriaId?.toString() === input.criteriaId) {
          return result;
        }

        continue;
      }

      if (input.criteriaName && result.criteriaName === input.criteriaName) {
        return result;
      }
    }

    return undefined;
  }

  /*
   * The request the check made. A URL is the step's own - as configured,
   * with {{monitorSecrets.*}} references as they were written, never the
   * values the probe was handed - redacted. An Incoming Request monitor's
   * request is its caller's method.
   */
  private static readRequest(input: {
    monitorType: MonitorType;
    monitorStep?: MonitorStep | undefined;
    dataToProcess: DataToProcess;
  }): MonitorEvaluationRequest | undefined {
    if (input.monitorType === MonitorType.IncomingRequest) {
      const request: IncomingMonitorRequest | null =
        MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
          input.dataToProcess,
        );

      const method: string | undefined = request?.requestMethod
        ? String(request.requestMethod).toUpperCase()
        : undefined;

      return method && HTTP_METHODS.includes(method)
        ? { method: method }
        : undefined;
    }

    const destination: string | undefined =
      MonitorRecordEvidence.getStepDestination(input.monitorStep) ||
      MonitorRecordEvidence.toText(
        (input.dataToProcess as ProbeMonitorResponse).monitorDestination,
      );

    if (!destination) {
      return undefined;
    }

    if (URL_MONITOR_TYPES.includes(input.monitorType)) {
      const request: MonitorEvaluationRequest = {
        url: MonitorEvaluationEvidence.bound(
          MonitorEvidenceRedaction.redactUrl(destination),
          MonitorEvaluationDetailsLimits.urlChars,
        ),
      };

      if (input.monitorType === MonitorType.API) {
        const method: string = String(
          input.monitorStep?.data?.requestType || HTTPMethod.GET,
        ).toUpperCase();

        if (HTTP_METHODS.includes(method)) {
          request.method = method;
        }
      }

      return request;
    }

    if (HOST_MONITOR_TYPES.includes(input.monitorType)) {
      const request: MonitorEvaluationRequest = {
        destination: MonitorEvaluationEvidence.bound(
          MonitorEvidenceRedaction.redactText(destination),
          MonitorEvaluationDetailsLimits.urlChars,
        ),
      };

      const port: number | undefined = MonitorRecordEvidence.getStepPort(
        input.monitorStep,
      );

      if (port !== undefined) {
        request.port = port;
      }

      return request;
    }

    return undefined;
  }

  // What came back, for the checks a probe makes to a URL or a host.
  private static readResponse(input: {
    monitorType: MonitorType;
    dataToProcess: DataToProcess;
  }): MonitorEvaluationResponse | undefined {
    if (!RESPONSE_MONITOR_TYPES.includes(input.monitorType)) {
      return undefined;
    }

    const probeResponse: ProbeMonitorResponse | null =
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(
        input.dataToProcess,
      );

    if (!probeResponse) {
      return undefined;
    }

    const response: MonitorEvaluationResponse = {};

    if (
      (input.monitorType === MonitorType.Website ||
        input.monitorType === MonitorType.API) &&
      typeof probeResponse.responseCode === "number"
    ) {
      response.statusCode = probeResponse.responseCode;
    }

    if (
      typeof probeResponse.responseTimeInMs === "number" &&
      Number.isFinite(probeResponse.responseTimeInMs)
    ) {
      response.responseTimeInMs = Math.round(probeResponse.responseTimeInMs);
    }

    if (typeof probeResponse.isOnline === "boolean") {
      response.isOnline = probeResponse.isOnline;
    }

    if (probeResponse.isTimeout === true) {
      response.isTimeout = true;
    }

    if (
      typeof probeResponse.failureCause === "string" &&
      probeResponse.failureCause.trim()
    ) {
      response.failureCause = MonitorEvaluationEvidence.bound(
        MonitorEvidenceRedaction.redactText(probeResponse.failureCause.trim()),
        MonitorEvaluationDetailsLimits.failureCauseChars,
      );
    }

    return Object.keys(response).length > 0 ? response : undefined;
  }
}
