import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import LogDatabaseService from "./LogService";
import MetricDatabaseService from "./MetricService";
import SpanDatabaseService from "./SpanService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import GlobalCache from "../Infrastructure/GlobalCache";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";

type TelemetrySource = {
  service: AnalyticsDatabaseService<any>;
  tableName: string;
  attributesColumn: string;
  /*
   * Some tables (e.g. ExceptionInstance) don't have a separate
   * attributeKeys array column — only the attributes map. Leave this
   * undefined for those; the SQL falls back to mapKeys(attributes).
   */
  attributeKeysColumn?: string | undefined;
  timeColumn: string;
};

type TelemetryAttributesCacheEntry = {
  attributes: Array<string>;
  refreshedAt: Date;
};

export class TelemetryAttributeService {
  private static readonly ATTRIBUTES_LIMIT: number = 5000;
  private static readonly CACHE_NAMESPACE: string = "telemetry-attributes";
  /*
   * Attribute keys change rarely. Cache for an hour so the (still O(seconds))
   * ClickHouse scan only runs once per project per hour rather than on every
   * dashboard / metrics-explorer load.
   */
  private static readonly CACHE_STALE_AFTER_MINUTES: number = 60;
  /*
   * The previous 30-day window forced a 100M+ row scan with an in-CTE
   * ORDER BY time DESC that pushed this query to 30-60s on busy projects.
   * Attribute keys rotate slowly, so a 1-day window covers virtually every
   * active key while keeping the scan tractable.
   */
  private static readonly LOOKBACK_WINDOW_IN_DAYS: number = 1;

  private getTelemetrySource(
    telemetryType: TelemetryType,
  ): TelemetrySource | null {
    switch (telemetryType) {
      case TelemetryType.Log:
        return {
          service: LogDatabaseService,
          tableName: LogDatabaseService.model.tableName,
          attributesColumn: "attributes",
          attributeKeysColumn: "attributeKeys",
          timeColumn: "time",
        };
      case TelemetryType.Metric:
        return {
          service: MetricDatabaseService,
          tableName: MetricDatabaseService.model.tableName,
          attributesColumn: "attributes",
          attributeKeysColumn: "attributeKeys",
          timeColumn: "time",
        };
      case TelemetryType.Trace:
        return {
          service: SpanDatabaseService,
          tableName: SpanDatabaseService.model.tableName,
          attributesColumn: "attributes",
          attributeKeysColumn: "attributeKeys",
          timeColumn: "startTime",
        };
      case TelemetryType.Exception:
        return {
          service: ExceptionInstanceService,
          tableName: ExceptionInstanceService.model.tableName,
          attributesColumn: "attributes",
          // ExceptionInstance has no attributeKeys column.
          timeColumn: "time",
        };
      default:
        return null;
    }
  }

  @CaptureSpan()
  public async fetchAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    metricName?: string | undefined;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
    );

    if (!source) {
      return [];
    }

    const cacheKey: string = TelemetryAttributeService.getCacheKey(
      data.projectId,
      data.telemetryType,
      data.metricName,
    );

    const cachedEntry: TelemetryAttributesCacheEntry | null =
      await TelemetryAttributeService.getCachedAttributes(cacheKey);

    if (cachedEntry && TelemetryAttributeService.isCacheFresh(cachedEntry)) {
      return cachedEntry.attributes;
    }

    let attributes: Array<string> = [];

    try {
      attributes = await TelemetryAttributeService.fetchAttributesFromDatabase({
        projectId: data.projectId,
        source,
        metricName: data.metricName,
      });
    } catch (error) {
      if (cachedEntry) {
        return cachedEntry.attributes;
      }

      throw error;
    }

    await TelemetryAttributeService.storeAttributesInCache(
      cacheKey,
      attributes,
    );

    if (attributes.length === 0 && cachedEntry) {
      return cachedEntry.attributes;
    }

    return attributes;
  }

  private static getCacheKey(
    projectId: ObjectID,
    telemetryType: TelemetryType,
    metricName?: string | undefined,
  ): string {
    const base: string = `${projectId.toString()}:${telemetryType}`;
    if (metricName) {
      return `${base}:${metricName}`;
    }
    return base;
  }

  private static getLookbackStartDate(): Date {
    return OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -TelemetryAttributeService.LOOKBACK_WINDOW_IN_DAYS,
    );
  }

  private static async getCachedAttributes(
    cacheKey: string,
  ): Promise<TelemetryAttributesCacheEntry | null> {
    let payload: JSONObject | null = null;

    try {
      payload = await GlobalCache.getJSONObject(
        TelemetryAttributeService.CACHE_NAMESPACE,
        cacheKey,
      );
    } catch {
      return null;
    }

    if (!payload) {
      return null;
    }

    const attributesValue: JSONObject["attributes"] = payload["attributes"];
    const refreshedAtValue: JSONObject["refreshedAt"] = payload["refreshedAt"];

    if (
      !Array.isArray(attributesValue) ||
      typeof refreshedAtValue !== "string"
    ) {
      return null;
    }

    const attributeCandidates: Array<unknown> =
      attributesValue as Array<unknown>;

    const attributes: Array<string> = attributeCandidates.filter(
      (attribute: unknown): attribute is string => {
        return typeof attribute === "string";
      },
    );

    return {
      attributes,
      refreshedAt: OneUptimeDate.fromString(refreshedAtValue),
    };
  }

  private static isCacheFresh(
    cacheEntry: TelemetryAttributesCacheEntry,
  ): boolean {
    const now: Date = OneUptimeDate.getCurrentDate();
    const minutesSinceRefresh: number = Math.abs(
      OneUptimeDate.getNumberOfMinutesBetweenDates(cacheEntry.refreshedAt, now),
    );

    return (
      minutesSinceRefresh <= TelemetryAttributeService.CACHE_STALE_AFTER_MINUTES
    );
  }

  private static async storeAttributesInCache(
    cacheKey: string,
    attributes: Array<string>,
  ): Promise<void> {
    const payload: JSONObject = {
      attributes,
      refreshedAt: OneUptimeDate.getCurrentDate().toISOString(),
    };

    try {
      await GlobalCache.setJSON(
        TelemetryAttributeService.CACHE_NAMESPACE,
        cacheKey,
        payload,
        {
          expiresInSeconds:
            TelemetryAttributeService.CACHE_STALE_AFTER_MINUTES * 60,
        },
      );
    } catch {
      return;
    }
  }

  private static buildAttributesStatement(data: {
    projectId: ObjectID;
    tableName: string;
    attributesColumn: string;
    attributeKeysColumn?: string | undefined;
    timeColumn: string;
    metricName?: string | undefined;
  }): Statement {
    const lookbackStartDate: Date =
      TelemetryAttributeService.getLookbackStartDate();

    /*
     * Two notable choices here:
     *
     * 1. We aggregate with `groupUniqArrayArray` (or `mapKeys`+`groupUniqArray`
     *    for tables that lack the denormalized array column) instead of
     *    `arrayJoin` + outer `DISTINCT`. That avoids materializing one row
     *    per attribute key across millions of source rows.
     *
     * 2. The previous implementation wrapped the scan in
     *    `ORDER BY time DESC LIMIT 10000` to "cap" the work. With `arrayJoin`
     *    that LIMIT applied AFTER expansion so it didn't actually bound rows
     *    read, but it did force ClickHouse to sort every matching row by
     *    time — the dominant cost on busy projects. Bounded by lookback
     *    instead, the aggregate-and-flatten approach finishes in seconds.
     */
    const statement: Statement = data.attributeKeysColumn
      ? SQL`
      SELECT arrayDistinct(arrayFlatten(groupUniqArrayArray(${data.attributeKeysColumn}))) AS keys
      FROM ${data.tableName}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND NOT empty(${data.attributeKeysColumn})
        AND ${data.timeColumn} >= ${{
          type: TableColumnType.Date,
          value: lookbackStartDate,
        }}`
      : SQL`
      SELECT groupUniqArray(arrayJoin(mapKeys(${data.attributesColumn}))) AS keys
      FROM ${data.tableName}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND NOT empty(${data.attributesColumn})
        AND ${data.timeColumn} >= ${{
          type: TableColumnType.Date,
          value: lookbackStartDate,
        }}`;

    if (data.metricName) {
      statement.append(
        SQL`
        AND name = ${{
          type: TableColumnType.Text,
          value: data.metricName,
        }}`,
      );
    }

    return statement;
  }

  private static async fetchAttributesFromDatabase(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
  }): Promise<Array<string>> {
    const statement: Statement =
      TelemetryAttributeService.buildAttributesStatement({
        projectId: data.projectId,
        tableName: data.source.tableName,
        attributesColumn: data.source.attributesColumn,
        attributeKeysColumn: data.source.attributeKeysColumn,
        timeColumn: data.source.timeColumn,
        metricName: data.metricName,
      });

    const dbResult: Results = await data.source.service.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const firstRow: JSONObject | undefined = rows[0];
    const rawKeys: unknown = firstRow ? firstRow["keys"] : null;

    if (!Array.isArray(rawKeys)) {
      return [];
    }

    const attributeKeys: Array<string> = rawKeys
      .map((attribute: unknown): string | null => {
        return typeof attribute === "string" ? attribute.trim() : null;
      })
      .filter((attribute: string | null): attribute is string => {
        return Boolean(attribute);
      });

    const distinctKeys: Array<string> = Array.from(new Set(attributeKeys));
    distinctKeys.sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });
    if (distinctKeys.length > TelemetryAttributeService.ATTRIBUTES_LIMIT) {
      distinctKeys.length = TelemetryAttributeService.ATTRIBUTES_LIMIT;
    }
    return distinctKeys;
  }

  private static readonly ATTRIBUTE_VALUES_LIMIT: number = 100;

  @CaptureSpan()
  public async fetchAttributeValues(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    metricName?: string | undefined;
    attributeKey: string;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
    );

    if (!source) {
      return [];
    }

    return TelemetryAttributeService.fetchAttributeValuesFromDatabase({
      projectId: data.projectId,
      source,
      metricName: data.metricName,
      attributeKey: data.attributeKey,
    });
  }

  private static async fetchAttributeValuesFromDatabase(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
  }): Promise<Array<string>> {
    const lookbackStartDate: Date =
      TelemetryAttributeService.getLookbackStartDate();

    const statement: Statement = SQL`
      SELECT DISTINCT ${data.source.attributesColumn}[${{
        type: TableColumnType.Text,
        value: data.attributeKey,
      }}] AS attributeValue
      FROM ${data.source.tableName}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND ${data.source.timeColumn} >= ${{
          type: TableColumnType.Date,
          value: lookbackStartDate,
        }}
        AND mapContains(${data.source.attributesColumn}, ${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }})`;

    if (data.metricName) {
      statement.append(
        SQL`
        AND name = ${{
          type: TableColumnType.Text,
          value: data.metricName,
        }}`,
      );
    }

    statement.append(
      SQL`
      ORDER BY attributeValue ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTE_VALUES_LIMIT,
      }}`,
    );

    const dbResult: Results = await data.source.service.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    return rows
      .map((row: JSONObject) => {
        const val: unknown = row["attributeValue"];
        return typeof val === "string" ? val.trim() : null;
      })
      .filter((val: string | null): val is string => {
        return Boolean(val);
      });
  }
}

export default new TelemetryAttributeService();
