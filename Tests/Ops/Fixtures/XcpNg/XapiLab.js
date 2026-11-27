/*
 * THE SAME LAB, AS XAPI ANSWERS FOR IT (#10999).
 *
 * XenOrchestraScrape.js is what Xen Orchestra's OpenMetrics plugin serves
 * for a lab of two pools; this is what each pool's master answers when a
 * probe reads that pool straight from XAPI - the records of
 * <class>.get_all_records and each running host's rrd_updates - for the
 * very same hosts, VMs, storage repositories and virtual disks, at the same
 * moment. The plugin builds its series from exactly these reads, so the
 * probe's port of it (packages/Probe/Utils/XcpNg/XapiOpenMetrics) is held
 * to the recording: read through XAPI, a pool has the series Xen
 * Orchestra served for it.
 *
 * The shapes are XAPI's own (ocaml/idl/datamodel*.ml in xapi-project/
 * xen-api, and the rrd_updates JSON of its metrics documentation, read on
 * 26 November 2026), as XAPI 24 (XCP-ng 8.3) writes them over JSON-RPC:
 *
 *   - records keyed by OpaqueRef, fields named as the datamodel names them;
 *   - int64 fields (sizes) as strings, as the plugin's xo-server reads them
 *     with a unary +;
 *   - a host's other_config.boot_time in seconds, with XAPI's trailing dot;
 *     a VM's metrics.start_time as an XAPI DateTime (20261126T04:20:00Z);
 *   - rrd_updates' legend "AVERAGE:<host|vm>:<uuid>:<name>", numbers as
 *     strings (XAPI 23.31 and later), rows newest first - and the plugin
 *     reads the LAST row, so that is the one holding the recorded minute.
 *     The row before it holds other values, which a port reading the wrong
 *     row would serve;
 *   - each RRD in XAPI's units: memory in KiB, throughput in MiB/s, latency
 *     in microseconds - the plugin converts them, and so must the port.
 *
 * What the plugin reads outside these - a host's IPMI power, through a
 * host plugin call - is not here: a probe with a read-only account cannot
 * make that call. So the VM power estimate drawn from it is not either.
 *
 * Each pool's master also holds a VM template, a VM snapshot and a VDI
 * snapshot, which xo-server leaves out of what the plugin reads.
 *
 * buildXapiLab({ pool: "production" | "unnamed", scrape: 1 | 2, nowSeconds })
 */

"use strict";

const { POOLS, HOSTS, VMS, SRS, VDIS } = require("./XenOrchestraScrape");

const GiB = 1024 * 1024 * 1024;
const NULL_REF = "OpaqueRef:NULL";

const HOST_ADDRESSES = {
  prod1: "10.0.0.11",
  prod2: "10.0.0.12",
  prod3: "10.0.0.13",
  lab1: "10.0.1.11",
};

// The first host of each pool is its master.
const MASTER_BY_POOL = {
  [POOLS.production.id]: "prod1",
  [POOLS.unnamed.id]: "lab1",
};

function poolKeyOf(poolId) {
  return poolId === POOLS.production.id ? "production" : "unnamed";
}

function ref(kind, key) {
  return `OpaqueRef:${kind}-${key}`;
}

// A UUID of the lab's own for an object the Xen Orchestra recording has none of.
function labUuid(pool, suffix) {
  return `${pool.id.slice(0, 8)}-0000-4000-8000-00000000${suffix}`;
}

// The same steady values XenOrchestraScrape.js serves (its wobble).
function wobble(base, scrape, step) {
  return Number((base + (scrape - 1) * step).toFixed(6));
}

// XAPI's DateTime: "20261126T04:20:00Z".
function xapiDateTime(seconds) {
  const date = new Date(seconds * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}Z`;
}

function hostBusy(host) {
  return host.key === "prod1" ? 0.62 : host.key === "prod2" ? 0.35 : 0.08;
}

function vmBusy(vm) {
  return vm.isControlDomain ? 0.05 : vm.key === "db01" ? 0.71 : 0.24;
}

/*
 * One running host's rrd_updates: its own series and those of the VMs it
 * runs, in XAPI's units, as the plugin's metric table reads them.
 */
function rrdOf(host, scrape, nowSeconds) {
  const legend = [];
  const recorded = [];
  const add = (objectType, uuid, name, value) => {
    legend.push(`AVERAGE:${objectType}:${uuid}:${name}`);
    recorded.push(value);
  };

  const busy = hostBusy(host);
  add("host", host.uuid, "loadavg", wobble(busy * 4, scrape, 0.1));
  add("host", host.uuid, "memory_free_kib", (host.key === "prod1" ? 9 * GiB : 40 * GiB) / 1024);
  add("host", host.uuid, "memory_total_kib", (64 * GiB) / 1024);
  add("host", host.uuid, "cpu_avg", wobble(busy, scrape, 0.01));
  for (let core = 0; core < host.cores; core++) {
    add("host", host.uuid, `cpu${core}`, wobble(busy + core * 0.01, scrape, 0.01));
  }
  add("host", host.uuid, "pif_aggr_rx", scrape === 1 ? 1873421.5 : 912377.25);
  add("host", host.uuid, "pif_aggr_tx", scrape === 1 ? 958231.75 : 433120.5);
  add("host", host.uuid, "pif_eth0_rx", scrape === 1 ? 1873421.5 : 912377.25);
  add("host", host.uuid, "pif_eth0_tx", scrape === 1 ? 958231.75 : 433120.5);

  const localSr = SRS.find((sr) => sr.host === host.key);
  const srIds = [
    localSr ? localSr.uuid.slice(0, 8) : null,
    host.pool === POOLS.production ? "1d2c3b4a" : null,
  ].filter(Boolean);
  for (const sr of srIds) {
    add("host", host.uuid, `iops_read_${sr}`, wobble(120, scrape, 15));
    add("host", host.uuid, `iops_write_${sr}`, wobble(310, scrape, -40));
    // MiB/s, as XAPI keeps them.
    add("host", host.uuid, `io_throughput_read_${sr}`, 3.5);
    add("host", host.uuid, `io_throughput_write_${sr}`, 7.25);
    // Microseconds, as XAPI keeps them.
    add("host", host.uuid, `read_latency_${sr}`, 2100);
    add("host", host.uuid, `write_latency_${sr}`, sr === "1d2c3b4a" ? 74300 : 3400);
    add("host", host.uuid, `iowait_${sr}`, 0.012);
    add("host", host.uuid, `iops_total_${sr}`, wobble(430, scrape, -25));
    add("host", host.uuid, `io_throughput_total_${sr}`, 10.75);
    add("host", host.uuid, `latency_${sr}`, sr === "1d2c3b4a" ? 61200 : 2900);
  }
  add("host", host.uuid, "hostload", wobble(busy * 1.1, scrape, 0.02));
  add("host", host.uuid, "memory_reclaimed", 0);
  add("host", host.uuid, "memory_reclaimed_max", (2 * GiB) / 1024);
  const runningVcpus = VMS.filter(
    (vm) => vm.host === host.key && vm.powerState[scrape] === "Running",
  ).reduce((sum, vm) => sum + vm.vcpus, 0);
  add("host", host.uuid, "running_vcpus", runningVcpus);

  for (const vm of VMS) {
    if (vm.host !== host.key || vm.powerState[scrape] !== "Running") continue;
    const busyVm = vmBusy(vm);
    add("vm", vm.uuid, "memory", vm.memory);
    if (!vm.isControlDomain) {
      add("vm", vm.uuid, "memory_internal_free", Math.round(vm.memory * 0.35) / 1024);
    }
    add("vm", vm.uuid, "memory_target", vm.memory);
    add("vm", vm.uuid, "cpu_usage", wobble(busyVm, scrape, 0.02));
    for (let core = 0; core < vm.vcpus; core++) {
      add("vm", vm.uuid, `cpu${core}`, wobble(busyVm, scrape, 0.02));
    }
    add("vm", vm.uuid, "runstate_fullrun", wobble(busyVm * 0.8, scrape, 0));
    add("vm", vm.uuid, "runstate_full_contention", vm.key === "db01" ? 0.142 : 0.004);
    add("vm", vm.uuid, "runstate_partial_run", 0.05);
    add("vm", vm.uuid, "runstate_partial_contention", 0.003);
    add("vm", vm.uuid, "runstate_concurrency_hazard", 0.001);
    add("vm", vm.uuid, "runstate_blocked", wobble(1 - busyVm, scrape, 0));
    for (const vif of vm.vifs) {
      add("vm", vm.uuid, `vif_${vif.index}_rx`, scrape === 1 ? 524288.5 : 131072.25);
      add("vm", vm.uuid, `vif_${vif.index}_tx`, scrape === 1 ? 262144 : 65536);
      add("vm", vm.uuid, `vif_${vif.index}_rx_errors`, scrape === 1 ? 0.5 : 0);
      add("vm", vm.uuid, `vif_${vif.index}_tx_errors`, 0);
    }
    for (const disk of vm.disks) {
      const d = (name, value) => add("vm", vm.uuid, `vbd_${disk.device}_${name}`, value);
      d("read", scrape === 1 ? 2097152 : 1048576);
      d("write", scrape === 1 ? 4194304 : 524288);
      d("iops_read", 42);
      d("iops_write", 97);
      d("iops_total", 139);
      d("read_latency", 1800);
      d("write_latency", 4100);
      d("io_throughput_read", 2);
      d("io_throughput_write", 4);
      d("io_throughput_total", 6);
      d("latency", 3100);
      d("iowait", 0.004);
      d("inflight", 0);
      d("avgqu_sz", 0.02);
    }
  }

  // The plugin's minute: Xen Orchestra's last full minute, less one.
  const recordedMinute = Math.floor(nowSeconds / 60) * 60 - 60;

  return JSON.stringify({
    meta: {
      start: recordedMinute - 60,
      step: 60,
      end: recordedMinute + 60,
      rows: 2,
      columns: legend.length,
      legend: legend,
    },
    data: [
      // Newest first: a later minute the plugin does not read.
      {
        t: recordedMinute + 60,
        values: recorded.map((value) => String(Number(value) + 1)),
      },
      { t: recordedMinute, values: recorded.map((value) => String(value)) },
    ],
  });
}

function buildXapiLab(options) {
  const poolKey = options && options.pool === "unnamed" ? "unnamed" : "production";
  const scrape = options && options.scrape === 2 ? 2 : 1;
  const nowSeconds = Math.floor(
    options && Number.isFinite(options.nowSeconds) ? options.nowSeconds : Date.now() / 1000,
  );
  const pool = POOLS[poolKey];
  const hosts = HOSTS.filter((host) => host.pool === pool);
  const masterKey = MASTER_BY_POOL[pool.id];
  const networkRef = ref("network", poolKey);

  const records = {
    pool: {
      [ref("pool", poolKey)]: {
        uuid: pool.id,
        name_label: pool.name,
        name_description: "",
        master: ref("host", masterKey),
        ha_enabled: poolKey === "production",
        ha_host_failures_to_tolerate: poolKey === "production" ? "1" : "0",
        ha_plan_exists_for: "0",
        ha_overcommitted: poolKey === "production",
        other_config: {},
        tags: [],
      },
    },
    host: {},
    host_metrics: {},
    VM: {},
    VM_metrics: {},
    SR: {},
    PBD: {},
    VDI: {},
    VBD: {},
    VIF: {},
    PIF: {},
    network: {
      [networkRef]: {
        uuid: labUuid(pool, "0e70"),
        name_label: "Pool-wide network associated with eth0",
        PIFs: [],
        VIFs: [],
      },
    },
  };

  for (const host of hosts) {
    const isRunning = host.powerState === "Running";
    records.host[ref("host", host.key)] = {
      uuid: host.uuid,
      name_label: host.name,
      address: HOST_ADDRESSES[host.key],
      enabled: host.enabled,
      metrics: ref("host_metrics", host.key),
      other_config:
        host.uptimeSeconds === null
          ? {}
          : { boot_time: `${nowSeconds - host.uptimeSeconds}.` },
      tags: host.tags,
      PIFs: [ref("PIF", host.key)],
      PBDs: [],
      software_version: {
        product_brand: "XCP-ng",
        product_version: "8.3.0",
        platform_version: "3.4.0",
        xapi: "24.39",
      },
    };
    records.host_metrics[ref("host_metrics", host.key)] = {
      live: isRunning,
      memory_total: String(64 * GiB),
      memory_free: String(host.key === "prod1" ? 9 * GiB : 40 * GiB),
    };
    records.PIF[ref("PIF", host.key)] = {
      device: "eth0",
      host: ref("host", host.key),
      network: networkRef,
      management: true,
    };
  }

  for (const vm of VMS) {
    if (vm.pool !== pool) continue;
    const powerState = vm.powerState[scrape];
    if (!powerState) continue;
    const isOn = powerState === "Running" || powerState === "Paused";
    records.VM[ref("VM", vm.key)] = {
      uuid: vm.uuid,
      name_label: vm.name,
      power_state: powerState,
      is_control_domain: vm.isControlDomain,
      is_a_template: false,
      is_a_snapshot: false,
      snapshot_of: NULL_REF,
      resident_on: isOn && vm.host ? ref("host", vm.host) : NULL_REF,
      metrics: ref("VM_metrics", vm.key),
      VCPUs_max: String(vm.vcpus),
      VCPUs_at_startup: String(vm.vcpus),
      tags: vm.tags,
      VBDs: vm.disks.map((disk) => ref("VBD", `${vm.key}-${disk.device}`)),
      VIFs: vm.vifs.map((vif) => ref("VIF", `${vm.key}-${vif.index}`)),
    };
    records.VM_metrics[ref("VM_metrics", vm.key)] = {
      start_time:
        powerState === "Running" && vm.uptimeSeconds !== null
          ? xapiDateTime(nowSeconds - vm.uptimeSeconds)
          : // XAPI keeps the last start of a VM that is not running.
            xapiDateTime(nowSeconds - 30 * 86400),
      VCPUs_number: String(vm.vcpus),
    };
    for (const disk of vm.disks) {
      records.VBD[ref("VBD", `${vm.key}-${disk.device}`)] = {
        VM: ref("VM", vm.key),
        VDI: ref("VDI", disk.vdi),
        device: disk.device,
        type: "Disk",
        currently_attached: isOn,
      };
    }
    for (const vif of vm.vifs) {
      records.VIF[ref("VIF", `${vm.key}-${vif.index}`)] = {
        VM: ref("VM", vm.key),
        network: networkRef,
        device: vif.index,
      };
    }
  }

  for (const sr of SRS) {
    if (sr.pool !== pool) continue;
    const pbdHosts = sr.host ? [sr.host] : hosts.map((host) => host.key);
    const usage = typeof sr.usage === "object" ? sr.usage[scrape] : sr.usage;
    records.SR[ref("SR", sr.key)] = {
      uuid: sr.uuid,
      name_label: sr.name,
      type: sr.type,
      content_type: sr.content,
      physical_size: String(sr.size),
      physical_utilisation: String(usage),
      virtual_allocation: String(sr.virtual),
      shared: sr.host === null,
      PBDs: pbdHosts.map((hostKey) => ref("PBD", `${sr.key}-${hostKey}`)),
      VDIs: [],
      tags: sr.tags,
    };
    for (const hostKey of pbdHosts) {
      records.PBD[ref("PBD", `${sr.key}-${hostKey}`)] = {
        host: ref("host", hostKey),
        SR: ref("SR", sr.key),
        currently_attached: true,
      };
    }
  }

  for (const vdi of VDIS) {
    const sr = SRS.find((candidate) => candidate.key === vdi.sr);
    if (!sr || sr.pool !== pool || !vdi.scrapes.includes(scrape)) continue;
    const vbds = vdi.vm
      ? (VMS.find((vm) => vm.key === vdi.vm).disks || [])
          .filter((disk) => disk.vdi === vdi.key)
          .map((disk) => ref("VBD", `${vdi.vm}-${disk.device}`))
      : [];
    records.VDI[ref("VDI", vdi.key)] = {
      uuid: vdi.uuid,
      name_label: vdi.name,
      SR: ref("SR", vdi.sr),
      VBDs: vbds,
      virtual_size: String(vdi.size),
      physical_utilisation: String(vdi.usage),
      is_a_snapshot: false,
      snapshot_of: NULL_REF,
      managed: true,
      type: "user",
    };
  }

  // What xo-server leaves out: a template, a VM snapshot, a VDI snapshot.
  const masterRef = ref("host", masterKey);
  records.VM[ref("VM", `${poolKey}-template`)] = {
    uuid: labUuid(pool, "a001"),
    name_label: "Debian Bookworm 12",
    power_state: "Halted",
    is_control_domain: false,
    is_a_template: true,
    is_a_snapshot: false,
    snapshot_of: NULL_REF,
    resident_on: NULL_REF,
    metrics: ref("VM_metrics", `${poolKey}-template`),
    VCPUs_max: "2",
    VCPUs_at_startup: "2",
    tags: [],
    VBDs: [],
    VIFs: [],
  };
  records.VM[ref("VM", `${poolKey}-snapshot`)] = {
    uuid: labUuid(pool, "a002"),
    name_label: "before upgrade",
    power_state: "Halted",
    is_control_domain: false,
    is_a_template: false,
    is_a_snapshot: true,
    snapshot_of: ref("VM", poolKey === "production" ? "web01" : "labvm01"),
    resident_on: NULL_REF,
    metrics: ref("VM_metrics", `${poolKey}-snapshot`),
    VCPUs_max: "1",
    VCPUs_at_startup: "1",
    tags: [],
    VBDs: [],
    VIFs: [],
  };
  const anySr = SRS.find((sr) => sr.pool === pool);
  records.VDI[ref("VDI", `${poolKey}-snapshot`)] = {
    uuid: labUuid(pool, "a003"),
    name_label: "before upgrade disk",
    SR: ref("SR", anySr.key),
    VBDs: [],
    virtual_size: String(10 * GiB),
    physical_utilisation: String(GiB),
    is_a_snapshot: true,
    snapshot_of: NULL_REF,
    managed: true,
    type: "user",
  };

  const rrds = {};
  for (const host of hosts) {
    if (host.powerState === "Running") {
      rrds[host.uuid] = rrdOf(host, scrape, nowSeconds);
    }
  }

  return {
    pool: poolKey,
    poolId: pool.id,
    scrape,
    nowSeconds,
    masterHostUuid: hosts.find((host) => host.key === masterKey).uuid,
    masterRef: masterRef,
    hosts: hosts.map((host) => ({
      key: host.key,
      uuid: host.uuid,
      name: host.name,
      address: HOST_ADDRESSES[host.key],
      isRunning: host.powerState === "Running",
      isMaster: host.key === masterKey,
    })),
    records,
    rrds,
  };
}

module.exports = {
  buildXapiLab,
  HOST_ADDRESSES,
  poolKeyOf,
  xapiDateTime,
};

if (require.main === module) {
  const pool = process.argv[2] === "unnamed" ? "unnamed" : "production";
  const scrape = Number(process.argv[3] || 1);
  const nowSeconds = process.argv[4] ? Number(process.argv[4]) : undefined;
  process.stdout.write(
    JSON.stringify(buildXapiLab({ pool, scrape, nowSeconds }), null, 2) + "\n",
  );
}
