import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../Types/Dashboard/DashboardVariable";
import { JSONObject } from "../../Types/JSON";
import { LogFilter, queryStringToFilter } from "../../Types/Log/LogQueryToFilter";
import LogRecordingRuleDefinition, {
  LogRecordingRuleAttributeFilter,
  LogRecordingRuleDefinitionUtil,
} from "../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../Types/ObjectID";
import SliType from "../../Types/ServiceLevelObjective/SliType";
import {
  TelemetryFieldPart,
  TelemetryFieldSignal,
  TelemetryFieldUse,
} from "../../Types/Telemetry/TelemetryFieldReaders";
import {
  parseSearchQuery,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
} from "../../Types/Telemetry/TelemetrySearchQuery";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleAttributeFilter,
  TraceRecordingRuleDefinitionUtil,
  TraceRecordingRuleSource,
} from "../../Types/Trace/TraceRecordingRuleDefinition";
import StoredDashboardViewConfig from "../Dashboard/StoredDashboardViewConfig";
import {
  ParsedSloRequestFilter,
  parseSloRequestFilter,
  SLO_REQUEST_FILTER_EXPLORER_FIELDS,
  SLO_REQUEST_FILTER_NAME_FIELD,
  SloRequestFilterTerm,
} from "../Slo/SloRequestFilter";
import { readSavedViewFilters, SavedViewFilterTuple } from "./SavedViewFilters";

/*
 * WHAT A SAVED RECORD READS OF A LOG'S OR A SPAN'S FIELDS (#10433).
 *
 * The queries a project keeps read logs and spans by their fields: a log
 * monitor filters on an attribute's value and searches the body, a trace
 * monitor searches the span's name and groups by an attribute, a recording
 * rule aggregates one, a saved view filters on several. Each such reading
 * is a reference: which records (logs or spans, of which services), which
 * part of them (the body, the attributes, the span's name...), which
 * attribute, how it is read (a filter, a search, a group-by, a value), and
 * the text a filter or a search looks for.
 *
 * A caller asks of each reference whether what it takes away is read there
 * - a scrub rule (ScrubRuleFieldReads), a drop or sample filter (#10436) -
 * so the walk is written once, here, without the database: the server reads
 * the records (Server/Utils/Telemetry/TelemetryFieldReaders) and hands each
 * one's stored query to the walker of its kind.
 *
 * Every walker reads its query as it is stored, defensively - JSON a person
 * or the API wrote, an older shape, a value of the wrong type - and never
 * throws: a part it cannot read is left out, not guessed.
 *
 * A reference's services are the primaryEntityIds its query is limited to,
 * in lower case, or null for every service: what a rule for one service
 * (Types/Telemetry/ScrubRuleScope) is read against.
 */

export interface TelemetryFieldReference {
  signal: TelemetryFieldSignal;
  // The services the query reads, in lower case; null for every service.
  serviceIds: Array<string> | null;
  part: TelemetryFieldPart;
  // An attribute's key, as the query names it.
  key?: string | undefined;
  use: TelemetryFieldUse;
  /*
   * The texts a filter or a search looks for: what a rule that hides them
   * makes it miss. None for a filter whose value is picked when it is read
   * (a dashboard's variable), a group-by and a value.
   */
  values?: Array<string> | undefined;
}

// How deep, and how many values, a stored query is walked.
const MAX_DEPTH: number = 32;
const MAX_VALUES: number = 10_000;
// The most texts one filter is read as, and the most of each.
const MAX_TEXTS_PER_FILTER: number = 50;
const MAX_TEXT_LENGTH: number = 2_000;

/*
 * A value as it is stored: a column's own classes write their JSON, and a
 * row kept as text (a definition written as JSON text) is its JSON read back.
 */
function asStored(value: unknown): unknown {
  try {
    return typeof value === "string"
      ? JSON.parse(value)
      : JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// An id as JSON writes one: its text, or ObjectID's { _type, value }.
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  const inner: unknown = asRecord(value)?.["value"];

  return typeof inner === "string" ? inner.trim().toLowerCase() : "";
}

// The services a query is limited to: none when it names none.
export function readServiceScope(value: unknown): Array<string> | null {
  const items: Array<unknown> = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.["value"])
      ? (asRecord(value)!["value"] as Array<unknown>)
      : typeof value === "string"
        ? [value]
        : [];
  const ids: Array<string> = items.map(readId).filter((id: string) => {
    return ObjectID.isValidUUID(id);
  });

  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

/*
 * The texts a stored filter value looks for: a plain value as text, an
 * operator's value(s) - Search, NotEqual, Includes, as JSONFunctions writes
 * them ({ _type, value }) - each text inside it. Numbers and true or false
 * as their text: a rule never changes them, so they never match one.
 */
export function readFilterTexts(value: unknown): Array<string> {
  const texts: Array<string> = [];
  let visited: number = 0;

  const walk: (node: unknown, depth: number) => void = (
    node: unknown,
    depth: number,
  ): void => {
    if (
      visited++ >= MAX_VALUES ||
      depth > MAX_DEPTH ||
      texts.length >= MAX_TEXTS_PER_FILTER ||
      node === null ||
      node === undefined
    ) {
      return;
    }

    if (typeof node === "string") {
      if (node.length > 0) {
        texts.push(node.slice(0, MAX_TEXT_LENGTH));
      }

      return;
    }

    if (typeof node === "number" || typeof node === "boolean") {
      texts.push(String(node));
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
      }

      return;
    }

    const entries: Record<string, unknown> | undefined = asRecord(node);

    if (!entries) {
      return;
    }

    // An operator's own name is no value it looks for.
    for (const [key, child] of Object.entries(entries)) {
      if (key !== "_type") {
        walk(child, depth + 1);
      }
    }
  };

  walk(value, 0);

  return Array.from(new Set(texts));
}

function reference(data: {
  signal: TelemetryFieldSignal;
  serviceIds: Array<string> | null;
  part: TelemetryFieldPart;
  use: TelemetryFieldUse;
  key?: string | undefined;
  values?: Array<string> | undefined;
}): TelemetryFieldReference {
  const found: TelemetryFieldReference = {
    signal: data.signal,
    serviceIds: data.serviceIds,
    part: data.part,
    use: data.use,
  };

  if (data.key !== undefined) {
    found.key = data.key;
  }

  if (data.values && data.values.length > 0) {
    found.values = data.values;
  }

  return found;
}

/*
 * The stored operators that keep a record whose value holds the text
 * anywhere, or at one end, rather than is it (Types/JSON ObjectType).
 */
const PARTIAL_OPERATOR_TYPES: ReadonlySet<string> = new Set([
  "Search",
  "StartsWith",
  "EndsWith",
  "NotContains",
  "Wildcard",
  "NotWildcard",
  "MultiSearch",
]);

/*
 * Whether a stored filter value looks for part of a value - contains, starts
 * or ends with, a glob - so a rule that hides the whole value makes it miss.
 */
export function isPartialFilterValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("*");
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_TEXTS_PER_FILTER).some(isPartialFilterValue);
  }

  const record: Record<string, unknown> | undefined = asRecord(value);

  return Boolean(
    record &&
      typeof record["_type"] === "string" &&
      PARTIAL_OPERATOR_TYPES.has(record["_type"]),
  );
}

// An attribute filter's references: a filter of each key, with the texts it looks for.
function attributeFilterReferences(data: {
  signal: TelemetryFieldSignal;
  serviceIds: Array<string> | null;
  part: TelemetryFieldPart;
  attributes: unknown;
}): Array<TelemetryFieldReference> {
  const attributes: Record<string, unknown> | undefined = asRecord(
    data.attributes,
  );

  if (!attributes) {
    return [];
  }

  return Object.keys(attributes)
    .filter((key: string): boolean => {
      return key.trim().length > 0;
    })
    .map((key: string): TelemetryFieldReference => {
      return reference({
        signal: data.signal,
        serviceIds: data.serviceIds,
        part: data.part,
        key: key.trim(),
        // A filter for part of a value searches it.
        use: isPartialFilterValue(attributes[key])
          ? TelemetryFieldUse.Search
          : TelemetryFieldUse.Filter,
        values: readFilterTexts(attributes[key]),
      });
    });
}

function keyReferences(data: {
  signal: TelemetryFieldSignal;
  serviceIds: Array<string> | null;
  keys: unknown;
  use: TelemetryFieldUse;
}): Array<TelemetryFieldReference> {
  const keys: Array<unknown> = Array.isArray(data.keys)
    ? data.keys
    : [data.keys];

  return keys
    .map(readText)
    .filter((key: string): boolean => {
      return key.length > 0;
    })
    .map((key: string): TelemetryFieldReference => {
      return reference({
        signal: data.signal,
        serviceIds: data.serviceIds,
        part: TelemetryFieldPart.Attributes,
        key,
        use: data.use,
      });
    });
}

function searchReference(data: {
  signal: TelemetryFieldSignal;
  serviceIds: Array<string> | null;
  part: TelemetryFieldPart;
  text: unknown;
}): Array<TelemetryFieldReference> {
  const texts: Array<string> = readFilterTexts(data.text).filter(
    (text: string): boolean => {
      return text.trim().length > 0;
    },
  );

  return texts.length > 0
    ? [
        reference({
          signal: data.signal,
          serviceIds: data.serviceIds,
          part: data.part,
          use: TelemetryFieldUse.Search,
          values: texts,
        }),
      ]
    : [];
}

/*
 * ---------------------------------------------------------------------------
 * Monitors
 * ---------------------------------------------------------------------------
 */

// A Logs step: its attribute filters, its body search, its groups and what resolves them.
function logMonitorReferences(
  step: Record<string, unknown>,
): Array<TelemetryFieldReference> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );
  const groupBy: Array<TelemetryFieldReference> = keyReferences({
    signal: "log",
    serviceIds,
    keys: step["groupByAttributes"],
    use: TelemetryFieldUse.GroupBy,
  });

  return [
    ...attributeFilterReferences({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Attributes,
      attributes: step["attributes"],
    }),
    ...searchReference({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Body,
      text: step["body"],
    }),
    ...groupBy,
    // The log that resolves a group: read only on a grouped monitor.
    ...(groupBy.length > 0
      ? attributeFilterReferences({
          signal: "log",
          serviceIds,
          part: TelemetryFieldPart.Attributes,
          attributes: step["resolvedByAttributes"],
        })
      : []),
  ];
}

// A Traces step: its attribute filters, its span name search and its groups.
function traceMonitorReferences(
  step: Record<string, unknown>,
): Array<TelemetryFieldReference> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );

  return [
    ...attributeFilterReferences({
      signal: "trace",
      serviceIds,
      part: TelemetryFieldPart.Attributes,
      attributes: step["attributes"],
    }),
    ...searchReference({
      signal: "trace",
      serviceIds,
      part: TelemetryFieldPart.SpanName,
      text: step["spanName"],
    }),
    ...keyReferences({
      signal: "trace",
      serviceIds,
      keys: step["groupByAttributes"],
      use: TelemetryFieldUse.GroupBy,
    }),
  ];
}

/*
 * An Exceptions step: its message search. An exception is a copy of a
 * span's exception event - its message scrubbed by the rules that scrub
 * span events - or found in a log line after the line's rules ran, so the
 * search reads both.
 */
function exceptionMonitorReferences(
  step: Record<string, unknown>,
): Array<TelemetryFieldReference> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );

  return [
    ...searchReference({
      signal: "trace",
      serviceIds,
      part: TelemetryFieldPart.Events,
      text: step["message"],
    }),
    ...searchReference({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Body,
      text: step["message"],
    }),
  ];
}

const MONITOR_STEP_READERS: Record<
  string,
  (step: Record<string, unknown>) => Array<TelemetryFieldReference>
> = {
  logMonitor: logMonitorReferences,
  traceMonitor: traceMonitorReferences,
  exceptionMonitor: exceptionMonitorReferences,
};

/*
 * Every field a monitor's steps read of logs and spans: each Logs, Traces
 * and Exceptions step, wherever the steps keep it - the whole value is
 * walked, so a step kept in an older shape is read too.
 */
export function findMonitorFieldReferences(
  monitorSteps: unknown,
): Array<TelemetryFieldReference> {
  const references: Array<TelemetryFieldReference> = [];
  let visited: number = 0;

  const walk: (node: unknown, depth: number) => void = (
    node: unknown,
    depth: number,
  ): void => {
    if (visited++ >= MAX_VALUES || depth > MAX_DEPTH || !node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
      }

      return;
    }

    const entries: Record<string, unknown> | undefined = asRecord(node);

    if (!entries) {
      return;
    }

    for (const [key, child] of Object.entries(entries)) {
      const readStep:
        | ((step: Record<string, unknown>) => Array<TelemetryFieldReference>)
        | undefined = Object.prototype.hasOwnProperty.call(
        MONITOR_STEP_READERS,
        key,
      )
        ? MONITOR_STEP_READERS[key]
        : undefined;
      const step: Record<string, unknown> | undefined = asRecord(child);

      if (readStep && step) {
        references.push(...readStep(step));
        continue;
      }

      walk(child, depth + 1);
    }
  };

  walk(asStored(monitorSteps), 0);

  return references;
}

/*
 * ---------------------------------------------------------------------------
 * Recording rules
 * ---------------------------------------------------------------------------
 */

/*
 * A log recording rule: its attribute filters and body search, the
 * attribute it aggregates and the ones it groups by, of its services.
 */
export function findLogRecordingRuleFieldReferences(
  definition: unknown,
): Array<TelemetryFieldReference> {
  const read: LogRecordingRuleDefinition | null =
    LogRecordingRuleDefinitionUtil.fromJSON(asStored(definition));

  if (!read) {
    return [];
  }

  const serviceIds: Array<string> | null = readServiceScope(
    read.filter?.telemetryServiceIds || [],
  );
  const filters: Record<string, unknown> = {};

  for (const filter of read.filter?.attributeFilters || []) {
    const row: LogRecordingRuleAttributeFilter = filter;

    if (row.key.trim()) {
      filters[row.key.trim()] = row.value;
    }
  }

  return [
    ...attributeFilterReferences({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Attributes,
      attributes: filters,
    }),
    ...searchReference({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Body,
      text: read.filter?.body,
    }),
    ...(LogRecordingRuleDefinitionUtil.needsValueAttribute(read.aggregationType)
      ? keyReferences({
          signal: "log",
          serviceIds,
          keys: read.valueAttribute,
          use: TelemetryFieldUse.Value,
        })
      : []),
    ...keyReferences({
      signal: "log",
      serviceIds,
      keys: read.groupByAttributes || [],
      use: TelemetryFieldUse.GroupBy,
    }),
  ];
}

// The span columns a trace rule or widget may group by, which are no attribute.
const SPAN_COLUMN_GROUP_BYS: ReadonlySet<string> = new Set([
  "primaryentityid",
  "statuscode",
  "kind",
  "status",
]);

// A group-by of spans: the span's name, a column, or an attribute.
function spanGroupByReferences(
  groupBy: unknown,
  serviceIds: Array<string> | null,
): Array<TelemetryFieldReference> {
  const key: string = readText(groupBy);

  if (!key || SPAN_COLUMN_GROUP_BYS.has(key.toLowerCase())) {
    return [];
  }

  if (key.toLowerCase() === "name") {
    return [
      reference({
        signal: "trace",
        serviceIds,
        part: TelemetryFieldPart.SpanName,
        use: TelemetryFieldUse.GroupBy,
      }),
    ];
  }

  return keyReferences({
    signal: "trace",
    serviceIds,
    keys: key,
    use: TelemetryFieldUse.GroupBy,
  });
}

/*
 * A trace recording rule: each source's attribute filters and span name
 * pattern, and the attribute it groups by. It reads the spans of every
 * service (ComputeTraceRecordingRules).
 */
export function findTraceRecordingRuleFieldReferences(
  definition: unknown,
): Array<TelemetryFieldReference> {
  const read: Record<string, unknown> | undefined = asRecord(
    asStored(definition),
  );

  if (!read) {
    return [];
  }

  const references: Array<TelemetryFieldReference> = [];
  const sources: Array<unknown> = Array.isArray(read["sources"])
    ? (read["sources"] as Array<unknown>)
    : [];

  for (const rawSource of sources) {
    const source: Record<string, unknown> | undefined = asRecord(rawSource);

    if (!source) {
      continue;
    }

    const filters: Record<string, unknown> = {};

    for (const filter of TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
      source as unknown as TraceRecordingRuleSource,
    )) {
      const row: TraceRecordingRuleAttributeFilter = filter;

      if (readText(row.key)) {
        filters[readText(row.key)] = row.value;
      }
    }

    references.push(
      ...attributeFilterReferences({
        signal: "trace",
        serviceIds: null,
        part: TelemetryFieldPart.Attributes,
        attributes: filters,
      }),
      ...searchReference({
        signal: "trace",
        serviceIds: null,
        part: TelemetryFieldPart.SpanName,
        text: source["spanNameRegex"],
      }),
    );
  }

  references.push(
    ...spanGroupByReferences(
      (read as unknown as TraceRecordingRuleDefinition).groupByAttribute,
      null,
    ),
  );

  return references;
}

/*
 * ---------------------------------------------------------------------------
 * SLOs
 * ---------------------------------------------------------------------------
 */

/*
 * A request SLO's filter, of its own services: each `@key:value` term an
 * attribute filter, `name:` the span's name. An SLO of another kind reads
 * no span, and one of no service counts nothing (EvaluateSlos).
 */
export function findSloFieldReferences(slo: {
  sliType?: SliType | string | undefined;
  requestFilter?: unknown;
  serviceIds: ReadonlyArray<string>;
}): Array<TelemetryFieldReference> {
  const serviceIds: Array<string> | null = readServiceScope(
    Array.from(slo.serviceIds),
  );

  if (
    (slo.sliType !== SliType.RequestSuccess &&
      slo.sliType !== SliType.RequestLatency) ||
    !serviceIds
  ) {
    return [];
  }

  const parsed: ParsedSloRequestFilter = parseSloRequestFilter(
    readText(slo.requestFilter),
  );

  return parsed.terms.map((term: SloRequestFilterTerm) => {
    return term.isAttribute
      ? reference({
          signal: "trace",
          serviceIds,
          part: TelemetryFieldPart.Attributes,
          key: term.key,
          use: useOfPredicate(term.predicate),
          values: predicateTexts(term.predicate),
        })
      : reference({
          signal: "trace",
          serviceIds,
          part: TelemetryFieldPart.SpanName,
          use: useOfPredicate(term.predicate),
          values: predicateTexts(term.predicate),
        });
  });
}

function predicateTexts(predicate: SearchValuePredicate): Array<string> {
  return readFilterTexts([predicate.value, ...(predicate.values || [])]);
}

// The search operators that look for part of a value, not the value.
const PARTIAL_SEARCH_OPERATORS: ReadonlySet<SearchValueOperator> = new Set([
  SearchValueOperator.Contains,
  SearchValueOperator.NotContains,
  SearchValueOperator.StartsWith,
  SearchValueOperator.EndsWith,
  SearchValueOperator.Wildcard,
  SearchValueOperator.NotWildcard,
]);

// How a parsed search term reads its field: a search for part of a value, or a filter.
function useOfPredicate(predicate: SearchValuePredicate): TelemetryFieldUse {
  return PARTIAL_SEARCH_OPERATORS.has(predicate.operator)
    ? TelemetryFieldUse.Search
    : TelemetryFieldUse.Filter;
}

/*
 * ---------------------------------------------------------------------------
 * Dashboards
 * ---------------------------------------------------------------------------
 */

// A dashboard's widget, as its dashboard names it.
export interface TelemetryFieldReferenceWidget {
  id: string;
  title: string;
  type: string;
}

export interface DashboardFieldReferences {
  // Each widget that reads logs or spans, in its order on the dashboard.
  widgets: Array<{
    widget: TelemetryFieldReferenceWidget;
    references: Array<TelemetryFieldReference>;
  }>;
  // What the dashboard reads outside its widgets: its telemetry attribute variables.
  dashboard: Array<TelemetryFieldReference>;
}

// What a widget is titled by, by kind (MetricReaders' WIDGET_TITLE_ARGUMENTS).
const WIDGET_TITLE_ARGUMENTS: ReadonlyArray<string> = [
  "title",
  "chartTitle",
  "widgetTitle",
  "tableTitle",
  "gaugeTitle",
];

const MAX_WIDGET_TITLE_LENGTH: number = 200;

/*
 * A trace widget's attribute filters: a record, or the older "k=v; k2=v2"
 * text (the Dashboard's parseAttributeFilters).
 */
function readTraceWidgetFilters(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const filters: Record<string, unknown> = {};

    for (const pair of value.split(";")) {
      const equals: number = pair.indexOf("=");

      if (equals <= 0) {
        continue;
      }

      const key: string = pair.slice(0, equals).trim();
      const filterValue: string = pair.slice(equals + 1).trim();

      if (key && filterValue) {
        filters[key] = filterValue;
      }
    }

    return filters;
  }

  return asRecord(value) || {};
}

// A log widget's attribute filters: the record, or the search text it was saved with.
function readLogWidgetFilters(
  widgetArguments: Record<string, unknown>,
): unknown {
  const record: Record<string, unknown> | undefined = asRecord(
    widgetArguments["attributeFilters"],
  );

  if (record && Object.keys(record).length > 0) {
    return record;
  }

  const query: string = readText(widgetArguments["attributeFilterQuery"]);

  if (!query) {
    return undefined;
  }

  // Only the attributes of the search text filter the widget.
  const filter: LogFilter = queryStringToFilter(query);

  return filter.attributes;
}

function widgetReferences(
  type: string,
  widgetArguments: Record<string, unknown>,
): Array<TelemetryFieldReference> {
  switch (type) {
    case DashboardComponentType.LogStream:
    case DashboardComponentType.LogChart:
      return [
        ...searchReference({
          signal: "log",
          serviceIds: null,
          part: TelemetryFieldPart.Body,
          text: widgetArguments["bodyContains"],
        }),
        ...attributeFilterReferences({
          signal: "log",
          serviceIds: null,
          part: TelemetryFieldPart.Attributes,
          attributes: readLogWidgetFilters(widgetArguments),
        }),
      ];
    case DashboardComponentType.TraceChart:
    case DashboardComponentType.TraceTable:
      return [
        ...searchReference({
          signal: "trace",
          serviceIds: null,
          part: TelemetryFieldPart.SpanName,
          text: widgetArguments["spanNameContains"],
        }),
        ...attributeFilterReferences({
          signal: "trace",
          serviceIds: null,
          part: TelemetryFieldPart.Attributes,
          attributes: readTraceWidgetFilters(
            widgetArguments["attributeFilters"],
          ),
        }),
        ...spanGroupByReferences(widgetArguments["groupByAttribute"], null),
      ];
    default:
      return [];
  }
}

/*
 * A dashboard's telemetry attribute variables: each lists the values of one
 * attribute, and filters the board's log and trace widgets by the one a
 * viewer picks (VariableInterpolation). A rule that hides that attribute's
 * values leaves the variable only what the rule left to offer.
 */
function variableReferences(
  config: JSONObject,
): Array<TelemetryFieldReference> {
  const variables: Array<unknown> = Array.isArray(config["variables"])
    ? (config["variables"] as Array<unknown>)
    : [];
  const references: Array<TelemetryFieldReference> = [];

  for (const rawVariable of variables) {
    const variable: Record<string, unknown> | undefined = asRecord(rawVariable);
    const key: string = readText(variable?.["attributeKey"]);

    if (variable?.["type"] !== DashboardVariableType.TelemetryAttribute || !key) {
      continue;
    }

    for (const signal of ["log", "trace"] as Array<TelemetryFieldSignal>) {
      references.push(
        reference({
          signal,
          serviceIds: null,
          part: TelemetryFieldPart.Attributes,
          key,
          use: TelemetryFieldUse.Filter,
        }),
      );
    }
  }

  return references;
}

/*
 * A dashboard's log and trace readings, widget by widget - Log Stream, Log
 * Chart, Trace Chart and Trace Table, by the arguments the board reads them
 * with - each named by the id the board draws it under, and its telemetry
 * attribute variables apart. Read from the config in whatever shape it was
 * stored (StoredDashboardViewConfig), as MetricReaders reads it.
 */
export function findDashboardFieldReferences(
  dashboardViewConfig: unknown,
): DashboardFieldReferences {
  const found: DashboardFieldReferences = { widgets: [], dashboard: [] };
  const config: JSONObject = StoredDashboardViewConfig.unwrap(
    asStored(dashboardViewConfig),
  );
  const entries: Array<unknown> =
    StoredDashboardViewConfig.getComponentEntries(config);
  const ids: Array<string | null> =
    StoredDashboardViewConfig.getComponentIds(entries);

  entries.forEach((entry: unknown, index: number): void => {
    const id: string | null = ids[index] || null;

    if (!id || !StoredDashboardViewConfig.isWidgetEntry(entry)) {
      return;
    }

    const component: JSONObject =
      StoredDashboardViewConfig.withArgumentsRead(entry);
    const type: string = readText(component["componentType"]);
    const widgetArguments: Record<string, unknown> =
      asRecord(component["arguments"]) || {};
    const references: Array<TelemetryFieldReference> = widgetReferences(
      type,
      widgetArguments,
    );

    if (references.length === 0) {
      return;
    }

    let title: string = "";

    for (const key of WIDGET_TITLE_ARGUMENTS) {
      title = readText(widgetArguments[key]);

      if (title) {
        break;
      }
    }

    found.widgets.push({
      widget: {
        id: id.toLowerCase(),
        title: title.slice(0, MAX_WIDGET_TITLE_LENGTH),
        type,
      },
      references,
    });
  });

  found.dashboard = variableReferences(config);

  return found;
}

/*
 * ---------------------------------------------------------------------------
 * Saved views
 * ---------------------------------------------------------------------------
 */

const SERVICE_SCOPE_PREFIX: string = "service:";

// The service a saved view's page is, when it is a service's page.
function readScopeServiceIds(scope: unknown): Array<string> | null {
  const text: string = readText(scope);

  if (!text.toLowerCase().startsWith(SERVICE_SCOPE_PREFIX)) {
    return null;
  }

  let id: string = text.slice(SERVICE_SCOPE_PREFIX.length);

  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }

  return readServiceScope([id]);
}

// Two scopes on one view: the records both name, or the one that names any.
function narrowerScope(
  first: Array<string> | null,
  second: Array<string> | null,
): Array<string> | null {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  const both: Array<string> = first.filter((id: string): boolean => {
    return second.includes(id);
  });

  // Two scopes that share none read nothing: the first is kept, on the safe side.
  return both.length > 0 ? both : first;
}

/*
 * A Logs saved view: its query's attribute filters and body search, of the
 * services it names and of the page it was saved on.
 */
export function findLogSavedViewFieldReferences(view: {
  query?: unknown;
  scope?: unknown;
}): Array<TelemetryFieldReference> {
  const query: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!query) {
    return [];
  }

  const serviceIds: Array<string> | null = narrowerScope(
    readServiceScope(query["primaryEntityId"]),
    readScopeServiceIds(view.scope),
  );

  return [
    ...attributeFilterReferences({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Attributes,
      attributes: query["attributes"],
    }),
    ...searchReference({
      signal: "log",
      serviceIds,
      part: TelemetryFieldPart.Body,
      text: query["body"],
    }),
  ];
}

// A facet filter's key on an attribute, as the explorers write it: none for a column's.
const ATTRIBUTE_FACET_PREFIXES: ReadonlyArray<string> = [
  "attributes.",
  "attributeSearches.",
];
const SERVICE_FACET_KEYS: ReadonlyArray<string> = [
  "primaryEntityId",
  "serviceId",
];
const EXCLUDE_FACET_PREFIX: string = "!";

interface SavedViewFacets {
  serviceIds: Array<string> | null;
  attributes: Record<string, Array<string>>;
}

// A Traces or Exceptions view's facet filters: the services it names and its attribute filters.
function readSavedViewFacets(filters: unknown): SavedViewFacets {
  const facets: SavedViewFacets = { serviceIds: null, attributes: {} };
  const services: Array<string> = [];

  for (const [rawKey, value] of readSavedViewFilters(filters).map(
    (tuple: SavedViewFilterTuple): SavedViewFilterTuple => {
      return tuple;
    },
  )) {
    const isExcluded: boolean = rawKey.startsWith(EXCLUDE_FACET_PREFIX);
    const key: string = isExcluded
      ? rawKey.slice(EXCLUDE_FACET_PREFIX.length)
      : rawKey;

    if (SERVICE_FACET_KEYS.includes(key)) {
      // An excluded service narrows nothing a rule's scope is read against.
      if (!isExcluded) {
        services.push(value);
      }

      continue;
    }

    const prefix: string | undefined = ATTRIBUTE_FACET_PREFIXES.find(
      (candidate: string): boolean => {
        return key.startsWith(candidate);
      },
    );

    if (!prefix) {
      continue;
    }

    const attribute: string = key.slice(prefix.length).trim();

    if (attribute) {
      facets.attributes[attribute] = [
        ...(facets.attributes[attribute] || []),
        value,
      ];
    }
  }

  facets.serviceIds = readServiceScope(services);

  return facets;
}

// The explorer fields a Traces search names that are no attribute (SloRequestFilter's copy of them).
const TRACE_SEARCH_FIELDS: ReadonlySet<string> = new Set(
  SLO_REQUEST_FILTER_EXPLORER_FIELDS,
);

/*
 * A Traces saved view: its facet filters and its search - `@k:v` and any
 * other `k:v` an attribute filter, `name:` and free text a search of the
 * span's name, `statusmessage:` of its status message - of the services it
 * names.
 */
export function findTraceSavedViewFieldReferences(view: {
  query?: unknown;
}): Array<TelemetryFieldReference> {
  const state: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!state) {
    return [];
  }

  const facets: SavedViewFacets = readSavedViewFacets(state["filters"]);
  const references: Array<TelemetryFieldReference> = [
    ...attributeFilterReferences({
      signal: "trace",
      serviceIds: facets.serviceIds,
      part: TelemetryFieldPart.Attributes,
      attributes: facets.attributes,
    }),
  ];
  const tokens: Array<SearchToken> = parseSearchQuery(
    readText(state["search"]),
    { knownFieldKeys: new Set(SLO_REQUEST_FILTER_EXPLORER_FIELDS) },
  );

  for (const token of tokens) {
    const fieldKey: string =
      token.type === SearchTokenType.Field ? token.key.toLowerCase() : "";

    if (token.type === SearchTokenType.FreeText) {
      references.push(
        ...searchReference({
          signal: "trace",
          serviceIds: facets.serviceIds,
          part: TelemetryFieldPart.SpanName,
          text: token.predicate.value,
        }),
      );
      continue;
    }

    if (fieldKey === SLO_REQUEST_FILTER_NAME_FIELD) {
      references.push(
        reference({
          signal: "trace",
          serviceIds: facets.serviceIds,
          part: TelemetryFieldPart.SpanName,
          use: useOfPredicate(token.predicate),
          values: predicateTexts(token.predicate),
        }),
      );
      continue;
    }

    if (fieldKey === "statusmessage") {
      references.push(
        reference({
          signal: "trace",
          serviceIds: facets.serviceIds,
          part: TelemetryFieldPart.StatusMessage,
          use: useOfPredicate(token.predicate),
          values: predicateTexts(token.predicate),
        }),
      );
      continue;
    }

    // Another of the explorer's columns: none a scrub rule reads.
    if (fieldKey && TRACE_SEARCH_FIELDS.has(fieldKey)) {
      continue;
    }

    references.push(
      reference({
        signal: "trace",
        serviceIds: facets.serviceIds,
        part: TelemetryFieldPart.Attributes,
        key: token.key,
        use: useOfPredicate(token.predicate),
        values: predicateTexts(token.predicate),
      }),
    );
  }

  return references;
}

/*
 * The Exceptions list's own search fields, which are no attribute (the
 * Dashboard's EXCEPTION_FIELD_ALIASES, which App/Tests/Telemetry/
 * TelemetryFieldReferences holds this list to).
 */
export const EXCEPTION_SEARCH_FIELDS: ReadonlyArray<string> = [
  "type",
  "exceptiontype",
  "service",
  "primaryentityid",
  "env",
  "environment",
  "class",
  "errorclass",
];

/*
 * An exception's attribute and message, as both its records keep them: a
 * span's exception event (scrubbed by the rules that scrub span events) and
 * a log line it was found in (scrubbed by the line's rules first).
 */
function exceptionReferences(data: {
  serviceIds: Array<string> | null;
  key?: string | undefined;
  use: TelemetryFieldUse;
  values: Array<string>;
}): Array<TelemetryFieldReference> {
  if (data.key) {
    return [
      reference({
        signal: "trace",
        serviceIds: data.serviceIds,
        part: TelemetryFieldPart.Events,
        key: data.key,
        use: data.use,
        values: data.values,
      }),
      reference({
        signal: "log",
        serviceIds: data.serviceIds,
        part: TelemetryFieldPart.Attributes,
        key: data.key,
        use: data.use,
        values: data.values,
      }),
    ];
  }

  return [
    reference({
      signal: "trace",
      serviceIds: data.serviceIds,
      part: TelemetryFieldPart.Events,
      use: data.use,
      values: data.values,
    }),
    reference({
      signal: "log",
      serviceIds: data.serviceIds,
      part: TelemetryFieldPart.Body,
      use: data.use,
      values: data.values,
    }),
  ];
}

/*
 * An Exceptions saved view: its attribute facets, and its search - free
 * text the exception's message, any field the list does not own an
 * attribute filter - of the services it names.
 */
export function findExceptionSavedViewFieldReferences(view: {
  query?: unknown;
}): Array<TelemetryFieldReference> {
  const state: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!state) {
    return [];
  }

  const facets: SavedViewFacets = readSavedViewFacets(state["filters"]);
  const references: Array<TelemetryFieldReference> = [];

  for (const [key, values] of Object.entries(facets.attributes)) {
    references.push(
      ...exceptionReferences({
        serviceIds: facets.serviceIds,
        key,
        use: TelemetryFieldUse.Filter,
        values,
      }),
    );
  }

  const tokens: Array<SearchToken> = parseSearchQuery(
    readText(state["search"]),
    { knownFieldKeys: new Set(EXCEPTION_SEARCH_FIELDS) },
  );

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      const text: string = token.predicate.value.trim();

      if (text) {
        references.push(
          ...exceptionReferences({
            serviceIds: facets.serviceIds,
            use: TelemetryFieldUse.Search,
            values: [text],
          }),
        );
      }

      continue;
    }

    if (
      token.type === SearchTokenType.Field &&
      EXCEPTION_SEARCH_FIELDS.includes(token.key.toLowerCase())
    ) {
      continue;
    }

    references.push(
      ...exceptionReferences({
        serviceIds: facets.serviceIds,
        key: token.key,
        use: useOfPredicate(token.predicate),
        values: predicateTexts(token.predicate),
      }),
    );
  }

  return references;
}
