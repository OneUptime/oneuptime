/** @timezone UTC */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { JSONValue } from "../../../Types/JSON";
import {
  KubernetesCostMemoryPeaksSource,
  KubernetesCostPricingSource,
} from "../../../Types/Kubernetes/KubernetesCostPricing";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #9633 / #9634: which engine priced a cluster's cost in a window, and at
 * what prices - read off the window's newest cost row, which says how it
 * was priced.
 */

const mockGetList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
  KubernetesCostEngineView,
  fetchKubernetesCostEngine,
  toKubernetesCostEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostEngine";

const CLUSTER_ID: ObjectID = new ObjectID(
  "0193c0de-8888-4aaa-8bbb-000000000008",
);
const START: Date = new Date("2026-11-11T12:00:00.000Z");
const END: Date = new Date("2026-11-18T12:00:00.000Z");

function row(values: Record<string, JSONValue>): KubernetesCostAllocation {
  const allocation: KubernetesCostAllocation = new KubernetesCostAllocation();

  for (const [key, value] of Object.entries(values)) {
    allocation.setColumnValue(key, value);
  }

  return allocation;
}

describe("toKubernetesCostEngine", () => {
  test("reads how the row was priced", () => {
    expect(
      toKubernetesCostEngine(
        row({
          costEngine: "Kubecost",
          costEngineService: "kubecost/kubecost-cost-analyzer",
          bundledEngineUnused: true,
          pricingSource: "list-prices",
          pricingProvider: "AWS",
          memoryPeaksFrom: "engine",
        }),
      ),
    ).toEqual({
      engine: "Kubecost",
      service: "kubecost/kubecost-cost-analyzer",
      bundledEngineUnused: true,
      pricingSource: KubernetesCostPricingSource.ListPrices,
      pricingProvider: "AWS",
      memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Engine,
    });
  });

  test("is null for no row, and for a row from an agent that says nothing", () => {
    expect(toKubernetesCostEngine(undefined)).toBeNull();
    expect(
      toKubernetesCostEngine(row({ costEngine: "", pricingSource: "" })),
    ).toBeNull();
  });

  test("reads a Bool column however ClickHouse wrote it", () => {
    for (const value of [true, 1, "true"]) {
      expect(
        toKubernetesCostEngine(
          row({
            pricingSource: "default-rates",
            costEngineService: "opencost/opencost",
            bundledEngineUnused: value,
          }),
        )?.bundledEngineUnused,
      ).toBe(true);
    }

    expect(
      toKubernetesCostEngine(
        row({ pricingSource: "default-rates", bundledEngineUnused: 0 }),
      )?.bundledEngineUnused,
    ).toBe(false);
  });

  test("keeps only what the agent could have sent", () => {
    expect(
      toKubernetesCostEngine(
        row({
          costEngine: "Evil",
          costEngineService: "a/b/c",
          pricingSource: "list-prices",
          pricingProvider: "<b>AWS</b>",
        }),
      ),
    ).toEqual({
      engine: "",
      service: "",
      bundledEngineUnused: false,
      pricingSource: KubernetesCostPricingSource.ListPrices,
      pricingProvider: "",
      memoryPeaksFrom: "",
    });
  });
});

describe("fetchKubernetesCostEngine", () => {
  beforeEach(() => {
    mockGetList.mockReset();
  });

  test("reads the window's newest row of the cluster, and only how it was priced", async () => {
    mockGetList.mockResolvedValue({
      data: [
        row({
          costEngine: "OpenCost",
          pricingSource: "default-rates",
        }),
      ],
      count: 1,
    } as never);

    const engine: unknown = await fetchKubernetesCostEngine({
      kubernetesClusterId: CLUSTER_ID,
      startDate: START,
      endDate: END,
    });

    expect(engine).toEqual({
      engine: "OpenCost",
      service: "",
      bundledEngineUnused: false,
      pricingSource: KubernetesCostPricingSource.DefaultRates,
      pricingProvider: "",
      memoryPeaksFrom: "",
    });

    const request: any = mockGetList.mock.calls[0]![0];

    expect(request.modelType).toBe(KubernetesCostAllocation);
    expect(request.query.projectId).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(request.query.kubernetesClusterId).toBe(CLUSTER_ID.toString());
    expect(request.query.windowStart).toBeInstanceOf(InBetween);
    expect(request.query.windowStart.startValue).toEqual(START);
    expect(request.query.windowStart.endValue).toEqual(END);
    expect(request.sort).toEqual({ windowStart: SortOrder.Descending });
    expect(request.limit).toBe(1);
    expect(Object.keys(request.select).sort()).toEqual(
      [
        "bundledEngineUnused",
        "costEngine",
        "costEngineService",
        "memoryPeaksFrom",
        "pricingProvider",
        "pricingSource",
        "windowEnd",
        "windowStart",
      ].sort(),
    );
    // An engine that reads no bill has nothing reconciled to look for.
    expect(mockGetList).toHaveBeenCalledTimes(1);
  });

  // #9970: where the memory peaks come from, as the newest row says.
  test("reads where the newest hour's memory peaks came from", async () => {
    mockGetList.mockResolvedValue({
      data: [
        row({
          costEngine: "Kubecost",
          costEngineService: "kubecost/kubecost-frontend",
          bundledEngineUnused: true,
          pricingSource: "default-rates",
          memoryPeaksFrom: "bundled",
        }),
      ],
      count: 1,
    } as never);

    const engine: KubernetesCostEngineView | null =
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      });

    expect(engine?.memoryPeaksFrom).toBe(
      KubernetesCostMemoryPeaksSource.Bundled,
    );
    expect(engine?.bundledEngineUnused).toBe(true);
  });

  /*
   * #9969: for a Kubecost that reads the cloud's bill, how far the window's
   * figures are reconciled: the newest correction row's hour.
   */
  test("for a Kubecost that reads the bill, reads how far the window is reconciled", async () => {
    mockGetList
      .mockResolvedValueOnce({
        data: [
          row({
            costEngine: "Kubecost",
            pricingSource: "billing-integration",
            pricingProvider: "AWS",
            windowStart: "2026-11-18T11:00:00.000Z",
            windowEnd: "2026-11-18T12:00:00.000Z",
          }),
        ],
        count: 1,
      } as never)
      .mockResolvedValueOnce({
        data: [
          row({
            windowStart: "2026-11-16T09:00:00.000Z",
            windowEnd: "2026-11-16T10:00:00.000Z",
          }),
        ],
        count: 1,
      } as never);

    const engine: KubernetesCostEngineView | null =
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      });

    expect(engine?.pricingSource).toBe(
      KubernetesCostPricingSource.BillingIntegration,
    );
    expect(engine?.reconciledThrough).toEqual(
      new Date("2026-11-16T10:00:00.000Z"),
    );
    expect(engine?.pricedThrough).toEqual(new Date("2026-11-18T12:00:00.000Z"));

    const reconciledRequest: any = mockGetList.mock.calls[1]![0];

    expect(reconciledRequest.modelType).toBe(KubernetesCostAllocation);
    expect(reconciledRequest.query.isCostAdjustment).toBe(true);
    expect(reconciledRequest.query.kubernetesClusterId).toBe(
      CLUSTER_ID.toString(),
    );
    expect(reconciledRequest.query.windowStart.startValue).toEqual(START);
    expect(reconciledRequest.query.windowStart.endValue).toEqual(END);
    expect(reconciledRequest.sort).toEqual({
      windowStart: SortOrder.Descending,
    });
    expect(reconciledRequest.limit).toBe(1);
    expect(Object.keys(reconciledRequest.select).sort()).toEqual([
      "windowEnd",
      "windowStart",
    ]);
  });

  test("a window no reconciliation reached yet says none", async () => {
    mockGetList
      .mockResolvedValueOnce({
        data: [
          row({
            pricingSource: "billing-integration",
            pricingProvider: "AWS",
            windowEnd: "2026-11-18T12:00:00.000Z",
          }),
        ],
        count: 1,
      } as never)
      .mockResolvedValueOnce({ data: [], count: 0 } as never);

    const engine: KubernetesCostEngineView | null =
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      });

    expect(engine?.reconciledThrough).toBeNull();
    expect(engine?.pricedThrough).toEqual(new Date("2026-11-18T12:00:00.000Z"));
  });

  test("a read of the reconciled hours that fails leaves the prices as they were read", async () => {
    mockGetList
      .mockResolvedValueOnce({
        data: [
          row({
            pricingSource: "billing-integration",
            pricingProvider: "AWS",
          }),
        ],
        count: 1,
      } as never)
      .mockRejectedValueOnce(new Error("Server Error") as never);

    const engine: KubernetesCostEngineView | null =
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      });

    expect(engine?.pricingSource).toBe(
      KubernetesCostPricingSource.BillingIntegration,
    );
    expect(engine?.reconciledThrough).toBeNull();
  });

  test("is null for a window with no cost rows", async () => {
    mockGetList.mockResolvedValue({ data: [], count: 0 } as never);

    expect(
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      }),
    ).toBeNull();
  });

  test("is null rather than an error when the read fails: the figures do not wait on it", async () => {
    mockGetList.mockRejectedValue(new Error("Server Error") as never);

    expect(
      await fetchKubernetesCostEngine({
        kubernetesClusterId: CLUSTER_ID,
        startDate: START,
        endDate: END,
      }),
    ).toBeNull();
  });
});
