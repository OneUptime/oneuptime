import { describe, expect, test } from "@jest/globals";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import MetricTelemetrySnapshot from "../../../Utils/Monitor/MetricTelemetrySnapshot";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #6265: what an incident or alert keeps of the metric check that
 * opened it. Each query with the filters the check read it with - its own
 * and the cluster, host or fleet an infrastructure monitor narrows it to -
 * so the event's card charts the resource the monitor watches, not every
 * one in the project.
 */

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T10:00:00.000Z"),
  new Date("2026-11-07T10:05:00.000Z"),
);

const queryOf: (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown>;
}) => MetricQueryConfigData = (data: {
  variable?: string;
  metricName?: string;
  attributes?: Dictionary<unknown>;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.variable || "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName || "system.cpu.utilization",
        aggegationType: MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as never,
      groupByAttributeKeys: ["resource.host.name"],
    },
    criticalThreshold: 90,
  };
};

const FORMULA: MetricFormulaConfigData = {
  metricAliasData: {
    metricVariable: "c",
    title: "",
    description: "",
    legend: "",
    legendUnit: "%",
  },
  metricFormulaData: { metricFormula: "a / b * 100" },
};

const responseOf: (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  queryAttributes?: Array<Dictionary<unknown> | undefined> | undefined;
  formulaConfigs?: Array<MetricFormulaConfigData>;
}) => MetricMonitorResponse = (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  queryAttributes?: Array<Dictionary<unknown> | undefined> | undefined;
  formulaConfigs?: Array<MetricFormulaConfigData>;
}): MetricMonitorResponse => {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    startAndEndDate: WINDOW,
    metricResult: [],
    metricViewConfig: {
      queryConfigs: data.queryConfigs,
      formulaConfigs: data.formulaConfigs || [],
    },
    ...(data.queryAttributes !== undefined
      ? { queryAttributes: data.queryAttributes }
      : {}),
  };
};

const attributesOf: (
  snapshot: TelemetryQuery,
  index?: number,
) => unknown = (snapshot: TelemetryQuery, index: number = 0): unknown => {
  return snapshot.metricViewData?.queryConfigs[index]?.metricQueryData
    .filterData.attributes;
};

describe("an infrastructure check's snapshot keeps the resource each query was read for", () => {
  test("Host: the host the monitor watches", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [queryOf({})],
        queryAttributes: [{ "resource.host.name": "web-01" }],
      }),
    );

    expect(attributesOf(snapshot)).toEqual({ "resource.host.name": "web-01" });
    expect(snapshot.metricQueriesAsRead).toBe(true);
    expect(MetricTelemetrySnapshot.isAsRead(snapshot)).toBe(true);
  });

  test("Kubernetes: its own filters with the cluster and resource filters, the formula as it was", () => {
    const used: MetricQueryConfigData = queryOf({
      variable: "a",
      metricName: "k8s.node.memory.working_set",
      attributes: { "resource.k8s.node.name": "node-1" },
    });
    const total: MetricQueryConfigData = queryOf({
      variable: "b",
      metricName: "k8s.node.allocatable_memory",
    });

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [used, total],
        formulaConfigs: [FORMULA],
        queryAttributes: [
          {
            "resource.k8s.node.name": "node-1",
            "resource.k8s.cluster.name": "prod",
            "resource.k8s.namespace.name": "payments",
          },
          {
            "resource.k8s.cluster.name": "prod",
            "resource.k8s.namespace.name": "payments",
          },
        ],
      }),
    );

    expect(attributesOf(snapshot, 0)).toEqual({
      "resource.k8s.node.name": "node-1",
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    });
    expect(attributesOf(snapshot, 1)).toEqual({
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    });
    expect(snapshot.metricViewData?.formulaConfigs).toEqual([FORMULA]);
  });

  test("Proxmox: the cluster and its node; everything else about the query is kept", () => {
    const query: MetricQueryConfigData = queryOf({
      metricName: "pve_cpu_usage_ratio",
    });

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [query],
        queryAttributes: [
          {
            "resource.proxmox.cluster.name": "pve-prod",
            "pve.scope": "node",
            "pve.id": "pve1",
          },
        ],
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs).toEqual([
      {
        ...query,
        metricQueryData: {
          ...query.metricQueryData,
          filterData: {
            ...query.metricQueryData.filterData,
            attributes: {
              "resource.proxmox.cluster.name": "pve-prod",
              "pve.scope": "node",
              "pve.id": "pve1",
            },
          },
        },
      },
    ]);
    expect(snapshot.telemetryType).toBe(TelemetryType.Metric);
    expect(snapshot.telemetryQuery).toBeNull();
    expect(snapshot.metricViewData?.startAndEndDate).toBe(WINDOW);
  });

  test("the monitor's filter wins where it names an attribute the query also filters on, as the worker read it", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [
          queryOf({ attributes: { "resource.k8s.cluster.name": "old" } }),
        ],
        queryAttributes: [{ "resource.k8s.cluster.name": "prod" }],
      }),
    );

    expect(attributesOf(snapshot)).toEqual({
      "resource.k8s.cluster.name": "prod",
    });
  });

  test("a query read with nothing keeps no filter map at all", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [queryOf({ attributes: { stale: "x" } })],
        queryAttributes: [undefined],
      }),
    );

    expect(
      Object.keys(snapshot.metricViewData!.queryConfigs[0]!.metricQueryData.filterData),
    ).not.toContain("attributes");
    expect(snapshot.metricQueriesAsRead).toBe(true);
  });
});

describe("a Metrics monitor's snapshot is as it was", () => {
  test("each query is the step's own, the same object, read with its own filters", () => {
    const filtered: MetricQueryConfigData = queryOf({
      attributes: { "resource.service.name": "checkout" },
    });
    const unfiltered: MetricQueryConfigData = queryOf({
      variable: "b",
      attributes: {},
    });
    const bare: MetricQueryConfigData = queryOf({ variable: "c" });

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [filtered, unfiltered, bare],
        // What the Metrics worker says: its own filters, or none.
        queryAttributes: [
          filtered.metricQueryData.filterData.attributes as never,
          undefined,
          undefined,
        ],
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs[0]).toBe(filtered);
    expect(snapshot.metricViewData?.queryConfigs[1]).toBe(unfiltered);
    expect(snapshot.metricViewData?.queryConfigs[2]).toBe(bare);
  });

  test("an equal copy of its own filters keeps the query as it is too", () => {
    const query: MetricQueryConfigData = queryOf({
      attributes: { "resource.service.name": "checkout" },
    });

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [query],
        queryAttributes: [{ "resource.service.name": "checkout" }],
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs[0]).toBe(query);
  });
});

describe("a response that does not say what it read with keeps the step's queries, unmarked", () => {
  test.each([
    ["no reads", undefined],
    ["not a list", "garbage" as never],
    ["fewer reads than queries", [{ "resource.host.name": "web-01" }]],
  ])("%s", (_name: string, queryAttributes: unknown) => {
    const first: MetricQueryConfigData = queryOf({});
    const second: MetricQueryConfigData = queryOf({ variable: "b" });
    const queryConfigs: Array<MetricQueryConfigData> = [first, second];

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: queryConfigs,
        queryAttributes: queryAttributes as never,
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs).toBe(queryConfigs);
    expect(snapshot.metricQueriesAsRead).toBeUndefined();
    expect("metricQueriesAsRead" in snapshot).toBe(false);
    expect(MetricTelemetrySnapshot.isAsRead(snapshot)).toBe(false);
  });

  test("a stored query that is not a query stays where it is", () => {
    const query: MetricQueryConfigData = queryOf({});

    expect(
      MetricTelemetrySnapshot.getReadQueryConfigs({
        queryConfigs: [null as never, query],
        queryAttributes: [{ a: "1" }, { "resource.host.name": "web-01" }],
      }),
    ).toEqual([
      null,
      {
        ...query,
        metricQueryData: {
          ...query.metricQueryData,
          filterData: {
            ...query.metricQueryData.filterData,
            attributes: { "resource.host.name": "web-01" },
          },
        },
      },
    ]);
    expect(
      MetricTelemetrySnapshot.getReadQueryConfigs({
        queryConfigs: undefined,
        queryAttributes: [],
      }),
    ).toBeNull();
  });
});

describe("operator-valued scopes survive being stored and read back", () => {
  /*
   * The event's JSON column is written with JSON.stringify (each operator's
   * toJSON) and the incident and alert pages read it back with
   * JSONFunctions.deserialize.
   */
  const storeAndRead: (snapshot: TelemetryQuery) => TelemetryQuery = (
    snapshot: TelemetryQuery,
  ): TelemetryQuery => {
    return JSONFunctions.deserialize(
      JSON.parse(JSON.stringify(snapshot)),
    ) as unknown as TelemetryQuery;
  };

  test("Docker Swarm's image globs and tasks-only filter, and an IoT fleet", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [queryOf({}), queryOf({ variable: "b" })],
        queryAttributes: [
          {
            "resource.docker.swarm.cluster.name": "swarm-1",
            "resource.container.image.name": new Wildcard<string>([
              "nginx",
              "nginx@*",
            ]),
            "resource.docker.swarm.task.id": new NotNull(),
          },
          {
            "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
          },
        ],
      }),
    );

    const readBack: TelemetryQuery = storeAndRead(snapshot);
    const swarm: Dictionary<unknown> = attributesOf(readBack, 0) as Dictionary<
      unknown
    >;
    const iot: Dictionary<unknown> = attributesOf(readBack, 1) as Dictionary<
      unknown
    >;

    expect(swarm["resource.docker.swarm.cluster.name"]).toBe("swarm-1");
    expect(swarm["resource.container.image.name"]).toBeInstanceOf(Wildcard);
    expect(
      (swarm["resource.container.image.name"] as Wildcard<string>).values,
    ).toEqual(["nginx", "nginx@*"]);
    expect(swarm["resource.docker.swarm.task.id"]).toBeInstanceOf(NotNull);
    expect(iot["resource.iot.fleet.name"]).toBeInstanceOf(Wildcard);
    expect((iot["resource.iot.fleet.name"] as Wildcard<string>).values).toEqual(
      ["Sensors"],
    );
    expect(readBack.metricQueriesAsRead).toBe(true);
  });

  test("what is stored is the operators' own JSON", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [queryOf({})],
        queryAttributes: [
          {
            "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
            "resource.docker.swarm.task.id": new NotNull(),
          },
        ],
      }),
    );

    expect(
      JSON.parse(JSON.stringify(snapshot)).metricViewData.queryConfigs[0]
        .metricQueryData.filterData.attributes,
    ).toEqual({
      "resource.iot.fleet.name": { _type: "Wildcard", value: ["Sensors"] },
      "resource.docker.swarm.task.id": { _type: "NotNull", value: null },
    });
  });
});

describe("whatever a check read (seeded)", () => {
  test("each query keeps exactly what it was read with, and nothing it is handed changes", () => {
    const random: SeededRandom = seededRandom(6265);

    for (let round: number = 0; round < 300; round++) {
      const count: number = 1 + random(3);
      const queryConfigs: Array<MetricQueryConfigData> = [];
      const queryAttributes: Array<Dictionary<unknown> | undefined> = [];

      for (let index: number = 0; index < count; index++) {
        const own: Dictionary<unknown> = {};
        for (let key: number = 0; key < random(3); key++) {
          own[`own.${key}`] = `v${random(4)}`;
        }
        queryConfigs.push(
          queryOf({
            variable: String.fromCharCode(97 + index),
            attributes: random(2) === 0 ? undefined : own,
          }),
        );

        const read: Dictionary<unknown> = { ...own };
        for (let key: number = 0; key < random(3); key++) {
          read[`scope.${key}`] = `s${random(4)}`;
        }
        queryAttributes.push(
          Object.keys(read).length === 0 && random(2) === 0 ? undefined : read,
        );
      }

      const before: string = JSON.stringify({ queryConfigs, queryAttributes });

      const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
        responseOf({ queryConfigs, queryAttributes }),
      );

      expect(snapshot.metricViewData?.queryConfigs).toHaveLength(count);
      for (let index: number = 0; index < count; index++) {
        expect(attributesOf(snapshot, index) || {}).toEqual(
          queryAttributes[index] || {},
        );
        expect(
          snapshot.metricViewData?.queryConfigs[index]?.metricAliasData,
        ).toEqual(queryConfigs[index]!.metricAliasData);
      }
      expect(JSON.stringify({ queryConfigs, queryAttributes })).toBe(before);
    }
  });
});

describe("telling a snapshot stored before apart", () => {
  test.each([
    ["no snapshot", null, false],
    [
      "a metric snapshot stored before",
      {
        telemetryType: TelemetryType.Metric,
        telemetryQuery: null,
        metricViewData: null,
      },
      false,
    ],
    [
      "a metric snapshot kept as read",
      {
        telemetryType: TelemetryType.Metric,
        telemetryQuery: null,
        metricViewData: null,
        metricQueriesAsRead: true,
      },
      true,
    ],
    [
      "a log snapshot that says so, which no metric card reads",
      {
        telemetryType: TelemetryType.Log,
        telemetryQuery: null,
        metricViewData: null,
        metricQueriesAsRead: true,
      },
      false,
    ],
    [
      "a mark that is not true",
      {
        telemetryType: TelemetryType.Metric,
        telemetryQuery: null,
        metricViewData: null,
        metricQueriesAsRead: "yes",
      },
      false,
    ],
  ])("%s", (_name: string, snapshot: unknown, isAsRead: boolean) => {
    expect(MetricTelemetrySnapshot.isAsRead(snapshot as TelemetryQuery)).toBe(
      isAsRead,
    );
  });
});
