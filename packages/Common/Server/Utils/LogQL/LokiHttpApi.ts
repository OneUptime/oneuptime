import {
  PrometheusQueryData,
  formatPrometheusQueryResult,
} from "../PromQL/PrometheusHttpApi";
import { JSONObject } from "../../../Types/JSON";
import { LogQLQuery } from "../../../Utils/LogQL/LogQLAst";
import LogQLEngine, {
  LogQLBucketCount,
  LogQLBucketsRequest,
  LogQLDirection,
  LogQLLinesRequest,
  LogQLLogRow,
  LogQLLogSource,
  LogQLResult,
  LogQLSamplesRequest,
  LogQLStream,
} from "../../../Utils/LogQL/LogQLEngine";
import { parseLogQL } from "../../../Utils/LogQL/LogQLParser";
import { PromQLLabelMatcher } from "../../../Utils/PromQL/PromQLAst";
import { parsePromQLDuration } from "../../../Utils/PromQL/PromQLDuration";
import {
  PromQLMatrixResultSeries,
  PromQLResultType,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";
import {
  PromQLLabels,
  promQLLabelValue,
} from "../../../Utils/PromQL/PromQLLabels";
import { comparePromQLText } from "../../../Utils/PromQL/PromQLLabelOrder";
import { copyOwnValues } from "../../../Utils/LookupTable";

/*
 * The Loki HTTP API's reading and writing (issue #7700), apart from Express
 * so it can be tested on its own: how Loki's times, durations, limits and
 * directions are read, how a result is written, and how an error is told.
 *
 * Written to Loki's own shapes and words
 * (https://grafana.com/docs/loki/latest/reference/loki-http-api/), so
 * Grafana's Loki data source, logcli and scripts written against Loki read
 * OneUptime's answers unchanged:
 *
 *   - a time is nanoseconds since 1970, Unix seconds (with a fraction, or
 *     ten digits or fewer), or RFC 3339;
 *   - a range defaults to the hour before its end (`since` changes it);
 *   - a query answers at most `limit` lines (100 by default, 5,000 at
 *     most: Loki's max_entries_limit_per_query), newest first unless
 *     `direction=forward`;
 *   - a metric query's step defaults to a 250th of its range, as Loki's;
 *   - an error is plain text, as Loki writes it.
 */

const NANOSECONDS_PER_MILLISECOND: bigint = BigInt(1000000);
const NANOSECONDS_PER_SECOND: bigint = BigInt(1000000000);

// A range's length when only its end is sent: Loki's default `since`.
export const LOKI_DEFAULT_SINCE_MS: number = 60 * 60 * 1000;

// The lines a log query answers when it does not say: Loki's.
export const LOKI_DEFAULT_LIMIT: number = 100;

// The most lines one log query answers: Loki's max_entries_limit_per_query.
export const LOKI_MAX_ENTRIES_LIMIT: number = 5000;

// The most steps a range query evaluates, as Loki allows.
export const LOKI_MAX_POINTS: number = 11000;

// The most label names, label values or series a metadata request answers.
export const LOKI_METADATA_LIMIT: number = 10000;

// The most label sets /series reads, and /labels and values with a query.
export const LOKI_SERIES_LIMIT: number = 1000;

// What /loki/api/v1/status/buildinfo answers, as Loki does: unwrapped.
export const LOKI_BUILD_INFO: JSONObject = {
  version: "3.0.0",
  revision: "oneuptime",
  branch: "",
  buildUser: "",
  buildDate: "",
  goVersion: "",
};

// Loki's own words for a query stopped at its time limit (504).
export const LOKI_TIMEOUT_MESSAGE: string =
  "Request timed out, decrease the duration of the request or add more label matchers (prefer exact match over regex match) to reduce the amount of data processed.";

const INTEGER: RegExp = /^[-+]?\d+$/;

const FLOAT: RegExp = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

const RFC3339: RegExp =
  /^(\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?([Zz]|[-+]\d{2}:\d{2})$/;

const MILLISECONDS_PER_SECOND: number = 1000;

const textOf: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  // A parameter sent twice is read as the first, as Go's Form.Get reads it.
  if (Array.isArray(value)) {
    return textOf(value[0]);
  }

  return String(value);
};

/*
 * A time parameter in nanoseconds, the way Loki's parseTimestamp reads it:
 * with a `.`, Unix seconds (to the millisecond); a whole number of ten
 * digits or fewer, Unix seconds; a longer one, nanoseconds; else RFC 3339.
 * Empty is `defaultNs`.
 */
export const parseLokiTime: (
  value: unknown,
  name: string,
  defaultNs: bigint,
) => bigint = (value: unknown, name: string, defaultNs: bigint): bigint => {
  const text: string = textOf(value);

  if (text === "") {
    return defaultNs;
  }

  if (text.includes(".") && FLOAT.test(text)) {
    const seconds: number = Number(text);

    if (Number.isFinite(seconds)) {
      const whole: number = Math.trunc(seconds);
      const milliseconds: number = Math.round(
        (seconds - whole) * MILLISECONDS_PER_SECOND,
      );

      return (
        BigInt(whole) * NANOSECONDS_PER_SECOND +
        BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND
      );
    }
  }

  if (INTEGER.test(text)) {
    const number: bigint = BigInt(text);

    return text.length <= 10 ? number * NANOSECONDS_PER_SECOND : number;
  }

  const rfc3339: RegExpExecArray | null = RFC3339.exec(text);

  if (rfc3339) {
    const wholeSecondMs: number = Date.parse(`${rfc3339[1]}${rfc3339[3]}`);

    if (!Number.isNaN(wholeSecondMs)) {
      const fraction: string = (rfc3339[2] || "").padEnd(9, "0");

      return (
        BigInt(wholeSecondMs) * NANOSECONDS_PER_MILLISECOND + BigInt(fraction)
      );
    }
  }

  throw new PromQLError(
    `could not parse '${name}' parameter: "${text}" is not a time. Send nanoseconds since 1970, such as 1700000000000000000, Unix seconds, such as 1700000000, or RFC 3339, such as 2023-11-14T22:13:20Z.`,
  );
};

/*
 * A step or an interval, in milliseconds, as Loki's parseSecondsOrDuration
 * reads one: a number of seconds (`15`, `0.5`), or a duration (`15s`,
 * `1m30s`, `500ms`).
 */
export const parseLokiDuration: (value: unknown) => number = (
  value: unknown,
): number => {
  const text: string = textOf(value);

  if (FLOAT.test(text)) {
    return Number(text) * MILLISECONDS_PER_SECOND;
  }

  const milliseconds: number | undefined = parsePromQLDuration(text);

  if (milliseconds === undefined) {
    throw new PromQLError(`cannot parse "${text}" to a valid duration`);
  }

  return milliseconds;
};

export interface LokiBounds {
  startNs: bigint;
  endNs: bigint;
}

/*
 * A request's range, as Loki's determineBounds reads it: `end` (now by
 * default), and `start` (`since` before the end, or before now when the
 * end is still to come; an hour by default).
 */
export const readLokiBounds: (
  params: Record<string, unknown>,
  nowNs: bigint,
) => LokiBounds = (
  params: Record<string, unknown>,
  nowNs: bigint,
): LokiBounds => {
  let sinceMs: number = LOKI_DEFAULT_SINCE_MS;
  const since: string = textOf(params["since"]);

  if (since !== "") {
    const parsed: number | undefined = parsePromQLDuration(since);

    if (parsed === undefined) {
      throw new PromQLError(
        `could not parse 'since' parameter: not a valid duration string: "${since}"`,
      );
    }

    sinceMs = parsed;
  }

  const endNs: bigint = parseLokiTime(params["end"], "end", nowNs);
  const endOrNowNs: bigint = endNs > nowNs ? nowNs : endNs;
  const startNs: bigint = parseLokiTime(
    params["start"],
    "start",
    endOrNowNs - BigInt(Math.round(sinceMs)) * NANOSECONDS_PER_MILLISECOND,
  );

  return { startNs, endNs };
};

/*
 * `limit`: 100 by default, and a whole number above 0. A log query asks
 * for at most LOKI_MAX_ENTRIES_LIMIT lines; a metric query's limit is
 * not read, as Loki's is not.
 */
export const readLokiLimit: (
  params: Record<string, unknown>,
  isLogQuery: boolean,
) => number = (
  params: Record<string, unknown>,
  isLogQuery: boolean,
): number => {
  const text: string = textOf(params["limit"]);

  if (text === "") {
    return LOKI_DEFAULT_LIMIT;
  }

  if (!INTEGER.test(text)) {
    throw new PromQLError(
      `could not parse 'limit' parameter: "${text}" is not a whole number`,
    );
  }

  const limit: number = Number(text);

  if (limit <= 0) {
    throw new PromQLError("limit must be a positive value");
  }

  if (isLogQuery && limit > LOKI_MAX_ENTRIES_LIMIT) {
    throw new PromQLError(
      `max entries limit per query exceeded, limit > max_entries_limit_per_query (${limit} > ${LOKI_MAX_ENTRIES_LIMIT})`,
    );
  }

  return limit;
};

// `direction`: backward (newest first) by default, or forward.
export const readLokiDirection: (
  params: Record<string, unknown>,
) => LogQLDirection = (params: Record<string, unknown>): LogQLDirection => {
  const text: string = textOf(params["direction"]);

  if (text === "") {
    return LogQLDirection.Backward;
  }

  switch (text.toLowerCase()) {
    case "forward":
      return LogQLDirection.Forward;
    case "backward":
      return LogQLDirection.Backward;
    default:
      throw new PromQLError(`invalid direction '${text}'`);
  }
};

/*
 * A range query's step in milliseconds: by default a 250th of the range in
 * whole seconds, one at least, as Loki's defaultQueryRangeStep.
 */
export const readLokiStep: (
  params: Record<string, unknown>,
  bounds: LokiBounds,
) => number = (params: Record<string, unknown>, bounds: LokiBounds): number => {
  const text: string = textOf(params["step"]);
  const rangeNs: bigint = bounds.endNs - bounds.startNs;
  const stepMs: number =
    text === ""
      ? Math.max(
          Math.floor(Number(rangeNs / NANOSECONDS_PER_SECOND) / 250),
          1,
        ) * MILLISECONDS_PER_SECOND
      : parseLokiDuration(text);

  if (!(stepMs > 0)) {
    throw new PromQLError(
      "zero or negative query resolution step widths are not accepted. Try a positive integer",
    );
  }

  const stepNs: bigint = BigInt(
    Math.max(1, Math.round(stepMs * Number(NANOSECONDS_PER_MILLISECOND))),
  );

  if (rangeNs / stepNs > BigInt(LOKI_MAX_POINTS)) {
    throw new PromQLError(
      "exceeded maximum resolution of 11,000 points per timeseries. Try increasing the value of the step parameter",
    );
  }

  return stepMs;
};

// A log query's `interval`: 0 (every line) by default.
export const readLokiInterval: (params: Record<string, unknown>) => number = (
  params: Record<string, unknown>,
): number => {
  const text: string = textOf(params["interval"]);

  if (text === "") {
    return 0;
  }

  const intervalMs: number = parseLokiDuration(text);

  if (intervalMs < 0) {
    throw new PromQLError("interval must be >= 0");
  }

  return intervalMs;
};

// The `query` parameter, parsed; refused when missing.
export const readLokiQuery: (params: Record<string, unknown>) => LogQLQuery = (
  params: Record<string, unknown>,
): LogQLQuery => {
  const text: string = textOf(params["query"]);

  if (text.trim() === "") {
    throw new PromQLError(
      'The query parameter is required, such as query={service_name="api"}.',
    );
  }

  return parseLogQL(text);
};

/*
 * The matchers of a stream selector sent to /series (`match[]`, once or
 * many times) or to /labels and label values (`query`).
 */
export const readStreamSelector: (
  text: string,
  name: string,
) => Array<PromQLLabelMatcher> = (
  text: string,
  name: string,
): Array<PromQLLabelMatcher> => {
  const query: LogQLQuery = parseLogQL(text);

  if (query.kind !== "LogQuery") {
    throw new PromQLError(
      `${name} takes a stream selector, such as {service_name="api"}, and "${text}" is not one.`,
    );
  }

  return query.selector.matchers;
};

export const readMatchSelectors: (
  params: Record<string, unknown>,
) => Array<Array<PromQLLabelMatcher>> = (
  params: Record<string, unknown>,
): Array<Array<PromQLLabelMatcher>> => {
  const raw: unknown = params["match[]"] ?? params["match"];
  const texts: Array<string> = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((item: unknown): string => {
      return String(item);
    })
    .filter((item: string): boolean => {
      return item.trim().length > 0;
    });

  // Each selector once, as Loki dedupes them.
  return Array.from(new Set(texts)).map(
    (text: string): Array<PromQLLabelMatcher> => {
      return readStreamSelector(text, "match[]");
    },
  );
};

export const nanosecondsToMilliseconds: (nanoseconds: bigint) => number = (
  nanoseconds: bigint,
): number => {
  return Number(nanoseconds / NANOSECONDS_PER_MILLISECOND);
};

/*
 * A source that counts what it reads, for an answer's stats: the lines,
 * and the bytes of their text, read from the logs or counted where they
 * are.
 */
export class LokiCountingSource implements LogQLLogSource {
  public linesProcessed: number = 0;
  public bytesProcessed: number = 0;
  public readonly countBuckets: LogQLLogSource["countBuckets"];
  private readonly inner: LogQLLogSource;

  public constructor(inner: LogQLLogSource) {
    this.inner = inner;
    this.countBuckets = inner.countBuckets
      ? async (
          request: LogQLBucketsRequest,
        ): Promise<{
          groups: Array<LogQLBucketCount>;
          reachedLimit: boolean;
        }> => {
          const counted: {
            groups: Array<LogQLBucketCount>;
            reachedLimit: boolean;
          } = await inner.countBuckets!(request);

          for (const group of counted.groups) {
            this.linesProcessed += group.count;
            this.bytesProcessed += group.bytes;
          }

          return counted;
        }
      : undefined;
  }

  private tally(rows: Array<LogQLLogRow>): void {
    for (const row of rows) {
      this.linesProcessed++;
      this.bytesProcessed += Buffer.byteLength(row.line, "utf8");
    }
  }

  public async readLines(
    request: LogQLLinesRequest,
  ): Promise<{ rows: Array<LogQLLogRow>; reachedLimit: boolean }> {
    const read: { rows: Array<LogQLLogRow>; reachedLimit: boolean } =
      await this.inner.readLines(request);
    this.tally(read.rows);
    return read;
  }

  public async readSamples(
    request: LogQLSamplesRequest,
  ): Promise<{ rows: Array<LogQLLogRow>; reachedLimit: boolean }> {
    const read: { rows: Array<LogQLLogRow>; reachedLimit: boolean } =
      await this.inner.readSamples(request);
    this.tally(read.rows);
    return read;
  }
}

// Loki's stats summary: what the query read, and how long it took.
export interface LokiStatsSummary {
  bytesProcessedPerSecond: number;
  linesProcessedPerSecond: number;
  totalBytesProcessed: number;
  totalLinesProcessed: number;
  execTime: number;
  queueTime: number;
  subqueries: number;
  totalEntriesReturned: number;
  splits: number;
  shards: number;
  totalPostFilterLines: number;
  totalStructuredMetadataBytesProcessed: number;
}

export interface LokiStats {
  summary: LokiStatsSummary;
}

export const lokiStatsOf: (data: {
  source: LokiCountingSource;
  execTimeMs: number;
  entriesReturned: number;
}) => LokiStats = (data: {
  source: LokiCountingSource;
  execTimeMs: number;
  entriesReturned: number;
}): LokiStats => {
  const seconds: number = data.execTimeMs / MILLISECONDS_PER_SECOND;
  const perSecond: (total: number) => number = (total: number): number => {
    return seconds > 0 ? Math.round(total / seconds) : 0;
  };

  return {
    summary: {
      bytesProcessedPerSecond: perSecond(data.source.bytesProcessed),
      linesProcessedPerSecond: perSecond(data.source.linesProcessed),
      totalBytesProcessed: data.source.bytesProcessed,
      totalLinesProcessed: data.source.linesProcessed,
      execTime: seconds,
      queueTime: 0,
      subqueries: 0,
      totalEntriesReturned: data.entriesReturned,
      splits: 0,
      shards: 0,
      totalPostFilterLines: data.entriesReturned,
      totalStructuredMetadataBytesProcessed: 0,
    },
  };
};

export interface LokiStreamEntry {
  stream: PromQLLabels;
  // [nanoseconds, line]
  values: Array<[string, string]>;
}

export type LokiQueryData =
  | { resultType: "streams"; result: Array<LokiStreamEntry>; stats: LokiStats }
  | (PrometheusQueryData & { stats: LokiStats });

// How many entries an answer holds: lines, points or samples.
const entriesOf: (result: LogQLResult) => number = (
  result: LogQLResult,
): number => {
  if (result.resultType === "streams") {
    return result.streams.reduce((total: number, stream: LogQLStream) => {
      return total + stream.values.length;
    }, 0);
  }

  switch (result.result.resultType) {
    case PromQLResultType.Matrix:
      return result.result.series.reduce(
        (total: number, series: PromQLMatrixResultSeries) => {
          return total + series.points.length;
        },
        0,
      );
    case PromQLResultType.Vector:
      return result.result.samples.length;
    default:
      return 1;
  }
};

// A result in Loki's `data` shape, with its stats.
export const formatLokiResult: (data: {
  result: LogQLResult;
  source: LokiCountingSource;
  execTimeMs: number;
}) => LokiQueryData = (data: {
  result: LogQLResult;
  source: LokiCountingSource;
  execTimeMs: number;
}): LokiQueryData => {
  const stats: LokiStats = lokiStatsOf({
    source: data.source,
    execTimeMs: data.execTimeMs,
    entriesReturned: entriesOf(data.result),
  });

  if (data.result.resultType === "streams") {
    return {
      resultType: "streams",
      result: data.result.streams.map(
        (stream: LogQLStream): LokiStreamEntry => {
          return {
            // Every label, one named __proto__ too (PromQLLabels).
            stream: copyOwnValues(stream.labels),
            values: stream.values,
          };
        },
      ),
      stats,
    };
  }

  return { ...formatPrometheusQueryResult(data.result.result), stats };
};

/*
 * A successful answer. Its data holds shapes OneUptime's JSON types do not
 * describe (a [time, "value"] pair), so it is typed at this one edge.
 */
export const lokiSuccess: (data: unknown) => JSONObject = (
  data: unknown,
): JSONObject => {
  return { status: "success", data } as unknown as JSONObject;
};

// GET or POST /loki/api/v1/query_range: a log or a metric query over a range.
export const runLokiRangeQuery: (data: {
  engine: LogQLEngine;
  source: LokiCountingSource;
  params: Record<string, unknown>;
  nowNs: bigint;
}) => Promise<JSONObject> = async (data: {
  engine: LogQLEngine;
  source: LokiCountingSource;
  params: Record<string, unknown>;
  nowNs: bigint;
}): Promise<JSONObject> => {
  const query: LogQLQuery = readLokiQuery(data.params);
  const bounds: LokiBounds = readLokiBounds(data.params, data.nowNs);

  if (bounds.endNs < bounds.startNs) {
    throw new PromQLError(
      "end timestamp must not be before or equal to start time",
    );
  }

  const limit: number = readLokiLimit(data.params, query.kind === "LogQuery");
  const direction: LogQLDirection = readLokiDirection(data.params);
  const stepMs: number = readLokiStep(data.params, bounds);
  const intervalMs: number = readLokiInterval(data.params);
  const startedAt: number = Date.now();

  const result: LogQLResult = await data.engine.rangeQuery({
    query,
    startMs: nanosecondsToMilliseconds(bounds.startNs),
    endMs: nanosecondsToMilliseconds(bounds.endNs),
    stepMs,
    limit,
    direction,
    intervalMs,
    startNs: bounds.startNs,
    endNs: bounds.endNs,
  });

  return lokiSuccess(
    formatLokiResult({
      result,
      source: data.source,
      execTimeMs: Date.now() - startedAt,
    }),
  );
};

// GET or POST /loki/api/v1/query: a metric query at one time.
export const runLokiInstantQuery: (data: {
  engine: LogQLEngine;
  source: LokiCountingSource;
  params: Record<string, unknown>;
  nowNs: bigint;
}) => Promise<JSONObject> = async (data: {
  engine: LogQLEngine;
  source: LokiCountingSource;
  params: Record<string, unknown>;
  nowNs: bigint;
}): Promise<JSONObject> => {
  const query: LogQLQuery = readLokiQuery(data.params);
  const timeNs: bigint = parseLokiTime(data.params["time"], "time", data.nowNs);

  readLokiLimit(data.params, query.kind === "LogQuery");
  readLokiDirection(data.params);

  const startedAt: number = Date.now();
  const result: LogQLResult = await data.engine.instantQuery({
    query,
    timeMs: nanosecondsToMilliseconds(timeNs),
  });

  return lokiSuccess(
    formatLokiResult({
      result,
      source: data.source,
      execTimeMs: Date.now() - startedAt,
    }),
  );
};

// Label names across label sets, sorted by code point, as Loki sorts them.
export const lokiLabelNamesOf: (
  labelSets: Array<PromQLLabels>,
) => Array<string> = (labelSets: Array<PromQLLabels>): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const labels of labelSets) {
    for (const name of Object.keys(labels)) {
      names.add(name);
    }
  }

  return Array.from(names).sort(comparePromQLText);
};

// One label's values across label sets, sorted by code point.
export const lokiLabelValuesOf: (
  labelSets: Array<PromQLLabels>,
  label: string,
) => Array<string> = (
  labelSets: Array<PromQLLabels>,
  label: string,
): Array<string> => {
  const values: Set<string> = new Set<string>();

  for (const labels of labelSets) {
    const value: string = promQLLabelValue(labels, label);

    if (value) {
      values.add(value);
    }
  }

  return Array.from(values).sort(comparePromQLText);
};

export interface LokiErrorAnswer {
  statusCode: number;
  // Plain text, as Loki answers an error.
  text: string;
}

/*
 * A LogQL error as Loki tells it: a mistake, or a query over a limit, is
 * 400; a query stopped at its time limit 504, in Loki's words. Undefined
 * for any other error, which the server's own error handling answers.
 */
export const toLokiErrorAnswer: (
  error: unknown,
) => LokiErrorAnswer | undefined = (
  error: unknown,
): LokiErrorAnswer | undefined => {
  if (!(error instanceof PromQLError)) {
    return undefined;
  }

  if (error.errorType === PromQLErrorType.Timeout) {
    return { statusCode: 504, text: LOKI_TIMEOUT_MESSAGE };
  }

  return { statusCode: 400, text: error.message };
};
