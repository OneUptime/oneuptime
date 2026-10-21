import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxInventorySummary,
  ProxmoxResourceLatestMetric,
} from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import {
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  PROXMOX_ROSTER_CACHE_TTL_MS,
  ProxmoxRosterNode,
  clearProxmoxNodeRosterCache,
} from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GitHub issue #4101: Proxmox VE's built-in OpenTelemetry push reached
 * OneUptime, but the Proxmox pages showed no data and the catalog checks
 * never fired — everything reads pve-exporter's pve_* shape, and the
 * native push sends proxmox_* series with a different identity model.
 *
 * This drives real native-push payloads (built the way
 * PVE::Status::OpenTelemetry builds them) through the real metrics
 * ingest — the in-place translation, the OTLP walk, the snapshot fold
 * and the flush — with only the Postgres seams and unrelated backends
 * mocked. Pins:
 *
 *   - the cluster is discovered from PVE's own `proxmox.cluster` (no
 *     hand-set resource attribute), and routed with no service.name,
 *   - the stored rows carry the pve_* series the pages and templates
 *     query, next to the untouched proxmox_* originals,
 *   - every node, guest and storage lands in the inventory with the
 *     same identity the agent path produces,
 *   - cluster counts come from the inventory, so a node's guest-only
 *     push does not report the cluster as that node's guest count,
 *   - every inventory upsert says which path it came from
 *     (isNativePush: true for the native push, false for the agent),
 *     per cluster — a native Node row is what the stale-row prune keeps
 *     through the retention window,
 *   - a native batch then takes the Node rows of its cluster last seen
 *     no later than its own newest observation into that keep
 *     (ProxmoxResourceService.adoptNodesAsNativePush) — once per 10
 *     minutes per cluster (a failed adoption releases its fence, so the
 *     next push retries), even with Redis down, never for the agent, and
 *     never at the cost of the batch — and adopting a row is not a report:
 *     it leaves the row's notReportingMarkedAt alone, so an Offline row
 *     the agent left behind is no mark, however fresh its updatedAt.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
// A second cluster, for requests that carry blocks of two clusters.
const OTHER_CLUSTER_ID: ObjectID = ObjectID.generate();

const CTIME_S: number = 1700000000;
const TIME_NANO: number = CTIME_S * 1_000_000_000;
const OBSERVED_AT: Date = new Date(CTIME_S * 1000);
const GIB: number = 1024 * 1024 * 1024;

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function attrs(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function gauge(
  name: string,
  value: number,
  labels: Record<string, string>,
  timeUnixNano: string | number = TIME_NANO,
): JSONObject {
  return {
    name,
    unit: "1",
    gauge: {
      dataPoints: [
        {
          timeUnixNano,
          attributes: attrs(labels),
          ...(Number.isInteger(value) ? { asInt: value } : { asDouble: value }),
        },
      ],
    },
  };
}

function pvePush(
  metrics: Array<JSONObject>,
  resource: Record<string, string> = {},
): JSONObject {
  return {
    resource: {
      attributes: attrs({
        "service.name": "proxmox-ve",
        "service.version": "9.0.10/deb1ca707ec72a89",
        "proxmox.cluster": "homelab",
        "proxmox.node": "pve1",
        ...resource,
      }),
    },
    scopeMetrics: [{ scope: {}, metrics }],
  };
}

// A node's own status push (pvestatd sends it as a request of its own).
function nodePush(
  node: string = "pve1",
  timeUnixNano: string | number = TIME_NANO,
  clusterName: string = "homelab",
): JSONObject {
  const n: Record<string, string> = { node };
  return pvePush(
    [
      gauge("proxmox_node_uptime", 86400, n, timeUnixNano),
      gauge("proxmox_node_cpustat_cpu", 0.25, n, timeUnixNano),
      gauge("proxmox_node_cpustat_cpus", 16, n, timeUnixNano),
      gauge("proxmox_node_memory_memtotal", 64 * GIB, n, timeUnixNano),
      gauge("proxmox_node_memory_memused", 16 * GIB, n, timeUnixNano),
      gauge("proxmox_node_blockstat_total", 100 * GIB, n, timeUnixNano),
      gauge("proxmox_node_blockstat_used", 40 * GIB, n, timeUnixNano),
    ],
    { "proxmox.cluster": clusterName, "proxmox.node": node },
  );
}

function qemuPush(
  node: string = "pve1",
  timeUnixNano: string | number = TIME_NANO,
): JSONObject {
  const vm: Record<string, string> = {
    vmid: "100",
    node,
    name: "web",
    type: "qemu",
  };
  return pvePush(
    [
      gauge("proxmox_vm_uptime", 3600, vm, timeUnixNano),
      gauge("proxmox_vm_cpu", 0.5, vm, timeUnixNano),
      gauge("proxmox_vm_mem", 2 * GIB, vm, timeUnixNano),
      gauge("proxmox_vm_maxmem", 8 * GIB, vm, timeUnixNano),
    ],
    { "proxmox.node": node },
  );
}

function storagePush(
  node: string = "pve1",
  timeUnixNano: string | number = TIME_NANO,
): JSONObject {
  const s: Record<string, string> = { node, storage: "local" };
  return pvePush(
    [
      gauge("proxmox_storage_total", 100 * GIB, s, timeUnixNano),
      gauge("proxmox_storage_used", 40 * GIB, s, timeUnixNano),
      gauge("proxmox_storage_active", 1, s, timeUnixNano),
    ],
    { "proxmox.node": node },
  );
}

/*
 * A Proxmox Agent scrape (pve-exporter behind the collector): the
 * cluster's own view of every node — by default pve1 up and pve2 down —
 * observed at `timeUnixNano`.
 */
function agentBlock(
  clusterName: string = "homelab",
  nodesUp: Record<string, boolean> = { pve1: true, pve2: false },
  timeUnixNano: string | number = TIME_NANO,
): JSONObject {
  const metrics: Array<JSONObject> = [];
  for (const [nodeName, up] of Object.entries(nodesUp)) {
    const id: string = `node/${nodeName}`;
    metrics.push(
      gauge("pve_node_info", 1, { id, name: nodeName }, timeUnixNano),
      gauge("pve_up", up ? 1 : 0, { id }, timeUnixNano),
    );
  }
  return {
    resource: { attributes: attrs({ "proxmox.cluster.name": clusterName }) },
    scopeMetrics: [{ scope: {}, metrics }],
  };
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

interface Spies {
  rows: Array<JSONObject>;
  discoverProxmox: jest.SpyInstance;
  resolveResource: jest.SpyInstance;
  bulkUpsert: jest.SpyInstance;
  bulkUpdateLatestMetrics: jest.SpyInstance;
  getInventorySummary: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
  adoptNodesAsNativePush: jest.SpyInstance;
}

function setupIngestMocks(data: {
  inventory?: ProxmoxInventorySummary;
  clusterId?: ObjectID | null;
}): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  const rows: Array<JSONObject> = [];
  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  const discoverProxmox: jest.SpyInstance = jest
    .spyOn(service, "autoDiscoverProxmoxCluster")
    .mockResolvedValue(
      data.clusterId === undefined ? CLUSTER_ID : data.clusterId,
    );

  const resolveResource: jest.SpyInstance = jest
    .spyOn(service, "resolveTelemetryResource")
    .mockResolvedValue({
      serviceName: "proxmox/homelab",
      primaryEntityId: CLUSTER_ID,
      primaryEntityType: ServiceType.ProxmoxCluster,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });

  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const bulkUpdateLatestMetrics: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);
  const getInventorySummary: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "getInventorySummary")
    .mockResolvedValue(
      data.inventory || {
        countsByKind: {},
        nodeOnlineCount: 0,
        guestRunningCount: 0,
      },
    );
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(ProxmoxClusterService, "updateLastSeen")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);
  const adoptNodesAsNativePush: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "adoptNodesAsNativePush")
    .mockResolvedValue(0);

  return {
    rows,
    discoverProxmox,
    resolveResource,
    bulkUpsert,
    bulkUpdateLatestMetrics,
    getInventorySummary,
    updateLastSeen,
    adoptNodesAsNativePush,
  };
}

function stringAttr(attributes: JSONArray, key: string): Array<string> {
  return (attributes as Array<JSONObject>)
    .filter((a: JSONObject) => {
      return a["key"] === key;
    })
    .map((a: JSONObject) => {
      return (a["value"] as JSONObject)["stringValue"] as string;
    });
}

// What the flush hands ProxmoxResourceService.bulkUpsert.
interface BulkUpsertArgs {
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
  resources: Array<ParsedProxmoxResource>;
  isNativePush?: boolean | undefined;
}

// The one upsert of a native-push batch of CLUSTER_ID, rows sorted by id.
function upserted(spies: Spies): Array<ParsedProxmoxResource> {
  expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
  const args: BulkUpsertArgs = spies.bulkUpsert.mock.calls[0]![0];
  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
  // Strictly true: a missing flag would read as an agent row.
  expect(args.isNativePush).toBe(true);
  return [...args.resources].sort(
    (a: ParsedProxmoxResource, b: ParsedProxmoxResource) => {
      return a.externalId.localeCompare(b.externalId);
    },
  );
}

// One bulkUpsert call, with its rows reduced to their sorted ids.
interface UpsertCall {
  proxmoxClusterId: string;
  isNativePush: boolean | undefined;
  externalIds: Array<string>;
}

// Every bulkUpsert call so far, in order.
function upsertCalls(bulkUpsert: jest.SpyInstance): Array<UpsertCall> {
  return (bulkUpsert.mock.calls as Array<Array<unknown>>).map(
    (call: Array<unknown>): UpsertCall => {
      const args: BulkUpsertArgs = call[0] as BulkUpsertArgs;
      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
      return {
        proxmoxClusterId: args.proxmoxClusterId.toString(),
        isNativePush: args.isNativePush,
        externalIds: args.resources
          .map((r: ParsedProxmoxResource) => {
            return r.externalId;
          })
          .sort(),
      };
    },
  );
}

// The distinct isNativePush values the upserts carried.
function isNativePushValues(
  bulkUpsert: jest.SpyInstance,
): Set<boolean | undefined> {
  return new Set(
    upsertCalls(bulkUpsert).map((call: UpsertCall) => {
      return call.isNativePush;
    }),
  );
}

function rowNames(rows: Array<JSONObject>): Set<string> {
  return new Set(
    rows.map((r: JSONObject) => {
      return r["name"] as string;
    }),
  );
}

/*
 * ------------------------------------------------------------------
 * Silent-node harness
 * ------------------------------------------------------------------
 *
 * A native-push node that dies goes quiet, so the nodes still alive
 * report it (ProxmoxNativeNodeLiveness decides, and
 * appendProxmoxSiblingReportsInPlace writes the report). The decision
 * reads OneUptime's receive clock and Redis, so the harness drives both:
 *
 *   - the receive clock — the ingest worker's clock: Date, and nothing
 *     else, is faked, so Date.now() and new Date() (OneUptimeDate
 *     .getCurrentDate()) both read the hand-set time, as they read the
 *     one wall clock in production,
 *   - GlobalCache is an in-memory store that honours TTLs on that
 *     clock — node liveness and the fences, the only keys the path
 *     keeps — and can be made to fail method by method, or for one
 *     method in one namespace,
 *   - pushes are ingested round by round, every 10 s as pvestatd sends
 *     them, each node's push as a request of its own,
 *   - the inventory is a map of Node rows that the flush writes the way
 *     the real SQL does, each write on its own clock:
 *       - bulkUpsert (a node's own push, or an agent scrape: newer
 *         lastSeenAt, Online, notReportingMarkedAt cleared, and
 *         updatedAt = now() — Postgres's clock, which may run ahead of
 *         the worker's: postgresClockAheadMs),
 *       - bulkUpdateLatestMetrics (updatedAt = now() again, for the rows
 *         the batch observed, under its metricsUpdatedAt guard),
 *       - markNodesNotReporting (Offline, notReportingMarkedAt = the
 *         markedAt the ingest passes — the worker's clock — rewriting a
 *         row already marked only once that mark is over a minute before
 *         markedAt; updatedAt = now(), Postgres's clock, as ever),
 *       - adoptNodesAsNativePush (isNativePush only, for rows last seen
 *         up to the batch's newest observation — notReportingMarkedAt and
 *         updatedAt are left alone: adopting a row is not a report),
 *     and getNodeRoster reads back what the real SELECT does — lastSeenAt,
 *     Online/Offline and notReportingMarkedAt, never updatedAt — so a
 *     node's own push refreshes its roster row, a report never can, a
 *     mark shows up on the next roster read, and no other write can pass
 *     for one.
 * ------------------------------------------------------------------
 */

const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";
const MARK_FENCE_NAMESPACE: string = "proxmox-silent-node-mark";

/*
 * The adoption fence (OtelMetricsIngestService.adoptProxmoxNodesAsNativePush),
 * spelled out: one key per cluster, for 10 minutes.
 */
const ADOPT_FENCE_NAMESPACE: string = "proxmox-native-adopt";
const ADOPT_FENCE_SECONDS: number = 600;

/*
 * The Offline mark's refresh interval (ProxmoxResourceService
 * .markNodesNotReporting), spelled out: a row already Offline on the
 * native push is rewritten — its notReportingMarkedAt stamped with the
 * markedAt the ingest passes, the worker's clock at the flush — only once
 * that mark is more than a minute before it. The mark is what lets the
 * reports of an Offline node carry on while no node is established: it
 * must be at most one monitor window (PROXMOX_MONITOR_WINDOW_MS) old at
 * the moment the roster holding it was read.
 */
const MARK_REFRESH_MS: number = 60_000;

// The Offline mark's fence (OtelMetricsIngestService), per cluster and set.
const MARK_FENCE_MS: number = 30_000;

/*
 * The pve_node_info weight of one silent node in a report that L nodes
 * make: 1 ÷ L, rounded up to whole 2^-16 units (with L = 3, a hair over
 * 1/3). L counts every node of the cluster that is not being reported —
 * each is presumed live until it is.
 */
function oneSilentNodeWeight(reporterCount: number): number {
  return Math.ceil(65536 / reporterCount) / 65536;
}

/*
 * The wire contract of a report, spelled out rather than imported: the
 * stored rows and the queries built on them depend on these strings.
 */
const INFERRED_ATTRIBUTE: string = "oneuptime.proxmox.inferred";
const INFERRED_NOT_REPORTING: string = "not-reporting";
const SIBLING_REPORT_SCOPE: string = "oneuptime.proxmox.sibling-report";

// pvestatd pushes each node's status this often.
const PUSH_INTERVAL_MS: number = 10_000;

// Round 0 of the simulation, on the PVE clocks.
const T0_MS: number = CTIME_S * 1000;

/*
 * The pushes of a round are ingested one after the other, this far
 * apart; the first one this long after the round's push time.
 */
const RECEIVE_STEP_MS: number = 250;

/*
 * The first round on which a node that has pushed since round 0 has
 * pushed continuously for the whole silence window (2 minutes): it is
 * established, so from here on — for as long as it keeps pushing, no
 * push more than a minute after the one before — every live node of its
 * cluster reports. Before it, nobody reports.
 */
const FIRST_REPORTING_ROUND: number =
  PROXMOX_NODE_SILENCE_MS / PUSH_INTERVAL_MS;

// pve3's last own push, before round 0: it is silent throughout.
const PVE3_LAST_SEEN_MS: number = T0_MS - 60_000;

type CacheMethod =
  | "getString"
  | "setString"
  | "getStrings"
  | "setStringIfNotExists"
  | "deleteKey";

interface FakeRedisEntry {
  value: string;
  expiresAtMs: number | null;
}

// One setString that went through, at the receive time it was made.
interface FakeRedisWrite {
  atMs: number;
  namespace: string;
  key: string;
  value: string;
  options: { expiresInSeconds: number } | undefined;
}

interface FakeRedis {
  // `${namespace}-${key}` → entry, as GlobalCache keys Redis.
  entries: Map<string, FakeRedisEntry>;
  // Every setString that went through, in order.
  writes: Array<FakeRedisWrite>;
  // Methods that currently reject, as they would with Redis down.
  failing: Set<CacheMethod>;
  // Methods that currently reject in one namespace only (failingIn()).
  failingInNamespace: Set<string>;
  getString: jest.SpyInstance;
  setString: jest.SpyInstance;
  getStrings: jest.SpyInstance;
  setStringIfNotExists: jest.SpyInstance;
  deleteKey: jest.SpyInstance;
  /*
   * GlobalCache's own Lua-script calls, watched but not faked (they
   * throw with no Redis connected): the path never needs one. Every
   * other GlobalCache helper goes through the five above.
   */
  scripted: Array<jest.SpyInstance>;
}

// The failingInNamespace entry for one method in one namespace.
function failingIn(method: CacheMethod, namespace: string): string {
  return `${method} ${namespace}`;
}

function installFakeRedis(): FakeRedis {
  const entries: Map<string, FakeRedisEntry> = new Map();
  const writes: Array<FakeRedisWrite> = [];
  const failing: Set<CacheMethod> = new Set();
  const failingInNamespace: Set<string> = new Set();

  const fullKey: (namespace: string, key: string) => string = (
    namespace: string,
    key: string,
  ): string => {
    return `${namespace}-${key}`;
  };

  const read: (namespace: string, key: string) => string | null = (
    namespace: string,
    key: string,
  ): string | null => {
    const entry: FakeRedisEntry | undefined = entries.get(
      fullKey(namespace, key),
    );
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs !== null && Date.now() >= entry.expiresAtMs) {
      entries.delete(fullKey(namespace, key));
      return null;
    }
    return entry.value;
  };

  const write: (
    namespace: string,
    key: string,
    value: string,
    options: { expiresInSeconds: number } | undefined,
  ) => void = (
    namespace: string,
    key: string,
    value: string,
    options: { expiresInSeconds: number } | undefined,
  ): void => {
    entries.set(fullKey(namespace, key), {
      value,
      expiresAtMs: options
        ? Date.now() + options.expiresInSeconds * 1000
        : null,
    });
  };

  const outage: (method: CacheMethod, namespace: string) => Error | null = (
    method: CacheMethod,
    namespace: string,
  ): Error | null => {
    return failing.has(method) ||
      failingInNamespace.has(failingIn(method, namespace))
      ? new Error(`redis down (${method} ${namespace})`)
      : null;
  };

  const getString: jest.SpyInstance = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      (namespace: string, key: string): Promise<string | null> => {
        const error: Error | null = outage("getString", namespace);
        return error
          ? Promise.reject(error)
          : Promise.resolve(read(namespace, key));
      },
    );

  const setString: jest.SpyInstance = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ): Promise<void> => {
        const error: Error | null = outage("setString", namespace);
        if (error) {
          return Promise.reject(error);
        }
        write(namespace, key, value, options);
        writes.push({ atMs: Date.now(), namespace, key, value, options });
        return Promise.resolve();
      },
    );

  const getStrings: jest.SpyInstance = jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(
      (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<string | null>> => {
        const error: Error | null = outage("getStrings", namespace);
        if (error) {
          return Promise.reject(error);
        }
        return Promise.resolve(
          keys.map((key: string) => {
            return read(namespace, key);
          }),
        );
      },
    );

  const setStringIfNotExists: jest.SpyInstance = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ): Promise<boolean> => {
        const error: Error | null = outage("setStringIfNotExists", namespace);
        if (error) {
          return Promise.reject(error);
        }
        if (read(namespace, key) !== null) {
          return Promise.resolve(false);
        }
        write(namespace, key, value, options);
        return Promise.resolve(true);
      },
    );

  const deleteKey: jest.SpyInstance = jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation((namespace: string, key: string): Promise<void> => {
      const error: Error | null = outage("deleteKey", namespace);
      if (error) {
        return Promise.reject(error);
      }
      entries.delete(fullKey(namespace, key));
      return Promise.resolve();
    });

  const scripted: Array<jest.SpyInstance> = [
    jest.spyOn(GlobalCache, "setStringIfChanged"),
    jest.spyOn(GlobalCache, "deleteKeyIfValue"),
    jest.spyOn(GlobalCache, "getAndDeleteString"),
  ];

  return {
    entries,
    writes,
    failing,
    failingInNamespace,
    getString,
    setString,
    getStrings,
    setStringIfNotExists,
    deleteKey,
    scripted,
  };
}

/*
 * OneUptime's receive clock — the ingest worker's: what Date.now() and
 * new Date() return while a test runs. Setting nowMs moves it.
 */
interface ReceiveClock {
  nowMs: number;
}

/*
 * Only Date is faked — timers, ticks and microtasks run as usual. The
 * top-level afterEach puts the real Date back.
 */
function installReceiveClock(startMs: number): ReceiveClock {
  jest.useFakeTimers({
    doNotFake: [
      "nextTick",
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(startMs);
  return {
    get nowMs(): number {
      return Date.now();
    },
    set nowMs(ms: number) {
      jest.setSystemTime(ms);
    },
  };
}

// One markNodesNotReporting write, with the receive time it was made at.
interface OfflineMark {
  atMs: number;
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
  nodeNames: Array<string>;
  silentBefore: Date;
  /*
   * The markedAt the ingest passed (ms), or null when it passed none —
   * the notReportingMarkedAt the rows it rewrote are stamped with.
   */
  markedAtMs: number | null;
  /*
   * The nodes whose row it rewrote, sorted: the rest were Offline and
   * marked within the last minute already (or not silent that long).
   */
  written: Array<string>;
}

// One Node row of the fake inventory.
interface FakeNodeRow {
  lastSeenAt: Date; // its own last push (or scrape), on its clock
  isUp: boolean | null; // Online / Offline
  isNativePush: boolean | null;
  /*
   * When the live nodes last reported it as not reporting: the markedAt
   * the ingest passed (the worker's clock). Null when nothing has marked
   * it since its own last push (or scrape) — or ever.
   */
  notReportingMarkedAt: Date | null;
  /*
   * Its last write of any kind, on Postgres's clock (now()): an upsert, a
   * latest-metrics update or a mark. The roster never reads it.
   */
  updatedAt: Date | null;
}

// One getNodeRoster read: when, and the rows it returned.
interface RosterRead {
  atMs: number;
  nodes: Array<ProxmoxRosterNode>;
}

interface SilentNodeHarness {
  spies: Spies;
  redis: FakeRedis;
  clock: ReceiveClock;
  // The inventory's Node rows, by node name.
  inventory: Map<string, FakeNodeRow>;
  getNodeRoster: jest.SpyInstance;
  // The receive time of every roster read, in order.
  rosterReadsAtMs: Array<number>;
  // Every roster read, with what it returned, in order.
  rosterReads: Array<RosterRead>;
  markNodesNotReporting: jest.SpyInstance;
  marks: Array<OfflineMark>;
  // The receive time of every adoptNodesAsNativePush call, in order.
  adoptionsAtMs: Array<number>;
}

function setupSilentNodeHarness(
  data: {
    // Node name → lastSeenAt (ms) already in the inventory at round 0.
    inventory?: Record<string, number>;
    /*
     * Those rows' Online/Offline state. Default true: the node's last
     * own push said it was up, and nothing has marked it since.
     */
    isUp?: Record<string, boolean | null>;
    // Those rows' isNativePush. Default true.
    isNativePush?: Record<string, boolean | null>;
    /*
     * Those rows' notReportingMarkedAt (ms, OneUptime's clock): for an
     * Offline row, when the live nodes last marked it. Default null —
     * never marked.
     */
    notReportingMarkedAt?: Record<string, number | null>;
    /*
     * Those rows' updatedAt (ms, Postgres's clock): their last write of
     * any kind. Default: their lastSeenAt.
     */
    updatedAt?: Record<string, number | null>;
    /*
     * How far Postgres's clock (the now() an upsert stamps) runs ahead
     * of the worker's. Default 0.
     */
    postgresClockAheadMs?: number;
    clusterId?: ObjectID | null;
  } = {},
): SilentNodeHarness {
  const spies: Spies = setupIngestMocks(
    data.clusterId === undefined ? {} : { clusterId: data.clusterId },
  );

  const clock: ReceiveClock = installReceiveClock(T0_MS);
  const postgresClockAheadMs: number = data.postgresClockAheadMs || 0;

  // A fresh Redis: nothing survives from before round 0.
  const redis: FakeRedis = installFakeRedis();

  const optionalDate: (ms: number | null) => Date | null = (
    ms: number | null,
  ): Date | null => {
    return ms === null ? null : new Date(ms);
  };
  const inventory: Map<string, FakeNodeRow> = new Map();
  for (const [nodeName, lastSeenMs] of Object.entries(
    data.inventory || { pve3: PVE3_LAST_SEEN_MS },
  )) {
    const isUp: boolean | null | undefined = data.isUp?.[nodeName];
    const isNativePush: boolean | null | undefined =
      data.isNativePush?.[nodeName];
    const markedAtMs: number | null | undefined =
      data.notReportingMarkedAt?.[nodeName];
    const updatedAtMs: number | null | undefined = data.updatedAt?.[nodeName];
    inventory.set(nodeName, {
      lastSeenAt: new Date(lastSeenMs),
      isUp: isUp === undefined ? true : isUp,
      isNativePush: isNativePush === undefined ? true : isNativePush,
      notReportingMarkedAt:
        markedAtMs === undefined ? null : optionalDate(markedAtMs),
      updatedAt:
        updatedAtMs === undefined
          ? new Date(lastSeenMs)
          : optionalDate(updatedAtMs),
    });
  }
  // now() on Postgres's clock.
  const postgresNow: () => Date = (): Date => {
    return new Date(Date.now() + postgresClockAheadMs);
  };

  /*
   * ON CONFLICT … DO UPDATE … "notReportingMarkedAt" = NULL,
   * "updatedAt" = now() WHERE EXCLUDED."lastSeenAt" >= "lastSeenAt".
   */
  spies.bulkUpsert.mockImplementation(
    (...args: Array<unknown>): Promise<void> => {
      const upsert: {
        resources: Array<ParsedProxmoxResource>;
        isNativePush?: boolean | undefined;
      } = args[0] as {
        resources: Array<ParsedProxmoxResource>;
        isNativePush?: boolean | undefined;
      };
      for (const resource of upsert.resources) {
        if (
          resource.kind !== "Node" ||
          !resource.externalId.startsWith("node/")
        ) {
          continue;
        }
        const nodeName: string = resource.externalId.substring("node/".length);
        const row: FakeNodeRow | undefined = inventory.get(nodeName);
        if (row && resource.lastSeenAt.getTime() < row.lastSeenAt.getTime()) {
          continue;
        }
        inventory.set(nodeName, {
          lastSeenAt: resource.lastSeenAt,
          // COALESCE(EXCLUDED."isUp", "isUp")
          isUp: resource.isUp ?? row?.isUp ?? null,
          isNativePush: Boolean(upsert.isNativePush),
          notReportingMarkedAt: null,
          updatedAt: postgresNow(),
        });
      }
      return Promise.resolve();
    },
  );

  /*
   * SET … "metricsUpdatedAt" = v."observedAt", "updatedAt" = now()
   * WHERE "metricsUpdatedAt" IS NULL OR v."observedAt" >= "metricsUpdatedAt".
   */
  const metricsUpdatedAtMs: Map<string, number> = new Map();
  spies.bulkUpdateLatestMetrics.mockImplementation(
    (...args: Array<unknown>): Promise<void> => {
      const update: { metrics: Array<ProxmoxResourceLatestMetric> } =
        args[0] as { metrics: Array<ProxmoxResourceLatestMetric> };
      for (const metric of update.metrics) {
        if (metric.kind !== "Node" || !metric.externalId.startsWith("node/")) {
          continue;
        }
        const nodeName: string = metric.externalId.substring("node/".length);
        const row: FakeNodeRow | undefined = inventory.get(nodeName);
        const observedMs: number = metric.observedAt.getTime();
        const previousMs: number | undefined = metricsUpdatedAtMs.get(nodeName);
        if (!row || (previousMs !== undefined && observedMs < previousMs)) {
          continue;
        }
        metricsUpdatedAtMs.set(nodeName, observedMs);
        inventory.set(nodeName, { ...row, updatedAt: postgresNow() });
      }
      return Promise.resolve();
    },
  );

  /*
   * SELECT "externalId", "lastSeenAt", "isUp", "notReportingMarkedAt" —
   * never updatedAt.
   */
  const rosterReadsAtMs: Array<number> = [];
  const rosterReads: Array<RosterRead> = [];
  const getNodeRoster: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "getNodeRoster")
    .mockImplementation((): Promise<Array<ProxmoxRosterNode>> => {
      // A snapshot: a later write never reaches a roster already read.
      const nodes: Array<ProxmoxRosterNode> = Array.from(
        inventory.entries(),
      ).map(([nodeName, row]: [string, FakeNodeRow]): ProxmoxRosterNode => {
        return {
          nodeName,
          lastSeenAt: row.lastSeenAt,
          isUp: row.isUp,
          notReportingMarkedAt: row.notReportingMarkedAt,
        };
      });
      rosterReadsAtMs.push(Date.now());
      rosterReads.push({ atMs: Date.now(), nodes });
      return Promise.resolve(nodes);
    });

  /*
   * SET "isUp" = false, "isNativePush" = true,
   *   "notReportingMarkedAt" = $5 (markedAt), "updatedAt" = now()
   * WHERE "lastSeenAt" < $4 AND ("isUp" IS DISTINCT FROM false
   *   OR "isNativePush" IS DISTINCT FROM true
   *   OR "notReportingMarkedAt" IS NULL
   *   OR "notReportingMarkedAt" < $6 (markedAt − 60 s)).
   * Without a markedAt the service stamps its own current time — the
   * same worker clock.
   */
  const marks: Array<OfflineMark> = [];
  const markNodesNotReporting: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "markNodesNotReporting")
    .mockImplementation(
      (mark: {
        projectId: ObjectID;
        proxmoxClusterId: ObjectID;
        nodeNames: Array<string>;
        silentBefore: Date;
        markedAt?: Date | undefined;
      }): Promise<number> => {
        const nowMs: number = Date.now();
        const markedAtMs: number = mark.markedAt
          ? mark.markedAt.getTime()
          : nowMs;
        const written: Array<string> = [];
        for (const nodeName of mark.nodeNames) {
          const row: FakeNodeRow | undefined = inventory.get(nodeName);
          if (!row || row.lastSeenAt.getTime() >= mark.silentBefore.getTime()) {
            continue;
          }
          const due: boolean =
            row.isUp !== false ||
            row.isNativePush !== true ||
            row.notReportingMarkedAt === null ||
            row.notReportingMarkedAt.getTime() < markedAtMs - MARK_REFRESH_MS;
          if (!due) {
            continue;
          }
          inventory.set(nodeName, {
            ...row,
            isUp: false,
            isNativePush: true,
            notReportingMarkedAt: new Date(markedAtMs),
            updatedAt: postgresNow(),
          });
          written.push(nodeName);
        }
        marks.push({
          atMs: nowMs,
          projectId: mark.projectId,
          proxmoxClusterId: mark.proxmoxClusterId,
          nodeNames: mark.nodeNames,
          silentBefore: mark.silentBefore,
          markedAtMs: mark.markedAt ? mark.markedAt.getTime() : null,
          written: written.sort(),
        });
        return Promise.resolve(written.length);
      },
    );

  /*
   * SET "isNativePush" = true
   * WHERE "isNativePush" IS DISTINCT FROM true AND "lastSeenAt" <= $3
   * (seenUpTo) — notReportingMarkedAt and updatedAt are left alone.
   */
  const adoptionsAtMs: Array<number> = [];
  spies.adoptNodesAsNativePush.mockImplementation(
    (adoption: {
      projectId: ObjectID;
      proxmoxClusterId: ObjectID;
      seenUpTo: Date;
    }): Promise<number> => {
      adoptionsAtMs.push(Date.now());
      let adopted: number = 0;
      for (const [nodeName, row] of inventory.entries()) {
        if (
          row.isNativePush !== true &&
          row.lastSeenAt.getTime() <= adoption.seenUpTo.getTime()
        ) {
          inventory.set(nodeName, { ...row, isNativePush: true });
          adopted++;
        }
      }
      return Promise.resolve(adopted);
    },
  );

  return {
    spies,
    redis,
    clock,
    inventory,
    getNodeRoster,
    rosterReadsAtMs,
    rosterReads,
    markNodesNotReporting,
    marks,
    adoptionsAtMs,
  };
}

function pushTimeMs(round: number): number {
  return T0_MS + round * PUSH_INTERVAL_MS;
}

// OTLP/JSON carries timeUnixNano as a decimal string.
function nanosAt(ms: number): string {
  return `${ms}000000`;
}

// Ingest one request at the given receive time; returns its stored rows.
async function ingestAt(
  harness: SilentNodeHarness,
  receivedAtMs: number,
  blocks: Array<JSONObject>,
): Promise<Array<JSONObject>> {
  harness.clock.nowMs = receivedAtMs;
  const before: number = harness.spies.rows.length;
  await OtelMetricsIngestService.processMetricsFromQueue(request(blocks));
  return harness.spies.rows.slice(before);
}

/*
 * One push round: every node in `nodes` pushes its own status at the
 * round's time, and the pushes are ingested in that order. Returns each
 * node's stored rows.
 */
async function nodeRound(
  harness: SilentNodeHarness,
  round: number,
  nodes: Array<string>,
): Promise<Map<string, Array<JSONObject>>> {
  const rowsByNode: Map<string, Array<JSONObject>> = new Map();
  for (let index: number = 0; index < nodes.length; index++) {
    const node: string = nodes[index]!;
    rowsByNode.set(
      node,
      await ingestAt(
        harness,
        pushTimeMs(round) + RECEIVE_STEP_MS * (index + 1),
        [nodePush(node, nanosAt(pushTimeMs(round)))],
      ),
    );
  }
  return rowsByNode;
}

// Rounds `from`..`to` inclusive; returns every row they stored.
async function nodeRounds(
  harness: SilentNodeHarness,
  data: { from: number; to: number; nodes: Array<string> },
): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = [];
  for (let round: number = data.from; round <= data.to; round++) {
    for (const nodeRows of (
      await nodeRound(harness, round, data.nodes)
    ).values()) {
      rows.push(...nodeRows);
    }
  }
  return rows;
}

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

function rowsOf(
  rows: Array<JSONObject>,
  name: string,
  id: string,
): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return row["name"] === name && attributesOf(row)["id"] === id;
  });
}

function valuesOf(rows: Array<JSONObject>): Array<number> {
  return rows.map((row: JSONObject) => {
    return row["value"] as number;
  });
}

// Rows written for a node that did not say it itself.
function inferredRows(rows: Array<JSONObject>): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return attributesOf(row)[INFERRED_ATTRIBUTE] !== undefined;
  });
}

// The ids the rows report as not reporting, sorted and de-duplicated.
function reportedIds(rows: Array<JSONObject>): Array<string> {
  return Array.from(
    new Set(
      inferredRows(rows).map((row: JSONObject) => {
        return attributesOf(row)["id"] as string;
      }),
    ),
  ).sort();
}

// A row's own timestamp in ms (rows carry "<ms>000000").
function rowTimeMs(row: JSONObject): number {
  return Number(String(row["timeUnixNano"]).slice(0, -6));
}

/*
 * Cluster Quorum at Risk over these rows: Σ pve_up ÷ Σ pve_node_info of
 * the node series (Sum/Sum, pve.scope = node), in percent.
 */
function quorumPercent(rows: Array<JSONObject>): number {
  let up: number = 0;
  let total: number = 0;
  for (const row of rows) {
    if (attributesOf(row)["pve.scope"] !== "node") {
      continue;
    }
    if (row["name"] === "pve_up") {
      up += row["value"] as number;
    } else if (row["name"] === "pve_node_info") {
      total += row["value"] as number;
    }
  }
  return (up / total) * 100;
}

// What a stored row says, without its per-ingest ids and stamps.
function rowSignature(rows: Array<JSONObject>): Array<string> {
  return rows
    .map((row: JSONObject) => {
      return `${row["name"] as string}|${String(attributesOf(row)["id"] ?? "")}|${String(row["value"])}|${String(row["timeUnixNano"])}`;
    })
    .sort();
}

function callsInNamespace(spy: jest.SpyInstance, namespace: string): number {
  return spy.mock.calls.filter((call: Array<unknown>) => {
    return call[0] === namespace;
  }).length;
}

// The two fences: the Offline mark's and the adoption's.
const FENCE_NAMESPACES: Array<string> = [
  MARK_FENCE_NAMESPACE,
  ADOPT_FENCE_NAMESPACE,
];

/*
 * Every GlobalCache call so far, in call order, as "<method> <namespace>"
 * — the watched Lua-script calls included.
 */
function cacheCalls(redis: FakeRedis): Array<string> {
  const calls: Array<{ order: number; call: string }> = [];
  const spies: Array<[string, jest.SpyInstance]> = [
    ["getString", redis.getString],
    ["setString", redis.setString],
    ["getStrings", redis.getStrings],
    ["setStringIfNotExists", redis.setStringIfNotExists],
    ["deleteKey", redis.deleteKey],
    ["setStringIfChanged", redis.scripted[0]!],
    ["deleteKeyIfValue", redis.scripted[1]!],
    ["getAndDeleteString", redis.scripted[2]!],
  ];
  for (const [method, spy] of spies) {
    (spy.mock.calls as Array<Array<unknown>>).forEach(
      (call: Array<unknown>, index: number) => {
        calls.push({
          order: spy.mock.invocationCallOrder[index]!,
          call: `${method} ${String(call[0])}`,
        });
      },
    );
  }
  return calls
    .sort((a: { order: number }, b: { order: number }) => {
      return a.order - b.order;
    })
    .map((entry: { call: string }) => {
      return entry.call;
    });
}

/*
 * Every GlobalCache call outside the two fences. Node liveness is the only
 * other state the silent-node path keeps in Redis, so these are its
 * liveness reads and writes — and any other key would show up here too.
 */
function livenessCalls(redis: FakeRedis): number {
  return cacheCalls(redis).filter((call: string) => {
    return !FENCE_NAMESPACES.includes(call.split(" ")[1]!);
  }).length;
}

function livenessEntry(
  redis: FakeRedis,
  nodeName: string,
): FakeRedisEntry | undefined {
  return redis.entries.get(
    `${LIVENESS_NAMESPACE}-${PROJECT_ID.toString()}:${CLUSTER_ID.toString()}:${nodeName}`,
  );
}

/*
 * How long ago, on the receive clock, the live nodes last marked a node
 * Offline: the age of its row's notReportingMarkedAt.
 */
function markAgeMs(harness: SilentNodeHarness, nodeName: string): number {
  const markedAt: Date | null =
    harness.inventory.get(nodeName)!.notReportingMarkedAt;
  expect(markedAt).not.toBeNull();
  return harness.clock.nowMs - markedAt!.getTime();
}

// A node's row as the last roster read returned it.
function lastRosterRow(
  harness: SilentNodeHarness,
  nodeName: string,
): ProxmoxRosterNode | undefined {
  const read: RosterRead | undefined =
    harness.rosterReads[harness.rosterReads.length - 1];
  return read?.nodes.find((node: ProxmoxRosterNode) => {
    return node.nodeName === nodeName;
  });
}

// The receive times of the Offline marks that rewrote this node's row.
function markRewritesAtMs(
  harness: SilentNodeHarness,
  nodeName: string,
): Array<number> {
  return harness.marks
    .filter((mark: OfflineMark) => {
      return mark.written.includes(nodeName);
    })
    .map((mark: OfflineMark) => {
      return mark.atMs;
    });
}

// The node-name sets marked Offline, in order.
function markedNodeSets(harness: SilentNodeHarness): Array<Array<string>> {
  return harness.marks.map((mark: OfflineMark) => {
    return mark.nodeNames;
  });
}

// Every inventory upsert of the test, flattened.
function allUpsertedResources(
  harness: SilentNodeHarness,
): Array<ParsedProxmoxResource> {
  const resources: Array<ParsedProxmoxResource> = [];
  for (const call of harness.spies.bulkUpsert.mock.calls as Array<
    Array<unknown>
  >) {
    resources.push(
      ...(call[0] as { resources: Array<ParsedProxmoxResource> }).resources,
    );
  }
  return resources;
}

// One adoptNodesAsNativePush call, reduced to what varies.
interface AdoptionCall {
  proxmoxClusterId: string;
  // Rows last seen after this (the batch's newest observation) are left.
  seenUpToMs: number;
}

// Every adoptNodesAsNativePush call so far, in order.
function adoptionCalls(spies: Spies): Array<AdoptionCall> {
  return (spies.adoptNodesAsNativePush.mock.calls as Array<Array<unknown>>).map(
    (call: Array<unknown>): AdoptionCall => {
      const args: {
        projectId: ObjectID;
        proxmoxClusterId: ObjectID;
        seenUpTo: Date;
      } = call[0] as {
        projectId: ObjectID;
        proxmoxClusterId: ObjectID;
        seenUpTo: Date;
      };
      expect(Object.keys(args).sort()).toEqual([
        "projectId",
        "proxmoxClusterId",
        "seenUpTo",
      ]);
      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(args.seenUpTo).toBeInstanceOf(Date);
      return {
        proxmoxClusterId: args.proxmoxClusterId.toString(),
        seenUpToMs: args.seenUpTo.getTime(),
      };
    },
  );
}

// The adoption fence of a cluster, as it sits in Redis.
function adoptFence(
  redis: FakeRedis,
  clusterId: ObjectID = CLUSTER_ID,
): FakeRedisEntry | undefined {
  return redis.entries.get(`${ADOPT_FENCE_NAMESPACE}-${clusterId.toString()}`);
}

// The rows stored at one round's push time.
function rowsAtRound(
  rows: Array<JSONObject>,
  round: number,
): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return rowTimeMs(row) === pushTimeMs(round);
  });
}

// A node's reported pve_node_info weight, summed over the rows.
function reportedWeight(rows: Array<JSONObject>, nodeName: string): number {
  return valuesOf(rowsOf(rows, "pve_node_info", `node/${nodeName}`)).reduce(
    (sum: number, value: number) => {
      return sum + value;
    },
    0,
  );
}

// The Offline marks made since `from`, each as its node names joined.
function markedSince(harness: SilentNodeHarness, from: number): Array<string> {
  return markedNodeSets(harness)
    .slice(from)
    .map((nodeNames: Array<string>) => {
      return nodeNames.join(",");
    });
}

beforeEach(() => {
  // Rosters are cached per ingest worker; every test starts cold.
  clearProxmoxNodeRosterCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  // The silent-node harness fakes Date: put the real one back.
  jest.useRealTimers();
});

describe("Proxmox VE native OTLP push — ingest (issue #4101)", () => {
  test("the cluster is discovered from PVE's own proxmox.cluster, without a hand-set attribute", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.discoverProxmox).toHaveBeenCalledTimes(1);
    const attributes: JSONArray =
      spies.discoverProxmox.mock.calls[0]![0].attributes;
    expect(stringAttr(attributes, "proxmox.cluster.name")).toEqual(["homelab"]);
  });

  test("the batch is routed with no service.name, so it lands on the cluster instead of a phantom 'proxmox-ve' Service", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.resolveResource).toHaveBeenCalledTimes(1);
    const args: { attributes: JSONArray; proxmoxClusterId: ObjectID } =
      spies.resolveResource.mock.calls[0]![0];
    expect(stringAttr(args.attributes, "service.name")).toEqual([]);
    expect(args.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
  });

  test("stored rows carry the pve_* series the Proxmox pages and templates query, next to the originals", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush(), qemuPush(), storagePush()]),
    );

    const names: Set<string> = rowNames(spies.rows);
    for (const expected of [
      "pve_up",
      "pve_node_info",
      "pve_guest_info",
      "pve_storage_info",
      "pve_version_info",
      "pve_uptime_seconds",
      "pve_cpu_usage_ratio",
      "pve_cpu_usage_limit",
      "pve_memory_usage_bytes",
      "pve_memory_size_bytes",
      "pve_disk_usage_bytes",
      "pve_disk_size_bytes",
      // The originals are still there for Metrics Explorer.
      "proxmox_node_cpustat_cpu",
      "proxmox_vm_cpu",
      "proxmox_storage_used",
    ]) {
      expect(names).toContain(expected);
    }

    const vmCpu: JSONObject | undefined = spies.rows.find((r: JSONObject) => {
      return (
        r["name"] === "pve_cpu_usage_ratio" &&
        (r["attributes"] as JSONObject)["id"] === "qemu/100"
      );
    });
    expect(vmCpu).toBeDefined();
    expect(vmCpu!["attributes"]).toMatchObject({
      id: "qemu/100",
      "pve.scope": "guest",
      "pve.type": "qemu",
      "pve.id": "100",
    });
  });

  test("every node, guest and storage becomes an inventory row with the agent's identity", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush(), qemuPush(), storagePush()]),
    );

    expect(upserted(spies)).toEqual([
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
        lastSeenAt: OBSERVED_AT,
      },
      {
        kind: "Guest",
        externalId: "qemu/100",
        name: "web",
        vmid: 100,
        guestType: "qemu",
        parentNodeName: "pve1",
        isUp: true,
        haState: null,
        onboot: null,
        isBackedUp: null,
        uptimeSeconds: 3600,
        lastSeenAt: OBSERVED_AT,
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
        lastSeenAt: OBSERVED_AT,
      },
    ]);

    const metrics: Array<ProxmoxResourceLatestMetric> =
      spies.bulkUpdateLatestMetrics.mock.calls[0]![0].metrics;
    const node: ProxmoxResourceLatestMetric | undefined = metrics.find(
      (m: ProxmoxResourceLatestMetric) => {
        return m.externalId === "node/pve1";
      },
    );
    expect(node).toEqual({
      kind: "Node",
      externalId: "node/pve1",
      cpuPercent: 25,
      memoryBytes: 16 * GIB,
      maxMemoryBytes: 64 * GIB,
      memoryPercent: 25,
      diskBytes: 40 * GIB,
      maxDiskBytes: 100 * GIB,
      observedAt: OBSERVED_AT,
    });
  });

  test("cluster counts come from the inventory, not from one node's push", async () => {
    const spies: Spies = setupIngestMocks({
      inventory: {
        countsByKind: { Node: 3, Guest: 14, Storage: 6 },
        nodeOnlineCount: 3,
        guestRunningCount: 11,
      },
    });

    // A guest-only push from one node of a three-node cluster.
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([qemuPush()]),
    );

    expect(spies.getInventorySummary).toHaveBeenCalledTimes(1);
    expect(
      spies.getInventorySummary.mock.calls[0]![0].proxmoxClusterId.toString(),
    ).toBe(CLUSTER_ID.toString());
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      nodeCount: 3,
      onlineNodeCount: 3,
      guestCount: 14,
      storageCount: 6,
    });
  });

  test("the node push also records the PVE version", async () => {
    const spies: Spies = setupIngestMocks({
      inventory: {
        countsByKind: { Node: 1 },
        nodeOnlineCount: 1,
        guestRunningCount: 0,
      },
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      pveVersion: "9.0.10",
      nodeCount: 1,
      onlineNodeCount: 1,
    });
  });

  test("an inventory write failure is swallowed and never fails the batch", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.getInventorySummary.mockRejectedValue(new Error("pg down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(request([qemuPush()])),
    ).resolves.toBeUndefined();
    expect(rowNames(spies.rows)).toContain("pve_up");
  });

  test("with no cluster discovered, the series are still translated and stored", async () => {
    const spies: Spies = setupIngestMocks({ clusterId: null });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([qemuPush()]),
    );

    expect(rowNames(spies.rows)).toContain("pve_cpu_usage_ratio");
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.getInventorySummary).not.toHaveBeenCalled();
    expect(spies.adoptNodesAsNativePush).not.toHaveBeenCalled();
  });
});

/*
 * A native-push node that dies goes quiet: nothing ever said pve_up = 0
 * for it, so Node Offline and Cluster Quorum at Risk could not fire. The
 * live nodes now speak for it. These drive whole push rounds through the
 * real ingest — liveness, roster, decision, report, fold and flush —
 * with only Redis, Postgres and the clock faked. Pins:
 *
 *   - once one node of the cluster has pushed continuously for 2
 *     minutes, and is still pushing (its last push at most a minute
 *     old), every live node's own status push — one still warming up
 *     included — carries pve_up = 0 and a pve_node_info weighted
 *     1 ÷ L for each silent sibling, with the sibling's own labels, at
 *     the reporter's own timestamp — L being every node of the cluster
 *     not reported (presumed live until it is), so the first node back
 *     after a gap never carries its siblings' share,
 *   - Sum/Sum over those rows is exactly L ÷ (L + D) on every minute,
 *     however unevenly the pushes fall into it,
 *   - reports never refresh the silent node's inventory row; the flush
 *     marks it Offline instead (after the upsert, before the recount),
 *     at most once per 30 s per node set, and every live node's own row
 *     is upserted as a native-push row (isNativePush: true),
 *   - nothing is reported by a guest or storage push, by a standalone
 *     host, when Redis or the roster fails, or when the feature is
 *     switched off,
 *   - no node is reported for the FIRST time before a node of the
 *     cluster has pushed continuously for 2 minutes (after an ingest
 *     outage too, even one a little shorter than the silence window) —
 *     but a node already Offline in the inventory, and marked within the
 *     last monitor window (5 minutes, as of the moment the roster was
 *     read: its row's notReportingMarkedAt), keeps being reported by
 *     every live node meanwhile (after an outage, a processing gap, a
 *     Redis failover that lost every key, or a lone survivor's own gaps
 *     and bursts), so its minutes never read 100 % up and Node Offline /
 *     Quorum at Risk do not resolve only to page again. Every push one
 *     cached roster serves decides alike, so the reports never drop out
 *     and come back at the window's edge. Those reports keep their own
 *     mark fresh (the fenced mark rewrites it once it is over a minute
 *     old, stamped with the worker's clock at the flush — the clock its
 *     age is judged by — whatever PVE's or Postgres's clock says), and
 *     the mark is in Postgres, so the reports carry on for as long as the
 *     gap lasts. Only after the whole cluster has been silent for longer
 *     than that does the mark age out: then nothing is reported until a
 *     node is established again — so a node that came back during the
 *     outage is never reported before its own push is processed. Nothing
 *     but the mark counts: not an Offline row's updatedAt, however fresh
 *     an upsert, a latest-metrics update or Postgres's clock leaves it,
 *     and not taking a node the agent left Offline into the native keep,
 *   - a push makes no Redis call beyond its own liveness GET and SET,
 *     one read of its siblings' liveness, and the two fences,
 *   - a node that pushes again stops being reported at once.
 */
describe("Proxmox VE native push — nodes that stop reporting are reported by their live siblings", () => {
  const DETECTION_ENV: string = "PVE_NATIVE_NODE_SILENCE_DETECTION";
  const originalDetectionEnv: string | undefined = process.env[DETECTION_ENV];

  afterEach(() => {
    if (originalDetectionEnv === undefined) {
      delete process.env[DETECTION_ENV];
    } else {
      process.env[DETECTION_ENV] = originalDetectionEnv;
    }
  });

  describe("the report", () => {
    test("a live node's own push reports a silent sibling as down, with the labels the sibling's own push would carry", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      // Both nodes are reporters from here on: L = 2, D = 1.
      const round: number = FIRST_REPORTING_ROUND + 1;
      const rows: Array<JSONObject> = (
        await nodeRound(harness, round, ["pve1", "pve2"])
      ).get("pve1")!;

      const ownUp: Array<JSONObject> = rowsOf(rows, "pve_up", "node/pve1");
      expect(valuesOf(ownUp)).toEqual([1]);
      expect(attributesOf(ownUp[0]!)[INFERRED_ATTRIBUTE]).toBeUndefined();

      const reportedIdentity: JSONObject = {
        id: "node/pve3",
        "pve.scope": "node",
        "pve.type": "node",
        "pve.id": "pve3",
        [INFERRED_ATTRIBUTE]: INFERRED_NOT_REPORTING,
        "resource.proxmox.cluster.name": "homelab",
        "scope.name": SIBLING_REPORT_SCOPE,
      };

      const up: Array<JSONObject> = rowsOf(rows, "pve_up", "node/pve3");
      expect(valuesOf(up)).toEqual([0]);
      expect(attributesOf(up[0]!)).toMatchObject(reportedIdentity);
      // pve_up carries no name label, exactly like the node's own pve_up.
      expect(attributesOf(up[0]!)["name"]).toBeUndefined();

      const info: Array<JSONObject> = rowsOf(
        rows,
        "pve_node_info",
        "node/pve3",
      );
      // D ÷ L = 1 ÷ 2 per report.
      expect(valuesOf(info)).toEqual([0.5]);
      expect(attributesOf(info[0]!)).toMatchObject({
        ...reportedIdentity,
        name: "pve3",
      });

      // At pve1's own timestamp, routed like pve1's own rows.
      for (const row of [...up, ...info]) {
        expect(row["timeUnixNano"]).toBe(nanosAt(pushTimeMs(round)));
        expect(row["timeUnixNano"]).toBe(ownUp[0]!["timeUnixNano"]);
        expect(row["time"]).toBe(ownUp[0]!["time"]);
        expect(row["metricPointType"]).toBe(ownUp[0]!["metricPointType"]);
        expect(row["primaryEntityId"]).toBe(CLUSTER_ID.toString());
      }

      // Nothing about pve3 is invented beyond the up/info pair.
      expect(
        rows
          .filter((row: JSONObject) => {
            return attributesOf(row)["id"] === "node/pve3";
          })
          .map((row: JSONObject) => {
            return row["name"];
          })
          .sort(),
      ).toEqual(["pve_node_info", "pve_up"]);
      expect(reportedIds(rows)).toEqual(["node/pve3"]);
    });

    test("the rest of the reporter's own push is exactly what it would be without the report", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });
      const round: number = FIRST_REPORTING_ROUND + 1;
      const rows: Array<JSONObject> = (
        await nodeRound(harness, round, ["pve1", "pve2"])
      ).get("pve1")!;

      // The same push again, with the feature off, as the reference.
      process.env[DETECTION_ENV] = "false";
      const reference: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(round) + 5_000,
        [nodePush("pve1", nanosAt(pushTimeMs(round)))],
      );
      expect(inferredRows(reference)).toEqual([]);

      const ownRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
        return attributesOf(row)[INFERRED_ATTRIBUTE] === undefined;
      });
      expect(rowSignature(ownRows)).toEqual(rowSignature(reference));
      expect(rows).toHaveLength(reference.length + 2);
    });

    test("once one node has pushed for 2 minutes, every live node reports — one still warming up too — each carrying D ÷ (live nodes)", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve1 pushes from round 0; pve2 joins a minute later.
      const joined: number = FIRST_REPORTING_ROUND / 2;
      const warmUp: Array<JSONObject> = [
        ...(await nodeRounds(harness, {
          from: 0,
          to: joined - 1,
          nodes: ["pve1"],
        })),
        ...(await nodeRounds(harness, {
          from: joined,
          to: FIRST_REPORTING_ROUND - 1,
          nodes: ["pve1", "pve2"],
        })),
      ];
      // Nobody is established yet, so nobody reports.
      expect(inferredRows(warmUp)).toEqual([]);

      const rowsByNode: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        FIRST_REPORTING_ROUND,
        ["pve1", "pve2"],
      );

      // pve2 has pushed for only a minute: it is still warming up…
      const pve2StreakStartMs: number = Number(
        livenessEntry(harness.redis, "pve2")!.value.split(",")[0],
      );
      expect(pve2StreakStartMs).toBe(pushTimeMs(joined) + 2 * RECEIVE_STEP_MS);
      expect(
        pushTimeMs(FIRST_REPORTING_ROUND) - pve2StreakStartMs,
      ).toBeLessThan(PROXMOX_NODE_SILENCE_MS);

      /*
       * …yet, with pve1 established, both report, and both count the
       * two live nodes: D ÷ L = 1 ÷ 2 each.
       */
      for (const node of ["pve1", "pve2"]) {
        const rows: Array<JSONObject> = rowsByNode.get(node)!;
        expect(reportedIds(rows)).toEqual(["node/pve3"]);
        expect(valuesOf(rowsOf(rows, "pve_up", "node/pve3"))).toEqual([0]);
        expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
          0.5,
        ]);
      }

      // Every round of pve2's warm-up adds exactly D = 1 to the denominator.
      const rest: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 1,
        to: joined + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      for (
        let round: number = FIRST_REPORTING_ROUND + 1;
        round < joined + FIRST_REPORTING_ROUND;
        round++
      ) {
        const roundRows: Array<JSONObject> = rest.filter((row: JSONObject) => {
          return rowTimeMs(row) === pushTimeMs(round);
        });
        expect(
          valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")),
        ).toEqual([0.5, 0.5]);
      }
    });

    test("Quorum at Risk (Sum/Sum) is exactly L ÷ (L + D): two live nodes, one silent", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      // A minute of steady rounds.
      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 1,
        to: FIRST_REPORTING_ROUND + 6,
        nodes: ["pve1", "pve2"],
      });

      expect(quorumPercent(rows)).toBeCloseTo(200 / 3, 10);
      // Every round adds exactly D = 1 to the denominator.
      for (let round: number = 1; round <= 6; round++) {
        const roundRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
          return rowTimeMs(row) === pushTimeMs(FIRST_REPORTING_ROUND + round);
        });
        expect(
          valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")).reduce(
            (sum: number, value: number) => {
              return sum + value;
            },
            0,
          ),
        ).toBe(1);
      }
    });

    test("Quorum at Risk (Sum/Sum) is exactly 50% when as many nodes are silent as alive, so the <= 50% check fires", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: { pve3: PVE3_LAST_SEEN_MS, pve4: PVE3_LAST_SEEN_MS },
      });
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 1,
        to: FIRST_REPORTING_ROUND + 6,
        nodes: ["pve1", "pve2"],
      });

      expect(reportedIds(rows)).toEqual(["node/pve3", "node/pve4"]);
      // L = D = 2: each report splits D ÷ L = 1 over the two silent nodes.
      expect(
        valuesOf(rowsOf(rows, "pve_node_info", "node/pve3")).every(
          (value: number) => {
            return value === 0.5;
          },
        ),
      ).toBe(true);
      expect(quorumPercent(rows)).toBe(50);
    });

    test("Node Offline sees the silent node down on every minute of its 5-minute window", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND,
        to: FIRST_REPORTING_ROUND + 29,
        nodes: ["pve1", "pve2"],
      });

      const minuteOf: (row: JSONObject) => number = (
        row: JSONObject,
      ): number => {
        return Math.floor(rowTimeMs(row) / 60_000);
      };
      const reported: Array<JSONObject> = rowsOf(rows, "pve_up", "node/pve3");
      // Min per id is 0 on every minute bucket the live nodes wrote.
      expect(new Set(valuesOf(reported))).toEqual(new Set([0]));
      expect(new Set(reported.map(minuteOf))).toEqual(
        new Set(rowsOf(rows, "pve_up", "node/pve1").map(minuteOf)),
      );
      // The live nodes themselves are never reported down.
      expect(
        valuesOf([
          ...rowsOf(rows, "pve_up", "node/pve1"),
          ...rowsOf(rows, "pve_up", "node/pve2"),
        ]).every((value: number) => {
          return value === 1;
        }),
      ).toBe(true);
      expect(reportedIds(rows)).toEqual(["node/pve3"]);
    });

    test("only the node-status block of a batch carries the report, once", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      const at: number = pushTimeMs(FIRST_REPORTING_ROUND + 1);
      const rows: Array<JSONObject> = await ingestAt(
        harness,
        at + RECEIVE_STEP_MS,
        [
          qemuPush("pve1", nanosAt(at)),
          nodePush("pve1", nanosAt(at)),
          storagePush("pve1", nanosAt(at)),
        ],
      );

      expect(valuesOf(rowsOf(rows, "pve_up", "node/pve3"))).toEqual([0]);
      expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
        0.5,
      ]);
      expect(
        inferredRows(rows).every((row: JSONObject) => {
          return attributesOf(row)["resource.proxmox.node"] === "pve1";
        }),
      ).toBe(true);
      // The guest and storage still land as usual.
      expect(valuesOf(rowsOf(rows, "pve_up", "qemu/100"))).toEqual([1]);
      expect(valuesOf(rowsOf(rows, "pve_up", "storage/pve1/local"))).toEqual([
        1,
      ]);
    });

    test("the roster is read once per 30 s per cluster, from the very first push on, not on every push", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      /*
       * Six pushes within ~20 s, before anyone may report: a node warming
       * up still needs its siblings to know whether one is established —
       * one roster read, on the very first push.
       */
      await nodeRounds(harness, {
        from: 0,
        to: 2,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.getNodeRoster).toHaveBeenCalledTimes(1);
      expect(harness.rosterReadsAtMs).toEqual([T0_MS + RECEIVE_STEP_MS]);
      const args: { projectId: ObjectID; proxmoxClusterId: ObjectID } =
        harness.getNodeRoster.mock.calls[0]![0];
      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(args.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());

      // Through the first reports and beyond: every 30 s, never more often.
      await nodeRounds(harness, {
        from: 3,
        to: FIRST_REPORTING_ROUND + 5,
        nodes: ["pve1", "pve2"],
      });
      const reads: Array<number> = harness.rosterReadsAtMs;
      // 36 pushes over 170 s: six reads.
      expect(reads).toHaveLength(6);
      for (let i: number = 1; i < reads.length; i++) {
        const gapMs: number = reads[i]! - reads[i - 1]!;
        expect(gapMs).toBeGreaterThanOrEqual(30_000);
        expect(gapMs).toBeLessThan(30_000 + PUSH_INTERVAL_MS);
      }
    });
  });

  describe("the inventory", () => {
    test("reports are never folded into the inventory: the silent node's row is never upserted", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 8,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(rows)).toEqual(["node/pve3"]);

      const upsertedIds: Set<string> = new Set(
        allUpsertedResources(harness).map((r: ParsedProxmoxResource) => {
          return r.externalId;
        }),
      );
      expect(upsertedIds).toEqual(new Set(["node/pve1", "node/pve2"]));
      /*
       * Each one a native-push row: the prune keeps such a Node row for
       * the retention window, so pve1 or pve2 stays on the roster should
       * it go quiet in turn.
       */
      expect(isNativePushValues(harness.spies.bulkUpsert)).toEqual(
        new Set([true]),
      );

      for (const call of harness.spies.bulkUpdateLatestMetrics.mock
        .calls as Array<Array<unknown>>) {
        const metrics: Array<ProxmoxResourceLatestMetric> = (
          call[0] as { metrics: Array<ProxmoxResourceLatestMetric> }
        ).metrics;
        expect(
          metrics.map((m: ProxmoxResourceLatestMetric) => {
            return m.externalId;
          }),
        ).not.toContain("node/pve3");
      }

      // pve3's "last seen" is still its own last push.
      expect(harness.inventory.get("pve3")!.lastSeenAt).toEqual(
        new Date(PVE3_LAST_SEEN_MS),
      );
    });

    test("the flush marks the reported node Offline, after the upsert and before the recount", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();

      const flushAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      await ingestAt(harness, flushAtMs, [
        nodePush("pve1", nanosAt(pushTimeMs(FIRST_REPORTING_ROUND))),
      ]);

      expect(harness.marks).toHaveLength(1);
      const mark: OfflineMark = harness.marks[0]!;
      expect(mark.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(mark.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
      expect(mark.nodeNames).toEqual(["pve3"]);
      // pve1's own push time minus the 2-minute silence window.
      expect(mark.silentBefore).toEqual(
        new Date(pushTimeMs(FIRST_REPORTING_ROUND) - PROXMOX_NODE_SILENCE_MS),
      );
      /*
       * Stamped with the ingest worker's clock at the flush, passed in
       * explicitly: the clock the mark's age is later judged against.
       */
      const args: Record<string, unknown> =
        harness.markNodesNotReporting.mock.calls[0]![0];
      expect(Object.keys(args).sort()).toEqual([
        "markedAt",
        "nodeNames",
        "projectId",
        "proxmoxClusterId",
        "silentBefore",
      ]);
      expect(args["markedAt"]).toBeInstanceOf(Date);
      expect(mark.markedAtMs).toBe(flushAtMs);
      expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
        new Date(flushAtMs),
      );

      const lastOrder: (spy: jest.SpyInstance) => number = (
        spy: jest.SpyInstance,
      ): number => {
        const order: Array<number> = spy.mock.invocationCallOrder;
        return order[order.length - 1]!;
      };
      const markOrder: number = lastOrder(harness.markNodesNotReporting);
      expect(lastOrder(harness.spies.bulkUpsert)).toBeLessThan(markOrder);
      expect(lastOrder(harness.spies.bulkUpdateLatestMetrics)).toBeLessThan(
        markOrder,
      );
      expect(markOrder).toBeLessThan(
        lastOrder(harness.spies.getInventorySummary),
      );
      expect(harness.spies.updateLastSeen).toHaveBeenCalled();
    });

    test("the Offline mark is stamped with the ingest worker's clock at the flush — not PVE's, not Postgres's — so however far those run off, it carries the reports through a gap and ages out over an outage", async () => {
      // PVE's clocks run 7 minutes behind OneUptime's, Postgres's 10 ahead.
      const pveBehindMs: number = 7 * 60_000;
      const postgresAheadMs: number = 10 * 60_000;
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: { pve3: PVE3_LAST_SEEN_MS - pveBehindMs },
        postgresClockAheadMs: postgresAheadMs,
      });
      // One round: each node's push, stamped by its own (PVE) clock.
      const pveRound: (
        round: number,
        nodes: Array<string>,
      ) => Promise<Map<string, Array<JSONObject>>> = async (
        round: number,
        nodes: Array<string>,
      ): Promise<Map<string, Array<JSONObject>>> => {
        const rowsByNode: Map<string, Array<JSONObject>> = new Map();
        for (const [index, node] of nodes.entries()) {
          rowsByNode.set(
            node,
            await ingestAt(
              harness,
              pushTimeMs(round) + RECEIVE_STEP_MS * (index + 1),
              [nodePush(node, nanosAt(pushTimeMs(round) - pveBehindMs))],
            ),
          );
        }
        return rowsByNode;
      };

      for (let round: number = 0; round <= FIRST_REPORTING_ROUND; round++) {
        await pveRound(round, ["pve1", "pve2"]);
      }
      /*
       * The first report marks pve3: silent since a time on the PVE
       * clock, its notReportingMarkedAt stamped with the worker's clock at
       * the flush — while every updatedAt, the mark's own write's included,
       * is stamped by Postgres.
       */
      const markedAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      expect(harness.marks).toMatchObject([
        {
          atMs: markedAtMs,
          markedAtMs,
          nodeNames: ["pve3"],
          written: ["pve3"],
        },
      ]);
      expect(harness.marks[0]!.silentBefore).toEqual(
        new Date(
          pushTimeMs(FIRST_REPORTING_ROUND) -
            pveBehindMs -
            PROXMOX_NODE_SILENCE_MS,
        ),
      );
      expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
        new Date(markedAtMs),
      );
      expect(harness.inventory.get("pve3")!.updatedAt).toEqual(
        new Date(markedAtMs + postgresAheadMs),
      );
      expect(harness.inventory.get("pve1")!.updatedAt).toEqual(
        new Date(markedAtMs + postgresAheadMs),
      );
      // The live nodes' own rows carry no mark.
      expect(harness.inventory.get("pve1")!.notReportingMarkedAt).toBeNull();

      /*
       * OneUptime processes nothing for 100 s: every streak breaks. The
       * mark, 100 s old on the worker's clock, carries pve3's reports on
       * from the first push back — and that push rewrites it, again on
       * the worker's clock.
       */
      const resume: number = FIRST_REPORTING_ROUND + 10;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      const resumed: Map<string, Array<JSONObject>> = await pveRound(resume, [
        "pve1",
        "pve2",
      ]);
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${resumeAtMs},${resumeAtMs}`,
      );
      for (const node of ["pve1", "pve2"]) {
        expect(reportedIds(resumed.get(node)!)).toEqual(["node/pve3"]);
      }
      expect(markRewritesAtMs(harness, "pve3")).toEqual([
        markedAtMs,
        resumeAtMs,
      ]);
      expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
        new Date(resumeAtMs),
      );

      /*
       * Then nothing is processed for over 6 minutes, and pve3 comes back
       * meanwhile. On the worker's clock its mark has aged out, so the
       * first two pushes back — processed before pve3's own — do not
       * report it, though its row's updatedAt, on Postgres's clock, still
       * lies in the future.
       */
      const outageEnd: number = resume + 37;
      harness.clock.nowMs = pushTimeMs(outageEnd) + RECEIVE_STEP_MS;
      expect(markAgeMs(harness, "pve3")).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      expect(
        harness.inventory.get("pve3")!.updatedAt!.getTime(),
      ).toBeGreaterThan(harness.clock.nowMs);
      const marksBefore: number = harness.marks.length;
      const after: Array<JSONObject> = [];
      for (
        let round: number = outageEnd;
        round <= outageEnd + FIRST_REPORTING_ROUND + 1;
        round++
      ) {
        for (const nodeRows of (
          await pveRound(round, ["pve1", "pve2", "pve3"])
        ).values()) {
          after.push(...nodeRows);
        }
      }
      expect(inferredRows(after)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);
      expect(harness.inventory.get("pve3")!.isUp).toBe(true);
      // Its own push cleared the mark.
      expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toBeNull();

      // Every mark of the test: the worker's clock at its own flush.
      for (const mark of harness.marks) {
        expect(mark.markedAtMs).toBe(mark.atMs);
      }
    });

    test("the Offline mark is fenced to once per 30 s per cluster and node set", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      // pve1 and pve2 both reported on this round; one write.
      expect(harness.marks).toHaveLength(1);
      expect(harness.marks[0]!.atMs).toBe(
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
      );

      const fenceCalls: Array<Array<unknown>> = (
        harness.redis.setStringIfNotExists.mock.calls as Array<Array<unknown>>
      ).filter((call: Array<unknown>) => {
        return call[0] === MARK_FENCE_NAMESPACE;
      });
      expect(fenceCalls).toHaveLength(2);
      expect(String(fenceCalls[0]![1])).toMatch(
        new RegExp(`^${CLUSTER_ID.toString()}:`),
      );
      expect(fenceCalls[0]![1]).toBe(fenceCalls[1]![1]);
      expect(fenceCalls[0]![3]).toEqual({ expiresInSeconds: 30 });

      // Pushes within the next 30 s write nothing more.
      await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 1,
        to: FIRST_REPORTING_ROUND + 2,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.marks).toHaveLength(1);

      // Five minutes of reports: a write every 30 s, never more often.
      await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 3,
        to: FIRST_REPORTING_ROUND + 29,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.marks).toHaveLength(10);
      for (let i: number = 1; i < harness.marks.length; i++) {
        const gapMs: number =
          harness.marks[i]!.atMs - harness.marks[i - 1]!.atMs;
        expect(gapMs).toBeGreaterThanOrEqual(30_000);
        expect(gapMs).toBeLessThan(30_000 + PUSH_INTERVAL_MS);
      }
      expect(
        markedNodeSets(harness).every((nodeNames: Array<string>) => {
          return nodeNames.join(",") === "pve3";
        }),
      ).toBe(true);
      /*
       * Every write carries its own report's time, and is stamped with the
       * worker's clock at its own flush.
       */
      for (const mark of harness.marks) {
        expect(mark.silentBefore.getTime()).toBe(
          mark.atMs - RECEIVE_STEP_MS - PROXMOX_NODE_SILENCE_MS,
        );
        expect(mark.markedAtMs).toBe(mark.atMs);
      }
    });

    test("a node that newly goes silent is marked at once, not after the fence of the previous set", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve4 pushes until the first reporting round, then dies.
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2", "pve4"],
      });

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND + 1,
        to: FIRST_REPORTING_ROUND + 13,
        nodes: ["pve1", "pve2"],
      });
      // Not before its own 2-minute silence window has passed.
      const firstPve4Report: number = Math.min(
        ...rowsOf(rows, "pve_up", "node/pve4").map(rowTimeMs),
      );
      expect(firstPve4Report).toBe(pushTimeMs(FIRST_REPORTING_ROUND + 13));

      const last: OfflineMark = harness.marks[harness.marks.length - 1]!;
      const previous: OfflineMark = harness.marks[harness.marks.length - 2]!;
      expect(last.nodeNames).toEqual(["pve3", "pve4"]);
      expect(last.atMs).toBe(firstPve4Report + RECEIVE_STEP_MS);
      // The {pve3} fence was still holding.
      expect(previous.nodeNames).toEqual(["pve3"]);
      expect(last.atMs - previous.atMs).toBeLessThan(30_000);
    });

    test("reports of several nodes in one batch mark once, from the earliest report", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });

      // One request carrying both nodes' pushes; pve2's clock is 3 s behind.
      const pve1Ms: number = pushTimeMs(FIRST_REPORTING_ROUND + 1);
      const pve2Ms: number = pve1Ms - 3_000;
      const rows: Array<JSONObject> = await ingestAt(harness, pve1Ms + 600, [
        nodePush("pve1", nanosAt(pve1Ms)),
        nodePush("pve2", nanosAt(pve2Ms)),
      ]);

      // Each reporter's report sits at its own push time.
      expect(rowsOf(rows, "pve_up", "node/pve3").map(rowTimeMs).sort()).toEqual(
        [pve2Ms, pve1Ms],
      );
      expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
        0.5, 0.5,
      ]);

      expect(harness.marks).toHaveLength(1);
      expect(harness.marks[0]!.nodeNames).toEqual(["pve3"]);
      expect(harness.marks[0]!.silentBefore).toEqual(
        new Date(pve2Ms - PROXMOX_NODE_SILENCE_MS),
      );
    });

    test("an Offline-mark failure is swallowed: the reports are stored and the counts still recounted", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      harness.markNodesNotReporting.mockRejectedValue(new Error("pg down"));
      const recountsBefore: number =
        harness.spies.getInventorySummary.mock.calls.length;

      let rows: Array<JSONObject> = [];
      await expect(
        (async (): Promise<void> => {
          rows = await ingestAt(
            harness,
            pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
            [nodePush("pve1", nanosAt(pushTimeMs(FIRST_REPORTING_ROUND)))],
          );
        })(),
      ).resolves.toBeUndefined();

      expect(harness.markNodesNotReporting).toHaveBeenCalledTimes(1);
      expect(reportedIds(rows)).toEqual(["node/pve3"]);
      expect(harness.spies.getInventorySummary.mock.calls.length).toBe(
        recountsBefore + 1,
      );
    });

    test("a fence failure skips the Offline mark but not the report or the recount", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      harness.redis.failing.add("setStringIfNotExists");
      const recountsBefore: number =
        harness.spies.getInventorySummary.mock.calls.length;

      const rows: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
        [nodePush("pve1", nanosAt(pushTimeMs(FIRST_REPORTING_ROUND)))],
      );

      expect(reportedIds(rows)).toEqual(["node/pve3"]);
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
      expect(harness.spies.getInventorySummary.mock.calls.length).toBe(
        recountsBefore + 1,
      );
    });

    test("a node still warming up marks the silent node Offline like any reporter: fenced with the others, after the upsert and before the recount", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve1 pushes from round 0; pve2 joins a minute later.
      const joined: number = FIRST_REPORTING_ROUND / 2;
      await nodeRounds(harness, {
        from: 0,
        to: joined - 1,
        nodes: ["pve1"],
      });
      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: joined,
        to: FIRST_REPORTING_ROUND + 2,
        nodes: ["pve1", "pve2"],
      });

      // Both report on each of these three rounds…
      expect(rowsOf(rows, "pve_up", "node/pve3")).toHaveLength(6);
      // …but only the first report wrote; the rest were fenced.
      expect(harness.marks).toHaveLength(1);
      expect(harness.marks[0]!.atMs).toBe(
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
      );

      /*
       * pve1 misses one push (20 s apart: its streak survives) just as
       * the 30 s fence runs out, so the first report after it is pve2's —
       * still warming up.
       */
      const round: number = FIRST_REPORTING_ROUND + 3;
      const receivedAtMs: number = pushTimeMs(round) + 2 * RECEIVE_STEP_MS;
      const pve2Rows: Array<JSONObject> = await ingestAt(
        harness,
        receivedAtMs,
        [nodePush("pve2", nanosAt(pushTimeMs(round)))],
      );
      const pve2StreakStartMs: number = Number(
        livenessEntry(harness.redis, "pve2")!.value.split(",")[0],
      );
      expect(receivedAtMs - pve2StreakStartMs).toBeLessThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(reportedIds(pve2Rows)).toEqual(["node/pve3"]);

      expect(harness.marks).toHaveLength(2);
      const mark: OfflineMark = harness.marks[1]!;
      expect(mark.atMs).toBe(receivedAtMs);
      expect(mark.nodeNames).toEqual(["pve3"]);
      expect(mark.silentBefore).toEqual(
        new Date(pushTimeMs(round) - PROXMOX_NODE_SILENCE_MS),
      );

      const lastOrder: (spy: jest.SpyInstance) => number = (
        spy: jest.SpyInstance,
      ): number => {
        const order: Array<number> = spy.mock.invocationCallOrder;
        return order[order.length - 1]!;
      };
      const markOrder: number = lastOrder(harness.markNodesNotReporting);
      expect(lastOrder(harness.spies.bulkUpsert)).toBeLessThan(markOrder);
      expect(markOrder).toBeLessThan(
        lastOrder(harness.spies.getInventorySummary),
      );

      // From there on, still one write per 30 s, whoever reports first.
      await nodeRounds(harness, {
        from: round + 1,
        to: round + 9,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.marks.length).toBeGreaterThan(2);
      for (let i: number = 1; i < harness.marks.length; i++) {
        expect(
          harness.marks[i]!.atMs - harness.marks[i - 1]!.atMs,
        ).toBeGreaterThanOrEqual(30_000);
      }
    });
  });

  describe("who may report", () => {
    test("guest and storage pushes neither record liveness nor report", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      // pve1 is a reporter by now.
      const livenessBefore: number = livenessCalls(harness.redis);
      const rosterReadsBefore: number = harness.getNodeRoster.mock.calls.length;
      const marksBefore: number = harness.marks.length;
      const pve1Liveness: FakeRedisEntry | undefined = livenessEntry(
        harness.redis,
        "pve1",
      );
      expect(pve1Liveness).toBeDefined();
      const pve1LivenessValue: string = pve1Liveness!.value;

      const at: number = pushTimeMs(FIRST_REPORTING_ROUND + 2);
      const rows: Array<JSONObject> = [
        ...(await ingestAt(harness, at + 100, [qemuPush("pve1", nanosAt(at))])),
        ...(await ingestAt(harness, at + 200, [
          storagePush("pve1", nanosAt(at)),
        ])),
        ...(await ingestAt(harness, at + 300, [
          qemuPush("pve2", nanosAt(at)),
          storagePush("pve2", nanosAt(at)),
        ])),
      ];

      expect(rowNames(rows)).toContain("pve_up");
      expect(inferredRows(rows)).toEqual([]);
      expect(livenessCalls(harness.redis)).toBe(livenessBefore);
      expect(harness.getNodeRoster.mock.calls.length).toBe(rosterReadsBefore);
      expect(harness.marks).toHaveLength(marksBefore);
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        pve1LivenessValue,
      );
    });

    test("a node that only sends guest and storage pushes never becomes a reporter", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();

      const rows: Array<JSONObject> = [];
      for (let round: number = 0; round <= FIRST_REPORTING_ROUND + 6; round++) {
        const at: number = pushTimeMs(round);
        rows.push(
          ...(await ingestAt(harness, at + RECEIVE_STEP_MS, [
            qemuPush("pve1", nanosAt(at)),
          ])),
          ...(await ingestAt(harness, at + 2 * RECEIVE_STEP_MS, [
            storagePush("pve1", nanosAt(at)),
          ])),
        );
      }

      expect(inferredRows(rows)).toEqual([]);
      expect(livenessCalls(harness.redis)).toBe(0);
      expect(livenessEntry(harness.redis, "pve1")).toBeUndefined();
      expect(harness.getNodeRoster).not.toHaveBeenCalled();
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
    });

    test("nobody reports until a node has pushed continuously for 2 minutes, though every push already reads its siblings", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });

      expect(inferredRows(rows)).toEqual([]);
      // Liveness is recorded from the first push on…
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${T0_MS + RECEIVE_STEP_MS},${pushTimeMs(FIRST_REPORTING_ROUND - 1) + RECEIVE_STEP_MS}`,
      );
      /*
       * …and every push reads the (cached) roster and its siblings'
       * liveness — a node warming up reports as soon as ANOTHER node is
       * established, so it has to look — but none is established yet.
       */
      expect(harness.getNodeRoster).toHaveBeenCalled();
      expect(
        callsInNamespace(harness.redis.getStrings, LIVENESS_NAMESPACE),
      ).toBe(2 * FIRST_REPORTING_ROUND);
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();

      /*
       * Exactly 2 minutes in, pve1 is established and reports — pve3
       * only, with pve2 (pushed 10 s ago) counted live: D ÷ L = 1 ÷ 2.
       */
      const reportingRows: Array<JSONObject> = (
        await nodeRound(harness, FIRST_REPORTING_ROUND, ["pve1"])
      ).get("pve1")!;
      expect(reportedIds(reportingRows)).toEqual(["node/pve3"]);
      expect(
        valuesOf(rowsOf(reportingRows, "pve_node_info", "node/pve3")),
      ).toEqual([0.5]);
    });

    test("a push makes no Redis call beyond its own liveness GET and SET, one read of its siblings' liveness and the fences — before any node is established, once one is, and while the node already Offline is reported with none established", async () => {
      /*
       * A mark keeps those reports going while it is at most one monitor
       * window old when the roster is read; a worker reuses a read for
       * 30 s.
       */
      expect(PROXMOX_MONITOR_WINDOW_MS).toBe(5 * 60_000);
      expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBe(30_000);

      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const liveness: (method: string) => string = (method: string): string => {
        return `${method} ${LIVENESS_NAMESPACE}`;
      };
      const markFenceCall: string = `setStringIfNotExists ${MARK_FENCE_NAMESPACE}`;
      const adoptFenceCall: string = `setStringIfNotExists ${ADOPT_FENCE_NAMESPACE}`;

      // Every push, ingested on its own: whether it reported, and its calls.
      const pushes: Array<{ reported: boolean; calls: Array<string> }> = [];
      const round: (at: number) => Promise<void> = async (
        at: number,
      ): Promise<void> => {
        for (const [index, node] of ["pve1", "pve2"].entries()) {
          const callsBefore: number = cacheCalls(harness.redis).length;
          const rows: Array<JSONObject> = await ingestAt(
            harness,
            pushTimeMs(at) + RECEIVE_STEP_MS * (index + 1),
            [nodePush(node, nanosAt(pushTimeMs(at)))],
          );
          pushes.push({
            reported: inferredRows(rows).length > 0,
            calls: cacheCalls(harness.redis).slice(callsBefore).sort(),
          });
        }
      };

      // The warm-up, then three rounds with pve1 established.
      for (let at: number = 0; at <= FIRST_REPORTING_ROUND + 2; at++) {
        await round(at);
      }
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);

      /*
       * Then nothing is processed for 90 s: every streak is broken, and
       * for the next 2 minutes nobody is established — pve3, marked
       * 110 s before, is reported all the same.
       */
      const resume: number = FIRST_REPORTING_ROUND + 2 + 9;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      harness.clock.nowMs = resumeAtMs;
      expect(markAgeMs(harness, "pve3")).toBe(110_000);
      for (let at: number = resume; at <= resume + 3; at++) {
        await round(at);
      }
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${resumeAtMs},${pushTimeMs(resume + 3) + RECEIVE_STEP_MS}`,
      );
      // Those reports rewrote pve3's mark, on the first push back.
      expect(markRewritesAtMs(harness, "pve3")).toEqual([
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
        resumeAtMs,
      ]);

      expect(
        pushes.map((push: { reported: boolean }) => {
          return push.reported;
        }),
      ).toEqual([
        ...new Array<boolean>(2 * FIRST_REPORTING_ROUND).fill(false),
        ...new Array<boolean>(6).fill(true),
        ...new Array<boolean>(8).fill(true),
      ]);
      /*
       * Every push: its own liveness GET and SET, one MGET of its
       * siblings, the adoption fence — and the mark fence when it
       * reported. Nothing else, established or not.
       */
      for (const push of pushes) {
        expect(push.calls).toEqual(
          [
            liveness("getString"),
            liveness("setString"),
            liveness("getStrings"),
            adoptFenceCall,
            ...(push.reported ? [markFenceCall] : []),
          ].sort(),
        );
      }

      // Every SET is a liveness key, for the silence window.
      expect(
        new Set(
          harness.redis.writes.map((write: FakeRedisWrite) => {
            return `${write.namespace} ${String(write.options?.expiresInSeconds)}`;
          }),
        ),
      ).toEqual(
        new Set([
          `${LIVENESS_NAMESPACE} ${String(PROXMOX_NODE_SILENCE_MS / 1000)}`,
        ]),
      );
      // Redis holds nothing but liveness keys and the two fences.
      expect(
        Array.from(harness.redis.entries.keys()).filter((key: string) => {
          return ![LIVENESS_NAMESPACE, ...FENCE_NAMESPACES].some(
            (namespace: string) => {
              return key.startsWith(`${namespace}-`);
            },
          );
        }),
      ).toEqual([]);
      expect(harness.redis.deleteKey).not.toHaveBeenCalled();
      for (const spy of harness.redis.scripted) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    test("after an ingest outage the node already Offline is reported again from the first push back, while a live sibling that looks silent is never reported", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const before: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(before)).toEqual(["node/pve3"]);
      // The flush has marked pve3 Offline.
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      const siblingReadsBefore: number = callsInNamespace(
        harness.redis.getStrings,
        LIVENESS_NAMESPACE,
      );
      const marksBefore: number = harness.marks.length;

      // Marked once, by the first report; the fence held the second round.
      const markedAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      expect(markRewritesAtMs(harness, "pve3")).toEqual([markedAtMs]);

      /*
       * OneUptime processes nothing for 2 minutes 40 s: every key
       * expires, so no node is established until 2 minutes after the
       * resume. On the first round back, pve1 is processed before pve2,
       * so it sees pve2 as silent (no key, and an inventory sighting from
       * before the outage) — but pve2 is Online in the inventory, so only
       * an established node could report it for the first time. pve3,
       * Offline and marked 160 s before the resume — within the monitor
       * window — is reported all along.
       */
      const lastPushAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND + 1) + 2 * RECEIVE_STEP_MS;
      const resume: number = FIRST_REPORTING_ROUND + 2 + 14;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      harness.clock.nowMs = resumeAtMs;
      expect(resumeAtMs - lastPushAtMs).toBeGreaterThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(livenessEntry(harness.redis, "pve1")!.expiresAtMs).toBeLessThan(
        resumeAtMs,
      );
      expect(livenessEntry(harness.redis, "pve2")!.expiresAtMs).toBeLessThan(
        resumeAtMs,
      );
      expect(markAgeMs(harness, "pve3")).toBe(160_000);
      expect(markAgeMs(harness, "pve3")).toBeLessThanOrEqual(
        PROXMOX_MONITOR_WINDOW_MS,
      );

      const afterOutage: Array<JSONObject> = await nodeRounds(harness, {
        from: resume,
        to: resume + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      // The siblings are read on every push; nobody is established.
      expect(
        callsInNamespace(harness.redis.getStrings, LIVENESS_NAMESPACE),
      ).toBe(siblingReadsBefore + 2 * FIRST_REPORTING_ROUND);
      expect(livenessEntry(harness.redis, "pve1")!.value.split(",")[0]).toBe(
        String(resumeAtMs),
      );
      /*
       * Those reports keep pve3's mark fresh: rewritten on the first push
       * back, then — the fence letting a mark through every 30 s — once
       * it is over a minute old.
       */
      expect(
        markRewritesAtMs(harness, "pve3").filter((atMs: number) => {
          return atMs >= resumeAtMs;
        }),
      ).toEqual([resumeAtMs, resumeAtMs + MARK_REFRESH_MS + MARK_FENCE_MS]);
      expect(reportedIds(afterOutage)).toEqual(["node/pve3"]);
      /*
       * By both nodes, on every round of the warm-up — the very first
       * push back included — weighted exactly 1 ÷ L = 1 ÷ 2 each: pve2,
       * though pve1 found no key of it, is not reported, so it is
       * presumed live and counted. Every round adds exactly D = 1.
       */
      for (
        let round: number = resume;
        round < resume + FIRST_REPORTING_ROUND;
        round++
      ) {
        const roundRows: Array<JSONObject> = rowsAtRound(afterOutage, round);
        expect(valuesOf(rowsOf(roundRows, "pve_up", "node/pve3"))).toEqual([
          0, 0,
        ]);
        expect(
          valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")),
        ).toEqual([0.5, 0.5]);
      }
      /*
       * So even the first push back, alone in its minute, reads exactly
       * L ÷ (L + D) = 2 ÷ 3 — the first node back does not carry pve2's
       * share of pve3 (1 ÷ 1, which would read 50 % and fire Quorum at
       * Risk).
       */
      const firstPushBack: Array<JSONObject> = afterOutage.filter(
        (row: JSONObject) => {
          return (
            rowTimeMs(row) === pushTimeMs(resume) &&
            attributesOf(row)["resource.proxmox.node"] === "pve1"
          );
        },
      );
      expect(quorumPercent(firstPushBack)).toBeCloseTo(200 / 3, 10);
      expect(quorumPercent(afterOutage)).toBeCloseTo(200 / 3, 10);
      // Its mark is kept up (fenced as ever); pve2 is never marked.
      expect(markedSince(harness, marksBefore).length).toBeGreaterThan(0);
      expect(new Set(markedSince(harness, marksBefore))).toEqual(
        new Set(["pve3"]),
      );
      expect(harness.inventory.get("pve2")!.isUp).toBe(true);

      // Two minutes after the resume, only the node really gone is reported.
      const later: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + FIRST_REPORTING_ROUND,
        to: resume + FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(later)).toEqual(["node/pve3"]);
    });

    test("the node already Offline is reported through a whole warm-up that ends over a monitor window after its last mark before the outage: the reports keep their own mark fresh", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      const markedAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      expect(markRewritesAtMs(harness, "pve3")).toEqual([markedAtMs]);

      /*
       * OneUptime processes nothing for 3 minutes 20 s. pve3's mark is
       * 210 s old on the first push back — within the monitor window —
       * but the warm-up after the outage ends well over a window after
       * it. Every push reports pve3 all the same, each weighted 1 ÷ 2:
       * the first push back rewrites the mark, and so on once a minute.
       */
      const resume: number = FIRST_REPORTING_ROUND + 1 + 20;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      const establishedRound: number = resume + FIRST_REPORTING_ROUND;
      harness.clock.nowMs = resumeAtMs;
      expect(markAgeMs(harness, "pve3")).toBe(210_000);
      expect(pushTimeMs(establishedRound)).toBeGreaterThan(
        markedAtMs + PROXMOX_MONITOR_WINDOW_MS,
      );

      let reported: number = 0;
      for (let round: number = resume; round <= establishedRound + 1; round++) {
        const rowsByNode: Map<string, Array<JSONObject>> = await nodeRound(
          harness,
          round,
          ["pve1", "pve2"],
        );
        for (const node of ["pve1", "pve2"]) {
          const rows: Array<JSONObject> = rowsByNode.get(node)!;
          expect(reportedIds(rows)).toEqual(["node/pve3"]);
          expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
            0.5,
          ]);
          reported++;
        }
        // Its mark never ages past a minute and a half meanwhile.
        expect(markAgeMs(harness, "pve3")).toBeLessThanOrEqual(
          MARK_REFRESH_MS + MARK_FENCE_MS,
        );
        if (round < establishedRound) {
          // Nobody is established: pve1's streak began on the resume.
          expect(
            livenessEntry(harness.redis, "pve1")!.value.split(",")[0],
          ).toBe(String(resumeAtMs));
        }
      }
      expect(reported).toBe(2 * (FIRST_REPORTING_ROUND + 2));

      /*
       * Rewritten on the first push back, then once it was over a minute
       * old — at most once a minute, though a mark went through the
       * fence every 30 s.
       */
      expect(
        markRewritesAtMs(harness, "pve3").filter((atMs: number) => {
          return atMs >= resumeAtMs;
        }),
      ).toEqual([resumeAtMs, resumeAtMs + MARK_REFRESH_MS + MARK_FENCE_MS]);
      expect(
        harness.marks
          .filter((mark: OfflineMark) => {
            return mark.atMs >= resumeAtMs;
          })
          .map((mark: OfflineMark) => {
            return mark.atMs - resumeAtMs;
          }),
      ).toEqual([0, 30_000, 60_000, 90_000, 120_000]);
    });

    test("after an ingest outage a little shorter than the silence window, a sibling whose streak it broke vouches for nobody: the first node back never reports a live sibling, only the node already Offline", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const lastRound: number = FIRST_REPORTING_ROUND + 1;
      await nodeRounds(harness, {
        from: 0,
        to: lastRound,
        nodes: ["pve1", "pve2", "pve4"],
      });
      // pve3 has been reported and marked Offline; pve4 is Online.
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);
      /*
       * OneUptime's ingest winds down unevenly: pve2's pushes are still
       * processed for 20 s after pve1's and pve4's stop. Then nothing is
       * processed for 110 s — a little under the silence window.
       */
      await nodeRounds(harness, {
        from: lastRound + 1,
        to: lastRound + 2,
        nodes: ["pve2"],
      });
      const marksBefore: number = harness.marks.length;

      const resume: number = lastRound + 13;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;

      /*
       * What pve1's first push back finds. pve4's key has just expired
       * and its inventory sighting is over 2 minutes older than pve1's
       * push, so pve4 looks silent — though it is about to push, in this
       * very round.
       */
      expect(
        livenessEntry(harness.redis, "pve4")?.expiresAtMs ?? 0,
      ).toBeLessThanOrEqual(resumeAtMs);
      expect(harness.inventory.get("pve4")!.lastSeenAt.getTime()).toBeLessThan(
        pushTimeMs(resume) - PROXMOX_NODE_SILENCE_MS,
      );
      /*
       * pve2's key, written before the outage, is still alive, over a
       * streak of more than 2 minutes — but its last push is more than a
       * minute old: the streak is broken, so pve2 is not established and
       * nobody may report a node for the first time.
       */
      const pve2Key: FakeRedisEntry = livenessEntry(harness.redis, "pve2")!;
      expect(pve2Key.expiresAtMs).toBeGreaterThan(resumeAtMs);
      const [pve2StreakStartMs, pve2LastPushMs]: Array<number> = pve2Key.value
        .split(",")
        .map(Number);
      expect(resumeAtMs - pve2StreakStartMs!).toBeGreaterThanOrEqual(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(resumeAtMs - pve2LastPushMs!).toBeGreaterThan(
        PROXMOX_NODE_STREAK_GAP_MS,
      );
      expect(resumeAtMs - pve2LastPushMs!).toBeLessThanOrEqual(
        PROXMOX_NODE_SILENCE_MS,
      );

      /*
       * pve1 is processed first on the round back, pve4 last. pve4 is
       * never reported; pve3, Offline since before the outage, is
       * reported by every live node on every round.
       */
      const afterOutage: Array<JSONObject> = await nodeRounds(harness, {
        from: resume,
        to: resume + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2", "pve4"],
      });
      expect(reportedIds(afterOutage)).toEqual(["node/pve3"]);
      for (
        let round: number = resume;
        round < resume + FIRST_REPORTING_ROUND;
        round++
      ) {
        expect(
          valuesOf(
            rowsOf(rowsAtRound(afterOutage, round), "pve_up", "node/pve3"),
          ),
        ).toEqual([0, 0, 0]);
      }
      /*
       * 1 ÷ L = 1 ÷ 3 per report on every round, the first one back
       * included: pve1 found no key of pve4, but pve4 — withheld, not
       * reported — is presumed live and counted, and pushes the same
       * report itself. So D = 1 per round from the resume on.
       */
      for (
        let round: number = resume;
        round < resume + FIRST_REPORTING_ROUND;
        round++
      ) {
        expect(
          valuesOf(
            rowsOf(
              rowsAtRound(afterOutage, round),
              "pve_node_info",
              "node/pve3",
            ),
          ),
        ).toEqual(new Array<number>(3).fill(oneSilentNodeWeight(3)));
        expect(
          reportedWeight(rowsAtRound(afterOutage, round), "pve3"),
        ).toBeCloseTo(1, 4);
      }
      expect(new Set(markedSince(harness, marksBefore))).toEqual(
        new Set(["pve3"]),
      );

      // Two minutes after the resume, only the node really gone is reported.
      const later: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + FIRST_REPORTING_ROUND,
        to: resume + FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2", "pve4"],
      });
      expect(reportedIds(later)).toEqual(["node/pve3"]);
      // pve4 is never marked Offline, before the resume or after it.
      expect(new Set(markedSince(harness, marksBefore))).toEqual(
        new Set(["pve3"]),
      );
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);
    });

    test("an established node quiet for over a minute stops vouching for a sibling still warming up: a newly silent node waits until that sibling is established itself, the node already Offline does not", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve1 pushes from round 0; pve2 joins at round 10.
      const joined: number = 10;
      // pve1 is established from the first reporting round; then it goes quiet.
      const pve1LastRound: number = FIRST_REPORTING_ROUND + 2;
      // For a minute after pve1's last push, it still vouches for pve2.
      const vouchRounds: number = PROXMOX_NODE_STREAK_GAP_MS / PUSH_INTERVAL_MS;
      const firstUnvouchedRound: number = pve1LastRound + vouchRounds + 1;
      /*
       * pve4 pushes alongside pve1 and dies just in time to turn silent
       * on the first round nobody vouches for pve2 — so only an
       * established node could report it for the first time.
       */
      const pve4LastRound: number =
        firstUnvouchedRound - FIRST_REPORTING_ROUND - 1;
      await nodeRounds(harness, {
        from: 0,
        to: pve4LastRound,
        nodes: ["pve1", "pve4"],
      });
      await nodeRounds(harness, {
        from: pve4LastRound + 1,
        to: joined - 1,
        nodes: ["pve1"],
      });
      const both: Array<JSONObject> = await nodeRounds(harness, {
        from: joined,
        to: pve1LastRound,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(both)).toEqual(["node/pve3"]);
      const pve1LastPushMs: number =
        pushTimeMs(pve1LastRound) + RECEIVE_STEP_MS;
      const pve2StreakStartMs: number = Number(
        livenessEntry(harness.redis, "pve2")!.value.split(",")[0],
      );
      expect(pve2StreakStartMs).toBe(pushTimeMs(joined) + 2 * RECEIVE_STEP_MS);

      const vouched: Array<JSONObject> = await nodeRounds(harness, {
        from: pve1LastRound + 1,
        to: pve1LastRound + vouchRounds,
        nodes: ["pve2"],
      });
      /*
       * pve1 still counts live, and so does pve4 (quiet, not yet silent):
       * D ÷ L = 1 ÷ 3 on each of pve2's pushes.
       */
      expect(reportedIds(vouched)).toEqual(["node/pve3"]);
      const vouchedWeights: Array<number> = valuesOf(
        rowsOf(vouched, "pve_node_info", "node/pve3"),
      );
      expect(vouchedWeights).toEqual(
        new Array<number>(vouchRounds).fill(oneSilentNodeWeight(3)),
      );

      /*
       * Then pve1's streak is broken — its last push is over a minute
       * old, though it still counts as live — and pve2 has not pushed
       * for 2 minutes yet: nobody is established.
       */
      const pve2EstablishedRound: number = joined + FIRST_REPORTING_ROUND + 1;
      const firstUnvouchedAtMs: number =
        pushTimeMs(firstUnvouchedRound) + RECEIVE_STEP_MS;
      const lastUnvouchedAtMs: number =
        pushTimeMs(pve2EstablishedRound - 1) + RECEIVE_STEP_MS;
      expect(firstUnvouchedAtMs - pve1LastPushMs).toBeGreaterThan(
        PROXMOX_NODE_STREAK_GAP_MS,
      );
      expect(lastUnvouchedAtMs - pve1LastPushMs).toBeLessThanOrEqual(
        PROXMOX_NODE_SILENCE_MS,
      );
      expect(lastUnvouchedAtMs - pve2StreakStartMs).toBeLessThan(
        PROXMOX_NODE_SILENCE_MS,
      );
      // pve4 is silent from the first unvouched round on, not before.
      const pve4LastSeenMs: number = harness.inventory
        .get("pve4")!
        .lastSeenAt.getTime();
      expect(pve4LastSeenMs).toBeGreaterThanOrEqual(
        pushTimeMs(firstUnvouchedRound - 1) - PROXMOX_NODE_SILENCE_MS,
      );
      expect(pve4LastSeenMs).toBeLessThan(
        pushTimeMs(firstUnvouchedRound) - PROXMOX_NODE_SILENCE_MS,
      );
      // pve3 is Offline, its mark kept fresh by the reports so far.
      harness.clock.nowMs = firstUnvouchedAtMs;
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      expect(markAgeMs(harness, "pve3")).toBeLessThanOrEqual(
        MARK_REFRESH_MS + MARK_FENCE_MS,
      );
      const marksBefore: number = harness.marks.length;
      const unvouched: Array<JSONObject> = await nodeRounds(harness, {
        from: firstUnvouchedRound,
        to: pve2EstablishedRound - 1,
        nodes: ["pve2"],
      });
      expect(livenessEntry(harness.redis, "pve4")).toBeUndefined();
      expect(unvouched.length).toBeGreaterThan(0);
      /*
       * pve4 is not reported, nor marked; pve3, Offline since the first
       * reporting round and marked well within the monitor window, still
       * is. Every node not reported is presumed live: pve1 (quiet), pve2,
       * and pve4 too, withheld rather than reported — 1 ÷ L = 1 ÷ 3.
       */
      expect(reportedIds(unvouched)).toEqual(["node/pve3"]);
      expect(valuesOf(rowsOf(unvouched, "pve_node_info", "node/pve3"))).toEqual(
        new Array<number>(pve2EstablishedRound - firstUnvouchedRound).fill(
          oneSilentNodeWeight(3),
        ),
      );
      expect(
        markedSince(harness, marksBefore).every((nodeNames: string) => {
          return nodeNames === "pve3";
        }),
      ).toBe(true);
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);

      /*
       * Once pve2 has pushed for 2 minutes itself, pve4 is reported too,
       * and no longer counted: 1 ÷ L = 1 ÷ 2 each.
       */
      const established: Array<JSONObject> = (
        await nodeRound(harness, pve2EstablishedRound, ["pve2"])
      ).get("pve2")!;
      expect(
        pushTimeMs(pve2EstablishedRound) + RECEIVE_STEP_MS - pve2StreakStartMs,
      ).toBeGreaterThanOrEqual(PROXMOX_NODE_SILENCE_MS);
      expect(reportedIds(established)).toEqual(["node/pve3", "node/pve4"]);
      expect(
        valuesOf(rowsOf(established, "pve_node_info", "node/pve3")),
      ).toEqual([0.5]);
      expect(
        valuesOf(rowsOf(established, "pve_node_info", "node/pve4")),
      ).toEqual([0.5]);
      expect(harness.marks[harness.marks.length - 1]!.nodeNames).toEqual([
        "pve3",
        "pve4",
      ]);
    });

    test("a gap of over a minute in a node's own pushes restarts its streak, yet it reports again at once while another node is established", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });

      // pve1's pushes are not processed for 70 s; pve2 keeps pushing.
      const pause: number = FIRST_REPORTING_ROUND + 2;
      const paused: Array<JSONObject> = await nodeRounds(harness, {
        from: pause,
        to: pause + 5,
        nodes: ["pve2"],
      });
      /*
       * pve1 is quiet but not silent (pushed within 2 minutes), so it
       * still counts as live: pve2 carries D ÷ L = 1 ÷ 2, never pve1.
       */
      expect(reportedIds(paused)).toEqual(["node/pve3"]);
      expect(
        valuesOf(rowsOf(paused, "pve_node_info", "node/pve3")).every(
          (value: number) => {
            return value === 0.5;
          },
        ),
      ).toBe(true);

      const back: number = pause + 6;
      const rowsByNode: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        back,
        ["pve1", "pve2"],
      );
      // The gap restarted pve1's streak…
      const backAtMs: number = pushTimeMs(back) + RECEIVE_STEP_MS;
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${backAtMs},${backAtMs}`,
      );
      /*
       * …but pve2 is established, so pve1 reports on its first push back,
       * and both carry half of pve3's weight. Neither reports the other.
       */
      for (const node of ["pve1", "pve2"]) {
        const rows: Array<JSONObject> = rowsByNode.get(node)!;
        expect(reportedIds(rows)).toEqual(["node/pve3"]);
        expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
          0.5,
        ]);
      }

      // And so on through pve1's warm-up and after it.
      for (
        let round: number = back + 1;
        round <= back + FIRST_REPORTING_ROUND;
        round++
      ) {
        const byNode: Map<string, Array<JSONObject>> = await nodeRound(
          harness,
          round,
          ["pve1", "pve2"],
        );
        for (const node of ["pve1", "pve2"]) {
          const rows: Array<JSONObject> = byNode.get(node)!;
          expect(reportedIds(rows)).toEqual(["node/pve3"]);
          expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
            0.5,
          ]);
        }
      }
    });

    test("a survivor back after a 90 s gap reports on its first push back with the established node's weight, and Quorum at Risk stays exactly 50% on every minute", async () => {
      // Two live nodes, two silent: the <= 50% check must keep firing.
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: { pve3: PVE3_LAST_SEEN_MS, pve4: PVE3_LAST_SEEN_MS },
      });
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      // Every row from the first reporting round on.
      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: FIRST_REPORTING_ROUND,
        to: FIRST_REPORTING_ROUND + 5,
        nodes: ["pve1", "pve2"],
      });

      // pve1's pushes are not processed for 90 s; pve2 keeps pushing.
      const lastBeforeGap: number = FIRST_REPORTING_ROUND + 5;
      const gapRounds: number = 90_000 / PUSH_INTERVAL_MS;
      rows.push(
        ...(await nodeRounds(harness, {
          from: lastBeforeGap + 1,
          to: lastBeforeGap + gapRounds - 1,
          nodes: ["pve2"],
        })),
      );

      const back: number = lastBeforeGap + gapRounds;
      const rowsByNode: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        back,
        ["pve1", "pve2"],
      );
      rows.push(...rowsByNode.get("pve1")!, ...rowsByNode.get("pve2")!);

      // Its streak restarted: pve1 is warming up again…
      const backAtMs: number = pushTimeMs(back) + RECEIVE_STEP_MS;
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${backAtMs},${backAtMs}`,
      );
      expect(backAtMs - (pushTimeMs(lastBeforeGap) + RECEIVE_STEP_MS)).toBe(
        90_000,
      );
      /*
       * …yet it reports on its first push back, exactly as pve2 does:
       * D ÷ L = 2 ÷ 2, half to each silent node.
       */
      for (const node of ["pve1", "pve2"]) {
        const nodeRows: Array<JSONObject> = rowsByNode.get(node)!;
        expect(reportedIds(nodeRows)).toEqual(["node/pve3", "node/pve4"]);
        expect(
          valuesOf(rowsOf(nodeRows, "pve_node_info", "node/pve3")),
        ).toEqual([0.5]);
        expect(
          valuesOf(rowsOf(nodeRows, "pve_node_info", "node/pve4")),
        ).toEqual([0.5]);
      }

      /*
       * The rest of pve1's warm-up and a minute beyond it. pve2 misses one
       * push in the middle (20 s apart: its streak survives), so that
       * minute holds 6 pushes from pve1 and 5 from pve2. Were only the
       * established nodes to report, pve2 alone would carry D = 2 per
       * report there, and the minute would read 11 ÷ (11 + 5 × 2) =
       * 52.4 % — the check would stop firing while two of four nodes are
       * down.
       */
      const missed: number = back + 4;
      for (
        let round: number = back + 1;
        round <= back + FIRST_REPORTING_ROUND + 6;
        round++
      ) {
        for (const nodeRows of (
          await nodeRound(
            harness,
            round,
            round === missed ? ["pve1"] : ["pve1", "pve2"],
          )
        ).values()) {
          rows.push(...nodeRows);
        }
      }

      // pve1 is never reported, even while it was quiet.
      expect(reportedIds(rows)).toEqual(["node/pve3", "node/pve4"]);

      // Sum/Sum per minute bucket, however unevenly the pushes fell.
      const rowsByMinute: Map<number, Array<JSONObject>> = new Map();
      for (const row of rows) {
        const minute: number = Math.floor(rowTimeMs(row) / 60_000);
        rowsByMinute.set(minute, [...(rowsByMinute.get(minute) || []), row]);
      }
      expect(rowsByMinute.size).toBeGreaterThanOrEqual(6);
      for (const minuteRows of rowsByMinute.values()) {
        expect(quorumPercent(minuteRows)).toBe(50);
      }
    });

    test("a standalone host never reports anyone", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: {},
      });

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 6,
        nodes: ["pve1"],
      });

      expect(inferredRows(rows)).toEqual([]);
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
      // pve1 is a reporter, but the roster holds only itself…
      expect(harness.getNodeRoster).toHaveBeenCalled();
      expect(harness.inventory.has("pve1")).toBe(true);
      /*
       * …so no sibling liveness is even read: its own liveness GET and SET
       * are its only Redis calls besides the adoption fence.
       */
      expect(
        callsInNamespace(harness.redis.getStrings, LIVENESS_NAMESPACE),
      ).toBe(0);
      expect(
        cacheCalls(harness.redis).filter((call: string) => {
          return !FENCE_NAMESPACES.includes(call.split(" ")[1]!);
        }),
      ).toEqual(
        new Array<Array<string>>(FIRST_REPORTING_ROUND + 7)
          .fill([
            `getString ${LIVENESS_NAMESPACE}`,
            `setString ${LIVENESS_NAMESPACE}`,
          ])
          .flat(),
      );
    });

    test("after the whole cluster went dark for longer than the monitor window, nothing is reported until a node is established again — not even the node already Offline — and a sibling booting less than 2 minutes behind the first node back never is", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      const marksBefore: number = harness.marks.length;

      /*
       * Power cut: nothing from any node for 10 minutes — twice the
       * monitor window, so pve3's last mark has long aged out of it, and
       * Node Offline / Quorum at Risk hold nothing from before the cut.
       * pve1 boots first; pve2 follows 90 s later. Nothing reports during
       * the dark, nor before pve1 has pushed for 2 minutes: not pve2,
       * still coming up, and not pve3 either, Offline since before the
       * cut — there is no incident left to keep up.
       */
      const powerBack: number = FIRST_REPORTING_ROUND + 2 + 60;
      harness.clock.nowMs = pushTimeMs(powerBack);
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      expect(markAgeMs(harness, "pve3")).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      const firstMinutes: Array<JSONObject> = await nodeRounds(harness, {
        from: powerBack,
        to: powerBack + 8,
        nodes: ["pve1"],
      });
      const bothBack: Array<JSONObject> = await nodeRounds(harness, {
        from: powerBack + 9,
        to: powerBack + 9 + FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });

      expect(inferredRows(firstMinutes)).toEqual([]);
      const pve1EstablishedRound: number = powerBack + FIRST_REPORTING_ROUND;
      for (
        let round: number = powerBack + 9;
        round <= powerBack + 9 + FIRST_REPORTING_ROUND;
        round++
      ) {
        const roundRows: Array<JSONObject> = rowsAtRound(bothBack, round);
        if (round < pve1EstablishedRound) {
          expect(inferredRows(roundRows)).toEqual([]);
          continue;
        }
        /*
         * Once pve1 is established, only the node still down is
         * reported, by both: 1 ÷ L = 1 ÷ 2 each.
         */
        expect(reportedIds(roundRows)).toEqual(["node/pve3"]);
        expect(
          valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")),
        ).toEqual([0.5, 0.5]);
      }
      expect(harness.inventory.get("pve2")!.isUp).toBe(true);
      const marksSince: Array<OfflineMark> = harness.marks.slice(marksBefore);
      expect(marksSince.length).toBeGreaterThan(0);
      for (const mark of marksSince) {
        expect(mark.nodeNames).toEqual(["pve3"]);
        expect(mark.atMs).toBeGreaterThanOrEqual(
          pushTimeMs(pve1EstablishedRound),
        );
      }
    });

    test("a node something else still reports (a fresh inventory sighting, no liveness key) is never called silent", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();

      const rows: Array<JSONObject> = [];
      for (
        let round: number = 0;
        round <= FIRST_REPORTING_ROUND + 12;
        round++
      ) {
        // The Proxmox Agent keeps refreshing pve3's inventory row.
        harness.inventory.get("pve3")!.lastSeenAt = new Date(pushTimeMs(round));
        for (const nodeRows of (
          await nodeRound(harness, round, ["pve1", "pve2"])
        ).values()) {
          rows.push(...nodeRows);
        }
      }

      expect(harness.getNodeRoster).toHaveBeenCalled();
      expect(livenessEntry(harness.redis, "pve3")).toBeUndefined();
      expect(inferredRows(rows)).toEqual([]);
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
    });
  });

  /*
   * The established-node gate guards a node's FIRST report only. A node
   * already Offline in the inventory keeps being reported by every live
   * node while none is established — otherwise the pushes of those two
   * minutes would carry no report, their minutes would read 100 % up,
   * and Node Offline and Quorum at Risk would resolve only to page again.
   * That continuation needs the node's own mark: its row's
   * notReportingMarkedAt, stamped on the ingest worker's clock, at most
   * one monitor window old at the moment the roster holding it was read.
   * Its age is taken then, not at each push, so every push one cached
   * roster serves decides alike: the reports never drop out and come back
   * at the window's edge. The mark is in Postgres, so it survives the loss
   * of every Redis key, and the continuing reports keep it fresh (the
   * fenced mark rewrites it once it is over a minute old), so the reports
   * carry on through gaps and bursts of any length. Only once the whole
   * cluster has been silent for longer than that has the mark aged out:
   * the window holds nothing from before the gap, there is no incident
   * left to keep up, and a node that came back during the gap must not be
   * reported before its own push is processed. Nothing else is a mark:
   * not an Offline row's updatedAt, however fresh, nor adopting a row
   * into the native-push keep.
   */
  describe("a node already Offline keeps being reported while no node is established", () => {
    test("after a processing gap of over a minute, every push still reports the sibling already Offline, while a sibling that went silent during the gap waits for an established node", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve3 is reported and marked Offline; pve4 dies after this round.
      const pve4LastRound: number = FIRST_REPORTING_ROUND + 1;
      await nodeRounds(harness, {
        from: 0,
        to: pve4LastRound,
        nodes: ["pve1", "pve2", "pve4"],
      });
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);

      // pve1 and pve2 push on for 50 s: pve4 is quiet, not silent yet.
      const lastBeforeGap: number = pve4LastRound + 5;
      const beforeGap: Array<JSONObject> = await nodeRounds(harness, {
        from: pve4LastRound + 1,
        to: lastBeforeGap,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(beforeGap)).toEqual(["node/pve3"]);
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);
      const marksBefore: number = harness.marks.length;

      /*
       * Then OneUptime processes nothing for the next 90 s (a queue
       * stall). Every streak is broken, so no node is established — but
       * pve1's and pve2's keys are still alive, so both count live. pve4
       * went silent during the gap, never reported, still Online.
       */
      const resume: number = lastBeforeGap + 10;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      for (const node of ["pve1", "pve2"]) {
        const [, lastPushMs]: Array<number> = livenessEntry(
          harness.redis,
          node,
        )!
          .value.split(",")
          .map(Number);
        expect(resumeAtMs - lastPushMs!).toBeGreaterThan(
          PROXMOX_NODE_STREAK_GAP_MS,
        );
        expect(resumeAtMs - lastPushMs!).toBeLessThanOrEqual(
          PROXMOX_NODE_SILENCE_MS,
        );
      }
      expect(
        livenessEntry(harness.redis, "pve4")?.expiresAtMs ?? 0,
      ).toBeLessThanOrEqual(resumeAtMs);
      expect(harness.inventory.get("pve4")!.lastSeenAt.getTime()).toBeLessThan(
        pushTimeMs(resume) - PROXMOX_NODE_SILENCE_MS,
      );

      // pve3 was marked on the first report, 160 s before the resume.
      const markedAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      expect(markRewritesAtMs(harness, "pve3")).toEqual([markedAtMs]);
      harness.clock.nowMs = resumeAtMs;
      expect(markAgeMs(harness, "pve3")).toBe(160_000);

      const firstBack: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        resume,
        ["pve1", "pve2"],
      );
      // The gap restarted pve1's streak…
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${resumeAtMs},${resumeAtMs}`,
      );
      /*
       * …yet both report pve3 on their first push back — Offline, and
       * marked within the monitor window — and the first report rewrites
       * that mark. Every node not reported is presumed live: pve1, pve2,
       * and pve4, withheld (Online, with nobody established) rather than
       * reported — 1 ÷ L = 1 ÷ 3 each.
       */
      expect(markRewritesAtMs(harness, "pve3")).toEqual([
        markedAtMs,
        resumeAtMs,
      ]);
      for (const node of ["pve1", "pve2"]) {
        const rows: Array<JSONObject> = firstBack.get(node)!;
        expect(reportedIds(rows)).toEqual(["node/pve3"]);
        expect(valuesOf(rowsOf(rows, "pve_up", "node/pve3"))).toEqual([0]);
        expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
          oneSilentNodeWeight(3),
        ]);
      }

      // And on every round of the warm-up; pve4 on none.
      const warmUp: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + 1,
        to: resume + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(warmUp)).toEqual(["node/pve3"]);
      for (
        let round: number = resume + 1;
        round < resume + FIRST_REPORTING_ROUND;
        round++
      ) {
        expect(
          valuesOf(
            rowsOf(rowsAtRound(warmUp, round), "pve_node_info", "node/pve3"),
          ),
        ).toEqual([oneSilentNodeWeight(3), oneSilentNodeWeight(3)]);
      }
      expect(new Set(markedSince(harness, marksBefore))).toEqual(
        new Set(["pve3"]),
      );
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);

      /*
       * Two minutes after the resume the nodes are established: pve4's
       * first report, and it is no longer counted — 1 ÷ 2 each.
       */
      const established: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        resume + FIRST_REPORTING_ROUND,
        ["pve1", "pve2"],
      );
      for (const node of ["pve1", "pve2"]) {
        const rows: Array<JSONObject> = established.get(node)!;
        expect(reportedIds(rows)).toEqual(["node/pve3", "node/pve4"]);
        expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve4"))).toEqual([
          0.5,
        ]);
      }
      expect(harness.marks[harness.marks.length - 1]!.nodeNames).toEqual([
        "pve3",
        "pve4",
      ]);
      expect(harness.inventory.get("pve4")!.isUp).toBe(false);
    });

    test.each<[string, number, boolean]>([
      ["90 s", 90_000 / PUSH_INTERVAL_MS, false],
      ["3 minutes 20 s", 200_000 / PUSH_INTERVAL_MS, true],
    ])(
      "a lone survivor back after its own %s gap keeps reporting its Offline siblings from its first push back, so they never read up",
      async (_label: string, gapRounds: number, outlastsWindow: boolean) => {
        const harness: SilentNodeHarness = setupSilentNodeHarness();
        // pve3 is silent throughout; pve2 dies after this round.
        const pve2LastRound: number = FIRST_REPORTING_ROUND + 1;
        await nodeRounds(harness, {
          from: 0,
          to: pve2LastRound,
          nodes: ["pve1", "pve2"],
        });

        // pve1 goes on alone, until pve2 is reported and marked Offline too.
        const pve2SilentRound: number =
          pve2LastRound + FIRST_REPORTING_ROUND + 1;
        const lastBeforeGap: number = pve2SilentRound + 1;
        const alone: Array<JSONObject> = await nodeRounds(harness, {
          from: pve2LastRound + 1,
          to: lastBeforeGap,
          nodes: ["pve1"],
        });
        expect(reportedIds(rowsAtRound(alone, pve2SilentRound - 1))).toEqual([
          "node/pve3",
        ]);
        expect(reportedIds(rowsAtRound(alone, pve2SilentRound))).toEqual([
          "node/pve2",
          "node/pve3",
        ]);
        expect(harness.inventory.get("pve2")!.isUp).toBe(false);
        expect(harness.inventory.get("pve3")!.isUp).toBe(false);

        /*
         * pve1's pushes are not processed for the gap. Its streak
         * restarts, and it is the only node left: nobody is established
         * for the next 2 minutes — after the longer gap, those end over a
         * monitor window after the last push that found pve1 established.
         * Both marks are within the window on the first push back.
         */
        const lastEstablishedAtMs: number =
          pushTimeMs(lastBeforeGap) + RECEIVE_STEP_MS;
        const back: number = lastBeforeGap + gapRounds;
        const backAtMs: number = pushTimeMs(back) + RECEIVE_STEP_MS;
        expect(
          pushTimeMs(back + FIRST_REPORTING_ROUND) +
            RECEIVE_STEP_MS -
            lastEstablishedAtMs >
            PROXMOX_MONITOR_WINDOW_MS,
        ).toBe(outlastsWindow);
        harness.clock.nowMs = backAtMs;
        for (const node of ["pve2", "pve3"]) {
          expect(markAgeMs(harness, node)).toBeLessThanOrEqual(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }
        const marksBefore: number = harness.marks.length;

        const rows: Array<JSONObject> = (
          await nodeRound(harness, back, ["pve1"])
        ).get("pve1")!;
        expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
          `${backAtMs},${backAtMs}`,
        );
        // The first push back rewrites both marks.
        expect(harness.marks.slice(marksBefore)).toMatchObject([
          {
            atMs: backAtMs,
            nodeNames: ["pve2", "pve3"],
            written: ["pve2", "pve3"],
          },
        ]);
        for (
          let round: number = back + 1;
          round <= back + FIRST_REPORTING_ROUND + 5;
          round++
        ) {
          rows.push(
            ...(await nodeRound(harness, round, ["pve1"])).get("pve1")!,
          );
          // Neither mark ever ages past a minute and a half meanwhile.
          for (const node of ["pve2", "pve3"]) {
            expect(markAgeMs(harness, node)).toBeLessThanOrEqual(
              MARK_REFRESH_MS + MARK_FENCE_MS,
            );
          }
        }

        /*
         * Every push, the first one back included, reports both, with
         * D ÷ L = 2 ÷ 1: each silent node weighs as much as pve1 itself.
         */
        for (
          let round: number = back;
          round <= back + FIRST_REPORTING_ROUND + 5;
          round++
        ) {
          const roundRows: Array<JSONObject> = rowsAtRound(rows, round);
          expect(reportedIds(roundRows)).toEqual(["node/pve2", "node/pve3"]);
          for (const id of ["node/pve2", "node/pve3"]) {
            expect(valuesOf(rowsOf(roundRows, "pve_up", id))).toEqual([0]);
            expect(valuesOf(rowsOf(roundRows, "pve_node_info", id))).toEqual([
              1,
            ]);
          }
        }
        // One node of three up, on every minute.
        expect(quorumPercent(rows)).toBeCloseTo(100 / 3, 10);
      },
    );

    test("a lone survivor whose pushes are processed in bursts over a minute apart is never established, yet keeps reporting its Offline siblings for as long as the bursts go on: each burst's reports keep their marks fresh", async () => {
      /*
       * pve2 and pve3 are Offline, marked 30 s before round 0; pve1 is
       * all that is left. Its pushes reach OneUptime in bursts: the 8
       * pushes of every 80 s are processed together, 100 ms apart, right
       * after the last of them — so each burst restarts pve1's streak.
       * This goes on for over twice the monitor window.
       */
      const quietSinceMs: number = T0_MS - 10 * 60_000;
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: {
          pve1: T0_MS - PUSH_INTERVAL_MS,
          pve2: quietSinceMs,
          pve3: quietSinceMs,
        },
        isUp: { pve2: false, pve3: false },
        notReportingMarkedAt: { pve2: T0_MS - 30_000, pve3: T0_MS - 30_000 },
      });
      const burstRounds: number = 8;
      const bursts: number = Math.ceil(
        (2 * PROXMOX_MONITOR_WINDOW_MS) / (burstRounds * PUSH_INTERVAL_MS),
      );
      expect(bursts * burstRounds * PUSH_INTERVAL_MS).toBeGreaterThanOrEqual(
        2 * PROXMOX_MONITOR_WINDOW_MS,
      );

      const rows: Array<JSONObject> = [];
      const burstsAtMs: Array<number> = [];
      for (let burst: number = 0; burst < bursts; burst++) {
        const first: number = burst * burstRounds;
        const last: number = first + burstRounds - 1;
        const burstAtMs: number = pushTimeMs(last) + RECEIVE_STEP_MS;
        burstsAtMs.push(burstAtMs);
        // The marks the burst goes on from are within the window.
        harness.clock.nowMs = burstAtMs;
        for (const node of ["pve2", "pve3"]) {
          expect(markAgeMs(harness, node)).toBeLessThanOrEqual(
            PROXMOX_MONITOR_WINDOW_MS,
          );
        }

        for (let round: number = first; round <= last; round++) {
          const pushRows: Array<JSONObject> = await ingestAt(
            harness,
            burstAtMs + (round - first) * 100,
            [nodePush("pve1", nanosAt(pushTimeMs(round)))],
          );
          /*
           * Every push reports both, each weighing as much as pve1
           * itself: D ÷ L = 2 ÷ 1.
           */
          expect(reportedIds(pushRows)).toEqual(["node/pve2", "node/pve3"]);
          for (const id of ["node/pve2", "node/pve3"]) {
            expect(valuesOf(rowsOf(pushRows, "pve_up", id))).toEqual([0]);
            expect(valuesOf(rowsOf(pushRows, "pve_node_info", id))).toEqual([
              1,
            ]);
          }
          rows.push(...pushRows);
        }

        // pve1's streak began with this burst: it is never established.
        const [streakStartMs, lastPushMs]: Array<number> = livenessEntry(
          harness.redis,
          "pve1",
        )!
          .value.split(",")
          .map(Number);
        expect(streakStartMs).toBe(burstAtMs);
        expect(lastPushMs! - streakStartMs!).toBeLessThan(
          PROXMOX_NODE_SILENCE_MS,
        );
      }

      expect(quorumPercent(rows)).toBeCloseTo(100 / 3, 10);
      // Each burst's first push rewrote both marks; nothing else did.
      expect(
        harness.marks
          .filter((mark: OfflineMark) => {
            return mark.written.length > 0;
          })
          .map((mark: OfflineMark) => {
            return { atMs: mark.atMs, written: mark.written };
          }),
      ).toEqual(
        burstsAtMs.map((atMs: number) => {
          return { atMs, written: ["pve2", "pve3"] };
        }),
      );
    });

    test.each<[string, boolean | null]>([
      ["Online", true],
      ["of unknown state (isUp NULL)", null],
    ])(
      "after 3 minutes of OneUptime downtime, with no liveness key left, a node already Offline and marked just before it is reported from the very first round, while one %s waits for an established node",
      async (_label: string, isUp: boolean | null) => {
        /*
         * OneUptime was down for 3 minutes: every liveness key is gone.
         * pve1 and pve2 pushed until the outage; pve3 and pve4 have been
         * quiet for ten minutes — pve3 was reported and marked Offline
         * just before the outage, pve4 never was. pve3's mark, 3 minutes
         * old, is within the monitor window: the whole warm-up after the
         * outage continues its reports.
         */
        const downSinceMs: number = T0_MS - 3 * 60_000;
        const quietSinceMs: number = T0_MS - 10 * 60_000;
        const harness: SilentNodeHarness = setupSilentNodeHarness({
          inventory: {
            pve1: downSinceMs,
            pve2: downSinceMs,
            pve3: quietSinceMs,
            pve4: quietSinceMs,
          },
          isUp: { pve3: false, pve4: isUp },
          notReportingMarkedAt: { pve3: downSinceMs },
        });
        const firstAtMs: number = T0_MS + RECEIVE_STEP_MS;
        harness.clock.nowMs = firstAtMs;
        expect(markAgeMs(harness, "pve3")).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );

        const warmUp: Array<JSONObject> = await nodeRounds(harness, {
          from: 0,
          to: FIRST_REPORTING_ROUND - 1,
          nodes: ["pve1", "pve2"],
        });
        expect(reportedIds(warmUp)).toEqual(["node/pve3"]);
        /*
         * By both, on every round, the very first included. Every node
         * not reported is presumed live — pve2 before its first push back
         * is processed, and pve4, withheld rather than reported — so
         * 1 ÷ L = 1 ÷ 3 per report.
         */
        for (let round: number = 0; round < FIRST_REPORTING_ROUND; round++) {
          const roundRows: Array<JSONObject> = rowsAtRound(warmUp, round);
          expect(valuesOf(rowsOf(roundRows, "pve_up", "node/pve3"))).toEqual([
            0, 0,
          ]);
          expect(
            valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")),
          ).toEqual([oneSilentNodeWeight(3), oneSilentNodeWeight(3)]);
        }
        expect(new Set(markedSince(harness, 0))).toEqual(new Set(["pve3"]));
        // The first push back rewrote pve3's mark, 3 minutes old.
        expect(markRewritesAtMs(harness, "pve3")[0]).toBe(firstAtMs);
        expect(harness.inventory.get("pve4")!.isUp).toBe(isUp);

        /*
         * Two minutes in, the nodes are established: pve4's first report,
         * 1 ÷ L = 1 ÷ 2 each.
         */
        const established: Map<string, Array<JSONObject>> = await nodeRound(
          harness,
          FIRST_REPORTING_ROUND,
          ["pve1", "pve2"],
        );
        for (const node of ["pve1", "pve2"]) {
          const rows: Array<JSONObject> = established.get(node)!;
          expect(reportedIds(rows)).toEqual(["node/pve3", "node/pve4"]);
          expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve4"))).toEqual([
            0.5,
          ]);
        }
        expect(harness.inventory.get("pve4")!.isUp).toBe(false);
        // pve3's mark was fresh already; only pve4's row is written.
        expect(harness.marks[harness.marks.length - 1]).toMatchObject({
          nodeNames: ["pve3", "pve4"],
          written: ["pve4"],
        });
      },
    );

    test("a Redis failover that loses every key mid-incident does not stop the reports of the node already Offline — its mark is in Postgres — while a sibling that went silent after it waits for an established node", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve3 is reported and marked Offline; pve4 dies after this round.
      const pve4LastRound: number = FIRST_REPORTING_ROUND + 3;
      const failoverRound: number = FIRST_REPORTING_ROUND + 6;
      await nodeRounds(harness, {
        from: 0,
        to: pve4LastRound,
        nodes: ["pve1", "pve2", "pve4"],
      });
      const before: Array<JSONObject> = await nodeRounds(harness, {
        from: pve4LastRound + 1,
        to: failoverRound - 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(before)).toEqual(["node/pve3"]);
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);

      /*
       * Redis fails over to a replica that holds nothing: every liveness
       * key and every fence is gone, so nobody is established for the next
       * 2 minutes. pve4 turns silent in the meantime.
       */
      harness.redis.entries.clear();
      const failoverAtMs: number = pushTimeMs(failoverRound) + RECEIVE_STEP_MS;
      harness.clock.nowMs = failoverAtMs;
      expect(markAgeMs(harness, "pve3")).toBeLessThanOrEqual(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      const pve1EstablishedRound: number =
        failoverRound + FIRST_REPORTING_ROUND;
      const pve4SilentRound: number = pve4LastRound + FIRST_REPORTING_ROUND + 1;
      expect(pve4SilentRound).toBeGreaterThan(failoverRound);
      expect(pve4SilentRound).toBeLessThan(pve1EstablishedRound);
      const marksBefore: number = harness.marks.length;

      const warmUp: Array<JSONObject> = await nodeRounds(harness, {
        from: failoverRound,
        to: pve1EstablishedRound - 1,
        nodes: ["pve1", "pve2"],
      });
      expect(livenessEntry(harness.redis, "pve1")!.value.split(",")[0]).toBe(
        String(failoverAtMs),
      );
      /*
       * pve3 is reported by both on every round, the first push after the
       * failover included. Every node not reported is presumed live: pve1,
       * pve2, and pve4 — quiet, then silent but withheld — so 1 ÷ L = 1 ÷ 3.
       */
      expect(reportedIds(warmUp)).toEqual(["node/pve3"]);
      for (
        let round: number = failoverRound;
        round < pve1EstablishedRound;
        round++
      ) {
        const roundRows: Array<JSONObject> = rowsAtRound(warmUp, round);
        expect(valuesOf(rowsOf(roundRows, "pve_up", "node/pve3"))).toEqual([
          0, 0,
        ]);
        expect(
          valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve3")),
        ).toEqual([oneSilentNodeWeight(3), oneSilentNodeWeight(3)]);
      }
      // pve3's mark is kept fresh meanwhile; pve4 is never marked.
      expect(
        markRewritesAtMs(harness, "pve3").filter((atMs: number) => {
          return atMs >= failoverAtMs;
        }).length,
      ).toBeGreaterThan(0);
      expect(new Set(markedSince(harness, marksBefore))).toEqual(
        new Set(["pve3"]),
      );
      expect(harness.inventory.get("pve4")!.isUp).toBe(true);

      // Once pve1 is established again, pve4's first report: 1 ÷ 2 each.
      const established: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        pve1EstablishedRound,
        ["pve1", "pve2"],
      );
      for (const node of ["pve1", "pve2"]) {
        const rows: Array<JSONObject> = established.get(node)!;
        expect(reportedIds(rows)).toEqual(["node/pve3", "node/pve4"]);
        expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve4"))).toEqual([
          0.5,
        ]);
      }
      expect(harness.marks[harness.marks.length - 1]!.nodeNames).toEqual([
        "pve3",
        "pve4",
      ]);
      expect(harness.inventory.get("pve4")!.isUp).toBe(false);
    });

    test.each<[string, number, boolean]>([
      ["290 s old is reported", 290_000, true],
      [
        "exactly one monitor window old is still reported",
        PROXMOX_MONITOR_WINDOW_MS,
        true,
      ],
      [
        "a millisecond older than one monitor window waits for an established node",
        PROXMOX_MONITOR_WINDOW_MS + 1,
        false,
      ],
      [
        "one monitor window and a roster cache's 30 s old waits for an established node",
        PROXMOX_MONITOR_WINDOW_MS + PROXMOX_ROSTER_CACHE_TTL_MS,
        false,
      ],
    ])(
      "with no node established, a node already Offline whose mark is %s",
      async (_label: string, markAgeOnReadMs: number, reported: boolean) => {
        /*
         * pve1's first push after an outage: nobody is established. pve3
         * has been quiet for ten minutes and is Offline; its mark is this
         * old when that push reads the roster — the reports continue while
         * it is at most one monitor window old then, not a millisecond
         * more.
         */
        const firstAtMs: number = T0_MS + RECEIVE_STEP_MS;
        const markedAtMs: number = firstAtMs - markAgeOnReadMs;
        const harness: SilentNodeHarness = setupSilentNodeHarness({
          inventory: { pve3: T0_MS - 10 * 60_000 },
          isUp: { pve3: false },
          notReportingMarkedAt: { pve3: markedAtMs },
        });

        const rows: Array<JSONObject> = (
          await nodeRound(harness, 0, ["pve1"])
        ).get("pve1")!;
        expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
          `${firstAtMs},${firstAtMs}`,
        );
        // That push read the roster, holding that mark.
        expect(harness.rosterReadsAtMs).toEqual([firstAtMs]);
        expect(lastRosterRow(harness, "pve3")).toEqual({
          nodeName: "pve3",
          lastSeenAt: new Date(T0_MS - 10 * 60_000),
          isUp: false,
          notReportingMarkedAt: new Date(markedAtMs),
        });
        expect(harness.inventory.get("pve3")!.isUp).toBe(false);

        if (reported) {
          // D ÷ L = 1 ÷ 1: pve3 weighs as much as pve1…
          expect(reportedIds(rows)).toEqual(["node/pve3"]);
          expect(valuesOf(rowsOf(rows, "pve_up", "node/pve3"))).toEqual([0]);
          expect(valuesOf(rowsOf(rows, "pve_node_info", "node/pve3"))).toEqual([
            1,
          ]);
          // …and the report rewrites its mark.
          expect(harness.marks).toMatchObject([
            {
              atMs: firstAtMs,
              markedAtMs: firstAtMs,
              nodeNames: ["pve3"],
              written: ["pve3"],
            },
          ]);
          expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
            new Date(firstAtMs),
          );
          return;
        }

        // Neither reported nor marked…
        expect(inferredRows(rows)).toEqual([]);
        expect(harness.marks).toEqual([]);
        expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
          new Date(markedAtMs),
        );
        // …until pve1 has pushed for 2 minutes.
        const warmUp: Array<JSONObject> = await nodeRounds(harness, {
          from: 1,
          to: FIRST_REPORTING_ROUND - 1,
          nodes: ["pve1"],
        });
        expect(inferredRows(warmUp)).toEqual([]);
        const established: Array<JSONObject> = (
          await nodeRound(harness, FIRST_REPORTING_ROUND, ["pve1"])
        ).get("pve1")!;
        expect(reportedIds(established)).toEqual(["node/pve3"]);
        expect(markRewritesAtMs(harness, "pve3")).toEqual([
          pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
        ]);
      },
    );

    /*
     * The window's edge. pve1 is all that is left; pve3 has been down for
     * ten minutes, Offline. pve1's pushes were not processed for a while:
     * it has no liveness key, so nobody is established for 2 minutes, and
     * its first push back reads the roster with pve3's last mark this old.
     * The worker reuses that read for 30 s: the next three pushes decide
     * on it too, the old mark aging on past the window on their receive
     * clock, and the fifth reads the roster again. The mark's age is taken
     * at the read, so every push that one read serves decides as the first
     * did — all report, or none do — and so does the one after the reload:
     * never a report that drops out and comes back, which would read a
     * minute 100 % up and resolve Node Offline only to page again.
     */
    test.each<[string, number, boolean]>([
      ["290 s", 290_000, true],
      ["exactly one monitor window", PROXMOX_MONITOR_WINDOW_MS, true],
      [
        "a millisecond over one monitor window",
        PROXMOX_MONITOR_WINDOW_MS + 1,
        false,
      ],
      ["310 s", 310_000, false],
      ["330 s", 330_000, false],
    ])(
      "a lone survivor back from a gap, its Offline sibling's mark %s old when its first push back reads the roster, decides alike on every push until the reload and after it: no hole at the window's edge",
      async (_label: string, markAgeOnReadMs: number, continues: boolean) => {
        const firstAtMs: number = T0_MS + RECEIVE_STEP_MS;
        const oldMarkMs: number = firstAtMs - markAgeOnReadMs;
        const harness: SilentNodeHarness = setupSilentNodeHarness({
          inventory: {
            pve1: T0_MS - 3 * 60_000,
            pve3: T0_MS - 10 * 60_000,
          },
          isUp: { pve3: false },
          notReportingMarkedAt: { pve3: oldMarkMs },
        });
        const lastRound: number = FIRST_REPORTING_ROUND + 3;
        const pve3MarkIn: (read: RosterRead) => Date | null | undefined = (
          read: RosterRead,
        ): Date | null | undefined => {
          return read.nodes.find((node: ProxmoxRosterNode) => {
            return node.nodeName === "pve3";
          })!.notReportingMarkedAt;
        };

        // Each of pve1's pushes: whether it reported pve3.
        const reported: Array<boolean> = [];
        const rows: Array<JSONObject> = [];
        // How old pve3's old mark was at each push the first read served.
        const cachedRosterMarkAgesMs: Array<number> = [];
        for (let round: number = 0; round <= lastRound; round++) {
          const pushRows: Array<JSONObject> = (
            await nodeRound(harness, round, ["pve1"])
          ).get("pve1")!;
          const ids: Array<string> = reportedIds(pushRows);
          reported.push(ids.length > 0);
          if (ids.length > 0) {
            // pve1 carries pve3's full weight: D ÷ L = 1 ÷ 1.
            expect(ids).toEqual(["node/pve3"]);
            expect(valuesOf(rowsOf(pushRows, "pve_up", "node/pve3"))).toEqual([
              0,
            ]);
            expect(
              valuesOf(rowsOf(pushRows, "pve_node_info", "node/pve3")),
            ).toEqual([1]);
          }
          if (harness.rosterReads.length === 1) {
            cachedRosterMarkAgesMs.push(harness.clock.nowMs - oldMarkMs);
          }
          rows.push(...pushRows);
        }
        // pve1's streak began with its first push back.
        expect(livenessEntry(harness.redis, "pve1")!.value.split(",")[0]).toBe(
          String(firstAtMs),
        );

        /*
         * The first push back read the roster, holding the old mark; the
         * next three were served that same read — the last of them 30 s
         * later, the old mark by then past the window on their receive
         * clock whatever its age at the read — and the fifth read again.
         */
        const reloadRound: number =
          PROXMOX_ROSTER_CACHE_TTL_MS / PUSH_INTERVAL_MS + 1;
        expect(harness.rosterReadsAtMs.slice(0, 2)).toEqual([
          firstAtMs,
          pushTimeMs(reloadRound) + RECEIVE_STEP_MS,
        ]);
        expect(pve3MarkIn(harness.rosterReads[0]!)).toEqual(
          new Date(oldMarkMs),
        );
        expect(cachedRosterMarkAgesMs).toEqual([
          markAgeOnReadMs,
          markAgeOnReadMs + PUSH_INTERVAL_MS,
          markAgeOnReadMs + 2 * PUSH_INTERVAL_MS,
          markAgeOnReadMs + PROXMOX_ROSTER_CACHE_TTL_MS,
        ]);
        expect(cachedRosterMarkAgesMs[3]!).toBeGreaterThan(
          PROXMOX_MONITOR_WINDOW_MS,
        );

        if (continues) {
          /*
           * Every push reports — each one the cached read served, however
           * far past the window the old mark had aged by then. The first
           * rewrote the mark on the worker's clock, so the reload found it
           * fresh, and it is kept fresh from there on, once a minute.
           */
          expect(reported).toEqual(
            new Array<boolean>(lastRound + 1).fill(true),
          );
          expect(pve3MarkIn(harness.rosterReads[1]!)).toEqual(
            new Date(firstAtMs),
          );
          expect(markRewritesAtMs(harness, "pve3")).toEqual([
            firstAtMs,
            firstAtMs + MARK_REFRESH_MS + MARK_FENCE_MS,
          ]);

          // No hole: every minute reads one node of two up, exactly.
          const rowsByMinute: Map<number, Array<JSONObject>> = new Map();
          for (const row of rows) {
            const minute: number = Math.floor(rowTimeMs(row) / 60_000);
            rowsByMinute.set(minute, [
              ...(rowsByMinute.get(minute) || []),
              row,
            ]);
          }
          expect(rowsByMinute.size).toBeGreaterThanOrEqual(3);
          for (const minuteRows of rowsByMinute.values()) {
            expect(quorumPercent(minuteRows)).toBe(50);
          }
          return;
        }

        /*
         * No push reports before pve1 is established: not the first, not
         * the ones the cached read served, and not the ones after the
         * reload, which found the same old mark — nothing had rewritten
         * it. From the established push on, every push reports, and the
         * first one marks.
         */
        expect(reported).toEqual([
          ...new Array<boolean>(FIRST_REPORTING_ROUND).fill(false),
          ...new Array<boolean>(lastRound + 1 - FIRST_REPORTING_ROUND).fill(
            true,
          ),
        ]);
        expect(pve3MarkIn(harness.rosterReads[1]!)).toEqual(
          new Date(oldMarkMs),
        );
        expect(markRewritesAtMs(harness, "pve3")).toEqual([
          pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
        ]);
      },
    );

    test.each<[string, number]>([
      ["in step with the worker's", 0],
      ["10 minutes ahead of the worker's", 10 * 60_000],
    ])(
      "an Offline row whose updatedAt is fresh but which carries no mark is never continued, with Postgres's clock %s: only notReportingMarkedAt counts, both ways",
      async (_label: string, postgresClockAheadMs: number) => {
        /*
         * pve1's first push after an outage: nobody is established. Two
         * siblings have been down for ten minutes, both Offline. pve3's row
         * carries no mark — marked before the column existed, or left
         * Offline by the agent and adopted — yet its updatedAt was written
         * just now: an upsert or a latest-metrics update, on Postgres's
         * clock (possibly ahead of the worker's). pve4's row carries a mark
         * two minutes old, yet its updatedAt is ten minutes old.
         */
        const firstAtMs: number = T0_MS + RECEIVE_STEP_MS;
        const quietSinceMs: number = T0_MS - 10 * 60_000;
        const pve4MarkedAtMs: number = T0_MS - 2 * 60_000;
        const harness: SilentNodeHarness = setupSilentNodeHarness({
          inventory: { pve3: quietSinceMs, pve4: quietSinceMs },
          isUp: { pve3: false, pve4: false },
          notReportingMarkedAt: { pve3: null, pve4: pve4MarkedAtMs },
          updatedAt: {
            pve3: firstAtMs + postgresClockAheadMs,
            pve4: quietSinceMs,
          },
          postgresClockAheadMs,
        });

        const warmUp: Array<JSONObject> = await nodeRounds(harness, {
          from: 0,
          to: FIRST_REPORTING_ROUND - 1,
          nodes: ["pve1"],
        });
        // The roster pve1's first push read: no updatedAt, no mark on pve3.
        expect(harness.rosterReadsAtMs[0]).toBe(firstAtMs);
        expect(
          [...harness.rosterReads[0]!.nodes].sort(
            (a: ProxmoxRosterNode, b: ProxmoxRosterNode) => {
              return a.nodeName.localeCompare(b.nodeName);
            },
          ),
        ).toEqual([
          {
            nodeName: "pve3",
            lastSeenAt: new Date(quietSinceMs),
            isUp: false,
            notReportingMarkedAt: null,
          },
          {
            nodeName: "pve4",
            lastSeenAt: new Date(quietSinceMs),
            isUp: false,
            notReportingMarkedAt: new Date(pve4MarkedAtMs),
          },
        ]);

        /*
         * Through the whole warm-up, only pve4 is reported, on every push,
         * the very first included. pve3 — withheld, not reported — is
         * presumed live: 1 ÷ L = 1 ÷ 2 per report. Only pve4's mark is
         * kept up; pve3 is never marked.
         */
        for (let round: number = 0; round < FIRST_REPORTING_ROUND; round++) {
          const roundRows: Array<JSONObject> = rowsAtRound(warmUp, round);
          expect(reportedIds(roundRows)).toEqual(["node/pve4"]);
          expect(
            valuesOf(rowsOf(roundRows, "pve_node_info", "node/pve4")),
          ).toEqual([oneSilentNodeWeight(2)]);
        }
        expect(new Set(markedSince(harness, 0))).toEqual(new Set(["pve4"]));
        expect(markRewritesAtMs(harness, "pve4")[0]).toBe(firstAtMs);
        expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toBeNull();

        /*
         * Once pve1 is established, pve3's first report — and its first
         * mark, on the worker's clock: D ÷ L = 2 ÷ 1.
         */
        const established: Array<JSONObject> = (
          await nodeRound(harness, FIRST_REPORTING_ROUND, ["pve1"])
        ).get("pve1")!;
        expect(reportedIds(established)).toEqual(["node/pve3", "node/pve4"]);
        for (const id of ["node/pve3", "node/pve4"]) {
          expect(valuesOf(rowsOf(established, "pve_node_info", id))).toEqual([
            1,
          ]);
        }
        const markedAtMs: number =
          pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
        // pve4's mark was fresh already; only pve3's row is written.
        expect(harness.marks[harness.marks.length - 1]).toMatchObject({
          atMs: markedAtMs,
          markedAtMs,
          nodeNames: ["pve3", "pve4"],
          written: ["pve3"],
        });
        expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
          new Date(markedAtMs),
        );
      },
    );

    test("after an outage longer than the monitor window, a node already Offline that came back during it is never reported: not before its own first push back is processed, nor after", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      const marksBefore: number = harness.marks.length;

      /*
       * OneUptime processes nothing for 6 minutes. pve3 came back during
       * the outage; on the round back its push is processed after pve1's
       * and pve2's. To them pve3 still looks silent — no key, an old
       * sighting — and Offline; but its mark has aged out of the monitor
       * window, so neither reports it (it would read down on a node that
       * is up).
       */
      const resume: number = FIRST_REPORTING_ROUND + 1 + 36;
      harness.clock.nowMs = pushTimeMs(resume);
      expect(markAgeMs(harness, "pve3")).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );
      const firstBack: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        resume,
        ["pve1", "pve2", "pve3"],
      );
      expect(inferredRows(firstBack.get("pve1")!)).toEqual([]);
      expect(inferredRows(firstBack.get("pve2")!)).toEqual([]);
      expect(
        valuesOf(rowsOf(firstBack.get("pve3")!, "pve_up", "node/pve3")),
      ).toEqual([1]);
      expect(harness.inventory.get("pve3")!.isUp).toBe(true);

      // Through the warm-up and past it, nobody is reported or marked.
      const after: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + 1,
        to: resume + FIRST_REPORTING_ROUND + 2,
        nodes: ["pve1", "pve2", "pve3"],
      });
      expect(inferredRows(after)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);
      expect(harness.inventory.get("pve3")!.isUp).toBe(true);
      // pve1 is established again by then.
      const [streakStartMs, lastPushMs]: Array<number> = livenessEntry(
        harness.redis,
        "pve1",
      )!
        .value.split(",")
        .map(Number);
      expect(lastPushMs! - streakStartMs!).toBeGreaterThanOrEqual(
        PROXMOX_NODE_SILENCE_MS,
      );
    });
  });

  describe("failures and switches", () => {
    test.each<[string, CacheMethod]>([
      ["the own liveness read", "getString"],
      ["the own liveness write", "setString"],
      ["the sibling liveness read", "getStrings"],
    ])(
      "when %s fails, the push is ingested exactly as it came, with no report",
      async (_label: string, method: CacheMethod) => {
        const harness: SilentNodeHarness = setupSilentNodeHarness();
        await nodeRounds(harness, {
          from: 0,
          to: FIRST_REPORTING_ROUND - 2,
          nodes: ["pve1", "pve2"],
        });
        // A push that reports nothing, as the reference.
        const reference: Array<JSONObject> = (
          await nodeRound(harness, FIRST_REPORTING_ROUND - 1, ["pve1", "pve2"])
        ).get("pve1")!;
        expect(inferredRows(reference)).toEqual([]);

        harness.redis.failing.add(method);
        const upsertsBefore: number =
          harness.spies.bulkUpsert.mock.calls.length;
        const round: number = FIRST_REPORTING_ROUND;
        let rows: Array<JSONObject> = [];
        await expect(
          (async (): Promise<void> => {
            rows = await ingestAt(
              harness,
              pushTimeMs(round) + RECEIVE_STEP_MS,
              [nodePush("pve1", nanosAt(pushTimeMs(round)))],
            );
          })(),
        ).resolves.toBeUndefined();

        expect(inferredRows(rows)).toEqual([]);
        expect(
          rowSignature(rows).map((signature: string) => {
            return signature.replace(
              nanosAt(pushTimeMs(round)),
              nanosAt(pushTimeMs(round - 1)),
            );
          }),
        ).toEqual(rowSignature(reference));
        expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
        // The inventory is still written.
        expect(harness.spies.bulkUpsert.mock.calls.length).toBe(
          upsertsBefore + 1,
        );

        // Redis back: the next push reports again.
        harness.redis.failing.clear();
        harness.redis.failingInNamespace.clear();
        const recovered: Array<JSONObject> = await ingestAt(
          harness,
          pushTimeMs(round) + 2 * RECEIVE_STEP_MS,
          [nodePush("pve2", nanosAt(pushTimeMs(round)))],
        );
        expect(reportedIds(recovered)).toEqual(["node/pve3"]);
      },
    );

    test("when the sibling liveness read fails while no node is established, even the node already Offline and freshly marked is not reported: the push is ingested exactly as it came", async () => {
      /*
       * A processing gap of 90 s broke every streak; pve3's mark, 100 s
       * old on the resume, would let pve1 and pve2 go on reporting it.
       */
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const lastBeforeGap: number = FIRST_REPORTING_ROUND + 1;
      await nodeRounds(harness, {
        from: 0,
        to: lastBeforeGap,
        nodes: ["pve1", "pve2"],
      });
      expect(harness.inventory.get("pve3")!.isUp).toBe(false);
      const resume: number = lastBeforeGap + 9;
      const resumeAtMs: number = pushTimeMs(resume) + RECEIVE_STEP_MS;
      harness.clock.nowMs = resumeAtMs;
      expect(markAgeMs(harness, "pve3")).toBe(100_000);
      const marksBefore: number = harness.marks.length;

      harness.redis.failingInNamespace.add(
        failingIn("getStrings", LIVENESS_NAMESPACE),
      );
      const failed: Array<JSONObject> = (
        await nodeRound(harness, resume, ["pve1"])
      ).get("pve1")!;
      // Its streak restarted: nobody is established.
      expect(livenessEntry(harness.redis, "pve1")!.value).toBe(
        `${resumeAtMs},${resumeAtMs}`,
      );
      expect(inferredRows(failed)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);

      /*
       * Redis back: pve2's push, in the same round, continues pve3's
       * reports, and rewrites its mark.
       */
      harness.redis.failingInNamespace.clear();
      const recovered: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(resume) + 2 * RECEIVE_STEP_MS,
        [nodePush("pve2", nanosAt(pushTimeMs(resume)))],
      );
      expect(reportedIds(recovered)).toEqual(["node/pve3"]);
      expect(harness.marks.slice(marksBefore)).toMatchObject([
        {
          atMs: resumeAtMs + RECEIVE_STEP_MS,
          nodeNames: ["pve3"],
          written: ["pve3"],
        },
      ]);

      // pve1's push again, with the feature off, as the reference.
      process.env[DETECTION_ENV] = "false";
      const reference: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(resume) + 5_000,
        [nodePush("pve1", nanosAt(pushTimeMs(resume)))],
      );
      expect(inferredRows(reference)).toEqual([]);
      expect(rowSignature(failed)).toEqual(rowSignature(reference));
    });

    test("when the roster read fails, the push is ingested with no report", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      /*
       * The roster has been read (and cached) since the first push; let
       * the cached copy run out so the next push reads it again — and
       * that read fails.
       */
      clearProxmoxNodeRosterCache();
      harness.getNodeRoster.mockRejectedValueOnce(new Error("pg down"));
      const rosterReadsBefore: number = harness.getNodeRoster.mock.calls.length;

      const rows: Array<JSONObject> = (
        await nodeRound(harness, FIRST_REPORTING_ROUND, ["pve1"])
      ).get("pve1")!;

      expect(harness.getNodeRoster.mock.calls.length).toBe(
        rosterReadsBefore + 1,
      );
      expect(valuesOf(rowsOf(rows, "pve_up", "node/pve1"))).toEqual([1]);
      expect(inferredRows(rows)).toEqual([]);
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();

      // The failure is not cached: the next push reads again and reports.
      const recovered: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(FIRST_REPORTING_ROUND) + 2 * RECEIVE_STEP_MS,
        [nodePush("pve2", nanosAt(pushTimeMs(FIRST_REPORTING_ROUND)))],
      );
      expect(harness.getNodeRoster.mock.calls.length).toBe(
        rosterReadsBefore + 2,
      );
      expect(reportedIds(recovered)).toEqual(["node/pve3"]);
    });

    test("with Redis unreachable altogether, nothing is ever reported", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      harness.redis.failing.add("getString");
      harness.redis.failing.add("setString");
      harness.redis.failing.add("getStrings");
      harness.redis.failing.add("setStringIfNotExists");
      harness.redis.failing.add("deleteKey");

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 6,
        nodes: ["pve1", "pve2"],
      });

      expect(rowNames(rows)).toContain("pve_up");
      expect(inferredRows(rows)).toEqual([]);
      expect(harness.getNodeRoster).not.toHaveBeenCalled();
      expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
    });

    test.each(["false", "FALSE", " False "])(
      "PVE_NATIVE_NODE_SILENCE_DETECTION=%p makes no liveness call at all",
      async (value: string) => {
        process.env[DETECTION_ENV] = value;
        const harness: SilentNodeHarness = setupSilentNodeHarness();

        const rows: Array<JSONObject> = await nodeRounds(harness, {
          from: 0,
          to: FIRST_REPORTING_ROUND + 6,
          nodes: ["pve1", "pve2"],
        });

        expect(rowNames(rows)).toContain("pve_up");
        expect(inferredRows(rows)).toEqual([]);
        expect(livenessCalls(harness.redis)).toBe(0);
        expect(
          callsInNamespace(
            harness.redis.setStringIfNotExists,
            MARK_FENCE_NAMESPACE,
          ),
        ).toBe(0);
        expect(harness.getNodeRoster).not.toHaveBeenCalled();
        expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
      },
    );

    test.each(["true", "0", "no", ""])(
      "PVE_NATIVE_NODE_SILENCE_DETECTION=%p leaves detection on (only false turns it off)",
      async (value: string) => {
        process.env[DETECTION_ENV] = value;
        const harness: SilentNodeHarness = setupSilentNodeHarness();

        const rows: Array<JSONObject> = await nodeRounds(harness, {
          from: 0,
          to: FIRST_REPORTING_ROUND,
          nodes: ["pve1", "pve2"],
        });

        expect(reportedIds(rows)).toEqual(["node/pve3"]);
        expect(harness.markNodesNotReporting).toHaveBeenCalled();
      },
    );

    test("a native push with no discovered cluster records no liveness", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        clusterId: null,
      });

      const rows: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 2,
        nodes: ["pve1", "pve2"],
      });

      expect(rowNames(rows)).toContain("pve_up");
      expect(inferredRows(rows)).toEqual([]);
      expect(livenessCalls(harness.redis)).toBe(0);
      expect(harness.getNodeRoster).not.toHaveBeenCalled();
    });
  });

  describe("recovery", () => {
    test("once the silent node pushes again it is no longer reported, and its row comes back Online", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const before: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(before)).toEqual(["node/pve3"]);
      const marksBefore: number = harness.marks.length;

      // pve3 is back; its own push is processed first in this round.
      const round: number = FIRST_REPORTING_ROUND + 2;
      const rowsByNode: Map<string, Array<JSONObject>> = await nodeRound(
        harness,
        round,
        ["pve3", "pve1", "pve2"],
      );

      const pve3Rows: Array<JSONObject> = rowsByNode.get("pve3")!;
      expect(valuesOf(rowsOf(pve3Rows, "pve_up", "node/pve3"))).toEqual([1]);
      expect(inferredRows(pve3Rows)).toEqual([]);
      expect(inferredRows(rowsByNode.get("pve1")!)).toEqual([]);
      expect(inferredRows(rowsByNode.get("pve2")!)).toEqual([]);

      // Its own push flips the inventory row back: up, seen just now.
      const pve3Upserts: Array<ParsedProxmoxResource> = allUpsertedResources(
        harness,
      ).filter((r: ParsedProxmoxResource) => {
        return r.externalId === "node/pve3";
      });
      expect(pve3Upserts).toHaveLength(1);
      expect(pve3Upserts[0]!.isUp).toBe(true);
      expect(pve3Upserts[0]!.lastSeenAt).toEqual(new Date(pushTimeMs(round)));
      // …as a native-push row, kept should it go quiet again.
      expect(
        upsertCalls(harness.spies.bulkUpsert).filter((call: UpsertCall) => {
          return call.externalIds.includes("node/pve3");
        }),
      ).toEqual([
        {
          proxmoxClusterId: CLUSTER_ID.toString(),
          isNativePush: true,
          externalIds: ["node/pve3"],
        },
      ]);
      expect(livenessEntry(harness.redis, "pve3")).toBeDefined();

      // While it keeps pushing, nobody reports it or marks it again.
      const after: Array<JSONObject> = await nodeRounds(harness, {
        from: round + 1,
        to: round + 8,
        nodes: ["pve1", "pve2", "pve3"],
      });
      expect(inferredRows(after)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);
    });

    test("a node that comes back once and goes quiet again is reported again after its silence window", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });

      const comeback: number = FIRST_REPORTING_ROUND + 2;
      await nodeRound(harness, comeback, ["pve3", "pve1", "pve2"]);

      // Within 2 minutes of its one push, pve3 is not reported.
      const quiet: Array<JSONObject> = await nodeRounds(harness, {
        from: comeback + 1,
        to: comeback + FIRST_REPORTING_ROUND,
        nodes: ["pve1", "pve2"],
      });
      expect(inferredRows(quiet)).toEqual([]);

      const again: Array<JSONObject> = (
        await nodeRound(harness, comeback + FIRST_REPORTING_ROUND + 1, [
          "pve1",
          "pve2",
        ])
      ).get("pve1")!;
      expect(reportedIds(again)).toEqual(["node/pve3"]);
      const last: OfflineMark = harness.marks[harness.marks.length - 1]!;
      expect(last.nodeNames).toEqual(["pve3"]);
      expect(last.silentBefore.getTime()).toBeGreaterThan(pushTimeMs(comeback));
    });
  });
});

describe("Proxmox Agent batches are unaffected", () => {
  test("the agent's full scrape still counts itself, without an inventory read", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([agentBlock()]),
    );

    expect(spies.getInventorySummary).not.toHaveBeenCalled();
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      nodeCount: 2,
      onlineNodeCount: 1,
    });
  });

  test("the agent's rows are exactly the series it sent", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([agentBlock()]),
    );

    expect([...rowNames(spies.rows)].sort()).toEqual([
      "pve_node_info",
      "pve_up",
    ]);
    expect(spies.rows).toHaveLength(4);
  });

  test("the agent's blocks never touch native-push node liveness, the roster or the Offline marking", async () => {
    // The agent reports its own view of every node, pve2 down included.
    const harness: SilentNodeHarness = setupSilentNodeHarness();

    for (let round: number = 0; round <= FIRST_REPORTING_ROUND + 6; round++) {
      const rows: Array<JSONObject> = await ingestAt(
        harness,
        pushTimeMs(round) + RECEIVE_STEP_MS,
        [agentBlock()],
      );
      expect(rows).toHaveLength(4);
    }

    expect(livenessCalls(harness.redis)).toBe(0);
    expect(
      callsInNamespace(
        harness.redis.setStringIfNotExists,
        MARK_FENCE_NAMESPACE,
      ),
    ).toBe(0);
    expect(harness.getNodeRoster).not.toHaveBeenCalled();
    expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
    expect(inferredRows(harness.spies.rows)).toEqual([]);
    expect(
      harness.spies.rows.every((row: JSONObject) => {
        return attributesOf(row)["scope.name"] === undefined;
      }),
    ).toBe(true);
    /*
     * Every scrape is upserted as an agent row, so the prune treats a
     * vanished node the way it always has (15 minutes, not the
     * native-push retention window).
     */
    expect(harness.spies.bulkUpsert).toHaveBeenCalledTimes(
      FIRST_REPORTING_ROUND + 7,
    );
    expect(isNativePushValues(harness.spies.bulkUpsert)).toEqual(
      new Set([false]),
    );
    // …and never taken into the native-push keep: not even the fence is asked.
    expect(harness.spies.adoptNodesAsNativePush).not.toHaveBeenCalled();
    expect(
      callsInNamespace(
        harness.redis.setStringIfNotExists,
        ADOPT_FENCE_NAMESPACE,
      ),
    ).toBe(0);
    expect(harness.inventory.get("pve2")!.isNativePush).toBe(false);
  });
});

/*
 * ProxmoxResource.isNativePush records which path a row came from, and
 * the stale-row prune keeps a native-push Node row for the retention
 * window (the rows ARE the cluster's membership: nothing else says which
 * nodes a native-push cluster has), while agent rows keep the 15-minute
 * prune. The flush therefore passes the flag on every upsert, per
 * cluster: true for a batch of the native push, false — never left out —
 * for the agent's.
 */
describe("ProxmoxResource.isNativePush — every inventory upsert says which path it came from", () => {
  test("a native push's node, guest and storage rows are upserted with isNativePush: true", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush(), qemuPush(), storagePush()]),
    );

    expect(upsertCalls(spies.bulkUpsert)).toEqual([
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        isNativePush: true,
        externalIds: ["node/pve1", "qemu/100", "storage/pve1/local"],
      },
    ]);
  });

  test.each<[string, () => JSONObject, string]>([
    ["guest", qemuPush, "qemu/100"],
    ["storage", storagePush, "storage/pve1/local"],
  ])(
    "a native %s-only push is a native-push batch too: isNativePush: true",
    async (_kind: string, push: () => JSONObject, externalId: string) => {
      const spies: Spies = setupIngestMocks({});

      await OtelMetricsIngestService.processMetricsFromQueue(request([push()]));

      expect(upsertCalls(spies.bulkUpsert)).toEqual([
        {
          proxmoxClusterId: CLUSTER_ID.toString(),
          isNativePush: true,
          externalIds: [externalId],
        },
      ]);
      /*
       * It takes the cluster's Node rows into the native-push keep too —
       * those last seen up to its own observation.
       */
      expect(adoptionCalls(spies)).toEqual([
        {
          proxmoxClusterId: CLUSTER_ID.toString(),
          seenUpToMs: OBSERVED_AT.getTime(),
        },
      ]);
    },
  );

  test("an agent scrape is upserted with isNativePush: false", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([agentBlock()]),
    );

    expect(upsertCalls(spies.bulkUpsert)).toEqual([
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        isNativePush: false,
        externalIds: ["node/pve1", "node/pve2"],
      },
    ]);
    // Strictly false, not merely falsy.
    expect(spies.bulkUpsert.mock.calls[0]![0].isNativePush).toBe(false);
    // An agent scrape never takes a node into the native-push keep.
    expect(spies.adoptNodesAsNativePush).not.toHaveBeenCalled();
  });

  test.each<[string, boolean]>([
    ["the native block first", false],
    ["the agent block first", true],
  ])(
    "one request with a native block for one cluster and an agent block for another upserts each cluster with its own flag (%s)",
    async (_order: string, agentFirst: boolean) => {
      const spies: Spies = setupIngestMocks({
        inventory: {
          countsByKind: { Node: 3 },
          nodeOnlineCount: 3,
          guestRunningCount: 0,
        },
      });
      // "homelab" is pushed natively; "lab2" is scraped by the agent.
      spies.discoverProxmox.mockImplementation(
        (args: { attributes: JSONArray }): Promise<ObjectID | null> => {
          const names: Array<string> = stringAttr(
            args.attributes,
            "proxmox.cluster.name",
          );
          return Promise.resolve(
            names[0] === "lab2" ? OTHER_CLUSTER_ID : CLUSTER_ID,
          );
        },
      );

      /*
       * Both clusters have a node/pve1 and a node/pve2 — the flag must
       * follow the cluster, not the row id or the block order.
       */
      const native: Array<JSONObject> = [nodePush("pve1"), qemuPush("pve2")];
      const agent: JSONObject = agentBlock("lab2");
      await OtelMetricsIngestService.processMetricsFromQueue(
        request(agentFirst ? [agent, ...native] : [...native, agent]),
      );

      const calls: Array<UpsertCall> = upsertCalls(spies.bulkUpsert);
      expect(calls).toHaveLength(2);
      const byCluster: Map<string, UpsertCall> = new Map(
        calls.map((call: UpsertCall): [string, UpsertCall] => {
          return [call.proxmoxClusterId, call];
        }),
      );
      expect(byCluster.get(CLUSTER_ID.toString())).toEqual({
        proxmoxClusterId: CLUSTER_ID.toString(),
        isNativePush: true,
        externalIds: ["node/pve1", "qemu/100"],
      });
      expect(byCluster.get(OTHER_CLUSTER_ID.toString())).toEqual({
        proxmoxClusterId: OTHER_CLUSTER_ID.toString(),
        isNativePush: false,
        externalIds: ["node/pve1", "node/pve2"],
      });
      // Only the native cluster's Node rows are taken into the keep.
      expect(adoptionCalls(spies)).toEqual([
        {
          proxmoxClusterId: CLUSTER_ID.toString(),
          seenUpToMs: OBSERVED_AT.getTime(),
        },
      ]);

      /*
       * The same per-cluster verdict decides the counts: the native
       * cluster is recounted from its inventory, the agent's counts
       * itself from its scrape.
       */
      expect(spies.getInventorySummary).toHaveBeenCalledTimes(1);
      expect(
        spies.getInventorySummary.mock.calls[0]![0].proxmoxClusterId.toString(),
      ).toBe(CLUSTER_ID.toString());
      const agentCounts: Array<unknown> | undefined = (
        spies.updateLastSeen.mock.calls as Array<Array<unknown>>
      ).find((call: Array<unknown>) => {
        return (call[0] as ObjectID).toString() === OTHER_CLUSTER_ID.toString();
      });
      expect(agentCounts?.[1]).toEqual({ nodeCount: 2, onlineNodeCount: 1 });
    },
  );
});

/*
 * A native-push cluster's Node rows ARE its membership, so the prune
 * keeps a native-push Node row through the retention window. A node that
 * was already down under the Proxmox Agent (isNativePush false), or whose
 * row predates the flag (NULL), never pushes itself — without adoption
 * its row would be pruned before the live nodes first mark it (after a
 * gap, that takes the 2 minutes of warm-up), and it would drop off the
 * roster while still down. So a native batch, right after its upsert,
 * takes the Node rows of its cluster into the keep
 * (ProxmoxResourceService.adoptNodesAsNativePush) — those last seen no
 * later than the batch's own newest observation, so a batch processed
 * late never takes the agent's newer rows — fenced to once per 10
 * minutes per cluster (released when the adoption fails, so the next
 * push retries; kept when it succeeds), run anyway when the fence cannot
 * be asked, never for the agent, and never at the cost of the batch.
 */
describe("Proxmox VE native push — the cluster's Node rows are adopted into the native-push keep", () => {
  test("the first native flush adopts them right after its upsert — a node down under the agent and one from before the flag included — before anything marks them; they are then reported once a node is established", async () => {
    /*
     * Left behind by the agent: pve3 down (its last scrape 30 s ago, its
     * row's updatedAt that fresh) and pve4, whose row predates
     * isNativePush.
     */
    const lastScrapedMs: number = T0_MS - 30_000;
    const harness: SilentNodeHarness = setupSilentNodeHarness({
      inventory: { pve3: lastScrapedMs, pve4: lastScrapedMs },
      isUp: { pve3: false },
      isNativePush: { pve3: false, pve4: null },
    });

    await nodeRound(harness, 0, ["pve1", "pve2"]);

    /*
     * Once, on the first push's flush — up to that push's own time,
     * which the agent's last scrape precedes.
     */
    expect(adoptionCalls(harness.spies)).toEqual([
      { proxmoxClusterId: CLUSTER_ID.toString(), seenUpToMs: T0_MS },
    ]);
    expect(harness.adoptionsAtMs).toEqual([T0_MS + RECEIVE_STEP_MS]);
    const firstCall: (spy: jest.SpyInstance) => number = (
      spy: jest.SpyInstance,
    ): number => {
      return spy.mock.invocationCallOrder[0]!;
    };
    expect(firstCall(harness.spies.bulkUpsert)).toBeLessThan(
      firstCall(harness.spies.adoptNodesAsNativePush),
    );
    expect(firstCall(harness.spies.adoptNodesAsNativePush)).toBeLessThan(
      firstCall(harness.spies.bulkUpdateLatestMetrics),
    );

    /*
     * Every Node row is a native-push row now; nothing is marked yet.
     * Adopting a row is not a report: neither carries a mark, and their
     * updatedAt is still the agent's last write.
     */
    expect(harness.inventory.get("pve3")).toEqual({
      lastSeenAt: new Date(lastScrapedMs),
      isUp: false,
      isNativePush: true,
      notReportingMarkedAt: null,
      updatedAt: new Date(lastScrapedMs),
    });
    expect(harness.inventory.get("pve4")).toEqual({
      lastSeenAt: new Date(lastScrapedMs),
      isUp: true,
      isNativePush: true,
      notReportingMarkedAt: null,
      updatedAt: new Date(lastScrapedMs),
    });
    expect(harness.marks).toEqual([]);

    /*
     * Both then stay on the roster, and both are silent from round 10,
     * before any node is established. pve3 is Offline — the agent said
     * so 30 s before round 0, and its row's updatedAt is that fresh — but
     * it carries no mark: nothing has reported it on the native push, so
     * there are no reports of it to carry on. Neither is reported, nor
     * marked, until a node is established.
     */
    const silentRound: number = 10;
    expect(lastScrapedMs).toBeGreaterThanOrEqual(
      pushTimeMs(silentRound - 1) - PROXMOX_NODE_SILENCE_MS,
    );
    expect(lastScrapedMs).toBeLessThan(
      pushTimeMs(silentRound) - PROXMOX_NODE_SILENCE_MS,
    );
    expect(silentRound).toBeLessThan(FIRST_REPORTING_ROUND);
    const warmUp: Array<JSONObject> = await nodeRounds(harness, {
      from: 1,
      to: FIRST_REPORTING_ROUND - 1,
      nodes: ["pve1", "pve2"],
    });
    expect(inferredRows(warmUp)).toEqual([]);
    expect(harness.marks).toEqual([]);
    /*
     * The last roster read before pve1 was established — after the
     * adoption, pve3 silent, its updatedAt well within the monitor
     * window — held pve3 Offline and unmarked.
     */
    const servingRead: RosterRead = harness.rosterReads
      .filter((read: RosterRead) => {
        return read.atMs < pushTimeMs(FIRST_REPORTING_ROUND);
      })
      .pop()!;
    expect(servingRead.atMs).toBeGreaterThan(harness.adoptionsAtMs[0]!);
    expect(servingRead.atMs).toBeGreaterThan(pushTimeMs(silentRound));
    expect(
      servingRead.atMs - harness.inventory.get("pve3")!.updatedAt!.getTime(),
    ).toBeLessThanOrEqual(PROXMOX_MONITOR_WINDOW_MS);
    expect(
      servingRead.nodes.find((node: ProxmoxRosterNode) => {
        return node.nodeName === "pve3";
      }),
    ).toEqual({
      nodeName: "pve3",
      lastSeenAt: new Date(lastScrapedMs),
      isUp: false,
      notReportingMarkedAt: null,
    });

    /*
     * Once pve1 is established, both are reported by both live nodes —
     * D ÷ L = 2 ÷ 2, half each — and the first report marks both, on the
     * worker's clock. pve3 is still on the roster, a native-push row.
     */
    const established: Array<JSONObject> = await nodeRounds(harness, {
      from: FIRST_REPORTING_ROUND,
      to: FIRST_REPORTING_ROUND,
      nodes: ["pve1", "pve2"],
    });
    expect(reportedIds(established)).toEqual(["node/pve3", "node/pve4"]);
    for (const id of ["node/pve3", "node/pve4"]) {
      expect(valuesOf(rowsOf(established, "pve_node_info", id))).toEqual([
        0.5, 0.5,
      ]);
    }
    const markedAtMs: number =
      pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
    expect(harness.marks).toMatchObject([
      {
        atMs: markedAtMs,
        markedAtMs,
        nodeNames: ["pve3", "pve4"],
        written: ["pve3", "pve4"],
      },
    ]);
    expect(harness.inventory.get("pve3")).toEqual({
      lastSeenAt: new Date(lastScrapedMs),
      isUp: false,
      isNativePush: true,
      notReportingMarkedAt: new Date(markedAtMs),
      updatedAt: new Date(markedAtMs),
    });
    expect(harness.inventory.get("pve4")!.isUp).toBe(false);
    // Still the one adoption: the fence holds.
    expect(harness.adoptionsAtMs).toHaveLength(1);
  });

  test.each<[string, number | null, number]>([
    [
      "still down, Postgres's clock in step: first reported once a node is established",
      null,
      0,
    ],
    [
      "still down, Postgres's clock 10 minutes ahead, so its updatedAt reads as written at the first native push: first reported once a node is established",
      null,
      10 * 60_000,
    ],
    [
      "back during the switch, its first native push processed a minute after its siblings', Postgres's clock in step: never reported",
      6,
      0,
    ],
    [
      "back during the switch, its first native push processed a minute after its siblings', Postgres's clock 10 minutes ahead, so its updatedAt reads as written at the first native push: never reported",
      6,
      10 * 60_000,
    ],
  ])(
    "adopting a node the agent last saw Offline 10 minutes ago is not a report, however fresh its updatedAt — the node %s",
    async (
      _label: string,
      pve3FirstPushRound: number | null,
      postgresClockAheadMs: number,
    ) => {
      /*
       * The cluster moves from the Proxmox Agent to the native push. The
       * agent was stopped 10 minutes before the first native push; its
       * last scrape saw pve3 down and wrote its row Offline then — its
       * updatedAt stamped by Postgres, whose clock may run ahead.
       */
      const agentLastWriteMs: number = T0_MS - 10 * 60_000;
      const agentAtMs: number = agentLastWriteMs + RECEIVE_STEP_MS;
      const firstAtMs: number = T0_MS + RECEIVE_STEP_MS;
      const harness: SilentNodeHarness = setupSilentNodeHarness({
        inventory: {},
        postgresClockAheadMs,
      });
      await ingestAt(harness, agentAtMs, [
        agentBlock(
          "homelab",
          { pve1: true, pve2: true, pve3: false },
          nanosAt(agentLastWriteMs),
        ),
      ]);
      expect(harness.inventory.get("pve3")).toEqual({
        lastSeenAt: new Date(agentLastWriteMs),
        isUp: false,
        isNativePush: false,
        notReportingMarkedAt: null,
        updatedAt: new Date(agentAtMs + postgresClockAheadMs),
      });
      // As old as the agent's last scrape — or, 10 minutes ahead, brand new.
      expect(
        firstAtMs - harness.inventory.get("pve3")!.updatedAt!.getTime(),
      ).toBe(10 * 60_000 - postgresClockAheadMs);
      const nodesOf: (round: number) => Array<string> = (
        round: number,
      ): Array<string> => {
        return pve3FirstPushRound !== null && round >= pve3FirstPushRound
          ? ["pve1", "pve2", "pve3"]
          : ["pve1", "pve2"];
      };

      const warmUp: Array<JSONObject> = [];
      for (let round: number = 0; round < FIRST_REPORTING_ROUND; round++) {
        for (const nodeRows of (
          await nodeRound(harness, round, nodesOf(round))
        ).values()) {
          warmUp.push(...nodeRows);
        }
        if (round === 0) {
          /*
           * The first native flush adopts pve3's row — no mark, and its
           * updatedAt still the agent's write.
           */
          expect(harness.adoptionsAtMs).toEqual([firstAtMs]);
          expect(harness.inventory.get("pve3")).toEqual({
            lastSeenAt: new Date(agentLastWriteMs),
            isUp: false,
            isNativePush: true,
            notReportingMarkedAt: null,
            updatedAt: new Date(agentAtMs + postgresClockAheadMs),
          });
        }
      }

      /*
       * The pushes before pve3's own first one decided on a roster read
       * after the adoption: Offline and silent, pve3 was up for a
       * continuation — but nothing had marked it, whatever its updatedAt
       * said, and nobody is established, so nobody reported it, nor
       * marked it.
       */
      const readsBeforePve3: Array<RosterRead> = harness.rosterReads.filter(
        (read: RosterRead) => {
          return (
            read.atMs > harness.adoptionsAtMs[0]! && read.atMs < pushTimeMs(6)
          );
        },
      );
      expect(readsBeforePve3.length).toBeGreaterThan(0);
      for (const read of readsBeforePve3) {
        expect(
          read.nodes.find((node: ProxmoxRosterNode) => {
            return node.nodeName === "pve3";
          }),
        ).toEqual({
          nodeName: "pve3",
          lastSeenAt: new Date(agentLastWriteMs),
          isUp: false,
          notReportingMarkedAt: null,
        });
      }
      expect(inferredRows(warmUp)).toEqual([]);
      expect(harness.marks).toEqual([]);

      const later: Array<JSONObject> = [];
      for (
        let round: number = FIRST_REPORTING_ROUND;
        round <= FIRST_REPORTING_ROUND + 2;
        round++
      ) {
        for (const nodeRows of (
          await nodeRound(harness, round, nodesOf(round))
        ).values()) {
          later.push(...nodeRows);
        }
      }

      if (pve3FirstPushRound !== null) {
        // Up since its own first push, and never read down.
        expect(inferredRows(later)).toEqual([]);
        expect(harness.markNodesNotReporting).not.toHaveBeenCalled();
        expect(harness.inventory.get("pve3")!.isUp).toBe(true);
        expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toBeNull();
        expect(
          valuesOf(rowsOf([...warmUp, ...later], "pve_up", "node/pve3")),
        ).toEqual(
          new Array<number>(
            FIRST_REPORTING_ROUND + 3 - pve3FirstPushRound,
          ).fill(1),
        );
        return;
      }

      /*
       * Still down: once pve1 is established, both report it — 1 ÷ 2
       * each — and the first report marks it, on the worker's clock.
       */
      for (
        let round: number = FIRST_REPORTING_ROUND;
        round <= FIRST_REPORTING_ROUND + 2;
        round++
      ) {
        expect(
          valuesOf(
            rowsOf(rowsAtRound(later, round), "pve_node_info", "node/pve3"),
          ),
        ).toEqual([0.5, 0.5]);
      }
      const markedAtMs: number =
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS;
      expect(harness.marks).toMatchObject([
        {
          atMs: markedAtMs,
          markedAtMs,
          nodeNames: ["pve3"],
          written: ["pve3"],
        },
      ]);
      expect(harness.inventory.get("pve3")).toEqual({
        lastSeenAt: new Date(agentLastWriteMs),
        isUp: false,
        isNativePush: true,
        notReportingMarkedAt: new Date(markedAtMs),
        updatedAt: new Date(markedAtMs + postgresClockAheadMs),
      });
    },
  );

  test("it is fenced to once per 10 minutes per cluster", async () => {
    const harness: SilentNodeHarness = setupSilentNodeHarness({
      inventory: {},
    });
    // "homelab" and "lab2" both push natively.
    harness.spies.discoverProxmox.mockImplementation(
      (args: { attributes: JSONArray }): Promise<ObjectID | null> => {
        return Promise.resolve(
          stringAttr(args.attributes, "proxmox.cluster.name")[0] === "lab2"
            ? OTHER_CLUSTER_ID
            : CLUSTER_ID,
        );
      },
    );
    const pushBoth: (round: number) => Promise<void> = async (
      round: number,
    ): Promise<void> => {
      await ingestAt(harness, pushTimeMs(round) + RECEIVE_STEP_MS, [
        nodePush("pve1", nanosAt(pushTimeMs(round))),
      ]);
      await ingestAt(harness, pushTimeMs(round) + 2 * RECEIVE_STEP_MS, [
        nodePush("lab2-pve1", nanosAt(pushTimeMs(round)), "lab2"),
      ]);
    };

    // Ten minutes of pushes from a node of each cluster.
    const fenceRounds: number = (ADOPT_FENCE_SECONDS * 1000) / PUSH_INTERVAL_MS;
    for (let round: number = 0; round < fenceRounds; round++) {
      await pushBoth(round);
    }

    // Each cluster once, on its first push, up to that push's own time.
    expect(adoptionCalls(harness.spies)).toEqual([
      { proxmoxClusterId: CLUSTER_ID.toString(), seenUpToMs: pushTimeMs(0) },
      {
        proxmoxClusterId: OTHER_CLUSTER_ID.toString(),
        seenUpToMs: pushTimeMs(0),
      },
    ]);
    expect(harness.adoptionsAtMs).toEqual([
      T0_MS + RECEIVE_STEP_MS,
      T0_MS + 2 * RECEIVE_STEP_MS,
    ]);
    /*
     * A successful adoption keeps its fence: never released, each still
     * set from its first push.
     */
    expect(
      callsInNamespace(harness.redis.deleteKey, ADOPT_FENCE_NAMESPACE),
    ).toBe(0);
    expect(adoptFence(harness.redis, CLUSTER_ID)).toEqual({
      value: "1",
      expiresAtMs: T0_MS + RECEIVE_STEP_MS + ADOPT_FENCE_SECONDS * 1000,
    });
    expect(adoptFence(harness.redis, OTHER_CLUSTER_ID)).toEqual({
      value: "1",
      expiresAtMs: T0_MS + 2 * RECEIVE_STEP_MS + ADOPT_FENCE_SECONDS * 1000,
    });
    // Every native flush asked the fence — its own cluster's, for 10 minutes.
    const fenceCalls: Array<Array<unknown>> = (
      harness.redis.setStringIfNotExists.mock.calls as Array<Array<unknown>>
    ).filter((call: Array<unknown>) => {
      return call[0] === ADOPT_FENCE_NAMESPACE;
    });
    expect(fenceCalls).toHaveLength(2 * fenceRounds);
    for (const [index, call] of fenceCalls.entries()) {
      expect(call).toEqual([
        ADOPT_FENCE_NAMESPACE,
        index % 2 === 0 ? CLUSTER_ID.toString() : OTHER_CLUSTER_ID.toString(),
        "1",
        { expiresInSeconds: ADOPT_FENCE_SECONDS },
      ]);
    }

    // Ten minutes after its first adoption, each cluster's comes round again.
    await pushBoth(fenceRounds);
    expect(adoptionCalls(harness.spies).slice(2)).toEqual([
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        seenUpToMs: pushTimeMs(fenceRounds),
      },
      {
        proxmoxClusterId: OTHER_CLUSTER_ID.toString(),
        seenUpToMs: pushTimeMs(fenceRounds),
      },
    ]);
    expect(harness.adoptionsAtMs.slice(2)).toEqual([
      T0_MS + RECEIVE_STEP_MS + ADOPT_FENCE_SECONDS * 1000,
      T0_MS + 2 * RECEIVE_STEP_MS + ADOPT_FENCE_SECONDS * 1000,
    ]);
    expect(
      callsInNamespace(harness.redis.deleteKey, ADOPT_FENCE_NAMESPACE),
    ).toBe(0);
  });

  test("when the fence cannot be asked (Redis down), every native flush adopts, and the batch is ingested as usual", async () => {
    const harness: SilentNodeHarness = setupSilentNodeHarness();
    harness.redis.failing.add("setStringIfNotExists");

    const rows: Array<JSONObject> = await nodeRounds(harness, {
      from: 0,
      to: 2,
      nodes: ["pve1", "pve2"],
    });

    expect(
      callsInNamespace(
        harness.redis.setStringIfNotExists,
        ADOPT_FENCE_NAMESPACE,
      ),
    ).toBe(6);
    // Each up to its own push's time.
    expect(adoptionCalls(harness.spies)).toEqual(
      [0, 0, 1, 1, 2, 2].map((round: number): AdoptionCall => {
        return {
          proxmoxClusterId: CLUSTER_ID.toString(),
          seenUpToMs: pushTimeMs(round),
        };
      }),
    );
    // Nothing was taken, so nothing is released.
    expect(
      callsInNamespace(harness.redis.deleteKey, ADOPT_FENCE_NAMESPACE),
    ).toBe(0);
    expect(valuesOf(rowsOf(rows, "pve_up", "node/pve1"))).toEqual([1, 1, 1]);
    expect(harness.spies.bulkUpdateLatestMetrics).toHaveBeenCalledTimes(6);
    expect(harness.spies.updateLastSeen).toHaveBeenCalledTimes(6);
  });

  test("an adoption failure is logged and costs the batch nothing: its rows, its report, its Offline mark and its recount", async () => {
    /*
     * OneUptime was down for 3 minutes. pve3 is Offline already, marked
     * just before the outage (its notReportingMarkedAt, on the worker's
     * clock) — within the monitor window — so pve1's very first push back
     * reports it and, the mark being over a minute old, marks it afresh,
     * in the same flush as the failing adoption.
     */
    const markedAtMs: number = T0_MS - 3 * 60_000;
    const harness: SilentNodeHarness = setupSilentNodeHarness({
      inventory: { pve3: T0_MS - 10 * 60_000 },
      isUp: { pve3: false },
      notReportingMarkedAt: { pve3: markedAtMs },
      updatedAt: { pve3: markedAtMs },
    });
    harness.spies.adoptNodesAsNativePush.mockRejectedValue(
      new Error("pg down"),
    );
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    let rows: Array<JSONObject> = [];
    await expect(
      (async (): Promise<void> => {
        rows = await ingestAt(harness, T0_MS + RECEIVE_STEP_MS, [
          nodePush("pve1", nanosAt(T0_MS)),
        ]);
      })(),
    ).resolves.toBeUndefined();

    expect(harness.spies.adoptNodesAsNativePush).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `Proxmox native-push node adoption failed for cluster ${CLUSTER_ID.toString()}: pg down`,
    );
    // The fence it took is released, so the next push retries.
    expect(harness.redis.deleteKey.mock.calls).toEqual([
      [ADOPT_FENCE_NAMESPACE, CLUSTER_ID.toString()],
    ]);
    expect(adoptFence(harness.redis)).toBeUndefined();

    // The batch is ingested in full.
    expect(valuesOf(rowsOf(rows, "pve_up", "node/pve1"))).toEqual([1]);
    expect(reportedIds(rows)).toEqual(["node/pve3"]);
    expect(harness.spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(harness.spies.bulkUpdateLatestMetrics).toHaveBeenCalledTimes(1);
    expect(markedNodeSets(harness)).toEqual([["pve3"]]);
    expect(harness.marks[0]!.written).toEqual(["pve3"]);
    expect(harness.inventory.get("pve3")!.notReportingMarkedAt).toEqual(
      new Date(T0_MS + RECEIVE_STEP_MS),
    );
    expect(harness.spies.getInventorySummary).toHaveBeenCalledTimes(1);
    expect(harness.spies.updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a failed adoption releases its fence, so the very next native push adopts; once one succeeds, the fence holds", async () => {
    // Left behind by the agent: pve3, down, never a native-push row.
    const lastScrapedMs: number = T0_MS - 30_000;
    const harness: SilentNodeHarness = setupSilentNodeHarness({
      inventory: { pve3: lastScrapedMs },
      isUp: { pve3: false },
      isNativePush: { pve3: false },
    });
    harness.spies.adoptNodesAsNativePush.mockRejectedValueOnce(
      new Error("pg down"),
    );
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    // pve1's push takes the fence; its adoption fails and gives it back.
    await ingestAt(harness, T0_MS + RECEIVE_STEP_MS, [
      nodePush("pve1", nanosAt(T0_MS)),
    ]);
    expect(harness.spies.adoptNodesAsNativePush).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `Proxmox native-push node adoption failed for cluster ${CLUSTER_ID.toString()}: pg down`,
    );
    expect(harness.redis.deleteKey.mock.calls).toEqual([
      [ADOPT_FENCE_NAMESPACE, CLUSTER_ID.toString()],
    ]);
    expect(adoptFence(harness.redis)).toBeUndefined();
    expect(harness.inventory.get("pve3")!.isNativePush).toBe(false);

    // pve2's push, a moment later, takes it again and adopts.
    const retryAtMs: number = T0_MS + 2 * RECEIVE_STEP_MS;
    await ingestAt(harness, retryAtMs, [nodePush("pve2", nanosAt(T0_MS))]);
    expect(adoptionCalls(harness.spies)).toEqual([
      { proxmoxClusterId: CLUSTER_ID.toString(), seenUpToMs: T0_MS },
      { proxmoxClusterId: CLUSTER_ID.toString(), seenUpToMs: T0_MS },
    ]);
    expect(harness.adoptionsAtMs).toEqual([retryAtMs]);
    expect(harness.inventory.get("pve3")!.isNativePush).toBe(true);
    // That one succeeded: its fence is kept, for the full 10 minutes.
    expect(adoptFence(harness.redis)).toEqual({
      value: "1",
      expiresAtMs: retryAtMs + ADOPT_FENCE_SECONDS * 1000,
    });

    // The pushes after it neither adopt nor release anything.
    await nodeRounds(harness, { from: 1, to: 6, nodes: ["pve1", "pve2"] });
    expect(harness.spies.adoptNodesAsNativePush).toHaveBeenCalledTimes(2);
    expect(harness.redis.deleteKey).toHaveBeenCalledTimes(1);
    expect(adoptFence(harness.redis)!.expiresAtMs).toBe(
      retryAtMs + ADOPT_FENCE_SECONDS * 1000,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a failed adoption that never took the fence (Redis down) releases nothing", async () => {
    const harness: SilentNodeHarness = setupSilentNodeHarness();
    harness.redis.failingInNamespace.add(
      failingIn("setStringIfNotExists", ADOPT_FENCE_NAMESPACE),
    );
    harness.spies.adoptNodesAsNativePush.mockRejectedValue(
      new Error("pg down"),
    );
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    const rows: Array<JSONObject> = await nodeRounds(harness, {
      from: 0,
      to: 1,
      nodes: ["pve1", "pve2"],
    });

    // Every push tried, unfenced, and failed…
    expect(harness.spies.adoptNodesAsNativePush).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(4);
    // …and released nothing: it held no fence.
    expect(harness.redis.deleteKey).not.toHaveBeenCalled();
    expect(valuesOf(rowsOf(rows, "pve_up", "node/pve1"))).toEqual([1, 1]);
    expect(harness.spies.updateLastSeen).toHaveBeenCalledTimes(4);
  });

  test("when releasing the fence fails too, it is swallowed and the fence simply runs out: no adoption before then, one right after", async () => {
    const harness: SilentNodeHarness = setupSilentNodeHarness();
    harness.redis.failingInNamespace.add(
      failingIn("deleteKey", ADOPT_FENCE_NAMESPACE),
    );
    harness.spies.adoptNodesAsNativePush.mockRejectedValueOnce(
      new Error("pg down"),
    );
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    const failedAtMs: number = T0_MS + RECEIVE_STEP_MS;
    let rows: Array<JSONObject> = [];
    await expect(
      (async (): Promise<void> => {
        rows = await ingestAt(harness, failedAtMs, [
          nodePush("pve1", nanosAt(T0_MS)),
        ]);
      })(),
    ).resolves.toBeUndefined();
    expect(valuesOf(rowsOf(rows, "pve_up", "node/pve1"))).toEqual([1]);
    expect(harness.spies.bulkUpdateLatestMetrics).toHaveBeenCalledTimes(1);
    expect(harness.spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(harness.redis.deleteKey).toHaveBeenCalledTimes(1);
    // Only the adoption failure is logged.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(adoptFence(harness.redis)).toEqual({
      value: "1",
      expiresAtMs: failedAtMs + ADOPT_FENCE_SECONDS * 1000,
    });

    // Just before the fence runs out, a push does not adopt…
    const fenceEndsAtMs: number = failedAtMs + ADOPT_FENCE_SECONDS * 1000;
    await ingestAt(harness, fenceEndsAtMs - 1, [
      nodePush("pve1", nanosAt(fenceEndsAtMs - 1_000)),
    ]);
    expect(harness.spies.adoptNodesAsNativePush).toHaveBeenCalledTimes(1);

    // …the first one after it does.
    await ingestAt(harness, fenceEndsAtMs, [
      nodePush("pve1", nanosAt(fenceEndsAtMs - 500)),
    ]);
    expect(adoptionCalls(harness.spies)).toEqual([
      { proxmoxClusterId: CLUSTER_ID.toString(), seenUpToMs: T0_MS },
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        seenUpToMs: fenceEndsAtMs - 500,
      },
    ]);
    expect(harness.adoptionsAtMs).toEqual([fenceEndsAtMs]);
  });

  test("it takes only the rows last seen no later than the batch's newest observation: a batch processed late never takes a row the agent scraped after it", async () => {
    /*
     * The cluster moves between the agent and the native push. The
     * agent scraped pve3 20 s after this native batch's newest
     * observation; pve4 it last scraped before it.
     */
    const harness: SilentNodeHarness = setupSilentNodeHarness({
      inventory: { pve3: T0_MS + 20_000, pve4: T0_MS - 30_000 },
      isNativePush: { pve3: false, pve4: false },
    });

    // One request, its observations out of order, processed a minute late.
    await ingestAt(harness, T0_MS + 60_000, [
      nodePush("pve1", nanosAt(T0_MS)),
      qemuPush("pve1", nanosAt(T0_MS + 7_000)),
      storagePush("pve1", nanosAt(T0_MS - 5_000)),
    ]);

    // Up to the batch's newest observation, on the PVE clock.
    expect(
      allUpsertedResources(harness)
        .map((r: ParsedProxmoxResource) => {
          return `${r.externalId}@${r.lastSeenAt.getTime() - T0_MS}`;
        })
        .sort(),
    ).toEqual(["node/pve1@0", "qemu/100@7000", "storage/pve1/local@-5000"]);
    expect(adoptionCalls(harness.spies)).toEqual([
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        seenUpToMs: T0_MS + 7_000,
      },
    ]);
    // pve4 is taken into the keep; the agent's newer pve3 is left alone.
    expect(harness.inventory.get("pve4")!.isNativePush).toBe(true);
    expect(harness.inventory.get("pve3")!.isNativePush).toBe(false);
  });
});
