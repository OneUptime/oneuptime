import Entities from "../../../Models/DatabaseModels/Index";
import Label from "../../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProxmoxResourceAPI from "../../../Server/API/ProxmoxResourceAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxInventorySummary,
  ProxmoxRemoveNodeResult,
  ProxmoxResourceLatestMetric,
} from "../../../Server/Services/ProxmoxResourceService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import {
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  decideProxmoxSilentNodes,
  isEligibleProxmoxReporter,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
} from "../../../Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * The Proxmox inventory's hand-written SQL, executed on Postgres against
 * the migrated "ProxmoxResource" table.
 *
 * Opt in with RUN_POSTGRES_PROXMOX_INVENTORY_TESTS=true against a database
 * the registered migrations (1796200000000-AddProxmoxResourceNativePushColumns
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
 * and whether the migrated isNativePush and notReportingMarkedAt columns are
 * the ones the statements name.
 *
 * It works on a structure-only clone (LIKE ... INCLUDING ALL, so the unique
 * (projectId, proxmoxClusterId, kind, externalId) index that ON CONFLICT
 * names comes along, with the _id / createdAt / updatedAt defaults) of
 * "ProxmoxResource" in a uniquely named schema that is the connection's
 * first search_path entry and is dropped afterwards. LIKE copies no foreign
 * key, so no Project or ProxmoxCluster row is needed; every row is
 * synthetic. The production service runs unchanged - only the DataSource it
 * resolves is pointed at the clone, and the logger is muted.
 *
 * The clocks. Every write - bulkUpsert, bulkUpdateLatestMetrics and the
 * mark alike - stamps updatedAt with the database's now(), and nothing
 * reads it back. The mark has a column of its own, notReportingMarkedAt:
 * only markNodesNotReporting writes it, with the markedAt its caller passes
 * - the ingest worker's clock, the one the mark is judged on (now, when
 * none is passed) - and rewrites a row already Offline, native and marked
 * only once that mark is before markedAt - 60 s, never reading the
 * database's clock; the node's own next observation clears it. The schema
 * holds a now() of its own, found ahead of pg_catalog's (search_path is
 * "<schema>, pg_catalog"; the clone's updatedAt default calls it too): it
 * reads the one row of the schema's clock table, and with that table empty
 * - as before every test - it is pg_catalog.now() itself. A test that sets
 * the clock runs the service's statements, unchanged, on that time. The
 * timelines keep the database clock on their simulated one, or set it
 * hours apart from it, and pass the simulated clock as markedAt, as the
 * ingest does.
 *
 * What it pins:
 *   - bulkUpsert inserts, merges a newer batch with COALESCE (a null never
 *     blanks a value), ignores an older batch outright, writes isNativePush
 *     from the batch's source and follows the latest batch, clears the
 *     not-reporting mark (notReportingMarkedAt) on an observation as new as
 *     the row's or newer - from either source - and never on an older one,
 *     never sets it (an agent batch listing a node Offline leaves it NULL,
 *     on any database clock), and writes more than 500 rows in chunks;
 *   - bulkUpdateLatestMetrics mirrors metrics onto existing rows only and
 *     never regresses a newer observation;
 *   - markNodesNotReporting marks exactly the named Node rows the node has
 *     not refreshed since silentBefore, binds the names as a text[], never
 *     moves lastSeenAt or metricsUpdatedAt, writes notReportingMarkedAt as
 *     markedAt exactly - however far the database clock is from it, which
 *     stamps updatedAt alone - and rewrites a row already Offline, native
 *     and marked only once that mark is more than 60 seconds before markedAt
 *     (60 s: 0 rows; 60 s and a millisecond: 1 row, the mark moved to
 *     markedAt), whatever its updatedAt - a row Offline but never marked
 *     (its own batch said it was down, or the agent's did) is marked at once
 *     - the mark the reports of an Offline node carry on from; it sets
 *     isNativePush too, so a row the agent last wrote (false) or one from
 *     before the migration (NULL) - Offline already or not - is taken over as
 *     a native node and kept by the prune;
 *   - getNodeRoster lists the cluster's Node rows within the retention
 *     window, parsed back into node names, each with its row's Online /
 *     Offline state (isUp: true, false, or null when unknown) and its mark
 *     (notReportingMarkedAt: the last report's markedAt, as a Date, or null
 *     - never updatedAt) - what lets the live nodes keep reporting a node
 *     that is already Offline, and was marked within the monitor window of
 *     the roster read, while none of them is established;
 *   - adoptNodesAsNativePush flags exactly the cluster's live Node rows not
 *     yet native (the agent's false, a pre-migration NULL, Offline or not)
 *     last seen no later than seenUpTo - the batch's newest observation,
 *     compared to the millisecond, inclusive - and nothing else about them,
 *     never a guest, storage, soft-deleted row, another cluster's or
 *     project's row, or a row newer than the batch (a native batch flushed
 *     late, after the cluster moved back to the agent, takes none of the
 *     agent's rows), and writes 0 rows the second time; it never touches
 *     notReportingMarkedAt or updatedAt, to the microsecond, however far the
 *     database clock has moved - adopting a row is no report, so an agent-era
 *     Offline row stays unmarked; an adopted node is kept by the prune and
 *     can be removed;
 *   - deleteStaleForCluster prunes agent rows, guests and storage at the
 *     cutoff but keeps a native-push Node row for the retention window,
 *     whether or not it has been marked yet, and returns the pruned count;
 *     with silent-node detection off (PVE_NATIVE_NODE_SILENCE_DETECTION=
 *     false) it runs the plain two-parameter DELETE and the keep is off;
 *   - removeOfflineNode deletes an Offline native-push Node row and nothing
 *     else - never a soft-deleted one - finds a node named past the column
 *     by its id clamped as bulkUpsert stored it, and says why it deleted
 *     nothing: "not-found" (no such live Node row here, or not a node id at
 *     all - that one without a statement), "not-native" (an agent or
 *     pre-migration row, left in place), "still-reporting" (a native node
 *     that is up or of unknown state);
 *   - getInventorySummary's online count follows the marks;
 *   - timelines of a native-push cluster - a node dying, a OneUptime outage,
 *     a whole-cluster power cut, a node coming back, a node already down when
 *     the cluster moved from the agent to the native push (with and without a
 *     gap between the two, and a node the agent last saw down that came
 *     back during the gap), a lone survivor's own gap, detection switched
 *     off, a database clock an hour off OneUptime's - where the live nodes
 *     decide with ProxmoxNativeNodeLiveness from the real roster query, each
 *     report weighing the silent nodes over the nodes it does not name, the
 *     mark refreshed once a minute on OneUptime's clock, and a node already
 *     Offline goes on being reported while no node is established - but
 *     only while its mark is within the monitor window - and a newly silent
 *     one, or one the agent last listed Offline (never marked), never is;
 *   - the remove-node route, run against cloned ProxmoxCluster, Label and
 *     ProxmoxClusterLabel tables: a label-scoped lookup loads only the
 *     caller's permitted labels, so the team block list is checked against
 *     the cluster loaded again as root with every label, and a block on any
 *     label of the cluster refuses the removal.
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
 * The suite's clock. Every time the service compares lastSeenAt or the mark
 * against is a bound parameter, so rows can sit at any point relative to
 * it. The database clock stamps updatedAt alone; a test that depends on it
 * sets that clock (see the header).
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

// The schema's clock table, which its now() reads (see the header).
const CLOCK_TABLE: string = "proxmox_test_clock";

/*
 * markNodesNotReporting rewrites a row already Offline, native and marked
 * once "notReportingMarkedAt" < $6, markedAt minus 60 seconds.
 */
const MARK_REFRESH_MS: number = 60 * SECOND_MS;

/*
 * The 60-second guard spelled out on report times, for a node that stays
 * silent and Offline once marked: which of the reports at reportTimes
 * (ascending) write its row. The first writes unless the row was already
 * Offline and native with a mark at lastMarkedMs (null: no mark, which only
 * a report writes), and then only once that mark is more than 60 s old;
 * each later one only once the last mark is.
 */
function expectedWrites(
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
  // The live nodes' last report that the node stopped reporting, or null.
  notReportingMarkedAt: Date | null;
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
  "lastSeenAt", "isNativePush", "notReportingMarkedAt", "latestCpuPercent", "latestMemoryBytes",
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

// Each roster entry's name and Online / Offline state, by name.
function rosterStatesOf(
  roster: Array<ProxmoxRosterNode>,
): Array<{ nodeName: string; isUp: boolean | null | undefined }> {
  return roster
    .map(
      (
        entry: ProxmoxRosterNode,
      ): { nodeName: string; isUp: boolean | null | undefined } => {
        return { nodeName: entry.nodeName, isUp: entry.isUp };
      },
    )
    .sort((a: { nodeName: string }, b: { nodeName: string }): number => {
      return a.nodeName.localeCompare(b.nodeName);
    });
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
 * push, adopts the cluster's Node rows into the native-push keep with the
 * real adoptNodesAsNativePush (bounded by the batch's newest observation, and
 * fenced, as the ingest fences it, to once per 10 minutes per cluster - the
 * first push, then the first push 10 minutes or more after the last
 * adoption), mirrors its node metrics, and marks the
 * nodes it reported with the real markNodesNotReporting (silentBefore = its
 * push time minus the silence window, markedAt = its push time - OneUptime's
 * clock, as the ingest passes it). Each report is recorded with the
 * decision's reporterCount and the rows the mark wrote. A node's push time
 * is the time OneUptime processes it, and the database clock (the schema's
 * now(), see the header) is set to the simulated clock - plus
 * databaseClockSkewMs, 0 unless a test sets the clocks apart - before
 * every step, so every updatedAt a write stamps runs on it; the mark
 * (notReportingMarkedAt) and its 60-second refresh run on markedAt. The
 * decision reads that mark off the roster, read afresh by every push (so
 * the roster's read time is the push's own): while no node is established,
 * a node already Offline is reported only while it was marked within the
 * monitor window. With silent-node detection switched off
 * (PVE_NATIVE_NODE_SILENCE_DETECTION=false) the ingest returns before any of
 * the liveness, roster or report work, and so does the simulator: the push
 * is upserted, adopted (the flush adopts regardless) and mirrored, nothing
 * else. `adoptNodes = false` leaves the adoption out, to show what it is
 * for. The ingest's 30-second fence on the mark is left out: every report
 * marks, the most chances for the mark to rewrite a row.
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
// The ingest's "proxmox-native-adopt" fence: once per 10 minutes per cluster.
const ADOPT_FENCE_MS: number = 10 * MINUTE_MS;

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
  /*
   * The decision's reporterCount: the nodes it does not report, the
   * reporter included - each presumed live until it is reported.
   */
  reporterCount: number;
  written: number;
}

interface AdoptionRecord {
  atMs: number;
  adopted: number;
}

interface TickRecord {
  atMs: number;
  // null: the cluster was disconnected, so the tick skipped it.
  deleted: number | null;
}

function markRecord(
  atMs: number,
  reporter: string,
  nodeNames: Array<string>,
  reporterCount: number,
  written: number,
): MarkRecord {
  return {
    atMs: atMs,
    reporter: reporter,
    nodeNames: nodeNames,
    reporterCount: reporterCount,
    written: written,
  };
}

/*
 * What each of these marks should have written, by the 60-second guard, for
 * nodes that stay silent and Offline once reported: for every node named,
 * its row is written by the marks expectedWrites picks from the ones naming
 * it, starting from lastMarkedMs (its notReportingMarkedAt before the first
 * of these marks, or null - no mark - when the first mark must write it).
 */
function expectedWrittenCounts(
  marks: Array<MarkRecord>,
  lastMarkedMs: Map<string, number | null>,
): Array<number> {
  const writesByNode: Map<string, Set<number>> = new Map();
  for (const [nodeName, lastMs] of lastMarkedMs) {
    writesByNode.set(
      nodeName,
      new Set(
        expectedWrites(
          marks
            .filter((mark: MarkRecord): boolean => {
              return mark.nodeNames.includes(nodeName);
            })
            .map((mark: MarkRecord): number => {
              return mark.atMs;
            }),
          lastMs,
        ),
      ),
    );
  }
  return marks.map((mark: MarkRecord): number => {
    return mark.nodeNames.filter((nodeName: string): boolean => {
      const writes: Set<number> | undefined = writesByNode.get(nodeName);
      if (!writes) {
        throw new Error(`No last write given for ${nodeName}`);
      }
      return writes.has(mark.atMs);
    }).length;
  });
}

// The times of the marks that wrote a row.
function writtenTimesOf(marks: Array<MarkRecord>): Array<number> {
  return marks
    .filter((mark: MarkRecord): boolean => {
      return mark.written > 0;
    })
    .map((mark: MarkRecord): number => {
      return mark.atMs;
    });
}

class NativeClusterSimulator {
  public readonly proxmoxClusterId: ObjectID = ObjectID.generate();
  public readonly startMs: number;
  public clockMs: number;
  public outage: boolean = false;
  public adoptNodes: boolean = true;
  public clusterLastSeenMs: number | null = null;
  public readonly marks: Array<MarkRecord> = [];
  public readonly adoptions: Array<AdoptionRecord> = [];
  public readonly ticks: Array<TickRecord> = [];

  private nextStepMs: number;
  private adoptFenceUntilMs: number | null = null;
  private readonly nodes: Array<SimulatedNode> = [];
  private readonly liveness: Map<string, ProxmoxNodeLiveness> = new Map();
  // Sets the database clock (the schema's now()).
  private readonly setDatabaseClock: (at: Date) => Promise<void>;
  // How far the database clock runs ahead of the simulated one.
  private readonly databaseClockSkewMs: number;

  public constructor(
    startMs: number,
    nodes: Array<{ name: string; vmids: Array<number> }>,
    setDatabaseClock: (at: Date) => Promise<void>,
    databaseClockSkewMs: number = 0,
  ) {
    // One node per step of a push interval: each pushes every 30 s.
    if (nodes.length !== PUSH_EVERY_STEPS) {
      throw new Error(`The simulator runs ${PUSH_EVERY_STEPS} nodes`);
    }
    this.startMs = startMs;
    this.clockMs = startMs;
    this.nextStepMs = startMs;
    this.setDatabaseClock = setDatabaseClock;
    this.databaseClockSkewMs = databaseClockSkewMs;
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

  // Whether the node could vouch for its siblings' first reports now.
  public isEstablished(nodeName: string): boolean {
    return isEligibleProxmoxReporter(
      this.liveness.get(nodeName) || null,
      this.clockMs,
    );
  }

  private async step(): Promise<void> {
    await this.setDatabaseClock(
      new Date(this.clockMs + this.databaseClockSkewMs),
    );
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
    // The batch's newest observation: every entry is its push time.
    await this.adopt(nowMs, seenAt);
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
          // OneUptime's clock, as the ingest passes it.
          markedAt: new Date(nowMs),
        });
      this.marks.push(
        markRecord(
          nowMs,
          pusher.name,
          decision.silentNodes,
          decision.reporterCount,
          written,
        ),
      );
    }
  }

  // Right after the native batch's upsert, as the flush does it.
  private async adopt(nowMs: number, seenUpTo: Date): Promise<void> {
    if (!this.adoptNodes) {
      return;
    }
    if (this.adoptFenceUntilMs !== null && nowMs < this.adoptFenceUntilMs) {
      return;
    }
    this.adoptFenceUntilMs = nowMs + ADOPT_FENCE_MS;
    const adopted: number = await ProxmoxResourceService.adoptNodesAsNativePush(
      {
        projectId: PROJECT_ID,
        proxmoxClusterId: this.proxmoxClusterId,
        seenUpTo: seenUpTo,
      },
    );
    this.adoptions.push({ atMs: nowMs, adopted: adopted });
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
    // The keys the ingest reads: the reporter's and its siblings'.
    const siblings: Array<string> = roster
      .map((entry: ProxmoxRosterNode): string => {
        return entry.nodeName;
      })
      .filter((nodeName: string): boolean => {
        return nodeName !== pusher.name;
      });
    if (siblings.length === 0) {
      return null;
    }
    const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map();
    for (const nodeName of [pusher.name, ...siblings]) {
      liveness.set(nodeName, this.liveness.get(nodeName) || null);
    }

    return decideProxmoxSilentNodes({
      selfNode: pusher.name,
      reporterTimeMs: nowMs,
      nowMs: nowMs,
      roster: roster,
      liveness: liveness,
      // Read just now: the marks' age is taken at this push.
      rosterReadAtMs: nowMs,
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

/*
 * The Proxmox Agent's last scrape of THREE_NODES: every node, its guests and
 * its storage, pve1 and pve2 up, pve3 (and its guests) as given.
 */
function agentScrape(
  scrapedAt: Date,
  pve3IsUp: boolean,
): Array<ParsedProxmoxResource> {
  const resources: Array<ParsedProxmoxResource> = [];
  for (const entry of THREE_NODES) {
    const up: boolean = entry.name !== "pve3" || pve3IsUp;
    resources.push(
      node(entry.name, {
        isUp: up,
        uptimeSeconds: up ? 86400 : null,
        lastSeenAt: scrapedAt,
      }),
      ...entry.vmids.map((vmid: number): ParsedProxmoxResource => {
        return guest(vmid, entry.name, { isUp: up, lastSeenAt: scrapedAt });
      }),
      storage(entry.name, "local", { lastSeenAt: scrapedAt }),
    );
  }
  return resources;
}

// The simulated timelines start well before NOW; nothing reads the wall clock.
const TIMELINE_START_MS: number = NOW.getTime() - 6 * HOUR_MS;

// POST /proxmox-resource/remove-node/:clusterId, as the router holds it.
const REMOVE_NODE_ROUTE: string = "/proxmox-resource/remove-node/:clusterId";

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

// The part of an Express router layer the route is looked up by.
interface RouterLayer {
  route?:
    | {
        path: string;
        methods: Dictionary<boolean>;
        stack: Array<{ handle: RouteHandler }>;
      }
    | undefined;
}

interface RouteOutcome {
  status: number | null;
  body: unknown;
  // What the route handed to next(), or null.
  error: unknown;
}

type PermissionGrant = {
  permission: Permission;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
};

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

  /*
   * A report's mark. markedAt is the worker's clock the ingest passes;
   * left out, the service reads the current time.
   */
  async function mark(
    nodeNames: Array<string>,
    silentBefore: Date,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
    markedAt?: Date | undefined,
  ): Promise<number> {
    return ProxmoxResourceService.markNodesNotReporting({
      projectId: PROJECT_ID,
      proxmoxClusterId: proxmoxClusterId,
      nodeNames: nodeNames,
      silentBefore: silentBefore,
      markedAt: markedAt,
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

  async function adopt(
    options: {
      seenUpTo?: Date | undefined;
      proxmoxClusterId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    } = {},
  ): Promise<number> {
    return ProxmoxResourceService.adoptNodesAsNativePush({
      projectId: options.projectId || PROJECT_ID,
      proxmoxClusterId: options.proxmoxClusterId || CLUSTER_ID,
      seenUpTo: options.seenUpTo || NOW,
    });
  }

  async function removeNode(
    externalId: string,
    options: {
      proxmoxClusterId?: ObjectID | undefined;
      projectId?: ObjectID | undefined;
    } = {},
  ): Promise<ProxmoxRemoveNodeResult> {
    return ProxmoxResourceService.removeOfflineNode({
      projectId: options.projectId || PROJECT_ID,
      proxmoxClusterId: options.proxmoxClusterId || CLUSTER_ID,
      externalId: externalId,
    });
  }

  async function roster(
    proxmoxClusterId: ObjectID = CLUSTER_ID,
    now: Date = NOW,
  ): Promise<Array<ProxmoxRosterNode>> {
    return ProxmoxResourceService.getNodeRoster({
      projectId: PROJECT_ID,
      proxmoxClusterId: proxmoxClusterId,
      now: now,
    });
  }

  /*
   * Set the database clock - the schema's now() - to `clock`, or back to
   * pg_catalog.now() with null. One statement: the old row goes, the new
   * one comes, in the same snapshot.
   */
  async function setDatabaseClock(clock: Date | null): Promise<void> {
    if (clock === null) {
      await database.query(`DELETE FROM "${schema}"."${CLOCK_TABLE}"`);
      return;
    }
    await database.query(
      `WITH cleared AS (DELETE FROM "${schema}"."${CLOCK_TABLE}")
       INSERT INTO "${schema}"."${CLOCK_TABLE}" ("at") VALUES ($1)`,
      [clock],
    );
  }

  // The row's updatedAt as the service reads it: a Date.
  async function updatedAtOf(
    nodeName: string,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<Date> {
    const rows: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "${schema}"."${TABLE}"
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "externalId" = $3`,
      [PROJECT_ID.toString(), proxmoxClusterId.toString(), `node/${nodeName}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedAt).toBeInstanceOf(Date);
    return rows[0]!.updatedAt;
  }

  // The row's not-reporting mark as the service reads it: a Date, or null.
  async function markedAtOf(
    nodeName: string,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<Date | null> {
    const rows: Array<{ notReportingMarkedAt: Date | null }> =
      await database.query(
        `SELECT "notReportingMarkedAt" FROM "${schema}"."${TABLE}"
         WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
           AND "kind" = 'Node' AND "externalId" = $3`,
        [
          PROJECT_ID.toString(),
          proxmoxClusterId.toString(),
          `node/${nodeName}`,
        ],
      );
    expect(rows).toHaveLength(1);
    const markedAt: Date | null = rows[0]!.notReportingMarkedAt;
    if (markedAt !== null) {
      expect(markedAt).toBeInstanceOf(Date);
    }
    return markedAt;
  }

  // The mark in epoch ms, for a row that must carry one.
  async function markedAtMsOf(
    nodeName: string,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<number> {
    const markedAt: Date | null = await markedAtOf(nodeName, proxmoxClusterId);
    expect(markedAt).not.toBeNull();
    return markedAt!.getTime();
  }

  /*
   * Set a row's mark directly, as if the last report had marked it then (or
   * never, with null); nothing else changes - not even updatedAt.
   */
  async function setMarkedAt(
    nodeName: string,
    markedAt: Date | null,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    const result: [unknown, number] = await database.query(
      `UPDATE "${schema}"."${TABLE}"
       SET "notReportingMarkedAt" = $4
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "externalId" = $3`,
      [
        PROJECT_ID.toString(),
        proxmoxClusterId.toString(),
        `node/${nodeName}`,
        markedAt,
      ],
    );
    expect(result[1]).toBe(1);
  }

  /*
   * Set a row's updatedAt, as if its last write were then; nothing else
   * changes.
   */
  async function setUpdatedAt(
    nodeName: string,
    updatedAt: Date,
    proxmoxClusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    const result: [unknown, number] = await database.query(
      `UPDATE "${schema}"."${TABLE}"
       SET "updatedAt" = $4
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "externalId" = $3`,
      [
        PROJECT_ID.toString(),
        proxmoxClusterId.toString(),
        `node/${nodeName}`,
        updatedAt,
      ],
    );
    expect(result[1]).toBe(1);
  }

  /*
   * The statements the service sends while `run` runs, by their first
   * keyword (the repository's manager is the DataSource's).
   */
  async function statementsDuring<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; statements: Array<string> }> {
    const query: jest.SpyInstance = jest.spyOn(database.manager, "query");
    try {
      const result: T = await run();
      return {
        result: result,
        statements: query.mock.calls.map((call: Array<unknown>): string => {
          return String(call[0]).trim().split(/\s+/)[0] || "";
        }),
      };
    } finally {
      query.mockRestore();
    }
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
      // pg_catalog named after the schema: the schema's now() comes first.
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
    await database.query(
      `CREATE TABLE "${schema}"."${CLOCK_TABLE}" ("at" timestamptz NOT NULL)`,
    );
    await database.query(
      `CREATE FUNCTION "${schema}".now() RETURNS timestamptz LANGUAGE sql STABLE
       AS $$ SELECT COALESCE((SELECT "at" FROM "${schema}"."${CLOCK_TABLE}" LIMIT 1), pg_catalog.now()) $$`,
    );
    // The clone's default was copied bound to pg_catalog.now().
    await database.query(
      `ALTER TABLE "${schema}"."${TABLE}" ALTER COLUMN "updatedAt" SET DEFAULT "${schema}".now()`,
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
    // The database clock back on pg_catalog.now().
    await setDatabaseClock(null);
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

    /*
     * AddProxmoxResourceNativePushColumns1796200000000: the mark is its own
     * nullable timestamptz with no default, so every row the migration finds
     * reads as never reported down, in the source table and the clone alike.
     */
    test("notReportingMarkedAt is a nullable timestamptz with no default, in the migrated table and the clone", async () => {
      for (const tableSchema of ["public", schema]) {
        const columns: Array<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }> = await database.query(
          `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND column_name = 'notReportingMarkedAt'`,
          [tableSchema, TABLE],
        );
        expect(columns).toEqual([
          {
            data_type: "timestamp with time zone",
            is_nullable: "YES",
            column_default: null,
          },
        ]);
      }

      // A row written without it - as before the migration - reads NULL.
      await insertLegacyRow("Node", "node/legacy", at(-MINUTE_MS));
      expect(await markedAtOf("legacy")).toBeNull();
    });

    test("the model reads the columns the service writes", async () => {
      const markedAt: Date = at(-30 * SECOND_MS);
      await upsert([node("pve1", { lastSeenAt: at(-5 * MINUTE_MS) })], {
        isNativePush: true,
      });
      expect(
        await mark(["pve1"], at(-3 * MINUTE_MS), CLUSTER_ID, markedAt),
      ).toBe(1);
      await upsert([node("pve9")], {
        isNativePush: false,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });

      const found: Array<ProxmoxResource> = await ProxmoxResourceService.findBy(
        {
          query: { projectId: PROJECT_ID, kind: "Node" },
          select: {
            externalId: true,
            isNativePush: true,
            notReportingMarkedAt: true,
          },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        },
      );

      expect(
        found
          .map((resource: ProxmoxResource): [string, unknown, unknown] => {
            return [
              resource.externalId!,
              resource.isNativePush,
              resource.notReportingMarkedAt
                ? new Date(resource.notReportingMarkedAt).getTime()
                : resource.notReportingMarkedAt,
            ];
          })
          .sort(),
      ).toEqual([
        ["node/pve1", true, markedAt.getTime()],
        ["node/pve9", false, null],
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
            notReportingMarkedAt: row.notReportingMarkedAt,
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
          // A new row starts with no mark: only a report writes one.
          notReportingMarkedAt: null,
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
          // A new row starts with no mark: only a report writes one.
          notReportingMarkedAt: null,
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
          // A new row starts with no mark: only a report writes one.
          notReportingMarkedAt: null,
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

    /*
     * The mark is the live nodes' report that the node stopped reporting; a
     * real observation of the node ends it - under the same lastSeenAt
     * guard as the rest of the row, so a replay of the observation the row
     * holds ends it too and a batch processed late never does.
     */
    test.each<{ source: string; isNativePush: boolean }>([
      { source: "the native push", isNativePush: true },
      { source: "the agent", isNativePush: false },
    ])(
      "a batch from $source clears the mark on an observation as new as the row's or newer, and never on an older one",
      async (row: { source: string; isNativePush: boolean }) => {
        const lastPush: Date = at(-10 * MINUTE_MS);
        const markedAt: Date = at(-7 * MINUTE_MS);
        await upsert(
          [
            node("pve2", { lastSeenAt: lastPush }),
            node("pve3", { lastSeenAt: lastPush }),
          ],
          { isNativePush: true },
        );
        expect(
          await mark(
            ["pve2", "pve3"],
            at(-8 * MINUTE_MS),
            CLUSTER_ID,
            markedAt,
          ),
        ).toBe(2);
        expect(await markedAtMsOf("pve2")).toBe(markedAt.getTime());
        const marked: ResourceRow = await nodeRow("pve2");

        // Older than the row: the guard skips the whole DO UPDATE.
        await upsert([node("pve2", { lastSeenAt: at(-11 * MINUTE_MS) })], {
          isNativePush: row.isNativePush,
        });
        expect(await nodeRow("pve2")).toEqual(marked);

        // As new as the row (a replay): applied, the mark ended.
        await upsert([node("pve2", { lastSeenAt: lastPush })], {
          isNativePush: row.isNativePush,
        });
        expect(await nodeRow("pve2")).toMatchObject({
          isUp: true,
          isNativePush: row.isNativePush,
          notReportingMarkedAt: null,
          lastSeenAt: lastPush,
        });

        // Newer: applied, the mark ended.
        await upsert([node("pve3", { lastSeenAt: at(0) })], {
          isNativePush: row.isNativePush,
        });
        expect(await nodeRow("pve3")).toMatchObject({
          isUp: true,
          isNativePush: row.isNativePush,
          notReportingMarkedAt: null,
          lastSeenAt: at(0),
        });

        // A report as the node goes quiet again marks it anew, at once.
        const remarkedAt: Date = at(-6 * MINUTE_MS);
        expect(
          await mark(["pve2"], at(-8 * MINUTE_MS), CLUSTER_ID, remarkedAt),
        ).toBe(1);
        expect(await markedAtMsOf("pve2")).toBe(remarkedAt.getTime());
      },
    );

    /*
     * The agent reports each node's own state - never that a node stopped
     * reporting - so its batch never marks a row, however it lists the node
     * and whatever the database clock reads: an agent-era Offline row must
     * never pass for a node the live nodes have just reported down.
     */
    test.each<{ label: string; skewMs: number }>([
      { label: "on the database's own clock", skewMs: 0 },
      {
        label: "with the database clock three hours ahead",
        skewMs: 3 * HOUR_MS,
      },
      {
        label: "with the database clock three hours behind",
        skewMs: -3 * HOUR_MS,
      },
    ])(
      "an agent batch listing a node Offline leaves the mark NULL $label - on insert and on update, NULL isNativePush rows included",
      async (row: { label: string; skewMs: number }) => {
        const scrapedAt: Date = at(-MINUTE_MS);
        await setDatabaseClock(new Date(scrapedAt.getTime() + row.skewMs));
        await upsertFrom(false, [
          node("agent-down", {
            isUp: false,
            uptimeSeconds: null,
            lastSeenAt: scrapedAt,
          }),
          node("agent-up", { lastSeenAt: scrapedAt }),
        ]);
        await upsertFrom(null, [
          node("legacy-down", { isUp: false, lastSeenAt: scrapedAt }),
        ]);
        // Updated in place by a newer scrape, still Offline.
        await upsert([node("agent-down", { isUp: false, lastSeenAt: at(0) })], {
          isNativePush: false,
        });

        for (const nodeName of ["agent-down", "agent-up", "legacy-down"]) {
          expect(await markedAtOf(nodeName)).toBeNull();
        }
        // updatedAt is the database's stamp - the one thing that moved.
        expect((await updatedAtOf("agent-up")).getTime()).toBe(
          scrapedAt.getTime() + row.skewMs,
        );
        expect(await nodeRow("agent-down")).toMatchObject({
          isUp: false,
          isNativePush: false,
          notReportingMarkedAt: null,
        });

        /*
         * The roster hands on no mark, so with no node established the
         * Offline row is never reported - it waits for an established node.
         */
        const entries: Array<ProxmoxRosterNode> = await roster();
        const agentDown: ProxmoxRosterNode | undefined = entries.find(
          (entry: ProxmoxRosterNode): boolean => {
            return entry.nodeName === "agent-down";
          },
        );
        expect(agentDown).toMatchObject({
          isUp: false,
          notReportingMarkedAt: null,
        });
        const decideAtMs: number =
          at(0).getTime() + PROXMOX_NODE_SILENCE_MS + 1;
        expect(
          decideProxmoxSilentNodes({
            selfNode: "pve1",
            reporterTimeMs: decideAtMs,
            nowMs: decideAtMs,
            roster: entries,
            // pve1 has just started pushing: alive, not established.
            liveness: new Map<string, ProxmoxNodeLiveness | null>([
              ["pve1", nextProxmoxNodeLiveness(null, decideAtMs)],
            ]),
            rosterReadAtMs: decideAtMs,
          }),
        ).toBeNull();
      },
    );

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
      expect(before.notReportingMarkedAt).toBeNull();

      // Reported a minute after the silence window ran out.
      const markedAt: Date = at(-30 * SECOND_MS);
      expect(await mark(["pve3"], at(-MINUTE_MS), CLUSTER_ID, markedAt)).toBe(
        1,
      );

      const after: ResourceRow = await nodeRow("pve3");
      expect(after).toEqual({
        ...before,
        isUp: false,
        uptimeSeconds: null,
        notReportingMarkedAt: markedAt,
        updatedAtText: after.updatedAtText,
      });
      expect(after.updatedAtText).not.toBe(before.updatedAtText);
      expect(after.lastSeenAt).toEqual(lastPush);
      expect(after.metricsUpdatedAt).toEqual(lastPush);
      expect(after.isNativePush).toBe(true);

      for (const untouched of [
        await nodeRow("pve1"),
        await nodeRow("pve2"),
        (await rowOf("qemu/300", { kind: "Guest" }))!,
        await nodeRow("pve3", OTHER_CLUSTER_ID),
        (await rowOf("node/pve3", { projectId: OTHER_PROJECT_ID }))!,
      ]) {
        expect(untouched.isUp).toBe(true);
        expect(untouched.notReportingMarkedAt).toBeNull();
      }
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

    test("within the minute after the mark, another report writes 0 rows and leaves the mark - and updatedAt - as the first set them", async () => {
      await upsert([node("pve3", { lastSeenAt: at(-5 * MINUTE_MS) })], {
        isNativePush: true,
      });

      // No markedAt: the worker's current time, read by the service.
      const calledFrom: number = Date.now();
      expect(await mark(["pve3"], at(-3 * MINUTE_MS))).toBe(1);
      const first: ResourceRow = await nodeRow("pve3");
      expect(first.notReportingMarkedAt).toBeInstanceOf(Date);
      expect(first.notReportingMarkedAt!.getTime()).toBeGreaterThanOrEqual(
        calledFrom,
      );
      expect(first.notReportingMarkedAt!.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );

      expect(await mark(["pve3"], at(-3 * MINUTE_MS))).toBe(0);
      // A later report (a later silentBefore) is no different.
      expect(await mark(["pve3"], at(0))).toBe(0);

      expect(await nodeRow("pve3")).toEqual(first);
    });

    /*
     * While the live nodes keep reporting a node, its row is rewritten at
     * most once a minute on the reports' own clock (markedAt) - the mark
     * the reports carry on from while no node is established.
     */
    test("an Offline native row marked 30 s before the report's markedAt is not rewritten; one marked 90 s before is - its notReportingMarkedAt moves to that markedAt, and lastSeenAt, metricsUpdatedAt and the rest do not", async () => {
      const lastPush: Date = at(-10 * MINUTE_MS);
      const markedAt: Date = at(-5 * MINUTE_MS);
      await upsert([node("pve3", { lastSeenAt: lastPush })], {
        isNativePush: true,
      });
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [nodeMetric("pve3", { observedAt: lastPush })],
      });
      expect(
        await mark(["pve3"], at(-2 * MINUTE_MS), CLUSTER_ID, markedAt),
      ).toBe(1);
      const marked: ResourceRow = await nodeRow("pve3");
      expect(await markedAtMsOf("pve3")).toBe(markedAt.getTime());

      expect(
        await mark(
          ["pve3"],
          at(-2 * MINUTE_MS),
          CLUSTER_ID,
          new Date(markedAt.getTime() + 30 * SECOND_MS),
        ),
      ).toBe(0);
      expect(await nodeRow("pve3")).toEqual(marked);

      const refreshedAt: Date = new Date(markedAt.getTime() + 90 * SECOND_MS);
      expect(
        await mark(["pve3"], at(-2 * MINUTE_MS), CLUSTER_ID, refreshedAt),
      ).toBe(1);

      const refreshed: ResourceRow = await nodeRow("pve3");
      expect(refreshed).toEqual({
        ...marked,
        notReportingMarkedAt: refreshedAt,
        updatedAtText: refreshed.updatedAtText,
      });
      expect(refreshed.updatedAtText).not.toBe(marked.updatedAtText);
      expect(refreshed).toMatchObject({
        isUp: false,
        uptimeSeconds: null,
        isNativePush: true,
        lastSeenAt: lastPush,
        metricsUpdatedAt: lastPush,
      });
      // Moved up by the 90 s, to the report's markedAt exactly.
      expect(await markedAtMsOf("pve3")).toBe(refreshedAt.getTime());

      // Refreshed: within the minute after it, nothing to write again.
      expect(
        await mark(
          ["pve3"],
          at(0),
          CLUSTER_ID,
          new Date(refreshedAt.getTime() + 30 * SECOND_MS),
        ),
      ).toBe(0);
      expect(await markedAtMsOf("pve3")).toBe(refreshedAt.getTime());
    });

    test("on markedAt: a mark exactly 60 s before the report's markedAt is left, one a millisecond older is rewritten to that markedAt - so a node reported every 10 s is rewritten every 70 s", async () => {
      const lastPush: Date = at(-10 * MINUTE_MS);
      const markedAt: Date = at(-8 * MINUTE_MS);
      /*
       * The database clock stays at lastPush throughout, minutes behind
       * every report: the mark never reads it, and it stamps updatedAt only.
       */
      await setDatabaseClock(lastPush);
      await upsert([node("pve3", { lastSeenAt: lastPush })], {
        isNativePush: true,
      });
      expect(
        await mark(["pve3"], at(-9 * MINUTE_MS), CLUSTER_ID, markedAt),
      ).toBe(1);
      expect(await markedAtMsOf("pve3")).toBe(markedAt.getTime());
      expect((await updatedAtOf("pve3")).getTime()).toBe(lastPush.getTime());

      // The guard is strict: 60 s is not more than 60 s.
      expect(
        await mark(
          ["pve3"],
          at(-9 * MINUTE_MS),
          CLUSTER_ID,
          new Date(markedAt.getTime() + MARK_REFRESH_MS),
        ),
      ).toBe(0);
      expect(await markedAtMsOf("pve3")).toBe(markedAt.getTime());

      const justPast: Date = new Date(markedAt.getTime() + MARK_REFRESH_MS + 1);
      expect(
        await mark(["pve3"], at(-9 * MINUTE_MS), CLUSTER_ID, justPast),
      ).toBe(1);
      expect(await markedAtMsOf("pve3")).toBe(justPast.getTime());
      expect((await updatedAtOf("pve3")).getTime()).toBe(lastPush.getTime());
      expect(await nodeRow("pve3")).toMatchObject({
        isUp: false,
        isNativePush: true,
        lastSeenAt: lastPush,
      });

      // Reported every 10 s for five minutes from the first mark.
      await setMarkedAt("pve3", markedAt);
      const reportTimes: Array<number> = [];
      const written: Array<number> = [];
      for (
        let elapsedMs: number = 10 * SECOND_MS;
        elapsedMs <= 5 * MINUTE_MS;
        elapsedMs += 10 * SECOND_MS
      ) {
        const reportAtMs: number = markedAt.getTime() + elapsedMs;
        reportTimes.push(reportAtMs);
        if (
          (await mark(
            ["pve3"],
            at(-9 * MINUTE_MS),
            CLUSTER_ID,
            new Date(reportAtMs),
          )) === 1
        ) {
          written.push(reportAtMs);
        }
      }
      expect(written).toEqual(expectedWrites(reportTimes, markedAt.getTime()));
      expect(written).toEqual(
        [70, 140, 210, 280].map((seconds: number): number => {
          return markedAt.getTime() + seconds * SECOND_MS;
        }),
      );
      expect(await markedAtMsOf("pve3")).toBe(written[written.length - 1]);
    });

    /*
     * The reports of an Offline node carry on while the roster read's time
     * minus notReportingMarkedAt, on the ingest worker's clock, is within the
     * monitor window - so the mark is stamped and refreshed on that clock,
     * never the database's, which stamps updatedAt alone. On the database's
     * now(), a database clock ahead of the worker's kept every mark from
     * ageing out, and one behind aged it out at once.
     */
    test.each<{ label: string; skewMs: number }>([
      { label: "three hours ahead of", skewMs: 3 * HOUR_MS },
      { label: "three hours behind", skewMs: -3 * HOUR_MS },
    ])(
      "with the database clock $label the worker's: notReportingMarkedAt is exactly the markedAt passed, the refresh compares it with markedAt - 60 s, and the roster hands the decision that very time - never updatedAt",
      async (row: { label: string; skewMs: number }) => {
        const onDatabaseClock: (workerAt: Date) => Promise<void> = (
          workerAt: Date,
        ): Promise<void> => {
          return setDatabaseClock(new Date(workerAt.getTime() + row.skewMs));
        };
        const lastPush: Date = at(-10 * MINUTE_MS);
        const markedAt: Date = at(-5 * MINUTE_MS);
        await onDatabaseClock(lastPush);
        await upsert([node("pve1"), node("pve3", { lastSeenAt: lastPush })], {
          isNativePush: true,
        });
        // The upsert stamps the database's clock, and no mark…
        expect((await updatedAtOf("pve3")).getTime()).toBe(
          lastPush.getTime() + row.skewMs,
        );
        expect(await markedAtOf("pve3")).toBeNull();

        // …the mark, the markedAt it is given - updatedAt the database's.
        await onDatabaseClock(markedAt);
        expect(
          await mark(["pve3"], at(-9 * MINUTE_MS), CLUSTER_ID, markedAt),
        ).toBe(1);
        expect(await markedAtMsOf("pve3")).toBe(markedAt.getTime());
        expect((await updatedAtOf("pve3")).getTime()).toBe(
          markedAt.getTime() + row.skewMs,
        );

        // Rewritten only once strictly more than 60 s before a markedAt.
        const atBound: Date = new Date(markedAt.getTime() + MARK_REFRESH_MS);
        await onDatabaseClock(atBound);
        expect(
          await mark(["pve3"], at(-9 * MINUTE_MS), CLUSTER_ID, atBound),
        ).toBe(0);
        expect(await markedAtMsOf("pve3")).toBe(markedAt.getTime());
        const justPast: Date = new Date(atBound.getTime() + 1);
        await onDatabaseClock(justPast);
        expect(
          await mark(["pve3"], at(-9 * MINUTE_MS), CLUSTER_ID, justPast),
        ).toBe(1);
        expect(await markedAtMsOf("pve3")).toBe(justPast.getTime());
        expect((await updatedAtOf("pve3")).getTime()).toBe(
          justPast.getTime() + row.skewMs,
        );

        /*
         * The roster hands on the mark - never updatedAt, hours off it; with
         * no node established, pve1 reports pve3 while the roster was read
         * within the monitor window of the mark, and not a millisecond past
         * it - however long after that read the push deciding on it is.
         */
        const entries: Array<ProxmoxRosterNode> = await roster();
        const pve3: ProxmoxRosterNode | undefined = entries.find(
          (entry: ProxmoxRosterNode): boolean => {
            return entry.nodeName === "pve3";
          },
        );
        expect(pve3).toStrictEqual({
          nodeName: "pve3",
          lastSeenAt: lastPush,
          isUp: false,
          notReportingMarkedAt: justPast,
        });
        const decideAt: (
          nowMs: number,
          rosterReadAtMs?: number | undefined,
        ) => ProxmoxSilentNodeDecision | null = (
          nowMs: number,
          rosterReadAtMs?: number | undefined,
        ): ProxmoxSilentNodeDecision | null => {
          return decideProxmoxSilentNodes({
            selfNode: "pve1",
            reporterTimeMs: nowMs,
            nowMs: nowMs,
            roster: entries,
            // pve1 has just started pushing: alive, not established.
            liveness: new Map<string, ProxmoxNodeLiveness | null>([
              ["pve1", nextProxmoxNodeLiveness(null, nowMs)],
            ]),
            rosterReadAtMs: rosterReadAtMs,
          });
        };
        const edgeMs: number = justPast.getTime() + PROXMOX_MONITOR_WINDOW_MS;
        // Read by the push itself.
        expect(decideAt(edgeMs)).toEqual({
          silentNodes: ["pve3"],
          reporterCount: 1,
        });
        expect(decideAt(edgeMs + 1)).toBeNull();
        // Read at the edge and reused 20 s on, or read just past it.
        expect(decideAt(edgeMs + 20 * SECOND_MS, edgeMs)).toEqual({
          silentNodes: ["pve3"],
          reporterCount: 1,
        });
        expect(decideAt(edgeMs + 20 * SECOND_MS, edgeMs + 1)).toBeNull();
      },
    );

    test("without markedAt the mark is stamped with the worker's current time, read once - never the database clock", async () => {
      const workerNow: Date = at(-4 * MINUTE_MS);
      await upsert([node("pve3", { lastSeenAt: at(-10 * MINUTE_MS) })], {
        isNativePush: true,
      });
      await setDatabaseClock(at(2 * HOUR_MS));
      const getCurrentDate: jest.SpyInstance = jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(workerNow);

      expect(await mark(["pve3"], at(-5 * MINUTE_MS))).toBe(1);
      expect(getCurrentDate).toHaveBeenCalledTimes(1);
      expect(await markedAtMsOf("pve3")).toBe(workerNow.getTime());
      // The database's clock stamps updatedAt alone.
      expect((await updatedAtOf("pve3")).getTime()).toBe(
        at(2 * HOUR_MS).getTime(),
      );

      // And the refresh reads the same clock: a minute on, still 0 rows.
      getCurrentDate.mockReturnValue(
        new Date(workerNow.getTime() + MARK_REFRESH_MS),
      );
      expect(await mark(["pve3"], at(-5 * MINUTE_MS))).toBe(0);
      getCurrentDate.mockReturnValue(
        new Date(workerNow.getTime() + MARK_REFRESH_MS + 1),
      );
      expect(await mark(["pve3"], at(-5 * MINUTE_MS))).toBe(1);
      expect(await markedAtMsOf("pve3")).toBe(
        workerNow.getTime() + MARK_REFRESH_MS + 1,
      );
    });

    test("only a row already Offline, native and marked waits for its mark to age - by the mark alone, whatever its updatedAt: every other named row is marked at once, and the refresh never reaches a row the node refreshed itself, a soft-deleted one or another cluster's", async () => {
      const stale: Date = at(-10 * MINUTE_MS);
      const silentBefore: Date = at(-2 * MINUTE_MS);
      await setDatabaseClock(at(-5 * MINUTE_MS));
      await upsert(
        [
          node("online", { lastSeenAt: stale }),
          node("unknown", { isUp: null, lastSeenAt: stale }),
          // Its own last batch said it was down: Offline, never marked.
          node("offline-unmarked", { isUp: false, lastSeenAt: stale }),
          node("offline-fresh", { isUp: false, lastSeenAt: stale }),
          node("offline-aged", { isUp: false, lastSeenAt: stale }),
          node("offline-aged-refreshed", { isUp: false, lastSeenAt: at(0) }),
          node("offline-aged-deleted", { isUp: false, lastSeenAt: stale }),
        ],
        { isNativePush: true },
      );
      await upsertFrom(false, [
        node("agent-offline", { isUp: false, lastSeenAt: stale }),
        node("agent-offline-marked", { isUp: false, lastSeenAt: stale }),
      ]);
      await upsert([node("offline-aged", { isUp: false, lastSeenAt: stale })], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      await softDelete("Node", "node/offline-aged-deleted");
      /*
       * The marks, set directly: exactly 60 s before the report's markedAt
       * (left), and a millisecond more (rewritten). updatedAt says the
       * opposite of each - the fresh mark's row last written a day ago, the
       * aged ones' an hour ahead - and the guard never reads it.
       */
      await setMarkedAt("offline-fresh", at(-MARK_REFRESH_MS));
      await setUpdatedAt("offline-fresh", at(-DAY_MS));
      for (const nodeName of [
        "offline-aged",
        "offline-aged-refreshed",
        "offline-aged-deleted",
      ]) {
        await setMarkedAt(nodeName, at(-MARK_REFRESH_MS - 1));
        await setUpdatedAt(nodeName, at(HOUR_MS));
      }
      await setMarkedAt(
        "offline-aged",
        at(-MARK_REFRESH_MS - 1),
        OTHER_CLUSTER_ID,
      );
      /*
       * An agent row with a fresh mark cannot come about (the agent's batch
       * clears the mark); set directly, it pins that the flag clause takes
       * it over whatever its mark.
       */
      await setMarkedAt("agent-offline-marked", at(-10 * SECOND_MS));
      const before: Array<ResourceRow> = await readRows();
      const otherBefore: Array<ResourceRow> = await readRows(OTHER_CLUSTER_ID);

      // Reported at NOW on the worker's clock; the database's is a minute back.
      await setDatabaseClock(at(-MINUTE_MS));
      expect(
        await mark(
          [
            "online",
            "unknown",
            "offline-unmarked",
            "offline-fresh",
            "offline-aged",
            "offline-aged-refreshed",
            "offline-aged-deleted",
            "agent-offline",
            "agent-offline-marked",
          ],
          silentBefore,
          CLUSTER_ID,
          NOW,
        ),
      ).toBe(6);

      const after: Map<string, ResourceRow> = new Map(
        (await readRows()).map((row: ResourceRow): [string, ResourceRow] => {
          return [row.externalId, row];
        }),
      );
      const moved: Array<string> = before
        .filter((row: ResourceRow): boolean => {
          return (
            JSON.stringify(after.get(row.externalId)) !== JSON.stringify(row)
          );
        })
        .map((row: ResourceRow): string => {
          return row.externalId;
        })
        .sort();
      expect(moved).toEqual([
        "node/agent-offline",
        "node/agent-offline-marked",
        "node/offline-aged",
        "node/offline-unmarked",
        "node/online",
        "node/unknown",
      ]);
      for (const externalId of moved) {
        expect(after.get(externalId)).toMatchObject({
          isUp: false,
          uptimeSeconds: null,
          isNativePush: true,
          // The worker's markedAt…
          notReportingMarkedAt: NOW,
          lastSeenAt: stale,
        });
        // …and updatedAt, the database's clock.
        expect(
          (await updatedAtOf(externalId.substring("node/".length))).getTime(),
        ).toBe(at(-MINUTE_MS).getTime());
      }
      // Every other row exactly as it was, its mark included.
      for (const row of before) {
        if (!moved.includes(row.externalId)) {
          expect(after.get(row.externalId)).toEqual(row);
        }
      }
      expect(await markedAtMsOf("offline-fresh")).toBe(
        at(-MARK_REFRESH_MS).getTime(),
      );
      // Another cluster's aged row is never this cluster's report's.
      expect(await readRows(OTHER_CLUSTER_ID)).toEqual(otherBefore);
    });

    test("a native Offline row its own batch said was down carries no mark and is marked at once, as is a NULL isUp; one marked within the minute before the report's markedAt is not rewritten, a soft-deleted row is not, and no names write nothing", async () => {
      await setDatabaseClock(NOW);
      await upsert(
        [
          // Its own last batch already said it was down.
          node("down", { isUp: false, uptimeSeconds: 42 }),
          // A batch that lacked pve_up.
          node("unknown", { isUp: null }),
          node("marked"),
          node("deleted"),
        ],
        { isNativePush: true },
      );
      expect(await markedAtOf("down")).toBeNull();
      // Reported down 30 s before the report below.
      expect(await mark(["marked"], at(MINUTE_MS), CLUSTER_ID, NOW)).toBe(1);
      await softDelete("Node", "node/deleted");
      const marked: ResourceRow = await nodeRow("marked");
      const reportedAt: Date = at(30 * SECOND_MS);

      expect(
        await mark(
          ["down", "unknown", "marked", "deleted"],
          at(MINUTE_MS),
          CLUSTER_ID,
          reportedAt,
        ),
      ).toBe(2);
      expect(await nodeRow("down")).toMatchObject({
        isUp: false,
        uptimeSeconds: null,
        isNativePush: true,
        notReportingMarkedAt: reportedAt,
      });
      expect(await nodeRow("unknown")).toMatchObject({
        isUp: false,
        notReportingMarkedAt: reportedAt,
      });
      expect(await nodeRow("marked")).toEqual(marked);
      expect(await nodeRow("deleted")).toMatchObject({
        isUp: true,
        notReportingMarkedAt: null,
      });

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
        // The agent never marks a row: its Offline row carries no mark.
        expect(downBefore.notReportingMarkedAt).toBeNull();
        const reported: Array<string> = ["down", "up", "fresh", "deleted"];
        const markedAt: Date = at(-30 * SECOND_MS);

        expect(await mark(reported, silentBefore, CLUSTER_ID, markedAt)).toBe(
          2,
        );

        /*
         * The source changes, and the mark is written: isUp was false
         * already, and stays so.
         */
        const downAfter: ResourceRow = await nodeRow("down");
        expect(downAfter).toEqual({
          ...downBefore,
          isNativePush: true,
          notReportingMarkedAt: markedAt,
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
          notReportingMarkedAt: markedAt,
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

        // Marked and taken over: the next reports within the minute write nothing.
        const marked: Array<ResourceRow> = await readRows();
        expect(
          await mark(
            reported,
            silentBefore,
            CLUSTER_ID,
            new Date(markedAt.getTime() + 30 * SECOND_MS),
          ),
        ).toBe(0);
        expect(
          await mark(
            reported,
            at(0),
            CLUSTER_ID,
            new Date(markedAt.getTime() + MARK_REFRESH_MS),
          ),
        ).toBe(0);
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
    // pve2 is marked by a report at markedAt, on the worker's clock.
    async function seedRoster(markedAt: Date = NOW): Promise<void> {
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
      await mark(["pve2"], NOW, CLUSTER_ID, markedAt);
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

    /*
     * The live nodes go on reporting a node that is already Offline, and
     * was marked within the monitor window of the roster read, even while
     * none of them is established, and nothing else - so the roster carries
     * each row's state exactly: a boolean, or null when the row's last batch
     * lacked pve_up, never undefined; and its mark, notReportingMarkedAt, as
     * a Date - the last report's markedAt - or null on a row no report has
     * marked since its own last observation. Never updatedAt, which every
     * write stamps on the database's clock.
     */
    test("carries each row's Online / Offline state - false once marked or as the agent last saw it, null when unknown - and its mark: the report's markedAt, or null - never updatedAt", async () => {
      const seededAt: Date = at(-3 * MINUTE_MS);
      const pve2MarkedAt: Date = at(-150 * SECOND_MS);
      const unknownAt: Date = at(-2 * MINUTE_MS);
      const agentDownAt: Date = at(-MINUTE_MS);
      await setDatabaseClock(seededAt);
      await seedRoster(pve2MarkedAt);
      await setDatabaseClock(unknownAt);
      await upsert([node("unknown", { isUp: null })], { isNativePush: true });
      // The agent's Offline row, written with the database clock an hour on.
      await setDatabaseClock(new Date(agentDownAt.getTime() + HOUR_MS));
      await upsert(
        [node("agent-down", { isUp: false, lastSeenAt: at(-HOUR_MS) })],
        { isNativePush: false },
      );

      const entries: Array<ProxmoxRosterNode> = (await roster()).sort(
        (a: ProxmoxRosterNode, b: ProxmoxRosterNode): number => {
          return a.nodeName.localeCompare(b.nodeName);
        },
      );

      expect(entries).toStrictEqual([
        {
          nodeName: "agent-down",
          lastSeenAt: at(-HOUR_MS),
          isUp: false,
          notReportingMarkedAt: null,
        },
        {
          nodeName: "agent1",
          lastSeenAt: at(-DAY_MS),
          isUp: true,
          notReportingMarkedAt: null,
        },
        {
          nodeName: "pve1",
          lastSeenAt: NOW,
          isUp: true,
          notReportingMarkedAt: null,
        },
        // Marked by the live nodes' report, at its markedAt.
        {
          nodeName: "pve2",
          lastSeenAt: at(-6 * DAY_MS),
          isUp: false,
          notReportingMarkedAt: pve2MarkedAt,
        },
        {
          nodeName: "pve3",
          lastSeenAt: at(-7 * DAY_MS),
          isUp: true,
          notReportingMarkedAt: null,
        },
        {
          nodeName: "unknown",
          lastSeenAt: NOW,
          isUp: null,
          notReportingMarkedAt: null,
        },
      ]);
      // The stamp the roster does not hand on, for the record.
      expect((await updatedAtOf("agent-down")).getTime()).toBe(
        agentDownAt.getTime() + HOUR_MS,
      );

      // The mark and the node's own next push move them; the roster follows.
      await setDatabaseClock(NOW);
      expect(await mark(["pve1"], at(MINUTE_MS), CLUSTER_ID, NOW)).toBe(1);
      await upsert([node("pve2", { lastSeenAt: at(MINUTE_MS) })], {
        isNativePush: true,
      });
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "agent-down", isUp: false },
        { nodeName: "agent1", isUp: true },
        { nodeName: "pve1", isUp: false },
        { nodeName: "pve2", isUp: true },
        { nodeName: "pve3", isUp: true },
        { nodeName: "unknown", isUp: null },
      ]);
      expect(
        (await roster())
          .map((entry: ProxmoxRosterNode): [string, number | null] => {
            return [
              entry.nodeName,
              entry.notReportingMarkedAt
                ? entry.notReportingMarkedAt.getTime()
                : null,
            ];
          })
          .sort(
            (
              a: [string, number | null],
              b: [string, number | null],
            ): number => {
              return a[0].localeCompare(b[0]);
            },
          ),
      ).toEqual([
        ["agent-down", null],
        ["agent1", null],
        ["pve1", NOW.getTime()],
        // Its own push ended the mark.
        ["pve2", null],
        ["pve3", null],
        ["unknown", null],
      ]);
    });

    test("an Offline row's mark is its last report's markedAt: a report refreshes it once it is more than a minute older than the report's markedAt, the roster reads the new one, and the node's own push clears it", async () => {
      // The database clock stays here, minutes behind every report.
      await setDatabaseClock(at(-10 * MINUTE_MS));
      await upsert(
        [
          node("pve1", { lastSeenAt: at(-10 * MINUTE_MS) }),
          node("pve2", { lastSeenAt: at(-10 * MINUTE_MS) }),
        ],
        { isNativePush: true },
      );
      expect(
        await mark(
          ["pve2"],
          at(-8 * MINUTE_MS),
          CLUSTER_ID,
          at(-7 * MINUTE_MS),
        ),
      ).toBe(1);

      const markOn: (entries: Array<ProxmoxRosterNode>) => number | null = (
        entries: Array<ProxmoxRosterNode>,
      ): number | null => {
        const entry: ProxmoxRosterNode | undefined = entries.find(
          (candidate: ProxmoxRosterNode): boolean => {
            return candidate.nodeName === "pve2";
          },
        );
        expect(entry).toBeDefined();
        return entry!.notReportingMarkedAt
          ? entry!.notReportingMarkedAt.getTime()
          : null;
      };
      expect(markOn(await roster())).toBe(at(-7 * MINUTE_MS).getTime());

      expect(
        await mark(
          ["pve2"],
          at(-8 * MINUTE_MS),
          CLUSTER_ID,
          at(-6 * MINUTE_MS),
        ),
      ).toBe(0);
      expect(markOn(await roster())).toBe(at(-7 * MINUTE_MS).getTime());

      expect(
        await mark(
          ["pve2"],
          at(-8 * MINUTE_MS),
          CLUSTER_ID,
          at(-5 * MINUTE_MS),
        ),
      ).toBe(1);
      expect(markOn(await roster())).toBe(at(-5 * MINUTE_MS).getTime());
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "pve1", isUp: true },
        { nodeName: "pve2", isUp: false },
      ]);
      // updatedAt stayed on the database's clock all along.
      expect((await updatedAtOf("pve2")).getTime()).toBe(
        at(-10 * MINUTE_MS).getTime(),
      );

      // Its own push, however stamped, ends the mark.
      await upsert([node("pve2", { lastSeenAt: at(-4 * MINUTE_MS) })], {
        isNativePush: true,
      });
      expect(markOn(await roster())).toBeNull();
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "pve1", isUp: true },
        { nodeName: "pve2", isUp: true },
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
    test("removed: deletes an Offline native-push Node row of this project and cluster with one statement, nothing else, and the roster lets it go", async () => {
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

      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode("node/pve3");
        }),
      ).toEqual({ result: "removed", statements: ["DELETE"] });
      expect(await rowOf("node/pve3")).toBeUndefined();

      // Gone: a second request deletes nothing, looks, and says so.
      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode("node/pve3");
        }),
      ).toEqual({ result: "not-found", statements: ["DELETE", "SELECT"] });

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
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "pve1", isUp: true },
        { nodeName: "pve4", isUp: null },
      ]);
    });

    test("not-found: a name the cluster does not have, another cluster's or project's Offline node, a soft-deleted Offline native row, a name that differs in case or spacing - none of them touched", async () => {
      await upsert([node("pve1", { isUp: false })], { isNativePush: true });
      await upsert([node("pve8", { isUp: false })], {
        isNativePush: true,
        proxmoxClusterId: OTHER_CLUSTER_ID,
      });
      await upsert([node("pve9", { isUp: false })], {
        isNativePush: true,
        projectId: OTHER_PROJECT_ID,
      });
      /*
       * Offline and native - all the DELETE's state guards would take - but
       * soft-deleted: no node of the cluster, never hard-deleted here.
       */
      await upsert([node("gone", { isUp: false })], { isNativePush: true });
      await softDelete("Node", "node/gone");
      expect(await rowOf("node/gone")).toMatchObject({
        isUp: false,
        isNativePush: true,
        deletedAt: expect.any(Date) as unknown as Date,
      });
      const cluster: Array<ResourceRow> = await readRows();
      const otherCluster: Array<ResourceRow> = await readRows(OTHER_CLUSTER_ID);
      const otherProject: Array<ResourceRow> = await readRows(
        CLUSTER_ID,
        OTHER_PROJECT_ID,
      );

      for (const externalId of [
        "node/ghost",
        "node/pve8",
        "node/pve9",
        "node/gone",
        "node/PVE1",
        "node/pve1 ",
      ]) {
        expect(
          await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
            return removeNode(externalId);
          }),
        ).toEqual({ result: "not-found", statements: ["DELETE", "SELECT"] });
      }

      expect(await readRows()).toEqual(cluster);
      expect(await readRows(OTHER_CLUSTER_ID)).toEqual(otherCluster);
      expect(await readRows(CLUSTER_ID, OTHER_PROJECT_ID)).toEqual(
        otherProject,
      );
    });

    test("not-found without a statement for an id that is not a node's, even one naming an Offline row", async () => {
      await upsert(
        [
          node("pve3", { isUp: false }),
          guest(100, "pve3", { isUp: false }),
          storage("pve3", "local", { isUp: false }),
        ],
        { isNativePush: true },
      );
      const before: Array<ResourceRow> = await readRows();

      for (const externalId of [
        "qemu/100",
        "storage/pve3/local",
        "pve3",
        "Node/pve3",
        "",
      ]) {
        expect(
          await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
            return removeNode(externalId);
          }),
        ).toEqual({ result: "not-found", statements: [] });
      }
      expect(await readRows()).toEqual(before);
    });

    /*
     * The agent lets a node go on its own once the cluster no longer lists
     * it, and would re-create one it still lists on its next scrape - so an
     * agent (or pre-migration) Node row is never removed here, whatever its
     * state.
     */
    test.each<{
      source: string;
      isNativePush: boolean | null;
      isUp: boolean | null;
    }>([
      {
        source: "an Offline row the agent wrote",
        isNativePush: false,
        isUp: false,
      },
      {
        source: "an Offline row from before the migration",
        isNativePush: null,
        isUp: false,
      },
      {
        source: "an Online row the agent wrote",
        isNativePush: false,
        isUp: true,
      },
      {
        source: "a row of unknown state from before the migration",
        isNativePush: null,
        isUp: null,
      },
    ])(
      "not-native: $source is left in place",
      async (row: {
        source: string;
        isNativePush: boolean | null;
        isUp: boolean | null;
      }) => {
        await upsertFrom(row.isNativePush, [
          node("pve3", { isUp: row.isUp, lastSeenAt: at(-20 * MINUTE_MS) }),
        ]);
        const before: ResourceRow = await nodeRow("pve3");
        expect(before.isNativePush).toBe(row.isNativePush);
        expect(before.isUp).toBe(row.isUp);

        expect(
          await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
            return removeNode("node/pve3");
          }),
        ).toEqual({ result: "not-native", statements: ["DELETE", "SELECT"] });
        expect(await nodeRow("pve3")).toEqual(before);
      },
    );

    /*
     * bulkUpsert stores a node's id clamped to the column (100 characters),
     * so a node named past it is found only by the id clamped the same way
     * - by the DELETE and by the read that says why nothing went.
     */
    test("a node named past the column is found by its id clamped as bulkUpsert stored it: removed by its full name or the stored one, and each other result read the same way", async () => {
      const removedByFullName: string = "f".repeat(150);
      const removedByStoredName: string = "s".repeat(150);
      const up: string = "u".repeat(150);
      const agents: string = "a".repeat(150);
      const storedId: (nodeName: string) => string = (
        nodeName: string,
      ): string => {
        return `node/${nodeName}`.substring(0, 100);
      };
      await upsert(
        [
          node(removedByFullName, { lastSeenAt: at(-10 * MINUTE_MS) }),
          node(removedByStoredName, { lastSeenAt: at(-10 * MINUTE_MS) }),
          node(up),
        ],
        { isNativePush: true },
      );
      await upsertFrom(false, [
        node(agents, { isUp: false, lastSeenAt: at(-10 * MINUTE_MS) }),
      ]);
      expect(
        await mark(
          [removedByFullName, removedByStoredName],
          at(-5 * MINUTE_MS),
        ),
      ).toBe(2);
      for (const nodeName of [removedByFullName, up, agents]) {
        expect(storedId(nodeName)).toHaveLength(100);
        expect(await rowOf(storedId(nodeName))).toBeDefined();
      }

      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode(`node/${up}`);
        }),
      ).toEqual({
        result: "still-reporting",
        statements: ["DELETE", "SELECT"],
      });
      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode(`node/${agents}`);
        }),
      ).toEqual({ result: "not-native", statements: ["DELETE", "SELECT"] });
      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode(`node/${removedByFullName}`);
        }),
      ).toEqual({ result: "removed", statements: ["DELETE"] });
      // The name the node's page reads back from the stored id.
      expect(
        await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
          return removeNode(storedId(removedByStoredName));
        }),
      ).toEqual({ result: "removed", statements: ["DELETE"] });

      expect(externalIdsOf(await readRows())).toEqual([
        storedId(agents),
        storedId(up),
      ]);
      expect(await removeNode(`node/${removedByFullName}`)).toBe("not-found");
      expect(
        rosterStatesOf(await roster()).map(
          (entry: { nodeName: string }): string => {
            return entry.nodeName;
          },
        ),
      ).toEqual([
        storedId(agents).substring("node/".length),
        storedId(up).substring("node/".length),
      ]);
    });

    test.each<{ state: string; isUp: boolean | null }>([
      { state: "up", isUp: true },
      { state: "of unknown state (its batch lacked pve_up)", isUp: null },
    ])(
      "still-reporting: a native-push node that is $state is left in place",
      async (row: { state: string; isUp: boolean | null }) => {
        await upsert([node("pve1", { isUp: row.isUp })], {
          isNativePush: true,
        });
        const before: ResourceRow = await nodeRow("pve1");

        expect(
          await statementsDuring((): Promise<ProxmoxRemoveNodeResult> => {
            return removeNode("node/pve1");
          }),
        ).toEqual({
          result: "still-reporting",
          statements: ["DELETE", "SELECT"],
        });
        expect(await nodeRow("pve1")).toEqual(before);
      },
    );
  });

  describe("adoptNodesAsNativePush", () => {
    test("flags exactly this cluster's live Node rows not yet native - the agent's and pre-migration ones, Offline or not - and nothing else about them, not even the mark or updatedAt, whatever the database clock reads; the second call writes 0 rows", async () => {
      const stale: Date = at(-20 * MINUTE_MS);
      await upsert(
        [
          node("n-native", { lastSeenAt: at(-MINUTE_MS) }),
          node("n-marked", { lastSeenAt: stale }),
        ],
        { isNativePush: true },
      );
      // A native node reported down: marked, and never adopted again.
      expect(
        await mark(
          ["n-marked"],
          at(-2 * MINUTE_MS),
          CLUSTER_ID,
          at(-MINUTE_MS),
        ),
      ).toBe(1);
      await upsertFrom(false, [
        node("a-up", { lastSeenAt: stale }),
        node("a-down", { isUp: false, uptimeSeconds: null, lastSeenAt: stale }),
        node("a-deleted", { isUp: false, lastSeenAt: stale }),
        guest(100, "a-up", { lastSeenAt: stale }),
        storage("a-up", "local", { lastSeenAt: stale }),
      ]);
      await upsertFrom(null, [
        node("l-up", { lastSeenAt: stale }),
        node("l-down", { isUp: false, lastSeenAt: stale }),
        guest(101, "l-up", { lastSeenAt: stale }),
      ]);
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: CLUSTER_ID,
        metrics: [nodeMetric("a-down", { observedAt: stale })],
      });
      await softDelete("Node", "node/a-deleted");
      await upsertFrom(
        false,
        [node("a-up", { lastSeenAt: stale })],
        OTHER_CLUSTER_ID,
      );
      await upsert([node("a-up", { lastSeenAt: stale })], {
        isNativePush: false,
        projectId: OTHER_PROJECT_ID,
      });
      /*
       * No statement leaves a mark on a row not native (the mark flags it
       * native, a batch clears it); set directly here to show the adoption
       * never writes the column, whatever it holds.
       */
      await setMarkedAt("a-down", at(-30 * SECOND_MS));
      const before: Array<ResourceRow> = await readRows();
      const otherCluster: Array<ResourceRow> = await readRows(OTHER_CLUSTER_ID);
      const otherProject: Array<ResourceRow> = await readRows(
        CLUSTER_ID,
        OTHER_PROJECT_ID,
      );
      const adopted: Array<string> = [
        "node/a-down",
        "node/a-up",
        "node/l-down",
        "node/l-up",
      ];

      /*
       * Hours on from every write: an adoption that stamped the database's
       * now() would move updatedAt far enough to show.
       */
      await setDatabaseClock(at(3 * HOUR_MS));
      expect(await adopt()).toBe(adopted.length);

      /*
       * Only isNativePush moves, and only on those four: the mark stays as
       * it was - NULL on the agent's and pre-migration rows - and updatedAt
       * to the microsecond: adopting a row is no report.
       */
      const after: Array<ResourceRow> = await readRows();
      expect(after).toEqual(
        before.map((row: ResourceRow): ResourceRow => {
          return adopted.includes(row.externalId)
            ? { ...row, isNativePush: true }
            : row;
        }),
      );
      for (const row of after) {
        expect(row.updatedAtText).toBe(
          before.find((candidate: ResourceRow): boolean => {
            return candidate.externalId === row.externalId;
          })!.updatedAtText,
        );
      }
      // Offline stays Offline: the adoption only takes a row into the keep.
      expect(await nodeRow("a-down")).toMatchObject({
        isUp: false,
        uptimeSeconds: null,
        lastSeenAt: stale,
        metricsUpdatedAt: stale,
        notReportingMarkedAt: at(-30 * SECOND_MS),
      });
      for (const nodeName of ["a-up", "l-up", "l-down", "n-native"]) {
        expect(await markedAtOf(nodeName)).toBeNull();
      }
      expect(await markedAtMsOf("n-marked")).toBe(at(-MINUTE_MS).getTime());
      expect(await readRows(OTHER_CLUSTER_ID)).toEqual(otherCluster);
      expect(await readRows(CLUSTER_ID, OTHER_PROJECT_ID)).toEqual(
        otherProject,
      );

      // Nothing is left to adopt: the next call writes nothing.
      expect(await adopt()).toBe(0);
      expect(await readRows()).toEqual(after);
    });

    test("takes only rows last seen no later than seenUpTo - compared to the millisecond, the bound included - and a later batch takes the rest", async () => {
      const seenUpTo: Date = at(-5 * MINUTE_MS);
      await upsertFrom(false, [
        // The agent's rows from before the batch's observation: taken.
        node("older-down", {
          isUp: false,
          uptimeSeconds: null,
          lastSeenAt: at(-20 * MINUTE_MS),
        }),
        node("older-up", { lastSeenAt: at(-5 * MINUTE_MS - 1) }),
        // Seen at the batch's very observation: taken.
        node("same", { isUp: false, lastSeenAt: at(-5 * MINUTE_MS) }),
        // The agent's rows from after it: left alone, down or up.
        node("newer-down", {
          isUp: false,
          uptimeSeconds: null,
          lastSeenAt: at(-5 * MINUTE_MS + 1),
        }),
        node("newer-up", { lastSeenAt: NOW }),
      ]);
      await upsertFrom(null, [
        node("l-older", { lastSeenAt: at(-6 * MINUTE_MS) }),
        node("l-newer", { isUp: false, lastSeenAt: at(-4 * MINUTE_MS) }),
      ]);
      const before: Array<ResourceRow> = await readRows();
      const adopted: Array<string> = [
        "node/l-older",
        "node/older-down",
        "node/older-up",
        "node/same",
      ];

      expect(await adopt({ seenUpTo: seenUpTo })).toBe(adopted.length);

      // Only the flag moves - the mark and updatedAt stay, to the microsecond.
      const after: Array<ResourceRow> = await readRows();
      expect(after).toEqual(
        before.map((row: ResourceRow): ResourceRow => {
          return adopted.includes(row.externalId)
            ? { ...row, isNativePush: true }
            : row;
        }),
      );
      // The caller's bound is left as it was.
      expect(seenUpTo).toEqual(at(-5 * MINUTE_MS));

      // A batch observed later takes what the first one left, and no more.
      expect(await adopt({ seenUpTo: at(-4 * MINUTE_MS) })).toBe(2);
      expect(
        (await readRows())
          .filter((row: ResourceRow): boolean => {
            return row.isNativePush !== true;
          })
          .map((row: ResourceRow): string => {
            return row.externalId;
          }),
      ).toEqual(["node/newer-up"]);
      expect(await adopt({ seenUpTo: NOW })).toBe(1);
      expect(await adopt({ seenUpTo: NOW })).toBe(0);
    });

    /*
     * Why the bound: a cluster moved from the native push back to the
     * agent, and a native batch from before the move is flushed only after
     * it (a backlog). Without the bound its adoption took the agent's newer
     * rows into the native keep - a node the agent lists as down was then
     * kept for the retention window instead of leaving with the agent, and
     * offered for removal although it is the agent's.
     */
    test("a native batch flushed late, after the cluster moved back to the agent, takes none of the agent's rows - while the same batch takes an agent-era row older than itself", async () => {
      const nativeUntil: Date = at(-30 * MINUTE_MS);
      await upsert(
        [
          node("pve1", { lastSeenAt: nativeUntil }),
          node("pve2", { lastSeenAt: nativeUntil }),
          node("pve3", { lastSeenAt: nativeUntil }),
        ],
        { isNativePush: true },
      );
      // The agent since: its last scrape, at -10:00, lists pve3 down.
      await upsertFrom(false, [
        node("pve1", { lastSeenAt: at(-10 * MINUTE_MS) }),
        node("pve2", { lastSeenAt: at(-10 * MINUTE_MS) }),
        node("pve3", {
          isUp: false,
          uptimeSeconds: null,
          lastSeenAt: at(-10 * MINUTE_MS),
        }),
      ]);
      /*
       * In another cluster, still moving to the native push: the agent last
       * listed pve3 down at -40:00, before the batch.
       */
      await upsertFrom(
        false,
        [node("pve3", { isUp: false, lastSeenAt: at(-40 * MINUTE_MS) })],
        OTHER_CLUSTER_ID,
      );
      const agentRows: Array<ResourceRow> = await readRows();

      // pve1's last native batch, observed at -30:00, flushed now.
      await upsert([node("pve1", { lastSeenAt: nativeUntil })], {
        isNativePush: true,
      });
      expect(await adopt({ seenUpTo: nativeUntil })).toBe(0);
      expect(await readRows()).toEqual(agentRows);
      expect(
        await adopt({
          seenUpTo: nativeUntil,
          proxmoxClusterId: OTHER_CLUSTER_ID,
        }),
      ).toBe(1);
      expect((await nodeRow("pve3", OTHER_CLUSTER_ID)).isNativePush).toBe(true);

      // The agent's node: not removable here…
      expect(await removeNode("node/pve3")).toBe("not-native");
      // …and pruned once the agent stops listing it; the adopted one is kept.
      await upsertFrom(false, [node("pve1"), node("pve2")]);
      expect(await prune({ olderThan: at(-5 * MINUTE_MS) })).toBe(1);
      expect(externalIdsOf(await readRows())).toEqual([
        "node/pve1",
        "node/pve2",
      ]);
      expect(
        await prune({
          olderThan: at(-5 * MINUTE_MS),
          proxmoxClusterId: OTHER_CLUSTER_ID,
        }),
      ).toBe(0);
      expect(await nodeRow("pve3", OTHER_CLUSTER_ID)).toMatchObject({
        isUp: false,
        isNativePush: true,
        lastSeenAt: at(-40 * MINUTE_MS),
      });
    });

    test("an empty cluster, or one whose Node rows are all native already, adopts nothing", async () => {
      expect(await adopt({ proxmoxClusterId: ObjectID.generate() })).toBe(0);

      await upsert([node("pve1"), node("pve2", { isUp: false })], {
        isNativePush: true,
      });
      await upsertFrom(false, [guest(100, "pve1"), storage("pve1", "local")]);
      const before: Array<ResourceRow> = await readRows();

      expect(await adopt()).toBe(0);
      expect(await readRows()).toEqual(before);
    });

    /*
     * Why: a node already down under the agent never pushes itself, so
     * before anything reported it its agent-era row was pruned at the
     * cutoff like any agent row - and it dropped off the roster while
     * still down.
     */
    test("an adopted node that was down under the agent is kept by the prune as Offline and unmarked, stays on the roster, and can then be removed", async () => {
      const stale: Date = at(-20 * MINUTE_MS);
      await upsertFrom(false, [
        node("pve1", { lastSeenAt: stale }),
        node("pve3", { isUp: false, uptimeSeconds: null, lastSeenAt: stale }),
        guest(100, "pve1", { lastSeenAt: stale }),
        guest(300, "pve3", { isUp: false, lastSeenAt: stale }),
        storage("pve3", "local", { lastSeenAt: stale }),
      ]);
      // The same node in a cluster the native push never adopted.
      await upsertFrom(
        false,
        [node("pve3", { isUp: false, lastSeenAt: stale })],
        OTHER_CLUSTER_ID,
      );

      // Not removable while it is the agent's.
      expect(await removeNode("node/pve3")).toBe("not-native");

      expect(await adopt()).toBe(2);
      // The guests and storage go at the cutoff; the adopted Node rows stay.
      expect(await prune()).toBe(3);
      expect(externalIdsOf(await readRows())).toEqual([
        "node/pve1",
        "node/pve3",
      ]);
      expect(await nodeRow("pve3")).toMatchObject({
        isUp: false,
        isNativePush: true,
        notReportingMarkedAt: null,
        lastSeenAt: stale,
      });
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "pve1", isUp: true },
        { nodeName: "pve3", isUp: false },
      ]);

      // Not adopted: pruned at the same cutoff.
      expect(await prune({ proxmoxClusterId: OTHER_CLUSTER_ID })).toBe(1);
      expect(await readRows(OTHER_CLUSTER_ID)).toEqual([]);

      // Adopted and Offline, it can be removed; its sibling that is up cannot.
      expect(await removeNode("node/pve1")).toBe("still-reporting");
      expect(await removeNode("node/pve3")).toBe("removed");
      expect(rosterStatesOf(await roster())).toEqual([
        { nodeName: "pve1", isUp: true },
      ]);
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
    // THREE_NODES from TIMELINE_START_MS, the database clock on the simulated one.
    function newSimulator(): NativeClusterSimulator {
      return new NativeClusterSimulator(
        TIMELINE_START_MS,
        THREE_NODES,
        setDatabaseClock,
      );
    }

    test("pve3 dies, is marked and its mark refreshed once a minute while reported, survives a 20-minute OneUptime outage and the prune ticks around it, is reported again once a node is established after the outage, and its own push brings it back", async () => {
      const sim: NativeClusterSimulator = newSimulator();
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
        markRecord(sim.time(7, 30), "pve1", ["pve3"], 2, 1),
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
       * Every live push reports it again, and writes only once the mark is
       * more than a minute old: pushes every 30 s from each of two nodes, a
       * step apart, so 70 or 80 s after the last write. Its guests and
       * storage age out at the 25:00 tick (cutoff 10:00); the node does not.
       */
      await sim.runUntil(sim.time(29, 50));
      // pve1 7:30 ... 29:30 and pve2 7:40 ... 29:40: 45 pushes each.
      expect(sim.marks).toHaveLength(90);
      expect(
        sim.marks.every((record: MarkRecord): boolean => {
          return (
            record.nodeNames.length === 1 &&
            record.nodeNames[0] === "pve3" &&
            record.reporterCount === 2
          );
        }),
      ).toBe(true);
      expect(
        sim.marks.map((record: MarkRecord): number => {
          return record.written;
        }),
      ).toEqual(expectedWrittenCounts(sim.marks, new Map([["pve3", null]])));
      const writtenBeforeOutage: Array<number> = writtenTimesOf(sim.marks);
      expect(writtenBeforeOutage.slice(0, 4)).toEqual([
        sim.time(7, 30),
        sim.time(8, 40),
        sim.time(10),
        sim.time(11, 10),
      ]);
      expect(writtenBeforeOutage).toHaveLength(18);
      expect(writtenBeforeOutage[17]).toBe(sim.time(28, 40));
      writtenBeforeOutage
        .slice(1)
        .forEach((atMs: number, index: number): void => {
          expect([70 * SECOND_MS, 80 * SECOND_MS]).toContain(
            atMs - writtenBeforeOutage[index]!,
          );
        });
      expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(28, 40));
      expect(sim.ticks).toEqual([
        { atMs: sim.time(0), deleted: 0 },
        { atMs: sim.time(5), deleted: 0 },
        { atMs: sim.time(10), deleted: 0 },
        { atMs: sim.time(15), deleted: 0 },
        { atMs: sim.time(20), deleted: 0 },
        { atMs: sim.time(25), deleted: 3 },
      ]);
      // Every Node row has been native from its first push: nothing to adopt.
      expect(sim.adoptions).toEqual([
        { atMs: sim.time(0), adopted: 0 },
        { atMs: sim.time(10), adopted: 0 },
        { atMs: sim.time(20), adopted: 0 },
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

      /*
       * No node is established again before 52:00, and pve3's mark was last
       * written at 28:40 - more than the monitor window before 50:00: the
       * window holds nothing from before the outage and pve3's Node Offline
       * has resolved already, so there is nothing to carry on.
       * Offline in the inventory all along, pve3 is reported again from the
       * first established push, at 52:00 - which rewrites the aged mark -
       * then on every push (weighed over pve1 and pve2).
       */
      expect(sim.time(50) - sim.time(28, 40)).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      await sim.runUntil(sim.time(51, 50));
      expect(sim.marksSince(sim.time(50))).toEqual([]);
      // pve2, silent too at 50:00, was never reported.
      expect(await row("pve2")).toMatchObject({ isUp: true });
      await sim.runUntil(sim.time(52, 10));
      expect(sim.marksSince(sim.time(52))).toEqual([
        markRecord(sim.time(52), "pve1", ["pve3"], 2, 1),
        markRecord(sim.time(52, 10), "pve2", ["pve3"], 2, 0),
      ]);
      expect(sim.isEstablished("pve1")).toBe(true);
      expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(52));

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
        // Its own push ended the mark.
        notReportingMarkedAt: null,
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
      /*
       * Every write, before the outage and after it, the 60-second guard's:
       * after the outage 52:00, then a refresh every 70 or 80 s up to 59:30
       * - the reports of 60:00 and 60:10 found it written within the minute.
       */
      expect(
        sim.marks.map((record: MarkRecord): number => {
          return record.written;
        }),
      ).toEqual(expectedWrittenCounts(sim.marks, new Map([["pve3", null]])));
      expect(writtenTimesOf(sim.marksSince(sim.time(50)))).toEqual([
        sim.time(52),
        sim.time(53, 10),
        sim.time(54, 30),
        sim.time(55, 40),
        sim.time(57),
        sim.time(58, 10),
        sim.time(59, 30),
      ]);
      expect(sim.rowsWritten()).toBe(18 + 7);
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
      const sim: NativeClusterSimulator = newSimulator();
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

      /*
       * Silent since before the outage but Online in the inventory: its
       * first report waits until a node is established again, though every
       * push from 50:00 on finds it silent.
       */
      await sim.runUntil(sim.time(51, 50));
      expect(sim.marks).toEqual([]);
      await sim.runUntil(sim.time(52));
      expect(sim.marks).toEqual([
        markRecord(sim.time(52), "pve1", ["pve3"], 2, 1),
      ]);
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({ isUp: false, uptimeSeconds: null });
      expect((await summary(clusterId)).nodeOnlineCount).toBe(2);

      await sim.runUntil(sim.time(60));
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toBeDefined();
      // Marked at 52:00, its mark then refreshed once a minute.
      expect(
        sim.marks.map((record: MarkRecord): number => {
          return record.written;
        }),
      ).toEqual(expectedWrittenCounts(sim.marks, new Map([["pve3", null]])));
      expect(writtenTimesOf(sim.marks)).toEqual([
        sim.time(52),
        sim.time(53, 10),
        sim.time(54, 30),
        sim.time(55, 40),
        sim.time(57),
        sim.time(58, 10),
        sim.time(59, 30),
      ]);
    }, 120_000);

    test("after a whole-cluster power cut, a node that fails to boot is kept while the others come back, then reported", async () => {
      const sim: NativeClusterSimulator = newSimulator();
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
        markRecord(sim.time(42), "pve1", ["pve3"], 2, 1),
      ]);
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 3, Storage: 2 },
        nodeOnlineCount: 2,
      });
    }, 120_000);

    test("an outage shorter than the silence window marks no live node when OneUptime resumes", async () => {
      const sim: NativeClusterSimulator = newSimulator();
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
     * Once, the report found the row already Offline and wrote nothing, so
     * the 15:00 tick pruned the non-native row - pve3 left the roster and
     * stopped being reported while still down. Now the first native push
     * adopts every Node row of the cluster seen up to its own observation,
     * writing the flag alone. Offline as the agent left it, its row carries
     * no mark - the agent never writes one, and the adoption does not - so
     * however recently that scrape wrote it, nothing carries on while no
     * node is established: pve3 is first reported, and marked, by pve1's
     * established push at 2:00 (a node the agent last saw down may have come
     * back - see below), and the reports refresh the mark once a minute.
     */
    test.each<{ source: string; isNativePush: boolean | null }>([
      { source: "isNativePush false", isNativePush: false },
      {
        source: "isNativePush NULL, from before the migration",
        isNativePush: null,
      },
    ])(
      "a node already down when the cluster moved from the agent to the native push ($source) is adopted by the first native push, first reported once a node is established - the agent's Offline row carries no mark, however recently written - and kept through the prune while still down",
      async (row: { source: string; isNativePush: boolean | null }) => {
        const sim: NativeClusterSimulator = newSimulator();
        const clusterId: ObjectID = sim.proxmoxClusterId;
        const scrapedAt: Date = new Date(sim.time(-1));
        // The agent's scrape, written on the database clock then.
        await setDatabaseClock(scrapedAt);
        await upsertFrom(
          row.isNativePush,
          agentScrape(scrapedAt, false),
          clusterId,
        );
        sim.setAlive("pve3", false);

        // pve1's own push made its row native; the adoption takes the other two.
        await sim.runUntil(sim.time(0));
        expect(sim.adoptions).toEqual([{ atMs: sim.time(0), adopted: 2 }]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          uptimeSeconds: null,
          isNativePush: true,
          lastSeenAt: scrapedAt,
        });

        // Adopted, not reported: unmarked, as the agent's scrape wrote it.
        expect(await markedAtOf("pve3", clusterId)).toBeNull();
        expect((await updatedAtOf("pve3", clusterId)).getTime()).toBe(
          scrapedAt.getTime(),
        );

        /*
         * Silent from pve2's push at 1:10 - its last sighting (-1:00) is then
         * more than the silence window old - and written by the agent's
         * scrape only 2 min 10 s before, well within the monitor window. But
         * no report has marked it, and nobody is established before pve1's
         * push at 2:00: pve1 and pve2 report nothing until then, and pve1's
         * report at 2:00 marks it.
         */
        expect(sim.time(1, 10) - scrapedAt.getTime()).toBeGreaterThan(
          PROXMOX_NODE_SILENCE_MS,
        );
        expect(sim.time(1, 10) - scrapedAt.getTime()).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        await sim.runUntil(sim.time(1, 50));
        expect(sim.isEstablished("pve2")).toBe(false);
        expect(sim.marks).toEqual([]);
        await sim.runUntil(sim.time(2));
        expect(sim.isEstablished("pve1")).toBe(true);
        expect(sim.marks).toEqual([
          markRecord(sim.time(2), "pve1", ["pve3"], 2, 1),
        ]);
        expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(2));

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
              record.nodeNames.length === 1 &&
              record.nodeNames[0] === "pve3" &&
              record.reporterCount === 2
            );
          }),
        ).toBe(true);
        // pve1 2:00 ... 20:00 and pve2 2:10 ... 19:40.
        expect(sim.marks).toHaveLength(37 + 36);
        /*
         * Adopted and Offline already, but never marked: the first report
         * marks it, and the reports after it refresh the mark only once it
         * is more than a minute old.
         */
        expect(
          sim.marks.map((record: MarkRecord): number => {
            return record.written;
          }),
        ).toEqual(expectedWrittenCounts(sim.marks, new Map([["pve3", null]])));
        expect(writtenTimesOf(sim.marks).slice(0, 3)).toEqual([
          sim.time(2),
          sim.time(3, 10),
          sim.time(4, 30),
        ]);
        expect(sim.adoptions).toEqual([
          { atMs: sim.time(0), adopted: 2 },
          { atMs: sim.time(10), adopted: 0 },
          { atMs: sim.time(20), adopted: 0 },
        ]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          isNativePush: true,
          lastSeenAt: scrapedAt,
        });
        expect(
          rosterStatesOf(await roster(clusterId, new Date(sim.time(20)))),
        ).toEqual([
          { nodeName: "pve1", isUp: true },
          { nodeName: "pve2", isUp: true },
          { nodeName: "pve3", isUp: false },
        ]);
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
          notReportingMarkedAt: null,
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
     * The agent's last scrape, a minute before the move, listed pve3 down;
     * pve3 came back meanwhile, and its first native push is processed at
     * 1:20 - after pve2's at 1:10, the first push that finds it silent by
     * its row, while no node is established. Its row is Offline and was
     * written only 2 min 10 s before (an hour into the future, on a database
     * clock that runs an hour fast), but no report ever marked it: pve2 does
     * not report it, and pve3's own push turns it Online. Taken for a mark,
     * that write had pve2 report a node that was up - a false Node Offline.
     */
    test.each<{ label: string; skewMs: number }>([
      { label: "the clocks agreeing", skewMs: 0 },
      { label: "the database clock an hour ahead", skewMs: HOUR_MS },
    ])(
      "a node down in the agent's last scrape a minute before the move, back before its first native push, is never reported - $label",
      async (row: { label: string; skewMs: number }) => {
        const sim: NativeClusterSimulator = new NativeClusterSimulator(
          TIMELINE_START_MS,
          THREE_NODES,
          setDatabaseClock,
          row.skewMs,
        );
        const clusterId: ObjectID = sim.proxmoxClusterId;
        const scrapedAt: Date = new Date(sim.time(-1));
        // The agent's scrape, written on the database clock then.
        await setDatabaseClock(new Date(scrapedAt.getTime() + row.skewMs));
        await upsertFrom(false, agentScrape(scrapedAt, false), clusterId);
        sim.setAlive("pve3", false);

        await sim.runUntil(sim.time(1));
        // pve3 boots at 1:00; its first push is at 1:20.
        sim.setAlive("pve3", true);
        await sim.runUntil(sim.time(1, 10));
        expect(sim.adoptions).toEqual([{ atMs: sim.time(0), adopted: 2 }]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          isNativePush: true,
          notReportingMarkedAt: null,
          lastSeenAt: scrapedAt,
        });
        expect((await updatedAtOf("pve3", clusterId)).getTime()).toBe(
          scrapedAt.getTime() + row.skewMs,
        );
        // Silent by its row on pve2's push at 1:10, nobody established.
        expect(sim.time(1, 10) - scrapedAt.getTime()).toBeGreaterThan(
          PROXMOX_NODE_SILENCE_MS,
        );
        expect(sim.time(1, 10) - scrapedAt.getTime()).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        expect(sim.isEstablished("pve1")).toBe(false);
        expect(sim.isEstablished("pve2")).toBe(false);
        expect(sim.marks).toEqual([]);

        await sim.runUntil(sim.time(1, 20));
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: true,
          uptimeSeconds: 20,
          isNativePush: true,
          notReportingMarkedAt: null,
          lastSeenAt: new Date(sim.time(1, 20)),
        });

        await sim.runUntil(sim.time(10));
        expect(sim.marks).toEqual([]);
        expect((await summary(clusterId)).nodeOnlineCount).toBe(3);
      },
      120_000,
    );

    /*
     * The roster's isUp and mark decide who is reported while no node
     * is established: a node already Offline, from the first push after an
     * outage its mark outlives; a node that died during it (Online in the
     * inventory) only once a node has pushed for the silence window again -
     * a first report is never made on a warm-up.
     */
    test("after an outage shorter than the monitor window, the node already Offline is reported from the first push, while one that died during it waits for an established node", async () => {
      const sim: NativeClusterSimulator = newSimulator();
      const clusterId: ObjectID = sim.proxmoxClusterId;
      const row: (nodeName: string) => Promise<ResourceRow | undefined> = (
        nodeName: string,
      ): Promise<ResourceRow | undefined> => {
        return rowOf(`node/${nodeName}`, { proxmoxClusterId: clusterId });
      };

      // pve3's last push is at 5:20; pve1 reports it at 7:30.
      await sim.runUntil(sim.time(5, 20));
      sim.setAlive("pve3", false);
      await sim.runUntil(sim.time(29, 50));
      expect(sim.marks[0]).toEqual(
        markRecord(sim.time(7, 30), "pve1", ["pve3"], 2, 1),
      );

      // OneUptime is out from 30:00 to 32:00; pve2 dies at 31:00.
      sim.outage = true;
      await sim.runUntil(sim.time(30, 50));
      sim.setAlive("pve2", false);
      await sim.runUntil(sim.time(31, 50));
      sim.outage = false;

      /*
       * pve1 alone, its streak restarted, and not established before 34:00.
       * pve3's mark was last refreshed at 28:40, 3 min 20 s before pve1's
       * first push back - within the monitor window: pve3, Offline already,
       * is reported from that first push, which refreshes the mark, and
       * again at 33:30. pve2, silent since 29:40 but Online in the
       * inventory, is not reported yet - so it is presumed live, and each
       * report weighs pve3 over pve1 and pve2.
       */
      await sim.runUntil(sim.time(33, 50));
      expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(33, 30));
      expect(sim.marksSince(sim.time(30))).toEqual([
        markRecord(sim.time(32), "pve1", ["pve3"], 2, 1),
        markRecord(sim.time(32, 30), "pve1", ["pve3"], 2, 0),
        markRecord(sim.time(33), "pve1", ["pve3"], 2, 0),
        markRecord(sim.time(33, 30), "pve1", ["pve3"], 2, 1),
      ]);
      const writtenBeforeOutage: Array<number> = writtenTimesOf(
        sim.marks,
      ).filter((atMs: number): boolean => {
        return atMs < sim.time(30);
      });
      expect(writtenBeforeOutage[writtenBeforeOutage.length - 1]).toBe(
        sim.time(28, 40),
      );
      expect(sim.time(32) - sim.time(28, 40)).toBeLessThanOrEqual(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      expect(await row("pve2")).toMatchObject({
        isUp: true,
        lastSeenAt: new Date(sim.time(29, 40)),
      });
      expect((await summary(clusterId)).nodeOnlineCount).toBe(2);

      // Established at 34:00: pve2's first report, with pve3, pve1 alone.
      await sim.runUntil(sim.time(34));
      expect(sim.isEstablished("pve1")).toBe(true);
      expect(sim.marksSince(sim.time(34))).toEqual([
        markRecord(sim.time(34), "pve1", ["pve2", "pve3"], 1, 1),
      ]);
      expect(await row("pve2")).toMatchObject({
        isUp: false,
        uptimeSeconds: null,
        isNativePush: true,
        lastSeenAt: new Date(sim.time(29, 40)),
      });
      expect((await summary(clusterId)).nodeOnlineCount).toBe(1);

      /*
       * pve1 34:30 ... 45:00, every push, each row's mark refreshed on its
       * own once more than a minute old: pve2's from 34:00, pve3's from
       * 33:30.
       */
      await sim.runUntil(sim.time(45));
      const since: Array<MarkRecord> = sim.marksSince(sim.time(34, 30));
      expect(since).toHaveLength(22);
      since.forEach((record: MarkRecord, index: number): void => {
        expect(record).toMatchObject({
          atMs: sim.time(34, 30 + 30 * index),
          reporter: "pve1",
          nodeNames: ["pve2", "pve3"],
          reporterCount: 1,
        });
      });
      expect(
        sim.marksSince(sim.time(30)).map((record: MarkRecord): number => {
          return record.written;
        }),
      ).toEqual(
        expectedWrittenCounts(
          sim.marksSince(sim.time(30)),
          new Map([
            ["pve3", sim.time(28, 40)],
            ["pve2", null],
          ]),
        ),
      );
      expect(
        since.slice(0, 6).map((record: MarkRecord): number => {
          return record.written;
        }),
      ).toEqual([0, 1, 1, 0, 1, 1]);
      // 45:00 (cutoff 30:00): pve2's guest and storage; its Node row stays.
      expect(
        sim.ticks.filter((tick: TickRecord): boolean => {
          return tick.atMs >= sim.time(30);
        }),
      ).toEqual([
        { atMs: sim.time(30), deleted: 0 },
        { atMs: sim.time(35), deleted: 0 },
        { atMs: sim.time(40), deleted: 0 },
        { atMs: sim.time(45), deleted: 2 },
      ]);
      expect(
        rosterStatesOf(await roster(clusterId, new Date(sim.time(45)))),
      ).toEqual([
        { nodeName: "pve1", isUp: true },
        { nodeName: "pve2", isUp: false },
        { nodeName: "pve3", isUp: false },
      ]);
    }, 120_000);

    /*
     * pve2 and pve3 are down and reported; pve1, the lone survivor, loses
     * two pushes (10:30 and 11:00 - a network blip, or a OneUptime stall,
     * which for the only node pushing is the same). Its next push, at 11:30,
     * restarts its streak, so it is not established again before 13:30 -
     * but both siblings are Offline already, and their marks, refreshed at
     * 9:00, within the monitor window: it goes on reporting them, alone,
     * from that first push, which refreshes both marks.
     */
    test("a lone survivor whose own pushes stop for 90 s goes on reporting its Offline siblings from its first push after the gap", async () => {
      const sim: NativeClusterSimulator = newSimulator();
      const clusterId: ObjectID = sim.proxmoxClusterId;

      // pve2's last push is at 5:10, pve3's at 5:20; pve1 reports both at 7:30.
      await sim.runUntil(sim.time(5, 20));
      sim.setAlive("pve2", false);
      sim.setAlive("pve3", false);
      await sim.runUntil(sim.time(10));
      // pve1 alone, every 30 s: both marks rewritten every 90 s.
      expect(sim.marks).toEqual([
        markRecord(sim.time(7, 30), "pve1", ["pve2", "pve3"], 1, 2),
        markRecord(sim.time(8), "pve1", ["pve2", "pve3"], 1, 0),
        markRecord(sim.time(8, 30), "pve1", ["pve2", "pve3"], 1, 0),
        markRecord(sim.time(9), "pve1", ["pve2", "pve3"], 1, 2),
        markRecord(sim.time(9, 30), "pve1", ["pve2", "pve3"], 1, 0),
        markRecord(sim.time(10), "pve1", ["pve2", "pve3"], 1, 0),
      ]);

      sim.outage = true;
      await sim.runUntil(sim.time(11, 20));
      sim.outage = false;
      await sim.runUntil(sim.time(13, 30));

      expect(sim.marksSince(sim.time(10, 30))).toEqual([
        // Warming up again: 11:30 ... 13:00.
        markRecord(sim.time(11, 30), "pve1", ["pve2", "pve3"], 1, 2),
        markRecord(sim.time(12), "pve1", ["pve2", "pve3"], 1, 0),
        markRecord(sim.time(12, 30), "pve1", ["pve2", "pve3"], 1, 0),
        markRecord(sim.time(13), "pve1", ["pve2", "pve3"], 1, 2),
        // Established again.
        markRecord(sim.time(13, 30), "pve1", ["pve2", "pve3"], 1, 0),
      ]);
      expect(sim.isEstablished("pve1")).toBe(true);
      expect(sim.rowsWritten()).toBe(8);
      expect(await summary(clusterId)).toMatchObject({
        countsByKind: { Node: 3, Guest: 5, Storage: 3 },
        nodeOnlineCount: 1,
      });
    }, 120_000);

    /*
     * The agent stopped 20 minutes before the native push started, so every
     * row it wrote is past the prune's cutoff by the first native push. That
     * push adopts the cluster's Node rows (every one seen before its own
     * observation) before the tick right after it; pve3, which never pushes,
     * is kept, reported, and can be removed. Up or down in the agent's last
     * scrape, it is first reported once a node is established, at 2:00,
     * which marks it: down, its row is Offline but carries no mark - the
     * agent never writes one and the adoption writes the flag alone - so
     * nothing carries on while no node is established, and pve2's push at
     * 0:10, the first decided after the adoption, reports nothing.
     */
    test.each<{
      state: string;
      pve3IsUp: boolean;
      source: string;
      isNativePush: boolean | null;
      firstReport: MarkRecord;
      reports: number;
    }>([
      {
        state: "down in the agent's last scrape",
        pve3IsUp: false,
        source: "isNativePush false",
        isNativePush: false,
        // pve1, established at 2:00, marking the agent's unmarked row.
        firstReport: markRecord(
          TIMELINE_START_MS + 2 * MINUTE_MS,
          "pve1",
          ["pve3"],
          2,
          1,
        ),
        // pve1 2:00 ... 20:00 and pve2 2:10 ... 19:40.
        reports: 37 + 36,
      },
      {
        state: "down in the agent's last scrape",
        pve3IsUp: false,
        source: "isNativePush NULL",
        isNativePush: null,
        firstReport: markRecord(
          TIMELINE_START_MS + 2 * MINUTE_MS,
          "pve1",
          ["pve3"],
          2,
          1,
        ),
        reports: 37 + 36,
      },
      {
        state: "up in the agent's last scrape and dead since",
        pve3IsUp: true,
        source: "isNativePush false",
        isNativePush: false,
        // pve1, established at 2:00.
        firstReport: markRecord(
          TIMELINE_START_MS + 2 * MINUTE_MS,
          "pve1",
          ["pve3"],
          2,
          1,
        ),
        // pve1 2:00 ... 20:00 and pve2 2:10 ... 19:40.
        reports: 37 + 36,
      },
      {
        state: "up in the agent's last scrape and dead since",
        pve3IsUp: true,
        source: "isNativePush NULL",
        isNativePush: null,
        firstReport: markRecord(
          TIMELINE_START_MS + 2 * MINUTE_MS,
          "pve1",
          ["pve3"],
          2,
          1,
        ),
        reports: 37 + 36,
      },
    ])(
      "after a 20-minute gap between the agent and the native push, a node $state ($source) is adopted by the first native push, kept through the tick right after it, reported, and removable",
      async (row: {
        state: string;
        pve3IsUp: boolean;
        source: string;
        isNativePush: boolean | null;
        firstReport: MarkRecord;
        reports: number;
      }) => {
        const sim: NativeClusterSimulator = newSimulator();
        const clusterId: ObjectID = sim.proxmoxClusterId;
        const scrapedAt: Date = new Date(sim.time(-20));
        // The agent's scrape, written on the database clock then.
        await setDatabaseClock(scrapedAt);
        await upsertFrom(
          row.isNativePush,
          agentScrape(scrapedAt, row.pve3IsUp),
          clusterId,
        );
        sim.setAlive("pve3", false);

        await sim.runUntil(row.firstReport.atMs - STEP_MS);
        expect(sim.marks).toEqual([]);
        await sim.runUntil(row.firstReport.atMs);
        expect(sim.marks).toEqual([row.firstReport]);

        /*
         * The 0:00 tick (cutoff -15:00) took pve2's and pve3's guests and
         * storage - pve2's come back with its push at 0:10 - and no Node row.
         */
        expect(sim.adoptions).toEqual([{ atMs: sim.time(0), adopted: 2 }]);
        expect(sim.ticks).toEqual([{ atMs: sim.time(0), deleted: 5 }]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          uptimeSeconds: null,
          isNativePush: true,
          notReportingMarkedAt: new Date(row.firstReport.atMs),
          lastSeenAt: scrapedAt,
        });
        // Every report waited for pve1 to be established.
        expect(sim.isEstablished("pve1")).toBe(true);
        expect(row.firstReport.atMs).toBe(sim.time(2));

        await sim.runUntil(sim.time(20));
        expect(
          sim.ticks.map((tick: TickRecord): number | null => {
            return tick.deleted;
          }),
        ).toEqual([5, 0, 0, 0, 0]);
        expect(sim.adoptions).toEqual([
          { atMs: sim.time(0), adopted: 2 },
          { atMs: sim.time(10), adopted: 0 },
          { atMs: sim.time(20), adopted: 0 },
        ]);
        expect(sim.marks).toHaveLength(row.reports);
        expect(
          sim.marks.every((record: MarkRecord): boolean => {
            return (
              record.nodeNames.length === 1 && record.nodeNames[0] === "pve3"
            );
          }),
        ).toBe(true);
        /*
         * The first report - no mark before it, Online or Offline, since
         * only a report writes one - then a refresh a minute: the 60-second
         * guard's.
         */
        expect(
          sim.marks.map((record: MarkRecord): number => {
            return record.written;
          }),
        ).toEqual(expectedWrittenCounts(sim.marks, new Map([["pve3", null]])));
        expect(
          rosterStatesOf(await roster(clusterId, new Date(sim.time(20)))),
        ).toEqual([
          { nodeName: "pve1", isUp: true },
          { nodeName: "pve2", isUp: true },
          { nodeName: "pve3", isUp: false },
        ]);
        expect(await summary(clusterId)).toEqual({
          countsByKind: { Node: 3, Guest: 3, Storage: 2 },
          nodeOnlineCount: 2,
          guestRunningCount: 3,
        });

        // Taken out of the cluster for good: removed, and no longer reported.
        expect(
          await removeNode("node/pve3", { proxmoxClusterId: clusterId }),
        ).toBe("removed");
        await sim.runUntil(sim.time(25));
        expect(sim.marksSince(sim.time(20, 10))).toEqual([]);
        expect(
          rosterStatesOf(await roster(clusterId, new Date(sim.time(25)))),
        ).toEqual([
          { nodeName: "pve1", isUp: true },
          { nodeName: "pve2", isUp: true },
        ]);
        expect(await summary(clusterId)).toEqual({
          countsByKind: { Node: 2, Guest: 3, Storage: 2 },
          nodeOnlineCount: 2,
          guestRunningCount: 3,
        });
      },
      120_000,
    );

    /*
     * The same gap, but pve3 - down in the agent's last scrape - booted
     * during it and pushes again from 0:20, after pve1's push (whose flush
     * adopts its row) and pve2's. The adopted row is Offline, but carries
     * no mark - the agent's batch wrote none and the adoption writes none -
     * so pve2, not established, does not report pve3 at 0:10, and pve3's own
     * push turns it Online. Had the adoption stamped a mark, or had the
     * agent's updatedAt - an hour into the future on a database clock that
     * runs an hour fast - stood for one, pve2 would have reported a node
     * that was up: a false Node Offline.
     */
    test.each<{ source: string; isNativePush: boolean | null; skewMs: number }>(
      [
        { source: "isNativePush false", isNativePush: false, skewMs: 0 },
        { source: "isNativePush NULL", isNativePush: null, skewMs: 0 },
        {
          source: "isNativePush false, the database clock an hour ahead",
          isNativePush: false,
          skewMs: HOUR_MS,
        },
      ],
    )(
      "after a 20-minute gap, a node down in the agent's last scrape ($source) that came back during the gap is never reported - though its siblings' pushes, and the adoption, are processed ahead of its own first push",
      async (row: {
        source: string;
        isNativePush: boolean | null;
        skewMs: number;
      }) => {
        const sim: NativeClusterSimulator = new NativeClusterSimulator(
          TIMELINE_START_MS,
          THREE_NODES,
          setDatabaseClock,
          row.skewMs,
        );
        const clusterId: ObjectID = sim.proxmoxClusterId;
        const scrapedAt: Date = new Date(sim.time(-20));
        // The agent's scrape, written on the database clock then.
        await setDatabaseClock(new Date(scrapedAt.getTime() + row.skewMs));
        await upsertFrom(
          row.isNativePush,
          agentScrape(scrapedAt, false),
          clusterId,
        );
        // pve3 boots at 0:00; its first push is at 0:20.
        sim.setAlive("pve3", false);
        sim.setAlive("pve3", true);

        await sim.runUntil(sim.time(0, 10));
        expect(sim.adoptions).toEqual([{ atMs: sim.time(0), adopted: 2 }]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: false,
          isNativePush: true,
          notReportingMarkedAt: null,
          lastSeenAt: scrapedAt,
        });
        // The agent's stamp, left by the adoption - and read by nothing.
        expect((await updatedAtOf("pve3", clusterId)).getTime()).toBe(
          scrapedAt.getTime() + row.skewMs,
        );
        expect(sim.isEstablished("pve2")).toBe(false);
        expect(sim.marks).toEqual([]);

        await sim.runUntil(sim.time(0, 20));
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: true,
          uptimeSeconds: 20,
          isNativePush: true,
          lastSeenAt: new Date(sim.time(0, 20)),
        });

        await sim.runUntil(sim.time(10));
        expect(sim.marks).toEqual([]);
        expect(
          rosterStatesOf(await roster(clusterId, new Date(sim.time(10)))),
        ).toEqual([
          { nodeName: "pve1", isUp: true },
          { nodeName: "pve2", isUp: true },
          { nodeName: "pve3", isUp: true },
        ]);
        expect((await summary(clusterId)).nodeOnlineCount).toBe(3);
      },
      120_000,
    );

    /*
     * The ingest hands the mark OneUptime's clock, the one the decision
     * judges it on, so a database clock an hour off changes nothing: pve3's
     * mark is refreshed as ever, carried on from the first push after a
     * two-minute outage, and aged out by a 20-minute one - pve3, back during
     * it, never reported after it. On the database's now(), an hour ahead
     * kept the mark in force after that outage (pve3 was reported while up),
     * and an hour behind aged it out at once (the reports after the short
     * outage stopped).
     */
    test.each<{ label: string; skewMs: number }>([
      { label: "an hour ahead of", skewMs: HOUR_MS },
      { label: "an hour behind", skewMs: -HOUR_MS },
    ])(
      "with the database clock $label OneUptime's, a dead node's mark is stamped and aged on OneUptime's clock: carried on through a two-minute outage, aged out by a 20-minute one - the node, back during it, never reported after it",
      async (row: { label: string; skewMs: number }) => {
        const sim: NativeClusterSimulator = new NativeClusterSimulator(
          TIMELINE_START_MS,
          THREE_NODES,
          setDatabaseClock,
          row.skewMs,
        );
        const clusterId: ObjectID = sim.proxmoxClusterId;

        // pve3's last push is at 5:20; pve1 reports it at 7:30.
        await sim.runUntil(sim.time(5, 20));
        sim.setAlive("pve3", false);
        await sim.runUntil(sim.time(12));
        expect(sim.marks[0]).toEqual(
          markRecord(sim.time(7, 30), "pve1", ["pve3"], 2, 1),
        );
        expect(writtenTimesOf(sim.marks)).toEqual([
          sim.time(7, 30),
          sim.time(8, 40),
          sim.time(10),
          sim.time(11, 10),
        ]);
        /*
         * The mark on OneUptime's clock; updatedAt - the mark's and pve1's
         * own push's - on the database's.
         */
        expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(11, 10));
        expect((await updatedAtOf("pve3", clusterId)).getTime()).toBe(
          sim.time(11, 10) + row.skewMs,
        );
        expect(await markedAtOf("pve1", clusterId)).toBeNull();
        expect((await updatedAtOf("pve1", clusterId)).getTime()).toBe(
          sim.time(12) + row.skewMs,
        );

        /*
         * Out from 12:10 to 13:50. Back at 14:00, pve3's mark is 2 min 50 s
         * old: carried on from pve1's first push, which refreshes it, until
         * pve1 is established at 16:00.
         */
        sim.outage = true;
        await sim.runUntil(sim.time(13, 50));
        sim.outage = false;
        await sim.runUntil(sim.time(16));
        expect(sim.marksSince(sim.time(12, 10))).toEqual([
          markRecord(sim.time(14), "pve1", ["pve3"], 2, 1),
          markRecord(sim.time(14, 10), "pve2", ["pve3"], 2, 0),
          markRecord(sim.time(14, 30), "pve1", ["pve3"], 2, 0),
          markRecord(sim.time(14, 40), "pve2", ["pve3"], 2, 0),
          markRecord(sim.time(15), "pve1", ["pve3"], 2, 0),
          markRecord(sim.time(15, 10), "pve2", ["pve3"], 2, 1),
          markRecord(sim.time(15, 30), "pve1", ["pve3"], 2, 0),
          markRecord(sim.time(15, 40), "pve2", ["pve3"], 2, 0),
          markRecord(sim.time(16), "pve1", ["pve3"], 2, 0),
        ]);
        expect(sim.isEstablished("pve1")).toBe(true);
        expect(await markedAtMsOf("pve3", clusterId)).toBe(sim.time(15, 10));

        /*
         * Out from 16:10 to 36:50; pve3 boots at 20:00. Back at 37:00, its
         * mark is 21 min 50 s old: pve1, not established, and pve2 after it
         * report nothing, and pve3's own push at 37:20 turns it Online.
         */
        sim.outage = true;
        await sim.runUntil(sim.time(20));
        sim.setAlive("pve3", true);
        await sim.runUntil(sim.time(36, 50));
        sim.outage = false;
        await sim.runUntil(sim.time(37, 10));
        expect(sim.time(37) - sim.time(15, 10)).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        expect(sim.marksSince(sim.time(16, 10))).toEqual([]);
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({ isUp: false });
        await sim.runUntil(sim.time(37, 20));
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({
          isUp: true,
          uptimeSeconds: 17 * 60 + 20,
          notReportingMarkedAt: null,
          lastSeenAt: new Date(sim.time(37, 20)),
        });
        await sim.runUntil(sim.time(40));
        expect(sim.marksSince(sim.time(16, 10))).toEqual([]);
        expect((await summary(clusterId)).nodeOnlineCount).toBe(3);
      },
      120_000,
    );

    /*
     * What the adoption is for: the same gap without it. No node is
     * established before 2:00, and a row the agent wrote carries no mark,
     * so nothing is reported before then - not even a node the agent last
     * saw down - and the tick right after the first push
     * prunes pve3's agent-era row, which vanishes while still down, whichever
     * way the agent last saw it.
     */
    test.each<{
      state: string;
      pve3IsUp: boolean;
      deleted: number;
      marks: Array<MarkRecord>;
      reportsBy5: number;
      nodes: Array<string>;
    }>([
      {
        state: "up in the agent's last scrape is pruned and never reported",
        pve3IsUp: true,
        // Both agent Node rows too; pve2's comes back at 0:10.
        deleted: 7,
        marks: [],
        reportsBy5: 0,
        nodes: ["pve1", "pve2"],
      },
      {
        state: "down in the agent's last scrape is pruned and never reported",
        pve3IsUp: false,
        deleted: 7,
        marks: [],
        reportsBy5: 0,
        nodes: ["pve1", "pve2"],
      },
    ])(
      "without the adoption, after the same gap a node $state",
      async (row: {
        state: string;
        pve3IsUp: boolean;
        deleted: number;
        marks: Array<MarkRecord>;
        reportsBy5: number;
        nodes: Array<string>;
      }) => {
        const sim: NativeClusterSimulator = newSimulator();
        sim.adoptNodes = false;
        const clusterId: ObjectID = sim.proxmoxClusterId;
        // The agent's scrape, written on the database clock then.
        await setDatabaseClock(new Date(sim.time(-20)));
        await upsertFrom(
          false,
          agentScrape(new Date(sim.time(-20)), row.pve3IsUp),
          clusterId,
        );
        sim.setAlive("pve3", false);

        await sim.runUntil(sim.time(0));
        expect(sim.ticks).toEqual([
          { atMs: sim.time(0), deleted: row.deleted },
        ]);
        expect(sim.marks).toEqual(row.marks);

        await sim.runUntil(sim.time(5));
        expect(sim.adoptions).toEqual([]);
        expect(sim.marks).toHaveLength(row.reportsBy5);
        expect(
          rosterStatesOf(await roster(clusterId, new Date(sim.time(5)))).map(
            (entry: { nodeName: string }): string => {
              return entry.nodeName;
            },
          ),
        ).toEqual(row.nodes);
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
      const sim: NativeClusterSimulator = newSimulator();
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

  /*
   * The remove-node route run for real - the update permission check, both
   * cluster lookups and the removal - against clones of "ProxmoxCluster",
   * "Label" and "ProxmoxClusterLabel" next to the inventory's. Only the
   * caller's props are stubbed (CommonAPI.getDatabaseCommonInteractionProps;
   * UserMiddleware, which reads them from a session, is not run).
   *
   * The security fix it pins: with a label-scoped edit grant the cluster
   * lookup is narrowed to the caller's permitted labels, and a cluster
   * loaded through it comes back with those labels only - so a team block
   * on another label of the cluster went unseen. The block check loads the
   * cluster again as root, with every label.
   */
  describe("the remove-node route against real cluster and label rows", () => {
    const CLUSTER_NOT_FOUND_MESSAGE: string =
      "Proxmox Cluster not found, or you do not have permission to edit it. Removing a node needs permission to edit its cluster.";
    const NODE_NOT_FOUND_MESSAGE: string =
      "This node is not in the cluster's inventory. It may already have been removed.";
    const NOT_NATIVE_MESSAGE: string =
      "Only a node that reports over Proxmox VE's built-in metric push can be removed here. With the Proxmox Agent, a node leaves OneUptime on its own once the cluster no longer lists it.";
    const STILL_REPORTING_MESSAGE: string =
      "Only a node that has stopped reporting can be removed. A node that is still reporting would come back on its next report.";
    const CLUSTER_TABLES: Array<string> = [
      "ProxmoxCluster",
      "Label",
      "ProxmoxClusterLabel",
    ];

    let handler: RouteHandler;
    let props: DatabaseCommonInteractionProps;
    // Labels in PROJECT_ID; which of them a cluster carries is per test.
    let permitted: ObjectID;
    let blocked: ObjectID;
    let other: ObjectID;

    async function insertLabel(name: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Label" ("_id", "projectId", "name", "slug", "color", "version")
         VALUES ($1, $2, $3, $3, '#000000', 0)`,
        [id.toString(), PROJECT_ID.toString(), name],
      );
      return id;
    }

    async function insertCluster(
      labelIds: Array<ObjectID>,
      projectId: ObjectID = PROJECT_ID,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."ProxmoxCluster" ("_id", "projectId", "name", "slug", "version")
         VALUES ($1, $2, $3, $3, 0)`,
        [id.toString(), projectId.toString(), `cluster-${id.toString()}`],
      );
      for (const labelId of labelIds) {
        await database.query(
          `INSERT INTO "${schema}"."ProxmoxClusterLabel" ("proxmoxClusterId", "labelId")
           VALUES ($1, $2)`,
          [id.toString(), labelId.toString()],
        );
      }
      return id;
    }

    // pve1 up and pve3 Offline, both native.
    async function seedNodes(proxmoxClusterId: ObjectID): Promise<void> {
      await upsert(
        [node("pve1"), node("pve3", { lastSeenAt: at(-10 * MINUTE_MS) })],
        { isNativePush: true, proxmoxClusterId: proxmoxClusterId },
      );
      expect(await mark(["pve3"], at(-5 * MINUTE_MS), proxmoxClusterId)).toBe(
        1,
      );
    }

    function propsWith(
      grants: Array<PermissionGrant>,
    ): DatabaseCommonInteractionProps {
      const permissionMap: Dictionary<UserTenantAccessPermission> = {};
      permissionMap[PROJECT_ID.toString()] = {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: grants.map((grant: PermissionGrant): UserPermission => {
          return {
            _type: "UserPermission",
            permission: grant.permission,
            labelIds: grant.labelIds || [],
            isBlockPermission: Boolean(grant.isBlockPermission),
          };
        }),
      };
      return {
        tenantId: PROJECT_ID,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: permissionMap,
      };
    }

    // May edit (and read) clusters with the permitted label, but not blocked.
    function labelScopedProps(): DatabaseCommonInteractionProps {
      return propsWith([
        { permission: Permission.EditProxmoxCluster, labelIds: [permitted] },
        { permission: Permission.ReadProxmoxCluster, labelIds: [permitted] },
        {
          permission: Permission.EditProxmoxCluster,
          isBlockPermission: true,
          labelIds: [blocked],
        },
      ]);
    }

    async function callRemoveNode(
      proxmoxClusterId: ObjectID,
      nodeName: string,
    ): Promise<RouteOutcome> {
      const outcome: RouteOutcome = { status: null, body: null, error: null };
      const res: {
        status: (code: number) => unknown;
        send: (body: unknown) => unknown;
      } = {
        status: (code: number): unknown => {
          outcome.status = code;
          return res;
        },
        send: (body: unknown): unknown => {
          outcome.body = body;
          return res;
        },
      };
      const req: ExpressRequest = {
        params: { clusterId: proxmoxClusterId.toString() },
        body: { nodeName: nodeName },
        query: {},
        headers: {},
        cookies: {},
      } as unknown as ExpressRequest;
      const next: NextFunction = ((err?: unknown): void => {
        outcome.error = err === undefined ? null : err;
      }) as NextFunction;

      await handler(req, res as unknown as ExpressResponse, next);
      return outcome;
    }

    // What the route handed to next(), and whether it answered at all.
    function refusal(outcome: RouteOutcome): {
      type: string;
      message: string;
      status: number | null;
    } {
      const error: unknown = outcome.error;
      let type: string = String(error);
      if (error instanceof NotFoundException) {
        type = "NotFoundException";
      } else if (error instanceof BadDataException) {
        type = "BadDataException";
      }
      return {
        type: type,
        message: error instanceof Error ? error.message : "",
        status: outcome.status,
      };
    }

    function labelIdsOf(cluster: ProxmoxCluster | null): Array<string> {
      return (cluster?.labels || [])
        .map((label: Label): string => {
          return String(label.id);
        })
        .sort();
    }

    beforeAll(async () => {
      for (const table of CLUSTER_TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const api: ProxmoxResourceAPI = new ProxmoxResourceAPI();
      const layers: Array<RouterLayer> = (
        api.getRouter() as unknown as { stack: Array<RouterLayer> }
      ).stack;
      const layer: RouterLayer | undefined = layers.find(
        (candidate: RouterLayer): boolean => {
          return (
            candidate.route?.path === REMOVE_NODE_ROUTE &&
            Boolean(candidate.route?.methods["post"])
          );
        },
      );
      const stack: Array<{ handle: RouteHandler }> = layer?.route?.stack || [];
      // UserMiddleware, then the route itself.
      expect(stack).toHaveLength(2);
      handler = stack[1]!.handle;
    });

    beforeEach(async () => {
      for (const table of CLUSTER_TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
      permitted = await insertLabel("permitted");
      blocked = await insertLabel("blocked");
      other = await insertLabel("other");
      props = propsWith([]);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockImplementation(
          async (): Promise<DatabaseCommonInteractionProps> => {
            return props;
          },
        );
    });

    test("a label-scoped lookup loads only the permitted labels, so the block check is given every label - and a block on another label of the cluster refuses the removal", async () => {
      const clusterId: ObjectID = await insertCluster([permitted, blocked]);
      await seedNodes(clusterId);
      props = labelScopedProps();

      async function findThroughScope(
        id: ObjectID,
      ): Promise<ProxmoxCluster | null> {
        const scoped: Query<ProxmoxCluster> =
          await ModelPermission.checkUpdateQueryPermissions(
            ProxmoxCluster,
            { _id: id.toString(), projectId: PROJECT_ID },
            {},
            props,
          );

        return await ProxmoxClusterService.findOneBy({
          query: scoped,
          select: { _id: true, projectId: true, labels: { _id: true } },
          props: { isRoot: true },
        });
      }

      /*
       * Why the fix: a lookup scoped to the caller's permitted labels loads
       * a cluster with those labels only, so a block check given that row
       * never sees the others - the route loads the cluster as root and
       * checks every label instead.
       */
      const unblockedId: ObjectID = await insertCluster([permitted, other]);
      expect(labelIdsOf(await findThroughScope(unblockedId))).toEqual([
        permitted.toString(),
      ]);

      /*
       * Since #4526 the scoped lookup also applies the team's blocks itself
       * (BasePermission.addRecordScopeToQuery): a cluster carrying a blocked
       * label is not found through it at all, where it used to come back
       * with the permitted label only and pass the block check.
       */
      expect(await findThroughScope(clusterId)).toBeNull();

      // Loaded as root, as the route now loads it: both labels, and refused.
      const unfiltered: ProxmoxCluster | null =
        await ProxmoxClusterService.findOneById({
          id: clusterId,
          select: { _id: true, projectId: true, labels: { _id: true } },
          props: { isRoot: true },
        });
      expect(labelIdsOf(unfiltered)).toEqual(
        [permitted.toString(), blocked.toString()].sort(),
      );
      await expect(
        ModelPermission.checkUpdatePermissionByModel({
          modelType: ProxmoxCluster,
          fetchModelWithAccessControlIds:
            async (): Promise<ProxmoxCluster | null> => {
              return unfiltered;
            },
          props: props,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);

      // The route refuses as it refuses a cluster it cannot find.
      expect(refusal(await callRemoveNode(clusterId, "pve3"))).toEqual({
        type: "NotFoundException",
        message: CLUSTER_NOT_FOUND_MESSAGE,
        status: null,
      });
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({ isUp: false, isNativePush: true });
    });

    test("the same caller removes the node from a cluster whose labels it is not blocked on", async () => {
      const clusterId: ObjectID = await insertCluster([permitted, other]);
      await seedNodes(clusterId);
      props = labelScopedProps();
      const findOneById: jest.SpyInstance = jest.spyOn(
        ProxmoxClusterService,
        "findOneById",
      );

      const outcome: RouteOutcome = await callRemoveNode(clusterId, "pve3");

      expect(outcome).toEqual({
        status: 200,
        body: { removed: true },
        error: null,
      });
      /*
       * The block check and the allow check both asked for the cluster
       * with every label: loaded once, as root.
       */
      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(findOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: clusterId,
          select: { _id: true, projectId: true, labels: { _id: true } },
          props: { isRoot: true },
        }),
      );
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toBeUndefined();
      expect(
        rosterStatesOf(await roster(clusterId)).map(
          (entry: { nodeName: string }): string => {
            return entry.nodeName;
          },
        ),
      ).toEqual(["pve1"]);
    });

    test("a cluster deleted between the lookup and the block check is not found, and nothing is removed", async () => {
      const clusterId: ObjectID = await insertCluster([permitted, other]);
      await seedNodes(clusterId);
      props = labelScopedProps();
      const loadWithAllLabels: (
        ...args: Parameters<typeof ProxmoxClusterService.findOneById>
      ) => Promise<ProxmoxCluster | null> =
        ProxmoxClusterService.findOneById.bind(ProxmoxClusterService);
      const findOneById: jest.SpyInstance = jest
        .spyOn(ProxmoxClusterService, "findOneById")
        .mockImplementation(
          async (
            ...args: Parameters<typeof ProxmoxClusterService.findOneById>
          ): Promise<ProxmoxCluster | null> => {
            // Deleted right after the scoped lookup found it.
            await database.query(
              `DELETE FROM "${schema}"."ProxmoxClusterLabel" WHERE "proxmoxClusterId" = $1`,
              [clusterId.toString()],
            );
            await database.query(
              `DELETE FROM "${schema}"."ProxmoxCluster" WHERE "_id" = $1`,
              [clusterId.toString()],
            );
            return loadWithAllLabels(...args);
          },
        );

      expect(refusal(await callRemoveNode(clusterId, "pve3"))).toEqual({
        type: "NotFoundException",
        message: CLUSTER_NOT_FOUND_MESSAGE,
        status: null,
      });
      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(
        await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
      ).toMatchObject({ isUp: false, isNativePush: true });
    });

    test("a node named past the column is removed through the route by its full name", async () => {
      const clusterId: ObjectID = await insertCluster([]);
      const longName: string = "n".repeat(150);
      await upsert([node(longName, { lastSeenAt: at(-10 * MINUTE_MS) })], {
        isNativePush: true,
        proxmoxClusterId: clusterId,
      });
      expect(await mark([longName], at(-5 * MINUTE_MS), clusterId)).toBe(1);
      props = propsWith([
        { permission: Permission.EditProxmoxCluster },
        { permission: Permission.ReadProxmoxCluster },
      ]);

      expect(await callRemoveNode(clusterId, longName)).toEqual({
        status: 200,
        body: { removed: true },
        error: null,
      });
      expect(await readRows(clusterId)).toEqual([]);
    });

    test("a cluster without the permitted label, or in another project, is not found, and nothing is removed", async () => {
      const unlabelled: ObjectID = await insertCluster([other]);
      const blockedOnly: ObjectID = await insertCluster([blocked]);
      const elsewhere: ObjectID = await insertCluster(
        [permitted],
        OTHER_PROJECT_ID,
      );
      for (const clusterId of [unlabelled, blockedOnly, elsewhere]) {
        await seedNodes(clusterId);
      }
      props = labelScopedProps();

      for (const clusterId of [unlabelled, blockedOnly, elsewhere]) {
        expect(refusal(await callRemoveNode(clusterId, "pve3"))).toEqual({
          type: "NotFoundException",
          message: CLUSTER_NOT_FOUND_MESSAGE,
          status: null,
        });
        expect(
          await rowOf("node/pve3", { proxmoxClusterId: clusterId }),
        ).toMatchObject({ isUp: false });
      }
    });

    test("each removal result on real rows: removed answers 200, then not-found 404, an agent node and a node still up 400 - and a control character never reaches Postgres", async () => {
      const clusterId: ObjectID = await insertCluster([]);
      await seedNodes(clusterId);
      await upsertFrom(
        false,
        [node("pve7", { isUp: false, lastSeenAt: at(-20 * MINUTE_MS) })],
        clusterId,
      );
      props = propsWith([
        { permission: Permission.EditProxmoxCluster },
        { permission: Permission.ReadProxmoxCluster },
      ]);

      expect(await callRemoveNode(clusterId, "pve3")).toEqual({
        status: 200,
        body: { removed: true },
        error: null,
      });
      expect(refusal(await callRemoveNode(clusterId, "pve3"))).toEqual({
        type: "NotFoundException",
        message: NODE_NOT_FOUND_MESSAGE,
        status: null,
      });
      expect(refusal(await callRemoveNode(clusterId, "pve7"))).toEqual({
        type: "BadDataException",
        message: NOT_NATIVE_MESSAGE,
        status: null,
      });
      expect(refusal(await callRemoveNode(clusterId, "pve1"))).toEqual({
        type: "BadDataException",
        message: STILL_REPORTING_MESSAGE,
        status: null,
      });
      // A NUL would make Postgres reject the statement itself.
      expect(refusal(await callRemoveNode(clusterId, "pve\u00003"))).toEqual({
        type: "BadDataException",
        message: "Node name must not contain control characters",
        status: null,
      });

      expect(externalIdsOf(await readRows(clusterId))).toEqual([
        "node/pve1",
        "node/pve7",
      ]);
      expect(
        (await rowOf("node/pve7", { proxmoxClusterId: clusterId }))
          ?.isNativePush,
      ).toBe(false);
    });
  });
});
