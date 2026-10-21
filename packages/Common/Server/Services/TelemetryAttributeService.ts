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
import {
  INTERACTIVE_READ_TIME_LIMIT,
  SUGGESTION_READ_TIME_LIMIT,
  getQuerySettings,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import ClickhouseReadResult from "../Utils/AnalyticsDatabase/ClickhouseReadResult";
import AttributeValueSuggestionCache, {
  AttributeValueSuggestionCacheEntry,
} from "../Utils/Telemetry/AttributeValueSuggestionCache";
import SingleFlight from "../Utils/SingleFlight";
import {
  ATTRIBUTE_KEYS_LIMIT,
  ATTRIBUTE_VALUES_LIMIT,
  MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH,
} from "../../Types/Telemetry/AttributeSuggestionLimits";
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

// The stretch of time one value lookup reads, edges included.
export interface AttributeValueLookupWindow {
  startTime: Date;
  endTime: Date;
}

/*
 * HOW MUCH ONE VALUE LOOKUP MAY READ (issue #4708).
 *
 * The value picker asks for the values of one attribute key. It used to read
 * every row of the last day that had the key - the whole attributes map of
 * each - sort them all and keep the first 100. On a project writing 30
 * million log lines a day that was 40 to 57 CPU-seconds per lookup whatever
 * the key: a key on every row with three values, a key on one row in a
 * hundred, a key no row has. Typing a key could start several at once.
 *
 * A lookup now reads a bounded sample, measured on ClickHouse 26.7 with that
 * project (25 keys a row, see AttributeValueSuggestionsClickhouse.test.ts):
 *
 *   - it reads only granules that can hold the key: `has(attributeKeys, k)`
 *     is what idx_attribute_keys answers, so a key no row has reads no rows
 *     at all (0.01 CPU-s, from 40);
 *   - it stops at ROWS_WITH_KEY_LIMIT rows that hold the key, and as soon as
 *     it has ATTRIBUTE_VALUES_LIMIT different values: a key on every row,
 *     with few values or many, reads about 25 thousand rows (0.05 CPU-s,
 *     from 45);
 *   - it reads at most ROWS_READ_BUDGET rows in all, so a key on few rows
 *     with few values - which never fills the limits above - costs the same
 *     over a week as over an hour (1.3 CPU-s for a key on one row in 200,
 *     from 43). ClickHouse stops reading at the budget and answers with the
 *     values it found, a whole document (read_overflow_mode 'break', checked
 *     on 24.8 and 26.7) - unlike a stop at the time limit;
 *   - four threads and small blocks hold it to under 75 MiB (from 450);
 *   - it has 10 seconds (SUGGESTION_READ_TIME_LIMIT, 'throw'), so on a
 *     database too busy to answer the picker says it could not load the
 *     values instead of spinning.
 *
 * Which rows the sample holds is up to ClickHouse: a value seldom used can be
 * missing from it. The picker is a shortcut to a value, never the only way to
 * one - any value can still be typed.
 */
const ROWS_WITH_KEY_LIMIT: number = 10000;
const ROWS_READ_BUDGET: number = 1000000;

/*
 * The window a lookup reads. The explorers send the time range on screen, so
 * the values offered are those of the rows the reader is looking at - the
 * pods of last Tuesday's incident, not today's. Its edges are widened to
 * whole five minutes, so readers on the same range in the same five minutes
 * ask the same question and share one answer, and a range longer than a week
 * is read from its newest week: the read is bounded by rows either way, and
 * the newest values are the likeliest to be wanted. A caller with no range on
 * screen (a dashboard variable, a chart editor) reads the last day.
 */
const VALUE_LOOKUP_STEP_IN_MS: number = 5 * 60 * 1000;
const VALUE_LOOKUP_DEFAULT_WINDOW_IN_MS: number = 24 * 60 * 60 * 1000;
const VALUE_LOOKUP_MAX_WINDOW_IN_MS: number = 7 * 24 * 60 * 60 * 1000;

/*
 * An attribute key longer than this is not a key anybody's telemetry has: it
 * is answered with no values, without a read.
 */
const MAX_ATTRIBUTE_KEY_LENGTH: number = 1024;

/*
 * Answers are kept five minutes (see AttributeValueSuggestionCache), and a
 * lookup that ran out of time is not tried again for a minute.
 */
const VALUE_ANSWER_TTL_IN_MS: number = 5 * 60 * 1000;
const VALUE_STOPPED_TTL_IN_MS: number = 60 * 1000;

export class TelemetryAttributeService {
  private static readonly ATTRIBUTES_LIMIT: number = ATTRIBUTE_KEYS_LIMIT;
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

  private static readonly ATTRIBUTE_VALUES_LIMIT: number =
    ATTRIBUTE_VALUES_LIMIT;

  private static readonly valueCache: AttributeValueSuggestionCache =
    new AttributeValueSuggestionCache({
      maxEntries: 2000,
      // About 8 MB of text in all: a typical answer is a few hundred bytes.
      maxCharacters: 4000000,
      answerTtlInMs: VALUE_ANSWER_TTL_IN_MS,
      stoppedTtlInMs: VALUE_STOPPED_TTL_IN_MS,
    });

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

  /*
   * The key list runs to the explorers' time limit and stops with 'throw'
   * (INTERACTIVE_READ_TIME_LIMIT). It used to say 'break', which reads a
   * stopped aggregation as an empty answer it never was (see
   * ClickhouseReadResult); a stop now fails the read, and fetchAttributes
   * answers with the last list it had, if it has one.
   */
  private static keyListSettings(): string {
    return getQuerySettings({
      maxExecutionTimeInSeconds:
        INTERACTIVE_READ_TIME_LIMIT.maxExecutionTimeInSeconds,
      timeoutOverflowMode: INTERACTIVE_READ_TIME_LIMIT.timeoutOverflowMode,
    });
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

    statement.append(TelemetryAttributeService.keyListSettings());

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

  /*
   * The values seen under one attribute key, for a picker: at most 100, in
   * alphabetical order, read from a bounded sample of the window (see the
   * top of this file) and kept for five minutes.
   *
   * `serviceFilter` is whose telemetry the caller may read
   * (TelemetryReadAccess.getServiceFilter): values are read from those
   * resources' rows only, and an answer is only ever reused for a caller of
   * the same project and the same scope.
   *
   * `startTime` / `endTime` is the time range the reader is looking at;
   * without it, the last day. A lookup that runs out of time throws a
   * QueryTimeoutException, and one asked again within a minute throws it
   * again without a read.
   */
  @CaptureSpan()
  public async fetchAttributeValues(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
    startTime?: Date | undefined;
    endTime?: Date | undefined;
  }): Promise<string[]> {
    const source: TelemetrySource | null = this.getTelemetrySource(
      data.telemetryType,
      data.metricName,
    );

    if (!source) {
      return [];
    }

    if (
      !data.attributeKey ||
      data.attributeKey.length > MAX_ATTRIBUTE_KEY_LENGTH
    ) {
      return [];
    }

    const window: AttributeValueLookupWindow | null =
      TelemetryAttributeService.getValueLookupWindow({
        startTime: data.startTime,
        endTime: data.endTime,
      });

    if (!window) {
      return [];
    }

    const searchText: string | undefined =
      data.searchText && data.searchText.trim().length > 0
        ? data.searchText.trim()
        : undefined;

    const cacheKey: string = TelemetryAttributeService.getValueCacheKey({
      projectId: data.projectId,
      telemetryType: data.telemetryType,
      tableName: source.tableName,
      metricName: data.metricName,
      serviceFilter: data.serviceFilter,
      window: window,
      attributeKey: data.attributeKey,
      searchText: searchText,
    });

    const cached: AttributeValueSuggestionCacheEntry | undefined =
      TelemetryAttributeService.valueCache.get(cacheKey);

    if (cached && cached.kind === "values") {
      return cached.values;
    }

    if (cached && cached.kind === "stopped") {
      throw ClickhouseReadResult.toTimeLimitException(
        SUGGESTION_READ_TIME_LIMIT.maxExecutionTimeInSeconds,
      );
    }

    /*
     * Readers asking the same question at the same moment (a dashboard
     * opened by several people, two tabs) share one read.
     */
    const values: Array<string> = await SingleFlight.run(
      `telemetry-attribute-values:${cacheKey}`,
      async (): Promise<Array<string>> => {
        try {
          const found: Array<string> =
            await TelemetryAttributeService.fetchAttributeValuesFromDatabase({
              projectId: data.projectId,
              source,
              metricName: data.metricName,
              attributeKey: data.attributeKey,
              searchText: searchText,
              serviceFilter: data.serviceFilter,
              window: window,
            });

          TelemetryAttributeService.valueCache.setValues(cacheKey, found);

          return found;
        } catch (error) {
          if (ClickhouseReadResult.isTimeLimitError(error)) {
            TelemetryAttributeService.valueCache.setStopped(cacheKey);
          }

          throw error;
        }
      },
    );

    return [...values];
  }

  /*
   * The window a value lookup reads: the reader's, edges widened to whole
   * five minutes and at most its newest week; the last day when there is no
   * reader's window. Null when there is nothing to read (an end before the
   * start).
   */
  public static getValueLookupWindow(data: {
    startTime?: Date | undefined;
    endTime?: Date | undefined;
    now?: Date | undefined;
  }): AttributeValueLookupWindow | null {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const step: number = VALUE_LOOKUP_STEP_IN_MS;

    const requestedEnd: number = (data.endTime || now).getTime();
    const requestedStart: number | undefined = data.startTime
      ? data.startTime.getTime()
      : undefined;

    if (
      !Number.isFinite(requestedEnd) ||
      (requestedStart !== undefined &&
        (!Number.isFinite(requestedStart) || requestedStart > requestedEnd))
    ) {
      return null;
    }

    let end: number = Math.ceil(requestedEnd / step) * step;
    let start: number =
      requestedStart === undefined
        ? end - VALUE_LOOKUP_DEFAULT_WINDOW_IN_MS
        : Math.floor(requestedStart / step) * step;

    // A moment, not a range: read the five minutes around it.
    if (end <= start) {
      end = start + step;
    }

    start = Math.max(start, end - VALUE_LOOKUP_MAX_WINDOW_IN_MS);

    return { startTime: new Date(start), endTime: new Date(end) };
  }

  /*
   * Everything that decides a lookup's answer. The project leads, readable;
   * the rest is hashed, so a key or a search text of any length or any
   * characters makes a key of fixed size, and two questions never share one.
   */
  private static getValueCacheKey(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    tableName: string;
    metricName?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
    window: AttributeValueLookupWindow;
    attributeKey: string;
    searchText?: string | undefined;
  }): string {
    const question: string = JSON.stringify([
      data.telemetryType,
      data.tableName,
      data.metricName || "",
      TelemetryAttributeService.getServiceFilterCacheKey(data.serviceFilter) ||
        "",
      data.window.startTime.getTime(),
      data.window.endTime.getTime(),
      data.attributeKey,
      data.searchText || "",
    ]);

    return `${data.projectId.toString()}:${crypto
      .createHash("sha256")
      .update(question)
      .digest("hex")}`;
  }

  // Forgets every answer this process holds. For tests.
  public static clearValueSuggestionCache(): void {
    TelemetryAttributeService.valueCache.clear();
  }

  /*
   * The settings every value lookup runs with: the suggestion time limit, a
   * scan held to four threads and small blocks, and the rows-read budget.
   */
  private static valueLookupSettings(withRowsBudget: boolean): string {
    return getQuerySettings({
      maxExecutionTimeInSeconds:
        SUGGESTION_READ_TIME_LIMIT.maxExecutionTimeInSeconds,
      timeoutOverflowMode: SUGGESTION_READ_TIME_LIMIT.timeoutOverflowMode,
      boundScanMemory: true,
      additionalSettings: withRowsBudget
        ? {
            max_rows_to_read: ROWS_READ_BUDGET,
            read_overflow_mode: "break",
          }
        : undefined,
    });
  }

  private static buildAttributeValuesStatement(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
    window?: AttributeValueLookupWindow | undefined;
  }): Statement {
    const window: AttributeValueLookupWindow =
      data.window ||
      (TelemetryAttributeService.getValueLookupWindow(
        {},
      ) as AttributeValueLookupWindow);

    if (data.source.isMutableMetricSource) {
      return TelemetryAttributeService.buildMutableMetricAttributeValuesStatement(
        {
          projectId: data.projectId,
          source: data.source,
          metricName: data.metricName,
          attributeKey: data.attributeKey,
          searchText: data.searchText,
          window: window,
          serviceFilter: data.serviceFilter,
        },
      );
    }

    /*
     * The inner read collects up to ROWS_WITH_KEY_LIMIT rows that hold the
     * key - no ORDER BY, so ClickHouse stops reading as soon as it has them -
     * and the outer DISTINCT stops at ATTRIBUTE_VALUES_LIMIT values. The
     * answer is sorted afterwards, in fetchAttributeValuesFromDatabase.
     */
    const statement: Statement = SQL`
      SELECT DISTINCT attributeValue
      FROM (
        SELECT ${data.source.attributesColumn}[${{
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
            value: window.startTime,
          }}
          AND ${data.source.timeColumn} <= ${{
            type: TableColumnType.Date,
            value: window.endTime,
          }}`;

    /*
     * Only rows that hold the key: on the keys array, idx_attribute_keys
     * skips every granule without it. A table without the array checks the
     * map itself.
     */
    if (data.source.attributeKeysColumn) {
      statement.append(
        SQL`
          AND has(${data.source.attributeKeysColumn}, ${{
            type: TableColumnType.Text,
            value: data.attributeKey,
          }})`,
      );
    } else {
      statement.append(
        SQL`
          AND mapContains(${data.source.attributesColumn}, ${{
            type: TableColumnType.Text,
            value: data.attributeKey,
          }})`,
      );
    }

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

    TelemetryAttributeService.appendValueFilters(statement, data);

    statement.append(
      SQL`
        LIMIT ${{
          type: TableColumnType.Number,
          value: ROWS_WITH_KEY_LIMIT,
        }}
      )
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTE_VALUES_LIMIT,
      }}`,
    );

    statement.append(TelemetryAttributeService.valueLookupSettings(true));

    return statement;
  }

  /*
   * What a value has to be to be offered: present, no longer than
   * MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH, and - when the picker sends what
   * the reader typed - containing it, case ignored.
   *
   * The search text narrows server-side as the user types, so a value past
   * the first 100 of a key with many (host.name, url, ...) can still be
   * reached. It is escaped so `%` and `_` narrow rather than widen - unescaped,
   * typing `100%` listed every value under the key and typing `a_b` matched
   * `axb` as well. Mirrors the ILIKE idiom used for bodySearchText /
   * nameSearchText.
   */
  private static appendValueFilters(
    statement: Statement,
    data: {
      source: TelemetrySource;
      attributeKey: string;
      searchText?: string | undefined;
    },
  ): void {
    statement.append(
      SQL`
          AND ${data.source.attributesColumn}[${{
            type: TableColumnType.Text,
            value: data.attributeKey,
          }}] != ''
          AND lengthUTF8(${data.source.attributesColumn}[${{
            type: TableColumnType.Text,
            value: data.attributeKey,
          }}]) <= ${{
            type: TableColumnType.Number,
            value: MAX_SUGGESTED_ATTRIBUTE_VALUE_LENGTH,
          }}`,
    );

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
  }

  private static async fetchAttributeValuesFromDatabase(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    serviceFilter?: TelemetryServiceFilter | undefined;
    window: AttributeValueLookupWindow;
  }): Promise<Array<string>> {
    const statement: Statement =
      TelemetryAttributeService.buildAttributeValuesStatement(data);

    const dbResult: Results = await data.source.service.executeQuery(statement);
    const response: DbJSONResponse = await dbResult.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const values: Set<string> = new Set<string>();

    for (const row of rows) {
      const value: unknown = row["attributeValue"];

      if (typeof value !== "string") {
        continue;
      }

      const trimmed: string = value.trim();

      if (trimmed) {
        values.add(trimmed);
      }
    }

    return Array.from(values).sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });
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

    statement.append(TelemetryAttributeService.keyListSettings());

    return statement;
  }

  /*
   * Metrics the platform records itself (incident time to resolve, ...) keep
   * every version of a data point, so their values are read through the
   * latest version of each point. These tables are small, and the read keeps
   * its exact shape - no rows budget, which would cut a point's versions in
   * half - with the same time limit and the same answer size.
   */
  private static buildMutableMetricAttributeValuesStatement(data: {
    projectId: ObjectID;
    source: TelemetrySource;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
    window: AttributeValueLookupWindow;
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
          value: data.window.startTime,
        }}
        AND ${data.source.timeColumn} <= ${{
          type: TableColumnType.Date,
          value: data.window.endTime,
        }}
        AND mapContains(${data.source.attributesColumn}, ${{
          type: TableColumnType.Text,
          value: data.attributeKey,
        }})`);

    TelemetryAttributeService.appendValueFilters(statement, data);

    statement.append(
      SQL`
      LIMIT ${{
        type: TableColumnType.Number,
        value: TelemetryAttributeService.ATTRIBUTE_VALUES_LIMIT,
      }}`,
    );

    statement.append(TelemetryAttributeService.valueLookupSettings(false));

    return statement;
  }
}

export default new TelemetryAttributeService();
