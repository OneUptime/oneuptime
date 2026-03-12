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

export class LogAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 10;
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
