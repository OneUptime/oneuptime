import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import ExceptionInstanceService from "./ExceptionInstanceService";
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

export interface ExceptionFilters {
  serviceIds?: Array<ObjectID> | undefined;
  exceptionTypes?: Array<string> | undefined;
  environments?: Array<string> | undefined;
  fingerprints?: Array<string> | undefined;
  traceIds?: Array<string> | undefined;
  escaped?: boolean | undefined;
  messageSearchText?: string | undefined;
}

export interface HistogramRequest extends ExceptionFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface FacetRequest extends ExceptionFilters {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  facetKey: string;
  limit?: number | undefined;
}

export class ExceptionAggregationService {
  private static readonly DEFAULT_FACET_LIMIT: number = 500;
  private static readonly TABLE_NAME: string =
    AnalyticsTableName.ExceptionInstance;
  private static readonly TOP_LEVEL_COLUMNS: Set<string> = new Set([
    "serviceId",
    "exceptionType",
    "environment",
    "fingerprint",
    "traceId",
    "spanId",
    "escaped",
    "release",
  ]);
  private static readonly ATTRIBUTE_KEY_PATTERN: RegExp = /^[a-zA-Z0-9._:/-]+$/;
  private static readonly MAX_FACET_KEY_LENGTH: number = 256;

  @CaptureSpan()
  public static async getHistogram(
    request: HistogramRequest,
  ): Promise<Array<HistogramBucket>> {
    const statement: Statement =
      ExceptionAggregationService.buildHistogramStatement(request);

    const dbResult: Results =
      await ExceptionInstanceService.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows.map((row: JSONObject): HistogramBucket => {
      return {
        time: String(row["bucket"] || ""),
        series: ExceptionAggregationService.mapEscapedToSeries(row["escaped"]),
        count: Number(row["cnt"] || 0),
      };
    });
  }

  @CaptureSpan()
  public static async getFacetValues(
    request: FacetRequest,
  ): Promise<Array<FacetValue>> {
    const statement: Statement =
      ExceptionAggregationService.buildFacetStatement(request);

    const dbResult: Results =
      await ExceptionInstanceService.executeQuery(statement);
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

  private static mapEscapedToSeries(raw: unknown): string {
    // ClickHouse returns booleans as 0/1
    if (raw === true || raw === 1 || raw === "1" || raw === "true") {
      return "unhandled";
    }
    return "handled";
  }

  private static buildHistogramStatement(request: HistogramRequest): Statement {
    const intervalSeconds: number = request.bucketSizeInMinutes * 60;

    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(time, INTERVAL ${{
          type: TableColumnType.Number,
          value: intervalSeconds,
        }} SECOND) AS bucket,
        escaped,
        count() AS cnt
      FROM ${ExceptionAggregationService.TABLE_NAME}
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

    ExceptionAggregationService.appendCommonFilters(statement, request);

    statement.append(" GROUP BY bucket, escaped ORDER BY bucket ASC");

    /*
     * Defense in depth: cap histogram runtime below nginx's 60s
     * proxy_read_timeout. 'break' returns partial aggregated results
     * rather than throwing, which is acceptable for a density viz.
     */
    statement.append(
      " SETTINGS max_execution_time = 55, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static buildFacetStatement(request: FacetRequest): Statement {
    const limit: number =
      request.limit ?? ExceptionAggregationService.DEFAULT_FACET_LIMIT;

    ExceptionAggregationService.validateFacetKey(request.facetKey);

    const isTopLevelColumn: boolean =
      ExceptionAggregationService.isTopLevelColumn(request.facetKey);

    const statement: Statement = new Statement();

    if (isTopLevelColumn) {
      statement.append(
        SQL`SELECT toString(${request.facetKey}) AS val, count() AS cnt FROM ${ExceptionAggregationService.TABLE_NAME}`,
      );
    } else {
      statement.append(
        SQL`SELECT JSONExtractRaw(attributes, ${{
          type: TableColumnType.Text,
          value: request.facetKey,
        }}) AS val, count() AS cnt FROM ${ExceptionAggregationService.TABLE_NAME}`,
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

    ExceptionAggregationService.appendCommonFilters(statement, request);

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
      " SETTINGS max_execution_time = 55, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static appendCommonFilters(
    statement: Statement,
    request: ExceptionFilters,
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

    if (request.exceptionTypes && request.exceptionTypes.length > 0) {
      statement.append(
        SQL` AND exceptionType IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.exceptionTypes),
        }})`,
      );
    }

    if (request.environments && request.environments.length > 0) {
      statement.append(
        SQL` AND environment IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.environments),
        }})`,
      );
    }

    if (request.fingerprints && request.fingerprints.length > 0) {
      statement.append(
        SQL` AND fingerprint IN (${{
          type: TableColumnType.Text,
          value: new Includes(request.fingerprints),
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

    if (request.escaped !== undefined) {
      statement.append(
        SQL` AND escaped = ${{
          type: TableColumnType.Boolean,
          value: request.escaped,
        }}`,
      );
    }

    if (
      request.messageSearchText &&
      request.messageSearchText.trim().length > 0
    ) {
      statement.append(
        SQL` AND message ILIKE ${{
          type: TableColumnType.Text,
          value: `%${request.messageSearchText.trim()}%`,
        }}`,
      );
    }
  }

  private static isTopLevelColumn(key: string): boolean {
    return ExceptionAggregationService.TOP_LEVEL_COLUMNS.has(key);
  }

  private static validateFacetKey(
    facetKey: unknown,
  ): asserts facetKey is string {
    if (typeof facetKey !== "string") {
      throw new BadDataException("Invalid facetKey");
    }

    if (
      facetKey.length === 0 ||
      facetKey.length > ExceptionAggregationService.MAX_FACET_KEY_LENGTH
    ) {
      throw new BadDataException("Invalid facetKey");
    }

    if (ExceptionAggregationService.isTopLevelColumn(facetKey)) {
      return;
    }

    if (!ExceptionAggregationService.ATTRIBUTE_KEY_PATTERN.test(facetKey)) {
      throw new BadDataException("Invalid facetKey");
    }
  }
}

export default ExceptionAggregationService;
