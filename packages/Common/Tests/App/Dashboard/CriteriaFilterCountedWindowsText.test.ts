import CriteriaFilterUtil, {
  COUNTED_WINDOW_FIELDS,
  EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS,
  describePercentile,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaRecoveryFilters, {
  DEFAULT_RECOVERY_WINDOW_IN_MINUTES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaRecoveryFilters";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * The Dashboard's side of #10355: how a window that counts its checks, or
 * reads a percentile, says itself in the criteria list and under the form's
 * window, which choices the form offers, and the recovery condition a
 * criteria starts with.
 */

const IS_ONLINE_FALSE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
};

const SLOW: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 300,
};

const BODY: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.NotContains,
  value: "App Title",
};

function windowOf(
  criteriaFilter: CriteriaFilter,
  options: Partial<EvaluateOverTimeOptions>,
): CriteriaFilter {
  return {
    ...criteriaFilter,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      ...options,
    },
  };
}

function labelsOf(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return option.label;
  });
}

describe("the criteria list, for a window that counts its checks", () => {
  test("Count says how many checks, over hours when the window is whole hours", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(IS_ONLINE_FALSE, {
          timeValueInMinutes: 480,
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countFilterType: FilterType.GreaterThan,
          countValue: 30,
        }),
        MonitorType.Ping,
      ),
    ).toBe(
      'Check if "Is Online" is false on more than 30 checks in the past 8\u00A0hours',
    );
  });

  test("a single check, and a window in minutes, read in the singular and in minutes", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(SLOW, {
          timeValueInMinutes: 15,
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countFilterType: FilterType.GreaterThanOrEqualTo,
          countValue: 1,
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Check if "Response Time (in ms)" is greater than 300\u00A0ms on at least 1 check in the past 15\u00A0minutes',
    );
  });

  test("Percentage says what share of the checks", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(BODY, {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.Percentage,
          countFilterType: FilterType.GreaterThan,
          countValue: 10,
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Check if "Response Body" does not contain "App Title" on more than 10% of the checks in the past 1\u00A0hour',
    );
  });

  test("Status Changes on a yes or no check says how often the check changed", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(IS_ONLINE_FALSE, {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
          countFilterType: FilterType.GreaterThan,
          countValue: 5,
        }),
        MonitorType.Ping,
      ),
    ).toBe(
      'Check if "Is Online" changed more than 5 times in the past 1\u00A0hour',
    );
  });

  test("Status Changes on any other condition says how often the checks went between matching it and not", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(SLOW, {
          timeValueInMinutes: 30,
          evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
          countFilterType: FilterType.LessThanOrEqualTo,
          countValue: 1,
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Check if the checks changed at most 1 time between matching and not in the past 30\u00A0minutes: "Response Time (in ms)" is greater than 300\u00A0ms',
    );
  });

  test("a count saved through the API without its comparison reads as more than 0", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(IS_ONLINE_FALSE, {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.Count,
        }),
        MonitorType.Ping,
      ),
    ).toBe(
      'Check if "Is Online" is false on more than 0 checks in the past 10\u00A0minutes',
    );
  });

  test("a counted window is not said as every or any check", () => {
    expect(
      CriteriaFilterUtil.getCheckByCheckWindow(
        windowOf(BODY, {
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countValue: 3,
        }),
        MonitorType.Website,
      ),
    ).toBeNull();
  });
});

describe("the criteria list, for a percentile", () => {
  test("p95 reads as monitoring tools write it, around what is measured", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(SLOW, {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.Percentile,
          percentile: 95,
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Check if p95 of "Response Time (in ms)" in the past 10\u00A0minutes is greater than 300\u00A0ms',
    );
  });

  test("a percentile saved without its number reads as p95, the default", () => {
    expect(
      CriteriaFilterUtil.translateFilterToText(
        windowOf(SLOW, {
          evaluateOverTimeType: EvaluateOverTimeType.Percentile,
        }),
        MonitorType.Website,
      ),
    ).toContain("p95 of");
  });

  test("a percentile is written with one decimal at most", () => {
    expect(describePercentile(99)).toBe("99");
    expect(describePercentile(99.9)).toBe("99.9");
    expect(describePercentile(99.95)).toBe("100");
    expect(describePercentile(12.345)).toBe("12.3");
  });
});

describe("the form's choices", () => {
  test("a numeric filter is offered the aggregates, a percentile, every check and the counts", () => {
    expect(
      labelsOf(
        CriteriaFilterUtil.getEvaluateOverTimeTypeOptions(
          SLOW,
          MonitorType.Website,
        ),
      ),
    ).toEqual([
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.Percentile,
      EvaluateOverTimeType.AllValues,
      EvaluateOverTimeType.AnyValue,
      EvaluateOverTimeType.Count,
      EvaluateOverTimeType.Percentage,
      EvaluateOverTimeType.StatusChanges,
    ]);
  });

  test("a check-by-check filter is offered no aggregate and no percentile", () => {
    expect(
      labelsOf(
        CriteriaFilterUtil.getEvaluateOverTimeTypeOptions(
          BODY,
          MonitorType.Website,
        ),
      ),
    ).toEqual([
      EvaluateOverTimeType.AllValues,
      EvaluateOverTimeType.AnyValue,
      EvaluateOverTimeType.Count,
      EvaluateOverTimeType.Percentage,
      EvaluateOverTimeType.StatusChanges,
    ]);
  });

  test("a Server monitor's Is Online is not counted: it is the time since the server last reported", () => {
    expect(
      labelsOf(
        CriteriaFilterUtil.getEvaluateOverTimeTypeOptions(
          IS_ONLINE_FALSE,
          MonitorType.Server,
        ),
      ),
    ).not.toContain(EvaluateOverTimeType.Count);
  });

  test("only the types that came with #10355 say what they do under their names", () => {
    const described: Array<string> = CriteriaFilterUtil.getEvaluateOverTimeTypeOptions(
      SLOW,
      MonitorType.Website,
    )
      .filter((option: DropdownOption): boolean => {
        return Boolean(option.description);
      })
      .map((option: DropdownOption): string => {
        return option.label;
      });

    expect(described).toEqual([
      EvaluateOverTimeType.Percentile,
      EvaluateOverTimeType.Count,
      EvaluateOverTimeType.Percentage,
      EvaluateOverTimeType.StatusChanges,
    ]);
    expect(Object.keys(EVALUATE_OVER_TIME_TYPE_DESCRIPTIONS).sort()).toEqual(
      [...described].sort(),
    );
  });

  test("each count names its number, and the word after it", () => {
    expect(COUNTED_WINDOW_FIELDS[EvaluateOverTimeType.Count]?.title).toBe(
      "Checks That Match",
    );
    expect(COUNTED_WINDOW_FIELDS[EvaluateOverTimeType.Percentage]?.unit).toBe(
      "%",
    );
    expect(
      COUNTED_WINDOW_FIELDS[EvaluateOverTimeType.StatusChanges]?.title,
    ).toBe("Times It Changed");
  });

  test("a count is compared by the six comparisons a number is, by their names", () => {
    expect(labelsOf(CriteriaFilterUtil.getCountComparisonOptions())).toEqual([
      FilterType.GreaterThan,
      FilterType.GreaterThanOrEqualTo,
      FilterType.LessThan,
      FilterType.LessThanOrEqualTo,
      FilterType.EqualTo,
      FilterType.NotEqualTo,
    ]);
  });

  test("the percentiles start at the default, p95, written the same in every language", () => {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getPercentileOptions();

    expect(labelsOf(options)).toEqual(["p95", "p50", "p90", "p99"]);
    expect(
      options.every((option: DropdownOption): boolean => {
        return option.isUserContent === true;
      }),
    ).toBe(true);
  });

  test("For the last reaches 24 hours, naming whole hours in hours", () => {
    const labels: Array<string> = labelsOf(
      CriteriaFilterUtil.getEvaluateOverTimeMinutesOptions(),
    );

    expect(labels[0]).toBe("2 Minutes");
    expect(labels).toContain("60 Minutes");
    expect(labels).toContain("8 Hours");
    expect(labels[labels.length - 1]).toBe("24 Hours");
    expect(labels.join(" ")).not.toContain("480");
  });
});

describe("picking a window type", () => {
  test("a count starts as more than 0, and keeps the window and If No Data", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: windowOf(IS_ONLINE_FALSE, {
          timeValueInMinutes: 60,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
        evaluateOverTimeType: EvaluateOverTimeType.Count,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 60,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      onNoDataPolicy: NoDataPolicy.Trigger,
      countFilterType: FilterType.GreaterThan,
      countValue: 0,
    });
  });

  test("moving between counts keeps the comparison, and a share stays at most 100", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: windowOf(IS_ONLINE_FALSE, {
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countFilterType: FilterType.GreaterThanOrEqualTo,
          countValue: 480,
        }),
        evaluateOverTimeType: EvaluateOverTimeType.Percentage,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.Percentage,
      countFilterType: FilterType.GreaterThanOrEqualTo,
      countValue: 100,
    });
  });

  test("leaving a count drops its number, and a percentile starts at p95", () => {
    const percentile: CriteriaFilter =
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: windowOf(SLOW, {
          evaluateOverTimeType: EvaluateOverTimeType.Count,
          countFilterType: FilterType.GreaterThan,
          countValue: 3,
        }),
        evaluateOverTimeType: EvaluateOverTimeType.Percentile,
      });

    expect(percentile.evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.Percentile,
      percentile: 95,
    });

    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: percentile,
        evaluateOverTimeType: EvaluateOverTimeType.Average,
      }).evaluateOverTimeOptions,
    ).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.Average,
    });
  });

  test("a number that is not one starts the count at 0", () => {
    expect(
      CriteriaFilterUtil.setEvaluateOverTimeType({
        criteriaFilter: windowOf(IS_ONLINE_FALSE, {
          countValue: Number.NaN,
        }),
        evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
      }).evaluateOverTimeOptions?.countValue,
    ).toBe(0);
  });
});

describe("the recovery condition a criteria starts with", () => {
  test("is each filter's opposite, over the last 10 minutes on every check", () => {
    expect(DEFAULT_RECOVERY_WINDOW_IN_MINUTES).toBe(10);

    expect(
      CriteriaRecoveryFilters.fromFilters({
        filters: [
          windowOf(IS_ONLINE_FALSE, {
            timeValueInMinutes: 60,
            evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
            countValue: 5,
          }),
          SLOW,
        ],
        monitorType: MonitorType.Website,
      }),
    ).toEqual([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      },
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.LessThanOrEqualTo,
        value: 300,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      },
    ]);
  });

  test("a filter offered no window recovers on a check that no longer matches it", () => {
    expect(
      CriteriaRecoveryFilters.fromFilters({
        filters: [
          {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.RecievedInMinutes,
            value: 5,
          },
        ],
        monitorType: MonitorType.IncomingRequest,
      })[0]?.evaluateOverTime,
    ).toBe(false);
  });

  test("a condition with no opposite stays as it is", () => {
    expect(
      CriteriaRecoveryFilters.getOpposite(FilterType.EvaluatesToTrue),
    ).toBe(FilterType.EvaluatesToTrue);
    expect(CriteriaRecoveryFilters.getOpposite(FilterType.Contains)).toBe(
      FilterType.NotContains,
    );
    expect(CriteriaRecoveryFilters.getOpposite(undefined)).toBeUndefined();
  });
});
