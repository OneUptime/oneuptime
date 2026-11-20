/** @timezone UTC */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #9969: a Kubecost that reads the cloud's bill reconciles each hour with it
 * about two days on, and ingest writes the change as rows of their own
 * (isCostAdjustment) that carry costs and no usage. Right-sizing adds their
 * costs in, so its savings are at what was paid, and leaves them out of
 * every count, average, percentile and peak, which they would drag down.
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

import { fetchRightSizingRecommendations } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesRightSizingUtils";

const CLUSTER_ID: ObjectID = new ObjectID(
  "0193c0de-8888-4aaa-8bbb-000000000008",
);

interface AggregateRequest {
  aggregateBy: {
    aggregateColumnName: string;
    aggregationType: AggregationType;
    query: Record<string, unknown>;
  };
}

describe("right-sizing and corrections of reconciled hours", () => {
  beforeEach(() => {
    mockAggregate.mockReset();
    mockAggregate.mockResolvedValue({ data: [] } as never);
  });

  test("counts, averages, percentiles and peaks leave the correction rows out; costs add them in", async () => {
    await fetchRightSizingRecommendations({
      kubernetesClusterId: CLUSTER_ID,
      startDate: new Date("2026-11-11T00:00:00.000Z"),
      endDate: new Date("2026-11-18T00:00:00.000Z"),
    });

    const requests: Array<AggregateRequest["aggregateBy"]> =
      mockAggregate.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as AggregateRequest).aggregateBy;
      });

    // Every measure right-sizing reads.
    expect(
      requests.map((request: AggregateRequest["aggregateBy"]): string => {
        return `${request.aggregationType}(${request.aggregateColumnName})`;
      }),
    ).toEqual([
      `${AggregationType.Avg}(cpuCoreRequestAverage)`,
      `${AggregationType.P95}(cpuCoreUsageAverage)`,
      `${AggregationType.Sum}(cpuCost)`,
      `${AggregationType.Avg}(ramBytesRequestAverage)`,
      `${AggregationType.Max}(ramBytesUsageMax)`,
      `${AggregationType.Sum}(ramCost)`,
      `${AggregationType.Count}(totalCost)`,
    ]);

    for (const request of requests) {
      if (request.aggregationType === AggregationType.Sum) {
        expect([
          request.aggregateColumnName,
          request.query["isCostAdjustment"],
        ]).toEqual([request.aggregateColumnName, undefined]);
      } else {
        expect([
          request.aggregateColumnName,
          request.query["isCostAdjustment"],
        ]).toEqual([request.aggregateColumnName, false]);
      }

      // The same cluster and window either way.
      expect(request.query["kubernetesClusterId"]).toBe(CLUSTER_ID.toString());
      expect(request.query["projectId"]).toBe(
        "10000000-0000-4000-8000-000000000001",
      );
    }
  });
});
