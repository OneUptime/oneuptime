/*
 * A RECORDED XEN ORCHESTRA SCRAPE, TWO POOLS, TWO MINUTES.
 *
 * What GET /openmetrics/metrics answers on a Xen Orchestra 6.9 with the
 * xo-server-openmetrics plugin 1.9.4 loaded, for the lab below: one Xen
 * Orchestra managing two XCP-ng 8.3 pools. There is no Xen Orchestra on the
 * machines OneUptime is built on, so the response is written here, byte for
 * byte the way the plugin's formatter writes it (vatesfr/xen-orchestra,
 * packages/xo-server-openmetrics/src/openmetric-formatter.mts and
 * open-metric-server.mts, read on 24 November 2026):
 *
 *   - sections in the order collectMetrics joins them: xcp_pool_connected
 *     (one line per connected pool, pool_name always present - empty for a
 *     pool XAPI names nothing - and NO timestamp), the RRD series of every
 *     host and VM (sorted by name, then by the JSON of their labels), the
 *     storage repositories, the virtual disks, the host statuses, the host
 *     uptimes, the VM statuses, the VM uptimes, then Xen Orchestra's own
 *     xo_* series;
 *   - each name's # HELP and # TYPE once, before its samples, and every
 *     sample but xcp_pool_connected stamped with a Unix time in SECONDS;
 *   - labels in the order the formatter adds them, empty ones left out;
 *   - the eight PIF / VIF / VBD series typed `counter` whose values are
 *     XAPI's per-second rates (the trap OneUptime's agent turns into
 *     gauges): their values here go DOWN between the two scrapes, as rates
 *     do, which a counter cannot;
 *   - the host power read over IPMI carrying no pool_id (the plugin builds
 *     those labels from the host alone), and Xen Orchestra's process series
 *     (xo_*) carrying none either;
 *   - the body ends "# EOF" with no newline after it.
 *
 * Scrape 2, one minute later, is what changed: web-01 was shut down, app-02
 * was started, the orphan disk was deleted (its series disappear), the
 * rates moved, and the Production pool's NFS repository filled a little.
 *
 * buildXenOrchestraScrape({ scrape: 1 | 2, nowSeconds }) returns the body.
 * Used by the XCP-ng agent's behaviour test (the fake Xen Orchestra serves
 * it to the real collector) and by the jest suites that read a scrape.
 */

"use strict";

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

const POOLS = {
  production: {
    id: "b7569d99-30f8-178a-7d94-801de3e29b5b",
    name: "Production",
  },
  // A pool made by joining hosts, never named: XAPI's name_label is "".
  unnamed: {
    id: "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1",
    name: "",
  },
};

const HOSTS = [
  {
    key: "prod1",
    uuid: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
    name: "xcp-prod-01",
    pool: POOLS.production,
    powerState: "Running",
    enabled: true,
    tags: ["rack-a"],
    uptimeSeconds: 10 * 86400,
    cores: 4,
    ipmiWatts: 241,
  },
  {
    key: "prod2",
    uuid: "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
    name: "xcp-prod-02",
    pool: POOLS.production,
    powerState: "Running",
    // In maintenance mode: disabled, still running its VMs.
    enabled: false,
    tags: [],
    uptimeSeconds: 5 * 3600,
    cores: 4,
    ipmiWatts: null,
  },
  {
    key: "prod3",
    uuid: "f0e1d2c3-b4a5-4968-8776-655443322110",
    name: "xcp-prod-03",
    pool: POOLS.production,
    // Down: Xen Orchestra keeps reporting its status, and nothing else.
    powerState: "Halted",
    enabled: true,
    tags: [],
    uptimeSeconds: null,
    cores: 4,
    ipmiWatts: null,
  },
  {
    key: "lab1",
    uuid: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
    name: "xcp-lab-01",
    pool: POOLS.unnamed,
    powerState: "Running",
    enabled: true,
    tags: [],
    uptimeSeconds: 3 * 86400,
    cores: 2,
    ipmiWatts: null,
  },
];

const SRS = [
  {
    key: "prodLocal",
    uuid: "ad4b8c63-1f2e-4d3c-8b4a-596877665544",
    name: "Local storage",
    pool: POOLS.production,
    type: "lvm",
    content: "user",
    host: "prod1",
    size: 500 * GiB,
    usage: 120 * GiB,
    virtual: 200 * GiB,
    tags: [],
  },
  {
    key: "prodNfs",
    uuid: "1d2c3b4a-5e6f-4789-9abc-def012345678",
    name: "NFS VM store",
    pool: POOLS.production,
    type: "nfs",
    content: "user",
    host: null,
    size: 2048 * GiB,
    // 92.5% full in scrape 1, 93.0% in scrape 2 (XAPI counts whole bytes).
    usage: { 1: Math.round(1894.4 * GiB), 2: Math.round(1904.64 * GiB) },
    virtual: Math.round(2662.4 * GiB),
    tags: ["shared-storage"],
  },
  {
    key: "prodTools",
    uuid: "c0ffee00-1111-4222-8333-444455556666",
    name: "XCP-ng Tools",
    pool: POOLS.production,
    type: "iso",
    content: "iso",
    host: null,
    size: 0,
    usage: 0,
    virtual: 0,
    tags: [],
  },
  {
    key: "labLocal",
    uuid: "77aa88bb-99cc-4ddd-8eee-ff0011223344",
    name: "Local storage",
    pool: POOLS.unnamed,
    type: "ext",
    content: "user",
    host: "lab1",
    size: 250 * GiB,
    usage: 40 * GiB,
    virtual: 60 * GiB,
    tags: [],
  },
];

const NETWORK_PROD = "Pool-wide network associated with eth0";

/*
 * A VM's state in each scrape: null leaves it out of that scrape (a VM
 * deleted, or not created yet).
 */
const VMS = [
  {
    key: "web01",
    uuid: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
    name: "web-01",
    pool: POOLS.production,
    host: "prod1",
    isControlDomain: false,
    powerState: { 1: "Running", 2: "Halted" },
    tags: ["production", "web"],
    vcpus: 2,
    memory: 4 * GiB,
    uptimeSeconds: 48 * 3600,
    disks: [{ device: "xvda", vdi: "web01Disk" }],
    vifs: [{ index: "0", network: NETWORK_PROD }],
  },
  {
    key: "db01",
    uuid: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    name: "db-01",
    pool: POOLS.production,
    host: "prod2",
    isControlDomain: false,
    powerState: { 1: "Running", 2: "Running" },
    tags: ["production"],
    vcpus: 4,
    memory: 16 * GiB,
    uptimeSeconds: 4 * 3600,
    disks: [{ device: "xvda", vdi: "db01Disk" }],
    vifs: [{ index: "0", network: NETWORK_PROD }],
  },
  {
    key: "app02",
    uuid: "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
    name: "app-02",
    pool: POOLS.production,
    host: "prod1",
    isControlDomain: false,
    powerState: { 1: "Halted", 2: "Running" },
    tags: [],
    vcpus: 1,
    memory: 2 * GiB,
    uptimeSeconds: 40,
    disks: [],
    vifs: [],
  },
  {
    key: "win03",
    uuid: "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a",
    name: "win-03",
    pool: POOLS.production,
    host: null,
    isControlDomain: false,
    powerState: { 1: "Suspended", 2: "Suspended" },
    tags: ["windows"],
    vcpus: 2,
    memory: 8 * GiB,
    uptimeSeconds: null,
    disks: [],
    vifs: [],
  },
  {
    key: "dom0prod1",
    uuid: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e",
    name: "Control domain on host: xcp-prod-01",
    pool: POOLS.production,
    host: "prod1",
    isControlDomain: true,
    powerState: { 1: "Running", 2: "Running" },
    tags: [],
    vcpus: 4,
    memory: 2 * GiB,
    uptimeSeconds: null,
    disks: [],
    vifs: [],
  },
  {
    key: "dom0prod2",
    uuid: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Control domain on host: xcp-prod-02",
    pool: POOLS.production,
    host: "prod2",
    isControlDomain: true,
    powerState: { 1: "Running", 2: "Running" },
    tags: [],
    vcpus: 4,
    memory: 2 * GiB,
    uptimeSeconds: null,
    disks: [],
    vifs: [],
  },
  {
    key: "labvm01",
    uuid: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    name: "lab-vm-01",
    pool: POOLS.unnamed,
    host: "lab1",
    isControlDomain: false,
    powerState: { 1: "Running", 2: "Running" },
    tags: [],
    vcpus: 1,
    memory: 1 * GiB,
    uptimeSeconds: 2 * 86400,
    disks: [{ device: "xvda", vdi: "labDisk" }],
    vifs: [{ index: "0", network: "Pool-wide network associated with eth0" }],
  },
  {
    key: "dom0lab1",
    uuid: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    name: "Control domain on host: xcp-lab-01",
    pool: POOLS.unnamed,
    host: "lab1",
    isControlDomain: true,
    powerState: { 1: "Running", 2: "Running" },
    tags: [],
    vcpus: 2,
    memory: 1 * GiB,
    uptimeSeconds: null,
    disks: [],
    vifs: [],
  },
];

const VDIS = [
  {
    key: "web01Disk",
    uuid: "aa11bb22-cc33-4d44-8e55-ff6677889900",
    name: "web-01 system",
    sr: "prodNfs",
    vm: "web01",
    size: 20 * GiB,
    usage: 8 * GiB,
    scrapes: [1, 2],
  },
  {
    key: "db01Disk",
    uuid: "bb22cc33-dd44-4e55-8f66-007788990011",
    name: "db-01 data",
    sr: "prodNfs",
    vm: "db01",
    size: 100 * GiB,
    usage: 61 * GiB,
    scrapes: [1, 2],
  },
  {
    // Attached to nothing, and deleted before scrape 2.
    key: "orphanDisk",
    uuid: "cc33dd44-ee55-4f66-8077-118899001122",
    name: "old-backup",
    sr: "prodNfs",
    vm: null,
    size: 50 * GiB,
    usage: 50 * GiB,
    scrapes: [1],
  },
  {
    key: "labDisk",
    uuid: "dd44ee55-ff66-4077-8188-229900112233",
    name: "lab-vm-01 system",
    sr: "labLocal",
    vm: "labvm01",
    size: 10 * GiB,
    usage: 3 * GiB,
    scrapes: [1, 2],
  },
];

// ---------------------------------------------------------------------------
// The plugin's formatter, as it formats (no code of the plugin is used).
// ---------------------------------------------------------------------------

function escapeLabelValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(labels) {
  const pairs = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

function serializeTags(tags) {
  if (!tags || tags.length === 0) return "";
  return [...new Set(tags)].filter((t) => t.trim() !== "").sort().join(",");
}

function addTags(labels, tags) {
  const serialized = serializeTags(tags);
  if (serialized !== "") labels.tags = serialized;
}

// HELP/TYPE once per name, in the order names are first seen.
function formatToOpenMetrics(metrics) {
  if (metrics.length === 0) return "";
  const grouped = new Map();
  for (const metric of metrics) {
    if (!grouped.has(metric.name)) grouped.set(metric.name, []);
    grouped.get(metric.name).push(metric);
  }
  const lines = [];
  for (const [name, list] of grouped) {
    lines.push(`# HELP ${name} ${list[0].help}`);
    lines.push(`# TYPE ${name} ${list[0].type}`);
    for (const metric of list) {
      lines.push(`${metric.name}${formatLabels(metric.labels)} ${metric.value} ${metric.timestamp}`);
    }
  }
  return lines.join("\n");
}

function hostByKey(key) {
  return HOSTS.find((h) => h.key === key);
}
function srByKey(key) {
  return SRS.find((s) => s.key === key);
}
function vmByKey(key) {
  return VMS.find((v) => v.key === key);
}
function vdiByKey(key) {
  return VDIS.find((v) => v.key === key);
}

// A value that moves a little between scrapes, the same each run.
function wobble(base, scrape, step) {
  return Number((base + (scrape - 1) * step).toFixed(6));
}

/*
 * One RRD metric of a host, as transformMetric labels it: pool_id, uuid,
 * type, pool_name, host_name, then the PIF network or the SR it resolved,
 * then the labels the metric name carried (interface, sr, core), then tags.
 */
function hostRrdMetric(host, name, help, type, value, ts, extra) {
  const labels = { pool_id: host.pool.id, uuid: host.uuid, type: "host" };
  if (host.pool.name !== "") labels.pool_name = host.pool.name;
  labels.host_name = host.name;
  if (extra && extra.network_name) labels.network_name = extra.network_name;
  if (extra && extra.sr) {
    const sr = SRS.find((s) => s.uuid.startsWith(extra.sr));
    if (sr) {
      labels.sr_uuid = sr.uuid;
      labels.sr_name = sr.name;
      labels.sr_type = sr.type;
    }
  }
  if (extra && extra.interface !== undefined) labels.interface = extra.interface;
  if (extra && extra.sr !== undefined) labels.sr = extra.sr;
  if (extra && extra.core !== undefined) labels.core = extra.core;
  addTags(labels, host.tags);
  return { name, help, type, labels, value, timestamp: ts };
}

/*
 * One RRD metric of a VM: pool_id, uuid, type, host_id, pool_name,
 * host_name, vm_name, is_control_domain, then the VBD's disk and SR or the
 * VIF's network, then device / vif / core, then tags.
 */
function vmRrdMetric(vm, name, help, type, value, ts, extra) {
  const host = hostByKey(vm.host);
  const labels = { pool_id: vm.pool.id, uuid: vm.uuid, type: "vm", host_id: host.uuid };
  if (vm.pool.name !== "") labels.pool_name = vm.pool.name;
  labels.host_name = host.name;
  labels.vm_name = vm.name;
  labels.is_control_domain = vm.isControlDomain ? "true" : "false";
  if (extra && extra.device) {
    const disk = vm.disks.find((d) => d.device === extra.device);
    const vdi = disk ? vdiByKey(disk.vdi) : null;
    if (vdi) {
      labels.vdi_name = vdi.name;
      const sr = srByKey(vdi.sr);
      labels.sr_name = sr.name;
      labels.sr_type = sr.type;
    }
  }
  if (extra && extra.vif !== undefined) {
    const vif = vm.vifs.find((v) => v.index === extra.vif);
    if (vif) labels.network_name = vif.network;
  }
  if (extra && extra.device !== undefined) labels.device = extra.device;
  if (extra && extra.vif !== undefined) labels.vif = extra.vif;
  if (extra && extra.core !== undefined) labels.core = extra.core;
  addTags(labels, vm.tags);
  return { name, help, type, labels, value, timestamp: ts };
}

function rrdSection(scrape, nowSeconds) {
  // The RRD's own clock: the last full 60-second step.
  const ts = Math.floor(nowSeconds / 60) * 60 - 60;
  const metrics = [];

  for (const host of HOSTS) {
    if (host.powerState !== "Running") continue;
    const h = (name, help, type, value, extra) =>
      metrics.push(hostRrdMetric(host, name, help, type, value, ts, extra));
    const busy = host.key === "prod1" ? 0.62 : host.key === "prod2" ? 0.35 : 0.08;

    h("xcp_host_load_average", "Host load average", "gauge", wobble(busy * 4, scrape, 0.1));
    h("xcp_host_memory_free_bytes", "Host free memory in bytes", "gauge", host.key === "prod1" ? 9 * GiB : 40 * GiB);
    h("xcp_host_memory_total_bytes", "Host total memory in bytes", "gauge", 64 * GiB);
    h("xcp_host_cpu_average", "Host average CPU usage ratio", "gauge", wobble(busy, scrape, 0.01));
    for (let core = 0; core < host.cores; core++) {
      h("xcp_host_cpu_core_usage", "Host CPU core usage ratio", "gauge", wobble(busy + core * 0.01, scrape, 0.01), { core: String(core) });
    }
    h("xcp_host_network_aggregated_receive_bytes", "Aggregated received bytes per second", "gauge", scrape === 1 ? 1873421.5 : 912377.25);
    h("xcp_host_network_aggregated_transmit_bytes", "Aggregated transmitted bytes per second", "gauge", scrape === 1 ? 958231.75 : 433120.5);
    // The trap: typed counter, a bytes-per-second rate that goes down.
    h("xcp_host_network_receive_bytes_total", "Host network interface received bytes", "counter", scrape === 1 ? 1873421.5 : 912377.25, { interface: "eth0", network_name: NETWORK_PROD });
    h("xcp_host_network_transmit_bytes_total", "Host network interface transmitted bytes", "counter", scrape === 1 ? 958231.75 : 433120.5, { interface: "eth0", network_name: NETWORK_PROD });
    const localSr = SRS.find((s) => s.host === host.key);
    const srIds = [localSr ? localSr.uuid.slice(0, 8) : null, host.pool === POOLS.production ? "1d2c3b4a" : null].filter(Boolean);
    for (const sr of srIds) {
      h("xcp_host_disk_iops_read", "Host disk read IOPS", "gauge", wobble(120, scrape, 15), { sr });
      h("xcp_host_disk_iops_write", "Host disk write IOPS", "gauge", wobble(310, scrape, -40), { sr });
      h("xcp_host_disk_throughput_read_bytes", "Host disk read throughput in bytes per second", "gauge", 3.5 * MiB, { sr });
      h("xcp_host_disk_throughput_write_bytes", "Host disk write throughput in bytes per second", "gauge", 7.25 * MiB, { sr });
      h("xcp_host_disk_read_latency_seconds", "Host disk read latency in seconds", "gauge", 0.0021, { sr });
      h("xcp_host_disk_write_latency_seconds", "Host disk write latency in seconds", "gauge", sr === "1d2c3b4a" ? 0.0743 : 0.0034, { sr });
      h("xcp_host_disk_iowait", "Host disk IO wait ratio", "gauge", 0.012, { sr });
      h("xcp_host_disk_iops_total", "Total IOPS (read + write) per SR", "gauge", wobble(430, scrape, -25), { sr });
      h("xcp_host_disk_throughput_total_bytes", "Total I/O throughput per SR in bytes per second", "gauge", 10.75 * MiB, { sr });
      h("xcp_host_disk_latency_seconds", "Combined I/O latency per SR in seconds", "gauge", sr === "1d2c3b4a" ? 0.0612 : 0.0029, { sr });
    }
    h("xcp_host_load", "Normalized host load", "gauge", wobble(busy * 1.1, scrape, 0.02));
    h("xcp_host_memory_reclaimed_bytes", "Reclaimed host memory in bytes", "gauge", 0);
    h("xcp_host_memory_reclaimed_max_bytes", "Maximum reclaimable host memory in bytes", "gauge", 2 * GiB);
    const runningVcpus = VMS.filter((v) => v.host === host.key && v.powerState[scrape] === "Running").reduce((sum, v) => sum + v.vcpus, 0);
    h("xcp_host_running_vcpus", "Total number of running vCPUs", "gauge", runningVcpus);
    if (host.ipmiWatts !== null) {
      // emitHostPowerMetrics: IPMI reading, labelled from the host alone.
      metrics.push({
        name: "xcp_host_power_consumption_watts",
        help: "Host power consumption in watts (IPMI)",
        type: "gauge",
        labels: { uuid: host.uuid, type: "host", source: "ipmi", host_name: host.name },
        value: host.ipmiWatts,
        timestamp: nowSeconds,
      });
    }
  }

  for (const vm of VMS) {
    if (vm.powerState[scrape] !== "Running") continue;
    const v = (name, help, type, value, extra) =>
      metrics.push(vmRrdMetric(vm, name, help, type, value, ts, extra));
    const busy = vm.isControlDomain ? 0.05 : vm.key === "db01" ? 0.71 : 0.24;

    v("xcp_vm_memory_bytes", "VM memory usage in bytes", "gauge", vm.memory);
    if (!vm.isControlDomain) {
      v("xcp_vm_memory_internal_free_bytes", "VM internal free memory in bytes", "gauge", Math.round(vm.memory * 0.35));
    }
    v("xcp_vm_memory_target_bytes", "VM memory target in bytes", "gauge", vm.memory);
    v("xcp_vm_cpu_usage", "VM CPU usage ratio", "gauge", wobble(busy, scrape, 0.02));
    for (let core = 0; core < vm.vcpus; core++) {
      v("xcp_vm_cpu_core_usage", "VM CPU core usage ratio", "gauge", wobble(busy, scrape, 0.02), { core: String(core) });
    }
    v("xcp_vm_runstate_fullrun", "VM runstate fullrun ratio", "gauge", wobble(busy * 0.8, scrape, 0));
    v("xcp_vm_runstate_full_contention", "VM runstate full contention ratio", "gauge", vm.key === "db01" ? 0.142 : 0.004);
    v("xcp_vm_runstate_partial_run", "VM runstate partial run ratio", "gauge", 0.05);
    v("xcp_vm_runstate_partial_contention", "VM runstate partial contention ratio", "gauge", 0.003);
    v("xcp_vm_runstate_concurrency_hazard", "VM runstate concurrency hazard ratio", "gauge", 0.001);
    v("xcp_vm_runstate_blocked", "VM runstate blocked ratio", "gauge", wobble(1 - busy, scrape, 0));
    for (const vif of vm.vifs) {
      // The trap again: four rate series typed counter.
      v("xcp_vm_network_receive_bytes_total", "VM network interface received bytes", "counter", scrape === 1 ? 524288.5 : 131072.25, { vif: vif.index });
      v("xcp_vm_network_transmit_bytes_total", "VM network interface transmitted bytes", "counter", scrape === 1 ? 262144 : 65536, { vif: vif.index });
      v("xcp_vm_network_receive_errors_total", "VM network interface receive errors", "counter", scrape === 1 ? 0.5 : 0, { vif: vif.index });
      v("xcp_vm_network_transmit_errors_total", "VM network interface transmit errors", "counter", 0, { vif: vif.index });
    }
    for (const disk of vm.disks) {
      const d = (name, help, type, value) => v(name, help, type, value, { device: disk.device });
      d("xcp_vm_disk_read_bytes_total", "VM disk read bytes", "counter", scrape === 1 ? 2097152 : 1048576);
      d("xcp_vm_disk_write_bytes_total", "VM disk write bytes", "counter", scrape === 1 ? 4194304 : 524288);
      d("xcp_vm_disk_iops_read", "VM disk read IOPS", "gauge", 42);
      d("xcp_vm_disk_iops_write", "VM disk write IOPS", "gauge", 97);
      d("xcp_vm_disk_iops_total", "VM disk total IOPS", "gauge", 139);
      d("xcp_vm_disk_read_latency_seconds", "VM disk read latency in seconds", "gauge", 0.0018);
      d("xcp_vm_disk_write_latency_seconds", "VM disk write latency in seconds", "gauge", 0.0041);
      d("xcp_vm_disk_throughput_read_bytes", "VM disk read throughput in bytes per second", "gauge", 2 * MiB);
      d("xcp_vm_disk_throughput_write_bytes", "VM disk write throughput in bytes per second", "gauge", 4 * MiB);
      d("xcp_vm_disk_throughput_total_bytes", "VM disk total throughput in bytes per second", "gauge", 6 * MiB);
      d("xcp_vm_disk_latency_seconds", "VM disk average IO latency in seconds", "gauge", 0.0031);
      d("xcp_vm_disk_iowait", "VM disk IO wait ratio", "gauge", 0.004);
      d("xcp_vm_disk_inflight", "VM disk inflight operations", "gauge", 0);
      d("xcp_vm_disk_queue_size", "VM disk average queue size", "gauge", 0.02);
    }
  }

  // computeVmPowerConsumption: the IPMI host's watts shared by its guests' load.
  for (const host of HOSTS) {
    if (host.ipmiWatts === null || host.powerState !== "Running") continue;
    const guests = VMS.filter((vm) => vm.host === host.key && !vm.isControlDomain && vm.powerState[scrape] === "Running");
    const loads = guests.map((vm) => {
      const cpu = wobble(vm.key === "db01" ? 0.71 : 0.24, scrape, 0.02);
      return cpu * vm.vcpus;
    });
    const total = loads.reduce((a, b) => a + b, 0);
    guests.forEach((vm, i) => {
      const representative = vmRrdMetric(vm, "", "", "gauge", 0, ts, {});
      const labels = { ...representative.labels, estimate: "true" };
      metrics.push({
        name: "xcp_vm_power_consumption_watts",
        help: "Estimated VM power consumption in watts (estimate, host power split by CPU load)",
        type: "gauge",
        labels,
        value: Number(((host.ipmiWatts * loads[i]) / total).toFixed(4)),
        timestamp: ts,
      });
    });
  }

  metrics.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return JSON.stringify(a.labels).localeCompare(JSON.stringify(b.labels));
  });
  return formatToOpenMetrics(metrics);
}

function srSection(scrape, nowSeconds) {
  const metrics = [];
  for (const sr of SRS) {
    const labels = { pool_id: sr.pool.id, sr_uuid: sr.uuid, sr_name: sr.name };
    if (sr.pool.name !== "") labels.pool_name = sr.pool.name;
    labels.content_type = sr.content;
    if (sr.type !== "") labels.sr_type = sr.type;
    if (sr.host) {
      const host = hostByKey(sr.host);
      labels.host_id = host.uuid;
      labels.host_name = host.name;
    }
    addTags(labels, sr.tags);
    const usage = typeof sr.usage === "object" ? sr.usage[scrape] : sr.usage;
    metrics.push({ name: "xcp_sr_virtual_size_bytes", help: "SR virtual allocated size in bytes", type: "gauge", labels: { ...labels }, value: sr.virtual, timestamp: nowSeconds });
    metrics.push({ name: "xcp_sr_physical_size_bytes", help: "SR physical size in bytes", type: "gauge", labels: { ...labels }, value: sr.size, timestamp: nowSeconds });
    metrics.push({ name: "xcp_sr_physical_usage_bytes", help: "SR physical space used in bytes", type: "gauge", labels: { ...labels }, value: usage, timestamp: nowSeconds });
  }
  return formatToOpenMetrics(metrics);
}

function vdiSection(scrape, nowSeconds) {
  const metrics = [];
  for (const vdi of VDIS) {
    if (!vdi.scrapes.includes(scrape)) continue;
    const sr = srByKey(vdi.sr);
    const labels = { pool_id: sr.pool.id, sr_uuid: sr.uuid, sr_name: sr.name, vdi_uuid: vdi.uuid, vdi_name: vdi.name };
    if (sr.pool.name !== "") labels.pool_name = sr.pool.name;
    if (sr.type !== "") labels.sr_type = sr.type;
    if (vdi.vm) {
      const vm = vmByKey(vdi.vm);
      labels.vm_uuid = vm.uuid;
      labels.vm_name = vm.name;
    }
    metrics.push({ name: "xcp_vdi_virtual_size_bytes", help: "VDI virtual size in bytes", type: "gauge", labels: { ...labels }, value: vdi.size, timestamp: nowSeconds });
    metrics.push({ name: "xcp_vdi_physical_usage_bytes", help: "VDI physical space used in bytes (allocated on SR)", type: "gauge", labels: { ...labels }, value: vdi.usage, timestamp: nowSeconds });
  }
  return formatToOpenMetrics(metrics);
}

function hostStatusSection(nowSeconds) {
  const metrics = HOSTS.map((host) => {
    const labels = { pool_id: host.pool.id, uuid: host.uuid, host_name: host.name, power_state: host.powerState, enabled: String(host.enabled) };
    if (host.pool.name !== "") labels.pool_name = host.pool.name;
    addTags(labels, host.tags);
    return { name: "xcp_host_status", help: "Host status (1 = current state)", type: "gauge", labels, value: 1, timestamp: nowSeconds };
  });
  return formatToOpenMetrics(metrics);
}

function hostUptimeSection(nowSeconds) {
  const metrics = [];
  // formatHostUptimeMetrics walks the hosts it has credentials for: running ones.
  for (const host of HOSTS) {
    if (host.uptimeSeconds === null) continue;
    const labels = { pool_id: host.pool.id, uuid: host.uuid };
    if (host.pool.name !== "") labels.pool_name = host.pool.name;
    labels.host_name = host.name;
    addTags(labels, host.tags);
    metrics.push({ name: "xcp_host_uptime_seconds", help: "Host uptime in seconds since boot", type: "gauge", labels, value: host.uptimeSeconds, timestamp: nowSeconds });
  }
  return formatToOpenMetrics(metrics);
}

function vmStatusSection(scrape, nowSeconds) {
  const metrics = [];
  // #getVmStatusData reads type 'VM' objects: no control domains, no templates.
  for (const vm of VMS) {
    if (vm.isControlDomain) continue;
    const powerState = vm.powerState[scrape];
    if (!powerState) continue;
    const labels = { pool_id: vm.pool.id, uuid: vm.uuid, power_state: powerState };
    if (vm.pool.name !== "") labels.pool_name = vm.pool.name;
    if (vm.name !== "") labels.vm_name = vm.name;
    addTags(labels, vm.tags);
    metrics.push({ name: "xcp_vm_status", help: "VM power state indicator (always 1; current state is carried by the power_state label)", type: "gauge", labels, value: 1, timestamp: nowSeconds });
  }
  return formatToOpenMetrics(metrics);
}

function vmUptimeSection(scrape, nowSeconds) {
  const metrics = [];
  for (const vm of VMS) {
    if (vm.isControlDomain || vm.powerState[scrape] !== "Running") continue;
    const labels = { pool_id: vm.pool.id, uuid: vm.uuid };
    if (vm.pool.name !== "") labels.pool_name = vm.pool.name;
    if (vm.name !== "") labels.vm_name = vm.name;
    addTags(labels, vm.tags);
    metrics.push({ name: "xcp_vm_uptime_seconds", help: "VM uptime in seconds since boot", type: "gauge", labels, value: vm.uptimeSeconds, timestamp: nowSeconds });
  }
  return formatToOpenMetrics(metrics);
}

function xoSection(scrape, nowSeconds) {
  const g = (name, help, labels, value) => ({ name, help, type: "gauge", labels, value, timestamp: nowSeconds });
  const metrics = [
    g("xo_task_pending", "Total number of tasks pending", {}, 0),
    g("xo_pool_total", "Total number of pools", {}, 2),
    g("xo_host_total", "Total number of hosts", {}, HOSTS.length),
    g("xo_vm_total", "Total number of virtual machines", {}, VMS.filter((v) => !v.isControlDomain).length),
    g("xo_user_total", "Total number of users", {}, 3),
    g("xo_group_total", "Total number of groups", {}, 1),
    g("xo_socket_total", "Total number of CPU sockets across all hosts", {}, 4),
    g("xo_sr_total", "Total number of storage repositories by content type", { content_type: "user" }, 3),
    g("xo_sr_total", "Total number of storage repositories by content type", { content_type: "iso" }, 1),
    g("xo_host_version_total", "Total number of hosts by product brand and version", { product_brand: "XCP-ng", version: "8.3.0" }, HOSTS.length),
    g("xo_host_license_total", "Total number of hosts by license SKU type", { sku_type: "free" }, HOSTS.length),
    g("xo_nodejs_process_memory_bytes", "Memory usage of the XO main process in bytes", { type: "rss" }, 412131328),
    g("xo_nodejs_heap_size_limit_bytes", "V8 heap size limit in bytes — OOM occurs when heap_used approaches this value", {}, 4345298944),
    g("xo_backup_job_total", "Total number of backup jobs by type", { type: "backup" }, 2),
  ];
  return formatToOpenMetrics(metrics);
}

function buildXenOrchestraScrape(options) {
  const scrape = options && options.scrape === 2 ? 2 : 1;
  const nowSeconds = Math.floor(
    options && Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000,
  );

  const poolLines = [
    "# HELP xcp_pool_connected Indicates if a pool is connected (1) or not (0)",
    "# TYPE xcp_pool_connected gauge",
  ];
  const seen = new Set();
  for (const host of HOSTS) {
    if (host.powerState !== "Running" || seen.has(host.pool.id)) continue;
    seen.add(host.pool.id);
    poolLines.push(`xcp_pool_connected{pool_id="${host.pool.id}",pool_name="${host.pool.name}"} 1`);
  }

  const sections = [
    poolLines.join("\n"),
    rrdSection(scrape, nowSeconds),
    srSection(scrape, nowSeconds),
    vdiSection(scrape, nowSeconds),
    hostStatusSection(nowSeconds),
    hostUptimeSection(nowSeconds),
    vmStatusSection(scrape, nowSeconds),
    vmUptimeSection(scrape, nowSeconds),
    xoSection(scrape, nowSeconds),
  ].filter((section) => section !== "");

  return sections.join("\n") + "\n# EOF";
}

module.exports = {
  buildXenOrchestraScrape,
  POOLS,
  HOSTS,
  VMS,
  SRS,
  VDIS,
  RATE_TYPED_AS_COUNTER: [
    "xcp_host_network_receive_bytes_total",
    "xcp_host_network_transmit_bytes_total",
    "xcp_vm_network_receive_bytes_total",
    "xcp_vm_network_transmit_bytes_total",
    "xcp_vm_network_receive_errors_total",
    "xcp_vm_network_transmit_errors_total",
    "xcp_vm_disk_read_bytes_total",
    "xcp_vm_disk_write_bytes_total",
  ],
};

if (require.main === module) {
  const scrape = Number(process.argv[2] || 1);
  const nowSeconds = process.argv[3] ? Number(process.argv[3]) : undefined;
  process.stdout.write(buildXenOrchestraScrape({ scrape, nowSeconds }));
}
