import KubernetesResourceService, {
  KUBERNETES_DISK_COLUMNS,
  KubernetesNeedsAttention,
  ResourceLatestNodeFilesystem,
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
 * A claim's and a node's verdict reads its disk (#9643, #9645), and two
 * writers keep it: the metrics path, which writes the disk reading and
 * works the verdict out again for the rows it touched, and the snapshot,
 * which carries no disk and so works its verdict out with the one the row
 * holds. These pin the statements with a fake manager.query;
 * KubernetesDiskVerdictsPostgres runs them on a migrated Postgres.
 */

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const SEEN: Date = new Date("2026-11-19T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

function minutesAfter(minutes: number): Date {
  return new Date(SEEN.getTime() + minutes * 60 * 1000);
}

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

// A row as an UPDATE ... RETURNING hands it back: the rules' columns.
function returnedRow(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: "30000000-0000-4000-8000-000000000003",
    kind: "Node",
    namespaceKey: "",
    name: "node-1",
    phase: null,
    isReady: true,
    hasMemoryPressure: false,
    hasDiskPressure: false,
    hasPidPressure: false,
    labels: null,
    ownerReferences: null,
    spec: {},
    status: { conditions: [{ type: "Ready", status: "True" }] },
    lastSeenAt: SEEN,
    resourceCreationTimestamp: SEEN,
    healthSeverity: null,
    latestVolumeCapacityBytes: String(100 * GIB),
    latestVolumeAvailableBytes: String(50 * GIB),
    latestVolumeInodes: null,
    latestVolumeInodesFree: null,
    latestVolumeMeasuredAt: minutesAfter(1),
    latestVolumeUsedBaselineBytes: null,
    latestVolumeUsedBaselineAt: null,
    latestImageFsCapacityBytes: null,
    latestImageFsAvailableBytes: null,
    metricsUpdatedAt: minutesAfter(1),
    ...fields,
  };
}

function nodeFilesystem(
  fields: Partial<ResourceLatestNodeFilesystem> = {},
): ResourceLatestNodeFilesystem {
  return {
    name: "node-1",
    capacityBytes: 100 * GIB,
    availableBytes: 8 * GIB,
    imageFs: { state: "unknown" },
    observedAt: minutesAfter(1),
    ...fields,
  };
}

describe("KubernetesResourceService.bulkUpdateLatestNodeFilesystems", () => {
  test("writes nothing for no nodes", async () => {
    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("updates the node's own row, its root disk in the claim columns, dated and guarded by its own time", async () => {
    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [nodeFilesystem()],
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE "KubernetesResource" AS k/);
    expect(sql).toMatch(/k\."kind" = 'Node'/);
    expect(sql).toMatch(/k\."namespaceKey" = ''/);
    expect(sql).toMatch(/k\."name" = v\."name"/);
    expect(sql).toContain(
      `"latestVolumeCapacityBytes" = COALESCE(v."capacity", k."latestVolumeCapacityBytes")`,
    );
    expect(sql).toContain(
      `"latestVolumeAvailableBytes" = COALESCE(v."available", k."latestVolumeAvailableBytes")`,
    );
    expect(sql).toContain(`"latestVolumeMeasuredAt" = v."observedAt"`);
    expect(sql).toContain(
      `(k."latestVolumeMeasuredAt" IS NULL OR v."observedAt" >= k."latestVolumeMeasuredAt")`,
    );
    // Its CPU and memory own metricsUpdatedAt: the disk never moves it.
    expect(sql).not.toContain(`"metricsUpdatedAt" =`);
    expect(params).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      "node-1",
      String(100 * GIB),
      String(8 * GIB),
      "unknown",
      null,
      null,
      minutesAfter(1),
    ]);
  });

  test("stores an image disk of its own, clears one that is the root disk, and keeps it when the batch cannot tell", async () => {
    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [
        nodeFilesystem({
          name: "a",
          imageFs: {
            state: "separate",
            capacityBytes: 500 * GIB,
            availableBytes: 20 * GIB,
          },
        }),
        nodeFilesystem({ name: "b", imageFs: { state: "same" } }),
      ],
    });

    const [sql, params] = query.mock.calls[0]!;
    for (const [column, value] of [
      ["latestImageFsCapacityBytes", "imageCapacity"],
      ["latestImageFsAvailableBytes", "imageAvailable"],
    ]) {
      expect(sql.replace(/\s+/g, " ")).toContain(
        `"${column}" = CASE v."imageFsState" WHEN 'separate' THEN v."${value}" WHEN 'same' THEN NULL ELSE k."${column}" END`,
      );
    }
    expect(params.slice(2)).toEqual([
      "a",
      String(100 * GIB),
      String(8 * GIB),
      "separate",
      String(500 * GIB),
      String(20 * GIB),
      minutesAfter(1),
      "b",
      String(100 * GIB),
      String(8 * GIB),
      "same",
      null,
      null,
      minutesAfter(1),
    ]);
  });

  test("returns what the rules read, and writes the verdict of a node whose disk changed it", async () => {
    query.mockResolvedValueOnce([
      returnedRow({ latestVolumeAvailableBytes: String(7 * GIB) }),
    ]);

    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [nodeFilesystem()],
    });

    const [update] = query.mock.calls[0]!;
    for (const column of [
      "_id",
      "status",
      "lastSeenAt",
      "healthSeverity",
      ...KUBERNETES_DISK_COLUMNS,
    ]) {
      expect(update).toContain(`k."${column}"`);
    }
    expect(update).toMatch(/RETURNING k\."_id"/);

    expect(query).toHaveBeenCalledTimes(2);
    const [verdictSql, verdictParams] = query.mock.calls[1]!;
    expect(verdictSql).toContain(`SET "healthSeverity" = v."severity"`);
    // Only while the stored verdict is still the one read.
    expect(verdictSql).toContain(
      `k."healthSeverity" IS NOT DISTINCT FROM v."previous"`,
    );
    expect(verdictParams).toEqual([
      "30000000-0000-4000-8000-000000000003",
      KubernetesHealthSeverity.Critical,
      null,
    ]);
  });

  test("writes no verdict that did not change", async () => {
    query.mockResolvedValueOnce([
      returnedRow({
        healthSeverity: KubernetesHealthSeverity.Critical,
        latestVolumeAvailableBytes: String(5 * GIB),
      }),
      returnedRow({
        _id: "30000000-0000-4000-8000-000000000004",
        name: "node-2",
      }),
    ]);

    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [nodeFilesystem(), nodeFilesystem({ name: "node-2" })],
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  test("clears the verdict of a node that has room again", async () => {
    query.mockResolvedValueOnce([
      returnedRow({ healthSeverity: KubernetesHealthSeverity.Warning }),
    ]);

    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [nodeFilesystem({ availableBytes: 50 * GIB })],
    });

    expect(query.mock.calls[1]![1]).toEqual([
      "30000000-0000-4000-8000-000000000003",
      null,
      KubernetesHealthSeverity.Warning,
    ]);
  });

  test("reads the rows whether the driver hands them as rows or as [rows, count]", async () => {
    query.mockResolvedValueOnce([
      [returnedRow({ latestVolumeAvailableBytes: String(15 * GIB) })],
      1,
    ]);

    await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      nodes: [nodeFilesystem()],
    });

    expect(query.mock.calls[1]![1]).toEqual([
      "30000000-0000-4000-8000-000000000003",
      KubernetesHealthSeverity.Warning,
      null,
    ]);
  });
});

describe("KubernetesResourceService.bulkUpdateLatestVolumeStats", () => {
  test("dates the reading, moves the claim's fill baseline, and works out the claim's verdict", async () => {
    query.mockResolvedValueOnce([
      returnedRow({
        kind: "PersistentVolumeClaim",
        namespaceKey: "db",
        name: "data-postgres-0",
        status: { phase: "Bound" },
        latestVolumeAvailableBytes: String(18 * GIB),
      }),
    ]);

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      volumes: [
        {
          namespaceKey: "db",
          name: "data-postgres-0",
          capacityBytes: 100 * GIB,
          availableBytes: 18 * GIB,
          inodes: null,
          inodesFree: null,
          observedAt: minutesAfter(1),
        },
      ],
    });

    const [sql] = query.mock.calls[0]!;
    const flat: string = sql.replace(/\s+/g, " ");
    expect(flat).toContain(`"latestVolumeMeasuredAt" = v."observedAt"`);
    expect(flat).toContain(`"latestVolumeUsedBaselineBytes" = CASE`);
    expect(flat).toContain(`"latestVolumeUsedBaselineAt" = CASE`);
    // Six hours back at most, halved to a point on the same line.
    expect(flat).toContain(
      `v."observedAt" - k."latestVolumeUsedBaselineAt" > interval '21600 seconds'`,
    );
    expect(flat).toContain(
      `k."latestVolumeUsedBaselineAt" + (v."observedAt" - k."latestVolumeUsedBaselineAt") / 2`,
    );
    expect(flat).toMatch(/RETURNING k\."_id"/);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![1]).toEqual([
      "30000000-0000-4000-8000-000000000003",
      KubernetesHealthSeverity.Warning,
      null,
    ]);
  });
});

describe("KubernetesResourceService.bulkUpsert keeps a claim's and a node's disk verdict", () => {
  function parsedClaim(
    fields: Partial<ParsedKubernetesResource> = {},
  ): ParsedKubernetesResource {
    return {
      kind: "PersistentVolumeClaim",
      namespaceKey: "db",
      name: "data-postgres-0",
      uid: "claim-uid-1",
      phase: "Bound",
      isReady: null,
      hasMemoryPressure: null,
      hasDiskPressure: null,
      hasPidPressure: null,
      labels: null,
      annotations: null,
      ownerReferences: null,
      spec: { volumeMode: "Filesystem" },
      containerCount: null,
      status: { phase: "Bound" },
      lastSeenAt: minutesAfter(3),
      resourceCreationTimestamp: SEEN,
      // The snapshot's own verdict: Bound, nothing wrong.
      healthSeverity: null,
      ...fields,
    };
  }

  function storedDisk(
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      kind: "PersistentVolumeClaim",
      namespaceKey: "db",
      name: "data-postgres-0",
      uid: "claim-uid-1",
      latestVolumeCapacityBytes: String(100 * GIB),
      latestVolumeAvailableBytes: String(5 * GIB),
      latestVolumeInodes: null,
      latestVolumeInodesFree: null,
      latestVolumeMeasuredAt: minutesAfter(1),
      latestVolumeUsedBaselineBytes: null,
      latestVolumeUsedBaselineAt: null,
      latestImageFsCapacityBytes: null,
      latestImageFsAvailableBytes: null,
      metricsUpdatedAt: minutesAfter(1),
      ...fields,
    };
  }

  function upsertedSeverity(): unknown {
    const insert: [string, Array<unknown>] = query.mock.calls.find(
      (call: [string, Array<unknown>]): boolean => {
        return call[0].includes("INSERT INTO");
      },
    )!;
    const columns: Array<string> = insert[0]
      .substring(insert[0].indexOf("(") + 1, insert[0].indexOf(")"))
      .split(",")
      .map((column: string): string => {
        return column.trim().replace(/"/g, "");
      });
    return insert[1][columns.indexOf("healthSeverity")];
  }

  test("works the claim's verdict out with the reading its row holds", async () => {
    query.mockResolvedValueOnce([storedDisk()]);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [parsedClaim()],
    });

    const [read, params] = query.mock.calls[0]!;
    expect(read).toMatch(/"kind" = ANY\(\$3\)/);
    expect(read).toMatch(/"name" = ANY\(\$4\)/);
    expect(params).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      ["PersistentVolumeClaim"],
      ["data-postgres-0"],
    ]);
    expect(upsertedSeverity()).toBe(KubernetesHealthSeverity.Critical);
  });

  test("a reading older than the snapshot's fifteen minutes no longer flags it", async () => {
    query.mockResolvedValueOnce([
      storedDisk({ latestVolumeMeasuredAt: minutesAfter(-20) }),
    ]);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [parsedClaim()],
    });

    expect(upsertedSeverity()).toBeNull();
  });

  test("a new claim under the same name gets none of the old one's reading", async () => {
    query.mockResolvedValueOnce([storedDisk({ uid: "claim-uid-0" })]);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [parsedClaim()],
    });

    expect(upsertedSeverity()).toBeNull();
    const insert: string = query.mock.calls[1]![0].replace(/\s+/g, " ");
    for (const column of KUBERNETES_DISK_COLUMNS) {
      expect(insert).toContain(
        `"${column}" = CASE WHEN "KubernetesResource"."uid" IS NOT NULL AND EXCLUDED."uid" IS NOT NULL AND "KubernetesResource"."uid" <> EXCLUDED."uid" THEN NULL ELSE "KubernetesResource"."${column}" END`,
      );
    }
  });

  test("a worse verdict of the snapshot's own stays: the disk only adds", async () => {
    query.mockResolvedValueOnce([
      storedDisk({ latestVolumeAvailableBytes: String(15 * GIB) }),
    ]);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [
        parsedClaim({
          phase: "Lost",
          status: { phase: "Lost" },
          healthSeverity: KubernetesHealthSeverity.Critical,
        }),
      ],
    });

    expect(upsertedSeverity()).toBe(KubernetesHealthSeverity.Critical);
  });

  test("a batch with no claim or node reads no disk", async () => {
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      resources: [
        parsedClaim({
          kind: "Pod",
          name: "web-0",
          status: { phase: "Running" },
        }),
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain("INSERT INTO");
  });
});

describe("KubernetesResourceService.getNeedsAttention names a claim's pod", () => {
  function flaggedClaim(
    fields: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      kind: "PersistentVolumeClaim",
      namespaceKey: "db",
      name: "data-postgres-0",
      phase: "Bound",
      isReady: null,
      hasMemoryPressure: null,
      hasDiskPressure: null,
      hasPidPressure: null,
      labels: null,
      ownerReferences: null,
      spec: { volumeMode: "Filesystem" },
      status: { phase: "Bound" },
      lastSeenAt: SEEN,
      resourceCreationTimestamp: SEEN,
      latestVolumeCapacityBytes: String(100 * GIB),
      latestVolumeAvailableBytes: String(6 * GIB),
      latestVolumeInodes: null,
      latestVolumeInodesFree: null,
      latestVolumeMeasuredAt: minutesAfter(1),
      latestVolumeUsedBaselineBytes: null,
      latestVolumeUsedBaselineAt: null,
      latestImageFsCapacityBytes: null,
      latestImageFsAvailableBytes: null,
      metricsUpdatedAt: minutesAfter(1),
      ...fields,
    };
  }

  async function read(): Promise<KubernetesNeedsAttention> {
    return KubernetesResourceService.getNeedsAttention({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
    });
  }

  test("reads the disk columns, so the rules see the claim's reading", async () => {
    query.mockResolvedValue([]);
    await read();
    const [sql] = query.mock.calls[0]!;
    for (const column of [...KUBERNETES_DISK_COLUMNS, "metricsUpdatedAt"]) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  test("a pod in its namespace that mounts it, a running one first", async () => {
    query
      // The flagged rows, then their namespaces' workloads.
      .mockResolvedValueOnce([flaggedClaim()])
      .mockResolvedValueOnce([])
      // The pods that mount it.
      .mockResolvedValueOnce([
        {
          namespaceKey: "db",
          name: "migrate-x7k2p",
          phase: "Succeeded",
          spec: {
            volumes: [
              {
                name: "data",
                type: "persistentVolumeClaim",
                source: "data-postgres-0",
              },
            ],
          },
        },
        {
          namespaceKey: "db",
          name: "postgres-0",
          phase: "Running",
          spec: {
            volumes: [
              {
                name: "data",
                type: "persistentVolumeClaim",
                source: "data-postgres-0",
              },
              { name: "config", type: "configMap", source: "pg-config" },
            ],
          },
        },
      ]);

    const result: KubernetesNeedsAttention = await read();

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      key: "PersistentVolumeClaim:db/data-postgres-0",
      severity: KubernetesHealthSeverity.Critical,
      pod: "postgres-0",
    });

    const [podSql, podParams] = query.mock.calls[2]!;
    expect(podSql).toMatch(/"kind" = 'Pod'/);
    expect(podSql).toMatch(/"namespaceKey" = ANY\(\$3\)/);
    expect(podSql).toContain(
      `'$.volumes[*] ? (@.type == "persistentVolumeClaim" && @.source == $claims[*])'`,
    );
    expect(podParams).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      ["db"],
      JSON.stringify(["data-postgres-0"]),
    ]);
  });

  test("a generic ephemeral volume's claim names the pod that owns it, with no read", async () => {
    query
      .mockResolvedValueOnce([
        flaggedClaim({
          name: "web-0-scratch",
          ownerReferences: {
            items: [{ kind: "Pod", name: "web-0", uid: "pod-uid" }],
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    const result: KubernetesNeedsAttention = await read();

    expect(result.findings[0]!.pod).toBe("web-0");
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("a claim no pod mounts names none", async () => {
    query
      .mockResolvedValueOnce([flaggedClaim()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result: KubernetesNeedsAttention = await read();

    expect(result.findings[0]!.pod).toBeUndefined();
  });
});

describe("KubernetesResourceService.getPodOwnedVolumeClaims", () => {
  test("lists the claims a pod owns, with the pod, in this cluster", async () => {
    query.mockResolvedValueOnce([
      { namespaceKey: "web", name: "web-0-scratch", podName: "web-0" },
      { namespaceKey: "web", name: "orphan", podName: null },
    ]);

    const claims: Array<{ namespace: string; name: string; podName: string }> =
      await KubernetesResourceService.getPodOwnedVolumeClaims({
        projectId: PROJECT,
        kubernetesClusterId: CLUSTER,
      });

    expect(claims).toEqual([
      { namespace: "web", name: "web-0-scratch", podName: "web-0" },
    ]);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/"kind" = 'PersistentVolumeClaim'/);
    expect(sql).toContain(`'$.items[*] ? (@.kind == "Pod")'`);
    expect(params).toEqual([PROJECT.toString(), CLUSTER.toString()]);
  });
});
