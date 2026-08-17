import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Service from "Common/Models/DatabaseModels/Service";
/*
 * Sibling-relative on purpose: the `Common` package specifier resolves
 * through App/node_modules, which may symlink a checkout that predates
 * this module; the relative path always resolves the sibling source this
 * branch ships with (identical to the specifier once merged).
 */
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "../../../../../Common/Utils/Telemetry/CrossSignalScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import {
  DictionaryFilterOperator,
  detectOperatorFromValue,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

// Re-exported so consumers type against the pivot util's own surface.
export type { CrossSignalQueryParams, TelemetryCrossSignalScope };

/*
 * Cross-signal pivots FROM the metrics surfaces: turn the metric
 * explorer's active view (and an exemplar dot on a chart) into a
 * TelemetryCrossSignalScope that the shared serializers
 * (Common/Utils/Telemetry/CrossSignalScope) translate into
 * equivalently-scoped Logs / Traces explorer URLs.
 *
 * Everything here except resolveServiceIdsByNames is pure so
 * App/Tests/Dashboard can exercise it without a renderer; the resolver's
 * network seam (ModelAPI.getList) is mocked in tests the same way
 * DeviceMonitorLookupUtil's is.
 */

/*
 * The service resource attribute the metric pipeline stores at ingest and
 * the Service view scopes by (Pages/Service/View/Metrics.tsx). An equality
 * filter on this key names a Service, so the pivot resolves the name to
 * its ObjectID — the value the logs/traces `primaryEntityId` column
 * actually stores — instead of passing the name through verbatim.
 */
export const SERVICE_NAME_ATTRIBUTE_KEY: string = "resource.service.name";

/*
 * The one attribute key whose equality values are carried as log severity
 * scope. It matches the logs table's own column name, so the value casing
 * flows through the serializer's severity canonicalization; other
 * severity-ish keys (monitor severities etc.) are NOT log severities and
 * pass through as plain attributes.
 */
export const SEVERITY_TEXT_ATTRIBUTE_KEY: string = "severityText";

/*
 * Window pad applied around an exemplar's timestamp when the host chart
 * has no resolvable window of its own — wide enough to catch the logs
 * emitted just before/after the sampled request without drowning them.
 */
export const EXEMPLAR_LOGS_FALLBACK_PAD_MS: number = 15 * 60 * 1000;

/**
 * The scope-relevant filters recovered from a set of metric query
 * configs. Attribute keys are verbatim; only exact-equality filters are
 * expressible in the cross-signal scope, so every filter that is not one
 * (non-equality operators, multi-value memberships on ordinary keys,
 * values that conflict across queries) lands in `droppedFilterKeys`
 * instead of being silently discarded.
 */
export interface MetricScopeFilterExtraction {
  attributes: Dictionary<string>;
  serviceNames: Array<string>;
  severityTexts: Array<string>;
  droppedFilterKeys: Array<string>;
}

type ExtractScopeFiltersFunction = (
  queryConfigs: Array<MetricQueryConfigData>,
) => MetricScopeFilterExtraction;

export const extractScopeFiltersFromQueryConfigs: ExtractScopeFiltersFunction =
  (queryConfigs: Array<MetricQueryConfigData>): MetricScopeFilterExtraction => {
    /*
     * Equality values per key, across ALL queries. One value → carry it;
     * several distinct values → the single-valued scope grammar cannot
     * express the disjunction, so the key is reported dropped.
     */
    const equalityValuesByKey: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    const keyOrder: Array<string> = [];

    const serviceNames: Array<string> = [];
    const severityTexts: Array<string> = [];
    const droppedFilterKeys: Array<string> = [];

    const pushUnique: (values: Array<string>, value: string) => void = (
      values: Array<string>,
      value: string,
    ): void => {
      if (value.length > 0 && !values.includes(value)) {
        values.push(value);
      }
    };

    for (const queryConfig of queryConfigs || []) {
      const attributes: Dictionary<unknown> | undefined = queryConfig
        ?.metricQueryData?.filterData?.attributes as
        | Dictionary<unknown>
        | undefined;

      if (!attributes || typeof attributes !== "object") {
        continue;
      }

      for (const key of Object.keys(attributes)) {
        const value: unknown = attributes[key];

        if (key.trim() === "" || value === undefined || value === null) {
          continue;
        }

        const detected: {
          operator: DictionaryFilterOperator;
          rawValue: string;
          rawValues?: Array<string> | undefined;
        } = detectOperatorFromValue(value);

        /*
         * The multi-value keys (service / severity) are Array-shaped in
         * the scope, so an IsAnyOf membership carries over losslessly;
         * ordinary keys can only carry a single equality value.
         */
        const isServiceKey: boolean = key === SERVICE_NAME_ATTRIBUTE_KEY;
        const isSeverityKey: boolean = key === SEVERITY_TEXT_ATTRIBUTE_KEY;

        if (detected.operator === DictionaryFilterOperator.EqualTo) {
          const equalityValue: string = detected.rawValue.trim();
          if (equalityValue === "") {
            continue;
          }
          if (isServiceKey) {
            pushUnique(serviceNames, equalityValue);
            continue;
          }
          if (isSeverityKey) {
            pushUnique(severityTexts, equalityValue);
            continue;
          }
          if (!equalityValuesByKey.has(key)) {
            equalityValuesByKey.set(key, new Set<string>());
            keyOrder.push(key);
          }
          equalityValuesByKey.get(key)!.add(equalityValue);
          continue;
        }

        if (detected.operator === DictionaryFilterOperator.IsAnyOf) {
          const memberValues: Array<string> = (detected.rawValues || []).filter(
            (memberValue: string): boolean => {
              return memberValue.trim() !== "";
            },
          );
          // An empty membership means "All" — it carries no scope at all.
          if (memberValues.length === 0) {
            continue;
          }
          if (isServiceKey) {
            for (const memberValue of memberValues) {
              pushUnique(serviceNames, memberValue.trim());
            }
            continue;
          }
          if (isSeverityKey) {
            for (const memberValue of memberValues) {
              pushUnique(severityTexts, memberValue.trim());
            }
            continue;
          }
          if (memberValues.length === 1) {
            const equalityValue: string = memberValues[0]!.trim();
            if (!equalityValuesByKey.has(key)) {
              equalityValuesByKey.set(key, new Set<string>());
              keyOrder.push(key);
            }
            equalityValuesByKey.get(key)!.add(equalityValue);
            continue;
          }
          pushUnique(droppedFilterKeys, key);
          continue;
        }

        // Every non-equality operator: not expressible as scope, report it.
        pushUnique(droppedFilterKeys, key);
      }
    }

    const attributes: Dictionary<string> = {};

    for (const key of keyOrder) {
      const values: Set<string> = equalityValuesByKey.get(key)!;
      if (values.size === 1) {
        attributes[key] = Array.from(values)[0]!;
      } else {
        // Conflicting equality values across queries — cannot carry both.
        pushUnique(droppedFilterKeys, key);
      }
    }

    return { attributes, serviceNames, severityTexts, droppedFilterKeys };
  };

export interface MetricCrossSignalScopeResult {
  scope: TelemetryCrossSignalScope;
  /*
   * Attribute keys the scope could not carry (non-equality operators,
   * conflicting/multi-value equality, unresolvable multi-service names) —
   * merged with the serializer's own dropped[] by the pivot builders so
   * partially-carried scope is always surfaced, never silent.
   */
  droppedFilterKeys: Array<string>;
}

type BuildCrossSignalScopeFunction = (input: {
  metricViewData: MetricViewData;
  /*
   * Service name → Service ObjectID string mapping (see
   * resolveServiceIdsByNames). When every extracted service name resolves,
   * the scope carries `serviceIds`; otherwise the pivot degrades to
   * attribute passthrough (single name) or reports the key dropped
   * (several names — the single-valued attribute grammar cannot carry a
   * disjunction of names).
   */
  serviceIdsByName?: Dictionary<string> | undefined;
}) => MetricCrossSignalScopeResult;

export const buildCrossSignalScopeFromMetricViewData: BuildCrossSignalScopeFunction =
  (input: {
    metricViewData: MetricViewData;
    serviceIdsByName?: Dictionary<string> | undefined;
  }): MetricCrossSignalScopeResult => {
    const extraction: MetricScopeFilterExtraction =
      extractScopeFiltersFromQueryConfigs(
        input.metricViewData?.queryConfigs || [],
      );

    const attributes: Dictionary<string> = { ...extraction.attributes };
    const droppedFilterKeys: Array<string> = [...extraction.droppedFilterKeys];

    let serviceIds: Array<string> = [];

    if (extraction.serviceNames.length > 0) {
      const mapping: Dictionary<string> = input.serviceIdsByName || {};
      const resolvedIds: Array<string> = extraction.serviceNames
        .map((serviceName: string): string => {
          return mapping[serviceName] || "";
        })
        .filter((serviceId: string): boolean => {
          return serviceId !== "";
        });

      if (resolvedIds.length === extraction.serviceNames.length) {
        serviceIds = resolvedIds;
      } else if (extraction.serviceNames.length === 1) {
        // Resolution unavailable — carry the name as a verbatim attribute.
        attributes[SERVICE_NAME_ATTRIBUTE_KEY] = extraction.serviceNames[0]!;
      } else if (!droppedFilterKeys.includes(SERVICE_NAME_ATTRIBUTE_KEY)) {
        droppedFilterKeys.push(SERVICE_NAME_ATTRIBUTE_KEY);
      }
    }

    /*
     * The explorer resolves relative tokens into startAndEndDate before
     * this runs, but windows restored from stored snapshots hold ISO
     * strings — coerce through the shared helper instead of trusting
     * `instanceof Date` (same pitfall MetricCharts' exemplar effect hit).
     */
    const window: InBetween<Date> | null = TelemetryQueryTimeRange.toDateWindow(
      input.metricViewData?.startAndEndDate,
    );

    const scope: TelemetryCrossSignalScope = {};

    if (Object.keys(attributes).length > 0) {
      scope.attributes = attributes;
    }

    if (serviceIds.length > 0) {
      scope.serviceIds = serviceIds;
    }

    if (extraction.severityTexts.length > 0) {
      scope.severityTexts = extraction.severityTexts;
    }

    if (window) {
      scope.startTime = window.startValue;
      scope.endTime = window.endValue;
    }

    return { scope, droppedFilterKeys };
  };

/*
 * One resolution result per distinct name set, so pivoting to Logs and
 * then Traces from the same view costs a single lookup. Failures are
 * intentionally NOT cached — the next pivot retries.
 */
const serviceIdsByNameCache: Map<string, Dictionary<string>> = new Map<
  string,
  Dictionary<string>
>();

type ResolveServiceIdsByNamesFunction = (
  serviceNames: Array<string>,
) => Promise<Dictionary<string>>;

/**
 * Resolve service NAMES (the `resource.service.name` attribute values) to
 * Service ObjectID strings via one list call. Best-effort: any failure —
 * no project, network error — returns an empty mapping so callers degrade
 * to attribute passthrough instead of blocking the pivot.
 */
export const resolveServiceIdsByNames: ResolveServiceIdsByNamesFunction =
  async (serviceNames: Array<string>): Promise<Dictionary<string>> => {
    const uniqueNames: Array<string> = [];

    for (const serviceName of serviceNames || []) {
      if (
        typeof serviceName === "string" &&
        serviceName.trim() !== "" &&
        !uniqueNames.includes(serviceName)
      ) {
        uniqueNames.push(serviceName);
      }
    }

    if (uniqueNames.length === 0) {
      return {};
    }

    const cacheKey: string = JSON.stringify([...uniqueNames].sort());
    const cached: Dictionary<string> | undefined =
      serviceIdsByNameCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return {};
      }

      const query: Query<Service> = { projectId: projectId } as Query<Service>;
      (query as Record<string, unknown>)["name"] = new Includes(uniqueNames);

      const result: ListResult<Service> = await ModelAPI.getList<Service>({
        modelType: Service,
        query: query,
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      const mapping: Dictionary<string> = {};

      for (const service of result.data || []) {
        const name: string = service.name?.toString() || "";
        const id: string = service.id?.toString() || "";
        if (name !== "" && id !== "") {
          mapping[name] = id;
        }
      }

      serviceIdsByNameCache.set(cacheKey, mapping);

      return mapping;
    } catch {
      return {};
    }
  };

export type CrossSignalPivotTarget = "logs" | "traces";

type BuildMetricExplorerPivotParamsFunction = (input: {
  target: CrossSignalPivotTarget;
  metricViewData: MetricViewData;
  serviceIdsByName?: Dictionary<string> | undefined;
}) => CrossSignalQueryParams;

/**
 * Full pivot translation for the metric explorer's Logs / Traces buttons:
 * scope construction plus the target serializer, with the two dropped
 * lists (scope-construction + serializer) merged. Formula and group-by
 * aspects have no filter representation and degrade to window+attributes
 * without an entry here.
 */
export const buildMetricExplorerPivotParams: BuildMetricExplorerPivotParamsFunction =
  (input: {
    target: CrossSignalPivotTarget;
    metricViewData: MetricViewData;
    serviceIdsByName?: Dictionary<string> | undefined;
  }): CrossSignalQueryParams => {
    const { scope, droppedFilterKeys }: MetricCrossSignalScopeResult =
      buildCrossSignalScopeFromMetricViewData({
        metricViewData: input.metricViewData,
        serviceIdsByName: input.serviceIdsByName,
      });

    const serialized: CrossSignalQueryParams =
      input.target === "traces"
        ? toTracesExplorerQueryParams(scope)
        : toLogsExplorerQueryParams(scope);

    const dropped: Array<string> = [];

    for (const droppedField of [...droppedFilterKeys, ...serialized.dropped]) {
      if (!dropped.includes(droppedField)) {
        dropped.push(droppedField);
      }
    }

    return { params: serialized.params, dropped };
  };

export interface ExemplarLogsPivotInput {
  traceId: string;
  /*
   * The exemplar's own timestamp — the fallback window anchor when the
   * host chart has no resolvable window.
   */
  exemplarTime: Date;
  // The host chart's resolved window (preferred pad around the exemplar).
  chartWindow: InBetween<Date> | null;
}

type BuildExemplarLogsPivotParamsFunction = (
  input: ExemplarLogsPivotInput,
) => CrossSignalQueryParams;

/**
 * Logs-explorer params for one exemplar dot: the exemplar's trace plus a
 * time window around it — the chart's own window when it resolves, else
 * EXEMPLAR_LOGS_FALLBACK_PAD_MS on both sides of the exemplar timestamp.
 */
export const buildExemplarLogsPivotParams: BuildExemplarLogsPivotParamsFunction =
  (input: ExemplarLogsPivotInput): CrossSignalQueryParams => {
    const chartWindow: InBetween<Date> | null =
      TelemetryQueryTimeRange.toDateWindow(input.chartWindow);

    let startTime: Date | undefined = chartWindow?.startValue;
    let endTime: Date | undefined = chartWindow?.endValue;

    if (
      (!startTime || !endTime) &&
      input.exemplarTime instanceof Date &&
      !isNaN(input.exemplarTime.getTime())
    ) {
      startTime = new Date(
        input.exemplarTime.getTime() - EXEMPLAR_LOGS_FALLBACK_PAD_MS,
      );
      endTime = new Date(
        input.exemplarTime.getTime() + EXEMPLAR_LOGS_FALLBACK_PAD_MS,
      );
    }

    const scope: TelemetryCrossSignalScope = {
      traceIds: [input.traceId],
      startTime,
      endTime,
    };

    return toLogsExplorerQueryParams(scope);
  };

type GetExemplarTraceQueryParamsFunction = (exemplar: {
  spanId?: string | undefined;
}) => Dictionary<string>;

/**
 * Query params for the exemplar's trace-view deep link (the route itself
 * carries the traceId as modelId). Present only when the exemplar sampled
 * a specific span.
 */
export const getExemplarTraceQueryParams: GetExemplarTraceQueryParamsFunction =
  (exemplar: { spanId?: string | undefined }): Dictionary<string> => {
    if (exemplar.spanId && exemplar.spanId.trim() !== "") {
      return { spanId: exemplar.spanId };
    }
    return {};
  };

/*
 * Friendly labels for the scope FIELD names the serializers report in
 * dropped[]. Attribute keys (from droppedFilterKeys) are already
 * user-facing and pass through verbatim.
 */
const DROPPED_FIELD_LABELS: Dictionary<string> = {
  serviceIds: "service",
  traceIds: "trace ID",
  spanIds: "span ID",
  severityTexts: "severity",
  startTime: "time window",
  endTime: "time window",
};

type FormatDroppedScopeHintFunction = (dropped: Array<string>) => string;

/**
 * One short sentence naming what a pivot could not carry over — empty
 * string when nothing was dropped (callers then show no hint at all).
 */
export const formatDroppedScopeHint: FormatDroppedScopeHintFunction = (
  dropped: Array<string>,
): string => {
  const labels: Array<string> = [];

  for (const droppedField of dropped || []) {
    if (typeof droppedField !== "string" || droppedField.trim() === "") {
      continue;
    }
    const label: string = DROPPED_FIELD_LABELS[droppedField] || droppedField;
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }

  if (labels.length === 0) {
    return "";
  }

  return `Not carried over: ${labels.join(", ")}.`;
};
