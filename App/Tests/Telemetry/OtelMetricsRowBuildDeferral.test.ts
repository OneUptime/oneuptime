/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The metric datapoint hot loop was restructured so that:
 *
 *   1. attributeKeys is a linear sorted-merge of a once-per-metric sorted
 *      base key list and the datapoint's own keys, replacing a full
 *      O(N log N) sort per datapoint — with the contract that the stored
 *      list is IDENTICAL (elements and order) to the old
 *      `Object.keys(attributes).sort()`.
 *   2. Pipeline rules evaluate a minimal row ({name, attributes,
 *      attributeKeys} — the only fields MetricPipelineRuleService reads or
 *      writes) BEFORE the expensive remainder of the row is computed, so a
 *      dropped datapoint never pays for timestamp parsing, bucket/quantile
 *      decoding, _id generation or retention resolution.
 *   3. The merged per-metric attribute base is assembled with a single
 *      ordered Object.assign, preserving the historical collision
 *      precedence (resource < metric attributes < scope.*, and datapoint
 *      attributes above all) and per-row map independence.
 *
 * These tests drive the REAL OTLP walk (processMetricsFromQueue) with all
 * backend touchpoints mocked, and read the rows the loop hands the fan-in
 * submit path. Golden expectations pin kept-row equivalence with the
 * pre-restructure builder; counting spies pin the actual deferral.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverIoTFleet",
];

// 2026-08-10T10:00:00.000Z / one hour earlier, as OTLP unix-nano strings.
const TIME_MS: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
const START_MS: number = Date.UTC(2026, 7, 10, 9, 0, 0, 0);
const TIME_NANO: string = `${TIME_MS}000000`;
const START_NANO: string = `${START_MS}000000`;
const TIME_DB: string = "2026-08-10 10:00:00";
const START_DB: string = "2026-08-10 09:00:00";

/*
 * The exact field order of a completed metric row. The completion half of
 * the split builder must keep this byte-identical to the pre-split literal —
 * downstream serialization and the golden shape both hang off it.
 */
const EXPECTED_METRIC_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "name",
  "time",
  "timeUnixNano",
  "metricPointType",
  "aggregationTemporality",
  "isMonotonic",
  "attributes",
  "attributeKeys",
  "value",
  "count",
  "sum",
  "min",
  "max",
  "bucketCounts",
  "explicitBounds",
  "scale",
  "zeroCount",
  "positiveOffset",
  "positiveBucketCounts",
  "negativeOffset",
  "negativeBucketCounts",
  "summaryQuantiles",
  "summaryValues",
  "traceId",
  "spanId",
  "retentionDate",
  "startTime",
  "startTimeUnixNano",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function dropEverythingRules(): MetricRulesForProject {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filters = [];
  return { projectRules: [rule], rulesByServiceId: new Map() };
}

function dropByNameRules(metricName: string): MetricRulesForProject {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
      value: metricName,
    },
  ];
  return { projectRules: [rule], rulesByServiceId: new Map() };
}

function transformRules(): MetricRulesForProject {
  const renameMetric: MetricPipelineRule = new MetricPipelineRule();
  renameMetric.ruleType = MetricPipelineRuleType.RenameMetric;
  renameMetric.renameToKey = "cpu_usage_renamed";
  renameMetric.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
      value: "cpu_usage",
    },
  ];

  const addAttribute: MetricPipelineRule = new MetricPipelineRule();
  addAttribute.ruleType = MetricPipelineRuleType.AddAttribute;
  addAttribute.addAttributeKey = "added.by.rule";
  addAttribute.addAttributeValue = "rule-value";
  addAttribute.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
      value: "cpu_usage_renamed",
    },
  ];

  const renameAttribute: MetricPipelineRule = new MetricPipelineRule();
  renameAttribute.ruleType = MetricPipelineRuleType.RenameAttribute;
  renameAttribute.renameFromKey = "dp.only";
  renameAttribute.renameToKey = "dp.renamed";
  renameAttribute.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
      attributeKey: "dp.only",
      conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
    },
  ];

  return {
    projectRules: [renameMetric, addAttribute, renameAttribute],
    rulesByServiceId: new Map(),
  };
}

/*
 * One resource -> one scope -> three metrics (gauge with two datapoints,
 * histogram, summary), with attribute collisions staged at every level:
 *
 *   - resource attr "collide" arrives prefixed as "resource.collide";
 *     the gauge metric declares its own "resource.collide" (metric wins),
 *     and the gauge's first datapoint declares it again (datapoint wins).
 *   - the gauge metric declares "scope.name" (the scope must win).
 *
 * No host.name anywhere, so the synthetic heartbeat path stays cold and
 * every captured row comes from the datapoint loop.
 */
function metricsRequest(): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", "metrics-deferral-test"),
              stringAttribute("collide", "from-resource"),
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "otel-lib", version: "7.7.7" },
              metrics: [
                {
                  name: "cpu_usage",
                  unit: "%",
                  attributes: [
                    stringAttribute("resource.collide", "from-metric"),
                    stringAttribute("scope.name", "metric-tries-to-be-scope"),
                    stringAttribute("metric.level", "metric-attr"),
                  ],
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: TIME_NANO,
                        asInt: 5,
                        attributes: [
                          stringAttribute("resource.collide", "from-datapoint"),
                          stringAttribute("dp.only", "yes"),
                        ],
                      },
                      {
                        timeUnixNano: TIME_NANO,
                        startTimeUnixNano: START_NANO,
                        asDouble: 2.5,
                      },
                    ],
                  },
                },
                {
                  name: "request_latency",
                  unit: "s",
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        timeUnixNano: TIME_NANO,
                        startTimeUnixNano: START_NANO,
                        count: "3",
                        sum: 6.5,
                        min: 0.5,
                        max: 4,
                        bucketCounts: ["1", "2", "0"],
                        explicitBounds: ["1", 5],
                        attributes: [stringAttribute("http.route", "/api")],
                      },
                    ],
                  },
                },
                {
                  name: "gc_pause",
                  unit: "s",
                  summary: {
                    dataPoints: [
                      {
                        timeUnixNano: TIME_NANO,
                        count: 10,
                        sum: 1.25,
                        quantileValues: [
                          { quantile: 0.5, value: 0.1 },
                          { quantile: 0.99, value: 0.4 },
                        ],
                        attributes: [stringAttribute("gc.kind", "minor")],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngestMocks(rules: MetricRulesForProject): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      /*
       * Drain like the real fan-in submit path does (it splices rows out of
       * the shared buffer), so mid-loop threshold flushes and the final
       * force flush both land in capturedRows exactly once.
       */
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "metrics-deferral-test",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(rules);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return capturedRows;
}

function rowByName(rows: Array<JSONObject>, name: string): JSONObject {
  const matches: Array<JSONObject> = rows.filter((row: JSONObject) => {
    return row["name"] === name;
  });
  expect(matches.length).toBeGreaterThanOrEqual(1);
  return matches[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("metric row golden equivalence (kept rows)", () => {
  test("every kept row has the historical field order, stamps and shape", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(Object.keys(row)).toEqual(EXPECTED_METRIC_ROW_KEY_ORDER);

      // _id is generated per row; assert shape, not value.
      expect(typeof row["_id"]).toBe("string");
      expect((row["_id"] as string).length).toBeGreaterThan(0);
      expect(typeof row["createdAt"]).toBe("string");
      expect(typeof row["retentionDate"]).toBe("string");

      expect(row["projectId"]).toBe(PROJECT_ID.toString());
      expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
      expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
      expect(row["entityKeys"]).toEqual([]);
      expect(row["serviceEntityKey"]).toBe("");
    }

    // All four rows carry distinct generated ids.
    const ids: Set<string> = new Set(
      rows.map((row: JSONObject) => {
        return row["_id"] as string;
      }),
    );
    expect(ids.size).toBe(4);
  });

  test("gauge datapoints: values, time fields and the null start-time default", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    const gaugeRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return row["name"] === "cpu_usage";
    });
    expect(gaugeRows).toHaveLength(2);

    const withDatapointAttrs: JSONObject = gaugeRows.find((row: JSONObject) => {
      return (row["attributes"] as JSONObject)["dp.only"] === "yes";
    })!;
    const withoutDatapointAttrs: JSONObject = gaugeRows.find(
      (row: JSONObject) => {
        return (row["attributes"] as JSONObject)["dp.only"] === undefined;
      },
    )!;

    expect(withDatapointAttrs["value"]).toBe(5);
    expect(withDatapointAttrs["time"]).toBe(TIME_DB);
    expect(withDatapointAttrs["timeUnixNano"]).toBe(TIME_NANO);
    expect(withDatapointAttrs["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(withDatapointAttrs["startTime"]).toBeNull();
    expect(withDatapointAttrs["startTimeUnixNano"]).toBeNull();

    expect(withoutDatapointAttrs["value"]).toBe(2.5);
    expect(withoutDatapointAttrs["startTime"]).toBe(START_DB);
    expect(withoutDatapointAttrs["startTimeUnixNano"]).toBe(START_NANO);
  });

  test("histogram datapoint: bucket arrays parsed exactly as before", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    const histogramRow: JSONObject = rowByName(rows, "request_latency");

    expect(histogramRow["metricPointType"]).toBe(MetricPointType.Histogram);
    expect(histogramRow["count"]).toBe(3);
    expect(histogramRow["sum"]).toBe(6.5);
    expect(histogramRow["min"]).toBe(0.5);
    expect(histogramRow["max"]).toBe(4);
    expect(histogramRow["bucketCounts"]).toEqual([1, 2, 0]);
    expect(histogramRow["explicitBounds"]).toEqual([1, 5]);
    // value falls back to sum for histograms.
    expect(histogramRow["value"]).toBe(6.5);
    expect(histogramRow["startTime"]).toBe(START_DB);
  });

  test("summary datapoint: quantile arrays parsed exactly as before", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    const summaryRow: JSONObject = rowByName(rows, "gc_pause");

    expect(summaryRow["metricPointType"]).toBe(MetricPointType.Summary);
    expect(summaryRow["count"]).toBe(10);
    expect(summaryRow["sum"]).toBe(1.25);
    expect(summaryRow["summaryQuantiles"]).toEqual([0.5, 0.99]);
    expect(summaryRow["summaryValues"]).toEqual([0.1, 0.4]);
  });
});

describe("attribute precedence and per-row map independence", () => {
  test("collision winners: resource < metric attributes < scope.*, datapoint above all", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    const gaugeRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return row["name"] === "cpu_usage";
    });
    const withDatapointAttrs: JSONObject = gaugeRows.find((row: JSONObject) => {
      return (row["attributes"] as JSONObject)["dp.only"] === "yes";
    })!;
    const withoutDatapointAttrs: JSONObject = gaugeRows.find(
      (row: JSONObject) => {
        return (row["attributes"] as JSONObject)["dp.only"] === undefined;
      },
    )!;

    const attrsWithDatapoint: JSONObject = withDatapointAttrs[
      "attributes"
    ] as JSONObject;
    const attrsWithoutDatapoint: JSONObject = withoutDatapointAttrs[
      "attributes"
    ] as JSONObject;

    // Datapoint attribute beats the metric-level value for the same key.
    expect(attrsWithDatapoint["resource.collide"]).toBe("from-datapoint");
    // Without a datapoint override, the metric-level value beats the resource's.
    expect(attrsWithoutDatapoint["resource.collide"]).toBe("from-metric");
    // The scope envelope beats a metric attribute that spoofs its key.
    expect(attrsWithDatapoint["scope.name"]).toBe("otel-lib");
    expect(attrsWithDatapoint["scope.version"]).toBe("7.7.7");
    // Ordinary resource attributes still arrive with the resource. prefix.
    expect(attrsWithDatapoint["resource.service.name"]).toBe(
      "metrics-deferral-test",
    );
    // The service stamps still lead the map.
    expect(attrsWithDatapoint["oneuptime.service.id"]).toBe(
      SERVICE_ID.toString(),
    );
  });

  test("attributeKeys is the exact sorted key list of each row's attributes", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      /*
       * The order-identity contract of the sorted-merge: element-for-
       * element equal to the full sort the per-datapoint code used to run.
       */
      expect(row["attributeKeys"]).toEqual(
        Object.keys(row["attributes"] as JSONObject).sort(),
      );
    }
  });

  test("rows own independent attribute maps and key lists", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    const gaugeRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return row["name"] === "cpu_usage";
    });
    const first: JSONObject = gaugeRows[0]!;
    const second: JSONObject = gaugeRows[1]!;

    expect(first["attributes"]).not.toBe(second["attributes"]);
    expect(first["attributeKeys"]).not.toBe(second["attributeKeys"]);

    // Mutating one row's map must not leak into its sibling.
    (first["attributes"] as JSONObject)["mutated.key"] = "mutated";
    (first["attributeKeys"] as Array<string>).push("mutated.key");
    expect((second["attributes"] as JSONObject)["mutated.key"]).toBeUndefined();
    expect(second["attributeKeys"] as Array<string>).not.toContain(
      "mutated.key",
    );
  });
});

describe("pipeline rule interaction", () => {
  test("transform rules still apply: rename metric, add attribute, rename attribute", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(transformRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    expect(rows).toHaveLength(4);

    const renamedRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return row["name"] === "cpu_usage_renamed";
    });
    expect(renamedRows).toHaveLength(2);
    expect(
      rows.filter((row: JSONObject) => {
        return row["name"] === "cpu_usage";
      }),
    ).toHaveLength(0);

    for (const row of renamedRows) {
      const attributes: JSONObject = row["attributes"] as JSONObject;
      expect(attributes["added.by.rule"]).toBe("rule-value");
      // The rule engine rebuilds attributeKeys sorted after mutations.
      expect(row["attributeKeys"]).toEqual(Object.keys(attributes).sort());
    }

    // The rename-attribute rule only matched the datapoint that had dp.only.
    const renamedAttrRow: JSONObject = renamedRows.find((row: JSONObject) => {
      return (row["attributes"] as JSONObject)["dp.renamed"] === "yes";
    })!;
    expect(renamedAttrRow).toBeDefined();
    expect(
      (renamedAttrRow["attributes"] as JSONObject)["dp.only"],
    ).toBeUndefined();
    expect(renamedAttrRow["attributeKeys"] as Array<string>).toContain(
      "dp.renamed",
    );
    expect(renamedAttrRow["attributeKeys"] as Array<string>).not.toContain(
      "dp.only",
    );

    // Untouched metrics keep their names and shape.
    expect(rowByName(rows, "request_latency")["count"]).toBe(3);
    expect(rowByName(rows, "gc_pause")["summaryQuantiles"]).toEqual([
      0.5, 0.99,
    ]);
  });

  test("a drop-all rule set produces no rows", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(dropEverythingRules());

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    expect(rows).toHaveLength(0);
  });

  test("a name-scoped drop rule removes only that metric's datapoints", async () => {
    const rows: Array<JSONObject> = setupIngestMocks(
      dropByNameRules("cpu_usage"),
    );

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    expect(rows).toHaveLength(2);
    expect(
      rows.map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual(expect.arrayContaining(["request_latency", "gc_pause"]));
  });
});

describe("deferral proof: dropped datapoints skip the expensive build", () => {
  test("drop-all: ObjectID generation and timestamp parsing never run", async () => {
    setupIngestMocks(dropEverythingRules());

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: Record<string, any> =
      OtelMetricsIngestService as unknown as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    const parseSpy: jest.SpyInstance = jest.spyOn(service, "safeParseUnixNano");

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    /*
     * The whole point of the restructure: with every datapoint dropped by
     * rules, neither _id generation nor any per-datapoint timestamp parse
     * may run. Before the split, both ran for every datapoint regardless.
     */
    expect(generateSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  test("no rules: exactly one _id per kept datapoint, parses only for kept rows", async () => {
    setupIngestMocks(noRules());

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: Record<string, any> =
      OtelMetricsIngestService as unknown as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    const parseSpy: jest.SpyInstance = jest.spyOn(service, "safeParseUnixNano");

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    // 4 kept datapoints -> 4 generated row ids.
    expect(generateSpy).toHaveBeenCalledTimes(4);
    /*
     * Per kept row: one parse for timeUnixNano, plus one for
     * startTimeUnixNano where present (gauge dp2 and the histogram).
     */
    expect(parseSpy).toHaveBeenCalledTimes(6);
  });

  test("partial drop: the dropped metric contributes zero expensive work", async () => {
    setupIngestMocks(dropByNameRules("cpu_usage"));

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelMetricsIngestService.processMetricsFromQueue(metricsRequest());

    // Only request_latency + gc_pause survive -> exactly 2 ids.
    expect(generateSpy).toHaveBeenCalledTimes(2);
  });
});
