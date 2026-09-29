import CountAnomaly, {
  CountAnomalyEvaluation,
  CountBaselineStats,
  MAD_TO_SIGMA,
} from "../../../../../Server/Utils/Monitor/Criteria/CountAnomaly";
import {
  AnomalyDetectionMethod,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";

/*
 * Pure math behind the span/log count anomaly criteria. The baseline
 * services feed per-minute counts through computeStats, and the
 * trace/log evaluators compare the observed rate through evaluate —
 * these tests pin both halves, mirroring the metric baseline's
 * mean±kσ / median+MAD semantics.
 */
describe("CountAnomaly.computeStats", () => {
  test("empty input → null (no baseline, caller stays in Learning)", () => {
    expect(CountAnomaly.computeStats([])).toBeNull();
  });

  test("computes mean, population stddev, median, MAD-sigma and min/max", () => {
    const stats: CountBaselineStats | null = CountAnomaly.computeStats([
      1, 2, 3, 4, 5,
    ]);

    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(5);
    expect(stats!.mean).toBe(3);
    // Population stddev of 1..5 is sqrt(2).
    expect(stats!.stddev).toBeCloseTo(Math.sqrt(2), 10);
    expect(stats!.median).toBe(3);
    // Absolute deviations from the median are [2,1,0,1,2] → MAD 1.
    expect(stats!.madSigma).toBeCloseTo(MAD_TO_SIGMA, 10);
    expect(stats!.minObserved).toBe(1);
    expect(stats!.maxObserved).toBe(5);
  });

  test("even-length input → median is the midpoint of the middle pair", () => {
    const stats: CountBaselineStats | null = CountAnomaly.computeStats([
      4, 1, 3, 2,
    ]);
    expect(stats!.median).toBe(2.5);
  });

  test("constant counts → zero stddev and zero MAD (zero-variance baseline)", () => {
    const stats: CountBaselineStats | null = CountAnomaly.computeStats([
      10, 10, 10, 10,
    ]);
    expect(stats!.mean).toBe(10);
    expect(stats!.stddev).toBe(0);
    expect(stats!.madSigma).toBe(0);
  });

  test("median/MAD are robust to a single outlier that inflates mean/stddev", () => {
    const counts: Array<number> = [10, 10, 10, 10, 10, 10, 10, 10, 10, 1000];
    const stats: CountBaselineStats | null = CountAnomaly.computeStats(counts);

    expect(stats!.median).toBe(10);
    expect(stats!.madSigma).toBe(0);
    expect(stats!.mean).toBeGreaterThan(100);
    expect(stats!.stddev).toBeGreaterThan(100);
  });
});

describe("CountAnomaly.evaluate", () => {
  const baseline: CountBaselineStats = {
    sampleCount: 120,
    mean: 20,
    stddev: 5,
    median: 18,
    madSigma: 4,
    minObserved: 8,
    maxObserved: 33,
  };

  test("AnomalouslyHigh breaches above mean + kσ and reports signed sigma", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 45,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyHigh,
    });

    expect(evaluation).not.toBeNull();
    expect(evaluation!.breaches).toBe(true);
    expect(evaluation!.expectedHigh).toBe(35);
    expect(evaluation!.expectedLow).toBe(5);
    expect(evaluation!.observedSigma).toBe(5);
    expect(evaluation!.center).toBe(20);
    expect(evaluation!.spread).toBe(5);
  });

  test("AnomalouslyHigh does not breach inside the band", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 30,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyHigh,
    });
    expect(evaluation!.breaches).toBe(false);
  });

  test("AnomalouslyHigh ignores a low breach", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 0,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyHigh,
    });
    expect(evaluation!.breaches).toBe(false);
  });

  test("AnomalouslyLow breaches below mean - kσ", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 0,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyLow,
    });
    expect(evaluation!.breaches).toBe(true);
    expect(evaluation!.observedSigma).toBe(-4);
  });

  test("Anomalous breaches in either direction", () => {
    const high: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 45,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.Anomalous,
    });
    const low: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 0,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.Anomalous,
    });
    expect(high!.breaches).toBe(true);
    expect(low!.breaches).toBe(true);
  });

  test("sigmaCount widens the band (Low sensitivity = 4σ does not fire where 2σ does)", () => {
    const observedPerMinute: number = 38; // 3.6σ above the mean of 20
    const highSensitivity: CountAnomalyEvaluation | null =
      CountAnomaly.evaluate({
        observedPerMinute,
        stats: baseline,
        sigmaCount: 2,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      });
    const lowSensitivity: CountAnomalyEvaluation | null = CountAnomaly.evaluate(
      {
        observedPerMinute,
        stats: baseline,
        sigmaCount: 4,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      },
    );
    expect(highSensitivity!.breaches).toBe(true);
    expect(lowSensitivity!.breaches).toBe(false);
  });

  test("MedianMad method compares against median and MAD-sigma", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 31, // > 18 + 3×4 = 30
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MedianMad,
      filterType: FilterType.AnomalouslyHigh,
    });
    expect(evaluation!.breaches).toBe(true);
    expect(evaluation!.center).toBe(18);
    expect(evaluation!.spread).toBe(4);
  });

  test("zero-spread baseline → null (caller must skip, never alert)", () => {
    const flat: CountBaselineStats = {
      ...baseline,
      stddev: 0,
      madSigma: 0,
    };
    expect(
      CountAnomaly.evaluate({
        observedPerMinute: 100,
        stats: flat,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
    expect(
      CountAnomaly.evaluate({
        observedPerMinute: 100,
        stats: flat,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MedianMad,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
  });

  test("non-anomaly filter type never breaches", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observedPerMinute: 1000,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.GreaterThan,
    });
    expect(evaluation!.breaches).toBe(false);
  });
});
