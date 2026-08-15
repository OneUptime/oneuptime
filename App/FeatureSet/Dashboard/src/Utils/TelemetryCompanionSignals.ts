import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import {
  MetricCrossSignalScopeResult,
  SERVICE_NAME_ATTRIBUTE_KEY,
  buildCrossSignalScopeFromMetricViewData,
  extractScopeFiltersFromQueryConfigs,
} from "./MetricsCrossSignalPivot";

/*
 * Companion-signal derivation for the incident / alert "Telemetry snapshot"
 * card: the monitor fired on ONE signal (the stored TelemetryQuery), and the
 * card offers the other three pillars scoped to the SAME slice — the
 * primary's service / entity / attribute scope, pinned to the exact window
 * the monitor evaluated over.
 *
 * Everything here is pure so App/Tests/Dashboard can exercise it without a
 * renderer. The rules it encodes:
 *
 *  - No stored window -> no companions at all. A companion without the pin
 *    would fall back to each viewer's rolling default and render "now" data
 *    under an incident heading — the exact confusion the snapshot cards
 *    exist to prevent.
 *  - Scope that a pillar cannot express degrades to entity+window and is
 *    reported in `notCarried` (surfaced as a hint in the tab), never
 *    silently. Filters that exist only on the primary signal (a log body
 *    search, a span status) are reported the same way.
 *  - A malformed stored query (wrong shape after the JSON round trip)
 *    produces no companions rather than a crash or an unscoped
 *    (all-services) view.
 */

/** Scope-attribute values the analytics query grammar can carry verbatim. */
export type CompanionScopeAttributeValue = string | number | boolean;

export interface CompanionLogsSpec {
  /** Service ObjectID strings for DashboardLogsViewer's serviceIds prop. */
  serviceIds: Array<string>;
  /** Carries the pinned `time` window plus translated scope filters. */
  logQuery: Query<Log>;
  /** Human labels for primary-scope filters logs cannot express. */
  notCarried: Array<string>;
}

export interface CompanionTracesSpec {
  /** Carries the pinned `startTime` window plus translated scope filters. */
  spanQuery: Query<Span>;
  notCarried: Array<string>;
}

export interface CompanionExceptionsSpec {
  /** Carries the pinned `time` window plus translated scope filters. */
  exceptionQuery: Query<ExceptionInstance>;
  notCarried: Array<string>;
}

export interface CompanionMetricsSpec {
  serviceIds: Array<string>;
  entityKeys: Array<string>;
  attributes: Dictionary<CompanionScopeAttributeValue>;
  window: InBetween<Date>;
  notCarried: Array<string>;
}

export interface CompanionSignalQueries {
  /** Null when the stored query is missing/malformed or carries no window. */
  primaryType: TelemetryType | null;
  logs: CompanionLogsSpec | null;
  traces: CompanionTracesSpec | null;
  metrics: CompanionMetricsSpec | null;
  exceptions: CompanionExceptionsSpec | null;
}

const NO_COMPANIONS: CompanionSignalQueries = {
  primaryType: null,
  logs: null,
  traces: null,
  metrics: null,
  exceptions: null,
};

/*
 * Same canonicalization table as the logs search DSL
 * (Common/Types/Log/LogQueryToFilter.ts, not exported from there) and the
 * CrossSignalScope serializer. The direct-query path applies no
 * normalization of its own, so severity values carried from a metric
 * monitor's filter must land in the exact stored casing.
 */
const LOG_SEVERITY_CANONICAL: Dictionary<string> = {
  fatal: "Fatal",
  error: "Error",
  warning: "Warning",
  warn: "Warning",
  information: "Information",
  info: "Information",
  debug: "Debug",
  trace: "Trace",
  unspecified: "Unspecified",
};

/*
 * Human labels for the primary-signal-only query keys the monitor query
 * builders emit (MonitorStepLogMonitorUtil.toQuery and siblings). Unknown
 * keys pass through verbatim so a new monitor filter is never silently
 * hidden from the hint.
 */
const PRIMARY_ONLY_QUERY_KEY_LABELS: Dictionary<string> = {
  body: "log body search",
  name: "span name search",
  statusCode: "span status filter",
  exceptionType: "exception type filter",
  message: "exception message search",
};

const SEVERITY_NOT_CARRIED_LABEL: string = "severity filter";

/*
 * Keys that never translate INTO companion scope but are not lost either:
 * projectId is implicit on every companion query, and the window fields are
 * replaced by the snapshot window parameter.
 */
const IGNORED_QUERY_KEYS: Set<string> = new Set<string>([
  "projectId",
  "time",
  "startTime",
]);

function isPlainRecord(value: unknown): value is JSONObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Includes) &&
    !(value instanceof InBetween) &&
    !(value instanceof ObjectID) &&
    !(value as JSONObject)["_type"]
  );
}

/*
 * Read the string values a query filter holds, across every shape the
 * store/load round trip can produce: an Includes instance, its serialized
 * `{ _type: "Includes", value: [...] }` form, a bare array, a single
 * string / number / ObjectID (instance or serialized).
 */
function getFilterStringValues(value: unknown): Array<string> {
  const collect: (items: Array<unknown>) => Array<string> = (
    items: Array<unknown>,
  ): Array<string> => {
    const values: Array<string> = [];

    for (const item of items) {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        item instanceof ObjectID
      ) {
        const stringValue: string = item.toString().trim();

        if (stringValue.length > 0 && !values.includes(stringValue)) {
          values.push(stringValue);
        }
      }
    }

    return values;
  };

  if (value === null || value === undefined) {
    return [];
  }

  if (value instanceof Includes) {
    return collect(value.values as Array<unknown>);
  }

  if (Array.isArray(value)) {
    return collect(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ObjectID
  ) {
    return collect([value]);
  }

  if (typeof value === "object") {
    const json: JSONObject = value as JSONObject;

    if (json["_type"] === ObjectType.Includes && Array.isArray(json["value"])) {
      return collect(json["value"] as Array<unknown>);
    }

    if (
      json["_type"] === ObjectType.ObjectID &&
      typeof json["value"] === "string"
    ) {
      return collect([json["value"]]);
    }
  }

  return [];
}

/*
 * Whether a filter value carries no scope AT ALL (an empty membership, an
 * empty string) — as opposed to a value we failed to read. The former is
 * omitted silently (it filters nothing), the latter must be reported.
 */
function isEmptyFilterValue(value: unknown): boolean {
  if (value instanceof Includes) {
    return value.values.length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (typeof value === "object" && value !== null) {
    const json: JSONObject = value as JSONObject;

    return (
      json["_type"] === ObjectType.Includes &&
      Array.isArray(json["value"]) &&
      (json["value"] as Array<unknown>).length === 0
    );
  }

  return false;
}

interface ExtractedPrimaryScope {
  serviceIds: Array<string>;
  entityKeys: Array<string>;
  attributes: Dictionary<CompanionScopeAttributeValue>;
  severityTexts: Array<string>;
  notCarried: Array<string>;
}

function pushUniqueLabel(labels: Array<string>, label: string): void {
  if (label.length > 0 && !labels.includes(label)) {
    labels.push(label);
  }
}

/*
 * Distill a stored Log / Span / ExceptionInstance monitor query into the
 * cross-pillar scope. The key set mirrors what the MonitorStep*Util.toQuery
 * builders emit; anything else is reported, never dropped in silence.
 */
function extractScopeFromPrimaryQuery(
  query: JSONObject,
): ExtractedPrimaryScope {
  const scope: ExtractedPrimaryScope = {
    serviceIds: [],
    entityKeys: [],
    attributes: {},
    severityTexts: [],
    notCarried: [],
  };

  for (const key of Object.keys(query)) {
    const value: unknown = query[key];

    if (value === null || value === undefined) {
      continue;
    }

    if (IGNORED_QUERY_KEYS.has(key)) {
      continue;
    }

    if (key === "primaryEntityId") {
      scope.serviceIds = getFilterStringValues(value);

      if (scope.serviceIds.length === 0 && !isEmptyFilterValue(value)) {
        pushUniqueLabel(scope.notCarried, "service filter");
      }
      continue;
    }

    if (key === "entityKeys") {
      scope.entityKeys = getFilterStringValues(value);

      if (scope.entityKeys.length === 0 && !isEmptyFilterValue(value)) {
        pushUniqueLabel(scope.notCarried, "entity-key filter");
      }
      continue;
    }

    if (key === "severityText") {
      scope.severityTexts = getFilterStringValues(value);

      if (scope.severityTexts.length === 0 && !isEmptyFilterValue(value)) {
        pushUniqueLabel(scope.notCarried, SEVERITY_NOT_CARRIED_LABEL);
      }
      continue;
    }

    if (key === "attributes") {
      if (!isPlainRecord(value)) {
        pushUniqueLabel(scope.notCarried, "attribute filters");
        continue;
      }

      for (const attributeKey of Object.keys(value)) {
        const attributeValue: unknown = value[attributeKey];

        if (
          typeof attributeValue === "string" ||
          typeof attributeValue === "number" ||
          typeof attributeValue === "boolean"
        ) {
          scope.attributes[attributeKey] = attributeValue;
        } else if (attributeValue !== null && attributeValue !== undefined) {
          // Operator-shaped values (Search / Includes / ...) — not scope.
          pushUniqueLabel(scope.notCarried, `attribute "${attributeKey}"`);
        }
      }
      continue;
    }

    pushUniqueLabel(
      scope.notCarried,
      PRIMARY_ONLY_QUERY_KEY_LABELS[key] || key,
    );
  }

  return scope;
}

/*
 * Same distillation for a Metric primary, reusing the metric explorer's
 * pivot-scope construction (equality-filter extraction, service-name
 * resolution with single-name attribute fallback, per-key drop reporting).
 */
function extractScopeFromMetricPrimary(
  metricViewData: MetricViewData,
  serviceIdsByName: Dictionary<string> | undefined,
): ExtractedPrimaryScope {
  const result: MetricCrossSignalScopeResult =
    buildCrossSignalScopeFromMetricViewData({
      metricViewData: metricViewData,
      serviceIdsByName: serviceIdsByName,
    });

  const attributes: Dictionary<CompanionScopeAttributeValue> = {};

  for (const key of Object.keys(result.scope.attributes || {})) {
    const value: string | undefined = (result.scope.attributes || {})[key];

    if (typeof value === "string" && value.length > 0) {
      attributes[key] = value;
    }
  }

  return {
    serviceIds: [...(result.scope.serviceIds || [])],
    entityKeys: [],
    attributes: attributes,
    severityTexts: [...(result.scope.severityTexts || [])],
    notCarried: [...result.droppedFilterKeys],
  };
}

function hasAnyAttributes(
  attributes: Dictionary<CompanionScopeAttributeValue>,
): boolean {
  return Object.keys(attributes).length > 0;
}

function buildLogsCompanion(
  scope: ExtractedPrimaryScope,
  window: InBetween<Date>,
): CompanionLogsSpec {
  const logQuery: Record<string, unknown> = {
    time: new InBetween<Date>(window.startValue, window.endValue),
  };

  if (hasAnyAttributes(scope.attributes)) {
    logQuery["attributes"] = { ...scope.attributes };
  }

  if (scope.entityKeys.length > 0) {
    logQuery["entityKeys"] = new Includes([...scope.entityKeys]);
  }

  if (scope.severityTexts.length > 0) {
    const canonicalSeverities: Array<string> = [];

    for (const severity of scope.severityTexts) {
      pushUniqueLabel(
        canonicalSeverities,
        LOG_SEVERITY_CANONICAL[severity.toLowerCase()] || severity,
      );
    }

    logQuery["severityText"] = new Includes(canonicalSeverities);
  }

  return {
    serviceIds: [...scope.serviceIds],
    logQuery: logQuery as Query<Log>,
    notCarried: [...scope.notCarried],
  };
}

function buildTracesCompanion(
  scope: ExtractedPrimaryScope,
  window: InBetween<Date>,
): CompanionTracesSpec {
  const spanQuery: Record<string, unknown> = {
    startTime: new InBetween<Date>(window.startValue, window.endValue),
  };

  if (scope.serviceIds.length > 0) {
    spanQuery["primaryEntityId"] = new Includes([...scope.serviceIds]);
  }

  if (hasAnyAttributes(scope.attributes)) {
    spanQuery["attributes"] = { ...scope.attributes };
  }

  if (scope.entityKeys.length > 0) {
    spanQuery["entityKeys"] = new Includes([...scope.entityKeys]);
  }

  const notCarried: Array<string> = [...scope.notCarried];

  if (scope.severityTexts.length > 0) {
    // Spans have no severity dimension.
    pushUniqueLabel(notCarried, SEVERITY_NOT_CARRIED_LABEL);
  }

  return {
    spanQuery: spanQuery as Query<Span>,
    notCarried: notCarried,
  };
}

function buildExceptionsCompanion(
  scope: ExtractedPrimaryScope,
  window: InBetween<Date>,
): CompanionExceptionsSpec {
  const exceptionQuery: Record<string, unknown> = {
    time: new InBetween<Date>(window.startValue, window.endValue),
  };

  if (scope.serviceIds.length > 0) {
    exceptionQuery["primaryEntityId"] = new Includes([...scope.serviceIds]);
  }

  if (hasAnyAttributes(scope.attributes)) {
    exceptionQuery["attributes"] = { ...scope.attributes };
  }

  if (scope.entityKeys.length > 0) {
    exceptionQuery["entityKeys"] = new Includes([...scope.entityKeys]);
  }

  const notCarried: Array<string> = [...scope.notCarried];

  if (scope.severityTexts.length > 0) {
    // Exceptions have no log-severity dimension.
    pushUniqueLabel(notCarried, SEVERITY_NOT_CARRIED_LABEL);
  }

  return {
    exceptionQuery: exceptionQuery as Query<ExceptionInstance>,
    notCarried: notCarried,
  };
}

function buildMetricsCompanion(
  scope: ExtractedPrimaryScope,
  window: InBetween<Date>,
): CompanionMetricsSpec {
  const notCarried: Array<string> = [...scope.notCarried];

  if (scope.severityTexts.length > 0) {
    // Metrics have no severity dimension.
    pushUniqueLabel(notCarried, SEVERITY_NOT_CARRIED_LABEL);
  }

  return {
    serviceIds: [...scope.serviceIds],
    entityKeys: [...scope.entityKeys],
    attributes: { ...scope.attributes },
    window: new InBetween<Date>(window.startValue, window.endValue),
    notCarried: notCarried,
  };
}

export interface DeriveCompanionSignalQueriesInput {
  telemetryQuery: TelemetryQuery | null | undefined;
  snapshotWindow: InBetween<Date> | null | undefined;
  /*
   * Service NAME -> Service ObjectID string mapping for Metric primaries
   * (their scope names services through the `resource.service.name`
   * attribute — see MetricsCrossSignalPivot.resolveServiceIdsByNames).
   * Optional: while unresolved, a single service name degrades to a
   * verbatim attribute filter instead of an id scope.
   */
  serviceIdsByName?: Dictionary<string> | undefined;
}

type DeriveCompanionSignalQueriesFunction = (
  input: DeriveCompanionSignalQueriesInput,
) => CompanionSignalQueries;

/**
 * Map the stored telemetry query's scope plus the pinned snapshot window
 * into the other three pillars' query/prop specs. The primary's own pillar
 * is null (it renders through the page's existing single-signal block);
 * everything null means "render no companion tabs".
 */
export const deriveCompanionSignalQueries: DeriveCompanionSignalQueriesFunction =
  (input: DeriveCompanionSignalQueriesInput): CompanionSignalQueries => {
    const telemetryQuery: TelemetryQuery | null | undefined =
      input.telemetryQuery;

    if (!telemetryQuery || typeof telemetryQuery !== "object") {
      return NO_COMPANIONS;
    }

    const primaryType: TelemetryType = telemetryQuery.telemetryType;

    if (
      primaryType !== TelemetryType.Log &&
      primaryType !== TelemetryType.Trace &&
      primaryType !== TelemetryType.Metric &&
      primaryType !== TelemetryType.Exception
    ) {
      return NO_COMPANIONS;
    }

    /*
     * Re-coerce defensively: the page hands over the already-hydrated
     * window, but a caller holding the raw stored shape (ISO-string
     * bounds) must work too, and an unparseable window means the pin is
     * unknown — no companions rather than a rolling default.
     */
    const window: InBetween<Date> | null = TelemetryQueryTimeRange.toDateWindow(
      input.snapshotWindow,
    );

    if (!window) {
      return NO_COMPANIONS;
    }

    let scope: ExtractedPrimaryScope;

    if (primaryType === TelemetryType.Metric) {
      const metricViewData: MetricViewData | null =
        telemetryQuery.metricViewData;

      if (
        !metricViewData ||
        typeof metricViewData !== "object" ||
        !Array.isArray(metricViewData.queryConfigs)
      ) {
        // Malformed metric scope — unknowable, so widen nothing.
        return NO_COMPANIONS;
      }

      scope = extractScopeFromMetricPrimary(
        metricViewData,
        input.serviceIdsByName,
      );
    } else {
      const primaryQuery: unknown = telemetryQuery.telemetryQuery;

      if (!isPlainRecord(primaryQuery)) {
        // Missing or malformed stored query — same rule.
        return NO_COMPANIONS;
      }

      scope = extractScopeFromPrimaryQuery(primaryQuery);
    }

    return {
      primaryType: primaryType,
      logs:
        primaryType === TelemetryType.Log
          ? null
          : buildLogsCompanion(scope, window),
      traces:
        primaryType === TelemetryType.Trace
          ? null
          : buildTracesCompanion(scope, window),
      metrics:
        primaryType === TelemetryType.Metric
          ? null
          : buildMetricsCompanion(scope, window),
      exceptions:
        primaryType === TelemetryType.Exception
          ? null
          : buildExceptionsCompanion(scope, window),
    };
  };

type GetCompanionMetricScopeServiceNamesFunction = (
  telemetryQuery: TelemetryQuery | null | undefined,
) => Array<string>;

/**
 * The service NAMES a Metric primary scopes by (its
 * `resource.service.name` equality filters) — the input for
 * resolveServiceIdsByNames. Empty for every other primary type, whose
 * scope already carries service ids.
 */
export const getCompanionMetricScopeServiceNames: GetCompanionMetricScopeServiceNamesFunction =
  (telemetryQuery: TelemetryQuery | null | undefined): Array<string> => {
    if (
      !telemetryQuery ||
      telemetryQuery.telemetryType !== TelemetryType.Metric ||
      !telemetryQuery.metricViewData ||
      !Array.isArray(telemetryQuery.metricViewData.queryConfigs)
    ) {
      return [];
    }

    return extractScopeFiltersFromQueryConfigs(
      telemetryQuery.metricViewData.queryConfigs,
    ).serviceNames;
  };

/** Fixed pillar order; the primary tab is hoisted to the front. */
export const TELEMETRY_SNAPSHOT_TAB_ORDER: Array<TelemetryType> = [
  TelemetryType.Log,
  TelemetryType.Trace,
  TelemetryType.Metric,
  TelemetryType.Exception,
];

type GetTelemetrySnapshotTabOrderFunction = (
  primaryType: TelemetryType | null,
) => Array<TelemetryType>;

export const getTelemetrySnapshotTabOrder: GetTelemetrySnapshotTabOrderFunction =
  (primaryType: TelemetryType | null): Array<TelemetryType> => {
    if (!primaryType || !TELEMETRY_SNAPSHOT_TAB_ORDER.includes(primaryType)) {
      return [...TELEMETRY_SNAPSHOT_TAB_ORDER];
    }

    return [
      primaryType,
      ...TELEMETRY_SNAPSHOT_TAB_ORDER.filter(
        (telemetryType: TelemetryType): boolean => {
          return telemetryType !== primaryType;
        },
      ),
    ];
  };

type BuildCompanionMetricNameQueryFunction = (input: {
  spec: CompanionMetricsSpec;
  projectId: ObjectID;
}) => Query<Metric>;

/**
 * The GROUP-BY-name discovery query for the metrics companion tab: which
 * metric names exist inside the primary's scope during the snapshot
 * window. Same shape MetricsViewer's entity-scoped name match uses.
 */
export const buildCompanionMetricNameQuery: BuildCompanionMetricNameQueryFunction =
  (input: {
    spec: CompanionMetricsSpec;
    projectId: ObjectID;
  }): Query<Metric> => {
    const query: Record<string, unknown> = {
      projectId: input.projectId,
      time: new InBetween<Date>(
        input.spec.window.startValue,
        input.spec.window.endValue,
      ),
    };

    if (input.spec.serviceIds.length > 0) {
      query["primaryEntityId"] = new Includes([...input.spec.serviceIds]);
    }

    if (input.spec.entityKeys.length > 0) {
      query["entityKeys"] = new Includes([...input.spec.entityKeys]);
    }

    if (hasAnyAttributes(input.spec.attributes)) {
      query["attributes"] = { ...input.spec.attributes };
    }

    return query as Query<Metric>;
  };

/** Cap on companion charts — each one costs an aggregate call. */
export const MAX_COMPANION_METRIC_CHARTS: number = 4;

export interface CompanionMetricChartPlan {
  queryConfigs: Array<MetricQueryConfigData>;
  /*
   * Scope aspects the CHARTS cannot honor even though the name list did
   * (MetricView's filterData has no service-id or entity-key dimension) —
   * surfaced as a hint, never dropped silently.
   */
  chartScopeNotes: Array<string>;
  /** How many discovered metric names did not fit under the chart cap. */
  omittedMetricCount: number;
}

type BuildCompanionMetricChartPlanFunction = (input: {
  metricNames: Array<string>;
  /*
   * Resolved service NAMES for the spec's serviceIds — chart values are
   * scoped through the `resource.service.name` attribute because
   * MetricView's filterData cannot filter by primaryEntityId.
   */
  serviceNames: Array<string>;
  spec: CompanionMetricsSpec;
  maxCharts?: number | undefined;
}) => CompanionMetricChartPlan;

export const buildCompanionMetricChartPlan: BuildCompanionMetricChartPlanFunction =
  (input: {
    metricNames: Array<string>;
    serviceNames: Array<string>;
    spec: CompanionMetricsSpec;
    maxCharts?: number | undefined;
  }): CompanionMetricChartPlan => {
    const maxCharts: number = input.maxCharts || MAX_COMPANION_METRIC_CHARTS;

    const uniqueNames: Array<string> = [];

    for (const metricName of input.metricNames || []) {
      if (typeof metricName === "string" && metricName.trim().length > 0) {
        pushUniqueLabel(uniqueNames, metricName.trim());
      }
    }

    uniqueNames.sort();

    const chartNames: Array<string> = uniqueNames.slice(0, maxCharts);
    const chartScopeNotes: Array<string> = [];

    const chartAttributes: Dictionary<CompanionScopeAttributeValue | Includes> =
      { ...input.spec.attributes };

    const serviceNames: Array<string> = [];

    for (const serviceName of input.serviceNames || []) {
      if (typeof serviceName === "string" && serviceName.trim().length > 0) {
        pushUniqueLabel(serviceNames, serviceName.trim());
      }
    }

    if (serviceNames.length === 1) {
      chartAttributes[SERVICE_NAME_ATTRIBUTE_KEY] = serviceNames[0]!;
    } else if (serviceNames.length > 1) {
      chartAttributes[SERVICE_NAME_ATTRIBUTE_KEY] = new Includes(serviceNames);
    } else if (input.spec.serviceIds.length > 0) {
      pushUniqueLabel(
        chartScopeNotes,
        "chart values are not narrowed to the service (service name could not be resolved)",
      );
    }

    if (input.spec.entityKeys.length > 0) {
      pushUniqueLabel(
        chartScopeNotes,
        "the entity-key scope narrows the metric list, not the chart values",
      );
    }

    const queryConfigs: Array<MetricQueryConfigData> = chartNames.map(
      (metricName: string): MetricQueryConfigData => {
        return {
          metricAliasData: {
            metricVariable: metricName,
            title: metricName,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: metricName,
              attributes: { ...chartAttributes },
              aggegationType: MetricsAggregationType.Avg,
            },
          },
        };
      },
    );

    return {
      queryConfigs: queryConfigs,
      chartScopeNotes: chartScopeNotes,
      omittedMetricCount: Math.max(0, uniqueNames.length - chartNames.length),
    };
  };
