import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import LogDatabaseService from "./LogService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
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

export class LogAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 10;
  private static readonly TABLE_NAME: string = "LogItem";

  @CaptureSpan()
  public static async getHistogram(
    request: HistogramRequest,
  ): Promise<Array<HistogramBucket>> {
    const statement: Statement =
      LogAggregationService.buildHistogramStatement(request);

    const dbResult: Results =
      await LogDatabaseService.executeQuery(statement);
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

    const dbResult: Results =
      await LogDatabaseService.executeQuery(statement);
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

  private static buildHistogramStatement(
    request: HistogramRequest,
  ): Statement {
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

    const isTopLevelColumn: boolean =
      LogAggregationService.isTopLevelColumn(request.facetKey);

    const escapedKey: string = LogAggregationService.escapeSingleQuotes(
      request.facetKey,
    );

    const valueExpression: string = isTopLevelColumn
      ? `toString(${escapedKey})`
      : `JSONExtractRaw(attributes, '${escapedKey}')`;

    // Build with raw SQL for the expression part, then parameterize WHERE values
    const statement: Statement = new Statement();

    statement.append(
      `SELECT ${valueExpression} AS val, count() AS cnt FROM ${LogAggregationService.TABLE_NAME}`,
    );

    statement.append(SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: request.projectId,
    }} AND time >= ${{
      type: TableColumnType.Date,
      value: request.startTime,
    }} AND time <= ${{
      type: TableColumnType.Date,
      value: request.endTime,
    }}`);

    if (!isTopLevelColumn) {
      statement.append(` AND JSONHas(attributes, '${escapedKey}') = 1`);
    }

    LogAggregationService.appendCommonFilters(statement, request);

    statement.append(SQL` GROUP BY val ORDER BY cnt DESC LIMIT ${{
      type: TableColumnType.Number,
      value: limit,
    }}`);

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
      const idStrings: Array<string> = request.serviceIds.map(
        (id: ObjectID): string => `'${id.toString()}'`,
      );
      statement.append(` AND serviceId IN (${idStrings.join(",")})`);
    }

    if (request.severityTexts && request.severityTexts.length > 0) {
      const sevStrings: Array<string> = request.severityTexts.map(
        (s: string): string =>
          `'${LogAggregationService.escapeSingleQuotes(s)}'`,
      );
      statement.append(` AND severityText IN (${sevStrings.join(",")})`);
    }

    if (request.traceIds && request.traceIds.length > 0) {
      const traceStrings: Array<string> = request.traceIds.map(
        (s: string): string =>
          `'${LogAggregationService.escapeSingleQuotes(s)}'`,
      );
      statement.append(` AND traceId IN (${traceStrings.join(",")})`);
    }

    if (request.spanIds && request.spanIds.length > 0) {
      const spanStrings: Array<string> = request.spanIds.map(
        (s: string): string =>
          `'${LogAggregationService.escapeSingleQuotes(s)}'`,
      );
      statement.append(` AND spanId IN (${spanStrings.join(",")})`);
    }

    if (request.bodySearchText && request.bodySearchText.trim().length > 0) {
      statement.append(` AND body ILIKE ${{
        type: TableColumnType.Text,
        value: `%${request.bodySearchText.trim()}%`,
      }}`);
    }
  }

  private static isTopLevelColumn(key: string): boolean {
    const topLevelColumns: Set<string> = new Set([
      "severityText",
      "serviceId",
      "traceId",
      "spanId",
    ]);
    return topLevelColumns.has(key);
  }

  private static escapeSingleQuotes(value: string): string {
    return value.replace(/'/g, "\\'");
  }
}

export default LogAggregationService;
