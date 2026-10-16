import {
  MAX_ATTRIBUTE_FILTERS,
  MAX_GROUP_BY_KEYS,
  MAX_TREND_BUCKETS,
  METRIC_ATTRIBUTE_SCHEMA_PROPERTIES,
  MetricReadPlan,
  chooseTrendInterval,
  countBuckets,
  describeMetricReadPlan,
  planMetricRead,
  readAttributeFilter,
  readGroupBy,
} from "../../../../../Server/Utils/AI/Toolbox/MetricAttributeQuery";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ATTRIBUTE ARGUMENTS OF THE AI'S METRIC TOOLS (issue #4784).
 *
 * query_metrics and query_resource_telemetry take `attributes` (an equality
 * filter) and `groupBy` (one series per value). Both come from the model,
 * so every shape is checked here, and a metric the host agent reports once
 * per state or mount point is read one series per value unless the caller
 * decided the split itself.
 */

const START: Date = new Date("2026-10-16T13:00:00.000Z");

function hoursLater(hours: number): Date {
  return new Date(START.getTime() + hours * 60 * 60 * 1000);
}

describe("readAttributeFilter", () => {
  test("no filter reads as none", () => {
    expect(readAttributeFilter({})).toBeUndefined();
    expect(readAttributeFilter({ attributes: null })).toBeUndefined();
    expect(readAttributeFilter({ attributes: {} })).toBeUndefined();
  });

  test("strings stay strings; numbers and booleans are read as their text, as attributes are stored", () => {
    expect(
      readAttributeFilter({
        attributes: {
          state: "idle",
          cpu: 3,
          "resource.host.name": "web-1",
          "k8s.pod.ready": true,
        },
      }),
    ).toEqual({
      state: "idle",
      cpu: "3",
      "resource.host.name": "web-1",
      "k8s.pod.ready": "true",
    });
  });

  test("keys are trimmed and blank keys are dropped", () => {
    expect(
      readAttributeFilter({ attributes: { "  state ": "user", "   ": "x" } }),
    ).toEqual({ state: "user" });
  });

  test.each([
    ["a list", { attributes: ["state", "idle"] }],
    ["text", { attributes: "state=idle" }],
    ["a number", { attributes: 4 }],
  ])("refuses %s in place of an object", (_label: string, args: JSONObject) => {
    expect(() => {
      return readAttributeFilter(args);
    }).toThrow("attributes must be an object");
  });

  test.each([
    ["an object value", { state: { not: "idle" } }],
    ["a list value", { state: ["idle", "user"] }],
    ["a null value", { state: null }],
  ])("refuses %s, saying what a value may be", (_label: string, attributes) => {
    expect(() => {
      return readAttributeFilter({ attributes } as JSONObject);
    }).toThrow('The value of attribute "state" must be a string');
  });

  test("refuses more filters than a read takes", () => {
    const attributes: JSONObject = {};

    for (let index: number = 0; index <= MAX_ATTRIBUTE_FILTERS; index++) {
      attributes[`key${index}`] = "value";
    }

    expect(() => {
      return readAttributeFilter({ attributes });
    }).toThrow(`At most ${MAX_ATTRIBUTE_FILTERS} attribute filters`);
  });

  test("refuses a key or a value too long to be one", () => {
    expect(() => {
      return readAttributeFilter({ attributes: { ["k".repeat(300)]: "v" } });
    }).toThrow("longer than 256 characters");
    expect(() => {
      return readAttributeFilter({ attributes: { state: "v".repeat(2000) } });
    }).toThrow("longer than 1024 characters");
  });
});

describe("readGroupBy", () => {
  test("no grouping reads as none", () => {
    expect(readGroupBy({})).toBeUndefined();
    expect(readGroupBy({ groupBy: [] })).toBeUndefined();
    expect(readGroupBy({ groupBy: "" })).toBeUndefined();
  });

  test("one key may come as plain text", () => {
    expect(readGroupBy({ groupBy: "state" })).toEqual(["state"]);
  });

  test("keys are trimmed, deduplicated and kept in order", () => {
    expect(
      readGroupBy({
        groupBy: [" resource.container.name ", "state", "state", "  "],
      }),
    ).toEqual(["resource.container.name", "state"]);
  });

  test("refuses a key that is not text", () => {
    expect(() => {
      return readGroupBy({ groupBy: ["state", 4] } as JSONObject);
    }).toThrow("groupBy must be a list of attribute keys");
  });

  test(`refuses more than ${MAX_GROUP_BY_KEYS} keys`, () => {
    expect(() => {
      return readGroupBy({ groupBy: ["a", "b", "c", "d"] });
    }).toThrow(`groupBy takes at most ${MAX_GROUP_BY_KEYS} attribute keys`);
  });

  test("refuses a key too long to be one", () => {
    expect(() => {
      return readGroupBy({ groupBy: ["k".repeat(300)] });
    }).toThrow("longer than 256 characters");
  });
});

describe("planMetricRead", () => {
  test("system.cpu.utilization, asked for as a whole, is read one series per state", () => {
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.cpu.utilization",
      attributeFilter: undefined,
      groupBy: undefined,
    });

    expect(plan.groupBy).toEqual(["state", "cpu.mode"]);
    expect(plan.isSplitByTool).toBe(true);
    expect(plan.isSplitIgnored).toBe(false);
    expect(describeMetricReadPlan(plan)).toContain(
      "system.cpu.utilization is reported once per state, so it was read one series per state",
    );
    expect(describeMetricReadPlan(plan)).toContain("add up to 1");
  });

  test("a filter that is not on the split still leaves the split to the tool", () => {
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.cpu.utilization",
      attributeFilter: { "resource.host.name": "web-1" },
      groupBy: undefined,
    });

    expect(plan.groupBy).toEqual(["state", "cpu.mode"]);
    expect(plan.isSplitByTool).toBe(true);
  });

  test("state=idle is read as asked: one series, with what a state means", () => {
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.cpu.utilization",
      attributeFilter: { state: "idle" },
      groupBy: undefined,
    });

    expect(plan.groupBy).toEqual([]);
    expect(plan.isSplitByTool).toBe(false);
    expect(plan.isSplitIgnored).toBe(false);
    expect(describeMetricReadPlan(plan)).toContain(
      "idle near 0 means the CPUs are saturated",
    );
  });

  test("grouping by the split is read as asked", () => {
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.memory.utilization",
      attributeFilter: undefined,
      groupBy: ["state", "resource.host.name"],
    });

    expect(plan.groupBy).toEqual(["state", "resource.host.name"]);
    expect(plan.isSplitByTool).toBe(false);
    expect(plan.isSplitIgnored).toBe(false);
  });

  test("grouping by something else is read as asked, with a warning that each series averages every state", () => {
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.cpu.utilization",
      attributeFilter: undefined,
      groupBy: ["resource.host.name"],
    });

    expect(plan.groupBy).toEqual(["resource.host.name"]);
    expect(plan.isSplitIgnored).toBe(true);
    expect(
      describeMetricReadPlan(plan).startsWith(
        "Warning: system.cpu.utilization is reported once per state, and this read did not split it",
      ),
    ).toBe(true);
    expect(describeMetricReadPlan(plan)).toContain('add "state" to groupBy');
  });

  test("a metric read as one number is read as asked, and the plan says nothing", () => {
    for (const groupBy of [undefined, ["resource.container.name"]]) {
      const plan: MetricReadPlan = planMetricRead({
        metricName: "container.cpu.utilization",
        attributeFilter: undefined,
        groupBy,
      });

      expect(plan.groupBy).toEqual(groupBy || []);
      expect(plan.split).toBeUndefined();
      expect(describeMetricReadPlan(plan)).toBe("");
    }
  });

  test("the caller's grouping is a copy: changing the plan never changes the arguments", () => {
    const groupBy: Array<string> = ["state"];
    const plan: MetricReadPlan = planMetricRead({
      metricName: "system.cpu.utilization",
      attributeFilter: undefined,
      groupBy,
    });

    plan.groupBy.push("cpu");
    expect(groupBy).toEqual(["state"]);
  });
});

describe("chooseTrendInterval", () => {
  test.each([
    [0.5, AggregationInterval.Minute],
    [0.8, AggregationInterval.Minute],
    [0.9, AggregationInterval.FiveMinutes],
    [1, AggregationInterval.FiveMinutes],
    [6, AggregationInterval.FifteenMinutes],
    [24, AggregationInterval.ThirtyMinutes],
    [48, AggregationInterval.Hour],
    [24 * 7, AggregationInterval.Day],
    [24 * 30, AggregationInterval.Day],
  ])(
    "a %s-hour window is read in %s buckets, never more than the trend budget",
    (hours: number, interval: AggregationInterval) => {
      expect(chooseTrendInterval(START, hoursLater(hours))).toBe(interval);

      if (hours <= 24 * 7) {
        expect(
          countBuckets({
            startTime: START,
            endTime: hoursLater(hours),
            interval,
          }),
        ).toBeLessThanOrEqual(MAX_TREND_BUCKETS);
      }
    },
  );

  test("countBuckets counts the partial first and last buckets, and Total is one", () => {
    expect(
      countBuckets({
        startTime: START,
        endTime: hoursLater(1),
        interval: AggregationInterval.Minute,
      }),
    ).toBe(61);
    expect(
      countBuckets({
        startTime: START,
        endTime: hoursLater(240),
        interval: AggregationInterval.Total,
      }),
    ).toBe(1);
  });
});

describe("the schema the model reads", () => {
  test("says what each argument is, with examples of both kinds of key", () => {
    const attributes: JSONObject = METRIC_ATTRIBUTE_SCHEMA_PROPERTIES[
      "attributes"
    ] as JSONObject;
    const groupBy: JSONObject = METRIC_ATTRIBUTE_SCHEMA_PROPERTIES[
      "groupBy"
    ] as JSONObject;

    expect(attributes["type"]).toBe("object");
    expect(String(attributes["description"])).toContain('{"state": "idle"}');
    expect(String(attributes["description"])).toContain("resource.host.name");
    expect(groupBy["type"]).toBe("array");
    expect(String(groupBy["description"])).toContain(
      `Up to ${MAX_GROUP_BY_KEYS} attribute keys`,
    );
    expect(String(groupBy["description"])).toContain("highest peak first");
  });
});
