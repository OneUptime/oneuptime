import CountAnomaly, {
  CountAnomalyEvaluation,
  CountBaselineStats,
  CountBaselineSummary,
  CountWindowBreach,
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
      observed: 45,
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
      observed: 30,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyHigh,
    });
    expect(evaluation!.breaches).toBe(false);
  });

  test("AnomalouslyHigh ignores a low breach", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observed: 0,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.AnomalouslyHigh,
    });
    expect(evaluation!.breaches).toBe(false);
  });

  test("AnomalouslyLow breaches below mean - kσ", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observed: 0,
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
      observed: 45,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.Anomalous,
    });
    const low: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observed: 0,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.Anomalous,
    });
    expect(high!.breaches).toBe(true);
    expect(low!.breaches).toBe(true);
  });

  test("sigmaCount widens the band (Low sensitivity = 4σ does not fire where 2σ does)", () => {
    const observed: number = 38; // 3.6σ above the mean of 20
    const highSensitivity: CountAnomalyEvaluation | null =
      CountAnomaly.evaluate({
        observed,
        stats: baseline,
        sigmaCount: 2,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      });
    const lowSensitivity: CountAnomalyEvaluation | null = CountAnomaly.evaluate(
      {
        observed,
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
      observed: 31, // > 18 + 3×4 = 30
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
        observed: 100,
        stats: flat,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
    expect(
      CountAnomaly.evaluate({
        observed: 100,
        stats: flat,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MedianMad,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
  });

  test("non-anomaly filter type never breaches", () => {
    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observed: 1000,
      stats: baseline,
      sigmaCount: 3,
      method: AnomalyDetectionMethod.MeanStddev,
      filterType: FilterType.GreaterThan,
    });
    expect(evaluation!.breaches).toBe(false);
  });
});

describe("CountAnomaly.withCountingNoise", () => {
  const stats: (counts: Array<number>) => CountBaselineStats = (
    counts: Array<number>,
  ): CountBaselineStats => {
    return CountAnomaly.computeStats(counts)!;
  };

  test("a flat history is as noisy as chance makes a count", () => {
    const widened: CountBaselineStats = CountAnomaly.withCountingNoise(
      stats([25, 25, 25, 25]),
    );

    expect(widened.stddev).toBe(5);
    expect(widened.madSigma).toBe(5);
  });

  test("a spread wider than chance is kept", () => {
    const original: CountBaselineStats = stats([0, 100, 0, 100]);
    const widened: CountBaselineStats =
      CountAnomaly.withCountingNoise(original);

    expect(widened.stddev).toBe(original.stddev);
    expect(widened.madSigma).toBe(original.madSigma);
  });

  test("the mean, median and extremes are left as they were", () => {
    const original: CountBaselineStats = stats([3, 3, 3, 3]);

    expect(CountAnomaly.withCountingNoise(original)).toMatchObject({
      sampleCount: original.sampleCount,
      mean: original.mean,
      median: original.median,
      minObserved: original.minObserved,
      maxObserved: original.maxObserved,
    });
  });

  test("a history of nothing has a spread of one, not none", () => {
    const widened: CountBaselineStats = CountAnomaly.withCountingNoise(
      stats([0, 0, 0, 0]),
    );

    expect(widened.stddev).toBe(1);
    expect(
      CountAnomaly.evaluate({
        observed: 50,
        stats: widened,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      })?.breaches,
    ).toBe(true);
  });

  test("without it a flat history is skipped, as spans and logs read one", () => {
    expect(
      CountAnomaly.evaluate({
        observed: 50,
        stats: stats([0, 0, 0, 0]),
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
  });
});

describe("CountAnomaly.findBreach", () => {
  const busy: CountBaselineSummary = {
    sampleCount: 120,
    mean: 100,
    stddev: 10,
    median: 98,
    madSigma: 8,
    minObserved: 70,
    maxObserved: 130,
    isReliable: true,
    windowDays: 14,
    hourOfWeek: 8,
  };

  // Two runs of a job an hour: most windows empty, the rest about 100.
  const sparse: CountBaselineSummary = {
    ...busy,
    sampleCount: 360,
    mean: 1.1,
    stddev: 7.8,
    median: 0,
    madSigma: 1.05,
    minObserved: 0,
    nonEmpty: {
      sampleCount: 4,
      mean: 100,
      stddev: 10,
      median: 100,
      madSigma: 10,
      minObserved: 90,
      maxObserved: 110,
    },
  };

  const find: (input: {
    observed: number;
    baseline?: CountBaselineSummary;
    filterType: FilterType;
    count?: number;
    minimumCount?: number;
    method?: AnomalyDetectionMethod;
  }) => CountWindowBreach | null = (input: {
    observed: number;
    baseline?: CountBaselineSummary;
    filterType: FilterType;
    count?: number;
    minimumCount?: number;
    method?: AnomalyDetectionMethod;
  }): CountWindowBreach | null => {
    return CountAnomaly.findBreach({
      observed: input.observed,
      count: input.count ?? input.observed,
      baseline: input.baseline || busy,
      sigmaCount: 3,
      method: input.method || AnomalyDetectionMethod.MeanStddev,
      filterType: input.filterType,
      minimumCount: input.minimumCount ?? 10,
    });
  };

  test("a busy baseline is judged as CountAnomaly.evaluate judges it", () => {
    expect(
      find({ observed: 131, filterType: FilterType.AnomalouslyHigh }),
    ).toMatchObject({
      breaches: true,
      center: 100,
      spread: 10,
      observedSigma: 3.1,
      sampleCount: 120,
    });
    expect(
      find({ observed: 130, filterType: FilterType.AnomalouslyHigh }),
    ).toBeNull();
    expect(
      find({ observed: 69, filterType: FilterType.AnomalouslyLow }),
    ).toMatchObject({ breaches: true, observedSigma: -3.1 });
    expect(
      find({ observed: 70, filterType: FilterType.AnomalouslyLow }),
    ).toBeNull();
  });

  test("each filter only breaches its own way", () => {
    expect(
      find({ observed: 200, filterType: FilterType.AnomalouslyLow }),
    ).toBeNull();
    expect(
      find({ observed: 0, filterType: FilterType.AnomalouslyHigh }),
    ).toBeNull();
    expect(
      find({ observed: 200, filterType: FilterType.Anomalous }),
    ).not.toBeNull();
    expect(
      find({ observed: 0, filterType: FilterType.Anomalous }),
    ).not.toBeNull();
  });

  test("a filter that is not an anomaly filter never breaches", () => {
    expect(
      find({ observed: 200, filterType: FilterType.GreaterThan }),
    ).toBeNull();
  });

  test("a window of a job's usual size is not unusually high, though most windows are empty", () => {
    expect(
      find({
        observed: 105,
        baseline: sparse,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
    expect(
      find({ observed: 105, baseline: sparse, filterType: FilterType.Anomalous }),
    ).toBeNull();
  });

  test("a window past the job's usual size is, and says what it was judged by", () => {
    expect(
      find({
        observed: 300,
        baseline: sparse,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toMatchObject({ center: 100, spread: 10, sampleCount: 4 });
  });

  test("an empty window of such a scope is not unusually low", () => {
    expect(
      find({
        observed: 0,
        baseline: sparse,
        filterType: FilterType.AnomalouslyLow,
      }),
    ).toBeNull();
    expect(
      find({ observed: 0, baseline: sparse, filterType: FilterType.Anomalous }),
    ).toBeNull();
  });

  test("a window between a job's runs and its usual size is neither", () => {
    expect(
      find({ observed: 50, baseline: sparse, filterType: FilterType.Anomalous }),
    ).toBeNull();
  });

  test("the median method reads each side's median and MAD", () => {
    expect(
      find({
        observed: 300,
        baseline: sparse,
        filterType: FilterType.AnomalouslyHigh,
        method: AnomalyDetectionMethod.MedianMad,
      }),
    ).toMatchObject({ center: 100, spread: 10 });
  });

  test("a count under the minimum is never unusually high, whatever its rate", () => {
    expect(
      find({
        observed: 500,
        count: 9,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
    expect(
      find({
        observed: 500,
        count: 10,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).not.toBeNull();
  });

  test("the minimum is the caller's", () => {
    expect(
      find({
        observed: 500,
        count: 9,
        minimumCount: 5,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).not.toBeNull();
  });

  test("the minimum does not stop a window reading as unusually low", () => {
    expect(
      find({ observed: 0, count: 0, filterType: FilterType.AnomalouslyLow }),
    ).not.toBeNull();
  });

  test("a baseline with no spread is still skipped", () => {
    expect(
      find({
        observed: 500,
        baseline: { ...busy, stddev: 0 },
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();
  });
});
