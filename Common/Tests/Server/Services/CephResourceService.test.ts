import CephResourceService, {
  ParsedCephResource,
  CephResourceLatestMetric,
} from "../../../Server/Services/CephResourceService";
import ObjectID from "../../../Types/ObjectID";

/*
 * WI-21: the CephResource inventory write path — same mocked-query-
 * runner shape as the ProxmoxResourceService tests. Locks in the
 * COALESCE-per-column upsert (a batch lacking a *_metadata series must
 * not blank hostname/deviceClass/daemonVersion), the lastSeenAt
 * dominance guard, exact parameter ordering, and the bigint-as-string
 * convention on the latest-metric mirror.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

type QueryCall = [string, Array<unknown>];

function mockQueryRunner(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest
    .spyOn(CephResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function parsedResource(
  overrides: Partial<ParsedCephResource> = {},
): ParsedCephResource {
  return {
    kind: "Osd",
    externalId: "osd.3",
    name: null,
    hostname: "ceph-node-1",
    daemonVersion: "ceph version 18.2.2 reef",
    deviceClass: "ssd",
    isUp: true,
    isIn: true,
    inQuorum: null,
    lastSeenAt: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CephResourceService.bulkUpsert", () => {
  test("does nothing for an empty batch", async () => {
    const query: jest.Mock = mockQueryRunner();
    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      resources: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  test("emits an ON CONFLICT upsert with COALESCE per identity/status column", async () => {
    const query: jest.Mock = mockQueryRunner();
    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      resources: [parsedResource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as QueryCall;

    expect(sql).toContain('INSERT INTO "CephResource"');
    expect(sql).toContain(
      'ON CONFLICT ("projectId", "cephClusterId", "kind", "externalId")',
    );

    for (const column of [
      "name",
      "hostname",
      "daemonVersion",
      "deviceClass",
      "isUp",
      "isIn",
      "inQuorum",
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(EXCLUDED."${column}", "CephResource"."${column}")`,
      );
    }

    expect(sql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(sql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "CephResource"."lastSeenAt"',
    );
  });

  test("parameter tuple matches the INSERT column order exactly", async () => {
    const query: jest.Mock = mockQueryRunner();
    const lastSeenAt: Date = new Date("2026-06-13T00:00:00.000Z");
    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      resources: [parsedResource({ lastSeenAt })],
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;

    // 13 columns per row: a 1-row batch carries exactly $1..$13.
    expect(params).toHaveLength(13);
    expect(sql).toContain(
      "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    );
    expect(params).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
      "Osd",
      "osd.3",
      null, // name — pool-only identity, NULL for daemons
      "ceph-node-1",
      "ceph version 18.2.2 reef",
      "ssd",
      true, // isUp
      true, // isIn
      null, // inQuorum — mon-only, NULL for OSDs
      lastSeenAt,
      0, // version
    ]);
  });

  test("chunks batches of more than 500 rows into multiple statements", async () => {
    const query: jest.Mock = mockQueryRunner();
    const resources: Array<ParsedCephResource> = [];
    for (let i: number = 0; i < 501; i++) {
      resources.push(parsedResource({ externalId: `osd.${i}` }));
    }

    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      resources,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [, firstParams] = query.mock.calls[0] as QueryCall;
    const [, secondParams] = query.mock.calls[1] as QueryCall;
    expect(firstParams).toHaveLength(500 * 13);
    expect(secondParams).toHaveLength(13);
  });
});

describe("CephResourceService.bulkUpdateLatestMetrics", () => {
  function latestMetric(
    overrides: Partial<CephResourceLatestMetric> = {},
  ): CephResourceLatestMetric {
    return {
      kind: "Osd",
      externalId: "osd.3",
      statBytes: 4000000000,
      statBytesUsed: 1000000000,
      applyLatencyMs: 12.5,
      commitLatencyMs: 10,
      pgCount: 96.7,
      storedBytes: null,
      maxAvailBytes: null,
      objects: null,
      readOpsCounter: null,
      writeOpsCounter: null,
      observedAt: new Date("2026-06-13T00:00:00.000Z"),
      ...overrides,
    };
  }

  test("COALESCEs every mirror column and guards on metricsUpdatedAt", async () => {
    const query: jest.Mock = mockQueryRunner();
    await CephResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      metrics: [latestMetric()],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('UPDATE "CephResource"');
    for (const column of [
      "statBytes",
      "statBytesUsed",
      "applyLatencyMs",
      "commitLatencyMs",
      "pgCount",
      "storedBytes",
      "maxAvailBytes",
      "objects",
      "readOpsCounter",
      "writeOpsCounter",
    ]) {
      expect(sql).toContain(
        `"${column}" = COALESCE(v."${column}", c."${column}")`,
      );
    }
    expect(sql).toContain(
      '(c."metricsUpdatedAt" IS NULL OR v."observedAt" >= c."metricsUpdatedAt")',
    );
  });

  test("bigints ride as strings, integers truncate, missing series stay NULL", async () => {
    const query: jest.Mock = mockQueryRunner();
    await CephResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      cephClusterId: CLUSTER_ID,
      metrics: [latestMetric()],
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    /*
     * Params: projectId, clusterId, then per row (kind, externalId,
     * statBytes, statBytesUsed, applyLatencyMs, commitLatencyMs,
     * pgCount, storedBytes, maxAvailBytes, objects, readOpsCounter,
     * writeOpsCounter, observedAt).
     */
    expect(params).toHaveLength(2 + 13);
    expect(params[4]).toBe("4000000000"); // statBytes as string
    expect(params[6]).toBe(12.5); // latency stays numeric
    expect(params[8]).toBe(96); // pgCount truncated
    expect(params[9]).toBeNull(); // storedBytes — OSD row, not a pool
    expect(params[12]).toBeNull(); // readOpsCounter
  });
});

describe("CephResourceService.deleteStaleForCluster", () => {
  test("normalizes the postgres [rows, affected] DELETE result", async () => {
    mockQueryRunner([[], 3]);
    const affected: number = await CephResourceService.deleteStaleForCluster({
      cephClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
    });
    expect(affected).toBe(3);
  });
});

describe("CephResourceService.getStaleThresholdMinutes", () => {
  const ENV_KEY: string = "CEPH_INVENTORY_STALE_MINUTES";
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

  test("defaults to 15 minutes and clamps bad overrides", () => {
    delete process.env[ENV_KEY];
    expect(CephResourceService.getStaleThresholdMinutes()).toBe(15);
    process.env[ENV_KEY] = "45";
    expect(CephResourceService.getStaleThresholdMinutes()).toBe(45);
    process.env[ENV_KEY] = "1";
    expect(CephResourceService.getStaleThresholdMinutes()).toBe(15);
  });
});
