import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import {
  DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
  DATA_SOURCE_MAX_SERIES,
  DATA_SOURCE_MAX_TABLE_ROWS,
  DATA_SOURCE_MAX_TIME_SERIES_ROWS,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceTableResult from "../../../../Types/DataSource/DataSourceTableResult";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
 * Connector for Elasticsearch and OpenSearch clusters. Queries are written
 * as Query DSL JSON and POSTed to {url}/{index}/_search; all requests go
 * through DataSourceHttpFetch, which egress-validates the URL and pins the
 * resolved addresses before dialing (the connector additionally runs the
 * egress guard itself before every request).
 *
 * Authentication: DataSourceHttpFetch.buildAuthHeaders sends
 * "Authorization: Bearer <apiToken>" when an API token is set, else HTTP
 * basic auth from username/password. Elasticsearch API keys that need the
 * "Authorization: ApiKey <base64>" scheme should be configured as a custom
 * header named "Authorization" instead — custom headers override the
 * computed Authorization header.
 *
 * Chart queries must contain a date_histogram aggregation (optionally
 * wrapped in a terms aggregation for one series per term); table queries
 * render hits[]._source rows.
 */

const ERROR_TEXT_MAX_LENGTH: number = 500;

// Table widgets cap columns so a wide _source cannot flood the UI.
const MAX_TABLE_COLUMNS: number = 50;

// Bucket keys that are histogram metadata rather than sub-aggregations.
const DATE_BUCKET_META_KEYS: Array<string> = [
  "key",
  "key_as_string",
  "doc_count",
];

export interface ElasticsearchTimeSeriesParseOptions {
  maxSeries?: number | undefined;
  maxPoints?: number | undefined;
}

export interface ElasticsearchTableParseOptions {
  maxRows?: number | undefined;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return null;
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric: number = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

/*
 * Replace dashboard time macros in the RAW query text before JSON parsing.
 * $__startTimeMs/$__endTimeMs become epoch-millisecond numbers (usable as
 * JSON numbers in range filters); $__startTime/$__endTime become ISO-8601
 * strings WITHOUT quotes — they are meant to sit inside existing JSON
 * string quotes, e.g. "gte": "$__startTime". The Ms variants are replaced
 * first so the shorter token cannot corrupt them.
 */
export function applyElasticsearchTimeMacros(
  queryText: string,
  startDate: Date,
  endDate: Date,
): string {
  return queryText
    .replace(/\$__startTimeMs\b/g, startDate.getTime().toString())
    .replace(/\$__endTimeMs\b/g, endDate.getTime().toString())
    .replace(/\$__startTime\b/g, startDate.toISOString())
    .replace(/\$__endTime\b/g, endDate.toISOString());
}

/*
 * Macro-substitute and parse the query text into a Query DSL body object.
 * Pure — exported for direct testing.
 */
export function parseQueryDsl(
  queryText: string,
  startDate: Date,
  endDate: Date,
): UnknownRecord {
  if (!queryText || queryText.trim() === "") {
    throw new BadDataException(
      "Query is required. Provide an Elasticsearch Query DSL JSON object (for example a query with a date_histogram aggregation).",
    );
  }

  const substituted: string = applyElasticsearchTimeMacros(
    queryText,
    startDate,
    endDate,
  );

  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(substituted);
  } catch (error) {
    throw new BadDataException(
      `Query is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }. Elasticsearch queries must be a single Query DSL JSON object.`,
    );
  }

  const record: UnknownRecord | null = asRecord(parsed);
  if (!record) {
    throw new BadDataException(
      "Query must be a JSON object (Elasticsearch Query DSL), not an array or primitive value.",
    );
  }

  return record;
}

/*
 * Build the _search URL: {url}/{encodedIndex}/_search, index taken from
 * additionalOptions.elasticsearchIndex (default "*", matching every
 * index the credentials can read).
 */
export function buildElasticsearchSearchUrl(
  settings: DataSourceConnectionSettings,
): string {
  const baseUrl: string = getTrimmedBaseUrl(settings);

  const rawIndex: unknown = settings.additionalOptions?.["elasticsearchIndex"];
  const index: string =
    typeof rawIndex === "string" && rawIndex.trim() !== ""
      ? rawIndex.trim()
      : "*";

  return `${baseUrl}/${encodeURIComponent(index)}/_search`;
}

function getTrimmedBaseUrl(settings: DataSourceConnectionSettings): string {
  if (!settings.url) {
    throw new BadDataException(
      "Elasticsearch data source is missing a URL. Set the base URL of the cluster's HTTP endpoint (for example https://elasticsearch.example.com:9200).",
    );
  }
  return settings.url.trim().replace(/\/+$/, "");
}

interface BucketAggregation {
  name: string;
  buckets: Array<unknown>;
}

/*
 * First entry in `record` whose value is an object carrying a `buckets`
 * array — how both date_histogram and terms aggregations shape their
 * responses (ES 6/7/8 and OpenSearch alike). Keyed (`"keyed": true`)
 * responses use an object instead of an array and are not recognized.
 */
function findBucketAggregation(
  record: UnknownRecord,
): BucketAggregation | null {
  for (const name of Object.keys(record)) {
    const candidate: UnknownRecord | null = asRecord(record[name]);
    if (candidate && Array.isArray(candidate["buckets"])) {
      return { name: name, buckets: candidate["buckets"] as Array<unknown> };
    }
  }
  return null;
}

/*
 * String bucket keys must LOOK like dates (YYYY-MM-DD...) before they are
 * fed to Date parsing — V8's lenient parser turns terms keys like "host-1"
 * into valid dates, which would make a plain terms aggregation
 * indistinguishable from a date_histogram.
 */
const DATE_LIKE_STRING_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}/;

function parseDateLikeString(value: string): Date | null {
  if (!DATE_LIKE_STRING_REGEX.test(value.trim())) {
    return null;
  }
  return SqlResultShaper.coerceTimestamp(value);
}

/*
 * Timestamp of one date_histogram bucket: `key` is epoch milliseconds in
 * every Elasticsearch/OpenSearch version; `key_as_string` is the formatted
 * fallback when key is absent or non-numeric.
 */
function bucketTimestamp(bucket: UnknownRecord): Date | null {
  const key: unknown = bucket["key"];
  if (typeof key === "number" && Number.isFinite(key)) {
    return new Date(key);
  }

  const keyAsString: unknown = bucket["key_as_string"];
  if (typeof keyAsString === "string") {
    return parseDateLikeString(keyAsString);
  }

  if (typeof key === "string") {
    return parseDateLikeString(key);
  }

  return null;
}

/*
 * Value of one date_histogram bucket: the first sub-aggregation object
 * owning a numeric `value` (metric aggs like avg/sum/max return
 * { "value": n }; string numbers are coerced), else the bucket's own
 * doc_count. Nested bucket aggregations are skipped.
 */
function bucketValue(bucket: UnknownRecord): number | null {
  for (const key of Object.keys(bucket)) {
    if (DATE_BUCKET_META_KEYS.includes(key)) {
      continue;
    }
    const subAggregation: UnknownRecord | null = asRecord(bucket[key]);
    if (!subAggregation || Array.isArray(subAggregation["buckets"])) {
      continue;
    }
    const numeric: number | null = coerceFiniteNumber(subAggregation["value"]);
    if (numeric !== null) {
      return numeric;
    }
  }

  return coerceFiniteNumber(bucket["doc_count"]);
}

function termBucketLabel(bucket: UnknownRecord): string {
  const keyAsString: unknown = bucket["key_as_string"];
  if (typeof keyAsString === "string") {
    return keyAsString;
  }
  const key: unknown = bucket["key"];
  if (key === undefined || key === null) {
    return "(unset)";
  }
  return String(key);
}

function throwDateHistogramRequired(aggregationName?: string): never {
  const prefix: string = aggregationName
    ? `The "${aggregationName}" aggregation does not look like a date_histogram (bucket keys are not timestamps)`
    : "Elasticsearch response contained no date_histogram aggregation";
  throw new BadDataException(
    `${prefix}. Chart queries must include a date_histogram aggregation under "aggs" (optionally wrapped in a terms aggregation for one series per term); keyed bucket responses ("keyed": true) are not supported. Use the Table widget for hit lists.`,
  );
}

/*
 * Parse a _search response's aggregations into the AggregatedResult shape
 * chart widgets consume. Supports a single date_histogram aggregation (any
 * name) and a terms aggregation wrapping a date_histogram (one series per
 * term bucket, labeled via attributes[termsAggName]). Pure — exported for
 * direct testing.
 */
export function parseTimeSeriesAggregations(
  body: unknown,
  options?: ElasticsearchTimeSeriesParseOptions,
): AggregatedResult {
  const maxSeries: number = options?.maxSeries ?? DATA_SOURCE_MAX_SERIES;
  const maxPoints: number =
    options?.maxPoints ?? DATA_SOURCE_MAX_TIME_SERIES_ROWS;

  const envelope: UnknownRecord | null = asRecord(body);
  if (!envelope) {
    throw new BadDataException(
      "Elasticsearch returned an unexpected response shape (expected a JSON object).",
    );
  }

  const aggregations: UnknownRecord | null = asRecord(envelope["aggregations"]);
  if (!aggregations) {
    throwDateHistogramRequired();
  }

  const outer: BucketAggregation | null = findBucketAggregation(aggregations);
  if (!outer) {
    throwDateHistogramRequired();
  }

  const firstBucket: UnknownRecord | null =
    outer.buckets
      .map((bucket: unknown) => {
        return asRecord(bucket);
      })
      .find((bucket: UnknownRecord | null) => {
        return bucket !== null;
      }) ?? null;

  if (!firstBucket) {
    return { data: [], truncated: false };
  }

  const nested: BucketAggregation | null = findBucketAggregation(firstBucket);
  if (nested) {
    return parseTermsWrappedHistogram(outer, maxSeries, maxPoints);
  }
  return parseSingleHistogram(outer, maxPoints);
}

function parseSingleHistogram(
  aggregation: BucketAggregation,
  maxPoints: number,
): AggregatedResult {
  let truncated: boolean = false;
  let sawRecordBucket: boolean = false;
  let sawTimestamp: boolean = false;
  const points: Array<AggregatedModel> = [];

  for (const rawBucket of aggregation.buckets) {
    const bucket: UnknownRecord | null = asRecord(rawBucket);
    if (!bucket) {
      continue;
    }
    sawRecordBucket = true;

    const timestamp: Date | null = bucketTimestamp(bucket);
    if (!timestamp) {
      continue;
    }
    sawTimestamp = true;

    const value: number | null = bucketValue(bucket);
    if (value === null) {
      continue;
    }

    if (points.length >= maxPoints) {
      truncated = true;
      break;
    }

    points.push({ timestamp: timestamp, value: value } as AggregatedModel);
  }

  if (sawRecordBucket && !sawTimestamp) {
    throwDateHistogramRequired(aggregation.name);
  }

  return { data: points, truncated: truncated };
}

function parseTermsWrappedHistogram(
  termsAggregation: BucketAggregation,
  maxSeries: number,
  maxPoints: number,
): AggregatedResult {
  let truncated: boolean = false;

  let termBuckets: Array<unknown> = termsAggregation.buckets;
  if (termBuckets.length > maxSeries) {
    termBuckets = termBuckets.slice(0, maxSeries);
    truncated = true;
  }

  let sawInnerRecordBucket: boolean = false;
  let sawInnerTimestamp: boolean = false;
  const points: Array<AggregatedModel> = [];

  outer: for (const rawTermBucket of termBuckets) {
    const termBucket: UnknownRecord | null = asRecord(rawTermBucket);
    if (!termBucket) {
      continue;
    }

    const inner: BucketAggregation | null = findBucketAggregation(termBucket);
    if (!inner) {
      continue;
    }

    const seriesLabel: string = termBucketLabel(termBucket);

    for (const rawDateBucket of inner.buckets) {
      const dateBucket: UnknownRecord | null = asRecord(rawDateBucket);
      if (!dateBucket) {
        continue;
      }
      sawInnerRecordBucket = true;

      const timestamp: Date | null = bucketTimestamp(dateBucket);
      if (!timestamp) {
        continue;
      }
      sawInnerTimestamp = true;

      const value: number | null = bucketValue(dateBucket);
      if (value === null) {
        continue;
      }

      if (points.length >= maxPoints) {
        truncated = true;
        break outer;
      }

      const point: AggregatedModel = {
        timestamp: timestamp,
        value: value,
      } as AggregatedModel;
      (point as UnknownRecord)["attributes"] = {
        [termsAggregation.name]: seriesLabel,
      };
      points.push(point);
    }
  }

  if (sawInnerRecordBucket && !sawInnerTimestamp) {
    throwDateHistogramRequired(termsAggregation.name);
  }

  return { data: points, truncated: truncated };
}

function readTotalHits(total: unknown): number | null {
  // ES 6 (and REST APIs mimicking it) return a bare number.
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }
  // ES 7/8 and OpenSearch return { value, relation }.
  const totalRecord: UnknownRecord | null = asRecord(total);
  if (totalRecord && typeof totalRecord["value"] === "number") {
    return totalRecord["value"] as number;
  }
  return null;
}

/*
 * Parse a _search response's hits into the table shape: one row per hit,
 * columns _id and _index plus the union of _source keys across rows
 * (capped at MAX_TABLE_COLUMNS), cells coerced to JSON-safe primitives.
 * Pure — exported for direct testing.
 */
export function parseHitsToTable(
  body: unknown,
  options?: ElasticsearchTableParseOptions,
): DataSourceTableResult {
  const maxRows: number = options?.maxRows ?? DATA_SOURCE_MAX_TABLE_ROWS;

  const envelope: UnknownRecord | null = asRecord(body);
  if (!envelope) {
    throw new BadDataException(
      "Elasticsearch returned an unexpected response shape (expected a JSON object).",
    );
  }

  const hitsEnvelope: UnknownRecord | null = asRecord(envelope["hits"]);
  if (!hitsEnvelope || !Array.isArray(hitsEnvelope["hits"])) {
    throw new BadDataException(
      "Elasticsearch response is missing hits.hits — expected a standard _search response.",
    );
  }

  const hitList: Array<unknown> = hitsEnvelope["hits"] as Array<unknown>;

  const rawRows: Array<Record<string, unknown>> = [];
  for (const rawHit of hitList) {
    const hit: UnknownRecord | null = asRecord(rawHit);
    if (!hit) {
      continue;
    }

    const row: Record<string, unknown> = {
      _id: hit["_id"] ?? null,
      _index: hit["_index"] ?? null,
    };

    const source: UnknownRecord | null = asRecord(hit["_source"]);
    if (source) {
      for (const key of Object.keys(source)) {
        if (key === "_id" || key === "_index") {
          continue;
        }
        row[key] = source[key];
      }
    }

    rawRows.push(row);
  }

  const columnNames: Array<string> = [];
  for (const row of rawRows) {
    for (const name of Object.keys(row)) {
      if (
        !columnNames.includes(name) &&
        columnNames.length < MAX_TABLE_COLUMNS
      ) {
        columnNames.push(name);
      }
    }
  }

  const strippedRows: Array<Record<string, unknown>> = rawRows.map(
    (row: Record<string, unknown>) => {
      const stripped: Record<string, unknown> = {};
      for (const name of columnNames) {
        if (name in row) {
          stripped[name] = row[name];
        }
      }
      return stripped;
    },
  );

  const table: DataSourceTableResult = SqlResultShaper.rowsToTable(
    strippedRows,
    { maxRows: maxRows },
  );

  /*
   * The request's size was clamped at the cap — when the page is full and
   * the cluster reports more matching documents, the result is truncated.
   */
  const totalHits: number | null = readTotalHits(hitsEnvelope["total"]);
  if (
    totalHits !== null &&
    table.rows.length >= maxRows &&
    totalHits > table.rows.length
  ) {
    table.truncated = true;
  }

  return table;
}

function remapAuthenticationError(error: unknown): Error {
  const message: string =
    error instanceof Error ? error.message : String(error);
  if (message.includes("HTTP 401")) {
    return new BadDataException(
      "Elasticsearch rejected the credentials (HTTP 401 Unauthorized). Check the username/password or API token configured on this data source.",
    );
  }
  if (message.includes("HTTP 403")) {
    return new BadDataException(
      "Elasticsearch denied access (HTTP 403 Forbidden). The configured credentials do not have permission for this cluster or index.",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export default class ElasticsearchConnector implements DataSourceConnector {
  public dataSourceType: DataSourceType = DataSourceType.Elasticsearch;

  public async testConnection(
    settings: DataSourceConnectionSettings,
  ): Promise<void> {
    await this.withSanitizedErrors(settings, async (): Promise<void> => {
      const rootUrl: string = `${getTrimmedBaseUrl(settings)}/`;

      const response: DataSourceHttpResponse = await this.performFetch({
        method: "GET",
        url: rootUrl,
        headers: DataSourceHttpFetch.buildAuthHeaders(settings),
        timeoutInMs: DATA_SOURCE_CONNECT_TIMEOUT_IN_MS,
      });

      if (response.bodyJson === undefined) {
        throw new BadDataException(
          `The URL responded (HTTP ${
            response.statusCode
          }) but did not return the JSON cluster banner Elasticsearch serves at its root. Check that the URL points at the Elasticsearch/OpenSearch HTTP endpoint (usually port 9200). Response: ${response.bodyText.substring(
            0,
            200,
          )}`,
        );
      }
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
        const body: UnknownRecord = parseQueryDsl(
          query,
          window.startDate,
          window.endDate,
        );

        // Charts read aggregations only — hits are dead weight on the wire.
        body["size"] = 0;

        const responseBody: unknown = await this.runSearch(settings, body);
        return parseTimeSeriesAggregations(responseBody);
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
        const body: UnknownRecord = parseQueryDsl(
          query,
          window.startDate,
          window.endDate,
        );

        const requestedSize: unknown = body["size"];
        const effectiveSize: number =
          typeof requestedSize === "number" &&
          Number.isFinite(requestedSize) &&
          requestedSize >= 0
            ? Math.floor(requestedSize)
            : DATA_SOURCE_MAX_TABLE_ROWS;
        body["size"] = Math.min(effectiveSize, DATA_SOURCE_MAX_TABLE_ROWS);

        const responseBody: unknown = await this.runSearch(settings, body);
        return parseHitsToTable(responseBody);
      },
    );
  }

  private async runSearch(
    settings: DataSourceConnectionSettings,
    body: UnknownRecord,
  ): Promise<unknown> {
    const searchUrl: string = buildElasticsearchSearchUrl(settings);

    const response: DataSourceHttpResponse = await this.performFetch({
      method: "POST",
      url: searchUrl,
      headers: DataSourceHttpFetch.buildAuthHeaders(settings),
      body: JSON.stringify(body),
      timeoutInMs: DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
    });

    if (response.bodyJson === undefined) {
      throw new BadDataException(
        `Elasticsearch returned a non-JSON response (HTTP ${
          response.statusCode
        }): ${response.bodyText.substring(0, ERROR_TEXT_MAX_LENGTH)}`,
      );
    }

    return response.bodyJson;
  }

  /*
   * Egress-validate, then fetch. DataSourceHttpFetch re-validates and pins
   * the resolved addresses; the explicit guard call here keeps the contract
   * (validate before every connection) independent of the HTTP client's
   * internals. Auth failures are remapped to operator-actionable messages.
   */
  private async performFetch(
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    await DataSourceEgressGuard.assertUrlAllowed(request.url);

    try {
      return await DataSourceHttpFetch.fetch(request);
    } catch (error) {
      throw remapAuthenticationError(error);
    }
  }

  /*
   * Belt-and-braces: no matter where a failure originates (egress guard,
   * HTTP layer echoing a response body, parsing), the message that surfaces
   * has credentials scrubbed.
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
