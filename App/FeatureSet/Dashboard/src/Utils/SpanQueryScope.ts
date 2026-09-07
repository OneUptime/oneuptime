import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { JSONObject } from "Common/Types/JSON";
import {
  TelemetryScopeAttributeValue,
  getFilterAttributes,
  getFilterNumberValues,
  getFilterSearchValue,
  getFilterStringValues,
  isEmptyFilterValue,
} from "./TelemetryQueryFilterValues";

/*
 * Read a stored `Query<Span>` — the slice a trace monitor evaluated, kept on
 * the incident / alert row — as a SCOPE the spans explorer can host.
 *
 * The alert and incident pages used to render that query through a dense
 * `AnalyticsModelTable`; they now embed the same `TracesViewer` the /traces
 * page uses, the way those pages already embed the logs viewer. That means
 * the query has to reach FOUR places, not one:
 *
 *   1. the span list query,
 *   2. the histogram + facet aggregation payload, which speaks a different
 *      vocabulary (`serviceIds`, `spanNameSearches`, `statusCodes`, ...),
 *   3. the read-only chips that tell the user what the list is scoped to,
 *   4. the time picker, pinned to the evaluation window.
 *
 * If (1) and (2) disagree the chart counts rows the list excludes — the
 * failure this file exists to prevent. So every dimension is read ONCE here
 * and rendered into both vocabularies together, and anything that cannot be
 * expressed in the payload is reported in `notCarried` rather than dropped
 * silently.
 *
 * Pure, so App/Tests/Dashboard can exercise it against a real
 * `MonitorStepTraceMonitorUtil.toQuery` result without a renderer.
 */

/**
 * A read-only scope chip. `displayKey` / `displayValue` are seeds — the
 * viewer re-derives them from its facet configs so a service id shows as the
 * service's name once services load.
 */
export interface SpanScopeChip {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
}

export interface SpanQueryScope {
  /** Service ids (the `primaryEntityId` column for OTLP telemetry). */
  serviceIds: Array<string>;
  /** Stable telemetry entity keys — `hasAny(entityKeys, [...])`. */
  entityKeys: Array<string>;
  /**
   * Attribute equality scope, applied by both transports.
   *
   * Values are STRINGS even when the monitor stored a number or a boolean.
   * Two reasons, and they point the same way: the ClickHouse `attributes`
   * column is a Map(String, String), and the aggregation endpoint's body
   * parser (parseAttributeFilterRecord in Common/Server/API/TelemetryAPI.ts)
   * keeps only strings, string arrays and serialized operators — it DROPS a
   * bare number. Passing one through would have narrowed the list by
   * `http.status_code = 500` while the chart and the facet counts above it
   * silently ignored the filter.
   */
  attributes: Dictionary<string>;
  /**
   * Attribute entries whose value this reader could not model. Applied to the
   * LIST query so it stays narrow; absent from the aggregation payload, and
   * named in `notCarried` so the wider chart is never silent.
   */
  attributesPassthrough: JSONObject;
  /** `SpanStatus` members. */
  statusCodes: Array<number>;
  /** A single span-name value matches as a SUBSTRING (the monitor's Search). */
  spanNameSearch: string | null;
  /** Several span-name values match exactly. */
  spanNames: Array<string>;
  statusMessageSearch: string | null;
  statusMessages: Array<string>;
  traceIds: Array<string>;
  spanIds: Array<string>;
  spanKinds: Array<string>;
  /** Tri-state: null when the query said nothing about it. */
  hasException: boolean | null;
  /** True when the query pinned `isRootSpan`. */
  rootOnly: boolean;
  /** The evaluation window, off `startTime`. Null when none was stored. */
  window: InBetween<Date> | null;
  chips: Array<SpanScopeChip>;
  /**
   * Query keys this reader could not render into the aggregation payload.
   * They are still applied to the LIST (see `passthrough`) — a narrower list
   * with a hint beats a wrong list — and named here so the widening of the
   * chart above it is never silent.
   */
  notCarried: Array<string>;
  /**
   * Unreadable keys, forwarded to the list query verbatim.
   *
   * Typed as a plain record rather than `Query<Span>`: the consumer copies
   * the entries onto its own query, and iterating `Query<Span>` with
   * `Object.entries` makes the checker expand that mapped type to the point
   * of TS2589 ("type instantiation is excessively deep").
   */
  passthrough: JSONObject;
  /** False when the query scoped nothing at all (or was absent / malformed). */
  hasScope: boolean;
}

export const EMPTY_SPAN_QUERY_SCOPE: SpanQueryScope = {
  serviceIds: [],
  entityKeys: [],
  attributes: {},
  attributesPassthrough: {},
  statusCodes: [],
  spanNameSearch: null,
  spanNames: [],
  statusMessageSearch: null,
  statusMessages: [],
  traceIds: [],
  spanIds: [],
  spanKinds: [],
  hasException: null,
  rootOnly: false,
  window: null,
  chips: [],
  notCarried: [],
  passthrough: {},
  hasScope: false,
};

/*
 * Keys the scope consumes itself, so the passthrough loop does not forward
 * them to the list a second time. `projectId` is implicit on every viewer
 * query and `startTime` becomes the pinned window, not a filter.
 */
const CONSUMED_QUERY_KEYS: Set<string> = new Set<string>([
  "projectId",
  "startTime",
  "primaryEntityId",
  "entityKeys",
  "attributes",
  "statusCode",
  "name",
  "statusMessage",
  "traceId",
  "spanId",
  "kind",
  "hasException",
  "isRootSpan",
]);

/** Human labels for the keys a hint may have to name. */
const QUERY_KEY_LABELS: Dictionary<string> = {
  durationUnixNano: "span duration filter",
  endTime: "span end time filter",
  parentSpanId: "parent span filter",
  sessionId: "session filter",
  attributeKeys: "attribute-presence filter",
};

const SPAN_STATUS_LABELS: Dictionary<string> = {
  "0": "Unset",
  "1": "Ok",
  "2": "Error",
};

function labelForKey(key: string): string {
  return QUERY_KEY_LABELS[key] || key;
}

function pushUniqueLabel(labels: Array<string>, label: string): void {
  if (label.length > 0 && !labels.includes(label)) {
    labels.push(label);
  }
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const lower: string = value.trim().toLowerCase();

    if (lower === "true") {
      return true;
    }

    if (lower === "false") {
      return false;
    }
  }

  return null;
}

/**
 * Read a stored span query as a viewer scope. A null / non-object query, or
 * one that scopes nothing, yields `EMPTY_SPAN_QUERY_SCOPE` — the viewer then
 * behaves exactly as it does on the standalone /traces page.
 */
export function buildSpanQueryScope(
  query: Query<Span> | JSONObject | null | undefined,
): SpanQueryScope {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return EMPTY_SPAN_QUERY_SCOPE;
  }

  const record: JSONObject = query as JSONObject;

  const scope: SpanQueryScope = {
    ...EMPTY_SPAN_QUERY_SCOPE,
    serviceIds: [],
    entityKeys: [],
    attributes: {},
    attributesPassthrough: {},
    statusCodes: [],
    spanNames: [],
    statusMessages: [],
    traceIds: [],
    spanIds: [],
    spanKinds: [],
    chips: [],
    notCarried: [],
    passthrough: {},
  };

  scope.window = TelemetryQueryTimeRange.getQueryWindow(
    record,
    TelemetryType.Trace,
  );

  const addChip: (
    facetKey: string,
    value: string,
    displayKey: string,
    displayValue?: string,
  ) => void = (
    facetKey: string,
    value: string,
    displayKey: string,
    displayValue?: string,
  ): void => {
    scope.chips.push({
      facetKey: facetKey,
      value: value,
      displayKey: displayKey,
      displayValue: displayValue || value,
    });
  };

  /*
   * A key whose value we could not read is NOT the same as a key that scopes
   * nothing: the first has to be forwarded to the list and reported, the
   * second is a no-op the monitor happened to store.
   */
  const takeStrings: (key: string) => Array<string> = (
    key: string,
  ): Array<string> => {
    const raw: unknown = record[key];

    if (raw === undefined || raw === null) {
      return [];
    }

    const values: Array<string> = getFilterStringValues(raw);

    if (values.length === 0 && !isEmptyFilterValue(raw)) {
      scope.passthrough[key] = raw as never;
      pushUniqueLabel(scope.notCarried, labelForKey(key));
    }

    return values;
  };

  scope.serviceIds = takeStrings("primaryEntityId");
  for (const serviceId of scope.serviceIds) {
    addChip("primaryEntityId", serviceId, "Service");
  }

  scope.entityKeys = takeStrings("entityKeys");
  for (const entityKey of scope.entityKeys) {
    addChip("entityKeys", entityKey, "Resource");
  }

  scope.traceIds = takeStrings("traceId");
  for (const traceId of scope.traceIds) {
    addChip("traceId", traceId, "Trace");
  }

  scope.spanIds = takeStrings("spanId");
  for (const spanId of scope.spanIds) {
    addChip("spanId", spanId, "Span");
  }

  scope.spanKinds = takeStrings("kind");
  for (const kind of scope.spanKinds) {
    addChip("kind", kind, "Kind");
  }

  scope.statusCodes = getFilterNumberValues(record["statusCode"]);
  if (
    scope.statusCodes.length === 0 &&
    record["statusCode"] !== undefined &&
    record["statusCode"] !== null &&
    !isEmptyFilterValue(record["statusCode"])
  ) {
    scope.passthrough["statusCode"] = record["statusCode"] as never;
    pushUniqueLabel(scope.notCarried, "span status filter");
  }
  for (const statusCode of scope.statusCodes) {
    addChip(
      "statusCode",
      String(statusCode),
      "Status",
      SPAN_STATUS_LABELS[String(statusCode)] || String(statusCode),
    );
  }

  /*
   * `name` and `statusMessage` are the two text columns the list matches as
   * a substring when a single value is given (see TEXT_CHIP_FIELDS in
   * TracesViewer) and exactly when several are. The payload mirrors that
   * with `spanNameSearches` / `spanNames`, so the split is decided here once
   * for both.
   */
  const readTextColumn: (key: string) => {
    search: string | null;
    values: Array<string>;
  } = (key: string): { search: string | null; values: Array<string> } => {
    const raw: unknown = record[key];

    if (raw === undefined || raw === null) {
      return { search: null, values: [] };
    }

    const search: string | null = getFilterSearchValue(raw);

    if (search) {
      return { search: search, values: [] };
    }

    const values: Array<string> = getFilterStringValues(raw);

    if (values.length === 0) {
      if (!isEmptyFilterValue(raw)) {
        scope.passthrough[key] = raw as never;
        pushUniqueLabel(scope.notCarried, labelForKey(key));
      }

      return { search: null, values: [] };
    }

    // One exact value still matches as a substring, mirroring the list.
    if (values.length === 1) {
      return { search: values[0]!, values: [] };
    }

    return { search: null, values: values };
  };

  const spanName: { search: string | null; values: Array<string> } =
    readTextColumn("name");
  scope.spanNameSearch = spanName.search;
  scope.spanNames = spanName.values;
  for (const value of scope.spanNameSearch
    ? [scope.spanNameSearch]
    : scope.spanNames) {
    addChip("name", value, "Name");
  }

  const statusMessage: { search: string | null; values: Array<string> } =
    readTextColumn("statusMessage");
  scope.statusMessageSearch = statusMessage.search;
  scope.statusMessages = statusMessage.values;
  for (const value of scope.statusMessageSearch
    ? [scope.statusMessageSearch]
    : scope.statusMessages) {
    addChip("statusMessage", value, "Status Message");
  }

  const scalarAttributes: Dictionary<TelemetryScopeAttributeValue> =
    getFilterAttributes(record["attributes"]);

  for (const [key, value] of Object.entries(scalarAttributes)) {
    scope.attributes[key] = String(value);
  }

  /*
   * An attributes map can be PARTIALLY readable: the scalars compile to the
   * fast map-subscript equality both transports speak, while an operator
   * value (a contains, a range, an is-any-of) does not. Dropping the half we
   * cannot model would widen the list under an event's heading, so those
   * entries ride the list query verbatim — the analytics compiler
   * understands more shapes than this reader does — and are named in the
   * hint, because the aggregation payload genuinely cannot carry them.
   */
  const rawAttributes: unknown = record["attributes"];

  if (rawAttributes !== undefined && rawAttributes !== null) {
    const unmodelled: JSONObject = {};

    if (
      typeof rawAttributes === "object" &&
      !Array.isArray(rawAttributes) &&
      Object.keys(rawAttributes as JSONObject).length > 0
    ) {
      for (const [key, value] of Object.entries(rawAttributes as JSONObject)) {
        if (scalarAttributes[key] === undefined && value !== undefined) {
          unmodelled[key] = value as never;
          pushUniqueLabel(scope.notCarried, `attribute filter on ${key}`);
        }
      }
    } else {
      pushUniqueLabel(scope.notCarried, "attribute filter");
    }

    if (Object.keys(unmodelled).length > 0) {
      scope.attributesPassthrough = unmodelled;
    }
  }

  for (const [key, value] of Object.entries(scope.attributes)) {
    addChip(`attributes.${key}`, value, key);
  }

  scope.hasException = readBoolean(record["hasException"]);
  if (scope.hasException !== null) {
    addChip(
      "hasException",
      String(scope.hasException),
      "Has Exception",
      scope.hasException ? "Yes" : "No",
    );
  }

  scope.rootOnly = readBoolean(record["isRootSpan"]) === true;

  for (const key of Object.keys(record)) {
    if (CONSUMED_QUERY_KEYS.has(key)) {
      continue;
    }

    const value: unknown = record[key];

    if (value === undefined || value === null) {
      continue;
    }

    scope.passthrough[key] = value as never;
    pushUniqueLabel(scope.notCarried, labelForKey(key));
  }

  scope.hasScope =
    scope.serviceIds.length > 0 ||
    scope.entityKeys.length > 0 ||
    Object.keys(scope.attributes).length > 0 ||
    Object.keys(scope.attributesPassthrough).length > 0 ||
    scope.statusCodes.length > 0 ||
    scope.spanNameSearch !== null ||
    scope.spanNames.length > 0 ||
    scope.statusMessageSearch !== null ||
    scope.statusMessages.length > 0 ||
    scope.traceIds.length > 0 ||
    scope.spanIds.length > 0 ||
    scope.spanKinds.length > 0 ||
    scope.hasException !== null ||
    scope.rootOnly ||
    Object.keys(scope.passthrough).length > 0;

  return scope;
}
