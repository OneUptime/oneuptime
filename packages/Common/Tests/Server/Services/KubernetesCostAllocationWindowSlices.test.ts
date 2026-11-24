import "../TestingUtils/Init";
import { KubernetesCostAllocationService } from "../../../Server/Services/KubernetesCostAllocationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import ObjectID from "../../../Types/ObjectID";
import {
  KUBERNETES_COST_CORRECTED_COLUMNS,
  KubernetesCostStoredSlice,
} from "../../../Types/Kubernetes/KubernetesCostCorrection";
import { describe, expect, test } from "@jest/globals";

/*
 * #9969: a later reading of a window is corrected against what the window
 * holds, per workload, pod and container: the sums of its first reading and
 * any corrections since. One read of one cluster's window.
 */

const PROJECT: ObjectID = new ObjectID("7b4157fc-c25d-41ea-aabc-972e0ee2c492");
const CLUSTER: ObjectID = new ObjectID("0193c0de-8888-4aaa-8bbb-000000000008");
const WINDOW_START: Date = new Date("2026-11-17T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-17T11:00:00.000Z");

describe("KubernetesCostAllocationService window slices", () => {
  const service: KubernetesCostAllocationService =
    new KubernetesCostAllocationService();

  const statement: Statement = service.buildWindowSlicesStatement({
    projectId: PROJECT,
    kubernetesClusterId: CLUSTER,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });

  test("reads one cluster's window, each value a parameter", () => {
    expect(statement.query).toMatch(
      /WHERE projectId = \{p\d+:\w+\} AND kubernetesClusterId = \{p\d+:\w+\} AND windowStart = \{p\d+:[\w()]+\} AND windowEnd = \{p\d+:[\w()]+\}/,
    );
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([
        AnalyticsTableName.KubernetesCostAllocation,
        PROJECT.toString(),
        CLUSTER.toString(),
      ]),
    );
    expect(statement.query).not.toContain(PROJECT.toString());
    expect(statement.query).not.toContain(CLUSTER.toString());
  });

  test("one row per workload, pod and container, as ingest tells rows apart", () => {
    expect(statement.query).toContain(
      "GROUP BY namespace, controllerKind, controllerName, podName, containerName",
    );
  });

  test("sums every cost a correction changes, over the first reading and any corrections", () => {
    for (const column of KUBERNETES_COST_CORRECTED_COLUMNS) {
      const alias: string = `sum${column.charAt(0).toUpperCase()}${column.slice(1)}`;

      expect(statement.query).toContain(`sum(${column}) AS ${alias}`);
      // And each is a column of the table.
      expect(
        new KubernetesCostAllocation().getTableColumn(column),
      ).not.toBeNull();
    }
  });

  test("says which engine priced the first reading, not a correction", () => {
    expect(statement.query).toContain(
      "anyIf(costEngine, NOT isCostAdjustment) AS pricedBy",
    );
    expect(statement.query).toContain(
      "anyIf(costEngineService, NOT isCostAdjustment) AS pricedByService",
    );
  });

  test("bounds how long the read may run", () => {
    expect(statement.query).toMatch(/SETTINGS max_execution_time\s*=\s*60/);
  });

  test("reads the rows back as slices, numbers however ClickHouse wrote them", () => {
    const slices: Array<KubernetesCostStoredSlice> =
      KubernetesCostAllocationService.readWindowSlices([
        {
          namespace: "prod",
          controllerKind: "deployment",
          controllerName: "api",
          podName: "api-abc",
          containerName: "api",
          sliceNode: "node-1",
          sliceProvider: "i-0123",
          sliceLabels: { team: "payments" },
          pricedBy: "Kubecost",
          pricedByService: "kubecost/kubecost-cost-analyzer",
          sumCpuCost: "0.05",
          sumGpuCost: 0,
          sumRamCost: 0.02,
          sumPvCost: "x",
          sumNetworkCost: null,
          sumLoadBalancerCost: 0,
          sumSharedCost: 0,
          sumExternalCost: 0,
          sumTotalCost: 0.07,
          sumEfficiencyWeight: 0.07,
          sumWeightedEfficiency: "0.035",
        },
      ]);

    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual({
      namespace: "prod",
      controllerKind: "deployment",
      controllerName: "api",
      podName: "api-abc",
      containerName: "api",
      nodeName: "node-1",
      providerId: "i-0123",
      labels: { team: "payments" },
      costEngine: "Kubecost",
      costEngineService: "kubecost/kubecost-cost-analyzer",
      cpuCost: 0.05,
      gpuCost: 0,
      ramCost: 0.02,
      pvCost: 0,
      networkCost: 0,
      loadBalancerCost: 0,
      sharedCost: 0,
      externalCost: 0,
      totalCost: 0.07,
      efficiencyWeight: 0.07,
      weightedEfficiency: 0.035,
    });
  });

  test("a label named __proto__ is kept as the workload's own", () => {
    const slices: Array<KubernetesCostStoredSlice> =
      KubernetesCostAllocationService.readWindowSlices([
        { sliceLabels: JSON.parse('{"__proto__":"x","app":"api"}') },
      ]);

    expect(Object.keys(slices[0]!.labels).sort()).toEqual(["__proto__", "app"]);
    expect(slices[0]!.labels["app"]).toBe("api");
  });

  test("a row with nothing in it reads as an empty slice", () => {
    expect(KubernetesCostAllocationService.readWindowSlices([{}])).toEqual([
      {
        namespace: "",
        controllerKind: "",
        controllerName: "",
        podName: "",
        containerName: "",
        nodeName: "",
        providerId: "",
        labels: {},
        costEngine: "",
        costEngineService: "",
        cpuCost: 0,
        gpuCost: 0,
        ramCost: 0,
        pvCost: 0,
        networkCost: 0,
        loadBalancerCost: 0,
        sharedCost: 0,
        externalCost: 0,
        totalCost: 0,
        efficiencyWeight: 0,
        weightedEfficiency: 0,
      },
    ]);
  });
});
