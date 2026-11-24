import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  DEFAULT_EVALUATE_OVER_TIME_PERCENTILE,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
  MAX_COUNTED_WINDOW_IN_MINUTES,
} from "../../../Types/Monitor/CriteriaFilter";
import CriteriaFilterValues from "../../../Types/Monitor/CriteriaFilterValues";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import MonitorStepsValuesUtil from "../../../Utils/Monitor/MonitorStepsValuesUtil";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The types behind #10355: windows that count their checks or read a
 * percentile, a criteria's own recovery condition and its active hours -
 * how each is read, written, offered and refused.
 */

function failedPings(
  options: Partial<CriteriaFilter["evaluateOverTimeOptions"]> = {},
): CriteriaFilter {
  return {
    checkOn: CheckOn.IsOnline,
    filterType: FilterType.False,
    value: undefined,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 480,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countFilterType: FilterType.GreaterThan,
      countValue: 30,
      ...options,
    },
  };
}

function criteriaWith(input: {
  filters?: Array<CriteriaFilter>;
  recoveryFilters?: Array<CriteriaFilter>;
  recoveryFilterCondition?: FilterCondition;
  activeHours?: JSONObject;
  activeHoursTimezone?: string;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "outage",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters || [failedPings()],
    incidents: [],
    alerts: [],
    name: "Access point is unstable",
    description: "",
    ...(input.recoveryFilters
      ? {
          recoveryFilters: input.recoveryFilters,
          recoveryFilterCondition: input.recoveryFilterCondition,
        }
      : {}),
    ...(input.activeHours
      ? {
          activeHours: input.activeHours,
          activeHoursTimezone: input.activeHoursTimezone,
        }
      : {}),
  };
  return instance;
}

function roundTrip(instance: MonitorCriteriaInstance): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.fromJSON(
    JSON.parse(JSON.stringify(instance.toJSON())) as JSONObject,
  );
}

describe("CriteriaFilterUtil: counted windows and percentiles", () => {
  test("Count, Percentage and Status Changes count checks; the aggregates and Percentile reduce values", () => {
    for (const type of [
      EvaluateOverTimeType.Count,
      EvaluateOverTimeType.Percentage,
      EvaluateOverTimeType.StatusChanges,
    ]) {
      expect(CriteriaFilterUtil.isCountedWindowType(type)).toBe(true);
      expect(CriteriaFilterUtil.isValueAggregateWindowType(type)).toBe(false);
    }

    for (const type of [
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.Percentile,
    ]) {
      expect(CriteriaFilterUtil.isCountedWindowType(type)).toBe(false);
      expect(CriteriaFilterUtil.isValueAggregateWindowType(type)).toBe(true);
    }

    expect(
      CriteriaFilterUtil.isCountedWindowType(EvaluateOverTimeType.AllValues),
    ).toBe(false);
    expect(CriteriaFilterUtil.isCountedWindowType(undefined)).toBe(false);
  });

  test.each([
    [CheckOn.IsOnline, MonitorType.Ping, true],
    [CheckOn.IsOnline, MonitorType.Website, true],
    [CheckOn.ResponseTime, MonitorType.API, true],
    [CheckOn.ResponseBody, MonitorType.Website, true],
    [CheckOn.IsRequestTimeout, MonitorType.Port, true],
    [CheckOn.SnmpIsOnline, MonitorType.NetworkDevice, true],
    [CheckOn.CPUUsagePercent, MonitorType.Server, true],
    [CheckOn.DiskUsagePercent, MonitorType.Server, true],
    // A server writes Is Online only when it reports: nothing failed to count.
    [CheckOn.IsOnline, MonitorType.Server, false],
    // What arrives rather than is checked has no checks at a cadence.
    [CheckOn.IsOnline, MonitorType.IncomingRequest, false],
    [CheckOn.EmailBody, MonitorType.IncomingEmail, false],
    // No series and no match history.
    [CheckOn.ResponseBody, MonitorType.SQLQuery, false],
    [CheckOn.IsValidCertificate, MonitorType.SSLCertificate, false],
  ] as const)(
    "%s on a %s monitor can be counted: %p",
    (checkOn: CheckOn, monitorType: MonitorType, canCount: boolean) => {
      expect(CriteriaFilterUtil.canCountChecks(checkOn, monitorType)).toBe(
        canCount,
      );
    },
  );

  test("a counted window is judged as one only with minutes, and on a check that can be counted", () => {
    expect(
      CriteriaFilterUtil.isCountedOverChecks(failedPings(), MonitorType.Ping),
    ).toBe(true);
    expect(
      CriteriaFilterUtil.isCountedOverChecks(
        failedPings({ timeValueInMinutes: undefined }),
        MonitorType.Ping,
      ),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.isCountedOverChecks(
        { ...failedPings(), evaluateOverTime: false },
        MonitorType.Ping,
      ),
    ).toBe(false);
    // On a server, Is Online cannot be counted: it is judged as All Values.
    expect(
      CriteriaFilterUtil.isCountedOverChecks(failedPings(), MonitorType.Server),
    ).toBe(false);
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        failedPings(),
        MonitorType.Server,
      ),
    ).toBe(EvaluateOverTimeType.AllValues);
  });

  test("a counted window on a yes or no check stays a count", () => {
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        failedPings({
          evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
        }),
        MonitorType.Ping,
      ),
    ).toBe(EvaluateOverTimeType.StatusChanges);
  });

  test("a Percentile on a yes or no check is judged as All Values, as any aggregate is", () => {
    expect(
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        failedPings({ evaluateOverTimeType: EvaluateOverTimeType.Percentile }),
        MonitorType.Ping,
      ),
    ).toBe(EvaluateOverTimeType.AllValues);
  });

  test("the percentile is its own when above 0 and below 100, else 95", () => {
    const withPercentile: (percentile: unknown) => number = (
      percentile: unknown,
    ): number => {
      return CriteriaFilterUtil.getPercentile(
        failedPings({ percentile: percentile as number }),
      );
    };

    expect(withPercentile(99)).toBe(99);
    expect(withPercentile(99.9)).toBe(99.9);
    expect(withPercentile(50)).toBe(50);
    expect(withPercentile(0)).toBe(DEFAULT_EVALUATE_OVER_TIME_PERCENTILE);
    expect(withPercentile(100)).toBe(DEFAULT_EVALUATE_OVER_TIME_PERCENTILE);
    expect(withPercentile(undefined)).toBe(95);
    expect(withPercentile("90")).toBe(90);
  });

  test("a count's comparison is its own, or more than 0", () => {
    expect(CriteriaFilterUtil.getCountComparison(failedPings())).toEqual({
      filterType: FilterType.GreaterThan,
      value: 30,
    });
    expect(
      CriteriaFilterUtil.getCountComparison(
        failedPings({ countFilterType: undefined, countValue: undefined }),
      ),
    ).toEqual({ filterType: FilterType.GreaterThan, value: 0 });
    // Not a comparison of numbers: read as more than.
    expect(
      CriteriaFilterUtil.getCountComparison(
        failedPings({ countFilterType: FilterType.Contains }),
      ).filterType,
    ).toBe(FilterType.GreaterThan);
  });

  test("windows reach 24 hours in the form, and a week through the API", () => {
    expect(Object.values(EvaluateOverTimeMinutes).map(Number)).toEqual([
      2, 3, 5, 10, 15, 20, 30, 45, 60, 120, 240, 360, 480, 720, 1440,
    ]);
    expect(MAX_COUNTED_WINDOW_IN_MINUTES).toBe(10080);
  });
});

describe("CriteriaFilterValues: the new window values written another way", () => {
  test.each([
    ["Count", EvaluateOverTimeType.Count],
    ["count", EvaluateOverTimeType.Count],
    ["PERCENTAGE", EvaluateOverTimeType.Percentage],
    ["percent", EvaluateOverTimeType.Percentage],
    ["status_changes", EvaluateOverTimeType.StatusChanges],
    ["flapping", EvaluateOverTimeType.StatusChanges],
    ["percentile", EvaluateOverTimeType.Percentile],
  ] as const)(
    "%p reads as %s",
    (written: string, read: EvaluateOverTimeType) => {
      expect(CriteriaFilterValues.readEvaluateOverTimeType(written)).toBe(read);
    },
  );

  test("a count's comparison is read like a condition: '>' is Greater Than", () => {
    const read: JSONObject = CriteriaFilterValues.readFilter({
      checkOn: "Is Online",
      filterType: "false",
      evaluateOverTimeOptions: {
        timeValueInMinutes: 480,
        evaluateOverTimeType: "count",
        countFilterType: ">",
        countValue: 30,
      },
    });

    expect(read["evaluateOverTimeOptions"]).toEqual({
      timeValueInMinutes: 480,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countFilterType: FilterType.GreaterThan,
      countValue: 30,
    });
  });

  test("a count and a percentile written as their digits are read as numbers, anything else as written", () => {
    const read: (options: JSONObject) => unknown = (
      options: JSONObject,
    ): unknown => {
      return CriteriaFilterValues.readFilter({
        checkOn: "Response Time (in ms)",
        filterType: "Greater Than",
        value: 300,
        evaluateOverTimeOptions: options,
      })["evaluateOverTimeOptions"];
    };

    expect(
      read({
        timeValueInMinutes: 60,
        evaluateOverTimeType: "Count",
        countValue: " 30 ",
      }),
    ).toEqual({
      timeValueInMinutes: 60,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countValue: 30,
    });
    expect(
      read({ evaluateOverTimeType: "Percentile", percentile: "99.5" }),
    ).toEqual({
      evaluateOverTimeType: EvaluateOverTimeType.Percentile,
      percentile: 99.5,
    });
    // Left for the window's own check to refuse.
    expect(read({ countValue: "lots", percentile: "-5" })).toEqual({
      countValue: "lots",
      percentile: "-5",
    });
    // The minutes keep the form they were saved in.
    expect(read({ timeValueInMinutes: "5" })).toEqual({
      timeValueInMinutes: "5",
    });
  });

  test("a count's comparison that means none is refused, naming where it is", () => {
    expect(
      CriteriaFilterValues.getUnreadableErrors({
        criteriaName: "Unstable",
        filterCondition: "All",
        filters: [
          {
            checkOn: "Is Online",
            filterType: "False",
            evaluateOverTimeOptions: { countFilterType: "lots" },
          },
        ],
      })[0],
    ).toMatch(
      /^Criteria "Unstable": filters\[0\]\.evaluateOverTimeOptions\.countFilterType "lots" is not a value OneUptime reads there\./,
    );
  });

  test("the recovery filters are named as recoveryFilters", () => {
    expect(
      CriteriaFilterValues.getUnreadableErrors({
        criteriaName: "Unstable",
        filterCondition: "Either",
        filters: [{ checkOn: "Is Onlin" }],
        filtersPath: "recoveryFilters",
        filterConditionPath: "recoveryFilterCondition",
      }),
    ).toEqual([
      expect.stringMatching(/recoveryFilterCondition "Either"/),
      expect.stringMatching(/recoveryFilters\[0\]\.checkOn "Is Onlin"/),
    ]);
  });
});

describe("MonitorCriteriaInstance: a recovery condition and active hours", () => {
  const RECOVERED: CriteriaFilter = {
    checkOn: CheckOn.IsOnline,
    filterType: FilterType.True,
    value: undefined,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 30,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    },
  };

  test("a criteria without either reads and writes as it always did", () => {
    const json: JSONObject = criteriaWith({}).toJSON();
    const value: JSONObject = json["value"] as JSONObject;

    expect(value).not.toHaveProperty("recoveryFilters");
    expect(value).not.toHaveProperty("recoveryFilterCondition");
    expect(value).not.toHaveProperty("activeHours");
    expect(value).not.toHaveProperty("activeHoursTimezone");
    expect(
      MonitorCriteriaInstance.hasRecoveryCondition(
        roundTrip(criteriaWith({})).data,
      ),
    ).toBe(false);
  });

  test("its recovery filters survive a round trip, read as filters are", () => {
    const read: MonitorCriteriaInstance = roundTrip(
      criteriaWith({
        recoveryFilters: [
          {
            ...RECOVERED,
            filterType: "true" as FilterType,
          },
        ],
        recoveryFilterCondition: "any" as FilterCondition,
      }),
    );

    expect(MonitorCriteriaInstance.hasRecoveryCondition(read.data)).toBe(true);
    expect(read.data?.recoveryFilters).toEqual([RECOVERED]);
    expect(read.data?.recoveryFilterCondition).toBe(FilterCondition.Any);
  });

  test("a recovery condition saved without its match condition is All", () => {
    const read: MonitorCriteriaInstance = roundTrip(
      criteriaWith({ recoveryFilters: [RECOVERED] }),
    );

    expect(read.data?.recoveryFilterCondition).toBe(FilterCondition.All);
  });

  test("an empty list, or one that is no list, is no recovery condition", () => {
    const json: JSONObject = criteriaWith({}).toJSON();
    (json["value"] as JSONObject)["recoveryFilters"] = "Is Online True";

    expect(
      MonitorCriteriaInstance.hasRecoveryCondition(
        MonitorCriteriaInstance.fromJSON(json).data,
      ),
    ).toBe(false);

    expect(
      MonitorCriteriaInstance.hasRecoveryCondition(
        criteriaWith({ recoveryFilters: [] }).data,
      ),
    ).toBe(false);
  });

  test("its recovery filters are checked as its filters are", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({
          recoveryFilters: [
            {
              checkOn: CheckOn.ResponseTime,
              filterType: undefined,
              value: 300,
            },
          ],
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Filter Condition is required for the recovery condition of criteria "Access point is unstable" on filter type: Response Time (in ms)',
    );

    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({
          recoveryFilters: [
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.LessThan,
              value: undefined,
            },
          ],
        }),
        MonitorType.Website,
      ),
    ).toBe(
      'Value is required for the recovery condition of criteria "Access point is unstable" on filter type: Response Time (in ms)',
    );

    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({ recoveryFilters: [RECOVERED] }),
        MonitorType.Ping,
      ),
    ).toBeNull();
  });

  test("active hours that never open are refused; ones that do are kept", () => {
    expect(
      MonitorCriteriaInstance.getValidationError(
        criteriaWith({
          activeHours: WorkingHours.fromSimpleHours({
            days: [],
            from: "08:00",
            to: "18:00",
            timezone: "Europe/Oslo",
          }).toJSON(),
          activeHoursTimezone: "Europe/Oslo",
        }),
        MonitorType.Ping,
      ),
    ).toMatch(/^Active hours of criteria "Access point is unstable": /);

    const kept: MonitorCriteriaInstance = roundTrip(
      criteriaWith({
        activeHours: WorkingHours.fromSimpleHours({
          days: [0, 1, 2, 3, 4],
          from: "08:00",
          to: "18:00",
          timezone: "Europe/Oslo",
        }).toJSON(),
        activeHoursTimezone: "Europe/Oslo",
      }),
    );

    expect(MonitorCriteriaInstance.hasActiveHours(kept.data)).toBe(true);
    expect(kept.data?.activeHoursTimezone).toBe("Europe/Oslo");
    expect(
      MonitorCriteriaInstance.getValidationError(kept, MonitorType.Ping),
    ).toBeNull();
  });
});

describe("MonitorCriteriaInstance.getWindowValidationError", () => {
  function windowError(filter: CriteriaFilter): string | null {
    return MonitorCriteriaInstance.getWindowValidationError({
      filter: filter,
      where: 'criteria "Unstable"',
      monitorType: MonitorType.Ping,
    });
  }

  test("a count over at most a week, compared with a number of 0 or more, is fine", () => {
    expect(windowError(failedPings())).toBeNull();
    expect(windowError(failedPings({ countValue: 0 }))).toBeNull();
    expect(
      windowError(
        failedPings({ timeValueInMinutes: MAX_COUNTED_WINDOW_IN_MINUTES }),
      ),
    ).toBeNull();
    // A count with no number reads as more than 0.
    expect(windowError(failedPings({ countValue: undefined }))).toBeNull();
    // A number the form saved as text.
    expect(windowError(failedPings({ countValue: "30" as never }))).toBeNull();
  });

  test.each([
    [{ countValue: -1 }, "needs a number to compare with, 0 or more."],
    [{ countValue: "many" }, "needs a number to compare with, 0 or more."],
    [
      { timeValueInMinutes: 10081 },
      "counts at most 10080\u00A0minutes (7\u00A0days) of checks.",
    ],
    [
      { timeValueInMinutes: 0 },
      "needs a window: how many minutes of checks to count.",
    ],
    [{ countFilterType: FilterType.Contains }, "is compared with Greater Than"],
  ] as const)(
    "%p is refused: %s",
    (options: Record<string, unknown>, error: string) => {
      expect(windowError(failedPings(options as never))).toContain(error);
    },
  );

  test("a share is at most 100%", () => {
    expect(
      windowError(
        failedPings({
          evaluateOverTimeType: EvaluateOverTimeType.Percentage,
          countValue: 101,
        }),
      ),
    ).toBe(
      'Percentage of criteria "Unstable" on filter type Is Online is a share of the checks, from 0 to 100.',
    );
    expect(
      windowError(
        failedPings({
          evaluateOverTimeType: EvaluateOverTimeType.Percentage,
          countValue: 100,
        }),
      ),
    ).toBeNull();
  });

  test("a percentile is above 0 and below 100", () => {
    const percentile: (value: number | undefined) => string | null = (
      value: number | undefined,
    ): string | null => {
      return windowError({
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 300,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.Percentile,
          percentile: value,
        },
      });
    };

    expect(percentile(95)).toBeNull();
    expect(percentile(undefined)).toBeNull();
    expect(percentile(100)).toContain("must be a number above 0 and below 100");
    expect(percentile(0)).toContain("must be a number above 0 and below 100");
  });

  test("a filter judged at once, or an older window type, says nothing", () => {
    expect(
      windowError({ ...failedPings(), evaluateOverTime: false }),
    ).toBeNull();
    expect(
      windowError(
        failedPings({ evaluateOverTimeType: EvaluateOverTimeType.AllValues }),
      ),
    ).toBeNull();
  });
});

describe("MonitorStepsValuesUtil: the server refuses what no check reads", () => {
  function stepsWith(criteria: MonitorCriteriaInstance): JSONObject {
    return {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: {
              id: ObjectID.generate().toString(),
              monitorDestination: "8.8.8.8",
              monitorCriteria: {
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: [criteria.toJSON()],
                },
              },
            },
          },
        ],
        defaultMonitorStatusId: ObjectID.generate().toString(),
      },
    };
  }

  test("a count compared with a negative number is refused on write", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Ping,
        monitorSteps: stepsWith(
          criteriaWith({ filters: [failedPings({ countValue: -5 })] }),
        ),
      }),
    ).toContain("needs a number to compare with, 0 or more.");
  });

  test("a recovery filter with a condition that means none is refused on write", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Ping,
        monitorSteps: stepsWith(
          criteriaWith({
            recoveryFilters: [
              {
                checkOn: CheckOn.IsOnline,
                filterType: "kinda" as FilterType,
                value: undefined,
              },
            ],
          }),
        ),
      }),
    ).toMatch(/recoveryFilters\[0\]\.filterType "kinda"/);
  });

  test("active hours in a zone nobody knows are refused on write", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Ping,
        monitorSteps: stepsWith(
          criteriaWith({
            activeHours: WorkingHours.fromSimpleHours({
              days: [0, 1, 2, 3, 4],
              from: "08:00",
              to: "18:00",
              timezone: "UTC",
            }).toJSON(),
            activeHoursTimezone: "Atlantis/Lost_City",
          }),
        ),
      }),
    ).toBe(
      'Active hours of criteria "Access point is unstable": choose the time zone the hours are in.',
    );
  });

  test("the customer's criteria are written as they are", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Ping,
        monitorSteps: stepsWith(
          criteriaWith({
            filters: [
              failedPings({
                evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
                timeValueInMinutes: 60,
                countValue: 5,
              }),
            ],
            recoveryFilters: [
              {
                ...failedPings({
                  evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
                  timeValueInMinutes: 60,
                  countFilterType: FilterType.LessThanOrEqualTo,
                  countValue: 1,
                }),
              },
            ],
          }),
        ),
      }),
    ).toBeNull();
  });
});
