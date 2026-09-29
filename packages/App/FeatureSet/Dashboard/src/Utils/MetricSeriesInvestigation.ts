import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { canonicalizeEntityValue } from "Common/Utils/Telemetry/EntityKey";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  CrossSignalQueryParams,
  extractScopeFiltersFromQueryConfigs,
  MetricScopeFilterExtraction,
  resolveServiceIdsByNames,
} from "./MetricsCrossSignalPivot";

/*
 * A route parameter sourced from telemetry must be a well-formed UUID.
 * Named const (not inline) to sidestep the wrap-regex vs prettier
 * circular-fix conflict.
 */
const UUID_ROUTE_PARAM: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/*
 * Per-SERIES investigation for grouped metric charts: the machinery that
 * turns one series of a group-by chart ("host.name=prod-01, cpu=3") back
 * into structured scope — the exact attribute filters that isolate that
 * series, the telemetry pivots carrying them, and the OneUptime resource
 * page (host / service / cluster / device) the series is about.
 *
 * Everything except the resolve* functions is pure so App/Tests/Dashboard
 * can exercise it without a renderer; the resolvers' network seam
 * (ModelAPI.getList) is mocked in tests the same way
 * MetricsCrossSignalPivot's is.
 */

/*
 * Split a composed grouped-series name back into its "key=value" segments,
 * using the known group keys so it stays correct when a value itself
 * contains the ", " that also joins multi-key segments. A single-key
 * group-by has exactly one segment (the whole name), so a comma in the
 * value can never be mis-split. For multi-key names, a fragment that
 * doesn't start with a known "key=" prefix is treated as a continuation of
 * the previous value. (Moved here from MetricCharts so label parsing and
 * the chart's color pins share one splitter.)
 */
export function splitSeriesNameIntoSegments(
  seriesName: string,
  groupByKeys: Array<string>,
): Array<string> {
  if (groupByKeys.length <= 1) {
    return [seriesName];
  }
  const startsWithKnownKey: (fragment: string) => boolean = (
    fragment: string,
  ): boolean => {
    return groupByKeys.some((key: string): boolean => {
      return fragment.startsWith(`${key}=`);
    });
  };
  const segments: Array<string> = [];
  for (const fragment of seriesName.split(", ")) {
    if (segments.length > 0 && !startsWithKnownKey(fragment)) {
      segments[segments.length - 1] += `, ${fragment}`;
    } else {
      segments.push(fragment);
    }
  }
  return segments;
}

/**
 * Recover the group-by labels from a composed series name. Returns one
 * entry per "key=value" segment whose key is a known group-by key; the
 * "(unset)" display value maps back to "" so MetricSeriesScope turns it
 * into the is-empty filter rather than an equality against the literal
 * text "(unset)". Segments that match no known key (e.g. an overlay
 * panel's "queryLabel: " disambiguation prefix) are skipped — fewer
 * labels just means a wider scope, never a wrong one.
 */
export function parseSeriesLabels(input: {
  seriesName: string;
  groupByKeys: Array<string>;
}): JSONObject {
  const labels: JSONObject = {};

  if (input.groupByKeys.length === 0) {
    return labels;
  }

  const segments: Array<string> = splitSeriesNameIntoSegments(
    input.seriesName,
    input.groupByKeys,
  );

  for (const segment of segments) {
    for (const key of input.groupByKeys) {
      if (!key || !segment.startsWith(`${key}=`)) {
        continue;
      }
      const value: string = segment.slice(key.length + 1);
      labels[key] =
        value === MetricSeriesScope.UnsetLabelDisplayValue ? "" : value;
      break;
    }
  }

  return labels;
}

/** Union of every query's group-by keys, in first-seen order. */
export function getGroupByKeysForViewData(
  metricViewData: MetricViewData,
): Array<string> {
  const keys: Array<string> = [];
  for (const queryConfig of metricViewData?.queryConfigs || []) {
    for (const key of queryConfig.metricQueryData?.groupByAttributeKeys || []) {
      if (key && !keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

export interface SeriesScopedViewData {
  scopedViewData: MetricViewData;
  seriesLabels: JSONObject;
  /** False when the name yielded no usable labels (nothing was narrowed). */
  didNarrow: boolean;
}

/**
 * Narrow a whole metric view down to the one series the user picked, by
 * parsing the series name back into group-by labels and pushing them into
 * each query's attribute filters (via MetricSeriesScope, which only
 * touches keys a query actually groups by). Identity-preserving when
 * there is nothing to narrow.
 */
export function scopeViewDataToSeries(input: {
  metricViewData: MetricViewData;
  seriesName: string;
  /** Panel-accurate group keys; defaults to the view-wide union. */
  groupByKeys?: Array<string> | undefined;
}): SeriesScopedViewData {
  const groupByKeys: Array<string> =
    input.groupByKeys && input.groupByKeys.length > 0
      ? input.groupByKeys
      : getGroupByKeysForViewData(input.metricViewData);

  const seriesLabels: JSONObject = parseSeriesLabels({
    seriesName: input.seriesName,
    groupByKeys,
  });

  const scopedViewData: MetricViewData =
    (MetricSeriesScope.scopeMetricViewDataToSeries({
      metricViewData: input.metricViewData,
      seriesLabels,
    }) as MetricViewData) || input.metricViewData;

  return {
    scopedViewData,
    seriesLabels,
    didNarrow: scopedViewData !== input.metricViewData,
  };
}

export type SeriesResourceTargetKind =
  | "host"
  | "service"
  | "kubernetesCluster"
  | "networkDevice";

export interface SeriesResourceTarget {
  kind: SeriesResourceTargetKind;
  /** Menu label, e.g. `Open host "prod-01"`. */
  label: string;
  attributeKey: string;
  attributeValue: string;
}

/*
 * Attribute keys that name a OneUptime resource, per kind. The resource
 * attribute spellings ("resource.host.name") are what the metric pipeline
 * stores at ingest; the bare spellings cover agents and hostmetrics
 * receivers that tag without the resource prefix.
 */
const HOST_ATTRIBUTE_KEYS: Array<string> = [
  "resource.host.name",
  "host.name",
  "host",
  "hostname",
];
const SERVICE_ATTRIBUTE_KEYS: Array<string> = [
  "resource.service.name",
  "service.name",
  "service",
];
const KUBERNETES_CLUSTER_ATTRIBUTE_KEYS: Array<string> = [
  "resource.k8s.cluster.name",
  "k8s.cluster.name",
];
const NETWORK_DEVICE_ATTRIBUTE_KEYS: Array<string> = ["networkDeviceId"];

const TARGET_KEYS_BY_KIND: Array<{
  kind: SeriesResourceTargetKind;
  keys: Array<string>;
}> = [
  { kind: "host", keys: HOST_ATTRIBUTE_KEYS },
  { kind: "service", keys: SERVICE_ATTRIBUTE_KEYS },
  { kind: "kubernetesCluster", keys: KUBERNETES_CLUSTER_ATTRIBUTE_KEYS },
  { kind: "networkDevice", keys: NETWORK_DEVICE_ATTRIBUTE_KEYS },
];

function getTargetLabel(kind: SeriesResourceTargetKind, value: string): string {
  switch (kind) {
    case "host":
      return `Open host "${value}"`;
    case "service":
      return `Open service "${value}"`;
    case "kubernetesCluster":
      return `Open Kubernetes cluster "${value}"`;
    case "networkDevice":
      return "Open network device";
    default:
      return `Open "${value}"`;
  }
}

/**
 * The OneUptime resource pages a series can jump to. A series' own labels
 * win; when the series doesn't carry a kind, the queries' exact-equality
 * attribute FILTERS fill in (a per-host chart filtered on host.name=X is
 * about host X even though nothing groups by it). At most one target per
 * kind, in the key lists' precedence order.
 */
export function getSeriesResourceTargets(input: {
  seriesLabels: JSONObject;
  queryConfigs: Array<MetricQueryConfigData>;
}): Array<SeriesResourceTarget> {
  const extraction: MetricScopeFilterExtraction =
    extractScopeFiltersFromQueryConfigs(input.queryConfigs || []);

  const getValueForKey: (key: string) => string | null = (
    key: string,
  ): string | null => {
    const labelValue: unknown = (input.seriesLabels || {})[key];
    if (typeof labelValue === "string" && labelValue.trim() !== "") {
      return labelValue;
    }
    /*
     * The extractor peels resource.service.name equalities into
     * serviceNames rather than attributes — check both.
     */
    const filterValue: string | undefined = extraction.attributes[key];
    if (typeof filterValue === "string" && filterValue.trim() !== "") {
      return filterValue;
    }
    if (
      SERVICE_ATTRIBUTE_KEYS.includes(key) &&
      extraction.serviceNames.length === 1
    ) {
      return extraction.serviceNames[0]!;
    }
    return null;
  };

  const targets: Array<SeriesResourceTarget> = [];

  for (const { kind, keys } of TARGET_KEYS_BY_KIND) {
    for (const key of keys) {
      const value: string | null = getValueForKey(key);
      if (value === null) {
        continue;
      }
      targets.push({
        kind,
        label: getTargetLabel(kind, value),
        attributeKey: key,
        attributeValue: value,
      });
      break;
    }
  }

  return targets;
}

/**
 * Exceptions-list params for a (series-scoped) metric view. The
 * exceptions grammar (ExceptionsViewer.readInitialUrlState) has service +
 * window dimensions but no attribute facets, so everything else is
 * reported in `dropped` — same contract as the CrossSignalScope
 * serializers. `status=all` keeps resolved/archived groups visible on
 * arrival (the spike may already be triaged).
 */
export function buildSeriesExceptionsPivotParams(input: {
  metricViewData: MetricViewData;
  serviceIds: Array<string>;
}): CrossSignalQueryParams {
  const params: Dictionary<string> = { status: "all" };
  const dropped: Array<string> = [];

  const serviceIds: Array<string> = (input.serviceIds || []).filter(
    (serviceId: string): boolean => {
      return typeof serviceId === "string" && serviceId.trim() !== "";
    },
  );

  if (serviceIds.length > 0) {
    params["filters"] = JSON.stringify(
      serviceIds.map((serviceId: string): [string, string] => {
        return ["primaryEntityId", serviceId];
      }),
    );
  }

  const window: InBetween<Date> | null = TelemetryQueryTimeRange.toDateWindow(
    input.metricViewData?.startAndEndDate,
  );

  if (window) {
    params["range"] = TimeRange.CUSTOM;
    params["start"] = OneUptimeDate.toString(window.startValue);
    params["end"] = OneUptimeDate.toString(window.endValue);
  }

  const extraction: MetricScopeFilterExtraction =
    extractScopeFiltersFromQueryConfigs(
      input.metricViewData?.queryConfigs || [],
    );

  for (const key of Object.keys(extraction.attributes)) {
    if (!dropped.includes(key)) {
      dropped.push(key);
    }
  }
  for (const key of extraction.droppedFilterKeys) {
    if (!dropped.includes(key)) {
      dropped.push(key);
    }
  }
  if (extraction.severityTexts.length > 0) {
    dropped.push("severityTexts");
  }
  if (extraction.serviceNames.length > 0 && serviceIds.length === 0) {
    dropped.push("serviceIds");
  }

  return { params, dropped };
}

/*
 * One resolution per distinct successful lookup, so reopening the menu
 * costs nothing. Failures are intentionally NOT cached — the next click
 * retries.
 */
const resolvedIdCache: Map<string, string | null> = new Map<
  string,
  string | null
>();

type LookupModelIdFunction = (input: {
  cacheKey: string;
  modelType: typeof Host | typeof KubernetesCluster;
  query: Query<Host> | Query<KubernetesCluster>;
}) => Promise<string | null>;

const lookupModelId: LookupModelIdFunction = async (input: {
  cacheKey: string;
  modelType: typeof Host | typeof KubernetesCluster;
  query: Query<Host> | Query<KubernetesCluster>;
}): Promise<string | null> => {
  if (resolvedIdCache.has(input.cacheKey)) {
    return resolvedIdCache.get(input.cacheKey) ?? null;
  }

  try {
    const result: ListResult<Host | KubernetesCluster> = await ModelAPI.getList<
      Host | KubernetesCluster
    >({
      modelType: input.modelType as typeof Host,
      query: input.query as Query<Host>,
      select: { _id: true },
      sort: {},
      skip: 0,
      limit: 1,
    });

    const id: string | undefined = result.data[0]?._id;
    if (!id) {
      return null;
    }
    resolvedIdCache.set(input.cacheKey, id);
    return id;
  } catch {
    return null;
  }
};

/**
 * Resolve a series resource target to the ObjectID string its view route
 * needs. Best-effort: unknown names and network failures return null so
 * the caller can say "no matching host" instead of navigating nowhere.
 *
 * Host rows store a CANONICALIZED identifier (trimmed, lowercased
 * `host.name` — HostService canonicalizes on write), so the host lookup
 * canonicalizes the same way. Kubernetes rows store `clusterIdentifier`
 * VERBATIM (KubernetesClusterService keeps the stored casing as-is), so
 * the cluster lookup only trims. Services store verbatim names and go
 * through the shared (cached) service resolver. Network devices carry
 * their own ObjectID in the attribute value (validated before use as a
 * route parameter).
 */
export async function resolveSeriesResourceModelId(
  target: SeriesResourceTarget,
): Promise<string | null> {
  const value: string = (target.attributeValue || "").trim();
  if (value === "") {
    return null;
  }

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  switch (target.kind) {
    case "host": {
      if (!projectId) {
        return null;
      }
      const hostIdentifier: string = canonicalizeEntityValue(value);
      return lookupModelId({
        cacheKey: `${projectId.toString()}:host:${hostIdentifier}`,
        modelType: Host,
        query: { projectId, hostIdentifier } as Query<Host>,
      });
    }
    case "kubernetesCluster": {
      if (!projectId) {
        return null;
      }
      const clusterIdentifier: string = value.trim();
      return lookupModelId({
        cacheKey: `${projectId.toString()}:k8s:${clusterIdentifier}`,
        modelType: KubernetesCluster,
        query: { projectId, clusterIdentifier } as Query<KubernetesCluster>,
      });
    }
    case "service": {
      const mapping: Dictionary<string> = await resolveServiceIdsByNames([
        value,
      ]);
      return mapping[value] || null;
    }
    case "networkDevice": {
      /*
       * The attribute value IS the device's ObjectID — but it arrives
       * from telemetry, so only a well-formed UUID may become a route
       * parameter.
       */
      return UUID_ROUTE_PARAM.test(value) ? value : null;
    }
    default:
      return null;
  }
}
