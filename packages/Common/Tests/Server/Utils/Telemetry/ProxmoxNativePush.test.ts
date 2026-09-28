import {
  PROXMOX_NATIVE_PUSH_SERVICE_NAME,
  isProxmoxNativePushResource,
  normalizeProxmoxNativePushInPlace,
  resolveProxmoxNativePushClusterName,
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
 * Which built-in Proxmox alert templates a native push can drive. Every
 * query of a served template must find a translated series with its
 * metric name, its attribute filters and its group-by label. A template
 * added later fails here until it is classified — and the docs, which
 * list the unserved ones, are updated with it.
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
   * Their series resolve, but each node pushes only its own status: a
   * node that goes down stops pushing instead of reporting pve_up = 0, so
   * these two cannot see it. The docs say so and point at the agent.
   */
  const SILENT_WHEN_A_NODE_DIES: Array<string> = [
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

  const payload: Array<JSONObject> = [
    nodePush(),
    qemuPush(),
    lxcPush(),
    storagePush(),
  ];
  normalizeProxmoxNativePushInPlace(payload as JSONArray);
  const series: Array<Series> = payload.flatMap((e: JSONObject) => {
    return pveSeries(e);
  });

  function queriesOf(template: ProxmoxAlertTemplate): Array<{
    metricName: string;
    attributes: Record<string, string>;
    groupBy: Array<string>;
  }> {
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
      };
    });
  }

  function served(template: ProxmoxAlertTemplate): boolean {
    return queriesOf(template).every(
      (query: {
        metricName: string;
        attributes: Record<string, string>;
        groupBy: Array<string>;
      }) => {
        return series.some((s: Series) => {
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
      },
    );
  }

  test("every template is classified", () => {
    expect(
      getAllProxmoxAlertTemplates()
        .map((t: ProxmoxAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual([...SERVED, ...SILENT_WHEN_A_NODE_DIES, ...NOT_SERVED].sort());
  });

  test.each([...SERVED, ...SILENT_WHEN_A_NODE_DIES])(
    "%s finds every series it queries",
    (id: string) => {
      const template: ProxmoxAlertTemplate = getAllProxmoxAlertTemplates().find(
        (t: ProxmoxAlertTemplate) => {
          return t.id === id;
        },
      )!;
      expect(served(template)).toBe(true);
    },
  );

  test.each(SILENT_WHEN_A_NODE_DIES)(
    "%s only ever sees nodes that are pushing, all of them up",
    (id: string) => {
      expect(
        getAllProxmoxAlertTemplates().some((t: ProxmoxAlertTemplate) => {
          return t.id === id;
        }),
      ).toBe(true);
      const nodeUp: Array<Series> = series.filter((s: Series) => {
        return s.name === "pve_up" && s.labels["pve.scope"] === "node";
      });
      expect(nodeUp.length).toBeGreaterThan(0);
      for (const s of nodeUp) {
        expect(s.value).toBe("1");
      }
    },
  );

  test.each(NOT_SERVED)(
    "%s needs data the native push does not send",
    (id: string) => {
      const template: ProxmoxAlertTemplate = getAllProxmoxAlertTemplates().find(
        (t: ProxmoxAlertTemplate) => {
          return t.id === id;
        },
      )!;
      expect(served(template)).toBe(false);
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
