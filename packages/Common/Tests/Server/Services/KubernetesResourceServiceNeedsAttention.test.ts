import KubernetesResourceService, {
  KubernetesNeedsAttention,
  NEEDS_ATTENTION_FINDING_LIMIT,
  NEEDS_ATTENTION_ROW_LIMIT,
  NEEDS_ATTENTION_WORKLOAD_LIMIT,
} from "../../../Server/Services/KubernetesResourceService";
import { ParsedKubernetesResource } from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import { KubernetesHealthSeverity } from "../../../Types/Kubernetes/KubernetesHealth";
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
 * The ingest stores each Kubernetes object's verdict (healthSeverity), and a
 * cluster's Overview reads what needs attention through it: the flagged
 * objects, worst first, and the workloads of their namespaces, so a pod's
 * finding folds into its Deployment. These pin the writes and both reads -
 * which rows they touch, how they are bound, and what they hand back.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

function ago(minutes: number): Date {
  return new Date(SEEN.getTime() - minutes * 60 * 1000);
}

interface StoredRow {
  kind: string;
  namespaceKey: string;
  name: string;
  phase: string | null;
  isReady: boolean | null;
  hasMemoryPressure: boolean | null;
  hasDiskPressure: boolean | null;
  hasPidPressure: boolean | null;
  labels: Record<string, unknown> | null;
  ownerReferences: Record<string, unknown> | null;
  spec: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  lastSeenAt: Date;
  resourceCreationTimestamp: Date | null;
}

function row(
  fields: Partial<StoredRow> & { kind: string; name: string },
): StoredRow {
  return {
    namespaceKey: "payments",
    phase: null,
    isReady: null,
    hasMemoryPressure: null,
    hasDiskPressure: null,
    hasPidPressure: null,
    labels: null,
    ownerReferences: null,
    spec: null,
    status: null,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
    ...fields,
  };
}

function crashLoopingPod(name: string): StoredRow {
  return row({
    kind: "Pod",
    name: name,
    phase: "Running",
    labels: { "pod-template-hash": "7d9f8b6c5" },
    ownerReferences: {
      items: [{ kind: "ReplicaSet", name: "checkout-7d9f8b6c5", uid: "rs-1" }],
    },
    status: {
      phase: "Running",
      conditions: [],
      containerStatuses: [
        {
          name: "app",
          ready: false,
          restartCount: 9,
          state: "waiting",
          reason: "CrashLoopBackOff",
          image: "app:1",
        },
      ],
      initContainerStatuses: [],
    },
  });
}

function deployment(available: number): StoredRow {
  return row({
    kind: "Deployment",
    name: "checkout",
    spec: { replicas: 3 },
    status: {
      availableReplicas: available,
      conditions: [
        {
          type: "Progressing",
          status: "True",
          reason: "NewReplicaSetAvailable",
          message: "",
          lastTransitionTime: ago(900).toISOString(),
        },
      ],
    },
  });
}

describe("KubernetesResourceService stores each object's verdict", () => {
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    query = jest.fn<QueryFunction>().mockResolvedValue([]);
    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function parsed(
    healthSeverity: ParsedKubernetesResource["healthSeverity"],
  ): ParsedKubernetesResource {
    const resource: ParsedKubernetesResource = {
      kind: "Pod",
      namespaceKey: "payments",
      name: "checkout-7d9f8b6c5-x2k4q",
      uid: "uid-1",
      phase: "Running",
      isReady: null,
      hasMemoryPressure: null,
      hasDiskPressure: null,
      hasPidPressure: null,
      labels: null,
      annotations: null,
      ownerReferences: null,
      spec: null,
      containerCount: 1,
      status: null,
      lastSeenAt: SEEN,
      resourceCreationTimestamp: null,
    };
    if (healthSeverity !== undefined) {
      resource.healthSeverity = healthSeverity;
    }
    return resource;
  }

  test("writes it beside the snapshot, and overwrites it with each new snapshot", async () => {
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [parsed(KubernetesHealthSeverity.Critical)],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters]: [string, Array<unknown>] = query.mock.calls[0]!;
    const columnList: string = sql.substring(
      sql.indexOf("(") + 1,
      sql.indexOf(")"),
    );
    const columns: Array<string> = columnList
      .split(",")
      .map((column: string): string => {
        return column.trim().replace(/"/g, "");
      });

    expect(columns).toContain("healthSeverity");
    expect(parameters[columns.indexOf("healthSeverity")]).toBe("critical");
    expect(parameters).toHaveLength(columns.length);
    // A newer snapshot's verdict replaces the old one, healthy included.
    expect(sql).toContain(`"healthSeverity" = EXCLUDED."healthSeverity"`);
  });

  test("writes null for a healthy object and for a row built without a verdict", async () => {
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [parsed(null), parsed(undefined)],
    });

    const [sql, parameters]: [string, Array<unknown>] = query.mock.calls[0]!;
    const columns: Array<string> = sql
      .substring(sql.indexOf("(") + 1, sql.indexOf(")"))
      .split(",")
      .map((column: string): string => {
        return column.trim().replace(/"/g, "");
      });
    const index: number = columns.indexOf("healthSeverity");

    expect(parameters[index]).toBeNull();
    expect(parameters[columns.length + index]).toBeNull();
  });
});

describe("KubernetesResourceService.getNeedsAttention", () => {
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

  async function read(): Promise<KubernetesNeedsAttention> {
    return KubernetesResourceService.getNeedsAttention({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
    });
  }

  test("reads this cluster's flagged live objects, worst first, every value bound", async () => {
    query.mockResolvedValue([]);

    const result: KubernetesNeedsAttention = await read();

    expect(result).toEqual({ findings: [], isTruncated: false });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters]: [string, Array<unknown>] = query.mock.calls[0]!;
    expect(sql).toContain(`"projectId" = $1`);
    expect(sql).toContain(`"kubernetesClusterId" = $2`);
    // The partial index's own predicate, so Postgres reads only flagged rows.
    expect(sql).toContain(`"healthSeverity" IS NOT NULL`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(
      `CASE "healthSeverity" WHEN 'critical' THEN 0 ELSE 1 END`,
    );
    expect(sql).toContain(`LIMIT ${NEEDS_ATTENTION_ROW_LIMIT + 1}`);
    expect(parameters).toEqual([PROJECT.toString(), CLUSTER.toString()]);
    // Never the whole inventory, and never a value spliced into the text.
    expect(sql).not.toContain(PROJECT.toString());
  });

  test("reads no workloads when nothing namespaced needs attention", async () => {
    query.mockResolvedValueOnce([
      row({
        kind: "Node",
        name: "node-3",
        namespaceKey: "",
        isReady: false,
        status: { conditions: [] },
      }),
    ]);

    const result: KubernetesNeedsAttention = await read();

    expect(query).toHaveBeenCalledTimes(1);
    expect(
      result.findings.map((finding: { key: string }) => {
        return finding.key;
      }),
    ).toEqual(["Node:node-3"]);
    expect(result.findings[0]!.severity).toBe(
      KubernetesHealthSeverity.Critical,
    );
  });

  test("reads the workloads of the flagged objects' namespaces and folds each pod into its Deployment", async () => {
    query
      .mockResolvedValueOnce([
        crashLoopingPod("checkout-7d9f8b6c5-aaaaa"),
        crashLoopingPod("checkout-7d9f8b6c5-bbbbb"),
      ])
      .mockResolvedValueOnce([deployment(1)]);

    const result: KubernetesNeedsAttention = await read();

    expect(query).toHaveBeenCalledTimes(2);
    const [sql, parameters]: [string, Array<unknown>] = query.mock.calls[1]!;
    expect(sql).toContain(`"kind" = ANY($3)`);
    expect(sql).toContain(`"namespaceKey" = ANY($4)`);
    expect(sql).toContain(`LIMIT ${NEEDS_ATTENTION_WORKLOAD_LIMIT}`);
    expect(parameters).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      [
        "Deployment",
        "StatefulSet",
        "DaemonSet",
        "Job",
        "CronJob",
        "DeploymentConfig",
      ],
      ["payments"],
    ]);

    expect(result.isTruncated).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      key: "Deployment:payments/checkout",
      kind: "Deployment",
      namespace: "payments",
      name: "checkout",
      severity: KubernetesHealthSeverity.Critical,
      podCount: 2,
    });
  });

  test("asks for each namespace once", async () => {
    query
      .mockResolvedValueOnce([
        crashLoopingPod("checkout-7d9f8b6c5-aaaaa"),
        crashLoopingPod("checkout-7d9f8b6c5-bbbbb"),
        { ...crashLoopingPod("worker-7d9f8b6c5-ccccc"), namespaceKey: "jobs" },
      ])
      .mockResolvedValueOnce([]);

    await read();

    expect(query.mock.calls[1]![1][3]).toEqual(["payments", "jobs"]);
  });

  test("says when more needed attention than one read takes, and keeps the worst", async () => {
    const many: Array<StoredRow> = [];
    for (let index: number = 0; index <= NEEDS_ATTENTION_ROW_LIMIT; index++) {
      many.push(
        row({
          kind: "Node",
          name: `node-${index}`,
          namespaceKey: "",
          isReady: false,
        }),
      );
    }
    query.mockResolvedValueOnce(many);

    const result: KubernetesNeedsAttention = await read();

    expect(result.isTruncated).toBe(true);
    expect(result.findings).toHaveLength(NEEDS_ATTENTION_FINDING_LIMIT);
  });
});
