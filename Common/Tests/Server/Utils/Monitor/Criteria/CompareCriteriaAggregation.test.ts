import CompareCriteria from "../../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";

/*
 * Two defects, both visible in one real alert email.
 *
 * The customer received:
 *   "Any value of (used_cpu / limit_cpu) * 100 is 72.35, 81.54, 79.95,
 *    91.53, 87.73 % which is greater than 90 %."
 * Four of those five numbers are below the threshold the sentence claims
 * they all exceed — `getCompareMessage` printed the whole evaluation window
 * and then asserted the filter's verdict over it.
 *
 * Separately, every comparator branched on `AnyValue` and let EVERY other
 * evaluation type fall through to `.every()`. Average, Sum, Maximum Value
 * and Minimum Value — all four selectable in the criteria UI — were
 * silently evaluated as "All Values".
 */

// The exact window from the customer's ALT-113.
const WINDOW: Array<number> = [72.35, 81.54, 79.95, 91.53, 87.73];

function metricFilter(
  filterType: FilterType,
  evaluationType: EvaluateOverTimeType,
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: filterType,
    value: 90,
    metricMonitorOptions: {
      metricAggregationType: evaluationType,
      metricAlias: "pod_cpu_limit_saturation",
    },
  } as CriteriaFilter;
}

describe("CompareCriteria aggregation semantics", () => {
  describe("reduceWindow", () => {
    test("Average collapses the window to its mean", () => {
      expect(
        CompareCriteria.reduceWindow({
          values: [10, 20, 30],
          evaluationType: EvaluateOverTimeType.Average,
        }),
      ).toEqual([20]);
    });

    test("Sum collapses the window to its total", () => {
      expect(
        CompareCriteria.reduceWindow({
          values: [10, 20, 30],
          evaluationType: EvaluateOverTimeType.Sum,
        }),
      ).toEqual([60]);
    });

    test("Maximum Value collapses to the largest sample", () => {
      expect(
        CompareCriteria.reduceWindow({
          values: [10, 30, 20],
          evaluationType: EvaluateOverTimeType.MaximumValue,
        }),
      ).toEqual([30]);
    });

    test("Minimum Value collapses to the smallest sample", () => {
      expect(
        CompareCriteria.reduceWindow({
          values: [30, 10, 20],
          evaluationType: EvaluateOverTimeType.MunimumValue,
        }),
      ).toEqual([10]);
    });

    test.each([
      EvaluateOverTimeType.AnyValue,
      EvaluateOverTimeType.AllValues,
      undefined,
    ])(
      "%s quantifies over the untouched window",
      (evaluationType: EvaluateOverTimeType | undefined) => {
        expect(
          CompareCriteria.reduceWindow({
            values: [10, 20, 30],
            evaluationType: evaluationType,
          }),
        ).toEqual([10, 20, 30]);
      },
    );

    test("an empty window is returned unchanged rather than reduced to NaN", () => {
      expect(
        CompareCriteria.reduceWindow({
          values: [],
          evaluationType: EvaluateOverTimeType.Average,
        }),
      ).toEqual([]);
    });
  });

  describe("the four reducing aggregations are actually applied", () => {
    /*
     * The mean of the production window is 82.62. Under the old code
     * "Average > 90" was evaluated as "every sample > 90" — false, but for
     * the wrong reason. These assertions pin the reason.
     */
    test("Average > 90 is false because the mean is 82.62, not because a sample was low", () => {
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: 90,
        }),
      ).toBe(false);

      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: 80,
        }),
      ).toBe(true);
    });

    test("Average > 80 was WRONG before this fix: AllValues semantics said false", () => {
      // If Average were still falling through to `.every()`, 79.95 would
      // sink it. It does not, because the mean is what is compared.
      expect(
        WINDOW.every((v: number) => {
          return v > 80;
        }),
      ).toBe(false);
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: 80,
        }),
      ).toBe(true);
    });

    test("Maximum Value fires on the single high sample", () => {
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.MaximumValue,
          threshold: 90,
        }),
      ).toBe(true);
    });

    test("Minimum Value does not", () => {
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.MunimumValue,
          threshold: 90,
        }),
      ).toBe(false);
    });

    test("Sum aggregates across the window", () => {
      expect(
        CompareCriteria.greaterThan({
          value: [1, 2, 3],
          evaluationType: EvaluateOverTimeType.Sum,
          threshold: 5,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.greaterThan({
          value: [1, 2, 3],
          evaluationType: EvaluateOverTimeType.Sum,
          threshold: 6,
        }),
      ).toBe(false);
    });

    test("every comparator honours the aggregation, not just greaterThan", () => {
      const mean: number = 20; // mean of [10, 20, 30]
      const values: Array<number> = [10, 20, 30];

      expect(
        CompareCriteria.lessThan({
          value: values,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: mean + 1,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.greaterThanOrEqual({
          value: values,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: mean,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.lessThanOrEqual({
          value: values,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: mean,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.equalTo({
          value: values,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: mean,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.notEqualTo({
          value: values,
          evaluationType: EvaluateOverTimeType.Average,
          threshold: mean,
        }),
      ).toBe(false);
    });
  });

  describe("AnyValue and AllValues keep their existing semantics", () => {
    test("AnyValue fires when one sample breaches", () => {
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.AnyValue,
          threshold: 90,
        }),
      ).toBe(true);
    });

    test("AllValues does not", () => {
      expect(
        CompareCriteria.greaterThan({
          value: WINDOW,
          evaluationType: EvaluateOverTimeType.AllValues,
          threshold: 90,
        }),
      ).toBe(false);
    });

    test("an unspecified evaluation type still defaults to AllValues", () => {
      expect(
        CompareCriteria.greaterThan({ value: WINDOW, threshold: 90 }),
      ).toBe(false);
    });

    test("a scalar value is compared directly", () => {
      expect(CompareCriteria.greaterThan({ value: 91, threshold: 90 })).toBe(
        true,
      );
    });

    test("an empty window never matches", () => {
      expect(
        CompareCriteria.greaterThan({
          value: [],
          evaluationType: EvaluateOverTimeType.AnyValue,
          threshold: 90,
        }),
      ).toBe(false);
    });
  });

  describe("the root cause quotes only the samples that breached", () => {
    test("the exact sentence a customer received is no longer produced", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: WINDOW,
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "(used_cpu / limit_cpu) * 100",
        unit: "%",
      });

      // The four non-breaching samples are gone.
      expect(message).not.toContain("72.35");
      expect(message).not.toContain("81.54");
      expect(message).not.toContain("79.95");
      expect(message).not.toContain("87.73");

      // The one that did breach is named, and the reader is told how much
      // of the window it represents.
      expect(message).toContain("91.53");
      expect(message).toContain(
        "1 of 5 samples in the evaluation window breached this threshold.",
      );
    });

    test("a fully breaching window keeps the shorter sentence", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: [95, 96, 97],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      });

      expect(message).toBe(
        "Any value of CPU is 95, 96, 97 % which is greater than 90 %.",
      );
    });

    test("a below-threshold recovery message quotes only the recovering samples", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: [95, 80, 70],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.LessThanOrEqualTo,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      });

      expect(message).toContain("80, 70");
      expect(message).not.toContain("95");
    });

    test("AllValues is unaffected — every sample breached by definition", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: [95, 96],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AllValues,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      });

      expect(message).toBe(
        "All values of CPU is 95, 96 % which is greater than 90 %.",
      );
    });

    test("a reducing aggregation quotes the aggregate, not the raw window", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: [10, 20, 30],
        threshold: 15,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.Average,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      });

      expect(message).toContain("The average of CPU is 20");
      expect(message).not.toContain("10, 20, 30");
    });

    test.each([
      [EvaluateOverTimeType.Average, "The average of"],
      [EvaluateOverTimeType.Sum, "The sum of"],
      [EvaluateOverTimeType.MaximumValue, "The maximum of"],
      [EvaluateOverTimeType.MunimumValue, "The minimum of"],
      [EvaluateOverTimeType.AnyValue, "Any value of"],
      [EvaluateOverTimeType.AllValues, "All values of"],
    ])(
      "%s is named in the sentence as %s",
      (evaluationType: EvaluateOverTimeType, expectedPrefix: string) => {
        const message: string = CompareCriteria.getCompareMessage({
          values: [100],
          threshold: 90,
          criteriaFilter: metricFilter(FilterType.GreaterThan, evaluationType),
          metricDisplayName: "CPU",
          unit: "%",
        });

        expect(message.startsWith(expectedPrefix)).toBe(true);
      },
    );

    test("a message rendered for a filter that did not match degrades gracefully", () => {
      // Nothing in the window is above 200; the whole window is quoted
      // rather than an empty list.
      const message: string = CompareCriteria.getCompareMessage({
        values: WINDOW,
        threshold: 200,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      });

      expect(message).toContain("72.35");
      expect(message).not.toContain("samples in the evaluation window");
    });

    test("a non-numeric window is left alone", () => {
      const message: string = CompareCriteria.getCompareMessage({
        values: [true, false],
        threshold: 1,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "Up",
      });

      expect(message).toContain("true, false");
    });

    test("getBreachingValues returns only the matching samples", () => {
      expect(
        CompareCriteria.getBreachingValues({
          values: WINDOW,
          evaluationType: EvaluateOverTimeType.AnyValue,
          predicate: (value: number) => {
            return value > 90;
          },
        }),
      ).toEqual([91.53]);
    });
  });
});
