/** @timezone UTC */
import { describe, expect, jest, test } from "@jest/globals";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What a Kubernetes cluster's overview says about its cost (#9548): spend
 * and idle spend of the last 24 hours, the workloads' cost-weighted
 * efficiency, the monthly run-rate from the last 7 days, and the costliest
 * namespaces and workloads - worked out from four aggregate reads.
 */

const mockAggregate: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return mockAggregate(...args);
      },
      getList: (...args: Array<unknown>) => {
        return mockGetList(...args);
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
  COST_OVERVIEW_TOP_ROWS,
  HOURS_PER_MONTH,
  KubernetesCostOverview,
  buildKubernetesCostOverview,
  fetchKubernetesCostOverview,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview";
import { CostEfficiencyReads } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils";

const NOW: Date = new Date("2026-11-18T12:30:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

function result(rows: Array<Record<string, unknown>>): AggregatedResult {
  return {
    data: rows.map((row: Record<string, unknown>): AggregatedModel => {
      return {
        timestamp: NOW,
        value: 0,
        ...row,
      } as unknown as AggregatedModel;
    }),
  };
}

function hourly(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number, index: number): AggregatedModel => {
      return {
        timestamp: new Date(NOW.getTime() - (values.length - index) * HOUR_MS),
        value: value,
      } as AggregatedModel;
    }),
  };
}

function workload(
  namespace: string,
  controllerName: string,
  value: number,
  controllerKind: string = "deployment",
): Record<string, unknown> {
  return { namespace, controllerKind, controllerName, value };
}

/*
 * The cluster's two efficiency sums as the aggregate reads return them: one
 * whole-window row each, with no group columns.
 */
function efficiencySums(sums: {
  weightedEfficiency: number;
  weight: number;
}): CostEfficiencyReads {
  return {
    weightedEfficiency: result([{ value: sums.weightedEfficiency }]),
    efficiencyWeight: result([{ value: sums.weight }]),
  };
}

function build(data: {
  namespaceSpend?: AggregatedResult;
  workloadSpend?: AggregatedResult;
  efficiency?: CostEfficiencyReads;
  hourlySpend?: AggregatedResult;
}): KubernetesCostOverview {
  return buildKubernetesCostOverview({
    namespaceSpend: data.namespaceSpend || result([]),
    workloadSpend: data.workloadSpend || result([]),
    efficiency: data.efficiency || {
      weightedEfficiency: result([]),
      efficiencyWeight: result([]),
    },
    hourlySpend: data.hourlySpend || hourly([]),
  });
}

describe("buildKubernetesCostOverview", () => {
  test("says a cluster that sent nothing in a week has no cost data", () => {
    const overview: KubernetesCostOverview = build({});

    expect(overview.hasData).toBe(false);
    expect(overview.hasRecentData).toBe(false);
    expect(overview.newestWindowStart).toBeNull();
    expect(overview.monthlyRunRate).toBeNull();
    expect(overview.idlePercent).toBeNull();
    expect(overview.efficiency).toBeNull();
    expect(overview.topNamespaces).toEqual([]);
    expect(overview.topWorkloads).toEqual([]);
  });

  test("adds up the last day's spend, idle and unallocated capacity included, and splits the idle out", () => {
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([
        { namespace: "shop", value: 30 },
        { namespace: "payments", value: 20 },
        { namespace: "__idle__", value: 40 },
        { namespace: "__unallocated__", value: 10 },
      ]),
      hourlySpend: hourly([4, 4]),
    });

    expect(overview.hasData).toBe(true);
    expect(overview.hasRecentData).toBe(true);
    expect(overview.lastDaySpend).toBe(100);
    expect(overview.lastDayIdleSpend).toBe(50);
    expect(overview.idlePercent).toBe(50);
  });

  test("lists the costliest namespaces, never the idle capacity, most first, at most five", () => {
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([
        { namespace: "a", value: 1 },
        { namespace: "b", value: 7 },
        { namespace: "__idle__", value: 100 },
        { namespace: "c", value: 3 },
        { namespace: "d", value: 5 },
        { namespace: "e", value: 2 },
        { namespace: "f", value: 6 },
        { namespace: "nothing", value: 0 },
      ]),
    });

    expect(COST_OVERVIEW_TOP_ROWS).toBe(5);
    expect(
      overview.topNamespaces.map((row: { namespace: string }): string => {
        return row.namespace;
      }),
    ).toEqual(["b", "f", "d", "c", "e"]);
  });

  test("lists the costliest workloads, leaving out the idle capacity's rows", () => {
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "shop", value: 10 }]),
      workloadSpend: result([
        workload("shop", "checkout", 6),
        workload("shop", "cart", 3, "statefulset"),
        workload("__idle__", "", 50, ""),
        workload("jobs", "nightly", 1, "job"),
      ]),
    });

    expect(overview.topWorkloads).toEqual([
      {
        namespace: "shop",
        controllerKind: "deployment",
        controllerName: "checkout",
        totalCost: 6,
      },
      {
        namespace: "shop",
        controllerKind: "statefulset",
        controllerName: "cart",
        totalCost: 3,
      },
      {
        namespace: "jobs",
        controllerKind: "job",
        controllerName: "nightly",
        totalCost: 1,
      },
    ]);
    // What the shares are of: the workloads' spend, idle capacity left out.
    expect(overview.lastDayWorkloadSpend).toBe(10);
  });

  test("tells apart workloads of one name in two namespaces", () => {
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "shop", value: 1 }]),
      workloadSpend: result([
        workload("shop", "api", 2),
        workload("staging", "api", 1),
      ]),
    });

    expect(overview.topWorkloads).toHaveLength(2);
  });

  test("weighs efficiency by what the CPU and memory cost", () => {
    /*
     * 80% on $9 of CPU and memory, 5% on $1: the two sums are 0.8 x 9 +
     * 0.05 x 1 and 10. A plain average of the two would say 42.5%.
     */
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "shop", value: 10 }]),
      workloadSpend: result([
        workload("shop", "checkout", 9),
        workload("shop", "cron", 1, "job"),
      ]),
      efficiency: efficiencySums({
        weightedEfficiency: 0.8 * 9 + 0.05 * 1,
        weight: 10,
      }),
    });

    expect(overview.efficiency).toBeCloseTo((0.8 * 9 + 0.05 * 1) / 10, 10);
  });

  test("says nothing about efficiency when no CPU or memory cost anything", () => {
    // Idle capacity alone, say: its rows weigh nothing.
    expect(
      build({
        namespaceSpend: result([{ namespace: "__idle__", value: 1 }]),
        efficiency: efficiencySums({ weightedEfficiency: 0, weight: 0 }),
      }).efficiency,
    ).toBeNull();

    // And no rows at all.
    expect(
      build({
        namespaceSpend: result([{ namespace: "shop", value: 1 }]),
      }).efficiency,
    ).toBeNull();
  });

  test("keeps an efficiency above 100% where workloads used more than they requested", () => {
    expect(
      build({
        namespaceSpend: result([{ namespace: "shop", value: 4 }]),
        efficiency: efficiencySums({ weightedEfficiency: 6, weight: 4 }),
      }).efficiency,
    ).toBe(1.5);
  });

  test("reads efficiency from the sums alone, not from what the workloads cost in total", () => {
    /*
     * Storage, network and load balancers are in a workload's total, and
     * efficiency does not measure them: a workload that is mostly a big
     * volume must not outweigh one that is all CPU.
     */
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "db", value: 100 }]),
      workloadSpend: result([workload("db", "postgres", 100, "statefulset")]),
      efficiency: efficiencySums({ weightedEfficiency: 1, weight: 4 }),
    });

    expect(overview.efficiency).toBe(0.25);
  });

  test("projects a month from the average of the hours that have cost data", () => {
    // Three hours: $1, $2 and $3, an average of $2 an hour.
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "shop", value: 6 }]),
      hourlySpend: hourly([1, 2, 3]),
    });

    expect(HOURS_PER_MONTH).toBe(730);
    expect(overview.runRateHours).toBe(3);
    expect(overview.monthlyRunRate).toBe(2 * 730);
  });

  test("never counts an hour with no data as free, so a new cluster is not projected low", () => {
    // Two hours of data in a week: the run-rate reads those two, not 168.
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([{ namespace: "shop", value: 20 }]),
      hourlySpend: hourly([10, 10]),
    });

    expect(overview.monthlyRunRate).toBe(10 * 730);
  });

  test("names the newest hour of cost, and says when none of it is in the last day", () => {
    const overview: KubernetesCostOverview = build({
      hourlySpend: {
        data: [
          {
            timestamp: new Date("2026-11-15T09:00:00.000Z"),
            value: 3,
          } as AggregatedModel,
          {
            timestamp: new Date("2026-11-15T10:00:00.000Z"),
            value: 3,
          } as AggregatedModel,
        ],
      },
    });

    expect(overview.hasData).toBe(true);
    expect(overview.hasRecentData).toBe(false);
    expect(overview.newestWindowStart?.toISOString()).toBe(
      "2026-11-15T10:00:00.000Z",
    );
    expect(overview.lastDaySpend).toBe(0);
  });

  test("reads a value that is not a number as nothing spent", () => {
    const overview: KubernetesCostOverview = build({
      namespaceSpend: result([
        { namespace: "shop", value: Number.NaN },
        { namespace: "cart", value: "2" },
      ]),
    });

    expect(overview.lastDaySpend).toBe(2);
    expect(overview.topNamespaces).toEqual([
      { namespace: "cart", totalCost: 2 },
    ]);
  });
});

describe("fetchKubernetesCostOverview", () => {
  test("makes five reads of the cluster's cost rows, all at once", async () => {
    mockAggregate.mockReset();
    mockAggregate.mockResolvedValue({ data: [] } as never);
    mockGetList.mockReset();
    mockGetList.mockResolvedValue({ data: [], count: 0 } as never);

    const clusterId: ObjectID = new ObjectID(
      "0193c0de-8888-4aaa-8bbb-000000000008",
    );

    await fetchKubernetesCostOverview({
      kubernetesClusterId: clusterId,
      now: NOW,
    });

    expect(mockAggregate).toHaveBeenCalledTimes(5);

    const reads: Array<any> = mockAggregate.mock.calls.map(
      (call: Array<unknown>): any => {
        return (call[0] as { aggregateBy: any }).aggregateBy;
      },
    );

    for (const read of reads) {
      expect(read.query.kubernetesClusterId).toBe(clusterId.toString());
      expect(read.endTimestamp.getTime()).toBe(NOW.getTime());
    }

    const lastDay: number = NOW.getTime() - 24 * HOUR_MS;
    const lastWeek: number = NOW.getTime() - 7 * 24 * HOUR_MS;

    expect(
      reads.map((read: any): [string, string, string, number] => {
        return [
          read.aggregateColumnName,
          read.aggregationType,
          read.aggregationInterval,
          read.startTimestamp.getTime(),
        ];
      }),
    ).toEqual([
      ["totalCost", AggregationType.Sum, AggregationInterval.Total, lastDay],
      ["totalCost", AggregationType.Sum, AggregationInterval.Total, lastDay],
      [
        "weightedEfficiency",
        AggregationType.Sum,
        AggregationInterval.Total,
        lastDay,
      ],
      [
        "efficiencyWeight",
        AggregationType.Sum,
        AggregationInterval.Total,
        lastDay,
      ],
      ["totalCost", AggregationType.Sum, AggregationInterval.Hour, lastWeek],
    ]);

    expect(reads[0].groupBy).toEqual({ namespace: true });
    expect(reads[1].groupBy).toEqual({
      namespace: true,
      controllerKind: true,
      controllerName: true,
    });
    // The cluster's efficiency: both sums over every row, ungrouped.
    expect(reads[2].groupBy).toBeUndefined();
    expect(reads[3].groupBy).toBeUndefined();
    expect(reads[4].groupBy).toBeUndefined();
  });
});

/*
 * #9633 / #9634: the card says how the cluster is priced, from the newest
 * hour of the week its run-rate reads.
 */
describe("fetchKubernetesCostOverview reads how the cluster is priced", () => {
  test("reads the newest row of the last 7 days for its engine and prices", async () => {
    mockAggregate.mockReset();
    mockAggregate.mockResolvedValue({ data: [] } as never);
    mockGetList.mockReset();

    const { default: KubernetesCostAllocation } = jest.requireActual(
      "../../../Models/AnalyticsModels/KubernetesCostAllocation",
    ) as { default: new () => any };

    const row: any = new KubernetesCostAllocation();
    row.setColumnValue("costEngine", "OpenCost");
    row.setColumnValue("pricingSource", "list-prices");
    row.setColumnValue("pricingProvider", "AWS");

    mockGetList.mockResolvedValue({ data: [row], count: 1 } as never);

    const clusterId: ObjectID = new ObjectID(
      "0193c0de-8888-4aaa-8bbb-000000000008",
    );

    const overview: KubernetesCostOverview = await fetchKubernetesCostOverview({
      kubernetesClusterId: clusterId,
      now: NOW,
    });

    expect(overview.engine).toEqual({
      engine: "OpenCost",
      service: "",
      bundledEngineUnused: false,
      pricingSource: "list-prices",
      pricingProvider: "AWS",
      memoryPeaksFrom: "",
    });

    const request: any = mockGetList.mock.calls[0]![0];

    expect(request.query.kubernetesClusterId).toBe(clusterId.toString());
    expect(request.query.windowStart.startValue.getTime()).toBe(
      NOW.getTime() - 7 * 24 * HOUR_MS,
    );
    expect(request.query.windowStart.endValue.getTime()).toBe(NOW.getTime());
  });

  test("still reads the figures when how they were priced cannot be read", async () => {
    mockAggregate.mockReset();
    mockAggregate.mockResolvedValue({ data: [] } as never);
    mockGetList.mockReset();
    mockGetList.mockRejectedValue(new Error("Server Error") as never);

    const overview: KubernetesCostOverview = await fetchKubernetesCostOverview({
      kubernetesClusterId: new ObjectID("0193c0de-8888-4aaa-8bbb-000000000008"),
      now: NOW,
    });

    expect(overview.engine).toBeNull();
    expect(overview.hasData).toBe(false);
  });

  test("buildKubernetesCostOverview carries the engine it is handed, and none when it is not", () => {
    expect(build({}).engine).toBeNull();
  });
});
