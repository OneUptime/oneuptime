import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #9113: the Kubernetes cluster overview's Memory tile had no bar.
 * CPU had one because it divides the cores in use by allocatable CPU;
 * memory was a bare byte total with nothing to divide by. The tile now
 * divides the nodes' working set by their allocatable memory
 * (KubernetesMemoryUtils). These pin the arithmetic, and what it does
 * when a part is missing: no share, so no bar, rather than a wrong one.
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
        return "10000000-0000-4000-8000-000000000001";
      },
    },
  };
});

import KubernetesMemoryUtils, {
  ClusterMemoryUtilization,
  NODE_ALLOCATABLE_MEMORY_METRIC,
  NODE_MEMORY_WORKING_SET_METRIC,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesMemoryUtils";
import {
  K8S_CLUSTER_RECEIVER_METRICS,
  KUBELETSTATS_RECEIVER_METRICS,
} from "../../Types/Monitor/Utils/KubernetesAgentEmittedMetrics";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const GIB: number = 1024 * 1024 * 1024;

type AggregateCall = {
  aggregateBy: {
    query: { name: string; attributes: Record<string, unknown> };
    aggregationType: string;
    groupBy?: { attributes?: boolean };
  };
};

function allocatableRow(
  nodeName: string | undefined,
  value: unknown,
): Record<string, unknown> {
  return {
    timestamp: new Date("2026-11-16T12:00:00.000Z"),
    value: value,
    attributes:
      nodeName === undefined ? {} : { "resource.k8s.node.name": nodeName },
  };
}

const WINDOW: { clusterIdentifier: string; startDate: Date; endDate: Date } = {
  clusterIdentifier: "production-us-east-1",
  startDate: new Date("2026-11-16T11:30:00.000Z"),
  endDate: new Date("2026-11-16T12:00:00.000Z"),
};

beforeEach(() => {
  mockAggregate.mockReset();
});

describe("the metrics the Memory tile reads", () => {
  test("are ones the Kubernetes agent sends", () => {
    // kubeletstats on every node: the working set.
    expect(KUBELETSTATS_RECEIVER_METRICS).toContain(
      NODE_MEMORY_WORKING_SET_METRIC,
    );
    // k8s_cluster's allocatable_types_to_report: allocatable memory.
    expect(K8S_CLUSTER_RECEIVER_METRICS).toContain(
      NODE_ALLOCATABLE_MEMORY_METRIC,
    );
  });

  test("are the working set and allocatable memory, not usage with its cache", () => {
    expect(NODE_MEMORY_WORKING_SET_METRIC).toBe("k8s.node.memory.working_set");
    expect(NODE_ALLOCATABLE_MEMORY_METRIC).toBe("k8s.node.allocatable_memory");
  });
});

describe("getClusterMemoryUtilization", () => {
  test("is the working set as a share of allocatable memory", () => {
    expect(
      KubernetesMemoryUtils.getClusterMemoryUtilization({
        usedBytes: 6 * GIB,
        allocatableBytes: 16 * GIB,
      }),
    ).toEqual({
      usedBytes: 6 * GIB,
      allocatableBytes: 16 * GIB,
      percent: 37.5,
    });
  });

  test("keeps a share over 100: the cluster dips into memory set aside for the system", () => {
    const reading: ClusterMemoryUtilization =
      KubernetesMemoryUtils.getClusterMemoryUtilization({
        usedBytes: 18 * GIB,
        allocatableBytes: 16 * GIB,
      });
    expect(reading.percent).toBe(112.5);
  });

  test("an idle cluster reads 0%, not 'no data'", () => {
    expect(
      KubernetesMemoryUtils.getClusterMemoryUtilization({
        usedBytes: 0,
        allocatableBytes: 16 * GIB,
      }).percent,
    ).toBe(0);
  });

  test.each([
    ["no allocatable memory reported", 0],
    ["no allocatable memory read", null],
    ["a negative allocatable", -1],
    ["a broken allocatable", Number.NaN],
    ["an endless allocatable", Number.POSITIVE_INFINITY],
  ])(
    "with %s there is no share, so no bar, but the bytes in use stay",
    (_case: string, allocatableBytes: number | null) => {
      expect(
        KubernetesMemoryUtils.getClusterMemoryUtilization({
          usedBytes: 6 * GIB,
          allocatableBytes: allocatableBytes,
        }),
      ).toEqual({ usedBytes: 6 * GIB, allocatableBytes: null, percent: null });
    },
  );

  test.each([
    ["no working set reported", null],
    ["a broken working set", Number.NaN],
    ["a negative working set", -5],
  ])(
    "with %s there is nothing in use to show, and no share",
    (_case: string, usedBytes: number | null) => {
      expect(
        KubernetesMemoryUtils.getClusterMemoryUtilization({
          usedBytes: usedBytes,
          allocatableBytes: 16 * GIB,
        }),
      ).toEqual({ usedBytes: null, allocatableBytes: 16 * GIB, percent: null });
    },
  );
});

describe("fetchClusterAllocatableMemoryBytes", () => {
  test("adds up each node's allocatable memory, taking each node once at its largest", async () => {
    mockAggregate.mockImplementation(() => {
      return Promise.resolve({
        data: [
          allocatableRow("node-a", 8 * GIB),
          // A second sample of node-a: still one node.
          allocatableRow("node-a", 7.5 * GIB),
          allocatableRow("node-b", 8 * GIB),
          // As ClickHouse can hand a number back: a string.
          allocatableRow("node-c", String(4 * GIB)),
        ],
      });
    });

    await expect(
      KubernetesMemoryUtils.fetchClusterAllocatableMemoryBytes(WINDOW),
    ).resolves.toBe(20 * GIB);
  });

  test("asks for allocatable memory of this cluster, per node, at its largest over the window", async () => {
    mockAggregate.mockImplementation(() => {
      return Promise.resolve({ data: [] });
    });

    await KubernetesMemoryUtils.fetchClusterAllocatableMemoryBytes(WINDOW);

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    const call: AggregateCall = mockAggregate.mock
      .calls[0]![0] as AggregateCall;
    expect(call.aggregateBy.query.name).toBe("k8s.node.allocatable_memory");
    expect(call.aggregateBy.query.attributes).toEqual({
      "resource.k8s.cluster.name": "production-us-east-1",
    });
    expect(call.aggregateBy.aggregationType).toBe(MetricsAggregationType.Max);
    expect(call.aggregateBy.groupBy).toEqual({ attributes: true });
  });

  test("leaves out rows with no node, and readings that are not a size", async () => {
    mockAggregate.mockImplementation(() => {
      return Promise.resolve({
        data: [
          allocatableRow(undefined, 64 * GIB),
          allocatableRow("node-a", 0),
          allocatableRow("node-b", -GIB),
          allocatableRow("node-c", "not a number"),
          allocatableRow("node-d", 2 * GIB),
        ],
      });
    });

    await expect(
      KubernetesMemoryUtils.fetchClusterAllocatableMemoryBytes(WINDOW),
    ).resolves.toBe(2 * GIB);
  });

  test("is 0 - no denominator - when the nodes report none", async () => {
    mockAggregate.mockImplementation(() => {
      return Promise.resolve({ data: [] });
    });

    await expect(
      KubernetesMemoryUtils.fetchClusterAllocatableMemoryBytes(WINDOW),
    ).resolves.toBe(0);
  });

  test("is 0 when the query fails, so the tile shows bytes rather than an error", async () => {
    mockAggregate.mockImplementation(() => {
      return Promise.reject(new Error("ClickHouse is away"));
    });

    await expect(
      KubernetesMemoryUtils.fetchClusterAllocatableMemoryBytes(WINDOW),
    ).resolves.toBe(0);
  });
});
