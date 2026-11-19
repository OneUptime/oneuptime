import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { JSONObject } from "Common/Types/JSON";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  TelemetryScopeAttributeValue,
  getFilterAttributes,
  getFilterNumberValues,
  getFilterSearchValue,
  getFilterStringValues,
  isEmptyFilterValue,
} from "./TelemetryQueryFilterValues";
import {
  TraceDurationFilter,
  hasTraceDurationFilter,
} from "../Components/Traces/TracesSearchCompile";

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
 *
 * A `primaryEntityId` chip's "Service" key is only the seed too: the column is
 * polymorphic, and the viewer swaps the key for the resolved entity's type
 * ("RUM Application", "Host") and the value for its name — see
 * resolveTraceChipDisplay in Components/Traces/TracesEntityDisplay. A chip
 * without a facet config keeps the seeded key ("Resource", "Trace").
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
  /**
   * The span duration bounds, in nanoseconds: a Traces monitor's "Takes at
   * least (ms)" (`durationUnixNano >= N`), the floor the mobile Slow Cold
   * Start recommendation alerts on. Null when the query set none. Both
   * transports carry it - the list as the same comparison, the payload as
   * its bound (`atLeastDurationNano`) - so the chart and the list count only
   * the slow spans the monitor counted.
   */
  duration: TraceDurationFilter | null;
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
  duration: null,
  rootOnly: false,
  window: null,
  chips: [],
  notCarried: [],
  passthrough: {},
  hasScope: false,
};

/*
 * The facet key of a duration chip: the span column, as the explorer's own
 * `duration:` token compiles to (TRACE_FIELD_ALIAS_MAP).
 */
export const DURATION_FACET_KEY: string = "durationUnixNano";

const NANOSECONDS_PER_MILLISECOND: number = 1_000_000;

/*
 * A stored comparison as its wire shape: a deserialized GreaterThanOrEqual
 * (the pages restore the query) or the `{_type, value}` JSON (a raw reader).
 */
function toWireShape(value: unknown): JSONObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate: { toJSON?: unknown } = value as { toJSON?: unknown };

  if (typeof candidate.toJSON === "function") {
    const json: unknown = (candidate.toJSON as () => unknown).call(value);

    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as JSONObject)
      : null;
  }

  return value as JSONObject;
}

// A nanosecond bound, from a number or a numeric string; null otherwise.
function toNanoBound(value: unknown): number | null {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * A stored `durationUnixNano` predicate as duration bounds, or null when it
 * is not one this reader models (an Includes, an operator a monitor never
 * writes). What a Traces monitor stores is `GreaterThanOrEqual` of the floor
 * in nanoseconds (MonitorStepTraceMonitorUtil.toQuery); the explorer's own
 * `duration:` filter compiles to GreaterThan, LessThan, their inclusive
 * forms and an exact number, and every one of them is read back here.
 */
export function readStoredDurationFilter(
  stored: unknown,
): TraceDurationFilter | null {
  if (typeof stored === "number" || typeof stored === "string") {
    const exact: number | null = toNanoBound(stored);

    return exact === null ? null : { exactDurationNano: exact };
  }

  const wire: JSONObject | null = toWireShape(stored);

  if (!wire) {
    return null;
  }

  const type: unknown = wire["_type"];

  if (type === "InBetween") {
    const start: number | null = toNanoBound(wire["startValue"]);
    const end: number | null = toNanoBound(wire["endValue"]);

    return start === null || end === null
      ? null
      : { atLeastDurationNano: start, atMostDurationNano: end };
  }

  const bound: number | null = toNanoBound(wire["value"]);

  if (bound === null) {
    return null;
  }

  switch (type) {
    case "GreaterThanOrEqual":
      return { atLeastDurationNano: bound };
    case "GreaterThan":
      return { minDurationNano: bound };
    case "LessThanOrEqual":
      return { atMostDurationNano: bound };
    case "LessThan":
      return { maxDurationNano: bound };
    default:
      return null;
  }
}

// Milliseconds as the search bar spells them: no trailing zeros.
function formatSearchMilliseconds(nano: number): string {
  const milliseconds: number = nano / NANOSECONDS_PER_MILLISECOND;

  return String(Math.round(milliseconds * 1000) / 1000);
}

/**
 * The value a `duration:` token spells a filter with (`>=5000`, `<200`,
 * `750`), in milliseconds, or null when the filter has two bounds: one token
 * holds one comparison, and the explorer reads only a token's first value.
 */
export function toDurationSearchValue(
  filter: TraceDurationFilter,
): string | null {
  const parts: Array<string> = [];

  if (filter.exactDurationNano !== undefined) {
    parts.push(formatSearchMilliseconds(filter.exactDurationNano));
  }

  if (filter.atLeastDurationNano !== undefined) {
    parts.push(`>=${formatSearchMilliseconds(filter.atLeastDurationNano)}`);
  }

  if (filter.minDurationNano !== undefined) {
    parts.push(`>${formatSearchMilliseconds(filter.minDurationNano)}`);
  }

  if (filter.atMostDurationNano !== undefined) {
    parts.push(`<=${formatSearchMilliseconds(filter.atMostDurationNano)}`);
  }

  if (filter.maxDurationNano !== undefined) {
    parts.push(`<${formatSearchMilliseconds(filter.maxDurationNano)}`);
  }

  return parts.length === 1 ? parts[0]! : null;
}

/**
 * How a duration chip says its bounds, before the explorer words the
 * durations in the reader's language: a comparison symbol, which no
 * language translates, before each bound. "≥ 5000 ms" for a monitor's
 * floor of five seconds.
 */
export function describeDurationBounds(
  filter: TraceDurationFilter,
  formatMilliseconds: (milliseconds: number) => string,
): string {
  const describe: (symbol: string, nano: number) => string = (
    symbol: string,
    nano: number,
  ): string => {
    // A no-break space: the symbol stays on the line of its number.
    return `${symbol}\u00A0${formatMilliseconds(nano / NANOSECONDS_PER_MILLISECOND)}`;
  };

  const parts: Array<string> = [];

  if (filter.exactDurationNano !== undefined) {
    parts.push(describe("=", filter.exactDurationNano));
  }

  if (filter.atLeastDurationNano !== undefined) {
    parts.push(describe("≥", filter.atLeastDurationNano));
  }

  if (filter.minDurationNano !== undefined) {
    parts.push(describe(">", filter.minDurationNano));
  }

  if (filter.atMostDurationNano !== undefined) {
    parts.push(describe("≤", filter.atMostDurationNano));
  }

  if (filter.maxDurationNano !== undefined) {
    parts.push(describe("<", filter.maxDurationNano));
  }

  return parts.join(", ");
}

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
  DURATION_FACET_KEY,
]);

/** Human labels for the keys a hint may have to name. */
const QUERY_KEY_LABELS: Dictionary<string> = {
  durationUnixNano: translationKey("span duration filter"),
  endTime: translationKey("span end time filter"),
  parentSpanId: translationKey("parent span filter"),
  sessionId: translationKey("session filter"),
  attributeKeys: translationKey("attribute-presence filter"),
};

const ATTRIBUTE_FILTER_ON_PREFIX: string = "attribute filter on ";

const SPAN_STATUS_LABELS: Dictionary<string> = {
  "0": "Unset",
  "1": "Ok",
  "2": "Error",
};

function labelForKey(key: string): string {
  return QUERY_KEY_LABELS[key] || key;
}

/**
 * One `notCarried` label as a sentence words it. The labels are English, and
 * a key nothing names (a new column) stays as written.
 */
export function describeNotCarriedFilter(
  label: string,
  sentence: Translator,
): string {
  if (label.startsWith(ATTRIBUTE_FILTER_ON_PREFIX)) {
    return sentence.translateTemplate("attribute filter on {{key}}", {
      key: label.substring(ATTRIBUTE_FILTER_ON_PREFIX.length),
    });
  }

  return sentence.translateTerm(label, { inSentence: true });
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
    pushUniqueLabel(scope.notCarried, translationKey("span status filter"));
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
          pushUniqueLabel(
            scope.notCarried,
            `${ATTRIBUTE_FILTER_ON_PREFIX}${key}`,
          );
        }
      }
    } else {
      pushUniqueLabel(scope.notCarried, translationKey("attribute filter"));
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

  /*
   * A Traces monitor's duration floor ("Takes at least (ms)"): read once, so
   * the list keeps the same comparison and the payload carries its bound.
   * A predicate this reader cannot model rides the list as it was stored,
   * and is named in the hint, as it always was.
   */
  const storedDuration: unknown = record[DURATION_FACET_KEY];

  if (
    storedDuration !== undefined &&
    storedDuration !== null &&
    !isEmptyFilterValue(storedDuration)
  ) {
    const duration: TraceDurationFilter | null =
      readStoredDurationFilter(storedDuration);

    if (duration && hasTraceDurationFilter(duration)) {
      scope.duration = duration;

      /*
       * The seed reads "≥ 5000 ms"; the explorer words the durations in the
       * reader's language as it draws the chip. Its value is the search
       * bar's spelling (`>=5000`), which the chip's tooltip offers to copy.
       */
      const seed: string = describeDurationBounds(
        duration,
        (milliseconds: number): string => {
          return `${milliseconds}\u00A0ms`;
        },
      );

      addChip(
        DURATION_FACET_KEY,
        toDurationSearchValue(duration) || seed,
        "Duration",
        seed,
      );
    } else {
      scope.passthrough[DURATION_FACET_KEY] = storedDuration as never;
      pushUniqueLabel(scope.notCarried, labelForKey(DURATION_FACET_KEY));
    }
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
    scope.duration !== null ||
    scope.rootOnly ||
    Object.keys(scope.passthrough).length > 0;

  return scope;
}
