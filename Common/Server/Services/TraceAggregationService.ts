import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import SpanService from "./SpanService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import logger from "../Utils/Logger";
import ServiceType from "../../Types/Telemetry/ServiceType";

export interface HistogramBucket {
  time: string;
  series: string;
  count: number;
}

export interface TraceFilters {
  serviceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
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
   * Strict bounds (`>` / `<`) — the list compiles duration:>N / duration:<N
   * to GreaterThan / LessThan, which are strict comparisons. `duration:N`
   * (no operator) is exact equality, carried by exactDurationNano.
   */
  minDurationNano?: number | undefined;
  maxDurationNano?: number | undefined;
  exactDurationNano?: number | undefined;
  rootOnly?: boolean | undefined;
  attributes?: Record<string, string> | undefined;
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
   * `primaryEntityId` slot is reused for host / docker host / k8s cluster
   * ids, disambiguated by the `primaryEntityType` discriminator.
   */
  private static readonly RESOURCE_FACET_KEYS: Map<string, ServiceType> =
    new Map([
      ["hostId", ServiceType.Host],
      ["dockerHostId", ServiceType.DockerHost],
      ["podmanHostId", ServiceType.PodmanHost],
      ["kubernetesClusterId", ServiceType.KubernetesCluster],
      ["proxmoxClusterId", ServiceType.ProxmoxCluster],
      ["cephClusterId", ServiceType.CephCluster],
      ["serverlessFunctionId", ServiceType.ServerlessFunction],
      ["cloudResourceId", ServiceType.CloudResource],
      ["rumApplicationId", ServiceType.RealUserMonitor],
    ]);
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

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      /*
       * When max_execution_time fires with timeout_overflow_mode='break',
       * ClickHouse may return a truncated JSON response. Return an empty
       * histogram rather than failing — the user still sees the span list.
       */
      logger.warn(
        "Histogram query returned unparseable response, returning empty result",
      );
    }

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
   * in Node.js. This avoids ClickHouse GROUP BY aggregations that can't
   * return partial results under max_execution_time 'break' mode, and
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
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
   * count map correctly serves the service / host / docker host / k8s cluster
   * facets once merged against each Postgres source-of-truth list (a host id
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    const serviceCounts: Map<string, number> = new Map<string, number>();
    const statusCounts: Map<string, number> = new Map<string, number>();

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      /*
       * 'break' mode can return truncated JSON on timeout. Degrade to empty
       * counts — the Postgres resolver still lists every resource (count 0),
       * which is no worse than the prior transient-failure behavior.
       */
      logger.warn(
        "Resource facet count query returned unparseable response, returning empty counts",
      );
      return { serviceCounts, statusCounts };
    }

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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    let rootCount: number = 0;
    let nonRootCount: number = 0;

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      // 'break' mode can truncate JSON on timeout — degrade to zero counts.
      logger.warn(
        "Root span count query returned unparseable response, returning zero counts",
      );
      return { rootCount, nonRootCount };
    }

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
   * is a base-table GROUP BY (still bounded by max_execution_time / 'break').
   * It is a single low-cardinality column read, so it is cheap for typical
   * windows and degrades gracefully on very wide ones.
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    let withExceptionCount: number = 0;
    let withoutExceptionCount: number = 0;

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      // 'break' mode can truncate JSON on timeout — degrade to zero counts.
      logger.warn(
        "Has-exception count query returned unparseable response, returning zero counts",
      );
      return { withExceptionCount, withoutExceptionCount };
    }

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
     * window edges round to the minute, which is consistent with the
     * minute-bucketed output and only shifts the first/last bucket by the
     * partial boundary minute when the range is not minute-aligned.
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
          AND toStartOfMinute(startTime) <= toStartOfMinute(${{
            type: TableColumnType.Date,
            value: request.endTime,
          }})
    `;

    TraceAggregationService.appendCommonFilters(statement, request);

    statement.append(
      " GROUP BY minute, statusCode ) GROUP BY bucket, statusCode ORDER BY bucket ASC",
    );

    /*
     * Defense in depth: cap histogram runtime below nginx's 60s
     * proxy_read_timeout. ClickHouse returns partial aggregated results
     * with 'break' mode rather than throwing, which is acceptable for
     * a density visualization. Explicitly enable projection use.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: TraceFilters,
  ): void {
    if (request.rootOnly) {
      statement.append(" AND isRootSpan = 1");
    }

    if (request.serviceIds && request.serviceIds.length > 0) {
      statement.append(
        SQL` AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            request.serviceIds.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        }})`,
      );
    }

    if (request.entityKeys && request.entityKeys.length > 0) {
      statement.append(
        SQL` AND hasAny(entityKeys, ${{
          type: TableColumnType.ArrayText,
          value: request.entityKeys,
        }})`,
      );
    }

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
     */
    if (request.spanNameSearches && request.spanNameSearches.length > 0) {
      for (const search of request.spanNameSearches) {
        if (search.trim().length === 0) {
          continue;
        }
        statement.append(
          SQL` AND name ILIKE ${{
            type: TableColumnType.Text,
            value: `%${search}%`,
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
          value: `%${request.nameSearchText.trim()}%`,
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
          value: `%${request.statusMessageSearchText}%`,
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

    if (request.attributes && Object.keys(request.attributes).length > 0) {
      for (const [attrKey, attrValue] of Object.entries(request.attributes)) {
        TraceAggregationService.validateFacetKey(attrKey);

        /*
         * Match attribute keys case-insensitively — see the matching note in
         * LogAggregationService.appendCommonFilters. Casings vary across
         * OTEL conventions and app-emitted attributes.
         */
        statement.append(
          SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
            type: TableColumnType.Text,
            value: attrKey,
          }}) AND v = ${{
            type: TableColumnType.Text,
            value: attrValue,
          }}, mapKeys(attributes), mapValues(attributes))`,
        );
      }
    }

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

        // Same key matching as `attributes`, contains-match on the value.
        statement.append(
          SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
            type: TableColumnType.Text,
            value: attrKey,
          }}) AND v ILIKE ${{
            type: TableColumnType.Text,
            value: `%${attrValue}%`,
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
   */
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

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      logger.warn(
        "Trace analytics timeseries query returned unparseable response, returning empty result",
      );
    }

    return rows.map((row: JSONObject): TraceAnalyticsTimeseriesRow => {
      const groupValues: Record<string, string> = {};

      for (const [index, key] of groupByKeys.entries()) {
        const alias: string = TraceAggregationService.groupByAlias(key, index);
        groupValues[key] = String(row[alias] ?? "");
      }

      return {
        time: String(row["bucket"] || ""),
        value: Number(row["val"] || 0),
        groupValues,
      };
    });
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

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      logger.warn(
        "Trace analytics top list query returned unparseable response, returning empty result",
      );
    }

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

    const dbResult: Results = await SpanService.executeQuery(statement);

    let rows: Array<JSONObject> = [];
    try {
      const response: DbJSONResponse = await dbResult.json<{
        data?: Array<JSONObject>;
      }>();
      rows = response.data || [];
    } catch {
      logger.warn(
        "Trace analytics table query returned unparseable response, returning empty result",
      );
    }

    const groupByKeys: Array<string> = request.groupBy;

    return rows.map((row: JSONObject): TraceAnalyticsTableRow => {
      const groupValues: Record<string, string> = {};

      for (const [index, key] of groupByKeys.entries()) {
        const alias: string = TraceAggregationService.groupByAlias(key, index);
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
    });
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
         * Same restriction as the Service facet: keep host/docker/k8s
         * entity ids out of the "Service" dimension (they reuse the
         * primaryEntityId slot, disambiguated by primaryEntityType).
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
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
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
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
      SQL` ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    return statement;
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
