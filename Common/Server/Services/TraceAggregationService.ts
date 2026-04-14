import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
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

export interface HistogramBucket {
  time: string;
  series: string;
  count: number;
}

export interface TraceFilters {
  serviceIds?: Array<ObjectID> | undefined;
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
    "serviceId",
    "traceId",
    "spanId",
    "parentSpanId",
    "name",
    "kind",
    "statusCode",
    "isRootSpan",
  ]);
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;

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
    } catch (_parseError) {
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

    const topLevelKeys: Array<string> = request.facetKeys.filter(
      (key: string): boolean => {
        return TraceAggregationService.isTopLevelColumn(key);
      },
    );
    const attributeKeys: Array<string> = request.facetKeys.filter(
      (key: string): boolean => {
        return !TraceAggregationService.isTopLevelColumn(key);
      },
    );

    const selectColumns: Array<string> = [];
    if (topLevelKeys.length > 0) {
      selectColumns.push(...topLevelKeys);
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
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
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
     * If any non-projection filter (kind, name, traceId, nameSearchText,
     * attributes) is active, ClickHouse transparently falls back to
     * scanning the main table for the inner query — same cost as before.
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
          AND startTime >= ${{
            type: TableColumnType.Date,
            value: request.startTime,
          }}
          AND startTime <= ${{
            type: TableColumnType.Date,
            value: request.endTime,
          }}
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
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', optimize_use_projections = 1",
    );

    return statement;
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    const limit: number =
      request.limit ?? TraceAggregationService.DEFAULT_FACET_LIMIT;

    TraceAggregationService.validateFacetKey(request.facetKey);

    const isTopLevelColumn: boolean = TraceAggregationService.isTopLevelColumn(
      request.facetKey,
    );

    const statement: Statement = new Statement();

    if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
      );
    } else {
      statement.append(
        SQL`SELECT JSONExtractRaw(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) AS val, count() AS cnt FROM ${TraceAggregationService.TABLE_NAME}`,
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

    if (!isTopLevelColumn) {
      statement.append(
        SQL` AND JSONHas(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) = 1`,
      );
    }

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
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
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
        SQL` AND serviceId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            request.serviceIds.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
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

        statement.append(
          SQL` AND attributes[${{
            type: TableColumnType.Text,
            value: attrKey,
          }}] = ${{
            type: TableColumnType.Text,
            value: attrValue,
          }}`,
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

    if (TraceAggregationService.isTopLevelColumn(facetKey)) {
      return;
    }

    if (!TraceAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default TraceAggregationService;
