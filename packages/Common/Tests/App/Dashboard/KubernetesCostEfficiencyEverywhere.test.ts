/** @timezone UTC */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import ObjectID from "../../../Types/ObjectID";
import {
  getKubernetesCostEfficiencyWeight,
  getKubernetesCostWeightedEfficiency,
} from "../../../Types/Kubernetes/KubernetesCostEfficiency";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #9635: the cluster overview's Cost card and the Costs pages showed two
 * different efficiencies for the same cluster and hours. The card weighted
 * each workload by its cost; the Costs pages averaged the rows, and the
 * project page averaged the idle rows in at 0%.
 *
 * Here every page reads one table of rows through a stand-in for
 * ClickHouse that adds them up as the aggregate reads ask, so the test
 * holds the pages to the same answer for the same rows, not to the shape of
 * the queries.
 */

const mockAggregate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return mockAggregate(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import {
  ClusterCostRow,
  NamespaceCostRow,
  WorkloadCostRow,
  fetchClusterBreakdown,
  fetchNamespaceBreakdown,
  fetchWorkloadBreakdown,
  toCostEfficiencies,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils";
import {
  KubernetesCostOverview,
  fetchKubernetesCostOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview";

const NOW: Date = new Date("2026-11-18T12:30:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const CLUSTER_ID: ObjectID = new ObjectID(
  "0193c0de-8888-4aaa-8bbb-000000000008",
);

interface StoredRow {
  clusterName: string;
  windowStart: Date;
  namespace: string;
  controllerKind: string;
  controllerName: string;
  totalCost: number;
  cpuCost: number;
  ramCost: number;
  pvCost: number;
  totalEfficiency: number;
  // As ingest stores them.
  efficiencyWeight: number;
  weightedEfficiency: number;
  [column: string]: unknown;
}

function stored(row: {
  namespace: string;
  controllerName?: string;
  cpuCost: number;
  ramCost: number;
  pvCost?: number;
  totalEfficiency: number;
  hoursAgo?: number;
}): StoredRow {
  const pvCost: number = row.pvCost || 0;

  return {
    clusterName: "prod-eu",
    windowStart: new Date(NOW.getTime() - (row.hoursAgo || 2) * HOUR_MS),
    namespace: row.namespace,
    controllerKind: row.controllerName ? "deployment" : "",
    controllerName: row.controllerName || "",
    totalCost: row.cpuCost + row.ramCost + pvCost,
    cpuCost: row.cpuCost,
    ramCost: row.ramCost,
    pvCost: pvCost,
    totalEfficiency: row.totalEfficiency,
    efficiencyWeight: getKubernetesCostEfficiencyWeight(row),
    weightedEfficiency: getKubernetesCostWeightedEfficiency(row),
  };
}

/*
 * What ClickHouse answers an aggregate read with, for the rows above: the
 * sum (or average) of the column per group, per hour or for the whole
 * window, honouring the read's namespace filter.
 */
function answer(rows: Array<StoredRow>, aggregateBy: any): AggregatedResult {
  const groupColumns: Array<string> = Object.keys(aggregateBy.groupBy || {});
  const namespaceFilter: unknown = aggregateBy.query?.namespace;
  const groups: Map<
    string,
    { item: Record<string, unknown>; values: Array<number> }
  > = new Map();

  for (const row of rows) {
    if (
      typeof namespaceFilter === "string" &&
      row.namespace !== namespaceFilter
    ) {
      continue;
    }

    const bucket: number =
      aggregateBy.aggregationInterval === AggregationInterval.Hour
        ? row.windowStart.getTime()
        : 0;
    const key: string = JSON.stringify([
      bucket,
      ...groupColumns.map((column: string): unknown => {
        return row[column];
      }),
    ]);

    let group:
      | { item: Record<string, unknown>; values: Array<number> }
      | undefined = groups.get(key);

    if (!group) {
      group = {
        item: { timestamp: new Date(bucket || NOW.getTime()) },
        values: [],
      };

      for (const column of groupColumns) {
        group.item[column] = row[column];
      }

      groups.set(key, group);
    }

    group.values.push(Number(row[aggregateBy.aggregateColumnName]));
  }

  return {
    data: Array.from(groups.values()).map(
      (group: {
        item: Record<string, unknown>;
        values: Array<number>;
      }): AggregatedModel => {
        const sum: number = group.values.reduce((a: number, b: number) => {
          return a + b;
        }, 0);

        return {
          ...group.item,
          value:
            aggregateBy.aggregationType === AggregationType.Avg
              ? sum / group.values.length
              : sum,
        } as unknown as AggregatedModel;
      },
    ),
  };
}

function serve(rows: Array<StoredRow>): void {
  mockAggregate.mockReset();
  mockAggregate.mockImplementation(((request: { aggregateBy: any }) => {
    return Promise.resolve(answer(rows, request.aggregateBy));
  }) as never);
}

const PARAMS: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
} = {
  kubernetesClusterId: CLUSTER_ID,
  startDate: new Date(NOW.getTime() - 24 * HOUR_MS),
  endDate: NOW,
};

/*
 * A cluster whose money is mostly one well-used service, with a one-cent
 * job that used nothing, a database whose bill is mostly storage, and idle
 * capacity.
 */
const ROWS: Array<StoredRow> = [
  stored({
    namespace: "shop",
    controllerName: "checkout",
    cpuCost: 6,
    ramCost: 3,
    totalEfficiency: 0.8,
  }),
  stored({
    namespace: "shop",
    controllerName: "checkout",
    cpuCost: 6,
    ramCost: 3,
    totalEfficiency: 0.7,
    hoursAgo: 3,
  }),
  stored({
    namespace: "shop",
    controllerName: "cleanup",
    cpuCost: 0.005,
    ramCost: 0.005,
    totalEfficiency: 0,
  }),
  stored({
    namespace: "db",
    controllerName: "postgres",
    cpuCost: 1,
    ramCost: 1,
    pvCost: 40,
    totalEfficiency: 0.3,
  }),
  stored({
    namespace: "__idle__",
    cpuCost: 20,
    ramCost: 10,
    totalEfficiency: 0,
  }),
];

function expectedEfficiency(rows: Array<StoredRow>): number {
  let weighted: number = 0;
  let weight: number = 0;

  for (const row of rows) {
    if (row.namespace === "__idle__") {
      continue;
    }

    weighted += row.totalEfficiency * (row.cpuCost + row.ramCost);
    weight += row.cpuCost + row.ramCost;
  }

  return weighted / weight;
}

describe("one efficiency on every page (#9635)", () => {
  beforeEach(() => {
    serve(ROWS);
  });

  test("the overview's card and the project's Costs page read the same figure for the same hours", async () => {
    const overview: KubernetesCostOverview = await fetchKubernetesCostOverview({
      kubernetesClusterId: CLUSTER_ID,
      now: NOW,
    });
    const clusters: Array<ClusterCostRow> = await fetchClusterBreakdown({
      startDate: PARAMS.startDate,
      endDate: PARAMS.endDate,
    });

    expect(clusters).toHaveLength(1);
    expect(overview.efficiency).toBeCloseTo(expectedEfficiency(ROWS), 12);
    expect(clusters[0]!.efficiency).toBeCloseTo(overview.efficiency!, 12);
  });

  test("the cluster's figure is its namespaces' figures weighted by their CPU and memory cost", async () => {
    const namespaces: Array<NamespaceCostRow> =
      await fetchNamespaceBreakdown(PARAMS);
    const overview: KubernetesCostOverview = await fetchKubernetesCostOverview({
      kubernetesClusterId: CLUSTER_ID,
      now: NOW,
    });

    let weighted: number = 0;
    let weight: number = 0;

    for (const namespace of namespaces) {
      if (namespace.efficiency === null) {
        continue;
      }

      weighted +=
        namespace.efficiency * (namespace.cpuCost + namespace.ramCost);
      weight += namespace.cpuCost + namespace.ramCost;
    }

    expect(weighted / weight).toBeCloseTo(overview.efficiency!, 12);
  });

  test("a namespace's figure counts each of its rows by what its CPU and memory cost", async () => {
    const shop: NamespaceCostRow | undefined = (
      await fetchNamespaceBreakdown(PARAMS)
    ).find((row: NamespaceCostRow): boolean => {
      return row.namespace === "shop";
    });

    // (0.8 x 9 + 0.7 x 9 + 0 x 0.01) / 18.01: the one-cent job barely moves it.
    expect(shop!.efficiency).toBeCloseTo((0.8 * 9 + 0.7 * 9) / 18.01, 12);
    // A plain average of the three rows would say 50%.
    expect(shop!.efficiency).toBeGreaterThan(0.74);
  });

  test("a workload's storage does not weigh in its efficiency", async () => {
    const postgres: WorkloadCostRow | undefined = (
      await fetchWorkloadBreakdown(PARAMS)
    ).find((row: WorkloadCostRow): boolean => {
      return row.controllerName === "postgres";
    });

    expect(postgres!.totalCost).toBe(42);
    expect(postgres!.efficiency).toBeCloseTo(0.3, 12);
  });

  test("idle capacity has no efficiency, rather than 0%", async () => {
    const idle: NamespaceCostRow | undefined = (
      await fetchNamespaceBreakdown(PARAMS)
    ).find((row: NamespaceCostRow): boolean => {
      return row.namespace === "__idle__";
    });

    expect(idle!.totalCost).toBe(30);
    expect(idle!.efficiency).toBeNull();
  });

  test("no page asks for an average of totalEfficiency any more", async () => {
    await fetchKubernetesCostOverview({
      kubernetesClusterId: CLUSTER_ID,
      now: NOW,
    });
    await fetchNamespaceBreakdown(PARAMS);
    await fetchWorkloadBreakdown(PARAMS);
    await fetchClusterBreakdown(PARAMS);

    const columns: Array<string> = mockAggregate.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { aggregateBy: any }).aggregateBy
          .aggregateColumnName;
      },
    );

    expect(columns).not.toContain("totalEfficiency");
    expect(
      mockAggregate.mock.calls.every((call: Array<unknown>): boolean => {
        return (
          (call[0] as { aggregateBy: any }).aggregateBy.aggregationType !==
          AggregationType.Avg
        );
      }),
    ).toBe(true);
  });
});

describe("toCostEfficiencies", () => {
  function result(rows: Array<Record<string, unknown>>): AggregatedResult {
    return {
      data: rows.map((row: Record<string, unknown>): AggregatedModel => {
        return { timestamp: NOW, ...row } as unknown as AggregatedModel;
      }),
    };
  }

  test("divides each group's weighted sum by its weight", () => {
    const efficiencies: Map<string, number | null> = toCostEfficiencies(
      {
        weightedEfficiency: result([
          { namespace: "a", value: 3 },
          { namespace: "b", value: 1 },
        ]),
        efficiencyWeight: result([
          { namespace: "a", value: 4 },
          { namespace: "b", value: 2 },
        ]),
      },
      ["namespace"],
    );

    expect(efficiencies.get("a")).toBe(0.75);
    expect(efficiencies.get("b")).toBe(0.5);
  });

  test("gives a group with no weight no figure, and a group the other read lacks a figure from what there is", () => {
    const efficiencies: Map<string, number | null> = toCostEfficiencies(
      {
        weightedEfficiency: result([{ namespace: "__idle__", value: 0 }]),
        efficiencyWeight: result([
          { namespace: "__idle__", value: 0 },
          { namespace: "quiet", value: 2 },
        ]),
      },
      ["namespace"],
    );

    expect(efficiencies.get("__idle__")).toBeNull();
    // Weighed, and nothing of it was used.
    expect(efficiencies.get("quiet")).toBe(0);
  });

  test("keys a read with no group columns as the empty key", () => {
    expect(
      toCostEfficiencies(
        {
          weightedEfficiency: result([{ value: 1.2 }]),
          efficiencyWeight: result([{ value: 1 }]),
        },
        [],
      ).get(""),
    ).toBe(1.2);
  });

  test("is empty when there are no rows", () => {
    expect(
      toCostEfficiencies(
        { weightedEfficiency: result([]), efficiencyWeight: result([]) },
        ["namespace"],
      ).size,
    ).toBe(0);
  });
});
