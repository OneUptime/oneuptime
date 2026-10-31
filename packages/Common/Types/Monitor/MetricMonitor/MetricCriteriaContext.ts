import { JSONObject } from "../../JSON";
import MetricsAggregationType from "../../Metrics/MetricsAggregationType";

/**
 * A per-timestamp snapshot of a variable referenced by a formula —
 * used to show "what did $a and $b evaluate to when c breached?" on the
 * incident root-cause page.
 */
export interface MetricComponentValue {
  alias: string;
  value: number | null;
}

export interface MetricBreachingSample {
  value: number;
  timestamp: Date;
  attributes: JSONObject;
  /**
   * For formula evaluations: the values of each referenced variable at
   * this timestamp. Keyed by variable alias. Absent for plain metric
   * criteria.
   */
  componentValues?: Array<MetricComponentValue> | undefined;
}

/**
 * Descriptor for one variable referenced by a formula, used to label
 * each breaching sample's component values and render the Metric
 * Details section. Name is the
 * metric display name (usually the metric name, sometimes the formula
 * expression for nested formulas) and unit is the variable's native
 * unit as configured.
 */
export interface MetricComponent {
  alias: string;
  name: string;
  unit: string | null;
  isFormula: boolean;
}

/**
 * State of an anomaly-detection evaluation. Populated only for
 * anomaly filter types (AnomalouslyHigh / AnomalouslyLow / Anomalous);
 * absent for static-threshold criteria.
 *
 *   - "Learning" — no baseline available yet (cold start) or the
 *     baseline cell did not meet the minimum sample threshold. The
 *     evaluator returns no breach for this state.
 *   - "Normal"   — baseline is reliable and the observed value sits
 *     inside the expected range.
 *   - "Anomalous" — observed value sits outside the expected range
 *     for the configured direction; evaluator returns a breach.
 */
export type MetricAnomalyState = "Learning" | "Normal" | "Anomalous";

/*
 * Why a series' data does not cover the window yet: it began part way
 * through (a new series), it has a hole of more than one missing data
 * point, or its newest data point is stale.
 */
export type MetricWindowShortfall = "StartsLate" | "Hole" | "Stale";

/**
 * An "All Values" criteria whose every data point meets the condition, but
 * whose data does not cover the monitor's time range yet - so it cannot say
 * the condition held for the whole range, and waits (issue #4793).
 */
export interface MetricWindowWait {
  /*
   * What the evaluation log says: "Deployment Replica Shortfall was 1 in 1
   * reading, above the 0 threshold. Waiting for 15 minutes of data: 1 of 15
   * minutes so far."
   */
  message: string;
  // How many series of the criteria are waiting; 1 on an ungrouped monitor.
  waitingSeriesCount: number;
  shortfall: MetricWindowShortfall;
  // The window the series was judged over, in milliseconds.
  windowMs: number;
  /*
   * How much of it the series' newest unbroken run of data covers, in
   * milliseconds.
   */
  coveredMs: number;
}

/*
 * How a criteria that judges the window as one value takes it from the
 * window's samples: the Average, Sum, Maximum Value or Minimum Value
 * evaluation types, in the words a sentence names them by.
 */
export type MetricWindowAggregation = "average" | "sum" | "maximum" | "minimum";

/**
 * The one value a criteria compared with its threshold when it judged the
 * whole window at once (see MetricCriteriaContext.windowAggregate).
 */
export interface MetricWindowAggregate {
  aggregation: MetricWindowAggregation;
  /*
   * In the same display unit as the samples, and taken from the same
   * values the criteria compared (CompareCriteria.reduceWindow).
   */
  value: number;
  // How many samples it was taken over; 0 for a window with none.
  sampleCount: number;
}

export interface MetricAnomalyBaseline {
  state: MetricAnomalyState;
  /** Baseline mean for the matching hour-of-week, rolling window. */
  mean: number;
  stddev: number;
  /** Baseline ± sigmaCount × stddev. */
  expectedHigh: number;
  expectedLow: number;
  sigmaCount: number;
  sampleCount: number;
  hourOfWeek: number;
  windowDays: number;
  /** The observed aggregate value compared against the band. */
  observedValue?: number | undefined;
  /**
   * Number of standard deviations the observed value sat from the
   * baseline mean. Reported in the root cause string; sign indicates
   * direction (positive = above, negative = below).
   */
  observedSigma?: number | undefined;
}

export default interface MetricCriteriaContext {
  metricName: string;
  alias: string;
  /**
   * The legend the user gave the query or formula the criteria targets
   * ("Node Memory Utilization (%)"), when it is more than the bare alias.
   * `metricName` is the formula EXPRESSION for a formula criteria, which is
   * not something to title a list with.
   */
  displayName?: string | undefined;
  unit: string | null;
  aggregationType: MetricsAggregationType | null;
  isFormula: boolean;
  formulaExpression?: string | undefined;
  filterAttributes: JSONObject;
  groupBy: Array<string>;
  timeWindowMinutes?: number | undefined;
  /**
   * Result of the anomaly check, when the criterion's filterType is
   * one of the anomaly types. Absent for static-threshold criteria.
   */
  anomalyBaseline?: MetricAnomalyBaseline | undefined;
  /**
   * Set when an "All Values" criteria did not match only because the
   * series' data does not cover the time range yet. Absent otherwise.
   */
  windowWait?: MetricWindowWait | undefined;
  /**
   * Fingerprint of the specific series this context represents when the
   * monitor is configured for per-series alerting. Undefined for
   * traditional whole-monitor evaluation.
   */
  seriesFingerprint?: string | undefined;
  /**
   * Label values identifying the series (e.g. {host.name: prod-01}).
   * Populated alongside seriesFingerprint.
   */
  seriesLabels?: JSONObject | undefined;
  breachingSample?: MetricBreachingSample | undefined;
  /**
   * All samples in the evaluation window that breached the threshold,
   * in chronological order. Used to render the Breaching Samples list
   * of timestamps and values on the incident root-cause page. For a Sum
   * criteria, which compares the window's total and never a sample, they
   * are the samples that added to that total (every one that is not 0).
   */
  breachingSamples?: Array<MetricBreachingSample> | undefined;
  /**
   * What the criteria compared with its threshold, when it judged the
   * window as one value - an Average, Sum, Maximum Value or Minimum Value
   * criteria. A summed template (restarts or failures in 15 minutes) is
   * judged on the window's total, which no single sample shows: one with
   * a restart in each of five minutes has no sample above 1. So the value
   * a reader is shown for the series - its row in an Affected Resources
   * list, the analysis sentence, the Breaching Samples summary - is this
   * one. Absent for Any Value and All Values, which judge each sample.
   */
  windowAggregate?: MetricWindowAggregate | undefined;
  /**
   * Total number of samples considered during evaluation (including
   * non-breaching ones), so the root cause can show "N of M samples
   * breached" without re-querying.
   */
  totalSamplesInWindow?: number | undefined;
  /**
   * The smallest and largest sample in the evaluation window, in the same
   * display unit as `breachingSamples`. Lets a reader of the context name
   * the series' worst value even when the criteria compared an aggregate
   * (a Sum over the window can breach while no single sample does).
   */
  sampleValueRange?: { min: number; max: number } | undefined;
  /**
   * For formulas: metadata for each variable the formula references,
   * in the order they appear in the expression. Consumers use this to
   * label each breaching sample's component values and to surface
   * underlying units/metric names in the Metric Details section.
   */
  components?: Array<MetricComponent> | undefined;
}
