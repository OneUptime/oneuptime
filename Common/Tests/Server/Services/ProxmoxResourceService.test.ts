import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxResourceLatestMetric,
} from "../../../Server/Services/ProxmoxResourceService";
import ObjectID from "../../../Types/ObjectID";

/*
 * WI-21: the ProxmoxResource inventory write path. The service builds
 * raw parameterized SQL against the TypeORM manager — these tests mock
 * the query runner (no Postgres) and lock in the statement shape:
 *
 *   - COALESCE per identity/status column, so a batch that lacks an
 *     info series (or the WI-24 backup-info collector) keeps the
 *     last-known value instead of blanking it,
 *   - the lastSeenAt dominance guard (out-of-order ingest never
 *     regresses a newer snapshot),
 *   - parameter tuples in exact column order — the INSERT column list
 *     and the params must never drift,
 *   - 500-row chunking,
 *   - NULL metric values stay NULL (a qemu guest without the guest
 *     agent must never read 0 disk).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

type QueryCall = [string, Array<unknown>];

function mockQueryRunner(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest
    .spyOn(ProxmoxResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function parsedResource(
  overrides: Partial<ParsedProxmoxResource> = {},
): ParsedProxmoxResource {
  return {
    kind: "Guest",
    externalId: "qemu/100",
    name: "web-vm",
    vmid: 100,
    guestType: "qemu",
    parentNodeName: "pve1",
    isUp: true,
    haState: null,
    onboot: true,
    isBackedUp: null,
    uptimeSeconds: 3600,
    lastSeenAt: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProxmoxResourceService.bulkUpsert", () => {
  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("emits an ON CONFLICT upsert with COALESCE per identity/status column", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [parsedResource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('INSERT INTO "ProxmoxResource"');
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "proxmoxClusterId", "kind", "externalId")',
    );

    /*
     * Every identity/status column COALESCEs against the existing row —
     * a partial batch must never blank a previously learned value.
     */
    for (const column of [
      "name",
      "vmid",
      "guestType",
      "parentNodeName",
      "isUp",
      "haState",
      "onboot",
      "isBackedUp",
      "uptimeSeconds",
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(EXCLUDED."${column}", "ProxmoxResource"."${column}")`,
      );
    }

    // lastSeenAt is overwritten (not COALESCEd) under the dominance guard.
    expect(sql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"',
    );
  });

  test("parameter tuple matches the INSERT column order exactly", async () => {
    const query: jest.Mock = mockQueryRunner();
    const lastSeenAt: Date = new Date("2026-06-13T00:00:00.000Z");
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        parsedResource({
          isBackedUp: false,
          uptimeSeconds: 3600.9,
          lastSeenAt,
        }),
      ],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    // 15 columns per row: a 1-row batch carries exactly $1..$15.
    expect(params).toHaveLength(15);
    expect(sql).toContain(
      "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    );
    expect(params).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
      "Guest",
      "qemu/100",
      "web-vm",
      100,
      "qemu",
      "pve1",
      true,
      null, // haState
      true, // onboot
      false, // isBackedUp (WI-24) — false is a value, distinct from null
      3600, // uptimeSeconds truncated
      lastSeenAt,
      0, // version
    ]);
  });

  test("tri-state isBackedUp: null rides through so COALESCE keeps the last-known flag", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [parsedResource({ isBackedUp: null })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    // Column 12 (0-indexed 11) is isBackedUp.
    expect(params[11]).toBeNull();
  });

  test("chunks batches of more than 500 rows into multiple statements", async () => {
    const query: jest.Mock = mockQueryRunner();
    const resources: Array<ParsedProxmoxResource> = [];
    for (let i: number = 0; i < 501; i++) {
      resources.push(parsedResource({ externalId: `qemu/${i}`, vmid: i }));
    }

    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(500 * 15);
    expect(secondParams).toHaveLength(15);
  });
});

describe("ProxmoxResourceService.bulkUpdateLatestMetrics", () => {
  function latestMetric(
    overrides: Partial<ProxmoxResourceLatestMetric> = {},
  ): ProxmoxResourceLatestMetric {
    return {
      kind: "Guest",
      externalId: "qemu/100",
      cpuPercent: 12.5,
      memoryBytes: 1024,
      maxMemoryBytes: 2048,
      memoryPercent: 50,
      diskBytes: null,
      maxDiskBytes: null,
      observedAt: new Date("2026-06-13T00:00:00.000Z"),
      ...overrides,
    };
  }

  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      metrics: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("COALESCEs every mirror column and guards on metricsUpdatedAt", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('UPDATE "ProxmoxResource"');
    for (const [column, alias] of [
      ["latestCpuPercent", "cpu"],
      ["latestMemoryBytes", "mem"],
      ["maxMemoryBytes", "maxMem"],
      ["latestMemoryPercent", "memPct"],
      ["latestDiskBytes", "disk"],
      ["maxDiskBytes", "maxDisk"],
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(v."${alias}", p."${column}")`,
      );
    }
    // Out-of-order points never regress a newer observation.
    expect(sql).toContain(
      '(p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")',
    );
  });

  test("missing disk series stays NULL — never coerced to 0 (qemu without guest agent)", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      metrics: [latestMetric({ diskBytes: null, maxDiskBytes: null })],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    /*
     * Params: projectId, clusterId, then per row
     * (kind, externalId, cpu, mem, maxMem, memPct, disk, maxDisk, observedAt).
     */
    expect(params).toHaveLength(2 + 9);
    expect(params[2]).toBe("Guest");
    expect(params[3]).toBe("qemu/100");
    expect(params[8]).toBeNull(); // disk
    expect(params[9]).toBeNull(); // maxDisk
    // Bigint columns are sent as strings to avoid JS precision loss.
    expect(params[5]).toBe("1024");
    expect(params[6]).toBe("2048");
  });
});

describe("ProxmoxResourceService.deleteStaleForCluster", () => {
  test("normalizes the postgres [rows, affected] DELETE result", async () => {
    mockQueryRunner([[], 7]);
    const affected: number = await ProxmoxResourceService.deleteStaleForCluster(
      {
        proxmoxClusterId: CLUSTER_ID,
        olderThan: new Date("2026-06-13T00:00:00.000Z"),
      },
    );
    expect(affected).toBe(7);
  });

  test("returns 0 when the driver result carries no affected count", async () => {
    mockQueryRunner({});
    const affected: number = await ProxmoxResourceService.deleteStaleForCluster(
      {
        proxmoxClusterId: CLUSTER_ID,
        olderThan: new Date("2026-06-13T00:00:00.000Z"),
      },
    );
    expect(affected).toBe(0);
  });
});

describe("ProxmoxResourceService.getStaleThresholdMinutes", () => {
  const ENV_KEY: string = "PVE_INVENTORY_STALE_MINUTES";
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedValue;
    }
  });

  test("defaults to 15 minutes (3x the 5-minute scrape interval)", () => {
    delete process.env[ENV_KEY];
    expect(ProxmoxResourceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("honors the env override", () => {
    process.env[ENV_KEY] = "30";
    expect(ProxmoxResourceService.getStaleThresholdMinutes()).toBe(30);
  });

  test("rejects overrides below the 5-minute floor and non-numbers", () => {
    process.env[ENV_KEY] = "2";
    expect(ProxmoxResourceService.getStaleThresholdMinutes()).toBe(15);
    process.env[ENV_KEY] = "not-a-number";
    expect(ProxmoxResourceService.getStaleThresholdMinutes()).toBe(15);
  });
});
