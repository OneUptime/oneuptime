import { PromQLLabelMatcher, PromQLValueType } from "./PromQLAst";
import { PromQLLabels } from "./PromQLLabels";

/*
 * What the PromQL engine reads, holds while it evaluates, and answers with.
 */

/*
 * The series one selector asks a source for. The engine asks once per
 * selector per query, for every sample any evaluation step can read:
 * timestamps after `startTimeMs` and at or before `endTimeMs`.
 */
export interface PromQLSeriesSelection {
  // The metric name, when the selector names one.
  metricName: string | undefined;
  /*
   * Every matcher, `__name__` included. A source returns only series that
   * satisfy all of them.
   */
  matchers: Array<PromQLLabelMatcher>;
  startTimeMs: number;
  endTimeMs: number;
}

export interface PromQLSeries {
  labels: PromQLLabels;
  // Ascending, in milliseconds since 1970, one per value.
  timestampsMs: ArrayLike<number>;
  values: ArrayLike<number>;
}

/*
 * Where series come from: OneUptime's metrics in ClickHouse on the server,
 * series held in memory in tests.
 */
export interface PromQLSeriesSource {
  select(selection: PromQLSeriesSelection): Promise<Array<PromQLSeries>>;
}

// One element of an instant vector while the engine evaluates.
export interface PromQLSample {
  labels: PromQLLabels;
  value: number;
  /*
   * When the sample was taken: a selector's sample keeps its own time (what
   * timestamp() answers); a computed sample has the evaluation time.
   */
  timestampMs: number;
}

export interface PromQLRangeSeries {
  labels: PromQLLabels;
  timestampsMs: ArrayLike<number>;
  values: ArrayLike<number>;
}

export type PromQLEvalValue =
  | { type: PromQLValueType.Scalar; value: number }
  | { type: PromQLValueType.String; value: string }
  | { type: PromQLValueType.InstantVector; samples: Array<PromQLSample> }
  | {
      type: PromQLValueType.RangeVector;
      series: Array<PromQLRangeSeries>;
      // The window the range covers: after start, up to and with end.
      rangeStartMs: number;
      rangeEndMs: number;
      rangeMs: number;
    };

export enum PromQLResultType {
  Matrix = "matrix",
  Vector = "vector",
  Scalar = "scalar",
  String = "string",
}

export interface PromQLResultPoint {
  timestampMs: number;
  value: number;
}

export interface PromQLMatrixResultSeries {
  labels: PromQLLabels;
  points: Array<PromQLResultPoint>;
}

export interface PromQLVectorResultSample {
  labels: PromQLLabels;
  timestampMs: number;
  value: number;
}

export type PromQLQueryResult =
  | {
      resultType: PromQLResultType.Matrix;
      series: Array<PromQLMatrixResultSeries>;
    }
  | {
      resultType: PromQLResultType.Vector;
      samples: Array<PromQLVectorResultSample>;
    }
  | { resultType: PromQLResultType.Scalar; timestampMs: number; value: number }
  | { resultType: PromQLResultType.String; timestampMs: number; value: string };

export interface PromQLEngineOptions {
  /*
   * How far back an instant selector looks for a series' latest sample.
   * Prometheus' default: 5 minutes.
   */
  lookbackDeltaMs?: number | undefined;
  // The step of a subquery written without one (`[1h:]`): 1 minute.
  defaultSubqueryStepMs?: number | undefined;
  // The most samples a query may read and hold.
  maxSamples?: number | undefined;
  // The most points one series of a range query may have: 11,000.
  maxPointsPerSeries?: number | undefined;
  // How long evaluation may take, after the series are read.
  timeoutMs?: number | undefined;
  // The clock the timeout reads; tests replace it.
  now?: (() => number) | undefined;
}
