import CompareCriteria from "../../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";

function metricFilter(
  filterType: FilterType,
  evaluationType?: EvaluateOverTimeType,
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType,
    value: 90,
    metricMonitorOptions: {
      metricAggregationType: evaluationType,
    },
  };
}

const COMPARISONS: Array<{
  filterType: FilterType;
  relation: string;
  matching: number;
  nonmatching: number;
}> = [
  {
    filterType: FilterType.GreaterThan,
    relation: "above",
    matching: 95,
    nonmatching: 90,
  },
  {
    filterType: FilterType.GreaterThanOrEqualTo,
    relation: "at or above",
    matching: 90,
    nonmatching: 85,
  },
  {
    filterType: FilterType.LessThan,
    relation: "below",
    matching: 85,
    nonmatching: 90,
  },
  {
    filterType: FilterType.LessThanOrEqualTo,
    relation: "at or below",
    matching: 90,
    nonmatching: 95,
  },
  {
    filterType: FilterType.EqualTo,
    relation: "equal to",
    matching: 90,
    nonmatching: 95,
  },
  {
    filterType: FilterType.NotEqualTo,
    relation: "different from",
    matching: 95,
    nonmatching: 90,
  },
];

describe("human-readable numeric criteria messages", () => {
  describe.each(COMPARISONS)("$filterType", ({
    filterType,
    relation,
    matching,
    nonmatching,
  }) => {
    test("describes a matching scalar without implying multiple readings", () => {
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: matching,
          threshold: 90,
          criteriaFilter: metricFilter(filterType),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBe(
        `CPU was ${matching.toFixed(2)}%, ${relation} the 90.00% threshold.`,
      );
    });

    test("does not produce a root cause for a scalar that did not match", () => {
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: nonmatching,
          threshold: 90,
          criteriaFilter: metricFilter(filterType),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBeNull();
    });

    test("AnyValue counts only matching readings, including duplicates", () => {
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: [nonmatching, matching, nonmatching, matching, nonmatching],
          threshold: 90,
          criteriaFilter: metricFilter(filterType, EvaluateOverTimeType.AnyValue),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBe(
        `CPU was ${matching.toFixed(2)}% in 2 of 5 readings, ${relation} the 90.00% threshold.`,
      );
    });

    test("AllValues reports the full count without repeating identical values", () => {
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: [matching, matching, matching],
          threshold: 90,
          criteriaFilter: metricFilter(filterType, EvaluateOverTimeType.AllValues),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBe(
        `CPU was ${matching.toFixed(2)}% in all 3 readings, ${relation} the 90.00% threshold.`,
      );
    });

    test("AllValues still rejects a window containing a nonmatching reading", () => {
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: [matching, nonmatching, matching],
          threshold: 90,
          criteriaFilter: metricFilter(filterType, EvaluateOverTimeType.AllValues),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBeNull();
    });

    test("a direct description distinguishes an unmet requirement from the observation", () => {
      expect(
        CompareCriteria.getCompareMessage({
          values: nonmatching,
          threshold: 90,
          criteriaFilter: metricFilter(filterType),
          metricDisplayName: "CPU",
          unit: "%",
        }),
      ).toBe(
        `CPU was ${nonmatching.toFixed(2)}%. The condition requires the value to be ${relation} the 90.00% threshold.`,
      );
    });
  });

  test.each([
    EvaluateOverTimeType.AnyValue,
    EvaluateOverTimeType.AllValues,
    undefined,
  ])("summarizes the repeated HPA saturation readings with %s", (evaluationType) => {
    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [100, 100, 100, 100, 100],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThanOrEqualTo,
          evaluationType,
        ),
        metricDisplayName: "(current_replicas / max_replicas) * 100",
        unit: "%",
      }),
    ).toBe(
      "(current_replicas / max_replicas) * 100 was 100.00% in all 5 readings, at or above the 90.00% threshold.",
    );
  });

  test("summarizes the repeated healthy readings from the evaluation screenshot", () => {
    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [100 / 3, 100 / 3, 100 / 3, 100 / 3, 100 / 3],
        threshold: 81,
        criteriaFilter: metricFilter(
          FilterType.LessThan,
          EvaluateOverTimeType.AllValues,
        ),
        metricDisplayName: "(current_replicas / max_replicas) * 100",
        unit: "%",
      }),
    ).toBe(
      "(current_replicas / max_replicas) * 100 was 33.33% in all 5 readings, below the 81.00% threshold.",
    );
  });

  test("uses singular grammar for a one-reading window", () => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [100],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AllValues,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe("CPU was 100.00% in 1 reading, above the 90.00% threshold.");
  });

  test("summarizes a varied window in numeric order without mutating it", () => {
    const values: Array<number> = [97, 95, 96];
    const original: Array<number> = [...values];

    expect(
      CompareCriteria.getCompareMessage({
        values,
        threshold: 90,
        criteriaFilter: metricFilter(FilterType.GreaterThan),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      "CPU ranged from 95.00% to 97.00% across all 3 readings, above the 90.00% threshold.",
    );
    expect(values).toEqual(original);
  });

  test("a recovery range excludes readings that do not satisfy the condition", () => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [95, 80, 70],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.LessThanOrEqualTo,
          EvaluateOverTimeType.AnyValue,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      "CPU ranged from 70.00% to 80.00% across 2 of 3 readings, at or below the 90.00% threshold.",
    );
  });

  test("handles zero and negative readings without losing the sign or count", () => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [-2.125, 0, -1],
        threshold: 0,
        criteriaFilter: metricFilter(
          FilterType.LessThanOrEqualTo,
          EvaluateOverTimeType.AllValues,
        ),
        metricDisplayName: "Temperature",
      }),
    ).toBe(
      "Temperature ranged from -2.13 to 0 across all 3 readings, at or below the 0 threshold.",
    );
  });

  test("keeps a large evaluation window concise", () => {
    const values: Array<number> = Array.from({ length: 10000 }, (_, index) => {
      return index + 1;
    });

    expect(
      CompareCriteria.getCompareMessage({
        values,
        threshold: 0,
        criteriaFilter: metricFilter(FilterType.GreaterThan),
        metricDisplayName: "Queue length",
      }),
    ).toBe(
      "Queue length ranged from 1 to 10000 across all 10000 readings, above the 0 threshold.",
    );
  });

  test.each([
    { evaluationType: EvaluateOverTimeType.Average, name: "average", value: 20 },
    { evaluationType: EvaluateOverTimeType.Sum, name: "sum", value: 60 },
    {
      evaluationType: EvaluateOverTimeType.MaximumValue,
      name: "maximum",
      value: 30,
    },
    {
      evaluationType: EvaluateOverTimeType.MunimumValue,
      name: "minimum",
      value: 10,
    },
  ])("reports the $name without treating it as one matching sample", ({
    evaluationType,
    name,
    value,
  }) => {
    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [10, 20, 30],
        threshold: 5,
        criteriaFilter: metricFilter(FilterType.GreaterThan, evaluationType),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      `The ${name} of CPU was ${value.toFixed(2)}%, above the 5.00% threshold.`,
    );
  });

  test("uses the same evaluation mode as the comparator when both options are saved", () => {
    const filter: CriteriaFilter = metricFilter(
      FilterType.GreaterThan,
      EvaluateOverTimeType.AllValues,
    );
    filter.evaluateOverTimeOptions = {
      evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
      timeValueInMinutes: 5,
    };

    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [10, 95],
        threshold: 90,
        criteriaFilter: filter,
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe("CPU was 95.00% in 1 of 2 readings, above the 90.00% threshold.");
  });

  test.each([
    { minutes: 1, duration: "1 minute" },
    { minutes: 5, duration: "5 minutes" },
  ])("uses natural duration grammar for $duration", ({ minutes, duration }) => {
    const filter: CriteriaFilter = metricFilter(
      FilterType.GreaterThan,
      EvaluateOverTimeType.Average,
    );
    filter.evaluateOverTime = true;
    filter.evaluateOverTimeOptions = {
      evaluateOverTimeType: EvaluateOverTimeType.Average,
      timeValueInMinutes: minutes,
    };

    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [10, 20, 30],
        threshold: 15,
        criteriaFilter: filter,
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      `The average of CPU over the last ${duration} was 20.00%, above the 15.00% threshold.`,
    );
  });

  test.each([
    {
      evaluationType: EvaluateOverTimeType.AnyValue,
      requirement: "at least one reading",
    },
    {
      evaluationType: EvaluateOverTimeType.AllValues,
      requirement: "every reading",
    },
    { evaluationType: undefined, requirement: "every reading" },
  ])("does not claim an unmet $evaluationType condition was satisfied", ({
    evaluationType,
    requirement,
  }) => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [70, 80],
        threshold: 90,
        criteriaFilter: metricFilter(FilterType.GreaterThan, evaluationType),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      `CPU ranged from 70.00% to 80.00% across all 2 readings. The condition requires ${requirement} to be above the 90.00% threshold.`,
    );
  });

  test("an unmet average condition still reports the actual average", () => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [10, 20, 30],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.Average,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      "The average of CPU was 20.00%. The condition requires the average to be above the 90.00% threshold.",
    );
  });

  test("a partly matching AllValues window reports its whole range and unmet requirement", () => {
    expect(
      CompareCriteria.getCompareMessage({
        values: [100, 80],
        threshold: 90,
        criteriaFilter: metricFilter(
          FilterType.GreaterThan,
          EvaluateOverTimeType.AllValues,
        ),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBe(
      "CPU ranged from 80.00% to 100.00% across all 2 readings. The condition requires every reading to be above the 90.00% threshold.",
    );
  });

  test("preserves disk and time context in the same observation", () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.DiskUsagePercent,
      filterType: FilterType.GreaterThan,
      value: 90,
      serverMonitorOptions: { diskPath: "/var/log" },
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        timeValueInMinutes: 1,
      },
    };

    expect(
      CompareCriteria.getCompareMessage({
        values: [95, 95],
        threshold: 90,
        criteriaFilter: filter,
      }),
    ).toBe(
      "Disk Usage (in %) on disk /var/log over the last 1 minute was 95 in all 2 readings, above the 90 threshold.",
    );
  });

  test.each([NaN, Infinity, -Infinity])("a non-finite reading (%s) is not summarized as a numeric range", (value) => {
    const message: string = CompareCriteria.getCompareMessage({
      values: [95, value],
      threshold: 90,
      criteriaFilter: metricFilter(FilterType.GreaterThan),
      metricDisplayName: "CPU",
      unit: "%",
    });

    expect(message).toContain(String(value));
    expect(message).not.toContain("ranged from");
    expect(message).not.toContain("readings");
  });

  test.each([
    EvaluateOverTimeType.AnyValue,
    EvaluateOverTimeType.AllValues,
    EvaluateOverTimeType.Average,
    EvaluateOverTimeType.Sum,
    EvaluateOverTimeType.MaximumValue,
    EvaluateOverTimeType.MunimumValue,
  ])("an empty %s window still produces no root cause", (evaluationType) => {
    expect(
      CompareCriteria.compareCriteriaNumbers({
        value: [],
        threshold: 90,
        criteriaFilter: metricFilter(FilterType.GreaterThan, evaluationType),
        metricDisplayName: "CPU",
        unit: "%",
      }),
    ).toBeNull();
  });
});
