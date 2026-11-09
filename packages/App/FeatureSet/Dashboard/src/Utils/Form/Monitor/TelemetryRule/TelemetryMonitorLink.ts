import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import Dictionary from "Common/Types/Dictionary";
import { toExcludeFacetKey } from "Common/Types/Telemetry/FacetExcludeKey";
import {
  EXCLUDED_LOG_MESSAGE_WORDS_FIELD,
  LOG_MESSAGE_WORDS_FIELD,
  LOG_MESSAGE_WORD_CHIP_KEY,
  readLogMessageWords,
} from "Common/Utils/Telemetry/LogMessageWord";
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
 *
 * What the view LEAVES OUT (a facet row's minus: "Severity is not debug")
 * is carried as the monitor's filters can hold it, exactly: a severity or
 * a span status left out as the ones left in (ingest stores only seven
 * severities, and a span has one of three statuses), an attribute value
 * left out as the attribute filter's "does not equal" or "is none of". What
 * they cannot hold - a service, a host or other resource, or message text
 * left out - is left out of the monitor, which widens what it watches, and
 * is named on the Create monitor button first (getLogsFilterLinkNotCarried).
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
  /*
   * Attribute values the view leaves out, by key ("Host Name is not
   * web-01"): the monitor's attribute filter holds one as "does not equal"
   * and several as "is none of". Logs and Traces.
   */
  excludedAttributes?: Dictionary<Array<string>> | undefined;
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

  const excludedInput: unknown = input["excludedAttributes"];

  if (
    excludedInput &&
    typeof excludedInput === "object" &&
    !Array.isArray(excludedInput)
  ) {
    const excludedAttributes: Dictionary<Array<string>> = {};

    for (const [key, value] of Object.entries(excludedInput as JSONObject)) {
      const name: string | undefined = readText(key);
      const values: Array<string> = readTexts(value);

      /*
       * A value an attribute both keeps and leaves out is kept, as the
       * explorers' chips never hold one twice; at most as many keys as the
       * kept attributes.
       */
      if (
        !name ||
        values.length === 0 ||
        (query.attributes && query.attributes[name] !== undefined) ||
        Object.keys(excludedAttributes).length >=
          TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES
      ) {
        continue;
      }

      excludedAttributes[name] = values;
    }

    if (Object.keys(excludedAttributes).length > 0) {
      query.excludedAttributes = excludedAttributes;
    }
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

  if (
    query.excludedAttributes &&
    Object.keys(query.excludedAttributes).length > 0
  ) {
    output["excludedAttributes"] = query.excludedAttributes;
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
 * The values a filter's field leaves out, as text: one value a "not
 * equal" holds, or the values a "none of" holds. Empty for anything else.
 */
const getExcludedFilterValues: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (value instanceof NotEqual) {
    const item: unknown = value.value;

    return item === undefined || item === null ? [] : [String(item)];
  }

  if (value instanceof IncludesNone) {
    return value.values.map((item: unknown) => {
      return String(item);
    });
  }

  return [];
};

// Whether a filter's field leaves values out: a "not equal" or a "none of".
const isExcludingFilterValue: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return value instanceof NotEqual || value instanceof IncludesNone;
};

/*
 * Every severity a log can be stored with but the ones left out, in the
 * enum's order: what "Severity is not debug" watches, exactly. Ingest
 * stores only these seven (LogSeverity), so the ones left in are the whole
 * of what the view shows. Empty when nothing known is left out - or when
 * all of them are, which a monitor's filter cannot say (it reads an empty
 * list as every severity).
 */
const getSeveritiesLeftIn: (excluded: Array<string>) => Array<LogSeverity> = (
  excluded: Array<string>,
): Array<LogSeverity> => {
  const leftOut: Set<LogSeverity> = new Set<LogSeverity>();

  for (const text of excluded) {
    const severity: LogSeverity | null = normalizeLogSeverity(text);

    if (severity) {
      leftOut.add(severity);
    }
  }

  const all: Array<LogSeverity> = Object.values(LogSeverity);
  const leftIn: Array<LogSeverity> = all.filter((severity: LogSeverity) => {
    return !leftOut.has(severity);
  });

  return leftOut.size === 0 || leftIn.length === 0 ? [] : leftIn;
};

/*
 * Every span status but the ones left out: what "Status is not Error"
 * watches, exactly - a span has one of three. Empty when nothing known is
 * left out, or all of them are.
 */
const getSpanStatusesLeftIn: (excluded: Array<string>) => Array<SpanStatus> = (
  excluded: Array<string>,
): Array<SpanStatus> => {
  const leftOut: Set<SpanStatus> = new Set<SpanStatus>();

  for (const text of excluded) {
    const status: number = Number(text);

    if (SPAN_STATUSES.includes(status as SpanStatus)) {
      leftOut.add(status as SpanStatus);
    }
  }

  const leftIn: Array<SpanStatus> = SPAN_STATUSES.filter(
    (status: SpanStatus) => {
      return !leftOut.has(status);
    },
  );

  return leftOut.size === 0 || leftIn.length === 0 ? [] : leftIn;
};

/*
 * The attribute values a filter leaves out exactly, by key - a "not equal"
 * or a "none of" on an attribute - at most as many keys as a link carries.
 */
const getFilterExcludedAttributes: (
  value: unknown,
) => Dictionary<Array<string>> | undefined = (
  value: unknown,
): Dictionary<Array<string>> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const excluded: Dictionary<Array<string>> = {};

  for (const [key, item] of Object.entries(value as Dictionary<unknown>)) {
    const values: Array<string> = getExcludedFilterValues(item);

    if (
      key &&
      values.length > 0 &&
      Object.keys(excluded).length < TELEMETRY_MONITOR_LINK_MAX_ATTRIBUTES
    ) {
      excluded[key] = Array.from(new Set<string>(values)).slice(
        0,
        TELEMETRY_MONITOR_LINK_MAX_VALUES,
      );
    }
  }

  return Object.keys(excluded).length > 0 ? excluded : undefined;
};

/*
 * The attributes a filter leaves out that the monitor's attribute filter
 * cannot be handed from a link: a pattern or a part of a value left out.
 */
const getFilterAttributesLeftOutAsPatterns: (
  value: unknown,
) => Array<string> = (value: unknown): Array<string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const keys: Array<string> = [];

  for (const [key, item] of Object.entries(value as Dictionary<unknown>)) {
    const operators: Array<unknown> = Array.isArray(item) ? item : [item];
    const isNegatedPattern: boolean = operators.some((entry: unknown) => {
      return entry instanceof NotContains || entry instanceof NotWildcard;
    });

    if (key && isNegatedPattern) {
      keys.push(key);
    }
  }

  return keys;
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

  // "Severity is not debug": the severities left in.
  if (severityTexts.length === 0) {
    severityTexts.push(
      ...getSeveritiesLeftIn(getExcludedFilterValues(filter["severityText"])),
    );
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

  const excludedAttributes: Dictionary<Array<string>> | undefined =
    getFilterExcludedAttributes(filter["attributes"]);

  if (excludedAttributes) {
    query.excludedAttributes = excludedAttributes;
  }

  return query;
};

/*
 * What a logs or traces view leaves out that its monitor cannot (the
 * filter its list is read with): a service, a host or other resource,
 * message text or a span name, an attribute pattern. Named as the
 * cross-signal pivots name what they cannot carry - the kept field marked
 * `!` (`!serviceIds`, `!hostId`, `!body`, `!attributes.<key>`) - so the
 * Create monitor button can say so before the monitor widens past the
 * view. A severity, a span status or an attribute value left out is
 * carried (getLogsFilterLinkQuery), and never named here.
 */
export const getTelemetryFilterLinkNotCarried: (
  filter: Dictionary<unknown>,
) => Array<string> = (filter: Dictionary<unknown>): Array<string> => {
  const notCarried: Array<string> = [];

  const add: (field: string) => void = (field: string): void => {
    if (!notCarried.includes(field)) {
      notCarried.push(field);
    }
  };

  if (isExcludingFilterValue(filter["primaryEntityId"])) {
    add("!serviceIds");
  }

  const excludedResources: unknown = filter["excludedResourceFilters"];

  if (
    excludedResources &&
    typeof excludedResources === "object" &&
    !Array.isArray(excludedResources)
  ) {
    for (const [facetKey, ids] of Object.entries(
      excludedResources as Dictionary<unknown>,
    )) {
      if (facetKey && Array.isArray(ids) && ids.length > 0) {
        add(`!${facetKey}`);
      }
    }
  }

  const body: unknown = filter["body"];

  if (body instanceof NotContains) {
    add("!body");
  }

  /*
   * A word the message holds whole ("Word in message"): a log monitor's
   * message filter reads a part of the message, never a whole word, so
   * neither the words kept nor the ones left out can be handed over as
   * they are read in the view.
   */
  if (readLogMessageWords(filter[LOG_MESSAGE_WORDS_FIELD]).length > 0) {
    add(LOG_MESSAGE_WORD_CHIP_KEY);
  }

  if (
    readLogMessageWords(filter[EXCLUDED_LOG_MESSAGE_WORDS_FIELD]).length > 0
  ) {
    add(toExcludeFacetKey(LOG_MESSAGE_WORD_CHIP_KEY));
  }

  const name: unknown = filter["name"];
  const nameParts: Array<unknown> = Array.isArray(name) ? name : [name];

  if (nameParts.some(isExcludingFilterValue)) {
    add("!name");
  }

  // A trace monitor has no span kind to keep or leave out.
  if (isExcludingFilterValue(filter["kind"])) {
    add("!kind");
  }

  for (const key of getFilterAttributesLeftOutAsPatterns(
    filter["attributes"],
  )) {
    add(`!attributes.${key}`);
  }

  return notCarried;
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

  // "Status is not Error": the statuses left in.
  if (spanStatuses.length === 0) {
    spanStatuses.push(
      ...getSpanStatusesLeftIn(getExcludedFilterValues(filter["statusCode"])),
    );
  }

  if (spanStatuses.length > 0) {
    query.spanStatuses = spanStatuses;
  }

  /*
   * A name searched as a part of it beside names left out ("GET, but not
   * GET /health") holds both; the part searched for is the span name.
   */
  const rawName: unknown = filter["name"];
  const name: unknown = Array.isArray(rawName)
    ? rawName.find((part: unknown) => {
        return part instanceof Search;
      })
    : rawName;

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

  const excludedAttributes: Dictionary<Array<string>> | undefined =
    getFilterExcludedAttributes(filter["attributes"]);

  if (excludedAttributes) {
    query.excludedAttributes = excludedAttributes;
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

  /*
   * The attributes the monitor watches: the values kept, and each value
   * left out as the attribute filter's "does not equal" (one) or "is none
   * of" (several) - what it shows as when the form is opened.
   */
  const linkAttributes: Dictionary<string | number | boolean> | undefined =
    getLinkAttributes(query);

  switch (data.monitorType) {
    case MonitorType.Logs: {
      const logMonitor: MonitorStepLogMonitor =
        step.data?.logMonitor || MonitorStepLogMonitorUtil.getDefault();

      step.setLogMonitor({
        ...logMonitor,
        ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
        ...(linkAttributes ? { attributes: linkAttributes } : {}),
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
        ...(linkAttributes ? { attributes: linkAttributes } : {}),
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

/*
 * A link's attributes as a monitor's attribute filter holds them: a kept
 * value as itself, a value left out as "does not equal", several as "is
 * none of". Undefined when the link names no attribute.
 */
const getLinkAttributes: (
  query: TelemetryMonitorLinkQuery,
) => Dictionary<string | number | boolean> | undefined = (
  query: TelemetryMonitorLinkQuery,
): Dictionary<string | number | boolean> | undefined => {
  const attributes: Dictionary<unknown> = { ...(query.attributes || {}) };

  for (const [key, values] of Object.entries(query.excludedAttributes || {})) {
    if (!key || attributes[key] !== undefined || values.length === 0) {
      continue;
    }

    attributes[key] =
      values.length === 1
        ? new NotEqual<string>(values[0]!)
        : new IncludesNone(values);
  }

  if (Object.keys(attributes).length === 0) {
    return undefined;
  }

  /*
   * The step's type names plain values only, but its attribute filter holds
   * the operators its form offers (dictionaryEnableOperators); they are
   * saved as their JSON and read back by MonitorStep.fromJSON.
   */
  return attributes as Dictionary<string | number | boolean>;
};
