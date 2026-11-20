import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  findRetiredCloudMetricQueriesOfDashboard,
  findRetiredCloudMetricQueryOfSlo,
  moveRetiredCloudMetricQueriesOfDashboard,
  moveRetiredCloudMetricQueryOfSlo,
} from "../../../Utils/Metrics/RetiredCloudMetricChartMoves";
import {
  CosmosConnectionMode,
  CosmosLatencyEvidence,
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricKeptReason,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
} from "../../../Utils/Metrics/RetiredCloudMetricMoves";

/*
 * Dashboard widgets and SLOs moved off the two metrics their clouds
 * deprecate (#9980), by the monitors' one rule (#9739): a Cosmos DB
 * account's latency by what it reported; Pub/Sub's messages published a
 * minute, each threshold 60 times what it was and each formula over it
 * divided by 60; a query of a response code, a count of points, a formula
 * that does not read as one, kept, with why.
 */

const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";
const TOPIC: JSONObject = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};

const NO_EVIDENCE: () => CosmosLatencyEvidence | null = () => {
  return null;
};

function query(data: {
  metricName: string;
  variable?: string;
  attributes?: JSONObject;
  groupBy?: Array<string>;
  aggregation?: string;
  legendUnit?: string;
  warningThreshold?: number;
  criticalThreshold?: number;
}): JSONObject {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "Published",
      ...(data.legendUnit ? { legendUnit: data.legendUnit } : {}),
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: data.attributes || {},
        aggegationType: data.aggregation || "Avg",
      },
      groupByAttributeKeys: data.groupBy || [],
    },
    ...(data.warningThreshold !== undefined
      ? { warningThreshold: data.warningThreshold }
      : {}),
    ...(data.criticalThreshold !== undefined
      ? { criticalThreshold: data.criticalThreshold }
      : {}),
  };
}

function formula(text: string, variable: string = "f"): JSONObject {
  return {
    metricAliasData: { metricVariable: variable },
    metricFormulaData: { metricFormula: text },
  };
}

function component(componentType: string, args: JSONObject): JSONObject {
  return {
    _type: "DashboardComponent",
    componentId: { _type: "ObjectID", value: `${componentType}-1` },
    componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };
}

function board(components: Array<JSONObject>): JSONObject {
  return {
    _type: "DashboardViewConfig",
    components,
    heightInDashboardUnits: 12,
  };
}

function argsOf(viewConfig: JSONObject, index: number = 0): JSONObject {
  return (viewConfig["components"] as Array<JSONObject>)[index]![
    "arguments"
  ] as JSONObject;
}

function move(
  viewConfig: JSONObject,
  evidence: CosmosLatencyEvidence | null = null,
): RetiredCloudMetricOutcome {
  return moveRetiredCloudMetricQueriesOfDashboard({
    dashboardViewConfigJSON: viewConfig,
    evidenceOf: () => {
      return evidence;
    },
  });
}

describe("a dashboard's chart of the publish operations", () => {
  test("draws the messages published a minute, its threshold lines 60 times what they were, its formula over the rate", () => {
    const viewConfig: JSONObject = board([
      component("Chart", {
        chartTitle: "Orders published",
        metricQueryConfigs: [
          query({
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            attributes: TOPIC,
            legendUnit: "/s",
            warningThreshold: 5,
            criticalThreshold: 12.5,
          }),
        ],
        metricFormulaConfigs: [formula("$a * 100")],
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = move(viewConfig);
    const args: JSONObject = argsOf(viewConfig);
    const moved: JSONObject = (
      args["metricQueryConfigs"] as Array<JSONObject>
    )[0]!;

    expect(outcome.kept).toEqual([]);
    expect(outcome.moved).toEqual([
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricVariable: "a",
        from: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        to: PUBSUB_MESSAGES_PUBLISHED_METRIC,
        thresholds: [
          { from: 5, to: 300 },
          { from: 12.5, to: 750 },
        ],
        formulas: [{ alias: "f", from: "$a * 100", to: "($a / 60) * 100" }],
      },
    ]);
    expect(
      ((moved["metricQueryData"] as JSONObject)["filterData"] as JSONObject)[
        "metricName"
      ],
    ).toBe(PUBSUB_MESSAGES_PUBLISHED_METRIC);
    // The attributes it reads by and its aggregation stay.
    expect(
      ((moved["metricQueryData"] as JSONObject)["filterData"] as JSONObject)[
        "attributes"
      ],
    ).toEqual(TOPIC);
    expect(
      ((moved["metricQueryData"] as JSONObject)["filterData"] as JSONObject)[
        "aggegationType"
      ],
    ).toBe("Avg");
    expect(moved["metricAliasData"]).toEqual({
      metricVariable: "a",
      title: "Published",
    });
    expect([moved["warningThreshold"], moved["criticalThreshold"]]).toEqual([
      300, 750,
    ]);
    expect(
      (
        (args["metricFormulaConfigs"] as Array<JSONObject>)[0]![
          "metricFormulaData"
        ] as JSONObject
      )["metricFormula"],
    ).toBe("($a / 60) * 100");
    expect(args["chartTitle"]).toBe("Orders published");
  });

  test("its single query, as older charts hold it, moves too; a query of another metric is left as it is", () => {
    const viewConfig: JSONObject = board([
      component("Chart", {
        metricQueryConfig: query({
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        }),
        metricQueryConfigs: [
          query({
            metricName: "pubsub.googleapis.com/topic/byte_cost",
            variable: "b",
          }),
        ],
      }),
    ]);

    expect(move(viewConfig).moved).toHaveLength(1);
    expect(
      (
        (
          (argsOf(viewConfig)["metricQueryConfig"] as JSONObject)[
            "metricQueryData"
          ] as JSONObject
        )["filterData"] as JSONObject
      )["metricName"],
    ).toBe(PUBSUB_MESSAGES_PUBLISHED_METRIC);
    expect(
      (
        (
          (argsOf(viewConfig)["metricQueryConfigs"] as Array<JSONObject>)[0]![
            "metricQueryData"
          ] as JSONObject
        )["filterData"] as JSONObject
      )["metricName"],
    ).toBe("pubsub.googleapis.com/topic/byte_cost");
  });

  test("one split by response code or class stays, and says why", () => {
    for (const viewConfig of [
      board([
        component("Chart", {
          metricQueryConfigs: [
            query({
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
              groupBy: ["response_code"],
            }),
          ],
        }),
      ]),
      board([
        component("Chart", {
          metricQueryConfigs: [
            query({
              metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
              attributes: { ...TOPIC, response_class: "success" },
            }),
          ],
        }),
      ]),
    ]) {
      const before: string = JSON.stringify(viewConfig);
      const outcome: RetiredCloudMetricOutcome = move(viewConfig);

      expect(outcome.moved).toEqual([]);
      expect(outcome.kept).toEqual([
        {
          metric: RetiredCloudMetric.PubSubPublishOperations,
          metricVariable: "a",
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          reason: RetiredCloudMetricKeptReason.ResponseCode,
          replacements: [PUBSUB_MESSAGES_PUBLISHED_METRIC],
        },
      ]);
      expect(JSON.stringify(viewConfig)).toBe(before);
    }
  });

  test("a count of points, or a formula that does not read as one, stays", () => {
    const counted: JSONObject = board([
      component("Chart", {
        metricQueryConfigs: [
          query({
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            aggregation: "Count",
          }),
        ],
      }),
    ]);
    const unreadable: JSONObject = board([
      component("Chart", {
        metricQueryConfigs: [
          query({ metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC }),
        ],
        metricFormulaConfigs: [formula("$a * (100")],
      }),
    ]);

    expect(move(counted).kept[0]!.reason).toBe(
      RetiredCloudMetricKeptReason.PointCount,
    );
    expect(move(unreadable).kept[0]!.reason).toBe(
      RetiredCloudMetricKeptReason.Formula,
    );
  });

  test("moved once, nothing moves again", () => {
    const viewConfig: JSONObject = board([
      component("Chart", {
        metricQueryConfigs: [
          query({
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            warningThreshold: 5,
          }),
        ],
      }),
    ]);

    move(viewConfig);
    const after: string = JSON.stringify(viewConfig);

    expect(move(viewConfig)).toEqual({ moved: [], kept: [] });
    expect(JSON.stringify(viewConfig)).toBe(after);
  });
});

describe("a dashboard's value and gauge of the publish operations", () => {
  test("a value's warning and critical thresholds are 60 times what they were", () => {
    const viewConfig: JSONObject = board([
      component("Value", {
        title: "Published",
        metricQueryConfig: query({
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        }),
        warningThreshold: 2,
        criticalThreshold: 0.5,
      }),
    ]);

    expect(move(viewConfig).moved[0]!.thresholds).toEqual([
      { from: 2, to: 120 },
      { from: 0.5, to: 30 },
    ]);
    expect([
      argsOf(viewConfig)["warningThreshold"],
      argsOf(viewConfig)["criticalThreshold"],
      argsOf(viewConfig)["title"],
    ]).toEqual([120, 30, "Published"]);
  });

  test("a gauge's range moves with its thresholds", () => {
    const viewConfig: JSONObject = board([
      component("Gauge", {
        gaugeTitle: "Published",
        metricQueryConfig: query({
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        }),
        minValue: 0,
        maxValue: 50,
        warningThreshold: 30,
      }),
    ]);

    move(viewConfig);

    expect([
      argsOf(viewConfig)["minValue"],
      argsOf(viewConfig)["maxValue"],
      argsOf(viewConfig)["warningThreshold"],
      argsOf(viewConfig)["criticalThreshold"],
    ]).toEqual([0, 3000, 1800, undefined]);
  });
});

describe("a dashboard's table of the publish operations", () => {
  function table(args: JSONObject): JSONObject {
    return board([
      component("Table", {
        tableTitle: "Topics",
        groupByAttributes: [{ key: "resource.topic_id", header: "Topic" }],
        columns: [
          {
            id: "c1",
            variable: "a",
            header: "Published",
            kind: "Metric",
            metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
            aggregation: "Avg",
            unit: "1/s",
            thresholds: { warning: 2, critical: 4, direction: "HigherIsWorse" },
          },
          {
            id: "c2",
            variable: "b",
            header: "Share",
            kind: "Formula",
            formula: "a / 2",
          },
        ],
        ...args,
      }),
    ]);
  }

  test("a metric column reads the count a minute, its thresholds 60 times, its unit dropped, a formula column over it divided", () => {
    const viewConfig: JSONObject = table({});
    const outcome: RetiredCloudMetricOutcome = move(viewConfig);
    const columns: Array<JSONObject> = argsOf(viewConfig)[
      "columns"
    ] as Array<JSONObject>;

    expect(outcome.kept).toEqual([]);
    expect(columns[0]).toEqual({
      id: "c1",
      variable: "a",
      header: "Published",
      kind: "Metric",
      metricName: PUBSUB_MESSAGES_PUBLISHED_METRIC,
      aggregation: "Avg",
      thresholds: { warning: 120, critical: 240, direction: "HigherIsWorse" },
    });
    expect(columns[1]!["formula"]).toBe("(a / 60) / 2");
  });

  test("a table split or filtered by response code stays; one that counts points too", () => {
    expect(
      move(table({ groupByAttributes: [{ key: "response_code" }] })).kept[0]!
        .reason,
    ).toBe(RetiredCloudMetricKeptReason.ResponseCode);
    expect(
      move(table({ groupByAttributeKeys: ["Response_Class"] })).kept[0]!.reason,
    ).toBe(RetiredCloudMetricKeptReason.ResponseCode);
    expect(
      move(table({ attributeFilters: { response_code: "success" } })).kept[0]!
        .reason,
    ).toBe(RetiredCloudMetricKeptReason.ResponseCode);

    const counted: JSONObject = table({});
    (argsOf(counted)["columns"] as Array<JSONObject>)[0]!["aggregation"] =
      "Count";
    expect(move(counted).kept[0]!.reason).toBe(
      RetiredCloudMetricKeptReason.PointCount,
    );
  });

  test("its queries are found with the widget's filter, as the connection reads them", () => {
    expect(
      findRetiredCloudMetricQueriesOfDashboard(
        table({ attributeFilters: TOPIC }),
      ),
    ).toEqual([
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricVariable: "a",
        metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        attributes: TOPIC,
      },
    ]);
  });
});

describe("a dashboard's chart of a Cosmos DB account's ServerSideLatency", () => {
  function chart(): JSONObject {
    return board([
      component("Chart", {
        metricQueryConfigs: [
          query({
            metricName: "azure_serversidelatency_average",
            attributes: { "azuremonitor.resource_id": COSMOS_ID },
            warningThreshold: 40,
          }),
        ],
      }),
    ]);
  }

  test("reads the latency the account reports, its thresholds as they were", () => {
    const viewConfig: JSONObject = chart();
    const asked: Array<RetiredCloudMetricQuery> = [];

    const outcome: RetiredCloudMetricOutcome =
      moveRetiredCloudMetricQueriesOfDashboard({
        dashboardViewConfigJSON: viewConfig,
        evidenceOf: (candidate: RetiredCloudMetricQuery) => {
          asked.push(candidate);
          return { directPoints: 0, gatewayPoints: 30 };
        },
      });
    const moved: JSONObject = (
      argsOf(viewConfig)["metricQueryConfigs"] as Array<JSONObject>
    )[0]!;

    expect(asked).toEqual([
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricVariable: "a",
        metricName: "azure_serversidelatency_average",
        attributes: { "azuremonitor.resource_id": COSMOS_ID },
      },
    ]);
    expect(outcome.moved[0]!.connectionMode).toBe(CosmosConnectionMode.Gateway);
    expect(
      ((moved["metricQueryData"] as JSONObject)["filterData"] as JSONObject)[
        "metricName"
      ],
    ).toBe("azure_serversidelatencygateway_average");
    expect(moved["warningThreshold"]).toBe(40);
  });

  test("an account that reported neither stays, and is moved later by the same rule", () => {
    const viewConfig: JSONObject = chart();

    expect(move(viewConfig).kept[0]!.reason).toBe(
      RetiredCloudMetricKeptReason.ConnectionModeUnknown,
    );
    expect(
      move(viewConfig, { directPoints: 3, gatewayPoints: 0 }).moved[0]!.to,
    ).toBe("azure_serversidelatencydirect_average");
  });
});

describe("what a dashboard holds besides", () => {
  test("widgets of other kinds, and a board of none, are left alone and read as nothing", () => {
    const viewConfig: JSONObject = board([
      component("Text", { text: PUBSUB_PUBLISH_OPERATIONS_METRIC }),
      component("LogChart", { title: "azure_serversidelatency_average" }),
      component("Chart", {}),
      { componentType: "Chart" },
    ]);
    const before: string = JSON.stringify(viewConfig);

    expect(findRetiredCloudMetricQueriesOfDashboard(viewConfig)).toEqual([]);
    expect(move(viewConfig)).toEqual({ moved: [], kept: [] });
    expect(JSON.stringify(viewConfig)).toBe(before);

    for (const nothing of [null, undefined, "text", [], {}]) {
      expect(findRetiredCloudMetricQueriesOfDashboard(nothing)).toEqual([]);
    }
  });

  test("every widget of a board is moved, each by its own rule", () => {
    const viewConfig: JSONObject = board([
      component("Chart", {
        metricQueryConfigs: [
          query({ metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC }),
        ],
      }),
      component("value", {
        metricQueryConfig: query({
          metricName: "azure_serversidelatency_average",
        }),
      }),
    ]);

    const outcome: RetiredCloudMetricOutcome = move(viewConfig, {
      directPoints: 1,
      gatewayPoints: 0,
    });

    expect(
      outcome.moved.map((moved: { to: string }) => {
        return moved.to;
      }),
    ).toEqual([
      PUBSUB_MESSAGES_PUBLISHED_METRIC,
      "azure_serversidelatencydirect_average",
    ]);
  });
});

/*
 * A config is read as every board reads it (StoredDashboardViewConfig,
 * #4571): the API, Terraform and scripts store what they are sent, so a
 * chart the board draws is found - and kept read - and moved on the config
 * handed in, whatever shape it was stored in.
 */
describe("a dashboard stored in another shape a board reads", () => {
  function publishChart(): JSONObject {
    return component("Chart", {
      metricQueryConfigs: [
        query({ metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC }),
      ],
    });
  }

  function metricNameOf(args: JSONObject): unknown {
    return (
      (
        (args["metricQueryConfigs"] as Array<JSONObject>)[0]![
          "metricQueryData"
        ] as JSONObject
      )["filterData"] as JSONObject
    )["metricName"];
  }

  test("in the envelopes the API reference documented, the config's as an object or as JSON text", () => {
    const stored: JSONObject = {
      components: [{ _type: "DashboardComponent", value: publishChart() }],
    };

    for (const value of [stored, JSON.stringify(stored)]) {
      const viewConfig: JSONObject = { _type: "DashboardViewConfig", value };
      const before: string = JSON.stringify(viewConfig);

      expect(findRetiredCloudMetricQueriesOfDashboard(viewConfig)).toHaveLength(
        1,
      );
      // Finding changes nothing.
      expect(JSON.stringify(viewConfig)).toBe(before);

      expect(move(viewConfig).moved).toHaveLength(1);
      expect(viewConfig["_type"]).toBe("DashboardViewConfig");
      expect(metricNameOf(argsOf(viewConfig["value"] as JSONObject))).toBe(
        PUBSUB_MESSAGES_PUBLISHED_METRIC,
      );
    }
  });

  test("a widget, or a widget's arguments, written as JSON text: moved as the objects they say", () => {
    const textArguments: JSONObject = {
      ...publishChart(),
      arguments: JSON.stringify(publishChart()["arguments"]),
    };
    const viewConfig: JSONObject = {
      _type: "DashboardViewConfig",
      components: [JSON.stringify(publishChart()), textArguments],
    };
    const before: string = JSON.stringify(viewConfig);

    expect(findRetiredCloudMetricQueriesOfDashboard(viewConfig)).toHaveLength(
      2,
    );
    expect(JSON.stringify(viewConfig)).toBe(before);

    expect(move(viewConfig).moved).toHaveLength(2);
    expect(metricNameOf(argsOf(viewConfig, 0))).toBe(
      PUBSUB_MESSAGES_PUBLISHED_METRIC,
    );
    expect(metricNameOf(argsOf(viewConfig, 1))).toBe(
      PUBSUB_MESSAGES_PUBLISHED_METRIC,
    );
  });
});

describe("an SLO of a deprecated metric", () => {
  test("a counter of the publish operations counts the messages published", () => {
    const config: JSONObject = {
      metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
      kind: "Counter",
      goodFilter: "@resource.topic_id:orders",
    };
    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueryOfSlo(
      {
        metricQueryConfig: config,
        evidenceOf: NO_EVIDENCE,
      },
    );

    expect(outcome.moved[0]!.to).toBe(PUBSUB_MESSAGES_PUBLISHED_METRIC);
    expect(config).toEqual({
      metricName: PUBSUB_MESSAGES_PUBLISHED_METRIC,
      kind: "Counter",
      goodFilter: "@resource.topic_id:orders",
    });
  });

  test("a histogram's good value is 60 times what it was", () => {
    const config: JSONObject = {
      metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
      kind: "Histogram",
      goodAtOrUnder: 2,
    };

    expect(
      moveRetiredCloudMetricQueryOfSlo({
        metricQueryConfig: config,
        evidenceOf: NO_EVIDENCE,
      }).moved[0]!.thresholds,
    ).toEqual([{ from: 2, to: 120 }]);
    expect(config["goodAtOrUnder"]).toBe(120);
  });

  test("one whose filter names a response code stays", () => {
    for (const filters of [
      { filter: "@response_code:success" },
      { goodFilter: "-@response_class:error" },
    ]) {
      const config: JSONObject = {
        metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        kind: "Counter",
        ...filters,
      };
      const before: string = JSON.stringify(config);

      expect(
        moveRetiredCloudMetricQueryOfSlo({
          metricQueryConfig: config,
          evidenceOf: NO_EVIDENCE,
        }).kept[0]!.reason,
      ).toBe(RetiredCloudMetricKeptReason.ResponseCode);
      expect(JSON.stringify(config)).toBe(before);
    }

    // A word that only holds the label's name is not the label.
    expect(
      moveRetiredCloudMetricQueryOfSlo({
        metricQueryConfig: {
          metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
          kind: "Counter",
          filter: "@topic:response_codes_v2",
        },
        evidenceOf: NO_EVIDENCE,
      }).moved,
    ).toHaveLength(1);
  });

  test("a Cosmos DB SLO is moved by what the account its filter names reported", () => {
    const query: RetiredCloudMetricQuery | null =
      findRetiredCloudMetricQueryOfSlo({
        metricName: "azure_serversidelatency_average",
        kind: "Histogram",
        goodAtOrUnder: 20,
        filter: `@azuremonitor.resource_id:"${COSMOS_ID}"`,
      });

    expect(query).toEqual({
      metric: RetiredCloudMetric.CosmosServerSideLatency,
      metricVariable: undefined,
      metricName: "azure_serversidelatency_average",
      attributes: { "azuremonitor.resource_id": COSMOS_ID },
    });

    const config: JSONObject = {
      metricName: "azure_serversidelatency_average",
      kind: "Histogram",
      goodAtOrUnder: 20,
    };

    expect(
      moveRetiredCloudMetricQueryOfSlo({
        metricQueryConfig: config,
        evidenceOf: () => {
          return { directPoints: 8, gatewayPoints: 1 };
        },
      }).moved[0]!.alsoReported,
    ).toBe("azure_serversidelatencygateway_average");
    // Milliseconds both: its good value stays.
    expect(config).toEqual({
      metricName: "azure_serversidelatencydirect_average",
      kind: "Histogram",
      goodAtOrUnder: 20,
    });
  });

  test("a filter of anything but equal terms names no account: nothing is guessed of it", () => {
    expect(
      findRetiredCloudMetricQueryOfSlo({
        metricName: "azure_serversidelatency_average",
        kind: "Counter",
        filter: `-@azuremonitor.resource_id:"${COSMOS_ID}"`,
      })!.attributes,
    ).toEqual({
      filter: { text: `-@azuremonitor.resource_id:"${COSMOS_ID}"` },
    });
  });

  test("an SLO of any other metric, or of none, is nothing", () => {
    for (const config of [
      { metricName: "http.server.request.duration", kind: "Histogram" },
      {},
      null,
      "text",
    ]) {
      expect(findRetiredCloudMetricQueryOfSlo(config)).toBeNull();
      expect(
        moveRetiredCloudMetricQueryOfSlo({
          metricQueryConfig: config,
          evidenceOf: NO_EVIDENCE,
        }),
      ).toEqual({ moved: [], kept: [] });
    }
  });
});
