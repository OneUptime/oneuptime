import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_SERIES,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
  DataSourceLimitsUtil,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../HttpFetch";
import SqlResultShaper from "../SqlResultShaper";
import {
  DataSourceConnectionSettings,
  DataSourceConnector,
  DataSourceQueryWindow,
} from "../Types";

/*
 * Connector for Grafana Loki (and Loki-compatible endpoints such as
 * GrafanaCloud Logs). Queries are LogQL, executed through the
 * /loki/api/v1/query_range endpoint:
 *
 *  - LogQL METRIC queries (rate(), count_over_time(), ...) come back as a
 *    Prometheus-style "matrix" and map to chartable time series;
 *  - raw LOG queries come back as "streams" and are only representable as a
 *    table (one row per log line).
 *
 * Loki's HTTP API takes timestamps in UNIX NANOSECONDS. Millisecond epochs
 * exceed Number.MAX_SAFE_INTEGER once multiplied by 1e6, so all
 * nanosecond math in this file goes through BigInt — float arithmetic would
 * silently corrupt the low digits of the window bounds.
 */

export type LokiFetchFunction = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface LokiQueryRangeData {
  resultType: string;
  result: Array<unknown>;
}

export interface LokiParsedPoint {
  timestamp: Date;
  value: number;
}

const NANOSECONDS_PER_MILLISECOND: bigint = BigInt(1000000);

// Optionally-signed base-10 integer string, the shape BigInt() accepts.
const INTEGER_STRING_REGEX: RegExp = /^-?\d+$/;

/*
 * Exact unix-nanosecond string for a Date. BigInt math keeps every digit:
 * 1699999999999 ms * 1e6 is above 2^53, where float multiplication would
 * round the tail off.
 */
export function toLokiNanoseconds(date: Date): string {
  return (BigInt(date.getTime()) * NANOSECONDS_PER_MILLISECOND).toString();
}

/*
 * Parse a Loki nanosecond timestamp (string in stream entries; tolerate a
 * number for robustness). Returns null when unparseable. Strings are kept
 * out of Number() entirely — 19-digit nanosecond epochs do not fit in a
 * float.
 */
export function parseLokiNanoseconds(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed: string = raw.trim();
  if (!INTEGER_STRING_REGEX.test(trimmed)) {
    return null;
  }
  return BigInt(trimmed);
}

/*
 * Nanosecond epoch -> Date (millisecond precision; sub-millisecond digits
 * are truncated). Division happens in BigInt space BEFORE converting to a
 * Number so the millisecond value is exact.
 */
export function lokiNanosecondsToDate(raw: unknown): Date | null {
  const nanoseconds: bigint | null = parseLokiNanoseconds(raw);
  if (nanoseconds === null) {
    return null;
  }
  const date: Date = new Date(
    Number(nanoseconds / NANOSECONDS_PER_MILLISECOND),
  );
  return isNaN(date.getTime()) ? null : date;
}

/*
 * Validate the Loki response envelope ({ status: "success", data:
 * { resultType, result } }) and return the data section. Throws
 * operator-actionable BadDataExceptions for every malformed shape.
 */
export function parseLokiResponseData(bodyJson: unknown): LokiQueryRangeData {
  if (
    bodyJson === null ||
    bodyJson === undefined ||
    typeof bodyJson !== "object" ||
    Array.isArray(bodyJson)
  ) {
    throw new BadDataException(
      "Loki did not return a JSON object. Check that the data source URL points at a Grafana Loki endpoint.",
    );
  }

  const body: Record<string, unknown> = bodyJson as Record<string, unknown>;

  if (body["status"] !== "success") {
    const errorDetail: string =
      typeof body["error"] === "string" ? `: ${body["error"]}` : ".";
    throw new BadDataException(
      `Loki query failed with status "${String(body["status"])}"${errorDetail}`,
    );
  }

  const dataRaw: unknown = body["data"];
  if (
    dataRaw === null ||
    dataRaw === undefined ||
    typeof dataRaw !== "object" ||
    Array.isArray(dataRaw)
  ) {
    throw new BadDataException(
      "Loki response is missing the data object. Check that the data source URL points at a Grafana Loki endpoint.",
    );
  }

  const data: Record<string, unknown> = dataRaw as Record<string, unknown>;
  const resultType: unknown = data["resultType"];
  const result: unknown = data["result"];

  if (typeof resultType !== "string" || !Array.isArray(result)) {
    throw new BadDataException(
      "Loki response is missing data.resultType or data.result.",
    );
  }

  return { resultType: resultType, result: result };
}

/*
 * Extract string labels from a metric/stream label object, skipping the
 * given keys. Non-object inputs yield an empty label set.
 */
function extractLabels(
  raw: unknown,
  excludeKeys: Array<string>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  if (
    raw === null ||
    raw === undefined ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return labels;
  }
  const rawRecord: Record<string, unknown> = raw as Record<string, unknown>;
  for (const key of Object.keys(rawRecord)) {
    if (excludeKeys.includes(key)) {
      continue;
    }
    const value: unknown = rawRecord[key];
    if (value === null || value === undefined) {
      continue;
    }
    labels[key] = String(value);
  }
  return labels;
}

/*
 * One matrix sample: [unixSeconds (may be fractional), "value"]. Returns
 * null for malformed or unplottable (NaN/Inf) samples so single bad points
 * do not fail the whole chart.
 */
export function parseLokiMatrixPoint(raw: unknown): LokiParsedPoint | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null;
  }

  const timestampRaw: unknown = raw[0];
  const valueRaw: unknown = raw[1];

  let seconds: number | null = null;
  if (typeof timestampRaw === "number" && Number.isFinite(timestampRaw)) {
    seconds = timestampRaw;
  } else if (
    typeof timestampRaw === "string" &&
    timestampRaw.trim() !== "" &&
    Number.isFinite(Number(timestampRaw))
  ) {
    seconds = Number(timestampRaw);
  }
  if (seconds === null || seconds <= 0) {
    return null;
  }

  let value: number | null = null;
  if (typeof valueRaw === "number") {
    value = valueRaw;
  } else if (typeof valueRaw === "string" && valueRaw.trim() !== "") {
    value = Number(valueRaw);
  }
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return { timestamp: new Date(Math.round(seconds * 1000)), value: value };
}

/*
 * "matrix" result -> AggregatedResult. Labels (minus __name__) become the
 * per-point `attributes` object the chart layer groups series on; series
 * without labels omit `attributes` entirely (single unnamed series).
 * Applies the series cap and the total-point cap, flagging `truncated`.
 */
export function lokiMatrixToTimeSeries(
  result: Array<unknown>,
): AggregatedResult {
  const data: Array<AggregatedModel> = [];
  let truncated: boolean = false;
  let seriesUsed: number = 0;
  let rowCapHit: boolean = false;

  for (const rawSeries of result) {
    if (
      rawSeries === null ||
      typeof rawSeries !== "object" ||
      Array.isArray(rawSeries)
    ) {
      continue;
    }

    if (seriesUsed >= DATA_SOURCE_MAX_SERIES) {
      truncated = true;
      break;
    }
    seriesUsed += 1;

    const series: Record<string, unknown> = rawSeries as Record<
      string,
      unknown
    >;
    const labels: Record<string, string> = extractLabels(series["metric"], [
      "__name__",
    ]);
    const values: unknown = series["values"];
    if (!Array.isArray(values)) {
      continue;
    }

    for (const rawPoint of values) {
      const parsed: LokiParsedPoint | null = parseLokiMatrixPoint(rawPoint);
      if (!parsed) {
        continue;
      }
      if (data.length >= DATA_SOURCE_MAX_TIME_SERIES_ROWS) {
        truncated = true;
        rowCapHit = true;
        break;
      }
      const point: AggregatedModel = {
        timestamp: parsed.timestamp,
        value: parsed.value,
      } as AggregatedModel;
      if (Object.keys(labels).length > 0) {
        (point as Record<string, unknown>)["attributes"] = { ...labels };
      }
      data.push(point);
    }

    if (rowCapHit) {
      break;
    }
  }

  return { data: data, truncated: truncated };
}

interface FlatLogEntry {
  order: bigint;
  row: Record<string, unknown>;
}

/*
 * "streams" result -> flat table rows { timestamp: Date, line, ...stream
 * labels }, sorted newest-first (interleaved across streams, the way a log
 * table reads). The `timestamp` and `line` cells always hold the entry's
 * real values — stream labels that happen to use those names are dropped
 * rather than allowed to clobber them. Rows are NOT capped here; the caller
 * clamps via SqlResultShaper so cap+1 fetches surface `truncated`.
 */
export function lokiStreamsToTableRows(
  result: Array<unknown>,
): Array<Record<string, unknown>> {
  const entries: Array<FlatLogEntry> = [];

  for (const rawStream of result) {
    if (
      rawStream === null ||
      typeof rawStream !== "object" ||
      Array.isArray(rawStream)
    ) {
      continue;
    }
    const stream: Record<string, unknown> = rawStream as Record<
      string,
      unknown
    >;
    const labels: Record<string, string> = extractLabels(stream["stream"], []);
    const values: unknown = stream["values"];
    if (!Array.isArray(values)) {
      continue;
    }

    for (const rawEntry of values) {
      if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
        continue;
      }
      const nanoseconds: bigint | null = parseLokiNanoseconds(rawEntry[0]);
      if (nanoseconds === null) {
        continue;
      }
      const timestamp: Date = new Date(
        Number(nanoseconds / NANOSECONDS_PER_MILLISECOND),
      );
      if (isNaN(timestamp.getTime())) {
        continue;
      }
      const lineRaw: unknown = rawEntry[1];
      const row: Record<string, unknown> = {
        timestamp: timestamp,
        line: typeof lineRaw === "string" ? lineRaw : String(lineRaw ?? ""),
      };
      for (const key of Object.keys(labels)) {
        if (key !== "timestamp" && key !== "line") {
          row[key] = labels[key];
        }
      }
      entries.push({ order: nanoseconds, row: row });
    }
  }

  entries.sort((a: FlatLogEntry, b: FlatLogEntry): number => {
    if (a.order === b.order) {
      return 0;
    }
    return a.order < b.order ? 1 : -1;
  });

  return entries.map((entry: FlatLogEntry): Record<string, unknown> => {
    return entry.row;
  });
}

/*
 * "matrix" result -> flat table rows { timestamp: Date, value, ...labels }.
 * As with streams, the reserved `timestamp`/`value` cells win over labels
 * with the same name, and capping is left to the caller's SqlResultShaper
 * pass.
 */
export function lokiMatrixToTableRows(
  result: Array<unknown>,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (const rawSeries of result) {
    if (
      rawSeries === null ||
      typeof rawSeries !== "object" ||
      Array.isArray(rawSeries)
    ) {
      continue;
    }
    const series: Record<string, unknown> = rawSeries as Record<
      string,
      unknown
    >;
    const labels: Record<string, string> = extractLabels(series["metric"], [
      "__name__",
    ]);
    const values: unknown = series["values"];
    if (!Array.isArray(values)) {
      continue;
    }

    for (const rawPoint of values) {
      const parsed: LokiParsedPoint | null = parseLokiMatrixPoint(rawPoint);
      if (!parsed) {
        continue;
      }
      const row: Record<string, unknown> = {
        timestamp: parsed.timestamp,
        value: parsed.value,
      };
      for (const key of Object.keys(labels)) {
        if (key !== "timestamp" && key !== "value") {
          row[key] = labels[key];
        }
      }
      rows.push(row);
    }
  }

  return rows;
}

export default class LokiConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.Loki;

  private fetchFunction: LokiFetchFunction;

  /*
   * The optional fetchFunction is a DI seam for tests. The default wrapper
   * resolves DataSourceHttpFetch.fetch at CALL time so jest.spyOn on the
   * static method also intercepts connectors constructed earlier.
   */
  public constructor(fetchFunction?: LokiFetchFunction | undefined) {
    this.fetchFunction =
      fetchFunction ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  private getBaseUrl(settings: DataSourceConnectionSettings): string {
    if (!settings.url || settings.url.trim() === "") {
      throw new BadDataException(
        "Loki data source requires a URL (e.g. http://loki.example.com:3100).",
      );
    }
    return settings.url.trim().replace(/\/+$/, "");
  }

  /*
   * All egress goes through DataSourceHttpFetch, which runs the SSRF egress
   * guard and pins validated addresses before dialing. Errors are
   * sanitized so credentials can never surface in an API response.
   */
  private async fetchSanitized(
    settings: DataSourceConnectionSettings,
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    try {
      return await this.fetchFunction(request);
    } catch (error) {
      throw new BadDataException(
        SqlResultShaper.sanitizeError(
          error,
          SqlResultShaper.collectSecrets(settings),
        ),
      );
    }
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    const baseUrl: string = this.getBaseUrl(settings);

    const endDate: Date = new Date();
    const startDate: Date = new Date(endDate.getTime() - 60 * 60 * 1000);

    const params: URLSearchParams = new URLSearchParams();
    params.set("start", toLokiNanoseconds(startDate));
    params.set("end", toLokiNanoseconds(endDate));

    const headers: Dictionary<string> =
      DataSourceHttpFetch.buildAuthHeaders(settings);

    const response: DataSourceHttpResponse = await this.fetchSanitized(
      settings,
      {
        method: "GET",
        url: `${baseUrl}/loki/api/v1/labels?${params.toString()}`,
        headers: headers,
        timeoutInMs: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      },
    );

    const body: unknown = response.bodyJson;
    if (
      body === null ||
      body === undefined ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as Record<string, unknown>)["status"] !== "success"
    ) {
      throw new BadDataException(
        'Connected to the host, but it did not respond like a Grafana Loki API (expected { "status": "success" } from /loki/api/v1/labels). Check the URL — it should be the Loki base URL, e.g. http://loki.example.com:3100.',
      );
    }
  }

  private async runRangeQuery(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
    limit: number,
  ): Promise<LokiQueryRangeData> {
    if (!query || query.trim() === "") {
      throw new BadDataException("Query is required.");
    }

    const baseUrl: string = this.getBaseUrl(settings);

    const stepInSeconds: number =
      window.stepInSeconds ??
      DataSourceLimitsUtil.getStepInSeconds(window.startDate, window.endDate);

    const params: URLSearchParams = new URLSearchParams();
    params.set("query", query);
    params.set("start", toLokiNanoseconds(window.startDate));
    params.set("end", toLokiNanoseconds(window.endDate));
    params.set("step", `${stepInSeconds}s`);
    params.set("limit", limit.toString());

    const headers: Dictionary<string> =
      DataSourceHttpFetch.buildAuthHeaders(settings);

    const response: DataSourceHttpResponse = await this.fetchSanitized(
      settings,
      {
        method: "GET",
        url: `${baseUrl}/loki/api/v1/query_range?${params.toString()}`,
        headers: headers,
        timeoutInMs: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
      },
    );

    return parseLokiResponseData(response.bodyJson);
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const data: LokiQueryRangeData = await this.runRangeQuery(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TIME_SERIES_ROWS + 1,
    );

    if (data.resultType === "streams") {
      throw new BadDataException(
        'This LogQL query returns raw log streams, which cannot be charted. Wrap it in a LogQL metric function such as rate() or count_over_time() — e.g. sum(rate({app="api"} [5m])) — or use the Table widget to view the log lines.',
      );
    }

    if (data.resultType !== "matrix") {
      throw new BadDataException(
        `Loki returned an unexpected result type "${data.resultType}" for a range query. Charts require a LogQL metric query that produces a matrix result.`,
      );
    }

    return lokiMatrixToTimeSeries(data.result);
  }

  public async queryTable(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<DataSourceTableResult> {
    const data: LokiQueryRangeData = await this.runRangeQuery(
      settings,
      query,
      window,
      DATA_SOURCE_MAX_TABLE_ROWS + 1,
    );

    let rows: Array<Record<string, unknown>>;
    if (data.resultType === "streams") {
      rows = lokiStreamsToTableRows(data.result);
    } else if (data.resultType === "matrix") {
      rows = lokiMatrixToTableRows(data.result);
    } else {
      throw new BadDataException(
        `Loki returned an unexpected result type "${data.resultType}" for a range query. Expected "streams" (raw logs) or "matrix" (metric query).`,
      );
    }

    return SqlResultShaper.rowsToTable(rows, {
      maxRows: DATA_SOURCE_MAX_TABLE_ROWS,
    });
  }
}
