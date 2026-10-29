import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity, {
  normalizeLogSeverity,
} from "Common/Types/Log/LogSeverity";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { TelemetryRuleRecipeKey } from "./TelemetryRuleRecipes";

/*
 * "Create monitor" from where the data is: the logs explorer, the traces
 * explorer and an exception's page link to Create Monitor with the type
 * and what they show - its services, severities, statuses, attributes and
 * text - and the new monitor starts watching just that, with the recipe
 * that suits it ("A message appears" for a search, "Too many errors" for
 * error logs, "Requests stop" for a set of requests, "Any exception" for
 * an exception). Everything else is the form's ordinary new monitor: the
 * recipes stay offered, and nothing is saved until Create.
 *
 * The link's query is read as text a person may have edited: values of the
 * wrong kind, ids that are not ids and severities nobody stores are left
 * out, and long text is cut, so a link can only ever narrow the form.
 */

export const TELEMETRY_MONITOR_TYPE_QUERY_PARAM: string = "monitorType";
export const TELEMETRY_MONITOR_QUERY_PARAM: string = "telemetryQuery";

// What a link can carry, each part optional.
export interface TelemetryMonitorLinkQuery {
  serviceIds?: Array<string> | undefined;
  attributes?: Dictionary<string> | undefined;
  // Logs.
  severityTexts?: Array<LogSeverity> | undefined;
  // A log's message, or an exception's.
  messageContains?: string | undefined;
  // Traces.
  spanStatuses?: Array<SpanStatus> | undefined;
  spanName?: string | undefined;
  // Exceptions.
  exceptionTypes?: Array<string> | undefined;
}

/*
 * A link's query with the monitor type it was made for: Create Monitor
 * starts a monitor of that type watching it, and a monitor of another type
 * (picked instead, after following the link) starts on its own defaults.
 */
export interface TelemetryMonitorLinkSeed {
  monitorType: MonitorType;
  query: TelemetryMonitorLinkQuery;
}

export const TELEMETRY_MONITOR_LINK_MAX_TEXT_LENGTH: number = 500;
export const TELEMETRY_MONITOR_LINK_MAX_VALUES: number = 50;
export const TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES: number = 20;

// The types a link can start: the ones whose explorers link here.
export const isTelemetryMonitorLinkType: (
  monitorType: MonitorType | string | null | undefined,
) => boolean = (
  monitorType: MonitorType | string | null | undefined,
): boolean => {
  return (
    monitorType === MonitorType.Logs ||
    monitorType === MonitorType.Traces ||
    monitorType === MonitorType.Exceptions
  );
};

const readText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.substring(0, TELEMETRY_MONITOR_LINK_MAX_TEXT_LENGTH);
};

const readTexts: (
  value: unknown,
  isAllowed?: (text: string) => boolean,
) => Array<string> = (
  value: unknown,
  isAllowed?: (text: string) => boolean,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const texts: Array<string> = [];

  for (const item of value) {
    const text: string | undefined = readText(item);

    if (
      text &&
      !texts.includes(text) &&
      (!isAllowed || isAllowed(text)) &&
      texts.length < TELEMETRY_MONITOR_LINK_MAX_VALUES
    ) {
      texts.push(text);
    }
  }

  return texts;
};

const SPAN_STATUSES: Array<SpanStatus> = [
  SpanStatus.Unset,
  SpanStatus.Ok,
  SpanStatus.Error,
];

/*
 * The link's query, as far as it holds what a monitor can watch; null when
 * there is no query or it is not one.
 */
export const readTelemetryMonitorLinkQuery: (
  raw: string | null | undefined,
) => TelemetryMonitorLinkQuery | null = (
  raw: string | null | undefined,
): TelemetryMonitorLinkQuery | null => {
  if (!raw) {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const input: JSONObject = parsed as JSONObject;
  const query: TelemetryMonitorLinkQuery = {};

  const serviceIds: Array<string> = readTexts(
    input["serviceIds"],
    (text: string) => {
      return ObjectID.isValidUUID(text);
    },
  );

  if (serviceIds.length > 0) {
    query.serviceIds = serviceIds;
  }

  const attributesInput: unknown = input["attributes"];

  if (
    attributesInput &&
    typeof attributesInput === "object" &&
    !Array.isArray(attributesInput)
  ) {
    const attributes: Dictionary<string> = {};

    for (const [key, value] of Object.entries(attributesInput as JSONObject)) {
      const name: string | undefined = readText(key);
      const text: string | undefined = readText(value);

      if (
        name &&
        text &&
        Object.keys(attributes).length < TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES
      ) {
        attributes[name] = text;
      }
    }

    if (Object.keys(attributes).length > 0) {
      query.attributes = attributes;
    }
  }

  const severityTexts: Array<LogSeverity> = [];

  for (const text of readTexts(input["severityTexts"])) {
    const severity: LogSeverity | null = normalizeLogSeverity(text);

    if (severity && !severityTexts.includes(severity)) {
      severityTexts.push(severity);
    }
  }

  if (severityTexts.length > 0) {
    query.severityTexts = severityTexts;
  }

  const messageContains: string | undefined = readText(
    input["messageContains"],
  );

  if (messageContains) {
    query.messageContains = messageContains;
  }

  if (Array.isArray(input["spanStatuses"])) {
    const spanStatuses: Array<SpanStatus> = [];

    for (const item of input["spanStatuses"] as Array<unknown>) {
      const status: number = Number(item);

      if (
        SPAN_STATUSES.includes(status as SpanStatus) &&
        !spanStatuses.includes(status as SpanStatus)
      ) {
        spanStatuses.push(status as SpanStatus);
      }
    }

    if (spanStatuses.length > 0) {
      query.spanStatuses = spanStatuses;
    }
  }

  const spanName: string | undefined = readText(input["spanName"]);

  if (spanName) {
    query.spanName = spanName;
  }

  const exceptionTypes: Array<string> = readTexts(input["exceptionTypes"]);

  if (exceptionTypes.length > 0) {
    query.exceptionTypes = exceptionTypes;
  }

  return query;
};

// The query a link carries, as its parameter holds it.
export const writeTelemetryMonitorLinkQuery: (
  query: TelemetryMonitorLinkQuery,
) => string = (query: TelemetryMonitorLinkQuery): string => {
  const output: JSONObject = {};

  if (query.serviceIds && query.serviceIds.length > 0) {
    output["serviceIds"] = query.serviceIds;
  }

  if (query.attributes && Object.keys(query.attributes).length > 0) {
    output["attributes"] = query.attributes;
  }

  if (query.severityTexts && query.severityTexts.length > 0) {
    output["severityTexts"] = query.severityTexts;
  }

  if (query.messageContains) {
    output["messageContains"] = query.messageContains;
  }

  if (query.spanStatuses && query.spanStatuses.length > 0) {
    output["spanStatuses"] = query.spanStatuses;
  }

  if (query.spanName) {
    output["spanName"] = query.spanName;
  }

  if (query.exceptionTypes && query.exceptionTypes.length > 0) {
    output["exceptionTypes"] = query.exceptionTypes;
  }

  return JSON.stringify(output);
};

/*
 * The values a filter's field holds, as text: one value, or the values an
 * "is any of" holds. Empty for anything else - a range, a "not", a
 * pattern - which a monitor's filter cannot hold.
 */
const getFilterValues: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [String(value)];
  }

  if (value instanceof ObjectID) {
    return [value.toString()];
  }

  if (value instanceof Includes) {
    return value.values.map((item: unknown) => {
      return String(item);
    });
  }

  return [];
};

/*
 * What the logs explorer shows, from the filter its list is read with (the
 * typed search, the chips and the page's own scope together): its services,
 * severities, message text and attributes. A part the monitor's filter
 * cannot hold - several messages, an attribute that is a range or a
 * pattern - is left out, which widens what the monitor watches and never
 * narrows it.
 */
export const getLogsFilterLinkQuery: (
  filter: Dictionary<unknown>,
) => TelemetryMonitorLinkQuery = (
  filter: Dictionary<unknown>,
): TelemetryMonitorLinkQuery => {
  const query: TelemetryMonitorLinkQuery = {};

  const serviceIds: Array<string> = getFilterValues(
    filter["primaryEntityId"],
  ).filter((id: string) => {
    return ObjectID.isValidUUID(id);
  });

  if (serviceIds.length > 0) {
    query.serviceIds = serviceIds;
  }

  const severityTexts: Array<LogSeverity> = [];

  for (const text of getFilterValues(filter["severityText"])) {
    const severity: LogSeverity | null = normalizeLogSeverity(text);

    if (severity && !severityTexts.includes(severity)) {
      severityTexts.push(severity);
    }
  }

  if (severityTexts.length > 0) {
    query.severityTexts = severityTexts;
  }

  const body: unknown = filter["body"];

  if (body instanceof Search && body.value.trim()) {
    query.messageContains = body.value.trim();
  } else if (typeof body === "string" && body.trim()) {
    query.messageContains = body.trim();
  }

  const attributes: Dictionary<string> | undefined = getFilterAttributes(
    filter["attributes"],
  );

  if (attributes) {
    query.attributes = attributes;
  }

  return query;
};

// A filter's exact attribute values; any other kind of value is left out.
const getFilterAttributes: (
  value: unknown,
) => Dictionary<string> | undefined = (
  value: unknown,
): Dictionary<string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const attributes: Dictionary<string> = {};

  for (const [key, item] of Object.entries(value as Dictionary<unknown>)) {
    const values: Array<string> = getFilterValues(item);

    if (key && values.length === 1 && !(item instanceof Includes)) {
      attributes[key] = values[0]!;
    }
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined;
};

/*
 * What the traces explorer shows, from the query its list is read with:
 * its services, statuses, span name and attributes, as for the logs
 * explorer (getLogsFilterLinkQuery).
 */
export const getTracesFilterLinkQuery: (
  filter: Dictionary<unknown>,
) => TelemetryMonitorLinkQuery = (
  filter: Dictionary<unknown>,
): TelemetryMonitorLinkQuery => {
  const query: TelemetryMonitorLinkQuery = {};

  const serviceIds: Array<string> = getFilterValues(
    filter["primaryEntityId"],
  ).filter((id: string) => {
    return ObjectID.isValidUUID(id);
  });

  if (serviceIds.length > 0) {
    query.serviceIds = serviceIds;
  }

  const spanStatuses: Array<SpanStatus> = [];

  for (const text of getFilterValues(filter["statusCode"])) {
    const status: number = Number(text);

    if (
      SPAN_STATUSES.includes(status as SpanStatus) &&
      !spanStatuses.includes(status as SpanStatus)
    ) {
      spanStatuses.push(status as SpanStatus);
    }
  }

  if (spanStatuses.length > 0) {
    query.spanStatuses = spanStatuses;
  }

  const name: unknown = filter["name"];

  if (name instanceof Search && name.value.trim()) {
    query.spanName = name.value.trim();
  } else {
    const names: Array<string> = getFilterValues(name);

    if (names.length === 1 && names[0]!.trim()) {
      query.spanName = names[0]!.trim();
    }
  }

  const attributes: Dictionary<string> | undefined = getFilterAttributes(
    filter["attributes"],
  );

  if (attributes) {
    query.attributes = attributes;
  }

  return query;
};

// The link's parameters: the monitor type, and the query when it holds any.
export const getTelemetryMonitorLinkParams: (data: {
  monitorType: MonitorType;
  query: TelemetryMonitorLinkQuery;
}) => Dictionary<string> = (data: {
  monitorType: MonitorType;
  query: TelemetryMonitorLinkQuery;
}): Dictionary<string> => {
  const params: Dictionary<string> = {
    [TELEMETRY_MONITOR_TYPE_QUERY_PARAM]: data.monitorType,
  };

  const written: string = writeTelemetryMonitorLinkQuery(data.query);

  if (written !== "{}") {
    params[TELEMETRY_MONITOR_QUERY_PARAM] = written;
  }

  return params;
};

/*
 * The recipe a link's monitor starts on: the one that suits what the link
 * shows.
 */
export const getTelemetryMonitorLinkRecipeKey: (data: {
  monitorType: MonitorType;
  query: TelemetryMonitorLinkQuery;
}) => TelemetryRuleRecipeKey | undefined = (data: {
  monitorType: MonitorType;
  query: TelemetryMonitorLinkQuery;
}): TelemetryRuleRecipeKey | undefined => {
  switch (data.monitorType) {
    case MonitorType.Logs: {
      // Words to look for: tell me when they appear.
      if (data.query.messageContains) {
        return TelemetryRuleRecipeKey.LogMessage;
      }

      const severities: Array<LogSeverity> = data.query.severityTexts || [];
      const isErrors: boolean =
        severities.length > 0 &&
        severities.every((severity: LogSeverity) => {
          return (
            severity === LogSeverity.Error || severity === LogSeverity.Fatal
          );
        });

      return isErrors
        ? TelemetryRuleRecipeKey.ErrorLogs
        : TelemetryRuleRecipeKey.LogMessage;
    }
    case MonitorType.Traces:
      return (data.query.spanStatuses || []).includes(SpanStatus.Error)
        ? TelemetryRuleRecipeKey.FailedSpans
        : TelemetryRuleRecipeKey.SpansStop;
    case MonitorType.Exceptions:
      return TelemetryRuleRecipeKey.AnyException;
    default:
      return undefined;
  }
};

/*
 * The step watching what the link shows: its query put over the step's,
 * part by part. A part the link leaves out keeps the step's.
 */
export const applyTelemetryMonitorLinkQuery: (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  query: TelemetryMonitorLinkQuery;
}) => MonitorStep = (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  query: TelemetryMonitorLinkQuery;
}): MonitorStep => {
  const { query } = data;
  const step: MonitorStep = MonitorStep.clone(data.monitorStep);

  const serviceIds: Array<ObjectID> | undefined =
    query.serviceIds && query.serviceIds.length > 0
      ? query.serviceIds.map((id: string) => {
          return new ObjectID(id);
        })
      : undefined;

  switch (data.monitorType) {
    case MonitorType.Logs: {
      const logMonitor: MonitorStepLogMonitor =
        step.data?.logMonitor || MonitorStepLogMonitorUtil.getDefault();

      step.setLogMonitor({
        ...logMonitor,
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
        ...(query.attributes ? { attributes: { ...query.attributes } } : {}),
        ...(query.severityTexts
          ? { severityTexts: [...query.severityTexts] }
          : {}),
        ...(query.messageContains ? { body: query.messageContains } : {}),
      });
      break;
    }
    case MonitorType.Traces: {
      const traceMonitor: MonitorStepTraceMonitor =
        step.data?.traceMonitor || MonitorStepTraceMonitorUtil.getDefault();

      step.setTraceMonitor({
        ...traceMonitor,
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
        ...(query.attributes ? { attributes: { ...query.attributes } } : {}),
        ...(query.spanStatuses
          ? { spanStatuses: [...query.spanStatuses] }
          : {}),
        ...(query.spanName ? { spanName: query.spanName } : {}),
      });
      break;
    }
    case MonitorType.Exceptions: {
      const exceptionMonitor: MonitorStepExceptionMonitor =
        step.data?.exceptionMonitor ||
        MonitorStepExceptionMonitorUtil.getDefault();

      step.setExceptionMonitor({
        ...exceptionMonitor,
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
        ...(query.exceptionTypes
          ? { exceptionTypes: [...query.exceptionTypes] }
          : {}),
        ...(query.messageContains ? { message: query.messageContains } : {}),
      });
      break;
    }
    default:
      break;
  }

  return step;
};
