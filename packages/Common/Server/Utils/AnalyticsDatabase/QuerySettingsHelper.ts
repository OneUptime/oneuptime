/**
 * Builder for the trailing ` SETTINGS ...` clause appended to ClickHouse
 * read queries.
 *
 * Every read built through this helper carries a per-query memory ceiling
 * (max_memory_usage) and spills oversized GROUP BY / ORDER BY states to
 * disk (max_bytes_before_external_group_by / _sort) instead of letting a
 * single dashboard query take down the server — historically no layer
 * bounded per-query memory at all. Execution-time caps and overflow
 * behavior stay per-call-site: each caller keeps the value it shipped
 * with.
 *
 * All values emitted here MUST be trusted literals (numbers / hardcoded
 * strings) — the clause is appended verbatim to SQL, never parameterized.
 */

export type TimeoutOverflowMode = "break" | "throw";

// 3 GiB.
export const DEFAULT_MAX_MEMORY_USAGE_IN_BYTES: number = 3221225472;

// 1.5 GiB — half the memory ceiling so spill kicks in before the cap.
export const DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES: number = 1610612736;

// 1.5 GiB.
export const DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES: number = 1610612736;

/*
 * Scan-side memory bound for wide-window aggregations.
 *
 * A GROUP BY over a log window has to visit every matching row, so unlike a
 * paginated list it cannot be made to read less. What it CAN be stopped from
 * doing is holding a huge amount of that data in flight at once: peak memory
 * is roughly (threads x block rows x bytes per row), and a row carrying the
 * fat `attributes` Map(String, String) is expensive. Reading the default
 * 65536 rows per block per thread is what pushes a filtered facet or a
 * projection-fallback histogram past max_memory_usage and into Code 241.
 *
 * These are execution-strategy settings only — ClickHouse returns the same
 * rows either way (asserted in QuerySettingsHelper.test.ts and verified
 * against a real server).
 *
 * Measured on ClickHouse 26.7, 3M rows shaped like LogItemV3, one facet
 * query filtered on an attribute:
 *
 *   default                                695 MiB peak
 *   max_block_size alone                    88 MiB peak (and faster)
 *   + preferred_block_size_bytes, threads   40 MiB peak
 *
 * NOTE: this bounds SCAN memory, not aggregation state. A facet on a
 * genuinely high-cardinality attribute builds a large hash table regardless;
 * that case is covered by max_bytes_before_external_group_by spilling to
 * disk, which is already applied to every read here.
 */
export const AGGREGATION_SCAN_MAX_BLOCK_SIZE: number = 8192;

// 1 MiB — caps a block by bytes when rows are unusually wide.
export const AGGREGATION_SCAN_PREFERRED_BLOCK_SIZE_IN_BYTES: number = 1048576;

/*
 * The Logs sidebar fans out one aggregation per facet key concurrently, so
 * per-query thread caps also bound how much of the server a single page load
 * can claim. Latency is barely affected — these queries are already bounded
 * by max_execution_time.
 */
export const AGGREGATION_SCAN_MAX_THREADS: number = 4;

/*
 * How long a read a person waits on may run — the telemetry explorers'
 * lists, charts, filter counts, totals and exports — and how it stops
 * (issue #4707).
 *
 * 45 s, under the ClickHouse client's 58 s request_timeout, so the server
 * answers before the client gives up on it. 'throw', so a read that runs out
 * of time is reported as exactly that: executeQuery turns it into a
 * QueryTimeoutException, the API answers 504 "This query took longer than 45
 * seconds and was stopped before it finished. Try a shorter time range or
 * more specific filters.", and the explorers say so where the results go.
 *
 * Not 'break'. It was chosen for these reads on the understanding that it
 * returns what was found so far, and it does not: ClickHouse answers a
 * grouped or sorted read it breaks off with an EMPTY body, and a read that
 * was streaming rows with the document cut off (measured on 24.8 and 26.7).
 * Every such search failed with a bare "Server Error" — or, where a caller
 * swallowed the error, showed nothing at all. And a partial answer that did
 * arrive would look complete: a list missing its newest rows, a chart with a
 * drop that never happened, counts too low to notice.
 */
export const INTERACTIVE_READ_TIME_LIMIT: Readonly<{
  maxExecutionTimeInSeconds: number;
  timeoutOverflowMode: TimeoutOverflowMode;
}> = {
  maxExecutionTimeInSeconds: 45,
  timeoutOverflowMode: "throw",
};

/*
 * How long a suggestion lookup may run — the values offered under `@key:` in
 * the search bars, the chart editors' value boxes, a dashboard's variable
 * dropdowns (issue #4708) — and how it stops.
 *
 * A suggestion is a convenience next to the reader's typing, not the answer
 * they are waiting for, so it gets far less than a search: a lookup reads a
 * bounded sample (TelemetryAttributeService) and finishes in well under a
 * second, and one that has not finished in 10 seconds is stopped with
 * 'throw', for the same reasons as above. The search bar then says it could
 * not load the values and the reader types one; the database is not held for
 * a list nobody is waiting on.
 */
export const SUGGESTION_READ_TIME_LIMIT: Readonly<{
  maxExecutionTimeInSeconds: number;
  timeoutOverflowMode: TimeoutOverflowMode;
}> = {
  maxExecutionTimeInSeconds: 10,
  timeoutOverflowMode: "throw",
};

export interface QuerySettingsOptions {
  /**
   * Wall-clock cap in seconds (max_execution_time). Omitted from the
   * clause entirely when undefined, leaving the server default in force.
   */
  maxExecutionTimeInSeconds?: number | undefined;
  /**
   * What ClickHouse does when max_execution_time fires: 'throw' fails the
   * query (the server default). 'break' is documented to return partial
   * results, but over HTTP it answers with an empty or cut-off body — see
   * INTERACTIVE_READ_TIME_LIMIT before reaching for it. Omitted from the
   * clause when undefined.
   */
  timeoutOverflowMode?: TimeoutOverflowMode | undefined;
  maxMemoryUsageInBytes?: number | undefined;
  maxBytesBeforeExternalGroupByInBytes?: number | undefined;
  maxBytesBeforeExternalSortInBytes?: number | undefined;
  /**
   * Bounds how much data a scan holds in flight, for aggregations that must
   * visit every row in a wide window. Emits max_block_size,
   * preferred_block_size_bytes and max_threads. Execution strategy only —
   * the result set is unchanged. See AGGREGATION_SCAN_MAX_BLOCK_SIZE.
   */
  boundScanMemory?: boolean | undefined;
  /**
   * Site-specific passthrough settings (e.g. optimize_use_projections,
   * optimize_aggregation_in_order, max_threads). Keys and values are
   * emitted verbatim — string values are single-quoted.
   */
  additionalSettings?: Record<string, number | string> | undefined;
}

export function getQuerySettings(options?: QuerySettingsOptions): string {
  const parts: Array<string> = [];

  if (options?.maxExecutionTimeInSeconds !== undefined) {
    parts.push(`max_execution_time = ${options.maxExecutionTimeInSeconds}`);
  }

  if (options?.timeoutOverflowMode !== undefined) {
    parts.push(`timeout_overflow_mode = '${options.timeoutOverflowMode}'`);
  }

  parts.push(
    `max_memory_usage = ${
      options?.maxMemoryUsageInBytes ?? DEFAULT_MAX_MEMORY_USAGE_IN_BYTES
    }`,
  );
  parts.push(
    `max_bytes_before_external_group_by = ${
      options?.maxBytesBeforeExternalGroupByInBytes ??
      DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY_IN_BYTES
    }`,
  );
  parts.push(
    `max_bytes_before_external_sort = ${
      options?.maxBytesBeforeExternalSortInBytes ??
      DEFAULT_MAX_BYTES_BEFORE_EXTERNAL_SORT_IN_BYTES
    }`,
  );

  /*
   * Emitted before additionalSettings so a call site can still override any
   * one of these explicitly if it has a reason to.
   */
  if (options?.boundScanMemory) {
    parts.push(`max_block_size = ${AGGREGATION_SCAN_MAX_BLOCK_SIZE}`);
    parts.push(
      `preferred_block_size_bytes = ${AGGREGATION_SCAN_PREFERRED_BLOCK_SIZE_IN_BYTES}`,
    );
    parts.push(`max_threads = ${AGGREGATION_SCAN_MAX_THREADS}`);
  }

  if (options?.additionalSettings) {
    for (const [key, value] of Object.entries(options.additionalSettings)) {
      parts.push(
        typeof value === "string" ? `${key} = '${value}'` : `${key} = ${value}`,
      );
    }
  }

  return ` SETTINGS ${parts.join(", ")}`;
}

export default class QuerySettingsHelper {
  public static getQuerySettings(options?: QuerySettingsOptions): string {
    return getQuerySettings(options);
  }
}
