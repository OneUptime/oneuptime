import {
  LOGQL_LINE_RANGE_OPERATIONS,
  LogQLLineFilterOperator,
  LogQLLogSelector,
  LogQLMetricQuery,
  LogQLQuery,
  LogQLRangeAggregation,
  LogQLRangeOperation,
  LogQLStage,
} from "./LogQLAst";
import { parseLogQL } from "./LogQLParser";
import {
  LogQLPipeline,
  LogQLPipelineResult,
  LogQLUnwrapper,
  assertNoPipelineError,
} from "./LogQLPipeline";
import {
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLNodeKind,
} from "../PromQL/PromQLAst";
import PromQLEngine from "../PromQL/PromQLEngine";
import {
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
} from "../PromQL/PromQLEngineTypes";
import PromQLError, { PromQLErrorType } from "../PromQL/PromQLError";
import {
  PromQLLabels,
  formatPromQLLabels,
  promQLLabelsKey,
} from "../PromQL/PromQLLabels";
import { comparePromQLText } from "../PromQL/PromQLLabelOrder";
import { promQLQuantile } from "../PromQL/PromQLMath";
import { copyOwnValues } from "../LookupTable";

/*
 * Evaluates LogQL over a project's logs (issue #7700), the way Loki does,
 * so a Grafana Loki data source reads OneUptime.
 *
 * A log query reads the logs its selector and line filters keep, newest or
 * oldest first, runs each through its pipeline (LogQLPipeline) and answers
 * them in streams, one per label set.
 *
 * A metric query evaluates each of its range aggregations at every step:
 * count_over_time({app="api"} |= "error" [5m]) at 10:05 counts the logs
 * from after 10:00 up to and with 10:05, per label set. Where its pipeline
 * is line filters alone (and drop or keep), the counting is done where the
 * logs are (LogQLLogSource.countBuckets), in buckets a range and a step are
 * both made of; any other pipeline is run here, over the logs themselves.
 * The PromQL around them - sum by (level) (...), topk, binary operators -
 * is then PromQL's own engine's, each range aggregation a series it reads,
 * as Loki's engine evaluates it after Prometheus'.
 *
 * Where logs live is the source's business: ClickHouse on the server
 * (LogQLClickhouseSource), logs held in memory in tests.
 */

// What a log is to the engine: when, its line, and its stored labels.
export interface LogQLLogRow {
  // Nanoseconds since 1970, as text: a JavaScript number cannot hold them.
  timeNs: string;
  line: string;
  labels: PromQLLabels;
}

export enum LogQLDirection {
  Forward = "forward",
  Backward = "backward",
}

export interface LogQLLinesRequest {
  selector: LogQLLogSelector;
  // From this time, with it...
  startNs: bigint;
  // ...up to this one, without it, as Loki reads a log query's range.
  endNs: bigint;
  direction: LogQLDirection;
  limit: number;
}

export interface LogQLSamplesRequest {
  selector: LogQLLogSelector;
  // After this time...
  startNs: bigint;
  // ...up to and with this one, as a range aggregation's window.
  endNs: bigint;
  limit: number;
}

export interface LogQLBucketsRequest {
  selector: LogQLLogSelector;
  // Buckets of this width, the first starting after this time...
  originNs: bigint;
  bucketNs: bigint;
  // ...up to and with this one.
  endNs: bigint;
  // The labels to count by; undefined for every label a log has.
  labels: Array<string> | undefined;
  limit: number;
}

export interface LogQLBucketCount {
  labels: PromQLLabels;
  // Which bucket, from 1: (origin + (b - 1) width, origin + b width].
  bucket: number;
  count: number;
  bytes: number;
}

export interface LogQLLogSource {
  /*
   * The logs a selector may keep in the range, in the direction, at most
   * `limit` of them: every log its matchers keep, and its line filters
   * before any stage that rewrites the line (a source may check fewer;
   * the pipeline checks every one again).
   */
  readLines(
    request: LogQLLinesRequest,
  ): Promise<{ rows: Array<LogQLLogRow>; reachedLimit: boolean }>;
  // The same, in no particular order, for a range aggregation's windows.
  readSamples(
    request: LogQLSamplesRequest,
  ): Promise<{ rows: Array<LogQLLogRow>; reachedLimit: boolean }>;
  /*
   * How many logs, and how many bytes of their lines, each label set has in
   * each bucket - for a selector whose pipeline is line filters alone,
   * every one of which the source checks exactly. Optional: without it the
   * engine counts the logs it reads.
   */
  countBuckets?:
    | ((request: LogQLBucketsRequest) => Promise<{
        groups: Array<LogQLBucketCount>;
        reachedLimit: boolean;
      }>)
    | undefined;
}

export interface LogQLEngineOptions {
  // The most logs a log query reads to find its lines past its filters.
  maxScannedLines?: number | undefined;
  // The most logs a metric query's range aggregation reads itself.
  maxSampleLines?: number | undefined;
  // The most label sets and buckets a counted range aggregation answers.
  maxBucketGroups?: number | undefined;
  // The most buckets a range aggregation is counted in.
  maxBuckets?: number | undefined;
  // The most series a metric query may answer: Loki's max_query_series.
  maxSeries?: number | undefined;
  // How long evaluating may take, after the logs are read.
  timeoutMs?: number | undefined;
}

export const LOGQL_DEFAULT_MAX_SCANNED_LINES: number = 20000;
export const LOGQL_DEFAULT_MAX_SAMPLE_LINES: number = 100000;
export const LOGQL_DEFAULT_MAX_BUCKET_GROUPS: number = 200000;
export const LOGQL_DEFAULT_MAX_BUCKETS: number = 20000;
export const LOGQL_DEFAULT_MAX_SERIES: number = 500;
export const LOGQL_DEFAULT_TIMEOUT_MS: number = 30000;
// The most steps a range query evaluates: Loki's, and Prometheus'.
export const LOGQL_MAX_POINTS_PER_SERIES: number = 11000;

export interface LogQLStream {
  labels: PromQLLabels;
  // [nanoseconds, line], in the query's direction.
  values: Array<[string, string]>;
}

export type LogQLResult =
  | { resultType: "streams"; streams: Array<LogQLStream> }
  | { resultType: "metric"; result: PromQLQueryResult };

const NANOSECONDS_PER_MILLISECOND: bigint = BigInt(1000000);

// A log's time in whole milliseconds, rounded up: (a, b] in ms holds it exactly.
export const ceilingMilliseconds: (timeNs: string) => number = (
  timeNs: string,
): number => {
  const nanoseconds: bigint = BigInt(timeNs);
  const milliseconds: bigint = nanoseconds / NANOSECONDS_PER_MILLISECOND;

  return Number(
    nanoseconds % NANOSECONDS_PER_MILLISECOND === BigInt(0) ||
      nanoseconds < BigInt(0)
      ? milliseconds
      : milliseconds + BigInt(1),
  );
};

export const millisecondsToNanoseconds: (milliseconds: number) => bigint = (
  milliseconds: number,
): bigint => {
  return BigInt(Math.round(milliseconds)) * NANOSECONDS_PER_MILLISECOND;
};

const greatestCommonDivisor: (a: number, b: number) => number = (
  a: number,
  b: number,
): number => {
  let x: number = Math.abs(a);
  let y: number = Math.abs(b);

  while (y > 0) {
    const rest: number = x % y;
    x = y;
    y = rest;
  }

  return x;
};

const utf8Length: (text: string) => number = (text: string): number => {
  return Buffer.byteLength(text, "utf8");
};

// Whether a stage rewrites the line, so a line filter after it reads another line.
const rewritesLine: (stage: LogQLStage) => boolean = (
  stage: LogQLStage,
): boolean => {
  return stage.kind === "LineFormat" || stage.kind === "Decolorize";
};

/*
 * Whether a selector's pipeline keeps or drops logs past what a source
 * checks (its matchers, and its line filters before any rewritten line):
 * a log query then reads more logs than it answers.
 */
export const pipelineFiltersPastSource: (
  selector: LogQLLogSelector,
) => boolean = (selector: LogQLLogSelector): boolean => {
  let rewritten: boolean = false;

  for (const stage of selector.stages) {
    if (rewritesLine(stage)) {
      rewritten = true;
    }

    if (stage.kind === "LabelFilter") {
      return true;
    }

    if (stage.kind === "LineFilter" && rewritten) {
      return true;
    }
  }

  return false;
};

/*
 * The line filters a source checks: those before any stage that rewrites
 * the line, which read the stored line.
 */
export const sourceLineFilters: (
  selector: LogQLLogSelector,
) => Array<{ operator: LogQLLineFilterOperator; values: Array<string> }> = (
  selector: LogQLLogSelector,
): Array<{ operator: LogQLLineFilterOperator; values: Array<string> }> => {
  const filters: Array<{
    operator: LogQLLineFilterOperator;
    values: Array<string>;
  }> = [];

  for (const stage of selector.stages) {
    if (rewritesLine(stage)) {
      break;
    }

    if (stage.kind === "LineFilter") {
      filters.push(stage);
    }
  }

  return filters;
};

/*
 * Whether a range aggregation can be counted where the logs are: it counts
 * lines or their bytes, and its pipeline is line filters, drop and keep -
 * nothing a source would have to run itself.
 */
export const isCountedAtSource: (range: LogQLRangeAggregation) => boolean = (
  range: LogQLRangeAggregation,
): boolean => {
  if (range.unwrap || !LOGQL_LINE_RANGE_OPERATIONS.has(range.operation)) {
    return false;
  }

  return range.selector.stages.every((stage: LogQLStage): boolean => {
    return (
      stage.kind === "LineFilter" ||
      stage.kind === "Drop" ||
      stage.kind === "Keep"
    );
  });
};

/*
 * The labels each range aggregation's series are read by, when what is
 * around it reads only some: `sum by (level) (count_over_time(...))` needs
 * each log's level and nothing else, so the source counts by it alone.
 * Undefined: every label.
 */
export const neededLabelsOfRanges: (
  expression: PromQLExpression,
) => Map<string, Array<string>> = (
  expression: PromQLExpression,
): Map<string, Array<string>> => {
  const needed: Map<string, Array<string>> = new Map();

  const unwrap: (node: PromQLExpression) => PromQLExpression = (
    node: PromQLExpression,
  ): PromQLExpression => {
    let current: PromQLExpression = node;

    while (current.kind === PromQLNodeKind.Paren) {
      current = current.expression;
    }

    return current;
  };

  const visit: (node: PromQLExpression) => void = (
    node: PromQLExpression,
  ): void => {
    switch (node.kind) {
      case PromQLNodeKind.Aggregate: {
        const inner: PromQLExpression = unwrap(node.expression);

        if (
          inner.kind === PromQLNodeKind.VectorSelector &&
          inner.name &&
          !node.without &&
          node.parameter === undefined
        ) {
          needed.set(inner.name, node.grouping);
        }

        visit(node.expression);
        return;
      }
      case PromQLNodeKind.Binary:
        visit(node.lhs);
        visit(node.rhs);
        return;
      case PromQLNodeKind.Call:
        node.args.forEach(visit);
        return;
      case PromQLNodeKind.Paren:
      case PromQLNodeKind.Unary:
        visit(node.expression);
        return;
      default:
        return;
    }
  };

  visit(expression);

  return needed;
};

interface WindowSamples {
  labels: PromQLLabels;
  // One value per step, NaN where the window has none.
  values: Array<number>;
}

/*
 * A range aggregation's value over one window of samples (values in time
 * order), as Loki's range vector aggregations compute it.
 */
const aggregateWindow: (data: {
  operation: LogQLRangeOperation;
  values: Array<number>;
  bytes: number;
  rangeSeconds: number;
  parameter: number | undefined;
}) => number = (data: {
  operation: LogQLRangeOperation;
  values: Array<number>;
  bytes: number;
  rangeSeconds: number;
  parameter: number | undefined;
}): number => {
  const values: Array<number> = data.values;
  const count: number = values.length;

  switch (data.operation) {
    case LogQLRangeOperation.CountOverTime:
      return count;
    case LogQLRangeOperation.BytesOverTime:
      return data.bytes;
    case LogQLRangeOperation.BytesRate:
      return data.bytes / data.rangeSeconds;
    case LogQLRangeOperation.AbsentOverTime:
      return 1;
    case LogQLRangeOperation.Rate: {
      // rate of lines: per second; of an unwrapped label: its sum per second.
      return (
        values.reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0) / data.rangeSeconds
      );
    }
    case LogQLRangeOperation.SumOverTime:
      return values.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0);
    case LogQLRangeOperation.AvgOverTime:
      return (
        values.reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0) / count
      );
    case LogQLRangeOperation.MinOverTime:
      return values.reduce((min: number, value: number): number => {
        return value < min ? value : min;
      }, Infinity);
    case LogQLRangeOperation.MaxOverTime:
      return values.reduce((max: number, value: number): number => {
        return value > max ? value : max;
      }, -Infinity);
    case LogQLRangeOperation.FirstOverTime:
      return values[0]!;
    case LogQLRangeOperation.LastOverTime:
      return values[count - 1]!;
    case LogQLRangeOperation.StdvarOverTime:
    case LogQLRangeOperation.StddevOverTime: {
      const mean: number =
        values.reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0) / count;
      const variance: number =
        values.reduce((sum: number, value: number): number => {
          return sum + (value - mean) * (value - mean);
        }, 0) / count;

      return data.operation === LogQLRangeOperation.StddevOverTime
        ? Math.sqrt(variance)
        : variance;
    }
    case LogQLRangeOperation.QuantileOverTime:
      return promQLQuantile(data.parameter ?? 0.5, [...values]);
  }
};

// The labels a series is grouped by: kept by `by`, taken away by `without`.
const groupLabels: (
  labels: PromQLLabels,
  grouping: { labels: Array<string>; without: boolean } | undefined,
) => PromQLLabels = (
  labels: PromQLLabels,
  grouping: { labels: Array<string>; without: boolean } | undefined,
): PromQLLabels => {
  if (!grouping) {
    return labels;
  }

  const grouped: PromQLLabels = {};

  for (const name of Object.keys(labels)) {
    const listed: boolean = grouping.labels.includes(name);

    if (listed !== grouping.without) {
      grouped[name] = labels[name]!;
    }
  }

  return grouped;
};

// The labels a selector names with =: absent_over_time's series' own.
const equalityLabels: (matchers: Array<PromQLLabelMatcher>) => PromQLLabels = (
  matchers: Array<PromQLLabelMatcher>,
): PromQLLabels => {
  const labels: PromQLLabels = {};

  for (const matcher of matchers) {
    if (matcher.type === PromQLMatchType.Equal && !labels[matcher.name]) {
      labels[matcher.name] = matcher.value;
    }
  }

  return labels;
};

interface ResolvedLogQLEngineOptions {
  maxScannedLines: number;
  maxSampleLines: number;
  maxBucketGroups: number;
  maxBuckets: number;
  maxSeries: number;
  timeoutMs: number;
}

export default class LogQLEngine {
  private readonly source: LogQLLogSource;
  private readonly options: ResolvedLogQLEngineOptions;

  public constructor(source: LogQLLogSource, options: LogQLEngineOptions = {}) {
    this.source = source;
    this.options = {
      maxScannedLines:
        options.maxScannedLines ?? LOGQL_DEFAULT_MAX_SCANNED_LINES,
      maxSampleLines: options.maxSampleLines ?? LOGQL_DEFAULT_MAX_SAMPLE_LINES,
      maxBucketGroups:
        options.maxBucketGroups ?? LOGQL_DEFAULT_MAX_BUCKET_GROUPS,
      maxBuckets: options.maxBuckets ?? LOGQL_DEFAULT_MAX_BUCKETS,
      maxSeries: options.maxSeries ?? LOGQL_DEFAULT_MAX_SERIES,
      timeoutMs: options.timeoutMs ?? LOGQL_DEFAULT_TIMEOUT_MS,
    };
  }

  /*
   * A query over a range: a log query's lines from start up to end, or a
   * metric query at every step from start to end.
   */
  public async rangeQuery(data: {
    query: string | LogQLQuery;
    startMs: number;
    endMs: number;
    stepMs: number;
    limit: number;
    direction: LogQLDirection;
    /*
     * A log query's lines at least this far apart, Loki's `interval`; a
     * metric query has its step instead.
     */
    intervalMs?: number | undefined;
    // A log query's range to the nanosecond, as Loki reads it.
    startNs?: bigint | undefined;
    endNs?: bigint | undefined;
  }): Promise<LogQLResult> {
    const query: LogQLQuery =
      typeof data.query === "string" ? parseLogQL(data.query) : data.query;

    if (query.kind === "LogQuery") {
      return {
        resultType: "streams",
        streams: await this.readStreams({
          selector: query.selector,
          startNs: data.startNs ?? millisecondsToNanoseconds(data.startMs),
          endNs: data.endNs ?? millisecondsToNanoseconds(data.endMs),
          direction: data.direction,
          limit: data.limit,
          intervalNs: millisecondsToNanoseconds(data.intervalMs || 0),
        }),
      };
    }

    if (!(data.stepMs > 0)) {
      throw new PromQLError("the step must be longer than zero, such as 15s.");
    }

    if (data.endMs < data.startMs) {
      throw new PromQLError("the end of the time range is before its start.");
    }

    /*
     * Loki's own bound, and its words: (end - start) / step steps after
     * the first, 11,000 at most (ParseRangeQuery).
     */
    if (
      Math.floor((data.endMs - data.startMs) / data.stepMs) >
      LOGQL_MAX_POINTS_PER_SERIES
    ) {
      throw new PromQLError(
        "exceeded maximum resolution of 11,000 points per timeseries. Try increasing the value of the step parameter",
      );
    }

    const steps: Array<number> = [];

    for (
      let timeMs: number = data.startMs;
      timeMs <= data.endMs;
      timeMs += data.stepMs
    ) {
      steps.push(timeMs);
    }

    const result: PromQLQueryResult = await this.evaluateMetric({
      query,
      steps,
      stepMs: data.stepMs,
      evaluate: (engine: PromQLEngine): Promise<PromQLQueryResult> => {
        return engine.rangeQuery(
          query.expression,
          data.startMs,
          data.endMs,
          data.stepMs,
        );
      },
    });

    return { resultType: "metric", result };
  }

  // A metric query at one time; a log query is refused, as Loki refuses it.
  public async instantQuery(data: {
    query: string | LogQLQuery;
    timeMs: number;
  }): Promise<LogQLResult> {
    const query: LogQLQuery =
      typeof data.query === "string" ? parseLogQL(data.query) : data.query;

    if (query.kind === "LogQuery") {
      throw new PromQLError(
        "log queries are not supported as an instant query type, please change your query to a range query type",
      );
    }

    const result: PromQLQueryResult = await this.evaluateMetric({
      query,
      steps: [data.timeMs],
      stepMs: 0,
      evaluate: (engine: PromQLEngine): Promise<PromQLQueryResult> => {
        return engine.instantQuery(query.expression, data.timeMs);
      },
    });

    return { resultType: "metric", result };
  }

  private async readStreams(data: {
    selector: LogQLLogSelector;
    startNs: bigint;
    endNs: bigint;
    direction: LogQLDirection;
    limit: number;
    intervalNs: bigint;
  }): Promise<Array<LogQLStream>> {
    const filtersPastSource: boolean = pipelineFiltersPastSource(data.selector);
    const read: { rows: Array<LogQLLogRow>; reachedLimit: boolean } =
      await this.source.readLines({
        selector: data.selector,
        startNs: data.startNs,
        endNs: data.endNs,
        direction: data.direction,
        limit: filtersPastSource
          ? Math.max(data.limit, this.options.maxScannedLines)
          : data.limit,
      });
    const pipeline: LogQLPipeline = new LogQLPipeline(data.selector);
    const streams: Map<string, LogQLStream> = new Map();
    const forward: boolean = data.direction === LogQLDirection.Forward;
    let kept: number = 0;
    let lastKeptNs: bigint | undefined = undefined;

    for (const row of read.rows) {
      if (kept >= data.limit) {
        break;
      }

      const entry: LogQLPipelineResult | null = pipeline.run({
        line: row.line,
        labels: row.labels,
      });

      if (!entry) {
        continue;
      }

      /*
       * With an interval, a line at least that long after the last one
       * kept (before it, going backward), across every stream: Loki's
       * readStreams.
       */
      const timeNs: bigint = BigInt(row.timeNs);

      if (data.intervalNs > BigInt(0) && lastKeptNs !== undefined) {
        const farEnough: boolean = forward
          ? timeNs >= lastKeptNs + data.intervalNs
          : timeNs <= lastKeptNs - data.intervalNs;

        if (!farEnough) {
          continue;
        }
      }

      lastKeptNs = timeNs;

      const key: string = promQLLabelsKey(entry.labels);
      let stream: LogQLStream | undefined = streams.get(key);

      if (!stream) {
        stream = { labels: entry.labels, values: [] };
        streams.set(key, stream);
      }

      stream.values.push([row.timeNs, entry.line]);
      kept++;
    }

    // In Loki's order: by each stream's labels as text ({a="1", b="2"}).
    return Array.from(streams.values())
      .map((stream: LogQLStream): { text: string; stream: LogQLStream } => {
        return { text: formatPromQLLabels(stream.labels), stream };
      })
      .sort(
        (
          a: { text: string; stream: LogQLStream },
          b: { text: string; stream: LogQLStream },
        ): number => {
          return comparePromQLText(a.text, b.text);
        },
      )
      .map((item: { text: string; stream: LogQLStream }): LogQLStream => {
        return item.stream;
      });
  }

  private async evaluateMetric(data: {
    query: LogQLMetricQuery;
    steps: Array<number>;
    stepMs: number;
    evaluate: (engine: PromQLEngine) => Promise<PromQLQueryResult>;
  }): Promise<PromQLQueryResult> {
    const needed: Map<string, Array<string>> = neededLabelsOfRanges(
      data.query.expression,
    );
    const seriesByName: Map<string, Array<PromQLSeries>> = new Map();

    for (const range of data.query.ranges) {
      const windows: Array<WindowSamples> = await this.evaluateRange({
        range,
        steps: data.steps,
        stepMs: data.stepMs,
        neededLabels: needed.get(range.seriesName),
      });

      seriesByName.set(
        range.seriesName,
        windows.map((window: WindowSamples): PromQLSeries => {
          const timestampsMs: Array<number> = [];
          const values: Array<number> = [];

          window.values.forEach((value: number, index: number): void => {
            if (!Number.isNaN(value)) {
              timestampsMs.push(data.steps[index]!);
              values.push(value);
            }
          });

          return { labels: window.labels, timestampsMs, values };
        }),
      );
    }

    const source: PromQLSeriesSource = {
      select: async (
        selection: PromQLSeriesSelection,
      ): Promise<Array<PromQLSeries>> => {
        return seriesByName.get(selection.metricName || "") || [];
      },
    };

    /*
     * Each range aggregation's series holds a sample at each step and none
     * between: a selector reads the one at its step, never an earlier one.
     */
    const result: PromQLQueryResult = await data.evaluate(
      new PromQLEngine(source, {
        lookbackDeltaMs: 1,
        timeoutMs: this.options.timeoutMs,
        // The steps rangeQuery allows: 11,000 after the first.
        maxPointsPerSeries: LOGQL_MAX_POINTS_PER_SERIES + 1,
      }),
    );

    const seriesCount: number =
      result.resultType === PromQLResultType.Matrix
        ? result.series.length
        : result.resultType === PromQLResultType.Vector
          ? result.samples.length
          : 1;

    if (seriesCount > this.options.maxSeries) {
      throw new PromQLError(
        `maximum of series (${this.options.maxSeries}) reached for a single query`,
        PromQLErrorType.Execution,
      );
    }

    return result;
  }

  private async evaluateRange(data: {
    range: LogQLRangeAggregation;
    steps: Array<number>;
    stepMs: number;
    neededLabels: Array<string> | undefined;
  }): Promise<Array<WindowSamples>> {
    const range: LogQLRangeAggregation = data.range;
    const firstStepMs: number = data.steps[0]!;
    const lastStepMs: number = data.steps[data.steps.length - 1]!;
    // The window of each step: after (step - range - offset), up to (step - offset).
    const originMs: number = firstStepMs - range.rangeMs - range.offsetMs;
    const endMs: number = lastStepMs - range.offsetMs;
    const bucketMs: number =
      data.stepMs > 0
        ? greatestCommonDivisor(range.rangeMs, data.stepMs)
        : range.rangeMs;
    const buckets: number = Math.round((endMs - originMs) / bucketMs);

    if (
      this.source.countBuckets &&
      isCountedAtSource(range) &&
      buckets <= this.options.maxBuckets
    ) {
      return this.countRangeAtSource({
        range,
        steps: data.steps,
        stepMs: data.stepMs,
        originMs,
        endMs,
        bucketMs,
        buckets,
        neededLabels: data.neededLabels,
      });
    }

    return this.countRangeHere({ range, steps: data.steps, originMs, endMs });
  }

  // The range aggregation counted in buckets where the logs are.
  private async countRangeAtSource(data: {
    range: LogQLRangeAggregation;
    steps: Array<number>;
    stepMs: number;
    originMs: number;
    endMs: number;
    bucketMs: number;
    buckets: number;
    neededLabels: Array<string> | undefined;
  }): Promise<Array<WindowSamples>> {
    const range: LogQLRangeAggregation = data.range;
    const counted: { groups: Array<LogQLBucketCount>; reachedLimit: boolean } =
      await this.source.countBuckets!({
        selector: range.selector,
        originNs: millisecondsToNanoseconds(data.originMs),
        bucketNs: millisecondsToNanoseconds(data.bucketMs),
        endNs: millisecondsToNanoseconds(data.endMs),
        labels: data.neededLabels,
        limit: this.options.maxBucketGroups + 1,
      });

    if (
      counted.reachedLimit ||
      counted.groups.length > this.options.maxBucketGroups
    ) {
      throw new PromQLError(
        `the query counts more than ${this.options.maxBucketGroups.toLocaleString("en-US")} label sets and time buckets. Aggregate it, such as sum by (level) (...), add label matchers, or shorten the time range.`,
        PromQLErrorType.Execution,
      );
    }

    // drop and keep, on the labels each count was made by.
    const labelPipeline: LogQLPipeline = new LogQLPipeline({
      kind: "LogSelector",
      matchers: [],
      stages: range.selector.stages.filter((stage: LogQLStage): boolean => {
        return stage.kind === "Drop" || stage.kind === "Keep";
      }),
    });

    const series: Map<
      string,
      { labels: PromQLLabels; counts: Float64Array; bytes: Float64Array }
    > = new Map();

    for (const group of counted.groups) {
      if (group.bucket < 1 || group.bucket > data.buckets) {
        continue;
      }

      const labels: PromQLLabels =
        labelPipeline.run({ line: "", labels: group.labels })?.labels ||
        group.labels;
      const key: string = promQLLabelsKey(labels);
      let entry:
        | { labels: PromQLLabels; counts: Float64Array; bytes: Float64Array }
        | undefined = series.get(key);

      if (!entry) {
        entry = {
          labels,
          counts: new Float64Array(data.buckets + 1),
          bytes: new Float64Array(data.buckets + 1),
        };
        series.set(key, entry);
      }

      entry.counts[group.bucket]! += group.count;
      entry.bytes[group.bucket]! += group.bytes;
    }

    const rangeBuckets: number = Math.round(range.rangeMs / data.bucketMs);
    const stepBuckets: number =
      data.stepMs > 0 ? Math.round(data.stepMs / data.bucketMs) : 0;
    const rangeSeconds: number = range.rangeMs / 1000;

    // Prefix sums, so each window is a difference.
    const windowsOf: (counts: Float64Array) => Array<number> = (
      counts: Float64Array,
    ): Array<number> => {
      const prefix: Float64Array = new Float64Array(counts.length);

      for (let bucket: number = 1; bucket < counts.length; bucket++) {
        prefix[bucket] = prefix[bucket - 1]! + counts[bucket]!;
      }

      return data.steps.map((_step: number, index: number): number => {
        const last: number = index * stepBuckets + rangeBuckets;
        return prefix[last]! - prefix[last - rangeBuckets]!;
      });
    };

    if (range.operation === LogQLRangeOperation.AbsentOverTime) {
      const total: Float64Array = new Float64Array(data.buckets + 1);

      for (const entry of series.values()) {
        entry.counts.forEach((count: number, bucket: number): void => {
          total[bucket]! += count;
        });
      }

      return [
        {
          labels: equalityLabels(range.selector.matchers),
          values: windowsOf(total).map((count: number): number => {
            return count === 0 ? 1 : NaN;
          }),
        },
      ].filter((window: WindowSamples): boolean => {
        return window.values.some((value: number): boolean => {
          return !Number.isNaN(value);
        });
      });
    }

    const windows: Array<WindowSamples> = [];

    for (const entry of series.values()) {
      const counts: Array<number> = windowsOf(entry.counts);
      const bytes: Array<number> = windowsOf(entry.bytes);
      const values: Array<number> = counts.map(
        (count: number, index: number): number => {
          if (count === 0) {
            return NaN;
          }

          switch (range.operation) {
            case LogQLRangeOperation.Rate:
              return count / rangeSeconds;
            case LogQLRangeOperation.BytesOverTime:
              return bytes[index]!;
            case LogQLRangeOperation.BytesRate:
              return bytes[index]! / rangeSeconds;
            default:
              return count;
          }
        },
      );

      if (
        values.some((value: number): boolean => {
          return !Number.isNaN(value);
        })
      ) {
        windows.push({ labels: entry.labels, values });
      }
    }

    return windows;
  }

  // The range aggregation counted here, over the logs and their pipeline.
  private async countRangeHere(data: {
    range: LogQLRangeAggregation;
    steps: Array<number>;
    originMs: number;
    endMs: number;
  }): Promise<Array<WindowSamples>> {
    const range: LogQLRangeAggregation = data.range;
    const read: { rows: Array<LogQLLogRow>; reachedLimit: boolean } =
      await this.source.readSamples({
        selector: range.selector,
        startNs: millisecondsToNanoseconds(data.originMs),
        endNs: millisecondsToNanoseconds(data.endMs),
        limit: this.options.maxSampleLines + 1,
      });

    if (read.reachedLimit || read.rows.length > this.options.maxSampleLines) {
      throw new PromQLError(
        `the query reads more than ${this.options.maxSampleLines.toLocaleString("en-US")} log lines. Add label matchers or line filters, shorten the time range, or count with line filters alone, which OneUptime counts where the logs are.`,
        PromQLErrorType.Execution,
      );
    }

    const pipeline: LogQLPipeline = new LogQLPipeline(range.selector);
    const unwrapper: LogQLUnwrapper | undefined = range.unwrap
      ? new LogQLUnwrapper(range.unwrap)
      : undefined;
    const series: Map<
      string,
      {
        labels: PromQLLabels;
        samples: Array<{ timeMs: number; value: number; bytes: number }>;
      }
    > = new Map();

    for (const row of read.rows) {
      const entry: LogQLPipelineResult | null = pipeline.run({
        line: row.line,
        labels: row.labels,
      });

      if (!entry) {
        continue;
      }

      let labels: PromQLLabels = entry.labels;
      let value: number = 1;

      if (unwrapper) {
        const sample: { value: number; labels: PromQLLabels } | null =
          unwrapper.sample(entry);

        if (!sample) {
          continue;
        }

        labels = sample.labels;
        value = sample.value;
      }

      assertNoPipelineError(labels);
      labels = groupLabels(labels, range.grouping);

      const key: string = promQLLabelsKey(labels);
      let entrySeries:
        | {
            labels: PromQLLabels;
            samples: Array<{ timeMs: number; value: number; bytes: number }>;
          }
        | undefined = series.get(key);

      if (!entrySeries) {
        entrySeries = { labels: copyOwnValues(labels), samples: [] };
        series.set(key, entrySeries);
      }

      entrySeries.samples.push({
        timeMs: ceilingMilliseconds(row.timeNs),
        value,
        bytes: utf8Length(entry.line),
      });
    }

    const rangeSeconds: number = range.rangeMs / 1000;

    if (range.operation === LogQLRangeOperation.AbsentOverTime) {
      const allTimes: Array<number> = [];

      for (const entrySeries of series.values()) {
        for (const sample of entrySeries.samples) {
          allTimes.push(sample.timeMs);
        }
      }

      allTimes.sort((a: number, b: number): number => {
        return a - b;
      });

      const values: Array<number> = data.steps.map((stepMs: number): number => {
        const fromMs: number = stepMs - range.offsetMs - range.rangeMs;
        const toMs: number = stepMs - range.offsetMs;
        const any: boolean = allTimes.some((timeMs: number): boolean => {
          return timeMs > fromMs && timeMs <= toMs;
        });

        return any ? NaN : 1;
      });

      return values.some((value: number): boolean => {
        return !Number.isNaN(value);
      })
        ? [{ labels: equalityLabels(range.selector.matchers), values }]
        : [];
    }

    const windows: Array<WindowSamples> = [];

    for (const entrySeries of series.values()) {
      const samples: Array<{ timeMs: number; value: number; bytes: number }> =
        entrySeries.samples.sort(
          (a: { timeMs: number }, b: { timeMs: number }): number => {
            return a.timeMs - b.timeMs;
          },
        );
      let low: number = 0;
      let high: number = 0;
      const values: Array<number> = [];

      for (const stepMs of data.steps) {
        const fromMs: number = stepMs - range.offsetMs - range.rangeMs;
        const toMs: number = stepMs - range.offsetMs;

        while (high < samples.length && samples[high]!.timeMs <= toMs) {
          high++;
        }

        while (low < high && samples[low]!.timeMs <= fromMs) {
          low++;
        }

        if (high <= low) {
          values.push(NaN);
          continue;
        }

        const window: Array<{ value: number; bytes: number }> = samples.slice(
          low,
          high,
        );

        values.push(
          aggregateWindow({
            operation: range.operation,
            values: window.map((sample: { value: number }): number => {
              return sample.value;
            }),
            bytes: window.reduce(
              (sum: number, sample: { bytes: number }): number => {
                return sum + sample.bytes;
              },
              0,
            ),
            rangeSeconds,
            parameter: range.parameter,
          }),
        );
      }

      if (
        values.some((value: number): boolean => {
          return !Number.isNaN(value);
        })
      ) {
        windows.push({ labels: entrySeries.labels, values });
      }
    }

    return windows;
  }
}
