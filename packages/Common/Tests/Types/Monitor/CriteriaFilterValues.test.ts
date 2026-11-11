import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import CriteriaFilterValues from "../../../Types/Monitor/CriteriaFilterValues";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * A CRITERIA'S FILTER VALUES WRITTEN ANOTHER WAY ARE READ AS THE ONES THEY
 * MEAN; ONES THAT MEAN NONE ARE REFUSED.
 *
 * Every check compares a filter's values with the ones OneUptime writes,
 * and a filter whose condition is not one of them matches nothing
 * (CompareCriteria). A Metrics monitor an AI created through the MCP
 * server stored its conditions as "GreaterThan" and "LessThanOrEqual":
 * its alert could only ever fire on a window with no data. The Terraform
 * provider takes only the values OneUptime writes; the API took anything.
 */

interface ValueSetCase<T extends string> {
  name: string;
  values: Array<T>;
  read: (value: unknown) => T | null;
}

const VALUE_SETS: Array<ValueSetCase<string>> = [
  {
    name: "filterType",
    values: Object.values(FilterType),
    read: (value: unknown): string | null => {
      return CriteriaFilterValues.readFilterType(value);
    },
  },
  {
    name: "checkOn",
    values: Object.values(CheckOn),
    read: (value: unknown): string | null => {
      return CriteriaFilterValues.readCheckOn(value);
    },
  },
  {
    name: "filterCondition",
    values: Object.values(FilterCondition),
    read: (value: unknown): string | null => {
      return CriteriaFilterValues.readFilterCondition(value);
    },
  },
  {
    name: "metricAggregationType",
    values: Object.values(EvaluateOverTimeType),
    read: (value: unknown): string | null => {
      return CriteriaFilterValues.readEvaluateOverTimeType(value);
    },
  },
  {
    name: "onNoDataPolicy",
    values: Object.values(NoDataPolicy),
    read: (value: unknown): string | null => {
      return CriteriaFilterValues.readNoDataPolicy(value);
    },
  },
];

const lettersAndDigitsOf: (text: string) => string = (text: string): string => {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

describe("CriteriaFilterValues reads every value as itself, however it is written", () => {
  test.each(VALUE_SETS)(
    "$name: each value, in any case and with any spaces",
    (set: ValueSetCase<string>) => {
      for (const value of set.values) {
        const spellings: Array<string> = [
          value,
          value.toLowerCase(),
          value.toUpperCase(),
          ` ${value} `,
          value.replace(/ /g, ""),
          value.replace(/ /g, "_"),
          value.replace(/ /g, "-").toLowerCase(),
          value.replace(/ /g, "_").toUpperCase(),
        ];

        for (const spelling of spellings) {
          expect({ spelling, reads: set.read(spelling) }).toEqual({
            spelling,
            reads: value,
          });
        }
      }
    },
  );

  /*
   * Two values with the same letters and digits would be read as neither,
   * so a written one that means either is not guessed - and a new value
   * like that would stop reading in other spellings. None has.
   */
  test.each(VALUE_SETS)(
    "$name: no two values have the same letters and digits",
    (set: ValueSetCase<string>) => {
      const seen: Map<string, string> = new Map<string, string>();

      for (const value of set.values) {
        const letters: string = lettersAndDigitsOf(value);

        expect({ value, sameAs: seen.get(letters) }).toEqual({
          value,
          sameAs: undefined,
        });
        seen.set(letters, value);
      }
    },
  );

  test("every condition's name in the code reads as its value", () => {
    for (const key of Object.keys(FilterType)) {
      expect(CriteriaFilterValues.readFilterType(key)).toBe(
        FilterType[key as keyof typeof FilterType],
      );
    }
  });
});

describe("CriteriaFilterValues reads the other ways a value is written", () => {
  test.each([
    // The conditions the MCP-written monitor stored.
    ["GreaterThan", FilterType.GreaterThan],
    ["LessThanOrEqual", FilterType.LessThanOrEqualTo],
    // Symbols.
    [">", FilterType.GreaterThan],
    [" >= ", FilterType.GreaterThanOrEqualTo],
    ["≥", FilterType.GreaterThanOrEqualTo],
    ["<", FilterType.LessThan],
    ["<=", FilterType.LessThanOrEqualTo],
    ["≤", FilterType.LessThanOrEqualTo],
    ["=", FilterType.EqualTo],
    ["==", FilterType.EqualTo],
    ["===", FilterType.EqualTo],
    ["!=", FilterType.NotEqualTo],
    ["!==", FilterType.NotEqualTo],
    ["<>", FilterType.NotEqualTo],
    ["≠", FilterType.NotEqualTo],
    // Short names.
    ["gt", FilterType.GreaterThan],
    ["GTE", FilterType.GreaterThanOrEqualTo],
    ["ge", FilterType.GreaterThanOrEqualTo],
    ["lt", FilterType.LessThan],
    ["lte", FilterType.LessThanOrEqualTo],
    ["le", FilterType.LessThanOrEqualTo],
    ["eq", FilterType.EqualTo],
    ["ne", FilterType.NotEqualTo],
    ["neq", FilterType.NotEqualTo],
    // Words, and the Dashboard's own.
    ["greater_than_or_equal", FilterType.GreaterThanOrEqualTo],
    ["Greater or equal", FilterType.GreaterThanOrEqualTo],
    ["less-or-equal", FilterType.LessThanOrEqualTo],
    ["equals", FilterType.EqualTo],
    ["NotEquals", FilterType.NotEqualTo],
    ["More than", FilterType.GreaterThan],
    ["Above", FilterType.GreaterThan],
    ["Fewer than", FilterType.LessThan],
    ["Below", FilterType.LessThan],
    ["At least", FilterType.GreaterThanOrEqualTo],
    ["At most", FilterType.LessThanOrEqualTo],
    ["Exactly", FilterType.EqualTo],
    ["Anything but", FilterType.NotEqualTo],
    ["does not contain", FilterType.NotContains],
  ])("condition %j reads as %s", (written: string, filterType: FilterType) => {
    expect(CriteriaFilterValues.readFilterType(written)).toBe(filterType);
  });

  test.each([
    ["MetricValue", CheckOn.MetricValue],
    ["metric_value", CheckOn.MetricValue],
    ["ResponseTimeInMs", CheckOn.ResponseTime],
    ["response time in ms", CheckOn.ResponseTime],
    ["ISONLINE", CheckOn.IsOnline],
  ])("check %j reads as %s", (written: string, checkOn: CheckOn) => {
    expect(CriteriaFilterValues.readCheckOn(written)).toBe(checkOn);
  });

  test.each([
    ["any", FilterCondition.Any],
    ["ALL", FilterCondition.All],
    ["and", FilterCondition.All],
    ["OR", FilterCondition.Any],
  ])(
    "filter condition %j reads as %s",
    (written: string, condition: FilterCondition) => {
      expect(CriteriaFilterValues.readFilterCondition(written)).toBe(condition);
    },
  );

  test.each([
    ["AnyValue", EvaluateOverTimeType.AnyValue],
    ["any", EvaluateOverTimeType.AnyValue],
    ["all", EvaluateOverTimeType.AllValues],
    ["avg", EvaluateOverTimeType.Average],
    ["mean", EvaluateOverTimeType.Average],
    ["max", EvaluateOverTimeType.MaximumValue],
    ["Maximum", EvaluateOverTimeType.MaximumValue],
    ["min", EvaluateOverTimeType.MunimumValue],
    ["MinimumValue", EvaluateOverTimeType.MunimumValue],
    ["SUM", EvaluateOverTimeType.Sum],
  ])(
    "aggregation %j reads as %s",
    (written: string, type: EvaluateOverTimeType) => {
      expect(CriteriaFilterValues.readEvaluateOverTimeType(written)).toBe(type);
    },
  );

  test.each([
    ["trigger", NoDataPolicy.Trigger],
    ["TreatAsZero", NoDataPolicy.TreatAsZero],
    ["treat_as_zero", NoDataPolicy.TreatAsZero],
    ["IGNORE", NoDataPolicy.Ignore],
  ])(
    "no-data policy %j reads as %s",
    (written: string, policy: NoDataPolicy) => {
      expect(CriteriaFilterValues.readNoDataPolicy(written)).toBe(policy);
    },
  );

  test.each([
    "GreaterThn",
    "bigger",
    "greater",
    "",
    "   ",
    ">>",
    "=>",
    "!",
    "not",
    "x".repeat(200),
  ])("condition %j means none", (written: string) => {
    expect(CriteriaFilterValues.readFilterType(written)).toBeNull();
  });

  test.each([5, 0, null, undefined, true, {}, [FilterType.GreaterThan]])(
    "%p, which is not text, means no value",
    (value: unknown) => {
      for (const set of VALUE_SETS) {
        expect(set.read(value)).toBeNull();
      }
    },
  );

  test("a key name whose words are another value's is not read: the aggregation's misspelt key", () => {
    // EvaluateOverTimeType.MunimumValue is "Minimum Value".
    expect(CriteriaFilterValues.readEvaluateOverTimeType("MunimumValue")).toBe(
      null,
    );
  });

  /*
   * Texts of a condition's pieces: whatever they read as, they read the
   * same in any case and with any separator, and a value reads as itself.
   */
  test("reads generated texts of a condition's pieces consistently", () => {
    const pieces: Array<string> = [
      "Greater",
      "Less",
      "Than",
      "Or",
      "Equal",
      "To",
      "Not",
      " ",
      "_",
      "-",
      ">",
      "<",
      "=",
      "!",
      "x",
    ];
    let readAsCondition: number = 0;

    for (const text of generatedTexts(20000, 6584, pieces, 6)) {
      const read: FilterType | null = CriteriaFilterValues.readFilterType(text);

      if (read !== null) {
        readAsCondition++;
        expect(Object.values(FilterType)).toContain(read);
        expect(CriteriaFilterValues.readFilterType(read)).toBe(read);
      }

      expect({
        text,
        read: CriteriaFilterValues.readFilterType(text.toLowerCase()),
      }).toEqual({ text, read });
      expect({
        text,
        read: CriteriaFilterValues.readFilterType(text.replace(/[ -]/g, "_")),
      }).toEqual({ text, read });
    }

    expect(readAsCondition).toBeGreaterThan(100);
  });
});

describe("CriteriaFilterValues.readFilter", () => {
  test("reads the MCP-written monitor's filters as the values they mean, keeping the rest", () => {
    const written: JSONObject = {
      value: 0,
      checkOn: "Metric Value",
      filterType: "GreaterThan",
      metricMonitorOptions: {
        metricAlias: "m1",
        onNoDataPolicy: "Trigger",
        metricAggregationType: "Any Value",
      },
    };
    const before: string = JSON.stringify(written);

    expect(CriteriaFilterValues.readFilter(written)).toEqual({
      value: 0,
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      metricMonitorOptions: {
        metricAlias: "m1",
        onNoDataPolicy: NoDataPolicy.Trigger,
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    });

    // The filter as written is not changed.
    expect(JSON.stringify(written)).toBe(before);
  });

  test("reads every value written another way, in each place it is written", () => {
    expect(
      CriteriaFilterValues.readFilter({
        checkOn: "metric_value",
        filterType: ">=",
        value: "90",
        metricMonitorOptions: {
          metricAlias: "a",
          metricAggregationType: "avg",
          onNoDataPolicy: "treat as zero",
        },
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: "max",
          onNoDataPolicy: "TRIGGER",
        },
      }),
    ).toEqual({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: "90",
      metricMonitorOptions: {
        metricAlias: "a",
        metricAggregationType: EvaluateOverTimeType.Average,
        onNoDataPolicy: NoDataPolicy.TreatAsZero,
      },
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
        onNoDataPolicy: NoDataPolicy.Trigger,
      },
    });
  });

  test("leaves a value that means none, and one not written, as they are", () => {
    expect(
      CriteriaFilterValues.readFilter({
        checkOn: "Metric Valu",
        filterType: "GreaterThn",
        metricMonitorOptions: { metricAlias: "a", onNoDataPolicy: "maybe" },
      }),
    ).toEqual({
      checkOn: "Metric Valu",
      filterType: "GreaterThn",
      metricMonitorOptions: { metricAlias: "a", onNoDataPolicy: "maybe" },
    });

    expect(CriteriaFilterValues.readFilter({ checkOn: "Is Online" })).toEqual({
      checkOn: CheckOn.IsOnline,
    });
  });

  test("leaves a filter that is not an object as it is", () => {
    expect(CriteriaFilterValues.readFilter(null as unknown as JSONObject)).toBe(
      null,
    );
  });
});

describe("CriteriaFilterValues.getUnreadableErrors", () => {
  test("says nothing of values OneUptime writes, written any way, or not written", () => {
    expect(
      CriteriaFilterValues.getUnreadableErrors({
        criteriaName: "Healthy",
        filterCondition: "any",
        filters: [
          {
            checkOn: "Metric Value",
            filterType: "LessThanOrEqual",
            metricMonitorOptions: {
              metricAggregationType: "Any Value",
              onNoDataPolicy: "Ignore",
            },
          },
          { checkOn: CheckOn.IsOnline, filterType: FilterType.True },
          { checkOn: CheckOn.ResponseTime },
          {},
        ],
      }),
    ).toEqual([]);
  });

  test("names the criteria, where the value is written, the value, and the values it can take", () => {
    const errors: Array<string> = CriteriaFilterValues.getUnreadableErrors({
      criteriaName: "HTTP 5xx",
      filterCondition: "Either",
      filters: [
        { checkOn: "Metric Value", filterType: "GreaterThan" },
        {
          checkOn: "Metric Valu",
          filterType: "GreaterThn",
          metricMonitorOptions: {
            metricAggregationType: "Median",
            onNoDataPolicy: "Alert",
          },
          evaluateOverTimeOptions: {
            evaluateOverTimeType: "P99",
            onNoDataPolicy: "Page",
          },
        },
      ],
    });

    expect(errors).toEqual([
      `Criteria "HTTP 5xx": filterCondition "Either" is not a value OneUptime reads there. Use one of "All" or "Any".`,
      expect.stringMatching(
        /^Criteria "HTTP 5xx": filters\[1\]\.checkOn "Metric Valu" is not a value OneUptime reads there\. Use one of "Response Time \(in ms\)", .* "Metric Value", .*\.$/,
      ),
      expect.stringMatching(
        /^Criteria "HTTP 5xx": filters\[1\]\.filterType "GreaterThn" is not a value OneUptime reads there\. Use one of "Equal To", "Not Equal To", "Greater Than", .* or "Forecast Below"\.$/,
      ),
      `Criteria "HTTP 5xx": filters[1].metricMonitorOptions.metricAggregationType "Median" is not a value OneUptime reads there. Use one of "Average", "Sum", "Maximum Value", "Minimum Value", "All Values" or "Any Value".`,
      `Criteria "HTTP 5xx": filters[1].metricMonitorOptions.onNoDataPolicy "Alert" is not a value OneUptime reads there. Use one of "Ignore", "Treat As Zero" or "Trigger".`,
      `Criteria "HTTP 5xx": filters[1].evaluateOverTimeOptions.evaluateOverTimeType "P99" is not a value OneUptime reads there. Use one of "Average", "Sum", "Maximum Value", "Minimum Value", "All Values" or "Any Value".`,
      `Criteria "HTTP 5xx": filters[1].evaluateOverTimeOptions.onNoDataPolicy "Page" is not a value OneUptime reads there. Use one of "Ignore", "Treat As Zero" or "Trigger".`,
    ]);
  });

  test("quotes a long value only in part, and a value that is not text by its kind", () => {
    const errors: Array<string> = CriteriaFilterValues.getUnreadableErrors({
      criteriaName: "c",
      filterCondition: undefined,
      filters: [
        { filterType: "y".repeat(5000) },
        { filterType: 5 },
        { filterType: [">"] },
      ],
    });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain(
      `filters[0].filterType "${"y".repeat(64)}…" is`,
    );
    expect(errors[0]!.length).toBeLessThan(1000);
    expect(errors[1]).toContain("filters[1].filterType 5 is");
    expect(errors[2]).toContain("filters[2].filterType a list is");
  });

  test("reads filters that are not a list as none", () => {
    expect(
      CriteriaFilterValues.getUnreadableErrors({
        criteriaName: "c",
        filterCondition: "Any",
        filters: { filterType: "GreaterThn" },
      }),
    ).toEqual([]);
  });
});

describe("MonitorCriteriaInstance reads its values written another way", () => {
  const criteriaJSON: (value: JSONObject) => JSONObject = (
    value: JSONObject,
  ): JSONObject => {
    return { _type: "MonitorCriteriaInstance", value };
  };

  test("fromJSON reads the condition and each filter's values as the ones they mean", () => {
    const instance: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      criteriaJSON({
        id: "a1000000-0000-4000-8000-000000000005",
        name: "HTTP 5xx",
        filterCondition: "any",
        filters: [
          {
            value: 0,
            checkOn: "Metric Value",
            filterType: "GreaterThan",
            metricMonitorOptions: {
              metricAlias: "m1",
              onNoDataPolicy: "Trigger",
              metricAggregationType: "Any Value",
            },
          },
        ],
        incidents: [],
        alerts: [],
      }),
    );

    expect(instance.data!.filterCondition).toBe(FilterCondition.Any);
    expect(instance.data!.filters[0]!.filterType).toBe(FilterType.GreaterThan);
    expect(instance.data!.filters[0]!.checkOn).toBe(CheckOn.MetricValue);

    // And it is stored as read.
    const stored: JSONObject = instance.toJSON();
    const storedValue: JSONObject = stored["value"] as JSONObject;

    expect(storedValue["filterCondition"]).toBe(FilterCondition.Any);
    expect(
      ((storedValue["filters"] as Array<JSONObject>)[0] as JSONObject)[
        "filterType"
      ],
    ).toBe(FilterType.GreaterThan);
  });

  test("fromJSON keeps a value that means none as written", () => {
    const instance: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      criteriaJSON({
        name: "HTTP 5xx",
        filterCondition: "Either",
        filters: [{ checkOn: "Metric Value", filterType: "GreaterThn" }],
      }),
    );

    expect(instance.data!.filterCondition as string).toBe("Either");
    expect(instance.data!.filters[0]!.filterType as string).toBe("GreaterThn");
  });

  test("getValidationError refuses a value that means none, with the values it can take", () => {
    const instance: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      criteriaJSON({
        name: "HTTP 5xx",
        filterCondition: "Any",
        filters: [
          { checkOn: "Metric Value", filterType: "GreaterThn", value: 0 },
        ],
      }),
    );

    expect(
      MonitorCriteriaInstance.getValidationError(instance, MonitorType.Metrics),
    ).toMatch(
      /^Criteria "HTTP 5xx": filters\[0\]\.filterType "GreaterThn" is not a value OneUptime reads there\. Use one of "Equal To", /,
    );
  });

  test("getValidationError says nothing of values written another way, read on the way in", () => {
    const instance: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      criteriaJSON({
        name: "HTTP 5xx",
        filterCondition: "any",
        filters: [
          {
            checkOn: "Metric Value",
            filterType: "GreaterThan",
            value: 0,
            metricMonitorOptions: {
              metricAlias: "m1",
              onNoDataPolicy: "trigger",
              metricAggregationType: "AnyValue",
            },
          },
        ],
      }),
    );

    expect(
      MonitorCriteriaInstance.getValidationError(instance, MonitorType.Metrics),
    ).toBeNull();
  });

  test("a filter built in code with a value written another way is stored as the one it means", () => {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data!.name = "Built in code";
    instance.data!.filterCondition = "any" as FilterCondition;
    instance.data!.filters = [
      {
        checkOn: CheckOn.MetricValue,
        filterType: "GreaterThan" as FilterType,
        value: 0,
      } as CriteriaFilter,
    ];

    /*
     * Every reader of a stored criteria reads it through fromJSON - the
     * worker reads a monitor's steps from the database that way - so what
     * the comparator is handed is the value it means.
     */
    const readBack: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
      instance.toJSON(),
    );

    expect(readBack.data!.filterCondition).toBe(FilterCondition.Any);
    expect(readBack.data!.filters[0]!.filterType).toBe(FilterType.GreaterThan);
    expect(
      MonitorCriteriaInstance.getValidationError(instance, MonitorType.Metrics),
    ).toBeNull();

    instance.data!.filters[0]!.filterType = "GreaterThn" as FilterType;

    expect(
      MonitorCriteriaInstance.getValidationError(instance, MonitorType.Metrics),
    ).toContain('filters[0].filterType "GreaterThn"');
  });
});
