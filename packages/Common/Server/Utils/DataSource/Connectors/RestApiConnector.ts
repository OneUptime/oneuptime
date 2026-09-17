import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../../Types/JSON";
import DataSourceEgressGuard from "../EgressGuard";
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
 * Generic JSON-over-HTTP connector: fetch JSON from any REST endpoint under
 * the data source's configured base URL and map fields into time series or
 * tables.
 *
 * The widget query text is a JSON "request descriptor":
 *
 *   {
 *     "path": "/api/stats?from=$__startTimeMs",   // default "/"
 *     "method": "GET" | "POST",                   // default "GET"
 *     "body": { ... } | "raw string",             // POST body
 *     "rowsPath": "data.items",                   // dot path to rows array
 *     "timestampField": "time",                   // time-series only
 *     "valueField": "count",                      // time-series only
 *     "seriesField": "service",                   // optional series label
 *     "labelFields": ["region", "env"]            // optional extra labels
 *   }
 *
 * The path must be relative — requests can never leave the configured base
 * URL — and the final URL is validated through the egress guard before any
 * socket opens.
 */

export type RestApiMethod = "GET" | "POST";

export interface RestApiRequestDescriptor {
  path: string;
  method: RestApiMethod;
  /*
   * POST body normalized to a string at parse time (objects are
   * JSON-encoded) so time macros can be applied uniformly before sending.
   */
  body?: string | undefined;
  rowsPath?: string | undefined;
  timestampField?: string | undefined;
  valueField?: string | undefined;
  seriesField?: string | undefined;
  labelFields?: Array<string> | undefined;
}

// Test seam: lets tests inject a fake transport instead of the HTTP client.
export type RestApiFetchFunction = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

const ABSOLUTE_URL_REGEX: RegExp = /^https?:\/\//i;

// Pure base-10 index, for traversing arrays in a rowsPath.
const ARRAY_INDEX_REGEX: RegExp = /^\d+$/;

function describeJsonValue(value: unknown): string {
  if (value === undefined) {
    return "undefined (the field is missing)";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "object") {
    return "an object";
  }
  return `a ${typeof value}`;
}

function readOptionalString(
  descriptor: Record<string, unknown>,
  key: string,
): string | undefined {
  const value: unknown = descriptor[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadDataException(
      `Request descriptor field "${key}" must be a non-empty string, but found ${describeJsonValue(
        value,
      )}.`,
    );
  }
  return value;
}

function validatePath(value: unknown): string {
  if (value === undefined) {
    return "/";
  }
  if (typeof value !== "string") {
    throw new BadDataException(
      `Request descriptor field "path" must be a string, but found ${describeJsonValue(
        value,
      )}.`,
    );
  }
  if (ABSOLUTE_URL_REGEX.test(value)) {
    throw new BadDataException(
      'Request descriptor field "path" must be a relative path on the data source base URL — absolute http(s):// URLs are not allowed.',
    );
  }
  if (!value.startsWith("/")) {
    throw new BadDataException(
      `Request descriptor field "path" must start with "/" (got "${value}").`,
    );
  }
  if (value.startsWith("//")) {
    throw new BadDataException(
      'Request descriptor field "path" must not start with "//" — protocol-relative URLs are not allowed.',
    );
  }

  /*
   * Reject ".." path segments (including percent-encoded variants that URL
   * normalization would collapse) so the request cannot climb above the
   * configured base URL's path prefix. Backslashes count as segment
   * separators too: WHATWG URL parsing treats "\" as "/" in http(s) URLs,
   * so "/a\..\x" would otherwise smuggle a ".." past a slash-only split.
   */
  const segments: Array<string> = value
    .replace(/%2e/gi, ".")
    .replace(/%5c/gi, "\\")
    .split(/[/\\?#]/);
  if (segments.includes("..")) {
    throw new BadDataException(
      'Request descriptor field "path" must not contain ".." segments.',
    );
  }

  return value;
}

function validateMethod(value: unknown): RestApiMethod {
  if (value === undefined) {
    return "GET";
  }
  if (typeof value !== "string") {
    throw new BadDataException(
      `Request descriptor field "method" must be "GET" or "POST", but found ${describeJsonValue(
        value,
      )}.`,
    );
  }
  const normalized: string = value.toUpperCase();
  if (normalized !== "GET" && normalized !== "POST") {
    throw new BadDataException(
      `Request descriptor field "method" must be "GET" or "POST" (got "${value}").`,
    );
  }
  return normalized as RestApiMethod;
}

function normalizeBody(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  throw new BadDataException(
    `Request descriptor field "body" must be a JSON object or a string, but found ${describeJsonValue(
      value,
    )}.`,
  );
}

function validateLabelFields(value: unknown): Array<string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BadDataException(
      `Request descriptor field "labelFields" must be an array of strings, but found ${describeJsonValue(
        value,
      )}.`,
    );
  }
  const fields: Array<unknown> = value;
  for (const field of fields) {
    if (typeof field !== "string" || field.trim() === "") {
      throw new BadDataException(
        `Request descriptor field "labelFields" must contain only non-empty strings, but found ${describeJsonValue(
          field,
        )}.`,
      );
    }
  }
  return fields as Array<string>;
}

/*
 * Parse and validate the widget query text into a request descriptor.
 * Throws BadDataException with the specific field that is wrong.
 */
export function parseRequestDescriptor(
  queryText: string,
): RestApiRequestDescriptor {
  if (!queryText || queryText.trim() === "") {
    throw new BadDataException(
      'Query is required. Provide a JSON request descriptor like { "path": "/api/stats", "rowsPath": "data.items" }.',
    );
  }

  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(queryText);
  } catch (error) {
    throw new BadDataException(
      `Query must be valid JSON (a request descriptor object): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadDataException(
      `Query must be a JSON object describing the request, but found ${describeJsonValue(
        parsed,
      )}.`,
    );
  }

  const raw: Record<string, unknown> = parsed as Record<string, unknown>;

  return {
    path: validatePath(raw["path"]),
    method: validateMethod(raw["method"]),
    body: normalizeBody(raw["body"]),
    rowsPath: readOptionalString(raw, "rowsPath"),
    timestampField: readOptionalString(raw, "timestampField"),
    valueField: readOptionalString(raw, "valueField"),
    seriesField: readOptionalString(raw, "seriesField"),
    labelFields: validateLabelFields(raw["labelFields"]),
  };
}

/*
 * Replace dashboard time macros in the request path or body. Unlike the SQL
 * variant, $__startTime / $__endTime interpolate as raw ISO-8601 strings
 * WITHOUT quotes — in a REST descriptor the macro usually sits inside an
 * already-quoted JSON string or a query parameter. Millisecond macros are
 * replaced first so $__startTime cannot corrupt $__startTimeMs.
 */
export function applyRestTimeMacros(
  text: string,
  startDate: Date,
  endDate: Date,
): string {
  return text
    .replace(/\$__startTimeMs\b/g, startDate.getTime().toString())
    .replace(/\$__endTimeMs\b/g, endDate.getTime().toString())
    .replace(/\$__startTime\b/g, startDate.toISOString())
    .replace(/\$__endTime\b/g, endDate.toISOString());
}

/*
 * Navigate the response payload down a dot path ("data.items") to the rows
 * array. Numeric segments index into arrays. The resolved value must be an
 * array whose every element is a JSON object; anything else throws a
 * BadDataException naming what was actually found.
 */
export function extractRowsByPath(
  payload: unknown,
  rowsPath: string | undefined,
): Array<Record<string, unknown>> {
  const pathLabel: string = rowsPath ? `"${rowsPath}"` : "the response root";

  let current: unknown = payload;

  if (rowsPath) {
    const segments: Array<string> = rowsPath.split(".");
    for (const segment of segments) {
      if (segment === "") {
        throw new BadDataException(
          `Request descriptor field "rowsPath" (${rowsPath}) contains an empty segment.`,
        );
      }
      if (Array.isArray(current) && ARRAY_INDEX_REGEX.test(segment)) {
        const list: Array<unknown> = current;
        current = list[Number(segment)];
        continue;
      }
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        throw new BadDataException(
          `Could not read "${segment}" of rowsPath ${pathLabel}: expected an object at that point of the response, but found ${describeJsonValue(
            current,
          )}.`,
        );
      }
      current = (current as Record<string, unknown>)[segment];
    }
  }

  if (!Array.isArray(current)) {
    throw new BadDataException(
      `Expected ${pathLabel} to be an array of rows, but found ${describeJsonValue(
        current,
      )}. Set "rowsPath" to the dot path of the rows array (for example "data.items").`,
    );
  }

  const rows: Array<unknown> = current;
  for (let index: number = 0; index < rows.length; index++) {
    const row: unknown = rows[index];
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new BadDataException(
        `Expected every row at ${pathLabel} to be a JSON object, but the row at index ${index} is ${describeJsonValue(
          row,
        )}.`,
      );
    }
  }

  return rows as Array<Record<string, unknown>>;
}

function joinUrl(baseUrl: string, path: string): string {
  // path always starts with "/" (descriptor validation), base loses its "/".
  const trimmedBase: string = baseUrl.replace(/\/+$/, "");
  return `${trimmedBase}${path}`;
}

export default class RestApiConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.RestApi;

  private fetchFunction: RestApiFetchFunction;

  public constructor(fetchFunction?: RestApiFetchFunction | undefined) {
    this.fetchFunction =
      fetchFunction ||
      ((request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        return DataSourceHttpFetch.fetch(request);
      });
  }

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    const baseUrl: string = this.getBaseUrl(settings);

    try {
      await DataSourceEgressGuard.assertUrlAllowed(baseUrl);

      const response: DataSourceHttpResponse = await this.fetchFunction({
        method: "GET",
        url: baseUrl,
        headers: DataSourceHttpFetch.buildAuthHeaders(settings),
        timeoutInMs: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new BadDataException(
          `Data source responded with HTTP ${response.statusCode} — expected a 2xx status. Check the URL and credentials.`,
        );
      }
    } catch (error) {
      throw new BadDataException(this.sanitizeThrownError(error, settings));
    }
  }

  public async queryTimeSeries(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<AggregatedResult> {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor(query);

    if (!descriptor.timestampField || !descriptor.valueField) {
      throw new BadDataException(
        'Time-series REST API queries require "timestampField" and "valueField" in the request descriptor so rows can be mapped to chart points.',
      );
    }

    const payload: unknown = await this.executeRequest(
      settings,
      descriptor,
      window,
    );

    const allRows: Array<Record<string, unknown>> = extractRowsByPath(
      payload,
      descriptor.rowsPath,
    );

    const truncated: boolean =
      allRows.length > DATA_SOURCE_MAX_TIME_SERIES_ROWS;
    const rows: Array<Record<string, unknown>> = truncated
      ? allRows.slice(0, DATA_SOURCE_MAX_TIME_SERIES_ROWS)
      : allRows;

    const data: Array<AggregatedModel> = [];

    for (const row of rows) {
      const timestamp: Date | null = SqlResultShaper.coerceTimestamp(
        row[descriptor.timestampField],
      );
      const value: number | null = this.coerceFiniteNumber(
        row[descriptor.valueField],
      );
      if (timestamp === null || value === null) {
        continue; // skip unplottable rows rather than failing the chart.
      }

      const point: AggregatedModel = { timestamp: timestamp, value: value };

      const attributes: Record<string, string> | undefined =
        this.buildAttributes(descriptor, row);
      if (attributes) {
        point["attributes"] = attributes;
      }

      data.push(point);
    }

    return { data: data, truncated: truncated };
  }

  public async queryTable(
    settings: DataSourceConnectionSettings,
    query: string,
    window: DataSourceQueryWindow,
  ): Promise<DataSourceTableResult> {
    const descriptor: RestApiRequestDescriptor = parseRequestDescriptor(query);

    const payload: unknown = await this.executeRequest(
      settings,
      descriptor,
      window,
    );

    const rows: Array<Record<string, unknown>> = extractRowsByPath(
      payload,
      descriptor.rowsPath,
    );

    /*
     * Rows go through the shared shaper as-is: nested objects become Json
     * columns via coerceCell rather than being flattened.
     */
    return SqlResultShaper.rowsToTable(rows, {
      maxRows: DATA_SOURCE_MAX_TABLE_ROWS,
    });
  }

  private async executeRequest(
    settings: DataSourceConnectionSettings,
    descriptor: RestApiRequestDescriptor,
    window: DataSourceQueryWindow,
  ): Promise<unknown> {
    const baseUrl: string = this.getBaseUrl(settings);

    const path: string = applyRestTimeMacros(
      descriptor.path,
      window.startDate,
      window.endDate,
    );
    const body: string | undefined =
      descriptor.body === undefined
        ? undefined
        : applyRestTimeMacros(
            descriptor.body,
            window.startDate,
            window.endDate,
          );

    const url: string = joinUrl(baseUrl, path);

    try {
      /*
       * Guard here as well as inside DataSourceHttpFetch: the fetch seam is
       * injectable, and the connector contract requires egress validation
       * before every connection regardless of transport.
       */
      await DataSourceEgressGuard.assertUrlAllowed(url);

      const request: DataSourceHttpRequest = {
        method: descriptor.method,
        url: url,
        headers: DataSourceHttpFetch.buildAuthHeaders(settings),
        body: body,
        timeoutInMs: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
      };

      const response: DataSourceHttpResponse =
        await this.fetchFunction(request);

      if (response.bodyJson === undefined) {
        throw new BadDataException(
          `Data source did not return JSON (HTTP ${
            response.statusCode
          }). Response starts with: ${response.bodyText.substring(0, 200)}`,
        );
      }

      return response.bodyJson;
    } catch (error) {
      throw new BadDataException(this.sanitizeThrownError(error, settings));
    }
  }

  private getBaseUrl(settings: DataSourceConnectionSettings): string {
    if (!settings.url || settings.url.trim() === "") {
      throw new BadDataException(
        "REST API data source has no URL configured. Set the base URL in the data source settings.",
      );
    }
    return settings.url.trim();
  }

  /*
   * Errors can echo credentials (a debug endpoint reflecting the
   * Authorization header into the response body excerpt, a driver message
   * quoting basic-auth) — redact every secret before the message can reach
   * an API response.
   */
  private sanitizeThrownError(
    error: unknown,
    settings: DataSourceConnectionSettings,
  ): string {
    return SqlResultShaper.sanitizeError(
      error,
      SqlResultShaper.collectSecrets(settings),
    );
  }

  private coerceFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "bigint") {
      const numeric: number = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const numeric: number = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  private buildAttributes(
    descriptor: RestApiRequestDescriptor,
    row: Record<string, unknown>,
  ): Record<string, string> | undefined {
    const attributes: Record<string, string> = {};
    let hasAttributes: boolean = false;

    if (descriptor.seriesField) {
      attributes["series"] = this.formatLabelValue(row[descriptor.seriesField]);
      hasAttributes = true;
    }

    if (descriptor.labelFields) {
      for (const field of descriptor.labelFields) {
        attributes[field] = this.formatLabelValue(row[field]);
        hasAttributes = true;
      }
    }

    return hasAttributes ? attributes : undefined;
  }

  private formatLabelValue(value: unknown): string {
    const cell: JSONValue = SqlResultShaper.coerceCell(value);
    return cell === null ? "(unset)" : String(cell);
  }
}
