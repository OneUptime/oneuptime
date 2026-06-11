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
  traceIds?: Array<string> | undefined;
  nameSearchText?: string | undefined;
  rootOnly?: boolean | undefined;
  attributes?: Record<string, string> | undefined;
}

export interface HistogramRequest extends TraceFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
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
      ["kubernetesClusterId", ServiceType.KubernetesCluster],
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
     * If any non-projection filter (kind, name, traceId, nameSearchText,
     * entityKeys, attributes) is active, ClickHouse transparently falls back
     * to scanning the main table for the inner query — same cost as before.
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
