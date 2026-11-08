import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse, {
  CustomCodeMonitorResult,
} from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationFilterDetails,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import CustomCodeMonitoringCriteria from "./Criteria/CustomCodeMonitorCriteria";
import DataToProcess from "./DataToProcess";
import JavaScriptExpressionValues from "./JavaScriptExpressionValues";
import MonitorCriteriaDataExtractor from "./MonitorCriteriaDataExtractor";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";
import ResponseExcerpt, {
  MatchExcerptResult,
  ResponseText,
} from "./ResponseExcerpt";

/*
 * WHAT A FILTER THAT MATCHED FOUND, AND WHERE.
 *
 * For each filter of the criteria that opened an incident or an alert, the
 * value the check had for it ("503", "6200 ms"), the field it was read from
 * (a JSON path, a header, a script result's path), a JavaScript expression's
 * references and their values, and an excerpt of the body around the match.
 * Read where a monitor type has such a thing - Website, API, Ping, IP, Port,
 * Incoming Request, Custom Code and Synthetic monitors - and nothing
 * otherwise: every filter also keeps the evaluation's own sentence, which
 * says what it found for every monitor type.
 *
 * Everything read from a body or a header goes through
 * MonitorEvidenceRedaction and the limits of MonitorEvaluationDetailsLimits,
 * and nothing is read from them at all when the monitor keeps no response
 * excerpts.
 */

export type MonitorEvaluationFilterEvidence = Pick<
  MonitorEvaluationFilterDetails,
  | "actual"
  | "windowMinutes"
  | "windowType"
  | "field"
  | "fieldValues"
  | "areFieldValuesTruncated"
  | "excerpt"
  | "excerptOmission"
>;

// The probe-checked monitor types whose checks get an HTTP response.
const HTTP_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
];

// Those whose response time, reachability and timeouts the probe reports.
const PROBE_CHECKED_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Port,
];

export default class MonitorEvaluationEvidence {
  public static async read(input: {
    monitorType: MonitorType;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    includeResponseContent: boolean;
  }): Promise<MonitorEvaluationFilterEvidence> {
    const evidence: MonitorEvaluationFilterEvidence =
      await MonitorEvaluationEvidence.readForType(input);

    /*
     * A filter judged over a window: what was read is this check's, and the
     * window says what was compared.
     */
    if (
      CriteriaFilterUtil.isEvaluatedOverTime(
        input.criteriaFilter,
        input.monitorType,
      )
    ) {
      const minutes: number | undefined =
        input.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes;

      if (typeof minutes === "number" && minutes > 0) {
        evidence.windowMinutes = minutes;

        const type: string | undefined =
          CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
            input.criteriaFilter,
            input.monitorType,
          );

        if (type) {
          evidence.windowType = type;
        }
      }
    }

    return evidence;
  }

  private static async readForType(input: {
    monitorType: MonitorType;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    includeResponseContent: boolean;
  }): Promise<MonitorEvaluationFilterEvidence> {
    const checkOn: CheckOn = input.criteriaFilter.checkOn;

    if (checkOn === CheckOn.JavaScriptExpression) {
      return MonitorEvaluationEvidence.readExpression(input);
    }

    if (PROBE_CHECKED_MONITOR_TYPES.includes(input.monitorType)) {
      const probeResponse: ProbeMonitorResponse | null =
        MonitorCriteriaDataExtractor.getProbeMonitorResponse(
          input.dataToProcess,
        );

      if (!probeResponse) {
        return {};
      }

      return MonitorEvaluationEvidence.readProbeCheck({
        ...input,
        probeResponse: probeResponse,
      });
    }

    if (input.monitorType === MonitorType.IncomingRequest) {
      const request: IncomingMonitorRequest | null =
        MonitorCriteriaDataExtractor.getIncomingMonitorRequest(
          input.dataToProcess,
        );

      if (!request) {
        return {};
      }

      return MonitorEvaluationEvidence.readIncomingRequest({
        ...input,
        request: request,
      });
    }

    if (input.monitorType === MonitorType.CustomJavaScriptCode) {
      const response: CustomCodeMonitorResponse | undefined = (
        input.dataToProcess as ProbeMonitorResponse
      ).customCodeMonitorResponse;

      return response
        ? MonitorEvaluationEvidence.readScriptResult({
            ...input,
            response: response,
          })
        : {};
    }

    if (input.monitorType === MonitorType.SyntheticMonitor) {
      const responses: Array<SyntheticMonitorResponse> =
        (input.dataToProcess as ProbeMonitorResponse)
          .syntheticMonitorResponse || [];

      /*
       * One response per browser and screen size: the first the filter
       * matches on is the one it fired for.
       */
      for (const response of responses) {
        const matched: string | null =
          await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet(
            {
              monitorResponse: response,
              criteriaFilter: input.criteriaFilter,
            },
          );

        if (matched) {
          return MonitorEvaluationEvidence.readScriptResult({
            ...input,
            response: response,
          });
        }
      }

      return {};
    }

    return {};
  }

  private static readProbeCheck(input: {
    monitorType: MonitorType;
    criteriaFilter: CriteriaFilter;
    probeResponse: ProbeMonitorResponse;
    includeResponseContent: boolean;
  }): MonitorEvaluationFilterEvidence {
    const probeResponse: ProbeMonitorResponse = input.probeResponse;
    const isHttp: boolean = HTTP_MONITOR_TYPES.includes(input.monitorType);

    switch (input.criteriaFilter.checkOn) {
      case CheckOn.ResponseTime:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatMilliseconds(
            probeResponse.responseTimeInMs,
          ),
        );
      case CheckOn.ResponseStatusCode:
        return MonitorEvaluationEvidence.withActual(
          probeResponse.responseCode !== undefined &&
            probeResponse.responseCode !== null
            ? String(probeResponse.responseCode)
            : undefined,
        );
      case CheckOn.IsOnline:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatBoolean(probeResponse.isOnline),
        );
      case CheckOn.IsRequestTimeout:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatBoolean(probeResponse.isTimeout),
        );
      case CheckOn.PacketLossPercent:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatNumber(
            probeResponse.pingResponse?.packetLossPercent,
            "%",
          ),
        );
      case CheckOn.Jitter:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatMilliseconds(
            probeResponse.pingResponse?.jitterInMs,
          ),
        );
      case CheckOn.PortDnsLookupTime:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatMilliseconds(
            probeResponse.portTimings?.dnsLookupInMs,
          ),
        );
      case CheckOn.PortTcpConnectTime:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatMilliseconds(
            probeResponse.portTimings?.tcpConnectInMs,
          ),
        );
      case CheckOn.ResponseBody:
        return isHttp
          ? MonitorEvaluationEvidence.readBody({
              body: probeResponse.responseBody,
              criteriaFilter: input.criteriaFilter,
              includeResponseContent: input.includeResponseContent,
            })
          : {};
      case CheckOn.ResponseHeader:
        return isHttp
          ? MonitorEvaluationEvidence.readHeaderNames({
              headers: probeResponse.responseHeaders,
              criteriaFilter: input.criteriaFilter,
            })
          : {};
      case CheckOn.ResponseHeaderValue:
        return isHttp
          ? MonitorEvaluationEvidence.readHeaderValue({
              headers: probeResponse.responseHeaders,
              criteriaFilter: input.criteriaFilter,
              includeResponseContent: input.includeResponseContent,
            })
          : {};
      default:
        return {};
    }
  }

  private static readIncomingRequest(input: {
    criteriaFilter: CriteriaFilter;
    request: IncomingMonitorRequest;
    includeResponseContent: boolean;
  }): MonitorEvaluationFilterEvidence {
    switch (input.criteriaFilter.checkOn) {
      case CheckOn.RequestBody:
        return MonitorEvaluationEvidence.readBody({
          body: input.request.requestBody,
          criteriaFilter: input.criteriaFilter,
          includeResponseContent: input.includeResponseContent,
        });
      case CheckOn.RequestHeader:
        return MonitorEvaluationEvidence.readHeaderNames({
          headers: input.request.requestHeaders,
          criteriaFilter: input.criteriaFilter,
        });
      case CheckOn.RequestHeaderValue:
        return MonitorEvaluationEvidence.readHeaderValue({
          headers: input.request.requestHeaders,
          criteriaFilter: input.criteriaFilter,
          includeResponseContent: input.includeResponseContent,
        });
      default:
        return {};
    }
  }

  // A Custom Code or Synthetic monitor's script: its result, time or error.
  private static readScriptResult(input: {
    criteriaFilter: CriteriaFilter;
    response: CustomCodeMonitorResponse;
  }): MonitorEvaluationFilterEvidence {
    switch (input.criteriaFilter.checkOn) {
      case CheckOn.ExecutionTime:
        return MonitorEvaluationEvidence.withActual(
          MonitorEvaluationEvidence.formatMilliseconds(
            input.response.executionTimeInMS,
          ),
        );
      case CheckOn.Error: {
        const error: string | undefined = input.response.scriptError;

        return MonitorEvaluationEvidence.withActual(
          typeof error === "string" && error
            ? MonitorEvaluationEvidence.bound(
                MonitorEvidenceRedaction.redactText(error),
              )
            : undefined,
        );
      }
      case CheckOn.ResultValue: {
        const path: string | undefined =
          input.criteriaFilter.customCodeMonitorOptions?.resultValuePath?.trim() ||
          undefined;

        const value: CustomCodeMonitorResult | undefined =
          CustomCodeMonitoringCriteria.resolveValueAtPath(
            input.response.result,
            path,
          );

        const evidence: MonitorEvaluationFilterEvidence = {
          actual: MonitorEvaluationEvidence.describeValue(value),
        };

        if (path) {
          evidence.field = path;
        }

        return evidence;
      }
      default:
        return {};
    }
  }

  private static readExpression(input: {
    monitorType: MonitorType;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    includeResponseContent: boolean;
  }): MonitorEvaluationFilterEvidence {
    const evidence: MonitorEvaluationFilterEvidence = { actual: "true" };
    const expression: string =
      typeof input.criteriaFilter.value === "string"
        ? input.criteriaFilter.value
        : "";

    if (!expression) {
      return evidence;
    }

    if (!input.includeResponseContent) {
      evidence.excerptOmission = "response-excerpts-off";
      return evidence;
    }

    const storageMap: JSONObject = JavaScriptExpressionValues.getStorageMap({
      monitorType: input.monitorType,
      dataToProcess: input.dataToProcess,
      isQuiet: true,
    });

    const { values, isTruncated } = JavaScriptExpressionValues.readReferences({
      expression: expression,
      storageMap: storageMap,
    });

    if (values.length > 0) {
      evidence.fieldValues = values;
    }

    if (isTruncated) {
      evidence.areFieldValuesTruncated = true;
    }

    return evidence;
  }

  /*
   * A body a Contains or Does Not Contain filter read: the excerpt around
   * the filter's text where it is found, with the JSON path of the field
   * that holds it, or the body's start where it is not - what came back
   * instead.
   */
  private static readBody(input: {
    body: unknown;
    criteriaFilter: CriteriaFilter;
    includeResponseContent: boolean;
  }): MonitorEvaluationFilterEvidence {
    if (!input.includeResponseContent) {
      return { excerptOmission: "response-excerpts-off" };
    }

    const response: ResponseText | null = ResponseExcerpt.readText(input.body);

    if (!response || !response.text.trim()) {
      return { excerptOmission: "empty-body" };
    }

    const needle: string =
      input.criteriaFilter.value !== undefined &&
      input.criteriaFilter.value !== null
        ? String(input.criteriaFilter.value)
        : "";

    if (needle) {
      let result: MatchExcerptResult | null = ResponseExcerpt.aroundMatch({
        response: response,
        needle: needle,
      });

      /*
       * Found in the body as stored, not in the text decoded from it: the
       * filter's text has a quote or a line break the stored JSON escapes.
       */
      if (!result && typeof input.body === "string" && input.body !== response.text) {
        result = ResponseExcerpt.aroundMatch({
          response: { text: input.body },
          needle: needle,
        });
      }

      if (result) {
        const evidence: MonitorEvaluationFilterEvidence = {};

        if (result.path) {
          evidence.field = result.path;
        }

        if (result.isMatchMasked) {
          evidence.excerptOmission = "matched-text-masked";
        } else if (result.excerpt) {
          evidence.excerpt = result.excerpt;
        }

        return evidence;
      }
    }

    // Nothing to point at: how the body begins.
    const start: ReturnType<typeof ResponseExcerpt.atStart> =
      ResponseExcerpt.atStart({ response: response });

    return start ? { excerpt: start } : { excerptOmission: "empty-body" };
  }

  /*
   * A Response Header or Request Header filter: the names the check got,
   * and - for Contains - the one it matched.
   */
  private static readHeaderNames(input: {
    headers: Dictionary<string> | undefined;
    criteriaFilter: CriteriaFilter;
  }): MonitorEvaluationFilterEvidence {
    const names: Array<string> = Object.keys(input.headers || {}).map(
      (name: string): string => {
        return name.toLowerCase();
      },
    );

    const evidence: MonitorEvaluationFilterEvidence = {};

    if (names.length > 0) {
      const listed: Array<string> = names
        .slice(0, MonitorEvaluationDetailsLimits.headerNames)
        .map((name: string): string => {
          return MonitorEvaluationEvidence.bound(name, 100);
        });
      const more: number = names.length - listed.length;

      evidence.actual = MonitorEvaluationEvidence.bound(
        more > 0 ? `${listed.join(", ")}, …` : listed.join(", "),
      );
    }

    const wanted: string =
      typeof input.criteriaFilter.value === "string"
        ? input.criteriaFilter.value.toLowerCase()
        : "";

    if (
      input.criteriaFilter.filterType === FilterType.Contains &&
      wanted &&
      names.includes(wanted)
    ) {
      evidence.field = MonitorEvaluationEvidence.bound(wanted, 100);
    }

    return evidence;
  }

  /*
   * A Response Header Value or Request Header Value filter that matched a
   * value: the header that had it, and the value - masked when the header
   * is one that carries a credential.
   */
  private static readHeaderValue(input: {
    headers: Dictionary<string> | undefined;
    criteriaFilter: CriteriaFilter;
    includeResponseContent: boolean;
  }): MonitorEvaluationFilterEvidence {
    if (input.criteriaFilter.filterType !== FilterType.Contains) {
      return {};
    }

    const wanted: string =
      input.criteriaFilter.value !== undefined &&
      input.criteriaFilter.value !== null
        ? String(input.criteriaFilter.value).toLowerCase()
        : "";

    if (!wanted) {
      return {};
    }

    const headers: Dictionary<string> = input.headers || {};

    const name: string | undefined = Object.keys(headers).find(
      (headerName: string): boolean => {
        const value: unknown = headers[headerName];

        return typeof value === "string" && value.toLowerCase() === wanted;
      },
    );

    if (!name) {
      return {};
    }

    const evidence: MonitorEvaluationFilterEvidence = {
      field: MonitorEvaluationEvidence.bound(name.toLowerCase(), 100),
    };

    if (!input.includeResponseContent) {
      evidence.excerptOmission = "response-excerpts-off";
      return evidence;
    }

    evidence.actual = MonitorEvidenceRedaction.isSensitiveHeaderName(name)
      ? MonitorEvidenceRedaction.REDACTED
      : MonitorEvaluationEvidence.bound(
          MonitorEvidenceRedaction.redactText(String(headers[name])),
        );

    return evidence;
  }

  // A script's result, or one field of it, as JSON text.
  private static describeValue(
    value: CustomCodeMonitorResult | undefined,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "string") {
      return MonitorEvaluationEvidence.bound(
        MonitorEvidenceRedaction.redactText(value),
      );
    }

    let text: string;

    try {
      text = JSON.stringify(MonitorEvidenceRedaction.redactJson(value)) ?? "";
    } catch {
      return undefined;
    }

    return MonitorEvaluationEvidence.bound(text);
  }

  private static withActual(
    actual: string | undefined,
  ): MonitorEvaluationFilterEvidence {
    return actual ? { actual: actual } : {};
  }

  public static formatMilliseconds(
    value: number | undefined | null,
  ): string | undefined {
    return MonitorEvaluationEvidence.formatNumber(value, " ms");
  }

  public static formatNumber(
    value: number | undefined | null,
    unit: string,
  ): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }

    // Whole numbers from 100 up; two decimals at most below that.
    const rounded: number =
      Math.abs(value) >= 100
        ? Math.round(value)
        : Math.round(value * 100) / 100;

    return `${rounded}${unit}`;
  }

  private static formatBoolean(
    value: boolean | undefined | null,
  ): string | undefined {
    if (typeof value !== "boolean") {
      return undefined;
    }

    return value ? "true" : "false";
  }

  /*
   * A value cut to the limit, with an ellipsis when it was longer - never
   * between the two halves of a character outside the basic plane.
   */
  public static bound(
    text: string,
    maxChars: number = MonitorEvaluationDetailsLimits.valueChars,
  ): string {
    if (text.length <= maxChars) {
      return text;
    }

    let end: number = maxChars;
    const last: number = text.charCodeAt(end - 1);

    if (last >= 0xd800 && last <= 0xdbff) {
      end--;
    }

    return `${text.slice(0, end)}…`;
  }
}
