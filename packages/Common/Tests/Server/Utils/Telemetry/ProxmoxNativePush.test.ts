import {
  PROXMOX_INFERRED_ATTRIBUTE,
  PROXMOX_INFERRED_NOT_REPORTING,
  PROXMOX_NATIVE_PUSH_SERVICE_NAME,
  PROXMOX_SIBLING_REPORT_SCOPE_NAME,
  appendProxmoxSiblingReportsInPlace,
  isProxmoxNativePushResource,
  isProxmoxSiblingReportScope,
  normalizeProxmoxNativePushInPlace,
  readProxmoxNativeNodeStatus,
  resolveProxmoxNativePushClusterName,
  splitProxmoxSiblingInfoWeights,
} from "../../../../Server/Utils/Telemetry/ProxmoxNativePush";
import {
  PVE_SNAPSHOT_METRIC_NAMES,
  ProxmoxClusterSnapshotBufferEntry,
  ProxmoxResourceBufferEntry,
  bufferProxmoxSnapshotMetric,
  deriveProxmoxClusterSnapshotExtras,
} from "../../../../Server/Utils/Telemetry/ProxmoxCephSnapshotScan";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../../Types/Monitor/ProxmoxMetricCatalog";
import MonitorStepProxmoxMonitor from "../../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../../Types/ObjectID";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Proxmox VE 9+ native OpenTelemetry push → the pve_* model.
 *
 * The payloads below are built exactly the way PVE::Status::OpenTelemetry
 * (pve-manager) builds them: one request per pvestatd status pass (node,
 * qemu, lxc, storage are flushed separately), resource attributes
 * service.name=proxmox-ve / service.version / proxmox.cluster /
 * proxmox.node, metric names `${prefix}_${key}` from the PVE status hash
 * (counters get `_total`), identity in `node` / `vmid` / `name` / `type` /
 * `storage` datapoint attributes, timeUnixNano = ctime * 1e9 as a JSON
 * number, integers as asInt, fractions as asDouble.
 */

const CTIME_S: number = 1700000000;
const TIME_NANO: number = CTIME_S * 1_000_000_000;

function attrs(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function dp(value: number, labels: Record<string, string>): JSONObject {
  const point: JSONObject = {
    timeUnixNano: TIME_NANO,
    attributes: attrs(labels),
  };
  if (Number.isInteger(value)) {
    point["asInt"] = value;
  } else {
    point["asDouble"] = value;
  }
  return point;
}

function gauge(
  name: string,
  value: number,
  labels: Record<string, string>,
): JSONObject {
  return { name, unit: "1", gauge: { dataPoints: [dp(value, labels)] } };
}

function counter(
  name: string,
  value: number,
  labels: Record<string, string>,
): JSONObject {
  return {
    name,
    unit: "bytes",
    sum: {
      dataPoints: [dp(value, labels)],
      aggregationTemporality: 2,
      isMonotonic: true,
    },
  };
}

function pveResource(
  metrics: Array<JSONObject>,
  overrides: {
    cluster?: string;
    node?: string;
    extra?: Record<string, string>;
  } = {},
): JSONObject {
  return {
    resource: {
      attributes: attrs({
        "service.name": PROXMOX_NATIVE_PUSH_SERVICE_NAME,
        "service.version": "9.0.10/deb1ca707ec72a89",
        "proxmox.cluster": overrides.cluster ?? "homelab",
        "proxmox.node": overrides.node ?? "pve1",
        ...(overrides.extra || {}),
      }),
    },
    scopeMetrics: [{ scope: {}, metrics }],
  };
}

const GIB: number = 1024 * 1024 * 1024;

// update_node_status: uptime, cpustat, memory, blockstat, nics.
function nodePush(node: string = "pve1"): JSONObject {
  const n: Record<string, string> = { node };
  return pveResource(
    [
      gauge("proxmox_node_uptime", 86400, n),
      gauge("proxmox_node_cpustat_cpu", 0.25, n),
      gauge("proxmox_node_cpustat_cpus", 16, n),
      gauge("proxmox_node_cpustat_avg1", 0.5, n),
      counter("proxmox_node_cpustat_user_total", 123456, n),
      gauge("proxmox_node_memory_memtotal", 64 * GIB, n),
      gauge("proxmox_node_memory_memused", 16 * GIB, n),
      gauge("proxmox_node_memory_swaptotal", 8 * GIB, n),
      gauge("proxmox_node_blockstat_total", 100 * GIB, n),
      gauge("proxmox_node_blockstat_used", 40 * GIB, n),
      gauge("proxmox_node_blockstat_avail", 60 * GIB, n),
      counter("proxmox_node_network_receive_total", 999, {
        node,
        device: "vmbr0",
      }),
    ],
    { node },
  );
}

function guestLabels(data: {
  vmid: string;
  type: string;
  name: string;
  node?: string;
}): Record<string, string> {
  return {
    vmid: data.vmid,
    node: data.node ?? "pve1",
    name: data.name,
    type: data.type,
  };
}

// update_qemu_status: every VM on the node, running or stopped.
function qemuPush(): JSONObject {
  const running: Record<string, string> = guestLabels({
    vmid: "100",
    type: "qemu",
    name: "web",
  });
  const stopped: Record<string, string> = guestLabels({
    vmid: "101",
    type: "qemu",
    name: "old-db",
  });
  return pveResource([
    gauge("proxmox_vm_uptime", 3600, running),
    gauge("proxmox_vm_cpu", 0.5, running),
    gauge("proxmox_vm_cpus", 4, running),
    gauge("proxmox_vm_mem", 2 * GIB, running),
    gauge("proxmox_vm_maxmem", 8 * GIB, running),
    gauge("proxmox_vm_disk", 0, running),
    gauge("proxmox_vm_maxdisk", 32 * GIB, running),
    counter("proxmox_vm_netin_total", 1000, running),
    counter("proxmox_vm_netout_total", 2000, running),
    counter("proxmox_vm_diskread_total", 3000, running),
    counter("proxmox_vm_diskwrite_total", 4000, running),
    gauge("proxmox_vm_pressurecpusome", 0.1, running),
    gauge("proxmox_vm_uptime", 0, stopped),
    gauge("proxmox_vm_cpu", 0, stopped),
    gauge("proxmox_vm_cpus", 2, stopped),
    gauge("proxmox_vm_mem", 0, stopped),
    gauge("proxmox_vm_maxmem", 4 * GIB, stopped),
  ]);
}

// update_lxc_status.
function lxcPush(): JSONObject {
  const ct: Record<string, string> = guestLabels({
    vmid: "200",
    type: "lxc",
    name: "dns",
  });
  return pveResource([
    gauge("proxmox_vm_uptime", 7200, ct),
    gauge("proxmox_vm_cpu", 0.05, ct),
    gauge("proxmox_vm_cpus", 1, ct),
    gauge("proxmox_vm_mem", 256 * 1024 * 1024, ct),
    gauge("proxmox_vm_maxmem", 512 * 1024 * 1024, ct),
    gauge("proxmox_vm_disk", 3 * GIB, ct),
    gauge("proxmox_vm_maxdisk", 8 * GIB, ct),
  ]);
}

// update_storage_status: only active storages are pushed.
function storagePush(): JSONObject {
  const local: Record<string, string> = { node: "pve1", storage: "local" };
  const zfs: Record<string, string> = { node: "pve1", storage: "local-zfs" };
  return pveResource([
    gauge("proxmox_storage_total", 100 * GIB, local),
    gauge("proxmox_storage_used", 40 * GIB, local),
    gauge("proxmox_storage_avail", 60 * GIB, local),
    gauge("proxmox_storage_active", 1, local),
    gauge("proxmox_storage_enabled", 1, local),
    gauge("proxmox_storage_shared", 0, local),
    gauge("proxmox_storage_total", 500 * GIB, zfs),
    gauge("proxmox_storage_used", 450 * GIB, zfs),
    gauge("proxmox_storage_active", 1, zfs),
  ]);
}

// ---- read helpers ----------------------------------------------------

function allMetrics(envelope: JSONObject): Array<JSONObject> {
  const out: Array<JSONObject> = [];
  for (const sm of envelope["scopeMetrics"] as JSONArray) {
    out.push(...((sm as JSONObject)["metrics"] as Array<JSONObject>));
  }
  return out;
}

function pointsOf(metric: JSONObject): Array<JSONObject> {
  const holder: JSONObject = (metric["gauge"] || metric["sum"]) as JSONObject;
  return holder["dataPoints"] as Array<JSONObject>;
}

function labelsOf(point: JSONObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of point["attributes"] as Array<JSONObject>) {
    out[a["key"] as string] = (a["value"] as JSONObject)[
      "stringValue"
    ] as string;
  }
  return out;
}

interface Series {
  name: string;
  value: JSONValue;
  labels: Record<string, string>;
  point: JSONObject;
  metric: JSONObject;
}

function pveSeries(envelope: JSONObject): Array<Series> {
  const out: Array<Series> = [];
  for (const metric of allMetrics(envelope)) {
    const name: string = metric["name"] as string;
    if (!name.startsWith("pve_")) {
      continue;
    }
    for (const point of pointsOf(metric)) {
      out.push({
        name,
        value: point["asDouble"] ?? point["asInt"],
        labels: labelsOf(point),
        point,
        metric,
      });
    }
  }
  return out;
}

function find(
  series: Array<Series>,
  name: string,
  id: string | undefined,
): Series {
  const match: Array<Series> = series.filter((s: Series) => {
    return s.name === name && s.labels["id"] === id;
  });
  if (match.length !== 1) {
    throw new Error(
      `expected exactly one ${name}{id=${id}}, found ${match.length}`,
    );
  }
  return match[0]!;
}

function resourceAttr(envelope: JSONObject, key: string): Array<string> {
  return (
    (envelope["resource"] as JSONObject)["attributes"] as Array<JSONObject>
  )
    .filter((a: JSONObject) => {
      return a["key"] === key;
    })
    .map((a: JSONObject) => {
      return (a["value"] as JSONObject)["stringValue"] as string;
    });
}

function normalized(envelope: JSONObject): JSONObject {
  normalizeProxmoxNativePushInPlace([envelope]);
  return envelope;
}

type NodeStatus = ReturnType<typeof readProxmoxNativeNodeStatus>;

interface SiblingWeight {
  nodeName: string;
  weight: number;
}

// Restamp every datapoint of a push (undefined drops the timestamp).
function withTime(
  envelope: JSONObject,
  timeUnixNano: JSONValue | undefined,
): JSONObject {
  for (const metric of allMetrics(envelope)) {
    for (const point of pointsOf(metric)) {
      if (timeUnixNano === undefined) {
        delete point["timeUnixNano"];
      } else {
        point["timeUnixNano"] = timeUnixNano;
      }
    }
  }
  return envelope;
}

// The scopeMetrics entries holding sibling reports.
function reportScopesOf(envelope: JSONObject): Array<JSONObject> {
  return (envelope["scopeMetrics"] as Array<JSONObject>).filter(
    (scopeMetric: JSONObject) => {
      return isProxmoxSiblingReportScope(scopeMetric);
    },
  );
}

// The one sibling-report scope of a push (fails when there is not one).
function reportScopeOf(envelope: JSONObject): JSONObject {
  const scopes: Array<JSONObject> = reportScopesOf(envelope);
  if (scopes.length !== 1) {
    throw new Error(
      `expected one sibling-report scope, found ${scopes.length}`,
    );
  }
  return scopes[0]!;
}

// The datapoints of one metric of the sibling-report scope.
function reportPointsOf(
  envelope: JSONObject,
  metricName: string,
): Array<JSONObject> {
  const metrics: Array<JSONObject> = reportScopeOf(envelope)[
    "metrics"
  ] as Array<JSONObject>;
  return metrics
    .filter((metric: JSONObject) => {
      return metric["name"] === metricName;
    })
    .flatMap((metric: JSONObject) => {
      return pointsOf(metric);
    });
}

function weightsOf(
  silentCount: number,
  reporterCount: number,
): Array<SiblingWeight> {
  const silentNodes: Array<string> = [];
  for (let i: number = 0; i < silentCount; i++) {
    silentNodes.push(`dead${i + 1}`);
  }
  return splitProxmoxSiblingInfoWeights(silentNodes, reporterCount);
}

function sumOf(values: Array<number>): number {
  let total: number = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

// ---- tests -----------------------------------------------------------

describe("isProxmoxNativePushResource", () => {
  test("recognises the resource PVE stamps on every push", () => {
    expect(
      isProxmoxNativePushResource(
        (nodePush()["resource"] as JSONObject)["attributes"] as JSONArray,
      ),
    ).toBe(true);
  });

  test("still recognises the block after service.name was dropped", () => {
    const envelope: JSONObject = normalized(nodePush());
    expect(
      isProxmoxNativePushResource(
        (envelope["resource"] as JSONObject)["attributes"] as JSONArray,
      ),
    ).toBe(true);
  });

  test("the Proxmox Agent's resource is not a native push", () => {
    expect(
      isProxmoxNativePushResource(attrs({ "proxmox.cluster.name": "homelab" })),
    ).toBe(false);
  });

  test("needs both proxmox.cluster and proxmox.node", () => {
    expect(
      isProxmoxNativePushResource(attrs({ "proxmox.cluster": "homelab" })),
    ).toBe(false);
    expect(isProxmoxNativePushResource(attrs({ "proxmox.node": "pve1" }))).toBe(
      false,
    );
    expect(
      isProxmoxNativePushResource(
        attrs({ "proxmox.cluster": "  ", "proxmox.node": "pve1" }),
      ),
    ).toBe(false);
  });

  test("tolerates missing or malformed attribute arrays", () => {
    expect(isProxmoxNativePushResource(undefined)).toBe(false);
    expect(
      isProxmoxNativePushResource([
        null,
        "x",
        { key: "proxmox.cluster" },
      ] as unknown as JSONArray),
    ).toBe(false);
  });
});

describe("resolveProxmoxNativePushClusterName", () => {
  test("uses the PVE cluster name", () => {
    expect(
      resolveProxmoxNativePushClusterName(
        attrs({ "proxmox.cluster": "homelab", "proxmox.node": "pve1" }),
      ),
    ).toBe("homelab");
  });

  test("an explicit proxmox.cluster.name wins, so existing clusters keep their identity", () => {
    expect(
      resolveProxmoxNativePushClusterName(
        attrs({
          "proxmox.cluster": "homelab",
          "proxmox.node": "pve1",
          "proxmox.cluster.name": "prod-cluster",
        }),
      ),
    ).toBe("prod-cluster");
  });

  test("a standalone node is its own cluster, not a shared 'single-node' bucket", () => {
    expect(
      resolveProxmoxNativePushClusterName(
        attrs({ "proxmox.cluster": "single-node", "proxmox.node": "nas" }),
      ),
    ).toBe("nas");
  });

  test("returns null when nothing identifies the cluster", () => {
    expect(resolveProxmoxNativePushClusterName(attrs({}))).toBeNull();
  });
});

describe("normalizeProxmoxNativePushInPlace — resource identity", () => {
  test("stamps proxmox.cluster.name from PVE's own proxmox.cluster", () => {
    const envelope: JSONObject = normalized(nodePush());
    expect(resourceAttr(envelope, "proxmox.cluster.name")).toEqual(["homelab"]);
  });

  test("keeps a user-supplied proxmox.cluster.name as the only one", () => {
    const envelope: JSONObject = normalized(
      pveResource([gauge("proxmox_node_uptime", 1, { node: "pve1" })], {
        extra: { "proxmox.cluster.name": "prod-cluster" },
      }),
    );
    expect(resourceAttr(envelope, "proxmox.cluster.name")).toEqual([
      "prod-cluster",
    ]);
  });

  test("drops service.name=proxmox-ve so the batch routes to the cluster, not a phantom Service", () => {
    const envelope: JSONObject = normalized(nodePush());
    expect(resourceAttr(envelope, "service.name")).toEqual([]);
    // The rest of what PVE sent is kept.
    expect(resourceAttr(envelope, "service.version")).toEqual([
      "9.0.10/deb1ca707ec72a89",
    ]);
    expect(resourceAttr(envelope, "proxmox.cluster")).toEqual(["homelab"]);
    expect(resourceAttr(envelope, "proxmox.node")).toEqual(["pve1"]);
  });

  test("keeps a service.name the user chose deliberately", () => {
    const envelope: JSONObject = pveResource([]);
    ((envelope["resource"] as JSONObject)["attributes"] as JSONArray).push({
      key: "service.name",
      value: { stringValue: "my-proxmox" },
    });
    normalized(envelope);
    expect(resourceAttr(envelope, "service.name")).toEqual(["my-proxmox"]);
  });

  test("leaves the Proxmox Agent's batches untouched", () => {
    const agent: JSONObject = {
      resource: { attributes: attrs({ "proxmox.cluster.name": "homelab" }) },
      scopeMetrics: [
        {
          scope: {},
          metrics: [gauge("pve_up", 1, { id: "node/pve1" })],
        },
      ],
    };
    const before: string = JSON.stringify(agent);
    normalizeProxmoxNativePushInPlace([agent]);
    expect(JSON.stringify(agent)).toBe(before);
  });

  test("leaves unrelated OTLP resources untouched", () => {
    const other: JSONObject = {
      resource: { attributes: attrs({ "service.name": "checkout" }) },
      scopeMetrics: [
        {
          scope: {},
          metrics: [gauge("proxmox_vm_cpu", 0.5, { vmid: "1", type: "qemu" })],
        },
      ],
    };
    const before: string = JSON.stringify(other);
    normalizeProxmoxNativePushInPlace([other]);
    expect(JSON.stringify(other)).toBe(before);
  });

  test("survives malformed envelopes without throwing", () => {
    expect(() => {
      normalizeProxmoxNativePushInPlace([
        null,
        1,
        "x",
        {},
        { resource: {} },
        { resource: { attributes: "nope" } },
        {
          resource: {
            attributes: attrs({
              "proxmox.cluster": "c",
              "proxmox.node": "n",
            }),
          },
          scopeMetrics: "nope",
        },
        {
          resource: {
            attributes: attrs({
              "proxmox.cluster": "c",
              "proxmox.node": "n",
            }),
          },
          scopeMetrics: [
            null,
            { metrics: "nope" },
            { metrics: [null, { name: 5 }, { name: "proxmox_vm_cpu" }] },
            {
              metrics: [
                { name: "proxmox_vm_cpu", gauge: { dataPoints: [null, {}] } },
              ],
            },
          ],
        },
      ] as unknown as JSONArray);
    }).not.toThrow();
    expect(() => {
      normalizeProxmoxNativePushInPlace(undefined as unknown as JSONArray);
    }).not.toThrow();
  });
});

describe("normalizeProxmoxNativePushInPlace — node push", () => {
  const series: Array<Series> = pveSeries(normalized(nodePush()));
  const id: string = "node/pve1";

  test("maps every node series the product reads", () => {
    expect(find(series, "pve_uptime_seconds", id).value).toBe(86400);
    expect(find(series, "pve_cpu_usage_ratio", id).value).toBe(0.25);
    expect(find(series, "pve_cpu_usage_limit", id).value).toBe(16);
    expect(find(series, "pve_memory_usage_bytes", id).value).toBe(16 * GIB);
    expect(find(series, "pve_memory_size_bytes", id).value).toBe(64 * GIB);
    expect(find(series, "pve_disk_usage_bytes", id).value).toBe(40 * GIB);
    expect(find(series, "pve_disk_size_bytes", id).value).toBe(100 * GIB);
  });

  test("a node that pushes is up, and gets its identity series", () => {
    expect(find(series, "pve_up", id).value).toBe("1");
    const info: Series = find(series, "pve_node_info", id);
    expect(info.value).toBe("1");
    expect(info.labels["name"]).toBe("pve1");
  });

  test("the PVE version is split into pve_version_info's version and repoid labels", () => {
    const version: Series = find(series, "pve_version_info", undefined);
    expect(version.labels).toEqual({
      version: "9.0.10",
      repoid: "deb1ca707ec72a89",
    });
    expect(version.point["timeUnixNano"]).toBe(TIME_NANO);
  });

  test("every data series carries the agent transform's identity attributes", () => {
    for (const s of series) {
      if (s.name === "pve_version_info") {
        continue;
      }
      expect(s.labels).toMatchObject({
        id,
        "pve.scope": "node",
        "pve.type": "node",
        "pve.id": "pve1",
      });
    }
  });

  test("derived series are gauges stamped with the push's timestamp", () => {
    for (const s of series) {
      expect(s.metric["gauge"]).toBeDefined();
      expect(s.metric["sum"]).toBeUndefined();
      expect(s.point["timeUnixNano"]).toBe(TIME_NANO);
    }
  });

  test("series with no pve-exporter counterpart are not invented", () => {
    const names: Set<string> = new Set(
      series.map((s: Series) => {
        return s.name;
      }),
    );
    expect([...names].sort()).toEqual(
      [
        "pve_cpu_usage_limit",
        "pve_cpu_usage_ratio",
        "pve_disk_size_bytes",
        "pve_disk_usage_bytes",
        "pve_memory_size_bytes",
        "pve_memory_usage_bytes",
        "pve_node_info",
        "pve_up",
        "pve_uptime_seconds",
        "pve_version_info",
      ].sort(),
    );
  });

  test("the original proxmox_* series stay exactly as PVE sent them", () => {
    const original: JSONObject = nodePush();
    const envelope: JSONObject = normalized(nodePush());
    const originals: Array<JSONObject> = allMetrics(envelope).filter(
      (m: JSONObject) => {
        return (m["name"] as string).startsWith("proxmox_");
      },
    );
    expect(originals).toEqual(allMetrics(original));
  });

  test("no version series when PVE sent no service.version", () => {
    const envelope: JSONObject = nodePush();
    const attributes: JSONArray = (envelope["resource"] as JSONObject)[
      "attributes"
    ] as JSONArray;
    (envelope["resource"] as JSONObject)["attributes"] = attributes.filter(
      (a: JSONValue) => {
        return (a as JSONObject)["key"] !== "service.version";
      },
    );
    const names: Array<string> = pveSeries(normalized(envelope)).map(
      (s: Series) => {
        return s.name;
      },
    );
    expect(names).not.toContain("pve_version_info");
  });

  test("a version without a repoid still reports the version", () => {
    const envelope: JSONObject = pveResource(
      [gauge("proxmox_node_uptime", 5, { node: "pve1" })],
      { extra: {} },
    );
    const attributes: Array<JSONObject> = (envelope["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>;
    for (const a of attributes) {
      if (a["key"] === "service.version") {
        a["value"] = { stringValue: "9.1.2" };
      }
    }
    expect(
      find(pveSeries(normalized(envelope)), "pve_version_info", undefined)
        .labels,
    ).toEqual({ version: "9.1.2" });
  });

  test("falls back to the resource's proxmox.node when a datapoint has no node label", () => {
    const envelope: JSONObject = pveResource(
      [gauge("proxmox_node_uptime", 42, {})],
      { node: "pve7" },
    );
    expect(
      find(pveSeries(normalized(envelope)), "pve_uptime_seconds", "node/pve7")
        .value,
    ).toBe(42);
  });
});

describe("normalizeProxmoxNativePushInPlace — guest pushes", () => {
  const qemu: Array<Series> = pveSeries(normalized(qemuPush()));
  const lxc: Array<Series> = pveSeries(normalized(lxcPush()));

  test("a VM maps onto qemu/<vmid> with every guest series", () => {
    const id: string = "qemu/100";
    expect(find(qemu, "pve_uptime_seconds", id).value).toBe(3600);
    expect(find(qemu, "pve_cpu_usage_ratio", id).value).toBe(0.5);
    expect(find(qemu, "pve_cpu_usage_limit", id).value).toBe(4);
    expect(find(qemu, "pve_memory_usage_bytes", id).value).toBe(2 * GIB);
    expect(find(qemu, "pve_memory_size_bytes", id).value).toBe(8 * GIB);
    expect(find(qemu, "pve_disk_usage_bytes", id).value).toBe(0);
    expect(find(qemu, "pve_disk_size_bytes", id).value).toBe(32 * GIB);
    expect(find(qemu, "pve_network_receive_bytes", id).value).toBe(1000);
    expect(find(qemu, "pve_network_transmit_bytes", id).value).toBe(2000);
    expect(find(qemu, "pve_disk_read_bytes", id).value).toBe(3000);
    expect(find(qemu, "pve_disk_write_bytes", id).value).toBe(4000);
  });

  test("a running guest is up, a stopped one is down (uptime is PVE's only run-state signal)", () => {
    expect(find(qemu, "pve_up", "qemu/100").value).toBe("1");
    expect(find(qemu, "pve_up", "qemu/101").value).toBe("0");
    expect(find(lxc, "pve_up", "lxc/200").value).toBe("1");
  });

  test("pve_guest_info carries the name, node and type labels the inventory reads", () => {
    expect(find(qemu, "pve_guest_info", "qemu/100").labels).toEqual({
      id: "qemu/100",
      "pve.scope": "guest",
      "pve.type": "qemu",
      "pve.id": "100",
      type: "qemu",
      name: "web",
      node: "pve1",
    });
    expect(find(lxc, "pve_guest_info", "lxc/200").labels).toMatchObject({
      "pve.type": "lxc",
      name: "dns",
    });
  });

  test("one info series per guest, however many series the guest pushed", () => {
    expect(
      qemu.filter((s: Series) => {
        return s.name === "pve_guest_info";
      }),
    ).toHaveLength(2);
  });

  test("an LXC container lands on the lxc/<vmid> id with the lxc type", () => {
    for (const s of lxc) {
      expect(s.labels).toMatchObject({
        id: "lxc/200",
        "pve.scope": "guest",
        "pve.type": "lxc",
        "pve.id": "200",
      });
    }
    expect(find(lxc, "pve_disk_usage_bytes", "lxc/200").value).toBe(3 * GIB);
  });

  test("counters pushed without the _total suffix map too", () => {
    const labels: Record<string, string> = guestLabels({
      vmid: "102",
      type: "qemu",
      name: "x",
    });
    const series: Array<Series> = pveSeries(
      normalized(
        pveResource([
          counter("proxmox_vm_netin", 1, labels),
          counter("proxmox_vm_netout", 2, labels),
          counter("proxmox_vm_diskread", 3, labels),
          counter("proxmox_vm_diskwrite", 4, labels),
        ]),
      ),
    );
    expect(find(series, "pve_network_receive_bytes", "qemu/102").value).toBe(1);
    expect(find(series, "pve_network_transmit_bytes", "qemu/102").value).toBe(
      2,
    );
    expect(find(series, "pve_disk_read_bytes", "qemu/102").value).toBe(3);
    expect(find(series, "pve_disk_write_bytes", "qemu/102").value).toBe(4);
  });

  test("a guest series without a usable vmid/type is skipped, not guessed", () => {
    const series: Array<Series> = pveSeries(
      normalized(
        pveResource([
          gauge("proxmox_vm_cpu", 0.5, { node: "pve1", type: "qemu" }),
          gauge("proxmox_vm_cpu", 0.5, { vmid: "5", node: "pve1" }),
          gauge("proxmox_vm_cpu", 0.5, {
            vmid: "6",
            node: "pve1",
            type: "openvz",
          }),
        ]),
      ),
    );
    expect(series).toEqual([]);
  });

  test("an integer vmid attribute is accepted", () => {
    const envelope: JSONObject = pveResource([
      {
        name: "proxmox_vm_cpu",
        gauge: {
          dataPoints: [
            {
              timeUnixNano: TIME_NANO,
              asDouble: 0.3,
              attributes: [
                { key: "vmid", value: { intValue: 300 } },
                { key: "type", value: { stringValue: "qemu" } },
              ],
            },
          ],
        },
      },
    ]);
    expect(
      find(pveSeries(normalized(envelope)), "pve_cpu_usage_ratio", "qemu/300")
        .value,
    ).toBe(0.3);
  });

  test("a non-numeric datapoint is skipped", () => {
    const labels: Record<string, string> = guestLabels({
      vmid: "100",
      type: "qemu",
      name: "web",
    });
    const envelope: JSONObject = pveResource([
      {
        name: "proxmox_vm_cpu",
        gauge: {
          dataPoints: [
            { timeUnixNano: TIME_NANO, attributes: attrs(labels) },
            {
              timeUnixNano: TIME_NANO,
              asDouble: "NaN",
              attributes: attrs(labels),
            },
          ],
        },
      },
    ]);
    expect(pveSeries(normalized(envelope))).toEqual([]);
  });

  test("int64 values sent as strings (protobuf-decoded) are carried over", () => {
    const labels: Record<string, string> = guestLabels({
      vmid: "100",
      type: "qemu",
      name: "web",
    });
    const envelope: JSONObject = pveResource([
      {
        name: "proxmox_vm_maxmem",
        gauge: {
          dataPoints: [
            {
              timeUnixNano: String(TIME_NANO),
              asInt: "8589934592",
              attributes: attrs(labels),
            },
          ],
        },
      },
    ]);
    const s: Series = find(
      pveSeries(normalized(envelope)),
      "pve_memory_size_bytes",
      "qemu/100",
    );
    expect(s.value).toBe("8589934592");
    expect(s.point["timeUnixNano"]).toBe(String(TIME_NANO));
  });

  test("guest pushes carry no node or version series", () => {
    for (const s of [...qemu, ...lxc]) {
      expect(["pve_node_info", "pve_version_info"]).not.toContain(s.name);
      expect(s.labels["pve.scope"]).toBe("guest");
    }
  });
});

describe("normalizeProxmoxNativePushInPlace — storage push", () => {
  const series: Array<Series> = pveSeries(normalized(storagePush()));

  test("storage maps onto storage/<node>/<storage>, pve-exporter's id format", () => {
    expect(
      find(series, "pve_disk_usage_bytes", "storage/pve1/local").value,
    ).toBe(40 * GIB);
    expect(
      find(series, "pve_disk_size_bytes", "storage/pve1/local").value,
    ).toBe(100 * GIB);
    expect(
      find(series, "pve_disk_usage_bytes", "storage/pve1/local-zfs").value,
    ).toBe(450 * GIB);
    expect(find(series, "pve_up", "storage/pve1/local").value).toBe(1);
  });

  test("pve_storage_info carries the node and storage labels", () => {
    expect(
      find(series, "pve_storage_info", "storage/pve1/local-zfs").labels,
    ).toEqual({
      id: "storage/pve1/local-zfs",
      "pve.scope": "storage",
      "pve.type": "storage",
      "pve.id": "pve1/local-zfs",
      node: "pve1",
      storage: "local-zfs",
    });
  });

  test("a storage series without a storage label is skipped", () => {
    expect(
      pveSeries(
        normalized(
          pveResource([gauge("proxmox_storage_used", 1, { node: "pve1" })]),
        ),
      ),
    ).toEqual([]);
  });
});

describe("normalizeProxmoxNativePushInPlace — idempotency", () => {
  test("running it twice derives nothing new", () => {
    const envelope: JSONObject = normalized(qemuPush());
    const once: string = JSON.stringify(envelope);
    normalizeProxmoxNativePushInPlace([envelope]);
    expect(JSON.stringify(envelope)).toBe(once);
  });

  test("a push already translated upstream (e.g. by a collector) is not doubled", () => {
    const envelope: JSONObject = pveResource([
      gauge(
        "proxmox_vm_cpu",
        0.5,
        guestLabels({
          vmid: "100",
          type: "qemu",
          name: "web",
        }),
      ),
      gauge("pve_cpu_usage_ratio", 0.5, { id: "qemu/100" }),
    ]);
    const series: Array<Series> = pveSeries(normalized(envelope));
    expect(series).toHaveLength(1);
    // The cluster identity is still filled in.
    expect(resourceAttr(envelope, "proxmox.cluster.name")).toEqual(["homelab"]);
  });

  test("a multi-resource payload is rewritten block by block", () => {
    const payload: JSONArray = [nodePush("pve1"), nodePush("pve2")];
    normalizeProxmoxNativePushInPlace(payload);
    expect(
      find(pveSeries(payload[0] as JSONObject), "pve_up", "node/pve1").value,
    ).toBe("1");
    expect(
      find(pveSeries(payload[1] as JSONObject), "pve_up", "node/pve2").value,
    ).toBe("1");
  });
});

/*
 * The translated series must be exactly what the real consumer — the
 * inventory / cluster snapshot scan — understands. Feed every derived
 * pve_* datapoint through bufferProxmoxSnapshotMetric the way the ingest
 * loop does.
 */
describe("translated pushes feed the Proxmox inventory", () => {
  function scan(envelopes: Array<JSONObject>): {
    rows: Array<ProxmoxResourceBufferEntry>;
    snap: ProxmoxClusterSnapshotBufferEntry;
  } {
    const resourceBuffer: Map<
      string,
      Map<string, ProxmoxResourceBufferEntry>
    > = new Map();
    const clusterBuffer: Map<string, ProxmoxClusterSnapshotBufferEntry> =
      new Map();
    normalizeProxmoxNativePushInPlace(envelopes as JSONArray);
    for (const envelope of envelopes) {
      const native: boolean = isProxmoxNativePushResource(
        (envelope["resource"] as JSONObject)["attributes"] as JSONArray,
      );
      for (const metric of allMetrics(envelope)) {
        const metricName: string = metric["name"] as string;
        if (!PVE_SNAPSHOT_METRIC_NAMES.has(metricName)) {
          continue;
        }
        for (const datapoint of pointsOf(metric)) {
          bufferProxmoxSnapshotMetric({
            clusterIdStr: "c1",
            metricName,
            datapoint,
            resourceBuffer,
            clusterBuffer,
            countsFromInventory: native,
          });
        }
      }
    }
    const rows: Array<ProxmoxResourceBufferEntry> = [
      ...(resourceBuffer.get("c1")?.values() || []),
    ].sort((a: ProxmoxResourceBufferEntry, b: ProxmoxResourceBufferEntry) => {
      return a.externalId.localeCompare(b.externalId);
    });
    return { rows, snap: clusterBuffer.get("c1")! };
  }

  function row(
    rows: Array<ProxmoxResourceBufferEntry>,
    externalId: string,
  ): ProxmoxResourceBufferEntry {
    const found: ProxmoxResourceBufferEntry | undefined = rows.find(
      (r: ProxmoxResourceBufferEntry) => {
        return r.externalId === externalId;
      },
    );
    if (!found) {
      throw new Error(`no inventory row ${externalId}`);
    }
    return found;
  }

  const { rows, snap } = scan([
    nodePush(),
    qemuPush(),
    lxcPush(),
    storagePush(),
  ]);

  test("every node, guest and storage becomes an inventory row", () => {
    expect(
      rows.map((r: ProxmoxResourceBufferEntry) => {
        return `${r.kind} ${r.externalId}`;
      }),
    ).toEqual([
      "Guest lxc/200",
      "Node node/pve1",
      "Guest qemu/100",
      "Guest qemu/101",
      "Storage storage/pve1/local",
      "Storage storage/pve1/local-zfs",
    ]);
  });

  test("the node row carries its name, state and latest metrics", () => {
    expect(row(rows, "node/pve1")).toMatchObject({
      kind: "Node",
      name: "pve1",
      isUp: true,
      uptimeSeconds: 86400,
      latestCpuPercent: 25,
      latestMemoryBytes: 16 * GIB,
      maxMemoryBytes: 64 * GIB,
      latestDiskBytes: 40 * GIB,
      maxDiskBytes: 100 * GIB,
      observedAt: new Date(CTIME_S * 1000),
    });
  });

  test("guest rows carry vmid, type, parent node and run state", () => {
    expect(row(rows, "qemu/100")).toMatchObject({
      kind: "Guest",
      name: "web",
      vmid: 100,
      guestType: "qemu",
      parentNodeName: "pve1",
      isUp: true,
      latestCpuPercent: 50,
      maxMemoryBytes: 8 * GIB,
    });
    expect(row(rows, "qemu/101")).toMatchObject({
      name: "old-db",
      isUp: false,
      uptimeSeconds: 0,
    });
    expect(row(rows, "lxc/200")).toMatchObject({
      name: "dns",
      vmid: 200,
      guestType: "lxc",
      isUp: true,
    });
  });

  test("storage rows carry name, parent node and capacity", () => {
    expect(row(rows, "storage/pve1/local-zfs")).toMatchObject({
      kind: "Storage",
      name: "local-zfs",
      parentNodeName: "pve1",
      isUp: true,
      latestDiskBytes: 450 * GIB,
      maxDiskBytes: 500 * GIB,
    });
  });

  test("the cluster learns its PVE version", () => {
    expect(snap.pveVersion).toBe("9.0.10");
  });

  test("a native push never derives cluster counts from one request", () => {
    expect(snap.countsFromInventory).toBe(true);
    expect(deriveProxmoxClusterSnapshotExtras(rows, snap)).toEqual({
      pveVersion: "9.0.10",
    });
  });
});

/*
 * ------------------------------------------------------------------
 * Reporting the nodes that have stopped reporting
 * ------------------------------------------------------------------
 *
 * A native-push node that dies goes quiet, so the live nodes' own status
 * pushes carry pve_up = 0 (and a pve_node_info share) for it. WHICH
 * siblings are silent is decided in ProxmoxNativeNodeLiveness; these are
 * the payload side: finding a node's own status push, splitting the
 * pve_node_info weight, and appending the reports.
 */

describe("isProxmoxSiblingReportScope", () => {
  test("recognises the scope the reports are appended under", () => {
    expect(PROXMOX_SIBLING_REPORT_SCOPE_NAME).toBe(
      "oneuptime.proxmox.sibling-report",
    );
    expect(
      isProxmoxSiblingReportScope({
        scope: { name: PROXMOX_SIBLING_REPORT_SCOPE_NAME, version: "1" },
        metrics: [],
      }),
    ).toBe(true);
    expect(
      isProxmoxSiblingReportScope({
        scope: { name: PROXMOX_SIBLING_REPORT_SCOPE_NAME },
      }),
    ).toBe(true);
  });

  test("any other scope — PVE's own is empty — is not a report", () => {
    expect(isProxmoxSiblingReportScope({ scope: {}, metrics: [] })).toBe(false);
    expect(isProxmoxSiblingReportScope({ scope: { name: "pve" } })).toBe(false);
    expect(isProxmoxSiblingReportScope({ metrics: [] })).toBe(false);
    // The name has to sit in scope.name.
    expect(
      isProxmoxSiblingReportScope({
        scope: PROXMOX_SIBLING_REPORT_SCOPE_NAME,
      }),
    ).toBe(false);
    expect(
      isProxmoxSiblingReportScope({ name: PROXMOX_SIBLING_REPORT_SCOPE_NAME }),
    ).toBe(false);
  });

  test("tolerates malformed input", () => {
    const inputs: Array<JSONValue | undefined> = [
      undefined,
      null,
      "x",
      5,
      true,
      [],
      { scope: null },
    ];
    for (const input of inputs) {
      expect(isProxmoxSiblingReportScope(input)).toBe(false);
    }
  });
});

describe("readProxmoxNativeNodeStatus", () => {
  const NATIVE_PVE1: JSONArray = attrs({
    "proxmox.cluster": "homelab",
    "proxmox.node": "pve1",
  });

  test("a node's own status push yields the node and the timestamp of its own pve_up", () => {
    expect(readProxmoxNativeNodeStatus(normalized(nodePush("pve2")))).toEqual({
      nodeName: "pve2",
      timeUnixNanos: [TIME_NANO],
    });
  });

  test("reads the block after the rewrite: a raw push carries no pve_up yet", () => {
    expect(readProxmoxNativeNodeStatus(nodePush())).toBeNull();
  });

  test("a guest or storage push is no node-status push, although it carries pve_up", () => {
    for (const push of [qemuPush(), lxcPush(), storagePush()]) {
      const envelope: JSONObject = normalized(push);
      expect(
        pveSeries(envelope).some((s: Series) => {
          return s.name === "pve_up";
        }),
      ).toBe(true);
      expect(readProxmoxNativeNodeStatus(envelope)).toBeNull();
    }
  });

  test("the Proxmox Agent's blocks are never read as a native node push", () => {
    const scopeMetrics: JSONArray = [
      {
        scope: {},
        metrics: [
          gauge("pve_up", 1, { id: "node/pve1", "pve.scope": "node" }),
          gauge("pve_node_info", 1, { id: "node/pve1", name: "pve1" }),
        ],
      },
    ];
    expect(
      readProxmoxNativeNodeStatus({
        resource: { attributes: attrs({ "proxmox.cluster.name": "homelab" }) },
        scopeMetrics,
      }),
    ).toBeNull();
    // Not even with a proxmox.node stamp — PVE's proxmox.cluster is missing.
    expect(
      readProxmoxNativeNodeStatus({
        resource: {
          attributes: attrs({
            "proxmox.cluster.name": "homelab",
            "proxmox.node": "pve1",
          }),
        },
        scopeMetrics,
      }),
    ).toBeNull();
  });

  test("other telemetry is ignored", () => {
    expect(
      readProxmoxNativeNodeStatus({
        resource: { attributes: attrs({ "service.name": "checkout" }) },
        scopeMetrics: [
          { scope: {}, metrics: [gauge("pve_up", 1, { id: "node/pve1" })] },
        ],
      }),
    ).toBeNull();
  });

  test("malformed input reads as null and never throws", () => {
    const inputs: Array<JSONValue | undefined> = [
      undefined,
      null,
      "x",
      5,
      [],
      {},
      { resource: null },
      { resource: {} },
      { resource: { attributes: "nope" } },
      { resource: { attributes: NATIVE_PVE1 } },
      { resource: { attributes: NATIVE_PVE1 }, scopeMetrics: "nope" },
      { resource: { attributes: NATIVE_PVE1 }, scopeMetrics: [] },
      {
        resource: { attributes: NATIVE_PVE1 },
        scopeMetrics: [
          null,
          "x",
          {},
          { metrics: "nope" },
          {
            metrics: [
              null,
              "x",
              { name: 5 },
              { name: "pve_up" },
              { name: "pve_up", gauge: null },
              { name: "pve_up", gauge: { dataPoints: "nope" } },
              {
                name: "pve_up",
                gauge: {
                  dataPoints: [
                    null,
                    "x",
                    {},
                    { attributes: "nope" },
                    { attributes: [null, { key: "id" }] },
                  ],
                },
              },
            ],
          },
        ],
      },
    ];
    for (const input of inputs) {
      expect(readProxmoxNativeNodeStatus(input)).toBeNull();
    }
  });

  test("points of the sibling-report scope never count as the node's own", () => {
    const reportAboutPve1: JSONObject = {
      scope: { name: PROXMOX_SIBLING_REPORT_SCOPE_NAME, version: "1" },
      metrics: [
        {
          name: "pve_up",
          gauge: {
            dataPoints: [
              {
                asInt: "0",
                timeUnixNano: TIME_NANO + 1_000_000_000,
                attributes: attrs({ id: "node/pve1", "pve.scope": "node" }),
              },
            ],
          },
        },
      ],
    };

    const envelope: JSONObject = normalized(nodePush("pve1"));
    (envelope["scopeMetrics"] as JSONArray).push(reportAboutPve1);
    expect(readProxmoxNativeNodeStatus(envelope)).toEqual({
      nodeName: "pve1",
      timeUnixNanos: [TIME_NANO],
    });

    // A block whose only node/pve1 pve_up is a report is no status push.
    expect(
      readProxmoxNativeNodeStatus({
        resource: { attributes: NATIVE_PVE1 },
        scopeMetrics: [reportAboutPve1],
      }),
    ).toBeNull();
  });

  test("pve_up of any other id is not the node's own", () => {
    // A block of pve1, translated upstream, carrying only other ids.
    expect(
      readProxmoxNativeNodeStatus(
        normalized(
          pveResource(
            [
              gauge("pve_up", 1, { id: "node/pve2", "pve.scope": "node" }),
              gauge("pve_up", 1, { id: "qemu/100", "pve.scope": "guest" }),
              gauge("pve_up", 1, {
                id: "storage/pve1/local",
                "pve.scope": "storage",
              }),
              // pve1's id, but not on pve_up.
              gauge("pve_node_info", 1, { id: "node/pve1", name: "pve1" }),
            ],
            { node: "pve1" },
          ),
        ),
      ),
    ).toBeNull();

    // A node series labelled with another node derives that node's id.
    expect(
      readProxmoxNativeNodeStatus(
        normalized(
          pveResource([gauge("proxmox_node_uptime", 5, { node: "pve9" })], {
            node: "pve1",
          }),
        ),
      ),
    ).toBeNull();

    // Among other ids, only the node's own point is read.
    expect(
      readProxmoxNativeNodeStatus(
        normalized(
          pveResource(
            [
              gauge("pve_up", 1, { id: "node/pve2" }),
              {
                name: "pve_up",
                gauge: {
                  dataPoints: [
                    {
                      asInt: 1,
                      timeUnixNano: TIME_NANO + 5_000_000_000,
                      attributes: attrs({ id: "node/pve1" }),
                    },
                  ],
                },
              },
            ],
            { node: "pve1" },
          ),
        ),
      ),
    ).toEqual({ nodeName: "pve1", timeUnixNanos: [TIME_NANO + 5_000_000_000] });
  });

  test("every own pve_up point is read in order, its timestamp exactly as sent", () => {
    // Two node-status scopes in one block, the second one protobuf-decoded.
    const later: string = String(TIME_NANO + 10_000_000_000);
    const envelope: JSONObject = nodePush("pve1");
    (envelope["scopeMetrics"] as JSONArray).push(
      ...(withTime(nodePush("pve1"), later)["scopeMetrics"] as JSONArray),
    );
    expect(readProxmoxNativeNodeStatus(normalized(envelope))).toEqual({
      nodeName: "pve1",
      timeUnixNanos: [TIME_NANO, later],
    });
  });

  test("an own pve_up without a timestamp reads as a null timestamp", () => {
    expect(
      readProxmoxNativeNodeStatus(
        normalized(withTime(nodePush("pve1"), undefined)),
      ),
    ).toEqual({ nodeName: "pve1", timeUnixNanos: [null] });
  });

  test("reads the same once the node's own reports are appended", () => {
    const envelope: JSONObject = normalized(nodePush("pve1"));
    const before: NodeStatus = readProxmoxNativeNodeStatus(envelope);
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: ["pve2", "pve3"],
      reporterCount: 1,
      timeUnixNanos: before!.timeUnixNanos,
    });
    expect(reportScopesOf(envelope)).toHaveLength(1);
    expect(readProxmoxNativeNodeStatus(envelope)).toEqual(before);
  });
});

describe("splitProxmoxSiblingInfoWeights", () => {
  const UNITS_PER_NODE: number = 65536; // 2^16

  function unitsOf(weights: Array<SiblingWeight>): Array<number> {
    return weights.map((w: SiblingWeight) => {
      return w.weight * UNITS_PER_NODE;
    });
  }

  function valuesOf(weights: Array<SiblingWeight>): Array<number> {
    return weights.map((w: SiblingWeight) => {
      return w.weight;
    });
  }

  test("nothing to split without silent nodes or reporters", () => {
    expect(splitProxmoxSiblingInfoWeights([], 3)).toEqual([]);
    expect(splitProxmoxSiblingInfoWeights([], 0)).toEqual([]);
    expect(splitProxmoxSiblingInfoWeights(["pve3"], 0)).toEqual([]);
    expect(splitProxmoxSiblingInfoWeights(["pve3"], -1)).toEqual([]);
    expect(splitProxmoxSiblingInfoWeights(["pve3"], 0.5)).toEqual([]);
  });

  test("one reporter, one silent node: the report weighs one node", () => {
    expect(splitProxmoxSiblingInfoWeights(["pve2"], 1)).toEqual([
      { nodeName: "pve2", weight: 1 },
    ]);
  });

  test("simple splits", () => {
    expect(splitProxmoxSiblingInfoWeights(["pve3"], 2)).toEqual([
      { nodeName: "pve3", weight: 0.5 },
    ]);
    expect(splitProxmoxSiblingInfoWeights(["pve2", "pve3"], 1)).toEqual([
      { nodeName: "pve2", weight: 1 },
      { nodeName: "pve3", weight: 1 },
    ]);
    expect(splitProxmoxSiblingInfoWeights(["pve3", "pve4"], 4)).toEqual([
      { nodeName: "pve3", weight: 0.25 },
      { nodeName: "pve4", weight: 0.25 },
    ]);
  });

  test("keeps the silent nodes' names and order, and leaves the input alone", () => {
    const silentNodes: Array<string> = ["pve9", "pve3", "pve5"];
    expect(
      splitProxmoxSiblingInfoWeights(silentNodes, 2).map((w: SiblingWeight) => {
        return w.nodeName;
      }),
    ).toEqual(["pve9", "pve3", "pve5"]);
    expect(silentNodes).toEqual(["pve9", "pve3", "pve5"]);
  });

  test("L = D: one report's weights add up to exactly 1, in any order", () => {
    for (let silent: number = 1; silent <= 32; silent++) {
      const weights: Array<number> = valuesOf(weightsOf(silent, silent));
      expect(sumOf(weights)).toBe(1);
      expect(sumOf([...weights].reverse())).toBe(1);
    }
  });

  test("the remainder goes to the first nodes", () => {
    // 5 × 65536 ÷ 3 = 109226.67… → 109227 units: 2 × 21846 + 3 × 21845.
    expect(
      unitsOf(splitProxmoxSiblingInfoWeights(["a", "b", "c", "d", "e"], 3)),
    ).toEqual([21846, 21846, 21845, 21845, 21845]);
    // 2 × 65536 ÷ 3 = 43690.67… → 43691 units: 21846 + 21845.
    expect(unitsOf(splitProxmoxSiblingInfoWeights(["a", "b"], 3))).toEqual([
      21846, 21845,
    ]);
    // L = D = 3: 65536 units, 21846 + 21845 + 21845 — still exactly 1.
    expect(unitsOf(splitProxmoxSiblingInfoWeights(["a", "b", "c"], 3))).toEqual(
      [21846, 21845, 21845],
    );
  });

  test("every weight is a whole number of 2^-16 units, the total within one unit of D ÷ L, split as evenly as possible", () => {
    const failures: Array<string> = [];
    for (let silent: number = 1; silent <= 32; silent++) {
      for (let reporters: number = 1; reporters <= 32; reporters++) {
        const weights: Array<SiblingWeight> = weightsOf(silent, reporters);
        const units: Array<number> = unitsOf(weights);
        const label: string = `D=${silent} L=${reporters} units=${units.join(",")}`;
        if (weights.length !== silent) {
          failures.push(`${label}: ${weights.length} weights`);
        }
        if (!units.every(Number.isInteger)) {
          failures.push(`${label}: not whole units`);
        }
        if (
          Math.abs(sumOf(units) - (silent * UNITS_PER_NODE) / reporters) >= 1
        ) {
          failures.push(`${label}: total is not within one unit of D ÷ L`);
        }
        if (Math.max(...units) - Math.min(...units) > 1) {
          failures.push(`${label}: uneven split`);
        }
        for (let i: number = 1; i < units.length; i++) {
          if ((units[i] as number) > (units[i - 1] as number)) {
            failures.push(`${label}: a later node got the remainder`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("L > D weighs less than one node per report, L < D more — only L = D weighs exactly one", () => {
    const failures: Array<string> = [];
    for (let silent: number = 1; silent <= 32; silent++) {
      for (let reporters: number = 1; reporters <= 32; reporters++) {
        const total: number = sumOf(valuesOf(weightsOf(silent, reporters)));
        const expected: boolean =
          reporters > silent
            ? total < 1
            : reporters < silent
              ? total > 1
              : total === 1;
        if (!expected) {
          failures.push(`D=${silent} L=${reporters}: total ${total}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/*
 * Cluster Quorum at Risk is Σ pve_up ÷ Σ pve_node_info over every
 * pve.scope=node row of a minute, compared with <= 50 %. On a native push
 * each live node adds pve_up 1 and pve_node_info 1 per push, and each
 * eligible reporter's push adds the report: pve_up 0 and a weight per
 * silent node. The weights must keep L live nodes over D silent ones at
 * L ÷ (L + D), and L = D at exactly 50 % — whatever order ClickHouse adds
 * the rows in.
 */
describe("sibling-report weights keep Quorum at Risk exact at 50 %", () => {
  type Random = () => number;

  const PUSH_INTERVAL_MS: number = 10_000;
  const MINUTE_MS: number = 60_000;

  interface MinuteBucket {
    pushesPerNode: Array<number>;
    upValues: Array<number>; // every pve_up{pve.scope=node} row
    infoValues: Array<number>; // every pve_node_info{pve.scope=node} row
  }

  /*
   * mulberry32: a small seeded PRNG, so every run explores the same
   * cases and a failure reproduces.
   */
  function seededRandom(seed: number): Random {
    let state: number = seed >>> 0;
    return (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t: number = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled<T>(items: Array<T>, random: Random): Array<T> {
    const out: Array<T> = [...items];
    for (let i: number = out.length - 1; i > 0; i--) {
      const j: number = Math.floor(random() * (i + 1));
      const swap: T = out[i] as T;
      out[i] = out[j] as T;
      out[j] = swap;
    }
    return out;
  }

  /*
   * Sum the way ClickHouse does: the rows arrive in no particular order
   * and are spread over several threads that each keep a partial sum;
   * the partial sums are then added together, in no particular order
   * either.
   */
  function parallelSum(values: Array<number>, random: Random): number {
    const partials: Array<number> = new Array<number>(
      1 + Math.floor(random() * 8),
    ).fill(0);
    for (const value of shuffled(values, random)) {
      const index: number = Math.floor(random() * partials.length);
      partials[index] = (partials[index] as number) + value;
    }
    return sumOf(shuffled(partials, random));
  }

  /*
   * `liveNodes` nodes, all of them eligible reporters, push every ~10 s
   * (pvestatd sleeps 10 s after a pass that itself takes a moment) from
   * a random phase, with jitter. A push is the node's own pve_up = 1 and
   * pve_node_info = 1, plus its report: pve_up = 0 and the report's
   * weight for every silent node.
   */
  function simulateMinuteBuckets(data: {
    liveNodes: number;
    reportWeights: Array<number>;
    minutes: number;
    random: Random;
  }): Array<MinuteBucket> {
    const buckets: Array<MinuteBucket> = [];
    for (let minute: number = 0; minute < data.minutes; minute++) {
      buckets.push({
        pushesPerNode: new Array<number>(data.liveNodes).fill(0),
        upValues: [],
        infoValues: [],
      });
    }
    for (let node: number = 0; node < data.liveNodes; node++) {
      let pushAtMs: number = data.random() * PUSH_INTERVAL_MS;
      while (pushAtMs < data.minutes * MINUTE_MS) {
        const bucket: MinuteBucket = buckets[
          Math.floor(pushAtMs / MINUTE_MS)
        ] as MinuteBucket;
        bucket.pushesPerNode[node] = (bucket.pushesPerNode[node] as number) + 1;
        bucket.upValues.push(1);
        bucket.infoValues.push(1);
        for (const weight of data.reportWeights) {
          bucket.upValues.push(0);
          bucket.infoValues.push(weight);
        }
        // 9.7 s .. 10.7 s to the next push.
        pushAtMs += PUSH_INTERVAL_MS - 300 + data.random() * 1000;
      }
    }
    return buckets;
  }

  // The template's formula: (nodes_online / nodes_total) * 100.
  function quorumPercent(bucket: MinuteBucket, random: Random): number {
    const online: number = parallelSum(bucket.upValues, random);
    const total: number = parallelSum(bucket.infoValues, random);
    return (online / total) * 100;
  }

  function boundaryFailure(data: {
    bucket: MinuteBucket;
    live: number;
    silent: number;
    random: Random;
  }): string | null {
    const label: string = `L=${data.live} D=${data.silent} pushes=${data.bucket.pushesPerNode.join(",")}`;
    for (const pushes of data.bucket.pushesPerNode) {
      if (pushes < 5 || pushes > 7) {
        return `${label}: a node pushed ${pushes} times in the minute`;
      }
    }
    const percent: number = quorumPercent(data.bucket, data.random);
    if (data.live <= data.silent && !(percent <= 50)) {
      return `${label}: ${percent} % does not fire (<= 50 %)`;
    }
    if (data.live === data.silent && percent !== 50) {
      return `${label}: ${percent} % is not exactly 50 %`;
    }
    if (data.live < data.silent && !(percent < 50)) {
      return `${label}: ${percent} % is not below 50 %`;
    }
    if (data.live > data.silent && !(percent > 50)) {
      return `${label}: ${percent} % fires (<= 50 %) with a majority up`;
    }
    const exact: number = (100 * data.live) / (data.live + data.silent);
    // Within the 2^-16 rounding of the weights.
    if (Math.abs(percent - exact) > 0.002) {
      return `${label}: ${percent} % is not L ÷ (L + D) = ${exact} %`;
    }
    return null;
  }

  test("2..32 nodes, every D: exactly 50 % when L = D, below when L < D, above when L > D — any push phase, any summation order", () => {
    const random: Random = seededRandom(0x5eed);
    const failures: Array<string> = [];
    let evenBuckets: number = 0;
    let unevenBuckets: number = 0;

    for (let nodes: number = 2; nodes <= 32; nodes++) {
      for (let silent: number = 1; silent < nodes; silent++) {
        const live: number = nodes - silent;
        const reportWeights: Array<number> = weightsOf(silent, live).map(
          (w: SiblingWeight) => {
            return w.weight;
          },
        );
        for (let trial: number = 0; trial < 2; trial++) {
          for (const bucket of simulateMinuteBuckets({
            liveNodes: live,
            reportWeights,
            minutes: 3,
            random,
          })) {
            /*
             * The claim is for a minute in which every live node pushed
             * the same number of times. Every live node here is a
             * reporter, so the other minutes hold too — each push adds
             * its own 1 and its report's D ÷ L alike — and are checked
             * as well.
             */
            if (new Set(bucket.pushesPerNode).size === 1) {
              evenBuckets++;
            } else {
              unevenBuckets++;
            }
            const failure: string | null = boundaryFailure({
              bucket,
              live,
              silent,
              random,
            });
            if (failure) {
              failures.push(failure);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
    // Both kinds of minute were exercised.
    expect(evenBuckets).toBeGreaterThan(100);
    expect(unevenBuckets).toBeGreaterThan(0);
  });

  test("naive 1 ÷ L float weights do not: for some L half the cluster is down and the ratio reads above 50 %", () => {
    const random: Random = seededRandom(0x5eed);
    const missedAt: Set<number> = new Set();

    // L = D, so 2..32 nodes.
    for (let live: number = 1; live <= 16; live++) {
      const naiveWeights: Array<number> = new Array<number>(live).fill(
        1 / live,
      );
      for (let trial: number = 0; trial < 4; trial++) {
        for (const bucket of simulateMinuteBuckets({
          liveNodes: live,
          reportWeights: naiveWeights,
          minutes: 3,
          random,
        })) {
          if (quorumPercent(bucket, random) > 50) {
            missedAt.add(live);
          }
        }
      }
    }
    // Quorum at Risk (<= 50 %) would stay quiet for these clusters.
    expect(missedAt.size).toBeGreaterThan(0);

    /*
     * The plainest case: three live nodes each reporting the three dead
     * ones, six pushes each, summed in push order.
     */
    function inPushOrder(reportWeights: Array<number>): number {
      let online: number = 0;
      let total: number = 0;
      for (let push: number = 0; push < 3 * 6; push++) {
        online += 1;
        total += 1;
        for (const weight of reportWeights) {
          total += weight;
        }
      }
      return (online / total) * 100;
    }
    expect(inPushOrder([1 / 3, 1 / 3, 1 / 3])).toBeGreaterThan(50);
    expect(
      inPushOrder(
        weightsOf(3, 3).map((w: SiblingWeight) => {
          return w.weight;
        }),
      ),
    ).toBe(50);
  });

  /*
   * A minute in which every live node pushed `pushes` times: the first
   * `reporters` of them carry the report, the others do not — nodes that
   * are alive but not eligible reporters (yet): in their first two
   * minutes of pushing, or pushing more than a minute apart.
   */
  function evenMinute(data: {
    reporters: number;
    nonReporters: number;
    reportWeights: Array<number>;
    pushes: number;
  }): MinuteBucket {
    const bucket: MinuteBucket = {
      pushesPerNode: [],
      upValues: [],
      infoValues: [],
    };
    for (
      let node: number = 0;
      node < data.reporters + data.nonReporters;
      node++
    ) {
      bucket.pushesPerNode.push(data.pushes);
      for (let push: number = 0; push < data.pushes; push++) {
        bucket.upValues.push(1);
        bucket.infoValues.push(1);
        if (node < data.reporters) {
          for (const weight of data.reportWeights) {
            bucket.upValues.push(0);
            bucket.infoValues.push(weight);
          }
        }
      }
    }
    return bucket;
  }

  /*
   * A round of pushes must add D to the denominator even when some live
   * nodes do not report: the L reporters add L × W, so W must not fall
   * short of D ÷ L. Rounding the split to the nearest 2^-16 unit does
   * fall short when L does not divide D × 2^16 — 3 reporters and a
   * fourth live node over 4 dead add 3.99998 a round, and half the
   * cluster down reads 50.0001 %. Rounding up keeps the boundary.
   */
  test("a live node that does not report yet still counts: half the cluster down reads <= 50 %, whatever L", () => {
    const random: Random = seededRandom(0x5eed);
    const failures: Array<string> = [];

    for (let nodes: number = 2; nodes <= 32; nodes++) {
      for (let silent: number = 1; silent < nodes; silent++) {
        const live: number = nodes - silent;
        for (
          let nonReporters: number = 1;
          nonReporters < live;
          nonReporters++
        ) {
          const reporters: number = live - nonReporters;
          const reportWeights: Array<number> = weightsOf(silent, reporters).map(
            (w: SiblingWeight) => {
              return w.weight;
            },
          );
          // In an even minute the ratio does not depend on the push count.
          const percent: number = quorumPercent(
            evenMinute({ reporters, nonReporters, reportWeights, pushes: 6 }),
            random,
          );
          const holds: boolean =
            live === silent
              ? percent <= 50
              : live < silent
                ? percent < 50
                : percent > 50;
          if (!holds) {
            failures.push(
              `${live} live (${reporters} reporting) over ${silent} dead: ${percent} %`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("appendProxmoxSiblingReportsInPlace", () => {
  type SiblingReport = Parameters<typeof appendProxmoxSiblingReportsInPlace>[1];

  const INFERRED: JSONObject = {
    key: PROXMOX_INFERRED_ATTRIBUTE,
    value: { stringValue: PROXMOX_INFERRED_NOT_REPORTING },
  };

  // pve1's own status push, rewritten, with its reports appended.
  function reportingPush(report: {
    silentNodes: Array<string>;
    reporterCount: number;
    timeUnixNanos?: Array<JSONValue> | undefined;
  }): JSONObject {
    const envelope: JSONObject = normalized(nodePush("pve1"));
    const status: NodeStatus = readProxmoxNativeNodeStatus(envelope);
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: report.silentNodes,
      reporterCount: report.reporterCount,
      timeUnixNanos: report.timeUnixNanos ?? status!.timeUnixNanos,
    });
    return envelope;
  }

  // The attributes a node's OWN push gives one of its own series.
  function ownAttributes(node: string, metricName: string): JSONArray {
    return find(
      pveSeries(normalized(nodePush(node))),
      metricName,
      `node/${node}`,
    ).point["attributes"] as JSONArray;
  }

  function pointsFor(points: Array<JSONObject>, id: string): Array<JSONObject> {
    return points.filter((point: JSONObject) => {
      return labelsOf(point)["id"] === id;
    });
  }

  function idsOf(points: Array<JSONObject>): Array<string | undefined> {
    return points.map((point: JSONObject) => {
      return labelsOf(point)["id"];
    });
  }

  test("marks the reports with the documented attribute", () => {
    expect(PROXMOX_INFERRED_ATTRIBUTE).toBe("oneuptime.proxmox.inferred");
    expect(PROXMOX_INFERRED_NOT_REPORTING).toBe("not-reporting");
  });

  test("appends exactly one scopeMetrics entry, in its own named and versioned scope", () => {
    const own: number = (
      normalized(nodePush("pve1"))["scopeMetrics"] as JSONArray
    ).length;
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
    });
    const scopeMetrics: Array<JSONObject> = envelope[
      "scopeMetrics"
    ] as Array<JSONObject>;
    expect(scopeMetrics).toHaveLength(own + 1);

    const report: JSONObject = scopeMetrics[scopeMetrics.length - 1]!;
    expect(report["scope"]).toEqual({
      name: PROXMOX_SIBLING_REPORT_SCOPE_NAME,
      version: "1",
    });
    expect(isProxmoxSiblingReportScope(report)).toBe(true);
    expect(report["metrics"]).toEqual([
      { name: "pve_up", gauge: { dataPoints: expect.any(Array) } },
      { name: "pve_node_info", gauge: { dataPoints: expect.any(Array) } },
    ]);
  });

  test("pve_up = 0, as an int, for every silent node at the push's own timestamp", () => {
    const up: Array<JSONObject> = reportPointsOf(
      reportingPush({ silentNodes: ["pve2", "pve3"], reporterCount: 2 }),
      "pve_up",
    );
    expect(idsOf(up)).toEqual(["node/pve2", "node/pve3"]);
    for (const point of up) {
      expect(point["asInt"]).toBe("0");
      expect(point["asDouble"]).toBeUndefined();
      expect(point["timeUnixNano"]).toBe(TIME_NANO);
    }
  });

  test("pve_node_info carries each silent node's weight as a double — D ÷ L in all", () => {
    // Two silent, three reporters: 2 × 65536 ÷ 3 → 21846 + 21845 units.
    const info: Array<JSONObject> = reportPointsOf(
      reportingPush({ silentNodes: ["pve4", "pve5"], reporterCount: 3 }),
      "pve_node_info",
    );
    expect(
      info.map((point: JSONObject) => {
        return [labelsOf(point)["id"], point["asDouble"]];
      }),
    ).toEqual([
      ["node/pve4", 21846 / 65536],
      ["node/pve5", 21845 / 65536],
    ]);
    for (const point of info) {
      expect(point["asInt"]).toBeUndefined();
      expect(point["timeUnixNano"]).toBe(TIME_NANO);
    }

    // L = D: one report weighs exactly one node.
    const even: Array<JSONObject> = reportPointsOf(
      reportingPush({ silentNodes: ["pve2", "pve3"], reporterCount: 2 }),
      "pve_node_info",
    );
    expect(
      sumOf(
        even.map((point: JSONObject) => {
          return point["asDouble"] as number;
        }),
      ),
    ).toBe(1);
  });

  test("the labels are exactly those the silent node's own push carries, plus the inferred marker", () => {
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
    });
    for (const node of ["pve2", "pve3"]) {
      const up: Array<JSONObject> = pointsFor(
        reportPointsOf(envelope, "pve_up"),
        `node/${node}`,
      );
      const info: Array<JSONObject> = pointsFor(
        reportPointsOf(envelope, "pve_node_info"),
        `node/${node}`,
      );
      expect(up).toHaveLength(1);
      expect(info).toHaveLength(1);
      expect(up[0]!["attributes"]).toEqual([
        ...ownAttributes(node, "pve_up"),
        INFERRED,
      ]);
      expect(info[0]!["attributes"]).toEqual([
        ...ownAttributes(node, "pve_node_info"),
        INFERRED,
      ]);
      expect(labelsOf(info[0]!)).toEqual({
        id: `node/${node}`,
        "pve.scope": "node",
        "pve.type": "node",
        "pve.id": node,
        name: node,
        [PROXMOX_INFERRED_ATTRIBUTE]: PROXMOX_INFERRED_NOT_REPORTING,
      });
    }
  });

  test("one point per silent node per own timestamp, each timestamp kept exactly as sent", () => {
    const later: string = String(TIME_NANO + 10_000_000_000);
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3", "pve4"],
      reporterCount: 1,
      timeUnixNanos: [TIME_NANO, later],
    });
    for (const metricName of ["pve_up", "pve_node_info"]) {
      const points: Array<JSONObject> = reportPointsOf(envelope, metricName);
      expect(points).toHaveLength(6);
      for (const node of ["pve2", "pve3", "pve4"]) {
        expect(
          pointsFor(points, `node/${node}`).map((point: JSONObject) => {
            return point["timeUnixNano"];
          }),
        ).toEqual([TIME_NANO, later]);
      }
    }
  });

  test("an own point without a timestamp gives reports without one", () => {
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2"],
      reporterCount: 1,
      timeUnixNanos: [null],
    });
    for (const metricName of ["pve_up", "pve_node_info"]) {
      const points: Array<JSONObject> = reportPointsOf(envelope, metricName);
      expect(points).toHaveLength(1);
      expect(points[0]).not.toHaveProperty("timeUnixNano");
    }
  });

  test("reports in the given order, and leaves the caller's arrays alone", () => {
    const silentNodes: Array<string> = ["pve3", "pve2"];
    const timeUnixNanos: Array<JSONValue> = [TIME_NANO];
    const envelope: JSONObject = normalized(nodePush("pve1"));
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes,
      reporterCount: 3,
      timeUnixNanos,
    });
    expect(silentNodes).toEqual(["pve3", "pve2"]);
    expect(timeUnixNanos).toEqual([TIME_NANO]);
    expect(idsOf(reportPointsOf(envelope, "pve_up"))).toEqual([
      "node/pve3",
      "node/pve2",
    ]);
    // The remainder unit goes to the first node given.
    expect(
      reportPointsOf(envelope, "pve_node_info").map((point: JSONObject) => {
        return (point["asDouble"] as number) * 65536;
      }),
    ).toEqual([21846, 21845]);
  });

  test("idempotent: a second append changes nothing, whatever it reports", () => {
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2"],
      reporterCount: 1,
    });
    const once: string = JSON.stringify(envelope);
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: ["pve2"],
      reporterCount: 1,
      timeUnixNanos: [TIME_NANO],
    });
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: ["pve3", "pve4"],
      reporterCount: 2,
      timeUnixNanos: [TIME_NANO + 1_000_000_000],
    });
    expect(JSON.stringify(envelope)).toBe(once);
    expect(reportScopesOf(envelope)).toHaveLength(1);
  });

  test("the node's own series and its resource are left exactly as they were", () => {
    const envelope: JSONObject = normalized(nodePush("pve1"));
    const before: JSONObject = JSON.parse(
      JSON.stringify(envelope),
    ) as JSONObject;
    appendProxmoxSiblingReportsInPlace(envelope, {
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
      timeUnixNanos: [TIME_NANO],
    });
    expect((envelope["scopeMetrics"] as JSONArray).slice(0, -1)).toEqual(
      before["scopeMetrics"],
    );
    expect(envelope["resource"]).toEqual(before["resource"]);
  });

  test("the reports survive a second rewrite pass untouched", () => {
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
    });
    const once: string = JSON.stringify(envelope);
    normalizeProxmoxNativePushInPlace([envelope]);
    expect(JSON.stringify(envelope)).toBe(once);
  });

  test("appends nothing without silent nodes, timestamps or reporters", () => {
    const reports: Array<SiblingReport> = [
      { silentNodes: [], reporterCount: 2, timeUnixNanos: [TIME_NANO] },
      { silentNodes: ["pve2"], reporterCount: 2, timeUnixNanos: [] },
      { silentNodes: ["pve2"], reporterCount: 0, timeUnixNanos: [TIME_NANO] },
      // No usable node name: there is no id to report.
      { silentNodes: [""], reporterCount: 1, timeUnixNanos: [TIME_NANO] },
    ];
    for (const report of reports) {
      const envelope: JSONObject = normalized(nodePush("pve1"));
      const before: string = JSON.stringify(envelope);
      appendProxmoxSiblingReportsInPlace(envelope, report);
      expect(JSON.stringify(envelope)).toBe(before);
      expect(reportScopesOf(envelope)).toEqual([]);
    }
  });

  test("appends nothing to a block without a scopeMetrics array, and never throws", () => {
    const values: Array<JSONValue | undefined> = [undefined, null, "nope", {}];
    for (const scopeMetrics of values) {
      const envelope: JSONObject = {
        resource: {
          attributes: attrs({
            "proxmox.cluster": "homelab",
            "proxmox.node": "pve1",
          }),
        },
      };
      if (scopeMetrics !== undefined) {
        envelope["scopeMetrics"] = scopeMetrics;
      }
      const before: string = JSON.stringify(envelope);
      expect(() => {
        appendProxmoxSiblingReportsInPlace(envelope, {
          silentNodes: ["pve2"],
          reporterCount: 1,
          timeUnixNanos: [TIME_NANO],
        });
      }).not.toThrow();
      expect(JSON.stringify(envelope)).toBe(before);
    }
  });

  test("every inferred point sits in the report scope, and the report scope holds nothing else", () => {
    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
    });
    let inferredPoints: number = 0;
    for (const scopeMetric of envelope["scopeMetrics"] as Array<JSONObject>) {
      const isReport: boolean = isProxmoxSiblingReportScope(scopeMetric);
      for (const metric of scopeMetric["metrics"] as Array<JSONObject>) {
        for (const point of pointsOf(metric)) {
          const inferred: boolean =
            labelsOf(point)[PROXMOX_INFERRED_ATTRIBUTE] ===
            PROXMOX_INFERRED_NOT_REPORTING;
          expect(inferred).toBe(isReport);
          if (inferred) {
            inferredPoints++;
          }
        }
      }
    }
    expect(inferredPoints).toBe(4);
  });

  /*
   * The ingest's inventory fold skips the report scope: a report must
   * never refresh the silent node's row. Folding the push as the ingest
   * does leaves only the reporter; folding the report scope too would
   * give each silent node a row stamped with the reporter's time.
   */
  test("with the report scope skipped, as the ingest does, the inventory fold sees only the reporter", () => {
    function fold(
      envelope: JSONObject,
      skipReports: boolean,
    ): Array<ProxmoxResourceBufferEntry> {
      const resourceBuffer: Map<
        string,
        Map<string, ProxmoxResourceBufferEntry>
      > = new Map();
      const clusterBuffer: Map<string, ProxmoxClusterSnapshotBufferEntry> =
        new Map();
      for (const scopeMetric of envelope["scopeMetrics"] as Array<JSONObject>) {
        if (skipReports && isProxmoxSiblingReportScope(scopeMetric)) {
          continue;
        }
        for (const metric of scopeMetric["metrics"] as Array<JSONObject>) {
          const metricName: string = metric["name"] as string;
          if (!PVE_SNAPSHOT_METRIC_NAMES.has(metricName)) {
            continue;
          }
          for (const datapoint of pointsOf(metric)) {
            bufferProxmoxSnapshotMetric({
              clusterIdStr: "c1",
              metricName,
              datapoint,
              resourceBuffer,
              clusterBuffer,
              countsFromInventory: true,
            });
          }
        }
      }
      return [...(resourceBuffer.get("c1")?.values() || [])].sort(
        (a: ProxmoxResourceBufferEntry, b: ProxmoxResourceBufferEntry) => {
          return a.externalId.localeCompare(b.externalId);
        },
      );
    }

    function externalIdsOf(
      rows: Array<ProxmoxResourceBufferEntry>,
    ): Array<string> {
      return rows.map((row: ProxmoxResourceBufferEntry) => {
        return row.externalId;
      });
    }

    const envelope: JSONObject = reportingPush({
      silentNodes: ["pve2", "pve3"],
      reporterCount: 2,
    });

    const rows: Array<ProxmoxResourceBufferEntry> = fold(envelope, true);
    expect(externalIdsOf(rows)).toEqual(["node/pve1"]);
    expect(rows[0]).toMatchObject({ kind: "Node", name: "pve1", isUp: true });

    expect(externalIdsOf(fold(envelope, false))).toEqual([
      "node/pve1",
      "node/pve2",
      "node/pve3",
    ]);
  });
});

/*
 * Which built-in Proxmox alert templates a native push can drive. Every
 * query of a served template must find a translated series with its
 * metric name, its attribute filters and its group-by label. A template
 * added later fails here until it is classified — and the docs, which
 * list the unserved ones, are updated with it.
 *
 * The payload is a three-node cluster whose third node, pve3, has died:
 * pve1 and pve2 still push their own status (pve1 its guests and storage
 * too), and each live node's status push carries the report the ingest
 * appends for the silent sibling — both live nodes being eligible
 * reporters.
 */
describe("built-in alert templates on a native push", () => {
  const SERVED: Array<string> = [
    "pve-node-high-cpu",
    "pve-node-high-memory",
    "pve-guest-high-cpu",
    "pve-storage-near-full",
    "pve-lxc-disk-near-full",
  ];
  /*
   * Each node pushes only its own status, so a node that dies goes quiet
   * instead of reporting pve_up = 0. These two see it anyway: the live
   * nodes' status pushes carry pve_up = 0 for it — and its pve_node_info
   * share — with the labels its own push would carry.
   */
  const SERVED_BY_SIBLING_REPORTS: Array<string> = [
    "pve-node-offline",
    "pve-quorum-risk",
  ];
  // Data the native push does not carry at all.
  const NOT_SERVED: Array<string> = [
    "pve-guest-down", // needs pve_onboot_status
    "pve-ha-state-error", // needs pve_ha_state
    "pve-guest-not-backed-up", // needs the backup-info collector
    "pve-replication-failing", // needs the replication collector
  ];

  const DEAD_NODE_ID: string = "node/pve3";

  interface TemplateQuery {
    metricName: string;
    attributes: Record<string, string>;
    groupBy: Array<string>;
    aggregation: MetricsAggregationType;
  }

  interface QuorumCase {
    title: string;
    live: Array<string>;
    dead: Array<string>;
    percent: number;
  }

  /*
   * The node-status pushes of a native-push cluster as the ingest emits
   * them: rewritten, each live node reporting the dead ones.
   */
  function clusterNodePushes(data: {
    live: Array<string>;
    dead: Array<string>;
  }): Array<JSONObject> {
    const pushes: Array<JSONObject> = data.live.map((node: string) => {
      return normalized(nodePush(node));
    });
    for (const push of pushes) {
      const status: NodeStatus = readProxmoxNativeNodeStatus(push);
      if (!status) {
        throw new Error("not a node-status push");
      }
      appendProxmoxSiblingReportsInPlace(push, {
        silentNodes: data.dead,
        reporterCount: data.live.length,
        timeUnixNanos: status.timeUnixNanos,
      });
    }
    return pushes;
  }

  function seriesOf(envelopes: Array<JSONObject>): Array<Series> {
    return envelopes.flatMap((envelope: JSONObject) => {
      return pveSeries(envelope);
    });
  }

  const series: Array<Series> = seriesOf([
    ...clusterNodePushes({ live: ["pve1", "pve2"], dead: ["pve3"] }),
    ...[qemuPush(), lxcPush(), storagePush()].map((envelope: JSONObject) => {
      return normalized(envelope);
    }),
  ]);

  function templateById(id: string): ProxmoxAlertTemplate {
    const template: ProxmoxAlertTemplate | undefined =
      getAllProxmoxAlertTemplates().find((t: ProxmoxAlertTemplate) => {
        return t.id === id;
      });
    if (!template) {
      throw new Error(`no template ${id}`);
    }
    return template;
  }

  function queriesOf(template: ProxmoxAlertTemplate): Array<TemplateQuery> {
    const monitor: MonitorStepProxmoxMonitor = template.getMonitorStep({
      clusterIdentifier: "homelab",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "m",
    }).data!.proxmoxMonitor!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return monitor.metricViewConfig.queryConfigs.map((q: any) => {
      return {
        metricName: q.metricQueryData.filterData.metricName as string,
        attributes: (q.metricQueryData.filterData.attributes || {}) as Record<
          string,
          string
        >,
        groupBy: (q.metricQueryData.groupByAttributeKeys ||
          []) as Array<string>,
        aggregation: q.metricQueryData.filterData
          .aggegationType as MetricsAggregationType,
      };
    });
  }

  function matching(query: TemplateQuery, from: Array<Series>): Array<Series> {
    return from.filter((s: Series) => {
      return (
        s.name === query.metricName &&
        Object.entries(query.attributes).every(
          ([key, value]: [string, string]) => {
            return s.labels[key] === value;
          },
        ) &&
        query.groupBy.every((key: string) => {
          return s.labels[key] !== undefined;
        })
      );
    });
  }

  function served(template: ProxmoxAlertTemplate): boolean {
    return queriesOf(template).every((query: TemplateQuery) => {
      return matching(query, series).length > 0;
    });
  }

  /*
   * One query over one window, as the monitor evaluates it: the matching
   * rows grouped by the group-by labels ("" when there are none), each
   * group aggregated.
   */
  function evaluate(
    query: TemplateQuery,
    from: Array<Series>,
  ): Record<string, number> {
    const groups: Map<string, Array<number>> = new Map();
    for (const s of matching(query, from)) {
      const key: string = query.groupBy
        .map((label: string) => {
          return s.labels[label];
        })
        .join("|");
      groups.set(key, [...(groups.get(key) || []), Number(s.value)]);
    }
    const out: Record<string, number> = {};
    for (const [key, values] of groups) {
      if (query.aggregation === MetricsAggregationType.Min) {
        out[key] = Math.min(...values);
      } else if (query.aggregation === MetricsAggregationType.Sum) {
        out[key] = sumOf(values);
      } else {
        throw new Error(`unexpected aggregation ${query.aggregation}`);
      }
    }
    return out;
  }

  // Node Offline: pve_up Min per node id; fires below 1.
  function nodeOfflineMins(from: Array<Series>): Record<string, number> {
    const queries: Array<TemplateQuery> = queriesOf(
      templateById("pve-node-offline"),
    );
    expect(queries).toHaveLength(1);
    return evaluate(queries[0]!, from);
  }

  function firingNodeIds(from: Array<Series>): Array<string> {
    const mins: Record<string, number> = nodeOfflineMins(from);
    return Object.keys(mins)
      .filter((id: string) => {
        return (mins[id] as number) < 1;
      })
      .sort();
  }

  // Cluster Quorum at Risk: (Σ pve_up ÷ Σ pve_node_info) × 100; fires <= 50.
  function quorumAtRiskPercent(from: Array<Series>): number {
    const queries: Array<TemplateQuery> = queriesOf(
      templateById("pve-quorum-risk"),
    );
    expect(
      queries.map((query: TemplateQuery) => {
        return query.metricName;
      }),
    ).toEqual(["pve_up", "pve_node_info"]);
    const online: number = evaluate(queries[0]!, from)[""] as number;
    const total: number = evaluate(queries[1]!, from)[""] as number;
    return (online / total) * 100;
  }

  test("every template is classified", () => {
    expect(
      getAllProxmoxAlertTemplates()
        .map((t: ProxmoxAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual([...SERVED, ...SERVED_BY_SIBLING_REPORTS, ...NOT_SERVED].sort());
  });

  test.each([...SERVED, ...SERVED_BY_SIBLING_REPORTS])(
    "%s finds every series it queries",
    (id: string) => {
      expect(served(templateById(id))).toBe(true);
    },
  );

  test.each(SERVED_BY_SIBLING_REPORTS)(
    "%s finds pve_up = 0 for the dead node, under its own id and pve.scope = node",
    (id: string) => {
      const upQueries: Array<TemplateQuery> = queriesOf(
        templateById(id),
      ).filter((query: TemplateQuery) => {
        return query.metricName === "pve_up";
      });
      expect(upQueries).toHaveLength(1);
      expect(upQueries[0]!.attributes).toEqual({ "pve.scope": "node" });

      const dead: Array<Series> = matching(upQueries[0]!, series).filter(
        (s: Series) => {
          return s.labels["id"] === DEAD_NODE_ID;
        },
      );
      // One report on each live node's push.
      expect(dead).toHaveLength(2);
      for (const s of dead) {
        expect(s.value).toBe("0");
        expect(s.labels).toEqual({
          id: DEAD_NODE_ID,
          "pve.scope": "node",
          "pve.type": "node",
          "pve.id": "pve3",
          [PROXMOX_INFERRED_ATTRIBUTE]: PROXMOX_INFERRED_NOT_REPORTING,
        });
      }
    },
  );

  test("Node Offline fires for the dead node, and only for it", () => {
    expect(nodeOfflineMins(series)).toEqual({
      "node/pve1": 1,
      "node/pve2": 1,
      [DEAD_NODE_ID]: 0,
    });
    expect(firingNodeIds(series)).toEqual([DEAD_NODE_ID]);
  });

  test("Quorum at Risk counts the dead node: 2 of 3 online is not at risk", () => {
    const percent: number = quorumAtRiskPercent(series);
    expect(percent).toBeCloseTo((2 / 3) * 100, 10);
    expect(percent).toBeGreaterThan(50);
  });

  const QUORUM_CASES: Array<QuorumCase> = [
    {
      title: "3 live, none dead",
      live: ["pve1", "pve2", "pve3"],
      dead: [],
      percent: 100,
    },
    {
      title: "3 live, 1 dead",
      live: ["pve1", "pve2", "pve3"],
      dead: ["pve4"],
      percent: 75,
    },
    {
      title: "3 live, 2 dead",
      live: ["pve1", "pve2", "pve3"],
      dead: ["pve4", "pve5"],
      percent: 60,
    },
    {
      title: "2 live, 2 dead",
      live: ["pve1", "pve2"],
      dead: ["pve3", "pve4"],
      percent: 50,
    },
    {
      title: "3 live, 3 dead",
      live: ["pve1", "pve2", "pve3"],
      dead: ["pve4", "pve5", "pve6"],
      percent: 50,
    },
    {
      title: "1 live, 2 dead",
      live: ["pve1"],
      dead: ["pve2", "pve3"],
      percent: 100 / 3,
    },
  ];

  test.each(QUORUM_CASES)(
    "$title: Quorum at Risk reads live ÷ all nodes, Node Offline fires for each dead node",
    (quorumCase: QuorumCase) => {
      const from: Array<Series> = seriesOf(
        clusterNodePushes({ live: quorumCase.live, dead: quorumCase.dead }),
      );
      const percent: number = quorumAtRiskPercent(from);
      if (quorumCase.percent === 50) {
        // The boundary is exact: half the cluster down always fires.
        expect(percent).toBe(50);
      } else {
        expect(percent).toBeCloseTo(quorumCase.percent, 2);
        expect(percent <= 50).toBe(quorumCase.percent <= 50);
      }

      expect(firingNodeIds(from)).toEqual(
        quorumCase.dead
          .map((node: string) => {
            return `node/${node}`;
          })
          .sort(),
      );
    },
  );

  test("without the sibling reports a dead node is invisible to both", () => {
    const quiet: Array<Series> = seriesOf(
      clusterNodePushes({ live: ["pve1", "pve2"], dead: [] }),
    );
    expect(nodeOfflineMins(quiet)).toEqual({ "node/pve1": 1, "node/pve2": 1 });
    expect(quorumAtRiskPercent(quiet)).toBe(100);
  });

  test("only what is said about the dead node is marked inferred", () => {
    for (const s of series) {
      expect(s.labels[PROXMOX_INFERRED_ATTRIBUTE] !== undefined).toBe(
        s.labels["id"] === DEAD_NODE_ID,
      );
    }
  });

  test.each(NOT_SERVED)(
    "%s needs data the native push does not send",
    (id: string) => {
      expect(served(templateById(id))).toBe(false);
    },
  );

  test("every translated series is a catalog metric", () => {
    const names: Set<string> = new Set(
      series.map((s: Series) => {
        return s.name;
      }),
    );
    for (const name of names) {
      expect(getProxmoxMetricByMetricName(name)).toBeDefined();
    }
  });
});
