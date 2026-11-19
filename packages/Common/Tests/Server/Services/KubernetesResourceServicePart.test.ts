import KubernetesResourceService, {
  KubernetesPart,
  PART_CANDIDATE_LIMIT,
  PART_POD_LIMIT,
} from "../../../Server/Services/KubernetesResourceService";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * An object's own page reads it with what it runs (getPart). A namespace's
 * page counts what in it needs attention and lists it (#9595), so its read
 * brings the namespace's flagged pods, worst first, and its other flagged
 * objects with the workloads a pod's finding folds into - through the
 * partial index the cluster's Needs attention reads, every value bound.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

function stored(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: `id-${String(fields["kind"])}-${String(fields["name"])}`,
    namespaceKey: "shop",
    phase: null,
    isReady: null,
    labels: null,
    ownerReferences: null,
    spec: null,
    status: null,
    lastSeenAt: new Date("2026-11-01T12:00:00.000Z"),
    resourceCreationTimestamp: null,
    latestCpuPercent: null,
    latestMemoryBytes: null,
    latestMemoryPercent: null,
    metricsUpdatedAt: null,
    ...fields,
  };
}

const NAMESPACE: Record<string, unknown> = stored({
  kind: "Namespace",
  name: "shop",
  namespaceKey: "",
  status: { phase: "Active" },
});

describe("KubernetesResourceService.getPart, for a namespace", () => {
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    query = jest.fn<QueryFunction>();
    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function read(): Promise<KubernetesPart> {
    return KubernetesResourceService.getPart({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      kind: "Namespace",
      name: "shop",
    });
  }

  test("reads its flagged pods worst first, then its flagged objects and the workloads they fold into", async () => {
    const pod: Record<string, unknown> = stored({
      kind: "Pod",
      name: "checkout-7d9f8b6c5-x2k4q",
    });
    const deployment: Record<string, unknown> = stored({
      kind: "Deployment",
      name: "checkout",
    });
    query
      .mockResolvedValueOnce([NAMESPACE])
      .mockResolvedValueOnce([pod])
      .mockResolvedValueOnce([deployment]);

    const result: KubernetesPart = await read();

    expect(query).toHaveBeenCalledTimes(3);

    const [podsSql, podsParameters]: [string, Array<unknown>] =
      query.mock.calls[1]!;
    expect(podsSql).toContain(`"namespaceKey" = $3`);
    expect(podsSql).toContain(`"kind" = 'Pod'`);
    // The partial index's own predicate: only what needs attention is read.
    expect(podsSql).toContain(`"healthSeverity" IS NOT NULL`);
    expect(podsSql).toContain(`"deletedAt" IS NULL`);
    expect(podsSql).toContain(
      `CASE "healthSeverity" WHEN 'critical' THEN 0 ELSE 1 END`,
    );
    expect(podsSql).toContain(`LIMIT ${PART_POD_LIMIT + 1}`);
    expect(podsParameters).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      "shop",
    ]);

    const [objectsSql, objectsParameters]: [string, Array<unknown>] =
      query.mock.calls[2]!;
    expect(objectsSql).toContain(`"kind" <> 'Pod'`);
    expect(objectsSql).toContain(`"healthSeverity" IS NOT NULL`);
    // A flagged pod folds into its workload: the workloads are read too.
    expect(objectsSql).toContain(`OR "kind" = ANY($4)`);
    expect(objectsSql).toContain(`LIMIT ${PART_CANDIDATE_LIMIT}`);
    expect(objectsParameters).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      "shop",
      [
        "Deployment",
        "StatefulSet",
        "DaemonSet",
        "Job",
        "CronJob",
        "DeploymentConfig",
      ],
    ]);
    // Never a value spliced into the text.
    expect(objectsSql).not.toContain("'shop'");

    expect(result.part).toEqual(NAMESPACE);
    expect(result.pods).toEqual([pod]);
    expect(result.objects).toEqual([deployment]);
    expect(result.jobs).toEqual([]);
    expect(result.isPodsTruncated).toBe(false);
  });

  test("with no pod that needs attention, only its flagged objects are read: no workloads to fold into", async () => {
    query
      .mockResolvedValueOnce([NAMESPACE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result: KubernetesPart = await read();

    const [objectsSql, objectsParameters]: [string, Array<unknown>] =
      query.mock.calls[2]!;
    expect(objectsSql).not.toContain("ANY($4)");
    expect(objectsParameters).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      "shop",
    ]);
    expect(result.pods).toEqual([]);
    expect(result.objects).toEqual([]);
  });

  test("more flagged pods than one read takes: the worst are listed, and it says so", async () => {
    const many: Array<Record<string, unknown>> = Array.from(
      { length: PART_POD_LIMIT + 1 },
      (_: unknown, index: number) => {
        return stored({ kind: "Pod", name: `pod-${index}` });
      },
    );
    query
      .mockResolvedValueOnce([NAMESPACE])
      .mockResolvedValueOnce(many)
      .mockResolvedValueOnce([]);

    const result: KubernetesPart = await read();

    expect(result.pods).toHaveLength(PART_POD_LIMIT);
    expect(result.isPodsTruncated).toBe(true);
  });

  test("a namespace the inventory does not hold reads nothing more", async () => {
    query.mockResolvedValueOnce([]);

    const result: KubernetesPart = await read();

    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      part: null,
      pods: [],
      jobs: [],
      objects: [],
      isPodsTruncated: false,
    });
  });

  test("any other kind's read has no objects of a namespace's", async () => {
    query.mockResolvedValueOnce([
      stored({ kind: "PersistentVolumeClaim", name: "data" }),
    ]);

    const result: KubernetesPart = await KubernetesResourceService.getPart({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      kind: "PersistentVolumeClaim",
      name: "data",
      namespace: "shop",
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.objects).toEqual([]);
  });
});
