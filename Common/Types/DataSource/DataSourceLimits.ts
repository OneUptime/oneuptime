/*
 * Hard resource bounds applied to every external Data Source query,
 * regardless of connector. These protect the OneUptime API server (memory,
 * event loop) and the customer's target system from runaway dashboard
 * queries — a dashboard with 20 widgets refreshing every minute multiplies
 * whatever a single query costs.
 */

// Upper bound on wall-clock time for one connection attempt.
export const DATA_SOURCE_CONNECT_TIMEOUT_IN_MS: number = 10 * 1000;

// Upper bound on wall-clock time for one query execution.
export const DATA_SOURCE_QUERY_TIMEOUT_IN_MS: number = 30 * 1000;

/*
 * Row cap for time-series results. 11k points ≈ 7.5 days at 1-minute
 * resolution for a single series — beyond that the chart cannot render the
 * detail anyway. Connectors fetch cap+1 to detect truncation.
 */
export const DATA_SOURCE_MAX_TIME_SERIES_ROWS: number = 11000;

// Row cap for tabular results — dashboards render tables, not exports.
export const DATA_SOURCE_MAX_TABLE_ROWS: number = 1000;

// Cap on distinct series one query may return before truncation.
export const DATA_SOURCE_MAX_SERIES: number = 100;

/*
 * Cap on the raw HTTP response body accepted from HTTP-based sources
 * (Prometheus/Loki/Elasticsearch/REST), before parsing. Prevents a
 * misconfigured endpoint from ballooning API-server memory.
 */
export const DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES: number = 20 * 1024 * 1024;

/*
 * Default step for range queries when the client does not send one:
 * aim for ~250 buckets across the selected window, clamped to sane bounds.
 */
export const DATA_SOURCE_TARGET_BUCKETS: number = 250;
export const DATA_SOURCE_MIN_STEP_IN_SECONDS: number = 10;
export const DATA_SOURCE_MAX_STEP_IN_SECONDS: number = 24 * 60 * 60;

export class DataSourceLimitsUtil {
  /*
   * Derive a range-query step (seconds) from a time window: ~TARGET_BUCKETS
   * buckets, clamped. Used server-side when the widget doesn't specify one
   * so Prometheus/Loki range queries stay bounded no matter the window.
   */
  public static getStepInSeconds(startDate: Date, endDate: Date): number {
    const rangeSeconds: number = Math.max(
      Math.floor((endDate.getTime() - startDate.getTime()) / 1000),
      1,
    );
    const rawStep: number = Math.ceil(
      rangeSeconds / DATA_SOURCE_TARGET_BUCKETS,
    );
    return Math.min(
      Math.max(rawStep, DATA_SOURCE_MIN_STEP_IN_SECONDS),
      DATA_SOURCE_MAX_STEP_IN_SECONDS,
    );
  }
}
