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
 * opened it. Its queries as the step keeps them, and beside each one the
 * filters the monitor added when it read it - the cluster, host or fleet an
 * infrastructure monitor narrows it to - so the event's card charts the
 * resource the monitor watches, not every one in the project, while what
 * reads the queries' own filters (the event's Logs, Traces and Exceptions
 * tabs) reads what it always did.
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

// The snapshot's queries as the event's card charts them.
const chartedOf: (snapshot: TelemetryQuery) => Array<MetricQueryConfigData> = (
  snapshot: TelemetryQuery,
): Array<MetricQueryConfigData> => {
  return MetricTelemetrySnapshot.applyScopes({
    queryConfigs: snapshot.metricViewData!.queryConfigs,
    scopes: MetricTelemetrySnapshot.getStoredScopes(snapshot)!,
  });
};

const attributesOf: (
  queryConfigs: Array<MetricQueryConfigData>,
  index?: number,
) => unknown = (
  queryConfigs: Array<MetricQueryConfigData>,
  index: number = 0,
): unknown => {
  return queryConfigs[index]?.metricQueryData.filterData.attributes;
};

describe("an infrastructure check's snapshot keeps the resource each query was read for", () => {
  test("Host: the host, beside the query; the query as the step keeps it", () => {
    const query: MetricQueryConfigData = queryOf({});

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [query],
        queryAttributes: [{ "resource.host.name": "web-01" }],
      }),
    );

    expect(snapshot.metricQueryScopes).toEqual([
      { "resource.host.name": "web-01" },
    ]);
    expect(snapshot.metricViewData?.queryConfigs[0]).toBe(query);
    expect(attributesOf(chartedOf(snapshot))).toEqual({
      "resource.host.name": "web-01",
    });
  });

  test("Kubernetes: the cluster and resource filters, beside each query's own filters", () => {
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

    // Only what the monitor added: the query's own filter is its own.
    expect(snapshot.metricQueryScopes).toEqual([
      {
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.namespace.name": "payments",
      },
      {
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.namespace.name": "payments",
      },
    ]);
    expect(attributesOf(chartedOf(snapshot), 0)).toEqual({
      "resource.k8s.node.name": "node-1",
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
    });
    expect(snapshot.metricViewData?.formulaConfigs).toEqual([FORMULA]);
  });

  test("Proxmox: the cluster and its node; the window and the rest as they were", () => {
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

    expect(chartedOf(snapshot)).toEqual([
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

  test("a filter of the query's own the monitor read with another value is part of its scope", () => {
    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: [
          queryOf({ attributes: { "resource.k8s.cluster.name": "old" } }),
        ],
        queryAttributes: [{ "resource.k8s.cluster.name": "prod" }],
      }),
    );

    expect(snapshot.metricQueryScopes).toEqual([
      { "resource.k8s.cluster.name": "prod" },
    ]);
    expect(attributesOf(chartedOf(snapshot))).toEqual({
      "resource.k8s.cluster.name": "prod",
    });
  });
});

describe("a Metrics monitor's snapshot is as it was", () => {
  test("its queries are the step's own, the same objects, with no scope beside them", () => {
    const filtered: MetricQueryConfigData = queryOf({
      attributes: { "resource.service.name": "checkout" },
    });
    const unfiltered: MetricQueryConfigData = queryOf({
      variable: "b",
      attributes: {},
    });
    const bare: MetricQueryConfigData = queryOf({ variable: "c" });
    const queryConfigs: Array<MetricQueryConfigData> = [
      filtered,
      unfiltered,
      bare,
    ];

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: queryConfigs,
        // What the Metrics worker says: its own filters, or none.
        queryAttributes: [
          filtered.metricQueryData.filterData.attributes as never,
          undefined,
          undefined,
        ],
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs).toBe(queryConfigs);
    expect(snapshot.metricQueryScopes).toEqual([null, null, null]);
    // Charted as they are: the very same list.
    expect(chartedOf(snapshot)).toBe(queryConfigs);
  });

  test("an equal copy of its own filters adds nothing", () => {
    expect(
      MetricTelemetrySnapshot.getQueryScopes({
        queryConfigs: [
          queryOf({ attributes: { "resource.service.name": "checkout" } }),
        ],
        queryAttributes: [{ "resource.service.name": "checkout" }],
      }),
    ).toEqual([null]);
  });
});

describe("a response that does not say what it read with keeps no scopes, as before", () => {
  test.each([
    ["no reads", undefined],
    ["not a list", "garbage" as never],
    ["fewer reads than queries", [{ "resource.host.name": "web-01" }]],
  ])("%s", (_name: string, queryAttributes: unknown) => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      queryOf({}),
      queryOf({ variable: "b" }),
    ];

    const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
      responseOf({
        queryConfigs: queryConfigs,
        queryAttributes: queryAttributes as never,
      }),
    );

    expect(snapshot.metricViewData?.queryConfigs).toBe(queryConfigs);
    expect("metricQueryScopes" in snapshot).toBe(false);
    expect(MetricTelemetrySnapshot.getStoredScopes(snapshot)).toBeNull();
  });

  test("a stored query that is not a query has no scope", () => {
    expect(
      MetricTelemetrySnapshot.getQueryScopes({
        queryConfigs: [null as never, queryOf({})],
        queryAttributes: [{ a: "1" }, { "resource.host.name": "web-01" }],
      }),
    ).toEqual([{ a: "1" }, { "resource.host.name": "web-01" }]);
    expect(
      MetricTelemetrySnapshot.getQueryScopes({
        queryConfigs: undefined,
        queryAttributes: [],
      }),
    ).toBeNull();
  });
});

describe("the scopes a stored snapshot keeps", () => {
  const stored: (data: Partial<TelemetryQuery>) => TelemetryQuery = (
    data: Partial<TelemetryQuery>,
  ): TelemetryQuery => {
    return {
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: {
        startAndEndDate: WINDOW,
        queryConfigs: [queryOf({}), queryOf({ variable: "b" })],
        formulaConfigs: [],
      },
      ...data,
    };
  };

  test.each([
    ["no snapshot", null, null],
    ["one stored before #6265", stored({}), null],
    [
      "scopes that do not line up with the queries",
      stored({ metricQueryScopes: [{ a: "1" }] }),
      null,
    ],
    [
      "scopes that are not a list",
      stored({ metricQueryScopes: "x" as never }),
      null,
    ],
    [
      "a log snapshot, which no metric card reads",
      stored({
        telemetryType: TelemetryType.Log,
        metricQueryScopes: [null, null],
      }),
      null,
    ],
    [
      "one per query, an empty or broken one read as none",
      stored({ metricQueryScopes: [{ a: "1" }, {} as never] }),
      [{ a: "1" }, null],
    ],
    [
      "none added to any query",
      stored({ metricQueryScopes: [null, "x" as never] }),
      [null, null],
    ],
  ])("%s", (_name: string, snapshot: unknown, expected: unknown) => {
    expect(
      MetricTelemetrySnapshot.getStoredScopes(snapshot as TelemetryQuery),
    ).toEqual(expected);
  });
});

describe("charting each query with its scope", () => {
  test("the scope over the query's own filters and its series filter, as the check read it", () => {
    const query: MetricQueryConfigData = queryOf({
      attributes: {
        "resource.k8s.node.name": "node-7",
        "resource.k8s.cluster.name": "typed",
      },
    });

    const [charted] = MetricTelemetrySnapshot.applyScopes({
      queryConfigs: [query],
      scopes: [{ "resource.k8s.cluster.name": "prod" }],
    });

    expect(attributesOf([charted!])).toEqual({
      "resource.k8s.node.name": "node-7",
      "resource.k8s.cluster.name": "prod",
    });
    // A copy: the query it was handed is left as it was.
    expect(query.metricQueryData.filterData.attributes).toEqual({
      "resource.k8s.node.name": "node-7",
      "resource.k8s.cluster.name": "typed",
    });
  });

  test("a query with no scope, or one it reads already, is kept as it is", () => {
    const first: MetricQueryConfigData = queryOf({});
    const second: MetricQueryConfigData = queryOf({
      variable: "b",
      attributes: { "resource.host.name": "web-01" },
    });
    const queryConfigs: Array<MetricQueryConfigData> = [first, second];

    expect(
      MetricTelemetrySnapshot.applyScopes({
        queryConfigs: queryConfigs,
        scopes: [null, { "resource.host.name": "web-01" }],
      }),
    ).toBe(queryConfigs);

    const mixed: Array<MetricQueryConfigData> =
      MetricTelemetrySnapshot.applyScopes({
        queryConfigs: queryConfigs,
        scopes: [{ "resource.host.name": "web-01" }, null],
      });
    expect(mixed).not.toBe(queryConfigs);
    expect(mixed[1]).toBe(second);
  });

  test("what is not a query, and scopes that run out, leave the queries be", () => {
    const query: MetricQueryConfigData = queryOf({});
    const queryConfigs: Array<MetricQueryConfigData> = [null as never, query];

    expect(
      MetricTelemetrySnapshot.applyScopes({
        queryConfigs: queryConfigs,
        scopes: [{ a: "1" }],
      }),
    ).toBe(queryConfigs);
  });
});

describe("operator-valued scopes survive being stored and read back", () => {
  /*
   * The event's JSON column is written with JSON.stringify (each operator's
   * toJSON), and the incident and alert pages read it back with
   * JSONFunctions.deserialize.
   */
  const storeAndRead: (snapshot: TelemetryQuery) => TelemetryQuery = (
    snapshot: TelemetryQuery,
  ): TelemetryQuery => {
    return JSONFunctions.deserialize(
      JSON.parse(JSON.stringify(snapshot)),
    ) as unknown as TelemetryQuery;
  };

  const swarmAndIoT: () => TelemetryQuery = (): TelemetryQuery => {
    return MetricTelemetrySnapshot.fromResponse(
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
  };

  test("Docker Swarm's image globs and tasks-only filter, and an IoT fleet", () => {
    const readBack: TelemetryQuery = storeAndRead(swarmAndIoT());
    const charted: Array<MetricQueryConfigData> = chartedOf(readBack);
    const swarm: Dictionary<unknown> = attributesOf(
      charted,
      0,
    ) as Dictionary<unknown>;
    const iot: Dictionary<unknown> = attributesOf(
      charted,
      1,
    ) as Dictionary<unknown>;

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
  });

  test("what is stored is the operators' own JSON", () => {
    expect(JSON.parse(JSON.stringify(swarmAndIoT())).metricQueryScopes).toEqual(
      [
        {
          "resource.docker.swarm.cluster.name": "swarm-1",
          "resource.container.image.name": {
            _type: "Wildcard",
            value: ["nginx", "nginx@*"],
          },
          "resource.docker.swarm.task.id": { _type: "NotNull", value: null },
        },
        {
          "resource.iot.fleet.name": { _type: "Wildcard", value: ["Sensors"] },
        },
      ],
    );
  });
});

describe("whatever a check read (seeded)", () => {
  test("each query is charted with exactly what it was read with, and nothing it is handed changes", () => {
    const random: SeededRandom = seededRandom(6265);

    for (let round: number = 0; round < 300; round++) {
      const count: number = 1 + random(3);
      const queryConfigs: Array<MetricQueryConfigData> = [];
      const queryAttributes: Array<Dictionary<unknown> | undefined> = [];

      for (let index: number = 0; index < count; index++) {
        const own: Dictionary<unknown> = {};
        const ownCount: number = random(3);
        for (let key: number = 0; key < ownCount; key++) {
          own[`own.${key}`] = `v${random(4)}`;
        }
        queryConfigs.push(
          queryOf({
            variable: String.fromCharCode(97 + index),
            ...(random(2) === 0 ? {} : { attributes: own }),
          }),
        );

        // The worker starts from the query's own filters and adds its scope.
        const read: Dictionary<unknown> = { ...own };
        const scopeCount: number = random(3);
        for (let key: number = 0; key < scopeCount; key++) {
          read[random(2) === 0 ? `scope.${key}` : `own.${key}`] =
            `s${random(4)}`;
        }
        queryAttributes.push(
          Object.keys(read).length === 0 && random(2) === 0 ? undefined : read,
        );
      }

      const before: string = JSON.stringify({ queryConfigs, queryAttributes });

      const snapshot: TelemetryQuery = MetricTelemetrySnapshot.fromResponse(
        responseOf({ queryConfigs, queryAttributes }),
      );
      const charted: Array<MetricQueryConfigData> = chartedOf(snapshot);

      expect(snapshot.metricViewData?.queryConfigs).toBe(queryConfigs);
      expect(charted).toHaveLength(count);
      for (let index: number = 0; index < count; index++) {
        // Only the reads of queries that had their own filters are complete.
        const own: Dictionary<unknown> =
          (queryConfigs[index]!.metricQueryData.filterData
            .attributes as Dictionary<unknown>) || {};
        expect(attributesOf(charted, index) || {}).toEqual({
          ...own,
          ...(queryAttributes[index] || {}),
        });
      }
      expect(JSON.stringify({ queryConfigs, queryAttributes })).toBe(before);
    }
  });
});
