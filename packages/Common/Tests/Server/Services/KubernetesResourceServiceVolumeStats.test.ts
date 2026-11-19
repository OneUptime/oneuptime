import KubernetesResourceService, {
  ResourceLatestVolumeStats,
} from "../../../Server/Services/KubernetesResourceService";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A persistent volume claim's latest usage, mirrored onto its row (#9539):
 * KubernetesResourceService.bulkUpdateLatestVolumeStats, the claim's twin of
 * bulkUpdateLatestMetrics. The statement is pinned as text here, with a fake
 * manager.query; KubernetesVolumeClaimUsagePostgres runs it on a migrated
 * Postgres, and LatestMetricsValuesShape holds its VALUES tuples to their
 * aliases.
 */

type QueryCall = [string, Array<unknown>];

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const OBSERVED_AT: Date = new Date("2026-11-18T10:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

function volume(
  fields: Partial<ResourceLatestVolumeStats> = {},
): ResourceLatestVolumeStats {
  return {
    namespaceKey: "default",
    name: "data-postgres-0",
    capacityBytes: 50 * GIB,
    availableBytes: 14 * GIB,
    inodes: 3276800,
    inodesFree: 3200000,
    observedAt: OBSERVED_AT,
    ...fields,
  };
}

function captureQueries(): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue([]);
  jest
    .spyOn(KubernetesResourceService, "getRepository")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KubernetesResourceService.bulkUpdateLatestVolumeStats", () => {
  test("writes nothing for no claims", async () => {
    const query: jest.Mock = captureQueries();

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [],
    });

    expect(query).not.toHaveBeenCalled();
  });

  test("updates only the claim's own row, in its project and cluster", async () => {
    const query: jest.Mock = captureQueries();

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [volume()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toMatch(/UPDATE "KubernetesResource" AS k/);
    expect(sql).toMatch(/k\."projectId" = \$1/);
    expect(sql).toMatch(/k\."kubernetesClusterId" = \$2/);
    // A claim, never a pod or a PersistentVolume of the same name.
    expect(sql).toMatch(/k\."kind" = 'PersistentVolumeClaim'/);
    expect(sql).toMatch(/k\."namespaceKey" = v\."ns"/);
    expect(sql).toMatch(/k\."name" = v\."name"/);
    expect(params.slice(0, 2)).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
    ]);
  });

  test("binds the claim and its readings as whole bytes, in the tuple's order", async () => {
    const query: jest.Mock = captureQueries();

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [volume({ availableBytes: 14 * GIB + 0.7 })],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toMatch(
      /AS v\("ns", "name", "capacity", "available", "inodes", "inodesFree", "observedAt"\)/,
    );
    expect(params.slice(2)).toEqual([
      "default",
      "data-postgres-0",
      String(50 * GIB),
      String(14 * GIB),
      "3276800",
      "3200000",
      OBSERVED_AT,
    ]);
  });

  test("keeps the stored reading where a batch carries none, and never writes a negative or an infinite one", async () => {
    const query: jest.Mock = captureQueries();

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [
        volume({
          capacityBytes: null,
          availableBytes: -5,
          inodes: Number.POSITIVE_INFINITY,
          inodesFree: Number.NaN,
        }),
      ],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(params.slice(4, 8)).toEqual([null, "0", null, null]);
    for (const [column, alias] of [
      ["latestVolumeCapacityBytes", "capacity"],
      ["latestVolumeAvailableBytes", "available"],
      ["latestVolumeInodes", "inodes"],
      ["latestVolumeInodesFree", "inodesFree"],
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(v."${alias}", k."${column}")`,
      );
    }
  });

  test("dates the readings, and never lets an older point overwrite a newer one", async () => {
    const query: jest.Mock = captureQueries();

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [volume()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain(`"metricsUpdatedAt" = v."observedAt"`);
    expect(sql).toContain(
      `(k."metricsUpdatedAt" IS NULL OR v."observedAt" >= k."metricsUpdatedAt")`,
    );
  });

  test("clamps a claim's identity as the snapshot upsert does, so the update finds the row it wrote", async () => {
    const query: jest.Mock = captureQueries();
    const oversized: string = "x".repeat(900);

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: [volume({ namespaceKey: oversized, name: oversized })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;

    expect(params[2]).toBe(oversized.substring(0, ColumnLength.ShortText));
    expect(params[3]).toBe(oversized.substring(0, ColumnLength.LongText));
  });

  test("writes a large cluster's claims in chunks of 500", async () => {
    const query: jest.Mock = captureQueries();
    const volumes: Array<ResourceLatestVolumeStats> = Array.from(
      { length: 1001 },
      (_: unknown, i: number) => {
        return volume({ name: `data-${i}` });
      },
    );

    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      volumes: volumes,
    });

    expect(query).toHaveBeenCalledTimes(3);
    const sizes: Array<number> = query.mock.calls.map((call: unknown) => {
      return ((call as QueryCall)[1].length - 2) / 7;
    });
    expect(sizes).toEqual([500, 500, 1]);
    // Every chunk numbers its own placeholders from $3.
    for (const call of query.mock.calls) {
      expect((call as QueryCall)[0]).toContain("($3, $4, $5::bigint");
    }
  });
});
