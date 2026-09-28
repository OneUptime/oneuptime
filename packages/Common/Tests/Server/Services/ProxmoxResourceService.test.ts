import { AddProxmoxResourceIsNativePush1796100000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1796100000000-AddProxmoxResourceIsNativePush";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxResourceLatestMetric,
} from "../../../Server/Services/ProxmoxResourceService";
import logger from "../../../Server/Utils/Logger";
import {
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  decideProxmoxSilentNodes,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
} from "../../../Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { QueryRunner } from "typeorm";

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
 *
 * Proxmox VE native push, silent nodes: a node that dies just goes
 * quiet, so the nodes still alive report it (ProxmoxNativeNodeLiveness).
 * The inventory side of that is locked in here:
 *
 *   - bulkUpsert records where each batch came from — isNativePush, true
 *     for the Proxmox VE native push and false for the agent (never NULL:
 *     an omitted flag is false) — and overwrites it under the lastSeenAt
 *     guard, so it follows the latest observation and a cluster moved
 *     from one to the other follows too,
 *   - getNodeRoster reads live Node rows seen since the retention cutoff
 *     (getSilentNodeRetentionCutoff) and parses `node/<name>` back into
 *     the node name,
 *   - markNodesNotReporting turns the row Offline — isUp false,
 *     uptimeSeconds cleared — and flags it isNativePush = true (a node the
 *     native pushes report is a member of a native-push cluster, whatever
 *     wrote its row last); it never touches lastSeenAt or
 *     metricsUpdatedAt, which stay the node's own last push; it never
 *     rewrites a row already Offline and native, and never marks a row the
 *     node refreshed itself after `silentBefore`,
 *   - removeOfflineNode deletes a Node row only while it is Offline,
 *   - deleteStaleForCluster, while silent-node detection is on (the
 *     default), keeps a native-push Node row until its own last push
 *     falls behind the SAME retention cutoff getNodeRoster reads — marked
 *     Offline or not, reported or not: those rows ARE the cluster's
 *     membership — and nothing else (agent rows, pre-migration NULL rows,
 *     guests and storage all age out at the normal cutoff); with it
 *     switched off (PVE_NATIVE_NODE_SILENCE_DETECTION=false) nothing
 *     would ever mark a dead node, so it runs the plain prune and every
 *     row ages out at the normal cutoff,
 *   - an in-memory model of the table runs those exact statements (and
 *     the migration that adds isNativePush) end to end: through OneUptime
 *     outages of any length up to the retention window — a node that
 *     died before or during one included — past it, after the node comes
 *     back, across a switch from the native push to the agent and back,
 *     from a release before isNativePush, with detection switched off,
 *     and for the rows the keep must not cover.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const RETENTION_ENV_KEY: string = "PVE_SILENT_NODE_RETENTION_HOURS";
const STALE_ENV_KEY: string = "PVE_INVENTORY_STALE_MINUTES";
const DETECTION_ENV_KEY: string = "PVE_NATIVE_NODE_SILENCE_DETECTION";

/*
 * The two statements deleteStaleForCluster sends, whitespace collapsed:
 * with silent-node detection on (the default), the prune with the native
 * Node keep; with it switched off, the plain prune from before the keep.
 */
const PRUNE_WITH_NATIVE_KEEP_SQL: string =
  'DELETE FROM "ProxmoxResource" WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2 AND NOT ("kind" = \'Node\' AND "isNativePush" IS TRUE AND "lastSeenAt" >= $3)';
const PLAIN_PRUNE_SQL: string =
  'DELETE FROM "ProxmoxResource" WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2';

// markNodesNotReporting's full WHERE, whitespace collapsed.
const MARK_WHERE_SQL: string =
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "externalId" = ANY($3) AND "deletedAt" IS NULL AND "lastSeenAt" < $4 AND ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true)';

/*
 * PVE_NATIVE_NODE_SILENCE_DETECTION values: only "false" (any case,
 * trimmed) switches silent-node detection off; anything else leaves it on.
 */
const DETECTION_OFF_VALUES: Array<[string]> = [
  ["false"],
  ["FALSE"],
  [" False "],
  ["false\n"],
];
const DETECTION_ON_VALUES: Array<[string]> = [
  [""],
  ["true"],
  ["TRUE"],
  ["0"],
  ["no"],
  ["off"],
  ["disabled"],
  ["f"],
  ["garbage"],
  ["falsey"],
];

type QueryCall = [string, Array<unknown>];

type RosterRow = {
  externalId: string | null;
  lastSeenAt: Date | string;
};

function mockQueryRunner(result: unknown = []): jest.Mock {
  return mockQueryResolving(result);
}

/*
 * Like mockQueryRunner, but without the default — so a test can make
 * the driver resolve `undefined` itself.
 */
function mockQueryResolving(result: unknown): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue(result);
  jest
    .spyOn(ProxmoxResourceService, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

/*
 * The statements are multi-line template literals; collapse whitespace
 * so assertions pin the SQL, not its indentation.
 */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

// The text between SET and WHERE of an UPDATE — the columns it writes.
function setClauseOf(sql: string): string {
  const normalized: string = normalizeSql(sql);
  const setIndex: number = normalized.indexOf(" SET ");
  const whereIndex: number = normalized.indexOf(" WHERE ");
  expect(setIndex).toBeGreaterThan(-1);
  expect(whereIndex).toBeGreaterThan(setIndex);
  return normalized.substring(setIndex, whereIndex);
}

// The text from WHERE to the end — the rows a statement may touch.
function whereClauseOf(sql: string): string {
  const normalized: string = normalizeSql(sql);
  const whereIndex: number = normalized.indexOf(" WHERE ");
  expect(whereIndex).toBeGreaterThan(-1);
  return normalized.substring(whereIndex);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * Save and restore one env var around every test of the enclosing
 * describe, so an override never leaks into another test.
 */
function preserveEnv(key: string): void {
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[key];
    delete process.env[key];
  });

  afterEach(() => {
    if (savedValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedValue;
    }
  });
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

    // 16 columns per row: a 1-row batch carries exactly $1..$16.
    expect(params).toHaveLength(16);
    expect(sql).toContain(
      "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    );
    expect(sql).not.toContain("$17");
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
      false, // isNativePush — omitted by the caller, so not native
      0, // version
    ]);
  });

  test.each([
    ["omitted", false, {}],
    ["undefined", false, { isNativePush: undefined }],
    ["false (an agent batch)", false, { isNativePush: false }],
    ["true (a native push)", true, { isNativePush: true }],
  ] as Array<[string, boolean, { isNativePush?: boolean | undefined }]>)(
    "isNativePush %s is bound on every row of every chunk as %p — never NULL",
    async (
      _label: string,
      expected: boolean,
      flag: { isNativePush?: boolean | undefined },
    ) => {
      const query: jest.Mock = mockQueryRunner();
      const resources: Array<ParsedProxmoxResource> = [];
      for (let i: number = 0; i < 501; i++) {
        resources.push(parsedResource({ externalId: `qemu/${i}`, vmid: i }));
      }

      await ProxmoxResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        resources,
        ...flag,
      });

      expect(query).toHaveBeenCalledTimes(2);
      let rowsSeen: number = 0;
      for (const call of query.mock.calls as Array<QueryCall>) {
        const params: Array<unknown> = call[1];
        for (let offset: number = 0; offset < params.length; offset += 16) {
          // Column 15 (0-indexed 14) is isNativePush.
          expect(params[offset + 14]).toBe(expected);
          // …right before the version, which stays last.
          expect(params[offset + 15]).toBe(0);
          rowsSeen++;
        }
      }
      expect(rowsSeen).toBe(501);
    },
  );

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

  test("isNativePush follows the latest observation — overwritten from EXCLUDED inside the lastSeenAt-guarded DO UPDATE only", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        parsedResource({
          kind: "Node",
          externalId: "node/pve2",
          name: "pve2",
          vmid: null,
          guestType: null,
          parentNodeName: null,
        }),
      ],
      isNativePush: true,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);
    const guard: string =
      'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"';
    const assignment: string = '"isNativePush" = EXCLUDED."isNativePush"';

    const doUpdateIndex: number = normalized.indexOf(" DO UPDATE SET ");
    const assignmentIndex: number = normalized.indexOf(assignment);
    const guardIndex: number = normalized.indexOf(guard);
    expect(doUpdateIndex).toBeGreaterThan(-1);
    expect(assignmentIndex).toBeGreaterThan(doUpdateIndex);
    expect(guardIndex).toBeGreaterThan(assignmentIndex);

    /*
     * The dominance guard is the statement's only WHERE and ends it, so
     * it covers the whole DO UPDATE — the flag included: an out-of-order
     * batch older than the stored lastSeenAt never flips where the row
     * says the node reports from.
     */
    expect(countOccurrences(normalized, " WHERE ")).toBe(1);
    expect(normalized.endsWith(guard)).toBe(true);

    /*
     * Overwritten, never COALESCEd: the batch always binds a boolean, and
     * a cluster moved from the native push to the agent must stop being
     * kept as native on the agent's very next scrape.
     */
    expect(normalized).not.toContain('COALESCE(EXCLUDED."isNativePush"');
    // The column list, the assignment's target and EXCLUDED — nothing else.
    expect(countOccurrences(normalized, '"isNativePush"')).toBe(3);
    // Nor read in the guard: a row's flag never decides whether it updates.
    expect(normalized.substring(guardIndex)).not.toContain("isNativePush");
  });

  test("the column list carries isNativePush between lastSeenAt and version, in step with the parameters", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [parsedResource()],
      isNativePush: true,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);
    const columnList: string = normalized.substring(
      normalized.indexOf("(") + 1,
      normalized.indexOf(")"),
    );
    const columns: Array<string> = columnList
      .split(",")
      .map((column: string): string => {
        return column.trim();
      });

    expect(columns).toEqual([
      '"projectId"',
      '"proxmoxClusterId"',
      '"kind"',
      '"externalId"',
      '"name"',
      '"vmid"',
      '"guestType"',
      '"parentNodeName"',
      '"isUp"',
      '"haState"',
      '"onboot"',
      '"isBackedUp"',
      '"uptimeSeconds"',
      '"lastSeenAt"',
      '"isNativePush"',
      '"version"',
    ]);
    expect(params).toHaveLength(columns.length);
    expect(params[columns.indexOf('"isNativePush"')]).toBe(true);
    expect(params[columns.indexOf('"lastSeenAt"')]).toBeInstanceOf(Date);
    expect(params[columns.indexOf('"version"')]).toBe(0);
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
    expect(firstParams).toHaveLength(500 * 16);
    expect(secondParams).toHaveLength(16);
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
  preserveEnv(RETENTION_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  const DELETE_NOW: Date = new Date("2026-09-28T12:00:00.000Z");

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

  test("deletes rows behind the cutoff but keeps a native-push Node until the retention cutoff, marked or not", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
      now: DELETE_NOW,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);

    expect(normalized.startsWith('DELETE FROM "ProxmoxResource"')).toBe(true);
    expect(normalized).toContain(
      'WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2',
    );
    /*
     * The exemption: only a Node, only one the Proxmox VE native push
     * wrote last (IS TRUE — an agent row, false, and a row from before
     * the column existed, NULL, are not exempt), and only until its own
     * last push falls behind the retention cutoff. Guests and storage of
     * a dead node age out as before.
     */
    expect(normalized).toContain(
      'AND NOT ("kind" = \'Node\' AND "isNativePush" IS TRUE AND "lastSeenAt" >= $3)',
    );
    // NULL-safe: a pre-migration row must not read as native.
    expect(normalized).not.toContain("IS NOT FALSE");
    // The exemption is ANDed onto the cutoff, never ORed around it.
    expect(normalized).not.toMatch(/\bOR\b/);
    // And that is the whole statement.
    expect(normalized).toBe(PRUNE_WITH_NATIVE_KEEP_SQL);
  });

  test("the keep never depends on the node having been marked Offline", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
      now: DELETE_NOW,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    /*
     * A node that died just before or during a OneUptime outage is only
     * marked once the nodes still alive have pushed again for two
     * minutes; the cleanup ticks in that warm-up must not drop it. So the
     * keep never reads the Offline state the mark writes — not isUp, not
     * uptimeSeconds: a native node's own pushes already set the
     * isNativePush it keys on.
     */
    expect(sql).not.toContain('"isUp"');
    expect(sql).not.toContain('"uptimeSeconds"');
    // It reads the kind, isNativePush and the node's own lastSeenAt only.
    expect(whereClauseOf(sql).trim()).toBe(
      'WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2 AND NOT ("kind" = \'Node\' AND "isNativePush" IS TRUE AND "lastSeenAt" >= $3)',
    );
  });

  test("the keep never depends on the reports continuing — it never reads updatedAt or the database clock", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
      now: DELETE_NOW,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    /*
     * A OneUptime outage pauses the reports (and the nodes need two
     * minutes afterwards before they report again); a keep that needed
     * them to refresh the row would drop a node that is still down.
     */
    expect(sql).not.toContain("updatedAt");
    expect(sql).not.toMatch(/now\(\)|interval/i);
  });

  test("parameters: the cluster, the worker's cutoff untouched, then the retention cutoff", async () => {
    const query: jest.Mock = mockQueryRunner([[], 0]);
    const olderThan: Date = new Date("2026-09-28T11:45:00.000Z");
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan,
      now: DELETE_NOW,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(params).toHaveLength(3);
    expect(params[0]).toBe(CLUSTER_ID.toString());
    // The very Date the worker passed — never re-derived.
    expect(params[1]).toBe(olderThan);
    // now minus the 7-day default retention.
    expect(params[2]).toBeInstanceOf(Date);
    expect((params[2] as Date).toISOString()).toBe("2026-09-21T12:00:00.000Z");

    // Each placeholder is bound exactly once.
    expect(countOccurrences(sql, "$1")).toBe(1);
    expect(countOccurrences(sql, "$2")).toBe(1);
    expect(countOccurrences(sql, "$3")).toBe(1);
    expect(sql).not.toContain("$4");
  });

  test("the retention cutoff honors PVE_SILENT_NODE_RETENTION_HOURS", async () => {
    process.env[RETENTION_ENV_KEY] = "24";
    const query: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-09-28T11:45:00.000Z"),
      now: DELETE_NOW,
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect((params[2] as Date).getTime()).toBe(
      DELETE_NOW.getTime() - 24 * HOUR_MS,
    );
  });

  test("without now the retention cutoff is measured from the current time, never from the worker's cutoff", async () => {
    const current: Date = new Date("2026-09-28T08:30:00.000Z");
    const getCurrentDate: jest.SpyInstance = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(current);
    const query: jest.Mock = mockQueryRunner([[], 0]);

    // The worker anchors olderThan to the cluster's lastSeenAt, which may lag.
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-09-20T00:00:00.000Z"),
    });

    expect(getCurrentDate).toHaveBeenCalled();
    const [, params] = query.mock.calls[0] as QueryCall;
    expect((params[2] as Date).getTime()).toBe(
      current.getTime() - 168 * HOUR_MS,
    );
  });

  test("the retention cutoff is getSilentNodeRetentionCutoff(now) — the very cutoff getNodeRoster reads", async () => {
    const cutoffSpy: jest.SpyInstance = jest.spyOn(
      ProxmoxResourceService,
      "getSilentNodeRetentionCutoff",
    );
    const deleteQuery: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-09-28T11:45:00.000Z"),
      now: DELETE_NOW,
    });

    expect(cutoffSpy).toHaveBeenCalledTimes(1);
    expect(cutoffSpy).toHaveBeenCalledWith(DELETE_NOW);
    const [, deleteParams] = deleteQuery.mock.calls[0] as QueryCall;
    expect(deleteParams[2]).toBe(cutoffSpy.mock.results[0]!.value);

    /*
     * A node leaves the roster (so nobody reports it any more) at the
     * very instant the prune stops keeping it.
     */
    const rosterQuery: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: DELETE_NOW,
    });
    const [, rosterParams] = rosterQuery.mock.calls[0] as QueryCall;
    expect((rosterParams[2] as Date).getTime()).toBe(
      (deleteParams[2] as Date).getTime(),
    );
  });

  test("never mutates the caller's olderThan or now", async () => {
    mockQueryRunner([[], 0]);
    const olderThan: Date = new Date("2026-09-28T11:45:00.000Z");
    const now: Date = new Date(DELETE_NOW.getTime());
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan,
      now,
    });
    expect(olderThan.toISOString()).toBe("2026-09-28T11:45:00.000Z");
    expect(now.getTime()).toBe(DELETE_NOW.getTime());
  });

  test("the mark can only bring a reported node into the keep (isNativePush, only ever to true), never stretch it: the retention clock stays the node's own last push", async () => {
    const markQuery: jest.Mock = mockQueryRunner([[], 1]);
    await ProxmoxResourceService.markNodesNotReporting({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      nodeNames: ["pve2"],
      silentBefore: new Date("2026-06-13T00:00:00.000Z"),
    });
    const [markSql] = markQuery.mock.calls[0] as QueryCall;
    const markSet: string = setClauseOf(markSql);
    const markedColumns: Array<string> = Array.from(
      markSet.matchAll(/"(\w+)" = /g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    jest.restoreAllMocks();
    const deleteQuery: jest.Mock = mockQueryRunner([[], 0]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
      now: DELETE_NOW,
    });
    const [deleteSql] = deleteQuery.mock.calls[0] as QueryCall;
    const deleteWhere: string = whereClauseOf(deleteSql);

    jest.restoreAllMocks();
    const upsertQuery: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [parsedResource({ kind: "Node", externalId: "node/pve2" })],
      isNativePush: true,
    });
    const upsertSql: string = normalizeSql(
      (upsertQuery.mock.calls[0] as QueryCall)[0],
    );

    // The mark writes isUp, uptimeSeconds, isNativePush and updatedAt…
    expect(markedColumns).toEqual([
      "isUp",
      "uptimeSeconds",
      "isNativePush",
      "updatedAt",
    ]);
    // …of which the prune's exemption reads isNativePush alone…
    expect(
      markedColumns.filter((column: string): boolean => {
        return deleteWhere.includes(`"${column}"`);
      }),
    ).toEqual(["isNativePush"]);
    // …and the mark only ever sets it to true — it can bring a row in…
    expect(markSet).toContain('"isNativePush" = true');
    expect(countOccurrences(markSet, '"isNativePush"')).toBe(1);
    expect(deleteWhere).toContain("\"kind\" = 'Node'");
    expect(deleteWhere).toContain('"isNativePush" IS TRUE');
    // …but the keep lasts from lastSeenAt, which the mark never writes…
    expect(deleteWhere).toContain('"lastSeenAt" >= $3');
    expect(markSet).not.toContain("lastSeenAt");
    // …and the node's own pushes do, both under the lastSeenAt guard.
    expect(upsertSql).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(upsertSql).toContain('"isNativePush" = EXCLUDED."isNativePush"');
  });

  test("logs a warning only when the deletion is larger than expected", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    mockQueryRunner([[], 100]);
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan: new Date("2026-06-13T00:00:00.000Z"),
    });
    expect(warn).not.toHaveBeenCalled();

    mockQueryRunner([[], 101]);
    const affected: number = await ProxmoxResourceService.deleteStaleForCluster(
      {
        proxmoxClusterId: CLUSTER_ID,
        olderThan: new Date("2026-06-13T00:00:00.000Z"),
      },
    );
    expect(affected).toBe(101);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(CLUSTER_ID.toString());
  });

  describe("PVE_NATIVE_NODE_SILENCE_DETECTION", () => {
    /*
     * With silent-node detection switched off nothing ever marks a dead
     * native node, so a keep would show it Online for the whole retention
     * window: the keep is off too, and the prune is the plain one from
     * before it. (Unset — the default — is every other test above.)
     */
    test.each(DETECTION_OFF_VALUES)(
      "%p switches the keep off: the plain prune, with the cluster and the worker's cutoff only",
      async (value: string) => {
        process.env[DETECTION_ENV_KEY] = value;
        const cutoffSpy: jest.SpyInstance = jest.spyOn(
          ProxmoxResourceService,
          "getSilentNodeRetentionCutoff",
        );
        const query: jest.Mock = mockQueryRunner([[], 0]);
        const olderThan: Date = new Date("2026-09-28T11:45:00.000Z");
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan,
          now: DELETE_NOW,
        });

        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0] as QueryCall;
        expect(normalizeSql(sql)).toBe(PLAIN_PRUNE_SQL);
        // No exemption of any kind: every row behind the cutoff goes.
        expect(sql).not.toContain("isNativePush");
        expect(sql).not.toContain('"kind"');
        expect(sql).not.toMatch(/\bNOT\b/);
        // The very Date the worker passed; no retention cutoff at all.
        expect(params).toEqual([CLUSTER_ID.toString(), olderThan]);
        expect(params[1]).toBe(olderThan);
        expect(olderThan.toISOString()).toBe("2026-09-28T11:45:00.000Z");
        expect(sql).not.toContain("$3");
        expect(cutoffSpy).not.toHaveBeenCalled();
      },
    );

    test.each(DETECTION_ON_VALUES)(
      "%p leaves detection on: the prune keeps the native Node, until the retention cutoff",
      async (value: string) => {
        process.env[DETECTION_ENV_KEY] = value;
        const query: jest.Mock = mockQueryRunner([[], 0]);
        const olderThan: Date = new Date("2026-09-28T11:45:00.000Z");
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan,
          now: DELETE_NOW,
        });

        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0] as QueryCall;
        expect(normalizeSql(sql)).toBe(PRUNE_WITH_NATIVE_KEEP_SQL);
        expect(params).toEqual([
          CLUSTER_ID.toString(),
          olderThan,
          new Date("2026-09-21T12:00:00.000Z"),
        ]);
        expect(params[1]).toBe(olderThan);
      },
    );

    test("switched off, the retention window plays no part", async () => {
      process.env[DETECTION_ENV_KEY] = "false";
      process.env[RETENTION_ENV_KEY] = "1";
      const query: jest.Mock = mockQueryRunner([[], 0]);
      const olderThan: Date = new Date("2026-09-20T00:00:00.000Z");
      await ProxmoxResourceService.deleteStaleForCluster({
        proxmoxClusterId: CLUSTER_ID,
        olderThan,
        now: DELETE_NOW,
      });

      const [sql, params] = query.mock.calls[0] as QueryCall;
      expect(normalizeSql(sql)).toBe(PLAIN_PRUNE_SQL);
      expect(params).toEqual([CLUSTER_ID.toString(), olderThan]);
    });

    test("read on every call: switching it off and back on flips the statement, with no restart", async () => {
      const query: jest.Mock = mockQueryRunner([[], 0]);
      const steps: Array<[string | undefined, string, number]> = [
        [undefined, PRUNE_WITH_NATIVE_KEEP_SQL, 3],
        ["false", PLAIN_PRUNE_SQL, 2],
        ["true", PRUNE_WITH_NATIVE_KEEP_SQL, 3],
        [" FALSE ", PLAIN_PRUNE_SQL, 2],
        [undefined, PRUNE_WITH_NATIVE_KEEP_SQL, 3],
      ];

      for (const [value, expectedSql, expectedParamCount] of steps) {
        if (value === undefined) {
          delete process.env[DETECTION_ENV_KEY];
        } else {
          process.env[DETECTION_ENV_KEY] = value;
        }
        query.mockClear();
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan: new Date("2026-09-28T11:45:00.000Z"),
          now: DELETE_NOW,
        });
        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0] as QueryCall;
        expect(normalizeSql(sql)).toBe(expectedSql);
        expect(params).toHaveLength(expectedParamCount);
      }
    });

    test("switched off, the affected count and the warning work as with it on", async () => {
      process.env[DETECTION_ENV_KEY] = "false";
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation((): void => {});

      mockQueryRunner([[], 7]);
      expect(
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan: new Date("2026-06-13T00:00:00.000Z"),
        }),
      ).toBe(7);

      mockQueryRunner({});
      expect(
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan: new Date("2026-06-13T00:00:00.000Z"),
        }),
      ).toBe(0);
      expect(warn).not.toHaveBeenCalled();

      mockQueryRunner([[], 101]);
      expect(
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan: new Date("2026-06-13T00:00:00.000Z"),
        }),
      ).toBe(101);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(CLUSTER_ID.toString());
    });
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

describe("ProxmoxResourceService.getNodeRoster", () => {
  preserveEnv(RETENTION_ENV_KEY);

  const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

  test("selects live Node rows of the cluster seen within the retention window", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);

    expect(normalized).toContain(
      'SELECT "externalId", "lastSeenAt" FROM "ProxmoxResource"',
    );
    const where: string = whereClauseOf(sql);
    expect(where).toContain('"projectId" = $1');
    expect(where).toContain('"proxmoxClusterId" = $2');
    expect(where).toContain("\"kind\" = 'Node'");
    expect(where).toContain('"deletedAt" IS NULL');
    // Inclusive: a node seen exactly at the cutoff is still on the roster.
    expect(where).toContain('"lastSeenAt" >= $3');
    // A read — it must never write the inventory.
    expect(normalized).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);

    expect(params).toHaveLength(3);
    expect(params[0]).toBe(PROJECT_ID.toString());
    expect(params[1]).toBe(CLUSTER_ID.toString());
  });

  test("the cutoff is now minus the 7-day default retention", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    const cutoff: Date = params[2] as Date;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBe(NOW.getTime() - 168 * HOUR_MS);
    expect(cutoff.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  test("the cutoff honors PVE_SILENT_NODE_RETENTION_HOURS", async () => {
    process.env[RETENTION_ENV_KEY] = "24";
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect((params[2] as Date).getTime()).toBe(NOW.getTime() - 24 * HOUR_MS);
  });

  test("an invalid retention override falls back to the default cutoff", async () => {
    process.env[RETENTION_ENV_KEY] = "0";
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [, params] = query.mock.calls[0] as QueryCall;
    expect((params[2] as Date).getTime()).toBe(NOW.getTime() - 168 * HOUR_MS);
  });

  test("the cutoff is getSilentNodeRetentionCutoff(now) — the one the prune keeps a silent node until", async () => {
    const cutoffSpy: jest.SpyInstance = jest.spyOn(
      ProxmoxResourceService,
      "getSilentNodeRetentionCutoff",
    );
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    expect(cutoffSpy).toHaveBeenCalledTimes(1);
    expect(cutoffSpy).toHaveBeenCalledWith(NOW);
    const [, params] = query.mock.calls[0] as QueryCall;
    expect(params[2]).toBe(cutoffSpy.mock.results[0]!.value);
  });

  test("without now the cutoff is measured from the current time", async () => {
    const current: Date = new Date("2026-09-28T08:30:00.000Z");
    const getCurrentDate: jest.SpyInstance = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(current);
    const query: jest.Mock = mockQueryRunner([]);

    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
    });

    expect(getCurrentDate).toHaveBeenCalled();
    const [, params] = query.mock.calls[0] as QueryCall;
    expect((params[2] as Date).getTime()).toBe(
      current.getTime() - 168 * HOUR_MS,
    );
  });

  test("never mutates the caller's now", async () => {
    mockQueryRunner([]);
    const now: Date = new Date(NOW.getTime());
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now,
    });
    expect(now.getTime()).toBe(NOW.getTime());
  });

  test("parses node/<name> back into node names, in row order, from Date or string lastSeenAt", async () => {
    const pve1SeenAt: Date = new Date("2026-09-28T11:59:50.000Z");
    const rows: Array<RosterRow> = [
      { externalId: "node/pve1", lastSeenAt: pve1SeenAt },
      // node-postgres may hand timestamps back as strings — both parse.
      { externalId: "node/pve2", lastSeenAt: "2026-09-28T11:55:00.000Z" },
      { externalId: "node/pve-3.lab", lastSeenAt: "2026-09-27T09:00:00Z" },
    ];
    mockQueryRunner(rows);

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });

    expect(roster).toEqual([
      { nodeName: "pve1", lastSeenAt: pve1SeenAt },
      {
        nodeName: "pve2",
        lastSeenAt: new Date("2026-09-28T11:55:00.000Z"),
      },
      {
        nodeName: "pve-3.lab",
        lastSeenAt: new Date("2026-09-27T09:00:00.000Z"),
      },
    ]);
    for (const node of roster) {
      expect(node.lastSeenAt).toBeInstanceOf(Date);
    }
  });

  test("skips non-node ids, empty names and unparseable lastSeenAt", async () => {
    const rows: Array<RosterRow> = [
      { externalId: "qemu/100", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: "lxc/200", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      {
        externalId: "storage/pve1/local",
        lastSeenAt: "2026-09-28T11:00:00.000Z",
      },
      // The prefix is case-sensitive, exactly as pve-exporter writes it.
      { externalId: "Node/pve9", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: "pve8", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: "node/", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: "", lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: null, lastSeenAt: "2026-09-28T11:00:00.000Z" },
      { externalId: "node/pve4", lastSeenAt: "not-a-date" },
      { externalId: "node/pve5", lastSeenAt: new Date(NaN) },
      { externalId: "node/pve6", lastSeenAt: "2026-09-28T11:00:00.000Z" },
    ];
    mockQueryRunner(rows);

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });

    expect(roster).toEqual([
      {
        nodeName: "pve6",
        lastSeenAt: new Date("2026-09-28T11:00:00.000Z"),
      },
    ]);
  });

  test("an empty cluster yields an empty roster", async () => {
    mockQueryRunner([]);
    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });
    expect(roster).toEqual([]);
  });

  test("a failing query rejects — the liveness caller fails closed on it", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockRejectedValue(new Error("connection terminated"));
    jest
      .spyOn(ProxmoxResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);

    await expect(
      ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      }),
    ).rejects.toThrow("connection terminated");
  });
});

describe("ProxmoxResourceService.markNodesNotReporting", () => {
  const SILENT_BEFORE: Date = new Date("2026-09-28T11:58:00.000Z");

  type MarkCapture = {
    affected: number;
    sql: string;
    params: Array<unknown>;
  };

  async function markAndCapture(
    nodeNames: Array<string>,
  ): Promise<MarkCapture> {
    return markWithDriverResult(nodeNames, [[], nodeNames.length]);
  }

  async function markWithDriverResult(
    nodeNames: Array<string>,
    result: unknown,
  ): Promise<MarkCapture> {
    const query: jest.Mock = mockQueryResolving(result);
    const affected: number = await ProxmoxResourceService.markNodesNotReporting(
      {
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        nodeNames,
        silentBefore: SILENT_BEFORE,
      },
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    return { affected, sql, params };
  }

  test("no nodes → no query, 0 rows", async () => {
    const query: jest.Mock = mockQueryRunner([[], 5]);
    const getRepository: jest.SpyInstance = jest.spyOn(
      ProxmoxResourceService,
      "getRepository",
    );
    getRepository.mockClear();

    const affected: number = await ProxmoxResourceService.markNodesNotReporting(
      {
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        nodeNames: [],
        silentBefore: SILENT_BEFORE,
      },
    );

    expect(affected).toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(getRepository).not.toHaveBeenCalled();
  });

  test("is a single UPDATE of the inventory table", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const normalized: string = normalizeSql(sql);
    expect(normalized.startsWith('UPDATE "ProxmoxResource"')).toBe(true);
    expect(normalized).not.toMatch(/\b(DELETE|INSERT)\b/);
  });

  test("parameters: project, cluster, node/<name> ids in order, silentBefore", async () => {
    const { params } = await markAndCapture(["pve2", "pve3", "pve-4.lab"]);
    expect(params).toHaveLength(4);
    expect(params[0]).toBe(PROJECT_ID.toString());
    expect(params[1]).toBe(CLUSTER_ID.toString());
    // One array bound to ANY($3) — never interpolated into the SQL.
    expect(params[2]).toEqual(["node/pve2", "node/pve3", "node/pve-4.lab"]);
    // The very Date the caller computed, unmodified.
    expect(params[3]).toBe(SILENT_BEFORE);
  });

  test("node names are bound, never spliced into the statement", async () => {
    const hostile: string = 'pve\'; DROP TABLE "ProxmoxResource"; --';
    const { sql, params } = await markAndCapture([hostile]);
    expect(sql).not.toContain(hostile);
    expect(sql).not.toContain("DROP TABLE");
    expect(params[2]).toEqual([`node/${hostile}`]);
  });

  test("clamps long ids exactly as bulkUpsert stored them", async () => {
    const longName: string = "n".repeat(150);
    const { params } = await markAndCapture([longName]);
    const markedIds: Array<string> = params[2] as Array<string>;
    expect(markedIds[0]).toHaveLength(100);

    jest.restoreAllMocks();
    // bulkUpsert warns about the clamp — expected here, keep it quiet.
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const upsertQuery: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        parsedResource({
          kind: "Node",
          externalId: `node/${longName}`,
          name: longName,
          vmid: null,
          guestType: null,
          parentNodeName: null,
        }),
      ],
    });
    const [, upsertParams] = upsertQuery.mock.calls[0] as QueryCall;
    // Column 4 (0-indexed 3) is externalId — the same row identity.
    expect(markedIds[0]).toBe(upsertParams[3]);
  });

  test("SET writes isUp = false, uptimeSeconds = NULL, isNativePush = true and updatedAt = now() only", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const setClause: string = setClauseOf(sql);

    expect(setClause).toBe(
      ' SET "isUp" = false, "uptimeSeconds" = NULL, "isNativePush" = true, "updatedAt" = now()',
    );
    // Exactly four assignments.
    expect(countOccurrences(setClause, " = ")).toBe(4);
  });

  test("flags the row native — only ever true — and reads isNativePush only in its write guard", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const setClause: string = setClauseOf(sql);
    const where: string = whereClauseOf(sql);

    /*
     * A node the native pushes report is a member of a native-push
     * cluster, whatever wrote its row last: one already down when the
     * cluster moved from the agent (false) or from before the column
     * existed (NULL) is kept like any other native node from its mark on,
     * instead of being pruned at the normal cutoff while still reported.
     */
    expect(setClause).toContain('"isNativePush" = true');
    // A literal — never bound, never NULL, never taken from anywhere else.
    expect(setClause).not.toMatch(/"isNativePush" = (false|NULL|\$)/);
    // Once in SET, once in the guard — nothing else reads it.
    expect(countOccurrences(sql, '"isNativePush"')).toBe(2);
    expect(countOccurrences(where, '"isNativePush"')).toBe(1);
    expect(where).toContain('"isNativePush" IS DISTINCT FROM true');
  });

  test("never writes lastSeenAt or metricsUpdatedAt — they stay the node's own last push", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const setClause: string = setClauseOf(sql);

    expect(setClause).not.toContain("lastSeenAt");
    expect(setClause).not.toContain("metricsUpdatedAt");
    // Nor any identity or latest-metric mirror column.
    for (const column of [
      "name",
      "vmid",
      "parentNodeName",
      "haState",
      "latestCpuPercent",
      "latestMemoryBytes",
      "deletedAt",
    ]) {
      expect(setClause).not.toContain(`"${column}"`);
    }
    // lastSeenAt appears once in the whole statement: the WHERE guard.
    expect(countOccurrences(sql, '"lastSeenAt"')).toBe(1);
    expect(sql).not.toContain("metricsUpdatedAt");
  });

  test("WHERE scopes to the project, the cluster, live Node rows and the given ids", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    expect(where).toContain('"projectId" = $1');
    expect(where).toContain('"proxmoxClusterId" = $2');
    expect(where).toContain("\"kind\" = 'Node'");
    expect(where).toContain('"externalId" = ANY($3)');
    expect(where).toContain('"deletedAt" IS NULL');
  });

  test("a row the node refreshed itself after silentBefore is left alone", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);
    // Strictly older — a late report can never mark a live node down.
    expect(where).toContain('"lastSeenAt" < $4');
  });

  test("a row already Offline and native is left alone; a NULL isUp, or an Offline row not yet native (false or NULL), is marked", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    // One parenthesised ANDed term, the statement's last.
    expect(
      where.endsWith(
        'AND ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true)',
      ),
    ).toBe(true);
    // IS DISTINCT FROM: a NULL isUp is marked too (NULL <> false is NULL)…
    expect(where).not.toContain('"isUp" <> false');
    expect(where).not.toContain('"isUp" != false');
    // …and so is a NULL isNativePush (NULL <> true is NULL).
    expect(where).not.toContain('"isNativePush" <> true');
    expect(where).not.toContain('"isNativePush" != true');
  });

  test("the guard's OR stays inside its parentheses — it never escapes the scope filters or the silentBefore guard", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    expect(where.trim()).toBe(MARK_WHERE_SQL);
    // The statement's only OR…
    expect(countOccurrences(where, " OR ")).toBe(1);
    // …sits inside the last term, after every ANDed filter.
    const orIndex: number = where.indexOf(" OR ");
    const openIndex: number = where.lastIndexOf("(", orIndex);
    expect(where.substring(0, openIndex).endsWith(" AND ")).toBe(true);
    expect(where.substring(0, openIndex)).toContain('"lastSeenAt" < $4');
    expect(where.substring(0, openIndex)).not.toMatch(/\bOR\b/);
    expect(where.endsWith(")")).toBe(true);
  });

  test("no time-based refresh: a marked row is never rewritten while it stays down", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    /*
     * The prune keeps the row on isNativePush and its own lastSeenAt, not
     * on a recent updatedAt, so nothing here needs re-writing it every so
     * often.
     */
    expect(where).not.toContain("updatedAt");
    expect(where).not.toMatch(/now\(\)|interval/i);
  });

  test("returns the affected count from the postgres [rows, affected] result", async () => {
    const { affected } = await markWithDriverResult(["pve2", "pve3"], [[], 2]);
    expect(affected).toBe(2);
  });

  test.each([[[[], 0]], [{}], [[]], [[[]]], [undefined], [null], [[[], "2"]]])(
    "returns 0 for the driver result %p",
    async (result: unknown) => {
      const { affected } = await markWithDriverResult(["pve2"], result);
      expect(affected).toBe(0);
    },
  );

  test("the node's own next push flips it back through bulkUpsert", async () => {
    /*
     * The mark never advanced lastSeenAt, so the node's next push (a
     * newer lastSeenAt) passes bulkUpsert's dominance guard and writes
     * isUp = true and a fresh uptime over the Offline row — flagged as a
     * native push by the push itself, as the mark had left it.
     */
    const { sql: markSql } = await markAndCapture(["pve2"]);
    expect(setClauseOf(markSql)).not.toContain("lastSeenAt");

    jest.restoreAllMocks();
    const query: jest.Mock = mockQueryRunner();
    const pushedAt: Date = new Date("2026-09-28T12:05:00.000Z");
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        parsedResource({
          kind: "Node",
          externalId: "node/pve2",
          name: "pve2",
          vmid: null,
          guestType: null,
          parentNodeName: null,
          isUp: true,
          uptimeSeconds: 42,
          lastSeenAt: pushedAt,
        }),
      ],
      isNativePush: true,
    });

    const [upsertSql, params] = query.mock.calls[0] as QueryCall;
    expect(upsertSql).toContain(
      'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"',
    );
    expect(upsertSql).toContain(
      '"isUp" = COALESCE(EXCLUDED."isUp", "ProxmoxResource"."isUp")',
    );
    expect(params[3]).toBe("node/pve2");
    expect(params[8]).toBe(true); // isUp
    expect(params[12]).toBe(42); // uptimeSeconds
    expect(params[13]).toBe(pushedAt); // lastSeenAt
    expect(params[14]).toBe(true); // isNativePush
  });
});

describe("ProxmoxResourceService.removeOfflineNode", () => {
  test.each([
    ["qemu/100"],
    ["lxc/200"],
    ["storage/pve1/local"],
    ["pve1"],
    [""],
    ["Node/pve1"],
    [" node/pve1"],
  ])(
    "refuses %p (not a node/ id) without touching the database",
    async (externalId: string) => {
      const query: jest.Mock = mockQueryRunner([[], 1]);
      const removed: boolean = await ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId,
      });
      expect(removed).toBe(false);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test("hard-deletes only an Offline Node row of this project and cluster", async () => {
    const query: jest.Mock = mockQueryRunner([[], 1]);
    await ProxmoxResourceService.removeOfflineNode({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      externalId: "node/pve2",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);

    expect(normalized.startsWith('DELETE FROM "ProxmoxResource"')).toBe(true);
    const where: string = whereClauseOf(sql);
    expect(where).toContain('"projectId" = $1');
    expect(where).toContain('"proxmoxClusterId" = $2');
    expect(where).toContain("\"kind\" = 'Node'");
    expect(where).toContain('"externalId" = $3');
    /*
     * IS FALSE: a node that is up — or whose state is unknown (NULL) —
     * is never removed; it would only reappear on its next push.
     */
    expect(where).toContain('"isUp" IS FALSE');
    expect(where).not.toMatch(/\bOR\b/);

    expect(params).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
      "node/pve2",
    ]);
  });

  test("true when a row was deleted", async () => {
    mockQueryRunner([[], 1]);
    const removed: boolean = await ProxmoxResourceService.removeOfflineNode({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      externalId: "node/pve2",
    });
    expect(removed).toBe(true);
  });

  test("false when no Offline row matched (the node is up, or unknown)", async () => {
    mockQueryRunner([[], 0]);
    const removed: boolean = await ProxmoxResourceService.removeOfflineNode({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      externalId: "node/pve2",
    });
    expect(removed).toBe(false);
  });

  test.each([[{}], [[]], [[[]]], [undefined], [null], [[[], "1"]]])(
    "false when the driver result %p carries no affected count",
    async (result: unknown) => {
      mockQueryResolving(result);
      const removed: boolean = await ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId: "node/pve2",
      });
      expect(removed).toBe(false);
    },
  );
});

describe("ProxmoxResourceService.getSilentNodeRetentionHours", () => {
  preserveEnv(RETENTION_ENV_KEY);

  test("defaults to 7 days", () => {
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(168);
  });

  test("an empty value keeps the default", () => {
    process.env[RETENTION_ENV_KEY] = "";
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(168);
  });

  test("honors the env override", () => {
    process.env[RETENTION_ENV_KEY] = "48";
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(48);
    process.env[RETENTION_ENV_KEY] = "720";
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(720);
  });

  test("accepts the 1-hour floor", () => {
    process.env[RETENTION_ENV_KEY] = "1";
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(1);
  });

  test.each([["0"], ["-12"], ["garbage"], ["NaN"], ["h24"]])(
    "rejects %p and keeps the default",
    (raw: string) => {
      process.env[RETENTION_ENV_KEY] = raw;
      expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(168);
    },
  );

  test("reads the env on every call — no stale cached value", () => {
    process.env[RETENTION_ENV_KEY] = "12";
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(12);
    delete process.env[RETENTION_ENV_KEY];
    expect(ProxmoxResourceService.getSilentNodeRetentionHours()).toBe(168);
  });
});

describe("ProxmoxResourceService.getSilentNodeRetentionCutoff", () => {
  preserveEnv(RETENTION_ENV_KEY);

  const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

  test("is now minus the 7-day default retention", () => {
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
  });

  test("honors PVE_SILENT_NODE_RETENTION_HOURS, down to the 1-hour floor", () => {
    process.env[RETENTION_ENV_KEY] = "24";
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).getTime(),
    ).toBe(NOW.getTime() - 24 * HOUR_MS);

    process.env[RETENTION_ENV_KEY] = "1";
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).getTime(),
    ).toBe(NOW.getTime() - HOUR_MS);
  });

  test.each([["0"], ["-12"], ["garbage"]])(
    "an invalid override %p keeps the 7-day default",
    (raw: string) => {
      process.env[RETENTION_ENV_KEY] = raw;
      expect(
        ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).getTime(),
      ).toBe(NOW.getTime() - 168 * HOUR_MS);
    },
  );

  test("reads the env on every call — no stale cached value", () => {
    process.env[RETENTION_ENV_KEY] = "12";
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).getTime(),
    ).toBe(NOW.getTime() - 12 * HOUR_MS);
    delete process.env[RETENTION_ENV_KEY];
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(NOW).getTime(),
    ).toBe(NOW.getTime() - 168 * HOUR_MS);
  });

  test("without now it is measured from the current time", () => {
    const current: Date = new Date("2026-09-28T08:30:00.000Z");
    const getCurrentDate: jest.SpyInstance = jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(current);

    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff().getTime(),
    ).toBe(current.getTime() - 168 * HOUR_MS);
    expect(
      ProxmoxResourceService.getSilentNodeRetentionCutoff(undefined).getTime(),
    ).toBe(current.getTime() - 168 * HOUR_MS);
    expect(getCurrentDate).toHaveBeenCalled();
  });

  test("with now it never reads the current time, and returns a new Date", () => {
    const getCurrentDate: jest.SpyInstance = jest.spyOn(
      OneUptimeDate,
      "getCurrentDate",
    );
    const now: Date = new Date(NOW.getTime());

    const cutoff: Date =
      ProxmoxResourceService.getSilentNodeRetentionCutoff(now);

    expect(getCurrentDate).not.toHaveBeenCalled();
    expect(cutoff).not.toBe(now);
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

/*
 * ------------------------------------------------------------------
 * The keep, end to end, on an in-memory inventory.
 *
 * SimulatedProxmoxCluster is a ProxmoxResource table held in memory
 * behind the service's query runner, plus the few moving parts of the
 * Proxmox VE native push around it: nodes push every 10 s (their rows
 * through bulkUpsert, flagged isNativePush exactly as the ingest flush
 * flags a native batch; their liveness through nextProxmoxNodeLiveness),
 * each push asks decideProxmoxSilentNodes — over getNodeRoster — whom
 * to report, the reports go to markNodesNotReporting, and the cleanup
 * runs deleteStaleForCluster exactly as CleanupStaleResources does.
 * The same table takes the agent's scrapes (isNativePush false, nobody
 * reporting on anybody's behalf) and the rows a release from before
 * isNativePush left behind, run through the real migration. Silent-node
 * detection follows the real PVE_NATIVE_NODE_SILENCE_DETECTION: switched
 * off, the pushes keep no liveness and report nobody, as in the ingest,
 * and the service's own prune drops the keep.
 *
 * The table executes only the exact statements pinned below (whitespace
 * aside) and throws on anything else, so it cannot drift from the SQL
 * the service sends: change a statement and these tests fail until the
 * model is taught the new one.
 * ------------------------------------------------------------------
 */

/*
 * One ProxmoxResource row as the model keeps it: the columns the keep
 * and the prune read or write. Identity columns (name, vmid, ...) bear
 * on neither and are not modelled; deletedAt is always NULL here.
 */
interface ModelRow {
  projectId: string;
  proxmoxClusterId: string;
  kind: string;
  externalId: string;
  isUp: boolean | null;
  uptimeSeconds: number | null;
  lastSeenAt: Date;
  // NULL only on a row written before the column existed.
  isNativePush: boolean | null;
  updatedAt: Date;
}

// A row a node's push writes: its own status, or a guest/storage on it.
interface ModelRider {
  kind: string;
  externalId: string;
  isUp: boolean | null;
}

// One report a live node made: the siblings it said stopped reporting.
interface ModelReport {
  atMs: number;
  silentNodes: Array<string>;
}

// One row markNodesNotReporting actually wrote.
interface ModelMark {
  atMs: number;
  externalId: string;
}

const MODEL_UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "proxmoxClusterId",
  "kind",
  "externalId",
  "name",
  "vmid",
  "guestType",
  "parentNodeName",
  "isUp",
  "haState",
  "onboot",
  "isBackedUp",
  "uptimeSeconds",
  "lastSeenAt",
  "isNativePush",
  "version",
];

const MODEL_UPSERT_COALESCED_COLUMNS: Array<string> = [
  "name",
  "vmid",
  "guestType",
  "parentNodeName",
  "isUp",
  "haState",
  "onboot",
  "isBackedUp",
  "uptimeSeconds",
];

const MODEL_UPSERT_CONFLICT_SQL: string = [
  'ON CONFLICT ("projectId", "proxmoxClusterId", "kind", "externalId")',
  "DO UPDATE SET",
  [
    ...MODEL_UPSERT_COALESCED_COLUMNS.map((column: string): string => {
      return `"${column}" = COALESCE(EXCLUDED."${column}", "ProxmoxResource"."${column}")`;
    }),
    '"lastSeenAt" = EXCLUDED."lastSeenAt"',
    '"isNativePush" = EXCLUDED."isNativePush"',
    '"updatedAt" = now()',
  ].join(", "),
  'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"',
].join(" ");

const MODEL_MARK_SQL: string = [
  'UPDATE "ProxmoxResource"',
  'SET "isUp" = false, "uptimeSeconds" = NULL, "isNativePush" = true, "updatedAt" = now()',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "externalId" = ANY($3)',
  'AND "deletedAt" IS NULL',
  'AND "lastSeenAt" < $4',
  'AND ("isUp" IS DISTINCT FROM false',
  'OR "isNativePush" IS DISTINCT FROM true)',
].join(" ");

// Silent-node detection on (the default): the prune with the native keep.
const MODEL_PRUNE_SQL: string = [
  'DELETE FROM "ProxmoxResource"',
  'WHERE "proxmoxClusterId" = $1',
  'AND "lastSeenAt" < $2',
  "AND NOT (\"kind\" = 'Node'",
  'AND "isNativePush" IS TRUE',
  'AND "lastSeenAt" >= $3)',
].join(" ");

// Silent-node detection switched off: the plain prune, no keep.
const MODEL_PLAIN_PRUNE_SQL: string = [
  'DELETE FROM "ProxmoxResource"',
  'WHERE "proxmoxClusterId" = $1',
  'AND "lastSeenAt" < $2',
].join(" ");

const MODEL_ROSTER_SQL: string = [
  'SELECT "externalId", "lastSeenAt" FROM "ProxmoxResource"',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "deletedAt" IS NULL',
  'AND "lastSeenAt" >= $3',
].join(" ");

/*
 * AddProxmoxResourceIsNativePush1796100000000.up: a nullable column with
 * no DEFAULT, so every row already in the table reads NULL — not native.
 */
const MODEL_ADD_IS_NATIVE_PUSH_SQL: string =
  'ALTER TABLE "ProxmoxResource" ADD "isNativePush" boolean';

// pvestatd pushes every ~10 s.
const PUSH_INTERVAL_MS: number = 10 * 1000;
const RETENTION_DEFAULT_MS: number = 7 * 24 * HOUR_MS;
const MODEL_T0_MS: number = new Date("2026-09-28T12:00:00.000Z").getTime();
const ALL_NODES: Array<string> = ["pve1", "pve2", "pve3"];

// pve2's guests and storage, written by pve2's own push.
const PVE2_RIDERS: Array<ModelRider> = [
  { kind: "Guest", externalId: "qemu/100", isUp: true },
  { kind: "Guest", externalId: "lxc/200", isUp: false }, // stopped
  { kind: "Storage", externalId: "storage/pve2/local", isUp: true },
];

function modelResource(rider: ModelRider, atMs: number): ParsedProxmoxResource {
  return parsedResource({
    kind: rider.kind,
    externalId: rider.externalId,
    name: rider.externalId.substring(rider.externalId.lastIndexOf("/") + 1),
    vmid: null,
    guestType: null,
    parentNodeName: null,
    isUp: rider.isUp,
    onboot: null,
    uptimeSeconds: rider.isUp ? 3600 : null,
    lastSeenAt: new Date(atMs),
  });
}

// "($1, ..., $n), ($n+1, ...)" — the VALUES list bulkUpsert must send.
function valuesPlaceholders(rowCount: number, columnCount: number): string {
  const tuples: Array<string> = [];
  for (let row: number = 0; row < rowCount; row++) {
    const placeholders: Array<string> = [];
    for (let column: number = 1; column <= columnCount; column++) {
      placeholders.push(`$${row * columnCount + column}`);
    }
    tuples.push(`(${placeholders.join(", ")})`);
  }
  return tuples.join(", ");
}

class SimulatedProxmoxCluster {
  // OneUptime's clock, the PVE clocks and the database's now() — one clock.
  public clockMs: number;
  /*
   * Off: no liveness is kept and nobody reports on anybody's behalf —
   * the agent path, or every report failing closed. Silent-node
   * detection switched off is the env var instead
   * (PVE_NATIVE_NODE_SILENCE_DETECTION=false), which the pushes here and
   * the service's prune both read, as the ingest and the cleanup do.
   */
  public reportsEnabled: boolean = true;
  /*
   * What each push hands bulkUpsert as isNativePush: true for the native
   * push (the ingest flush passes the batch's countsFromInventory),
   * false for the agent; undefined leaves the key out.
   */
  public isNativePushArg: boolean | undefined = true;
  // Rows markNodesNotReporting actually wrote, over the whole run.
  public marks: Array<ModelMark> = [];
  public reports: Array<ModelReport> = [];
  // Which prune statement each cleanup ran.
  public prunes: { withNativeKeep: number; plain: number } = {
    withNativeKeep: 0,
    plain: 0,
  };
  private rows: Array<ModelRow> = [];
  private hasIsNativePushColumn: boolean = true;
  private liveness: Map<string, ProxmoxNodeLiveness | null> = new Map();
  private riders: Map<string, Array<ModelRider>> = new Map();
  private clusterLastSeenMs: number;

  public constructor(startMs: number) {
    this.clockMs = startMs;
    this.clusterLastSeenMs = startMs;
    const query: jest.Mock = jest
      .fn()
      .mockImplementation(
        async (sql: string, params: Array<unknown>): Promise<unknown> => {
          return this.execute(sql, params);
        },
      );
    jest
      .spyOn(ProxmoxResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return new Date(this.clockMs);
    });
  }

  public row(externalId: string): ModelRow | undefined {
    const row: ModelRow | undefined = this.rows.find(
      (candidate: ModelRow): boolean => {
        return candidate.externalId === externalId;
      },
    );
    return row ? { ...row } : undefined;
  }

  // When markNodesNotReporting wrote this row, in order.
  public marksOf(externalId: string): Array<number> {
    return this.marks
      .filter((mark: ModelMark): boolean => {
        return mark.externalId === externalId;
      })
      .map((mark: ModelMark): number => {
        return mark.atMs;
      });
  }

  // When a report named this node, in order.
  public reportTimesOf(nodeName: string): Array<number> {
    return this.reports
      .filter((report: ModelReport): boolean => {
        return report.silentNodes.includes(nodeName);
      })
      .map((report: ModelReport): number => {
        return report.atMs;
      });
  }

  // What a node's push writes besides its own status, from now on.
  public carry(nodeName: string, riders: Array<ModelRider>): void {
    this.riders.set(nodeName, riders);
  }

  // OneUptime processes nothing meanwhile: no push, no report, no cleanup.
  public advance(ms: number): void {
    this.clockMs += ms;
  }

  public advanceTo(ms: number): void {
    expect(ms).toBeGreaterThanOrEqual(this.clockMs);
    this.clockMs = ms;
  }

  /*
   * The rows a release from before isNativePush left behind, last seen
   * now, then the real migration run over them through this model
   * (AddProxmoxResourceIsNativePush1796100000000.up). Only on a table
   * nothing has written yet.
   */
  public async upgradeFromPreviousRelease(
    previousRows: Array<ModelRider>,
  ): Promise<void> {
    expect(this.rows).toHaveLength(0);
    this.hasIsNativePushColumn = false;
    for (const rider of previousRows) {
      this.rows.push({
        projectId: PROJECT_ID.toString(),
        proxmoxClusterId: CLUSTER_ID.toString(),
        kind: rider.kind,
        externalId: rider.externalId,
        isUp: rider.isUp,
        uptimeSeconds: rider.isUp ? 3600 : null,
        lastSeenAt: this.now(),
        // Not a column yet — the migration decides what it reads.
        isNativePush: null,
        updatedAt: this.now(),
      });
    }

    const queryRunner: QueryRunner = {
      query: async (sql: string): Promise<unknown> => {
        return this.execute(sql, []);
      },
    } as unknown as QueryRunner;
    await new AddProxmoxResourceIsNativePush1796100000000().up(queryRunner);
    expect(this.hasIsNativePushColumn).toBe(true);
  }

  /*
   * Each node's status push, processed now, as the ingest does it: its
   * liveness, its inventory rows, and — through the real decision over
   * the real roster — its report on the siblings that went quiet. (The
   * ingest fences the inventory write to once per 30 s; marking on
   * every report only gives the mark more chances to rewrite a row.)
   */
  public async push(nodeNames: Array<string>): Promise<void> {
    for (const nodeName of nodeNames) {
      const nowMs: number = this.clockMs;
      // The ingest returns before either when detection is switched off.
      const reporting: boolean =
        this.reportsEnabled && isProxmoxSilentNodeDetectionEnabled();
      if (reporting) {
        this.liveness.set(
          nodeName,
          nextProxmoxNodeLiveness(this.liveness.get(nodeName) || null, nowMs),
        );
      }
      this.clusterLastSeenMs = nowMs;

      const written: Array<ModelRider> = [
        { kind: "Node", externalId: `node/${nodeName}`, isUp: true },
        ...(this.riders.get(nodeName) || []),
      ];
      const resources: Array<ParsedProxmoxResource> = written.map(
        (rider: ModelRider): ParsedProxmoxResource => {
          return modelResource(rider, nowMs);
        },
      );
      if (this.isNativePushArg === undefined) {
        await ProxmoxResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          resources,
        });
      } else {
        await ProxmoxResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          resources,
          isNativePush: this.isNativePushArg,
        });
      }

      if (!reporting) {
        continue;
      }
      const roster: Array<ProxmoxRosterNode> =
        await ProxmoxResourceService.getNodeRoster({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
        });
      const decision: ProxmoxSilentNodeDecision | null =
        decideProxmoxSilentNodes({
          selfNode: nodeName,
          reporterTimeMs: nowMs,
          nowMs,
          roster,
          liveness: this.liveness,
        });
      if (!decision) {
        continue;
      }
      this.reports.push({ atMs: nowMs, silentNodes: decision.silentNodes });
      await ProxmoxResourceService.markNodesNotReporting({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        nodeNames: decision.silentNodes,
        silentBefore: new Date(nowMs - PROXMOX_NODE_SILENCE_MS),
      });
    }
  }

  // The nodes push every 10 s for durationMs; afterEachTick follows each round.
  public async pushFor(
    nodeNames: Array<string>,
    durationMs: number,
    afterEachTick?: () => Promise<void>,
  ): Promise<void> {
    const endMs: number = this.clockMs + durationMs;
    while (this.clockMs + PUSH_INTERVAL_MS <= endMs) {
      this.clockMs += PUSH_INTERVAL_MS;
      await this.push(nodeNames);
      if (afterEachTick) {
        await afterEachTick();
      }
    }
  }

  /*
   * One CleanupStaleResources run: the cutoff anchored to the cluster's
   * last push and no `now`, so the retention cutoff reads the current
   * time. Returns the cutoff it used.
   */
  public async cleanup(): Promise<Date> {
    const olderThan: Date = ProxmoxResourceService.getStaleThresholdDate(
      new Date(this.clusterLastSeenMs),
    );
    await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: CLUSTER_ID,
      olderThan,
    });
    return olderThan;
  }

  public async rosterNodeNames(): Promise<Array<string>> {
    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
      });
    return roster.map((node: ProxmoxRosterNode): string => {
      return node.nodeName;
    });
  }

  private now(): Date {
    return new Date(this.clockMs);
  }

  private execute(sql: string, params: Array<unknown>): unknown {
    const statement: string = normalizeSql(sql);
    if (statement.startsWith('INSERT INTO "ProxmoxResource"')) {
      return this.executeUpsert(statement, params);
    }
    if (statement === MODEL_MARK_SQL) {
      return this.executeMark(params);
    }
    if (statement === MODEL_PRUNE_SQL) {
      return this.executePrune(params);
    }
    if (statement === MODEL_PLAIN_PRUNE_SQL) {
      return this.executePlainPrune(params);
    }
    if (statement === MODEL_ROSTER_SQL) {
      return this.executeRoster(params);
    }
    if (statement === MODEL_ADD_IS_NATIVE_PUSH_SQL) {
      return this.executeAddIsNativePush();
    }
    throw new Error(
      `The inventory model does not implement this statement — teach it the new SQL: ${statement}`,
    );
  }

  private executeUpsert(
    statement: string,
    params: Array<unknown>,
  ): Array<unknown> {
    expect(this.hasIsNativePushColumn).toBe(true);
    const match: RegExpMatchArray | null = statement.match(
      /^INSERT INTO "ProxmoxResource" \(([^)]*)\) VALUES (.*?) (ON CONFLICT .*)$/,
    );
    expect(match).not.toBeNull();
    const columns: Array<string> = match![1]!
      .split(",")
      .map((column: string): string => {
        return column.trim().replace(/"/g, "");
      });
    expect(columns).toEqual(MODEL_UPSERT_COLUMNS);
    expect(match![2]).toBe(
      valuesPlaceholders(params.length / columns.length, columns.length),
    );
    expect(match![3]).toBe(MODEL_UPSERT_CONFLICT_SQL);

    for (
      let offset: number = 0;
      offset < params.length;
      offset += columns.length
    ) {
      const value: (column: string) => unknown = (column: string): unknown => {
        return params[offset + columns.indexOf(column)];
      };
      // Always bound as a boolean: NULL only ever comes from the migration.
      expect(typeof value("isNativePush")).toBe("boolean");
      const incoming: ModelRow = {
        projectId: value("projectId") as string,
        proxmoxClusterId: value("proxmoxClusterId") as string,
        kind: value("kind") as string,
        externalId: value("externalId") as string,
        isUp: value("isUp") as boolean | null,
        uptimeSeconds: value("uptimeSeconds") as number | null,
        lastSeenAt: value("lastSeenAt") as Date,
        isNativePush: value("isNativePush") as boolean,
        updatedAt: this.now(),
      };
      const existing: ModelRow | undefined = this.rows.find(
        (row: ModelRow): boolean => {
          return (
            row.projectId === incoming.projectId &&
            row.proxmoxClusterId === incoming.proxmoxClusterId &&
            row.kind === incoming.kind &&
            row.externalId === incoming.externalId
          );
        },
      );
      if (!existing) {
        this.rows.push(incoming);
        continue;
      }
      // DO UPDATE ... WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"
      if (incoming.lastSeenAt.getTime() < existing.lastSeenAt.getTime()) {
        continue;
      }
      existing.isUp = incoming.isUp !== null ? incoming.isUp : existing.isUp;
      existing.uptimeSeconds =
        incoming.uptimeSeconds !== null
          ? incoming.uptimeSeconds
          : existing.uptimeSeconds;
      existing.lastSeenAt = incoming.lastSeenAt;
      // "isNativePush" = EXCLUDED."isNativePush" — overwritten, not COALESCEd.
      existing.isNativePush = incoming.isNativePush;
      existing.updatedAt = this.now();
    }
    return [];
  }

  private executeMark(params: Array<unknown>): Array<unknown> {
    const [projectId, proxmoxClusterId, externalIds, silentBefore] = params as [
      string,
      string,
      Array<string>,
      Date,
    ];
    let affected: number = 0;
    for (const row of this.rows) {
      const matches: boolean =
        row.projectId === projectId &&
        row.proxmoxClusterId === proxmoxClusterId &&
        row.kind === "Node" &&
        externalIds.includes(row.externalId) &&
        row.lastSeenAt.getTime() < silentBefore.getTime() &&
        // ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true)
        (row.isUp !== false || row.isNativePush !== true);
      if (!matches) {
        continue;
      }
      row.isUp = false;
      row.uptimeSeconds = null;
      row.isNativePush = true;
      row.updatedAt = this.now();
      this.marks.push({ atMs: this.clockMs, externalId: row.externalId });
      affected++;
    }
    return [[], affected];
  }

  private executePrune(params: Array<unknown>): Array<unknown> {
    expect(this.hasIsNativePushColumn).toBe(true);
    expect(params).toHaveLength(3);
    this.prunes.withNativeKeep++;
    const [proxmoxClusterId, olderThan, retentionCutoff] = params as [
      string,
      Date,
      Date,
    ];
    const before: number = this.rows.length;
    this.rows = this.rows.filter((row: ModelRow): boolean => {
      const exempt: boolean =
        row.kind === "Node" &&
        // "isNativePush" IS TRUE — false and NULL are not exempt.
        row.isNativePush === true &&
        row.lastSeenAt.getTime() >= retentionCutoff.getTime();
      const doomed: boolean =
        row.proxmoxClusterId === proxmoxClusterId &&
        row.lastSeenAt.getTime() < olderThan.getTime() &&
        !exempt;
      return !doomed;
    });
    return [[], before - this.rows.length];
  }

  private executePlainPrune(params: Array<unknown>): Array<unknown> {
    expect(params).toHaveLength(2);
    this.prunes.plain++;
    const [proxmoxClusterId, olderThan] = params as [string, Date];
    const before: number = this.rows.length;
    // No exemption: every row of the cluster behind the cutoff goes.
    this.rows = this.rows.filter((row: ModelRow): boolean => {
      return !(
        row.proxmoxClusterId === proxmoxClusterId &&
        row.lastSeenAt.getTime() < olderThan.getTime()
      );
    });
    return [[], before - this.rows.length];
  }

  private executeRoster(params: Array<unknown>): Array<RosterRow> {
    const [projectId, proxmoxClusterId, seenSince] = params as [
      string,
      string,
      Date,
    ];
    return this.rows
      .filter((row: ModelRow): boolean => {
        return (
          row.projectId === projectId &&
          row.proxmoxClusterId === proxmoxClusterId &&
          row.kind === "Node" &&
          row.lastSeenAt.getTime() >= seenSince.getTime()
        );
      })
      .map((row: ModelRow): RosterRow => {
        return { externalId: row.externalId, lastSeenAt: row.lastSeenAt };
      });
  }

  private executeAddIsNativePush(): Array<unknown> {
    // Postgres refuses to add a column twice.
    expect(this.hasIsNativePushColumn).toBe(false);
    this.hasIsNativePushColumn = true;
    // No DEFAULT: every existing row reads NULL.
    for (const row of this.rows) {
      row.isNativePush = null;
    }
    return [];
  }
}

interface DeadNodeCluster {
  cluster: SimulatedProxmoxCluster;
  // pve2's last push, on the PVE clock (its row's lastSeenAt).
  pve2LastPushMs: number;
  // When the nodes still alive first reported it and its row turned Offline.
  markedAtMs: number;
}

/*
 * pve1, pve2 and pve3 push for three minutes over the native push (pve2
 * writing its guests and storage too), then pve2 dies; pve1 and pve3
 * carry on for three more minutes and report it once it has been quiet
 * for the silence window.
 */
async function clusterWithDeadPve2(): Promise<DeadNodeCluster> {
  const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
    MODEL_T0_MS,
  );
  cluster.carry("pve2", PVE2_RIDERS);
  await cluster.push(ALL_NODES);
  await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
  const pve2LastPushMs: number = cluster.clockMs;
  await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

  const marks: Array<number> = cluster.marksOf("node/pve2");
  expect(marks).toHaveLength(1);
  return {
    cluster,
    pve2LastPushMs,
    markedAtMs: marks[0]!,
  };
}

interface UnseenDeathCluster {
  cluster: SimulatedProxmoxCluster;
  // pve2's last push, on the PVE clock (its row's lastSeenAt).
  pve2LastPushMs: number;
}

/*
 * pve1, pve2 and pve3 push for three minutes over the native push (pve2
 * writing its guests and storage too); then OneUptime stops processing
 * anything and pve2 dies while it is, so nothing ever reported it.
 */
async function clusterWherePve2DiesUnseen(): Promise<UnseenDeathCluster> {
  const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
    MODEL_T0_MS,
  );
  cluster.carry("pve2", PVE2_RIDERS);
  await cluster.push(ALL_NODES);
  await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
  expect(cluster.reports).toEqual([]);
  return { cluster, pve2LastPushMs: cluster.clockMs };
}

const PVE2_RIDER_IDS: Array<string> = PVE2_RIDERS.map(
  (rider: ModelRider): string => {
    return rider.externalId;
  },
);

// The normal prune's window (PVE_INVENTORY_STALE_MINUTES, 15 minutes here).
function staleThresholdMs(): number {
  return ProxmoxResourceService.getStaleThresholdMinutes() * MINUTE_MS;
}

describe("ProxmoxResourceService inventory model — a native-push node that stops reporting", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  test("is marked Offline once — lastSeenAt untouched, still flagged native — however often it is reported", async () => {
    const { cluster, pve2LastPushMs, markedAtMs } = await clusterWithDeadPve2();

    // First reported on the first push after the silence window.
    expect(markedAtMs).toBe(
      pve2LastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
    );
    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(false);
    expect(pve2.uptimeSeconds).toBeNull();
    expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
    expect(pve2.isNativePush).toBe(true);
    expect(pve2.updatedAt.getTime()).toBe(markedAtMs);

    // Both live nodes reported it on every push; only the first wrote.
    expect(cluster.reports.length).toBeGreaterThan(2);
    for (const report of cluster.reports) {
      expect(report.silentNodes).toEqual(["pve2"]);
      expect(report.atMs).toBeGreaterThanOrEqual(markedAtMs);
    }
    expect(cluster.marks).toEqual([
      { atMs: markedAtMs, externalId: "node/pve2" },
    ]);

    // The mark touched pve2's Node row and nothing else.
    for (const rider of PVE2_RIDERS) {
      const row: ModelRow = cluster.row(rider.externalId)!;
      expect(row.isUp).toBe(rider.isUp);
      // Written by pve2's native push too — the flag is per batch.
      expect(row.isNativePush).toBe(true);
    }
    for (const externalId of ["node/pve1", "node/pve3"]) {
      const row: ModelRow = cluster.row(externalId)!;
      expect(row.isUp).toBe(true);
      expect(row.isNativePush).toBe(true);
    }
  });

  const OUTAGES: Array<[string, number]> = [
    ["13-minute", 13 * MINUTE_MS],
    ["20-minute", 20 * MINUTE_MS],
    ["one-hour", HOUR_MS],
    ["one-day", 24 * HOUR_MS],
    ["six-day", 6 * 24 * HOUR_MS],
    [
      "seven-day (to the last tick of the retention window)",
      RETENTION_DEFAULT_MS - 6 * MINUTE_MS,
    ],
  ];

  test.each(OUTAGES)(
    "marked before a %s OneUptime outage, it survives the outage and the warm-up after it, with nothing refreshing its row",
    async (_label: string, outageMs: number) => {
      const { cluster, pve2LastPushMs, markedAtMs } =
        await clusterWithDeadPve2();

      cluster.advance(outageMs);
      const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
      const reportsBeforeOutage: number = cluster.reports.length;
      const tally: { cleanupsPastUpdatedAt: number } = {
        cleanupsPastUpdatedAt: 0,
      };

      /*
       * OneUptime is back: the nodes still alive push again, need two
       * minutes before any is established, then report again. The
       * cleanup runs after every round — far more often than its
       * five-minute cron.
       */
      await cluster.pushFor(
        ["pve1", "pve3"],
        3 * MINUTE_MS,
        async (): Promise<void> => {
          const olderThan: Date = await cluster.cleanup();
          const pve2: ModelRow | undefined = cluster.row("node/pve2");
          expect(pve2).toBeDefined();
          if (pve2!.updatedAt.getTime() < olderThan.getTime()) {
            tally.cleanupsPastUpdatedAt++;
          }
        },
      );

      // Nothing reported it during the warm-up; then the reports resumed…
      const reportsBack: Array<ModelReport> =
        cluster.reports.slice(reportsBeforeOutage);
      expect(reportsBack.length).toBeGreaterThan(0);
      expect(reportsBack[0]!.atMs).toBe(backAtMs + PROXMOX_NODE_SILENCE_MS);
      // …and even they never rewrote the row: it was Offline already.
      expect(cluster.marksOf("node/pve2")).toEqual([markedAtMs]);
      // A keep that needed a recent updatedAt would have lost it here.
      expect(tally.cleanupsPastUpdatedAt).toBeGreaterThan(0);

      const pve2: ModelRow = cluster.row("node/pve2")!;
      expect(pve2.isUp).toBe(false);
      expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
      expect(pve2.isNativePush).toBe(true);
      expect(pve2.updatedAt.getTime()).toBe(markedAtMs);

      // Still inside the retention window, still on the roster.
      expect(cluster.clockMs - pve2LastPushMs).toBeLessThanOrEqual(
        RETENTION_DEFAULT_MS,
      );
      expect(await cluster.rosterNodeNames()).toContain("pve2");

      // The cleanup ran with teeth: pve2's guests and storage are gone.
      for (const externalId of PVE2_RIDER_IDS) {
        expect(cluster.row(externalId)).toBeUndefined();
      }
      expect(cluster.row("node/pve1")).toBeDefined();
      expect(cluster.row("node/pve3")).toBeDefined();
    },
  );

  const UNSEEN_DEATHS: Array<[string, number]> = [
    ["a 20-minute OneUptime outage", 20 * MINUTE_MS],
    ["a one-hour OneUptime outage", HOUR_MS],
    [
      "a two-hour whole-cluster power cut it never boots back from",
      2 * HOUR_MS,
    ],
    ["a one-day OneUptime outage", 24 * HOUR_MS],
    ["a six-day OneUptime outage", 6 * 24 * HOUR_MS],
  ];

  test.each(UNSEEN_DEATHS)(
    "dead during %s, never marked, it is kept through every cleanup of the warm-up after — then marked by the first report",
    async (_label: string, outageMs: number) => {
      const { cluster, pve2LastPushMs } = await clusterWherePve2DiesUnseen();

      cluster.advance(outageMs);
      const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
      const tally: { unmarkedPastNormalCutoff: number } = {
        unmarkedPastNormalCutoff: 0,
      };

      await cluster.pushFor(
        ["pve1", "pve3"],
        3 * MINUTE_MS,
        async (): Promise<void> => {
          const olderThan: Date = await cluster.cleanup();
          const pve2: ModelRow | undefined = cluster.row("node/pve2");
          expect(pve2).toBeDefined();
          expect(pve2!.isNativePush).toBe(true);
          if (
            pve2!.isUp === true &&
            pve2!.lastSeenAt.getTime() < olderThan.getTime()
          ) {
            tally.unmarkedPastNormalCutoff++;
          }
        },
      );

      /*
       * The normal cutoff had passed its last push while it was still
       * unmarked: a keep that needed the mark would have pruned it here,
       * and it would never have been reported at all.
       */
      expect(tally.unmarkedPastNormalCutoff).toBeGreaterThan(0);

      // Marked by the first report once a node is established again.
      expect(cluster.reportTimesOf("pve2")[0]).toBe(
        backAtMs + PROXMOX_NODE_SILENCE_MS,
      );
      expect(cluster.marksOf("node/pve2")).toEqual([
        backAtMs + PROXMOX_NODE_SILENCE_MS,
      ]);
      const pve2: ModelRow = cluster.row("node/pve2")!;
      expect(pve2.isUp).toBe(false);
      expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
      expect(pve2.isNativePush).toBe(true);
      expect(await cluster.rosterNodeNames()).toContain("pve2");

      // Its guests and storage were pruned as usual.
      for (const externalId of PVE2_RIDER_IDS) {
        expect(cluster.row(externalId)).toBeUndefined();
      }
    },
  );

  const RETENTION_CASES: Array<[string, string | undefined, number]> = [
    ["the 7-day default", undefined, 7 * 24],
    ["PVE_SILENT_NODE_RETENTION_HOURS=24", "24", 24],
    ["the 1-hour floor", "1", 1],
  ];

  test.each(RETENTION_CASES)(
    "with %s it is deleted on the first cleanup after its last push falls behind the retention cutoff — as it leaves the roster",
    async (_label: string, envValue: string | undefined, hours: number) => {
      if (envValue !== undefined) {
        process.env[RETENTION_ENV_KEY] = envValue;
      }
      const { cluster, pve2LastPushMs } = await clusterWithDeadPve2();
      const retentionEndMs: number = pve2LastPushMs + hours * HOUR_MS;

      // Skip to five minutes before the window closes, then run through it.
      cluster.advanceTo(retentionEndMs - 5 * MINUTE_MS);
      const seen: {
        leftRosterAtMs: number | null;
        deletedAtMs: number | null;
      } = { leftRosterAtMs: null, deletedAtMs: null };
      await cluster.pushFor(
        ["pve1", "pve3"],
        7 * MINUTE_MS,
        async (): Promise<void> => {
          const roster: Array<string> = await cluster.rosterNodeNames();
          if (seen.leftRosterAtMs === null && !roster.includes("pve2")) {
            seen.leftRosterAtMs = cluster.clockMs;
          }
          await cluster.cleanup();
          if (seen.deletedAtMs === null && !cluster.row("node/pve2")) {
            seen.deletedAtMs = cluster.clockMs;
          }
        },
      );

      // Kept at exactly the retention cutoff (inclusive), gone on the next tick.
      expect(seen.deletedAtMs).toBe(retentionEndMs + PUSH_INTERVAL_MS);
      expect(seen.leftRosterAtMs).toBe(seen.deletedAtMs);

      // Reported right up to then and never after.
      expect(Math.max(...cluster.reportTimesOf("pve2"))).toBe(retentionEndMs);
      expect(cluster.marks).toHaveLength(1);
    },
  );

  test.each(RETENTION_CASES)(
    "with %s, dead during an outage and still unmarked when its retention runs out, it is deleted on the first cleanup past the cutoff — never reported",
    async (_label: string, envValue: string | undefined, hours: number) => {
      if (envValue !== undefined) {
        process.env[RETENTION_ENV_KEY] = envValue;
      }
      const { cluster, pve2LastPushMs } = await clusterWherePve2DiesUnseen();
      const retentionEndMs: number = pve2LastPushMs + hours * HOUR_MS;

      /*
       * OneUptime is back a minute before pve2's retention runs out — too
       * late for the two-minute warm-up to finish first.
       */
      cluster.advanceTo(retentionEndMs - MINUTE_MS);
      const seen: {
        leftRosterAtMs: number | null;
        deletedAtMs: number | null;
      } = { leftRosterAtMs: null, deletedAtMs: null };
      await cluster.pushFor(
        ["pve1", "pve3"],
        5 * MINUTE_MS,
        async (): Promise<void> => {
          const roster: Array<string> = await cluster.rosterNodeNames();
          if (seen.leftRosterAtMs === null && !roster.includes("pve2")) {
            seen.leftRosterAtMs = cluster.clockMs;
          }
          await cluster.cleanup();
          const pve2: ModelRow | undefined = cluster.row("node/pve2");
          if (pve2) {
            // Kept although never marked — and the normal cutoff long passed.
            expect(pve2.isUp).toBe(true);
            expect(pve2.isNativePush).toBe(true);
          } else if (seen.deletedAtMs === null) {
            seen.deletedAtMs = cluster.clockMs;
          }
        },
      );

      // Kept at exactly the retention cutoff (inclusive), gone on the next tick.
      expect(seen.deletedAtMs).toBe(retentionEndMs + PUSH_INTERVAL_MS);
      expect(seen.leftRosterAtMs).toBe(seen.deletedAtMs);
      // It left the roster before any node was established again.
      expect(cluster.reports).toEqual([]);
      expect(cluster.marks).toEqual([]);
    },
  );

  test("back again it stays a native row; quiet again and never re-marked because every report fails closed, it is kept past the normal cutoff until the retention cutoff", async () => {
    const { cluster } = await clusterWithDeadPve2();

    // pve2 comes back: a real, newer observation.
    await cluster.pushFor(ALL_NODES, MINUTE_MS);
    const back: ModelRow = cluster.row("node/pve2")!;
    expect(back.isUp).toBe(true);
    expect(back.isNativePush).toBe(true);
    expect(back.lastSeenAt.getTime()).toBe(cluster.clockMs);
    const pve2LastPushMs: number = cluster.clockMs;

    /*
     * It goes quiet again, and this time nothing marks it: every report
     * fails closed (say Redis is unreachable). Silent-node detection is
     * still on, so the prune still keeps it — the next report that gets
     * through marks it. (With detection switched off nothing ever would,
     * and it is pruned at the normal cutoff instead: see below.)
     */
    cluster.reportsEnabled = false;
    const tally: { keptPastNormalCutoff: number } = {
      keptPastNormalCutoff: 0,
    };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        const olderThan: Date = await cluster.cleanup();
        const pve2: ModelRow | undefined = cluster.row("node/pve2");
        // A stale native row, never re-marked — and never pruned for it.
        expect(pve2).toBeDefined();
        expect(pve2!.isUp).toBe(true);
        expect(pve2!.isNativePush).toBe(true);
        if (pve2!.lastSeenAt.getTime() < olderThan.getTime()) {
          tally.keptPastNormalCutoff++;
        }
      },
    );

    // Every cleanup from the first whose normal cutoff passed its last push.
    expect(tally.keptPastNormalCutoff).toBe(
      (20 * MINUTE_MS - staleThresholdMs()) / PUSH_INTERVAL_MS,
    );
    expect(await cluster.rosterNodeNames()).toContain("pve2");

    // It lets go once its last push falls behind the retention cutoff.
    const retentionEndMs: number = pve2LastPushMs + RETENTION_DEFAULT_MS;
    cluster.advanceTo(retentionEndMs - 5 * MINUTE_MS);
    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      7 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        if (seen.deletedAtMs === null && !cluster.row("node/pve2")) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );
    expect(seen.deletedAtMs).toBe(retentionEndMs + PUSH_INTERVAL_MS);
    // Only its first death was ever marked.
    expect(cluster.marks).toHaveLength(1);
    // Detection stayed on throughout: every cleanup ran the keep.
    expect(cluster.prunes.plain).toBe(0);
    expect(cluster.prunes.withNativeKeep).toBeGreaterThan(0);
  });

  test("back and then dead again, it is marked Offline anew", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();

    await cluster.pushFor(ALL_NODES, MINUTE_MS);
    const secondLastPushMs: number = cluster.clockMs;
    await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(false);
    expect(pve2.lastSeenAt.getTime()).toBe(secondLastPushMs);
    expect(pve2.isNativePush).toBe(true);
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      secondLastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
    ]);
  });

  test("an out-of-order batch older than its last push never flips it back up, nor off the native push", async () => {
    const { cluster, pve2LastPushMs, markedAtMs } = await clusterWithDeadPve2();

    // A late native batch, then a late agent batch.
    for (const isNativePush of [true, false]) {
      await ProxmoxResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        resources: [
          modelResource(
            { kind: "Node", externalId: "node/pve2", isUp: true },
            pve2LastPushMs - 30 * 1000,
          ),
        ],
        isNativePush,
      });
    }

    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(false);
    expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
    expect(pve2.isNativePush).toBe(true);
    expect(pve2.updatedAt.getTime()).toBe(markedAtMs);
  });

  test("a replay of its last push (the same lastSeenAt) re-applies isUp = true, but never drops the row — the next report marks it again", async () => {
    const { cluster, pve2LastPushMs, markedAtMs } = await clusterWithDeadPve2();

    // The very batch pve2 last pushed, ingested again (a redelivery).
    const replayedAtMs: number = cluster.clockMs;
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        { kind: "Node", externalId: "node/pve2", isUp: true },
        ...PVE2_RIDERS,
      ].map((rider: ModelRider): ParsedProxmoxResource => {
        return modelResource(rider, pve2LastPushMs);
      }),
      isNativePush: true,
    });

    // The guard is >=: an equal lastSeenAt passes and isUp is re-applied…
    const replayed: ModelRow = cluster.row("node/pve2")!;
    expect(replayed.isUp).toBe(true);
    expect(replayed.lastSeenAt.getTime()).toBe(pve2LastPushMs);
    expect(replayed.isNativePush).toBe(true);
    expect(replayed.updatedAt.getTime()).toBe(replayedAtMs);

    // …but the row is kept on isNativePush, which the replay left true.
    const tally: { cleanupsPastLastPush: number } = {
      cleanupsPastLastPush: 0,
    };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        const olderThan: Date = await cluster.cleanup();
        expect(cluster.row("node/pve2")).toBeDefined();
        if (pve2LastPushMs < olderThan.getTime()) {
          tally.cleanupsPastLastPush++;
        }
      },
    );
    expect(tally.cleanupsPastLastPush).toBeGreaterThan(0);

    // The very next report finds it up and marks it Offline again.
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      replayedAtMs + PUSH_INTERVAL_MS,
    ]);
    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(false);
    expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
    expect(pve2.isNativePush).toBe(true);

    // The replayed guests and storage still aged out at the normal cutoff.
    for (const externalId of PVE2_RIDER_IDS) {
      expect(cluster.row(externalId)).toBeUndefined();
    }
  });

  test("its guests and storage — a stopped guest included — are still pruned at the normal cutoff while the node is kept", async () => {
    const { cluster, pve2LastPushMs } = await clusterWithDeadPve2();

    const deletedAtMs: Map<string, number> = new Map();
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        expect(cluster.row("node/pve2")).toBeDefined();
        for (const externalId of PVE2_RIDER_IDS) {
          const row: ModelRow | undefined = cluster.row(externalId);
          if (row) {
            // Native rows too — the flag alone keeps nothing but a Node.
            expect(row.isNativePush).toBe(true);
          } else if (!deletedAtMs.has(externalId)) {
            deletedAtMs.set(externalId, cluster.clockMs);
          }
        }
      },
    );

    for (const externalId of PVE2_RIDER_IDS) {
      expect(deletedAtMs.get(externalId)).toBe(
        pve2LastPushMs + staleThresholdMs() + PUSH_INTERVAL_MS,
      );
    }
  });

  test("a live node is never marked after an outage a little shorter than the silence window, whichever node is processed first", async () => {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    await cluster.push(ALL_NODES);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
    const pve3LastPushMs: number = cluster.clockMs;
    // pve1 and pve2 land one more push, 8 s later, then OneUptime stalls.
    cluster.advance(8 * 1000);
    await cluster.push(["pve1", "pve2"]);
    const pve2LastPushMs: number = cluster.clockMs;

    /*
     * Back 117 s later: pve2's pre-outage key is still alive but its
     * streak is broken; pve3's key expired a moment ago, although pve3
     * is alive and its next push is right behind pve1's.
     */
    cluster.advance(117 * 1000);
    expect(cluster.clockMs - pve2LastPushMs).toBeLessThanOrEqual(
      PROXMOX_NODE_SILENCE_MS,
    );
    expect(cluster.clockMs - pve2LastPushMs).toBeGreaterThan(
      PROXMOX_NODE_STREAK_GAP_MS,
    );
    expect(cluster.clockMs - pve3LastPushMs).toBeGreaterThan(
      PROXMOX_NODE_SILENCE_MS,
    );
    await cluster.push(["pve1"]);
    await cluster.push(["pve2", "pve3"]);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS, async (): Promise<void> => {
      await cluster.cleanup();
    });

    // pve2 could not vouch for anyone, so nobody reported pve3.
    expect(cluster.reports).toEqual([]);
    expect(cluster.marks).toEqual([]);
    for (const nodeName of ALL_NODES) {
      const row: ModelRow = cluster.row(`node/${nodeName}`)!;
      expect(row.isUp).toBe(true);
      expect(row.isNativePush).toBe(true);
    }
  });
});

/*
 * With silent-node detection switched off (PVE_NATIVE_NODE_SILENCE_DETECTION
 * =false) nothing ever marks a native node that dies: its row keeps the
 * isUp = true of its last push. Kept for the retention window, it would
 * read Online for a week — so the keep is off, and every row, a native
 * Node's included, ages out at the normal cutoff as before the keep.
 */
describe("ProxmoxResourceService inventory model — silent-node detection switched off", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  preserveEnv(DETECTION_ENV_KEY);

  const PVE2_ROW_IDS: Array<string> = ["node/pve2", ...PVE2_RIDER_IDS];

  // When each of pve2's rows was first found gone, over cleanups every tick.
  async function pushAndCleanupRecordingDeletions(
    cluster: SimulatedProxmoxCluster,
    durationMs: number,
    whilePresent: (pve2: ModelRow, olderThan: Date) => void,
  ): Promise<Map<string, number>> {
    const deletedAtMs: Map<string, number> = new Map();
    await cluster.pushFor(
      ["pve1", "pve3"],
      durationMs,
      async (): Promise<void> => {
        const olderThan: Date = await cluster.cleanup();
        const pve2: ModelRow | undefined = cluster.row("node/pve2");
        if (pve2) {
          whilePresent(pve2, olderThan);
        }
        for (const externalId of PVE2_ROW_IDS) {
          if (!cluster.row(externalId) && !deletedAtMs.has(externalId)) {
            deletedAtMs.set(externalId, cluster.clockMs);
          }
        }
      },
    );
    return deletedAtMs;
  }

  test.each(DETECTION_OFF_VALUES)(
    "with %p from the start, a native node that dies is never reported, reads Online while kept, and is pruned with its guests and storage at the normal cutoff",
    async (value: string) => {
      process.env[DETECTION_ENV_KEY] = value;
      const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
        MODEL_T0_MS,
      );
      cluster.carry("pve2", PVE2_RIDERS);
      await cluster.push(ALL_NODES);
      await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
      const pve2LastPushMs: number = cluster.clockMs;
      for (const nodeName of ALL_NODES) {
        expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
      }

      const deletedAtMs: Map<string, number> =
        await pushAndCleanupRecordingDeletions(
          cluster,
          20 * MINUTE_MS,
          (pve2: ModelRow, olderThan: Date): void => {
            // Never marked: it reads Online for as long as it is kept…
            expect(pve2.isUp).toBe(true);
            expect(pve2.isNativePush).toBe(true);
            // …which is no longer than any other row.
            expect(pve2.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
              olderThan.getTime(),
            );
          },
        );

      // The node and everything it wrote go on the same cleanup.
      for (const externalId of PVE2_ROW_IDS) {
        expect(deletedAtMs.get(externalId)).toBe(
          pve2LastPushMs + staleThresholdMs() + PUSH_INTERVAL_MS,
        );
      }
      expect(cluster.reports).toEqual([]);
      expect(cluster.marks).toEqual([]);
      expect(await cluster.rosterNodeNames()).toEqual(["pve1", "pve3"]);
      // Every cleanup ran the plain prune.
      expect(cluster.prunes).toEqual({
        withNativeKeep: 0,
        plain: (20 * MINUTE_MS) / PUSH_INTERVAL_MS,
      });
      // The nodes still pushing are untouched.
      for (const externalId of ["node/pve1", "node/pve3"]) {
        const row: ModelRow = cluster.row(externalId)!;
        expect(row.isUp).toBe(true);
        expect(row.isNativePush).toBe(true);
      }
    },
  );

  test("back again, then quiet with detection switched off: a stale native row, never re-marked, is pruned at the normal cutoff", async () => {
    const { cluster } = await clusterWithDeadPve2();

    // pve2 comes back, pushing its guests and storage again.
    await cluster.pushFor(ALL_NODES, MINUTE_MS);
    const pve2LastPushMs: number = cluster.clockMs;
    expect(cluster.row("node/pve2")!.isUp).toBe(true);
    const reportsBefore: number = cluster.reports.length;

    // Detection is switched off; pve2 goes quiet again.
    process.env[DETECTION_ENV_KEY] = "false";
    const tally: { keptPastNormalCutoff: number } = {
      keptPastNormalCutoff: 0,
    };
    const deletedAtMs: Map<string, number> =
      await pushAndCleanupRecordingDeletions(
        cluster,
        20 * MINUTE_MS,
        (pve2: ModelRow, olderThan: Date): void => {
          // A stale native row, never re-marked — so never kept for it.
          expect(pve2.isUp).toBe(true);
          expect(pve2.isNativePush).toBe(true);
          if (pve2.lastSeenAt.getTime() < olderThan.getTime()) {
            tally.keptPastNormalCutoff++;
          }
        },
      );

    expect(tally.keptPastNormalCutoff).toBe(0);
    for (const externalId of PVE2_ROW_IDS) {
      expect(deletedAtMs.get(externalId)).toBe(
        pve2LastPushMs + staleThresholdMs() + PUSH_INTERVAL_MS,
      );
    }
    // Nobody reported it; only its first death was ever marked.
    expect(cluster.reports).toHaveLength(reportsBefore);
    expect(cluster.marks).toHaveLength(1);
    expect(await cluster.rosterNodeNames()).not.toContain("pve2");
    expect(cluster.prunes.withNativeKeep).toBe(0);
  });

  test("marked Offline while detection was on, then switched off: nobody reports it any more, and its Offline row goes at the normal cutoff", async () => {
    const { cluster, pve2LastPushMs, markedAtMs } = await clusterWithDeadPve2();
    const reportsBefore: number = cluster.reports.length;

    process.env[DETECTION_ENV_KEY] = "false";
    const deletedAtMs: Map<string, number> =
      await pushAndCleanupRecordingDeletions(
        cluster,
        20 * MINUTE_MS,
        (pve2: ModelRow): void => {
          // Still the Offline, native row the mark left.
          expect(pve2.isUp).toBe(false);
          expect(pve2.isNativePush).toBe(true);
          expect(pve2.updatedAt.getTime()).toBe(markedAtMs);
        },
      );

    for (const externalId of PVE2_ROW_IDS) {
      expect(deletedAtMs.get(externalId)).toBe(
        pve2LastPushMs + staleThresholdMs() + PUSH_INTERVAL_MS,
      );
    }
    expect(cluster.reports).toHaveLength(reportsBefore);
    expect(cluster.marks).toEqual([
      { atMs: markedAtMs, externalId: "node/pve2" },
    ]);
    expect(cluster.prunes.withNativeKeep).toBe(0);
  });

  test("an Offline node the agent last listed, on a cluster moved to the native push, is never reported: it stays an agent row and is pruned at the normal cutoff", async () => {
    process.env[DETECTION_ENV_KEY] = "false";
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.reportsEnabled = false;
    cluster.isNativePushArg = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve9", isUp: false },
    ]);
    await cluster.push(["pve1", "pve3"]);
    const pve9LastSeenMs: number = cluster.clockMs;

    cluster.carry("pve1", []);
    cluster.isNativePushArg = true;
    cluster.reportsEnabled = true;
    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        const pve9: ModelRow | undefined = cluster.row("node/pve9");
        if (pve9) {
          expect(pve9.isUp).toBe(false);
          expect(pve9.isNativePush).toBe(false);
        } else if (seen.deletedAtMs === null) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );

    expect(cluster.reports).toEqual([]);
    expect(cluster.marks).toEqual([]);
    expect(seen.deletedAtMs).toBe(
      pve9LastSeenMs + staleThresholdMs() + PUSH_INTERVAL_MS,
    );
    for (const nodeName of ["pve1", "pve3"]) {
      expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
    }
  });
});

describe("ProxmoxResourceService inventory model — rows the keep must not cover", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  preserveEnv(DETECTION_ENV_KEY);

  test.each([
    ["false", false],
    ["omitted — read as false", undefined],
  ] as Array<[string, boolean | undefined]>)(
    "an agent-path Offline node (isNativePush %s) is pruned at the normal cutoff",
    async (_label: string, isNativePushArg: boolean | undefined) => {
      /*
       * The Proxmox Agent path: pve-exporter reports every node itself,
       * so nobody reports on anybody's behalf.
       */
      const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
        MODEL_T0_MS,
      );
      cluster.reportsEnabled = false;
      cluster.isNativePushArg = isNativePushArg;
      // The scrape still lists pve9, Offline…
      cluster.carry("pve1", [
        { kind: "Node", externalId: "node/pve9", isUp: false },
      ]);
      await cluster.push(["pve1"]);
      const pve9LastSeenMs: number = cluster.clockMs;
      // …then pve9 leaves the cluster and the scrape stops listing it.
      cluster.carry("pve1", []);

      const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
      await cluster.pushFor(
        ["pve1"],
        20 * MINUTE_MS,
        async (): Promise<void> => {
          await cluster.cleanup();
          const pve9: ModelRow | undefined = cluster.row("node/pve9");
          if (pve9) {
            expect(pve9.isUp).toBe(false);
            expect(pve9.isNativePush).toBe(false);
          } else if (seen.deletedAtMs === null) {
            seen.deletedAtMs = cluster.clockMs;
          }
        },
      );

      expect(seen.deletedAtMs).toBe(
        pve9LastSeenMs + staleThresholdMs() + PUSH_INTERVAL_MS,
      );
      expect(cluster.row("node/pve1")!.isNativePush).toBe(false);
      expect(cluster.marks).toEqual([]);
    },
  );

  test("on the agent path, rows from before the migration read NULL and keep the normal prune; the next write flags them", async () => {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    await cluster.upgradeFromPreviousRelease([
      { kind: "Node", externalId: "node/pve1", isUp: true },
      { kind: "Node", externalId: "node/pve9", isUp: false },
    ]);
    const upgradedAtMs: number = cluster.clockMs;
    for (const externalId of ["node/pve1", "node/pve9"]) {
      expect(cluster.row(externalId)!.isNativePush).toBeNull();
    }

    // The agent carries on after the upgrade; it no longer lists pve9.
    cluster.reportsEnabled = false;
    cluster.isNativePushArg = false;
    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(["pve1"], 20 * MINUTE_MS, async (): Promise<void> => {
      await cluster.cleanup();
      const pve9: ModelRow | undefined = cluster.row("node/pve9");
      if (pve9) {
        expect(pve9.isUp).toBe(false);
        expect(pve9.isNativePush).toBeNull();
      } else if (seen.deletedAtMs === null) {
        seen.deletedAtMs = cluster.clockMs;
      }
    });

    expect(seen.deletedAtMs).toBe(
      upgradedAtMs + staleThresholdMs() + PUSH_INTERVAL_MS,
    );
    // pve1's own scrape flagged its row.
    expect(cluster.row("node/pve1")!.isNativePush).toBe(false);
  });

  test("moved from the native push to the agent: the agent's next scrape flags every row not native, and a node it stops listing is pruned at the normal cutoff", async () => {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.carry("pve2", PVE2_RIDERS);
    await cluster.push(ALL_NODES);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
    for (const nodeName of ALL_NODES) {
      expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
    }
    const lastNativePushMs: number = cluster.clockMs;

    /*
     * Moved to the Proxmox Agent: every scrape is flagged not native, and
     * nobody reports on anybody's behalf.
     */
    cluster.isNativePushArg = false;
    cluster.reportsEnabled = false;
    await cluster.pushFor(ALL_NODES, MINUTE_MS);
    for (const externalId of [
      "node/pve1",
      "node/pve2",
      "node/pve3",
      ...PVE2_RIDERS.map((rider: ModelRider): string => {
        return rider.externalId;
      }),
    ]) {
      expect(cluster.row(externalId)!.isNativePush).toBe(false);
    }
    const pve2LastSeenMs: number = cluster.clockMs;

    // A native batch from before the switch, ingested late, never flips it back.
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        modelResource(
          { kind: "Node", externalId: "node/pve2", isUp: true },
          lastNativePushMs,
        ),
      ],
      isNativePush: true,
    });
    expect(cluster.row("node/pve2")!.isNativePush).toBe(false);
    expect(cluster.row("node/pve2")!.lastSeenAt.getTime()).toBe(pve2LastSeenMs);

    // pve2 leaves the cluster: the agent stops listing it.
    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        if (seen.deletedAtMs === null && !cluster.row("node/pve2")) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );

    expect(seen.deletedAtMs).toBe(
      pve2LastSeenMs + staleThresholdMs() + PUSH_INTERVAL_MS,
    );
    expect(cluster.marks).toEqual([]);
  });
});

/*
 * A node the native pushes report is a member of a native-push cluster,
 * whatever wrote its row last. The mark flags it native, so from then on
 * it is kept — and reported — like any other native node until its own
 * last report falls behind the retention cutoff, instead of being pruned
 * at the normal cutoff while it is still down and still being reported.
 */
describe("ProxmoxResourceService inventory model — a reported node the native push did not write last", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  test("moved from the agent to the native push: an Offline node the agent last listed is reported, marked a native row once, and kept until the retention cutoff — as it leaves the roster", async () => {
    /*
     * pve9's row is Offline, written by the agent before the cluster
     * moved to the native push; pve9 never pushes natively.
     */
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.reportsEnabled = false;
    cluster.isNativePushArg = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve9", isUp: false },
    ]);
    await cluster.push(["pve1", "pve3"]);
    const pve9LastSeenMs: number = cluster.clockMs;
    expect(cluster.row("node/pve9")!.isNativePush).toBe(false);

    cluster.carry("pve1", []);
    cluster.isNativePushArg = true;
    cluster.reportsEnabled = true;
    // The first push after pve1 and pve3 are established again.
    const firstReportMs: number =
      pve9LastSeenMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS;
    const tally: { keptPastNormalCutoff: number } = {
      keptPastNormalCutoff: 0,
    };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        const olderThan: Date = await cluster.cleanup();
        const pve9: ModelRow | undefined = cluster.row("node/pve9");
        expect(pve9).toBeDefined();
        expect(pve9!.isUp).toBe(false);
        // An agent row until the first report marks it native.
        expect(pve9!.isNativePush).toBe(cluster.clockMs >= firstReportMs);
        if (pve9!.lastSeenAt.getTime() < olderThan.getTime()) {
          tally.keptPastNormalCutoff++;
        }
      },
    );

    // Reported from the first established push, and on every push since…
    const reportTimes: Array<number> = cluster.reportTimesOf("pve9");
    expect(reportTimes[0]).toBe(firstReportMs);
    expect(Math.max(...reportTimes)).toBe(cluster.clockMs);
    // …marked once, by the first: already Offline, it gained the flag…
    expect(cluster.marks).toEqual([
      { atMs: firstReportMs, externalId: "node/pve9" },
    ]);
    const pve9: ModelRow = cluster.row("node/pve9")!;
    expect(pve9.isUp).toBe(false);
    expect(pve9.uptimeSeconds).toBeNull();
    expect(pve9.isNativePush).toBe(true);
    expect(pve9.lastSeenAt.getTime()).toBe(pve9LastSeenMs);
    expect(pve9.updatedAt.getTime()).toBe(firstReportMs);
    // …and was kept on every cleanup since the normal cutoff passed it.
    expect(tally.keptPastNormalCutoff).toBe(
      (20 * MINUTE_MS - staleThresholdMs()) / PUSH_INTERVAL_MS,
    );
    expect(await cluster.rosterNodeNames()).toContain("pve9");

    // It lets go — and stops being reported — once its retention runs out.
    const retentionEndMs: number = pve9LastSeenMs + RETENTION_DEFAULT_MS;
    cluster.advanceTo(retentionEndMs - 5 * MINUTE_MS);
    const seen: {
      leftRosterAtMs: number | null;
      deletedAtMs: number | null;
    } = { leftRosterAtMs: null, deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      7 * MINUTE_MS,
      async (): Promise<void> => {
        const roster: Array<string> = await cluster.rosterNodeNames();
        if (seen.leftRosterAtMs === null && !roster.includes("pve9")) {
          seen.leftRosterAtMs = cluster.clockMs;
        }
        await cluster.cleanup();
        if (seen.deletedAtMs === null && !cluster.row("node/pve9")) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );
    expect(seen.deletedAtMs).toBe(retentionEndMs + PUSH_INTERVAL_MS);
    expect(seen.leftRosterAtMs).toBe(seen.deletedAtMs);
    expect(Math.max(...cluster.reportTimesOf("pve9"))).toBe(retentionEndMs);
    expect(cluster.marks).toHaveLength(1);
    for (const nodeName of ["pve1", "pve3"]) {
      expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
    }
  });

  test.each([
    ["whose last push said it was up", true],
    ["that the agent last listed Offline", false],
  ] as Array<[string, boolean]>)(
    "upgraded from a release before isNativePush, a node %s and dead since is marked a native row by the first report and kept past the normal cutoff",
    async (_label: string, isUpBefore: boolean) => {
      const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
        MODEL_T0_MS,
      );
      await cluster.upgradeFromPreviousRelease([
        { kind: "Node", externalId: "node/pve1", isUp: true },
        { kind: "Node", externalId: "node/pve2", isUp: isUpBefore },
        { kind: "Node", externalId: "node/pve3", isUp: true },
      ]);
      const upgradedAtMs: number = cluster.clockMs;
      for (const nodeName of ALL_NODES) {
        expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBeNull();
      }

      // pve1 and pve3 push natively after the upgrade; pve2 never again.
      const firstReportMs: number =
        upgradedAtMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS;
      const tally: { keptPastNormalCutoff: number } = {
        keptPastNormalCutoff: 0,
      };
      await cluster.pushFor(
        ["pve1", "pve3"],
        20 * MINUTE_MS,
        async (): Promise<void> => {
          const olderThan: Date = await cluster.cleanup();
          const pve2: ModelRow | undefined = cluster.row("node/pve2");
          expect(pve2).toBeDefined();
          if (cluster.clockMs < firstReportMs) {
            // As the migration left it until then.
            expect(pve2!.isNativePush).toBeNull();
            expect(pve2!.isUp).toBe(isUpBefore);
          } else {
            expect(pve2!.isNativePush).toBe(true);
            expect(pve2!.isUp).toBe(false);
          }
          if (pve2!.lastSeenAt.getTime() < olderThan.getTime()) {
            tally.keptPastNormalCutoff++;
          }
        },
      );

      expect(cluster.reportTimesOf("pve2")[0]).toBe(firstReportMs);
      expect(cluster.marks).toEqual([
        { atMs: firstReportMs, externalId: "node/pve2" },
      ]);
      const pve2: ModelRow = cluster.row("node/pve2")!;
      expect(pve2.isUp).toBe(false);
      expect(pve2.uptimeSeconds).toBeNull();
      expect(pve2.isNativePush).toBe(true);
      expect(pve2.lastSeenAt.getTime()).toBe(upgradedAtMs);
      expect(tally.keptPastNormalCutoff).toBe(
        (20 * MINUTE_MS - staleThresholdMs()) / PUSH_INTERVAL_MS,
      );
      expect(await cluster.rosterNodeNames()).toContain("pve2");
      // pve1's and pve3's own pushes flagged their rows.
      for (const nodeName of ["pve1", "pve3"]) {
        expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
      }
      expect(cluster.prunes.plain).toBe(0);
    },
  );
});
