import KubernetesClusterComplianceSummary, {
  ComplianceSummaryRefreshResult,
  MAX_SUMMARIES_PER_RUN,
} from "../../../../Server/Utils/Kubernetes/KubernetesClusterComplianceSummary";
import KubernetesClusterCompliance from "../../../../Server/Utils/Kubernetes/KubernetesClusterCompliance";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { KubernetesComplianceResponse } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
  KubernetesComplianceSummary,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EACH CLUSTER'S COMPLIANCE SUMMARY, KEPT FRESH (#9876): written on the
 * cluster's record in one hook-free statement, from the answer its own
 * Compliance page draws; and the job's run, which scores each cluster that
 * is due, the oldest first, until its cap or deadline.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60000);
}

function answer(
  clusterId: string,
  score: number,
): KubernetesComplianceResponse {
  return {
    clusterId,
    kubernetesVersion: "1.31",
    standardVersion: "1.31",
    provider: null,
    isManagedControlPlane: false,
    podCount: 4,
    podsRead: 4,
    templateCount: 0,
    hasPolicyObjects: true,
    policyEngine: null,
    isTruncated: false,
    namespaces: [],
    frameworks: [
      {
        framework: KubernetesComplianceFramework.PssBaseline,
        fullName: "Pod Security Standards: Baseline",
        scope: "Pods",
        score,
        isTurnedOff: false,
        turnedOffRequirements: [],
        turnedOffNamespaces: [],
        workloadsEvaluated: 3,
        workloadsPassing: 2,
        podsNotRead: 0,
        failingByNamespace: {},
        requirements: [
          {
            requirement: "Privileged Containers",
            title: "Privileged Containers",
            status: ComplianceRequirementStatus.Failing,
            failingCount: 1,
            findings: [],
            turnedOffNamespaces: [],
          },
        ],
        turnedOff: [],
      },
    ],
  };
}

function clusterRow(
  name: string,
  data: Partial<KubernetesCluster> = {},
): KubernetesCluster {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster._id = ObjectID.generate().toString();
  cluster.projectId = PROJECT_ID;
  cluster.name = name;
  cluster.otelCollectorStatus = "connected";
  Object.assign(cluster, data);
  return cluster;
}

let writes: Array<{ id: string; data: Record<string, unknown>; skip: unknown }>;
let clusters: Array<KubernetesCluster>;
let findBy: jest.SpyInstance;

beforeEach(() => {
  writes = [];
  clusters = [];
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest
    .spyOn(KubernetesClusterService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
      skipUpdateDateColumn?: boolean;
    }) => {
      writes.push({
        id: input.id.toString(),
        data: input.data,
        skip: input.skipUpdateDateColumn,
      });
    }) as never);
  findBy = jest
    .spyOn(KubernetesClusterService, "findBy")
    .mockImplementation((async () => {
      return clusters;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("storing a cluster's summary", () => {
  test("writes the summary and when it was worked out, on the cluster's record, and nothing else", async () => {
    const clusterId: ObjectID = ObjectID.generate();
    const summary: KubernetesComplianceSummary =
      await KubernetesClusterComplianceSummary.store({
        clusterId,
        compliance: answer(clusterId.toString(), 64),
        refreshedAt: NOW,
      });

    expect(summary).toMatchObject({
      version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
      refreshedAt: NOW.toISOString(),
      frameworks: [
        {
          framework: KubernetesComplianceFramework.PssBaseline,
          score: 64,
          failingControls: [
            {
              requirement: "Privileged Containers",
              title: "Privileged Containers",
              failingCount: 1,
            },
          ],
        },
      ],
    });
    // One hook-free statement: nobody changed the cluster, so nothing is audited.
    expect(writes).toEqual([
      {
        id: clusterId.toString(),
        data: { complianceSummary: summary, complianceSummaryRefreshedAt: NOW },
        // Bookkeeping: the cluster's own "updated" stays.
        skip: true,
      },
    ]);
  });

  test("after a person's read, a failed write is logged and the read goes on", async () => {
    (
      KubernetesClusterService.updateColumnsByIdWithoutHooks as unknown as jest.SpyInstance
    ).mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      KubernetesClusterComplianceSummary.storeQuietly({
        clusterId: ObjectID.generate(),
        compliance: answer("c", 50),
        refreshedAt: NOW,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("refreshing one cluster scores it at that time, with its own name and platform, and keeps the result", async () => {
    const readCompliance: jest.SpyInstance = jest
      .spyOn(KubernetesClusterCompliance, "readCompliance")
      .mockResolvedValue(answer("c", 80) as never);
    const id: ObjectID = ObjectID.generate();

    await KubernetesClusterComplianceSummary.refresh(
      { id, projectId: PROJECT_ID, name: "prod-eu", provider: "GKE" },
      NOW,
    );

    expect(readCompliance).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cluster: { id, name: "prod-eu", provider: "GKE" },
      now: NOW,
    });
    expect(writes[0]!.data["complianceSummaryRefreshedAt"]).toBe(NOW);
  });
});

describe("the clusters due", () => {
  test("never scored first, then the oldest, leaving out the ones scored lately", async () => {
    clusters = [
      clusterRow("fresh", { complianceSummaryRefreshedAt: minutesAgo(3) }),
      clusterRow("old", { complianceSummaryRefreshedAt: minutesAgo(40) }),
      clusterRow("never"),
      clusterRow("older", { complianceSummaryRefreshedAt: minutesAgo(90) }),
      // Silent agent: its inventory has not moved, so it waits the hour.
      clusterRow("silent", {
        otelCollectorStatus: "disconnected",
        complianceSummaryRefreshedAt: minutesAgo(40),
      }),
      clusterRow("silent-long", {
        otelCollectorStatus: "disconnected",
        complianceSummaryRefreshedAt: minutesAgo(61),
      }),
    ];

    const { due, dueCount } =
      await KubernetesClusterComplianceSummary.findDueClusters({
        now: NOW,
        limit: 10,
      });

    expect(
      due.map((cluster: { name: string }): string => {
        return cluster.name;
      }),
    ).toEqual(["never", "older", "silent-long", "old"]);
    expect(dueCount).toBe(4);
    // Read as OneUptime, archived clusters left out.
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { isArchived: false },
      props: { isRoot: true },
      select: {
        complianceSummaryRefreshedAt: true,
        otelCollectorStatus: true,
      },
    });
  });

  test("at most the cap a run, and a cluster with no name is named by its identifier", async () => {
    clusters = [
      clusterRow("a"),
      clusterRow("", { clusterIdentifier: "arn:eks:prod" }),
      clusterRow("c"),
    ];

    const { due, dueCount } =
      await KubernetesClusterComplianceSummary.findDueClusters({
        now: NOW,
        limit: 2,
      });

    expect(dueCount).toBe(3);
    expect(due).toHaveLength(2);
    expect(due[1]!.name).toBe("arn:eks:prod");
    expect(MAX_SUMMARIES_PER_RUN).toBe(100);
  });
});

describe("a run of the job", () => {
  test("scores each cluster due; one that fails is logged and left due, the others scored all the same", async () => {
    clusters = [clusterRow("a"), clusterRow("broken"), clusterRow("c")];
    jest
      .spyOn(KubernetesClusterCompliance, "readCompliance")
      .mockImplementation((async (data: {
        cluster: { name: string; id: ObjectID };
      }) => {
        if (data.cluster.name === "broken") {
          throw new Error("inventory read timed out");
        }

        return answer(data.cluster.id.toString(), 90);
      }) as never);

    const result: ComplianceSummaryRefreshResult =
      await KubernetesClusterComplianceSummary.refreshDueClusters({ now: NOW });

    expect(result).toEqual({ refreshed: 2, failed: 1, left: 0 });
    expect(writes).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("stops at its deadline, leaving the rest for the next run", async () => {
    clusters = [clusterRow("a"), clusterRow("b"), clusterRow("c")];
    const deadline: JobDeadline = new JobDeadline({});
    jest
      .spyOn(KubernetesClusterCompliance, "readCompliance")
      .mockImplementation((async (data: { cluster: { id: ObjectID } }) => {
        // The run's time is up once the first cluster is scored.
        deadline.end(new Error("time is up"));
        return answer(data.cluster.id.toString(), 70);
      }) as never);

    const result: ComplianceSummaryRefreshResult =
      await KubernetesClusterComplianceSummary.refreshDueClusters({
        now: NOW,
        deadline,
      });

    expect(result).toEqual({ refreshed: 1, failed: 0, left: 2 });
  });

  test("with nothing due, scores nothing", async () => {
    clusters = [
      clusterRow("fresh", { complianceSummaryRefreshedAt: minutesAgo(1) }),
    ];
    const readCompliance: jest.SpyInstance = jest.spyOn(
      KubernetesClusterCompliance,
      "readCompliance",
    );

    expect(
      await KubernetesClusterComplianceSummary.refreshDueClusters({ now: NOW }),
    ).toEqual({ refreshed: 0, failed: 0, left: 0 });
    expect(readCompliance).not.toHaveBeenCalled();
  });
});
