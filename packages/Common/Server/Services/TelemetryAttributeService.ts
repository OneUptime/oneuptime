import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../Utils/AnalyticsDatabase/Statement";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import LogDatabaseService from "./LogService";
import MetricDatabaseService from "./MetricService";
import SpanDatabaseService from "./SpanService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import SecurityEventService from "./SecurityEventService";
import MutableMetricDatabaseService, {
  MutableMetricService as MutableMetricServiceClass,
} from "./MutableMetricService";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import GlobalCache from "../Infrastructure/GlobalCache";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";
import crypto from "crypto";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";

type TelemetrySource = {
  service: AnalyticsDatabaseService<any>;
  tableName: string;
  attributesColumn: string;
  /*
   * Older telemetry tables may lack a separate attributeKeys array column.
   * Leave this undefined for those; the SQL falls back to mapKeys(attributes).
   */
  attributeKeysColumn?: string | undefined;
  timeColumn: string;
  isMutableMetricSource?: boolean | undefined;
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
    metricName?: string | undefined,
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
        if (MutableMetricServiceClass.isMutableMetricName(metricName)) {
          return {
            service: MutableMetricDatabaseService,
            tableName: MutableMetricDatabaseService.model.tableName,
            attributesColumn: "attributes",
            attributeKeysColumn: "attributeKeys",
            timeColumn: "time",
            isMutableMetricSource: true,
          };
        }

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
          attributeKeysColumn: "attributeKeys",
          timeColumn: "time",
        };
      /*
       * Security events carry the whole source payload flattened into
       * `attributes`, which is where every field the OCSF schema does not
       * have a typed column for ends up (device.hostname,
       * finding_info.title, metadata.product.name, ...). The security
       * events table offers those as optional columns, and this is the
       * list it offers.
       */
      case TelemetryType.SecurityEvent:
        return {
          service: SecurityEventService,
          tableName: SecurityEventService.model.tableName,
          attributesColumn: "attributes",
          attributeKeysColumn: "attributeKeys",
          timeColumn: "time",
        };
      default:
        return null;
    }
  }

  /*
   * Whether a signal has attribute keys and values to offer. Profiles have
   * none: a route answers them with nothing, without working out whose
   * telemetry the caller may read.
   */
  public hasAttributeSource(
    telemetryType: TelemetryType,
    metricName?: string | undefined,
  ): boolean {
    return this.getTelemetrySource(telemetryType, metricName) !== null;
  }

  /*
   * `serviceFilter` is whose telemetry the caller may read
   * (TelemetryReadAccess.getServiceFilter): keys are read from those
   * resources' rows only, and cached apart from the whole project's.
   */
  @CaptureSpan()
  public async fetchAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    metricName?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
      data.metricName,
    );

    if (!source) {
      return [];
    }

    const cacheKey: string = TelemetryAttributeService.getCacheKey(
      data.projectId,
      data.telemetryType,
      data.metricName,
      source.tableName,
      data.serviceFilter,
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
        serviceFilter: data.serviceFilter,
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
    sourceTableName?: string | undefined,
    serviceFilter?: TelemetryServiceFilter | undefined,
  ): string {
    let base: string = `${projectId.toString()}:${telemetryType}:${
      sourceTableName || "default"
    }`;

    /*
     * A caller limited to some resources gets keys from those resources
     * only, so their answer is cached under its own scope and never served
     * to (or from) the whole project's.
     */
    const scopeKey: string | null =
      TelemetryAttributeService.getServiceFilterCacheKey(serviceFilter);

    if (scopeKey) {
      base = `${base}:scope:${scopeKey}`;
    }

    if (metricName) {
      return `${base}:${metricName}`;
    }
    return base;
  }

  // A stable digest of a service filter, or null when it filters nothing.
  private static getServiceFilterCacheKey(
    serviceFilter: TelemetryServiceFilter | undefined,
  ): string | null {
    const toSortedIds: (ids: Array<ObjectID> | undefined) => Array<string> = (
      ids: Array<ObjectID> | undefined,
    ): Array<string> => {
      return (ids || [])
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort();
    };

    const serviceIds: Array<string> = toSortedIds(serviceFilter?.serviceIds);
    const excludedServiceIds: Array<string> = toSortedIds(
      serviceFilter?.excludedServiceIds,
    );

    if (serviceIds.length === 0 && excludedServiceIds.length === 0) {
      return null;
    }

    return crypto
      .createHash("sha256")
      .update(`in:${serviceIds.join(",")}|out:${excludedServiceIds.join(",")}`)
      .digest("hex");
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
    isMutableMetricSource?: boolean | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Statement {
    const lookbackStartDate: Date =
      TelemetryAttributeService.getLookbackStartDate();

    if (data.isMutableMetricSource) {
      return TelemetryAttributeService.buildMutableMetricAttributesStatement({
        projectId: data.projectId,
        tableName: data.tableName,
        attributesColumn: data.attributesColumn,
        attributeKeysColumn: data.attributeKeysColumn,
        timeColumn: data.timeColumn,
        metricName: data.metricName,
        lookbackStartDate,
        serviceFilter: data.serviceFilter,
      });
    }

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

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );

    /*
     * Cap runtime below the ClickHouse client's 58s request_timeout so a
     * slow scan on a large project can't hold a pool connection for the
     * full timeout. 'break' returns partial keys, which is fine for an
     * attribute-key picker (matches the findBy / aggregation read paths).
     */
    statement.append(
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static async fetchAttributesFromDatabase(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<Array<string>> {
    const statement: Statement =
      TelemetryAttributeService.buildAttributesStatement({
        projectId: data.projectId,
        tableName: data.source.tableName,
        attributesColumn: data.source.attributesColumn,
        attributeKeysColumn: data.source.attributeKeysColumn,
        timeColumn: data.source.timeColumn,
        metricName: data.metricName,
        isMutableMetricSource: data.source.isMutableMetricSource,
        serviceFilter: data.serviceFilter,
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

  /*
   * `serviceFilter` is whose telemetry the caller may read
   * (TelemetryReadAccess.getServiceFilter): values are read from those
   * resources' rows only.
   */
  @CaptureSpan()
  public async fetchAttributeValues(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
      data.metricName,
    );

    if (!source) {
      return [];
    }

    return TelemetryAttributeService.fetchAttributeValuesFromDatabase({
      projectId: data.projectId,
      source,
      metricName: data.metricName,
      attributeKey: data.attributeKey,
      searchText: data.searchText,
      serviceFilter: data.serviceFilter,
    });
  }

  private static buildAttributeValuesStatement(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Statement {
    const lookbackStartDate: Date =
      TelemetryAttributeService.getLookbackStartDate();

    if (data.source.isMutableMetricSource) {
      return TelemetryAttributeService.buildMutableMetricAttributeValuesStatement(
        {
          projectId: data.projectId,
          source: data.source,
          metricName: data.metricName,
          attributeKey: data.attributeKey,
          searchText: data.searchText,
          lookbackStartDate,
          serviceFilter: data.serviceFilter,
        },
      );
    }

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
        }}`;

    /*
     * Every writer stores the map's keys in attributeKeys, whose bloom index
     * can skip each granule that never saw the key. indexHint() uses the
     * array for that pruning only, without reading it per row, which would
     * add about a quarter to a scan the index cannot shorten. A key absent
     * from the window (each prefix of a key being typed after `@`, a typo)
     * then costs an index probe instead of a day of attribute maps, and a
     * rare key reads only the granules that hold it.
     */
    if (data.source.attributeKeysColumn) {
      statement.append(
        SQL`
        AND indexHint(has(${data.source.attributeKeysColumn}, ${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }}))`,
      );
    }

    /*
     * mapContains() rather than `[key] != ''`: queried through a Distributed
     * table, the subscript form drops the map after PREWHERE and ClickHouse
     * then sizes read blocks by the small value column alone, which took
     * about ten times the memory for the same scan.
     */
    statement.append(
      SQL`
        AND mapContains(${data.source.attributesColumn}, ${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }})`,
    );

    if (data.metricName) {
      statement.append(
        SQL`
        AND name = ${{
          type: TableColumnType.Text,
          value: data.metricName,
        }}`,
      );
    }

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );

    /*
     * Case-insensitive substring filter so the value autocomplete keeps
     * narrowing server-side as the user types. Without it only the first
     * ATTRIBUTE_VALUES_LIMIT values found are ever reachable, which hides
     * matches on high-cardinality keys (host.name, url, ...).
     * Mirrors the ILIKE idiom used for bodySearchText / nameSearchText.
     *
     * The typed text is escaped so `%` and `_` narrow rather than widen —
     * unescaped, typing `100%` listed every value under the key and typing
     * `a_b` matched `axb` as well, so the one value the user was reaching for
     * sat below the LIMIT among values that do not contain what they typed.
     */
    if (data.searchText && data.searchText.trim().length > 0) {
      statement.append(
        SQL`
        AND ${data.source.attributesColumn}[${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }}] ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(data.searchText.trim())}%`,
        }}`,
      );
    }

    /*
     * No ORDER BY: DISTINCT ... LIMIT stops reading once it has
     * ATTRIBUTE_VALUES_LIMIT values, where sorting first means reading every
     * row in the window to find the alphabetically first ones — a full day
     * of attribute maps for a key like url.path, each time the picker opens.
     * fetchAttributeValuesFromDatabase sorts what comes back. A key with
     * more values than the limit offers whichever were found first; the
     * search text narrows to the rest.
     */
    statement.append(
      SQL`
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTE_VALUES_LIMIT,
      }}`,
    );

    /*
     * Cap runtime below the client's 58s request_timeout. This value
     * autocomplete runs per keystroke and scans a Map subscript, so a
     * pathological key/project must not hold a pool connection; 'break'
     * returns partial values, acceptable for autocomplete.
     */
    statement.append(
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static async fetchAttributeValuesFromDatabase(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Promise<Array<string>> {
    const statement: Statement =
      TelemetryAttributeService.buildAttributeValuesStatement(data);

    const dbResult: Results = await data.source.service.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    const values: Array<string> = rows
      .map((row: JSONObject) => {
        const val: unknown = row["attributeValue"];
        return typeof val === "string" ? val.trim() : null;
      })
      .filter((val: string | null): val is string => {
        return Boolean(val);
      });

    /*
     * Sorted here rather than in the query (see
     * buildAttributeValuesStatement); code-unit order matches the byte order
     * ClickHouse sorted ASCII values by. Trimming can make two stored values
     * equal, hence the Set.
     */
    return Array.from(new Set(values)).sort();
  }

  private static buildMutableMetricAttributesStatement(data: {
    projectId: ObjectID;
    tableName: string;
    attributesColumn: string;
    attributeKeysColumn?: string | undefined;
    timeColumn: string;
    metricName?: string | undefined;
    lookbackStartDate: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Statement {
    const attributeKeysColumn: string =
      data.attributeKeysColumn || "attributeKeys";

    const statement: Statement = SQL`
      SELECT arrayDistinct(arrayFlatten(groupUniqArrayArray(${attributeKeysColumn}))) AS keys
      FROM (
        SELECT
          argMax(${data.timeColumn}, version) AS ${data.timeColumn},
          argMax(${data.attributesColumn}, version) AS ${data.attributesColumn},
          argMax(${attributeKeysColumn}, version) AS ${attributeKeysColumn},
          argMax(retentionDate, version) AS retentionDate,
          argMax(isDeleted, version) AS isDeleted
        FROM ${data.tableName}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
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

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );

    statement.append(SQL`
        GROUP BY projectId, name, primaryEntityId, primaryEntityType, metricPointId
      )
      WHERE isDeleted = false
        AND retentionDate >= now()
        AND ${data.timeColumn} >= ${{
          type: TableColumnType.Date,
          value: data.lookbackStartDate,
        }}
        AND NOT empty(${attributeKeysColumn})`);

    statement.append(
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
    );

    return statement;
  }

  private static buildMutableMetricAttributeValuesStatement(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    lookbackStartDate: Date;
    serviceFilter?: TelemetryServiceFilter | undefined;
  }): Statement {
    const statement: Statement = SQL`
      SELECT DISTINCT ${data.source.attributesColumn}[${{
        type: TableColumnType.Text,
        value: data.attributeKey,
      }}] AS attributeValue
      FROM (
        SELECT
          argMax(${data.source.timeColumn}, version) AS ${data.source.timeColumn},
          argMax(${data.source.attributesColumn}, version) AS ${data.source.attributesColumn},
          argMax(retentionDate, version) AS retentionDate,
          argMax(isDeleted, version) AS isDeleted
        FROM ${data.source.tableName}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
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

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.serviceFilter || {},
    );

    statement.append(SQL`
        GROUP BY projectId, name, primaryEntityId, primaryEntityType, metricPointId
      )
      WHERE isDeleted = false
        AND retentionDate >= now()
        AND ${data.source.timeColumn} >= ${{
          type: TableColumnType.Date,
          value: data.lookbackStartDate,
        }}
        AND mapContains(${data.source.attributesColumn}, ${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }})`);

    // Escaped like the immutable path above; see the note there.
    if (data.searchText && data.searchText.trim().length > 0) {
      statement.append(
        SQL`
        AND ${data.source.attributesColumn}[${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }}] ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(data.searchText.trim())}%`,
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

    statement.append(
      " SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
    );

    return statement;
  }
}

export default new TelemetryAttributeService();
