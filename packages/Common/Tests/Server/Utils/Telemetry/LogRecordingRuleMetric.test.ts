import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import LogRecordingRuleMetric, {
  LOG_RECORDING_RULE_METRIC_RETENTION_IN_DAYS,
} from "../../../../Server/Utils/Telemetry/LogRecordingRuleMetric";
import { LogRecordingRulePoint } from "../../../../Server/Utils/Telemetry/LogRecordingRuleQuery";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
} from "../../../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a log recording rule writes into the metric store: one Gauge row per
 * point, in the shape the metric and trace recording rule workers write
 * theirs, so the Metric Explorer, dashboards and Metrics monitors read it
 * like any other metric - and the catalogue entry that lists the output
 * metric, with its unit, in the metric pickers.
 */

const RULE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const NOW: Date = new Date("2026-10-07T10:05:40.000Z");
const BUCKET: Date = new Date("2026-10-07T10:04:00.000Z");

const latencyRule: LogRecordingRuleDefinition = {
  filter: {},
  aggregationType: AggregationType.Avg,
  valueAttribute: "latency",
  groupByAttributes: ["gw_name", "profile_name"],
  unit: "ms",
};

const point: (
  groupValues: Record<string, string>,
  value: number,
) => LogRecordingRulePoint = (
  groupValues: Record<string, string>,
  value: number,
): LogRecordingRulePoint => {
  return { bucketStart: BUCKET, groupValues, value, matchedLogs: 1 };
};

const rowsFor: (points: Array<LogRecordingRulePoint>) => Array<JSONObject> = (
  points: Array<LogRecordingRulePoint>,
): Array<JSONObject> => {
  return LogRecordingRuleMetric.buildRows({
    ruleId: RULE_ID,
    projectId: PROJECT_ID,
    outputMetricName: "sdwan.gateway.latency.ms",
    points,
    now: NOW,
  });
};

describe("LogRecordingRuleMetric.buildRows", () => {
  test("writes a Gauge point at the start of its minute, under the output metric name", () => {
    const [row] = rowsFor([
      point({ gw_name: "WAN2", profile_name: "Branch-Internet" }, 11),
    ]);

    expect(row).toEqual({
      _id: expect.any(String),
      projectId: PROJECT_ID.toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(NOW),
      time: "2026-10-07 10:04:00",
      timeUnixNano: (BUCKET.getTime() * 1_000_000).toString(),
      primaryEntityType: ServiceType.OpenTelemetry,
      name: "sdwan.gateway.latency.ms",
      metricPointType: MetricPointType.Gauge,
      value: 11,
      attributes: {
        gw_name: "WAN2",
        profile_name: "Branch-Internet",
        [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString(),
      },
      attributeKeys: [
        "gw_name",
        LOG_RECORDING_RULE_ID_ATTRIBUTE,
        "profile_name",
      ].sort(),
      retentionDate: OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(
          NOW,
          LOG_RECORDING_RULE_METRIC_RETENTION_IN_DAYS,
        ),
      ),
    });
  });

  test("one row per point, each with its own id", () => {
    const rows: Array<JSONObject> = rowsFor([
      point({ gw_name: "WAN1", profile_name: "p" }, 9),
      point({ gw_name: "WAN2", profile_name: "p" }, 40),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]!["_id"]).not.toBe(rows[1]!["_id"]);
    expect(
      rows.map((row: JSONObject) => {
        return [(row["attributes"] as JSONObject)["gw_name"], row["value"]];
      }),
    ).toEqual([
      ["WAN1", 9],
      ["WAN2", 40],
    ]);
  });

  test("a series whose logs lacked a group-by attribute is written without it", () => {
    const [row] = rowsFor([point({ gw_name: "", profile_name: "p" }, 9)]);

    expect(row!["attributes"]).toEqual({
      profile_name: "p",
      [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString(),
    });
    expect(row!["attributeKeys"]).toEqual(
      [LOG_RECORDING_RULE_ID_ATTRIBUTE, "profile_name"].sort(),
    );
  });

  test("a rule with no group by writes only its rule id", () => {
    const [row] = rowsFor([point({}, 0)]);

    expect(row!["attributes"]).toEqual({
      [LOG_RECORDING_RULE_ID_ATTRIBUTE]: RULE_ID.toString(),
    });
    expect(row!["value"]).toBe(0);
  });

  test("no group-by value can stand in for the rule's id", () => {
    const [row] = rowsFor([
      point({ [LOG_RECORDING_RULE_ID_ATTRIBUTE]: "forged" }, 1),
    ]);

    expect(
      (row!["attributes"] as JSONObject)[LOG_RECORDING_RULE_ID_ATTRIBUTE],
    ).toBe(RULE_ID.toString());
  });

  test("nothing to write is nothing written", () => {
    expect(rowsFor([])).toEqual([]);
  });
});

describe("LogRecordingRuleMetric.buildMetricType", () => {
  test("lists the output metric with the rule's unit and what it computes", () => {
    const metricType: MetricType = LogRecordingRuleMetric.buildMetricType({
      outputMetricName: "sdwan.gateway.latency.ms",
      ruleName: "SD-WAN gateway latency",
      definition: latencyRule,
    });

    expect(metricType.name).toBe("sdwan.gateway.latency.ms");
    expect(metricType.unit).toBe("ms");
    expect(metricType.description).toBe(
      'Written every minute by the log recording rule "SD-WAN gateway latency" from the logs it matches: avg(latency) by gw_name, profile_name.',
    );
  });

  test("the rule's own description, when it has one, describes the metric", () => {
    const metricType: MetricType = LogRecordingRuleMetric.buildMetricType({
      outputMetricName: "sdwan.gateway.latency.ms",
      ruleName: "SD-WAN gateway latency",
      ruleDescription: "  Average SLA latency per SD-WAN gateway.  ",
      definition: latencyRule,
    });

    expect(metricType.description).toBe(
      "Average SLA latency per SD-WAN gateway.",
    );
  });

  test("a rule without a unit registers none, and a nameless one is named by its metric", () => {
    const metricType: MetricType = LogRecordingRuleMetric.buildMetricType({
      outputMetricName: "error_logs",
      definition: { filter: {}, aggregationType: AggregationType.Count },
    });

    expect(metricType.unit).toBe("");
    expect(metricType.description).toBe(
      'Written every minute by the log recording rule "error_logs" from the logs it matches: count.',
    );
  });
});
