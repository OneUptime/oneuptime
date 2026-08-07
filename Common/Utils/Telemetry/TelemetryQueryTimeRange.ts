import InBetween from "../../Types/BaseDatabase/InBetween";
import Query from "../../Types/BaseDatabase/Query";
import { JSONObject, ObjectType } from "../../Types/JSON";
import MetricViewData from "../../Types/Metrics/MetricViewData";
import { TelemetryQuery } from "../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../Types/Time/TimeRange";

/*
 * The snapshot window that a telemetry monitor evaluated over is stamped onto
 * the query it stores on the Incident / Alert row: logs and exceptions carry
 * it as `time`, spans as `startTime`, metrics as `metricViewData.startAndEndDate`.
 *
 * Two things make that window awkward to consume on the client.
 *
 * 1. It does not survive the store/load round trip as Dates. The blob is
 *    persisted through `JSON.stringify`, which calls `InBetween.toJSON()` and
 *    then flattens each bound to an ISO string. On the way back
 *    `InBetween.fromJSON()` reconstructs the operator but hands those strings
 *    to the constructor untouched, so `startValue` is a `string` even though
 *    the static type says `Date`. Anything guarding on `instanceof Date`
 *    silently no-ops on an incident page.
 *
 * 2. Viewers that own a time-range picker (the logs viewer) need the window as
 *    a `RangeStartAndEndDateTime`, not as a query filter, because the picker
 *    state — not the query — is what drives the histogram and facet requests.
 *
 * These helpers are the single place that knows both shapes. They are pure so
 * they can be unit tested without mounting a viewer.
 */
export default class TelemetryQueryTimeRange {
  /*
   * Field on the telemetry query that carries the snapshot window, per type.
   * Metrics keep theirs on metricViewData instead, and profiles do not store a
   * query at all, so both return null.
   */
  public static getWindowFieldName(
    telemetryType: TelemetryType | undefined | null,
  ): string | null {
    if (telemetryType === TelemetryType.Log) {
      return "time";
    }

    if (telemetryType === TelemetryType.Exception) {
      return "time";
    }

    if (telemetryType === TelemetryType.Trace) {
      return "startTime";
    }

    return null;
  }

  /*
   * Coerce a stored window into an InBetween whose bounds are real Dates.
   *
   * Accepts an `InBetween` instance (bounds may be Dates, ISO strings or epoch
   * numbers, depending on whether the value was just built or came back from
   * storage) and the plain `{ _type: "InBetween", startValue, endValue }`
   * object that a caller sees when it skipped `JSONFunctions.deserialize`.
   *
   * Returns null for anything unparseable so callers can fall back to their own
   * default. An inverted window (start after end) is returned as-is rather than
   * rejected: it renders as a visibly odd range the user can see and report,
   * which beats silently swapping back to a rolling default that shows
   * unrelated data under an incident's heading.
   */
  public static toDateWindow(value: unknown): InBetween<Date> | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    let rawStart: unknown = undefined;
    let rawEnd: unknown = undefined;

    if (value instanceof InBetween) {
      /*
       * Already in the target shape — hand back the same instance rather than
       * an equal copy. Callers use identity to decide whether anything changed,
       * and a fresh-but-equal object would churn React state on every load.
       */
      if (
        this.toDate(value.startValue) === value.startValue &&
        this.toDate(value.endValue) === value.endValue
      ) {
        return value as InBetween<Date>;
      }

      rawStart = value.startValue;
      rawEnd = value.endValue;
    } else if ((value as JSONObject)["_type"] === ObjectType.InBetween) {
      rawStart = (value as JSONObject)["startValue"];
      rawEnd = (value as JSONObject)["endValue"];
    } else {
      return null;
    }

    const startDate: Date | null = this.toDate(rawStart);
    const endDate: Date | null = this.toDate(rawEnd);

    if (!startDate || !endDate) {
      return null;
    }

    return new InBetween<Date>(startDate, endDate);
  }

  private static toDate(value: unknown): Date | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }

    /*
     * `new Date("")` is the current time, not an Invalid Date, so an empty
     * bound would silently become "now" and quietly widen the window instead
     * of being reported as missing.
     */
    if (typeof value === "string" && value.trim() === "") {
      return null;
    }

    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /*
   * Pull the snapshot window out of a telemetry query record, whatever its
   * telemetry type. Returns null when the monitor stored no window (older
   * incidents, or a log monitor configured with no lastXSecondsOfLogs).
   */
  public static getSnapshotWindow(
    telemetryQuery: TelemetryQuery | null | undefined,
  ): InBetween<Date> | null {
    if (!telemetryQuery) {
      return null;
    }

    if (telemetryQuery.metricViewData) {
      const metricWindow: InBetween<Date> | null = this.toDateWindow(
        telemetryQuery.metricViewData.startAndEndDate,
      );

      if (metricWindow) {
        return metricWindow;
      }
    }

    return this.getQueryWindow(
      telemetryQuery.telemetryQuery,
      telemetryQuery.telemetryType,
    );
  }

  /*
   * Same, for a bare query. `telemetryType` picks the field to read; when it is
   * unknown both known field names are tried so a caller holding only a query
   * (e.g. the logs viewer, which is handed a Query<Log> and nothing else) still
   * finds the window.
   */
  public static getQueryWindow(
    query: Query<Record<string, unknown>> | JSONObject | null | undefined,
    telemetryType?: TelemetryType | undefined,
  ): InBetween<Date> | null {
    if (!query) {
      return null;
    }

    const fieldName: string | null = this.getWindowFieldName(telemetryType);
    const fieldNames: Array<string> = fieldName
      ? [fieldName]
      : ["time", "startTime"];

    for (const candidate of fieldNames) {
      const window: InBetween<Date> | null = this.toDateWindow(
        (query as JSONObject)[candidate],
      );

      if (window) {
        return window;
      }
    }

    return null;
  }

  /*
   * Present a snapshot window as a picker value. Always CUSTOM: the window is
   * an absolute instant in the past, so it must never re-anchor to "now" the
   * way a relative range like "Past 1 Hour" does.
   */
  public static toRangeStartAndEndDateTime(
    window: InBetween<Date> | null | undefined,
  ): RangeStartAndEndDateTime | null {
    if (!window) {
      return null;
    }

    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: window,
    };
  }

  /*
   * Convenience for viewers: resolve the pinned picker value for a query, or
   * null when the query carries no window and the viewer should keep its own
   * rolling default.
   */
  public static getPinnedRangeForQuery(
    query: Query<Record<string, unknown>> | JSONObject | null | undefined,
    telemetryType?: TelemetryType | undefined,
  ): RangeStartAndEndDateTime | null {
    return this.toRangeStartAndEndDateTime(
      this.getQueryWindow(query, telemetryType),
    );
  }

  /*
   * Value equality for two picker values. Hosts that rebuild their query on
   * every render produce an equal-but-new window each time, so state updates
   * have to be gated on the value rather than on object identity or a
   * re-render loop follows.
   */
  public static isSameRange(
    a: RangeStartAndEndDateTime | null | undefined,
    b: RangeStartAndEndDateTime | null | undefined,
  ): boolean {
    if (!a || !b) {
      return !a && !b;
    }

    if (a.range !== b.range) {
      return false;
    }

    const aWindow: InBetween<Date> | null = this.toDateWindow(
      a.startAndEndDate,
    );
    const bWindow: InBetween<Date> | null = this.toDateWindow(
      b.startAndEndDate,
    );

    if (!aWindow || !bWindow) {
      return !aWindow && !bWindow;
    }

    return (
      aWindow.startValue.getTime() === bWindow.startValue.getTime() &&
      aWindow.endValue.getTime() === bWindow.endValue.getTime()
    );
  }

  /*
   * Rewrite a stored telemetry query so every window bound is a real Date.
   *
   * Consumers downstream gate real behaviour on `instanceof Date` — the metric
   * chart skips aggregation-bucket alignment and never fetches exemplars when
   * the bounds are strings — so hydrating once at the page's deserialize
   * boundary is what makes those paths work on an incident.
   *
   * Returns the input unchanged (same reference) when there is nothing to fix,
   * so callers can hydrate unconditionally without churning React state.
   */
  public static hydrate(
    telemetryQuery: TelemetryQuery | null | undefined,
  ): TelemetryQuery | null {
    if (!telemetryQuery) {
      return null;
    }

    let didChange: boolean = false;

    let metricViewData: MetricViewData | null =
      telemetryQuery.metricViewData || null;

    if (metricViewData) {
      const metricWindow: InBetween<Date> | null = this.toDateWindow(
        metricViewData.startAndEndDate,
      );

      if (metricWindow && metricWindow !== metricViewData.startAndEndDate) {
        metricViewData = {
          ...metricViewData,
          startAndEndDate: metricWindow,
        };
        didChange = true;
      }
    }

    let query: TelemetryQuery["telemetryQuery"] =
      telemetryQuery.telemetryQuery || null;

    if (query) {
      const fieldName: string | null = this.getWindowFieldName(
        telemetryQuery.telemetryType,
      );

      if (fieldName) {
        const window: InBetween<Date> | null = this.toDateWindow(
          (query as JSONObject)[fieldName],
        );

        if (window && window !== (query as JSONObject)[fieldName]) {
          query = {
            ...(query as JSONObject),
            [fieldName]: window,
          } as TelemetryQuery["telemetryQuery"];
          didChange = true;
        }
      }
    }

    if (!didChange) {
      return telemetryQuery;
    }

    return {
      ...telemetryQuery,
      telemetryQuery: query,
      metricViewData: metricViewData,
    };
  }
}
