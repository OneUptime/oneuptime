import {
  AnomalyDetectionMethod,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";

/**
 * Consistency constant that maps a Median Absolute Deviation to the
 * standard deviation of a Gaussian (σ ≈ 1.4826 × MAD), so the same
 * sigmaCount sensitivity levels apply to both anomaly methods.
 */
export const MAD_TO_SIGMA: number = 1.4826;

/**
 * Descriptive statistics of a set of telemetry counts — one hour-of-week
 * baseline cell aggregated over a rolling window, per minute for spans and
 * logs, per monitor window for exceptions.
 * Computed in app code (not SQL) so the math is pure and unit-testable.
 */
export interface CountBaselineStats {
  /** Number of non-empty minute cells that contributed. */
  sampleCount: number;
  mean: number;
  /** Population standard deviation. */
  stddev: number;
  median: number;
  /** MAD × 1.4826 → σ-equivalent, used by the MedianMad method. */
  madSigma: number;
  minObserved: number;
  maxObserved: number;
}

/**
 * Baseline summary returned by the span/log count baseline services:
 * the stats plus the reliability verdict and lookup coordinates.
 * Mirrors `BaselineSummary` from MetricBaselineService.
 */
export interface CountBaselineSummary extends CountBaselineStats {
  /**
   * Whether this cell meets the minimum sample threshold to be trusted.
   * Callers must refuse to evaluate against an unreliable baseline —
   * the "Learning" cold-start state.
   */
  isReliable: boolean;
  /** Window the baseline was computed over (days). */
  windowDays: number;
  hourOfWeek: number;
}

export interface CountAnomalyEvaluation {
  breaches: boolean;
  /** (observed - center) / spread — signed sigma distance. */
  observedSigma: number;
  expectedHigh: number;
  expectedLow: number;
  /** Baseline center actually compared against (mean or median). */
  center: number;
  /** Baseline spread actually compared against (stddev or MAD×1.4826). */
  spread: number;
}

/**
 * Pure math for count-based anomaly criteria (CheckOn.SpanCount /
 * CheckOn.LogCount / CheckOn.ExceptionCount with
 * FilterType.AnomalouslyHigh/Low/Anomalous).
 * The services compute stats through here so the write-side MV cells
 * and the eval-time comparison agree on what a "sample" is.
 */
export default class CountAnomaly {
  /**
   * Compute baseline stats over a cell's per-minute counts. Returns
   * null for an empty input — the caller treats that as "no baseline"
   * (Learning), same as a missing row.
   */
  public static computeStats(counts: Array<number>): CountBaselineStats | null {
    if (counts.length === 0) {
      return null;
    }

    let sum: number = 0;
    let min: number = counts[0]!;
    let max: number = counts[0]!;
    for (const value of counts) {
      sum += value;
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
    const mean: number = sum / counts.length;

    let sumSquaredDeviation: number = 0;
    for (const value of counts) {
      sumSquaredDeviation += (value - mean) * (value - mean);
    }
    const stddev: number = Math.sqrt(sumSquaredDeviation / counts.length);

    const median: number = CountAnomaly.medianOf(counts);
    const absoluteDeviations: Array<number> = counts.map((value: number) => {
      return Math.abs(value - median);
    });
    const madSigma: number =
      CountAnomaly.medianOf(absoluteDeviations) * MAD_TO_SIGMA;

    return {
      sampleCount: counts.length,
      mean,
      stddev,
      median,
      madSigma,
      minObserved: min,
      maxObserved: max,
    };
  }

  /**
   * A baseline no narrower than a count is by chance. A count's standard
   * deviation is at least the square root of its mean (Poisson), so a
   * service that threw 4, 4 and 4 is not one that can never throw 5: a
   * measured spread of zero says how few samples there are, not how steady
   * it is. The mean is taken as at least one, so the baseline of a service
   * that threw nothing still has a spread, and a burst is judged rather
   * than skipped.
   */
  public static withCountingNoise(
    stats: CountBaselineStats,
  ): CountBaselineStats {
    const noise: number = Math.sqrt(Math.max(stats.mean, 1));

    return {
      ...stats,
      stddev: Math.max(stats.stddev, noise),
      madSigma: Math.max(stats.madSigma, noise),
    };
  }

  /**
   * Compare an observed count, in the unit of the baseline's samples (a
   * per-minute rate, or a whole window), to a baseline cell. Returns
   * null when the baseline has zero spread — any deviation at all would
   * fire, so the caller must skip rather than alert (mirrors the metric
   * evaluator's zero-variance guard).
   */
  public static evaluate(input: {
    observed: number;
    stats: CountBaselineStats;
    sigmaCount: number;
    method: AnomalyDetectionMethod;
    filterType: FilterType | undefined;
  }): CountAnomalyEvaluation | null {
    const isMedianMad: boolean =
      input.method === AnomalyDetectionMethod.MedianMad;
    const center: number = isMedianMad ? input.stats.median : input.stats.mean;
    const spread: number = isMedianMad
      ? input.stats.madSigma
      : input.stats.stddev;

    if (!Number.isFinite(spread) || spread <= 0) {
      return null;
    }

    const expectedHigh: number = center + input.sigmaCount * spread;
    const expectedLow: number = center - input.sigmaCount * spread;
    const observedSigma: number = (input.observed - center) / spread;

    const isHighBreach: boolean = input.observed > expectedHigh;
    const isLowBreach: boolean = input.observed < expectedLow;

    let breaches: boolean = false;
    switch (input.filterType) {
      case FilterType.AnomalouslyHigh:
        breaches = isHighBreach;
        break;
      case FilterType.AnomalouslyLow:
        breaches = isLowBreach;
        break;
      case FilterType.Anomalous:
        breaches = isHighBreach || isLowBreach;
        break;
      default:
        breaches = false;
    }

    return {
      breaches,
      observedSigma,
      expectedHigh,
      expectedLow,
      center,
      spread,
    };
  }

  private static medianOf(values: Array<number>): number {
    const sorted: Array<number> = [...values].sort((a: number, b: number) => {
      return a - b;
    });
    const mid: number = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    return sorted[mid]!;
  }
}
