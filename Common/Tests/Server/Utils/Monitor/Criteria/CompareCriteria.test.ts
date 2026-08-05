import CompareCriteria from "../../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";

/*
 * CompareCriteria is the pure comparison engine that decides whether a
 * monitored value breaches a criterion and, if so, builds the human-readable
 * root-cause message. It is exercised indirectly by every monitor-criteria
 * evaluator, but had no direct unit test — so the AnyValue/AllValues array
 * semantics, the number/string/boolean coercion rules, and the message
 * formatting are pinned down here.
 */

/**
 * Build a minimal CriteriaFilter for the numeric/string comparison helpers.
 */
function makeFilter(overrides: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: undefined,
    ...overrides,
  };
}

describe("CompareCriteria", () => {
  describe("greaterThan", () => {
    test("compares a scalar against the threshold", () => {
      expect(CompareCriteria.greaterThan({ value: 10, threshold: 5 })).toBe(
        true,
      );
      expect(CompareCriteria.greaterThan({ value: 5, threshold: 5 })).toBe(
        false,
      );
      expect(CompareCriteria.greaterThan({ value: 1, threshold: 5 })).toBe(
        false,
      );
    });

    test("AnyValue passes when at least one array element exceeds the threshold", () => {
      expect(
        CompareCriteria.greaterThan({
          value: [1, 2, 9],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);

      expect(
        CompareCriteria.greaterThan({
          value: [1, 2, 3],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(false);
    });

    test("AllValues (and an unspecified evaluation type) require every element to exceed the threshold", () => {
      expect(
        CompareCriteria.greaterThan({
          value: [6, 7, 8],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(true);

      expect(
        CompareCriteria.greaterThan({
          value: [6, 7, 4],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(false);

      // No evaluationType provided defaults to the "every" branch.
      expect(
        CompareCriteria.greaterThan({ value: [6, 7, 8], threshold: 5 }),
      ).toBe(true);
      expect(
        CompareCriteria.greaterThan({ value: [6, 7, 4], threshold: 5 }),
      ).toBe(false);
    });
  });

  describe("lessThan", () => {
    test("scalar comparison", () => {
      expect(CompareCriteria.lessThan({ value: 3, threshold: 5 })).toBe(true);
      expect(CompareCriteria.lessThan({ value: 5, threshold: 5 })).toBe(false);
    });

    test("AnyValue vs AllValues array semantics", () => {
      expect(
        CompareCriteria.lessThan({
          value: [9, 9, 1],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.lessThan({
          value: [9, 9, 1],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(false);
    });
  });

  describe("greaterThanOrEqual / lessThanOrEqual", () => {
    test("boundary values are inclusive", () => {
      expect(
        CompareCriteria.greaterThanOrEqual({ value: 5, threshold: 5 }),
      ).toBe(true);
      expect(CompareCriteria.lessThanOrEqual({ value: 5, threshold: 5 })).toBe(
        true,
      );
      expect(
        CompareCriteria.greaterThanOrEqual({ value: 4, threshold: 5 }),
      ).toBe(false);
      expect(CompareCriteria.lessThanOrEqual({ value: 6, threshold: 5 })).toBe(
        false,
      );
    });

    test("AnyValue arrays", () => {
      expect(
        CompareCriteria.greaterThanOrEqual({
          value: [1, 5],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.lessThanOrEqual({
          value: [5, 9],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
    });
  });

  describe("equalTo / notEqualTo", () => {
    test("scalar equality", () => {
      expect(CompareCriteria.equalTo({ value: 5, threshold: 5 })).toBe(true);
      expect(CompareCriteria.equalTo({ value: 4, threshold: 5 })).toBe(false);
      expect(CompareCriteria.notEqualTo({ value: 4, threshold: 5 })).toBe(true);
      expect(CompareCriteria.notEqualTo({ value: 5, threshold: 5 })).toBe(
        false,
      );
    });

    test("equalTo with AllValues requires every element to match", () => {
      expect(
        CompareCriteria.equalTo({
          value: [5, 5, 5],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.equalTo({
          value: [5, 5, 6],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(false);
    });

    test("notEqualTo with AnyValue passes when any element differs", () => {
      expect(
        CompareCriteria.notEqualTo({
          value: [5, 5, 6],
          threshold: 5,
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
    });
  });

  describe("isTrue / isFalse", () => {
    test("scalar booleans", () => {
      expect(CompareCriteria.isTrue({ value: true })).toBe(true);
      expect(CompareCriteria.isTrue({ value: false })).toBe(false);
      expect(CompareCriteria.isFalse({ value: false })).toBe(true);
      expect(CompareCriteria.isFalse({ value: true })).toBe(false);
    });

    test("array semantics for isTrue", () => {
      expect(
        CompareCriteria.isTrue({
          value: [true, false],
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.isTrue({
          value: [true, false],
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(false);
      expect(
        CompareCriteria.isTrue({
          value: [true, true],
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(true);
    });

    test("array semantics for isFalse", () => {
      expect(
        CompareCriteria.isFalse({
          value: [false, true],
          evaluationType: EvaluateOverTimeType.AnyValue,
        }),
      ).toBe(true);
      expect(
        CompareCriteria.isFalse({
          value: [false, false],
          evaluationType: EvaluateOverTimeType.AllValues,
        }),
      ).toBe(true);
    });
  });

  describe("convertToNumber", () => {
    test("passes numbers through unchanged", () => {
      expect(CompareCriteria.convertToNumber(42)).toBe(42);
      expect(CompareCriteria.convertToNumber(0)).toBe(0);
      expect(CompareCriteria.convertToNumber(-3.5)).toBe(-3.5);
    });

    test("parses integer-ish strings (parseInt semantics)", () => {
      expect(CompareCriteria.convertToNumber("42")).toBe(42);
      // parseInt stops at the first non-numeric char.
      expect(CompareCriteria.convertToNumber("42.9")).toBe(42);
      expect(CompareCriteria.convertToNumber("10px")).toBe(10);
      expect(CompareCriteria.convertToNumber("  7  ")).toBe(7);
    });

    test("returns null for undefined", () => {
      expect(CompareCriteria.convertToNumber(undefined)).toBeNull();
    });

    test("returns null (not NaN) for an unparseable string", () => {
      /*
       * Regression guard: callers only check `=== null`; a leaked NaN would
       * make every downstream numeric comparison silently false.
       */
      expect(CompareCriteria.convertToNumber("abc")).toBeNull();
      expect(CompareCriteria.convertToNumber("")).toBeNull();
    });
  });

  describe("checkEqualToOrNotEqualTo", () => {
    test("EqualTo returns a message only when the values match", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.EqualTo,
      });

      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 200,
          threshold: 200,
          criteriaFilter: filter,
        }),
      ).toBe("Response Status Code is equal to 200.");

      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 200,
          threshold: 500,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("uses strict equality, so number and string forms differ", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.EqualTo,
      });
      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 200,
          threshold: "200",
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("NotEqualTo returns a message only when the values differ", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.NotEqualTo,
      });

      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 200,
          threshold: 500,
          criteriaFilter: filter,
        }),
      ).toBe("Response Status Code is not equal to 500.");

      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 200,
          threshold: 200,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("returns null for an unrelated filter type", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.checkEqualToOrNotEqualTo({
          value: 1,
          threshold: 1,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });
  });

  describe("compareEmptyAndNotEmpty", () => {
    test("IsEmpty matches null and undefined only", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.IsEmpty,
      });

      expect(
        CompareCriteria.compareEmptyAndNotEmpty({
          value: null,
          criteriaFilter: filter,
        }),
      ).toBe("Response Body is empty.");
      expect(
        CompareCriteria.compareEmptyAndNotEmpty({
          value: undefined,
          criteriaFilter: filter,
        }),
      ).toBe("Response Body is empty.");
      expect(
        CompareCriteria.compareEmptyAndNotEmpty({
          value: "something",
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("IsNotEmpty reports the value and truncates very long values", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.IsNotEmpty,
      });

      expect(
        CompareCriteria.compareEmptyAndNotEmpty({
          value: "hello",
          criteriaFilter: filter,
        }),
      ).toBe("Response Body is not empty. Value: hello");

      const longValue: string = "a".repeat(600);
      const message: string | null = CompareCriteria.compareEmptyAndNotEmpty({
        value: longValue,
        criteriaFilter: filter,
      });
      expect(message).toBe(
        `Response Body is not empty. Value: ${"a".repeat(500)}...`,
      );

      expect(
        CompareCriteria.compareEmptyAndNotEmpty({
          value: null,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });
  });

  describe("compareCriteriaStrings", () => {
    test("Contains / NotContains", () => {
      const contains: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.Contains,
      });
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "the quick brown fox",
          threshold: "quick",
          criteriaFilter: contains,
        }),
      ).toContain("contains");
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "the quick brown fox",
          threshold: "slow",
          criteriaFilter: contains,
        }),
      ).toBeNull();

      const notContains: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.NotContains,
      });
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "the quick brown fox",
          threshold: "slow",
          criteriaFilter: notContains,
        }),
      ).toContain("does not contain");
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "the quick brown fox",
          threshold: "quick",
          criteriaFilter: notContains,
        }),
      ).toBeNull();
    });

    test("StartsWith / EndsWith", () => {
      const startsWith: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.StartsWith,
      });
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "error: boom",
          threshold: "error",
          criteriaFilter: startsWith,
        }),
      ).toContain("starts with");
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "error: boom",
          threshold: "boom",
          criteriaFilter: startsWith,
        }),
      ).toBeNull();

      const endsWith: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.EndsWith,
      });
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "error: boom",
          threshold: "boom",
          criteriaFilter: endsWith,
        }),
      ).toContain("ends with");
    });

    test("coerces non-string values before comparing", () => {
      const contains: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.Contains,
      });
      // 404 is coerced to "404" which includes "40".
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: 404 as unknown as string,
          threshold: "40" as unknown as string,
          criteriaFilter: contains,
        }),
      ).toContain("contains");
    });

    test("returns null when the value or threshold is missing", () => {
      const contains: CriteriaFilter = makeFilter({
        filterType: FilterType.Contains,
      });
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: null as unknown as string,
          threshold: "x",
          criteriaFilter: contains,
        }),
      ).toBeNull();
      expect(
        CompareCriteria.compareCriteriaStrings({
          value: "x",
          threshold: null as unknown as string,
          criteriaFilter: contains,
        }),
      ).toBeNull();
    });
  });

  describe("compareCriteriaBoolean", () => {
    test("True fires only for a true value", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
      });
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: true,
          criteriaFilter: filter,
        }),
      ).toBe("Is Online is true.");
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: false,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("False fires only for a false value", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
      });
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: false,
          criteriaFilter: filter,
        }),
      ).toBe("Is Online is false.");
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: true,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("null/undefined value never fires", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
      });
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: null as unknown as boolean,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("honors AnyValue array evaluation", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        },
      });
      expect(
        CompareCriteria.compareCriteriaBoolean({
          value: [false, true],
          criteriaFilter: filter,
        }),
      ).not.toBeNull();
    });
  });

  describe("compareCriteriaNumbers", () => {
    test("GreaterThan fires and returns a descriptive message", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: 100,
          threshold: 50,
          criteriaFilter: filter,
        }),
      ).toBe("Response Time (in ms) is 100 which is greater than 50.");
    });

    test("does not fire when the threshold is not breached", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: 10,
          threshold: 50,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });

    test("each numeric filter type is wired to the right comparator", () => {
      const cases: Array<{
        filterType: FilterType;
        value: number;
        threshold: number;
        fires: boolean;
      }> = [
        {
          filterType: FilterType.LessThan,
          value: 1,
          threshold: 5,
          fires: true,
        },
        {
          filterType: FilterType.LessThan,
          value: 9,
          threshold: 5,
          fires: false,
        },
        { filterType: FilterType.EqualTo, value: 5, threshold: 5, fires: true },
        {
          filterType: FilterType.NotEqualTo,
          value: 4,
          threshold: 5,
          fires: true,
        },
        {
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 5,
          threshold: 5,
          fires: true,
        },
        {
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
          threshold: 5,
          fires: true,
        },
      ];

      for (const c of cases) {
        const filter: CriteriaFilter = makeFilter({
          checkOn: CheckOn.ResponseTime,
          filterType: c.filterType,
        });
        const result: string | null = CompareCriteria.compareCriteriaNumbers({
          value: c.value,
          threshold: c.threshold,
          criteriaFilter: filter,
        });
        if (c.fires) {
          expect(result).not.toBeNull();
        } else {
          expect(result).toBeNull();
        }
      }
    });

    test("returns null when value or threshold is missing", () => {
      const filter: CriteriaFilter = makeFilter({
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: null as unknown as number,
          threshold: 5,
          criteriaFilter: filter,
        }),
      ).toBeNull();
      expect(
        CompareCriteria.compareCriteriaNumbers({
          value: 5,
          threshold: null as unknown as number,
          criteriaFilter: filter,
        }),
      ).toBeNull();
    });
  });

  describe("getCompareMessage formatting", () => {
    test("prefixes 'Any value of' / 'All values of' for over-time evaluation", () => {
      const anyFilter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        evaluateOverTimeOptions: {
          timeValueInMinutes: undefined,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        },
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: [10, 20],
          threshold: 5,
          criteriaFilter: anyFilter,
        }),
      ).toBe(
        "Any value of Response Time (in ms) is 10, 20 which is greater than 5.",
      );

      const allFilter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        evaluateOverTimeOptions: {
          timeValueInMinutes: undefined,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: [10, 20],
          threshold: 5,
          criteriaFilter: allFilter,
        }),
      ).toBe(
        "All values of Response Time (in ms) is 10, 20 which is greater than 5.",
      );
    });

    test("summarizes more than five numeric samples as a range", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: [1, 2, 3, 4, 5, 6],
          threshold: 0,
          criteriaFilter: filter,
        }),
      ).toBe(
        "Response Time (in ms) is 6 samples between 1 and 6 which is greater than 0.",
      );
    });

    test("truncates a long non-numeric value list", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.GreaterThan,
      });
      // A boolean in the array makes it "not all numeric" -> truncated list.
      const message: string = CompareCriteria.getCompareMessage({
        values: [1, 2, 3, 4, 5, true] as Array<number | boolean>,
        threshold: 0,
        criteriaFilter: filter,
      });
      expect(message).toContain("1, 2, 3, 4, 5, … (6 values total)");
    });

    test("rounds non-integer values to two decimals", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 12.3456,
          threshold: 1.9999,
          criteriaFilter: filter,
        }),
      ).toBe("Response Time (in ms) is 12.35 which is greater than 2.");
    });

    test("appends a unit suffix to both the value and the threshold", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 100,
          threshold: 50,
          criteriaFilter: filter,
          unit: "ms",
        }),
      ).toBe("Metric Value is 100 ms which is greater than 50 ms.");
    });

    test("includes the disk path for disk usage checks", () => {
      const withPath: CriteriaFilter = makeFilter({
        checkOn: CheckOn.DiskUsagePercent,
        filterType: FilterType.GreaterThan,
        serverMonitorOptions: { diskPath: "/var" },
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 95,
          threshold: 80,
          criteriaFilter: withPath,
        }),
      ).toBe("Disk Usage (in %) on disk /var is 95 which is greater than 80.");

      const withoutPath: CriteriaFilter = makeFilter({
        checkOn: CheckOn.DiskUsagePercent,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 95,
          threshold: 80,
          criteriaFilter: withoutPath,
        }),
      ).toContain("on disk /");
    });

    test("mentions the evaluation window when evaluateOverTime is set", () => {
      const filter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.CPUUsagePercent,
        filterType: FilterType.GreaterThan,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 90,
          threshold: 70,
          criteriaFilter: filter,
        }),
      ).toContain("over the last 5 minutes");
    });

    test("uses the metric display name only for MetricValue checks", () => {
      const metricFilter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 100,
          threshold: 50,
          criteriaFilter: metricFilter,
          metricDisplayName: "http.server.duration",
        }),
      ).toBe("http.server.duration is 100 which is greater than 50.");

      // For a non-MetricValue check the display name is ignored.
      const responseFilter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: 100,
          threshold: 50,
          criteriaFilter: responseFilter,
          metricDisplayName: "http.server.duration",
        }),
      ).toBe("Response Time (in ms) is 100 which is greater than 50.");
    });

    test("True/False messages omit the 'which is' clause", () => {
      const trueFilter: CriteriaFilter = makeFilter({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
      });
      expect(
        CompareCriteria.getCompareMessage({
          values: true,
          threshold: true,
          criteriaFilter: trueFilter,
        }),
      ).toBe("Is Online is true.");
    });

    test("renders each comparison verb", () => {
      const verbs: Array<{ filterType: FilterType; verb: string }> = [
        { filterType: FilterType.GreaterThan, verb: "greater than" },
        {
          filterType: FilterType.GreaterThanOrEqualTo,
          verb: "greater than or equal to",
        },
        { filterType: FilterType.LessThan, verb: "less than" },
        {
          filterType: FilterType.LessThanOrEqualTo,
          verb: "less than or equal to",
        },
        { filterType: FilterType.EqualTo, verb: "equal to" },
        { filterType: FilterType.NotEqualTo, verb: "not equal to" },
      ];

      for (const { filterType, verb } of verbs) {
        const filter: CriteriaFilter = makeFilter({
          checkOn: CheckOn.ResponseTime,
          filterType,
        });
        expect(
          CompareCriteria.getCompareMessage({
            values: 100,
            threshold: 50,
            criteriaFilter: filter,
          }),
        ).toContain(verb);
      }
    });
  });
});
