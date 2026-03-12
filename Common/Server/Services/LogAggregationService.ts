import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import LogDatabaseService from "./LogService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Includes from "../../Types/BaseDatabase/Includes";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";

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
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface FacetRequest {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
  serviceIds?: Array<ObjectID> | undefined;
  severityTexts?: Array<string> | undefined;
  bodySearchText?: string | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
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
  private static readonly TABLE_NAME: string = "LogItem";
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "severityText",
    "serviceId",
    "traceId",
    "spanId",
  ]);
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;

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

    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(time, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket,
        severityText,
        count() AS cnt
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

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY bucket, severityText ORDER BY bucket ASC");

    return statement;
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    const limit: number =
      request.limit ?? LogAggregationService.DEFAULT_FACET_LIMIT;

    LogAggregationService.validateFacetKey(request.facetKey);

    const isTopLevelColumn: boolean = LogAggregationService.isTopLevelColumn(
      request.facetKey,
    );

    const statement: Statement = new Statement();

    if (isTopLevelColumn) {
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

    if (!isTopLevelColumn) {
      statement.append(
        SQL` AND JSONHas(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) = 1`,
      );
    }

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
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

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY bucket");

    if (request.groupBy && request.groupBy.length > 0) {
      LogAggregationService.appendGroupByClause(statement, request.groupBy);
    }

    statement.append(" ORDER BY bucket ASC");

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

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(
      SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
        type: TableColumnType.Number,
        value: limit,
      }}`,
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

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: Pick<
      HistogramRequest,
      "serviceIds" | "severityTexts" | "bodySearchText" | "traceIds" | "spanIds"
    >,
  ): void {
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

    if (LogAggregationService.isTopLevelColumn(facetKey)) {
      return;
    }

    if (!LogAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default LogAggregationService;
