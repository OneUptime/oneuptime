import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../Utils/AnalyticsDatabase/Statement";
import { appendAttributeOperatorFilter } from "../Utils/AnalyticsDatabase/AttributeFilterStatement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import LogDatabaseService from "./LogService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, ObjectType } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import ServiceType from "../../Types/Telemetry/ServiceType";
import {
  appendResourceScopeFilters,
  ResourceEntityScope,
} from "../Utils/Telemetry/ResourceEntityFilter";
import {
  buildLogErrorPatternExpression,
  clampLogErrorPattern,
} from "../Utils/Telemetry/LogErrorPatternSql";

export interface HistogramBucket {
  time: string;
  severity: string;
  count: number;
}

/*
 * A serialized QueryOperator (`{_type: "Search", value: "web"}` and friends)
 * — how an attribute filter row that uses any operator other than the
 * implicit `=` arrives over the wire, since every QueryOperator's toJSON()
 * emits this shape. See appendAttributeOperatorFilter.
 */
export interface SerializedAttributeOperator {
  _type: string;
  value?: unknown;
}

export type LogAttributeFilterValue =
  | string
  | Array<string>
  | SerializedAttributeOperator;
export type LogAttributeFilters = Record<string, LogAttributeFilterValue>;

export interface HistogramRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
  serviceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
  /*
   * Resource-facet selections (Kubernetes cluster / host / docker host /
   * podman host) already resolved to their entity keys. One scope per
   * facet: the branches inside a scope OR (a row proves membership either
   * by being primary-keyed on the resource or by carrying its entity key),
   * and the scopes AND with each other so two facets intersect. See
   * ResourceEntityFilter.
   */
  resourceScopes?: Array<ResourceEntityScope> | undefined;
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  attributes?: LogAttributeFilters | undefined;
}

export interface FacetValue {
  value: string;
  count: number;
  displayName?: string | undefined;
}

export interface FacetRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
  serviceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
  /*
   * Resource-facet selections (Kubernetes cluster / host / docker host /
   * podman host) already resolved to their entity keys. One scope per
   * facet: the branches inside a scope OR (a row proves membership either
   * by being primary-keyed on the resource or by carrying its entity key),
   * and the scopes AND with each other so two facets intersect. See
   * ResourceEntityFilter.
   */
  resourceScopes?: Array<ResourceEntityScope> | undefined;
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  attributes?: LogAttributeFilters | undefined;
}

export type AnalyticsChartType = "timeseries" | "toplist" | "table";
export type AnalyticsAggregation = "count" | "unique";

export interface AnalyticsRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
  chartType: AnalyticsChartType;
  groupBy?: Array<string> | undefined;
  aggregation: AnalyticsAggregation;
  aggregationField?: string | undefined;
  serviceIds?: Array<ObjectID> | undefined;
  /*
   * Resource-facet selections (Kubernetes cluster / host / docker host /
   * podman host) already resolved to their entity keys. One scope per
   * facet: the branches inside a scope OR (a row proves membership either
   * by being primary-keyed on the resource or by carrying its entity key),
   * and the scopes AND with each other so two facets intersect. See
   * ResourceEntityFilter.
   */
  resourceScopes?: Array<ResourceEntityScope> | undefined;
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  limit?: number | undefined;
}

export interface AnalyticsTimeseriesRow {
  time: string;
  count: number;
  groupValues: Record<string, string>;
}

export interface AnalyticsTopItem {
  value: string;
  count: number;
}

export interface AnalyticsTableRow {
  groupValues: Record<string, string>;
  count: number;
}

/*
 * ---------------------------------------------------------------------
 * Error-pattern insights
 * ---------------------------------------------------------------------
 *
 * The Logs Insights page answers "what is actually going wrong, and where"
 * by clustering error bodies into patterns (see
 * Common/Utils/Telemetry/LogErrorPattern) and counting the clusters in the
 * database. Everything below shares one filter shape so the top-list and
 * every drill-down run against exactly the same slice of logs — a
 * correlation panel that silently widened its own scope would be worse
 * than no panel at all.
 */

/** Severities treated as "an error" when the caller does not say. */
export const DEFAULT_ERROR_LOG_SEVERITIES: Array<string> = ["Error", "Fatal"];

export interface ErrorPatternFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
  resourceScopes?: Array<ResourceEntityScope> | undefined;
  /** Defaults to DEFAULT_ERROR_LOG_SEVERITIES when absent or empty. */
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  sessionIds?: Array<string> | undefined;
  attributes?: LogAttributeFilters | undefined;
}

export interface TopErrorPatternsRequest extends ErrorPatternFilters {
  limit?: number | undefined;
}

export interface TopErrorPattern {
  /** The normalized message every occurrence in this group shares. */
  pattern: string;
  /** The most recent raw body in the group, for display. */
  sampleBody: string;
  count: number;
  /** ClickHouse datetime strings — parse with OneUptimeDate.fromString. */
  firstSeenAt: string;
  lastSeenAt: string;
  /** Distinct services / hosts / clusters this pattern was seen on. */
  resourceCount: number;
  resourceIds: Array<string>;
  severities: Array<string>;
  /** Distinct traces carrying at least one occurrence. */
  traceCount: number;
  sampleTraceIds: Array<string>;
}

export interface ErrorPatternDetailRequest extends ErrorPatternFilters {
  pattern: string;
  limit?: number | undefined;
}

export interface ErrorPatternTimelineRequest extends ErrorPatternDetailRequest {
  bucketSizeInMinutes: number;
}

export interface ErrorPatternTimelinePoint {
  time: string;
  count: number;
}

export interface ErrorPatternCoOccurrence {
  pattern: string;
  sampleBody: string;
  count: number;
}

export interface ErrorPatternAttribute {
  key: string;
  value: string;
  count: number;
}

export interface ErrorPatternResource {
  resourceId: string;
  resourceType: string;
  count: number;
  lastSeenAt: string;
}

export interface ErrorPatternTrace {
  traceId: string;
  count: number;
  lastSeenAt: string;
  resourceId: string;
}

export interface ErrorPatternSample {
  logId: string;
  time: string;
  body: string;
  severityText: string;
  resourceId: string;
  traceId: string;
  spanId: string;
}

export class LogAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 500;
  private static readonly TABLE_NAME: string = AnalyticsTableName.Log;
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "severityText",
    "primaryEntityId",
    "traceId",
    "spanId",
  ]);
  /*
   * Virtual facet keys that don't correspond to real ClickHouse columns —
   * they all read out of `primaryEntityId` filtered by `primaryEntityType`.
   * The discriminator was added so host / docker host / k8s cluster
   * telemetry could reuse the `primaryEntityId` slot instead of synthesising
   * phantom Service rows; these facets surface each resource type
   * independently.
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
   * Read-side retention filter (mirrors
   * AnalyticsDatabaseService.getRetentionReadFilter): rows past their
   * per-service retention stay queryable until their whole part drops
   * (ttl_only_drop_parts), so raw-table reads exclude them explicitly.
   * Deliberately NOT applied to projection-shaped queries (the severity
   * histogram): an aggregate projection cannot evaluate a predicate on a
   * column it does not store, so adding it would silently force a full
   * base-table scan.
   */
  private static readonly RETENTION_FILTER: string =
    " AND retentionDate >= now()";

  @CaptureSpan()
  public static async getHistogram(
    request: HistogramRequest,
  ): Promise<Array<HistogramBucket>> {
    const statement: Statement =
      LogAggregationService.buildHistogramStatement(request);

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows.map((row: JSONObject): HistogramBucket => {
      return {
        time: String(row["bucket"] || ""),
        severity: String(row["severityText"] || "Unspecified"),
        count: Number(row["cnt"] || 0),
      };
    });
  }

  @CaptureSpan()
  public static async getFacetValues(
    request: FacetRequest,
  ): Promise<Array<FacetValue>> {
    const statement: Statement =
      LogAggregationService.buildFacetStatement(request);

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
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

  private static buildHistogramStatement(request: HistogramRequest): Statement {
    const intervalSeconds: number = request.bucketSizeInMinutes * 60;

    /*
     * Two-stage aggregation mirroring TraceAggregationService.getHistogram.
     * The inner query groups by toStartOfInterval(time, INTERVAL 1 MINUTE) —
     * the exact key expression of the proj_severity_histogram projection
     * (projectId, severityText, minute) — and filters the window on that same
     * expression rather than raw `time`. A raw `time` predicate references a
     * column the aggregate projection does not store, so ClickHouse rejects
     * the projection and full-scans (verified: 2.1M rows / ~46ms vs 978 rows /
     * ~7ms with this form). The outer query re-buckets the tiny minute-level
     * result to the requested size. Window edges round to the minute, which is
     * consistent with the minute-bucketed output and only shifts the first/last
     * bucket by the partial boundary minute when the range is not minute-aligned.
     *
     * A non-projection filter (primaryEntityId, entityKeys, traceId, spanId,
     * attributes) makes the inner query transparently fall back to a
     * base-table scan — same cost as before, still correct.
     */
    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(minute, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket,
        severityText,
        sum(cnt_minute) AS cnt
      FROM (
        SELECT
          toStartOfInterval(time, INTERVAL 1 MINUTE) AS minute,
          severityText,
          count() AS cnt_minute
        FROM ${LogAggregationService.TABLE_NAME}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: request.projectId,
        }}
          AND toStartOfInterval(time, INTERVAL 1 MINUTE) >= toStartOfInterval(${{
            type: TableColumnType.Date,
            value: request.startTime,
          }}, INTERVAL 1 MINUTE)
          AND toStartOfInterval(time, INTERVAL 1 MINUTE) <= toStartOfInterval(${{
            type: TableColumnType.Date,
            value: request.endTime,
          }}, INTERVAL 1 MINUTE)
    `;

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(
      " GROUP BY minute, severityText ) GROUP BY bucket, severityText ORDER BY bucket ASC",
    );

    /*
     * Defense in depth: cap histogram runtime below nginx's 60s
     * proxy_read_timeout. 'break' returns partial aggregated results
     * rather than throwing, which is acceptable for a density viz.
     * Explicitly enable projection use.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        boundScanMemory: true,
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
      request.limit ?? LogAggregationService.DEFAULT_FACET_LIMIT;

    LogAggregationService.validateFacetKey(request.facetKey);

    const resourceServiceType: ServiceType | undefined =
      LogAggregationService.RESOURCE_FACET_KEYS.get(request.facetKey);
    const isResourceFacet: boolean = resourceServiceType !== undefined;
    const isTopLevelColumn: boolean =
      isResourceFacet ||
      LogAggregationService.isTopLevelColumn(request.facetKey);

    const statement: Statement = new Statement();

    if (isResourceFacet) {
      /*
       * Virtual facet — group primaryEntityId values whose row carries the
       * matching ServiceType discriminator (Host / DockerHost /
       * KubernetesCluster).
       */
      statement.append(
        SQL`SELECT toString(primaryEntityId) AS val, count() AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
      );
    } else if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
      );
    } else {
      // attributes is Map(String, String) — subscript access, not JSON functions.
      statement.append(
        SQL`SELECT attributes[${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}] AS val, count() AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
      );
    }

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

    if (isResourceFacet) {
      statement.append(
        SQL` AND primaryEntityType = ${{
          type: TableColumnType.Text,
          value: resourceServiceType as string,
        }}`,
      );
    } else if (request.facetKey === "primaryEntityId") {
      /*
       * Constrain the canonical Services facet to rows that actually
       * belong to a Service. NULL / empty primaryEntityType covers legacy
       * rows ingested before the discriminator existed.
       */
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

    statement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(statement, request);

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
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  private static readonly DEFAULT_ANALYTICS_LIMIT: number = 10;
  private static readonly MAX_GROUP_BY_DIMENSIONS: number = 2;

  @CaptureSpan()
  public static async getAnalyticsTimeseries(
    request: AnalyticsRequest,
  ): Promise<Array<AnalyticsTimeseriesRow>> {
    const statement: Statement =
      LogAggregationService.buildAnalyticsTimeseriesStatement(request);

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const groupByKeys: Array<string> = request.groupBy || [];

    return rows.map((row: JSONObject): AnalyticsTimeseriesRow => {
      const groupValues: Record<string, string> = {};

      for (const key of groupByKeys) {
        const alias: string = LogAggregationService.groupByAlias(key);
        groupValues[key] = String(row[alias] || "");
      }

      return {
        time: String(row["bucket"] || ""),
        count: Number(row["cnt"] || 0),
        groupValues,
      };
    });
  }

  @CaptureSpan()
  public static async getAnalyticsTopList(
    request: AnalyticsRequest,
  ): Promise<Array<AnalyticsTopItem>> {
    if (!request.groupBy || request.groupBy.length === 0) {
      throw new BadDataException(
        "groupBy with at least one dimension is required for top list",
      );
    }

    const statement: Statement =
      LogAggregationService.buildAnalyticsTopListStatement(request);

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows
      .map((row: JSONObject): AnalyticsTopItem => {
        return {
          value: String(row["val"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((item: AnalyticsTopItem): boolean => {
        return item.value.length > 0;
      });
  }

  @CaptureSpan()
  public static async getAnalyticsTable(
    request: AnalyticsRequest,
  ): Promise<Array<AnalyticsTableRow>> {
    if (!request.groupBy || request.groupBy.length === 0) {
      throw new BadDataException(
        "groupBy with at least one dimension is required for table",
      );
    }

    const statement: Statement =
      LogAggregationService.buildAnalyticsTableStatement(request);

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const groupByKeys: Array<string> = request.groupBy;

    return rows.map((row: JSONObject): AnalyticsTableRow => {
      const groupValues: Record<string, string> = {};

      for (const key of groupByKeys) {
        const alias: string = LogAggregationService.groupByAlias(key);
        groupValues[key] = String(row[alias] || "");
      }

      return {
        groupValues,
        count: Number(row["cnt"] || 0),
      };
    });
  }

  private static groupByAlias(key: string): string {
    if (LogAggregationService.isTopLevelColumn(key)) {
      return key;
    }

    // For attribute keys, use a sanitized alias
    return `attr_${key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  }

  private static appendGroupBySelect(
    statement: Statement,
    groupByKeys: Array<string>,
  ): void {
    for (const key of groupByKeys) {
      LogAggregationService.validateFacetKey(key);

      if (LogAggregationService.isTopLevelColumn(key)) {
        statement.append(`, toString(${key}) AS ${key}`);
      } else {
        const alias: string = LogAggregationService.groupByAlias(key);
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
    for (const key of groupByKeys) {
      if (LogAggregationService.isTopLevelColumn(key)) {
        statement.append(`, ${key}`);
      } else {
        const alias: string = LogAggregationService.groupByAlias(key);
        statement.append(`, ${alias}`);
      }
    }
  }

  private static getAggregationExpression(request: AnalyticsRequest): string {
    if (request.aggregation === "unique" && request.aggregationField) {
      LogAggregationService.validateFacetKey(request.aggregationField);

      if (LogAggregationService.isTopLevelColumn(request.aggregationField)) {
        return `uniqExact(${request.aggregationField})`;
      }

      return `uniqExact(attributes['${request.aggregationField.replace(/'/g, "\\'")}'])`;
    }

    return "count()";
  }

  private static validateGroupBy(groupBy: Array<string> | undefined): void {
    if (!groupBy) {
      return;
    }

    if (groupBy.length > LogAggregationService.MAX_GROUP_BY_DIMENSIONS) {
      throw new BadDataException(
        `groupBy supports at most ${LogAggregationService.MAX_GROUP_BY_DIMENSIONS} dimensions`,
      );
    }

    for (const key of groupBy) {
      LogAggregationService.validateFacetKey(key);
    }
  }

  private static buildAnalyticsTimeseriesStatement(
    request: AnalyticsRequest,
  ): Statement {
    LogAggregationService.validateGroupBy(request.groupBy);

    const intervalSeconds: number = request.bucketSizeInMinutes * 60;
    const aggExpr: string =
      LogAggregationService.getAggregationExpression(request);

    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(time, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket`;

    statement.append(`, ${aggExpr} AS cnt`);

    if (request.groupBy && request.groupBy.length > 0) {
      LogAggregationService.appendGroupBySelect(statement, request.groupBy);
    }

    statement.append(
      SQL`
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}`,
    );

    statement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY bucket");

    if (request.groupBy && request.groupBy.length > 0) {
      LogAggregationService.appendGroupByClause(statement, request.groupBy);
    }

    statement.append(" ORDER BY bucket ASC");

    /*
     * Defense in depth: cap runtime below the client's 58s request_timeout
     * (matches the histogram / facet paths above). 'break' returns partial
     * aggregated results rather than holding a pool connection.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  private static buildAnalyticsTopListStatement(
    request: AnalyticsRequest,
  ): Statement {
    const groupByKey: string = request.groupBy![0]!;
    LogAggregationService.validateFacetKey(groupByKey);

    const limit: number =
      request.limit ?? LogAggregationService.DEFAULT_ANALYTICS_LIMIT;
    const aggExpr: string =
      LogAggregationService.getAggregationExpression(request);

    const isTopLevel: boolean =
      LogAggregationService.isTopLevelColumn(groupByKey);

    const statement: Statement = new Statement();

    if (isTopLevel) {
      statement.append(
        `SELECT toString(${groupByKey}) AS val, ${aggExpr} AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
      );
    } else {
      statement.append(`SELECT attributes[`);
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: groupByKey,
        }}`,
      );
      statement.append(
        `] AS val, ${aggExpr} AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
      );
    }

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

    if (!isTopLevel) {
      statement.append(
        SQL` AND mapContains(attributes, ${{
          type: TableColumnType.Text,
          value: groupByKey,
        }})`,
      );
    }

    statement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' returns
     * partial results (matches the histogram / facet paths).
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  private static buildAnalyticsTableStatement(
    request: AnalyticsRequest,
  ): Statement {
    LogAggregationService.validateGroupBy(request.groupBy);

    const groupByKeys: Array<string> = request.groupBy!;
    const limit: number =
      request.limit ?? LogAggregationService.DEFAULT_ANALYTICS_LIMIT;
    const aggExpr: string =
      LogAggregationService.getAggregationExpression(request);

    const statement: Statement = new Statement();
    statement.append(`SELECT ${aggExpr} AS cnt`);

    LogAggregationService.appendGroupBySelect(statement, groupByKeys);

    statement.append(
      SQL`
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}`,
    );

    statement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(statement, request);

    // Build GROUP BY from aliases
    const aliases: Array<string> = groupByKeys.map((key: string) => {
      if (LogAggregationService.isTopLevelColumn(key)) {
        return key;
      }

      return LogAggregationService.groupByAlias(key);
    });

    statement.append(` GROUP BY ${aliases.join(", ")}`);

    statement.append(
      SQL` ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' returns
     * partial results (matches the histogram / facet paths).
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: Pick<
      HistogramRequest,
      | "serviceIds"
      | "entityKeys"
      | "resourceScopes"
      | "severityTexts"
      | "bodySearchText"
      | "traceIds"
      | "spanIds"
      | "sessionIds"
      | "attributes"
    >,
  ): void {
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

    appendResourceScopeFilters(statement, request.resourceScopes);

    if (request.severityTexts && request.severityTexts.length > 0) {
      statement.append(
        SQL` AND severityText IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.severityTexts),
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

    if (request.spanIds && request.spanIds.length > 0) {
      statement.append(
        SQL` AND spanId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.spanIds),
        }})`,
      );
    }

    if (request.sessionIds && request.sessionIds.length > 0) {
      statement.append(
        SQL` AND sessionId IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.sessionIds),
        }})`,
      );
    }

    if (request.bodySearchText && request.bodySearchText.trim().length > 0) {
      /*
       * Escaped so a body containing `%` or `_` matches literally. The list
       * query escapes centrally (Statement.serializseValue); without the same
       * treatment here a "100% CPU" filter counted every log line in the
       * chart while the table below it showed only the matching ones.
       */
      statement.append(
        SQL` AND body ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(request.bodySearchText.trim())}%`,
        }}`,
      );
    }

    if (request.attributes && Object.keys(request.attributes).length > 0) {
      for (const [attrKey, attrValue] of Object.entries(request.attributes)) {
        LogAggregationService.validateFacetKey(attrKey);

        /*
         * Match attribute keys case-insensitively — keys in the data come
         * from many sources (OTEL conventions are dot.lowercase, app code
         * often uses camelCase like `requestId`), and forcing users to
         * remember the exact casing is a poor experience. The user-supplied
         * key is validated above.
         */
        if (Array.isArray(attrValue)) {
          if (attrValue.length === 0) {
            continue;
          }
          statement.append(
            SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
              type: TableColumnType.Text,
              value: attrKey,
            }}) AND v IN (${{
              type: TableColumnType.Text,
              value: new Includes(attrValue),
            }}), mapKeys(attributes), mapValues(attributes))`,
          );
        } else if (typeof attrValue === "object" && attrValue !== null) {
          LogAggregationService.appendAttributeOperatorFilter(
            statement,
            attrKey,
            attrValue as unknown as Record<string, unknown>,
          );
        } else if (attrValue === "") {
          /*
           * A blank equality value is "missing or empty", not "present and
           * empty": the list query compares `attributes['k'] = ''`, and a Map
           * subscript returns the type default for a key the row does not
           * carry, so rows without the attribute match too. Routed through the
           * operator builder so a bare "" and an explicit EqualTo("") — the
           * same filter written two ways — cannot disagree.
           */
          LogAggregationService.appendAttributeOperatorFilter(
            statement,
            attrKey,
            { _type: ObjectType.IsNull },
          );
        } else {
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
  }

  /*
   * Attribute filter rows carry an operator (`contains`, `is any of`,
   * `is empty`, `matches`, ...) as well as a value, and the operator travels
   * over the wire as the serialized `{_type, value}` shape every
   * QueryOperator's toJSON() produces. The list query compiles those through
   * StatementGenerator; these aggregation endpoints (histogram, facets,
   * export) used to treat anything non-array as a plain string, so an
   * operator object bound as "[object Object]", matched nothing, and left the
   * log monitor preview showing an empty chart beside a populated list.
   *
   * The compilation itself lives in AttributeFilterStatement so the trace,
   * metric and exception builders answer identically — see the comment there.
   */
  private static appendAttributeOperatorFilter(
    statement: Statement,
    attrKey: string,
    attrValue: Record<string, unknown>,
  ): void {
    appendAttributeOperatorFilter({
      statement,
      attributeKey: attrKey,
      operator: attrValue,
    });
  }

  @CaptureSpan()
  public static async getExportLogs(request: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
    limit: number;
    serviceIds?: Array<ObjectID> | undefined;
    severityTexts?: Array<string> | undefined;
    bodySearchText?: string | undefined;
    traceIds?: Array<string> | undefined;
    spanIds?: Array<string> | undefined;
    sessionIds?: Array<string> | undefined;
    attributes?: Record<string, string> | undefined;
  }): Promise<Array<JSONObject>> {
    const maxLimit: number = Math.min(request.limit || 10000, 10000);

    const statement: Statement = SQL`
      SELECT
        time,
        primaryEntityId,
        severityText,
        severityNumber,
        body,
        traceId,
        spanId,
        attributes
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}
    `;

    statement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` ORDER BY time DESC LIMIT ${{
        type: TableColumnType.Number,
        value: maxLimit,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout; 'break' returns
     * partial rows rather than holding a pool connection on a large export.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  @CaptureSpan()
  public static async getLogContext(request: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    time: Date;
    logId: string;
    count: number;
    sessionIds?: Array<string> | undefined;
  }): Promise<{ before: Array<JSONObject>; after: Array<JSONObject> }> {
    const count: number = Math.min(request.count || 5, 20);

    const beforeStatement: Statement = SQL`
      SELECT
        _id,
        time,
        timeUnixNano,
        primaryEntityId,
        severityText,
        severityNumber,
        body,
        traceId,
        spanId,
        attributes
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: request.primaryEntityId,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.time,
        }}
        AND _id != ${{
          type: TableColumnType.Text,
          value: request.logId,
        }}
        AND retentionDate >= now()
    `;

    const afterStatement: Statement = SQL`
      SELECT
        _id,
        time,
        timeUnixNano,
        primaryEntityId,
        severityText,
        severityNumber,
        body,
        traceId,
        spanId,
        attributes
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: request.primaryEntityId,
        }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.time,
        }}
        AND _id != ${{
          type: TableColumnType.Text,
          value: request.logId,
        }}
        AND retentionDate >= now()
    `;

    /*
     * Session scoping keeps "surrounding" logs within the same RUM
     * session instead of interleaving every session the service handled
     * at that instant.
     */
    if (request.sessionIds && request.sessionIds.length > 0) {
      for (const contextStatement of [beforeStatement, afterStatement]) {
        contextStatement.append(
          SQL` AND sessionId IN (${{
            type: TableColumnType.Text,
            value: new Includes(request.sessionIds),
          }})`,
        );
      }
    }

    beforeStatement.append(
      SQL` ORDER BY time DESC, timeUnixNano DESC
      LIMIT ${{
        type: TableColumnType.Number,
        value: count,
      }}`,
    );

    afterStatement.append(
      SQL` ORDER BY time ASC, timeUnixNano ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: count,
      }}`,
    );

    const [beforeResult, afterResult] = await Promise.all([
      LogDatabaseService.executeQuery(beforeStatement),
      LogDatabaseService.executeQuery(afterStatement),
    ]);

    const beforeResponse: DbJSONResponse = await beforeResult.json<{
      data?: Array<JSONObject>;
    }>();
    const afterResponse: DbJSONResponse = await afterResult.json<{
      data?: Array<JSONObject>;
    }>();

    const beforeRows: Array<JSONObject> = (beforeResponse.data || []).reverse();
    const afterRows: Array<JSONObject> = afterResponse.data || [];

    return { before: beforeRows, after: afterRows };
  }

  @CaptureSpan()
  public static async getDropFilterEstimate(request: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
    filterQuery: string;
    serviceIds?: Array<ObjectID> | undefined;
    severityTexts?: Array<string> | undefined;
    bodySearchText?: string | undefined;
  }): Promise<{
    totalLogs: number;
    matchingLogs: number;
    estimatedReductionPercent: number;
  }> {
    // Get total count
    const totalStatement: Statement = SQL`
      SELECT count() AS cnt
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}
    `;

    totalStatement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(totalStatement, request);

    /*
     * Cap the count scan below the client's 58s request_timeout; 'break'
     * returns a partial (lower-bound) count, acceptable for an estimate.
     */
    totalStatement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    // Get matching count using the filter query as body search
    const matchStatement: Statement = SQL`
      SELECT count() AS cnt
      FROM ${LogAggregationService.TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: request.projectId,
      }}
        AND time >= ${{
          type: TableColumnType.Date,
          value: request.startTime,
        }}
        AND time <= ${{
          type: TableColumnType.Date,
          value: request.endTime,
        }}
    `;

    matchStatement.append(LogAggregationService.RETENTION_FILTER);

    LogAggregationService.appendCommonFilters(matchStatement, {
      ...request,
      bodySearchText: request.filterQuery,
    });

    /*
     * Cap the count scan below the client's 58s request_timeout; 'break'
     * returns a partial (lower-bound) count, acceptable for an estimate.
     */
    matchStatement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
      }),
    );

    const [totalResult, matchResult] = await Promise.all([
      LogDatabaseService.executeQuery(totalStatement),
      LogDatabaseService.executeQuery(matchStatement),
    ]);

    const totalResponse: DbJSONResponse = await totalResult.json<{
      data?: Array<JSONObject>;
    }>();
    const matchResponse: DbJSONResponse = await matchResult.json<{
      data?: Array<JSONObject>;
    }>();

    const totalData: Array<JSONObject> = totalResponse.data || [];
    const matchData: Array<JSONObject> = matchResponse.data || [];

    const totalLogs: number = Number(totalData[0]?.["cnt"] || 0);
    const matchingLogs: number = Number(matchData[0]?.["cnt"] || 0);
    const estimatedReductionPercent: number =
      totalLogs > 0 ? Math.round((matchingLogs / totalLogs) * 100) : 0;

    return { totalLogs, matchingLogs, estimatedReductionPercent };
  }

  // --- Error pattern insights ---

  private static readonly DEFAULT_ERROR_PATTERN_LIMIT: number = 10;
  private static readonly MAX_ERROR_PATTERN_LIMIT: number = 50;
  private static readonly ERROR_PATTERN_SAMPLE_ARRAY_LIMIT: number = 5;
  /* Every severity a pattern can carry fits comfortably in eight slots. */
  private static readonly ERROR_PATTERN_SEVERITY_ARRAY_LIMIT: number = 8;
  /*
   * Cheap pre-filter for bodies that carry no message: they normalize to the
   * empty pattern, which would otherwise become a meaningless "" group.
   *
   * Deliberately only a pre-filter, not the guarantee. ClickHouse's trimBoth
   * strips SPACES only, so a body of tabs or newlines survives this predicate
   * and still normalizes to "" once the whitespace rule collapses it. The
   * grouped reads therefore also carry `HAVING pattern != ''`; this stays
   * because skipping those rows before aggregation is strictly cheaper than
   * grouping them and throwing the group away.
   */
  private static readonly NON_EMPTY_BODY_FILTER: string =
    " AND notEmpty(trimBoth(ifNull(body, '')))";

  /*
   * The actual guarantee that no empty-pattern group is returned. Applied to
   * every read that GROUPs BY the pattern; the row-returning reads instead
   * scope to one caller-supplied pattern, which is never "".
   */
  private static readonly NON_EMPTY_PATTERN_HAVING: string =
    " HAVING pattern != ''";

  /**
   * The distinct error messages in the window, most frequent first.
   *
   * This is the "Top Errors" list: one row per pattern with its occurrence
   * count, when it started and last happened, how many resources it spans,
   * and enough sample material (a real body, some trace ids) for the UI to
   * render the row without a second round trip.
   */
  @CaptureSpan()
  public static async getTopErrorPatterns(
    request: TopErrorPatternsRequest,
  ): Promise<Array<TopErrorPattern>> {
    const statement: Statement =
      LogAggregationService.buildTopErrorPatternsStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows
      .map((row: JSONObject): TopErrorPattern => {
        return {
          pattern: String(row["pattern"] || ""),
          sampleBody: String(row["sampleBody"] || ""),
          count: Number(row["cnt"] || 0),
          firstSeenAt: String(row["firstSeen"] || ""),
          lastSeenAt: String(row["lastSeen"] || ""),
          resourceCount: Number(row["resourceCount"] || 0),
          resourceIds: LogAggregationService.toStringArray(row["resourceIds"]),
          severities: LogAggregationService.toStringArray(row["severities"]),
          traceCount: Number(row["traceCount"] || 0),
          sampleTraceIds: LogAggregationService.toStringArray(
            row["sampleTraceIds"],
          ),
        };
      })
      .filter((item: TopErrorPattern): boolean => {
        return item.pattern.length > 0;
      });
  }

  /**
   * When one pattern happened, bucketed over the window — the "is this a
   * steady drip or a spike at 14:05" question.
   */
  @CaptureSpan()
  public static async getErrorPatternTimeline(
    request: ErrorPatternTimelineRequest,
  ): Promise<Array<ErrorPatternTimelinePoint>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternTimelineStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows.map((row: JSONObject): ErrorPatternTimelinePoint => {
      return {
        time: String(row["bucket"] || ""),
        count: Number(row["cnt"] || 0),
      };
    });
  }

  /**
   * Other error patterns that fired in the same time buckets as this one.
   *
   * This is the correlation the Insights page exists for: rather than
   * eyeballing two log lists side by side, the panel names the errors that
   * keep company with the one under investigation. "Same bucket" is a
   * deliberately coarse notion of simultaneity — it inherits whatever
   * bucket size the timeline is drawn at, so a wide window correlates
   * loosely and a narrow one tightly.
   */
  @CaptureSpan()
  public static async getErrorPatternCoOccurrences(
    request: ErrorPatternTimelineRequest,
  ): Promise<Array<ErrorPatternCoOccurrence>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternCoOccurrenceStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows
      .map((row: JSONObject): ErrorPatternCoOccurrence => {
        return {
          pattern: String(row["pattern"] || ""),
          sampleBody: String(row["sampleBody"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((item: ErrorPatternCoOccurrence): boolean => {
        return item.pattern.length > 0;
      });
  }

  /**
   * The attribute key/value pairs carried by this pattern's occurrences,
   * most common first — how the page answers "which host is this?" without
   * the user having to open a log line and read its attributes.
   */
  @CaptureSpan()
  public static async getErrorPatternAttributes(
    request: ErrorPatternDetailRequest,
  ): Promise<Array<ErrorPatternAttribute>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternAttributesStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows
      .map((row: JSONObject): ErrorPatternAttribute => {
        return {
          key: String(row["attrKey"] || ""),
          value: String(row["attrValue"] || ""),
          count: Number(row["cnt"] || 0),
        };
      })
      .filter((item: ErrorPatternAttribute): boolean => {
        return item.key.length > 0;
      });
  }

  /** Which services / hosts / clusters this pattern is happening on. */
  @CaptureSpan()
  public static async getErrorPatternResources(
    request: ErrorPatternDetailRequest,
  ): Promise<Array<ErrorPatternResource>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternResourcesStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows
      .map((row: JSONObject): ErrorPatternResource => {
        return {
          resourceId: String(row["resourceId"] || ""),
          resourceType: String(row["resourceType"] || ""),
          count: Number(row["cnt"] || 0),
          lastSeenAt: String(row["lastSeen"] || ""),
        };
      })
      .filter((item: ErrorPatternResource): boolean => {
        return item.resourceId.length > 0;
      });
  }

  /**
   * Traces that carry at least one occurrence — the jump from "this error
   * happened" to the request it happened inside.
   */
  @CaptureSpan()
  public static async getErrorPatternTraces(
    request: ErrorPatternDetailRequest,
  ): Promise<Array<ErrorPatternTrace>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternTracesStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows
      .map((row: JSONObject): ErrorPatternTrace => {
        return {
          traceId: String(row["traceId"] || ""),
          count: Number(row["cnt"] || 0),
          lastSeenAt: String(row["lastSeen"] || ""),
          resourceId: String(row["resourceId"] || ""),
        };
      })
      .filter((item: ErrorPatternTrace): boolean => {
        return item.traceId.length > 0;
      });
  }

  /** The most recent raw log lines behind the pattern. */
  @CaptureSpan()
  public static async getErrorPatternSamples(
    request: ErrorPatternDetailRequest,
  ): Promise<Array<ErrorPatternSample>> {
    const statement: Statement =
      LogAggregationService.buildErrorPatternSamplesStatement(request);

    const rows: Array<JSONObject> =
      await LogAggregationService.runQuery(statement);

    return rows.map((row: JSONObject): ErrorPatternSample => {
      return {
        logId: String(row["_id"] || ""),
        time: String(row["time"] || ""),
        body: String(row["body"] || ""),
        severityText: String(row["severityText"] || ""),
        resourceId: String(row["resourceId"] || ""),
        traceId: String(row["traceId"] || ""),
        spanId: String(row["spanId"] || ""),
      };
    });
  }

  private static async runQuery(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const dbResult: Results = await LogDatabaseService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  /*
   * ClickHouse returns array-valued aggregates (groupUniqArray) as JSON
   * arrays, but a row that reached us through a different serializer could
   * carry anything — coerce defensively rather than trusting the shape.
   */
  private static toStringArray(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item: unknown): string => {
        return String(item ?? "");
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  private static clampErrorPatternLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
      return LogAggregationService.DEFAULT_ERROR_PATTERN_LIMIT;
    }

    return Math.min(
      Math.max(1, Math.floor(limit)),
      LogAggregationService.MAX_ERROR_PATTERN_LIMIT,
    );
  }

  /*
   * Error-pattern reads share one WHERE clause so a drill-down can never
   * see rows the top-list did not. The only thing this adds over
   * appendCommonFilters is the severity default: a request that names no
   * severities means "errors", not "every log in the project".
   */
  private static appendErrorPatternScope(
    statement: Statement,
    request: ErrorPatternFilters,
  ): void {
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

    statement.append(LogAggregationService.RETENTION_FILTER);
    statement.append(LogAggregationService.NON_EMPTY_BODY_FILTER);

    LogAggregationService.appendCommonFilters(statement, {
      ...request,
      severityTexts:
        request.severityTexts && request.severityTexts.length > 0
          ? request.severityTexts
          : DEFAULT_ERROR_LOG_SEVERITIES,
    });
  }

  /*
   * ` AND <pattern expression> = '<the pattern>'` — the predicate every
   * drill-down uses to reduce the window to one cluster. The pattern value
   * is clamped to the same maximum length the expression truncates to, so
   * an oversized parameter cannot be used to push a huge constant into the
   * query (it could only ever match nothing anyway).
   */
  private static appendErrorPatternEquality(
    statement: Statement,
    pattern: string,
  ): void {
    statement.append(" AND ");
    statement.append(buildLogErrorPatternExpression());
    statement.append(
      SQL` = ${{
        type: TableColumnType.Text,
        value: clampLogErrorPattern(pattern),
      }}`,
    );
  }

  private static errorPatternQuerySettings(): string {
    /*
     * Same ceiling as every other aggregation here: below the client's 58s
     * request timeout, 'break' so a wide window degrades to partial counts
     * instead of an error page, and the scan-memory bound because these
     * queries read the fat `attributes` map alongside `body`.
     */
    return getQuerySettings({
      maxExecutionTimeInSeconds: 45,
      timeoutOverflowMode: "break",
      boundScanMemory: true,
    });
  }

  private static buildTopErrorPatternsStatement(
    request: TopErrorPatternsRequest,
  ): Statement {
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );
    /*
     * Inlined rather than bound as a parameter: these are the parameters of
     * a PARAMETRIC aggregate function, which ClickHouse requires to be
     * constants, and they are trusted class constants rather than anything
     * a caller supplies.
     */
    const sampleLimit: number =
      LogAggregationService.ERROR_PATTERN_SAMPLE_ARRAY_LIMIT;
    const severityLimit: number =
      LogAggregationService.ERROR_PATTERN_SEVERITY_ARRAY_LIMIT;

    const statement: Statement = new Statement();

    statement.append("SELECT ");
    statement.append(buildLogErrorPatternExpression());
    statement.append(" AS pattern");
    statement.append(", count() AS cnt");
    /*
     * The newest real body in the group. Showing a raw example alongside
     * the normalized pattern is what makes a row readable — `<num>` reads
     * very differently next to the line it came from.
     */
    statement.append(", argMax(ifNull(body, ''), time) AS sampleBody");
    statement.append(", min(time) AS firstSeen");
    statement.append(", max(time) AS lastSeen");
    statement.append(", uniqExact(primaryEntityId) AS resourceCount");
    statement.append(
      `, groupUniqArray(${sampleLimit})(toString(primaryEntityId)) AS resourceIds`,
    );
    statement.append(
      `, groupUniqArray(${severityLimit})(toString(severityText)) AS severities`,
    );
    statement.append(
      ", uniqExactIf(traceId, ifNull(traceId, '') != '') AS traceCount",
    );
    statement.append(
      `, groupUniqArrayIf(${sampleLimit})(ifNull(traceId, ''), ifNull(traceId, '') != '') AS sampleTraceIds`,
    );
    statement.append(` FROM ${LogAggregationService.TABLE_NAME}`);

    LogAggregationService.appendErrorPatternScope(statement, request);

    statement.append(" GROUP BY pattern");
    statement.append(LogAggregationService.NON_EMPTY_PATTERN_HAVING);
    statement.append(
      SQL` ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternTimelineStatement(
    request: ErrorPatternTimelineRequest,
  ): Statement {
    const intervalSeconds: number =
      LogAggregationService.resolveBucketSeconds(request);

    const statement: Statement = SQL`SELECT toStartOfInterval(time, INTERVAL ${{
      type: TableColumnType.Number,
      value: intervalSeconds,
    }} SECOND) AS bucket, count() AS cnt`;

    statement.append(` FROM ${LogAggregationService.TABLE_NAME}`);

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(" GROUP BY bucket ORDER BY bucket ASC");
    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternCoOccurrenceStatement(
    request: ErrorPatternTimelineRequest,
  ): Statement {
    const intervalSeconds: number =
      LogAggregationService.resolveBucketSeconds(request);
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );

    const statement: Statement = new Statement();

    statement.append("SELECT ");
    statement.append(buildLogErrorPatternExpression());
    statement.append(" AS pattern");
    statement.append(", count() AS cnt");
    statement.append(", argMax(ifNull(body, ''), time) AS sampleBody");
    statement.append(` FROM ${LogAggregationService.TABLE_NAME}`);

    LogAggregationService.appendErrorPatternScope(statement, request);

    /*
     * Everything EXCEPT the pattern under investigation. Written as the
     * full expression rather than the `pattern` alias: ClickHouse
     * substitutes same-level SELECT aliases into WHERE, and an alias that
     * shadows nothing today can start shadowing a real column tomorrow.
     */
    statement.append(" AND ");
    statement.append(buildLogErrorPatternExpression());
    statement.append(
      SQL` != ${{
        type: TableColumnType.Text,
        value: clampLogErrorPattern(request.pattern),
      }}`,
    );

    /*
     * ...restricted to the buckets the investigated pattern itself landed
     * in.
     *
     * GLOBAL IN, not plain IN, and it is load-bearing. This predicate sits
     * in a query on the Distributed LogItemV3 table whose subquery reads
     * that SAME Distributed table, which multi-shard ClickHouse rejects
     * outright as a double-distributed subquery (Code 288,
     * distributed_product_mode = 'deny' by default) — the panel would throw
     * on any 2+-shard cluster, and because the endpoint wraps each
     * correlation read in a degrade-to-empty catch it would fail SILENTLY,
     * rendering "nothing else was failing" forever.
     *
     * A shard-local evaluation would be wrong even where it is allowed: the
     * sharding key is cityHash64(projectId, primaryEntityId, time), so one
     * project's rows span every shard and the bucket set has to be computed
     * once globally. On a single shard GLOBAL is a semantic no-op. Same
     * reasoning, same shape as MetricService's Top-K group restriction.
     */
    statement.append(
      SQL` AND toStartOfInterval(time, INTERVAL ${{
        type: TableColumnType.Number,
        value: intervalSeconds,
      }} SECOND) GLOBAL IN (SELECT DISTINCT toStartOfInterval(time, INTERVAL ${{
        type: TableColumnType.Number,
        value: intervalSeconds,
      }} SECOND)`,
    );

    statement.append(` FROM ${LogAggregationService.TABLE_NAME}`);

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(")");

    statement.append(" GROUP BY pattern");
    statement.append(LogAggregationService.NON_EMPTY_PATTERN_HAVING);
    statement.append(
      SQL` ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternAttributesStatement(
    request: ErrorPatternDetailRequest,
  ): Statement {
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );

    /*
     * The ARRAY JOIN runs over a pre-filtered subquery on purpose. Written
     * flat, the join explodes every row in the window into one row per
     * attribute BEFORE the WHERE narrows to a single pattern — on a service
     * carrying twenty resource attributes that is a twentyfold scan for a
     * result the size of a tooltip.
     */
    const statement: Statement = new Statement();

    statement.append(
      `SELECT attrKey, attrValue, count() AS cnt FROM (SELECT attributes FROM ${LogAggregationService.TABLE_NAME}`,
    );

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(
      ") ARRAY JOIN mapKeys(attributes) AS attrKey, mapValues(attributes) AS attrValue",
    );
    statement.append(
      SQL` GROUP BY attrKey, attrValue ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternResourcesStatement(
    request: ErrorPatternDetailRequest,
  ): Statement {
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );

    const statement: Statement = new Statement();

    statement.append(
      `SELECT toString(primaryEntityId) AS resourceId, any(ifNull(primaryEntityType, '')) AS resourceType, count() AS cnt, max(time) AS lastSeen FROM ${LogAggregationService.TABLE_NAME}`,
    );

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(
      SQL` GROUP BY resourceId ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternTracesStatement(
    request: ErrorPatternDetailRequest,
  ): Statement {
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );

    const statement: Statement = new Statement();

    statement.append(
      `SELECT ifNull(traceId, '') AS traceId, count() AS cnt, max(time) AS lastSeen, any(toString(primaryEntityId)) AS resourceId FROM ${LogAggregationService.TABLE_NAME}`,
    );

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(" AND ifNull(traceId, '') != ''");

    statement.append(
      SQL` GROUP BY traceId ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  private static buildErrorPatternSamplesStatement(
    request: ErrorPatternDetailRequest,
  ): Statement {
    const limit: number = LogAggregationService.clampErrorPatternLimit(
      request.limit,
    );

    const statement: Statement = new Statement();

    statement.append(
      `SELECT _id, time, ifNull(body, '') AS body, toString(severityText) AS severityText, toString(primaryEntityId) AS resourceId, ifNull(traceId, '') AS traceId, ifNull(spanId, '') AS spanId FROM ${LogAggregationService.TABLE_NAME}`,
    );

    LogAggregationService.appendErrorPatternScope(statement, request);
    LogAggregationService.appendErrorPatternEquality(
      statement,
      request.pattern,
    );

    statement.append(
      SQL` ORDER BY time DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
    );

    statement.append(LogAggregationService.errorPatternQuerySettings());

    return statement;
  }

  /*
   * Bucket size in seconds, clamped to a minute floor. A zero or negative
   * bucket would compile to `INTERVAL 0 SECOND`, which ClickHouse rejects —
   * and the correlation query's "same bucket" join would lose all meaning.
   */
  private static resolveBucketSeconds(
    request: ErrorPatternTimelineRequest,
  ): number {
    const minutes: number = request.bucketSizeInMinutes;

    if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
      return 60;
    }

    return Math.max(1, Math.floor(minutes)) * 60;
  }

  private static isTopLevelColumn(key: string): boolean {
    return LogAggregationService.TOP_LEVEL_COLUMNS.has(key);
  }

  private static validateFacetKey(
    facetKey: unknown,
  ): asserts facetKey is string {
    if (typeof facetKey !== "string") {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      facetKey.length === 0 ||
      facetKey.length > LogAggregationService.MAX_FACET_KEY_LENGTH
    ) {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      LogAggregationService.isTopLevelColumn(facetKey) ||
      LogAggregationService.RESOURCE_FACET_KEYS.has(facetKey)
    ) {
      return;
    }

    if (!LogAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default LogAggregationService;
