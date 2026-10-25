import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { appendAttributeFilters } from "../Utils/AnalyticsDatabase/AttributeFilterStatement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import MetricService from "./MetricService";
import { MutableMetricService as MutableMetricServiceClass } from "./MutableMetricService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryReadScopeUtil from "../Utils/Telemetry/TelemetryReadScope";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import ServiceType from "../../Types/Telemetry/ServiceType";
import { getResourceFacetServiceTypeMap } from "../../Types/Telemetry/ResourceFacetCatalog";
import {
  METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES,
  METRIC_NAME_ID_PATTERN,
  METRIC_NAME_ID_PLACEHOLDER,
  MetricAttributeReading,
  MetricNamePatternReading,
  MetricShapeReading,
  MetricVolumeReading,
  OTEL_METRIC_OVERFLOW_ATTRIBUTE,
} from "../../Utils/Metrics/MetricInsight";

export interface FacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

/*
 * A serialized QueryOperator (`{_type: "Wildcard", value: ["api-*"]}` and
 * friends) — how an attribute filter row that uses any operator other than
 * the implicit `=` arrives over the wire, since every QueryOperator's
 * toJSON() emits this shape. See appendAttributeOperatorFilter.
 */
export interface SerializedAttributeOperator {
  _type: string;
  value?: unknown;
}

/*
 * An attribute predicate. A single string is `= value`; an array is
 * `IN (...)`; an object is any other operator (contains, matches, is empty,
 * ...). Mirrors LogAttributeFilterValue / TraceAttributeFilterValue so every
 * explorer filters identically.
 */
export type MetricAttributeFilterValue =
  | string
  | Array<string>
  | SerializedAttributeOperator;
export type MetricAttributeFilters = Record<string, MetricAttributeFilterValue>;

export interface MetricFilters {
  serviceIds?: Array<ObjectID> | undefined;
  // Resources whose rows are left out whatever else matches.
  excludedServiceIds?: Array<ObjectID> | undefined;
  metricNames?: Array<string> | undefined;
  /*
   * Attribute predicates over the `attributes` map, same shapes as the log
   * and trace explorers. Metrics had no attribute channel at all, so no
   * selection could narrow the facet counts — every facet counted the whole
   * window no matter what else was selected beside it.
   */
  attributes?: MetricAttributeFilters | undefined;
}

export interface FacetRequest extends MetricFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
}

export interface MetricsForTraceRequest {
  projectId: ObjectID;
  /** Exemplar traceId stamped on Metric rows (bloom-indexed). */
  traceId: string;
  /** Optional span-level narrowing within the trace (bloom-indexed). */
  spanIds?: Array<string> | undefined;
  limit?: number | undefined;
  // The services the caller may read (TelemetryReadScope).
  serviceIds?: Array<ObjectID> | undefined;
  // Resources whose rows are left out whatever else matches.
  excludedServiceIds?: Array<ObjectID> | undefined;
}

export interface MetricForTraceItem {
  name: string;
  time: string;
  value: number;
  spanId: string;
  /** primaryEntityId of the row, stringified for the wire. */
  serviceId: string;
  attributes: JSONObject;
}

/*
 * The Metrics AI lane's reads (Utils/Metrics/MetricInsight): the hour a look
 * reads, from the hourly rollup, and then a few of its metrics closely, from
 * the metric table itself. Read as root with the project scoped explicitly:
 * the insight scanner is a system actor.
 */
export interface MetricHourRequest {
  projectId: ObjectID;
  // The hour's start, on the hour (Utils/Metrics/MetricInsight's window).
  hourStart: Date;
  limit: number;
}

export interface MetricNamePatternRequest extends MetricHourRequest {
  // The fewest names a pattern must cover to be returned.
  minNameCount: number;
}

// One metric of one primary entity (a service, a host, a monitor).
export interface MetricSeriesKey {
  metricName: string;
  serviceId: string;
}

export interface MetricWindowRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  metrics: Array<MetricSeriesKey>;
}

export interface MetricAttributeCardinalityRequest extends MetricWindowRequest {
  // The fewest values an attribute must take to be returned.
  minValueCount: number;
  // How many of its values each returned attribute carries, to be read.
  sampleSize: number;
}

export interface MetricShapeRow extends MetricShapeReading, MetricSeriesKey {}

export interface MetricAttributeCardinalityRow
  extends MetricAttributeReading,
    MetricSeriesKey {}

/*
 * Facet aggregation for the Metrics page sidebar. Same shape as
 * TraceAggregationService / LogAggregationService — per-facet GROUP BY on
 * the analytics table, with a `primaryEntityType` discriminator that lets
 * the `primaryEntityId` column carry Host / DockerHost / KubernetesCluster /
 * ... ids (one virtual facet per ResourceFacetCatalog resource type).
 */
export class MetricAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 500;
  private static readonly TABLE_NAME: string = AnalyticsTableName.Metric;
  private static readonly MUTABLE_TABLE_NAME: string =
    AnalyticsTableName.MutableMetric;
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "primaryEntityId",
    "name",
  ]);
  private static readonly RESOURCE_FACET_KEYS: Map<string, ServiceType> =
    getResourceFacetServiceTypeMap();
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;
  /**
   * Cap on rows returned by the reverse exemplar lookup. A single trace
   * rarely stamps more than a handful of exemplars, so hitting this cap
   * means a pathological instrumentation loop — truncating is safe.
   */
  private static readonly MAX_METRICS_FOR_TRACE_LIMIT: number = 500;

  /**
   * Reverse exemplar lookup: every Metric row whose exemplar traceId
   * matches the given trace (optionally narrowed to specific spans).
   * Drives the "Metrics" tab on the trace detail view. traceId and
   * spanId both carry bloom-filter skip indexes, so the read touches
   * only the granules the index cannot rule out.
   */
  @CaptureSpan()
  public static async getMetricsForTrace(
    request: MetricsForTraceRequest,
  ): Promise<Array<MetricForTraceItem>> {
    const statement: Statement =
      MetricAggregationService.buildMetricsForTraceStatement(request);

    const dbResult: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows.map((row: JSONObject): MetricForTraceItem => {
      return {
        name: String(row["name"] || ""),
        time: String(row["time"] || ""),
        value: Number(row["value"] || 0),
        spanId: String(row["spanId"] || ""),
        serviceId: String(row["serviceId"] || ""),
        attributes: (row["attributes"] as JSONObject) || {},
      };
    });
  }

  private static buildMetricsForTraceStatement(
    request: MetricsForTraceRequest,
  ): Statement {
    const limit: number = Math.min(
      request.limit || MetricAggregationService.MAX_METRICS_FOR_TRACE_LIMIT,
      MetricAggregationService.MAX_METRICS_FOR_TRACE_LIMIT,
    );

    const statement: Statement = SQL`
      SELECT
        name,
        time,
        toFloat64(value) AS value,
        spanId,
        toString(primaryEntityId) AS serviceId,
        attributes
      FROM ${MetricAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND traceId = ${{
          type: TableColumnType.Text,
          value: request.traceId,
        }}
    `;

    if (request.spanIds && request.spanIds.length > 0) {
      statement.append(
        SQL` AND spanId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanIds),
        }})`,
      );
    }

    /*
     * Read-side retention filter: rows past their retention stay on disk
     * until the midnight after it (the TTL is rounded up to the day).
     */
    statement.append(" AND retentionDate >= now()");

    TelemetryReadScopeUtil.appendServiceFilter(statement, request);

    statement.append(
      SQL` ORDER BY time ASC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout rather than hold a
     * pool connection, and say so when it is reached (see
     * INTERACTIVE_READ_TIME_LIMIT).
     */
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    return statement;
  }

  @CaptureSpan()
  public static async getFacetValues(
    request: FacetRequest,
  ): Promise<Array<FacetValue>> {
    const statement: Statement =
      MetricAggregationService.buildFacetStatement(request);

    const dbResult: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows
      .map((row: JSONObject): FacetValue => {
        return {
          value: String(row["val"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((facet: FacetValue): boolean => {
        return facet.value.length > 0;
      });
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    // Pre-rename alias from stale clients; the V3 column is primaryEntityId.
    if (request.facetKey === "serviceId") {
      request.facetKey = "primaryEntityId";
    }

    const limit: number =
      request.limit ?? MetricAggregationService.DEFAULT_FACET_LIMIT;

    MetricAggregationService.validateFacetKey(request.facetKey);

    const resourceServiceType: ServiceType | undefined =
      MetricAggregationService.RESOURCE_FACET_KEYS.get(request.facetKey);
    const isResourceFacet: boolean = resourceServiceType !== undefined;
    const isTopLevelColumn: boolean =
      isResourceFacet ||
      MetricAggregationService.isTopLevelColumn(request.facetKey);
    const useMutableMetricTable: boolean =
      MetricAggregationService.shouldUseMutableMetricTable(request);

    const statement: Statement = new Statement();

    if (isResourceFacet) {
      statement.append(
        SQL`SELECT toString(primaryEntityId) AS val, count() AS cnt`,
      );
    } else if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt`,
      );
    } else {
      statement.append(
        SQL`SELECT attributes[${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}] AS val, count() AS cnt`,
      );
    }

    MetricAggregationService.appendFacetSourceTable(
      statement,
      request,
      useMutableMetricTable,
    );

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND time >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND time <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    if (useMutableMetricTable) {
      statement.append(SQL` AND isDeleted = false`);
    }

    if (isResourceFacet) {
      statement.append(
        SQL` AND primaryEntityType = ${{
          type: TableColumnType.Text,
          value: resourceServiceType as string,
        }}`,
      );
    } else if (request.facetKey === "primaryEntityId") {
      statement.append(
        SQL` AND (primaryEntityType = '' OR primaryEntityType = ${{
          type: TableColumnType.Text,
          value: ServiceType.OpenTelemetry as string,
        }})`,
      );
    } else if (!isTopLevelColumn) {
      statement.append(
        SQL` AND mapContains(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }})`,
      );
    }

    /*
     * Read-side retention filter: rows past their retention stay on disk
     * until the midnight after it (the TTL is rounded up to the day).
     */
    statement.append(" AND retentionDate >= now()");

    MetricAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Defense in depth: cap runtime below nginx's 60s proxy_read_timeout
     * so a slow facet never starves the endpoint. A facet stopped at the
     * limit is named in the facets endpoint's timedOutFacets.
     */
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    return statement;
  }

  private static shouldUseMutableMetricTable(request: FacetRequest): boolean {
    if (!request.metricNames || request.metricNames.length === 0) {
      return false;
    }

    return request.metricNames.every((metricName: string): boolean => {
      return MutableMetricServiceClass.isMutableMetricName(metricName);
    });
  }

  private static appendFacetSourceTable(
    statement: Statement,
    request: FacetRequest,
    useMutableMetricTable: boolean,
  ): void {
    if (!useMutableMetricTable) {
      statement.append(SQL` FROM ${MetricAggregationService.TABLE_NAME}`);
      return;
    }

    statement.append(
      SQL` FROM (
        SELECT
          projectId,
          name,
          primaryEntityId,
          primaryEntityType,
          metricPointId,
          argMax(time, version) AS time,
          argMax(attributes, version) AS attributes,
          argMax(retentionDate, version) AS retentionDate,
          argMax(isDeleted, version) AS isDeleted
        FROM ${MetricAggregationService.MUTABLE_TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}`,
    );

    if (request.metricNames && request.metricNames.length > 0) {
      statement.append(
        SQL` AND name IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.metricNames),
        }})`,
      );
    }

    statement.append(
      SQL`
        GROUP BY projectId, name, primaryEntityId, primaryEntityType, metricPointId
      )`,
    );
  }

  private static appendCommonFilters(
    statement: Statement,
    request: MetricFilters,
  ): void {
    TelemetryReadScopeUtil.appendServiceFilter(statement, request);

    if (request.metricNames && request.metricNames.length > 0) {
      statement.append(
        SQL` AND name IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.metricNames),
        }})`,
      );
    }

    /*
     * Attribute filters - a value, a list (empty means "no selection"), a
     * blank ("is empty") or an operator - compiled exactly as the log and
     * trace charts compile them: keys matched case-insensitively, an exact
     * value checked with `has(mapValues(attributes), ...)` before the
     * per-key lambda. MetricItemV3 has no attribute value index (see
     * AttributeValueIndex for why), so here that check skips no granule; it
     * only spares the lambda the rows that do not hold the value. See
     * AttributeFilterStatement.
     */
    appendAttributeFilters({
      statement: statement,
      attributes: request.attributes,
      validateKey: (attributeKey: string): void => {
        MetricAggregationService.validateFacetKey(attributeKey);
      },
    });
  }

  private static isTopLevelColumn(key: string): boolean {
    return MetricAggregationService.TOP_LEVEL_COLUMNS.has(key);
  }

  private static validateFacetKey(
    facetKey: unknown,
  ): asserts facetKey is string {
    if (typeof facetKey !== "string") {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      facetKey.length === 0 ||
      facetKey.length > MetricAggregationService.MAX_FACET_KEY_LENGTH
    ) {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      MetricAggregationService.isTopLevelColumn(facetKey) ||
      MetricAggregationService.RESOURCE_FACET_KEYS.has(facetKey)
    ) {
      return;
    }

    if (!MetricAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }

  /*
   * The Metrics AI lane's reads stop with an error at their time limit, under
   * the client's request timeout - never 'break', which answers a grouped
   * read with an empty body that would read as "no metrics" (issue #4707).
   */
  public static readonly INSIGHT_READ_MAX_EXECUTION_SECONDS: number = 45;

  // The most metrics one close read takes at once.
  public static readonly INSIGHT_MAX_METRICS_PER_READ: number = 20;

  // The most rows a close read returns.
  public static readonly INSIGHT_MAX_ROWS: number = 200;

  private static appendInsightReadSettings(statement: Statement): void {
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds:
          MetricAggregationService.INSIGHT_READ_MAX_EXECUTION_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );
  }

  /*
   * The hourly rollup's one cell for the hour: the same day and hour-of-week
   * expressions its materialized view writes (MetricBaselineHourly), worked
   * out by ClickHouse from the hour's start so the two always agree.
   */
  private static appendHourCell(statement: Statement, hourStart: Date): void {
    statement.append(
      SQL` AND day = toDate(${{
        type: TableColumnType.Date,
        value: hourStart,
      }}) AND hourOfWeek = toUInt8((toDayOfWeek(${{
        type: TableColumnType.Date,
        value: hourStart,
      }}, 1) - 1) * 24 + toHour(${{
        type: TableColumnType.Date,
        value: hourStart,
      }}))`,
    );
  }

  // The metrics a close read takes: exactly these, by the sort key's prefix.
  private static appendMetricKeys(
    statement: Statement,
    metrics: Array<MetricSeriesKey>,
  ): void {
    statement.append(" AND (");

    metrics.forEach((metric: MetricSeriesKey, index: number): void => {
      if (index > 0) {
        statement.append(" OR ");
      }

      statement.append(
        SQL`(name = ${{
          type: TableColumnType.Text,
          value: metric.metricName,
        }} AND primaryEntityId = ${{
          type: TableColumnType.Text,
          value: metric.serviceId,
        }})`,
      );
    });

    statement.append(")");
  }

  private static appendWindow(
    statement: Statement,
    request: MetricWindowRequest,
  ): void {
    statement.append(
      SQL` AND time >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND time < ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    // Rows past their retention stay on disk until the midnight after it.
    statement.append(" AND retentionDate >= now()");
  }

  // The metrics a close read takes, at most INSIGHT_MAX_METRICS_PER_READ.
  public static toMetricKeys(
    metrics: Array<MetricSeriesKey>,
  ): Array<MetricSeriesKey> {
    return metrics
      .filter((metric: MetricSeriesKey): boolean => {
        return Boolean(metric.metricName) && Boolean(metric.serviceId);
      })
      .slice(0, MetricAggregationService.INSIGHT_MAX_METRICS_PER_READ);
  }

  private static async readRows(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const dbResult: Results = await MetricService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  // Every metric of the hour by its primary entity, busiest first.
  public static buildHourlyVolumeStatement(
    request: MetricHourRequest,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      SQL`SELECT name, primaryEntityId, countMerge(sampleCountState) AS points FROM ${AnalyticsTableName.MetricBaselineHourly} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}`,
    );
    MetricAggregationService.appendHourCell(statement, request.hourStart);
    statement.append(
      SQL` GROUP BY name, primaryEntityId ORDER BY points DESC, name ASC, primaryEntityId ASC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit,
      }}`,
    );
    MetricAggregationService.appendInsightReadSettings(statement);

    return statement;
  }

  // The rows as the lane's gates read them. Pure.
  public static toMetricVolumes(
    rows: Array<JSONObject>,
  ): Array<MetricVolumeReading> {
    return rows
      .map((row: JSONObject): MetricVolumeReading => {
        return {
          metricName: String(row["name"] || ""),
          serviceId: String(row["primaryEntityId"] || "")
            .trim()
            .toLowerCase(),
          dataPointCount: Number(row["points"] || 0),
        };
      })
      .filter((reading: MetricVolumeReading): boolean => {
        return (
          reading.metricName.length > 0 &&
          reading.serviceId.length > 0 &&
          Number.isFinite(reading.dataPointCount)
        );
      });
  }

  /*
   * Every metric of the hour, from the hourly rollup: its data points by
   * metric and primary entity, busiest first.
   */
  @CaptureSpan()
  public static async getHourlyMetricVolumes(
    request: MetricHourRequest,
  ): Promise<Array<MetricVolumeReading>> {
    return MetricAggregationService.toMetricVolumes(
      await MetricAggregationService.readRows(
        MetricAggregationService.buildHourlyVolumeStatement(request),
      ),
    );
  }

  /*
   * The hour's metric names with their ids collapsed (METRIC_NAME_ID_PATTERN,
   * which ClickHouse reads as JavaScript does), by primary entity: the
   * patterns that cover enough names, the most names first.
   */
  public static buildNamePatternStatement(
    request: MetricNamePatternRequest,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      SQL`SELECT primaryEntityId, namePattern, uniqExact(name) AS nameCount, sum(points) AS points FROM (SELECT name, primaryEntityId, replaceRegexpAll(name, ${{
        type: TableColumnType.Text,
        value: METRIC_NAME_ID_PATTERN,
      }}, ${{
        type: TableColumnType.Text,
        value: METRIC_NAME_ID_PLACEHOLDER,
      }}) AS namePattern, countMerge(sampleCountState) AS points FROM ${AnalyticsTableName.MetricBaselineHourly} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}`,
    );
    MetricAggregationService.appendHourCell(statement, request.hourStart);
    statement.append(
      SQL` GROUP BY name, primaryEntityId) WHERE position(namePattern, ${{
        type: TableColumnType.Text,
        value: METRIC_NAME_ID_PLACEHOLDER,
      }}) > 0 GROUP BY primaryEntityId, namePattern HAVING nameCount >= ${{
        type: TableColumnType.Number,
        value: request.minNameCount,
      }} ORDER BY nameCount DESC, namePattern ASC, primaryEntityId ASC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit,
      }}`,
    );
    MetricAggregationService.appendInsightReadSettings(statement);

    return statement;
  }

  // The rows as the lane's gates read them. Pure.
  public static toMetricNamePatterns(
    rows: Array<JSONObject>,
  ): Array<MetricNamePatternReading> {
    return rows
      .map((row: JSONObject): MetricNamePatternReading => {
        return {
          serviceId: String(row["primaryEntityId"] || "")
            .trim()
            .toLowerCase(),
          namePattern: String(row["namePattern"] || ""),
          nameCount: Number(row["nameCount"] || 0),
          dataPointCount: Number(row["points"] || 0),
        };
      })
      .filter((reading: MetricNamePatternReading): boolean => {
        return (
          reading.serviceId.length > 0 &&
          reading.namePattern.length > 0 &&
          Number.isFinite(reading.nameCount)
        );
      });
  }

  @CaptureSpan()
  public static async getMetricNamePatterns(
    request: MetricNamePatternRequest,
  ): Promise<Array<MetricNamePatternReading>> {
    return MetricAggregationService.toMetricNamePatterns(
      await MetricAggregationService.readRows(
        MetricAggregationService.buildNamePatternStatement(request),
      ),
    );
  }

  /*
   * A few metrics over the window, by kind of data point: their bucket
   * counts summed bucket by bucket over the points with the same bounds,
   * their counts, their smallest and largest values, and how many of their
   * points carry the SDK's overflow attribute.
   */
  public static buildMetricShapeStatement(
    request: MetricWindowRequest,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      SQL`SELECT name, primaryEntityId, ifNull(metricPointType, '') AS pointType, ifNull(aggregationTemporality, '') AS temporality, explicitBounds AS bounds, sumForEach(bucketCounts) AS buckets, sum(ifNull(count, 0)) AS countSum, max(ifNull(count, 0)) AS countMax, min(min) AS minValue, max(max) AS maxValue, count() AS points, countIf(has(attributeKeys, ${{
        type: TableColumnType.Text,
        value: OTEL_METRIC_OVERFLOW_ATTRIBUTE,
      }})) AS overflowPoints FROM ${MetricAggregationService.TABLE_NAME} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}`,
    );
    MetricAggregationService.appendMetricKeys(
      statement,
      MetricAggregationService.toMetricKeys(request.metrics),
    );
    MetricAggregationService.appendWindow(statement, request);
    statement.append(
      SQL` GROUP BY name, primaryEntityId, pointType, temporality, bounds ORDER BY points DESC, name ASC, primaryEntityId ASC LIMIT ${{
        type: TableColumnType.Number,
        value: MetricAggregationService.INSIGHT_MAX_ROWS,
      }}`,
    );
    MetricAggregationService.appendInsightReadSettings(statement);

    return statement;
  }

  private static toNumberList(value: unknown): Array<number> {
    return Array.isArray(value)
      ? value.map((item: unknown): number => {
          return Number(item);
        })
      : [];
  }

  private static toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number: number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  // The rows as the lane's gates read them. Pure.
  public static toMetricShapes(rows: Array<JSONObject>): Array<MetricShapeRow> {
    return rows
      .map((row: JSONObject): MetricShapeRow => {
        return {
          metricName: String(row["name"] || ""),
          serviceId: String(row["primaryEntityId"] || "")
            .trim()
            .toLowerCase(),
          pointType: String(row["pointType"] || ""),
          temporality: String(row["temporality"] || ""),
          bounds: MetricAggregationService.toNumberList(row["bounds"]),
          bucketCounts: MetricAggregationService.toNumberList(row["buckets"]),
          countSum: Number(row["countSum"] || 0),
          countMax: Number(row["countMax"] || 0),
          minValue: MetricAggregationService.toNumberOrNull(row["minValue"]),
          maxValue: MetricAggregationService.toNumberOrNull(row["maxValue"]),
          dataPointCount: Number(row["points"] || 0),
          overflowDataPointCount: Number(row["overflowPoints"] || 0),
        };
      })
      .filter((row: MetricShapeRow): boolean => {
        return row.metricName.length > 0 && row.serviceId.length > 0;
      });
  }

  @CaptureSpan()
  public static async getMetricShapes(
    request: MetricWindowRequest,
  ): Promise<Array<MetricShapeRow>> {
    if (MetricAggregationService.toMetricKeys(request.metrics).length === 0) {
      return [];
    }

    return MetricAggregationService.toMetricShapes(
      await MetricAggregationService.readRows(
        MetricAggregationService.buildMetricShapeStatement(request),
      ),
    );
  }

  /*
   * A few metrics over the window: how many values each attribute their
   * code sets took - not the resource's, the scope's or OneUptime's own
   * stamps, nor the SDK's overflow marker - for the attributes past the
   * gate, each with a small sample of its values so their shape can be
   * told (and then dropped).
   */
  public static buildAttributeCardinalityStatement(
    request: MetricAttributeCardinalityRequest,
  ): Statement {
    const statement: Statement = new Statement();
    // A count the code chose, never a caller's: written into the SQL.
    const sampleSize: number = Math.max(
      1,
      Math.min(Math.floor(request.sampleSize) || 1, 1000),
    );

    statement.append(
      `SELECT name, primaryEntityId, key, uniq(attributes[key]) AS valueCount, groupUniqArray(${sampleSize})(attributes[key]) AS sampleValues FROM ${MetricAggregationService.TABLE_NAME} ARRAY JOIN arrayFilter(k -> NOT (`,
    );

    METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES.forEach(
      (prefix: string, index: number): void => {
        if (index > 0) {
          statement.append(" OR ");
        }

        statement.append(
          SQL`startsWith(k, ${{
            type: TableColumnType.Text,
            value: prefix,
          }})`,
        );
      },
    );

    statement.append(
      SQL` OR k = ${{
        type: TableColumnType.Text,
        value: OTEL_METRIC_OVERFLOW_ATTRIBUTE,
      }}), attributeKeys) AS key WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}`,
    );
    MetricAggregationService.appendMetricKeys(
      statement,
      MetricAggregationService.toMetricKeys(request.metrics),
    );
    MetricAggregationService.appendWindow(statement, request);
    statement.append(
      SQL` GROUP BY name, primaryEntityId, key HAVING valueCount >= ${{
        type: TableColumnType.Number,
        value: request.minValueCount,
      }} ORDER BY valueCount DESC, name ASC, primaryEntityId ASC, key ASC LIMIT ${{
        type: TableColumnType.Number,
        value: MetricAggregationService.INSIGHT_MAX_ROWS,
      }}`,
    );
    MetricAggregationService.appendInsightReadSettings(statement);

    return statement;
  }

  // The rows as the lane's gates read them. Pure.
  public static toAttributeCardinality(
    rows: Array<JSONObject>,
  ): Array<MetricAttributeCardinalityRow> {
    return rows
      .map((row: JSONObject): MetricAttributeCardinalityRow => {
        const sample: unknown = row["sampleValues"];

        return {
          metricName: String(row["name"] || ""),
          serviceId: String(row["primaryEntityId"] || "")
            .trim()
            .toLowerCase(),
          key: String(row["key"] || ""),
          valueCount: Number(row["valueCount"] || 0),
          sampleValues: Array.isArray(sample)
            ? sample.map((value: unknown): string => {
                return String(value ?? "");
              })
            : [],
        };
      })
      .filter((row: MetricAttributeCardinalityRow): boolean => {
        return (
          row.metricName.length > 0 &&
          row.serviceId.length > 0 &&
          row.key.length > 0
        );
      });
  }

  @CaptureSpan()
  public static async getMetricAttributeCardinality(
    request: MetricAttributeCardinalityRequest,
  ): Promise<Array<MetricAttributeCardinalityRow>> {
    if (MetricAggregationService.toMetricKeys(request.metrics).length === 0) {
      return [];
    }

    return MetricAggregationService.toAttributeCardinality(
      await MetricAggregationService.readRows(
        MetricAggregationService.buildAttributeCardinalityStatement(request),
      ),
    );
  }
}

export default MetricAggregationService;
