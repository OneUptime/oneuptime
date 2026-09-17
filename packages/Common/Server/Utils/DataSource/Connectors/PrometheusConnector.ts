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
import DataSourceTableResult, {
  DataSourceTableColumn,
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../../Types/JSON";
import DataSourceHttpFetch, { DataSourceHttpResponse } from "../HttpFetch";
import SqlResultShaper from "../SqlResultShaper";
import {
  DataSourceConnectionSettings,
  DataSourceConnector,
  DataSourceQueryWindow,
} from "../Types";

/*
 * Connector for Prometheus-compatible HTTP APIs (Prometheus, Thanos,
 * Cortex, Mimir, VictoriaMetrics). All requests go through
 * DataSourceHttpFetch, which egress-validates the URL and pins the resolved
 * addresses before dialing.
 *
 * Endpoints used:
 *  - GET /api/v1/query        (test connection + table widget)
 *  - GET /api/v1/query_range  (time-series widget)
 */

const NAME_LABEL: string = "__name__";
const ERROR_TEXT_MAX_LENGTH: number = 500;

export interface PrometheusParseOptions {
  maxSeries?: number | undefined;
  maxPoints?: number | undefined;
}

export interface PrometheusTableParseOptions {
  maxRows?: number | undefined;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return null;
}

/*
 * Join the operator-supplied base URL (which may carry a path prefix like
 * https://host/prometheus, with or without a trailing slash) with an API
 * path and query parameters — preserving the prefix and never producing
 * double slashes.
 */
export function buildPrometheusApiUrl(
  baseUrl: string,
  path: string,
  params: Dictionary<string>,
): string {
  const trimmedBase: string = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath: string = path.startsWith("/") ? path : `/${path}`;

  const searchParams: URLSearchParams = new URLSearchParams();
  for (const key of Object.keys(params)) {
    searchParams.append(key, params[key] as string);
  }

  return `${trimmedBase}${normalizedPath}?${searchParams.toString()}`;
}

/*
 * Validate the standard Prometheus response envelope
 * ({ status, data, error? }) and return the data object. Throws
 * BadDataException with the server's own error text when status is "error".
 */
export function assertPrometheusSuccess(body: unknown): UnknownRecord {
  const envelope: UnknownRecord | null = asRecord(body);
  if (!envelope) {
    throw new BadDataException(
      "Prometheus returned an unexpected response shape (expected a JSON object with a status field).",
    );
  }

  const status: unknown = envelope["status"];
  if (status === "error") {
    const errorText: string =
      typeof envelope["error"] === "string" && envelope["error"]
        ? (envelope["error"] as string)
        : "unknown error";
    throw new BadDataException(
      `Prometheus query failed: ${errorText.substring(0, ERROR_TEXT_MAX_LENGTH)}`,
    );
  }

  if (status !== "success") {
    throw new BadDataException(
      `Prometheus returned an unexpected status: ${String(status).substring(0, 100)}.`,
    );
  }

  const data: UnknownRecord | null = asRecord(envelope["data"]);
  if (!data) {
    throw new BadDataException(
      "Prometheus response is missing the data field.",
    );
  }

  return data;
}

/*
 * Series labels for one result entry: the metric object minus __name__.
 * When stripping __name__ leaves nothing but the name existed, the name
 * itself becomes the single label so the chart still gets a readable series
 * title. No labels at all ⇒ undefined (single unnamed series).
 */
function metricToAttributes(
  metric: unknown,
): Record<string, string> | undefined {
  const metricRecord: UnknownRecord | null = asRecord(metric);
  if (!metricRecord) {
    return undefined;
  }

  const attributes: Record<string, string> = {};
  for (const key of Object.keys(metricRecord)) {
    if (key === NAME_LABEL) {
      continue;
    }
    attributes[key] = String(metricRecord[key]);
  }

  if (Object.keys(attributes).length > 0) {
    return attributes;
  }

  const metricName: unknown = metricRecord[NAME_LABEL];
  if (typeof metricName === "string" && metricName !== "") {
    return { [NAME_LABEL]: metricName };
  }

  return undefined;
}

/*
 * One Prometheus sample: [unixSeconds, "stringValue"]. Returns null for
 * malformed pairs and non-finite values ("NaN", "+Inf", "-Inf") so they are
 * skipped rather than plotted.
 */
function parseSamplePair(
  pair: unknown,
): { timestamp: Date; value: number } | null {
  if (!Array.isArray(pair) || pair.length < 2) {
    return null;
  }

  const rawTimestamp: unknown = pair[0];
  const timestampInSeconds: number =
    typeof rawTimestamp === "number"
      ? rawTimestamp
      : typeof rawTimestamp === "string" && rawTimestamp.trim() !== ""
        ? Number(rawTimestamp)
        : NaN;
  if (!Number.isFinite(timestampInSeconds)) {
    return null;
  }

  const rawValue: unknown = pair[1];
  const value: number =
    typeof rawValue === "string"
      ? parseFloat(rawValue)
      : typeof rawValue === "number"
        ? rawValue
        : NaN;
  if (!Number.isFinite(value)) {
    return null;
  }

  return { timestamp: new Date(timestampInSeconds * 1000), value: value };
}

interface SeriesEntry {
  attributes: Record<string, string> | undefined;
  pairs: Array<unknown>;
}

/*
 * Normalize matrix/vector/scalar result payloads into a uniform list of
 * series so cap enforcement lives in one place.
 */
function collectSeriesEntries(data: UnknownRecord): Array<SeriesEntry> {
  const resultType: unknown = data["resultType"];
  const result: unknown = data["result"];

  if (resultType === "matrix" || resultType === "vector") {
    if (!Array.isArray(result)) {
      return [];
    }
    const entries: Array<SeriesEntry> = [];
    for (const rawEntry of result) {
      const entry: UnknownRecord | null = asRecord(rawEntry);
      if (!entry) {
        continue;
      }
      const pairs: Array<unknown> =
        resultType === "matrix"
          ? Array.isArray(entry["values"])
            ? (entry["values"] as Array<unknown>)
            : []
          : [entry["value"]];
      entries.push({
        attributes: metricToAttributes(entry["metric"]),
        pairs: pairs,
      });
    }
    return entries;
  }

  if (resultType === "scalar") {
    return [{ attributes: undefined, pairs: [result] }];
  }

  throw new BadDataException(
    `Prometheus returned an unsupported resultType "${String(
      resultType,
    ).substring(
      0,
      100,
    )}" for a time-series query. Expected matrix, vector or scalar.`,
  );
}

/*
 * Parse a /api/v1/query_range (or instant) response body into the
 * AggregatedResult shape chart widgets consume, enforcing the series and
 * point caps. Pure — exported for direct testing.
 */
export function parseRangeQueryResult(
  body: unknown,
  options?: PrometheusParseOptions,
): AggregatedResult {
  const maxSeries: number = options?.maxSeries ?? DATA_SOURCE_MAX_SERIES;
  const maxPoints: number =
    options?.maxPoints ?? DATA_SOURCE_MAX_TIME_SERIES_ROWS;

  const data: UnknownRecord = assertPrometheusSuccess(body);
  const allEntries: Array<SeriesEntry> = collectSeriesEntries(data);

  let truncated: boolean = false;
  let entries: Array<SeriesEntry> = allEntries;
  if (allEntries.length > maxSeries) {
    entries = allEntries.slice(0, maxSeries);
    truncated = true;
  }

  const points: Array<AggregatedModel> = [];
  outer: for (const entry of entries) {
    for (const pair of entry.pairs) {
      const sample: { timestamp: Date; value: number } | null =
        parseSamplePair(pair);
      if (!sample) {
        continue;
      }
      if (points.length >= maxPoints) {
        truncated = true;
        break outer;
      }
      const point: AggregatedModel = {
        timestamp: sample.timestamp,
        value: sample.value,
      } as AggregatedModel;
      if (entry.attributes) {
        (point as UnknownRecord)["attributes"] = entry.attributes;
      }
      points.push(point);
    }
  }

  return { data: points, truncated: truncated };
}

/*
 * Parse a /api/v1/query (instant) response body into the table shape: one
 * row per vector entry — every label as a Text column plus "value" (Number)
 * and "timestamp" (Date, ISO string). Pure — exported for direct testing.
 */
export function parseInstantQueryResult(
  body: unknown,
  options?: PrometheusTableParseOptions,
): DataSourceTableResult {
  const maxRows: number = options?.maxRows ?? DATA_SOURCE_MAX_TABLE_ROWS;

  const data: UnknownRecord = assertPrometheusSuccess(body);
  const resultType: unknown = data["resultType"];
  const result: unknown = data["result"];

  if (resultType === "matrix") {
    throw new BadDataException(
      "Prometheus returned a matrix (range vector) for a table query. Use an instant-vector query (no [range] selector) for the Table widget.",
    );
  }

  interface InstantRow {
    labels: Record<string, string>;
    value: number | null;
    timestamp: Date;
  }

  const rawEntries: Array<unknown> =
    resultType === "scalar"
      ? [{ metric: {}, value: result }]
      : Array.isArray(result)
        ? result
        : [];

  let truncated: boolean = false;
  let entries: Array<unknown> = rawEntries;
  if (rawEntries.length > maxRows) {
    entries = rawEntries.slice(0, maxRows);
    truncated = true;
  }

  const labelColumnNames: Array<string> = [];
  const parsedRows: Array<InstantRow> = [];

  for (const rawEntry of entries) {
    const entry: UnknownRecord | null = asRecord(rawEntry);
    if (!entry) {
      continue;
    }

    const pair: unknown = entry["value"];
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }

    const rawTimestamp: unknown = pair[0];
    const timestampInSeconds: number =
      typeof rawTimestamp === "number"
        ? rawTimestamp
        : typeof rawTimestamp === "string" && rawTimestamp.trim() !== ""
          ? Number(rawTimestamp)
          : NaN;
    if (!Number.isFinite(timestampInSeconds)) {
      continue;
    }

    const rawValue: unknown = pair[1];
    const numericValue: number =
      typeof rawValue === "string"
        ? parseFloat(rawValue)
        : typeof rawValue === "number"
          ? rawValue
          : NaN;

    const labels: Record<string, string> = {};
    const metricRecord: UnknownRecord | null = asRecord(entry["metric"]);
    if (metricRecord) {
      for (const key of Object.keys(metricRecord)) {
        labels[key] = String(metricRecord[key]);
        if (!labelColumnNames.includes(key)) {
          labelColumnNames.push(key);
        }
      }
    }

    parsedRows.push({
      labels: labels,
      value: Number.isFinite(numericValue) ? numericValue : null,
      timestamp: new Date(timestampInSeconds * 1000),
    });
  }

  if (parsedRows.length === 0) {
    return { columns: [], rows: [], truncated: truncated };
  }

  const columns: Array<DataSourceTableColumn> = [
    ...labelColumnNames.map((name: string) => {
      return {
        key: name,
        title: name,
        type: DataSourceTableColumnType.Text,
      };
    }),
    {
      key: "value",
      title: "value",
      type: DataSourceTableColumnType.Number,
    },
    {
      key: "timestamp",
      title: "timestamp",
      type: DataSourceTableColumnType.Date,
    },
  ];

  const rows: Array<{ [key: string]: JSONValue }> = parsedRows.map(
    (parsedRow: InstantRow) => {
      const row: { [key: string]: JSONValue } = {};
      for (const name of labelColumnNames) {
        row[name] = parsedRow.labels[name] ?? null;
      }
      row["value"] = parsedRow.value;
      row["timestamp"] = parsedRow.timestamp.toISOString();
      return row;
    },
  );

  return { columns: columns, rows: rows, truncated: truncated };
}

export default class PrometheusConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.Prometheus;

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    await this.withSanitizedErrors(settings, async (): Promise<void> => {
      const body: unknown = await this.fetchFromPrometheus(
        settings,
        "/api/v1/query",
        { query: "vector(1)" },
        DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      );
      assertPrometheusSuccess(body);
    });
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    return this.withSanitizedErrors(
      settings,
      async (): Promise<AggregatedResult> => {
        const stepInSeconds: number = Math.max(
          1,
          Math.floor(
            window.stepInSeconds ??
              DataSourceLimitsUtil.getStepInSeconds(
                window.startDate,
                window.endDate,
              ),
          ),
        );

        const body: unknown = await this.fetchFromPrometheus(
          settings,
          "/api/v1/query_range",
          {
            query: query,
            start: String(this.toUnixSeconds(window.startDate)),
            end: String(this.toUnixSeconds(window.endDate)),
            step: String(stepInSeconds),
          },
          DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
        );

        return parseRangeQueryResult(body);
      },
    );
  }

  public async queryTable(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<DataSourceTableResult> {
    return this.withSanitizedErrors(
      settings,
      async (): Promise<DataSourceTableResult> => {
        const body: unknown = await this.fetchFromPrometheus(
          settings,
          "/api/v1/query",
          {
            query: query,
            time: String(this.toUnixSeconds(window.endDate)),
          },
          DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
        );

        return parseInstantQueryResult(body);
      },
    );
  }

  private toUnixSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  private async fetchFromPrometheus(
    settings: DataSourceConnectionSettings,
    path: string,
    params: Dictionary<string>,
    timeoutInMs: number,
  ): Promise<unknown> {
    if (!settings.url) {
      throw new BadDataException(
        "Prometheus data source is missing a URL. Set the base URL of the Prometheus-compatible API (for example https://prometheus.example.com).",
      );
    }

    const url: string = buildPrometheusApiUrl(settings.url, path, params);

    const response: DataSourceHttpResponse = await DataSourceHttpFetch.fetch({
      method: "GET",
      url: url,
      headers: DataSourceHttpFetch.buildAuthHeaders(settings),
      timeoutInMs: timeoutInMs,
    });

    if (response.bodyJson === undefined) {
      throw new BadDataException(
        `Prometheus returned a non-JSON response (HTTP ${
          response.statusCode
        }): ${response.bodyText.substring(0, 200)}`,
      );
    }

    return response.bodyJson;
  }

  /*
   * Belt-and-braces: no matter where a failure originates (egress guard,
   * HTTP layer echoing a response body, envelope validation), the message
   * that surfaces has credentials scrubbed.
   */
  private async withSanitizedErrors<T>(
    settings: DataSourceConnectionSettings,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw new BadDataException(
        SqlResultShaper.sanitizeError(
          error,
          SqlResultShaper.collectSecrets(settings),
        ),
      );
    }
  }
}
