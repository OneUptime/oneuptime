import Entities from "../../../Models/DatabaseModels/Index";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxInventorySummary,
  ProxmoxResourceLatestMetric,
} from "../../../Server/Services/ProxmoxResourceService";
import logger from "../../../Server/Utils/Logger";
import {
  PROXMOX_NODE_SILENCE_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  decideProxmoxSilentNodes,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
} from "../../../Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The Proxmox inventory's hand-written SQL, executed on Postgres against
 * the migrated "ProxmoxResource" table.
 *
 * Opt in with RUN_POSTGRES_PROXMOX_INVENTORY_TESTS=true against a database
 * the registered migrations (1796100000000-AddProxmoxResourceIsNativePush
 * included) have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_PROXMOX_INVENTORY_TESTS=true \
 *   PROXMOX_INVENTORY_TEST_DATABASE_HOST=127.0.0.1 \
 *   PROXMOX_INVENTORY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/ProxmoxResourcePostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml, right after that job has
 * applied every registered migration to an empty database. Credentials come
 * from DATABASE_USERNAME / DATABASE_PASSWORD, the database from
 * PROXMOX_INVENTORY_TEST_DATABASE_NAME or DATABASE_NAME.
 *
 * Why a real Postgres: ProxmoxResourceService writes the inventory through
 * manager.query() with statements it builds by hand - a 16-column multi-row
 * INSERT ... ON CONFLICT behind a lastSeenAt guard, an UPDATE ... FROM
 * (VALUES ...), an UPDATE over `"externalId" = ANY($3)`, and a DELETE whose
 * keep clause decides which silent Proxmox VE nodes survive the prune. The
 * unit suite fakes manager.query, so it pins the text of each statement but
 * not what Postgres does with it: whether a JavaScript array binds as a
 * text[], whether each guard compares the way its comment says, whether the
 * driver's [rows, affected] result carries the counts the callers return,
 * and whether the migrated isNativePush column is the one the statements
 * name.
 *
 * It works on a structure-only clone (LIKE ... INCLUDING ALL, so the unique
 * (projectId, proxmoxClusterId, kind, externalId) index that ON CONFLICT
 * names comes along, with the _id / createdAt / updatedAt defaults) of
 * "ProxmoxResource" in a uniquely named schema that is the connection's only
 * search_path entry and is dropped afterwards. LIKE copies no foreign key, so
 * no Project or ProxmoxCluster row is needed; every row is synthetic. The
 * production service runs unchanged - only the DataSource it resolves is
 * pointed at the clone, and the logger is muted.
 *
 * What it pins:
 *   - bulkUpsert inserts, merges a newer batch with COALESCE (a null never
 *     blanks a value), ignores an older batch outright, writes isNativePush
 *     from the batch's source and follows the latest batch, and writes more
 *     than 500 rows in chunks;
 *   - bulkUpdateLatestMetrics mirrors metrics onto existing rows only and
 *     never regresses a newer observation;
 *   - markNodesNotReporting marks exactly the named Node rows the node has
 *     not refreshed since silentBefore, binds the names as a text[], writes
 *     0 rows the second time and never moves lastSeenAt or metricsUpdatedAt;
 *     it sets isNativePush too, so a row the agent last wrote (false) or one
 *     from before the migration (NULL) - Offline already or not - is taken
 *     over as a native node and kept by the prune;
 *   - getNodeRoster lists the cluster's Node rows within the retention
 *     window, parsed back into node names;
 *   - deleteStaleForCluster prunes agent rows, guests and storage at the
 *     cutoff but keeps a native-push Node row for the retention window,
 *     whether or not it has been marked yet, and returns the pruned count;
 *     with silent-node detection off (PVE_NATIVE_NODE_SILENCE_DETECTION=
 *     false) it runs the plain two-parameter DELETE and the keep is off;
 *   - removeOfflineNode deletes an Offline Node row and nothing else;
 *   - getInventorySummary's online count follows the marks;
 *   - timelines of a native-push cluster - a node dying, a OneUptime outage,
 *     a whole-cluster power cut, a node coming back, a node already down when
 *     the cluster moved from the agent to the native push, detection switched
 *     off - where the live nodes decide with ProxmoxNativeNodeLiveness from
 *     the real roster query.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROXMOX_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "ProxmoxResource";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const OTHER_CLUSTER_ID: ObjectID = ObjectID.generate();

const SECOND_MS: number = 1_000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * The suite's clock. Every time the service compares against is a bound
 * parameter (the database clock only stamps updatedAt), so rows can sit at
 * any point relative to it.
 */
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const DETECTION_ENV: string = "PVE_NATIVE_NODE_SILENCE_DETECTION";

// Saved before the suite, cleared before every test, restored after it.
const ENV_KEYS: Array<string> = [
  "PVE_SILENT_NODE_RETENTION_HOURS",
  "PVE_INVENTORY_STALE_MINUTES",
  DETECTION_ENV,
];

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

// A row as Postgres stores it (numeric and bigint come back as text).
interface ResourceRow {
  _id: string;
  kind: string;
  externalId: string;
  name: string | null;
  vmid: number | null;
  guestType: string | null;
  parentNodeName: string | null;
  isUp: boolean | null;
  haState: string | null;
  onboot: boolean | null;
  isBackedUp: boolean | null;
  uptimeSeconds: number | null;
  lastSeenAt: Date;
  isNativePush: boolean | null;
  latestCpuPercent: string | null;
  latestMemoryBytes: string | null;
  maxMemoryBytes: string | null;
  latestMemoryPercent: string | null;
  latestDiskBytes: string | null;
  maxDiskBytes: string | null;
  metricsUpdatedAt: Date | null;
  deletedAt: Date | null;
  version: number;
  // updatedAt to the microsecond - a JavaScript Date keeps milliseconds only.
  updatedAtText: string;
}

// Exactly the columns of ResourceRow.
const ROW_COLUMNS: string = `"_id", "kind", "externalId", "name", "vmid", "guestType",
  "parentNodeName", "isUp", "haState", "onboot", "isBackedUp", "uptimeSeconds",
  "lastSeenAt", "isNativePush", "latestCpuPercent", "latestMemoryBytes",
  "maxMemoryBytes", "latestMemoryPercent", "latestDiskBytes", "maxDiskBytes",
  "metricsUpdatedAt", "deletedAt", "version", "updatedAt"::text AS "updatedAtText"`;

function node(
  name: string,
  overrides: Partial<ParsedProxmoxResource> = {},
): ParsedProxmoxResource {
  return {
    kind: "Node",
    externalId: `node/${name}`,
    name: name,
    vmid: null,
    guestType: null,
    parentNodeName: null,
    isUp: true,
    haState: null,
    onboot: null,
    isBackedUp: null,
    uptimeSeconds: 86400,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function guest(
  vmid: number,
  parentNodeName: string,
  overrides: Partial<ParsedProxmoxResource> = {},
): ParsedProxmoxResource {
  return {
    kind: "Guest",
    externalId: `qemu/${vmid}`,
    name: `vm-${vmid}`,
    vmid: vmid,
    guestType: "qemu",
    parentNodeName: parentNodeName,
    isUp: true,
    haState: "started",
    onboot: true,
    isBackedUp: true,
    uptimeSeconds: 3600,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function storage(
  nodeName: string,
  storageName: string,
  overrides: Partial<ParsedProxmoxResource> = {},
): ParsedProxmoxResource {
  return {
    kind: "Storage",
    externalId: `storage/${nodeName}/${storageName}`,
    name: storageName,
    vmid: null,
    guestType: null,
    parentNodeName: nodeName,
    isUp: true,
    haState: null,
    onboot: null,
    isBackedUp: null,
    uptimeSeconds: null,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function nodeMetric(
  nodeName: string,
  overrides: Partial<ProxmoxResourceLatestMetric> = {},
): ProxmoxResourceLatestMetric {
  return {
    kind: "Node",
    externalId: `node/${nodeName}`,
    cpuPercent: 12.5,
    memoryBytes: 8 * 1024 * 1024 * 1024,
    maxMemoryBytes: 64 * 1024 * 1024 * 1024,
    memoryPercent: 12.5,
    diskBytes: 20 * 1024 * 1024 * 1024,
    maxDiskBytes: 100 * 1024 * 1024 * 1024,
    observedAt: NOW,
    ...overrides,
  };
}

function externalIdsOf(rows: Array<ResourceRow>): Array<string> {
  return rows.map((row: ResourceRow): string => {
    return row.externalId;
  });
}

function rosterOf(
  roster: Array<ProxmoxRosterNode>,
): Array<{ nodeName: string; lastSeenAt: number }> {
  return roster
    .map(
      (entry: ProxmoxRosterNode): { nodeName: string; lastSeenAt: number } => {
        expect(entry.lastSeenAt).toBeInstanceOf(Date);
        return {
          nodeName: entry.nodeName,
          lastSeenAt: entry.lastSeenAt.getTime(),
        };
      },
    )
    .sort(
      (
        a: { nodeName: string; lastSeenAt: number },
        b: { nodeName: string; lastSeenAt: number },
      ): number => {
        return a.nodeName.localeCompare(b.nodeName);
      },
    );
}

/*
 * A Proxmox VE cluster on the native push, on a simulated clock that moves
 * in 10 s steps. Each live node pushes its own status (its Node row, its
 * guests and its storage) every 30 s, the nodes a step apart, the way the
 * ingest handles such a push: the node's liveness advances on OneUptime's
 * receive clock (nextProxmoxNodeLiveness - what the Redis key holds; a key
 * past its expiry reads the same as a stale one to every check), the roster
 * is read with the real getNodeRoster and the node decides with the real
 * decideProxmoxSilentNodes, then the flush upserts its batch as a native
 * push, mirrors its node metrics, and marks the nodes it reported with the
 * real markNodesNotReporting (silentBefore = its push time minus the silence
 * window). There is no clock skew: a node's push time is the time OneUptime
 * processes it. With silent-node detection switched off
 * (PVE_NATIVE_NODE_SILENCE_DETECTION=false) the ingest returns before any of
 * the liveness, roster or report work, and so does the simulator: the push
 * is upserted and mirrored, nothing else.
 *
 * Every 5 minutes the cleanup worker ticks, after that step's push: while
 * the cluster has been seen within 15 minutes it is connected and pruned
 * with the cutoff anchored to its last push (getStaleThresholdDate), and a
 * disconnected cluster is skipped. The simulated clock is handed to the
 * prune as `now`, so the retention window is measured on it. The cluster's
 * lastSeenAt is modelled as its last processed push (the ingest's 5-minute
 * fence on that write is left out). While OneUptime is out, no push is
 * processed and every one of them is lost.
 */
const STEP_MS: number = 10 * SECOND_MS;
const PUSH_EVERY_STEPS: number = 3;
const TICK_EVERY_STEPS: number = 30;
const DISCONNECTED_AFTER_MS: number = 15 * MINUTE_MS;

interface SimulatedNode {
  name: string;
  vmids: Array<number>;
  alive: boolean;
  bootMs: number;
}

interface MarkRecord {
  atMs: number;
  reporter: string;
  nodeNames: Array<string>;
  written: number;
}

interface TickRecord {
  atMs: number;
  // null: the cluster was disconnected, so the tick skipped it.
  deleted: number | null;
}

class NativeClusterSimulator {
  public readonly proxmoxClusterId: ObjectID = ObjectID.generate();
  public readonly startMs: number;
  public clockMs: number;
  public outage: boolean = false;
  public clusterLastSeenMs: number | null = null;
  public readonly marks: Array<MarkRecord> = [];
  public readonly ticks: Array<TickRecord> = [];

  private nextStepMs: number;
  private readonly nodes: Array<SimulatedNode> = [];
  private readonly liveness: Map<string, ProxmoxNodeLiveness> = new Map();

  public constructor(
    startMs: number,
    nodes: Array<{ name: string; vmids: Array<number> }>,
  ) {
    // One node per step of a push interval: each pushes every 30 s.
    if (nodes.length !== PUSH_EVERY_STEPS) {
      throw new Error(`The simulator runs ${PUSH_EVERY_STEPS} nodes`);
    }
    this.startMs = startMs;
    this.clockMs = startMs;
    this.nextStepMs = startMs;
    for (const entry of nodes) {
      this.nodes.push({
        name: entry.name,
        vmids: entry.vmids,
        alive: true,
        bootMs: startMs - DAY_MS,
      });
    }
  }

  // Minutes and seconds after the start, in epoch ms.
  public time(minutes: number, seconds: number = 0): number {
    return this.startMs + minutes * MINUTE_MS + seconds * SECOND_MS;
  }

  public setAlive(nodeName: string, alive: boolean): void {
    const simulated: SimulatedNode | undefined = this.nodes.find(
      (candidate: SimulatedNode): boolean => {
        return candidate.name === nodeName;
      },
    );
    if (!simulated) {
      throw new Error(`No simulated node ${nodeName}`);
    }
    if (alive && !simulated.alive) {
      simulated.bootMs = this.clockMs;
    }
    simulated.alive = alive;
  }

  // Every step up to and including untilMs.
  public async runUntil(untilMs: number): Promise<void> {
    while (this.nextStepMs <= untilMs) {
      this.clockMs = this.nextStepMs;
      await this.step();
      this.nextStepMs += STEP_MS;
    }
  }

  public marksSince(fromMs: number): Array<MarkRecord> {
    return this.marks.filter((mark: MarkRecord): boolean => {
      return mark.atMs >= fromMs;
    });
  }

  public rowsWritten(): number {
    return this.marks.reduce((sum: number, mark: MarkRecord): number => {
      return sum + mark.written;
    }, 0);
  }

  private async step(): Promise<void> {
    const stepIndex: number = Math.round(
      (this.clockMs - this.startMs) / STEP_MS,
    );
    // Node i pushes on the steps i, i + 3, i + 6, ...
    const pusher: SimulatedNode | undefined =
      this.nodes[stepIndex % PUSH_EVERY_STEPS];
    if (pusher && pusher.alive && !this.outage) {
      await this.push(pusher);
    }
    if (stepIndex % TICK_EVERY_STEPS === 0) {
      await this.tick();
    }
  }

  private async push(pusher: SimulatedNode): Promise<void> {
    const nowMs: number = this.clockMs;
    const decision: ProxmoxSilentNodeDecision | null =
      isProxmoxSilentNodeDetectionEnabled()
        ? await this.recordPushAndDecide(pusher, nowMs)
        : null;

    const seenAt: Date = new Date(nowMs);
    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: this.proxmoxClusterId,
      resources: [
        node(pusher.name, {
          uptimeSeconds: Math.floor((nowMs - pusher.bootMs) / SECOND_MS),
          lastSeenAt: seenAt,
        }),
        ...pusher.vmids.map((vmid: number): ParsedProxmoxResource => {
          return guest(vmid, pusher.name, { lastSeenAt: seenAt });
        }),
        storage(pusher.name, "local", { lastSeenAt: seenAt }),
      ],
      isNativePush: true,
    });
    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: this.proxmoxClusterId,
      metrics: [nodeMetric(pusher.name, { observedAt: seenAt })],
    });
    this.clusterLastSeenMs = nowMs;

    if (decision) {
      const written: number =
        await ProxmoxResourceService.markNodesNotReporting({
          projectId: PROJECT_ID,
          proxmoxClusterId: this.proxmoxClusterId,
          nodeNames: decision.silentNodes,
          silentBefore: new Date(nowMs - PROXMOX_NODE_SILENCE_MS),
        });
      this.marks.push({
        atMs: nowMs,
        reporter: pusher.name,
        nodeNames: decision.silentNodes,
        written: written,
      });
    }
  }

  // The report is decided while the batch is parsed, before its flush.
  private async recordPushAndDecide(
    pusher: SimulatedNode,
    nowMs: number,
  ): Promise<ProxmoxSilentNodeDecision | null> {
    const previous: ProxmoxNodeLiveness | null =
      this.liveness.get(pusher.name) || null;
    this.liveness.set(pusher.name, nextProxmoxNodeLiveness(previous, nowMs));

    const roster: Array<ProxmoxRosterNode> =
      await ProxmoxResourceService.getNodeRoster({
        projectId: PROJECT_ID,
        proxmoxClusterId: this.proxmoxClusterId,
        now: new Date(nowMs),
      });
    const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map(
      this.liveness,
    );
    return decideProxmoxSilentNodes({
      selfNode: pusher.name,
      reporterTimeMs: nowMs,
      nowMs: nowMs,
      roster: roster,
      liveness: liveness,
    });
  }

  private async tick(): Promise<void> {
    if (this.clusterLastSeenMs === null) {
      return;
    }
    if (this.clusterLastSeenMs < this.clockMs - DISCONNECTED_AFTER_MS) {
      this.ticks.push({ atMs: this.clockMs, deleted: null });
      return;
    }
    const deleted: number = await ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: this.proxmoxClusterId,
      olderThan: ProxmoxResourceService.getStaleThresholdDate(
        new Date(this.clusterLastSeenMs),
      ),
      now: new Date(this.clockMs),
    });
    this.ticks.push({ atMs: this.clockMs, deleted: deleted });
  }
}

const THREE_NODES: Array<{ name: string; vmids: Array<number> }> = [
  { name: "pve1", vmids: [100, 101] },
  { name: "pve2", vmids: [200] },
  { name: "pve3", vmids: [300, 301] },
];

// The simulated timelines start well before NOW; nothing reads the wall clock.
const TIMELINE_START_MS: number = NOW.getTime() - 6 * HOUR_MS;

describePostgres("Proxmox inventory SQL against a migrated Postgres", () => {
  const schema: string = `proxmox_inventory_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  let warn: jest.SpyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  async function upsert(
    resources: Array<ParsedProxmoxResource>,
    options: {
      isNativePush?: boolean | undefined;
      proxmoxClusterId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    } = {},
  ): Promise<void> {
    await ProxmoxResourceService.bulkUpsert({
      projectId: options.projectId || PROJECT_ID,
      proxmoxClusterId: options.proxmoxClusterId || CLUSTER_ID,
      resources: resources,
      isNativePush: options.isNativePush,
    });
  }

  async function mark(
    nodeNames: Array<string>,
    silentBefore: Date,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<number> {
    return ProxmoxResourceService.markNodesNotReporting({
      projectId: PROJECT_ID,
      proxmoxClusterId: proxmoxClusterId,
      nodeNames: nodeNames,
      silentBefore: silentBefore,
    });
  }

  async function prune(
    options: {
      olderThan?: Date | undefined;
      now?: Date | undefined;
      proxmoxClusterId?: ObjectID | undefined;
    } = {},
  ): Promise<number> {
    return ProxmoxResourceService.deleteStaleForCluster({
      proxmoxClusterId: options.proxmoxClusterId || CLUSTER_ID,
      olderThan:
        options.olderThan || ProxmoxResourceService.getStaleThresholdDate(NOW),
      now: options.now || NOW,
    });
  }

  async function readRows(
    proxmoxClusterId: ObjectID = CLUSTER_ID,
    projectId: ObjectID = PROJECT_ID,
  ): Promise<Array<ResourceRow>> {
    return database.query(
      `SELECT ${ROW_COLUMNS}
       FROM "${schema}"."${TABLE}"
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
       ORDER BY "kind", "externalId"`,
      [projectId.toString(), proxmoxClusterId.toString()],
    );
  }

  async function rowOf(
    externalId: string,
    options: {
      kind?: string | undefined;
      proxmoxClusterId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    } = {},
  ): Promise<ResourceRow | undefined> {
    const rows: Array<ResourceRow> = await database.query(
      `SELECT ${ROW_COLUMNS}
       FROM "${schema}"."${TABLE}"
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = $3 AND "externalId" = $4`,
      [
        (options.projectId || PROJECT_ID).toString(),
        (options.proxmoxClusterId || CLUSTER_ID).toString(),
        options.kind || "Node",
        externalId,
      ],
    );
    expect(rows.length).toBeLessThanOrEqual(1);
    return rows[0];
  }

  async function nodeRow(
    nodeName: string,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<ResourceRow> {
    const row: ResourceRow | undefined = await rowOf(`node/${nodeName}`, {
      proxmoxClusterId: proxmoxClusterId,
    });
    expect(row).toBeDefined();
    return row!;
  }

  async function countRows(): Promise<number> {
    const rows: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM "${schema}"."${TABLE}"`,
    );
    return rows[0]!.count;
  }

  /*
   * A row written before the migration: isNativePush is left out, so it
   * reads the column's (absent) default.
   */
  async function insertLegacyRow(
    kind: string,
    externalId: string,
    lastSeenAt: Date,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."${TABLE}"
         ("projectId", "proxmoxClusterId", "kind", "externalId", "isUp", "lastSeenAt", "version")
       VALUES ($1, $2, $3, $4, true, $5, 0)`,
      [
        PROJECT_ID.toString(),
        proxmoxClusterId.toString(),
        kind,
        externalId,
        lastSeenAt,
      ],
    );
  }

  /*
   * Write the batch from the given source: true / false as the native push /
   * the agent writes it, NULL as a row written before the migration reads
   * (the batch lands as the agent's, then the column is cleared).
   */
  async function upsertFrom(
    isNativePush: boolean | null,
    resources: Array<ParsedProxmoxResource>,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    await upsert(resources, {
      isNativePush: isNativePush === true,
      proxmoxClusterId: proxmoxClusterId,
    });
    if (isNativePush !== null) {
      return;
    }
    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "isNativePush" = NULL
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND ("kind", "externalId") IN
           (SELECT * FROM unnest($3::text[], $4::text[]))`,
      [
        PROJECT_ID.toString(),
        proxmoxClusterId.toString(),
        resources.map((resource: ParsedProxmoxResource): string => {
          return resource.kind;
        }),
        resources.map((resource: ParsedProxmoxResource): string => {
          return resource.externalId;
        }),
      ],
    );
  }

  async function softDelete(kind: string, externalId: string): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "deletedAt" = now()
       WHERE "proxmoxClusterId" = $1 AND "kind" = $2 AND "externalId" = $3`,
      [CLUSTER_ID.toString(), kind, externalId],
    );
  }

  async function summary(
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<ProxmoxInventorySummary> {
    return ProxmoxResourceService.getInventorySummary({
      projectId: PROJECT_ID,
      proxmoxClusterId: proxmoxClusterId,
    });
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }

    database = new DataSource({
      type: "postgres",
      host: process.env["PROXMOX_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROXMOX_INVENTORY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROXMOX_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    for (const level of ["debug", "info"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    warn = jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    /*
     * Runs even when beforeAll failed after CREATE SCHEMA; the pool is closed
     * whether or not the drop succeeds.
     */
    if (database?.isInitialized) {
      try {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.destroy();
      }
    }
  });

  describe("the migrated table", () => {
    test("isNativePush is a nullable boolean with no default, and the clone carries the unique identity index", async () => {
      const columns: Array<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'isNativePush'`,
        [TABLE],
      );
      expect(columns).toEqual([
        { data_type: "boolean", is_nullable: "YES", column_default: null },
      ]);

      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = $1 AND tablename = $2 AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
        [schema, TABLE],
      );
      expect(
        indexes.some((index: { indexdef: string }): boolean => {
          return index.indexdef.includes(
            '("projectId", "proxmoxClusterId", kind, "externalId")',
          );
        }),
      ).toBe(true);
    });

    test("the model reads the column the service writes", async () => {
      await upsert([node("pve1")], { isNativePush: true });
      await upsert([node("pve9")], {
        isNativePush: false,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });

      const found: Array<ProxmoxResource> = await ProxmoxResourceService.findBy(
        {
          query: { projectId: PROJECT_ID, kind: "Node" },
          select: { externalId: true, isNativePush: true },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        },
      );

      expect(
        found
          .map((resource: ProxmoxResource): [string, unknown] => {
            return [resource.externalId!, resource.isNativePush];
          })
          .sort(),
      ).toEqual([
        ["node/pve1", true],
        ["node/pve9", false],
      ]);
    });
  });

  describe("bulkUpsert", () => {
    test("inserts a batch with every column in place and isNativePush from the batch's source", async () => {
      await upsert(
        [
          node("pve1"),
          guest(100, "pve1", { uptimeSeconds: 3600.9 }),
          storage("pve1", "local"),
        ],
        { isNativePush: true },
      );

      const rows: Array<ResourceRow> = await readRows();
      expect(
        rows.map((row: ResourceRow): Partial<ResourceRow> => {
          return {
            kind: row.kind,
            externalId: row.externalId,
            name: row.name,
            vmid: row.vmid,
            guestType: row.guestType,
            parentNodeName: row.parentNodeName,
            isUp: row.isUp,
            haState: row.haState,
            onboot: row.onboot,
            isBackedUp: row.isBackedUp,
            uptimeSeconds: row.uptimeSeconds,
            lastSeenAt: row.lastSeenAt,
            isNativePush: row.isNativePush,
            metricsUpdatedAt: row.metricsUpdatedAt,
            deletedAt: row.deletedAt,
            version: row.version,
          };
        }),
      ).toEqual([
        {
          kind: "Guest",
          externalId: "qemu/100",
          name: "vm-100",
          vmid: 100,
          guestType: "qemu",
          parentNodeName: "pve1",
          isUp: true,
          haState: "started",
          onboot: true,
          isBackedUp: true,
          // Truncated, not rounded.
          uptimeSeconds: 3600,
          lastSeenAt: NOW,
          isNativePush: true,
          metricsUpdatedAt: null,
          deletedAt: null,
          version: 0,
        },
        {
          kind: "Node",
          externalId: "node/pve1",
          name: "pve1",
          vmid: null,
          guestType: null,
          parentNodeName: null,
          isUp: true,
          haState: null,
          onboot: null,
          isBackedUp: null,
          uptimeSeconds: 86400,
          lastSeenAt: NOW,
          isNativePush: true,
          metricsUpdatedAt: null,
          deletedAt: null,
          version: 0,
        },
        {
          kind: "Storage",
          externalId: "storage/pve1/local",
          name: "local",
          vmid: null,
          guestType: null,
          parentNodeName: "pve1",
          isUp: true,
          haState: null,
          onboot: null,
          isBackedUp: null,
          uptimeSeconds: null,
          lastSeenAt: NOW,
          isNativePush: true,
          metricsUpdatedAt: null,
          deletedAt: null,
          version: 0,
        },
      ]);
      for (const row of rows) {
        expect(row._id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    test("an agent batch writes isNativePush false, and so does a batch that does not say - never NULL", async () => {
      await upsert([node("agent1")], { isNativePush: false });
      await upsert([node("unsaid")]);

      expect((await nodeRow("agent1")).isNativePush).toBe(false);
      expect((await nodeRow("unsaid")).isNativePush).toBe(false);

      // A row from before the migration reads NULL until its next batch.
      await insertLegacyRow("Node", "node/legacy", at(-MINUTE_MS));
      expect((await nodeRow("legacy")).isNativePush).toBeNull();
      await upsert([node("legacy")], { isNativePush: true });
      expect((await nodeRow("legacy")).isNativePush).toBe(true);
    });

    test("a newer batch merges: COALESCE keeps what its nulls would blank, and lastSeenAt, isUp and isNativePush follow it", async () => {
      await upsert(
        [node("pve1", { haState: "online", onboot: true }), guest(100, "pve1")],
        { isNativePush: false },
      );
      const before: ResourceRow = await nodeRow("pve1");

      await upsert(
        [
          node("pve1", {
            name: null,
            haState: null,
            onboot: null,
            uptimeSeconds: null,
            isUp: false,
            lastSeenAt: at(MINUTE_MS),
          }),
          guest(100, "pve1", {
            name: null,
            vmid: null,
            guestType: null,
            parentNodeName: null,
            isBackedUp: null,
            isUp: false,
            lastSeenAt: at(MINUTE_MS),
          }),
        ],
        { isNativePush: true },
      );

      const after: ResourceRow = await nodeRow("pve1");
      expect(after._id).toBe(before._id);
      expect(after.name).toBe("pve1");
      expect(after.haState).toBe("online");
      expect(after.onboot).toBe(true);
      expect(after.uptimeSeconds).toBe(86400);
      expect(after.isUp).toBe(false);
      expect(after.lastSeenAt).toEqual(at(MINUTE_MS));
      expect(after.isNativePush).toBe(true);
      expect(after.version).toBe(0);
      expect(after.updatedAtText).not.toBe(before.updatedAtText);

      const guestRow: ResourceRow | undefined = await rowOf("qemu/100", {
        kind: "Guest",
      });
      expect(guestRow).toMatchObject({
        name: "vm-100",
        vmid: 100,
        guestType: "qemu",
        parentNodeName: "pve1",
        isBackedUp: true,
        isUp: false,
        isNativePush: true,
      });
      expect(await countRows()).toBe(2);
    });

    test("an older batch changes nothing - not isUp, not isNativePush, not updatedAt - and a batch as old as the row applies", async () => {
      await upsert([node("pve1", { lastSeenAt: at(MINUTE_MS) })], {
        isNativePush: true,
      });
      const newest: ResourceRow = await nodeRow("pve1");

      await upsert(
        [
          node("pve1", {
            name: "stale-name",
            isUp: false,
            uptimeSeconds: 5,
            lastSeenAt: at(MINUTE_MS - 1),
          }),
        ],
        { isNativePush: false },
      );

      expect(await nodeRow("pve1")).toEqual(newest);

      await upsert([node("pve1", { isUp: false, lastSeenAt: at(MINUTE_MS) })], {
        isNativePush: false,
      });
      const same: ResourceRow = await nodeRow("pve1");
      expect(same.isUp).toBe(false);
      expect(same.isNativePush).toBe(false);
      expect(same.updatedAtText).not.toBe(newest.updatedAtText);
    });

    test("isNativePush follows the latest batch - a cluster moved from the agent to the native push and back", async () => {
      await upsert([node("pve1", { lastSeenAt: at(-3 * MINUTE_MS) })], {
        isNativePush: false,
      });
      await upsert([node("pve1", { lastSeenAt: at(-2 * MINUTE_MS) })], {
        isNativePush: true,
      });
      expect((await nodeRow("pve1")).isNativePush).toBe(true);

      await upsert([node("pve1", { lastSeenAt: at(-MINUTE_MS) })], {
        isNativePush: false,
      });
      expect((await nodeRow("pve1")).isNativePush).toBe(false);

      // A late native batch older than the agent's does not flip it back.
      await upsert([node("pve1", { lastSeenAt: at(-90 * SECOND_MS) })], {
        isNativePush: true,
      });
      expect((await nodeRow("pve1")).isNativePush).toBe(false);

      // The flag is per batch: another cluster's rows are not touched.
      await upsert([node("pve1")], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      expect((await nodeRow("pve1")).isNativePush).toBe(false);
      expect((await nodeRow("pve1", OTHER_CLUSTER_ID)).isNativePush).toBe(true);
    });

    test("a batch of more than 500 rows is written in chunks - every row once, the flag on each - and the mirror and the prune handle it too", async () => {
      const count: number = 1201;
      const vmids: Array<number> = Array.from(
        { length: count },
        (_: unknown, index: number): number => {
          return 1000 + index;
        },
      );

      await upsert(
        vmids.map((vmid: number): ParsedProxmoxResource => {
          return guest(vmid, "pve1", { lastSeenAt: at(-20 * MINUTE_MS) });
        }),
        { isNativePush: true },
      );
      const flags: Array<{ isNativePush: boolean; count: number }> =
        await database.query(
          `SELECT "isNativePush", COUNT(*)::int AS "count"
           FROM "${schema}"."${TABLE}" GROUP BY "isNativePush"`,
        );
      expect(flags).toEqual([{ isNativePush: true, count: count }]);

      // The same identities again, newer: every row is updated in place.
      await upsert(
        vmids.map((vmid: number): ParsedProxmoxResource => {
          return guest(vmid, "pve1", {
            isUp: false,
            lastSeenAt: at(-16 * MINUTE_MS),
          });
        }),
        { isNativePush: false },
      );
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: vmids.map(
          (vmid: number, index: number): ProxmoxResourceLatestMetric => {
            return {
              kind: "Guest",
              externalId: `qemu/${vmid}`,
              cpuPercent: index % 100,
              memoryBytes: null,
              maxMemoryBytes: null,
              memoryPercent: null,
              diskBytes: null,
              maxDiskBytes: null,
              observedAt: at(-16 * MINUTE_MS),
            };
          },
        ),
      });

      const rows: Array<ResourceRow> = await readRows();
      expect(rows).toHaveLength(count);
      rows.forEach((row: ResourceRow) => {
        const index: number = Number(row.vmid) - 1000;
        expect(row.externalId).toBe(`qemu/${row.vmid}`);
        expect(row.isUp).toBe(false);
        expect(row.isNativePush).toBe(false);
        expect(row.lastSeenAt).toEqual(at(-16 * MINUTE_MS));
        expect(Number(row.latestCpuPercent)).toBe(index % 100);
        expect(row.metricsUpdatedAt).toEqual(at(-16 * MINUTE_MS));
      });

      // The driver's affected count survives a large delete.
      expect(await prune()).toBe(count);
      expect(await countRows()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`deleted ${count} stale rows`),
      );
    }, 60_000);
  });

  describe("bulkUpdateLatestMetrics", () => {
    test("mirrors onto existing rows only, keeps a missing series NULL, and never regresses a newer observation", async () => {
      await upsert(
        [node("pve1", { lastSeenAt: at(-MINUTE_MS) }), guest(100, "pve1")],
        { isNativePush: true },
      );
      const identity: ResourceRow = await nodeRow("pve1");

      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [
          nodeMetric("pve1", { memoryBytes: 1024.9, observedAt: at(0) }),
          {
            kind: "Guest",
            externalId: "qemu/100",
            cpuPercent: 3.25,
            memoryBytes: 512,
            maxMemoryBytes: 2048,
            memoryPercent: 25,
            // qemu without the guest agent: no disk usage series.
            diskBytes: null,
            maxDiskBytes: 32 * 1024 * 1024 * 1024,
            observedAt: at(0),
          },
          nodeMetric("never-upserted"),
        ],
      });

      const nodeAfter: ResourceRow = await nodeRow("pve1");
      expect(Number(nodeAfter.latestCpuPercent)).toBe(12.5);
      expect(nodeAfter.latestMemoryBytes).toBe("1024");
      expect(nodeAfter.maxMemoryBytes).toBe(String(64 * 1024 * 1024 * 1024));
      expect(Number(nodeAfter.latestMemoryPercent)).toBe(12.5);
      expect(nodeAfter.latestDiskBytes).toBe(String(20 * 1024 * 1024 * 1024));
      expect(nodeAfter.metricsUpdatedAt).toEqual(at(0));
      // The mirror leaves identity and status alone.
      expect(nodeAfter.lastSeenAt).toEqual(identity.lastSeenAt);
      expect(nodeAfter.isUp).toBe(true);
      expect(nodeAfter.isNativePush).toBe(true);

      const guestAfter: ResourceRow | undefined = await rowOf("qemu/100", {
        kind: "Guest",
      });
      expect(guestAfter?.latestDiskBytes).toBeNull();
      expect(guestAfter?.maxDiskBytes).toBe(String(32 * 1024 * 1024 * 1024));
      expect(await countRows()).toBe(2);

      // Older: nothing changes.
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [
          nodeMetric("pve1", { cpuPercent: 99, observedAt: at(-SECOND_MS) }),
        ],
      });
      expect(Number((await nodeRow("pve1")).latestCpuPercent)).toBe(12.5);

      // Newer without a series: that column keeps its value.
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [
          nodeMetric("pve1", {
            cpuPercent: null,
            diskBytes: null,
            memoryBytes: 2048,
            observedAt: at(MINUTE_MS),
          }),
        ],
      });
      const newest: ResourceRow = await nodeRow("pve1");
      expect(Number(newest.latestCpuPercent)).toBe(12.5);
      expect(newest.latestDiskBytes).toBe(String(20 * 1024 * 1024 * 1024));
      expect(newest.latestMemoryBytes).toBe("2048");
      expect(newest.metricsUpdatedAt).toEqual(at(MINUTE_MS));
    });
  });

  describe("markNodesNotReporting", () => {
    test("marks exactly the named Node rows of this project and cluster Offline, and never moves lastSeenAt or metricsUpdatedAt", async () => {
      const lastPush: Date = at(-3 * MINUTE_MS);
      await upsert(
        [
          node("pve1", { lastSeenAt: lastPush }),
          node("pve2", { lastSeenAt: lastPush }),
          node("pve3", { lastSeenAt: lastPush }),
          guest(300, "pve3", { lastSeenAt: lastPush }),
        ],
        { isNativePush: true },
      );
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [nodeMetric("pve3", { observedAt: lastPush })],
      });
      await upsert([node("pve3", { lastSeenAt: lastPush })], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      await upsert([node("pve3", { lastSeenAt: lastPush })], {
        isNativePush: true,
        projectId: OTHER_PROJECT_ID,
      });
      const before: ResourceRow = await nodeRow("pve3");

      // Reported a minute after the silence window ran out.
      expect(await mark(["pve3"], at(-MINUTE_MS))).toBe(1);

      const after: ResourceRow = await nodeRow("pve3");
      expect(after).toEqual({
        ...before,
        isUp: false,
        uptimeSeconds: null,
        updatedAtText: after.updatedAtText,
      });
      expect(after.updatedAtText).not.toBe(before.updatedAtText);
      expect(after.lastSeenAt).toEqual(lastPush);
      expect(after.metricsUpdatedAt).toEqual(lastPush);
      expect(after.isNativePush).toBe(true);

      expect((await nodeRow("pve1")).isUp).toBe(true);
      expect((await nodeRow("pve2")).isUp).toBe(true);
      expect((await rowOf("qemu/300", { kind: "Guest" }))?.isUp).toBe(true);
      expect((await nodeRow("pve3", OTHER_CLUSTER_ID)).isUp).toBe(true);
      expect(
        (await rowOf("node/pve3", { projectId: OTHER_PROJECT_ID }))?.isUp,
      ).toBe(true);
    });

    test("binds the names as a text[] for ANY($3): several at once, unknown names ignored, array-literal characters kept literally", async () => {
      const odd: Array<string> = [
        "pve'4",
        'pve"5',
        "pve,6",
        "{pve7}",
        "pve\\8",
        "pve 9",
      ];
      await upsert(
        [
          node("pve1", { lastSeenAt: at(-10 * MINUTE_MS) }),
          node("pve2", { lastSeenAt: at(-10 * MINUTE_MS) }),
          ...odd.map((name: string): ParsedProxmoxResource => {
            return node(name, { lastSeenAt: at(-10 * MINUTE_MS) });
          }),
        ],
        { isNativePush: true },
      );

      expect(
        await mark(["pve2", ...odd, "ghost", "pve"], at(-5 * MINUTE_MS)),
      ).toBe(1 + odd.length);

      const offline: Array<string> = externalIdsOf(
        (await readRows()).filter((row: ResourceRow): boolean => {
          return row.isUp === false;
        }),
      );
      expect(offline.sort()).toEqual(
        [
          "node/pve2",
          ...odd.map((name: string): string => {
            return `node/${name}`;
          }),
        ].sort(),
      );
      expect((await nodeRow("pve1")).isUp).toBe(true);
    });

    test("a row the node refreshed at or after silentBefore is left alone", async () => {
      const silentBefore: Date = at(-2 * MINUTE_MS);
      await upsert(
        [
          node("exactly", { lastSeenAt: silentBefore }),
          node("just-before", {
            lastSeenAt: new Date(silentBefore.getTime() - 1),
          }),
          node("after", { lastSeenAt: at(0) }),
        ],
        { isNativePush: true },
      );

      expect(
        await mark(["exactly", "just-before", "after"], silentBefore),
      ).toBe(1);
      expect((await nodeRow("exactly")).isUp).toBe(true);
      expect((await nodeRow("just-before")).isUp).toBe(false);
      expect((await nodeRow("after")).isUp).toBe(true);
    });

    test("is idempotent: the second report writes 0 rows and leaves updatedAt as the first set it", async () => {
      await upsert([node("pve3", { lastSeenAt: at(-5 * MINUTE_MS) })], {
        isNativePush: true,
      });

      expect(await mark(["pve3"], at(-3 * MINUTE_MS))).toBe(1);
      const first: ResourceRow = await nodeRow("pve3");

      expect(await mark(["pve3"], at(-3 * MINUTE_MS))).toBe(0);
      // A later report (a later silentBefore) is no different.
      expect(await mark(["pve3"], at(0))).toBe(0);

      expect(await nodeRow("pve3")).toEqual(first);
    });

    test("a native Offline row is not rewritten, a NULL isUp is marked, a soft-deleted row is not, and no names write nothing", async () => {
      await upsert(
        [
          // Its own last batch already said it was down.
          node("down", { isUp: false, uptimeSeconds: 42 }),
          // A batch that lacked pve_up.
          node("unknown", { isUp: null }),
          node("deleted"),
        ],
        { isNativePush: true },
      );
      await softDelete("Node", "node/deleted");
      const down: ResourceRow = await nodeRow("down");

      expect(await mark(["down", "unknown", "deleted"], at(MINUTE_MS))).toBe(1);
      expect(await nodeRow("down")).toEqual(down);
      expect((await nodeRow("unknown")).isUp).toBe(false);
      expect((await nodeRow("deleted")).isUp).toBe(true);

      expect(await mark([], at(MINUTE_MS))).toBe(0);
    });

    /*
     * A node the native pushes report is a member of a native-push cluster.
     * One already down when the cluster moved from the agent to the native
     * push carries isNativePush false from the agent's last batch, one that
     * died before the migration NULL - and, already Offline, it used to be
     * skipped by the mark, stay a non-native row, and be pruned at the
     * 15-minute cutoff while still down.
     */
    test.each<{ source: string; isNativePush: boolean | null }>([
      {
        source: "the agent last wrote (isNativePush false)",
        isNativePush: false,
      },
      {
        source: "from before the migration (isNativePush NULL)",
        isNativePush: null,
      },
    ])(
      "a Node row $source is taken over as native, Offline already or not - nothing else moves, it survives the prune, and the second report writes 0 rows",
      async (row: { source: string; isNativePush: boolean | null }) => {
        const stale: Date = at(-20 * MINUTE_MS);
        const silentBefore: Date = at(-2 * MINUTE_MS);
        await upsertFrom(row.isNativePush, [
          // Down in the agent's last batch.
          node("down", { isUp: false, uptimeSeconds: null, lastSeenAt: stale }),
          // Up in the agent's last batch, then died.
          node("up", { lastSeenAt: stale }),
          // Refreshed after silentBefore: a late report never touches it.
          node("fresh", { isUp: false, lastSeenAt: at(0) }),
          node("deleted", { isUp: false, lastSeenAt: stale }),
          // Not reported: stays what it was and ages out.
          node("unnamed", { isUp: false, lastSeenAt: stale }),
        ]);
        await ProxmoxResourceService.bulkUpdateLatestMetrics({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          metrics: [nodeMetric("down", { observedAt: stale })],
        });
        await softDelete("Node", "node/deleted");
        const before: Array<ResourceRow> = await readRows();
        expect(
          before.map((resource: ResourceRow): boolean | null => {
            return resource.isNativePush;
          }),
        ).toEqual([
          row.isNativePush,
          row.isNativePush,
          row.isNativePush,
          row.isNativePush,
          row.isNativePush,
        ]);
        const downBefore: ResourceRow = await nodeRow("down");
        const reported: Array<string> = ["down", "up", "fresh", "deleted"];

        expect(await mark(reported, silentBefore)).toBe(2);

        // Only the source changes: isUp was false already, and stays so.
        const downAfter: ResourceRow = await nodeRow("down");
        expect(downAfter).toEqual({
          ...downBefore,
          isNativePush: true,
          updatedAtText: downAfter.updatedAtText,
        });
        expect(downAfter.updatedAtText).not.toBe(downBefore.updatedAtText);
        expect(downAfter.isUp).toBe(false);
        expect(downAfter.lastSeenAt).toEqual(stale);
        expect(downAfter.metricsUpdatedAt).toEqual(stale);

        expect(await nodeRow("up")).toMatchObject({
          isUp: false,
          uptimeSeconds: null,
          isNativePush: true,
          lastSeenAt: stale,
        });

        const byExternalId: Map<string, ResourceRow> = new Map(
          before.map((resource: ResourceRow): [string, ResourceRow] => {
            return [resource.externalId, resource];
          }),
        );
        for (const untouched of ["fresh", "deleted", "unnamed"]) {
          expect(await nodeRow(untouched)).toEqual(
            byExternalId.get(`node/${untouched}`),
          );
        }

        // Marked and taken over: the next reports write nothing.
        const marked: Array<ResourceRow> = await readRows();
        expect(await mark(reported, silentBefore)).toBe(0);
        expect(await mark(reported, at(0))).toBe(0);
        expect(await readRows()).toEqual(marked);

        // The prune keeps both as native nodes; the rows it did not take over go.
        expect(await prune()).toBe(2);
        expect(externalIdsOf(await readRows())).toEqual([
          "node/down",
          "node/fresh",
          "node/up",
        ]);
        expect(
          rosterOf(
            await ProxmoxResourceService.getNodeRoster({
              projectId: PROJECT_ID,
              proxmoxClusterId: CLUSTER_ID,
              now: NOW,
            }),
          ),
        ).toEqual([
          { nodeName: "down", lastSeenAt: stale.getTime() },
          { nodeName: "fresh", lastSeenAt: at(0).getTime() },
          { nodeName: "up", lastSeenAt: stale.getTime() },
        ]);
      },
    );

    test("an agent-era Offline row of another cluster or project is not taken over by this cluster's report", async () => {
      const stale: Date = at(-20 * MINUTE_MS);
      await upsertFrom(false, [
        node("pve3", { isUp: false, lastSeenAt: stale }),
      ]);
      await upsertFrom(
        false,
        [node("pve3", { isUp: false, lastSeenAt: stale })],
        OTHER_CLUSTER_ID,
      );
      await upsert([node("pve3", { isUp: false, lastSeenAt: stale })], {
        isNativePush: false,
        projectId: OTHER_PROJECT_ID,
      });

      expect(await mark(["pve3"], at(-2 * MINUTE_MS))).toBe(1);

      expect((await nodeRow("pve3")).isNativePush).toBe(true);
      expect((await nodeRow("pve3", OTHER_CLUSTER_ID)).isNativePush).toBe(
        false,
      );
      expect(
        (await rowOf("node/pve3", { projectId: OTHER_PROJECT_ID }))
          ?.isNativePush,
      ).toBe(false);
    });

    test("a node name too long for the column is clamped exactly as bulkUpsert stored it", async () => {
      const longName: string = "n".repeat(150);
      await upsert([node(longName, { lastSeenAt: at(-5 * MINUTE_MS) })], {
        isNativePush: true,
      });
      const stored: Array<ResourceRow> = await readRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]!.externalId).toHaveLength(100);

      expect(await mark([longName], at(-3 * MINUTE_MS))).toBe(1);
      expect((await readRows())[0]!.isUp).toBe(false);
    });
  });

  describe("getNodeRoster", () => {
    async function seedRoster(): Promise<void> {
      await upsert(
        [
          node("pve1", { lastSeenAt: NOW }),
          node("pve2", { lastSeenAt: at(-6 * DAY_MS) }),
          node("pve3", { lastSeenAt: at(-7 * DAY_MS) }),
          node("pve4", { lastSeenAt: at(-7 * DAY_MS - 1) }),
          guest(100, "pve1"),
          storage("pve1", "local"),
          // A Node row whose id is not node/<name>, and one with no name.
          node("malformed", { externalId: "pve-malformed" }),
          node("", { externalId: "node/" }),
          node("pve5"),
        ],
        { isNativePush: true },
      );
      await mark(["pve2"], NOW);
      await upsert([node("agent1", { lastSeenAt: at(-DAY_MS) })], {
        isNativePush: false,
      });
      await softDelete("Node", "node/pve5");
      await upsert([node("pve6")], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      await upsert([node("pve7")], {
        isNativePush: true,
        projectId: OTHER_PROJECT_ID,
      });
    }

    test("lists the cluster's live Node rows seen within the retention window, Offline or not, whatever their source, parsed back into names", async () => {
      await seedRoster();

      expect(
        rosterOf(
          await ProxmoxResourceService.getNodeRoster({
            projectId: PROJECT_ID,
            proxmoxClusterId: CLUSTER_ID,
            now: NOW,
          }),
        ),
      ).toEqual([
        { nodeName: "agent1", lastSeenAt: at(-DAY_MS).getTime() },
        { nodeName: "pve1", lastSeenAt: NOW.getTime() },
        { nodeName: "pve2", lastSeenAt: at(-6 * DAY_MS).getTime() },
        // Exactly at the cutoff is still in.
        { nodeName: "pve3", lastSeenAt: at(-7 * DAY_MS).getTime() },
      ]);
    });

    test("the window follows PVE_SILENT_NODE_RETENTION_HOURS", async () => {
      await seedRoster();
      process.env["PVE_SILENT_NODE_RETENTION_HOURS"] = "24";

      expect(
        rosterOf(
          await ProxmoxResourceService.getNodeRoster({
            projectId: PROJECT_ID,
            proxmoxClusterId: CLUSTER_ID,
            now: NOW,
          }),
        ),
      ).toEqual([
        { nodeName: "agent1", lastSeenAt: at(-DAY_MS).getTime() },
        { nodeName: "pve1", lastSeenAt: NOW.getTime() },
      ]);
    });

    test("an empty cluster has an empty roster", async () => {
      expect(
        await ProxmoxResourceService.getNodeRoster({
          projectId: PROJECT_ID,
          proxmoxClusterId: ObjectID.generate(),
          now: NOW,
        }),
      ).toEqual([]);
    });
  });

  describe("deleteStaleForCluster", () => {
    const stale: Date = at(-20 * MINUTE_MS);

    // Every kind of row the prune decides on, 20 minutes stale or not.
    async function seedPruneCluster(): Promise<void> {
      await upsert(
        [
          node("n-live", { lastSeenAt: at(-MINUTE_MS) }),
          // Died before the next report could mark it.
          node("n-silent", { lastSeenAt: stale }),
          node("n-marked", { lastSeenAt: at(-2 * DAY_MS) }),
          node("n-at-retention", { lastSeenAt: at(-7 * DAY_MS) }),
          node("n-past-retention", { lastSeenAt: at(-7 * DAY_MS - 1) }),
          guest(100, "n-silent", { lastSeenAt: stale }),
          guest(101, "n-silent", {
            externalId: "lxc/101",
            guestType: "lxc",
            isUp: false,
            lastSeenAt: stale,
          }),
          storage("n-silent", "local", { lastSeenAt: stale }),
          guest(102, "n-live", { lastSeenAt: at(-MINUTE_MS) }),
        ],
        { isNativePush: true },
      );
      expect(await mark(["n-marked"], at(-DAY_MS))).toBe(1);
      await upsert(
        [
          node("a-stale", { lastSeenAt: stale }),
          node("a-offline", { isUp: false, lastSeenAt: stale }),
          node("a-fresh", { lastSeenAt: at(-5 * MINUTE_MS) }),
        ],
        { isNativePush: false },
      );
      await insertLegacyRow("Node", "node/legacy", stale);
      await upsert([node("b-stale", { lastSeenAt: at(-DAY_MS) })], {
        isNativePush: false,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
    }

    test("prunes agent rows, guests and storage at the cutoff, keeps native Node rows within retention whether marked or not, and returns the count", async () => {
      await seedPruneCluster();

      expect(await prune()).toBe(7);

      expect(externalIdsOf(await readRows())).toEqual([
        "qemu/102",
        "node/a-fresh",
        "node/n-at-retention",
        "node/n-live",
        "node/n-marked",
        "node/n-silent",
      ]);
      // Kept as it was: not marked, still up, until the live nodes report it.
      expect(await nodeRow("n-silent")).toMatchObject({
        isUp: true,
        isNativePush: true,
        lastSeenAt: stale,
      });
      expect(await nodeRow("n-marked")).toMatchObject({
        isUp: false,
        isNativePush: true,
      });
      expect(externalIdsOf(await readRows(OTHER_CLUSTER_ID))).toEqual([
        "node/b-stale",
      ]);

      // Nothing left to prune.
      expect(await prune()).toBe(0);
    });

    test("the retention window follows PVE_SILENT_NODE_RETENTION_HOURS", async () => {
      process.env["PVE_SILENT_NODE_RETENTION_HOURS"] = "24";
      await upsert(
        [
          node("n-23h", { lastSeenAt: at(-23 * HOUR_MS) }),
          node("n-25h", { lastSeenAt: at(-25 * HOUR_MS) }),
        ],
        { isNativePush: true },
      );

      expect(await prune()).toBe(1);
      expect(externalIdsOf(await readRows())).toEqual(["node/n-23h"]);
    });

    test("without now, the retention window is measured on the wall clock", async () => {
      const wallNow: number = Date.now();
      await upsert(
        [
          node("n-hour", { lastSeenAt: new Date(wallNow - HOUR_MS) }),
          node("n-8d", { lastSeenAt: new Date(wallNow - 8 * DAY_MS) }),
        ],
        { isNativePush: true },
      );

      expect(
        await ProxmoxResourceService.deleteStaleForCluster({
          proxmoxClusterId: CLUSTER_ID,
          olderThan: new Date(wallNow - 15 * MINUTE_MS),
        }),
      ).toBe(1);
      expect(externalIdsOf(await readRows())).toEqual(["node/n-hour"]);
    });

    test("a Node row the agent took over is pruned at the normal cutoff", async () => {
      await upsert([node("pve1", { lastSeenAt: at(-30 * MINUTE_MS) })], {
        isNativePush: true,
      });
      await upsert([node("pve1", { lastSeenAt: at(-16 * MINUTE_MS) })], {
        isNativePush: false,
      });

      expect(await prune()).toBe(1);
      expect(await countRows()).toBe(0);
    });

    /*
     * With silent-node detection off nothing ever marks a dead native node,
     * so keeping it for the retention window would show it Online for a week:
     * the keep is off and the prune is the plain pre-feature DELETE. Postgres
     * rejects a bind that supplies more parameters than the statement names,
     * so this also pins that the two-parameter statement gets two.
     */
    test("with PVE_NATIVE_NODE_SILENCE_DETECTION=false a native Node row goes at the normal cutoff; by default the same row is kept", async () => {
      await upsert([node("n-silent", { lastSeenAt: stale })], {
        isNativePush: true,
      });

      expect(await prune()).toBe(0);
      expect(await nodeRow("n-silent")).toMatchObject({
        isUp: true,
        isNativePush: true,
      });

      process.env[DETECTION_ENV] = "false";
      expect(await prune()).toBe(1);
      expect(await countRows()).toBe(0);
    });

    test("with detection off the keep is off for every native Node row - marked or not, within retention or not - and the cutoff is exclusive as before", async () => {
      await seedPruneCluster();
      const cutoff: Date = ProxmoxResourceService.getStaleThresholdDate(NOW);
      await upsert(
        [
          node("n-at-cutoff", { lastSeenAt: cutoff }),
          node("n-before-cutoff", {
            lastSeenAt: new Date(cutoff.getTime() - 1),
          }),
        ],
        { isNativePush: true },
      );
      process.env[DETECTION_ENV] = "false";

      /*
       * The 7 the default prune takes, and n-silent, n-marked, n-at-retention
       * and n-before-cutoff with them.
       */
      expect(await prune({ olderThan: cutoff })).toBe(11);

      expect(externalIdsOf(await readRows())).toEqual([
        "qemu/102",
        "node/a-fresh",
        "node/n-at-cutoff",
        "node/n-live",
      ]);
      expect(externalIdsOf(await readRows(OTHER_CLUSTER_ID))).toEqual([
        "node/b-stale",
      ]);
      expect(await prune({ olderThan: cutoff })).toBe(0);
    });

    test.each<{ value: string; kept: boolean }>([
      { value: "FALSE", kept: false },
      { value: " False ", kept: false },
      { value: "true", kept: true },
      { value: "0", kept: true },
      { value: "off", kept: true },
      { value: "", kept: true },
    ])(
      'PVE_NATIVE_NODE_SILENCE_DETECTION="$value": only false turns the keep off (kept: $kept)',
      async (row: { value: string; kept: boolean }) => {
        await upsert([node("n-silent", { lastSeenAt: stale })], {
          isNativePush: true,
        });
        process.env[DETECTION_ENV] = row.value;

        expect(await prune()).toBe(row.kept ? 0 : 1);
        expect(await countRows()).toBe(row.kept ? 1 : 0);
      },
    );
  });

  describe("removeOfflineNode", () => {
    test("deletes only an Offline Node row of this project and cluster, and says whether it did", async () => {
      await upsert(
        [
          node("pve1"),
          node("pve3", { lastSeenAt: at(-10 * MINUTE_MS) }),
          node("pve4", { isUp: null }),
          guest(100, "pve3", { isUp: false }),
        ],
        { isNativePush: true },
      );
      expect(await mark(["pve3"], at(-5 * MINUTE_MS))).toBe(1);
      await upsert([node("pve3", { isUp: false })], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      await upsert([node("pve3", { isUp: false })], {
        isNativePush: true,
        projectId: OTHER_PROJECT_ID,
      });

      const remove: (externalId: string) => Promise<boolean> = (
        externalId: string,
      ): Promise<boolean> => {
        return ProxmoxResourceService.removeOfflineNode({
          projectId: PROJECT_ID,
          proxmoxClusterId: CLUSTER_ID,
          externalId: externalId,
        });
      };

      expect(await remove("node/pve3")).toBe(true);
      expect(await rowOf("node/pve3")).toBeUndefined();
      expect(await remove("node/pve3")).toBe(false);

      // Up, unknown, not a node, or no such node: nothing is removed.
      expect(await remove("node/pve1")).toBe(false);
      expect(await remove("node/pve4")).toBe(false);
      expect(await remove("qemu/100")).toBe(false);
      expect(await remove("node/ghost")).toBe(false);

      expect(externalIdsOf(await readRows())).toEqual([
        "qemu/100",
        "node/pve1",
        "node/pve4",
      ]);
      expect((await nodeRow("pve3", OTHER_CLUSTER_ID)).isUp).toBe(false);
      expect(
        await rowOf("node/pve3", { projectId: OTHER_PROJECT_ID }),
      ).toBeDefined();

      // Gone from the roster, so nobody reports it any more.
      expect(
        rosterOf(
          await ProxmoxResourceService.getNodeRoster({
            projectId: PROJECT_ID,
            proxmoxClusterId: CLUSTER_ID,
            now: NOW,
          }),
        ).map((entry: { nodeName: string }): string => {
          return entry.nodeName;
        }),
      ).toEqual(["pve1", "pve4"]);
    });
  });

  describe("getInventorySummary", () => {
    test("the online node count drops when a node is marked and comes back with its own push", async () => {
      await upsert(
        [
          node("pve1"),
          node("pve2"),
          node("pve3", { lastSeenAt: at(-5 * MINUTE_MS) }),
          guest(100, "pve1"),
          guest(101, "pve2"),
          guest(102, "pve2", { isUp: false }),
          guest(103, "pve2"),
          storage("pve1", "local"),
        ],
        { isNativePush: true },
      );
      await softDelete("Guest", "qemu/103");
      await upsert([node("pve9"), guest(900, "pve9")], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });

      expect(await summary()).toEqual({
        countsByKind: { Node: 3, Guest: 3, Storage: 1 },
        nodeOnlineCount: 3,
        guestRunningCount: 2,
      });

      expect(await mark(["pve3"], at(-3 * MINUTE_MS))).toBe(1);
      expect(await summary()).toEqual({
        countsByKind: { Node: 3, Guest: 3, Storage: 1 },
        nodeOnlineCount: 2,
        guestRunningCount: 2,
      });

      await upsert([node("pve3", { lastSeenAt: at(MINUTE_MS) })], {
        isNativePush: true,
      });
      expect((await summary()).nodeOnlineCount).toBe(3);
    });
  });

  describe("a native-push cluster over time", () => {
    test("pve3 dies, is marked once, survives a 20-minute OneUptime outage and the prune ticks around it, and its own push brings it back", async () => {
      const sim: NativeClusterSimulator = new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
      );
      const clusterId: ObjectID = sim.proxmoxClusterId;
      const row: (nodeName: string) => Promise<ResourceRow | undefined> = (
        nodeName: string,
      ): Promise<ResourceRow | undefined> => {
        return rowOf(`node/${nodeName}`, { proxmoxClusterId: clusterId });
      };

      // pve3's last push is at 5:20.
      await sim.runUntil(sim.time(5, 20));
      sim.setAlive("pve3", false);
      expect((await summary(clusterId)).nodeOnlineCount).toBe(3);

      // Silent for the whole window only after 7:20; pve1 reports at 7:30.
      await sim.runUntil(sim.time(7, 20));
      expect(sim.marks).toEqual([]);
      await sim.runUntil(sim.time(7, 30));
      expect(sim.marks).toEqual([
        {
          atMs: sim.time(7, 30),
          reporter: "pve1",
          nodeNames: ["pve3"],
          written: 1,
        },
      ]);
      expect(await row("pve3")).toMatchObject({
        isUp: false,
        uptimeSeconds: null,
        isNativePush: true,
        lastSeenAt: new Date(sim.time(5, 20)),
        metricsUpdatedAt: new Date(sim.time(5, 20)),
      });
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 5, Storage: 3 },
        nodeOnlineCount: 2,
      });

      /*
       * Every live push reports it again, and writes nothing. Its guests and
       * storage age out at the 25:00 tick (cutoff 10:00); the node does not.
       */
      await sim.runUntil(sim.time(29, 50));
      // pve1 7:30 ... 29:30 and pve2 7:40 ... 29:40: 45 pushes each.
      expect(sim.marks).toHaveLength(90);
      expect(
        sim.marks.every((record: MarkRecord): boolean => {
          return (
            record.nodeNames.length === 1 && record.nodeNames[0] === "pve3"
          );
        }),
      ).toBe(true);
      expect(sim.rowsWritten()).toBe(1);
      expect(sim.ticks).toEqual([
        { atMs: sim.time(0), deleted: 0 },
        { atMs: sim.time(5), deleted: 0 },
        { atMs: sim.time(10), deleted: 0 },
        { atMs: sim.time(15), deleted: 0 },
        { atMs: sim.time(20), deleted: 0 },
        { atMs: sim.time(25), deleted: 3 },
      ]);
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 3, Storage: 2 },
        nodeOnlineCount: 2,
      });

      // OneUptime is out from 30:00 to 50:00; the last push it took is 29:40.
      sim.outage = true;
      const marksBeforeOutage: number = sim.marks.length;
      await sim.runUntil(sim.time(49, 50));
      expect(sim.marks.length).toBe(marksBeforeOutage);
      expect(sim.ticks.slice(6)).toEqual([
        { atMs: sim.time(30), deleted: 0 },
        { atMs: sim.time(35), deleted: 0 },
        { atMs: sim.time(40), deleted: 0 },
        // Seen last at 29:40: disconnected, skipped.
        { atMs: sim.time(45), deleted: null },
      ]);
      expect(await row("pve3")).toMatchObject({ isUp: false });

      /*
       * Back at 50:00: pve1's push reconnects the cluster and the tick right
       * after it prunes with the cutoff at 35:00. pve2 has not pushed yet -
       * its guest and storage go (and come back at 50:10), its Node row stays,
       * as does pve3's.
       */
      sim.outage = false;
      await sim.runUntil(sim.time(50));
      expect(sim.ticks[sim.ticks.length - 1]).toEqual({
        atMs: sim.time(50),
        deleted: 2,
      });
      expect(await row("pve2")).toMatchObject({
        isUp: true,
        lastSeenAt: new Date(sim.time(29, 40)),
      });
      expect(await row("pve3")).toMatchObject({
        isUp: false,
        lastSeenAt: new Date(sim.time(5, 20)),
      });

      // No report until a node has pushed for two minutes again.
      await sim.runUntil(sim.time(51, 50));
      expect(sim.marksSince(sim.time(50))).toEqual([]);
      await sim.runUntil(sim.time(52));
      expect(sim.marksSince(sim.time(50))).toEqual([
        {
          atMs: sim.time(52),
          reporter: "pve1",
          nodeNames: ["pve3"],
          written: 0,
        },
      ]);

      await sim.runUntil(sim.time(60));
      expect(sim.ticks[sim.ticks.length - 2]).toEqual({
        atMs: sim.time(55),
        deleted: 0,
      });
      expect(await row("pve3")).toMatchObject({ isUp: false });

      // pve3 boots at 60:00 and pushes at 60:20.
      sim.setAlive("pve3", true);
      await sim.runUntil(sim.time(60, 20));
      expect(await row("pve3")).toMatchObject({
        isUp: true,
        uptimeSeconds: 20,
        isNativePush: true,
        lastSeenAt: new Date(sim.time(60, 20)),
        metricsUpdatedAt: new Date(sim.time(60, 20)),
      });
      expect(await summary(clusterId)).toEqual({
        countsByKind: { Node: 3, Guest: 5, Storage: 3 },
        nodeOnlineCount: 3,
        guestRunningCount: 5,
      });

      // A report decided before its push, landing after it, marks nothing.
      expect(
        await mark(
          ["pve3"],
          new Date(sim.time(60, 10) - PROXMOX_NODE_SILENCE_MS),
          clusterId,
        ),
      ).toBe(0);

      await sim.runUntil(sim.time(75));
      expect(sim.marksSince(sim.time(60, 20))).toEqual([]);
      expect(sim.rowsWritten()).toBe(1);
      expect(
        sim.ticks
          .filter((tick: TickRecord): boolean => {
            return tick.atMs > sim.time(60);
          })
          .map((tick: TickRecord): number | null => {
            return tick.deleted;
          }),
      ).toEqual([0, 0, 0]);
      expect(await summary(clusterId)).toEqual({
        countsByKind: { Node: 3, Guest: 5, Storage: 3 },
        nodeOnlineCount: 3,
        guestRunningCount: 5,
      });
    }, 120_000);

    test("a node that dies just before an outage is kept through the warm-up after it, although never marked, then reported", async () => {
      const sim: NativeClusterSimulator = new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
      );
      const clusterId: ObjectID = sim.proxmoxClusterId;

      // pve3's last push is at 29:20 - still alive when OneUptime goes out.
      await sim.runUntil(sim.time(29, 20));
      sim.setAlive("pve3", false);
      await sim.runUntil(sim.time(29, 50));
      sim.outage = true;
      await sim.runUntil(sim.time(49, 50));
      sim.outage = false;

      // The tick at 50:00 prunes with the cutoff at 35:00.
      await sim.runUntil(sim.time(50));
      expect(sim.marks).toEqual([]);
      expect(sim.ticks[sim.ticks.length - 1]).toEqual({
        atMs: sim.time(50),
        // pve3's two guests and storage, pve2's guest and storage.
        deleted: 5,
      });
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({
        isUp: true,
        isNativePush: true,
        lastSeenAt: new Date(sim.time(29, 20)),
      });

      await sim.runUntil(sim.time(52));
      expect(sim.marks).toEqual([
        {
          atMs: sim.time(52),
          reporter: "pve1",
          nodeNames: ["pve3"],
          written: 1,
        },
      ]);
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({ isUp: false, uptimeSeconds: null });
      expect((await summary(clusterId)).nodeOnlineCount).toBe(2);

      await sim.runUntil(sim.time(60));
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toBeDefined();
      expect(sim.rowsWritten()).toBe(1);
    }, 120_000);

    test("after a whole-cluster power cut, a node that fails to boot is kept while the others come back, then reported", async () => {
      const sim: NativeClusterSimulator = new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
      );
      const clusterId: ObjectID = sim.proxmoxClusterId;

      // Every node's last push is by 9:50.
      await sim.runUntil(sim.time(9, 50));
      for (const entry of THREE_NODES) {
        sim.setAlive(entry.name, false);
      }

      // Nobody is left to report; the cluster turns disconnected.
      await sim.runUntil(sim.time(39, 50));
      expect(sim.marks).toEqual([]);
      expect(
        sim.ticks.map((tick: TickRecord): number | null => {
          return tick.deleted;
        }),
      ).toEqual([0, 0, 0, 0, 0, null, null, null]);

      // pve1 and pve2 boot; pve3 does not.
      sim.setAlive("pve1", true);
      sim.setAlive("pve2", true);
      await sim.runUntil(sim.time(40));
      expect(sim.ticks[sim.ticks.length - 1]).toEqual({
        atMs: sim.time(40),
        deleted: 5,
      });
      for (const nodeName of ["pve2", "pve3"]) {
        expect(
          await rowOf(`node/${nodeName}`, { proxmoxClusterId: clusterId }),
        ).toMatchObject({ isUp: true, isNativePush: true });
      }

      await sim.runUntil(sim.time(41, 50));
      expect(sim.marks).toEqual([]);
      await sim.runUntil(sim.time(42));
      expect(sim.marks).toEqual([
        {
          atMs: sim.time(42),
          reporter: "pve1",
          nodeNames: ["pve3"],
          written: 1,
        },
      ]);
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 3, Storage: 2 },
        nodeOnlineCount: 2,
      });
    }, 120_000);

    test("an outage shorter than the silence window marks no live node when OneUptime resumes", async () => {
      const sim: NativeClusterSimulator = new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
      );
      const clusterId: ObjectID = sim.proxmoxClusterId;

      /*
       * The last pushes before the outage: pve1 29:30, pve2 29:40, pve3
       * 29:50. OneUptime resumes at 31:40 with pve2's push - pve1's key has
       * expired by then and pve3's has not, but pve3's streak is broken, so
       * it vouches for nobody and pve1 is not reported.
       */
      await sim.runUntil(sim.time(29, 50));
      sim.outage = true;
      await sim.runUntil(sim.time(31, 30));
      sim.outage = false;
      await sim.runUntil(sim.time(40));

      expect(sim.marks).toEqual([]);
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 5, Storage: 3 },
        nodeOnlineCount: 3,
      });
    }, 120_000);

    /*
     * The agent's last scrape, a minute before the cluster moved to the
     * native push, listed pve3 as down (and its guests). pve3 never pushes.
     * Before the mark set isNativePush, the report found the row already
     * Offline and wrote nothing, so the 15:00 tick pruned the non-native row
     * - pve3 left the roster and stopped being reported while still down.
     */
    test.each<{ source: string; isNativePush: boolean | null }>([
      { source: "isNativePush false", isNativePush: false },
      {
        source: "isNativePush NULL, from before the migration",
        isNativePush: null,
      },
    ])(
      "a node already down when the cluster moved from the agent to the native push ($source) is reported, taken over, and kept through the prune while still down",
      async (row: { source: string; isNativePush: boolean | null }) => {
        const sim: NativeClusterSimulator = new NativeClusterSimulator(
          TIMELINE_START_MS,
          THREE_NODES,
        );
        const clusterId: ObjectID = sim.proxmoxClusterId;
        const scrapedAt: Date = new Date(sim.time(-1));
        const agentScrape: Array<ParsedProxmoxResource> = [];
        for (const entry of THREE_NODES) {
          const up: boolean = entry.name !== "pve3";
          agentScrape.push(
            node(entry.name, {
              isUp: up,
              uptimeSeconds: up ? 86400 : null,
              lastSeenAt: scrapedAt,
            }),
            ...entry.vmids.map((vmid: number): ParsedProxmoxResource => {
              return guest(vmid, entry.name, {
                isUp: up,
                lastSeenAt: scrapedAt,
              });
            }),
            storage(entry.name, "local", { lastSeenAt: scrapedAt }),
          );
        }
        await upsertFrom(row.isNativePush, agentScrape, clusterId);
        sim.setAlive("pve3", false);

        // Reported once pve1 has pushed for the silence window.
        await sim.runUntil(sim.time(1, 50));
        expect(sim.marks).toEqual([]);
        await sim.runUntil(sim.time(2));
        expect(sim.marks).toEqual([
          {
            atMs: sim.time(2),
            reporter: "pve1",
            nodeNames: ["pve3"],
            written: 1,
          },
        ]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          uptimeSeconds: null,
          isNativePush: true,
          lastSeenAt: scrapedAt,
        });

        // The 15:00 tick (cutoff 0:00) takes pve3's guests and storage only.
        await sim.runUntil(sim.time(20));
        expect(sim.ticks).toEqual([
          { atMs: sim.time(0), deleted: 0 },
          { atMs: sim.time(5), deleted: 0 },
          { atMs: sim.time(10), deleted: 0 },
          { atMs: sim.time(15), deleted: 3 },
          { atMs: sim.time(20), deleted: 0 },
        ]);
        expect(
          sim.marks.every((record: MarkRecord): boolean => {
            return (
              record.nodeNames.length === 1 && record.nodeNames[0] === "pve3"
            );
          }),
        ).toBe(true);
        // pve1 2:00 ... 20:00 and pve2 2:10 ... 19:40.
        expect(sim.marks).toHaveLength(37 + 36);
        expect(sim.rowsWritten()).toBe(1);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          isNativePush: true,
          lastSeenAt: scrapedAt,
        });
        expect(
          rosterOf(
            await ProxmoxResourceService.getNodeRoster({
              projectId: PROJECT_ID,
              proxmoxClusterId: clusterId,
              now: new Date(sim.time(20)),
            }),
          ).map((entry: { nodeName: string }): string => {
            return entry.nodeName;
          }),
        ).toEqual(["pve1", "pve2", "pve3"]);
        expect(await summary(clusterId)).toEqual({
          countsByKind: { Node: 3, Guest: 3, Storage: 2 },
          nodeOnlineCount: 2,
          guestRunningCount: 3,
        });

        // pve3 boots at 20:00: its own push brings it back.
        sim.setAlive("pve3", true);
        await sim.runUntil(sim.time(20, 20));
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: true,
          uptimeSeconds: 20,
          isNativePush: true,
          lastSeenAt: new Date(sim.time(20, 20)),
        });
        await sim.runUntil(sim.time(25));
        expect(sim.marksSince(sim.time(20, 20))).toEqual([]);
        expect(sim.ticks[sim.ticks.length - 1]).toEqual({
          atMs: sim.time(25),
          deleted: 0,
        });
        expect(await summary(clusterId)).toEqual({
          countsByKind: { Node: 3, Guest: 5, Storage: 3 },
          nodeOnlineCount: 3,
          guestRunningCount: 5,
        });
      },
      120_000,
    );

    /*
     * With detection off nothing marks pve3, so it is shown as it last
     * pushed - Online - until the prune takes it with its guests and storage
     * at the normal cutoff, as before the feature. Kept for the retention
     * window, it would show Online for a week.
     */
    test("with PVE_NATIVE_NODE_SILENCE_DETECTION=false a dead node is never reported and ages out with its guests at the normal cutoff", async () => {
      process.env[DETECTION_ENV] = "false";
      const sim: NativeClusterSimulator = new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
      );
      const clusterId: ObjectID = sim.proxmoxClusterId;

      // pve3's last push is at 5:20.
      await sim.runUntil(sim.time(5, 20));
      sim.setAlive("pve3", false);

      await sim.runUntil(sim.time(24, 50));
      expect(sim.marks).toEqual([]);
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({
        isUp: true,
        isNativePush: true,
        lastSeenAt: new Date(sim.time(5, 20)),
      });
      expect((await summary(clusterId)).nodeOnlineCount).toBe(3);

      // The 25:00 tick (cutoff 10:00): the Node row, both guests, the storage.
      await sim.runUntil(sim.time(25));
      expect(sim.ticks).toEqual([
        { atMs: sim.time(0), deleted: 0 },
        { atMs: sim.time(5), deleted: 0 },
        { atMs: sim.time(10), deleted: 0 },
        { atMs: sim.time(15), deleted: 0 },
        { atMs: sim.time(20), deleted: 0 },
        { atMs: sim.time(25), deleted: 4 },
      ]);
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toBeUndefined();
      expect(
        rosterOf(
          await ProxmoxResourceService.getNodeRoster({
            projectId: PROJECT_ID,
            proxmoxClusterId: clusterId,
            now: new Date(sim.time(25)),
          }),
        ).map((entry: { nodeName: string }): string => {
          return entry.nodeName;
        }),
      ).toEqual(["pve1", "pve2"]);
      expect(await summary(clusterId)).toEqual({
        countsByKind: { Node: 2, Guest: 3, Storage: 2 },
        nodeOnlineCount: 2,
        guestRunningCount: 3,
      });

      await sim.runUntil(sim.time(30));
      expect(sim.marks).toEqual([]);
      expect(sim.ticks[sim.ticks.length - 1]).toEqual({
        atMs: sim.time(30),
        deleted: 0,
      });
    }, 120_000);
  });
});
