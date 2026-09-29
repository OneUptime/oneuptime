import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * ------------------------------------------------------------------
 * Proxmox VE native OpenTelemetry push — translate to the pve_* model
 * ------------------------------------------------------------------
 *
 * Proxmox VE 9+ can push metrics itself (Datacenter → Metric Server →
 * OpenTelemetry, PVE::Status::OpenTelemetry in pve-manager). Everything
 * OneUptime builds for Proxmox — cluster discovery, the node / guest /
 * storage inventory, the overview charts, the metric catalog and the
 * alert templates — is written against the shape the Proxmox Agent
 * ships (prometheus-pve-exporter series): `pve_*` names, resource
 * identity in one `id` datapoint label (`node/pve1`, `qemu/100`,
 * `lxc/101`, `storage/pve1/local`) plus the `pve.scope` / `pve.type` /
 * `pve.id` attributes the agent's transform derives from it, and the
 * cluster in the `proxmox.cluster.name` resource attribute.
 *
 * The native push differs in more than the prefix, which is why a
 * per-cluster "series prefix" setting could not make it work:
 *
 *   - names follow the PVE status hash keys: `proxmox_node_cpustat_cpu`,
 *     `proxmox_vm_maxmem`, `proxmox_storage_used`, …;
 *   - identity is spread over `node` / `vmid` / `type` / `storage`
 *     datapoint attributes, with no `id`;
 *   - there is no up/info series — a guest's run state only shows as a
 *     non-zero uptime;
 *   - the resource carries `service.name=proxmox-ve` and
 *     `proxmox.cluster` (not `proxmox.cluster.name`), so batches were
 *     routed to a phantom "proxmox-ve" Service and no cluster appeared
 *     unless the user added a resource attribute by hand.
 *
 * So each native-push resource block is rewritten in place, before
 * anything reads it: the cluster identity is filled in from what PVE
 * already sends, and the pve_* series the product reads are derived and
 * appended next to the originals. The original proxmox_* series are left
 * untouched — they stay available in Metrics Explorer, and anything a
 * user already built on them keeps working.
 *
 * What the native push does not carry (HA state, start-on-boot, backup
 * coverage, replication) cannot be derived and is not invented here.
 * The one thing a node cannot say about itself — that it is down — is
 * said for it by the nodes still alive: see
 * appendProxmoxSiblingReportsInPlace below and ProxmoxNativeNodeLiveness.
 */

// The service.name every PVE native push stamps on its resource.
export const PROXMOX_NATIVE_PUSH_SERVICE_NAME: string = "proxmox-ve";

/*
 * `proxmox.cluster` value PVE falls back to when the node is not part of
 * a cluster (PVE::Cluster::get_clinfo has no cluster name).
 */
export const PROXMOX_NATIVE_PUSH_STANDALONE_CLUSTER: string = "single-node";

type NativeScope = "node" | "guest" | "storage";

/*
 * Native series → canonical pve_* series. Counters are pushed with a
 * `_total` suffix (PVE's _classify_metric_type); the bare spelling is
 * accepted too so an older or future plugin revision still maps.
 * pve-exporter reports the byte counters as gauges, so the derived
 * series are gauges — that keeps the rate charts identical on both paths.
 */
const NODE_SERIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["proxmox_node_uptime", "pve_uptime_seconds"],
  // read_proc_stat: `cpu` is already a 0..1 ratio across all cores.
  ["proxmox_node_cpustat_cpu", "pve_cpu_usage_ratio"],
  ["proxmox_node_cpustat_cpus", "pve_cpu_usage_limit"],
  ["proxmox_node_memory_memused", "pve_memory_usage_bytes"],
  ["proxmox_node_memory_memtotal", "pve_memory_size_bytes"],
  // blockstat is df('/') in bytes — the node's root filesystem.
  ["proxmox_node_blockstat_used", "pve_disk_usage_bytes"],
  ["proxmox_node_blockstat_total", "pve_disk_size_bytes"],
]);

const GUEST_SERIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["proxmox_vm_uptime", "pve_uptime_seconds"],
  // vmstatus: `cpu` is a 0..1 ratio of the guest's allocated vCPUs.
  ["proxmox_vm_cpu", "pve_cpu_usage_ratio"],
  ["proxmox_vm_cpus", "pve_cpu_usage_limit"],
  ["proxmox_vm_mem", "pve_memory_usage_bytes"],
  ["proxmox_vm_maxmem", "pve_memory_size_bytes"],
  ["proxmox_vm_disk", "pve_disk_usage_bytes"],
  ["proxmox_vm_maxdisk", "pve_disk_size_bytes"],
  ["proxmox_vm_netin_total", "pve_network_receive_bytes"],
  ["proxmox_vm_netin", "pve_network_receive_bytes"],
  ["proxmox_vm_netout_total", "pve_network_transmit_bytes"],
  ["proxmox_vm_netout", "pve_network_transmit_bytes"],
  ["proxmox_vm_diskread_total", "pve_disk_read_bytes"],
  ["proxmox_vm_diskread", "pve_disk_read_bytes"],
  ["proxmox_vm_diskwrite_total", "pve_disk_write_bytes"],
  ["proxmox_vm_diskwrite", "pve_disk_write_bytes"],
]);

const STORAGE_SERIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["proxmox_storage_used", "pve_disk_usage_bytes"],
  ["proxmox_storage_total", "pve_disk_size_bytes"],
  /*
   * pve-exporter reports a storage as up when PVE lists it available;
   * the native push's `active` flag is the same signal.
   */
  ["proxmox_storage_active", "pve_up"],
]);

function scopeOfNativeSeries(metricName: string): NativeScope | null {
  if (NODE_SERIES.has(metricName)) {
    return "node";
  }
  if (GUEST_SERIES.has(metricName)) {
    return "guest";
  }
  if (STORAGE_SERIES.has(metricName)) {
    return "storage";
  }
  return null;
}

function canonicalNameOf(metricName: string, scope: NativeScope): string {
  const table: ReadonlyMap<string, string> =
    scope === "node"
      ? NODE_SERIES
      : scope === "guest"
        ? GUEST_SERIES
        : STORAGE_SERIES;
  return table.get(metricName) as string;
}

function readAttributeString(
  attributes: JSONArray | undefined,
  key: string,
): string | null {
  if (!Array.isArray(attributes)) {
    return null;
  }
  for (const attribute of attributes) {
    const attr: JSONObject | null =
      attribute && typeof attribute === "object"
        ? (attribute as JSONObject)
        : null;
    if (!attr || attr["key"] !== key) {
      continue;
    }
    const value: JSONObject | undefined = attr["value"] as
      | JSONObject
      | undefined;
    if (!value || typeof value !== "object") {
      continue;
    }
    const raw: JSONValue =
      value["stringValue"] ?? value["intValue"] ?? value["doubleValue"];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return String(raw);
    }
  }
  return null;
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function readNumber(datapoint: JSONObject): number | null {
  const raw: JSONValue = datapoint["asDouble"] ?? datapoint["asInt"];
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed: number = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function metricDataPoints(metric: JSONObject): JSONArray {
  const gauge: JSONObject | undefined = metric["gauge"] as
    | JSONObject
    | undefined;
  const sum: JSONObject | undefined = metric["sum"] as JSONObject | undefined;
  const points: JSONValue =
    (gauge && gauge["dataPoints"]) || (sum && sum["dataPoints"]) || [];
  return Array.isArray(points) ? (points as JSONArray) : [];
}

/*
 * True for a resource block pushed by Proxmox VE itself. PVE always
 * stamps both `proxmox.cluster` and `proxmox.node`; neither is set by the
 * Proxmox Agent (which uses `proxmox.cluster.name`), so the pair tells
 * the two paths apart before and after the rewrite below.
 */
export function isProxmoxNativePushResource(
  resourceAttributes: JSONArray | undefined,
): boolean {
  return Boolean(
    readAttributeString(resourceAttributes, "proxmox.cluster") &&
      readAttributeString(resourceAttributes, "proxmox.node"),
  );
}

/*
 * The cluster name a native push belongs to. An explicit
 * `proxmox.cluster.name` (the old documented workaround, or a user's own
 * choice) always wins, so existing clusters keep their identity. A
 * standalone node reports the placeholder "single-node", which would
 * merge every standalone host of a project into one cluster — the node
 * name is used instead.
 */
export function resolveProxmoxNativePushClusterName(
  resourceAttributes: JSONArray | undefined,
): string | null {
  const explicit: string | null = readAttributeString(
    resourceAttributes,
    "proxmox.cluster.name",
  );
  if (explicit) {
    return explicit;
  }
  const cluster: string | null = readAttributeString(
    resourceAttributes,
    "proxmox.cluster",
  );
  const node: string | null = readAttributeString(
    resourceAttributes,
    "proxmox.node",
  );
  if (cluster && cluster !== PROXMOX_NATIVE_PUSH_STANDALONE_CLUSTER) {
    return cluster;
  }
  return node || cluster;
}

interface ResourceIdentity {
  id: string;
  scope: NativeScope;
  type: string;
  labels: Array<JSONObject>; // extra labels of the *_info series
  infoMetricName: string;
}

function identityOf(data: {
  scope: NativeScope;
  datapointAttributes: JSONArray | undefined;
  resourceNode: string | null;
}): ResourceIdentity | null {
  const node: string | null =
    readAttributeString(data.datapointAttributes, "node") || data.resourceNode;

  if (data.scope === "node") {
    if (!node) {
      return null;
    }
    return {
      id: `node/${node}`,
      scope: "node",
      type: "node",
      labels: [stringAttribute("name", node)],
      infoMetricName: "pve_node_info",
    };
  }

  if (data.scope === "guest") {
    const vmid: string | null = readAttributeString(
      data.datapointAttributes,
      "vmid",
    );
    const type: string | null = readAttributeString(
      data.datapointAttributes,
      "type",
    );
    if (!vmid || (type !== "qemu" && type !== "lxc")) {
      return null;
    }
    const labels: Array<JSONObject> = [stringAttribute("type", type)];
    const name: string | null = readAttributeString(
      data.datapointAttributes,
      "name",
    );
    if (name) {
      labels.push(stringAttribute("name", name));
    }
    if (node) {
      labels.push(stringAttribute("node", node));
    }
    return {
      id: `${type}/${vmid}`,
      scope: "guest",
      type,
      labels,
      infoMetricName: "pve_guest_info",
    };
  }

  const storage: string | null = readAttributeString(
    data.datapointAttributes,
    "storage",
  );
  if (!storage || !node) {
    return null;
  }
  return {
    id: `storage/${node}/${storage}`,
    scope: "storage",
    type: "storage",
    labels: [
      stringAttribute("node", node),
      stringAttribute("storage", storage),
    ],
    infoMetricName: "pve_storage_info",
  };
}

// The attributes the agent's transform/pve-identity processor stamps.
function identityAttributes(identity: ResourceIdentity): Array<JSONObject> {
  return [
    stringAttribute("id", identity.id),
    stringAttribute("pve.scope", identity.scope),
    stringAttribute("pve.type", identity.type),
    stringAttribute(
      "pve.id",
      identity.id.substring(identity.id.indexOf("/") + 1),
    ),
  ];
}

function gaugePoint(data: {
  value: number | JSONValue;
  valueKey: "asInt" | "asDouble";
  timeUnixNano: JSONValue;
  attributes: Array<JSONObject>;
}): JSONObject {
  const point: JSONObject = {
    [data.valueKey]: data.value,
    attributes: data.attributes,
  };
  if (data.timeUnixNano !== undefined && data.timeUnixNano !== null) {
    point["timeUnixNano"] = data.timeUnixNano;
  }
  return point;
}

/*
 * Accumulates the derived datapoints of one resource block, keyed by
 * canonical metric name, plus one info/up series per resource seen.
 */
class DerivedSeries {
  private points: Map<string, Array<JSONObject>> = new Map();
  private resourcesSeen: Set<string> = new Set();
  // Timestamp of the first node seen — undefined when the block has none.
  public nodeTimeUnixNano: JSONValue | undefined = undefined;

  public add(metricName: string, point: JSONObject): void {
    let list: Array<JSONObject> | undefined = this.points.get(metricName);
    if (!list) {
      list = [];
      this.points.set(metricName, list);
    }
    list.push(point);
  }

  // First sighting of a resource in this block → emit its info series.
  public markSeen(identity: ResourceIdentity, timeUnixNano: JSONValue): void {
    const key: string = `${identity.scope}|${identity.id}`;
    if (this.resourcesSeen.has(key)) {
      return;
    }
    this.resourcesSeen.add(key);

    this.add(
      identity.infoMetricName,
      gaugePoint({
        value: "1",
        valueKey: "asInt",
        timeUnixNano,
        attributes: [...identityAttributes(identity), ...identity.labels],
      }),
    );

    /*
     * A node that pushes is up — pve-exporter reports its own view the
     * same way. A node that is down pushes nothing at all; its live
     * siblings report it (appendProxmoxSiblingReportsInPlace).
     */
    if (identity.scope === "node") {
      if (this.nodeTimeUnixNano === undefined) {
        this.nodeTimeUnixNano = timeUnixNano ?? null;
      }
      this.add(
        "pve_up",
        gaugePoint({
          value: "1",
          valueKey: "asInt",
          timeUnixNano,
          attributes: identityAttributes(identity),
        }),
      );
    }
  }

  public hasAny(): boolean {
    return this.points.size > 0;
  }

  public toMetrics(): Array<JSONObject> {
    const metrics: Array<JSONObject> = [];
    for (const [name, dataPoints] of this.points) {
      metrics.push({ name, gauge: { dataPoints } });
    }
    return metrics;
  }
}

function blockAlreadyHasPveSeries(scopeMetrics: JSONArray): boolean {
  for (const scopeMetric of scopeMetrics) {
    const metrics: JSONValue = (scopeMetric as JSONObject)?.["metrics"];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metric of metrics) {
      const name: JSONValue = (metric as JSONObject)?.["name"];
      if (typeof name === "string" && name.startsWith("pve_")) {
        return true;
      }
    }
  }
  return false;
}

function upsertResourceAttribute(
  attributes: JSONArray,
  key: string,
  value: string,
): void {
  for (const attribute of attributes) {
    const attr: JSONObject = attribute as JSONObject;
    if (attr && attr["key"] === key) {
      attr["value"] = { stringValue: value };
      return;
    }
  }
  attributes.push(stringAttribute(key, value));
}

/*
 * Drop the `service.name=proxmox-ve` PVE stamps, so the batch routes to
 * the discovered Proxmox cluster (per-cluster retention, no phantom
 * Service) exactly like the agent — whose collector config deletes
 * service.name for the same reason. A service.name the user set to
 * something else through the metric server's resource attributes is a
 * deliberate choice and is kept.
 */
function removeNativeServiceName(attributes: JSONArray): void {
  for (let i: number = attributes.length - 1; i >= 0; i--) {
    const attr: JSONObject = attributes[i] as JSONObject;
    if (
      attr &&
      attr["key"] === "service.name" &&
      readAttributeString([attr], "service.name") ===
        PROXMOX_NATIVE_PUSH_SERVICE_NAME
    ) {
      attributes.splice(i, 1);
    }
  }
}

/*
 * `service.version` is PVE's version_text(): "<version>/<repoid>", e.g.
 * "9.0.10/deb1ca707ec72a89". pve-exporter reports them as the `version`
 * and `repoid` labels of pve_version_info.
 */
function versionInfoLabels(resourceAttributes: JSONArray): Array<JSONObject> {
  const text: string | null = readAttributeString(
    resourceAttributes,
    "service.version",
  );
  if (!text) {
    return [];
  }
  const slash: number = text.indexOf("/");
  const version: string = (slash >= 0 ? text.substring(0, slash) : text).trim();
  const repoid: string = slash >= 0 ? text.substring(slash + 1).trim() : "";
  if (!version) {
    return [];
  }
  const labels: Array<JSONObject> = [stringAttribute("version", version)];
  if (repoid) {
    labels.push(stringAttribute("repoid", repoid));
  }
  return labels;
}

/*
 * Derive the pve_* series of one scopeMetrics entry and append them to
 * it. Returns what was derived, for the version-info decision.
 */
function deriveScopeMetrics(data: {
  scopeMetric: JSONObject;
  resourceNode: string | null;
}): DerivedSeries {
  const derived: DerivedSeries = new DerivedSeries();
  const metrics: JSONValue = data.scopeMetric["metrics"];
  if (!Array.isArray(metrics)) {
    return derived;
  }

  for (const metricValue of metrics) {
    const metric: JSONObject | null =
      metricValue && typeof metricValue === "object"
        ? (metricValue as JSONObject)
        : null;
    const metricName: JSONValue = metric?.["name"];
    if (!metric || typeof metricName !== "string") {
      continue;
    }
    const scope: NativeScope | null = scopeOfNativeSeries(metricName);
    if (!scope) {
      continue;
    }
    const canonicalName: string = canonicalNameOf(metricName, scope);

    for (const datapointValue of metricDataPoints(metric)) {
      const datapoint: JSONObject | null =
        datapointValue && typeof datapointValue === "object"
          ? (datapointValue as JSONObject)
          : null;
      if (!datapoint) {
        continue;
      }
      const value: number | null = readNumber(datapoint);
      if (value === null) {
        continue;
      }
      const identity: ResourceIdentity | null = identityOf({
        scope,
        datapointAttributes: datapoint["attributes"] as JSONArray | undefined,
        resourceNode: data.resourceNode,
      });
      if (!identity) {
        continue;
      }

      const timeUnixNano: JSONValue = datapoint["timeUnixNano"];
      derived.markSeen(identity, timeUnixNano);

      const hasDouble: boolean =
        datapoint["asDouble"] !== undefined && datapoint["asDouble"] !== null;
      derived.add(
        canonicalName,
        gaugePoint({
          value: hasDouble ? datapoint["asDouble"] : datapoint["asInt"],
          valueKey: hasDouble ? "asDouble" : "asInt",
          timeUnixNano,
          attributes: identityAttributes(identity),
        }),
      );

      /*
       * PVE has no run-state series for guests; a running guest is the
       * one with a non-zero uptime (vmstatus zeroes it when stopped).
       * pve-exporter's pve_up is the same "status == running" signal.
       */
      if (identity.scope === "guest" && metricName === "proxmox_vm_uptime") {
        derived.add(
          "pve_up",
          gaugePoint({
            value: value > 0 ? "1" : "0",
            valueKey: "asInt",
            timeUnixNano,
            attributes: identityAttributes(identity),
          }),
        );
      }
    }
  }

  return derived;
}

/*
 * Rewrite every Proxmox VE native-push block of an OTLP metrics payload
 * in place (see the header). Blocks from any other source — including
 * the Proxmox Agent — are left exactly as they are. Idempotent: a block
 * that already carries pve_* series (translated upstream, or already
 * rewritten) only gets its cluster identity filled in.
 */
export function normalizeProxmoxNativePushInPlace(
  resourceEnvelopes: JSONArray,
): void {
  if (!Array.isArray(resourceEnvelopes)) {
    return;
  }

  for (const envelopeValue of resourceEnvelopes) {
    const envelope: JSONObject | null =
      envelopeValue && typeof envelopeValue === "object"
        ? (envelopeValue as JSONObject)
        : null;
    const resource: JSONObject | undefined = envelope?.["resource"] as
      | JSONObject
      | undefined;
    const attributes: JSONValue = resource?.["attributes"];
    if (!envelope || !Array.isArray(attributes)) {
      continue;
    }
    const resourceAttributes: JSONArray = attributes as JSONArray;
    if (!isProxmoxNativePushResource(resourceAttributes)) {
      continue;
    }

    const clusterName: string | null =
      resolveProxmoxNativePushClusterName(resourceAttributes);
    if (clusterName) {
      upsertResourceAttribute(
        resourceAttributes,
        "proxmox.cluster.name",
        clusterName,
      );
    }
    removeNativeServiceName(resourceAttributes);

    const scopeMetricsValue: JSONValue = envelope["scopeMetrics"];
    if (!Array.isArray(scopeMetricsValue)) {
      continue;
    }
    const scopeMetrics: JSONArray = scopeMetricsValue as JSONArray;
    if (blockAlreadyHasPveSeries(scopeMetrics)) {
      continue;
    }

    const resourceNode: string | null = readAttributeString(
      resourceAttributes,
      "proxmox.node",
    );

    for (const scopeMetricValue of scopeMetrics) {
      if (!scopeMetricValue || typeof scopeMetricValue !== "object") {
        continue;
      }
      const scopeMetric: JSONObject = scopeMetricValue as JSONObject;
      const derived: DerivedSeries = deriveScopeMetrics({
        scopeMetric,
        resourceNode,
      });
      if (!derived.hasAny()) {
        continue;
      }

      /*
       * One version series per node push (PVE flushes node, qemu, lxc
       * and storage status as separate requests) — the node's own push
       * is the one that carries it.
       */
      if (derived.nodeTimeUnixNano !== undefined) {
        const labels: Array<JSONObject> = versionInfoLabels(resourceAttributes);
        if (labels.length > 0) {
          derived.add(
            "pve_version_info",
            gaugePoint({
              value: "1",
              valueKey: "asInt",
              timeUnixNano: derived.nodeTimeUnixNano,
              attributes: labels,
            }),
          );
        }
      }

      (scopeMetric["metrics"] as JSONArray).push(...derived.toMetrics());
    }
  }
}

/*
 * ------------------------------------------------------------------
 * Reporting the nodes that have stopped reporting
 * ------------------------------------------------------------------
 *
 * A native-push node that dies goes quiet — nothing ever says pve_up = 0
 * for it. The nodes still alive speak for it: a live node's own status
 * push carries, next to its own pve_up = 1, a pve_up = 0 for every
 * sibling that has gone quiet (ProxmoxNativeNodeLiveness decides which).
 * That is what pve-exporter does for the agent — one node's view reports
 * the dead ones — so the unchanged Node Offline and Cluster Quorum at
 * Risk monitors now fire on a native push too.
 *
 * The reports sit in their own scopeMetrics entry, named
 * PROXMOX_SIBLING_REPORT_SCOPE_NAME, and every datapoint carries
 * `oneuptime.proxmox.inferred = not-reporting`, so they can always be
 * told apart from what a node said itself. The inventory fold skips
 * them: a report must never refresh the silent node's "last seen".
 *
 * Quorum at Risk is Σ pve_up ÷ Σ pve_node_info over every row of a
 * minute, so each node must weigh the same in the denominator. Every
 * live node contributes one pve_node_info = 1 per push, and every live
 * node reports (ProxmoxNativeNodeLiveness): with L live nodes and D
 * silent ones, each report carries pve_node_info = D ÷ L in total (split
 * across the silent nodes). A minute in which the live nodes land P
 * pushes between them then sums to P in the numerator and P + P·D/L in
 * the denominator — the ratio is L ÷ (L + D), as with the agent, however
 * unevenly the pushes fall into the minute. The weights are multiples of
 * 2^-16, so any sum of them is exact in floating point, whatever order
 * ClickHouse adds them in, and rounded UP, so a cluster exactly half
 * down never reads a hair above 50 %.
 * ------------------------------------------------------------------
 */

export const PROXMOX_SIBLING_REPORT_SCOPE_NAME: string =
  "oneuptime.proxmox.sibling-report";

// Marks every reported datapoint as inferred, not measured.
export const PROXMOX_INFERRED_ATTRIBUTE: string = "oneuptime.proxmox.inferred";
export const PROXMOX_INFERRED_NOT_REPORTING: string = "not-reporting";

const WEIGHT_UNITS_PER_NODE: number = 65536; // 2^16

export function isProxmoxSiblingReportScope(
  scopeMetric: JSONValue | undefined,
): boolean {
  const scope: JSONValue | undefined =
    scopeMetric && typeof scopeMetric === "object"
      ? (scopeMetric as JSONObject)["scope"]
      : undefined;
  return Boolean(
    scope &&
      typeof scope === "object" &&
      (scope as JSONObject)["name"] === PROXMOX_SIBLING_REPORT_SCOPE_NAME,
  );
}

/*
 * The node a native-push block is the own status push of, and the
 * timestamps of its own pve_up points — or null for anything else
 * (guest / storage pushes, agent blocks, other telemetry). Reads the
 * block after normalizeProxmoxNativePushInPlace.
 */
export function readProxmoxNativeNodeStatus(
  envelope: JSONValue | undefined,
): { nodeName: string; timeUnixNanos: Array<JSONValue> } | null {
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const resource: JSONObject | undefined = (envelope as JSONObject)[
    "resource"
  ] as JSONObject | undefined;
  const attributes: JSONArray | undefined = resource?.["attributes"] as
    | JSONArray
    | undefined;
  if (!isProxmoxNativePushResource(attributes)) {
    return null;
  }
  const nodeName: string | null = readAttributeString(
    attributes,
    "proxmox.node",
  );
  const scopeMetrics: JSONValue = (envelope as JSONObject)["scopeMetrics"];
  if (!nodeName || !Array.isArray(scopeMetrics)) {
    return null;
  }

  const ownId: string = `node/${nodeName}`;
  const timeUnixNanos: Array<JSONValue> = [];
  for (const scopeMetric of scopeMetrics) {
    if (isProxmoxSiblingReportScope(scopeMetric)) {
      continue;
    }
    const metrics: JSONValue = (scopeMetric as JSONObject)?.["metrics"];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metric of metrics) {
      if ((metric as JSONObject)?.["name"] !== "pve_up") {
        continue;
      }
      for (const point of metricDataPoints(metric as JSONObject)) {
        const datapoint: JSONObject | null =
          point && typeof point === "object" ? (point as JSONObject) : null;
        if (
          datapoint &&
          readAttributeString(
            datapoint["attributes"] as JSONArray | undefined,
            "id",
          ) === ownId
        ) {
          timeUnixNanos.push(datapoint["timeUnixNano"] ?? null);
        }
      }
    }
  }

  return timeUnixNanos.length > 0 ? { nodeName, timeUnixNanos } : null;
}

/*
 * Each silent node's pve_node_info weight in one report: D ÷ L in total,
 * rounded up to whole 2^-16 units, split as evenly as possible (the first
 * nodes in the given order take the remainder). With L = D the weights
 * add up to exactly 1. Rounding up can only ever lower the ratio by a
 * negligible amount — too little to take a cluster with more live than
 * silent nodes down to 50 %.
 */
export function splitProxmoxSiblingInfoWeights(
  silentNodes: Array<string>,
  reporterCount: number,
): Array<{ nodeName: string; weight: number }> {
  if (silentNodes.length === 0 || reporterCount < 1) {
    return [];
  }
  const totalUnits: number = Math.ceil(
    (silentNodes.length * WEIGHT_UNITS_PER_NODE) / reporterCount,
  );
  const baseUnits: number = Math.floor(totalUnits / silentNodes.length);
  const remainder: number = totalUnits - baseUnits * silentNodes.length;
  return silentNodes.map((nodeName: string, index: number) => {
    return {
      nodeName,
      weight: (baseUnits + (index < remainder ? 1 : 0)) / WEIGHT_UNITS_PER_NODE,
    };
  });
}

/*
 * Append the "not reporting" reports to a node's own status push: per
 * own pve_up point, pve_up = 0 and a pve_node_info weight for every
 * silent sibling, at that point's timestamp, with the exact labels the
 * sibling's own push would carry. Idempotent.
 */
export function appendProxmoxSiblingReportsInPlace(
  envelope: JSONObject,
  report: {
    silentNodes: Array<string>;
    reporterCount: number;
    timeUnixNanos: Array<JSONValue>;
  },
): void {
  const scopeMetrics: JSONValue = envelope["scopeMetrics"];
  if (
    !Array.isArray(scopeMetrics) ||
    report.silentNodes.length === 0 ||
    report.timeUnixNanos.length === 0 ||
    scopeMetrics.some((scopeMetric: JSONValue) => {
      return isProxmoxSiblingReportScope(scopeMetric);
    })
  ) {
    return;
  }

  const upPoints: Array<JSONObject> = [];
  const infoPoints: Array<JSONObject> = [];
  const inferred: JSONObject = stringAttribute(
    PROXMOX_INFERRED_ATTRIBUTE,
    PROXMOX_INFERRED_NOT_REPORTING,
  );

  for (const { nodeName, weight } of splitProxmoxSiblingInfoWeights(
    report.silentNodes,
    report.reporterCount,
  )) {
    const identity: ResourceIdentity | null = identityOf({
      scope: "node",
      datapointAttributes: [],
      resourceNode: nodeName,
    });
    if (!identity) {
      continue;
    }
    for (const timeUnixNano of report.timeUnixNanos) {
      upPoints.push(
        gaugePoint({
          value: "0",
          valueKey: "asInt",
          timeUnixNano,
          attributes: [...identityAttributes(identity), inferred],
        }),
      );
      infoPoints.push(
        gaugePoint({
          value: weight,
          valueKey: "asDouble",
          timeUnixNano,
          attributes: [
            ...identityAttributes(identity),
            ...identity.labels,
            inferred,
          ],
        }),
      );
    }
  }

  if (upPoints.length === 0) {
    return;
  }

  (scopeMetrics as JSONArray).push({
    scope: { name: PROXMOX_SIBLING_REPORT_SCOPE_NAME, version: "1" },
    metrics: [
      { name: "pve_up", gauge: { dataPoints: upPoints } },
      { name: "pve_node_info", gauge: { dataPoints: infoPoints } },
    ],
  });
}
