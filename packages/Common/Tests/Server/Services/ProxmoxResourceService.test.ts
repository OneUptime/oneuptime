import { AddProxmoxResourceNativePushColumns1796100000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1796100000000-AddProxmoxResourceNativePushColumns";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxRemoveNodeResult,
  ProxmoxResourceLatestMetric,
} from "../../../Server/Services/ProxmoxResourceService";
import logger from "../../../Server/Utils/Logger";
import {
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  PROXMOX_ROSTER_CACHE_TTL_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  decideProxmoxSilentNodes,
  isEligibleProxmoxReporter,
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
 *     from one to the other follows too; under that same guard it clears
 *     the node's not-reporting mark (notReportingMarkedAt = NULL): a real
 *     observation as new as the row's, or newer, from either source, ends
 *     the mark, and an older one never does,
 *   - getNodeRoster reads live Node rows seen since the retention cutoff
 *     (getSilentNodeRetentionCutoff), Offline or not, marked or not,
 *     parses `node/<name>` back into the node name and hands on each row's
 *     isUp — a real boolean, or null for anything else — and its
 *     notReportingMarkedAt — a valid Date (from a Date or a string), or
 *     null for anything else — and never reads updatedAt, which the
 *     upsert and the metrics mirror stamp on the database's clock.
 *     decideProxmoxSilentNodes keeps reporting a node whose row is Offline
 *     (isUp false) and was marked within the monitor window of the roster
 *     read even while no node is established, so a garbage value must
 *     never read as false, nor as a time,
 *   - adoptNodesAsNativePush — run by the ingest on every native flush,
 *     fenced to once per 10 minutes per cluster — flags every live Node
 *     row of the cluster isNativePush = true (false and NULL alike),
 *     Online or Offline, however old, as long as it was last seen no later
 *     than `seenUpTo` (the batch's newest observation, bound inclusive),
 *     and writes nothing else — not isUp, not lastSeenAt, not the mark
 *     (notReportingMarkedAt) and not updatedAt: adopting a row is no
 *     report. A node that was already down under the agent (or before the
 *     column existed) is then kept through the warm-up after a gap,
 *     instead of pruned before anybody reported it, yet its agent-era
 *     Offline row carries no mark, however recently the agent wrote it —
 *     while a native batch processed late, after the cluster moved back to
 *     the agent, never takes the agent's newer rows,
 *   - markNodesNotReporting turns the row Offline — isUp false,
 *     uptimeSeconds cleared — and flags it isNativePush = true (a node the
 *     native pushes report is a member of a native-push cluster, whatever
 *     wrote its row last); it never touches lastSeenAt or
 *     metricsUpdatedAt, which stay the node's own last push; it stamps the
 *     mark, notReportingMarkedAt, with `markedAt` — the ingest worker's
 *     clock, the one the mark is later judged on (now, when the caller
 *     gives none), never the database's now(), which stamps only updatedAt
 *     — and a row already Offline, native and marked it rewrites only once
 *     its mark is more than 60 seconds before markedAt (a row with no mark
 *     is always marked) — so while the node is reported its mark is
 *     refreshed at most once a minute, and that durable mark is what lets
 *     the reports carry on while no node is established — and it never
 *     marks a row the node refreshed itself after `silentBefore`,
 *   - removeOfflineNode deletes a live (not soft-deleted) Node row only
 *     while it is Offline AND native ("removed"), its id clamped exactly
 *     as bulkUpsert stored it (so a node named past the column is found);
 *     when nothing was deleted a read of the row says why — "not-found"
 *     (no row; also any id that is not `node/…`, without a query),
 *     "not-native" (an agent row, or one from before the column: the
 *     agent lets a node go on its own) or "still-reporting",
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
 *     the migration that adds isNativePush and notReportingMarkedAt) end
 *     to end: through OneUptime outages of any length up to the retention
 *     window — a node that died before or during one included — past it,
 *     after the node comes back, across a switch from the native push to
 *     the agent and back — after a gap longer than the normal prune window
 *     included, and with a native batch processed late after the move back
 *     — from a release before the columns, with detection switched off,
 *     for the rows the keep must not cover, for reports of an Offline node
 *     that carry on while no node is established (only while the node's
 *     own mark — notReportingMarkedAt, on OneUptime's clock — is within
 *     the monitor window of the roster read, which the roster cache may
 *     have made up to 30 s before the push: after a short outage, a Redis
 *     failover, a lone survivor's own gaps or bursts — each report
 *     refreshing the mark once a minute — but not after the whole cluster
 *     was silent for longer than the window, nor for an agent-era Offline
 *     row, with or without a gap before the native push and however far
 *     the database clock runs ahead, when a node that came back meanwhile
 *     must not be reported), with the database clock agreeing with
 *     OneUptime's or hours off it, and for Remove Node — a node named past
 *     the column included. Each report weighs D ÷ L, where L counts every
 *     node not reported (presumed live until it is).
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

// markNodesNotReporting's SET and full WHERE, whitespace collapsed.
const MARK_SET_SQL: string =
  ' SET "isUp" = false, "uptimeSeconds" = NULL, "isNativePush" = true, "notReportingMarkedAt" = $5, "updatedAt" = now()';
const MARK_WHERE_SQL: string =
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "externalId" = ANY($3) AND "deletedAt" IS NULL AND "lastSeenAt" < $4 AND ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true OR "notReportingMarkedAt" IS NULL OR "notReportingMarkedAt" < $6)';

/*
 * The mark's refresh: a row Offline, native and marked is rewritten once
 * its mark (notReportingMarkedAt) is before $6 — markedAt minus 60 s, both
 * on the caller's clock; a row with no mark is always marked.
 */
const MARK_UNMARKED_SQL: string = '"notReportingMarkedAt" IS NULL';
const MARK_REFRESH_SQL: string = '"notReportingMarkedAt" < $6';
const MARK_REFRESH_MS: number = 60 * 1000;

// bulkUpsert's DO UPDATE ends the mark: a real observation clears it.
const UPSERT_CLEARS_MARK_SQL: string = '"notReportingMarkedAt" = NULL';

// getNodeRoster's statement, whitespace collapsed.
const ROSTER_SQL: string =
  'SELECT "externalId", "lastSeenAt", "isUp", "notReportingMarkedAt" FROM "ProxmoxResource" WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "deletedAt" IS NULL AND "lastSeenAt" >= $3';

// adoptNodesAsNativePush's statement, whitespace collapsed.
const ADOPT_SQL: string =
  'UPDATE "ProxmoxResource" SET "isNativePush" = true WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "deletedAt" IS NULL AND "isNativePush" IS DISTINCT FROM true AND "lastSeenAt" <= $3';

// removeOfflineNode's DELETE, then the read that says why nothing went.
const REMOVE_SQL: string =
  'DELETE FROM "ProxmoxResource" WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "externalId" = $3 AND "deletedAt" IS NULL AND "isUp" IS FALSE AND "isNativePush" IS TRUE';
const REMOVE_REASON_SQL: string =
  'SELECT "isUp", "isNativePush" FROM "ProxmoxResource" WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "externalId" = $3 AND "deletedAt" IS NULL';

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
  // A boolean or NULL from Postgres; anything at all to test the parse.
  isUp?: unknown;
  // A timestamp (Date or string) or NULL; anything at all to test the parse.
  notReportingMarkedAt?: unknown;
};

// The row removeOfflineNode reads when its DELETE removed nothing.
type RemoveReasonRow = {
  isUp: boolean | null;
  isNativePush: boolean | null;
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
 * A query runner that resolves each statement with the next result in
 * turn and rejects any statement past the last, so a test pins how many
 * statements were sent as well as what each returned.
 */
function mockQuerySequence(results: Array<unknown>): jest.Mock {
  const query: jest.Mock = jest.fn();
  for (const result of results) {
    query.mockResolvedValueOnce(result);
  }
  query.mockRejectedValue(new Error("unexpected extra statement"));
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

  test.each([
    ["a native push", { isNativePush: true }],
    ["an agent scrape", { isNativePush: false }],
    ["a batch that does not say", {}],
  ] as Array<[string, { isNativePush?: boolean | undefined }]>)(
    "%s ends the not-reporting mark: notReportingMarkedAt = NULL inside the lastSeenAt-guarded DO UPDATE only — on an observation as new as the row's or newer, never an older one",
    async (_label: string, flag: { isNativePush?: boolean | undefined }) => {
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
            isUp: false,
            uptimeSeconds: null,
          }),
        ],
        ...flag,
      });

      const [sql, params] = query.mock.calls[0] as QueryCall;
      const normalized: string = normalizeSql(sql);
      const guard: string =
        'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"';
      const doUpdateIndex: number = normalized.indexOf(" DO UPDATE SET ");
      const clearIndex: number = normalized.indexOf(UPSERT_CLEARS_MARK_SQL);
      const guardIndex: number = normalized.indexOf(guard);

      /*
       * Q: the mark is the live nodes' report that the node stopped
       * reporting; the node's own next observation ends it — whichever
       * source wrote it, and whatever its isUp says (an agent scrape that
       * lists the node Offline is still no report of silence). Inside the
       * DO UPDATE, so the dominance guard covers it: >=, so a replay of the
       * very observation the row holds clears it too, and an older batch —
       * processed late — never does.
       */
      expect(doUpdateIndex).toBeGreaterThan(-1);
      expect(clearIndex).toBeGreaterThan(doUpdateIndex);
      expect(guardIndex).toBeGreaterThan(clearIndex);
      expect(countOccurrences(normalized, " WHERE ")).toBe(1);
      expect(normalized.endsWith(guard)).toBe(true);
      expect(normalized).not.toContain('EXCLUDED."lastSeenAt" > "');

      /*
       * The only mention of the column: never in the INSERT column list (a
       * new row starts with no mark), never read by the guard, never bound
       * — a literal NULL, not COALESCEd, not a parameter.
       */
      expect(countOccurrences(normalized, '"notReportingMarkedAt"')).toBe(1);
      expect(normalized).not.toMatch(
        /"notReportingMarkedAt" = (COALESCE|\$|EXCLUDED)/,
      );
      expect(normalized.substring(guardIndex)).not.toContain(
        "notReportingMarkedAt",
      );
      expect(params).toHaveLength(16);
    },
  );

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

  test("never touches the not-reporting mark, nor isUp: it stamps updatedAt alone, on the database's clock — which is why the mark is its own column", async () => {
    const query: jest.Mock = mockQueryRunner();
    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      metrics: [latestMetric({ kind: "Node", externalId: "node/pve2" })],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    const normalized: string = normalizeSql(sql);
    /*
     * The mirror rewrites updatedAt with the database's now() on every
     * flush: updatedAt could never stand for "marked recently" (Q) — the
     * mark lives in notReportingMarkedAt, which the mirror leaves alone.
     */
    expect(normalized).toContain('"updatedAt" = now()');
    expect(normalized).not.toContain("notReportingMarkedAt");
    expect(normalized).not.toContain('"isUp"');
    expect(normalized).not.toContain('"lastSeenAt"');
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
    expect(sql).not.toContain("notReportingMarkedAt");
    // It reads the kind, isNativePush and the node's own lastSeenAt only.
    expect(whereClauseOf(sql).trim()).toBe(
      'WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2 AND NOT ("kind" = \'Node\' AND "isNativePush" IS TRUE AND "lastSeenAt" >= $3)',
    );
  });

  test("the keep never depends on the reports continuing — it never reads the mark, updatedAt or the database clock", async () => {
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
    expect(sql).not.toContain("notReportingMarkedAt");
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

    /*
     * The mark writes isUp, uptimeSeconds, isNativePush, the mark itself
     * (notReportingMarkedAt) and updatedAt…
     */
    expect(markedColumns).toEqual([
      "isUp",
      "uptimeSeconds",
      "isNativePush",
      "notReportingMarkedAt",
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

    /*
     * The whole statement: the id, the node's own last push, its isUp and
     * when the live nodes last reported it as not reporting (its mark).
     */
    expect(normalized).toBe(ROSTER_SQL);
    expect(normalized).toContain(
      'SELECT "externalId", "lastSeenAt", "isUp", "notReportingMarkedAt" FROM "ProxmoxResource"',
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

  test("Offline rows stay on the roster: isUp is read, never filtered on", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    /*
     * A node reported Offline is exactly the one whose reports must carry
     * on — while no node is established too — so its row must come back.
     */
    expect(whereClauseOf(sql)).not.toContain('"isUp"');
    expect(countOccurrences(sql, '"isUp"')).toBe(1);
    // Nor on whoever wrote the row: an agent row is on the roster too.
    expect(sql).not.toContain("isNativePush");
  });

  test("rows marked long ago, or never, stay on the roster: the mark is read, never filtered on, and the database clock is never consulted", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    /*
     * Whether a mark is recent enough to carry the reports on is decided
     * on OneUptime's clock (decideProxmoxSilentNodes, against the monitor
     * window at the roster read); a node whose mark aged out, or that was
     * never marked, is still a member of the cluster — it waits for an
     * established node, it never leaves the roster.
     */
    expect(whereClauseOf(sql)).not.toContain('"notReportingMarkedAt"');
    expect(countOccurrences(sql, '"notReportingMarkedAt"')).toBe(1);
    expect(sql).not.toMatch(/now\(\)|interval|CURRENT_TIMESTAMP/i);
    // The retention cutoff is the only time bound, and it is lastSeenAt's.
    expect(params).toHaveLength(3);
    expect(countOccurrences(sql, "$3")).toBe(1);
    expect(whereClauseOf(sql)).toContain('"lastSeenAt" >= $3');
  });

  test("never reads updatedAt: the upsert and the metrics mirror stamp it on the database's clock, so an agent scrape — or any write — could pass for a fresh mark", async () => {
    const query: jest.Mock = mockQueryRunner([]);
    await ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      now: NOW,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    // Q: the mark is its own column; updatedAt is nobody's mark.
    expect(sql).not.toContain("updatedAt");
    expect(sql).not.toContain("metricsUpdatedAt");
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

  test("parses node/<name> back into node names, in row order, from Date or string lastSeenAt and notReportingMarkedAt, with each row's isUp — and nothing else", async () => {
    const pve1SeenAt: Date = new Date("2026-09-28T11:59:50.000Z");
    const pve1MarkedAt: Date = new Date("2026-09-28T11:59:50.123Z");
    const rows: Array<RosterRow> = [
      {
        externalId: "node/pve1",
        lastSeenAt: pve1SeenAt,
        isUp: true,
        notReportingMarkedAt: pve1MarkedAt,
      },
      // node-postgres may hand timestamps back as strings — both parse.
      {
        externalId: "node/pve2",
        lastSeenAt: "2026-09-28T11:55:00.000Z",
        isUp: false,
        notReportingMarkedAt: "2026-09-28T11:58:30.000Z",
      },
      {
        externalId: "node/pve-3.lab",
        lastSeenAt: "2026-09-27T09:00:00Z",
        isUp: null,
        notReportingMarkedAt: null,
      },
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
        nodeName: "pve1",
        lastSeenAt: pve1SeenAt,
        isUp: true,
        notReportingMarkedAt: pve1MarkedAt,
      },
      {
        nodeName: "pve2",
        lastSeenAt: new Date("2026-09-28T11:55:00.000Z"),
        isUp: false,
        notReportingMarkedAt: new Date("2026-09-28T11:58:30.000Z"),
      },
      {
        nodeName: "pve-3.lab",
        lastSeenAt: new Date("2026-09-27T09:00:00.000Z"),
        isUp: null,
        notReportingMarkedAt: null,
      },
    ]);
    for (const node of roster) {
      expect(node.lastSeenAt).toBeInstanceOf(Date);
      // The roster carries these four and nothing else — no updatedAt.
      expect(Object.keys(node).sort()).toEqual([
        "isUp",
        "lastSeenAt",
        "nodeName",
        "notReportingMarkedAt",
      ]);
    }
    expect(roster[0]!.notReportingMarkedAt).toBeInstanceOf(Date);
    expect(roster[1]!.notReportingMarkedAt).toBeInstanceOf(Date);
  });

  test("a driver row that carried updatedAt too would still hand on the mark alone — updatedAt, whatever it reads, is nobody's mark", async () => {
    mockQueryRunner([
      {
        externalId: "node/pve2",
        lastSeenAt: "2026-09-28T11:55:00.000Z",
        isUp: false,
        notReportingMarkedAt: null,
        // An agent scrape a second ago, on a database clock running ahead.
        updatedAt: new Date("2026-09-28T13:00:00.000Z"),
      },
    ] as Array<RosterRow & { updatedAt: Date }>);

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });

    expect(roster).toStrictEqual([
      {
        nodeName: "pve2",
        lastSeenAt: new Date("2026-09-28T11:55:00.000Z"),
        isUp: false,
        notReportingMarkedAt: null,
      },
    ]);
  });

  test.each([
    [
      "a Date",
      new Date("2026-09-28T11:58:30.250Z"),
      new Date("2026-09-28T11:58:30.250Z"),
    ],
    [
      "an ISO string",
      "2026-09-28T11:58:30.250Z",
      new Date("2026-09-28T11:58:30.250Z"),
    ],
    [
      "an ISO string with an offset",
      "2026-09-28T13:58:30.250+02:00",
      new Date("2026-09-28T11:58:30.250Z"),
    ],
    ["NULL", null, null],
    ["undefined", undefined, null],
    ["an empty string", "", null],
    ['the string "garbage"', "garbage", null],
    ['the string "not-a-date"', "not-a-date", null],
    ["an invalid Date", new Date(NaN), null],
    ["NaN", NaN, null],
    ["an object", {}, null],
    ["an empty array", [], null],
  ] as Array<[string, unknown, Date | null]>)(
    "a notReportingMarkedAt of %s from the driver is handed on as %p — only a valid time counts",
    async (_label: string, raw: unknown, expected: Date | null) => {
      mockQueryRunner([
        {
          externalId: "node/pve2",
          lastSeenAt: "2026-09-28T11:55:00.000Z",
          isUp: false,
          notReportingMarkedAt: raw,
        },
      ] as Array<RosterRow>);

      const roster: Array<ProxmoxRosterNode> =
        await ProxmoxResourceService.getNodeRoster({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          now: NOW,
        });

      /*
       * A recent mark lets an Offline node be reported while no node is
       * established, so only a real time may read as one: anything else
       * is null — no mark — and the node waits for an established node.
       * The row itself stays on the roster either way.
       */
      expect(roster).toHaveLength(1);
      expect(roster[0]!.nodeName).toBe("pve2");
      expect(roster[0]!.isUp).toBe(false);
      if (expected === null) {
        expect(roster[0]!.notReportingMarkedAt).toBeNull();
      } else {
        expect(roster[0]!.notReportingMarkedAt).toBeInstanceOf(Date);
        expect(roster[0]!.notReportingMarkedAt!.getTime()).toBe(
          expected.getTime(),
        );
      }
    },
  );

  test.each([
    ["true", true, true],
    ["false", false, false],
    ["NULL", null, null],
    ['the string "false"', null, "false"],
    ['the string "f"', null, "f"],
    ['the string "true"', null, "true"],
    ["0", null, 0],
    ["1", null, 1],
    ["an empty string", null, ""],
    ["an object", null, {}],
  ] as Array<[string, boolean | null, unknown]>)(
    "an isUp of %s from the driver is handed on as %p — only a real boolean counts",
    async (_label: string, expected: boolean | null, raw: unknown) => {
      mockQueryRunner([
        {
          externalId: "node/pve2",
          lastSeenAt: "2026-09-28T11:55:00.000Z",
          isUp: raw,
        },
      ] as Array<RosterRow>);

      const roster: Array<ProxmoxRosterNode> =
        await ProxmoxResourceService.getNodeRoster({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          now: NOW,
        });

      /*
       * Offline (false) lets a node be reported while no node is
       * established, so only a real false may read as false: anything
       * else is null — unknown — and waits for an established node.
       */
      expect(roster).toHaveLength(1);
      expect(roster[0]!.isUp).toBe(expected);
    },
  );

  test("a row with no isUp or mark at all reads null for both — never undefined, never false, never a time", async () => {
    mockQueryRunner([
      { externalId: "node/pve2", lastSeenAt: "2026-09-28T11:55:00.000Z" },
    ] as Array<RosterRow>);

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });

    expect(roster).toHaveLength(1);
    expect(roster[0]!.isUp).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(roster[0], "isUp")).toBe(true);
    expect(roster[0]!.notReportingMarkedAt).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(roster[0], "notReportingMarkedAt"),
    ).toBe(true);
  });

  test("the mark never decides who is on the roster: rows with a garbage, NULL or ancient notReportingMarkedAt are listed like the rest", async () => {
    mockQueryRunner([
      {
        externalId: "node/pve1",
        lastSeenAt: "2026-09-28T11:59:50.000Z",
        isUp: true,
        notReportingMarkedAt: "2026-09-28T11:59:50.000Z",
      },
      {
        externalId: "node/pve2",
        lastSeenAt: "2026-09-28T11:55:00.000Z",
        isUp: false,
        notReportingMarkedAt: "garbage",
      },
      {
        externalId: "node/pve3",
        lastSeenAt: "2026-09-28T11:00:00.000Z",
        isUp: false,
        notReportingMarkedAt: null,
      },
      {
        externalId: "node/pve4",
        lastSeenAt: "2026-09-22T12:00:00.000Z",
        isUp: false,
        notReportingMarkedAt: new Date("2026-09-22T12:05:00.000Z"),
      },
    ] as Array<RosterRow>);

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        now: NOW,
      });

    expect(
      roster.map((node: ProxmoxRosterNode): [string, number | null] => {
        return [
          node.nodeName,
          node.notReportingMarkedAt
            ? node.notReportingMarkedAt.getTime()
            : null,
        ];
      }),
    ).toEqual([
      ["pve1", new Date("2026-09-28T11:59:50.000Z").getTime()],
      ["pve2", null],
      ["pve3", null],
      ["pve4", new Date("2026-09-22T12:05:00.000Z").getTime()],
    ]);
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
      // A valid mark never saves a row whose lastSeenAt is garbage.
      {
        externalId: "node/pve4",
        lastSeenAt: "not-a-date",
        isUp: false,
        notReportingMarkedAt: "2026-09-28T11:59:00.000Z",
      },
      {
        externalId: "node/pve5",
        lastSeenAt: new Date(NaN),
        isUp: false,
        notReportingMarkedAt: new Date("2026-09-28T11:59:00.000Z"),
      },
      {
        externalId: "node/pve6",
        lastSeenAt: "2026-09-28T11:00:00.000Z",
        isUp: false,
        notReportingMarkedAt: "2026-09-28T11:59:00.000Z",
      },
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
        isUp: false,
        notReportingMarkedAt: new Date("2026-09-28T11:59:00.000Z"),
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
  // Now on the ingest worker's clock, as the ingest passes it.
  const MARKED_AT: Date = new Date("2026-09-28T12:00:00.000Z");

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
    markedAt: Date = MARKED_AT,
  ): Promise<MarkCapture> {
    const query: jest.Mock = mockQueryResolving(result);
    const affected: number = await ProxmoxResourceService.markNodesNotReporting(
      {
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        nodeNames,
        silentBefore: SILENT_BEFORE,
        markedAt,
      },
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    return { affected, sql, params };
  }

  // The statement and parameters of a mark called without markedAt.
  async function markWithoutMarkedAt(
    markedAtKey: "omitted" | "undefined",
  ): Promise<MarkCapture> {
    const query: jest.Mock = mockQueryResolving([[], 1]);
    const affected: number =
      markedAtKey === "omitted"
        ? await ProxmoxResourceService.markNodesNotReporting({
            projectId: PROJECT_ID,
            proxmoxClusterId: CLUSTER_ID,
            nodeNames: ["pve2"],
            silentBefore: SILENT_BEFORE,
          })
        : await ProxmoxResourceService.markNodesNotReporting({
            projectId: PROJECT_ID,
            proxmoxClusterId: CLUSTER_ID,
            nodeNames: ["pve2"],
            silentBefore: SILENT_BEFORE,
            markedAt: undefined,
          });
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

  test("parameters: project, cluster, node/<name> ids in order, silentBefore, markedAt, then markedAt minus 60 s", async () => {
    const { params } = await markAndCapture(["pve2", "pve3", "pve-4.lab"]);
    expect(params).toHaveLength(6);
    expect(params[0]).toBe(PROJECT_ID.toString());
    expect(params[1]).toBe(CLUSTER_ID.toString());
    // One array bound to ANY($3) — never interpolated into the SQL.
    expect(params[2]).toEqual(["node/pve2", "node/pve3", "node/pve-4.lab"]);
    // The very Date the caller computed, unmodified.
    expect(params[3]).toBe(SILENT_BEFORE);
    // $5: the time the mark is stamped with — the caller's markedAt.
    expect(params[4]).toBeInstanceOf(Date);
    expect((params[4] as Date).getTime()).toBe(MARKED_AT.getTime());
    // $6: the refresh bound, a minute before it on the same clock.
    expect(params[5]).toBeInstanceOf(Date);
    expect((params[5] as Date).getTime()).toBe(
      MARKED_AT.getTime() - MARK_REFRESH_MS,
    );
    expect(MARKED_AT.toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });

  test("markedAt is stamped to the millisecond, and the refresh bound is exactly 60 000 ms before it — the caller's Date never mutated", async () => {
    const markedAt: Date = new Date("2026-09-28T11:59:59.999Z");
    const { params } = await markWithDriverResult(["pve2"], [[], 1], markedAt);

    expect((params[4] as Date).toISOString()).toBe("2026-09-28T11:59:59.999Z");
    expect((params[5] as Date).toISOString()).toBe("2026-09-28T11:58:59.999Z");
    expect(markedAt.toISOString()).toBe("2026-09-28T11:59:59.999Z");
    // The bound is its own Date: shifting it never moved the stamp.
    expect(params[5]).not.toBe(params[4]);
    expect(params[5]).not.toBe(markedAt);
  });

  test.each([["omitted"], ["undefined"]] as Array<["omitted" | "undefined"]>)(
    "markedAt %s: it is now — the current time read once, the stamp and the refresh bound both from that one reading",
    async (markedAtKey: "omitted" | "undefined") => {
      const now: Date = new Date("2026-09-28T12:34:56.789Z");
      const getCurrentDate: jest.SpyInstance = jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(now);

      const { params } = await markWithoutMarkedAt(markedAtKey);

      expect(getCurrentDate).toHaveBeenCalledTimes(1);
      expect(params).toHaveLength(6);
      expect((params[4] as Date).getTime()).toBe(now.getTime());
      expect((params[5] as Date).getTime()).toBe(
        now.getTime() - MARK_REFRESH_MS,
      );
      expect(now.toISOString()).toBe("2026-09-28T12:34:56.789Z");
    },
  );

  test("with markedAt given, the current time is never read — the stamp is the caller's clock alone", async () => {
    const getCurrentDate: jest.SpyInstance = jest.spyOn(
      OneUptimeDate,
      "getCurrentDate",
    );

    const { params } = await markAndCapture(["pve2"]);

    expect(getCurrentDate).not.toHaveBeenCalled();
    expect((params[4] as Date).getTime()).toBe(MARKED_AT.getTime());
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

  test("SET writes isUp = false, uptimeSeconds = NULL, isNativePush = true, the mark notReportingMarkedAt = $5 (markedAt) and updatedAt = now() only", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const setClause: string = setClauseOf(sql);

    expect(setClause).toBe(MARK_SET_SQL);
    // Exactly five assignments.
    expect(countOccurrences(setClause, " = ")).toBe(5);
    // The mark is the caller's clock, bound once — never the database's.
    expect(setClause).toContain('"notReportingMarkedAt" = $5');
    expect(setClause).not.toMatch(/"notReportingMarkedAt" = (now\(\)|NULL)/);
    /*
     * updatedAt is plain bookkeeping on the database's clock, as every
     * other write stamps it; nothing reads it as the mark.
     */
    expect(setClause).toContain('"updatedAt" = now()');
    expect(countOccurrences(sql, "now()")).toBe(1);
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

  test("a row already Offline, native and marked is left alone while its mark is within the last minute; a NULL isUp, an Offline row not yet native (false or NULL), an Offline native row never marked (a NULL mark), or one marked longer ago, is marked", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    // One parenthesised ANDed term, the statement's last.
    expect(
      where.endsWith(
        `AND ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true OR ${MARK_UNMARKED_SQL} OR ${MARK_REFRESH_SQL})`,
      ),
    ).toBe(true);
    // IS DISTINCT FROM: a NULL isUp is marked too (NULL <> false is NULL)…
    expect(where).not.toContain('"isUp" <> false');
    expect(where).not.toContain('"isUp" != false');
    // …and so is a NULL isNativePush (NULL <> true is NULL)…
    expect(where).not.toContain('"isNativePush" <> true');
    expect(where).not.toContain('"isNativePush" != true');
    /*
     * …and a row with no mark at all (NULL < $6 is NULL): an agent-era
     * Offline row adopted by the native push, or a node whose own last
     * push said it was down, gets its first mark from the first report,
     * whatever its updatedAt reads.
     */
    expect(where).toContain(MARK_UNMARKED_SQL);
    expect(where).not.toContain('"notReportingMarkedAt" = NULL');
  });

  test("the guard's ORs stay inside its parentheses — they never escape the scope filters or the silentBefore guard", async () => {
    const { sql } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);

    expect(where.trim()).toBe(MARK_WHERE_SQL);
    // The statement's only three ORs…
    expect(countOccurrences(where, " OR ")).toBe(3);
    // …sit inside the last term, after every ANDed filter.
    const orIndex: number = where.indexOf(" OR ");
    const openIndex: number = where.lastIndexOf("(", orIndex);
    expect(where.substring(0, openIndex).endsWith(" AND ")).toBe(true);
    expect(where.substring(0, openIndex)).toContain('"lastSeenAt" < $4');
    expect(where.substring(0, openIndex)).not.toMatch(/\bOR\b/);
    expect(where.lastIndexOf(" OR ")).toBeGreaterThan(openIndex);
    expect(where.endsWith(")")).toBe(true);
    // The term's parenthesis is the statement's only one beyond ANY($3).
    expect(countOccurrences(where.substring(openIndex), "(")).toBe(1);
    expect(countOccurrences(where, "(")).toBe(2);
    expect(where.substring(openIndex)).toContain(MARK_UNMARKED_SQL);
    expect(where.substring(openIndex)).toContain(MARK_REFRESH_SQL);
    expect(where).not.toContain("now()");
  });

  test("the refresh: a row Offline, native and marked is rewritten once its mark is more than 60 seconds before markedAt — strictly, both on the caller's clock, never the database's now(), and never by updatedAt", async () => {
    const { sql, params } = await markAndCapture(["pve2"]);
    const where: string = whereClauseOf(sql);
    const setClause: string = setClauseOf(sql);

    /*
     * While the live nodes keep reporting a node, its mark is refreshed at
     * most once a minute — the ingest fences the write to once per 30 s
     * on top — and a recent mark is what lets the reports of an Offline
     * node carry on while no node is established (decideProxmoxSilentNodes,
     * against the monitor window at the roster read, on the worker's
     * clock). Stamped and compared on that same clock, so a database clock
     * minutes off it can neither keep a mark from ageing out nor age it
     * out early.
     */
    expect(countOccurrences(where, MARK_REFRESH_SQL)).toBe(1);
    // Strictly older: a mark exactly 60 s old is not rewritten yet.
    expect(where).not.toMatch(/"notReportingMarkedAt" <= /);
    expect(where).not.toMatch(/"notReportingMarkedAt" (>|>=|=) /);
    // The mark is read only there and in its NULL test, written only to $5.
    expect(countOccurrences(where, '"notReportingMarkedAt"')).toBe(2);
    expect(setClause).toContain('"notReportingMarkedAt" = $5');
    expect(countOccurrences(sql, '"notReportingMarkedAt"')).toBe(3);
    /*
     * updatedAt never decides whether the row is written: the upsert and
     * the metrics mirror stamp it too, on the database's clock, so it says
     * nothing about when the node was last reported down.
     */
    expect(where).not.toContain("updatedAt");
    expect(countOccurrences(sql, '"updatedAt"')).toBe(1);
    // $5 once, in SET; $6 once, in the guard; nothing past them.
    expect(countOccurrences(sql, "$5")).toBe(1);
    expect(countOccurrences(setClause, "$5")).toBe(1);
    expect(countOccurrences(sql, "$6")).toBe(1);
    expect(countOccurrences(where, "$6")).toBe(1);
    expect(sql).not.toContain("$7");
    expect(params).toHaveLength(6);
    // The bound is the stamp's own clock, a minute back.
    expect((params[4] as Date).getTime() - (params[5] as Date).getTime()).toBe(
      MARK_REFRESH_MS,
    );
    // The database clock plays no part in the guard: no now(), no interval.
    expect(where).not.toContain("now()");
    expect(sql).not.toMatch(/interval/i);
    // The refresh never makes a row the node refreshed itself markable.
    expect(where).toContain('AND "lastSeenAt" < $4 AND (');
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

  test("the node's own next push flips it back through bulkUpsert, and ends the mark", async () => {
    /*
     * The mark never advanced lastSeenAt, so the node's next push (a
     * newer lastSeenAt) passes bulkUpsert's dominance guard and writes
     * isUp = true and a fresh uptime over the Offline row — flagged as a
     * native push by the push itself, as the mark had left it — and
     * clears the mark the report wrote.
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
    // The column the mark wrote, and the push clears — under the guard.
    expect(setClauseOf(markSql)).toContain('"notReportingMarkedAt" = $5');
    const upsertNormalized: string = normalizeSql(upsertSql);
    expect(upsertNormalized.indexOf(UPSERT_CLEARS_MARK_SQL)).toBeLessThan(
      upsertNormalized.indexOf(' WHERE EXCLUDED."lastSeenAt"'),
    );
    expect(upsertNormalized.indexOf(UPSERT_CLEARS_MARK_SQL)).toBeGreaterThan(
      upsertNormalized.indexOf(" DO UPDATE SET "),
    );
  });
});

describe("ProxmoxResourceService.adoptNodesAsNativePush", () => {
  type AdoptCapture = {
    affected: number;
    sql: string;
    params: Array<unknown>;
  };

  // The newest observation of the batch the flush adopts after.
  const SEEN_UP_TO: Date = new Date("2026-09-28T12:00:00.000Z");

  async function adoptWithDriverResult(
    result: unknown,
    seenUpTo: Date = SEEN_UP_TO,
  ): Promise<AdoptCapture> {
    const query: jest.Mock = mockQueryResolving(result);
    const affected: number =
      await ProxmoxResourceService.adoptNodesAsNativePush({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        seenUpTo,
      });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;
    return { affected, sql, params };
  }

  async function adoptAndCapture(): Promise<AdoptCapture> {
    return adoptWithDriverResult([[], 2]);
  }

  test("is a single UPDATE of the inventory table — the whole statement", async () => {
    const { sql } = await adoptAndCapture();
    const normalized: string = normalizeSql(sql);
    expect(normalized).toBe(ADOPT_SQL);
    expect(normalized.startsWith('UPDATE "ProxmoxResource"')).toBe(true);
    expect(normalized).not.toMatch(/\b(DELETE|INSERT|SELECT)\b/);
  });

  test("SET writes isNativePush = true and nothing else — a literal true, never bound", async () => {
    const { sql } = await adoptAndCapture();
    const setClause: string = setClauseOf(sql);

    expect(setClause).toBe(' SET "isNativePush" = true');
    expect(countOccurrences(setClause, " = ")).toBe(1);
    // Only ever into the keep: never false, NULL or a parameter.
    expect(setClause).not.toMatch(/"isNativePush" = (false|NULL|\$)/);
  });

  test("never touches the mark (notReportingMarkedAt) or updatedAt — adopting a row is no report, so an agent-era Offline row stays unmarked", async () => {
    const { sql, params } = await adoptAndCapture();

    /*
     * The mark is what lets the reports of an Offline node carry on while
     * no node is established. Were the adoption to write it — or anything
     * the decision reads as it — an agent-era Offline row adopted on the
     * first native flush would read as marked just now, and be reported
     * with no node established: a false Node Offline for a node that came
     * back during the switch and whose own first native push was processed
     * after its siblings'. Nor does it stamp updatedAt: nothing but the
     * flag moves.
     */
    expect(sql).not.toContain("notReportingMarkedAt");
    expect(sql).not.toContain('"updatedAt"');
    expect(sql).not.toContain("now()");
    expect(params).toHaveLength(3);
    for (const param of params) {
      // The only time bound is seenUpTo, and it is compared, never written.
      if (param instanceof Date) {
        expect(param).toBe(SEEN_UP_TO);
      }
    }
  });

  test("never writes isUp, uptimeSeconds, lastSeenAt, metricsUpdatedAt, the mark or updatedAt — what the node reported, whether it was reported down, and its retention clock, stay its own", async () => {
    const { sql } = await adoptAndCapture();
    const setClause: string = setClauseOf(sql);

    /*
     * Adoption only changes what the prune keeps. An adopted Online row
     * still reads Online until a report marks it; an Offline one stays
     * Offline and unmarked (or marked as it was); and it is kept only
     * until its own last push falls behind the retention cutoff, as any
     * native node.
     */
    for (const column of [
      "isUp",
      "uptimeSeconds",
      "lastSeenAt",
      "metricsUpdatedAt",
      "notReportingMarkedAt",
      "updatedAt",
      "name",
      "externalId",
      "kind",
      "deletedAt",
    ]) {
      expect(setClause).not.toContain(`"${column}"`);
    }
  });

  test("WHERE: exactly the project, the cluster and its live Node rows not yet native, last seen no later than seenUpTo", async () => {
    const { sql } = await adoptAndCapture();
    const where: string = whereClauseOf(sql);

    expect(where.trim()).toBe(
      'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "deletedAt" IS NULL AND "isNativePush" IS DISTINCT FROM true AND "lastSeenAt" <= $3',
    );
    // Guests and storage are never adopted: the keep is for Node rows.
    expect(where).toContain("\"kind\" = 'Node'");
    // Every filter ANDed: none can be escaped.
    expect(where).not.toMatch(/\bOR\b/);
  });

  test("adopts agent rows (false) and rows from before the column (NULL) alike, and leaves native rows alone", async () => {
    const { sql } = await adoptAndCapture();
    const where: string = whereClauseOf(sql);

    // IS DISTINCT FROM: NULL is adopted too (NULL <> true is NULL).
    expect(where).toContain('"isNativePush" IS DISTINCT FROM true');
    expect(where).not.toContain('"isNativePush" <> true');
    expect(where).not.toContain('"isNativePush" != true');
    expect(where).not.toContain('"isNativePush" = false');
    expect(where).not.toContain('"isNativePush" IS FALSE');
    // Once in SET, once in the guard — a native row is never rewritten.
    expect(countOccurrences(sql, '"isNativePush"')).toBe(2);
  });

  test("adopts Online and Offline rows alike, however old — it never reads isUp, and reads lastSeenAt only as the seenUpTo bound", async () => {
    const { sql } = await adoptAndCapture();
    const where: string = whereClauseOf(sql);

    /*
     * A node the agent last saw Online may have died during the gap
     * before the native push: it must be kept through the warm-up until
     * an established node reports it. And a row too old for the keep is
     * still pruned — the keep itself reads lastSeenAt; the adoption has
     * no lower bound.
     */
    expect(sql).not.toContain('"isUp"');
    expect(countOccurrences(sql, '"lastSeenAt"')).toBe(1);
    expect(where).toContain('"lastSeenAt" <= $3');
    expect(where).not.toMatch(/"lastSeenAt" (>|>=|<|=) /);
    expect(sql).not.toMatch(/interval|now\(\) *[-+]/i);
  });

  test("the seenUpTo bound is inclusive: a row seen at the batch's very instant is adopted, only a newer one is not", async () => {
    const { sql } = await adoptAndCapture();
    const where: string = whereClauseOf(sql);

    /*
     * A native batch processed late, after the cluster moved back to the
     * agent, must not take the agent's newer rows (strictly newer than
     * its newest observation); anything seen up to that observation was
     * seen while the cluster pushed natively, or before.
     */
    expect(where.endsWith('AND "lastSeenAt" <= $3')).toBe(true);
    expect(where).not.toContain('"lastSeenAt" < $3');
  });

  test("parameters: the project, the cluster, then seenUpTo itself — bound, never spliced, never shifted", async () => {
    const seenUpTo: Date = new Date("2026-09-28T11:59:59.999Z");
    const seenUpToMs: number = seenUpTo.getTime();
    const { sql, params } = await adoptWithDriverResult([[], 1], seenUpTo);

    expect(params).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
      seenUpTo,
    ]);
    // The caller's very Date, to the millisecond, and left as it was.
    expect(params[2]).toBe(seenUpTo);
    expect(seenUpTo.getTime()).toBe(seenUpToMs);
    expect(sql).not.toContain(seenUpTo.toISOString());
  });

  test("returns the affected count from the postgres [rows, affected] result", async () => {
    const { affected } = await adoptWithDriverResult([[], 3]);
    expect(affected).toBe(3);
  });

  test.each([[[[], 0]], [{}], [[]], [[[]]], [undefined], [null], [[[], "2"]]])(
    "returns 0 for the driver result %p",
    async (result: unknown) => {
      const { affected } = await adoptWithDriverResult(result);
      expect(affected).toBe(0);
    },
  );

  test("a failing query rejects — the ingest releases its fence, logs it and carries on", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockRejectedValue(new Error("connection terminated"));
    jest
      .spyOn(ProxmoxResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);

    await expect(
      ProxmoxResourceService.adoptNodesAsNativePush({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        seenUpTo: SEEN_UP_TO,
      }),
    ).rejects.toThrow("connection terminated");
  });
});

describe("ProxmoxResourceService.removeOfflineNode", () => {
  type RemoveCapture = {
    result: ProxmoxRemoveNodeResult;
    calls: Array<QueryCall>;
  };

  // The statements removeOfflineNode sent, in order, and what it returned.
  async function removeWith(
    driverResults: Array<unknown>,
    externalId: string = "node/pve2",
  ): Promise<RemoveCapture> {
    const query: jest.Mock = mockQuerySequence(driverResults);
    const result: ProxmoxRemoveNodeResult =
      await ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId,
      });
    return { result, calls: query.mock.calls as Array<QueryCall> };
  }

  const EXPECTED_PARAMS: Array<string> = [
    PROJECT_ID.toString(),
    CLUSTER_ID.toString(),
    "node/pve2",
  ];

  test.each([
    ["qemu/100"],
    ["lxc/200"],
    ["storage/pve1/local"],
    ["pve1"],
    [""],
    ["Node/pve1"],
    [" node/pve1"],
  ])(
    "%p (not a node/ id) is not-found without touching the database",
    async (externalId: string) => {
      // Were it sent, the DELETE would report a row removed.
      const query: jest.Mock = mockQueryRunner([[], 1]);
      const getRepository: jest.SpyInstance = jest.spyOn(
        ProxmoxResourceService,
        "getRepository",
      );
      getRepository.mockClear();

      const result: ProxmoxRemoveNodeResult =
        await ProxmoxResourceService.removeOfflineNode({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          externalId,
        });

      expect(result).toBe("not-found");
      expect(query).not.toHaveBeenCalled();
      expect(getRepository).not.toHaveBeenCalled();
    },
  );

  test("removed: one DELETE of an Offline, native Node row of this project and cluster — and nothing else is sent", async () => {
    const { result, calls } = await removeWith([[[], 1]]);

    expect(result).toBe("removed");
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0]!;
    expect(normalizeSql(sql)).toBe(REMOVE_SQL);
    expect(params).toEqual(EXPECTED_PARAMS);
  });

  test("the DELETE removes a node only while it is Offline AND on the native push", async () => {
    const { calls } = await removeWith([[[], 1]]);
    const [sql] = calls[0]!;
    const normalized: string = normalizeSql(sql);
    const where: string = whereClauseOf(sql);

    expect(normalized.startsWith('DELETE FROM "ProxmoxResource"')).toBe(true);
    expect(where).toContain('"projectId" = $1');
    expect(where).toContain('"proxmoxClusterId" = $2');
    expect(where).toContain("\"kind\" = 'Node'");
    expect(where).toContain('"externalId" = $3');
    /*
     * IS FALSE: a node that is up — or whose state is unknown (NULL) —
     * is never removed; it would only reappear on its next push.
     */
    expect(where).toContain('"isUp" IS FALSE');
    /*
     * IS TRUE: an agent row (false) or one from before the column (NULL)
     * is never removed — the agent lets a node go on its own, and would
     * re-create one it still lists on its next scrape.
     */
    expect(where).toContain('"isNativePush" IS TRUE');
    expect(where).not.toMatch(/\bOR\b/);
    expect(where).not.toContain("IS DISTINCT FROM");
  });

  test("the DELETE skips a soft-deleted row, exactly as the read that says why does — a soft-deleted Offline native row reads not-found and stays", async () => {
    const { result, calls } = await removeWith([[[], 0], []]);
    const [deleteSql] = calls[0]!;
    const [reasonSql] = calls[1]!;
    const deleteWhere: string = whereClauseOf(deleteSql);

    /*
     * Without it the DELETE would hard-delete a soft-deleted row that is
     * Offline and native — a row that is no node of the cluster any more
     * (the read, which skips it, would never have found it).
     */
    expect(deleteWhere).toContain('"deletedAt" IS NULL');
    expect(countOccurrences(deleteWhere, '"deletedAt"')).toBe(1);
    expect(deleteWhere).not.toMatch(/"deletedAt" IS NOT NULL/);
    // Right after the row's identity, before the state guards, ANDed.
    expect(deleteWhere).toContain(
      '"externalId" = $3 AND "deletedAt" IS NULL AND "isUp" IS FALSE',
    );
    // The two statements address the very same rows.
    const identity: string =
      'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "kind" = \'Node\' AND "externalId" = $3 AND "deletedAt" IS NULL';
    expect(deleteWhere.trim().startsWith(identity)).toBe(true);
    expect(whereClauseOf(reasonSql).trim()).toBe(identity);
    expect(result).toBe("not-found");
  });

  test.each([
    ["150 plain characters", "n".repeat(150)],
    ["exactly one past the column (96 + node/)", "a".repeat(96)],
    [
      "an emoji straddling the 100th code unit — the orphaned half is dropped",
      `${"e".repeat(94)}\u{1F525}tail`,
    ],
  ])(
    "a node id longer than the column (%s) is clamped exactly as bulkUpsert stored it — for the DELETE and the read alike",
    async (_label: string, nodeName: string) => {
      const externalId: string = `node/${nodeName}`;
      expect(externalId.length).toBeGreaterThan(100);

      const { calls } = await removeWith([[[], 0], []], externalId);
      expect(calls).toHaveLength(2);
      const deleteParams: Array<unknown> = calls[0]![1];
      const reasonParams: Array<unknown> = calls[1]![1];

      // What bulkUpsert stored for the same node.
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
            externalId,
            name: nodeName,
            vmid: null,
            guestType: null,
            parentNodeName: null,
          }),
        ],
        isNativePush: true,
      });
      const [, upsertParams] = upsertQuery.mock.calls[0] as QueryCall;
      // Column 4 (0-indexed 3) is externalId — the row's identity.
      const stored: string = upsertParams[3] as string;
      expect(stored.length).toBeLessThanOrEqual(100);
      expect(externalId.startsWith(stored)).toBe(true);

      expect(deleteParams).toEqual([
        PROJECT_ID.toString(),
        CLUSTER_ID.toString(),
        stored,
      ]);
      expect(reasonParams).toEqual(deleteParams);
    },
  );

  test("a node id of exactly 100 characters, the column's width, is bound unchanged", async () => {
    const externalId: string = `node/${"x".repeat(95)}`;
    expect(externalId).toHaveLength(100);
    const { calls } = await removeWith([[[], 1]], externalId);
    expect(calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      CLUSTER_ID.toString(),
      externalId,
    ]);
  });

  test("the clamp comes after the node/ check: a long id that is not a node's is still not-found without a statement", async () => {
    const query: jest.Mock = mockQueryRunner([[], 1]);
    const result: ProxmoxRemoveNodeResult =
      await ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId: `qemu/${"9".repeat(150)}`,
      });
    expect(result).toBe("not-found");
    expect(query).not.toHaveBeenCalled();
  });

  test("any positive affected count reads removed", async () => {
    const { result, calls } = await removeWith([[[], 2]]);
    expect(result).toBe("removed");
    expect(calls).toHaveLength(1);
  });

  test("nothing deleted: one read of the row's isUp and isNativePush says why — same parameters, never a write", async () => {
    const { calls } = await removeWith([[[], 0], []]);

    expect(calls).toHaveLength(2);
    expect(normalizeSql(calls[0]![0])).toBe(REMOVE_SQL);
    const [sql, params] = calls[1]!;
    const normalized: string = normalizeSql(sql);
    expect(normalized).toBe(REMOVE_REASON_SQL);
    expect(normalized).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);
    // A soft-deleted row is no node of the cluster.
    expect(whereClauseOf(sql)).toContain('"deletedAt" IS NULL');
    expect(params).toEqual(EXPECTED_PARAMS);
    // The very array the DELETE was bound with, unchanged.
    expect(params).toEqual(calls[0]![1]);
  });

  test.each([
    ["no row", "not-found", []],
    [
      "an agent row, Offline",
      "not-native",
      [{ isUp: false, isNativePush: false }],
    ],
    [
      "an agent row, Online — not being native decides first",
      "not-native",
      [{ isUp: true, isNativePush: false }],
    ],
    [
      "a row from before isNativePush (NULL), Offline",
      "not-native",
      [{ isUp: false, isNativePush: null }],
    ],
    [
      "a row from before isNativePush (NULL), state unknown",
      "not-native",
      [{ isUp: null, isNativePush: null }],
    ],
    [
      "a native row, Online",
      "still-reporting",
      [{ isUp: true, isNativePush: true }],
    ],
    [
      "a native row whose state is unknown (NULL)",
      "still-reporting",
      [{ isUp: null, isNativePush: true }],
    ],
    [
      /*
       * The DELETE found it up; a sibling's report marked it Offline
       * before the read. The answer is the DELETE's; trying again
       * removes it.
       */
      "a native row a report turned Offline between the two statements",
      "still-reporting",
      [{ isUp: false, isNativePush: true }],
    ],
  ] as Array<[string, ProxmoxRemoveNodeResult, Array<RemoveReasonRow>]>)(
    "nothing deleted and the read finds %s → %p",
    async (
      _label: string,
      expected: ProxmoxRemoveNodeResult,
      rows: Array<RemoveReasonRow>,
    ) => {
      const { result, calls } = await removeWith([[[], 0], rows]);
      expect(result).toBe(expected);
      expect(calls).toHaveLength(2);
    },
  );

  test.each([[[[], 0]], [{}], [[]], [[[]]], [undefined], [null], [[[], "1"]]])(
    "a DELETE result %p with no positive affected count falls through to the read",
    async (deleteResult: unknown) => {
      const notFound: RemoveCapture = await removeWith([deleteResult, []]);
      expect(notFound.result).toBe("not-found");
      expect(notFound.calls).toHaveLength(2);
      expect(normalizeSql(notFound.calls[1]![0])).toBe(REMOVE_REASON_SQL);

      jest.restoreAllMocks();
      const stillUp: RemoveCapture = await removeWith([
        deleteResult,
        [{ isUp: true, isNativePush: true }],
      ]);
      expect(stillUp.result).toBe("still-reporting");
    },
  );

  test("a failing DELETE rejects, and no read is sent", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockRejectedValueOnce(new Error("connection terminated"));
    jest
      .spyOn(ProxmoxResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);

    await expect(
      ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId: "node/pve2",
      }),
    ).rejects.toThrow("connection terminated");
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a failing read rejects", async () => {
    const query: jest.Mock = jest
      .fn()
      .mockResolvedValueOnce([[], 0])
      .mockRejectedValueOnce(new Error("connection terminated"));
    jest
      .spyOn(ProxmoxResourceService, "getRepository")
      .mockReturnValue({ manager: { query } } as any);

    await expect(
      ProxmoxResourceService.removeOfflineNode({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        externalId: "node/pve2",
      }),
    ).rejects.toThrow("connection terminated");
    expect(query).toHaveBeenCalledTimes(2);
  });
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
 * flags a native batch — each push ending the row's not-reporting mark;
 * their liveness through nextProxmoxNodeLiveness), each native flush runs
 * adoptNodesAsNativePush — bounded by the batch's newest observation
 * (seenUpTo), and leaving the mark and updatedAt as they were — behind the
 * same 10-minute per-cluster fence as the ingest (a Redis failover loses
 * it, and the next flush adopts again), each push asks
 * decideProxmoxSilentNodes — over getNodeRoster, isUp and the mark
 * (notReportingMarkedAt) included, and the time that roster was read, so a
 * node already Offline whose mark was within the monitor window at the
 * read is reported while no node is established — whom to report (the
 * roster read afresh on every push unless a test turns on the ingest's
 * 30-second roster cache, rosterCacheTtlMs), the reports go to
 * markNodesNotReporting with the ingest's markedAt, OneUptime's clock (on
 * every report, or behind the ingest's 30-second fence per cluster and
 * set of nodes, which a Redis failover loses too; the mark is stamped with
 * markedAt and its 60-second refresh runs against markedAt minus 60 s, as
 * the bound $5 and $6 do in Postgres, and a row with no mark is always
 * marked), the cleanup runs deleteStaleForCluster exactly as
 * CleanupStaleResources does, and Remove Node runs removeOfflineNode. The
 * same table takes the agent's scrapes (isNativePush false, nobody
 * reporting on anybody's behalf, nothing adopted) and the rows a release
 * from before isNativePush and notReportingMarkedAt left behind, run
 * through the real migration. The database's now() — which the upsert and
 * the mark stamp updatedAt with, and which nothing reads — is OneUptime's
 * clock unless a test sets it apart (databaseClockSkewMs). Silent-node
 * detection follows the real PVE_NATIVE_NODE_SILENCE_DETECTION: switched
 * off, the pushes keep no liveness and report nobody, as in the ingest,
 * and the service's own prune drops the keep (the adoption, as in the
 * ingest, still runs).
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
  /*
   * When the live nodes last reported the node as not reporting, on
   * OneUptime's clock; NULL until then, and again from its own next push.
   */
  notReportingMarkedAt: Date | null;
  // The database's now() at the row's last write; nothing reads it.
  updatedAt: Date;
}

// A row a node's push writes: its own status, or a guest/storage on it.
interface ModelRider {
  kind: string;
  externalId: string;
  isUp: boolean | null;
}

/*
 * One report a live node made: the siblings it said stopped reporting,
 * and over how many nodes it spread their weight — every node it did not
 * report, itself included (presumed live until reported).
 */
interface ModelReport {
  atMs: number;
  silentNodes: Array<string>;
  reporterCount: number;
}

// One row markNodesNotReporting actually wrote.
interface ModelMark {
  atMs: number;
  externalId: string;
}

// One adoptNodesAsNativePush a native flush ran (past the fence).
interface ModelAdoption {
  atMs: number;
  affected: number;
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
    '"notReportingMarkedAt" = NULL',
    '"updatedAt" = now()',
  ].join(", "),
  'WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"',
].join(" ");

const MODEL_MARK_SQL: string = [
  'UPDATE "ProxmoxResource"',
  'SET "isUp" = false, "uptimeSeconds" = NULL, "isNativePush" = true,',
  '"notReportingMarkedAt" = $5, "updatedAt" = now()',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "externalId" = ANY($3)',
  'AND "deletedAt" IS NULL',
  'AND "lastSeenAt" < $4',
  'AND ("isUp" IS DISTINCT FROM false',
  'OR "isNativePush" IS DISTINCT FROM true',
  'OR "notReportingMarkedAt" IS NULL',
  'OR "notReportingMarkedAt" < $6)',
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
  'SELECT "externalId", "lastSeenAt", "isUp", "notReportingMarkedAt" FROM "ProxmoxResource"',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "deletedAt" IS NULL',
  'AND "lastSeenAt" >= $3',
].join(" ");

const MODEL_ADOPT_SQL: string = [
  'UPDATE "ProxmoxResource"',
  'SET "isNativePush" = true',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "deletedAt" IS NULL',
  'AND "isNativePush" IS DISTINCT FROM true',
  'AND "lastSeenAt" <= $3',
].join(" ");

const MODEL_REMOVE_SQL: string = [
  'DELETE FROM "ProxmoxResource"',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "externalId" = $3',
  'AND "deletedAt" IS NULL',
  'AND "isUp" IS FALSE AND "isNativePush" IS TRUE',
].join(" ");

const MODEL_REMOVE_REASON_SQL: string = [
  'SELECT "isUp", "isNativePush" FROM "ProxmoxResource"',
  'WHERE "projectId" = $1 AND "proxmoxClusterId" = $2',
  'AND "kind" = \'Node\' AND "externalId" = $3',
  'AND "deletedAt" IS NULL',
].join(" ");

/*
 * OtelMetricsIngestService.adoptProxmoxNodesAsNativePush: once per 10
 * minutes per cluster (GlobalCache "proxmox-native-adopt", 600 s).
 */
const ADOPT_FENCE_MS: number = 600 * 1000;

/*
 * OtelMetricsIngestService.markProxmoxSilentNodesOffline: the write is
 * fenced to once per 30 s per cluster and set of nodes (GlobalCache
 * "proxmox-silent-node-mark", 30 s).
 */
const MARK_FENCE_MS: number = 30 * 1000;

/*
 * The mark's rows as markNodesNotReporting writes them for one node that
 * stays silent, reported at each of reportTimes (ascending; a time may
 * repeat — two reporters on one round): the first report writes unless
 * the row is already Offline, native and marked at lastMarkedMs, and then
 * only once that mark is more than 60 s older than the report's markedAt;
 * each later report only once the last mark is. A row with no mark
 * (lastMarkedMs null) is written by the first report whatever else it
 * holds. The 60-second guard, spelled out on the report times (each
 * report's markedAt is its own time, on OneUptime's clock).
 */
function expectedMarkWrites(
  reportTimes: Array<number>,
  lastMarkedMs: number | null,
): Array<number> {
  const writes: Array<number> = [];
  let lastMs: number | null = lastMarkedMs;
  for (const atMs of reportTimes) {
    if (lastMs === null || atMs - lastMs > MARK_REFRESH_MS) {
      writes.push(atMs);
      lastMs = atMs;
    }
  }
  return writes;
}

/*
 * AddProxmoxResourceNativePushColumns1796100000000.up: two nullable
 * columns with no DEFAULT, so every row already in the table reads NULL —
 * not native, never reported down.
 */
const MODEL_ADD_IS_NATIVE_PUSH_SQL: string =
  'ALTER TABLE "ProxmoxResource" ADD "isNativePush" boolean';
const MODEL_ADD_NOT_REPORTING_MARKED_AT_SQL: string =
  'ALTER TABLE "ProxmoxResource" ADD "notReportingMarkedAt" TIMESTAMP WITH TIME ZONE';

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
  /*
   * OneUptime's clock (the markedAt the ingest hands the mark) and the PVE
   * clocks — one clock.
   */
  public clockMs: number;
  /*
   * How far the database's now() — the updatedAt the upsert and the mark
   * stamp — runs ahead of clockMs (behind, when negative). 0: the clocks
   * agree.
   */
  public databaseClockSkewMs: number = 0;
  /*
   * 0 (the default): every push reads the roster afresh, and decides on
   * it as read at its own time — the ingest on a roster-cache miss.
   * PROXMOX_ROSTER_CACHE_TTL_MS: the ingest's in-process cache — a roster
   * read is reused, with the time it was read, by every push until the
   * clock is past the read plus the TTL (InMemoryTTLCache expires an entry
   * once now > set + ttl).
   */
  public rosterCacheTtlMs: number = 0;
  // When a push read the roster (cache misses only), over the whole run.
  public rosterReads: Array<number> = [];
  /*
   * On (the ingest): a push judges the marks' age at the time its roster
   * was read — recordProxmoxNodePushAndFindSilentNodes hands on the cached
   * roster's readAtMs as rosterReadAtMs. Off only for a control run: judged
   * at the push's own time (rosterReadAtMs left out), as before the read
   * time was handed on.
   */
  public judgeMarksAtRosterRead: boolean = true;
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
  /*
   * A native flush adopts the cluster's Node rows, as the ingest does.
   * Off only for a control run: the ingest from before the adoption.
   */
  public adoptOnNativeFlush: boolean = true;
  /*
   * Off (the default): every report goes to markNodesNotReporting — the
   * most chances for the mark to rewrite a row. On: behind the ingest's
   * 30-second fence per cluster and set of nodes, so the mark is
   * refreshed as seldom as the ingest refreshes it.
   */
  public markFenceEnabled: boolean = false;
  // Rows markNodesNotReporting actually wrote, over the whole run.
  public marks: Array<ModelMark> = [];
  public reports: Array<ModelReport> = [];
  // Every adoptNodesAsNativePush a native flush ran, past the fence.
  public adoptions: Array<ModelAdoption> = [];
  // Which prune statement each cleanup ran.
  public prunes: { withNativeKeep: number; plain: number } = {
    withNativeKeep: 0,
    plain: 0,
  };
  private rows: Array<ModelRow> = [];
  private hasIsNativePushColumn: boolean = true;
  private hasNotReportingMarkedAtColumn: boolean = true;
  // The ingest's roster cache: in-process memory, not Redis.
  private rosterCache: {
    roster: Array<ProxmoxRosterNode>;
    readAtMs: number;
  } | null = null;
  // Redis: the liveness keys, the adoption fence and the mark fences.
  private liveness: Map<string, ProxmoxNodeLiveness | null> = new Map();
  private adoptFenceExpiresAtMs: number | null = null;
  private markFenceExpiresAtMs: Map<string, number> = new Map();
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

  // The reports that named this node, in order.
  public reportsOf(nodeName: string): Array<ModelReport> {
    return this.reports.filter((report: ModelReport): boolean => {
      return report.silentNodes.includes(nodeName);
    });
  }

  // The node's liveness key as Redis holds it now (null: none).
  public livenessOf(nodeName: string): ProxmoxNodeLiveness | null {
    return this.liveness.get(nodeName) || null;
  }

  // Whether the node could vouch for its siblings' first reports now.
  public isEstablished(nodeName: string): boolean {
    return isEligibleProxmoxReporter(this.livenessOf(nodeName), this.clockMs);
  }

  /*
   * How old the row's mark — notReportingMarkedAt, stamped with
   * OneUptime's clock — is now on that clock. An Offline row whose mark
   * was no older than the monitor window when the roster was read is
   * reported while no node is established.
   */
  public markAgeMs(externalId: string): number {
    const row: ModelRow | undefined = this.row(externalId);
    expect(row).toBeDefined();
    expect(row!.notReportingMarkedAt).toBeInstanceOf(Date);
    return this.clockMs - row!.notReportingMarkedAt!.getTime();
  }

  /*
   * A Redis failover to an empty replica: every liveness key, the
   * adoption fence and the mark fences are gone. The inventory — the
   * marks included — is untouched.
   */
  public loseRedis(): void {
    this.liveness.clear();
    this.adoptFenceExpiresAtMs = null;
    this.markFenceExpiresAtMs.clear();
  }

  /*
   * A native batch a node pushed at observedAtMs, flushed only now (a
   * backlog): its rows through bulkUpsert, then the adoption — fenced,
   * bounded by the batch's newest observation — exactly as the ingest
   * flush runs them. Its report is beside the point here and left out.
   */
  public async flushLateNativeBatch(
    nodeName: string,
    observedAtMs: number,
  ): Promise<void> {
    expect(observedAtMs).toBeLessThanOrEqual(this.clockMs);
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      resources: [
        modelResource(
          { kind: "Node", externalId: `node/${nodeName}`, isUp: true },
          observedAtMs,
        ),
      ],
      isNativePush: true,
    });
    await this.adoptUnlessFenced(observedAtMs);
  }

  // Remove Node, as the API calls it.
  public async remove(nodeName: string): Promise<ProxmoxRemoveNodeResult> {
    return ProxmoxResourceService.removeOfflineNode({
      projectId: PROJECT_ID,
      proxmoxClusterId: CLUSTER_ID,
      externalId: `node/${nodeName}`,
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
   * The rows a release from before isNativePush and notReportingMarkedAt
   * left behind, last seen now, then the real migration run over them
   * through this model (AddProxmoxResourceNativePushColumns1796100000000
   * .up). Only on a table nothing has written yet.
   */
  public async upgradeFromPreviousRelease(
    previousRows: Array<ModelRider>,
  ): Promise<void> {
    expect(this.rows).toHaveLength(0);
    this.hasIsNativePushColumn = false;
    this.hasNotReportingMarkedAtColumn = false;
    for (const rider of previousRows) {
      this.rows.push({
        projectId: PROJECT_ID.toString(),
        proxmoxClusterId: CLUSTER_ID.toString(),
        kind: rider.kind,
        externalId: rider.externalId,
        isUp: rider.isUp,
        uptimeSeconds: rider.isUp ? 3600 : null,
        lastSeenAt: this.now(),
        // Not columns yet — the migration decides what they read.
        isNativePush: null,
        notReportingMarkedAt: null,
        // Written by that release's upsert, on the database clock.
        updatedAt: this.databaseNow(),
      });
    }

    const queryRunner: QueryRunner = {
      query: async (sql: string): Promise<unknown> => {
        return this.execute(sql, []);
      },
    } as unknown as QueryRunner;
    await new AddProxmoxResourceNativePushColumns1796100000000().up(
      queryRunner,
    );
    expect(this.hasIsNativePushColumn).toBe(true);
    expect(this.hasNotReportingMarkedAtColumn).toBe(true);
  }

  /*
   * Each node's status push, processed now, as the ingest does it: its
   * liveness, its inventory rows, the adoption (a native flush only,
   * fenced), and — through the real decision over the real roster — its
   * report on the siblings that went quiet, and the mark. (The ingest
   * fences the mark to once per 30 s per set of nodes; unless
   * markFenceEnabled, marking on every report only refreshes the mark
   * more often — every 70 s instead of up to every 90 s.)
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

      /*
       * Right after the upsert of a native batch (countsFromInventory),
       * bounded by the batch's newest observation.
       */
      if (this.isNativePushArg === true && this.adoptOnNativeFlush) {
        const seenUpToMs: number = Math.max(
          ...resources.map((resource: ParsedProxmoxResource): number => {
            return resource.lastSeenAt.getTime();
          }),
        );
        await this.adoptUnlessFenced(seenUpToMs);
      }

      if (!reporting) {
        continue;
      }
      const { roster, readAtMs } = await this.readRoster(nowMs);
      // recordProxmoxNodePushAndFindSilentNodes returns before a lone row.
      const hasSibling: boolean = roster.some(
        (node: ProxmoxRosterNode): boolean => {
          return node.nodeName !== nodeName;
        },
      );
      if (!hasSibling) {
        continue;
      }
      /*
       * The marks' age is taken when the roster was read, as
       * recordProxmoxNodePushAndFindSilentNodes hands it on.
       */
      const decision: ProxmoxSilentNodeDecision | null =
        decideProxmoxSilentNodes({
          selfNode: nodeName,
          reporterTimeMs: nowMs,
          nowMs,
          roster,
          liveness: this.liveness,
          rosterReadAtMs: this.judgeMarksAtRosterRead ? readAtMs : undefined,
        });
      if (!decision) {
        continue;
      }
      this.reports.push({
        atMs: nowMs,
        silentNodes: decision.silentNodes,
        reporterCount: decision.reporterCount,
      });
      if (!this.acquireMarkFence(decision.silentNodes)) {
        continue;
      }
      // markedAt: OneUptime's clock, as the ingest passes it.
      await ProxmoxResourceService.markNodesNotReporting({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        nodeNames: decision.silentNodes,
        silentBefore: new Date(nowMs - PROXMOX_NODE_SILENCE_MS),
        markedAt: new Date(nowMs),
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

  /*
   * The roster a push at nowMs decides on, and when it was read: afresh
   * with the cache off; with it on, the cached one while nowMs is within
   * the TTL of its read (InMemoryTTLCache: expired once now > set + ttl).
   */
  private async readRoster(
    nowMs: number,
  ): Promise<{ roster: Array<ProxmoxRosterNode>; readAtMs: number }> {
    if (
      this.rosterCacheTtlMs > 0 &&
      this.rosterCache &&
      nowMs <= this.rosterCache.readAtMs + this.rosterCacheTtlMs
    ) {
      return this.rosterCache;
    }
    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
      });
    this.rosterReads.push(nowMs);
    this.rosterCache = { roster, readAtMs: nowMs };
    return this.rosterCache;
  }

  // The database's now(): the updatedAt the upsert and the mark stamp.
  private databaseNow(): Date {
    return new Date(this.clockMs + this.databaseClockSkewMs);
  }

  /*
   * GlobalCache.setStringIfNotExists("proxmox-native-adopt", cluster,
   * "1", { expiresInSeconds: 600 }): the first native flush in 10
   * minutes adopts — the rows seen up to its batch's newest observation;
   * the rest skip it.
   */
  private async adoptUnlessFenced(seenUpToMs: number): Promise<void> {
    if (
      this.adoptFenceExpiresAtMs !== null &&
      this.clockMs < this.adoptFenceExpiresAtMs
    ) {
      return;
    }
    this.adoptFenceExpiresAtMs = this.clockMs + ADOPT_FENCE_MS;
    const affected: number =
      await ProxmoxResourceService.adoptNodesAsNativePush({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        seenUpTo: new Date(seenUpToMs),
      });
    this.adoptions.push({ atMs: this.clockMs, affected });
  }

  /*
   * GlobalCache.setStringIfNotExists("proxmox-silent-node-mark",
   * `${cluster}:${sha1(sorted names)}`, "1", { expiresInSeconds: 30 }),
   * when markFenceEnabled; otherwise every report marks.
   */
  private acquireMarkFence(nodeNames: Array<string>): boolean {
    if (!this.markFenceEnabled) {
      return true;
    }
    const key: string = [...nodeNames].sort().join("\n");
    const expiresAtMs: number | undefined = this.markFenceExpiresAtMs.get(key);
    if (expiresAtMs !== undefined && this.clockMs < expiresAtMs) {
      return false;
    }
    this.markFenceExpiresAtMs.set(key, this.clockMs + MARK_FENCE_MS);
    return true;
  }

  private execute(sql: string, params: Array<unknown>): unknown {
    const statement: string = normalizeSql(sql);
    if (statement.startsWith('INSERT INTO "ProxmoxResource"')) {
      return this.executeUpsert(statement, params);
    }
    if (statement === MODEL_MARK_SQL) {
      return this.executeMark(params);
    }
    if (statement === MODEL_ADOPT_SQL) {
      return this.executeAdopt(params);
    }
    if (statement === MODEL_REMOVE_SQL) {
      return this.executeRemove(params);
    }
    if (statement === MODEL_REMOVE_REASON_SQL) {
      return this.executeRemoveReason(params);
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
    if (statement === MODEL_ADD_NOT_REPORTING_MARKED_AT_SQL) {
      return this.executeAddNotReportingMarkedAt();
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
    expect(this.hasNotReportingMarkedAtColumn).toBe(true);
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
        // Not in the INSERT: a new row starts with no mark.
        notReportingMarkedAt: null,
        // "updatedAt" = now() — the database's clock.
        updatedAt: this.databaseNow(),
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
      // "notReportingMarkedAt" = NULL — a real observation ends the mark.
      existing.notReportingMarkedAt = null;
      existing.updatedAt = this.databaseNow();
    }
    return [];
  }

  private executeMark(params: Array<unknown>): Array<unknown> {
    expect(this.hasIsNativePushColumn).toBe(true);
    expect(this.hasNotReportingMarkedAtColumn).toBe(true);
    expect(params).toHaveLength(6);
    const [
      projectId,
      proxmoxClusterId,
      externalIds,
      silentBefore,
      markedAt,
      refreshBefore,
    ] = params as [string, string, Array<string>, Date, Date, Date];
    expect(markedAt).toBeInstanceOf(Date);
    expect(refreshBefore).toBeInstanceOf(Date);
    let affected: number = 0;
    for (const row of this.rows) {
      const matches: boolean =
        row.projectId === projectId &&
        row.proxmoxClusterId === proxmoxClusterId &&
        row.kind === "Node" &&
        externalIds.includes(row.externalId) &&
        row.lastSeenAt.getTime() < silentBefore.getTime() &&
        /*
         * ("isUp" IS DISTINCT FROM false OR "isNativePush" IS DISTINCT
         * FROM true OR "notReportingMarkedAt" IS NULL OR
         * "notReportingMarkedAt" < $6) — updatedAt plays no part.
         */
        (row.isUp !== false ||
          row.isNativePush !== true ||
          row.notReportingMarkedAt === null ||
          row.notReportingMarkedAt.getTime() < refreshBefore.getTime());
      if (!matches) {
        continue;
      }
      row.isUp = false;
      row.uptimeSeconds = null;
      row.isNativePush = true;
      // "notReportingMarkedAt" = $5 — the caller's markedAt.
      row.notReportingMarkedAt = new Date(markedAt.getTime());
      // "updatedAt" = now() — the database's clock, read by nothing.
      row.updatedAt = this.databaseNow();
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
    expect(this.hasNotReportingMarkedAtColumn).toBe(true);
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
        return {
          externalId: row.externalId,
          lastSeenAt: row.lastSeenAt,
          isUp: row.isUp,
          // A timestamptz comes back as a Date, a copy of the stored value.
          notReportingMarkedAt: row.notReportingMarkedAt
            ? new Date(row.notReportingMarkedAt.getTime())
            : null,
        };
      });
  }

  private executeAdopt(params: Array<unknown>): Array<unknown> {
    expect(this.hasIsNativePushColumn).toBe(true);
    expect(params).toHaveLength(3);
    const [projectId, proxmoxClusterId, seenUpTo] = params as [
      string,
      string,
      Date,
    ];
    expect(seenUpTo).toBeInstanceOf(Date);
    let affected: number = 0;
    for (const row of this.rows) {
      const matches: boolean =
        row.projectId === projectId &&
        row.proxmoxClusterId === proxmoxClusterId &&
        row.kind === "Node" &&
        // "isNativePush" IS DISTINCT FROM true — false and NULL alike.
        row.isNativePush !== true &&
        // "lastSeenAt" <= $3 — never a row newer than the batch.
        row.lastSeenAt.getTime() <= seenUpTo.getTime();
      if (!matches) {
        continue;
      }
      /*
       * isUp, uptimeSeconds and lastSeenAt stay the node's own, the mark
       * stays as it was (NULL on an agent-era row), and updatedAt stays
       * when the row was last written — adopting is no report.
       */
      row.isNativePush = true;
      affected++;
    }
    return [[], affected];
  }

  // The rows removeOfflineNode's two statements address.
  private removeTargets(params: Array<unknown>): Array<ModelRow> {
    expect(params).toHaveLength(3);
    const [projectId, proxmoxClusterId, externalId] = params as [
      string,
      string,
      string,
    ];
    return this.rows.filter((row: ModelRow): boolean => {
      return (
        row.projectId === projectId &&
        row.proxmoxClusterId === proxmoxClusterId &&
        row.kind === "Node" &&
        row.externalId === externalId
      );
    });
  }

  private executeRemove(params: Array<unknown>): Array<unknown> {
    // "deletedAt" IS NULL holds for every row here.
    const doomed: Array<ModelRow> = this.removeTargets(params).filter(
      (row: ModelRow): boolean => {
        // "isUp" IS FALSE AND "isNativePush" IS TRUE — NULL is neither.
        return row.isUp === false && row.isNativePush === true;
      },
    );
    this.rows = this.rows.filter((row: ModelRow): boolean => {
      return !doomed.includes(row);
    });
    return [[], doomed.length];
  }

  private executeRemoveReason(params: Array<unknown>): Array<RemoveReasonRow> {
    return this.removeTargets(params).map((row: ModelRow): RemoveReasonRow => {
      return { isUp: row.isUp, isNativePush: row.isNativePush };
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

  private executeAddNotReportingMarkedAt(): Array<unknown> {
    expect(this.hasNotReportingMarkedAtColumn).toBe(false);
    this.hasNotReportingMarkedAtColumn = true;
    // No DEFAULT: no existing row was ever reported down.
    for (const row of this.rows) {
      row.notReportingMarkedAt = null;
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
 * for the silence window. The database clock runs databaseClockSkewMs
 * off OneUptime's throughout (0: they agree).
 */
async function clusterWithDeadPve2(
  databaseClockSkewMs: number = 0,
): Promise<DeadNodeCluster> {
  const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
    MODEL_T0_MS,
  );
  cluster.databaseClockSkewMs = databaseClockSkewMs;
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

  test("is marked Offline by the first report, then rewritten at most once a minute however often it is reported — lastSeenAt untouched, still flagged native", async () => {
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
    // The mark: the report's markedAt, OneUptime's clock.
    expect(pve2.notReportingMarkedAt!.getTime()).toBe(markedAtMs);
    // Its updatedAt: the database's now(), on the same clock here.
    expect(pve2.updatedAt.getTime()).toBe(markedAtMs);
    // No other row is marked: pve1's and pve3's pushes leave theirs NULL.
    for (const externalId of ["node/pve1", "node/pve3", ...PVE2_RIDER_IDS]) {
      expect(cluster.row(externalId)!.notReportingMarkedAt).toBeNull();
    }

    /*
     * Both live nodes report it on every push — 12 reports in the setup's
     * last minute — and only the first wrote: the row is Offline, native
     * and marked less than a minute ago.
     */
    expect(cluster.reports).toHaveLength(
      2 * ((cluster.clockMs - markedAtMs) / PUSH_INTERVAL_MS + 1),
    );
    for (const report of cluster.reports) {
      expect(report.silentNodes).toEqual(["pve2"]);
      expect(report.atMs).toBeGreaterThanOrEqual(markedAtMs);
    }
    expect(cluster.marks).toEqual([
      { atMs: markedAtMs, externalId: "node/pve2" },
    ]);

    /*
     * Five minutes more: a mark is written again on the first report more
     * than 60 s after the last one — every 70 s at a push every 10 s —
     * and never on the reports between. That write is what keeps the mark
     * fresh for the reports that carry on while no node is established.
     */
    const reportsBefore: number = cluster.reports.length;
    const markAges: Array<number> = [];
    await cluster.pushFor(
      ["pve1", "pve3"],
      5 * MINUTE_MS,
      async (): Promise<void> => {
        markAges.push(cluster.markAgeMs("node/pve2"));
      },
    );
    const refreshStepMs: number = MARK_REFRESH_MS + PUSH_INTERVAL_MS;
    // The setup ended 50 s after the mark: refreshes at +70 s ... +350 s.
    expect(cluster.clockMs).toBe(markedAtMs + 50 * 1000 + 5 * MINUTE_MS);
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      markedAtMs + refreshStepMs,
      markedAtMs + 2 * refreshStepMs,
      markedAtMs + 3 * refreshStepMs,
      markedAtMs + 4 * refreshStepMs,
      markedAtMs + 5 * refreshStepMs,
    ]);
    expect(cluster.reports.length - reportsBefore).toBe(
      2 * ((5 * MINUTE_MS) / PUSH_INTERVAL_MS),
    );
    // After every round the mark is at most a minute old.
    expect(Math.max(...markAges)).toBe(MARK_REFRESH_MS);
    const refreshed: ModelRow = cluster.row("node/pve2")!;
    expect(refreshed.notReportingMarkedAt!.getTime()).toBe(
      markedAtMs + 5 * refreshStepMs,
    );
    expect(refreshed.isUp).toBe(false);
    expect(refreshed.uptimeSeconds).toBeNull();
    expect(refreshed.isNativePush).toBe(true);
    // The refresh never moves the node's own last push — its retention clock.
    expect(refreshed.lastSeenAt.getTime()).toBe(pve2LastPushMs);

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
    "marked before a %s OneUptime outage, it survives the outage and the warm-up after it, with nothing refreshing its row — and is reported again, its mark refreshed, once a node is established",
    async (_label: string, outageMs: number) => {
      const { cluster, pve2LastPushMs, markedAtMs } =
        await clusterWithDeadPve2();

      cluster.advance(outageMs);
      const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
      /*
       * Longer than the monitor window: pve2's mark has aged out of it by
       * the first roster read after the outage.
       */
      expect(outageMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      expect(backAtMs - markedAtMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
      const reportsBeforeOutage: number = cluster.reports.length;
      const tally: { cleanupsPastMark: number } = {
        cleanupsPastMark: 0,
      };

      /*
       * OneUptime is back: the nodes still alive push again. None is
       * established for two minutes, and pve2's mark is older than the
       * monitor window — the window holds nothing from before the outage
       * and pve2's incidents have resolved already — so nothing carries
       * on: pve2, Offline all along, is reported again only once a node is
       * established. The cleanup runs after every round — far more often
       * than its five-minute cron.
       */
      const warmUp: { unestablishedRounds: number } = {
        unestablishedRounds: 0,
      };
      await cluster.pushFor(
        ["pve1", "pve3"],
        3 * MINUTE_MS,
        async (): Promise<void> => {
          if (
            !cluster.isEstablished("pve1") &&
            !cluster.isEstablished("pve3")
          ) {
            warmUp.unestablishedRounds++;
          }
          const olderThan: Date = await cluster.cleanup();
          const pve2: ModelRow | undefined = cluster.row("node/pve2");
          expect(pve2).toBeDefined();
          if (pve2!.notReportingMarkedAt!.getTime() < olderThan.getTime()) {
            tally.cleanupsPastMark++;
          }
        },
      );

      // The two minutes with no node established reported nothing…
      expect(warmUp.unestablishedRounds).toBe(
        PROXMOX_NODE_SILENCE_MS / PUSH_INTERVAL_MS,
      );
      /*
       * …then pve1, established first, and pve3 with it, on every push
       * since — each report weighing pve2 over the two nodes it does not
       * name (L = nodes not reported).
       */
      const reportsBack: Array<ModelReport> =
        cluster.reports.slice(reportsBeforeOutage);
      expect(reportsBack[0]).toEqual({
        atMs: establishedAtMs,
        silentNodes: ["pve2"],
        reporterCount: 2,
      });
      expect(reportsBack).toHaveLength(
        2 * ((3 * MINUTE_MS - PROXMOX_NODE_SILENCE_MS) / PUSH_INTERVAL_MS),
      );
      for (const report of reportsBack) {
        expect(report.atMs).toBeGreaterThanOrEqual(establishedAtMs);
        expect(report.silentNodes).toEqual(["pve2"]);
        expect(report.reporterCount).toBe(2);
      }
      /*
       * Nothing wrote the row through the outage and the warm-up; the
       * first report after it found the mark more than a minute old and
       * refreshed it (pve3's, on the same round, did not), and the minute
       * since holds no further refresh.
       */
      expect(cluster.clockMs - establishedAtMs).toBeLessThanOrEqual(
        MARK_REFRESH_MS,
      );
      expect(cluster.marksOf("node/pve2")).toEqual([
        markedAtMs,
        establishedAtMs,
      ]);
      // A keep that needed a recent mark would have lost it here.
      expect(tally.cleanupsPastMark).toBeGreaterThan(0);

      const pve2: ModelRow = cluster.row("node/pve2")!;
      expect(pve2.isUp).toBe(false);
      expect(pve2.lastSeenAt.getTime()).toBe(pve2LastPushMs);
      expect(pve2.isNativePush).toBe(true);
      expect(pve2.notReportingMarkedAt!.getTime()).toBe(establishedAtMs);

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

  test("marked before an outage shorter than the monitor window, it is reported from the first push after it by every live node — each over the two nodes not reported, the sibling not processed yet included", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();

    /*
     * Two minutes out: pve2's mark, three minutes old on the first push
     * back, is within the monitor window, so the reports of pve2, Offline
     * already, carry on from the first push — and that report refreshes
     * the mark, as does one a minute through the rest of the warm-up.
     */
    cluster.advance(2 * MINUTE_MS);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    expect(backAtMs - markedAtMs).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    const reportsBefore: number = cluster.reports.length;
    const warmUp: { unestablishedRounds: number; maxMarkAgeMs: number } = {
      unestablishedRounds: 0,
      maxMarkAgeMs: 0,
    };
    await cluster.pushFor(
      ["pve1", "pve3"],
      3 * MINUTE_MS,
      async (): Promise<void> => {
        if (!cluster.isEstablished("pve1") && !cluster.isEstablished("pve3")) {
          warmUp.unestablishedRounds++;
          warmUp.maxMarkAgeMs = Math.max(
            warmUp.maxMarkAgeMs,
            cluster.markAgeMs("node/pve2"),
          );
        }
      },
    );
    expect(warmUp.unestablishedRounds).toBe(
      PROXMOX_NODE_SILENCE_MS / PUSH_INTERVAL_MS,
    );
    // After each round of the warm-up the mark was at most a minute old.
    expect(warmUp.maxMarkAgeMs).toBe(MARK_REFRESH_MS);

    /*
     * pve1 reports first, before pve3's own first push after the outage
     * is processed (pve3 has no live key then): pve3 is not reported, so
     * it is presumed live and pve1's report weighs pve2 over two nodes,
     * not one — never handing pve1 all of pve2's weight.
     */
    const reportsBack: Array<ModelReport> =
      cluster.reports.slice(reportsBefore);
    expect(reportsBack).toHaveLength(2 * ((3 * MINUTE_MS) / PUSH_INTERVAL_MS));
    expect(cluster.livenessOf("pve3")!.streakStartMs).toBe(backAtMs);
    reportsBack.forEach((report: ModelReport, index: number): void => {
      expect(report).toEqual({
        atMs: backAtMs + Math.floor(index / 2) * PUSH_INTERVAL_MS,
        silentNodes: ["pve2"],
        reporterCount: 2,
      });
    });
    /*
     * Offline all along: the first push back rewrote only the mark, and
     * the reports since once every 70 s — never the node's own columns.
     */
    const refreshStepMs: number = MARK_REFRESH_MS + PUSH_INTERVAL_MS;
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      backAtMs,
      backAtMs + refreshStepMs,
      backAtMs + 2 * refreshStepMs,
    ]);
    expect(
      expectedMarkWrites(
        reportsBack.map((report: ModelReport): number => {
          return report.atMs;
        }),
        markedAtMs,
      ),
    ).toEqual(cluster.marksOf("node/pve2").slice(1));
    expect(cluster.row("node/pve2")).toEqual(
      expect.objectContaining({ isUp: false, isNativePush: true }),
    );
  });

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
      /*
       * Its mark: the first report, then — the pushes back after the skip,
       * the mark long out of the monitor window, so nothing before a node
       * is established — the first established report and a refresh a
       * minute until the last report. Never after it left the roster.
       */
      const backAtMs: number =
        retentionEndMs - 5 * MINUTE_MS + PUSH_INTERVAL_MS;
      const reportsAfterSkip: Array<number> = cluster
        .reportTimesOf("pve2")
        .filter((atMs: number): boolean => {
          return atMs >= backAtMs;
        });
      expect(reportsAfterSkip[0]).toBe(backAtMs + PROXMOX_NODE_SILENCE_MS);
      const marks: Array<number> = cluster.marksOf("node/pve2");
      // The setup's mark, long out of the monitor window by then.
      expect(backAtMs - marks[0]!).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      expect(marks.slice(1)).toEqual(
        expectedMarkWrites(reportsAfterSkip, marks[0]!),
      );
      expect(marks.slice(1)).toEqual([
        backAtMs + PROXMOX_NODE_SILENCE_MS,
        backAtMs + PROXMOX_NODE_SILENCE_MS + MARK_REFRESH_MS + PUSH_INTERVAL_MS,
        backAtMs +
          PROXMOX_NODE_SILENCE_MS +
          2 * (MARK_REFRESH_MS + PUSH_INTERVAL_MS),
      ]);
      expect(Math.max(...marks)).toBeLessThanOrEqual(retentionEndMs);
      // Only pve2's row was ever marked.
      expect(cluster.marks).toHaveLength(marks.length);
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

    // pve2 comes back: a real, newer observation — which ends the mark.
    await cluster.pushFor(ALL_NODES, MINUTE_MS);
    const back: ModelRow = cluster.row("node/pve2")!;
    expect(back.isUp).toBe(true);
    expect(back.isNativePush).toBe(true);
    expect(back.lastSeenAt.getTime()).toBe(cluster.clockMs);
    expect(back.notReportingMarkedAt).toBeNull();
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
        expect(pve2!.notReportingMarkedAt).toBeNull();
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
    // Its own pushes ended the first mark.
    expect(cluster.row("node/pve2")!.notReportingMarkedAt).toBeNull();
    await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(false);
    expect(pve2.lastSeenAt.getTime()).toBe(secondLastPushMs);
    expect(pve2.isNativePush).toBe(true);
    const remarkedAtMs: number =
      secondLastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS;
    expect(cluster.marksOf("node/pve2")).toEqual([markedAtMs, remarkedAtMs]);
    expect(pve2.notReportingMarkedAt!.getTime()).toBe(remarkedAtMs);
  });

  test("an out-of-order batch older than its last push never flips it back up, nor off the native push, nor ends its mark", async () => {
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
    // The guard skipped the whole DO UPDATE: the mark and updatedAt stand.
    expect(pve2.notReportingMarkedAt!.getTime()).toBe(markedAtMs);
    expect(pve2.updatedAt.getTime()).toBe(markedAtMs);
  });

  test("a replay of its last push (the same lastSeenAt) re-applies isUp = true and ends the mark, but never drops the row — the next report marks it again", async () => {
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

    /*
     * The guard is >=: an equal lastSeenAt passes, isUp is re-applied and
     * the mark ends…
     */
    const replayed: ModelRow = cluster.row("node/pve2")!;
    expect(replayed.isUp).toBe(true);
    expect(replayed.lastSeenAt.getTime()).toBe(pve2LastPushMs);
    expect(replayed.isNativePush).toBe(true);
    expect(replayed.notReportingMarkedAt).toBeNull();
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

    /*
     * The very next report finds it up and marks it Offline again; the
     * reports after refresh that mark once a minute.
     */
    const marks: Array<number> = cluster.marksOf("node/pve2");
    expect(marks.slice(0, 2)).toEqual([
      markedAtMs,
      replayedAtMs + PUSH_INTERVAL_MS,
    ]);
    expect(marks.slice(1)).toEqual(
      expectedMarkWrites(
        cluster.reportTimesOf("pve2").filter((atMs: number): boolean => {
          return atMs > replayedAtMs;
        }),
        null,
      ),
    );
    expect(marks).toHaveLength(
      2 +
        Math.floor(
          (20 * MINUTE_MS - PUSH_INTERVAL_MS) /
            (MARK_REFRESH_MS + PUSH_INTERVAL_MS),
        ),
    );
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
          // Still the Offline, native row the mark left, marked as it was.
          expect(pve2.isUp).toBe(false);
          expect(pve2.isNativePush).toBe(true);
          expect(pve2.notReportingMarkedAt!.getTime()).toBe(markedAtMs);
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

  test("an Offline node the agent last listed, on a cluster moved to the native push, is never reported: adopted as a native row, it is still pruned at the normal cutoff", async () => {
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
    expect(cluster.row("node/pve9")!.isNativePush).toBe(false);

    cluster.carry("pve1", []);
    cluster.isNativePushArg = true;
    cluster.reportsEnabled = true;
    const firstNativeFlushMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        const pve9: ModelRow | undefined = cluster.row("node/pve9");
        if (pve9) {
          expect(pve9.isUp).toBe(false);
          /*
           * The ingest adopts on every native flush, detection or not —
           * with detection off the plain prune never reads the flag. The
           * adoption writes the flag alone: no mark, and updatedAt is still
           * the agent's last write.
           */
          expect(pve9.isNativePush).toBe(true);
          expect(pve9.notReportingMarkedAt).toBeNull();
          expect(pve9.updatedAt.getTime()).toBe(pve9LastSeenMs);
        } else if (seen.deletedAtMs === null) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );

    // pve9 and pve3's agent row, on pve1's first native flush.
    expect(cluster.adoptions[0]).toEqual({
      atMs: firstNativeFlushMs,
      affected: 2,
    });
    expect(cluster.reports).toEqual([]);
    expect(cluster.marks).toEqual([]);
    expect(seen.deletedAtMs).toBe(
      pve9LastSeenMs + staleThresholdMs() + PUSH_INTERVAL_MS,
    );
    expect(cluster.prunes.withNativeKeep).toBe(0);
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
            // Listed Offline by the agent: no report, so no mark.
            expect(pve9.notReportingMarkedAt).toBeNull();
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
      expect(cluster.row(externalId)!.notReportingMarkedAt).toBeNull();
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

  test("moved from the native push to the agent: a native batch flushed late, past the adoption fence, adopts none of the agent's newer rows — the node the agent lists Offline stays the agent's and is pruned at the normal cutoff", async () => {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    await cluster.push(ALL_NODES);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);
    const lastNativePushMs: number = cluster.clockMs;
    expect(cluster.adoptions).toEqual([{ atMs: MODEL_T0_MS, affected: 0 }]);

    /*
     * Moved to the Proxmox Agent, which lists pve2 — down now — as
     * Offline, for longer than the adoption fence lasts.
     */
    cluster.isNativePushArg = false;
    cluster.reportsEnabled = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve2", isUp: false },
    ]);
    await cluster.pushFor(["pve1", "pve3"], ADOPT_FENCE_MS + MINUTE_MS);
    const pve2LastListedMs: number = cluster.clockMs;
    for (const nodeName of ALL_NODES) {
      expect(cluster.row(`node/${nodeName}`)).toEqual(
        expect.objectContaining({
          isUp: nodeName !== "pve2",
          isNativePush: false,
        }),
      );
    }

    /*
     * pve1's last native batch, from before the move, is flushed only
     * now. Its upsert is ignored (older than the agent's rows); its
     * adoption runs — the fence has lapsed — bounded by the batch's own
     * observation, and every row the agent wrote is newer.
     */
    const adoptionsBefore: number = cluster.adoptions.length;
    await cluster.flushLateNativeBatch("pve1", lastNativePushMs);
    expect(cluster.adoptions.slice(adoptionsBefore)).toEqual([
      { atMs: cluster.clockMs, affected: 0 },
    ]);
    for (const nodeName of ALL_NODES) {
      const row: ModelRow = cluster.row(`node/${nodeName}`)!;
      expect(row.isNativePush).toBe(false);
      expect(row.lastSeenAt.getTime()).toBe(pve2LastListedMs);
      expect(row.lastSeenAt.getTime()).toBeGreaterThan(lastNativePushMs);
    }

    // The agent's node: Remove Node leaves it to the agent…
    expect(await cluster.remove("pve2")).toBe("not-native");

    // …which stops listing it: pruned at the normal cutoff, never kept.
    cluster.carry("pve1", []);
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
      pve2LastListedMs + staleThresholdMs() + PUSH_INTERVAL_MS,
    );
    expect(cluster.marks).toEqual([]);
    expect(cluster.reports).toEqual([]);
  });

  test("a native batch flushed late adopts the agent's rows last seen up to its own observation, and none after it", async () => {
    // The agent lists pve1, pve3 and pve9 (Offline), then stops.
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.isNativePushArg = false;
    cluster.reportsEnabled = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve9", isUp: false },
    ]);
    await cluster.push(["pve1", "pve3"]);
    const olderScrapeMs: number = cluster.clockMs;
    // A minute later the agent lists pve1 and pve3 again, pve9 no more.
    cluster.carry("pve1", []);
    cluster.advance(MINUTE_MS);
    await cluster.push(["pve1", "pve3"]);

    /*
     * pve3's native batch observed at the older scrape's instant: pve9,
     * last seen then, is taken (the bound is inclusive); pve1 and pve3,
     * seen a minute after, are not.
     */
    await cluster.flushLateNativeBatch("pve3", olderScrapeMs);
    expect(cluster.adoptions).toEqual([{ atMs: cluster.clockMs, affected: 1 }]);
    expect(cluster.row("node/pve9")).toEqual(
      expect.objectContaining({
        isUp: false,
        isNativePush: true,
        lastSeenAt: new Date(olderScrapeMs),
      }),
    );
    for (const nodeName of ["pve1", "pve3"]) {
      expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(false);
    }
  });
});

/*
 * A node the native pushes report is a member of a native-push cluster,
 * whatever wrote its row last. The first native flush adopts every Node
 * row of the cluster (and the mark flags a row native too), so from then
 * on it is kept — and reported — like any other native node until its
 * own last report falls behind the retention cutoff, instead of being
 * pruned at the normal cutoff while it is still down and still being
 * reported.
 */
describe("ProxmoxResourceService inventory model — a reported node the native push did not write last", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  test("moved from the agent to the native push: an Offline node the agent last listed is adopted by the first native flush, reported, and kept until the retention cutoff — as it leaves the roster", async () => {
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
    const firstNativeFlushMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    /*
     * The first push after pve9 has been quiet for the silence window —
     * which is also when pve1 and pve3 are established again.
     */
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
        // A native row from the first native flush — before any report.
        expect(pve9!.isNativePush).toBe(true);
        if (cluster.clockMs < firstReportMs) {
          // Adopted, not reported: unmarked, still the agent's last write.
          expect(pve9!.notReportingMarkedAt).toBeNull();
          expect(pve9!.updatedAt.getTime()).toBe(pve9LastSeenMs);
        }
        if (pve9!.lastSeenAt.getTime() < olderThan.getTime()) {
          tally.keptPastNormalCutoff++;
        }
      },
    );

    // pve9 and pve3's agent row, on pve1's first native flush.
    expect(cluster.adoptions[0]).toEqual({
      atMs: firstNativeFlushMs,
      affected: 2,
    });
    // Reported from the first push past its silence, and on every push since…
    const reportTimes: Array<number> = cluster.reportTimesOf("pve9");
    expect(reportTimes[0]).toBe(firstReportMs);
    expect(Math.max(...reportTimes)).toBe(cluster.clockMs);
    /*
     * …its row Offline already and adopted before the first report, but
     * with no mark — the agent never reports a node as not reporting, and
     * the adoption writes no mark — so the first report marks it, and the
     * mark is refreshed once a minute since…
     */
    const marksWhileReported: Array<number> = cluster.marksOf("node/pve9");
    expect(marksWhileReported[0]).toBe(firstReportMs);
    expect(marksWhileReported).toEqual(expectedMarkWrites(reportTimes, null));
    expect(cluster.marks).toHaveLength(marksWhileReported.length);
    const pve9: ModelRow = cluster.row("node/pve9")!;
    expect(pve9.isUp).toBe(false);
    expect(pve9.uptimeSeconds).toBeNull();
    expect(pve9.isNativePush).toBe(true);
    expect(pve9.lastSeenAt.getTime()).toBe(pve9LastSeenMs);
    expect(pve9.notReportingMarkedAt!.getTime()).toBe(
      marksWhileReported[marksWhileReported.length - 1]!,
    );
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
    /*
     * After the skip the mark was long out of the monitor window: nothing
     * before a node was established again, then a mark a minute until the
     * last report — none once it left the roster.
     */
    const backAtMs: number = retentionEndMs - 5 * MINUTE_MS + PUSH_INTERVAL_MS;
    const reportsAfterSkip: Array<number> = cluster
      .reportTimesOf("pve9")
      .filter((atMs: number): boolean => {
        return atMs >= backAtMs;
      });
    expect(reportsAfterSkip[0]).toBe(backAtMs + PROXMOX_NODE_SILENCE_MS);
    expect(cluster.marksOf("node/pve9")).toEqual([
      ...marksWhileReported,
      ...expectedMarkWrites(
        reportsAfterSkip,
        marksWhileReported[marksWhileReported.length - 1]!,
      ),
    ]);
    expect(Math.max(...cluster.marksOf("node/pve9"))).toBeLessThanOrEqual(
      retentionEndMs,
    );
    // Every later adoption found nothing left to adopt.
    for (const adoption of cluster.adoptions.slice(1)) {
      expect(adoption.affected).toBe(0);
    }
    expect(cluster.adoptions.length).toBeGreaterThan(1);
    for (const nodeName of ["pve1", "pve3"]) {
      expect(cluster.row(`node/${nodeName}`)!.isNativePush).toBe(true);
    }
  });

  test.each([
    ["whose last push said it was up", true],
    ["that the agent last listed Offline", false],
  ] as Array<[string, boolean]>)(
    "upgraded from a release before isNativePush and notReportingMarkedAt, a node %s and dead since is adopted by the first native flush, reported, and kept past the normal cutoff",
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
        expect(
          cluster.row(`node/${nodeName}`)!.notReportingMarkedAt,
        ).toBeNull();
      }

      // pve1 and pve3 push natively after the upgrade; pve2 never again.
      const firstNativeFlushMs: number = upgradedAtMs + PUSH_INTERVAL_MS;
      /*
       * Silent for the silence window, and pve1 and pve3 established,
       * on the same push: Offline or not, it is first reported then.
       */
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
          // Adopted by the first native flush, before any report.
          expect(pve2!.isNativePush).toBe(true);
          expect(pve2!.isUp).toBe(
            cluster.clockMs < firstReportMs ? isUpBefore : false,
          );
          if (cluster.clockMs < firstReportMs) {
            // Adopted, not reported: unmarked, the old release's last write.
            expect(pve2!.notReportingMarkedAt).toBeNull();
            expect(pve2!.updatedAt.getTime()).toBe(upgradedAtMs);
          }
          if (pve2!.lastSeenAt.getTime() < olderThan.getTime()) {
            tally.keptPastNormalCutoff++;
          }
        },
      );

      // pve2 and pve3 (NULL) on pve1's first native flush.
      expect(cluster.adoptions[0]).toEqual({
        atMs: firstNativeFlushMs,
        affected: 2,
      });
      expect(cluster.reportTimesOf("pve2")[0]).toBe(firstReportMs);
      /*
       * Marked by the first report — when its last push said it was up,
       * to turn it Offline; Offline already and adopted, because the
       * migration left it with no mark (and the adoption writes none) —
       * and refreshed once a minute by the reports since, either way.
       */
      expect(cluster.marksOf("node/pve2")).toEqual(
        expectedMarkWrites(cluster.reportTimesOf("pve2"), null),
      );
      expect(cluster.marksOf("node/pve2")[0]).toBe(firstReportMs);
      expect(cluster.marks).toHaveLength(cluster.marksOf("node/pve2").length);
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

/*
 * The established gate guards a node's FIRST report only. A node already
 * Offline in the inventory keeps being reported by every live node while
 * none is established — after a short OneUptime outage, a Redis failover,
 * a lone survivor's own gaps or bursty processing — so those pushes are
 * never stored with no report and its minutes never read 100 % up (which
 * would resolve Node Offline and Quorum at Risk only to page again
 * minutes later). That carries on only while the node's own mark — its
 * row's notReportingMarkedAt, written by markNodesNotReporting alone, with
 * OneUptime's clock — was within the monitor window when the roster was
 * read (exactly the window carries on, a millisecond more does not); each
 * report refreshes the mark once a minute, so the reports keep it fresh
 * for as long as they keep coming. The age is taken at the roster read,
 * not at the push, so every push the ingest's 30-second roster cache
 * serves from one read decides alike — no push at the window's edge falls
 * between two that report. After the whole cluster was silent for longer
 * than the window the mark has aged out — the window holds nothing from
 * before and the incidents have resolved — so nothing carries on, and a
 * node that came back meanwhile is never reported ahead of its own first
 * push; nor does a database clock hours off OneUptime's change any of it,
 * since the database's now() stamps only updatedAt, which nothing reads.
 * A node silent for the first time always waits for an established node.
 */
describe("ProxmoxResourceService inventory model — reports of a node already Offline carry on while no node is established", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  const ROUNDS_TO_ESTABLISH: number =
    PROXMOX_NODE_SILENCE_MS / PUSH_INTERVAL_MS;
  const REFRESH_STEP_MS: number = MARK_REFRESH_MS + PUSH_INTERVAL_MS;

  // The rounds from firstMs to lastMs, one push interval apart.
  function roundsBetween(firstMs: number, lastMs: number): Array<number> {
    const rounds: Array<number> = [];
    for (let atMs: number = firstMs; atMs <= lastMs; atMs += PUSH_INTERVAL_MS) {
      rounds.push(atMs);
    }
    return rounds;
  }

  // The distinct times of the reports made from fromMs on.
  function reportedRoundsSince(
    cluster: SimulatedProxmoxCluster,
    fromMs: number,
  ): Array<number> {
    return Array.from(
      new Set(
        cluster.reports
          .filter((report: ModelReport): boolean => {
            return report.atMs >= fromMs;
          })
          .map((report: ModelReport): number => {
            return report.atMs;
          }),
      ),
    );
  }

  test("after a OneUptime outage shorter than the monitor window, the Offline node is reported from the first push, while a node that died unseen during it waits for an established node", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    // pve3 pushed on the setup's last round, then died during the outage.
    const pve3LastPushMs: number = cluster.clockMs;
    /*
     * Two and a half minutes: long enough for pve3 to be silent on pve1's
     * first push back, short enough that pve2's mark is still within the
     * monitor window then.
     */
    cluster.advance(150 * 1000);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
    expect(backAtMs - pve3LastPushMs).toBeGreaterThan(PROXMOX_NODE_SILENCE_MS);
    expect(backAtMs - markedAtMs).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    const reportsBefore: number = cluster.reports.length;

    // pve1 is the only node back.
    const established: Array<boolean> = [];
    await cluster.pushFor(["pve1"], 3 * MINUTE_MS, async (): Promise<void> => {
      established.push(cluster.isEstablished("pve1"));
      await cluster.cleanup();
    });

    // A report on every one of pve1's pushes, the lone reporter's…
    const reportsBack: Array<ModelReport> =
      cluster.reports.slice(reportsBefore);
    expect(reportsBack).toHaveLength((3 * MINUTE_MS) / PUSH_INTERVAL_MS);
    reportsBack.forEach((report: ModelReport, index: number): void => {
      expect(report.atMs).toBe(backAtMs + index * PUSH_INTERVAL_MS);
      expect(established[index]).toBe(report.atMs >= establishedAtMs);
      // …the Offline node alone until pve1 is established, then both…
      expect(report.silentNodes).toEqual(
        report.atMs < establishedAtMs ? ["pve2"] : ["pve2", "pve3"],
      );
      /*
       * …weighed over the nodes not reported: pve3, dead but not reported
       * yet, is presumed live until it is.
       */
      expect(report.reporterCount).toBe(report.atMs < establishedAtMs ? 2 : 1);
    });
    expect(
      established.filter((isEstablished: boolean): boolean => {
        return !isEstablished;
      }),
    ).toHaveLength(ROUNDS_TO_ESTABLISH);

    // pve3's first report, and its mark, waited for pve1 to be established.
    expect(cluster.reportTimesOf("pve3")[0]).toBe(establishedAtMs);
    expect(cluster.marksOf("node/pve3")).toEqual([establishedAtMs]);
    const pve3: ModelRow = cluster.row("node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.lastSeenAt.getTime()).toBe(pve3LastPushMs);
    /*
     * pve2's row, Offline all along: its mark refreshed by the first push
     * back (then 3.5 minutes old) and once every 70 s after — also on the
     * rounds that reported pve3 with it.
     */
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      backAtMs,
      backAtMs + REFRESH_STEP_MS,
      backAtMs + 2 * REFRESH_STEP_MS,
    ]);
    // The mark column holds the last refresh's markedAt.
    expect(cluster.row("node/pve2")!.notReportingMarkedAt!.getTime()).toBe(
      backAtMs + 2 * REFRESH_STEP_MS,
    );
  });

  test("after a OneUptime outage longer than the monitor window nothing carries on: the Offline node and the node that died unseen during it are first reported together, once pve1 is established", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    const pve3LastPushMs: number = cluster.clockMs;
    cluster.advance(20 * MINUTE_MS);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
    expect(backAtMs - markedAtMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
    const reportsBefore: number = cluster.reports.length;

    await cluster.pushFor(["pve1"], 3 * MINUTE_MS, async (): Promise<void> => {
      await cluster.cleanup();
    });

    /*
     * The window holds nothing from before the outage and pve2's Node
     * Offline has resolved already: pve1 reports nothing while it warms
     * up, then both nodes on every push, alone (L = 1).
     */
    const reportsBack: Array<ModelReport> =
      cluster.reports.slice(reportsBefore);
    expect(reportsBack).toHaveLength(
      (3 * MINUTE_MS - PROXMOX_NODE_SILENCE_MS) / PUSH_INTERVAL_MS,
    );
    reportsBack.forEach((report: ModelReport, index: number): void => {
      expect(report).toEqual({
        atMs: establishedAtMs + index * PUSH_INTERVAL_MS,
        silentNodes: ["pve2", "pve3"],
        reporterCount: 1,
      });
    });
    expect(cluster.marksOf("node/pve3")).toEqual([establishedAtMs]);
    expect(cluster.row("node/pve3")!.lastSeenAt.getTime()).toBe(pve3LastPushMs);
    /*
     * Both kept through the warm-up's cleanups all the same; pve2's aged
     * mark is refreshed by that same first report.
     */
    expect(cluster.marksOf("node/pve2")).toEqual([markedAtMs, establishedAtMs]);
    expect(cluster.row("node/pve2")).toEqual(
      expect.objectContaining({ isUp: false, isNativePush: true }),
    );
  });

  test.each([
    [
      "exactly the monitor window old — it carries on",
      PROXMOX_MONITOR_WINDOW_MS,
      true,
    ],
    [
      "a millisecond older than the monitor window — it waits",
      PROXMOX_MONITOR_WINDOW_MS + 1,
      false,
    ],
    [
      "a round older than the monitor window — it waits",
      PROXMOX_MONITOR_WINDOW_MS + PUSH_INTERVAL_MS,
      false,
    ],
    [
      "the roster cache's lifetime older than the monitor window — it waits: the window is not stretched by the cache",
      PROXMOX_MONITOR_WINDOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
      false,
    ],
  ] as Array<[string, number, boolean]>)(
    "on the first push after a gap, read afresh, a mark %s",
    async (_label: string, markAgeMs: number, carriesOn: boolean) => {
      const { cluster, markedAtMs } = await clusterWithDeadPve2();
      const backAtMs: number = markedAtMs + markAgeMs;
      cluster.advanceTo(backAtMs - PUSH_INTERVAL_MS);
      const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;

      await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

      /*
       * The window is the monitor window, inclusive, on OneUptime's clock,
       * the mark's age taken when the roster was read (here, by the push
       * itself): a mark exactly five minutes old still carries the reports
       * on — and that report refreshes it — while one a millisecond older
       * leaves pve2 unreported until a node is established, however
       * Offline its row.
       */
      const firstReportMs: number = carriesOn ? backAtMs : establishedAtMs;
      expect(reportedRoundsSince(cluster, backAtMs)).toEqual(
        roundsBetween(firstReportMs, cluster.clockMs),
      );
      expect(cluster.marksOf("node/pve2")).toEqual([
        markedAtMs,
        ...expectedMarkWrites(
          roundsBetween(firstReportMs, cluster.clockMs),
          markedAtMs,
        ),
      ]);
      expect(cluster.marksOf("node/pve2")[1]).toBe(firstReportMs);
      for (const report of cluster.reportsOf("pve2")) {
        expect(report.silentNodes).toEqual(["pve2"]);
        expect(report.reporterCount).toBe(2);
      }
    },
  );

  /*
   * The ingest reuses a cluster's roster for 30 s, so a push may decide on
   * a mark read up to 30 s before it. Judged at the push's own time, the
   * pushes a roster read just inside the window serves would report until
   * the window's edge, then not — though the first of them had already
   * refreshed the mark in the inventory — until the next read found that
   * fresh mark: reported, unreported, reported again, and the unreported
   * minutes read up. Judged at the read, every push it serves decides the
   * same.
   */
  test.each([
    [
      "judged at the roster read (the ingest), every push the cached roster serves reports it — no hole at the window's edge",
      true,
    ],
    [
      "control — judged at each push's own time, the pushes it serves past the window's edge report nothing until the next read",
      false,
    ],
  ] as Array<[string, boolean]>)(
    "behind the 30-second roster cache, a roster read 10 s inside the monitor window: %s",
    async (_label: string, judgeMarksAtRosterRead: boolean) => {
      const { cluster, markedAtMs } = await clusterWithDeadPve2();
      cluster.rosterCacheTtlMs = PROXMOX_ROSTER_CACHE_TTL_MS;
      cluster.judgeMarksAtRosterRead = judgeMarksAtRosterRead;
      // Back 4 min 50 s after pve2 was marked: read then, 10 s inside.
      const backAtMs: number =
        markedAtMs + PROXMOX_MONITOR_WINDOW_MS - PUSH_INTERVAL_MS;
      cluster.advanceTo(backAtMs - PUSH_INTERVAL_MS);
      const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
      const readsBefore: number = cluster.rosterReads.length;

      await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

      /*
       * Read on the first push back, then reused through the 30 s after
       * it (expired once now > read + TTL): each read serves four rounds.
       */
      expect(cluster.rosterReads.slice(readsBefore, readsBefore + 3)).toEqual([
        backAtMs,
        backAtMs + 4 * PUSH_INTERVAL_MS,
        backAtMs + 8 * PUSH_INTERVAL_MS,
      ]);
      // The first push back refreshed the inventory's mark all the same.
      expect(cluster.marksOf("node/pve2").slice(0, 2)).toEqual([
        markedAtMs,
        backAtMs,
      ]);
      // No node established through the rounds the first read served.
      expect(establishedAtMs).toBeGreaterThan(
        backAtMs + PROXMOX_ROSTER_CACHE_TTL_MS,
      );

      /*
       * The rounds served by the first read, past the window's edge at
       * the push's own time (their pushes 5 min 10 s and 5 min 20 s after
       * the mark that read carries).
       */
      const pastEdge: Array<number> = [
        backAtMs + 2 * PUSH_INTERVAL_MS,
        backAtMs + 3 * PUSH_INTERVAL_MS,
      ];
      for (const atMs of pastEdge) {
        expect(atMs - markedAtMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      }
      const allRounds: Array<number> = roundsBetween(backAtMs, cluster.clockMs);
      expect(reportedRoundsSince(cluster, backAtMs)).toEqual(
        judgeMarksAtRosterRead
          ? allRounds
          : allRounds.filter((atMs: number): boolean => {
              return !pastEdge.includes(atMs);
            }),
      );
      // Whoever reports, on whichever round: pve2 alone, over pve1 and pve3.
      for (const report of cluster.reportsOf("pve2")) {
        expect(report.silentNodes).toEqual(["pve2"]);
        expect(report.reporterCount).toBe(2);
      }
    },
  );

  test.each([
    [
      "exactly the monitor window old at the read — every push it serves carries on",
      PROXMOX_MONITOR_WINDOW_MS,
      true,
    ],
    [
      "a millisecond older than the monitor window at the read — every push it serves waits",
      PROXMOX_MONITOR_WINDOW_MS + 1,
      false,
    ],
  ] as Array<[string, number, boolean]>)(
    "behind the 30-second roster cache, a mark %s",
    async (_label: string, markAgeMs: number, carriesOn: boolean) => {
      const { cluster, markedAtMs } = await clusterWithDeadPve2();
      cluster.rosterCacheTtlMs = PROXMOX_ROSTER_CACHE_TTL_MS;
      const backAtMs: number = markedAtMs + markAgeMs;
      cluster.advanceTo(backAtMs - PUSH_INTERVAL_MS);
      const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
      const readsBefore: number = cluster.rosterReads.length;

      await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

      expect(cluster.rosterReads[readsBefore]).toBe(backAtMs);
      /*
       * The four rounds the first read serves decide alike: all report
       * pve2 — at the read its mark was within the window, however far
       * past it their own pushes are — or none does, and pve2 waits for
       * an established node.
       */
      const firstReportMs: number = carriesOn ? backAtMs : establishedAtMs;
      expect(reportedRoundsSince(cluster, backAtMs)).toEqual(
        roundsBetween(firstReportMs, cluster.clockMs),
      );
      expect(cluster.marksOf("node/pve2")[1]).toBe(firstReportMs);
    },
  );

  test("the reports carry on through a warm-up however long ago a node was last established: each report keeps its own mark fresh", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    // The setup's last round had pve1 and pve3 established.
    const lastEstablishedMs: number = cluster.clockMs;
    expect(cluster.isEstablished("pve1")).toBe(true);

    /*
     * Out for 3 min 25 s: back with pve2's mark within the window, and a
     * two-minute warm-up that runs past one monitor window after the last
     * established push — without a mark that the reports refresh, the
     * rounds past that point and before a node is established would have
     * been stored with no report, and pve2's minutes read 100 % up.
     */
    cluster.advance(205 * 1000);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
    expect(backAtMs - markedAtMs).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    expect(establishedAtMs - lastEstablishedMs).toBeGreaterThan(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    const reportsBefore: number = cluster.reports.length;

    await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);

    // Every round, from the first push back.
    expect(reportedRoundsSince(cluster, backAtMs)).toEqual(
      roundsBetween(backAtMs, cluster.clockMs),
    );
    // Both live nodes on every round, pve2 over the two of them.
    const reportsBack: Array<ModelReport> =
      cluster.reports.slice(reportsBefore);
    expect(reportsBack).toHaveLength(
      2 * roundsBetween(backAtMs, cluster.clockMs).length,
    );
    for (const report of reportsBack) {
      expect(report.silentNodes).toEqual(["pve2"]);
      expect(report.reporterCount).toBe(2);
    }
    // The first push back refreshed the mark, then once every 70 s.
    expect(cluster.marksOf("node/pve2")).toEqual([
      markedAtMs,
      backAtMs,
      backAtMs + REFRESH_STEP_MS,
      backAtMs + 2 * REFRESH_STEP_MS,
    ]);
  });

  test("after a Redis failover that loses every key, the reports of the Offline node carry on from the first push — its mark is in the inventory — and no live node whose key was lost is ever reported", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    const reportsBefore: number = cluster.reports.length;
    const adoptionsBefore: number = cluster.adoptions.length;

    cluster.loseRedis();
    expect(cluster.livenessOf("pve1")).toBeNull();
    expect(cluster.livenessOf("pve3")).toBeNull();
    const failedOverAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    const warmUp: { unestablishedRounds: number } = { unestablishedRounds: 0 };
    await cluster.pushFor(
      ["pve1", "pve3"],
      3 * MINUTE_MS,
      async (): Promise<void> => {
        if (!cluster.isEstablished("pve1") && !cluster.isEstablished("pve3")) {
          warmUp.unestablishedRounds++;
        }
        await cluster.cleanup();
      },
    );

    // Every streak restarted: two minutes with no node established…
    expect(warmUp.unestablishedRounds).toBe(ROUNDS_TO_ESTABLISH);
    /*
     * …yet pve2 is reported on every round from the first push after the
     * failover, by both live nodes, each weighing it over the two nodes
     * not reported: the mark it carries on from is pve2's row, which the
     * failover never touched.
     */
    const reportsBack: Array<ModelReport> =
      cluster.reports.slice(reportsBefore);
    expect(reportedRoundsSince(cluster, failedOverAtMs)).toEqual(
      roundsBetween(failedOverAtMs, cluster.clockMs),
    );
    expect(reportsBack).toHaveLength(
      2 * roundsBetween(failedOverAtMs, cluster.clockMs).length,
    );
    for (const report of reportsBack) {
      expect(report.reporterCount).toBe(2);
      // pve3's key was lost too, but its row was seen seconds before.
      expect(report.silentNodes).toEqual(["pve2"]);
    }
    /*
     * The mark, a minute old at the failover, is refreshed on the round
     * after it and every 70 s since, as before.
     */
    expect(cluster.marks).toEqual(
      [0, 1, 2, 3].map((step: number): ModelMark => {
        return {
          atMs: markedAtMs + step * REFRESH_STEP_MS,
          externalId: "node/pve2",
        };
      }),
    );
    for (const nodeName of ["pve1", "pve3"]) {
      expect(cluster.row(`node/${nodeName}`)!.isUp).toBe(true);
    }
    // The fence went with Redis: the next flush adopted again — nothing.
    expect(cluster.adoptions.slice(adoptionsBefore)).toEqual([
      { atMs: failedOverAtMs, affected: 0 },
    ]);
  });

  test.each([
    ["a little over a minute", 60 * 1000],
    ["three minutes — past its own silence window", 3 * MINUTE_MS],
  ] as Array<[string, number]>)(
    "a lone survivor whose own pushes stop for %s keeps reporting the Offline nodes through its warm-up",
    async (_label: string, pauseMs: number) => {
      const { cluster } = await clusterWithDeadPve2();
      // pve3 dies too; pve1, established, carries on alone and reports it.
      const pve3LastPushMs: number = cluster.clockMs;
      await cluster.pushFor(["pve1"], 3 * MINUTE_MS);
      expect(cluster.marksOf("node/pve3")).toEqual([
        pve3LastPushMs + PROXMOX_NODE_SILENCE_MS + PUSH_INTERVAL_MS,
      ]);
      const marksBefore: number = cluster.marks.length;
      const reportsBefore: number = cluster.reports.length;

      // pve1's own pushes stop.
      const pausedAtMs: number = cluster.clockMs;
      cluster.advance(pauseMs);
      const resumedAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
      expect(resumedAtMs - pausedAtMs).toBeGreaterThan(
        PROXMOX_NODE_STREAK_GAP_MS,
      );
      // Both marks still within the monitor window when it resumes.
      for (const externalId of ["node/pve2", "node/pve3"]) {
        expect(
          cluster.markAgeMs(externalId) + PUSH_INTERVAL_MS,
        ).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
      }

      const established: Array<boolean> = [];
      await cluster.pushFor(
        ["pve1"],
        3 * MINUTE_MS,
        async (): Promise<void> => {
          established.push(cluster.isEstablished("pve1"));
        },
      );

      // Its streak restarted: not established for two minutes…
      expect(established[0]).toBe(false);
      expect(
        established.filter((isEstablished: boolean): boolean => {
          return !isEstablished;
        }),
      ).toHaveLength(ROUNDS_TO_ESTABLISH);
      // …yet it reported both Offline nodes on every push.
      const reportsBack: Array<ModelReport> =
        cluster.reports.slice(reportsBefore);
      expect(reportsBack).toHaveLength((3 * MINUTE_MS) / PUSH_INTERVAL_MS);
      reportsBack.forEach((report: ModelReport, index: number): void => {
        expect(report).toEqual({
          atMs: resumedAtMs + index * PUSH_INTERVAL_MS,
          silentNodes: ["pve2", "pve3"],
          reporterCount: 1,
        });
      });
      /*
       * Both marks more than a minute old on its first push back: both
       * refreshed then, and every 70 s after — and nothing else written.
       */
      const refreshes: Array<number> = [
        resumedAtMs,
        resumedAtMs + REFRESH_STEP_MS,
        resumedAtMs + 2 * REFRESH_STEP_MS,
      ];
      expect(cluster.marks.slice(marksBefore)).toEqual(
        refreshes.flatMap((atMs: number): Array<ModelMark> => {
          return [
            { atMs, externalId: "node/pve2" },
            { atMs, externalId: "node/pve3" },
          ];
        }),
      );
    },
  );

  test("a lone survivor whose pushes are processed only in bursts, never established, keeps reporting the nodes already Offline on every burst — and never makes a first report of one that dies meanwhile", async () => {
    const nodes: Array<string> = ["pve1", "pve2", "pve3", "pve4"];
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    await cluster.push(nodes);
    await cluster.pushFor(nodes, 3 * MINUTE_MS);
    // pve2 dies and is reported, then pve3.
    await cluster.pushFor(["pve1", "pve3", "pve4"], 3 * MINUTE_MS);
    await cluster.pushFor(["pve1", "pve4"], 3 * MINUTE_MS);
    expect(cluster.marksOf("node/pve2").length).toBeGreaterThan(0);
    expect(cluster.marksOf("node/pve3").length).toBeGreaterThan(0);
    const pve4LastPushMs: number = cluster.clockMs;
    const marksBefore: number = cluster.marks.length;
    const reportsBefore: number = cluster.reports.length;

    /*
     * pve4 dies as well, and pve1's pushes are processed only once every
     * 90 s from then on (a backlog drained in bursts): each gap breaks its
     * streak, so it is never established again.
     */
    const burstGapMs: number = 90 * 1000;
    expect(burstGapMs).toBeGreaterThan(PROXMOX_NODE_STREAK_GAP_MS);
    const bursts: Array<number> = [];
    for (let burst: number = 0; burst < 8; burst++) {
      cluster.advance(burstGapMs);
      await cluster.push(["pve1"]);
      bursts.push(cluster.clockMs);
      expect(cluster.isEstablished("pve1")).toBe(false);
    }

    /*
     * Every burst reports pve2 and pve3 — Offline, and their marks, each
     * refreshed by the burst before, never more than 90 s old — weighed
     * over pve1 and pve4: pve4, silent from the second burst on but never
     * reported (its row still reads Online, and no node is established),
     * is presumed live.
     */
    expect(cluster.reports.slice(reportsBefore)).toEqual(
      bursts.map((atMs: number): ModelReport => {
        return { atMs, silentNodes: ["pve2", "pve3"], reporterCount: 2 };
      }),
    );
    expect(bursts[1]! - pve4LastPushMs).toBeGreaterThan(
      PROXMOX_NODE_SILENCE_MS,
    );
    expect(cluster.reportTimesOf("pve4")).toEqual([]);
    expect(cluster.marksOf("node/pve4")).toEqual([]);
    expect(cluster.row("node/pve4")!.isUp).toBe(true);
    // Each burst finds both marks more than a minute old and refreshes them.
    expect(cluster.marks.slice(marksBefore)).toEqual(
      bursts.flatMap((atMs: number): Array<ModelMark> => {
        return [
          { atMs, externalId: "node/pve2" },
          { atMs, externalId: "node/pve3" },
        ];
      }),
    );
  });

  test("behind the ingest's 30-second mark fence the mark is refreshed every 90 s — well inside the monitor window — and the reports carry on through a warm-up all the same", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    cluster.markFenceEnabled = true;
    const marksBefore: number = cluster.marks.length;

    const markAges: Array<number> = [];
    await cluster.pushFor(
      ["pve1", "pve3"],
      10 * MINUTE_MS,
      async (): Promise<void> => {
        markAges.push(cluster.markAgeMs("node/pve2"));
      },
    );
    const refreshes: Array<number> = cluster
      .marksOf("node/pve2")
      .slice(marksBefore);
    expect(refreshes.length).toBeGreaterThan(5);
    /*
     * The fence lets a mark through every 30 s; the guard writes the first
     * that finds the row more than 60 s old: every third, 90 s apart.
     */
    refreshes.forEach((atMs: number, index: number): void => {
      const previousMs: number =
        index === 0 ? markedAtMs : refreshes[index - 1]!;
      expect(atMs - previousMs).toBe(MARK_REFRESH_MS + MARK_FENCE_MS);
    });
    expect(Math.max(...markAges)).toBeLessThan(MARK_REFRESH_MS + MARK_FENCE_MS);

    // A two-minute outage: the reports carry on from the first push back.
    cluster.advance(2 * MINUTE_MS);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    expect(backAtMs - refreshes[refreshes.length - 1]!).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);
    expect(reportedRoundsSince(cluster, backAtMs)).toEqual(
      roundsBetween(backAtMs, cluster.clockMs),
    );
    for (const report of cluster.reportsOf("pve2")) {
      expect(report.silentNodes).toEqual(["pve2"]);
      expect(report.reporterCount).toBe(2);
    }
  });

  test("a node back during the warm-up is reported no more from its own first push — the reports never outlast its silence", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    // An outage its mark outlives, so the reports carry on.
    cluster.advance(2 * MINUTE_MS);
    const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    expect(backAtMs - markedAtMs).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );

    // pve1 and pve3 are back first, and report pve2 at once…
    await cluster.pushFor(["pve1", "pve3"], 3 * PUSH_INTERVAL_MS);
    // …then pve2 pushes again, well inside the warm-up.
    const pve2BackAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
    expect(pve2BackAtMs).toBeLessThan(backAtMs + PROXMOX_NODE_SILENCE_MS);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);

    /*
     * Both live nodes on each round before it came back; on its round,
     * pve1 once more — processed just ahead of pve2's own push — and
     * nobody after.
     */
    expect(
      cluster.reportTimesOf("pve2").filter((atMs: number): boolean => {
        return atMs >= backAtMs;
      }),
    ).toEqual([
      backAtMs,
      backAtMs,
      backAtMs + PUSH_INTERVAL_MS,
      backAtMs + PUSH_INTERVAL_MS,
      backAtMs + 2 * PUSH_INTERVAL_MS,
      backAtMs + 2 * PUSH_INTERVAL_MS,
      pve2BackAtMs,
    ]);
    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(true);
    expect(pve2.lastSeenAt.getTime()).toBe(cluster.clockMs);
    expect(pve2.isNativePush).toBe(true);
    /*
     * The first report back refreshed its mark; the last found it written
     * seconds before and wrote nothing.
     */
    expect(cluster.marks).toEqual([
      { atMs: markedAtMs, externalId: "node/pve2" },
      { atMs: backAtMs, externalId: "node/pve2" },
    ]);
  });

  test("a node that came back during an outage longer than the monitor window is never reported after it — not even by a sibling processed ahead of its own first push", async () => {
    const { cluster, markedAtMs } = await clusterWithDeadPve2();
    const reportsBefore: number = cluster.reports.length;

    /*
     * pve2 boots during a 20-minute OneUptime outage; its pushes are lost
     * with the rest. After it, pve1's push is processed first on each
     * round: pve2 has no key and a row that says Offline — but its mark is
     * 20 minutes old and no node is established, so pve1 does not report
     * it, and pve2's own push, a moment later, turns it Online.
     */
    cluster.advance(20 * MINUTE_MS + PUSH_INTERVAL_MS);
    expect(cluster.clockMs - markedAtMs).toBeGreaterThan(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    await cluster.push(["pve1"]);
    expect(cluster.row("node/pve2")!.isUp).toBe(false);
    await cluster.push(["pve2", "pve3"]);
    await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);

    expect(cluster.reports.slice(reportsBefore)).toEqual([]);
    expect(cluster.marks).toEqual([
      { atMs: markedAtMs, externalId: "node/pve2" },
    ]);
    const pve2: ModelRow = cluster.row("node/pve2")!;
    expect(pve2.isUp).toBe(true);
    expect(pve2.lastSeenAt.getTime()).toBe(cluster.clockMs);
  });

  /*
   * The mark is judged on OneUptime's clock (the roster read's time), so
   * it is stamped on it too — the ingest hands the mark its markedAt, and
   * it lives in its own column, notReportingMarkedAt. The database's now()
   * stamps updatedAt alone, which nothing reads: were the mark that stamp,
   * a database clock more than the window ahead kept every mark from
   * ageing out (a node back during a long outage was reported after it),
   * and one behind aged every mark out at once (the reports stopped
   * carrying on).
   */
  test.each([
    ["an hour ahead of", HOUR_MS],
    ["an hour behind", -HOUR_MS],
  ] as Array<[string, number]>)(
    "with the database clock %s OneUptime's, the mark is stamped and aged on OneUptime's clock: refreshed once a minute, carried on after a short outage, aged out after a long one — a node back during it never reported",
    async (_label: string, skewMs: number) => {
      const { cluster, markedAtMs } = await clusterWithDeadPve2(skewMs);

      /*
       * The upsert and the mark stamp updatedAt on the database's clock;
       * the mark column holds OneUptime's.
       */
      expect(cluster.row("node/pve1")!.updatedAt.getTime()).toBe(
        cluster.clockMs + skewMs,
      );
      expect(cluster.row("node/pve1")!.notReportingMarkedAt).toBeNull();
      expect(cluster.row("node/pve2")!.notReportingMarkedAt!.getTime()).toBe(
        markedAtMs,
      );
      expect(cluster.row("node/pve2")!.updatedAt.getTime()).toBe(
        markedAtMs + skewMs,
      );

      // Refreshed on the first report more than 60 s after it, as ever.
      const refreshStepMs: number = MARK_REFRESH_MS + PUSH_INTERVAL_MS;
      await cluster.pushFor(["pve1", "pve3"], 5 * MINUTE_MS);
      expect(cluster.marksOf("node/pve2")).toEqual(
        [0, 1, 2, 3, 4, 5].map((step: number): number => {
          return markedAtMs + step * refreshStepMs;
        }),
      );
      const lastRefreshMs: number = markedAtMs + 5 * refreshStepMs;
      expect(cluster.row("node/pve2")!.notReportingMarkedAt!.getTime()).toBe(
        lastRefreshMs,
      );
      expect(cluster.row("node/pve2")!.updatedAt.getTime()).toBe(
        lastRefreshMs + skewMs,
      );

      // A two-minute outage: the reports carry on from the first push back.
      cluster.advance(2 * MINUTE_MS);
      const backAtMs: number = cluster.clockMs + PUSH_INTERVAL_MS;
      expect(backAtMs - lastRefreshMs).toBeLessThanOrEqual(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      const reportsBefore: number = cluster.reports.length;
      await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);
      const reportsBack: Array<ModelReport> =
        cluster.reports.slice(reportsBefore);
      expect(reportsBack).toHaveLength(
        2 * ((3 * MINUTE_MS) / PUSH_INTERVAL_MS),
      );
      reportsBack.forEach((report: ModelReport, index: number): void => {
        expect(report).toEqual({
          atMs: backAtMs + Math.floor(index / 2) * PUSH_INTERVAL_MS,
          silentNodes: ["pve2"],
          reporterCount: 2,
        });
      });
      expect(cluster.marksOf("node/pve2").slice(6)).toEqual([
        backAtMs,
        backAtMs + refreshStepMs,
        backAtMs + 2 * refreshStepMs,
      ]);

      /*
       * A 20-minute outage, pve2 back during it: its mark has aged out on
       * OneUptime's clock, so pve1, processed ahead of pve2's own first
       * push, does not report it — and nobody after.
       */
      const marksBefore: number = cluster.marks.length;
      const reportsBeforeLong: number = cluster.reports.length;
      cluster.advance(20 * MINUTE_MS + PUSH_INTERVAL_MS);
      expect(cluster.markAgeMs("node/pve2")).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      await cluster.push(["pve1"]);
      expect(cluster.row("node/pve2")!.isUp).toBe(false);
      await cluster.push(["pve2", "pve3"]);
      await cluster.pushFor(ALL_NODES, 3 * MINUTE_MS);

      expect(cluster.reports.slice(reportsBeforeLong)).toEqual([]);
      expect(cluster.marks).toHaveLength(marksBefore);
      expect(cluster.row("node/pve2")).toEqual(
        expect.objectContaining({ isUp: true, isNativePush: true }),
      );
    },
  );
});

/*
 * The cluster moves from the Proxmox Agent to the Proxmox VE native push
 * after a gap longer than the normal prune window. When the native push
 * starts, the cleanup's cutoff jumps to the new last report and every
 * row the agent wrote is behind it; a node that is dead by then never
 * pushes, and the live nodes need two minutes to report it — whether the
 * agent last saw it Online or Offline: its row carries no mark (the agent
 * never writes notReportingMarkedAt, and a real observation clears it),
 * and the adoption, which writes the flag alone, does not give it one —
 * however recently, on whatever database clock, the agent wrote it. The
 * first native flush adopts its row, so the cron ticks of those two
 * minutes keep it.
 */
describe("ProxmoxResourceService inventory model — moved from the agent to the native push after a gap", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  const GAP_MS: number = 20 * MINUTE_MS;
  const CRON_INTERVAL_MS: number = 5 * MINUTE_MS;

  interface GapCluster {
    cluster: SimulatedProxmoxCluster;
    // pve9's last sighting, by the agent.
    pve9LastSeenMs: number;
    // The first native push.
    backAtMs: number;
  }

  /*
   * The agent lists pve9 (as isUpUnderAgent) alongside pve1 and pve3 for
   * five minutes. Then the cluster reports nothing for gapMs (GAP_MS by
   * default) while the cleanup cron runs on, before pve1 and pve3 push
   * natively; pve9 is dead by then and never pushes. The database clock
   * runs databaseClockSkewMs off OneUptime's throughout (0: they agree).
   */
  async function agentThenGap(
    isUpUnderAgent: boolean,
    gapMs: number = GAP_MS,
    databaseClockSkewMs: number = 0,
  ): Promise<GapCluster> {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.databaseClockSkewMs = databaseClockSkewMs;
    cluster.reportsEnabled = false;
    cluster.isNativePushArg = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve9", isUp: isUpUnderAgent },
    ]);
    await cluster.push(["pve1", "pve3"]);
    await cluster.pushFor(["pve1", "pve3"], 5 * MINUTE_MS);
    const pve9LastSeenMs: number = cluster.clockMs;
    // The agent's write: unmarked, stamped on the database's clock.
    expect(cluster.row("node/pve9")).toEqual(
      expect.objectContaining({
        isUp: isUpUnderAgent,
        isNativePush: false,
        notReportingMarkedAt: null,
        updatedAt: new Date(pve9LastSeenMs + databaseClockSkewMs),
      }),
    );
    expect(cluster.adoptions).toEqual([]);

    // Anchored at the cluster's last report, the cron prunes nothing.
    cluster.carry("pve1", []);
    for (
      let elapsedMs: number = CRON_INTERVAL_MS;
      elapsedMs <= gapMs;
      elapsedMs += CRON_INTERVAL_MS
    ) {
      cluster.advanceTo(pve9LastSeenMs + elapsedMs);
      await cluster.cleanup();
      expect(cluster.row("node/pve9")).toBeDefined();
    }
    cluster.advanceTo(pve9LastSeenMs + gapMs);

    cluster.isNativePushArg = true;
    cluster.reportsEnabled = true;
    return {
      cluster,
      pve9LastSeenMs,
      backAtMs: cluster.clockMs + PUSH_INTERVAL_MS,
    };
  }

  test.each([
    ["that the agent last listed Offline", false],
    ["that the agent last listed Online and that died during the gap", true],
  ] as Array<[string, boolean]>)(
    "a node %s is adopted by the first native flush, kept by every cron tick of the warm-up, and reported",
    async (_label: string, isUpUnderAgent: boolean) => {
      const { cluster, pve9LastSeenMs, backAtMs } =
        await agentThenGap(isUpUnderAgent);
      expect(GAP_MS).toBeGreaterThan(staleThresholdMs());
      const establishedAtMs: number = backAtMs + PROXMOX_NODE_SILENCE_MS;
      const warmUp: { cleanupsPastNormalCutoff: number } = {
        cleanupsPastNormalCutoff: 0,
      };

      await cluster.pushFor(
        ["pve1", "pve3"],
        5 * MINUTE_MS,
        async (): Promise<void> => {
          const olderThan: Date = await cluster.cleanup();
          const pve9: ModelRow | undefined = cluster.row("node/pve9");
          expect(pve9).toBeDefined();
          expect(pve9!.isNativePush).toBe(true);
          expect(pve9!.lastSeenAt.getTime()).toBe(pve9LastSeenMs);
          if (cluster.clockMs < establishedAtMs) {
            // Adopted, not reported: as the agent last wrote it, unmarked.
            expect(pve9!.isUp).toBe(isUpUnderAgent);
            expect(pve9!.notReportingMarkedAt).toBeNull();
            expect(pve9!.updatedAt.getTime()).toBe(pve9LastSeenMs);
          }
          if (
            cluster.clockMs < establishedAtMs &&
            pve9LastSeenMs < olderThan.getTime()
          ) {
            warmUp.cleanupsPastNormalCutoff++;
          }
        },
      );

      /*
       * Every cleanup before a node was established — the one right
       * after the first native flush included — had its normal cutoff
       * past pve9's last sighting.
       */
      expect(warmUp.cleanupsPastNormalCutoff).toBe(
        PROXMOX_NODE_SILENCE_MS / PUSH_INTERVAL_MS,
      );
      /*
       * pve9 and pve3's agent row, on pve1's first native flush: both
       * last seen before that batch's own observation.
       */
      expect(cluster.adoptions[0]).toEqual({ atMs: backAtMs, affected: 2 });
      expect(pve9LastSeenMs).toBeLessThan(backAtMs);

      /*
       * Either way it is first reported once pve1 is established, pve3 live
       * beside it, and marked then. Offline as the agent last saw it, its
       * row carries no mark — the agent never writes one, and the adoption
       * writes the flag alone — so nothing carries on while no node is
       * established: a node the agent last saw down may have come back
       * during the gap, and must not be reported ahead of its own first
       * push (see below). Every report weighs it over pve1 and pve3 —
       * pve3, silent to the first push but Online in the inventory, is
       * presumed live and never reported.
       */
      expect(backAtMs - pve9LastSeenMs).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      expect(cluster.reportsOf("pve9")[0]).toEqual({
        atMs: establishedAtMs,
        silentNodes: ["pve9"],
        reporterCount: 2,
      });
      for (const report of cluster.reports) {
        expect(report.atMs).toBeGreaterThanOrEqual(establishedAtMs);
        expect(report.silentNodes).toEqual(["pve9"]);
        expect(report.reporterCount).toBe(2);
      }
      expect(Math.max(...cluster.reportTimesOf("pve9"))).toBe(cluster.clockMs);
      /*
       * The mark: written by the first report — turning the Online row
       * Offline, or marking the Offline one, which no report had marked —
       * then once a minute either way.
       */
      expect(cluster.marksOf("node/pve9")).toEqual(
        expectedMarkWrites(cluster.reportTimesOf("pve9"), null),
      );
      expect(cluster.marksOf("node/pve9")[0]).toBe(establishedAtMs);
      expect(cluster.marks).toHaveLength(cluster.marksOf("node/pve9").length);
      const pve9: ModelRow = cluster.row("node/pve9")!;
      expect(pve9.isUp).toBe(false);
      expect(pve9.uptimeSeconds).toBeNull();
      expect(pve9.isNativePush).toBe(true);
      expect(await cluster.rosterNodeNames()).toContain("pve9");
      expect(cluster.prunes.plain).toBe(0);
    },
  );

  /*
   * pve9 booted during the gap; its first native push is processed a
   * moment after pve1's and pve3's, pve1's flush adopting its Offline
   * agent-era row. Neither sibling is established, and pve9 is silent by
   * its row — yet the row carries no mark: the agent's upsert never writes
   * one and the adoption writes the flag alone, so neither sibling reports
   * it, whatever updatedAt reads. Had updatedAt stood for the mark, the
   * agent's write a few minutes before — or one the database's clock,
   * running an hour ahead, stamped into the future — would have read as a
   * mark in force, and pve1 and pve3 would have reported a node that was
   * up: a false Node Offline.
   */
  test.each([
    ["20 minutes, the clocks agreeing", 20 * MINUTE_MS, 0],
    ["20 minutes, the database clock an hour ahead", 20 * MINUTE_MS, HOUR_MS],
    ["three minutes, the clocks agreeing", 3 * MINUTE_MS, 0],
    ["three minutes, the database clock an hour ahead", 3 * MINUTE_MS, HOUR_MS],
  ] as Array<[string, number, number]>)(
    "after a gap of %s, a node the agent last listed Offline that came back during it is never reported — not even by siblings whose pushes, and the adoption, are processed ahead of its own first push",
    async (_label: string, gapMs: number, skewMs: number) => {
      const { cluster, pve9LastSeenMs, backAtMs } = await agentThenGap(
        false,
        gapMs,
        skewMs,
      );
      // Silent by its row on the siblings' first pushes…
      expect(backAtMs - pve9LastSeenMs).toBeGreaterThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      // …and, for the short gap, last written well within the window.
      if (gapMs < PROXMOX_MONITOR_WINDOW_MS) {
        expect(backAtMs - pve9LastSeenMs).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
      }

      cluster.advanceTo(backAtMs);
      await cluster.push(["pve1"]);
      expect(cluster.adoptions).toEqual([{ atMs: backAtMs, affected: 2 }]);
      expect(cluster.row("node/pve9")).toEqual(
        expect.objectContaining({
          isUp: false,
          isNativePush: true,
          lastSeenAt: new Date(pve9LastSeenMs),
          // No mark: the agent wrote none, the adoption wrote none.
          notReportingMarkedAt: null,
          // The agent's write, on the database's clock — read by nothing.
          updatedAt: new Date(pve9LastSeenMs + skewMs),
        }),
      );
      await cluster.push(["pve3"]);
      expect(cluster.isEstablished("pve1")).toBe(false);
      expect(cluster.isEstablished("pve3")).toBe(false);
      expect(cluster.reports).toEqual([]);

      // pve9's own first push turns it Online; nobody ever reports it.
      await cluster.push(["pve9"]);
      expect(cluster.row("node/pve9")).toEqual(
        expect.objectContaining({
          isUp: true,
          isNativePush: true,
          notReportingMarkedAt: null,
        }),
      );
      await cluster.pushFor(
        ["pve1", "pve3", "pve9"],
        5 * MINUTE_MS,
        async (): Promise<void> => {
          await cluster.cleanup();
        },
      );

      expect(cluster.reports).toEqual([]);
      expect(cluster.marks).toEqual([]);
      for (const nodeName of ["pve1", "pve3", "pve9"]) {
        expect(cluster.row(`node/${nodeName}`)).toEqual(
          expect.objectContaining({
            isUp: true,
            isNativePush: true,
            notReportingMarkedAt: null,
          }),
        );
      }
    },
  );

  test("control — without the adoption (the ingest before it), the node the agent last listed Online is pruned by the first cron tick after the native push starts, never reported", async () => {
    const { cluster, backAtMs } = await agentThenGap(true);
    cluster.adoptOnNativeFlush = false;

    const seen: { deletedAtMs: number | null } = { deletedAtMs: null };
    await cluster.pushFor(
      ["pve1", "pve3"],
      5 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        if (seen.deletedAtMs === null && !cluster.row("node/pve9")) {
          seen.deletedAtMs = cluster.clockMs;
        }
      },
    );

    // Two minutes before an established node could have reported it.
    expect(seen.deletedAtMs).toBe(backAtMs);
    expect(cluster.adoptions).toEqual([]);
    expect(cluster.reportTimesOf("pve9")).toEqual([]);
    expect(cluster.marks).toEqual([]);
    expect(await cluster.rosterNodeNames()).not.toContain("pve9");
  });
});

describe("ProxmoxResourceService inventory model — Remove Node", () => {
  preserveEnv(RETENTION_ENV_KEY);
  preserveEnv(STALE_ENV_KEY);
  // Unset around every test: silent-node detection on, as by default.
  preserveEnv(DETECTION_ENV_KEY);

  test("an agent node is not-native until the native push adopts it; Offline and native it is removed, leaves the roster and is reported no more; a live node is still-reporting; an unknown one is not-found", async () => {
    const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
      MODEL_T0_MS,
    );
    cluster.reportsEnabled = false;
    cluster.isNativePushArg = false;
    cluster.carry("pve1", [
      { kind: "Node", externalId: "node/pve9", isUp: false },
    ]);
    await cluster.push(["pve1", "pve3"]);

    // On the agent: it lets a node go on its own — nothing is removed.
    expect(await cluster.remove("pve9")).toBe("not-native");
    expect(await cluster.remove("pve1")).toBe("not-native");
    expect(await cluster.remove("pve7")).toBe("not-found");
    expect(cluster.row("node/pve9")).toEqual(
      expect.objectContaining({ isUp: false, isNativePush: false }),
    );

    // Moved to the native push: adopted, then reported by the live nodes.
    cluster.carry("pve1", []);
    cluster.isNativePushArg = true;
    cluster.reportsEnabled = true;
    await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);
    expect(cluster.reportTimesOf("pve9").length).toBeGreaterThan(0);

    // A live node is never removed: it would come back on its next push.
    const pve1Before: ModelRow | undefined = cluster.row("node/pve1");
    expect(await cluster.remove("pve1")).toBe("still-reporting");
    expect(cluster.row("node/pve1")).toEqual(pve1Before);

    expect(await cluster.remove("pve9")).toBe("removed");
    const removedAtMs: number = cluster.clockMs;
    expect(cluster.row("node/pve9")).toBeUndefined();
    expect(await cluster.rosterNodeNames()).toEqual(["pve1", "pve3"]);

    // Its siblings stop reporting it, and nothing brings the row back.
    await cluster.pushFor(
      ["pve1", "pve3"],
      20 * MINUTE_MS,
      async (): Promise<void> => {
        await cluster.cleanup();
        expect(cluster.row("node/pve9")).toBeUndefined();
      },
    );
    expect(Math.max(...cluster.reportTimesOf("pve9"))).toBeLessThan(
      removedAtMs + PUSH_INTERVAL_MS,
    );
    expect(await cluster.remove("pve9")).toBe("not-found");

    // Were it to push again, its own push brings it back.
    await cluster.push(["pve9"]);
    expect(cluster.row("node/pve9")).toEqual(
      expect.objectContaining({ isUp: true, isNativePush: true }),
    );
  });

  // 150 characters: "node/<name>" is stored clamped to the column's 100.
  const LONG_NAME: string = `pve-${"x".repeat(146)}`;

  test.each([
    ["its full name, as an API caller gives it", "full"],
    ["the name its page reads back from the stored id", "stored"],
  ] as Array<[string, "full" | "stored"]>)(
    "a node named past the column is reported by its stored name, marked, and removed by %s",
    async (_label: string, which: "full" | "stored") => {
      // bulkUpsert warns about the clamp — expected here, keep it quiet.
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
      const cluster: SimulatedProxmoxCluster = new SimulatedProxmoxCluster(
        MODEL_T0_MS,
      );
      const nodes: Array<string> = ["pve1", "pve3", LONG_NAME];
      await cluster.push(nodes);
      await cluster.pushFor(nodes, 3 * MINUTE_MS);

      const storedId: string = `node/${LONG_NAME}`.substring(0, 100);
      const storedName: string = storedId.substring("node/".length);
      expect(cluster.row(storedId)).toEqual(
        expect.objectContaining({ isUp: true, isNativePush: true }),
      );
      expect(cluster.row(`node/${LONG_NAME}`)).toBeUndefined();
      expect(await cluster.rosterNodeNames()).toEqual([
        "pve1",
        "pve3",
        storedName,
      ]);
      // Up, it is found — and never removed — by its full name too.
      expect(await cluster.remove(LONG_NAME)).toBe("still-reporting");
      expect(cluster.reports).toEqual([]);

      // It dies: its siblings report it by the roster's name, and mark it.
      await cluster.pushFor(["pve1", "pve3"], 3 * MINUTE_MS);
      expect(cluster.reportTimesOf(storedName).length).toBeGreaterThan(0);
      expect(cluster.marksOf(storedId)).toHaveLength(1);
      expect(cluster.row(storedId)!.isUp).toBe(false);

      const removedAtMs: number = cluster.clockMs;
      expect(
        await cluster.remove(which === "full" ? LONG_NAME : storedName),
      ).toBe("removed");
      expect(cluster.row(storedId)).toBeUndefined();
      expect(await cluster.rosterNodeNames()).toEqual(["pve1", "pve3"]);

      await cluster.pushFor(["pve1", "pve3"], MINUTE_MS);
      expect(Math.max(...cluster.reportTimesOf(storedName))).toBeLessThan(
        removedAtMs + PUSH_INTERVAL_MS,
      );
      expect(await cluster.remove(LONG_NAME)).toBe("not-found");
      expect(await cluster.remove(storedName)).toBe("not-found");
    },
  );
});
