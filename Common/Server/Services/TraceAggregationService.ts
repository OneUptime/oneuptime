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

    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(startTime, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket,
        statusCode,
        count() AS cnt
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

    statement.append(" GROUP BY bucket, statusCode ORDER BY bucket ASC");

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

    // Defense in depth: cap individual facet query runtime below nginx's
    // 60s proxy_read_timeout so a slow facet never starves the endpoint.
    statement.append(
      " SETTINGS max_execution_time = 55, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: TraceFilters,
  ): void {
    if (request.rootOnly) {
      statement.append(" AND (parentSpanId = '' OR parentSpanId IS NULL)");
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
