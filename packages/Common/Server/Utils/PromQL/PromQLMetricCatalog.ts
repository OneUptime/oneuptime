import MetricService from "../../Services/MetricService";
import MetricTypeService from "../../Services/MetricTypeService";
import TelemetryAttributeService from "../../Services/TelemetryAttributeService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { TelemetryServiceFilter } from "../Telemetry/TelemetryReadScope";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import logger from "../Logger";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { PROMQL_METRIC_NAME_LABEL } from "../../../Utils/PromQL/PromQLAst";
import {
  PromQLStoredMetric,
  prometheusSeriesNamesOf,
  toPrometheusFamilyName,
  toPrometheusUnit,
  toPromQLLabelName,
} from "../../../Utils/PromQL/PromQLMetricNames";
import { writeOwnValue } from "../../../Utils/LookupTable";

/*
 * What the Prometheus API's metadata endpoints answer without reading
 * series (issue #6796): the metric names a project has, the label names its
 * metrics carry, one label's values, and each metric's type and help.
 *
 * Names come from the metric catalog, read with the caller's own
 * permissions (MetricTypeService scopes it), and label names and values from
 * the attribute lookups the Metrics explorer uses, through the caller's
 * service scope.
 */

// Labels every metric can have besides its attributes.
const STRUCTURAL_LABELS: ReadonlyArray<string> = [
  PROMQL_METRIC_NAME_LABEL,
  "instance",
  "job",
  "le",
  "quantile",
];

const POINT_TYPES_CACHE_MS: number = 10 * 60 * 1000;

const pointTypesCache: Map<
  string,
  { pointTypes: Map<string, string>; expiresAt: number }
> = new Map();

/*
 * The point type of each of a project's histograms and summaries, from the
 * last hour, kept ten minutes. Everything else is a gauge or a sum, named
 * once; these are named with their _bucket, _count and _sum series. A slow
 * or failed read answers what it found: names, not errors.
 */
export const readHistogramPointTypes: (
  projectId: ObjectID,
) => Promise<Map<string, string>> = async (
  projectId: ObjectID,
): Promise<Map<string, string>> => {
  const key: string = projectId.toString();
  const cached:
    | { pointTypes: Map<string, string>; expiresAt: number }
    | undefined = pointTypesCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.pointTypes;
  }

  const pointTypes: Map<string, string> = new Map();

  try {
    /*
     * The point type is read as pointType, not by its column's name: the
     * WHERE below reads metricPointType too, and ClickHouse reads a name an
     * alias spells as the alias, so the WHERE would hold an aggregate and
     * every read would fail (ILLEGAL_AGGREGATION), naming no histogram.
     */
    const statement: Statement = SQL`SELECT name, any(metricPointType) AS pointType FROM ${AnalyticsTableName.Metric} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: new Date(Date.now() - 60 * 60 * 1000),
    }} AND metricPointType IN ('Histogram', 'ExponentialHistogram', 'Summary') GROUP BY name LIMIT ${{
      type: TableColumnType.Number,
      value: LIMIT_PER_PROJECT,
    }}`;
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 10,
        timeoutOverflowMode: "break",
        boundScanMemory: true,
      }),
    );

    const result: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = (response.data ||
      []) as unknown as Array<JSONObject>;

    for (const row of rows) {
      const name: unknown = row["name"];
      const pointType: unknown = row["pointType"];

      if (typeof name === "string" && typeof pointType === "string") {
        pointTypes.set(name, pointType);
      }
    }
  } catch (error: unknown) {
    logger.debug("PromQL: reading histogram point types failed");
    logger.debug(error);
  }

  if (pointTypesCache.size > 1000) {
    pointTypesCache.clear();
  }

  pointTypesCache.set(key, {
    pointTypes,
    expiresAt: Date.now() + POINT_TYPES_CACHE_MS,
  });

  return pointTypes;
};

const readCatalog: (
  projectId: ObjectID,
  props: DatabaseCommonInteractionProps,
) => Promise<Array<MetricType>> = async (
  projectId: ObjectID,
  props: DatabaseCommonInteractionProps,
): Promise<Array<MetricType>> => {
  return MetricTypeService.findBy({
    query: { projectId },
    select: { name: true, description: true, unit: true, isMonotonic: true },
    sort: { name: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props,
  });
};

// A catalog row as the metric it describes, its name as ingest stores it.
const toStoredMetric: (metricType: MetricType) => PromQLStoredMetric = (
  metricType: MetricType,
): PromQLStoredMetric => {
  return {
    name: (metricType.name || "").toLowerCase(),
    unit: metricType.unit || undefined,
    isMonotonic: metricType.isMonotonic === true,
  };
};

/*
 * Every PromQL metric name the caller may see, sorted: each series under
 * the name Prometheus gives it, with its unit (issue #7715). The name
 * without the unit finds the same series, and is not listed again.
 */
export const listPromQLMetricNames: (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}) => Promise<Array<string>> = async (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Array<string>> => {
  const [catalog, pointTypes] = await Promise.all([
    readCatalog(data.projectId, data.props),
    readHistogramPointTypes(data.projectId),
  ]);
  const names: Set<string> = new Set<string>();

  for (const metricType of catalog) {
    const metric: PromQLStoredMetric = toStoredMetric(metricType);

    if (!metric.name) {
      continue;
    }

    for (const series of prometheusSeriesNamesOf(
      metric,
      pointTypes.get(metric.name),
    )) {
      names.add(series.name);
    }
  }

  return Array.from(names).sort();
};

/*
 * Every label name the caller's metrics carry: their attributes as PromQL
 * names them, and the labels every metric can have.
 */
export const listPromQLLabelNames: (data: {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
}) => Promise<Array<string>> = async (data: {
  projectId: ObjectID;
  serviceFilter: TelemetryServiceFilter;
}): Promise<Array<string>> => {
  const keys: Array<string> = await TelemetryAttributeService.fetchAttributes({
    projectId: data.projectId,
    telemetryType: TelemetryType.Metric,
    serviceFilter: data.serviceFilter,
  });
  const names: Set<string> = new Set<string>(STRUCTURAL_LABELS);

  for (const key of keys) {
    names.add(toPromQLLabelName(key));
  }

  return Array.from(names).sort();
};

// The attribute keys a label name is read from.
const attributeKeysOfLabel: (
  label: string,
  keys: Array<string>,
) => Array<string> = (label: string, keys: Array<string>): Array<string> => {
  if (label === "job") {
    return ["resource.service.name"];
  }

  if (label === "instance") {
    return ["resource.service.instance.id"];
  }

  return keys.filter((key: string): boolean => {
    return key === label || toPromQLLabelName(key) === label;
  });
};

/*
 * One label's values among the caller's metrics in the window, from the
 * attribute lookups (at most five attribute keys read for one label).
 */
export const listPromQLLabelValues: (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  serviceFilter: TelemetryServiceFilter;
  label: string;
  startTimeMs: number;
  endTimeMs: number;
}) => Promise<Array<string>> = async (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  serviceFilter: TelemetryServiceFilter;
  label: string;
  startTimeMs: number;
  endTimeMs: number;
}): Promise<Array<string>> => {
  if (data.label === PROMQL_METRIC_NAME_LABEL) {
    return listPromQLMetricNames({
      projectId: data.projectId,
      props: data.props,
    });
  }

  /*
   * `le` and `quantile` are read like any label: a histogram's and a
   * summary's are made from their points and are no attribute, but a
   * classic histogram or summary sent as its series (Prometheus remote
   * write) carries them as attributes, which are its values here.
   */
  const keys: Array<string> = await TelemetryAttributeService.fetchAttributes({
    projectId: data.projectId,
    telemetryType: TelemetryType.Metric,
    serviceFilter: data.serviceFilter,
  });
  const values: Set<string> = new Set<string>();

  for (const key of attributeKeysOfLabel(data.label, keys).slice(0, 5)) {
    const keyValues: Array<string> =
      await TelemetryAttributeService.fetchAttributeValues({
        projectId: data.projectId,
        telemetryType: TelemetryType.Metric,
        attributeKey: key,
        serviceFilter: data.serviceFilter,
        startTime: new Date(data.startTimeMs),
        endTime: new Date(data.endTimeMs),
      });

    for (const value of keyValues) {
      if (value) {
        values.add(value);
      }
    }
  }

  return Array.from(values).sort();
};

export interface PrometheusMetricMetadata {
  type: string;
  help: string;
  unit: string;
}

/*
 * Each metric's type, help and unit, keyed by its PromQL name, as
 * /api/v1/metadata answers them. A histogram's or summary's series share
 * its entry under the base name, as in Prometheus. The name and the unit
 * are Prometheus' (issue #7715): `http_server_request_duration_seconds` in
 * `seconds`, a counter's name with its `_total`.
 */
export const listPromQLMetricMetadata: (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  metric: string | undefined;
  limit: number;
}) => Promise<Record<string, Array<PrometheusMetricMetadata>>> = async (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  metric: string | undefined;
  limit: number;
}): Promise<Record<string, Array<PrometheusMetricMetadata>>> => {
  const [catalog, pointTypes] = await Promise.all([
    readCatalog(data.projectId, data.props),
    readHistogramPointTypes(data.projectId),
  ]);
  const metadata: Record<string, Array<PrometheusMetricMetadata>> = {};
  let count: number = 0;

  for (const metricType of catalog) {
    const metric: PromQLStoredMetric = toStoredMetric(metricType);

    if (!metric.name) {
      continue;
    }

    const pointType: string | undefined = pointTypes.get(metric.name);
    const base: string = toPrometheusFamilyName({ metric, pointType });

    if (!base || (data.metric && data.metric !== base)) {
      continue;
    }

    let type: string = metricType.isMonotonic ? "counter" : "unknown";

    if (pointType === "Histogram" || pointType === "ExponentialHistogram") {
      type = "histogram";
    } else if (pointType === "Summary") {
      type = "summary";
    }

    // As an own key: an exporter may name a metric __proto__.
    writeOwnValue(metadata, base, [
      {
        type,
        help: metricType.description || "",
        unit: toPrometheusUnit(metric.unit),
      },
    ]);
    count++;

    if (count >= data.limit) {
      break;
    }
  }

  return metadata;
};
