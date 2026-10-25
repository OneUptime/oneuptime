import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../Utils/AnalyticsDatabase/Statement";
import { appendAttributeFilters } from "../Utils/AnalyticsDatabase/AttributeFilterStatement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import SpanService from "./SpanService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import { ExceptionSpanScope } from "../../Types/Telemetry/ExceptionSpanScope";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryReadScopeUtil from "../Utils/Telemetry/TelemetryReadScope";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import logger from "../Utils/Logger";
import ServiceType from "../../Types/Telemetry/ServiceType";
import { getResourceFacetServiceTypeMap } from "../../Types/Telemetry/ResourceFacetCatalog";
import {
  appendResourceScopeFilters,
  ResourceEntityScope,
} from "../Utils/Telemetry/ResourceEntityFilter";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetSpec,
} from "../Utils/Telemetry/ResourceFacetResolver";

export interface HistogramBucket {
  time: string;
  series: string;
  count: number;
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
 * `IN (...)`, which is what a multi-select dashboard variable resolves to;
 * an object is any other operator (contains, matches, is empty, ...), which
 * the span list already compiles through StatementGenerator. Mirrors
 * LogAttributeFilterValue so both explorers filter identically.
 */
export type TraceAttributeFilterValue =
  | string
  | Array<string>
  | SerializedAttributeOperator;
export type TraceAttributeFilters = Record<string, TraceAttributeFilterValue>;

export interface TraceFilters {
  serviceIds?: Array<ObjectID> | undefined;
  // Resources whose rows are left out whatever else matches.
  excludedServiceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
  /*
   * Resource-facet selections (host / Kubernetes cluster / Proxmox
   * cluster / ... — any ResourceFacetCatalog type) already resolved to
   * their entity keys and resource attributes. One scope per
   * facet: the branches inside a scope OR (a span proves membership either
   * by being primary-keyed on the resource or by carrying its entity key),
   * and the scopes AND with each other so two facets intersect. See
   * ResourceEntityFilter.
   */
  resourceScopes?: Array<ResourceEntityScope> | undefined;
  statusCodes?: Array<number> | undefined;
  spanKinds?: Array<string> | undefined;
  spanNames?: Array<string> | undefined;
  /*
   * Substring name matches (ANDed). The span list compiles a single `name`
   * filter to `name ILIKE '%v%'` (Search) — aggregations must use the same
   * semantics or the histogram/facets disagree with the list. `spanNames`
   * stays exact-match for multi-value filters (list-side `Includes`).
   */
  spanNameSearches?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  nameSearchText?: string | undefined;
  statusMessageSearchText?: string | undefined;
  // Exact-match for multi-value statusMessage filters (list-side `Includes`).
  statusMessages?: Array<string> | undefined;
  hasException?: boolean | undefined;
  /*
   * Only the spans an exception group's occurrences were raised in. Compiled
   * to a (traceId, spanId) IN subquery over the exception occurrences, pinned
   * to the request's project — see Types/Telemetry/ExceptionSpanScope.
   */
  exceptionScope?: ExceptionSpanScope | undefined;
  /*
   * Strict bounds (`>` / `<`) — the list compiles duration:>N / duration:<N
   * to GreaterThan / LessThan, which are strict comparisons. `duration:N`
   * (no operator) is exact equality, carried by exactDurationNano.
   */
  minDurationNano?: number | undefined;
  maxDurationNano?: number | undefined;
  exactDurationNano?: number | undefined;
  rootOnly?: boolean | undefined;
  attributes?: TraceAttributeFilters | undefined;
  /*
   * Substring (contains) attribute matches — `@key:~value` in the explorer.
   * Same case-insensitive key matching as `attributes`, value via ILIKE.
   */
  attributeSearches?: Record<string, string> | undefined;
}

export interface HistogramRequest extends TraceFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
}

export type TraceAnalyticsChartType = "timeseries" | "toplist" | "table";

export type TraceAnalyticsMetric =
  | "count"
  | "errorCount"
  | "avgDuration"
  | "minDuration"
  | "maxDuration"
  | "p50Duration"
  | "p90Duration"
  | "p95Duration"
  | "p99Duration";

export interface TraceAnalyticsRequest extends TraceFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
  chartType: TraceAnalyticsChartType;
  metric: TraceAnalyticsMetric;
  /*
   * Up to two dimensions: top-level Span columns (name, primaryEntityId,
   * kind, statusCode, ...) or span attribute keys (e.g. url.host).
   */
  groupBy?: Array<string> | undefined;
  limit?: number | undefined;
  /*
   * The table's order: which column, and which way. The rows are ranked
   * by it before the limit, so "the slowest ten by p99" is the slowest ten
   * of the whole window, not the slowest of the busiest ten. Unset, the
   * busiest groups come first, as the table always ranked them.
   */
  tableSort?: TraceAnalyticsTableSort | undefined;
}

/*
 * The columns a trace table can be ordered by - the dashboard Trace Table
 * widget's sortable headers (Common/Utils/Dashboard/DashboardWidgetSorts) -
 * each mapped to the aggregate it orders by. A fixed list: a request names
 * a key, never SQL. `group` is the table's first group-by dimension.
 */
export const TRACE_ANALYTICS_TABLE_SORT_ALIASES: Readonly<
  Record<string, string>
> = {
  count: "cnt",
  errorCount: "err_cnt",
  avg: "avg_ms",
  p50: "p50_ms",
  p90: "p90_ms",
  p95: "p95_ms",
  p99: "p99_ms",
  min: "min_ms",
  max: "max_ms",
};

export const TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY: string = "group";

export interface TraceAnalyticsTableSort {
  // A key of TRACE_ANALYTICS_TABLE_SORT_ALIASES, or the group dimension.
  column: string;
  direction: "asc" | "desc";
}

/*
 * A table sort a request names, or null when it names none this table can
 * be ordered by: then the table keeps its own order, busiest first.
 */
export function parseTraceAnalyticsTableSort(
  column: unknown,
  direction: unknown,
): TraceAnalyticsTableSort | null {
  if (
    typeof column !== "string" ||
    (column !== TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY &&
      !Object.prototype.hasOwnProperty.call(
        TRACE_ANALYTICS_TABLE_SORT_ALIASES,
        column,
      ))
  ) {
    return null;
  }

  if (direction !== "asc" && direction !== "desc") {
    return null;
  }

  return { column, direction };
}

export interface TraceAnalyticsTimeseriesRow {
  time: string;
  // Metric value — a count, or milliseconds for duration metrics.
  value: number;
  groupValues: Record<string, string>;
}

export interface TraceAnalyticsTopItem {
  value: string;
  // The selected metric for this dimension value.
  metricValue: number;
  count: number;
}

export interface TraceAnalyticsTableRow {
  groupValues: Record<string, string>;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

/*
 * Which operations of some services run which code: a sample of their
 * recent spans that carry OpenTelemetry's code attributes (the file and the
 * function a span was started in), grouped (getCodeLocationSample).
 */
export interface CodeLocationSampleRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  serviceIds: Array<ObjectID>;
  // The spans read at most, and the groups answered at most.
  sampleSize: number;
  limit: number;
}

export interface CodeLocationSampleRow {
  serviceId: string;
  // The span's name: the operation.
  name: string;
  // code.filepath, or the newer code.file.path.
  filePath: string;
  // code.function, or the newer code.function.name.
  functionName: string;
  // Spans of the sample in the group.
  count: number;
}

// The attribute keys a span names its code with, older names first.
export const CODE_FILE_PATH_ATTRIBUTE_KEYS: Array<string> = [
  "code.filepath",
  "code.file.path",
];

export const CODE_FUNCTION_ATTRIBUTE_KEYS: Array<string> = [
  "code.function",
  "code.function.name",
];

// How long the code location sample may read before it stops with an error.
export const CODE_LOCATION_SAMPLE_TIME_LIMIT_IN_SECONDS: number = 20;

/*
 * Per-service latency profile over a whole window (no time buckets). Only
 * the two aggregates proj_agg_by_service stores — see
 * getServiceLatencyProfile for why nothing else may be added here.
 */
export interface ServiceLatencyProfileRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  // Services returned, ranked by span volume (busiest first).
  limit: number;
  /*
   * Only these services. primaryEntityId is a key of the projection, so
   * the narrowed query is still served by it.
   */
  serviceIds?: Array<ObjectID> | undefined;
}

export interface ServiceLatencyProfileRow {
  primaryEntityId: string;
  count: number;
  p99DurationMs: number;
}

export interface ServiceLatencyProfile {
  rows: Array<ServiceLatencyProfileRow>;
  /*
   * TRUE when the rows may be incomplete: ClickHouse ran with
   * timeout_overflow_mode='break', which returns whatever it aggregated so
   * far — no exception, no marker in the payload. A partial aggregate is
   * WRONG data, not less data (a p99 over a fraction of the spans), so
   * unattended callers that compare windows MUST discard the result rather
   * than reason over it. Never a reason to throw: user-facing callers may
   * still choose to render partial rows.
   */
  isPartial: boolean;
}

/*
 * Per-service span counts over a whole window - every span, the failed ones
 * (an error status) and the root ones - from the proj_hist_by_minute
 * aggregate projection (getServiceSpanHealth).
 */
export interface ServiceSpanHealthRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  // Services returned, busiest first.
  limit: number;
}

export interface ServiceSpanHealthRow {
  primaryEntityId: string;
  spanCount: number;
  failedSpanCount: number;
  rootSpanCount: number;
}

export interface FacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

export interface FacetRequest extends TraceFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
}

export interface MultiFacetRequest extends TraceFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKeys: Array<string>;
  limit?: number | undefined;
  sampleSize?: number | undefined;
}

export class TraceAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 500;
  private static readonly TABLE_NAME: string = AnalyticsTableName.Span;
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "primaryEntityId",
    "traceId",
    "spanId",
    "parentSpanId",
    "name",
    "kind",
    "statusCode",
    "isRootSpan",
  ]);
  /*
   * Virtual facet keys — same scheme as LogAggregationService. The
   * `primaryEntityId` slot is reused for every non-Service resource id
   * (host / docker host / k8s cluster / ... — one entry per
   * ResourceFacetCatalog type), disambiguated by the `primaryEntityType`
   * discriminator.
   */
  private static readonly RESOURCE_FACET_KEYS: Map<string, ServiceType> =
    getResourceFacetServiceTypeMap();
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;
  /*
   * Read-side retention filter for raw-table queries (rows past their
   * per-service retention stay in their part until the whole part drops
   * — ttl_only_drop_parts). Deliberately NOT applied to the
   * projection-shaped queries (histogram / resource facet counts): the
   * proj_hist_by_minute aggregate projection does not store
   * retentionDate, so the predicate would silently force a full
   * base-table scan.
   */
  private static readonly RETENTION_FILTER: string =
    " AND retentionDate >= now()";

  @CaptureSpan()
  public static async getHistogram(
    request: HistogramRequest,
  ): Promise<Array<HistogramBucket>> {
    const statement: Statement =
      TraceAggregationService.buildHistogramStatement(request);

    /*
     * A histogram stopped at its time limit throws a QueryTimeoutException:
     * the chart says it was stopped rather than draw an empty window that
     * reads as "no spans" (issue #4707).
     */
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    return rows.map((row: JSONObject): HistogramBucket => {
      return {
        time: String(row["bucket"] || ""),
        series: TraceAggregationService.mapStatusCodeToSeries(
          Number(row["statusCode"] || 0),
        ),
        count: Number(row["cnt"] || 0),
      };
    });
  }

  @CaptureSpan()
  public static async getFacetValues(
    request: FacetRequest,
  ): Promise<Array<FacetValue>> {
    const statement: Statement =
      TraceAggregationService.buildFacetStatement(request);

    const dbResult: Results = await SpanService.executeQuery(statement);
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

  /*
   * Sample-based facet computation. Runs a single sort-key aligned query
   * (ORDER BY startTime DESC LIMIT sampleSize) and computes top-K per facet
   * in Node.js. This avoids ClickHouse GROUP BY aggregations over the
   * whole window, which a wide window cannot finish in time, and
   * leverages the (projectId, startTime, ...) primary key for efficient
   * backwards scans. Facet values reflect the most recent N root spans in
   * the window — the most actionable view for filtering.
   */
  @CaptureSpan()
  public static async getFacetValuesFromSample(
    request: MultiFacetRequest,
  ): Promise<Record<string, Array<FacetValue>>> {
    const limit: number =
      request.limit ?? TraceAggregationService.DEFAULT_FACET_LIMIT;
    const sampleSize: number = request.sampleSize ?? 1000;

    for (const facetKey of request.facetKeys) {
      TraceAggregationService.validateFacetKey(facetKey);
    }

    const resourceKeys: Array<string> = request.facetKeys.filter(
      (key: string): boolean => {
        return TraceAggregationService.RESOURCE_FACET_KEYS.has(key);
      },
    );
    const topLevelKeys: Array<string> = request.facetKeys.filter(
      (key: string): boolean => {
        return (
          TraceAggregationService.isTopLevelColumn(key) &&
          !TraceAggregationService.RESOURCE_FACET_KEYS.has(key)
        );
      },
    );
    const attributeKeys: Array<string> = request.facetKeys.filter(
      (key: string): boolean => {
        return (
          !TraceAggregationService.isTopLevelColumn(key) &&
          !TraceAggregationService.RESOURCE_FACET_KEYS.has(key)
        );
      },
    );

    const selectColumns: Array<string> = [];
    if (topLevelKeys.length > 0) {
      selectColumns.push(...topLevelKeys);
    }
    if (resourceKeys.length > 0) {
      /*
       * Virtual facets read out of primaryEntityId disambiguated by
       * primaryEntityType.
       */
      if (!selectColumns.includes("primaryEntityId")) {
        selectColumns.push("primaryEntityId");
      }
      selectColumns.push("primaryEntityType");
    }
    if (attributeKeys.length > 0) {
      selectColumns.push("attributes");
    }
    if (selectColumns.length === 0) {
      return {};
    }

    /*
     * Safe to interpolate: top-level column names come from a hardcoded
     * allowlist (TOP_LEVEL_COLUMNS) and "attributes" is a literal. TABLE_NAME
     * is also a private constant.
     */
    const statement: Statement = new Statement();
    statement.append(
      `SELECT ${selectColumns.join(", ")} FROM ${TraceAggregationService.TABLE_NAME}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    statement.append(TraceAggregationService.RETENTION_FILTER);

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` ORDER BY startTime DESC LIMIT ${{
        type: TableColumnType.Number,
        value: sampleSize,
      }}`,
    );

    /*
     * Defense in depth: the sample query is sort-key aligned and should
     * return in well under a second, but cap runtime below nginx's 60s
     * proxy_read_timeout regardless.
     */
    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    const dbResult: Results = await SpanService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    const counts: Record<string, Map<string, number>> = {};
    for (const key of request.facetKeys) {
      counts[key] = new Map<string, number>();
    }

    for (const row of rows) {
      for (const key of topLevelKeys) {
        const raw: unknown = row[key];
        if (raw === undefined || raw === null) {
          continue;
        }
        const value: string = String(raw);
        if (value.length === 0) {
          continue;
        }
        const map: Map<string, number> = counts[key]!;
        map.set(value, (map.get(value) || 0) + 1);
      }

      if (resourceKeys.length > 0) {
        const rowServiceType: string =
          row["primaryEntityType"] === undefined ||
          row["primaryEntityType"] === null
            ? ""
            : String(row["primaryEntityType"]);
        const rowServiceId: unknown = row["primaryEntityId"];
        if (rowServiceId !== undefined && rowServiceId !== null) {
          const value: string = String(rowServiceId);
          if (value.length > 0) {
            for (const key of resourceKeys) {
              const expected: ServiceType | undefined =
                TraceAggregationService.RESOURCE_FACET_KEYS.get(key);
              if (expected && rowServiceType === expected) {
                const map: Map<string, number> = counts[key]!;
                map.set(value, (map.get(value) || 0) + 1);
              }
            }
          }
        }
      }

      if (attributeKeys.length > 0) {
        const attrs: unknown = row["attributes"];
        let parsed: Record<string, unknown> | null = null;
        if (attrs && typeof attrs === "object") {
          parsed = attrs as Record<string, unknown>;
        } else if (typeof attrs === "string" && attrs.length > 0) {
          try {
            parsed = JSON.parse(attrs) as Record<string, unknown>;
          } catch {
            parsed = null;
          }
        }
        if (parsed) {
          for (const key of attributeKeys) {
            const raw: unknown = parsed[key];
            if (raw === undefined || raw === null) {
              continue;
            }
            const value: string =
              typeof raw === "object" ? JSON.stringify(raw) : String(raw);
            if (value.length === 0) {
              continue;
            }
            const map: Map<string, number> = counts[key]!;
            map.set(value, (map.get(value) || 0) + 1);
          }
        }
      }
    }

    const result: Record<string, Array<FacetValue>> = {};
    for (const key of request.facetKeys) {
      const entries: Array<FacetValue> = Array.from(counts[key]!.entries()).map(
        ([value, count]: [string, number]): FacetValue => {
          return { value, count };
        },
      );
      entries.sort((a: FacetValue, b: FacetValue): number => {
        return b.count - a.count;
      });
      result[key] = entries.slice(0, limit);
    }

    return result;
  }

  /*
   * Accurate per-service and per-status counts over the FULL time window,
   * computed with a real GROUP BY instead of the recent-N sample in
   * getFacetValuesFromSample(). The sample saturates with whichever service
   * is chattiest right now, so high-volume services that aren't in the most
   * recent N root spans read 0 — the "top 1000" symptom. This GROUP BY is
   * exact regardless of skew.
   *
   * It is cheap because it rides the proj_hist_by_minute aggregate projection
   * (projectId, minute, primaryEntityId, statusCode, isRootSpan -> count): a
   * 1-month window reads a few thousand pre-aggregated minute rows in
   * single-digit ms instead of scanning tens of millions of raw spans. Two
   * things are required for ClickHouse to actually pick that projection, both
   * load-bearing:
   *   1. The time predicate must be on toStartOfMinute(startTime) — the
   *      projection's key expression — NOT raw startTime. A raw startTime
   *      filter references a column the aggregate projection does not store, so
   *      ClickHouse rejects the projection and full-scans. (Window edges land
   *      on minute boundaries, consistent with the minute-bucketed histogram.)
   *   2. Every other predicate must be on a projection column. isRootSpan,
   *      primaryEntityId and statusCode all are, so the default sidebar load
   *      and drill-down-by-service stay on the projection. A non-projection
   *      filter (kind / name / traceId / entityKeys / attributes)
   *      transparently falls back to a base-table scan — still correct, still
   *      bounded by max_execution_time.
   *
   * primaryEntityId is intentionally NOT disambiguated by primaryEntityType
   * here. Resource IDs are globally unique, so a single primaryEntityId ->
   * count map correctly serves the service facet and every resource facet
   * once merged against each Postgres source-of-truth list (a host id
   * never collides with a service id, so an unrelated entry is simply never
   * looked up). Omitting the primaryEntityType predicate keeps the query
   * projection-eligible.
   */
  @CaptureSpan()
  public static async getResourceFacetCounts(
    request: MultiFacetRequest,
  ): Promise<{
    serviceCounts: Map<string, number>;
    statusCounts: Map<string, number>;
  }> {
    const statement: Statement = new Statement();
    statement.append(
      `SELECT primaryEntityId, statusCode, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.startTime,
      }}) AND toStartOfMinute(startTime) <= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.endTime,
      }})`,
    );

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY primaryEntityId, statusCode");

    /*
     * Cap runtime below nginx's 60s proxy_read_timeout and explicitly allow
     * projection use so proj_hist_by_minute is read when eligible (see the
     * toStartOfMinute note above).
     */
    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    const serviceCounts: Map<string, number> = new Map<string, number>();
    const statusCounts: Map<string, number> = new Map<string, number>();

    /*
     * Counts stopped at the time limit throw (a QueryTimeoutException); the
     * facets endpoint names the facets they leave uncounted instead of
     * showing every resource at 0 (issue #4707).
     */
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    for (const row of rows) {
      const cnt: number = Number(row["cnt"] || 0);

      const rawServiceId: unknown = row["primaryEntityId"];
      if (rawServiceId !== undefined && rawServiceId !== null) {
        const serviceId: string = String(rawServiceId);
        if (serviceId.length > 0) {
          serviceCounts.set(
            serviceId,
            (serviceCounts.get(serviceId) || 0) + cnt,
          );
        }
      }

      const rawStatusCode: unknown = row["statusCode"];
      if (rawStatusCode !== undefined && rawStatusCode !== null) {
        const statusCode: string = String(rawStatusCode);
        statusCounts.set(statusCode, (statusCounts.get(statusCode) || 0) + cnt);
      }
    }

    return { serviceCounts, statusCounts };
  }

  /*
   * Exact root-span vs non-root-span counts over the full window, backing the
   * "Span Type" sidebar facet. Like getResourceFacetCounts this rides the
   * proj_hist_by_minute aggregate projection (isRootSpan is a projection key),
   * so it reads a few pre-aggregated minute rows in single-digit ms rather than
   * scanning raw spans — same toStartOfMinute()/optimize_use_projections
   * requirements apply.
   *
   * rootOnly is deliberately forced OFF here: a facet must not filter by its
   * own dimension, or the unselected bucket would always read 0 and the user
   * could never see how many root vs non-root spans exist (the exact confusion
   * the facet is meant to resolve). Every OTHER active filter (service /
   * status / ...) still applies, so the counts narrow with the rest of the
   * sidebar.
   */
  @CaptureSpan()
  public static async getRootSpanCounts(request: MultiFacetRequest): Promise<{
    rootCount: number;
    nonRootCount: number;
  }> {
    const statement: Statement = new Statement();
    statement.append(
      `SELECT isRootSpan, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.startTime,
      }}) AND toStartOfMinute(startTime) <= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.endTime,
      }})`,
    );

    // Force rootOnly off so both buckets survive (see method comment).
    TraceAggregationService.appendCommonFilters(statement, {
      ...request,
      rootOnly: false,
    });

    statement.append(" GROUP BY isRootSpan");

    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    let rootCount: number = 0;
    let nonRootCount: number = 0;

    // Stopped at the time limit: throws, see getResourceFacetCounts.
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    for (const row of rows) {
      const cnt: number = Number(row["cnt"] || 0);
      const raw: unknown = row["isRootSpan"];
      // ClickHouse Bool may serialize as true/false, 1/0, or "1"/"true".
      const isRoot: boolean =
        raw === true || raw === 1 || raw === "1" || raw === "true";
      if (isRoot) {
        rootCount += cnt;
      } else {
        nonRootCount += cnt;
      }
    }

    return { rootCount, nonRootCount };
  }

  /*
   * Exact has-exception vs no-exception counts over the window, backing the
   * "Has Exception" sidebar facet. Unlike getResourceFacetCounts /
   * getRootSpanCounts, hasException is not a proj_hist_by_minute key, so this
   * is a base-table GROUP BY (still bounded by max_execution_time). It is a
   * single low-cardinality column read, so it is cheap for typical windows;
   * on one too wide to count in time the facet says so.
   *
   * Exactness matters specifically here: exception spans are usually rare, so
   * the recent-N sample (getFacetValuesFromSample) can miss them entirely and
   * report 0 — actively misleading for the one facet whose purpose is to find
   * exceptions. Every active filter (incl. rootOnly) still applies via
   * appendCommonFilters, so the count narrows with the rest of the sidebar.
   */
  @CaptureSpan()
  public static async getHasExceptionCounts(
    request: MultiFacetRequest,
  ): Promise<{
    withExceptionCount: number;
    withoutExceptionCount: number;
  }> {
    const statement: Statement = new Statement();
    statement.append(
      `SELECT hasException, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

    statement.append(TraceAggregationService.RETENTION_FILTER);

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY hasException");

    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    let withExceptionCount: number = 0;
    let withoutExceptionCount: number = 0;

    // Stopped at the time limit: throws, see getResourceFacetCounts.
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    for (const row of rows) {
      const cnt: number = Number(row["cnt"] || 0);
      const raw: unknown = row["hasException"];
      // ClickHouse Bool may serialize as true/false, 1/0, or "1"/"true".
      const hasException: boolean =
        raw === true || raw === 1 || raw === "1" || raw === "true";
      if (hasException) {
        withExceptionCount += cnt;
      } else {
        withoutExceptionCount += cnt;
      }
    }

    return { withExceptionCount, withoutExceptionCount };
  }

  private static mapStatusCodeToSeries(code: number): string {
    if (code === 1) {
      return "ok";
    }
    if (code === 2) {
      return "error";
    }
    return "unset";
  }

  private static buildHistogramStatement(request: HistogramRequest): Statement {
    const intervalSeconds: number = request.bucketSizeInMinutes * 60;

    /*
     * Two-stage aggregation. The inner query groups by minute + statusCode,
     * which exactly matches the proj_hist_by_minute projection. With
     * optimize_use_projections=1 (default in modern ClickHouse), the inner
     * scan reads pre-aggregated rows instead of the 1.8B-row span table —
     * even for multi-week ranges. The outer query then re-buckets the tiny
     * minute-level result to the requested bucket size.
     *
     * The time window is filtered on toStartOfMinute(startTime) — the
     * projection's key expression — NOT raw startTime. A raw startTime
     * predicate references a column the aggregate projection does not store,
     * so ClickHouse rejects proj_hist_by_minute and full-scans the base table
     * (verified: 32M rows / ~220ms vs 1.5K rows / ~6ms with this form). The
     * start edge rounds down to the minute, which is consistent with the
     * minute-bucketed output and only widens the first bucket by the partial
     * boundary minute when the range is not minute-aligned. The end edge
     * keeps every minute that STARTS before the window ends, so a
     * minute-aligned end - what zooming into a bar produces - does not draw
     * an extra bar of spans the list below it does not show (see the log
     * histogram in LogAggregationService for the same rule).
     *
     * If any non-projection filter (kind, name, traceId, spanId,
     * nameSearchText, spanNameSearches, statusMessageSearchText,
     * hasException, duration bounds, entityKeys, attributes) is active,
     * ClickHouse transparently falls back to scanning the main table for the
     * inner query — same cost as before.
     * The retention read-filter is omitted for the same reason (see
     * RETENTION_FILTER).
     */
    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(minute, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket,
        statusCode,
        sum(cnt_minute) AS cnt
      FROM (
        SELECT
          toStartOfMinute(startTime) AS minute,
          statusCode,
          count() AS cnt_minute
        FROM ${TraceAggregationService.TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}
          AND toStartOfMinute(startTime) >= toStartOfMinute(${{
            type: TableColumnType.Date,
            value: request.startTime,
          }})
          AND toStartOfMinute(startTime) < ${{
            type: TableColumnType.DateTime64,
            value: request.endTime,
          }}
    `;

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(
      " GROUP BY minute, statusCode ) GROUP BY bucket, statusCode ORDER BY bucket ASC",
    );

    /*
     * Defense in depth: cap histogram runtime below nginx's 60s
     * proxy_read_timeout, and say so when it is reached (see
     * INTERACTIVE_READ_TIME_LIMIT) rather than draw a chart that looks
     * complete. Explicitly enable projection use.
     */
    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    return statement;
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    // Pre-rename alias from stale clients; the V3 column is primaryEntityId.
    if (request.facetKey === "serviceId") {
      request.facetKey = "primaryEntityId";
    }

    const limit: number =
      request.limit ?? TraceAggregationService.DEFAULT_FACET_LIMIT;

    TraceAggregationService.validateFacetKey(request.facetKey);

    const resourceServiceType: ServiceType | undefined =
      TraceAggregationService.RESOURCE_FACET_KEYS.get(request.facetKey);
    const isResourceFacet: boolean = resourceServiceType !== undefined;
    const isTopLevelColumn: boolean =
      isResourceFacet ||
      TraceAggregationService.isTopLevelColumn(request.facetKey);

    const statement: Statement = new Statement();

    if (isResourceFacet) {
      statement.append(
        SQL`SELECT toString(primaryEntityId) AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
      );
    } else if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
      );
    } else {
      statement.append(
        SQL`SELECT attributes[${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}] AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
      );
    }

    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );

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

    statement.append(TraceAggregationService.RETENTION_FILTER);

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Defense in depth: cap individual facet query runtime below nginx's
     * 60s proxy_read_timeout so a slow facet never starves the endpoint.
     */
    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    return statement;
  }

  /*
   * The spans behind one exception group's occurrences. The subquery is
   * pinned to the request's project; without a project the filter matches
   * nothing rather than widening to every span. GLOBAL IN because both tables
   * are Distributed and shard on different keys: a plain IN is rejected on
   * multi-shard clusters (Code 288) and would be wrong shard-locally.
   */
  public static appendExceptionScopeFilter(
    statement: Statement,
    request: {
      exceptionScope?: ExceptionSpanScope | undefined;
      projectId?: ObjectID | undefined;
    },
  ): void {
    if (!request.exceptionScope) {
      return;
    }

    if (!request.projectId) {
      statement.append(" AND 0");
      return;
    }

    statement.append(
      SQL` AND (traceId, spanId) GLOBAL IN (SELECT traceId, spanId FROM ${AnalyticsTableName.ExceptionInstance} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND fingerprint = ${{
        type: TableColumnType.Text,
        value: request.exceptionScope.fingerprint,
      }}`,
    );

    if (request.exceptionScope.primaryEntityId) {
      statement.append(
        SQL` AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: new ObjectID(request.exceptionScope.primaryEntityId),
        }}`,
      );
    }

    statement.append(")");
  }

  private static appendCommonFilters(
    statement: Statement,
    request: TraceFilters & { projectId?: ObjectID | undefined },
  ): void {
    if (request.rootOnly) {
      statement.append(" AND isRootSpan = 1");
    }

    TraceAggregationService.appendExceptionScopeFilter(statement, request);

    TelemetryReadScopeUtil.appendServiceFilter(statement, request);

    if (request.entityKeys && request.entityKeys.length > 0) {
      statement.append(
        SQL` AND hasAny(entityKeys, ${{
          type: TableColumnType.ArrayText,
          value: request.entityKeys,
        }})`,
      );
    }

    appendResourceScopeFilters(statement, request.resourceScopes);

    if (request.statusCodes && request.statusCodes.length > 0) {
      statement.append(
        SQL` AND statusCode IN (${{
          type: TableColumnType.Number,
          value: new Includes(
            request.statusCodes.map((code: number) => {
              return String(code);
            }),
          ),
        }})`,
      );
    }

    if (request.spanKinds && request.spanKinds.length > 0) {
      statement.append(
        SQL` AND toString(kind) IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanKinds),
        }})`,
      );
    }

    if (request.spanNames && request.spanNames.length > 0) {
      statement.append(
        SQL` AND name IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanNames),
        }})`,
      );
    }

    /*
     * Values are kept verbatim (no trim) — the list-side Search serialization
     * wraps the raw value in %...%, and quoted search values deliberately
     * preserve whitespace. Only blank entries are skipped.
     *
     * Every ILIKE below escapes the user's `%` and `_` so they match
     * literally. The list query escapes centrally (Statement.serializseValue);
     * without the same treatment here a span name like `GET /100%` counted
     * every span in the chart while the table beside it counted only the
     * matching ones.
     */
    if (request.spanNameSearches && request.spanNameSearches.length > 0) {
      for (const search of request.spanNameSearches) {
        if (search.trim().length === 0) {
          continue;
        }
        statement.append(
          SQL` AND name ILIKE ${{
            type: TableColumnType.Text,
            value: `%${escapeIlikePattern(search)}%`,
          }}`,
        );
      }
    }

    if (request.spanIds && request.spanIds.length > 0) {
      statement.append(
        SQL` AND spanId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanIds),
        }})`,
      );
    }

    if (request.traceIds && request.traceIds.length > 0) {
      statement.append(
        SQL` AND traceId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.traceIds),
        }})`,
      );
    }

    if (request.nameSearchText && request.nameSearchText.trim().length > 0) {
      statement.append(
        SQL` AND name ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(request.nameSearchText.trim())}%`,
        }}`,
      );
    }

    if (
      request.statusMessageSearchText &&
      request.statusMessageSearchText.trim().length > 0
    ) {
      statement.append(
        SQL` AND statusMessage ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(request.statusMessageSearchText)}%`,
        }}`,
      );
    }

    if (request.statusMessages && request.statusMessages.length > 0) {
      statement.append(
        SQL` AND statusMessage IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.statusMessages),
        }})`,
      );
    }

    if (request.hasException !== undefined) {
      statement.append(
        request.hasException
          ? " AND hasException = 1"
          : " AND hasException = 0",
      );
    }

    /*
     * durationUnixNano is LongNumber (Int128) — a Number (Int32) param would
     * overflow for spans longer than ~2.1 seconds.
     */
    if (
      request.minDurationNano !== undefined &&
      !isNaN(request.minDurationNano)
    ) {
      statement.append(
        SQL` AND durationUnixNano > ${{
          type: TableColumnType.LongNumber,
          value: request.minDurationNano,
        }}`,
      );
    }

    if (
      request.maxDurationNano !== undefined &&
      !isNaN(request.maxDurationNano)
    ) {
      statement.append(
        SQL` AND durationUnixNano < ${{
          type: TableColumnType.LongNumber,
          value: request.maxDurationNano,
        }}`,
      );
    }

    if (
      request.exactDurationNano !== undefined &&
      !isNaN(request.exactDurationNano)
    ) {
      statement.append(
        SQL` AND durationUnixNano = ${{
          type: TableColumnType.LongNumber,
          value: request.exactDurationNano,
        }}`,
      );
    }

    /*
     * Attribute filters - a value, a list (a multi-select dashboard
     * variable; empty means "no selection"), a blank ("is empty") or an
     * operator row (`@k:api-*`, `@k:~web`, `@k:>5`, ...) - compiled exactly
     * as the log and metric charts compile them, keys matched
     * case-insensitively and an exact value looked up in the attribute value
     * index first (#4706). See AttributeFilterStatement.
     */
    appendAttributeFilters({
      statement: statement,
      attributes: request.attributes,
      validateKey: (attributeKey: string): void => {
        TraceAggregationService.validateFacetKey(attributeKey);
      },
    });

    if (
      request.attributeSearches &&
      Object.keys(request.attributeSearches).length > 0
    ) {
      for (const [attrKey, attrValue] of Object.entries(
        request.attributeSearches,
      )) {
        TraceAggregationService.validateFacetKey(attrKey);

        if (attrValue.trim().length === 0) {
          continue;
        }

        /*
         * Same key matching as `attributes`, contains-match on the value,
         * `%`/`_` escaped so they match literally (see spanNameSearches).
         *
         * Kept alongside the operator dispatch above because saved views and
         * existing deep links still send this channel; a Search operator in
         * `attributes` compiles to exactly the same predicate.
         */
        statement.append(
          SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
            type: TableColumnType.Text,
            value: attrKey,
          }}) AND v ILIKE ${{
            type: TableColumnType.Text,
            value: `%${escapeIlikePattern(attrValue)}%`,
          }}, mapKeys(attributes), mapValues(attributes))`,
        );
      }
    }
  }

  private static readonly DEFAULT_ANALYTICS_LIMIT: number = 10;
  private static readonly MAX_GROUP_BY_DIMENSIONS: number = 2;

  /*
   * Metric → ClickHouse aggregate expression. Values are an allowlist — the
   * expression is interpolated into SQL, so it must never come from user
   * input directly. Durations are converted to milliseconds.
   */
  private static readonly METRIC_EXPRESSIONS: Record<
    TraceAnalyticsMetric,
    string
  > = {
    count: "count()",
    errorCount: "countIf(statusCode = 2)",
    avgDuration: "avg(durationUnixNano) / 1000000",
    minDuration: "min(durationUnixNano) / 1000000",
    maxDuration: "max(durationUnixNano) / 1000000",
    p50Duration: "quantile(0.5)(durationUnixNano) / 1000000",
    p90Duration: "quantile(0.9)(durationUnixNano) / 1000000",
    p95Duration: "quantile(0.95)(durationUnixNano) / 1000000",
    p99Duration: "quantile(0.99)(durationUnixNano) / 1000000",
  };

  public static isValidAnalyticsMetric(
    metric: string,
  ): metric is TraceAnalyticsMetric {
    return Object.prototype.hasOwnProperty.call(
      TraceAggregationService.METRIC_EXPRESSIONS,
      metric,
    );
  }

  /*
   * Multidimensional span analytics — the interactive "split by dimension"
   * path (count / duration percentiles grouped by a span column or
   * attribute). Mirrors the logs analytics architecture
   * (LogAggregationService.getAnalyticsTimeseries and friends) and shares
   * appendCommonFilters with the histogram/facets, so every explorer filter
   * applies identically.
   *
   * A resource dimension (rumApplicationId, hostId, kubernetesClusterId, …)
   * selects the bare `toString(primaryEntityId)`, so grouping by one returns
   * internal ObjectIDs. Nothing downstream turns those into names: the traces
   * explorer resolves only its own `primaryEntityId` split, client-side, and
   * the dashboard TraceChart / TraceTable widgets have no equivalent — so the
   * raw id reaches the chart legend, the tooltip series name and the table
   * cell. Resolve them here, once per query, through the same resolver the
   * facet sidebar uses.
   *
   * Deliberately NOT applied to getAnalyticsTopList: the timeseries path
   * feeds that method's values straight back into the query as an IN filter
   * (see getAnalyticsTimeseries), and the AI latency detectors match on them,
   * so those must stay raw.
   *
   * Unresolvable ids — a deleted resource, or one past the resolver's page
   * size — keep their raw value rather than vanishing from the result.
   */
  private static async applyResourceDisplayValues<
    TRow extends { groupValues: Record<string, string> },
  >(
    projectId: ObjectID,
    groupByKeys: Array<string>,
    rows: Array<TRow>,
  ): Promise<Array<TRow>> {
    /*
     * Both memberships are required, and the two sets genuinely differ:
     *
     * - Every resource dimension here is a ResourceFacetCatalog type, and
     *   the resolver lists every catalog type from Postgres, so all of them
     *   (Proxmox / vCenter / Ceph / Docker Swarm / IoT fleet included) come
     *   back with display names.
     * - `primaryEntityId` / `serviceId` are resolvable but are NOT resource
     *   dimensions here — they select the OpenTelemetry-service slot, and
     *   the traces explorer already resolves that split client-side
     *   (TracesAnalyticsView's serviceNameMap). Renaming their values
     *   server-side would change an existing surface for no gain.
     *
     * Taking the intersection keeps a dimension this service learns before
     * the resolver does from costing a round-trip that could only leave
     * the cell raw.
     */
    const resourceKeys: Array<string> = groupByKeys.filter(
      (key: string): boolean => {
        return (
          TraceAggregationService.RESOURCE_FACET_KEYS.has(key) &&
          ResourceFacetResolver.isResourceFacet(key)
        );
      },
    );

    if (resourceKeys.length === 0 || rows.length === 0) {
      return rows;
    }

    const specs: Array<ResourceFacetSpec> = resourceKeys.map(
      (key: string): ResourceFacetSpec => {
        const counts: Map<string, number> = new Map();

        for (const row of rows) {
          const raw: string | undefined = row.groupValues[key];
          if (raw) {
            counts.set(raw, (counts.get(raw) || 0) + 1);
          }
        }

        return { facetKey: key, counts: counts };
      },
    );

    let resolved: Record<string, Array<ResolvedFacetValue>> = {};

    try {
      resolved = await ResourceFacetResolver.resolve(projectId, specs);
    } catch (err: unknown) {
      logger.warn(
        `Could not resolve resource display names for trace analytics group-by; falling back to raw ids: ${err}`,
      );
      return rows;
    }

    const displayNamesByKey: Map<string, Map<string, string>> = new Map();

    for (const key of resourceKeys) {
      const displayNames: Map<string, string> = new Map();

      for (const entry of resolved[key] || []) {
        if (entry.displayName) {
          displayNames.set(entry.value, entry.displayName);
        }
      }

      displayNamesByKey.set(key, displayNames);
    }

    for (const row of rows) {
      for (const key of resourceKeys) {
        const raw: string | undefined = row.groupValues[key];
        const displayName: string | undefined = raw
          ? displayNamesByKey.get(key)?.get(raw)
          : undefined;

        if (displayName) {
          row.groupValues[key] = displayName;
        }
      }
    }

    return rows;
  }

  @CaptureSpan()
  public static async getAnalyticsTimeseries(
    request: TraceAnalyticsRequest,
  ): Promise<Array<TraceAnalyticsTimeseriesRow>> {
    const groupByKeys: Array<string> = request.groupBy || [];

    /*
     * Cap the series count: a high-cardinality dimension (e.g. url.host
     * across hundreds of tenants) would otherwise return one series per
     * value. Pre-resolve the top values of the first dimension — ranked by
     * the SELECTED metric (so duration metrics chart the slowest dimension
     * values, counts chart the busiest) — and constrain the timeseries to
     * them. The full groupBy is passed so the ranking applies the same
     * dimension-implied predicates (e.g. mapContains on the second
     * dimension) as the final query.
     */
    let topValues: Array<string> | undefined = undefined;
    if (groupByKeys.length > 0) {
      const topItems: Array<TraceAnalyticsTopItem> =
        await TraceAggregationService.getAnalyticsTopList(request);

      topValues = topItems.map((item: TraceAnalyticsTopItem): string => {
        return item.value;
      });

      /*
       * No non-empty values → skip the cap rather than returning nothing:
       * spans whose dimension value is an empty string still chart (as one
       * "(empty)" series), consistent with the table view.
       */
      if (topValues.length === 0) {
        topValues = undefined;
      }
    }

    const statement: Statement =
      TraceAggregationService.buildAnalyticsTimeseriesStatement(
        request,
        topValues,
      );

    // Stopped at the time limit: throws, rather than chart an empty window.
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    const timeseriesRows: Array<TraceAnalyticsTimeseriesRow> = rows.map(
      (row: JSONObject): TraceAnalyticsTimeseriesRow => {
        const groupValues: Record<string, string> = {};

        for (const [index, key] of groupByKeys.entries()) {
          const alias: string = TraceAggregationService.groupByAlias(
            key,
            index,
          );
          groupValues[key] = String(row[alias] ?? "");
        }

        return {
          time: String(row["bucket"] || ""),
          value: Number(row["val"] || 0),
          groupValues,
        };
      },
    );

    return TraceAggregationService.applyResourceDisplayValues(
      request.projectId,
      groupByKeys,
      timeseriesRows,
    );
  }

  @CaptureSpan()
  public static async getAnalyticsTopList(
    request: TraceAnalyticsRequest,
  ): Promise<Array<TraceAnalyticsTopItem>> {
    if (!request.groupBy || request.groupBy.length === 0) {
      throw new BadDataException(
        "groupBy with at least one dimension is required for top list",
      );
    }

    const statement: Statement =
      TraceAggregationService.buildAnalyticsTopListStatement(request);

    // Stopped at the time limit: throws, rather than list nothing.
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    return rows
      .map((row: JSONObject): TraceAnalyticsTopItem => {
        return {
          value: String(row["dim"] ?? ""),
          metricValue: Number(row["val"] || 0),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((item: TraceAnalyticsTopItem): boolean => {
        return item.value.length > 0;
      });
  }

  @CaptureSpan()
  public static async getAnalyticsTable(
    request: TraceAnalyticsRequest,
  ): Promise<Array<TraceAnalyticsTableRow>> {
    if (!request.groupBy || request.groupBy.length === 0) {
      throw new BadDataException(
        "groupBy with at least one dimension is required for table",
      );
    }

    const statement: Statement =
      TraceAggregationService.buildAnalyticsTableStatement(request);

    // Stopped at the time limit: throws, rather than list nothing.
    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();
    const rows: Array<JSONObject> = response.data || [];

    const groupByKeys: Array<string> = request.groupBy;

    const tableRows: Array<TraceAnalyticsTableRow> = rows.map(
      (row: JSONObject): TraceAnalyticsTableRow => {
        const groupValues: Record<string, string> = {};

        for (const [index, key] of groupByKeys.entries()) {
          const alias: string = TraceAggregationService.groupByAlias(
            key,
            index,
          );
          groupValues[key] = String(row[alias] ?? "");
        }

        return {
          groupValues,
          count: Number(row["cnt"] || 0),
          errorCount: Number(row["err_cnt"] || 0),
          avgDurationMs: Number(row["avg_ms"] || 0),
          p50DurationMs: Number(row["p50_ms"] || 0),
          p90DurationMs: Number(row["p90_ms"] || 0),
          p95DurationMs: Number(row["p95_ms"] || 0),
          p99DurationMs: Number(row["p99_ms"] || 0),
          minDurationMs: Number(row["min_ms"] || 0),
          maxDurationMs: Number(row["max_ms"] || 0),
        };
      },
    );

    return TraceAggregationService.applyResourceDisplayValues(
      request.projectId,
      groupByKeys,
      tableRows,
    );
  }

  /*
   * Wall-clock cap for the latency-profile query — same 45s ceiling as the
   * other projection-served reads (below nginx's 60s proxy_read_timeout).
   */
  private static readonly LATENCY_PROFILE_MAX_EXECUTION_SECONDS: number = 45;

  /*
   * Partial-result heuristic. With timeout_overflow_mode='break' ClickHouse
   * checks the deadline BETWEEN blocks and then returns a well-formed JSON
   * body holding partial aggregates — there is no flag in the payload and no
   * exception to catch. The only signal available on the response is
   * `statistics.elapsed`: a query that was cut off necessarily burned (very
   * nearly) its whole budget, while a projection-served profile completes in
   * single-digit ms. Anything at or past this fraction of the cap is treated
   * as "may be partial". False positives are harmless here — the caller skips
   * one 15-minute tick; false negatives are what we must not have.
   */
  private static readonly LATENCY_PROFILE_PARTIAL_ELAPSED_RATIO: number = 0.9;

  /*
   * Which operations of these services run which code, from their recent
   * spans that say where they were started (code.filepath / code.file.path,
   * code.function / code.function.name) - what a production review of a
   * pull request matches the files and functions it changes against.
   *
   * Unattended, and asked for a repository at most every half hour, so it
   * reads little: only granules that hold one of the keys (has() on
   * attributeKeys is what idx_attribute_keys answers, so a project whose
   * spans carry none reads almost nothing), at most `sampleSize` spans of
   * them (no ORDER BY in the inner read, so ClickHouse stops as soon as it
   * has them), four threads and small blocks, and it stops with an error
   * at its time limit rather than answer with part of the groups.
   */
  @CaptureSpan()
  public static async getCodeLocationSample(
    request: CodeLocationSampleRequest,
  ): Promise<Array<CodeLocationSampleRow>> {
    if (request.serviceIds.length === 0) {
      return [];
    }

    const statement: Statement =
      TraceAggregationService.buildCodeLocationSampleStatement(request);

    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): CodeLocationSampleRow => {
        return {
          serviceId: String(row["serviceId"] || "").toLowerCase(),
          name: String(row["name"] || ""),
          filePath: String(row["f1"] || row["f2"] || ""),
          functionName: String(row["fn1"] || row["fn2"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((row: CodeLocationSampleRow): boolean => {
        return (
          Boolean(row.serviceId) &&
          Boolean(row.name) &&
          (Boolean(row.filePath) || Boolean(row.functionName))
        );
      });
  }

  public static buildCodeLocationSampleStatement(
    request: CodeLocationSampleRequest,
  ): Statement {
    const [oldFileKey, newFileKey] = CODE_FILE_PATH_ATTRIBUTE_KEYS as [
      string,
      string,
    ];
    const [oldFunctionKey, newFunctionKey] = CODE_FUNCTION_ATTRIBUTE_KEYS as [
      string,
      string,
    ];

    const statement: Statement = SQL`SELECT serviceId, name, f1, f2, fn1, fn2, count() AS cnt FROM (SELECT toString(primaryEntityId) AS serviceId, name, attributes[${{
      type: TableColumnType.Text,
      value: oldFileKey,
    }}] AS f1, attributes[${{
      type: TableColumnType.Text,
      value: newFileKey,
    }}] AS f2, attributes[${{
      type: TableColumnType.Text,
      value: oldFunctionKey,
    }}] AS fn1, attributes[${{
      type: TableColumnType.Text,
      value: newFunctionKey,
    }}] AS fn2 FROM ${TraceAggregationService.TABLE_NAME} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: request.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: request.startTime,
    }} AND startTime <= ${{
      type: TableColumnType.Date,
      value: request.endTime,
    }} AND (has(attributeKeys, ${{
      type: TableColumnType.Text,
      value: oldFileKey,
    }}) OR has(attributeKeys, ${{
      type: TableColumnType.Text,
      value: newFileKey,
    }}) OR has(attributeKeys, ${{
      type: TableColumnType.Text,
      value: oldFunctionKey,
    }}) OR has(attributeKeys, ${{
      type: TableColumnType.Text,
      value: newFunctionKey,
    }}))`;

    TelemetryReadScopeUtil.appendServiceFilter(statement, {
      serviceIds: request.serviceIds,
    });

    statement.append(TraceAggregationService.RETENTION_FILTER);

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: request.sampleSize,
      }}) GROUP BY serviceId, name, f1, f2, fn1, fn2 ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit,
      }}`,
    );

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: CODE_LOCATION_SAMPLE_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  /**
   * Per-service span volume + p99 latency over the whole window, served by
   * the proj_agg_by_service aggregate projection (projectId,
   * primaryEntityId, toStartOfMinute(startTime) -> count() /
   * avg(durationUnixNano) / quantile(0.99)(durationUnixNano)).
   *
   * This exists because getAnalyticsTable CANNOT be projection-served: its
   * stat set (countIf / p50 / p90 / p95 / min / max) has no stored state,
   * its time predicate is on raw startTime, and it carries the
   * retentionDate filter — any one of those forces a full base-table scan.
   * That is fine for a human staring at the trace explorer and fatal for an
   * unattended 15-minute scanner: a 25-hour raw-span GROUP BY per project
   * per tick, which on the largest tenants hits the execution cap and comes
   * back silently partial.
   *
   * Four things are load-bearing for the optimizer to pick the projection —
   * changing any of them silently reverts this to a full scan:
   *   1. The time predicates must be written over toStartOfMinute(startTime)
   *      — the projection's key expression — never raw startTime.
   *   2. The aggregates must BYTE-MATCH stored expressions: count() and
   *      quantile(0.99)(durationUnixNano). The ns->ms division is therefore
   *      done in TS below, NOT folded into the aggregate expression.
   *   3. GROUP BY must stay a subset of the projection's grouping keys.
   *      Dropping `minute` merges the per-minute aggregate STATES into a
   *      whole-window value (the same subset-group-by getResourceFacetCounts
   *      does against proj_hist_by_minute).
   *   4. Every predicate must be on a projection column — so NO
   *      RETENTION_FILTER (retentionDate is not stored by this projection)
   *      and no statusCode / name / attribute filters.
   *
   * Trade-off, identical to the other projection paths: window edges round
   * to the minute, and rows past their per-service retention that have not
   * yet dropped with their part are still counted. Irrelevant to a p99
   * ratio between two windows.
   */
  @CaptureSpan()
  public static async getServiceLatencyProfile(
    request: ServiceLatencyProfileRequest,
  ): Promise<ServiceLatencyProfile> {
    const statement: Statement = new Statement();
    statement.append(
      `SELECT primaryEntityId, count() AS cnt, quantile(0.99)(durationUnixNano) AS p99_ns FROM ${TraceAggregationService.TABLE_NAME}`,
    );

    /*
     * Half-open window (`<` on the end). The caller runs two adjacent
     * windows (recent hour, prior 24h) whose boundary minute would
     * otherwise be counted in BOTH.
     */
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.startTime,
      }}) AND toStartOfMinute(startTime) < toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.endTime,
      }})`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, {
      serviceIds: request.serviceIds,
    });

    // Ranked by volume: a p99 regression on the busiest services is the one that hurts.
    statement.append(
      SQL` GROUP BY primaryEntityId ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit,
      }}`,
    );

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds:
          TraceAggregationService.LATENCY_PROFILE_MAX_EXECUTION_SECONDS,
        timeoutOverflowMode: "break",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    let elapsedSeconds: number = 0;

    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
      elapsedSeconds = Number(response.statistics?.elapsed || 0);
    } catch {
      /*
       * 'break' mode can also truncate the JSON body outright. Unparseable
       * IS partial — report it as such rather than handing back an empty
       * profile the caller would read as "this project has no traffic".
       */
      logger.warn(
        "Service latency profile query returned unparseable response, reporting a partial result",
      );
      return { rows: [], isPartial: true };
    }

    const isPartial: boolean =
      elapsedSeconds >=
      TraceAggregationService.LATENCY_PROFILE_MAX_EXECUTION_SECONDS *
        TraceAggregationService.LATENCY_PROFILE_PARTIAL_ELAPSED_RATIO;

    return {
      rows: rows
        .map((row: JSONObject): ServiceLatencyProfileRow => {
          return {
            primaryEntityId: String(row["primaryEntityId"] ?? ""),
            count: Number(row["cnt"] || 0),
            // ns -> ms here, NOT in the aggregate expression (see above).
            p99DurationMs: Number(row["p99_ns"] || 0) / 1000000,
          };
        })
        .filter((row: ServiceLatencyProfileRow): boolean => {
          return row.primaryEntityId.length > 0;
        }),
      isPartial,
    };
  }

  /*
   * The most rows the span health read groups: a service's spans fall in at
   * most six (three statuses, root or not), so this bounds it to some
   * thousand services and resources.
   */
  private static readonly SPAN_HEALTH_MAX_ROWS: number = 6000;

  /**
   * Per-service span counts over the whole window - every span, the failed
   * ones (statusCode 2, an error) and the root ones - served by the
   * proj_hist_by_minute aggregate projection (projectId, minute,
   * primaryEntityId, statusCode, isRootSpan -> count()): the Traces
   * product's AI section reads every service's at once, once an hour,
   * unattended (Utils/Traces/TraceInsight).
   *
   * The same rules hold as for getServiceLatencyProfile, for the same
   * reason - each one, broken, silently reverts this to a full scan: the
   * time predicates are written over toStartOfMinute(startTime), the
   * aggregate is the stored count(), the GROUP BY is a subset of the
   * projection's keys, and every predicate is on a projection column (no
   * retention filter). It stops with an error at its time limit rather
   * than answer with part of the counts: a share computed over part of the
   * window is wrong, not smaller.
   */
  @CaptureSpan()
  public static async getServiceSpanHealth(
    request: ServiceSpanHealthRequest,
  ): Promise<Array<ServiceSpanHealthRow>> {
    const statement: Statement = new Statement();
    statement.append(
      `SELECT primaryEntityId, statusCode, isRootSpan, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
    );

    // Half-open window, as the latency profile's.
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.startTime,
      }}) AND toStartOfMinute(startTime) < toStartOfMinute(${{
        type: TableColumnType.Date,
        value: request.endTime,
      }})`,
    );

    statement.append(
      SQL` GROUP BY primaryEntityId, statusCode, isRootSpan LIMIT ${{
        type: TableColumnType.Number,
        value: TraceAggregationService.SPAN_HEALTH_MAX_ROWS,
      }}`,
    );

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds:
          TraceAggregationService.LATENCY_PROFILE_MAX_EXECUTION_SECONDS,
        timeoutOverflowMode: "throw",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    const dbResult: Results = await SpanService.executeQuery(statement);

    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return TraceAggregationService.toServiceSpanHealth(
      response.data || [],
      request.limit,
    );
  }

  /*
   * The grouped rows, summed per service - busiest first, then by id - and
   * cut to the limit. Pure.
   */
  public static toServiceSpanHealth(
    rows: Array<JSONObject>,
    limit: number,
  ): Array<ServiceSpanHealthRow> {
    const byService: Map<string, ServiceSpanHealthRow> = new Map<
      string,
      ServiceSpanHealthRow
    >();

    for (const row of rows) {
      const entityId: string = String(row["primaryEntityId"] ?? "")
        .trim()
        .toLowerCase();

      if (!entityId) {
        continue;
      }

      const count: number = Number(row["cnt"] || 0);

      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }

      const health: ServiceSpanHealthRow = byService.get(entityId) || {
        primaryEntityId: entityId,
        spanCount: 0,
        failedSpanCount: 0,
        rootSpanCount: 0,
      };

      const rawRoot: unknown = row["isRootSpan"];
      // ClickHouse Bool may serialize as true/false, 1/0, or "1"/"true".
      const isRoot: boolean =
        rawRoot === true ||
        rawRoot === 1 ||
        rawRoot === "1" ||
        rawRoot === "true";

      health.spanCount += count;

      if (Number(row["statusCode"]) === 2) {
        health.failedSpanCount += count;
      }

      if (isRoot) {
        health.rootSpanCount += count;
      }

      byService.set(entityId, health);
    }

    return Array.from(byService.values())
      .sort((a: ServiceSpanHealthRow, b: ServiceSpanHealthRow): number => {
        return (
          b.spanCount - a.spanCount ||
          a.primaryEntityId.localeCompare(b.primaryEntityId)
        );
      })
      .slice(0, Math.max(0, limit));
  }

  private static groupByAlias(key: string, index: number): string {
    if (
      TraceAggregationService.isTopLevelColumn(key) ||
      TraceAggregationService.RESOURCE_FACET_KEYS.has(key)
    ) {
      return key;
    }

    /*
     * Attribute keys get a sanitized alias. The dimension index is included
     * so two distinct keys that sanitize identically (url.host vs url:host)
     * never collide into one alias (ClickHouse rejects duplicate aliases).
     */
    return `attr_${index}_${key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  }

  /*
   * Append the SELECT expression for one group-by dimension. Resource facet
   * keys (hostId / dockerHostId / ...) read out of primaryEntityId — the
   * matching primaryEntityType predicate is added by
   * appendGroupByDimensionFilters.
   */
  private static appendGroupBySelect(
    statement: Statement,
    groupByKeys: Array<string>,
  ): void {
    for (const [index, key] of groupByKeys.entries()) {
      TraceAggregationService.validateFacetKey(key);

      if (TraceAggregationService.RESOURCE_FACET_KEYS.has(key)) {
        statement.append(`, toString(primaryEntityId) AS ${key}`);
      } else if (TraceAggregationService.isTopLevelColumn(key)) {
        statement.append(`, toString(${key}) AS ${key}`);
      } else {
        const alias: string = TraceAggregationService.groupByAlias(key, index);
        statement.append(
          SQL`, attributes[${{
            type: TableColumnType.Text,
            value: key,
          }}] AS ${alias}`,
        );
      }
    }
  }

  private static appendGroupByClause(
    statement: Statement,
    groupByKeys: Array<string>,
  ): void {
    for (const [index, key] of groupByKeys.entries()) {
      statement.append(`, ${TraceAggregationService.groupByAlias(key, index)}`);
    }
  }

  /*
   * Dimension-implied WHERE predicates: attribute dimensions only count
   * spans that carry the attribute (matching buildFacetStatement); resource
   * dimensions constrain primaryEntityType to the matching resource type.
   */
  private static appendGroupByDimensionFilters(
    statement: Statement,
    groupByKeys: Array<string>,
  ): void {
    for (const key of groupByKeys) {
      const resourceType: ServiceType | undefined =
        TraceAggregationService.RESOURCE_FACET_KEYS.get(key);

      if (resourceType !== undefined) {
        statement.append(
          SQL` AND primaryEntityType = ${{
            type: TableColumnType.Text,
            value: resourceType as string,
          }}`,
        );
        continue;
      }

      if (key === "primaryEntityId") {
        /*
         * Same restriction as the Service facet: keep resource entity ids
         * (host / docker / k8s / ...) out of the "Service" dimension (they
         * reuse the primaryEntityId slot, disambiguated by
         * primaryEntityType).
         */
        statement.append(
          SQL` AND (primaryEntityType = '' OR primaryEntityType = ${{
            type: TableColumnType.Text,
            value: ServiceType.OpenTelemetry as string,
          }})`,
        );
        continue;
      }

      if (TraceAggregationService.isTopLevelColumn(key)) {
        continue;
      }

      statement.append(
        SQL` AND mapContains(attributes, ${{
          type: TableColumnType.Text,
          value: key,
        }})`,
      );
    }
  }

  private static validateGroupBy(groupBy: Array<string> | undefined): void {
    if (!groupBy) {
      return;
    }

    if (groupBy.length > TraceAggregationService.MAX_GROUP_BY_DIMENSIONS) {
      throw new BadDataException(
        `groupBy supports at most ${TraceAggregationService.MAX_GROUP_BY_DIMENSIONS} dimensions`,
      );
    }

    for (const key of groupBy) {
      TraceAggregationService.validateFacetKey(key);
    }
  }

  private static getMetricExpression(metric: TraceAnalyticsMetric): string {
    const expression: string | undefined =
      TraceAggregationService.METRIC_EXPRESSIONS[metric];

    if (!expression) {
      throw new BadDataException("Invalid analytics metric");
    }

    return expression;
  }

  private static appendAnalyticsTimeWindow(
    statement: Statement,
    request: TraceAnalyticsRequest,
  ): void {
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: request.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: request.endTime,
      }}`,
    );
  }

  private static buildAnalyticsTimeseriesStatement(
    request: TraceAnalyticsRequest,
    topDimensionValues?: Array<string> | undefined,
  ): Statement {
    TraceAggregationService.validateGroupBy(request.groupBy);

    const groupByKeys: Array<string> = request.groupBy || [];
    const intervalSeconds: number = request.bucketSizeInMinutes * 60;
    const metricExpr: string = TraceAggregationService.getMetricExpression(
      request.metric,
    );

    const statement: Statement = SQL`SELECT toStartOfInterval(startTime, INTERVAL ${{
      type: TableColumnType.Number,
      value: intervalSeconds,
    }} SECOND) AS bucket`;

    statement.append(`, ${metricExpr} AS val`);

    TraceAggregationService.appendGroupBySelect(statement, groupByKeys);

    statement.append(` FROM ${TraceAggregationService.TABLE_NAME}`);

    TraceAggregationService.appendAnalyticsTimeWindow(statement, request);

    statement.append(TraceAggregationService.RETENTION_FILTER);

    TraceAggregationService.appendGroupByDimensionFilters(
      statement,
      groupByKeys,
    );

    /*
     * Series cap: constrain the first dimension to the pre-resolved top
     * values (see getAnalyticsTimeseries).
     */
    if (
      topDimensionValues &&
      topDimensionValues.length > 0 &&
      groupByKeys.length > 0
    ) {
      TraceAggregationService.appendDimensionExpression(
        statement,
        groupByKeys[0]!,
        " AND ",
      );
      statement.append(
        SQL` IN (${{
          type: TableColumnType.Text,
          value: new Includes(topDimensionValues),
        }})`,
      );
    }

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY bucket");
    TraceAggregationService.appendGroupByClause(statement, groupByKeys);
    statement.append(" ORDER BY bucket ASC");

    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    return statement;
  }

  /*
   * Append the bare dimension expression (no alias) prefixed by `prefix` —
   * used in WHERE clauses where SELECT aliases are not yet visible.
   */
  private static appendDimensionExpression(
    statement: Statement,
    key: string,
    prefix: string,
  ): void {
    TraceAggregationService.validateFacetKey(key);

    if (
      TraceAggregationService.RESOURCE_FACET_KEYS.has(key) ||
      key === "primaryEntityId"
    ) {
      statement.append(`${prefix}toString(primaryEntityId)`);
      return;
    }

    if (TraceAggregationService.isTopLevelColumn(key)) {
      statement.append(`${prefix}toString(${key})`);
      return;
    }

    statement.append(`${prefix}attributes[`);
    statement.append(
      SQL`${{
        type: TableColumnType.Text,
        value: key,
      }}`,
    );
    statement.append("]");
  }

  private static buildAnalyticsTopListStatement(
    request: TraceAnalyticsRequest,
  ): Statement {
    const groupByKey: string = request.groupBy![0]!;
    TraceAggregationService.validateFacetKey(groupByKey);

    const limit: number =
      request.limit ?? TraceAggregationService.DEFAULT_ANALYTICS_LIMIT;
    const metricExpr: string = TraceAggregationService.getMetricExpression(
      request.metric,
    );

    const statement: Statement = new Statement();
    statement.append("SELECT");
    TraceAggregationService.appendDimensionExpression(
      statement,
      groupByKey,
      " ",
    );
    statement.append(
      ` AS dim, ${metricExpr} AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
    );

    TraceAggregationService.appendAnalyticsTimeWindow(statement, request);

    statement.append(TraceAggregationService.RETENTION_FILTER);

    /*
     * Dimension-implied predicates for EVERY groupBy key — when this query
     * pre-resolves the series cap for a two-dimension timeseries, the
     * ranking must count the same span set the final chart counts.
     */
    TraceAggregationService.appendGroupByDimensionFilters(
      statement,
      request.groupBy!,
    );

    TraceAggregationService.appendCommonFilters(statement, request);

    /*
     * Duration metrics rank by the metric itself (slowest first); count-like
     * metrics rank by volume. Either way `cnt` is returned for context.
     */
    statement.append(
      SQL` GROUP BY dim ORDER BY val DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    return statement;
  }

  private static buildAnalyticsTableStatement(
    request: TraceAnalyticsRequest,
  ): Statement {
    TraceAggregationService.validateGroupBy(request.groupBy);

    const groupByKeys: Array<string> = request.groupBy!;
    const limit: number =
      request.limit ?? TraceAggregationService.DEFAULT_ANALYTICS_LIMIT;

    /*
     * The "top dimensions" table always carries the full stat set (count,
     * errors, avg, p50/p90/p95/p99, min, max) — one query answers "requests,
     * errors and tail latency per tenant" without a follow-up. errorCount
     * mirrors the METRIC_EXPRESSIONS convention: statusCode = 2 is an error.
     */
    const statement: Statement = new Statement();
    statement.append(
      "SELECT count() AS cnt" +
        ", countIf(statusCode = 2) AS err_cnt" +
        ", avg(durationUnixNano) / 1000000 AS avg_ms" +
        ", quantile(0.5)(durationUnixNano) / 1000000 AS p50_ms" +
        ", quantile(0.9)(durationUnixNano) / 1000000 AS p90_ms" +
        ", quantile(0.95)(durationUnixNano) / 1000000 AS p95_ms" +
        ", quantile(0.99)(durationUnixNano) / 1000000 AS p99_ms" +
        ", min(durationUnixNano) / 1000000 AS min_ms" +
        ", max(durationUnixNano) / 1000000 AS max_ms",
    );

    TraceAggregationService.appendGroupBySelect(statement, groupByKeys);

    statement.append(` FROM ${TraceAggregationService.TABLE_NAME}`);

    TraceAggregationService.appendAnalyticsTimeWindow(statement, request);

    statement.append(TraceAggregationService.RETENTION_FILTER);

    TraceAggregationService.appendGroupByDimensionFilters(
      statement,
      groupByKeys,
    );

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY");
    let first: boolean = true;
    for (const [index, key] of groupByKeys.entries()) {
      statement.append(
        `${first ? " " : ", "}${TraceAggregationService.groupByAlias(key, index)}`,
      );
      first = false;
    }

    statement.append(
      ` ORDER BY ${TraceAggregationService.getAnalyticsTableOrderBy(
        request.tableSort,
        TraceAggregationService.groupByAlias(groupByKeys[0] as string, 0),
      )}`,
    );

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
      }),
    );

    return statement;
  }

  /*
   * The trace table's ORDER BY: the busiest groups first, as it always
   * ranked them, or the column a request names from the fixed list
   * (TRACE_ANALYTICS_TABLE_SORT_ALIASES), busiest first among ties. Built
   * from that list and the group's own alias only - never from text a
   * request sends.
   */
  private static getAnalyticsTableOrderBy(
    tableSort: TraceAnalyticsTableSort | undefined,
    groupAlias: string,
  ): string {
    const sort: TraceAnalyticsTableSort | null = tableSort
      ? parseTraceAnalyticsTableSort(tableSort.column, tableSort.direction)
      : null;

    if (!sort) {
      return "cnt DESC";
    }

    const direction: string = sort.direction === "asc" ? "ASC" : "DESC";

    const alias: string =
      sort.column === TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY
        ? groupAlias
        : (TRACE_ANALYTICS_TABLE_SORT_ALIASES[sort.column] as string);

    if (alias === "cnt") {
      return `cnt ${direction}`;
    }

    return `${alias} ${direction}, cnt DESC`;
  }

  private static isTopLevelColumn(key: string): boolean {
    return TraceAggregationService.TOP_LEVEL_COLUMNS.has(key);
  }

  private static validateFacetKey(
    facetKey: unknown,
  ): asserts facetKey is string {
    if (typeof facetKey !== "string") {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      facetKey.length === 0 ||
      facetKey.length > TraceAggregationService.MAX_FACET_KEY_LENGTH
    ) {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      TraceAggregationService.isTopLevelColumn(facetKey) ||
      TraceAggregationService.RESOURCE_FACET_KEYS.has(facetKey)
    ) {
      return;
    }

    if (!TraceAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default TraceAggregationService;
