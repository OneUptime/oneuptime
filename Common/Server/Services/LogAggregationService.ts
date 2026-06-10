import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import LogDatabaseService from "./LogService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import ServiceType from "../../Types/Telemetry/ServiceType";

export interface HistogramBucket {
  time: string;
  severity: string;
  count: number;
}

export interface HistogramRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
  serviceIds?: Array<ObjectID> | undefined;
  entityKeys?: Array<string> | undefined;
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  attributes?: Record<string, string> | undefined;
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
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  attributes?: Record<string, string> | undefined;
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
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
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
      ["kubernetesClusterId", ServiceType.KubernetesCluster],
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
      statement.append(
        SQL`SELECT JSONExtractRaw(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) AS val, count() AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
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
        SQL` AND JSONHas(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) = 1`,
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
          SQL`, JSONExtractRaw(attributes, ${{
            type: TableColumnType.Text,
            value: key,
          }}) AS ${alias}`,
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

      return `uniqExact(JSONExtractRaw(attributes, '${request.aggregationField.replace(/'/g, "\\'")}'))`;
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
      statement.append(`SELECT JSONExtractRaw(attributes, `);
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: groupByKey,
        }}`,
      );
      statement.append(
        `) AS val, ${aggExpr} AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
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
        SQL` AND JSONHas(attributes, ${{
          type: TableColumnType.Text,
          value: groupByKey,
        }}) = 1`,
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
      | "severityTexts"
      | "bodySearchText"
      | "traceIds"
      | "spanIds"
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

    if (request.bodySearchText && request.bodySearchText.trim().length > 0) {
      statement.append(
        ` AND body ILIKE ${{
          type: TableColumnType.Text,
          value: `%${request.bodySearchText.trim()}%`,
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
      ORDER BY time DESC, timeUnixNano DESC
      LIMIT ${{
        type: TableColumnType.Number,
        value: count,
      }}
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
      ORDER BY time ASC, timeUnixNano ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: count,
      }}
    `;

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
