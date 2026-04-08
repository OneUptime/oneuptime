import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import LogDatabaseService from "./LogService";
import MetricDatabaseService from "./MetricService";
import SpanDatabaseService from "./SpanService";
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
  attributeKeysColumn: string;
  timeColumn: string;
};

type TelemetryAttributesCacheEntry = {
  attributes: Array<string>;
  refreshedAt: Date;
};

export class TelemetryAttributeService {
  private static readonly ATTRIBUTES_LIMIT: number = 5000;
  private static readonly ROW_SCAN_LIMIT: number = 10000;
  private static readonly CACHE_NAMESPACE: string = "telemetry-attributes";
  private static readonly CACHE_STALE_AFTER_MINUTES: number = 5;
  private static readonly LOOKBACK_WINDOW_IN_DAYS: number = 30;

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
    attributeKeysColumn: string;
    timeColumn: string;
    metricName?: string | undefined;
  }): Statement {
    const lookbackStartDate: Date =
      TelemetryAttributeService.getLookbackStartDate();

    const statement: Statement = SQL`
      WITH filtered AS (
        SELECT arrayJoin(
            if(
              empty(${data.attributeKeysColumn}),
              mapKeys(${data.attributesColumn}),
              ${data.attributeKeysColumn}
            )
          ) AS attribute
        FROM ${data.tableName}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
        }}
          AND (
            NOT empty(${data.attributeKeysColumn}) OR
            NOT empty(${data.attributesColumn})
          )
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

    statement.append(
      SQL`
        ORDER BY ${data.timeColumn} DESC
        LIMIT ${{
          type: TableColumnType.Number,
          value: TelemetryAttributeService.ROW_SCAN_LIMIT,
        }}
      )
      SELECT DISTINCT attribute
      FROM filtered
      WHERE attribute IS NOT NULL AND attribute != ''
      ORDER BY attribute ASC
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTES_LIMIT,
      }}`,
    );

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

    const attributeKeys: Array<string> = rows
      .map((row: JSONObject) => {
        const attribute: unknown = row["attribute"];
        return typeof attribute === "string" ? attribute.trim() : null;
      })
      .filter((attribute: string | null): attribute is string => {
        return Boolean(attribute);
      });

    return Array.from(new Set(attributeKeys));
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
