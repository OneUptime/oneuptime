import crypto from "crypto";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import {
  PROXMOX_NATIVE_PUSH_SERVICE_NAME,
  appendProxmoxSiblingReportsInPlace,
  isProxmoxNativePushResource,
  isProxmoxSiblingReportScope,
  normalizeProxmoxNativePushInPlace,
  readProxmoxNativeNodeStatus,
} from "Common/Server/Utils/Telemetry/ProxmoxNativePush";
import {
  PROXMOX_NODE_SILENCE_MS,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  ProxmoxSilentNodeReport,
  isProxmoxSilentNodeDetectionEnabled,
  recordProxmoxNodePushAndFindSilentNodes,
} from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";

/*
 * ------------------------------------------------------------------
 * A Proxmox VE cluster pushing natively over OTLP, and the three
 * stores the alert path touches — for ProxmoxNativeSilentNodeAlerts.
 * ------------------------------------------------------------------
 *
 * Not a test file (no `.test.ts`): the suite wires these into its jest
 * mocks and spies. Everything here runs on ONE clock — the process
 * clock, which the suite fakes and moves to each push's receive time
 * (`setClock`) before ingesting it, exactly as OneUptime's own receive
 * clock would read.
 *
 *   ProxmoxNativeClusterSimulator  every node's pvestatd pushing its
 *     node / qemu / lxc / storage status as four separate OTLP requests
 *     every ~10 s (a random phase per node, per-push jitter, a small
 *     clock skew, `timeUnixNano = ctime * 1e9` in whole seconds like
 *     PVE::Status::OpenTelemetry), deaths / returns, a OneUptime ingest
 *     outage (Redis wiped, or keeping its keys until they expire), and
 *     OneUptime falling behind on one node's requests (processed in
 *     bursts). Each request is ingested the way OtelMetricsIngestService
 *     does it, with the REAL functions: normalizeProxmoxNativePushInPlace
 *     → readProxmoxNativeNodeStatus → recordProxmoxNodePushAndFindSilentNodes
 *     (hence the real nextProxmoxNodeLiveness / isAliveProxmoxNode /
 *     isEligibleProxmoxReporter / decideProxmoxSilentNodes and its 30 s
 *     roster cache) → appendProxmoxSiblingReportsInPlace → Metric rows →
 *     the flush, in flushProxmoxSnapshotBuffers' order: the inventory fold
 *     (bulkUpsert; sibling-report scope skipped; a newer own point clears
 *     the row's notReportingMarkedAt), the native-push adoption
 *     (adoptNodesAsNativePush, fenced to once per 10 minutes per cluster,
 *     up to the batch's newest point; isNativePush only — never the mark,
 *     never updatedAt), the Offline mark of the nodes the push reported
 *     (markNodesNotReporting, fenced to once per 30 s per cluster and set
 *     of nodes; notReportingMarkedAt written as markedAt — the ingest
 *     worker's clock — and an Offline row's refreshed once over a minute
 *     old on that clock) → the cluster heartbeat.
 *
 *   The inventory  the cluster's Node rows (lastSeenAt on the node's own
 *     clock; isUp — Online from the node's own pve_up = 1, Offline once
 *     marked; isNativePush; notReportingMarkedAt — the mark: written only
 *     by markNodesNotReporting, on the WORKER's clock, refreshed at most
 *     once a minute while the node stays reported, cleared by the node's
 *     own fold, null for a row never reported; updatedAt — every write of
 *     the row, on the DATABASE's clock (its now()): the fold, the mark;
 *     the database's clock runs `databaseClockOffsetMs` ahead of the
 *     workers', 0 unless a scenario skews it) — the roster
 *     ProxmoxResourceService.getNodeRoster reads, isUp and the mark
 *     included (never updatedAt), with the real
 *     getSilentNodeRetentionCutoff; it may start with the rows an earlier
 *     collector left (`initialNodeRows`) — and the
 *     Proxmox:CleanupStaleResources cron every 5 minutes on the wall clock:
 *     markDisconnectedClusters (the cluster's lastSeenAt older than 15
 *     minutes), then, for a connected cluster, deleteStaleForCluster's
 *     predicate with the real getStaleThresholdDate (anchored to the
 *     cluster's lastSeenAt) and getSilentNodeRetentionCutoff: a Node row
 *     older than the cutoff is pruned unless it is native-push and last
 *     seen within the retention window. The cluster's lastSeenAt is the
 *     receive time of the last request processed — the freshest the
 *     heartbeat can be (its 60 s throttle only makes it older), so the
 *     anchored cutoff is the latest it can be: the prune at its harshest.
 *     Guest and storage rows are not modelled: the roster never reads
 *     them.
 *
 *   SimulatedRedis  what GlobalCache.getString / getStrings / setString
 *     reach: an in-memory key store with Redis EX expiry — each node's
 *     liveness key (SILENCE_MS), lost when Redis is — and SET NX EX
 *     (setStringIfNotExists) for the flush's fences, which the simulator
 *     mirrors as it mirrors the flush. Nothing of the continuation's gate
 *     lives in Redis: it reads the inventory's notReportingMarkedAt. Each
 *     push records the Offline rows of the roster its decision read, with
 *     their mark, and when that roster was read — the core caches it for
 *     30 s and takes the marks' age then — so the suite can check its own
 *     model of the mark and of the cache.
 *
 *   SimulatedMetricTable  the ClickHouse Metric table as MetricService
 *     findBy / aggregateBy answer the Proxmox monitor: rows flattened
 *     like the ingest service flattens them (TelemetryUtil.getAttributes,
 *     `resource.` prefix, `scope.*`), WHERE projectId / name / time
 *     BETWEEN (inclusive) / `attributes['k'] = 'v'` (a missing key reads
 *     ''), ORDER BY time, LIMIT / OFFSET, and for aggregateBy the
 *     per-minute bucket the window picks (AggregationIntervalUtil) with
 *     Sum / Avg / Min / Max / Count. Sum adds a bucket's values in a
 *     shuffled order, since ClickHouse promises none. Any query shape it
 *     does not emulate throws instead of being silently ignored.
 *
 * Only pve_* rows are stored — the Proxmox templates read nothing else,
 * and the original proxmox_* series would only cost memory. A big
 * cluster can narrow that further (`storedNames`) and push node status
 * only (`pushKinds`).
 * ------------------------------------------------------------------
 */

const MINUTE_MS: number = 60_000;
const PUSH_INTERVAL_MS: number = 10_000;
const GIB: number = 1024 * 1024 * 1024;

// Proxmox:CleanupStaleResources runs on EVERY_FIVE_MINUTE ("*/5 * * * *").
const CLEANUP_INTERVAL_MS: number = 5 * MINUTE_MS;

// ProxmoxClusterService.markDisconnectedClusters' threshold.
const DISCONNECTED_AFTER_MS: number = 15 * MINUTE_MS;

// GlobalCache.setString's expiry when none is given (30 days).
const DEFAULT_CACHE_EXPIRY_SECONDS: number = 30 * 24 * 60 * 60;

/*
 * OtelMetricsIngestService's flush fences (module-private there): the
 * Offline mark once per 30 s per cluster and set of nodes, the native-push
 * adoption once per 10 minutes per cluster.
 */
export const SILENT_NODE_MARK_FENCE_NAMESPACE: string =
  "proxmox-silent-node-mark";
export const SILENT_NODE_MARK_FENCE_SECONDS: number = 30;
export const NATIVE_ADOPTION_FENCE_NAMESPACE: string = "proxmox-native-adopt";
export const NATIVE_ADOPTION_FENCE_SECONDS: number = 600;

/*
 * markNodesNotReporting's refresh guard (in its SQL:
 * "notReportingMarkedAt" IS NULL OR "notReportingMarkedAt" < $6, $6 =
 * markedAt - 60 s, on the worker's clock): a row already Offline and
 * native is written again — its mark refreshed — only once its mark is
 * missing or over a minute older than the worker's now.
 */
export const SILENT_NODE_MARK_REFRESH_MS: number = 60_000;

// mulberry32 — small, fast and fully deterministic for a given seed.
export function createSeededRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed: number = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function toNumberOrNull(raw: JSONValue | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed: number = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ---- PVE::Status::OpenTelemetry-shaped payloads ------------------------

export type NativePushKind = "node" | "qemu" | "lxc" | "storage";

const PUSH_KINDS: Array<NativePushKind> = ["node", "qemu", "lxc", "storage"];

function stringAttributes(values: Dictionary<string>): JSONArray {
  return Object.keys(values).map((key: string) => {
    return { key: key, value: { stringValue: values[key] as string } };
  });
}

function dataPoint(data: {
  value: number;
  labels: Dictionary<string>;
  timeUnixNano: number;
}): JSONObject {
  const point: JSONObject = {
    timeUnixNano: data.timeUnixNano,
    attributes: stringAttributes(data.labels),
  };
  // PVE sends integers as asInt and fractions as asDouble.
  if (Number.isInteger(data.value)) {
    point["asInt"] = data.value;
  } else {
    point["asDouble"] = data.value;
  }
  return point;
}

function gauge(
  name: string,
  value: number,
  labels: Dictionary<string>,
  timeUnixNano: number,
): JSONObject {
  return {
    name: name,
    gauge: {
      dataPoints: [dataPoint({ value, labels, timeUnixNano })],
    },
  };
}

function counter(
  name: string,
  value: number,
  labels: Dictionary<string>,
  timeUnixNano: number,
): JSONObject {
  return {
    name: name,
    sum: {
      dataPoints: [dataPoint({ value, labels, timeUnixNano })],
      aggregationTemporality: 2,
      isMonotonic: true,
    },
  };
}

/*
 * One OTLP request of one pvestatd status pass. Resource attributes are
 * what pve-manager stamps; identity rides in datapoint attributes.
 */
export function buildNativePushEnvelope(data: {
  kind: NativePushKind;
  clusterName: string;
  nodeName: string;
  nodeIndex: number;
  ctimeSeconds: number;
  uptimeSeconds: number;
}): JSONObject {
  const timeUnixNano: number = data.ctimeSeconds * 1_000_000_000;
  const node: Dictionary<string> = { node: data.nodeName };
  let metrics: Array<JSONObject> = [];

  if (data.kind === "node") {
    metrics = [
      gauge("proxmox_node_uptime", data.uptimeSeconds, node, timeUnixNano),
      gauge("proxmox_node_cpustat_cpu", 0.125, node, timeUnixNano),
      gauge("proxmox_node_cpustat_cpus", 16, node, timeUnixNano),
      gauge("proxmox_node_memory_memused", 16 * GIB, node, timeUnixNano),
      gauge("proxmox_node_memory_memtotal", 64 * GIB, node, timeUnixNano),
      gauge("proxmox_node_blockstat_used", 40 * GIB, node, timeUnixNano),
      gauge("proxmox_node_blockstat_total", 100 * GIB, node, timeUnixNano),
      counter(
        "proxmox_node_network_receive_total",
        data.uptimeSeconds * 1000,
        { node: data.nodeName, device: "vmbr0" },
        timeUnixNano,
      ),
    ];
  } else if (data.kind === "qemu" || data.kind === "lxc") {
    const vmid: string = String(
      (data.kind === "qemu" ? 100 : 200) + data.nodeIndex,
    );
    const guest: Dictionary<string> = {
      vmid: vmid,
      node: data.nodeName,
      name: `${data.kind}-${vmid}`,
      type: data.kind,
    };
    metrics = [
      gauge("proxmox_vm_uptime", data.uptimeSeconds, guest, timeUnixNano),
      gauge("proxmox_vm_cpu", 0.25, guest, timeUnixNano),
      gauge("proxmox_vm_cpus", 2, guest, timeUnixNano),
      gauge("proxmox_vm_mem", 2 * GIB, guest, timeUnixNano),
      gauge("proxmox_vm_maxmem", 4 * GIB, guest, timeUnixNano),
      counter("proxmox_vm_netin_total", 4096, guest, timeUnixNano),
    ];
  } else {
    const storage: Dictionary<string> = {
      node: data.nodeName,
      storage: "local",
    };
    metrics = [
      gauge("proxmox_storage_total", 100 * GIB, storage, timeUnixNano),
      gauge("proxmox_storage_used", 40 * GIB, storage, timeUnixNano),
      gauge("proxmox_storage_active", 1, storage, timeUnixNano),
    ];
  }

  return {
    resource: {
      attributes: stringAttributes({
        "service.name": PROXMOX_NATIVE_PUSH_SERVICE_NAME,
        "service.version": "9.0.10/deb1ca707ec72a89",
        "proxmox.cluster": data.clusterName,
        "proxmox.node": data.nodeName,
      }),
    },
    scopeMetrics: [{ scope: {}, metrics: metrics }],
  };
}

// ---- Redis, as GlobalCache's string calls reach it ----------------------

interface RedisEntry {
  value: string;
  expiresAtMs: number;
}

export class SimulatedRedis {
  private entries: Map<string, RedisEntry> = new Map();
  private now: () => number;

  public constructor(now: () => number) {
    this.now = now;
  }

  public getString(namespace: string, key: string): string | null {
    const fullKey: string = `${namespace}-${key}`;
    const entry: RedisEntry | undefined = this.entries.get(fullKey);
    if (!entry) {
      return null;
    }
    if (this.now() >= entry.expiresAtMs) {
      this.entries.delete(fullKey);
      return null;
    }
    // GlobalCache turns an empty value into null.
    return entry.value ? entry.value : null;
  }

  public getStrings(
    namespace: string,
    keys: Array<string>,
  ): Array<string | null> {
    return keys.map((key: string) => {
      return this.getString(namespace, key);
    });
  }

  public setString(
    namespace: string,
    key: string,
    value: string,
    options?: { expiresInSeconds?: number | undefined } | undefined,
  ): void {
    const expiresInSeconds: number =
      options?.expiresInSeconds ?? DEFAULT_CACHE_EXPIRY_SECONDS;
    this.entries.set(`${namespace}-${key}`, {
      value: value,
      expiresAtMs: this.now() + expiresInSeconds * 1000,
    });
  }

  // SET NX EX: true when the key was free (and is now set).
  public setStringIfNotExists(
    namespace: string,
    key: string,
    value: string,
    options?: { expiresInSeconds?: number | undefined } | undefined,
  ): boolean {
    const entry: RedisEntry | undefined = this.entries.get(
      `${namespace}-${key}`,
    );
    if (entry && this.now() < entry.expiresAtMs) {
      return false;
    }
    this.setString(namespace, key, value, options);
    return true;
  }

  // Everything gone at once (a Redis restart during the outage).
  public flushAll(): void {
    this.entries.clear();
  }
}

// ---- the ClickHouse Metric table, as the Proxmox monitor queries it ----

export interface SimulatedMetricRow {
  projectId: string;
  name: string;
  time: Date;
  value: number;
  attributes: Dictionary<AttributeType | Array<AttributeType>>;
}

export interface SimulatedFindByArgs {
  query: Dictionary<unknown>;
  select?: Dictionary<unknown> | undefined;
  sort?: Dictionary<unknown> | undefined;
  limit: number;
  skip?: number | undefined;
}

export interface SimulatedAggregateByArgs {
  query: Dictionary<unknown>;
  aggregationType: MetricsAggregationType;
  aggregateColumnName: string;
  aggregationTimestampColumnName: string;
  startTimestamp: Date;
  endTimestamp: Date;
  aggregationInterval?: AggregationInterval | undefined;
  limit: number;
  skip?: number | undefined;
  sort?: Dictionary<unknown> | undefined;
  groupBy?: Dictionary<unknown> | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}

// The WHERE columns the stand-in emulates; anything else throws.
const EMULATED_QUERY_KEYS: Set<string> = new Set<string>([
  "projectId",
  "name",
  "time",
  "attributes",
]);

// The raw-row columns the Proxmox monitor selects.
const EMULATED_SELECT_KEYS: Set<string> = new Set<string>([
  "attributes",
  "value",
  "time",
]);

function sortDirection(sort: Dictionary<unknown> | undefined): SortOrder {
  if (!sort || Object.keys(sort).length === 0) {
    // AnalyticsDatabaseService's default: the timestamp, newest first.
    return SortOrder.Descending;
  }
  const keys: Array<string> = Object.keys(sort);
  if (keys.length !== 1 || keys[0] !== "time") {
    throw new Error(
      `SimulatedMetricTable does not emulate ORDER BY ${keys.join(", ")}`,
    );
  }
  return sort["time"] === SortOrder.Ascending
    ? SortOrder.Ascending
    : SortOrder.Descending;
}

export class SimulatedMetricTable {
  private rowsByName: Map<string, Array<SimulatedMetricRow>> = new Map();
  private random: () => number;
  // Metric names kept; every pve_* series when not given.
  private storedNames: Set<string> | null;

  public constructor(seed: number, storedNames?: Array<string> | undefined) {
    this.random = createSeededRandom(seed);
    this.storedNames = storedNames ? new Set<string>(storedNames) : null;
  }

  public rowsNamed(name: string): Array<SimulatedMetricRow> {
    return this.rowsByName.get(name) || [];
  }

  /*
   * One ingested OTLP resource block → Metric rows, flattened the way
   * OtelMetricsIngestService builds them: resource attributes prefixed
   * `resource.`, metric attributes, `scope.*`, then the datapoint's own.
   */
  public insertEnvelope(data: {
    projectId: ObjectID;
    envelope: JSONObject;
  }): void {
    const resource: JSONObject =
      (data.envelope["resource"] as JSONObject | undefined) || {};
    const resourceAttributes: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getAttributes({
        items: (resource["attributes"] as JSONArray | undefined) || [],
        prefixKeysWithString: "resource",
      });

    const scopeMetrics: JSONArray =
      (data.envelope["scopeMetrics"] as JSONArray | undefined) || [];

    for (const scopeMetricValue of scopeMetrics) {
      const scopeMetric: JSONObject = scopeMetricValue as JSONObject;
      const scopeAttributes: Dictionary<AttributeType | Array<AttributeType>> =
        TelemetryUtil.getPrefixedScopeAttributes(
          scopeMetric["scope"] as JSONObject | undefined,
        );

      for (const metricValue of (scopeMetric["metrics"] as JSONArray) || []) {
        const metric: JSONObject = metricValue as JSONObject;
        const name: string = String(metric["name"] || "").toLowerCase();
        if (
          this.storedNames
            ? !this.storedNames.has(name)
            : !name.startsWith("pve_")
        ) {
          continue;
        }

        const baseAttributes: Dictionary<AttributeType | Array<AttributeType>> =
          Object.assign(
            {},
            resourceAttributes,
            TelemetryUtil.getAttributes({
              items: (metric["attributes"] as JSONArray | undefined) || [],
              prefixKeysWithString: "",
            }),
            scopeAttributes,
          );

        const wrapper: JSONObject | undefined =
          (metric["gauge"] as JSONObject | undefined) ||
          (metric["sum"] as JSONObject | undefined);
        const dataPoints: JSONArray =
          (wrapper?.["dataPoints"] as JSONArray | undefined) || [];

        for (const pointValue of dataPoints) {
          const point: JSONObject = pointValue as JSONObject;
          const valueFromInt: number | null = toNumberOrNull(point["asInt"]);
          const valueFromDouble: number | null = toNumberOrNull(
            point["asDouble"],
          );
          const value: number | null =
            valueFromInt !== null ? valueFromInt : valueFromDouble;
          if (value === null) {
            continue;
          }

          const attributes: Dictionary<AttributeType | Array<AttributeType>> =
            point["attributes"]
              ? Object.assign(
                  {},
                  baseAttributes,
                  TelemetryUtil.getAttributes({
                    items: point["attributes"] as JSONArray,
                    prefixKeysWithString: "",
                  }),
                )
              : Object.assign({}, baseAttributes);

          this.insertRow({
            projectId: data.projectId.toString(),
            name: name,
            time: OneUptimeDate.fromUnixNano(
              point["timeUnixNano"] as string | number,
            ),
            value: value,
            attributes: attributes,
          });
        }
      }
    }
  }

  public insertRow(row: SimulatedMetricRow): void {
    let rows: Array<SimulatedMetricRow> | undefined = this.rowsByName.get(
      row.name,
    );
    if (!rows) {
      rows = [];
      this.rowsByName.set(row.name, rows);
    }
    rows.push(row);
  }

  // MetricService.findBy: raw rows.
  public findBy(args: SimulatedFindByArgs): Array<JSONObject> {
    for (const key of Object.keys(args.select || {})) {
      if (!EMULATED_SELECT_KEYS.has(key)) {
        throw new Error(`SimulatedMetricTable does not emulate column ${key}`);
      }
    }

    const direction: SortOrder = sortDirection(args.sort);
    const rows: Array<SimulatedMetricRow> = this.selectRows(args.query);
    rows.sort((a: SimulatedMetricRow, b: SimulatedMetricRow) => {
      return direction === SortOrder.Ascending
        ? a.time.getTime() - b.time.getTime()
        : b.time.getTime() - a.time.getTime();
    });

    const skip: number = args.skip || 0;
    return rows
      .slice(skip, skip + args.limit)
      .map((row: SimulatedMetricRow) => {
        return {
          time: new Date(row.time.getTime()),
          value: row.value,
          attributes: { ...row.attributes } as JSONObject,
        };
      });
  }

  /*
   * MetricService.aggregateBy with no group-by: one row per time bucket.
   * The monitor never passes groupBy on this path (a grouped monitor
   * reads raw rows instead), so the stand-in refuses one.
   */
  public aggregateBy(args: SimulatedAggregateByArgs): AggregatedResult {
    if (
      args.aggregateColumnName !== "value" ||
      args.aggregationTimestampColumnName !== "time"
    ) {
      throw new Error(
        `SimulatedMetricTable does not emulate aggregating ${args.aggregateColumnName} over ${args.aggregationTimestampColumnName}`,
      );
    }
    if (
      (args.groupBy && Object.keys(args.groupBy).length > 0) ||
      (args.groupByAttributeKeys && args.groupByAttributeKeys.length > 0)
    ) {
      throw new Error(
        "SimulatedMetricTable does not emulate a grouped aggregateBy",
      );
    }

    const interval: AggregationInterval =
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: args.startTimestamp,
        endDate: args.endTimestamp,
        aggregationInterval: args.aggregationInterval,
      });
    if (interval !== AggregationInterval.Minute) {
      throw new Error(
        `SimulatedMetricTable only emulates minute buckets, not ${interval}`,
      );
    }

    const buckets: Map<number, Array<number>> = new Map();
    for (const row of this.selectRows(args.query)) {
      const bucketMs: number =
        Math.floor(row.time.getTime() / MINUTE_MS) * MINUTE_MS;
      let values: Array<number> | undefined = buckets.get(bucketMs);
      if (!values) {
        values = [];
        buckets.set(bucketMs, values);
      }
      values.push(row.value);
    }

    const data: Array<AggregatedModel> = [];
    for (const [bucketMs, values] of buckets) {
      data.push({
        timestamp: new Date(bucketMs),
        value: this.aggregate(args.aggregationType, values),
      });
    }

    const direction: SortOrder = sortDirection(args.sort);
    data.sort((a: AggregatedModel, b: AggregatedModel) => {
      return direction === SortOrder.Ascending
        ? a.timestamp.getTime() - b.timestamp.getTime()
        : b.timestamp.getTime() - a.timestamp.getTime();
    });

    const skip: number = args.skip || 0;
    return { data: data.slice(skip, skip + args.limit) };
  }

  private aggregate(
    aggregationType: MetricsAggregationType,
    values: Array<number>,
  ): number {
    switch (aggregationType) {
      case MetricsAggregationType.Sum:
        return this.sumInArbitraryOrder(values);
      case MetricsAggregationType.Avg:
        return this.sumInArbitraryOrder(values) / values.length;
      case MetricsAggregationType.Min:
        return Math.min(...values);
      case MetricsAggregationType.Max:
        return Math.max(...values);
      case MetricsAggregationType.Count:
        return values.length;
      default:
        throw new Error(
          `SimulatedMetricTable does not emulate ${aggregationType}`,
        );
    }
  }

  // ClickHouse's sum() promises no order; add in a shuffled one.
  private sumInArbitraryOrder(values: Array<number>): number {
    const shuffled: Array<number> = [...values];
    for (let index: number = shuffled.length - 1; index > 0; index--) {
      const swapWith: number = Math.floor(this.random() * (index + 1));
      const held: number = shuffled[index]!;
      shuffled[index] = shuffled[swapWith]!;
      shuffled[swapWith] = held;
    }
    return shuffled.reduce((total: number, value: number) => {
      return total + value;
    }, 0);
  }

  private selectRows(query: Dictionary<unknown>): Array<SimulatedMetricRow> {
    for (const key of Object.keys(query)) {
      if (!EMULATED_QUERY_KEYS.has(key)) {
        throw new Error(
          `SimulatedMetricTable does not emulate the "${key}" filter`,
        );
      }
    }

    const name: unknown = query["name"];
    if (typeof name !== "string") {
      throw new Error("SimulatedMetricTable needs an exact metric name");
    }

    const time: unknown = query["time"];
    if (!(time instanceof InBetween)) {
      throw new Error("SimulatedMetricTable needs a time window");
    }
    const startMs: number = new Date(time.startValue as Date).getTime();
    const endMs: number = new Date(time.endValue as Date).getTime();

    const projectId: string | null =
      query["projectId"] === undefined ? null : String(query["projectId"]);

    const attributeFilters: Array<[string, string]> = [];
    const attributes: unknown = query["attributes"];
    if (attributes !== undefined) {
      for (const [key, value] of Object.entries(
        attributes as Dictionary<unknown>,
      )) {
        if (typeof value !== "string") {
          throw new Error(
            `SimulatedMetricTable only emulates attribute equality (${key})`,
          );
        }
        attributeFilters.push([key, value]);
      }
    }

    return this.rowsNamed(name).filter((row: SimulatedMetricRow) => {
      if (projectId !== null && row.projectId !== projectId) {
        return false;
      }
      const rowMs: number = row.time.getTime();
      if (rowMs < startMs || rowMs > endMs) {
        return false;
      }
      return attributeFilters.every(([key, value]: [string, string]) => {
        // attributes['k'] on a Map(String, String): '' when missing.
        const stored: AttributeType | Array<AttributeType> | undefined =
          row.attributes[key];
        return (
          (stored === undefined || stored === null ? "" : String(stored)) ===
          value
        );
      });
    });
  }
}

// ---- the cluster ------------------------------------------------------

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

/*
 * OneUptime falls behind on one node's requests (a backed-up ingest
 * queue): every request it receives from the node from fromMs on is
 * held and processed in one burst, the bursts minIntervalMs to
 * maxIntervalMs apart, until the first burst at or after toMs. Each
 * request keeps its own point time; only its processing moves.
 */
export interface SimulatedProcessingBursts extends TimeRange {
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface SimulatedNodePlan {
  name: string;
  // True-time ranges [fromMs, toMs) in which the node is down.
  downRanges?: Array<TimeRange> | undefined;
  processingBursts?: SimulatedProcessingBursts | undefined;
}

/*
 * OneUptime receives nothing in [fromMs, toMs) and Redis loses every
 * key at fromMs — unless keepsLiveness, when Redis rides the outage out
 * and each key simply expires SILENCE_MS after its last write. A node's
 * pushes are received again only from toMs + its resume delay.
 */
export interface SimulatedIngestOutage extends TimeRange {
  resumeDelayMsByNode?: Dictionary<number> | undefined;
  keepsLiveness?: boolean | undefined;
}

export interface SimulatedClusterPlan {
  clusterName: string;
  seed: number;
  startMs: number;
  endMs: number;
  nodes: Array<SimulatedNodePlan>;
  outage?: SimulatedIngestOutage | undefined;
  // The requests each status pass sends; all four when not given.
  pushKinds?: Array<NativePushKind> | undefined;
  /*
   * A counterfactual, never production: the prune WITHOUT
   * deleteStaleForCluster's native-Node keep, so every Node row older
   * than the anchored cutoff goes — what a native node never yet marked
   * Offline got before the keep covered it.
   */
  withoutNativeNodeKeep?: boolean | undefined;
  /*
   * The inventory's Node rows before the first push, by node name — rows
   * the Proxmox Agent left (isNativePush false), or a native push from
   * before the column existed (null).
   */
  initialNodeRows?: Dictionary<SimulatedNodeRow> | undefined;
  /*
   * A counterfactual, never production: the flush WITHOUT
   * adoptNodesAsNativePush, so a Node row an earlier collector left keeps
   * its isNativePush until a report marks it.
   */
  withoutNativeAdoption?: boolean | undefined;
  /*
   * How far the database's clock (its now(), which every updatedAt write
   * takes) runs ahead of the ingest workers' — the clock the marks are
   * written and judged on. 0 when not given.
   */
  databaseClockOffsetMs?: number | undefined;
  /*
   * A counterfactual, never production: adoptNodesAsNativePush as it first
   * shipped, also stamping "updatedAt" = now(). Harmless on its own — the
   * roster never reads updatedAt — unless combined with markInUpdatedAt,
   * as it first shipped: an Offline row an earlier collector left then
   * reads as just marked.
   */
  adoptionStampsUpdatedAt?: boolean | undefined;
  /*
   * A counterfactual, never production: markNodesNotReporting before it
   * took markedAt — the mark written as the database's now() and its
   * refresh guard on now() - 60 s, the DATABASE's clock, while the
   * continuation judges the mark on the worker's.
   */
  markOnDatabaseClock?: boolean | undefined;
  /*
   * A counterfactual, never production: the design before
   * notReportingMarkedAt, the mark kept in updatedAt — markNodesNotReporting
   * writing "updatedAt" = markedAt and refreshing on it, getNodeRoster
   * returning the row's updatedAt as its mark. Every other write of
   * updatedAt then passes for a mark: the fold's (bulkUpsert and
   * bulkUpdateLatestMetrics, of an earlier collector's rows too), on the
   * database's clock, and the adoption's under adoptionStampsUpdatedAt.
   */
  markInUpdatedAt?: boolean | undefined;
}

// One Node row of the inventory, as the roster and the prune read it.
export interface SimulatedNodeRow {
  // The node's own newest point, on its clock.
  lastSeenAt: Date;
  /*
   * Online / Offline: true from the node's own pve_up = 1, false once
   * markNodesNotReporting has marked it (until its next own push); null
   * when never known. The roster carries it.
   */
  isUp: boolean | null;
  /*
   * Written by a Proxmox VE native-push batch (bulkUpsert's isNativePush),
   * or taken into the native keep by adoptNodesAsNativePush /
   * markNodesNotReporting; false for an agent's row, null for a row from
   * before the column existed.
   */
  isNativePush: boolean | null;
  /*
   * The mark: when the live nodes last reported this node as not
   * reporting. Written only by markNodesNotReporting, as markedAt — the
   * ingest worker's clock — at most once a minute while the node stays
   * reported; cleared by the node's own fold; never touched by the
   * adoption. Null for a row never reported (an earlier collector's
   * included). The roster carries it: the continuation's gate.
   */
  notReportingMarkedAt: Date | null;
  /*
   * When the inventory last wrote the row (NOT NULL DEFAULT now()), on the
   * database's clock: the node's own fold, the Offline mark. The adoption
   * leaves it alone. The roster never reads it (but see markInUpdatedAt).
   */
  updatedAt: Date;
}

function copyNodeRow(row: SimulatedNodeRow): SimulatedNodeRow {
  return {
    lastSeenAt: new Date(row.lastSeenAt.getTime()),
    isUp: row.isUp,
    isNativePush: row.isNativePush,
    notReportingMarkedAt: row.notReportingMarkedAt
      ? new Date(row.notReportingMarkedAt.getTime())
      : null,
    updatedAt: new Date(row.updatedAt.getTime()),
  };
}

/*
 * One Offline mark the flush attempted for the nodes a push reported
 * (markProxmoxSilentNodesOffline → markNodesNotReporting).
 */
export interface SimulatedOfflineMark {
  atMs: number;
  // The report's nodes, sorted.
  nodeNames: Array<string>;
  // The report's own time minus the silence window, on the PVE clock.
  silentBeforeMs: number;
  // Held off by the 30 s fence: the same set was written moments ago.
  fenced: boolean;
  // The rows the UPDATE changed.
  markedNodes: Array<string>;
  /*
   * The mark the UPDATE writes: markedAt, the worker's now (the database's
   * now() under the markOnDatabaseClock counterfactual).
   */
  markedAtMs: number;
}

// One adoptNodesAsNativePush the flush ran (the fence let it through).
export interface SimulatedAdoption {
  atMs: number;
  // The batch's newest point (its seenUpTo), on the node's clock.
  seenUpToMs: number;
  // The rows the UPDATE changed.
  adoptedNodes: Array<string>;
  /*
   * Where it fell among the node-status pushes: after the first
   * `nodeStatusPushCount` of them — inside the flush of the last one
   * (after its fold, before its mark) when `withinNodeStatusPush`, else
   * in a later request's flush, before the next one.
   */
  nodeStatusPushCount: number;
  withinNodeStatusPush: boolean;
}

// One Proxmox:CleanupStaleResources tick, as it went for this cluster.
export interface SimulatedCleanupRun {
  atMs: number;
  // Still connected after markDisconnectedClusters, so the prune ran.
  connected: boolean;
  // The anchored cutoff handed to deleteStaleForCluster; null if skipped.
  cutoffMs: number | null;
  // Node rows older than the cutoff: kept by the native-Node keep, or pruned.
  keptNodes: Array<string>;
  prunedNodes: Array<string>;
}

// An Offline row of the roster a push's decision read, with its mark.
export interface RosterOfflineRow {
  nodeName: string;
  // The mark (notReportingMarkedAt) as the roster carried it; null if none.
  markedAtMs: number | null;
}

// One ingested node-status push and what it reported.
export interface NodeStatusPushRecord {
  nodeName: string;
  // The node's own point time (its ctime, on its own clock).
  pushTimeMs: number;
  // OneUptime's receive clock.
  receiveMs: number;
  // Siblings reported as not reporting; empty when it reported nothing.
  silentNodes: Array<string>;
  reporterCount: number;
  /*
   * The Offline rows (isUp false) of the roster the push's decision read —
   * the one the core last loaded, which it caches for 30 s — sorted by
   * name, each with the mark the continuation's gate reads; empty when
   * detection is off.
   */
  offlineRosterRows: Array<RosterOfflineRow>;
  /*
   * When the core loaded that roster (the receive clock) — the moment the
   * gate takes the marks' age at; null when detection is off.
   */
  rosterReadAtMs: number | null;
}

interface PushEvent {
  type: "push";
  receiveMs: number;
  sequence: number;
  kind: NativePushKind;
  nodeName: string;
  nodeIndex: number;
  ctimeSeconds: number;
  uptimeSeconds: number;
}

interface LivenessLostEvent {
  type: "liveness-lost";
  receiveMs: number;
  sequence: number;
}

interface CleanupEvent {
  type: "cleanup";
  receiveMs: number;
  sequence: number;
}

type SimulationEvent = PushEvent | LivenessLostEvent | CleanupEvent;

function isInside(ranges: Array<TimeRange> | undefined, ms: number): boolean {
  return (ranges || []).some((range: TimeRange) => {
    return ms >= range.fromMs && ms < range.toMs;
  });
}

/*
 * The burst times of a stalled node, oldest first: the first one an
 * interval after fromMs, the last the first one at or after toMs.
 */
function burstTimes(
  bursts: SimulatedProcessingBursts,
  random: () => number,
): Array<number> {
  const times: Array<number> = [];
  let atMs: number = bursts.fromMs;
  do {
    atMs += Math.floor(
      bursts.minIntervalMs +
        random() * (bursts.maxIntervalMs - bursts.minIntervalMs + 1),
    );
    times.push(atMs);
  } while (atMs < bursts.toMs);
  return times;
}

/*
 * When OneUptime processes a request it received at receiveMs: at the
 * first burst at or after it while the node is stalled, else at once.
 */
function processedAt(data: {
  receiveMs: number;
  stalledFromMs: number;
  bursts: Array<number>;
}): number {
  if (data.receiveMs < data.stalledFromMs) {
    return data.receiveMs;
  }
  const burstMs: number | undefined = data.bursts.find((atMs: number) => {
    return atMs >= data.receiveMs;
  });
  return burstMs === undefined ? data.receiveMs : burstMs;
}

export class ProxmoxNativeClusterSimulator {
  public readonly clusterName: string;
  // Every node-status push, in the order OneUptime processed them.
  public readonly nodeStatusPushes: Array<NodeStatusPushRecord> = [];
  // When Redis lost every key (the outage began), oldest first.
  public readonly livenessLostAtMs: Array<number> = [];
  // Every Proxmox:CleanupStaleResources tick, oldest first.
  public readonly cleanupRuns: Array<SimulatedCleanupRun> = [];
  // Every Offline mark the flush attempted, oldest first.
  public readonly offlineMarks: Array<SimulatedOfflineMark> = [];
  // Every native-push adoption the flush ran, oldest first.
  public readonly adoptions: Array<SimulatedAdoption> = [];

  private readonly events: Array<SimulationEvent>;
  private nextEventIndex: number = 0;
  // The inventory's Node rows, by node name.
  private readonly nodeRows: Map<string, SimulatedNodeRow> = new Map();
  /*
   * The ProxmoxCluster row: its lastSeenAt (receive clock) and status;
   * null until the first request creates it.
   */
  private clusterLastSeenAtMs: number | null = null;
  private clusterConnected: boolean = false;

  private readonly projectId: ObjectID;
  private readonly proxmoxClusterId: ObjectID;
  private readonly metricTable: SimulatedMetricTable;
  private readonly redis: SimulatedRedis;
  private readonly setClock: (ms: number) => void;
  private readonly withoutNativeNodeKeep: boolean;
  private readonly withoutNativeAdoption: boolean;
  private readonly adoptionStampsUpdatedAt: boolean;
  private readonly markOnDatabaseClock: boolean;
  private readonly markInUpdatedAt: boolean;
  // The database's clock minus the workers'.
  private readonly databaseClockOffsetMs: number;
  // The rows the inventory started with, by node name.
  private readonly startingRows: Map<string, SimulatedNodeRow> = new Map();
  /*
   * The roster the core last loaded for this cluster — what its 30 s cache
   * hands every decision until the next load — and when it loaded it.
   */
  private lastLoadedRoster: Array<ProxmoxRosterNode> = [];
  private lastLoadedRosterAtMs: number | null = null;

  public constructor(data: {
    plan: SimulatedClusterPlan;
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    metricTable: SimulatedMetricTable;
    redis: SimulatedRedis;
    setClock: (ms: number) => void;
  }) {
    this.clusterName = data.plan.clusterName;
    this.projectId = data.projectId;
    this.proxmoxClusterId = data.proxmoxClusterId;
    this.metricTable = data.metricTable;
    this.redis = data.redis;
    this.setClock = data.setClock;
    this.withoutNativeNodeKeep = Boolean(data.plan.withoutNativeNodeKeep);
    this.withoutNativeAdoption = Boolean(data.plan.withoutNativeAdoption);
    this.adoptionStampsUpdatedAt = Boolean(data.plan.adoptionStampsUpdatedAt);
    this.markOnDatabaseClock = Boolean(data.plan.markOnDatabaseClock);
    this.markInUpdatedAt = Boolean(data.plan.markInUpdatedAt);
    this.databaseClockOffsetMs = data.plan.databaseClockOffsetMs || 0;
    for (const [nodeName, row] of Object.entries(
      data.plan.initialNodeRows || {},
    )) {
      this.startingRows.set(nodeName, copyNodeRow(row));
      this.nodeRows.set(nodeName, copyNodeRow(row));
    }
    this.events = ProxmoxNativeClusterSimulator.scheduleEvents(data.plan);
  }

  /*
   * pvestatd on every node: a status pass every 10 s from a random
   * phase, ±300 ms of jitter, a clock skew within ±800 ms, and each of
   * the four requests reaching OneUptime 150–1500 ms later. Every node
   * draws from its own seeded stream, so a node's schedule does not
   * depend on what the other nodes do; a stalled node's burst times
   * come from a stream of their own, so stalling it does not move its
   * pushes either.
   */
  private static scheduleEvents(
    plan: SimulatedClusterPlan,
  ): Array<SimulationEvent> {
    const events: Array<SimulationEvent> = [];
    const pushKinds: Array<NativePushKind> = plan.pushKinds || PUSH_KINDS;
    let sequence: number = 0;

    plan.nodes.forEach((node: SimulatedNodePlan, nodeIndex: number) => {
      const random: () => number = createSeededRandom(
        plan.seed * 1000 + nodeIndex + 1,
      );
      const phaseMs: number = Math.floor(random() * PUSH_INTERVAL_MS);
      const skewMs: number = Math.round((random() * 2 - 1) * 800);
      const bootMs: number = plan.startMs - 86_400_000;
      const bursts: Array<number> = node.processingBursts
        ? burstTimes(
            node.processingBursts,
            createSeededRandom(plan.seed * 1000 + 500 + nodeIndex + 1),
          )
        : [];
      const stalledFromMs: number = node.processingBursts
        ? node.processingBursts.fromMs
        : Number.MAX_SAFE_INTEGER;

      for (let pass: number = 0; ; pass++) {
        const jitterMs: number = Math.round((random() * 2 - 1) * 300);
        const delaysMs: Array<number> = PUSH_KINDS.map(() => {
          return 150 + Math.floor(random() * 1350);
        });
        const trueMs: number =
          plan.startMs + phaseMs + pass * PUSH_INTERVAL_MS + jitterMs;
        if (trueMs > plan.endMs) {
          break;
        }
        if (isInside(node.downRanges, trueMs)) {
          continue;
        }

        const ctimeSeconds: number = Math.floor((trueMs + skewMs) / 1000);
        for (const kind of pushKinds) {
          const receiveMs: number = processedAt({
            receiveMs: trueMs + delaysMs[PUSH_KINDS.indexOf(kind)]!,
            stalledFromMs: stalledFromMs,
            bursts: bursts,
          });
          if (plan.outage) {
            const resumeAtMs: number =
              plan.outage.toMs +
              (plan.outage.resumeDelayMsByNode?.[node.name] || 0);
            if (receiveMs >= plan.outage.fromMs && receiveMs < resumeAtMs) {
              continue;
            }
          }
          events.push({
            type: "push",
            receiveMs: receiveMs,
            sequence: sequence++,
            kind: kind,
            nodeName: node.name,
            nodeIndex: nodeIndex,
            ctimeSeconds: ctimeSeconds,
            uptimeSeconds: Math.floor((trueMs - bootMs) / 1000),
          });
        }
      }
    });

    if (plan.outage && !plan.outage.keepsLiveness) {
      events.push({
        type: "liveness-lost",
        receiveMs: plan.outage.fromMs,
        sequence: sequence++,
      });
    }

    // The cleanup cron, on the wall clock's five-minute marks.
    for (
      let atMs: number =
        Math.ceil(plan.startMs / CLEANUP_INTERVAL_MS) * CLEANUP_INTERVAL_MS;
      atMs <= plan.endMs;
      atMs += CLEANUP_INTERVAL_MS
    ) {
      events.push({ type: "cleanup", receiveMs: atMs, sequence: sequence++ });
    }

    return events.sort((a: SimulationEvent, b: SimulationEvent) => {
      return a.receiveMs - b.receiveMs || a.sequence - b.sequence;
    });
  }

  // Ingest every request OneUptime has received by `ms`, in order.
  public async advanceTo(ms: number): Promise<void> {
    while (
      this.nextEventIndex < this.events.length &&
      this.events[this.nextEventIndex]!.receiveMs <= ms
    ) {
      const event: SimulationEvent = this.events[this.nextEventIndex]!;
      this.nextEventIndex++;
      this.setClock(event.receiveMs);

      if (event.type === "liveness-lost") {
        this.redis.flushAll();
        this.livenessLostAtMs.push(event.receiveMs);
        continue;
      }
      if (event.type === "cleanup") {
        this.cleanup(event.receiveMs);
        continue;
      }
      await this.ingest(event);
    }
  }

  // The node's own status pushes, oldest first.
  public ownPushes(nodeName: string): Array<NodeStatusPushRecord> {
    return this.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
      return push.nodeName === nodeName;
    });
  }

  // Every push that reported `nodeName` as not reporting.
  public reportsOf(nodeName: string): Array<NodeStatusPushRecord> {
    return this.nodeStatusPushes.filter((push: NodeStatusPushRecord) => {
      return push.silentNodes.includes(nodeName);
    });
  }

  /*
   * ProxmoxResourceService.getNodeRoster over the simulated inventory:
   * every Node row seen within the retention window, with its isUp and
   * its mark (notReportingMarkedAt; the row's updatedAt under the
   * markInUpdatedAt counterfactual).
   */
  public loadRoster(): Array<ProxmoxRosterNode> {
    const seenSince: Date =
      ProxmoxResourceService.getSilentNodeRetentionCutoff();
    const roster: Array<ProxmoxRosterNode> = [];
    for (const [nodeName, row] of this.nodeRows) {
      if (row.lastSeenAt >= seenSince) {
        const markedAtMs: number | null = this.markOf(row);
        roster.push({
          nodeName,
          lastSeenAt: new Date(row.lastSeenAt.getTime()),
          isUp: row.isUp,
          notReportingMarkedAt:
            markedAtMs === null ? null : new Date(markedAtMs),
        });
      }
    }
    return roster;
  }

  /*
   * The row's mark, where the design keeps it: notReportingMarkedAt — or
   * updatedAt under the markInUpdatedAt counterfactual.
   */
  private markOf(row: SimulatedNodeRow): number | null {
    if (this.markInUpdatedAt) {
      return row.updatedAt.getTime();
    }
    return row.notReportingMarkedAt ? row.notReportingMarkedAt.getTime() : null;
  }

  // The node's inventory row as it stands now; null once pruned.
  public nodeRow(nodeName: string): SimulatedNodeRow | null {
    const row: SimulatedNodeRow | undefined = this.nodeRows.get(nodeName);
    return row ? copyNodeRow(row) : null;
  }

  // The rows the inventory started with (`initialNodeRows`), by node name.
  public initialNodeRows(): Map<string, SimulatedNodeRow> {
    const rows: Map<string, SimulatedNodeRow> = new Map();
    for (const [nodeName, row] of this.startingRows) {
      rows.set(nodeName, copyNodeRow(row));
    }
    return rows;
  }

  /*
   * One Proxmox:CleanupStaleResources tick for this cluster. Step 1,
   * markDisconnectedClusters: a connected cluster not seen for 15 minutes
   * turns disconnected. Step 2, for a connected cluster only:
   * deleteStaleForCluster with the cutoff anchored to the cluster's own
   * lastSeenAt —
   *   DELETE … WHERE "lastSeenAt" < cutoff
   *     AND NOT ("kind" = 'Node' AND "isNativePush" IS TRUE
   *              AND "lastSeenAt" >= retention cutoff)
   * over the Node rows (the only rows modelled).
   */
  private cleanup(atMs: number): void {
    if (
      this.clusterConnected &&
      this.clusterLastSeenAtMs !== null &&
      this.clusterLastSeenAtMs < atMs - DISCONNECTED_AFTER_MS
    ) {
      this.clusterConnected = false;
    }

    const run: SimulatedCleanupRun = {
      atMs: atMs,
      connected: this.clusterConnected,
      cutoffMs: null,
      keptNodes: [],
      prunedNodes: [],
    };
    this.cleanupRuns.push(run);
    if (!this.clusterConnected || this.clusterLastSeenAtMs === null) {
      return;
    }

    const cutoff: Date = ProxmoxResourceService.getStaleThresholdDate(
      new Date(this.clusterLastSeenAtMs),
    );
    const retentionCutoff: Date =
      ProxmoxResourceService.getSilentNodeRetentionCutoff(new Date(atMs));
    run.cutoffMs = cutoff.getTime();

    for (const [nodeName, row] of this.nodeRows) {
      if (row.lastSeenAt >= cutoff) {
        continue;
      }
      const kept: boolean =
        !this.withoutNativeNodeKeep &&
        row.isNativePush === true &&
        row.lastSeenAt >= retentionCutoff;
      if (kept) {
        run.keptNodes.push(nodeName);
      } else {
        run.prunedNodes.push(nodeName);
        this.nodeRows.delete(nodeName);
      }
    }
  }

  /*
   * One OTLP request through the ingest steps that matter here, in
   * OtelMetricsIngestService's order: normalize the batch, report silent
   * siblings on a node's own status push, build the rows, then the flush
   * — fold the inventory (bulkUpsert), adopt the cluster's Node rows into
   * the native keep, mark the reported nodes Offline — and refresh the
   * cluster's heartbeat (ProxmoxClusterService.updateLastSeen stamps
   * lastSeenAt = now and "connected").
   */
  private async ingest(event: PushEvent): Promise<void> {
    const resourceMetrics: JSONArray = [
      buildNativePushEnvelope({
        kind: event.kind,
        clusterName: this.clusterName,
        nodeName: event.nodeName,
        nodeIndex: event.nodeIndex,
        ctimeSeconds: event.ctimeSeconds,
        uptimeSeconds: event.uptimeSeconds,
      }),
    ];
    normalizeProxmoxNativePushInPlace(resourceMetrics);
    const envelope: JSONObject = resourceMetrics[0] as JSONObject;

    const resourceAttributes: JSONArray = (envelope["resource"] as JSONObject)[
      "attributes"
    ] as JSONArray;
    const pushesBefore: number = this.nodeStatusPushes.length;
    let report: ProxmoxSilentNodeReport | null = null;
    if (isProxmoxNativePushResource(resourceAttributes)) {
      report = await this.appendSilentNodeReports(envelope, event.receiveMs);
    }

    this.metricTable.insertEnvelope({
      projectId: this.projectId,
      envelope: envelope,
    });

    /*
     * flushProxmoxSnapshotBuffers. Every request here is a native-push
     * batch with inventory entries (node, guest or storage rows), so the
     * adoption follows every upsert; the mark follows when it reported.
     */
    this.foldInventory(envelope, event.receiveMs);
    if (!this.withoutNativeAdoption) {
      /*
       * seenUpTo: the batch's newest entry — every point of one pvestatd
       * request carries the pass's ctime.
       */
      this.adoptNodesAsNativePush({
        atMs: event.receiveMs,
        seenUpToMs: event.ctimeSeconds * 1000,
        withinNodeStatusPush: this.nodeStatusPushes.length > pushesBefore,
      });
    }
    if (report) {
      this.markNodesNotReporting(report, event.receiveMs);
    }
    this.clusterLastSeenAtMs = event.receiveMs;
    this.clusterConnected = true;
  }

  /*
   * OtelMetricsIngestService.adoptProxmoxNodesAsNativePush (fenced to once
   * per 10 minutes per cluster) → ProxmoxResourceService
   * .adoptNodesAsNativePush:
   *   UPDATE … SET "isNativePush" = true
   *   WHERE "kind" = 'Node' AND "isNativePush" IS DISTINCT FROM true
   *     AND "lastSeenAt" <= seenUpTo
   * Adopting a row is not a report: its mark (notReportingMarkedAt) and
   * updatedAt are left alone. (The adoptionStampsUpdatedAt counterfactual
   * also sets "updatedAt" = now(), as it first shipped.) The UPDATE never
   * fails here, so the fence is never released early.
   */
  private adoptNodesAsNativePush(data: {
    atMs: number;
    seenUpToMs: number;
    // The request running it is a node-status push (already recorded).
    withinNodeStatusPush: boolean;
  }): void {
    const acquired: boolean = this.redis.setStringIfNotExists(
      NATIVE_ADOPTION_FENCE_NAMESPACE,
      this.proxmoxClusterId.toString(),
      "1",
      { expiresInSeconds: NATIVE_ADOPTION_FENCE_SECONDS },
    );
    if (!acquired) {
      return;
    }
    const adoption: SimulatedAdoption = {
      atMs: data.atMs,
      seenUpToMs: data.seenUpToMs,
      adoptedNodes: [],
      nodeStatusPushCount: this.nodeStatusPushes.length,
      withinNodeStatusPush: data.withinNodeStatusPush,
    };
    for (const [nodeName, row] of this.nodeRows) {
      if (
        row.isNativePush !== true &&
        row.lastSeenAt.getTime() <= data.seenUpToMs
      ) {
        row.isNativePush = true;
        if (this.adoptionStampsUpdatedAt) {
          row.updatedAt = new Date(data.atMs + this.databaseClockOffsetMs);
        }
        adoption.adoptedNodes.push(nodeName);
      }
    }
    adoption.adoptedNodes.sort();
    this.adoptions.push(adoption);
  }

  /*
   * OtelMetricsIngestService.markProxmoxSilentNodesOffline (fenced to once
   * per 30 s per cluster and set of nodes) → ProxmoxResourceService
   * .markNodesNotReporting, with markedAt = the worker's now
   * (OneUptimeDate.getCurrentDate() — here the one simulated clock):
   *   UPDATE … SET "isUp" = false, "isNativePush" = true,
   *                "notReportingMarkedAt" = markedAt, "updatedAt" = now()
   *   WHERE "externalId" = ANY(the nodes) AND "lastSeenAt" < silentBefore
   *     AND ("isUp" IS DISTINCT FROM false
   *          OR "isNativePush" IS DISTINCT FROM true
   *          OR "notReportingMarkedAt" IS NULL
   *          OR "notReportingMarkedAt" < markedAt - 60 s)
   * — a node that stays reported has its mark refreshed at most once a
   * minute, and a row the node itself refreshed after silentBefore is
   * never touched. The markOnDatabaseClock counterfactual writes and
   * guards the mark on the database's now() instead; markInUpdatedAt keeps
   * it in updatedAt ("updatedAt" = markedAt, guarded alike).
   */
  private markNodesNotReporting(
    report: ProxmoxSilentNodeReport,
    atMs: number,
  ): void {
    const databaseNowMs: number = atMs + this.databaseClockOffsetMs;
    const markedAtMs: number = this.markOnDatabaseClock ? databaseNowMs : atMs;
    const nodeNames: Array<string> = Array.from(report.nodeNames).sort();
    const fingerprint: string = crypto
      .createHash("sha1")
      .update(nodeNames.join("\n"))
      .digest("hex");
    const acquired: boolean = this.redis.setStringIfNotExists(
      SILENT_NODE_MARK_FENCE_NAMESPACE,
      `${this.proxmoxClusterId.toString()}:${fingerprint}`,
      "1",
      { expiresInSeconds: SILENT_NODE_MARK_FENCE_SECONDS },
    );
    const mark: SimulatedOfflineMark = {
      atMs: atMs,
      nodeNames: nodeNames,
      silentBeforeMs: report.silentBefore.getTime(),
      fenced: !acquired,
      markedNodes: [],
      markedAtMs: markedAtMs,
    };
    this.offlineMarks.push(mark);
    if (!acquired) {
      return;
    }
    for (const nodeName of nodeNames) {
      const row: SimulatedNodeRow | undefined = this.nodeRows.get(nodeName);
      if (!row || row.lastSeenAt >= report.silentBefore) {
        continue;
      }
      const lastMarkMs: number | null = this.markOf(row);
      if (
        row.isUp !== false ||
        row.isNativePush !== true ||
        lastMarkMs === null ||
        lastMarkMs < markedAtMs - SILENT_NODE_MARK_REFRESH_MS
      ) {
        row.isUp = false;
        row.isNativePush = true;
        if (this.markInUpdatedAt) {
          row.updatedAt = new Date(markedAtMs);
        } else {
          row.notReportingMarkedAt = new Date(markedAtMs);
          row.updatedAt = new Date(databaseNowMs);
        }
        mark.markedNodes.push(nodeName);
      }
    }
  }

  /*
   * OtelMetricsIngestService.appendProxmoxSilentNodeReports, line for
   * line (it is private). The push record is kept even when detection
   * is off, so the suite's oracles see every own point. Returns what the
   * push reported, for the flush's Offline mark; null when nothing.
   */
  private async appendSilentNodeReports(
    envelope: JSONObject,
    receiveMs: number,
  ): Promise<ProxmoxSilentNodeReport | null> {
    const status: {
      nodeName: string;
      timeUnixNanos: Array<JSONValue>;
    } | null = readProxmoxNativeNodeStatus(envelope);
    if (!status) {
      return null;
    }

    let reporterTimeMs: number | null = null;
    for (const timeUnixNano of status.timeUnixNanos) {
      if (
        typeof timeUnixNano !== "string" &&
        typeof timeUnixNano !== "number"
      ) {
        continue;
      }
      const ms: number = OneUptimeDate.fromUnixNano(timeUnixNano).getTime();
      if (
        Number.isFinite(ms) &&
        (reporterTimeMs === null || ms < reporterTimeMs)
      ) {
        reporterTimeMs = ms;
      }
    }
    if (reporterTimeMs === null) {
      reporterTimeMs = OneUptimeDate.getCurrentDate().getTime();
    }

    const record: NodeStatusPushRecord = {
      nodeName: status.nodeName,
      pushTimeMs: reporterTimeMs,
      receiveMs: receiveMs,
      silentNodes: [],
      reporterCount: 0,
      offlineRosterRows: [],
      rosterReadAtMs: null,
    };
    this.nodeStatusPushes.push(record);

    if (!isProxmoxSilentNodeDetectionEnabled()) {
      return null;
    }

    const decision: ProxmoxSilentNodeDecision | null =
      await recordProxmoxNodePushAndFindSilentNodes({
        projectId: this.projectId,
        proxmoxClusterId: this.proxmoxClusterId,
        selfNode: status.nodeName,
        reporterTimeMs: reporterTimeMs,
        loadRoster: (): Promise<Array<ProxmoxRosterNode>> => {
          this.lastLoadedRoster = this.loadRoster();
          this.lastLoadedRosterAtMs = receiveMs;
          return Promise.resolve(this.lastLoadedRoster);
        },
      });

    // The roster the decision read: the one loaded now, or the cached one.
    record.rosterReadAtMs = this.lastLoadedRosterAtMs;
    record.offlineRosterRows = this.lastLoadedRoster
      .filter((node: ProxmoxRosterNode) => {
        return node.isUp === false;
      })
      .map((node: ProxmoxRosterNode) => {
        return {
          nodeName: node.nodeName,
          markedAtMs: node.notReportingMarkedAt
            ? node.notReportingMarkedAt.getTime()
            : null,
        };
      })
      .sort((a: RosterOfflineRow, b: RosterOfflineRow) => {
        return a.nodeName.localeCompare(b.nodeName);
      });

    if (!decision) {
      return null;
    }

    record.silentNodes = [...decision.silentNodes];
    record.reporterCount = decision.reporterCount;
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: decision.silentNodes,
      reporterCount: decision.reporterCount,
      timeUnixNanos: status.timeUnixNanos,
    });
    return {
      nodeNames: new Set<string>(decision.silentNodes),
      silentBefore: new Date(reporterTimeMs - PROXMOX_NODE_SILENCE_MS),
    };
  }

  /*
   * The inventory fold (bulkUpsert): per Node row of the batch, the newest
   * own point is lastSeenAt and the newest own pve_up gives isUp (a node
   * that pushes says pve_up = 1); a native-push batch stamps isNativePush
   * — every batch here is one. The row is written only when that point is
   * at least as new as the row's (DO UPDATE … WHERE EXCLUDED."lastSeenAt"
   * >= the row's), isUp COALESCEd against the row's, the mark cleared
   * ("notReportingMarkedAt" = NULL: the node's own newer point outranks
   * any report of it), updatedAt = now() on the database's clock (a new
   * row takes the column's DEFAULT now() and no mark;
   * bulkUpdateLatestMetrics' write of the same row, guarded by the same
   * observations, stamps updatedAt alike and never the mark). Sibling
   * reports never reach it.
   */
  private foldInventory(envelope: JSONObject, atMs: number): void {
    const batch: Map<string, { observedAt: Date; isUp: boolean | null }> =
      new Map();

    for (const scopeMetricValue of (envelope["scopeMetrics"] as JSONArray) ||
      []) {
      if (isProxmoxSiblingReportScope(scopeMetricValue)) {
        continue;
      }
      const scopeMetric: JSONObject = scopeMetricValue as JSONObject;
      for (const metricValue of (scopeMetric["metrics"] as JSONArray) || []) {
        const metric: JSONObject = metricValue as JSONObject;
        const name: unknown = metric["name"];
        if (name !== "pve_node_info" && name !== "pve_up") {
          continue;
        }
        const gaugeData: JSONObject =
          (metric["gauge"] as JSONObject | undefined) || {};
        for (const pointValue of (gaugeData["dataPoints"] as JSONArray) || []) {
          const point: JSONObject = pointValue as JSONObject;
          const labels: Dictionary<AttributeType | Array<AttributeType>> =
            TelemetryUtil.getAttributes({
              items: (point["attributes"] as JSONArray | undefined) || [],
              prefixKeysWithString: "",
            });
          const id: string = String(labels["id"] || "");
          if (!id.startsWith("node/")) {
            continue;
          }
          const nodeName: string = id.substring("node/".length);
          const observedAt: Date = OneUptimeDate.fromUnixNano(
            point["timeUnixNano"] as string | number,
          );
          const value: number | null =
            toNumberOrNull(point["asInt"]) ?? toNumberOrNull(point["asDouble"]);
          const isUp: boolean | null =
            name === "pve_up" && value !== null ? value >= 1 : null;

          const entry: { observedAt: Date; isUp: boolean | null } | undefined =
            batch.get(nodeName);
          if (!entry) {
            batch.set(nodeName, { observedAt, isUp });
            continue;
          }
          // Newest observation wins (foldProxmoxResourceSnapshot).
          if (isUp !== null && observedAt >= entry.observedAt) {
            entry.isUp = isUp;
          }
          if (observedAt > entry.observedAt) {
            entry.observedAt = observedAt;
          }
        }
      }
    }

    const databaseNow: number = atMs + this.databaseClockOffsetMs;
    for (const [nodeName, entry] of batch) {
      const existing: SimulatedNodeRow | undefined =
        this.nodeRows.get(nodeName);
      if (!existing) {
        this.nodeRows.set(nodeName, {
          lastSeenAt: entry.observedAt,
          isUp: entry.isUp,
          isNativePush: true,
          notReportingMarkedAt: null,
          updatedAt: new Date(databaseNow),
        });
        continue;
      }
      // DO UPDATE only WHERE EXCLUDED."lastSeenAt" >= the row's.
      if (entry.observedAt >= existing.lastSeenAt) {
        existing.lastSeenAt = entry.observedAt;
        existing.isUp = entry.isUp ?? existing.isUp;
        existing.isNativePush = true;
        existing.notReportingMarkedAt = null;
        existing.updatedAt = new Date(databaseNow);
      }
    }
  }
}
