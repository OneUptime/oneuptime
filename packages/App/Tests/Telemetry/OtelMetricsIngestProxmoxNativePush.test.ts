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
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import {
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
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
 *     through the retention window.
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
    { "proxmox.node": node },
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
 * cluster's own view of every node, pve2 down included.
 */
function agentBlock(clusterName: string = "homelab"): JSONObject {
  return {
    resource: { attributes: attrs({ "proxmox.cluster.name": clusterName }) },
    scopeMetrics: [
      {
        scope: {},
        metrics: [
          gauge("pve_node_info", 1, { id: "node/pve1", name: "pve1" }),
          gauge("pve_up", 1, { id: "node/pve1" }),
          gauge("pve_node_info", 1, { id: "node/pve2", name: "pve2" }),
          gauge("pve_up", 0, { id: "node/pve2" }),
        ],
      },
    ],
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

  return {
    rows,
    discoverProxmox,
    resolveResource,
    bulkUpsert,
    bulkUpdateLatestMetrics,
    getInventorySummary,
    updateLastSeen,
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
 * reads OneUptime's receive clock (Date.now) and Redis, so the harness
 * drives both:
 *
 *   - Date.now is a hand-set receive clock,
 *   - GlobalCache is an in-memory store that honours TTLs on that
 *     clock, and can be made to fail method by method,
 *   - pushes are ingested round by round, every 10 s as pvestatd sends
 *     them, each node's push as a request of its own,
 *   - the inventory is a map that bulkUpsert feeds and getNodeRoster
 *     reads back, so a node's own push refreshes its roster row the way
 *     the real flush does, and a report never can.
 * ------------------------------------------------------------------
 */

const LIVENESS_NAMESPACE: string = "proxmox-native-node-live";
const MARK_FENCE_NAMESPACE: string = "proxmox-silent-node-mark";

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
  | "setStringIfNotExists";

interface FakeRedisEntry {
  value: string;
  expiresAtMs: number | null;
}

interface FakeRedis {
  // `${namespace}-${key}` → entry, as GlobalCache keys Redis.
  entries: Map<string, FakeRedisEntry>;
  // Methods that currently reject, as they would with Redis down.
  failing: Set<CacheMethod>;
  getString: jest.SpyInstance;
  setString: jest.SpyInstance;
  getStrings: jest.SpyInstance;
  setStringIfNotExists: jest.SpyInstance;
}

function installFakeRedis(): FakeRedis {
  const entries: Map<string, FakeRedisEntry> = new Map();
  const failing: Set<CacheMethod> = new Set();

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

  const outage: (method: CacheMethod) => Error | null = (
    method: CacheMethod,
  ): Error | null => {
    return failing.has(method) ? new Error(`redis down (${method})`) : null;
  };

  const getString: jest.SpyInstance = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      (namespace: string, key: string): Promise<string | null> => {
        const error: Error | null = outage("getString");
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
        const error: Error | null = outage("setString");
        if (error) {
          return Promise.reject(error);
        }
        write(namespace, key, value, options);
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
        const error: Error | null = outage("getStrings");
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
        const error: Error | null = outage("setStringIfNotExists");
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

  return {
    entries,
    failing,
    getString,
    setString,
    getStrings,
    setStringIfNotExists,
  };
}

// OneUptime's receive clock — what Date.now returns while a test runs.
interface ReceiveClock {
  nowMs: number;
}

// One markNodesNotReporting write, with the receive time it was made at.
interface OfflineMark {
  atMs: number;
  projectId: ObjectID;
  proxmoxClusterId: ObjectID;
  nodeNames: Array<string>;
  silentBefore: Date;
}

interface SilentNodeHarness {
  spies: Spies;
  redis: FakeRedis;
  clock: ReceiveClock;
  // The inventory's Node rows: node name → lastSeenAt (its own last push).
  inventory: Map<string, Date>;
  getNodeRoster: jest.SpyInstance;
  // The receive time of every roster read, in order.
  rosterReadsAtMs: Array<number>;
  markNodesNotReporting: jest.SpyInstance;
  marks: Array<OfflineMark>;
}

function setupSilentNodeHarness(
  data: {
    // Node name → lastSeenAt (ms) already in the inventory at round 0.
    inventory?: Record<string, number>;
    clusterId?: ObjectID | null;
  } = {},
): SilentNodeHarness {
  const spies: Spies = setupIngestMocks(
    data.clusterId === undefined ? {} : { clusterId: data.clusterId },
  );

  const clock: ReceiveClock = { nowMs: T0_MS };
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clock.nowMs;
  });

  const redis: FakeRedis = installFakeRedis();

  const inventory: Map<string, Date> = new Map();
  for (const [nodeName, lastSeenMs] of Object.entries(
    data.inventory || { pve3: PVE3_LAST_SEEN_MS },
  )) {
    inventory.set(nodeName, new Date(lastSeenMs));
  }

  spies.bulkUpsert.mockImplementation(
    (...args: Array<unknown>): Promise<void> => {
      const upsert: { resources: Array<ParsedProxmoxResource> } = args[0] as {
        resources: Array<ParsedProxmoxResource>;
      };
      for (const resource of upsert.resources) {
        if (
          resource.kind === "Node" &&
          resource.externalId.startsWith("node/")
        ) {
          inventory.set(
            resource.externalId.substring("node/".length),
            resource.lastSeenAt,
          );
        }
      }
      return Promise.resolve();
    },
  );

  const rosterReadsAtMs: Array<number> = [];
  const getNodeRoster: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "getNodeRoster")
    .mockImplementation((): Promise<Array<ProxmoxRosterNode>> => {
      rosterReadsAtMs.push(Date.now());
      return Promise.resolve(
        Array.from(inventory.entries()).map(
          ([nodeName, lastSeenAt]: [string, Date]): ProxmoxRosterNode => {
            return { nodeName, lastSeenAt };
          },
        ),
      );
    });

  const marks: Array<OfflineMark> = [];
  const markNodesNotReporting: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "markNodesNotReporting")
    .mockImplementation(
      (mark: {
        projectId: ObjectID;
        proxmoxClusterId: ObjectID;
        nodeNames: Array<string>;
        silentBefore: Date;
      }): Promise<number> => {
        marks.push({ atMs: Date.now(), ...mark });
        return Promise.resolve(mark.nodeNames.length);
      },
    );

  return {
    spies,
    redis,
    clock,
    inventory,
    getNodeRoster,
    rosterReadsAtMs,
    markNodesNotReporting,
    marks,
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

// Every GlobalCache call that read or wrote node liveness.
function livenessCalls(redis: FakeRedis): number {
  return (
    callsInNamespace(redis.getString, LIVENESS_NAMESPACE) +
    callsInNamespace(redis.setString, LIVENESS_NAMESPACE) +
    callsInNamespace(redis.getStrings, LIVENESS_NAMESPACE) +
    callsInNamespace(redis.setStringIfNotExists, LIVENESS_NAMESPACE)
  );
}

function livenessEntry(
  redis: FakeRedis,
  nodeName: string,
): FakeRedisEntry | undefined {
  return redis.entries.get(
    `${LIVENESS_NAMESPACE}-${PROJECT_ID.toString()}:${CLUSTER_ID.toString()}:${nodeName}`,
  );
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

beforeEach(() => {
  // Rosters are cached per ingest worker; every test starts cold.
  clearProxmoxNodeRosterCache();
});

afterEach(() => {
  jest.restoreAllMocks();
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
 *     D ÷ (live nodes) for each silent sibling, with the sibling's own
 *     labels, at the reporter's own timestamp,
 *   - Sum/Sum over those rows is exactly L ÷ (L + D) on every minute,
 *     however unevenly the pushes fall into it,
 *   - reports never refresh the silent node's inventory row; the flush
 *     marks it Offline instead (after the upsert, before the recount),
 *     at most once per 30 s per node set, and every live node's own row
 *     is upserted as a native-push row (isNativePush: true),
 *   - nothing is reported by a guest or storage push, before any node
 *     has pushed continuously for 2 minutes (after an ingest outage
 *     too, even one a little shorter than the silence window), by a
 *     standalone host, when Redis or the roster fails, or when the
 *     feature is switched off,
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
      expect(harness.inventory.get("pve3")).toEqual(
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

      await ingestAt(
        harness,
        pushTimeMs(FIRST_REPORTING_ROUND) + RECEIVE_STEP_MS,
        [nodePush("pve1", nanosAt(pushTimeMs(FIRST_REPORTING_ROUND)))],
      );

      expect(harness.marks).toHaveLength(1);
      const mark: OfflineMark = harness.marks[0]!;
      expect(mark.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(mark.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
      expect(mark.nodeNames).toEqual(["pve3"]);
      // pve1's own push time minus the 2-minute silence window.
      expect(mark.silentBefore).toEqual(
        new Date(pushTimeMs(FIRST_REPORTING_ROUND) - PROXMOX_NODE_SILENCE_MS),
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
      // Every write carries its own report's time.
      for (const mark of harness.marks) {
        expect(mark.silentBefore.getTime()).toBe(
          mark.atMs - RECEIVE_STEP_MS - PROXMOX_NODE_SILENCE_MS,
        );
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

    test("after an ingest outage nobody reports until they have pushed for 2 minutes again, and a live sibling is never reported", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const before: Array<JSONObject> = await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(before)).toEqual(["node/pve3"]);
      const siblingReadsBefore: number = callsInNamespace(
        harness.redis.getStrings,
        LIVENESS_NAMESPACE,
      );
      const marksBefore: number = harness.marks.length;

      /*
       * OneUptime processes nothing for 3 minutes: every key expires. On
       * the first round back, pve1 is processed before pve2, so it sees
       * pve2 as silent (no key, and an inventory sighting from before the
       * outage) — and would report it, were any node established.
       */
      const resume: number = FIRST_REPORTING_ROUND + 2 + 18;
      const afterOutage: Array<JSONObject> = await nodeRounds(harness, {
        from: resume,
        to: resume + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2"],
      });
      // The siblings are read on every push, but nobody is established.
      expect(
        callsInNamespace(harness.redis.getStrings, LIVENESS_NAMESPACE),
      ).toBe(siblingReadsBefore + 2 * FIRST_REPORTING_ROUND);
      expect(inferredRows(afterOutage)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);

      // Two minutes after the resume, only the node really gone is reported.
      const later: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + FIRST_REPORTING_ROUND,
        to: resume + FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      expect(reportedIds(later)).toEqual(["node/pve3"]);
    });

    test("after an ingest outage a little shorter than the silence window, a sibling whose streak it broke vouches for nobody: the first node back never reports a live sibling", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      const lastRound: number = FIRST_REPORTING_ROUND + 1;
      await nodeRounds(harness, {
        from: 0,
        to: lastRound,
        nodes: ["pve1", "pve2", "pve4"],
      });
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
      expect(harness.inventory.get("pve4")!.getTime()).toBeLessThan(
        pushTimeMs(resume) - PROXMOX_NODE_SILENCE_MS,
      );
      /*
       * pve2's key, written before the outage, is still alive, over a
       * streak of more than 2 minutes — but its last push is more than a
       * minute old: the streak is broken, so pve2 is not established and
       * nobody may report.
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

      // pve1 is processed first on the round back, pve4 last.
      const afterOutage: Array<JSONObject> = await nodeRounds(harness, {
        from: resume,
        to: resume + FIRST_REPORTING_ROUND - 1,
        nodes: ["pve1", "pve2", "pve4"],
      });
      expect(inferredRows(afterOutage)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);

      // Two minutes after the resume, only the node really gone is reported.
      const later: Array<JSONObject> = await nodeRounds(harness, {
        from: resume + FIRST_REPORTING_ROUND,
        to: resume + FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2", "pve4"],
      });
      expect(reportedIds(later)).toEqual(["node/pve3"]);
      expect(
        markedNodeSets(harness)
          .slice(marksBefore)
          .map((nodeNames: Array<string>) => {
            return nodeNames.join(",");
          }),
      ).toEqual(["pve3"]);
    });

    test("an established node quiet for over a minute stops vouching for a sibling still warming up, which reports again once established itself", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      // pve1 pushes from round 0; pve2 joins at round 10.
      const joined: number = 10;
      await nodeRounds(harness, {
        from: 0,
        to: joined - 1,
        nodes: ["pve1"],
      });
      // pve1 is established from the first reporting round; then it goes quiet.
      const pve1LastRound: number = FIRST_REPORTING_ROUND + 2;
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

      // For a minute after pve1's last push, it still vouches for pve2.
      const vouchRounds: number = PROXMOX_NODE_STREAK_GAP_MS / PUSH_INTERVAL_MS;
      const vouched: Array<JSONObject> = await nodeRounds(harness, {
        from: pve1LastRound + 1,
        to: pve1LastRound + vouchRounds,
        nodes: ["pve2"],
      });
      // pve1 still counts live: D ÷ L = 1 ÷ 2 on each of pve2's pushes.
      expect(reportedIds(vouched)).toEqual(["node/pve3"]);
      expect(valuesOf(rowsOf(vouched, "pve_node_info", "node/pve3"))).toEqual(
        new Array<number>(vouchRounds).fill(0.5),
      );

      /*
       * Then pve1's streak is broken — its last push is over a minute
       * old, though it still counts as live — and pve2 has not pushed
       * for 2 minutes yet: nobody is established, nothing is reported.
       */
      const pve2EstablishedRound: number = joined + FIRST_REPORTING_ROUND + 1;
      const firstUnvouchedAtMs: number =
        pushTimeMs(pve1LastRound + vouchRounds + 1) + RECEIVE_STEP_MS;
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
      const marksBefore: number = harness.marks.length;
      const unvouched: Array<JSONObject> = await nodeRounds(harness, {
        from: pve1LastRound + vouchRounds + 1,
        to: pve2EstablishedRound - 1,
        nodes: ["pve2"],
      });
      expect(unvouched.length).toBeGreaterThan(0);
      expect(inferredRows(unvouched)).toEqual([]);
      expect(harness.marks).toHaveLength(marksBefore);

      // Once pve2 has pushed for 2 minutes itself, it reports again.
      const established: Array<JSONObject> = (
        await nodeRound(harness, pve2EstablishedRound, ["pve2"])
      ).get("pve2")!;
      expect(
        pushTimeMs(pve2EstablishedRound) + RECEIVE_STEP_MS - pve2StreakStartMs,
      ).toBeGreaterThanOrEqual(PROXMOX_NODE_SILENCE_MS);
      expect(reportedIds(established)).toEqual(["node/pve3"]);
      expect(
        valuesOf(rowsOf(established, "pve_node_info", "node/pve3")),
      ).toEqual([0.5]);
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
      // …so no sibling liveness is even read.
      expect(
        callsInNamespace(harness.redis.getStrings, LIVENESS_NAMESPACE),
      ).toBe(0);
    });

    test("after the whole cluster went dark, the first node back never reports a sibling booting less than 2 minutes behind it", async () => {
      const harness: SilentNodeHarness = setupSilentNodeHarness();
      await nodeRounds(harness, {
        from: 0,
        to: FIRST_REPORTING_ROUND + 1,
        nodes: ["pve1", "pve2"],
      });
      const marksBefore: number = harness.marks.length;

      /*
       * Power cut: nothing from any node for 10 minutes. pve1 boots
       * first; pve2 follows 90 s later. Neither is reported while the
       * other is still coming up, and nothing reports during the dark.
       */
      const powerBack: number = FIRST_REPORTING_ROUND + 2 + 60;
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
      // Once pve1 may report again, only the node still down is reported.
      expect(reportedIds(bothBack)).toEqual(["node/pve3"]);
      expect(
        harness.marks.slice(marksBefore).every((mark: OfflineMark) => {
          return mark.nodeNames.join(",") === "pve3";
        }),
      ).toBe(true);
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
        harness.inventory.set("pve3", new Date(pushTimeMs(round)));
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
        const recovered: Array<JSONObject> = await ingestAt(
          harness,
          pushTimeMs(round) + 2 * RECEIVE_STEP_MS,
          [nodePush("pve2", nanosAt(pushTimeMs(round)))],
        );
        expect(reportedIds(recovered)).toEqual(["node/pve3"]);
      },
    );

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
