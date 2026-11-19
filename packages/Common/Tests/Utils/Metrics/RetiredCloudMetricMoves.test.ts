import { describe, expect, test } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  CosmosConnectionMode,
  CosmosLatencyEvidence,
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_SCALE,
  RetiredCloudMetric,
  RetiredCloudMetricKeptReason,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
  chooseCosmosConnectionMode,
  divideFormulaVariable,
  findRetiredCloudMetricQueries,
  getCosmosLatencyReplacement,
  getRetiredCloudMetric,
  getRetiredCloudMetricReplacements,
  moveRetiredCloudMetricQueries,
  scaleThreshold,
} from "../../../Utils/Metrics/RetiredCloudMetricMoves";

/*
 * #9739: Metrics monitors moved off the two metrics their clouds deprecate
 * (Pub/Sub's send_message_operation_count, Cosmos DB's ServerSideLatency),
 * on monitor steps as the database stores them: what moves and how, what
 * stays and why, and that nothing else of a monitor changes.
 */

const TOPIC_ATTRIBUTES: JSONObject = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};
const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";
const COSMOS_ATTRIBUTES: JSONObject = {
  "azuremonitor.resource_id": COSMOS_ID,
};
const COSMOS_LATENCY: string = "azure_serversidelatency_average";

const STATUS: {
  online: ObjectID;
  offline: ObjectID;
  incident: ObjectID;
  alert: ObjectID;
} = {
  online: new ObjectID("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  offline: new ObjectID("6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e"),
  incident: new ObjectID("7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f"),
  alert: new ObjectID("8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a"),
};

function query(data: {
  variable?: string | undefined;
  metricName: string;
  attributes?: JSONObject | undefined;
  aggregationType?: AggregationType | undefined;
  legendUnit?: string | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: "Publishes",
      description: undefined,
      legend: undefined,
      legendUnit: data.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: (data.attributes || TOPIC_ATTRIBUTES) as never,
        aggregateBy: {},
        ...(data.aggregationType
          ? { aggegationType: data.aggregationType }
          : {}),
      },
      ...(data.groupByAttributeKeys
        ? { groupByAttributeKeys: data.groupByAttributeKeys }
        : {}),
    },
  } as MetricQueryConfigData;
}

function formula(alias: string, text: string): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: alias,
      title: alias,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricFormulaData: { metricFormula: text },
  };
}

// A criteria pair on an alias: fires at or above `value`, clears under it.
function criteriaOn(
  alias: string,
  value: number,
  extra?: (filter: CriteriaFilter) => void,
): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: STATUS.offline,
    incidentSeverityId: STATUS.incident,
    alertSeverityId: STATUS.alert,
    monitorName: "orders",
    metricAlias: alias,
    filterType: FilterType.GreaterThanOrEqualTo,
    value,
    metricAggregationType: EvaluateOverTimeType.AnyValue,
  });
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: STATUS.online,
    metricAlias: alias,
    filterType: FilterType.LessThan,
    value,
    recoveryValue: value,
  });

  if (extra) {
    extra(unhealthy.data!.filters[0]!);
    extra(healthy.data!.filters[0]!);
  }

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [unhealthy, healthy] };

  return criteria;
}

function metricStep(data: {
  queries: Array<MetricQueryConfigData>;
  formulas?: Array<MetricFormulaConfigData> | undefined;
  criteria: MonitorCriteria;
  rollingTime?: RollingTime | undefined;
}): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "orders",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: STATUS.online,
    offlineMonitorStatusId: STATUS.offline,
    defaultIncidentSeverityId: STATUS.incident,
    defaultAlertSeverityId: STATUS.alert,
  });
  const metricMonitor: MonitorStepMetricMonitor = {
    metricViewConfig: {
      queryConfigs: data.queries,
      formulaConfigs: data.formulas || [],
    },
    rollingTime: data.rollingTime || RollingTime.Past15Minutes,
  };

  step.setMetricMonitor(metricMonitor);
  step.setMonitorCriteria(data.criteria);

  return step;
}

// Monitor steps as the database holds them and hands them back.
function stored(steps: Array<MonitorStep>): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(STATUS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

// What stored steps say, read back as the product reads them.
function readBack(json: JSONObject): Array<MonitorStep> {
  return MonitorSteps.fromJSON(json).data!.monitorStepsInstanceArray;
}

function viewOf(step: MonitorStep): MetricsViewConfig {
  return step.data!.metricMonitor!.metricViewConfig;
}

function thresholdsOf(step: MonitorStep): Array<unknown> {
  return step
    .data!.monitorCriteria.data!.monitorCriteriaInstanceArray.flatMap(
      (instance: MonitorCriteriaInstance) => {
        return instance.data!.filters;
      },
    )
    .map((filter: CriteriaFilter): unknown => {
      return filter.value;
    });
}

const NO_EVIDENCE: () => null = (): null => {
  return null;
};

describe("which metrics are retired", () => {
  test("the Pub/Sub publish operations, and Cosmos DB's ServerSideLatency under any aggregation", () => {
    expect(getRetiredCloudMetric(PUBSUB_PUBLISH_OPERATIONS_METRIC)).toBe(
      RetiredCloudMetric.PubSubPublishOperations,
    );
    expect(
      getRetiredCloudMetric(
        " PubSub.GoogleAPIs.com/Topic/Send_Message_Operation_Count ",
      ),
    ).toBe(RetiredCloudMetric.PubSubPublishOperations);

    for (const aggregation of [
      "average",
      "total",
      "maximum",
      "minimum",
      "count",
    ]) {
      expect(
        getRetiredCloudMetric(`azure_serversidelatency_${aggregation}`),
      ).toBe(RetiredCloudMetric.CosmosServerSideLatency);
    }
  });

  test("never their replacements, nor anything named like them", () => {
    for (const name of [
      PUBSUB_MESSAGES_PUBLISHED_METRIC,
      "pubsub.googleapis.com/topic/send_request_count",
      "azure_serversidelatencydirect_average",
      "azure_serversidelatencygateway_average",
      "azure_serversidelatency",
      "azure_serversidelatency_p99",
      "",
      undefined,
      42,
    ]) {
      expect([name, getRetiredCloudMetric(name)]).toEqual([name, null]);
    }
  });

  test("what replaces each, by its stored name", () => {
    expect(
      getRetiredCloudMetricReplacements(PUBSUB_PUBLISH_OPERATIONS_METRIC),
    ).toEqual([PUBSUB_MESSAGES_PUBLISHED_METRIC]);
    expect(
      getRetiredCloudMetricReplacements("azure_serversidelatency_maximum"),
    ).toEqual([
      "azure_serversidelatencydirect_maximum",
      "azure_serversidelatencygateway_maximum",
    ]);
    expect(
      getCosmosLatencyReplacement(COSMOS_LATENCY, CosmosConnectionMode.Gateway),
    ).toBe("azure_serversidelatencygateway_average");
    expect(
      getCosmosLatencyReplacement(
        "azure_percentage_cpu_average",
        CosmosConnectionMode.Direct,
      ),
    ).toBe(null);
  });

  test("a query of each is found in stored steps, with its variable and its filter", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
          query({
            variable: "b",
            metricName: PUBSUB_MESSAGES_PUBLISHED_METRIC,
          }),
        ],
        criteria: criteriaOn("a", 5),
      }),
      metricStep({
        queries: [
          query({
            variable: "c",
            metricName: COSMOS_LATENCY,
            attributes: COSMOS_ATTRIBUTES,
          }),
        ],
        criteria: criteriaOn("c", 50),
      }),
    ]);

    expect(findRetiredCloudMetricQueries(json)).toEqual([
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricVariable: "a",
        metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        attributes: TOPIC_ATTRIBUTES,
      },
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "c",
        metricName: COSMOS_LATENCY,
        attributes: COSMOS_ATTRIBUTES,
      },
    ]);
    // Nothing of steps that are none, or of none at all.
    expect(findRetiredCloudMetricQueries({})).toEqual([]);
    expect(findRetiredCloudMetricQueries(null)).toEqual([]);
    expect(
      findRetiredCloudMetricQueries({
        value: { monitorStepsInstanceArray: [{ value: {} }, "x", null] },
      }),
    ).toEqual([]);
  });
});

describe("a Pub/Sub monitor of the publish operations", () => {
  test("reads the messages published, its thresholds 60 times what they were: it fires when it did", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            legendUnit: "1/s",
          }),
        ],
        criteria: criteriaOn("a", 5),
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    expect(outcome).toEqual({
      moved: [
        {
          metric: RetiredCloudMetric.PubSubPublishOperations,
          metricVariable: "a",
          from: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          to: PUBSUB_MESSAGES_PUBLISHED_METRIC,
          thresholds: [
            { from: 5, to: 300 },
            { from: 5, to: 300 },
          ],
          formulas: [],
        },
      ],
      kept: [],
    });

    const [step] = readBack(json);
    const [moved] = viewOf(step!).queryConfigs;

    expect(moved!.metricQueryData.filterData.metricName).toBe(
      PUBSUB_MESSAGES_PUBLISHED_METRIC,
    );
    // Its attributes and its aggregation are its own still.
    expect(moved!.metricQueryData.filterData.attributes).toEqual(
      TOPIC_ATTRIBUTES,
    );
    // A rate's unit is no count's.
    expect(moved!.metricAliasData!.legendUnit).toBeUndefined();
    expect(moved!.metricAliasData!.title).toBe("Publishes");
    expect(thresholdsOf(step!)).toEqual([300, 300]);
    expect(PUBSUB_PUBLISH_OPERATIONS_SCALE).toBe(60);
  });

  test("keeps the aggregation it read with: an Avg, a Sum, a Max or a percentile of values 60 times as large is 60 times as large", () => {
    for (const aggregationType of [
      AggregationType.Avg,
      AggregationType.Sum,
      AggregationType.Max,
      AggregationType.Min,
      AggregationType.P95,
      undefined,
    ]) {
      const json: JSONObject = stored([
        metricStep({
          queries: [
            query({
              variable: "a",
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
              aggregationType,
            }),
          ],
          criteria: criteriaOn("a", 0.5),
        }),
      ]);

      expect(
        moveRetiredCloudMetricQueries({
          monitorStepsJSON: json,
          evidenceOf: NO_EVIDENCE,
        }).moved,
      ).toHaveLength(1);

      const [step] = readBack(json);

      expect(
        viewOf(step!).queryConfigs[0]!.metricQueryData.filterData
          .aggegationType,
      ).toBe(aggregationType);
      expect(thresholdsOf(step!)).toEqual([30, 30]);
    }
  });

  test("a formula over it reads it divided by 60, and its own thresholds stay", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
          query({
            variable: "b",
            metricName: "pubsub.googleapis.com/topic/send_request_count",
          }),
        ],
        formulas: [formula("share", "$a / $b * 100")],
        criteria: criteriaOn("share", 90),
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    expect(outcome.moved).toEqual([
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricVariable: "a",
        from: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        to: PUBSUB_MESSAGES_PUBLISHED_METRIC,
        thresholds: [],
        formulas: [
          { alias: "share", from: "$a / $b * 100", to: "($a / 60) / $b * 100" },
        ],
      },
    ]);

    const [step] = readBack(json);

    expect(
      viewOf(step!).formulaConfigs[0]!.metricFormulaData.metricFormula,
    ).toBe("($a / 60) / $b * 100");
    // The formula's value is what it was: its line is.
    expect(thresholdsOf(step!)).toEqual([90, 90]);
    // The other query is untouched.
    expect(
      viewOf(step!).queryConfigs[1]!.metricQueryData.filterData.metricName,
    ).toBe("pubsub.googleapis.com/topic/send_request_count");
  });

  test("a criteria that names no metric reads the first query, and moves with it", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        criteria: criteriaOn("", 2),
      }),
    ]);

    moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    expect(thresholdsOf(readBack(json)[0]!)).toEqual([120, 120]);
  });

  test("a threshold written as text stays text; a per-second threshold unit is dropped with the rate", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        criteria: criteriaOn("a", 1.5, (filter: CriteriaFilter): void => {
          filter.value = "1.5";
          filter.metricMonitorOptions!.thresholdUnit = "1/s";
        }),
      }),
    ]);

    moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    const [step] = readBack(json);
    const filters: Array<CriteriaFilter> =
      step!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.flatMap(
        (instance: MonitorCriteriaInstance) => {
          return instance.data!.filters;
        },
      );

    expect(
      filters.map((filter: CriteriaFilter) => {
        return [filter.value, filter.metricMonitorOptions?.thresholdUnit];
      }),
    ).toEqual([
      ["90", undefined],
      ["90", undefined],
    ]);
  });

  test("a forecast's threshold moves too; an anomaly's has none to move", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        criteria: criteriaOn("a", 2, (filter: CriteriaFilter): void => {
          filter.filterType =
            filter.filterType === FilterType.GreaterThanOrEqualTo
              ? FilterType.ForecastAbove
              : FilterType.AnomalouslyHigh;
        }),
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    expect(outcome.moved[0]!.thresholds).toEqual([{ from: 2, to: 120 }]);
    expect(thresholdsOf(readBack(json)[0]!)).toEqual([120, 2]);
  });

  test("every step of a monitor, and every query of a step, is moved", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        criteria: criteriaOn("a", 1),
      }),
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            attributes: {
              ...TOPIC_ATTRIBUTES,
              "resource.topic_id": "payments",
            },
          }),
          query({
            variable: "b",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        formulas: [formula("sum", "a + B")],
        criteria: criteriaOn("sum", 10),
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });

    expect(outcome.moved).toHaveLength(3);
    expect(outcome.kept).toEqual([]);

    const [, second] = readBack(json);

    expect(
      viewOf(second!).formulaConfigs[0]!.metricFormulaData.metricFormula,
    ).toBe("(a / 60) + (B / 60)");
    expect(findRetiredCloudMetricQueries(json)).toEqual([]);
  });

  test("moved once, nothing moves again", () => {
    const json: JSONObject = stored([
      metricStep({
        queries: [
          query({
            variable: "a",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          }),
        ],
        criteria: criteriaOn("a", 5),
      }),
    ]);

    moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: NO_EVIDENCE,
    });
    const after: string = JSON.stringify(json);

    expect(
      moveRetiredCloudMetricQueries({
        monitorStepsJSON: json,
        evidenceOf: NO_EVIDENCE,
      }),
    ).toEqual({ moved: [], kept: [] });
    expect(JSON.stringify(json)).toBe(after);
  });

  describe("stays as it is, and says why, where moving it would change what it judges", () => {
    function outcomeOf(step: MonitorStep): {
      outcome: RetiredCloudMetricOutcome;
      before: string;
      after: string;
    } {
      const json: JSONObject = stored([step]);
      const before: string = JSON.stringify(json);
      const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
        monitorStepsJSON: json,
        evidenceOf: NO_EVIDENCE,
      });

      return { outcome, before, after: JSON.stringify(json) };
    }

    test.each([
      [
        "a query of one response code: the replacement counts what was published",
        query({
          variable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          attributes: { ...TOPIC_ATTRIBUTES, response_code: "not_found" },
        }),
        RetiredCloudMetricKeptReason.ResponseCode,
      ],
      [
        "a query split by response class",
        query({
          variable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          groupByAttributeKeys: ["response_class"],
        }),
        RetiredCloudMetricKeptReason.ResponseCode,
      ],
      [
        "a count of points",
        query({
          variable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          aggregationType: AggregationType.Count,
        }),
        RetiredCloudMetricKeptReason.PointCount,
      ],
    ])(
      "%s",
      (
        _label: string,
        retired: MetricQueryConfigData,
        reason: RetiredCloudMetricKeptReason,
      ) => {
        const { outcome, before, after } = outcomeOf(
          metricStep({ queries: [retired], criteria: criteriaOn("a", 5) }),
        );

        expect(outcome).toEqual({
          moved: [],
          kept: [
            {
              metric: RetiredCloudMetric.PubSubPublishOperations,
              metricVariable: "a",
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
              reason,
              replacements: [PUBSUB_MESSAGES_PUBLISHED_METRIC],
            },
          ],
        });
        expect(after).toBe(before);
      },
    );

    test("a threshold in a unit of its own", () => {
      const { outcome, before, after } = outcomeOf(
        metricStep({
          queries: [
            query({
              variable: "a",
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            }),
          ],
          criteria: criteriaOn("a", 5, (filter: CriteriaFilter): void => {
            filter.metricMonitorOptions!.thresholdUnit = "KiB";
          }),
        }),
      );

      expect(outcome.kept[0]!.reason).toBe(
        RetiredCloudMetricKeptReason.ThresholdUnit,
      );
      expect(after).toBe(before);
    });

    test("a formula over it that does not read as a formula", () => {
      const { outcome, before, after } = outcomeOf(
        metricStep({
          queries: [
            query({
              variable: "a",
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            }),
          ],
          formulas: [formula("f", "($a * 2")],
          criteria: criteriaOn("f", 5),
        }),
      );

      expect(outcome.kept[0]!.reason).toBe(
        RetiredCloudMetricKeptReason.Formula,
      );
      expect(after).toBe(before);
    });
  });
});

describe("a Cosmos DB monitor of ServerSideLatency", () => {
  function cosmosStep(metricName: string = COSMOS_LATENCY): MonitorStep {
    return metricStep({
      queries: [
        query({
          variable: "latency",
          metricName,
          attributes: COSMOS_ATTRIBUTES,
          legendUnit: "ms",
        }),
      ],
      criteria: criteriaOn("latency", 50),
    });
  }

  function moveWith(
    evidence: CosmosLatencyEvidence | null,
    metricName?: string,
  ): {
    json: JSONObject;
    outcome: RetiredCloudMetricOutcome;
    asked: Array<RetiredCloudMetricQuery>;
  } {
    const json: JSONObject = stored([cosmosStep(metricName)]);
    const asked: Array<RetiredCloudMetricQuery> = [];
    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: json,
      evidenceOf: (
        retired: RetiredCloudMetricQuery,
      ): CosmosLatencyEvidence | null => {
        asked.push(retired);
        return evidence;
      },
    });

    return { json, outcome, asked };
  }

  test("reads the direct latency of an account whose clients connect directly, nothing else changed", () => {
    const { json, outcome, asked } = moveWith({
      directPoints: 40_000,
      gatewayPoints: 0,
    });

    // What the evidence is asked of: the query, by its filter.
    expect(asked).toEqual([
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "latency",
        metricName: COSMOS_LATENCY,
        attributes: COSMOS_ATTRIBUTES,
      },
    ]);
    expect(outcome).toEqual({
      moved: [
        {
          metric: RetiredCloudMetric.CosmosServerSideLatency,
          metricVariable: "latency",
          from: COSMOS_LATENCY,
          to: "azure_serversidelatencydirect_average",
          thresholds: [],
          formulas: [],
          connectionMode: CosmosConnectionMode.Direct,
        },
      ],
      kept: [],
    });

    const [step] = readBack(json);
    const [moved] = viewOf(step!).queryConfigs;

    expect(moved!.metricQueryData.filterData.metricName).toBe(
      "azure_serversidelatencydirect_average",
    );
    // Milliseconds, as it was: its legend and its thresholds stay.
    expect(moved!.metricAliasData!.legendUnit).toBe("ms");
    expect(thresholdsOf(step!)).toEqual([50, 50]);
  });

  test("the gateway's for an account whose clients go through it", () => {
    expect(
      moveWith({ directPoints: 0, gatewayPoints: 900 }).outcome.moved[0],
    ).toMatchObject({
      to: "azure_serversidelatencygateway_average",
      connectionMode: CosmosConnectionMode.Gateway,
    });
  });

  test("an account that reported both reads the one with more points, and names the other", () => {
    expect(
      moveWith({ directPoints: 300, gatewayPoints: 5_000 }).outcome.moved[0],
    ).toMatchObject({
      to: "azure_serversidelatencygateway_average",
      connectionMode: CosmosConnectionMode.Gateway,
      alsoReported: "azure_serversidelatencydirect_average",
    });
  });

  test("an account of the API for MongoDB connects through the gateway alone, reported or not", () => {
    expect(
      moveWith({ directPoints: 0, gatewayPoints: 0, isGatewayOnly: true })
        .outcome.moved[0],
    ).toMatchObject({
      to: "azure_serversidelatencygateway_average",
      connectionMode: CosmosConnectionMode.Gateway,
    });
  });

  test("the aggregation a collector stored it under is kept", () => {
    expect(
      moveWith(
        { directPoints: 1, gatewayPoints: 0 },
        "azure_serversidelatency_maximum",
      ).outcome.moved[0]!.to,
    ).toBe("azure_serversidelatencydirect_maximum");
  });

  test("an account that reported neither stays as it is, and says what to read", () => {
    for (const evidence of [
      null,
      { directPoints: 0, gatewayPoints: 0 },
    ] as Array<CosmosLatencyEvidence | null>) {
      const json: JSONObject = stored([cosmosStep()]);
      const before: string = JSON.stringify(json);
      const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
        monitorStepsJSON: json,
        evidenceOf: (): CosmosLatencyEvidence | null => {
          return evidence;
        },
      });

      expect(outcome).toEqual({
        moved: [],
        kept: [
          {
            metric: RetiredCloudMetric.CosmosServerSideLatency,
            metricVariable: "latency",
            metricName: COSMOS_LATENCY,
            reason: RetiredCloudMetricKeptReason.ConnectionModeUnknown,
            replacements: [
              "azure_serversidelatencydirect_average",
              "azure_serversidelatencygateway_average",
            ],
          },
        ],
      });
      expect(JSON.stringify(json)).toBe(before);
    }
  });
});

describe("the pieces", () => {
  test("a connection mode is chosen by what the account reported", () => {
    expect(chooseCosmosConnectionMode(null)).toBe(null);
    expect(
      chooseCosmosConnectionMode({ directPoints: 0, gatewayPoints: 0 }),
    ).toBe(null);
    expect(
      chooseCosmosConnectionMode({ directPoints: 5, gatewayPoints: 5 }),
    ).toEqual({ mode: CosmosConnectionMode.Direct, alsoReported: true });
    expect(
      chooseCosmosConnectionMode({ directPoints: -1, gatewayPoints: 2 }),
    ).toEqual({ mode: CosmosConnectionMode.Gateway, alsoReported: false });
  });

  test("a threshold is scaled without the float's dust", () => {
    expect(scaleThreshold(0.1, 60)).toBe(6);
    expect(scaleThreshold(0.7, 60)).toBe(42);
    expect(scaleThreshold(1.15, 60)).toBe(69);
    expect(scaleThreshold(-2, 60)).toBe(-120);
  });

  test("a formula's variable is divided wherever it is named, however it is spelled", () => {
    expect(
      divideFormulaVariable({ formula: "$a * 100", variable: "a", factor: 60 }),
    ).toBe("($a / 60) * 100");
    expect(
      divideFormulaVariable({ formula: "a+$A-ab", variable: "a", factor: 60 }),
    ).toBe("(a / 60)+($A / 60)-ab");
    // A number's exponent is no variable.
    expect(
      divideFormulaVariable({
        formula: "$a * 1e3 + e",
        variable: "e",
        factor: 60,
      }),
    ).toBe("$a * 1e3 + (e / 60)");
    // A formula that does not name it is as it was.
    expect(
      divideFormulaVariable({ formula: "$b / 2", variable: "a", factor: 60 }),
    ).toBe("$b / 2");
    // One the evaluator cannot read is not guessed at.
    expect(
      divideFormulaVariable({ formula: "$a +", variable: "a", factor: 60 }),
    ).toBe(null);
  });
});
