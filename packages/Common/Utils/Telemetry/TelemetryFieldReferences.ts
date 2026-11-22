import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../Types/Dashboard/DashboardVariable";
import { JSONObject } from "../../Types/JSON";
import {
  LogFilter,
  queryStringToFilter,
} from "../../Types/Log/LogQueryToFilter";
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
 * ---------------------------------------------------------------------------
 * The records a query keeps (#10436)
 * ---------------------------------------------------------------------------
 *
 * A scrub rule changes a field, so a caller asks of each field a record
 * reads. A drop or sample filter takes whole records, so it asks of each
 * query a record keeps whether the two can keep the same record: a
 * monitor's step, a dashboard's widget, a saved view, a recording rule's
 * source, a request SLO, a monitor's log that resolves a group. A record
 * with several reads what any of them keeps.
 *
 * A query is the signal it reads, the services it is limited to, the
 * values it pins a field to - a severity, a span status, an attribute's
 * value - and the field references it reads (for the page to say what of
 * it reads). A field is pinned only where the query keeps exactly the
 * records whose field is one of a few values; a search, a pattern, a
 * "not", a value picked when the query is read (a dashboard's variable)
 * pins nothing, and the field may then be anything.
 */
export interface TelemetryReadQuery {
  signal: TelemetryFieldSignal;
  // The services the query reads, in lower case; null for every service.
  serviceIds: Array<string> | null;
  /*
   * The values a field holds in every record the query keeps, by the
   * field as a drop filter's query names it: severityText, statusCode,
   * name, isEntrySpan, attributes.<key>. One of them, as text.
   */
  pinned: Record<string, Array<string>>;
  references: Array<TelemetryFieldReference>;
}

// The pinned field of an attribute, as a filter's query names it.
export const PINNED_ATTRIBUTE_PREFIX: string = "attributes.";

// The stored operators that keep exactly the records whose value is one of theirs.
const EXACT_OPERATOR_TYPES: ReadonlySet<string> = new Set([
  "EqualTo",
  "Includes",
]);

/*
 * The values a stored filter value keeps a record by, exactly: a plain
 * value is itself, an EqualTo or an Includes its value(s). Null for one it
 * keeps records by otherwise (a search, a "not", a range), or that names
 * no value - a text left empty, a dashboard's {{variable}}.
 */
export function readPinnedValues(value: unknown): Array<string> | null {
  const asTexts: (items: Array<unknown>) => Array<string> | null = (
    items: Array<unknown>,
  ): Array<string> | null => {
    const texts: Array<string> = [];

    for (const item of items.slice(0, MAX_TEXTS_PER_FILTER)) {
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      ) {
        return null;
      }

      const text: string = String(item);

      if (!text || text.includes("{{")) {
        return null;
      }

      texts.push(text);
    }

    return texts.length > 0 ? Array.from(new Set(texts)) : null;
  };

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return asTexts([value]);
  }

  const record: Record<string, unknown> | undefined = asRecord(value);

  if (
    !record ||
    typeof record["_type"] !== "string" ||
    !EXACT_OPERATOR_TYPES.has(record["_type"])
  ) {
    return null;
  }

  const inner: unknown = record["value"];

  return asTexts(Array.isArray(inner) ? inner : [inner]);
}

/*
 * Pins a field to values. Pinned twice - two conditions on one field, both
 * kept - it holds what both allow: none in common pins it to nothing, and
 * the query keeps no record.
 */
function pin(
  pinned: Record<string, Array<string>>,
  field: string,
  values: Array<string> | null,
): void {
  if (!values || !field) {
    return;
  }

  const existing: Array<string> | undefined =
    Object.prototype.hasOwnProperty.call(pinned, field)
      ? pinned[field]
      : undefined;

  pinned[field] = existing
    ? existing.filter((value: string): boolean => {
        return values.includes(value);
      })
    : [...values];
}

// Each attribute a stored filter keeps exactly by, pinned.
function pinAttributes(
  pinned: Record<string, Array<string>>,
  attributes: unknown,
): void {
  const record: Record<string, unknown> | undefined = asRecord(attributes);

  if (!record) {
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    if (key.trim()) {
      pin(
        pinned,
        `${PINNED_ATTRIBUTE_PREFIX}${key.trim()}`,
        readPinnedValues(value),
      );
    }
  }
}

// A list of texts a query keeps records by, as stored: none for an empty or odd one.
function readTextList(value: unknown): Array<string> | null {
  return Array.isArray(value) && value.length > 0
    ? readPinnedValues({ _type: "Includes", value })
    : null;
}

function telemetryQuery(data: {
  signal: TelemetryFieldSignal;
  serviceIds: Array<string> | null;
  pinned?: Record<string, Array<string>> | undefined;
  references: Array<TelemetryFieldReference>;
}): TelemetryReadQuery {
  return {
    signal: data.signal,
    serviceIds: data.serviceIds,
    pinned: data.pinned || {},
    references: data.references,
  };
}

// Every field reference of some queries, in their order.
function referencesOf(
  queries: Array<TelemetryReadQuery>,
): Array<TelemetryFieldReference> {
  return queries.flatMap(
    (readQuery: TelemetryReadQuery): Array<TelemetryFieldReference> => {
      return readQuery.references;
    },
  );
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

/*
 * A Logs step: its attribute filters, its body search, its groups and what
 * resolves them. The log that resolves a group is a query of its own: read
 * only on a grouped monitor, and kept by its own attributes.
 */
function logMonitorQueries(
  step: Record<string, unknown>,
): Array<TelemetryReadQuery> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );
  const groupBy: Array<TelemetryFieldReference> = keyReferences({
    signal: "log",
    serviceIds,
    keys: step["groupByAttributes"],
    use: TelemetryFieldUse.GroupBy,
  });
  const pinned: Record<string, Array<string>> = {};

  pinAttributes(pinned, step["attributes"]);
  pin(pinned, "severityText", readTextList(step["severityTexts"]));

  const queries: Array<TelemetryReadQuery> = [
    telemetryQuery({
      signal: "log",
      serviceIds,
      pinned,
      references: [
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
      ],
    }),
  ];

  // The log that resolves a group: read only on a grouped monitor.
  const resolvedBy: Array<TelemetryFieldReference> =
    groupBy.length > 0
      ? attributeFilterReferences({
          signal: "log",
          serviceIds,
          part: TelemetryFieldPart.Attributes,
          attributes: step["resolvedByAttributes"],
        })
      : [];

  if (resolvedBy.length > 0) {
    const resolvedByPinned: Record<string, Array<string>> = {};

    pinAttributes(resolvedByPinned, step["resolvedByAttributes"]);
    queries.push(
      telemetryQuery({
        signal: "log",
        serviceIds,
        pinned: resolvedByPinned,
        references: resolvedBy,
      }),
    );
  }

  return queries;
}

// A Traces step: its attribute filters, its span name search and its groups.
function traceMonitorQueries(
  step: Record<string, unknown>,
): Array<TelemetryReadQuery> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );
  const pinned: Record<string, Array<string>> = {};

  pinAttributes(pinned, step["attributes"]);
  pin(pinned, "statusCode", readTextList(step["spanStatuses"]));

  return [
    telemetryQuery({
      signal: "trace",
      serviceIds,
      pinned,
      references: [
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
      ],
    }),
  ];
}

/*
 * An Exceptions step: its message search. An exception is a copy of a
 * span's exception event - its message scrubbed by the rules that scrub
 * span events - or found in a log line after the line's rules ran, so the
 * search reads both, and the step reads the spans and the logs its
 * exceptions come from: a filter that drops one drops its exception too.
 */
function exceptionMonitorQueries(
  step: Record<string, unknown>,
): Array<TelemetryReadQuery> {
  const serviceIds: Array<string> | null = readServiceScope(
    step["telemetryServiceIds"],
  );

  return [
    telemetryQuery({
      signal: "trace",
      serviceIds,
      references: searchReference({
        signal: "trace",
        serviceIds,
        part: TelemetryFieldPart.Events,
        text: step["message"],
      }),
    }),
    telemetryQuery({
      signal: "log",
      serviceIds,
      references: searchReference({
        signal: "log",
        serviceIds,
        part: TelemetryFieldPart.Body,
        text: step["message"],
      }),
    }),
  ];
}

const MONITOR_STEP_QUERIES: Record<
  string,
  (step: Record<string, unknown>) => Array<TelemetryReadQuery>
> = {
  logMonitor: logMonitorQueries,
  traceMonitor: traceMonitorQueries,
  exceptionMonitor: exceptionMonitorQueries,
};

/*
 * Every query a monitor's steps keep records by: each Logs, Traces and
 * Exceptions step, wherever the steps keep it - the whole value is walked,
 * so a step kept in an older shape is read too.
 */
export function findMonitorTelemetryQueries(
  monitorSteps: unknown,
): Array<TelemetryReadQuery> {
  const queries: Array<TelemetryReadQuery> = [];
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
        | ((step: Record<string, unknown>) => Array<TelemetryReadQuery>)
        | undefined = Object.prototype.hasOwnProperty.call(
        MONITOR_STEP_QUERIES,
        key,
      )
        ? MONITOR_STEP_QUERIES[key]
        : undefined;
      const step: Record<string, unknown> | undefined = asRecord(child);

      if (readStep && step) {
        queries.push(...readStep(step));
        continue;
      }

      walk(child, depth + 1);
    }
  };

  walk(asStored(monitorSteps), 0);

  return queries;
}

/*
 * Every field a monitor's steps read of logs and spans: the field
 * references of each of its queries, in order.
 */
export function findMonitorFieldReferences(
  monitorSteps: unknown,
): Array<TelemetryFieldReference> {
  return referencesOf(findMonitorTelemetryQueries(monitorSteps));
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

    if (
      variable?.["type"] !== DashboardVariableType.TelemetryAttribute ||
      !key
    ) {
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

/*
 * ---------------------------------------------------------------------------
 * The queries each record keeps records by, for a drop or sample filter
 * (#10436)
 * ---------------------------------------------------------------------------
 */

// A dashboard's widget and the queries it reads by.
export interface DashboardTelemetryQueries {
  // Each widget that reads logs or spans, in its order on the dashboard.
  widgets: Array<{
    widget: TelemetryFieldReferenceWidget;
    queries: Array<TelemetryReadQuery>;
  }>;
}

// A log widget's severities, as its arguments keep them: none for every severity.
function readWidgetSeverities(
  widgetArguments: Record<string, unknown>,
): Array<string> | null {
  const list: Array<string> | null = readTextList(
    widgetArguments["severityFilters"],
  );

  if (list) {
    return list;
  }

  return readPinnedValues(readText(widgetArguments["severityFilter"]) || null);
}

function widgetQueries(
  type: string,
  widgetArguments: Record<string, unknown>,
): Array<TelemetryReadQuery> {
  const references: Array<TelemetryFieldReference> = widgetReferences(
    type,
    widgetArguments,
  );

  switch (type) {
    case DashboardComponentType.LogStream:
    case DashboardComponentType.LogChart: {
      const pinned: Record<string, Array<string>> = {};

      pin(pinned, "severityText", readWidgetSeverities(widgetArguments));

      return [
        telemetryQuery({ signal: "log", serviceIds: null, pinned, references }),
      ];
    }
    case DashboardComponentType.TraceChart:
    case DashboardComponentType.TraceTable:
      return [
        telemetryQuery({ signal: "trace", serviceIds: null, references }),
      ];
    default:
      return [];
  }
}

/*
 * A dashboard's log and trace widgets, each with the query it reads by -
 * one with no filter too, which reads every record of its signal. A
 * widget's attribute filters pin nothing: a board's variables fill them in
 * when it is viewed.
 */
export function findDashboardTelemetryQueries(
  dashboardViewConfig: unknown,
): DashboardTelemetryQueries {
  const found: DashboardTelemetryQueries = { widgets: [] };
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
    const queries: Array<TelemetryReadQuery> = widgetQueries(
      type,
      widgetArguments,
    );

    if (queries.length === 0) {
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
      queries,
    });
  });

  return found;
}

// Equality filters kept as { key, value } rows, as attributes to pin.
function rowsAsAttributes(
  rows: Array<{ key?: unknown; value?: unknown }>,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const row of rows) {
    const key: string = readText(row.key);

    if (key) {
      attributes[key] = row.value;
    }
  }

  return attributes;
}

// A log recording rule: the logs of its services, severities and attribute filters.
export function findLogRecordingRuleTelemetryQueries(
  definition: unknown,
): Array<TelemetryReadQuery> {
  const read: LogRecordingRuleDefinition | null =
    LogRecordingRuleDefinitionUtil.fromJSON(asStored(definition));

  if (!read) {
    return [];
  }

  const pinned: Record<string, Array<string>> = {};

  pinAttributes(pinned, rowsAsAttributes(read.filter?.attributeFilters || []));
  pin(pinned, "severityText", readTextList(read.filter?.severityTexts));

  return [
    telemetryQuery({
      signal: "log",
      serviceIds: readServiceScope(read.filter?.telemetryServiceIds || []),
      pinned,
      references: findLogRecordingRuleFieldReferences(definition),
    }),
  ];
}

/*
 * A trace recording rule: each source a query of every service's spans,
 * by its kind, its errors and its attribute filters
 * (ComputeTraceRecordingRules).
 */
export function findTraceRecordingRuleTelemetryQueries(
  definition: unknown,
): Array<TelemetryReadQuery> {
  const read: Record<string, unknown> | undefined = asRecord(
    asStored(definition),
  );

  if (!read) {
    return [];
  }

  const groupBy: Array<TelemetryFieldReference> = spanGroupByReferences(
    (read as unknown as TraceRecordingRuleDefinition).groupByAttribute,
    null,
  );
  const sources: Array<unknown> = Array.isArray(read["sources"])
    ? (read["sources"] as Array<unknown>)
    : [];
  const queries: Array<TelemetryReadQuery> = [];

  for (const rawSource of sources) {
    const source: Record<string, unknown> | undefined = asRecord(rawSource);

    if (!source) {
      continue;
    }

    const filters: Record<string, unknown> = rowsAsAttributes(
      TraceRecordingRuleDefinitionUtil.getSourceAttributeFilters(
        source as unknown as TraceRecordingRuleSource,
      ),
    );
    const pinned: Record<string, Array<string>> = {};

    pinAttributes(pinned, filters);
    pin(pinned, "kind", readPinnedValues(readText(source["spanKind"]) || null));

    if (source["onlyErrors"] === true) {
      pin(pinned, "statusCode", ["2"]);
    }

    queries.push(
      telemetryQuery({
        signal: "trace",
        serviceIds: null,
        pinned,
        references: [
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
          ...groupBy,
        ],
      }),
    );
  }

  return queries;
}

// What a search term keeps records by exactly: Equals and In, else nothing.
function pinnedOfPredicate(
  predicate: SearchValuePredicate,
): Array<string> | null {
  if (predicate.operator === SearchValueOperator.Equals) {
    return readPinnedValues(predicate.value);
  }

  if (predicate.operator === SearchValueOperator.In) {
    return readTextList(predicate.values);
  }

  return null;
}

/*
 * A request SLO: the entry spans of its services (SloRequestCounting reads
 * no other), by its filter's terms. None for an SLO that reads no span.
 */
export function findSloTelemetryQueries(slo: {
  sliType?: SliType | string | undefined;
  requestFilter?: unknown;
  serviceIds: ReadonlyArray<string>;
}): Array<TelemetryReadQuery> {
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

  const pinned: Record<string, Array<string>> = { isEntrySpan: ["true"] };

  for (const term of parseSloRequestFilter(readText(slo.requestFilter)).terms) {
    pin(
      pinned,
      term.isAttribute ? `${PINNED_ATTRIBUTE_PREFIX}${term.key}` : "name",
      pinnedOfPredicate(term.predicate),
    );
  }

  return [
    telemetryQuery({
      signal: "trace",
      serviceIds,
      pinned,
      references: findSloFieldReferences(slo),
    }),
  ];
}

// A Logs saved view: its services, severities and attribute filters.
export function findLogSavedViewTelemetryQueries(view: {
  query?: unknown;
  scope?: unknown;
}): Array<TelemetryReadQuery> {
  const stored: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!stored) {
    return [];
  }

  const pinned: Record<string, Array<string>> = {};

  pinAttributes(pinned, stored["attributes"]);
  pin(
    pinned,
    "severityText",
    Array.isArray(stored["severityText"])
      ? readTextList(stored["severityText"])
      : readPinnedValues(stored["severityText"]),
  );

  return [
    telemetryQuery({
      signal: "log",
      serviceIds: narrowerScope(
        readServiceScope(stored["primaryEntityId"]),
        readScopeServiceIds(view.scope),
      ),
      pinned,
      references: findLogSavedViewFieldReferences(view),
    }),
  ];
}

/*
 * A Traces view's facets a record must hold a value of. A facet that
 * excludes or searches a value pins nothing of its attribute.
 */
function pinnedFacetAttributes(
  filters: unknown,
): Record<string, Array<string>> {
  const values: Record<string, Array<string>> = {};
  const unpinned: Set<string> = new Set<string>();

  for (const [rawKey, value] of readSavedViewFilters(filters)) {
    const isExcluded: boolean = rawKey.startsWith(EXCLUDE_FACET_PREFIX);
    const key: string = isExcluded
      ? rawKey.slice(EXCLUDE_FACET_PREFIX.length)
      : rawKey;
    const prefix: string | undefined = ATTRIBUTE_FACET_PREFIXES.find(
      (candidate: string): boolean => {
        return key.startsWith(candidate);
      },
    );

    if (!prefix) {
      continue;
    }

    const attribute: string = key.slice(prefix.length).trim();

    if (!attribute) {
      continue;
    }

    if (isExcluded || prefix !== ATTRIBUTE_FACET_PREFIXES[0] || !value) {
      unpinned.add(attribute);
      continue;
    }

    values[attribute] = [...(values[attribute] || []), value];
  }

  const pinned: Record<string, Array<string>> = {};

  for (const [attribute, list] of Object.entries(values)) {
    if (!unpinned.has(attribute)) {
      pin(pinned, `${PINNED_ATTRIBUTE_PREFIX}${attribute}`, list);
    }
  }

  return pinned;
}

// A Traces saved view: its services, its facets and its search's exact terms.
export function findTraceSavedViewTelemetryQueries(view: {
  query?: unknown;
}): Array<TelemetryReadQuery> {
  const state: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!state) {
    return [];
  }

  const pinned: Record<string, Array<string>> = pinnedFacetAttributes(
    state["filters"],
  );

  for (const token of parseSearchQuery(readText(state["search"]), {
    knownFieldKeys: new Set(SLO_REQUEST_FILTER_EXPLORER_FIELDS),
  })) {
    if (token.type !== SearchTokenType.Field) {
      continue;
    }

    const fieldKey: string = token.key.toLowerCase();

    if (fieldKey === SLO_REQUEST_FILTER_NAME_FIELD) {
      pin(pinned, "name", pinnedOfPredicate(token.predicate));
      continue;
    }

    if (TRACE_SEARCH_FIELDS.has(fieldKey)) {
      continue;
    }

    pin(
      pinned,
      `${PINNED_ATTRIBUTE_PREFIX}${token.key}`,
      pinnedOfPredicate(token.predicate),
    );
  }

  return [
    telemetryQuery({
      signal: "trace",
      serviceIds: readSavedViewFacets(state["filters"]).serviceIds,
      pinned,
      references: findTraceSavedViewFieldReferences(view),
    }),
  ];
}

/*
 * An Exceptions saved view: the spans and the logs its exceptions come
 * from, of its services. An exception's own fields are no span's or log's,
 * so they pin nothing.
 */
export function findExceptionSavedViewTelemetryQueries(view: {
  query?: unknown;
}): Array<TelemetryReadQuery> {
  const state: Record<string, unknown> | undefined = asRecord(
    asStored(view.query),
  );

  if (!state) {
    return [];
  }

  const serviceIds: Array<string> | null = readSavedViewFacets(
    state["filters"],
  ).serviceIds;
  const references: Array<TelemetryFieldReference> =
    findExceptionSavedViewFieldReferences(view);

  return (["trace", "log"] as Array<TelemetryFieldSignal>).map(
    (signal: TelemetryFieldSignal): TelemetryReadQuery => {
      return telemetryQuery({
        signal,
        serviceIds,
        references: references.filter(
          (reference: TelemetryFieldReference): boolean => {
            return reference.signal === signal;
          },
        ),
      });
    },
  );
}
