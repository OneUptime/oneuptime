#!/usr/bin/env node
// A stand-in for the REST API of a NetApp ONTAP cluster, for running the real
// NetApp Harvest exporter against when no cluster is at hand.
//
// Tests/Ops/storage-array-agent-netapp-behaviour.sh runs it on the node image,
// next to the Storage Array Agent's shipped netapp-harvest service, and it
// answers every endpoint the shipped netapp-harvest-*.yaml templates (and the
// Harvest plugins they name) read:
//
//   - public collections (api/storage/volumes ...) and private CLI
//     passthrough (api/private/cli/volume ...) as {"records": [...],
//     "num_records": n}, filtered by ONTAP's query syntax (a|b, !a, !null,
//     >=n, *, "quoted"), cut down to the fields asked for, paged by
//     max_records;
//   - api/cluster, which is one object, not a collection;
//   - the performance counter tables api/cluster/counter/tables/<table>
//     (their counter schemas) and their /rows;
//   - api/support/ems/events, with the time, message.name and
//     message.severity filters honoured.
//
// Records are shaped as NetApp's ONTAP REST API reference and Harvest's own
// testdata (cmd/collectors/*/testdata, which are recorded ONTAP responses)
// shape them. Every value is invented: see
// packages/Common/Tests/Fixtures/NetAppHarvest/26.11.0/README.md for what the
// scenarios are and what no real ONTAP confirmed.
//
// Counters move with wall-clock time, so Harvest's KeyPerf and RestPerf
// collectors compute rates: statistics.*_raw and every counter-table counter
// grows at the scenario's rate, and statistics.timestamp is the current time.
// EMS events follow a timeline relative to the moment this server started.
//
// Environment:
//   ONTAP_SCENARIO   ontap (default): an ONTAP 9.16.1 AFF A400 HA pair
//                    fsx: an Amazon FSx for NetApp ONTAP file system on 9.15.1,
//                    which answers 403 for what fsxadmin cannot read
//   ONTAP_USERNAME, ONTAP_PASSWORD
//                    the only HTTP Basic credentials accepted; anything else
//                    is answered with ONTAP's 401
//   ONTAP_PORT       HTTPS port (default 443, where Harvest connects)
//   ONTAP_TLS_CERT, ONTAP_TLS_KEY
//                    PEM files of the self-signed certificate it serves
//                    (default /fake/cert.pem and /fake/key.pem)
//
// It logs one line per request: the time since it started, the method, the
// path and query, the status, how many records it returned and whether the
// Basic credentials were exactly the configured ones (auth=ok). An endpoint
// it does not know answers {"records": [], "num_records": 0} - Harvest takes
// that as an object with no instances - and is logged as UNKNOWN; so is a
// counter table it does not know, which answers ONTAP's 404 "Table requested
// is not found" instead (Harvest's RestPerf reads the first record of a
// table's definition, and has none to read in an empty list). It never logs
// a password.
//
// No dependencies: node's own https module only.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");

const SCENARIO = process.env.ONTAP_SCENARIO || "ontap";
const USERNAME = process.env.ONTAP_USERNAME;
const PASSWORD = process.env.ONTAP_PASSWORD;
const PORT = Number(process.env.ONTAP_PORT || "443");
const TLS_CERT = process.env.ONTAP_TLS_CERT || "/fake/cert.pem";
const TLS_KEY = process.env.ONTAP_TLS_KEY || "/fake/key.pem";

if (!["ontap", "fsx"].includes(SCENARIO)) {
  console.error(`ONTAP_SCENARIO must be ontap or fsx, not ${JSON.stringify(SCENARIO)}`);
  process.exit(2);
}
if (!USERNAME || PASSWORD === undefined || PASSWORD === "") {
  console.error("ONTAP_USERNAME and ONTAP_PASSWORD must be set");
  process.exit(2);
}

// ---- Time --------------------------------------------------------------------
// The EMS timeline counts from START. Counters count from BOOT, which is the
// nodes' boot: about 120 days before START.

const START_MS = Date.now();
const START_S = Math.floor(START_MS / 1000);
const UPTIME_AT_START_S = 120 * 86400 + 4 * 3600 + 17 * 60;
const BOOT_S = START_S - UPTIME_AT_START_S;

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const TIB = 1024 * GIB;

function nowSeconds() {
  return Date.now() / 1000;
}

// 2026-11-26T03:30:15Z, as ONTAP writes statistics.timestamp.
function isoZulu(seconds) {
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(".000Z", "Z");
}

// 2026-11-26T03:30:15+00:00, as ONTAP writes event times and dates.
function isoOffset(seconds) {
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(".000Z", "+00:00");
}

// PT3H10M12S, as ONTAP writes durations.
function isoDuration(seconds) {
  let rest = Math.max(0, Math.round(seconds));
  const days = Math.floor(rest / 86400);
  rest -= days * 86400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const secs = rest - minutes * 60;
  let out = "P";
  if (days) {
    out += `${days}D`;
  }
  out += "T";
  if (hours) {
    out += `${hours}H`;
  }
  if (minutes) {
    out += `${minutes}M`;
  }
  if (secs || out.endsWith("T")) {
    out += `${secs}S`;
  }
  return out;
}

// A counter that has grown at perSecond since BOOT.
function grown(perSecond, atSeconds) {
  return Math.round(perSecond * (atSeconds - BOOT_S));
}

// A UUID that stays the same for the same name in the same scenario.
function uuidFor(name) {
  const h = crypto.createHash("sha1").update(`${SCENARIO}/${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-1${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function hexFor(name, length) {
  return crypto.createHash("sha1").update(`${SCENARIO}/${name}`).digest("hex").slice(0, length).toUpperCase();
}

function link(href) {
  return { self: { href } };
}

// ---- Performance profiles --------------------------------------------------
// A profile is a steady workload: operations per second, microseconds per
// operation and bytes per second, for reads, writes and other operations.

function profile(readOps, writeOps, otherOps, readLatency, writeLatency, otherLatency, readBytes, writeBytes) {
  return { readOps, writeOps, otherOps, readLatency, writeLatency, otherLatency, readBytes, writeBytes, otherBytes: 0 };
}

const IDLE = profile(0, 0, 0, 0, 0, 0, 0, 0);

function sumProfiles(profiles) {
  const total = { ...IDLE };
  const weighted = { read: 0, write: 0, other: 0 };
  for (const p of profiles) {
    total.readOps += p.readOps;
    total.writeOps += p.writeOps;
    total.otherOps += p.otherOps;
    total.readBytes += p.readBytes;
    total.writeBytes += p.writeBytes;
    total.otherBytes += p.otherBytes;
    weighted.read += p.readOps * p.readLatency;
    weighted.write += p.writeOps * p.writeLatency;
    weighted.other += p.otherOps * p.otherLatency;
  }
  total.readLatency = total.readOps ? weighted.read / total.readOps : 0;
  total.writeLatency = total.writeOps ? weighted.write / total.writeOps : 0;
  total.otherLatency = total.otherOps ? weighted.other / total.otherOps : 0;
  return total;
}

// The statistics block of api/cluster, api/cluster/nodes, api/storage/aggregates,
// api/storage/volumes and api/storage/luns: raw counters since boot, which
// Harvest's KeyPerf collector turns into rates and averages.
function statisticsBlock(p, atSeconds) {
  const t = Math.floor(atSeconds);
  const iops = {
    read: grown(p.readOps, t),
    write: grown(p.writeOps, t),
    other: grown(p.otherOps, t),
  };
  iops.total = iops.read + iops.write + iops.other;
  const latency = {
    other: grown(p.otherOps * p.otherLatency, t),
    read: grown(p.readOps * p.readLatency, t),
    write: grown(p.writeOps * p.writeLatency, t),
  };
  latency.total = latency.other + latency.read + latency.write;
  const throughput = {
    read: grown(p.readBytes, t),
    write: grown(p.writeBytes, t),
    other: grown(p.otherBytes, t),
  };
  throughput.total = throughput.read + throughput.write + throughput.other;
  return {
    timestamp: isoZulu(t),
    status: "ok",
    latency_raw: { other: latency.other, total: latency.total, read: latency.read, write: latency.write },
    iops_raw: iops,
    throughput_raw: throughput,
  };
}

// The 15-second averages ONTAP reports beside the raw counters.
function metricBlock(p, atSeconds) {
  const totalOps = p.readOps + p.writeOps + p.otherOps;
  const totalLatency = totalOps
    ? (p.readOps * p.readLatency + p.writeOps * p.writeLatency + p.otherOps * p.otherLatency) / totalOps
    : 0;
  return {
    timestamp: isoZulu(Math.floor(atSeconds / 15) * 15),
    duration: "PT15S",
    status: "ok",
    latency: {
      other: Math.round(p.otherLatency),
      total: Math.round(totalLatency),
      read: Math.round(p.readLatency),
      write: Math.round(p.writeLatency),
    },
    iops: {
      read: Math.round(p.readOps),
      write: Math.round(p.writeOps),
      other: Math.round(p.otherOps),
      total: Math.round(totalOps),
    },
    throughput: {
      read: Math.round(p.readBytes),
      write: Math.round(p.writeBytes),
      other: Math.round(p.otherBytes),
      total: Math.round(p.readBytes + p.writeBytes + p.otherBytes),
    },
  };
}

// ---- Scenarios -------------------------------------------------------------

// Harvest's default EMS template (conf/ems/9.6.0/ems.yaml of 26.11.0) asks only
// for events the cluster's catalogue lists, so the catalogue holds all of them
// (and a few more, as a real one holds thousands).
const EMS_CATALOGUE = [
  "LUN.destroy", "LUN.offline", "LUN.online", "NVMeNS.destroy", "NVMeNS.offline", "NVMeNS.online",
  "Nblade.cifsManyAuths", "Nblade.cifsMaxOpenSameFile", "Nblade.cifsMaxSessPerUsrConn",
  "Nblade.cifsNbNameConflict", "Nblade.cifsNoPrivShare", "Nblade.nfsV4PoolExhaust",
  "Nblade.vscanBadUserPrivAccess", "Nblade.vscanConnBackPressure", "Nblade.vscanConnInactive",
  "Nblade.vscanNoRegdScanner", "Nblade.vscanNoScannerConn", "Nblade.vscanVirusDetected",
  "arl.netra.ca.check.failed", "arw.volume.state", "arw.vserver.state", "callhome.arw.activity.seen",
  "callhome.battery.low", "callhome.data.outage.detected", "callhome.hainterconnect.down",
  "callhome.sp.hbt.missed", "callhome.sp.hbt.stopped", "cifs.shadowcopy.failure",
  "cloud.aws.iamNotInitialized", "cluster.switch.pwr.fail", "disk.outOfService", "diskShelf.psu.added",
  "diskShelf.psu.removed", "fabricpool.full", "fabricpool.nearly.full", "gb.netra.ca.check.failed",
  "hm.alert.cleared", "hm.alert.raised", "mcc.config.auso.stDisabled", "mcc.config.auso.stEnabled",
  "mgmtgwd.rootvolrec.low.space", "monitor.fan.critical", "monitor.fan.failed", "monitor.fan.ok",
  "monitor.fan.warning", "nvmf.graceperiod.active", "nvmf.graceperiod.expired", "nvmf.graceperiod.start",
  "nvram.battery.charging.normal", "object.store.available", "object.store.unavailable",
  "objstore.host.unresolvable", "objstore.interclusterlifDown", "osc.signatureMismatch",
  "qos.monitor.memory.abated", "qos.monitor.memory.maxed", "scsiblade.san.config.active",
  "scsitarget.fct.port.full", "scsitarget.fct.sfpRxPowerLow", "scsitarget.fct.sfpTxPowerLow",
  "ses.status.fanError", "ses.status.fanInfo", "sk.panic", "sm.mediator.added", "sm.mediator.cacert.expired",
  "sm.mediator.cacert.expiring", "sm.mediator.clientc.expired", "sm.mediator.clientc.expiring",
  "sm.mediator.in.quorum", "sm.mediator.misconfigured", "sm.mediator.removed", "sm.mediator.serverc.expired",
  "sm.mediator.serverc.expiring", "sm.mediator.unreachable", "smbc.aufo.completed", "smbc.aufo.failed",
  "smbc.pfo.completed", "smbc.pfo.failed", "smc.snapmir.init.fail", "sms.common.snapshot.failed",
  "sms.fanout.comm.snap.deleted", "sms.resync.attempt.failed", "sms.snap.not.replicated",
  "sms.status.in.sync", "sms.status.out.of.sync", "sms.status.out.of.sync.cg", "sp.heartbeat.resumed",
  "sp.ipmi.lost.shutdown", "sp.notConfigured", "unowned.disk.reminder", "vserver.start.succeeded",
  "vserver.stop.succeeded", "wafl.ca.resync.complete", "wafl.dir.size.warning", "wafl.readdir.expired",
  "wafl.vol.autoSize.done", "wafl.vvol.offline", "wafl.vvol.online", "wafl.vvol.restrict",
  // Not in Harvest's list.
  "callhome.reboot.unknown", "mgmtgwd.jobmgr.jobcomplete.success", "raid.rg.recons.done",
  "sis.chkpoint.restore.failed", "snapmirror.dst.resync.success", "wafl.scan.done",
];

function ontapScenario() {
  const nodeNames = ["ontap-prod-01-01", "ontap-prod-01-02"];
  const cluster = {
    name: "ontap-prod-01",
    uuid: "9f2c1a4e-0b7d-11ee-9d3a-00a098d7c5f1",
    serial: "1-80-000123",
    release: "NetApp Release 9.16.1P3: Thu Mar 13 08:24:36 UTC 2025",
    version: [9, 16, 1],
    location: "DC1, row 4, rack 12",
    contact: "storage-team@example.com",
    managementIp: "192.0.2.10",
    dnsDomains: ["corp.example.com"],
    nameServers: ["192.0.2.53", "192.0.2.54"],
    ntpServers: ["ntp1.corp.example.com", "ntp2.corp.example.com"],
    sanOptimized: false,
    disaggregated: false,
  };

  const nodes = [
    {
      name: nodeNames[0],
      serial: "721950000101",
      systemId: "0538120101",
      model: "AFF-A400",
      partner: nodeNames[1],
      cpuBusy: 0.35,
      failedFans: 0,
      failedFanMessage: "There are no failed fans.",
      failedFanCode: "111411208",
      managementIp: "192.0.2.11",
      spIp: "192.0.2.21",
    },
    {
      name: nodeNames[1],
      serial: "721950000102",
      systemId: "0538120102",
      model: "AFF-A400",
      partner: nodeNames[0],
      cpuBusy: 0.62,
      failedFans: 1,
      failedFanMessage: "Fan 2 is not operating within the recommended RPM range.",
      failedFanCode: "111411207",
      managementIp: "192.0.2.12",
      spIp: "192.0.2.22",
    },
  ];

  const svms = [
    { name: "ontap-prod-01", type: "admin" },
    { name: nodeNames[0], type: "node" },
    { name: nodeNames[1], type: "node" },
    { name: "svm_nas", type: "data", state: "running", nfs: true, cifs: true, rootVolume: "svm_nas_root", aggregate: "aggr1_n01" },
    { name: "svm_san", type: "data", state: "running", iscsi: true, fcp: true, rootVolume: "svm_san_root", aggregate: "aggr1_n01" },
    { name: "svm_dr", type: "data", state: "running", nfs: true, rootVolume: "svm_dr_root", aggregate: "aggr1_n02" },
    { name: "svm_test", type: "data", state: "stopped", nfs: true, rootVolume: "svm_test_root", aggregate: "aggr1_n02" },
  ];

  // Root-data-data partitioning, as AFF systems ship: every SSD in use gives
  // one data partition to each node's data aggregate and its third, root
  // partition to its own node's root aggregate.
  const aggregates = [
    {
      name: "aggr1_n01",
      node: nodeNames[0],
      size: 46 * TIB,
      usedPercent: 82,
      reductionRatio: 2.6,
      volumeCount: 3,
      diskCount: 10,
      root: false,
      profileOf: ["vol_home", "vol_db", "svm_nas_root"],
    },
    {
      name: "aggr1_n02",
      node: nodeNames[1],
      size: 46 * TIB,
      usedPercent: 93,
      reductionRatio: 2.6,
      volumeCount: 5,
      diskCount: 10,
      root: false,
      profileOf: ["vol_projects", "vol_logs", "vol_web_dr", "vol_erp_dr", "vol_home_dr"],
    },
    { name: "aggr0_n01", node: nodeNames[0], size: 159 * GIB, usedPercent: 95, volumeCount: 1, diskCount: 4, root: true },
    { name: "aggr0_n02", node: nodeNames[1], size: 238 * GIB, usedPercent: 95, volumeCount: 1, diskCount: 6, root: true },
  ];

  const volumes = [
    {
      name: "vol_home", svm: "svm_nas", aggregate: "aggr1_n01", size: 10 * TIB, usedPercent: 64, state: "online",
      type: "rw", junction: "/vol_home", snapshotPolicy: "default", nfs: true, protectedBy: "vol_home_dr",
      perf: profile(850, 420, 1300, 320, 410, 110, 54 * MIB, 27 * MIB),
    },
    {
      name: "vol_projects", svm: "svm_nas", aggregate: "aggr1_n02", size: 20 * TIB, usedPercent: 96, state: "online",
      type: "rw", junction: "/vol_projects", snapshotPolicy: "default", nfs: true,
      perf: profile(640, 380, 900, 7500, 1900, 140, 81 * MIB, 46 * MIB),
    },
    {
      name: "vol_db", svm: "svm_san", aggregate: "aggr1_n01", size: 8 * TIB, usedPercent: 71, state: "online",
      type: "rw", snapshotPolicy: "default",
      perf: profile(2400, 1600, 120, 900, 620, 90, 150 * MIB, 98 * MIB),
    },
    {
      name: "vol_logs", svm: "svm_nas", aggregate: "aggr1_n02", size: 2 * TIB, state: "offline",
      type: "rw", junction: "/vol_logs", snapshotPolicy: "default", nfs: true,
      perf: profile(12, 30, 40, 260, 340, 95, 400 * KIB, 1200 * KIB),
    },
    {
      name: "vol_web_dr", svm: "svm_dr", aggregate: "aggr1_n02", size: 2 * TIB, usedPercent: 40, state: "online",
      type: "dp", junction: "/vol_web_dr", snapshotPolicy: "none",
      perf: profile(35, 160, 60, 280, 450, 120, 2 * MIB, 11 * MIB),
    },
    {
      name: "vol_erp_dr", svm: "svm_dr", aggregate: "aggr1_n02", size: 4 * TIB, usedPercent: 55, state: "online",
      type: "dp", junction: "/vol_erp_dr", snapshotPolicy: "none",
      perf: profile(20, 25, 45, 300, 520, 130, 1 * MIB, 2 * MIB),
    },
    {
      name: "vol_home_dr", svm: "svm_dr", aggregate: "aggr1_n02", size: 10 * TIB, usedPercent: 63, state: "online",
      type: "dp", junction: "/vol_home_dr", snapshotPolicy: "none",
      perf: profile(30, 210, 70, 310, 470, 115, 2 * MIB, 14 * MIB),
    },
    {
      name: "svm_nas_root", svm: "svm_nas", aggregate: "aggr1_n01", size: 1 * GIB, usedPercent: 5, state: "online",
      type: "rw", junction: "/", snapshotPolicy: "default", svmRoot: true, nfs: true,
      perf: profile(15, 2, 60, 180, 240, 60, 60 * KIB, 8 * KIB),
    },
    // The nodes' root volumes: the private CLI lists them, the public API does
    // not, and Harvest leaves them out.
    { name: "vol0", svm: nodeNames[0], aggregate: "aggr0_n01", size: 151 * GIB, usedPercent: 12, state: "online", type: "rw", nodeRoot: true, perf: IDLE },
    { name: "vol0", svm: nodeNames[1], aggregate: "aggr0_n02", size: 226 * GIB, usedPercent: 9, state: "online", type: "rw", nodeRoot: true, perf: IDLE },
  ];

  const luns = [
    {
      name: "lun_db01", volume: "vol_db", svm: "svm_san", size: 2 * TIB, usedPercent: 55, state: "online",
      perf: profile(2300, 1500, 80, 870, 600, 70, 144 * MIB, 92 * MIB),
    },
    { name: "lun_db02", volume: "vol_db", svm: "svm_san", size: 1 * TIB, usedPercent: 0, state: "offline", perf: IDLE },
  ];

  // Twelve SSDs in shelf 1.0, owned alternately by the two nodes. 1.0.7 has
  // failed and 1.0.11 is the spare.
  const disks = [];
  for (let bay = 0; bay < 12; bay++) {
    const name = `1.0.${bay}`;
    const owner = nodeNames[bay % 2 === 1 ? 0 : 1];
    const container = bay === 7 ? "broken" : bay === 11 ? "spare" : "shared";
    disks.push({
      name,
      bay,
      owner,
      container,
      uid: `5002538B:0${hexFor(`disk-${name}`, 7)}:00000000:00000000:00000000:00000000:00000000:00000000:00000000:00000000`,
      serial: `S5B2NA0R1001${String(bay).padStart(2, "0")}`,
      ops: container === "shared" ? 950 + bay * 23 : 0,
    });
  }

  const shelf = {
    name: "1.0",
    id: "0",
    uid: "12660157823845126081",
    serial: "SHFMS2140000123",
    model: "NS224",
    moduleType: "nsm100",
    state: "ok",
    opStatus: "normal",
    diskCount: 12,
    fans: [
      { id: 1, rpm: 3020, state: "ok", location: "rear of the shelf on the lower left power supply" },
      { id: 2, rpm: 3010, state: "ok", location: "rear of the shelf on the lower left power supply" },
      { id: 3, rpm: 2990, state: "ok", location: "rear of the shelf on the lower right power supply" },
      { id: 4, rpm: 3030, state: "ok", location: "rear of the shelf on the lower right power supply" },
    ],
    psus: [
      { id: 1, state: "ok", installed: true, serial: "PSD094190000501", powerDrawn: 214, powerRating: 1600 },
      { id: 2, state: "error", installed: true, serial: "PSD094190000502", powerDrawn: 0, powerRating: 1600 },
    ],
    modules: [
      { id: "A", state: "ok", serial: "8001922304", firmware: "0300" },
      { id: "B", state: "ok", serial: "8001922305", firmware: "0300" },
    ],
    temperatures: [
      { id: 1, temperature: 23, ambient: true, location: "front of the shelf" },
      { id: 2, temperature: 31, ambient: false, location: "NSM A" },
      { id: 3, temperature: 32, ambient: false, location: "NSM B" },
      { id: 4, temperature: 29, ambient: false, location: "lower left power supply" },
    ],
    voltages: [{ id: 1, voltage: 12.18, location: "rear of the shelf on the lower left power supply" }],
    currents: [{ id: 1, current: 7650, location: "rear of the shelf on the lower left power supply" }],
    error: { type: "power", severity: "error", text: "Power supply 2 failed" },
  };

  const sensorsFor = (node, index, fanTwo) => [
    { node, index: index + 1, name: "Ambient Temp", type: "thermal", value: 23, units: "C", crit: [0, 42], warn: [5, 40] },
    { node, index: index + 2, name: "CPU0 Temp", type: "thermal", value: 52, units: "C", crit: [0, 95], warn: [5, 90] },
    { node, index: index + 3, name: "CPU1 Temp", type: "thermal", value: 49, units: "C", crit: [0, 95], warn: [5, 90] },
    { node, index: index + 4, name: "PSU1 Temp", type: "thermal", value: 31, units: "C", crit: [0, 70], warn: [5, 65] },
    { node, index: index + 5, name: "PSU2 Temp", type: "thermal", value: 30, units: "C", crit: [0, 70], warn: [5, 65] },
    { node, index: index + 6, name: "Bat Volt", type: "voltage", value: 8100, units: "mV", crit: [5800, 9400], warn: [6200, 9200] },
    { node, index: index + 7, name: "PSU1 In Pwr", type: "unknown", value: 221, units: "W" },
    { node, index: index + 8, name: "PSU2 In Pwr", type: "unknown", value: 214, units: "W" },
    { node, index: index + 9, name: "System Fan 1", type: "fan", value: 7350, units: "RPM", crit: [2000, 13000], warn: [2500, 12500] },
    { node, index: index + 10, name: "System Fan 2", type: "fan", ...fanTwo, units: "RPM", crit: [2000, 13000], warn: [2500, 12500] },
  ];
  const sensors = [
    ...sensorsFor(nodeNames[0], 0, { value: 7280, state: "normal" }),
    // ONTAP's REST API spells the state crit_low (the CLI: crit-low).
    ...sensorsFor(nodeNames[1], 0, { value: 1200, state: "crit_low" }),
  ];

  const ethernetPorts = [
    { node: nodeNames[0], name: "e0a", speed: 25000, state: "up", role: "data", rx: 118 * MIB, tx: 76 * MIB, kind: "nic_ixl" },
    { node: nodeNames[0], name: "e0b", speed: 25000, state: "up", role: "data", rx: 96 * MIB, tx: 61 * MIB, kind: "nic_ixl" },
    { node: nodeNames[0], name: "e0c", state: "down", role: "data", rx: 0, tx: 0, kind: "nic_ixl" },
    { node: nodeNames[0], name: "e0M", speed: 1000, state: "up", role: "node-mgmt", mtu: 1500, rx: 48 * KIB, tx: 31 * KIB, kind: "nic_igb" },
    { node: nodeNames[1], name: "e0a", speed: 25000, state: "up", role: "data", rx: 131 * MIB, tx: 88 * MIB, kind: "nic_ixl" },
    { node: nodeNames[1], name: "e0b", speed: 25000, state: "up", role: "data", rx: 102 * MIB, tx: 70 * MIB, kind: "nic_ixl" },
    { node: nodeNames[1], name: "e0M", speed: 1000, state: "up", role: "node-mgmt", mtu: 1500, rx: 51 * KIB, tx: 35 * KIB, kind: "nic_igb" },
  ];

  const fcPorts = [
    { node: nodeNames[0], name: "0c", ops: 1000, linkFailuresPer30s: 0 },
    { node: nodeNames[0], name: "0d", ops: 950, linkFailuresPer30s: 1 },
    { node: nodeNames[1], name: "0c", ops: 980, linkFailuresPer30s: 0 },
    { node: nodeNames[1], name: "0d", ops: 970, linkFailuresPer30s: 0 },
  ];

  const lifs = [
    { name: "cluster_mgmt", svm: "ontap-prod-01", node: nodeNames[0], port: "e0M", ip: "192.0.2.10" },
    { name: `${nodeNames[0]}_mgmt1`, svm: "ontap-prod-01", node: nodeNames[0], port: "e0M", ip: "192.0.2.11" },
    { name: `${nodeNames[1]}_mgmt1`, svm: "ontap-prod-01", node: nodeNames[1], port: "e0M", ip: "192.0.2.12" },
    { name: `${nodeNames[0]}_ic1`, svm: "ontap-prod-01", node: nodeNames[0], port: "e0b", ip: "198.51.100.11" },
    { name: `${nodeNames[1]}_ic1`, svm: "ontap-prod-01", node: nodeNames[1], port: "e0b", ip: "198.51.100.12" },
    { name: "svm_nas_lif1", svm: "svm_nas", node: nodeNames[0], port: "e0a", ip: "198.51.100.21", nfs: true },
    { name: "svm_nas_lif2", svm: "svm_nas", node: nodeNames[1], port: "e0a", ip: "198.51.100.22", nfs: true },
    { name: "svm_san_iscsi1", svm: "svm_san", node: nodeNames[0], port: "e0b", ip: "198.51.100.31" },
    { name: "svm_san_iscsi2", svm: "svm_san", node: nodeNames[1], port: "e0b", ip: "198.51.100.32" },
    { name: "svm_dr_lif1", svm: "svm_dr", node: nodeNames[1], port: "e0a", ip: "198.51.100.41", nfs: true },
  ];

  const remote = { name: "ontap-edge-01", uuid: "4d6f7a20-5c11-11ef-8a2b-00a098e3b1c4" };
  const snapmirrors = [
    {
      destination: "svm_dr:vol_web_dr", destinationVolume: "vol_web_dr", destinationSvm: "svm_dr",
      sourceCluster: remote.name, sourceSvm: "svm_web", sourceVolume: "vol_web",
      policyType: "async_mirror", policy: "MirrorAllSnapshots", schedule: "hourly", lag: 25 * 60 + 12,
      healthy: true, lastTransferSize: 3.4 * GIB, lastTransferDuration: 74,
    },
    {
      destination: "svm_dr:vol_erp_dr", destinationVolume: "vol_erp_dr", destinationSvm: "svm_dr",
      sourceCluster: remote.name, sourceSvm: "svm_erp", sourceVolume: "vol_erp",
      policyType: "async_mirror", policy: "MirrorAllSnapshots", schedule: "hourly", lag: 3 * 3600 + 10 * 60 + 4,
      healthy: false, unhealthyReason: "Transfer failed.", lastTransferSize: 1.2 * GIB, lastTransferDuration: 51,
      failedUpdates: 3,
    },
    {
      destination: "svm_dr:vol_home_dr", destinationVolume: "vol_home_dr", destinationSvm: "svm_dr",
      sourceSvm: "svm_nas", sourceVolume: "vol_home",
      policyType: "async_mirror", policy: "MirrorAllSnapshots", schedule: "daily", lag: 6 * 3600 + 2 * 60 + 41,
      healthy: true, lastTransferSize: 61 * GIB, lastTransferDuration: 1260,
    },
    {
      // svm_san on ontap-edge-01 is peered as svm_san_edge: this cluster has an
      // svm_san of its own, and ONTAP needs a local name for the peer then.
      destination: "svm_dr:vol_db_sync", destinationVolume: "vol_db_sync", destinationSvm: "svm_dr",
      sourceCluster: remote.name, sourceSvm: "svm_san_edge", sourceVolume: "vol_db",
      policyType: "sync_mirror", policy: "Sync", lag: 0, status: "in_sync",
      healthy: true, lastTransferSize: 0, lastTransferDuration: 0,
    },
  ];
  const svmPeers = [
    { name: "svm_web", svm: "svm_dr", peerSvm: "svm_web", peerCluster: remote.name },
    { name: "svm_erp", svm: "svm_dr", peerSvm: "svm_erp", peerCluster: remote.name },
    { name: "svm_san_edge", svm: "svm_dr", peerSvm: "svm_san", peerCluster: remote.name },
    { name: "svm_nas", svm: "svm_dr", peerSvm: "svm_nas", peerCluster: cluster.name },
  ];

  const supportAlerts = [
    {
      node: nodeNames[1],
      monitor: "node-connect",
      name: "DualPathToDiskShelf_Alert",
      resource: "Shelf ID 1.0",
      cause: "Disk shelf 1.0 does not have two paths to controller ontap-prod-01-02.",
      correctiveAction: "Connect the disk shelf to the controller through a second path.",
      possibleEffect: "Access to disk shelf 1.0 via controller ontap-prod-01-02 will be lost with a single hardware component failure (e.g. cable, HBA, or IOM failure).",
      raisedAt: START_S - 2 * 86400 - 3 * 3600,
    },
  ];

  const ems = [
    {
      at: 0,
      node: nodeNames[0],
      index: 81234501,
      name: "disk.outOfService",
      severity: "notice",
      source: "config_thread",
      parameters: [
        ["diskName", "1.0.7"],
        ["powerOnHours", "2883"],
        ["glistEntries", "0"],
        ["serialno", "S5B2NA0R100107"],
        ["reason", "Failed"],
        ["disk_information", "Disk 1.0.7 Shelf 0 Bay 7 [NETAPP   X4011WBORA3T8NTF NA02] S/N [S5B2NA0R100107] UID [5002538B:0..]"],
      ],
      logMessage:
        "disk.outOfService: Drive 1.0.7 (S5B2NA0R100107): Failed. Power-On Hours: 2883, GList Count: 0, Drive Info: Disk 1.0.7 Shelf 0 Bay 7 [NETAPP   X4011WBORA3T8NTF NA02] S/N [S5B2NA0R100107] UID [5002538B:0..].",
    },
    {
      at: 0,
      node: nodeNames[1],
      index: 79310044,
      name: "monitor.fan.failed",
      severity: "alert",
      source: "monitor",
      parameters: [["report", "System Fan 2"]],
      logMessage: "monitor.fan.failed: System Fan 2",
    },
    {
      at: 300,
      node: nodeNames[1],
      index: 79310057,
      name: "monitor.fan.ok",
      severity: "notice",
      source: "monitor",
      parameters: [["report", "System Fan 2"]],
      logMessage: "monitor.fan.ok: System Fan 2",
    },
  ];

  const subsystems = [
    "sas_connect", "environment", "memory", "service_processor", "switch_health", "cifs_ndo", "motherboard",
    "io", "metrocluster", "metrocluster_node", "fhm_switch", "fhm_bridge", "sas_connect_cluster",
  ];

  const licenses = ["base", "nfs", "cifs", "iscsi", "fcp", "snapmirror", "snapmirror_sync", "flexclone", "snaprestore", "snapvault", "multi_tenant_encryption_key_management"];

  return {
    cluster, nodes, svms, aggregates, volumes, luns, disks, shelves: [shelf], sensors, ethernetPorts, fcPorts,
    lifs, snapmirrors, svmPeers, clusterPeers: [remote], supportAlerts, ems, subsystems, licenses,
    forbidden: new Set(),
  };
}

function fsxScenario() {
  const id = "FsxId0a1b2c3d4e5f6a7b8";
  const nodeNames = [`${id}-01`, `${id}-02`];
  const cluster = {
    name: id,
    uuid: "c3e9f1d2-7a40-11ef-b1c6-0a1b2c3d4e5f",
    serial: "1-80-000011",
    release: "NetApp Release 9.15.1P7: Wed Oct 09 17:52:11 UTC 2024",
    version: [9, 15, 1],
    location: "",
    contact: "",
    managementIp: "10.0.1.10",
    dnsDomains: [],
    nameServers: [],
    ntpServers: ["169.254.169.123"],
    sanOptimized: false,
  };
  const nodes = nodeNames.map((name, i) => ({
    name,
    serial: `0000000000000${i + 1}`,
    systemId: `000000000${i + 1}`,
    model: "FSx",
    partner: nodeNames[1 - i],
    cpuBusy: i === 0 ? 0.18 : 0.11,
    failedFans: 0,
    failedFanMessage: "There are no failed fans.",
    failedFanCode: "111411208",
    managementIp: `10.0.1.1${i + 1}`,
  }));
  const svms = [
    { name: id, type: "admin" },
    { name: nodeNames[0], type: "node" },
    { name: nodeNames[1], type: "node" },
    { name: "fsx", type: "data", state: "running", nfs: true, cifs: false, rootVolume: "fsx_root", aggregate: "aggr1" },
    { name: "svm_files", type: "data", state: "running", nfs: true, cifs: true, rootVolume: "svm_files_root", aggregate: "aggr1" },
  ];
  const aggregates = [
    {
      name: "aggr1", node: nodeNames[0], size: 2 * TIB, usedPercent: 40, reductionRatio: 1.4, volumeCount: 3,
      diskCount: 8, root: false, profileOf: ["fsx_root", "vol_files", "vol_backup"],
    },
  ];
  const volumes = [
    {
      name: "fsx_root", svm: "fsx", aggregate: "aggr1", size: 1 * GIB, usedPercent: 4, state: "online", type: "rw",
      junction: "/", snapshotPolicy: "default", svmRoot: true, nfs: true,
      perf: profile(4, 1, 25, 210, 300, 70, 20 * KIB, 4 * KIB),
    },
    {
      name: "vol_files", svm: "svm_files", aggregate: "aggr1", size: 512 * GIB, usedPercent: 58, state: "online", type: "rw",
      junction: "/vol_files", snapshotPolicy: "default", nfs: true,
      perf: profile(420, 160, 610, 480, 690, 150, 26 * MIB, 9 * MIB),
    },
    {
      name: "vol_backup", svm: "fsx", aggregate: "aggr1", size: 1 * TIB, usedPercent: 20, state: "online", type: "rw",
      junction: "/vol_backup", snapshotPolicy: "default", nfs: true,
      perf: profile(15, 240, 30, 350, 820, 120, 1 * MIB, 31 * MIB),
    },
  ];
  const ethernetPorts = [
    { node: nodeNames[0], name: "e0e", speed: 10000, state: "up", role: "data", rx: 33 * MIB, tx: 12 * MIB, kind: "nic_ena" },
    { node: nodeNames[1], name: "e0e", speed: 10000, state: "up", role: "data", rx: 2 * MIB, tx: 1 * MIB, kind: "nic_ena" },
  ];
  const lifs = [
    { name: "fsx-mgmt", svm: id, node: nodeNames[0], port: "e0e", ip: "10.0.1.10" },
    { name: "nfs_smb_management_1", svm: "fsx", node: nodeNames[0], port: "e0e", ip: "10.0.1.31", nfs: true },
    { name: "nfs_smb_management_1", svm: "svm_files", node: nodeNames[0], port: "e0e", ip: "10.0.1.41", nfs: true },
  ];
  return {
    cluster, nodes, svms, aggregates, volumes, luns: [], disks: [], shelves: [], sensors: [], ethernetPorts,
    fcPorts: [], lifs, snapmirrors: [], svmPeers: [], clusterPeers: [], supportAlerts: [], ems: [],
    subsystems: ["sas_connect", "environment", "memory", "service_processor", "switch_health", "cifs_ndo", "motherboard", "io"],
    licenses: ["base", "nfs", "cifs", "iscsi", "snapmirror", "flexclone", "snaprestore"],
    // What Amazon does not let fsxadmin read answers ONTAP's permission-denied
    // error. A stand-in for whatever FSx really answers there.
    forbidden: new Set([
      "api/storage/disks",
      "api/private/cli/disk",
      "api/storage/shelves",
      "api/private/cli/storage/shelf",
      "api/cluster/sensors",
      "api/private/cli/system/chassis/fru",
      "api/private/cli/system/node/power",
      "api/network/fc/ports",
      "api/private/support/alerts",
      "api/cluster/counter/tables/disk:constituent",
      "api/cluster/counter/tables/disk:constituent/rows",
    ]),
  };
}

const S = SCENARIO === "fsx" ? fsxScenario() : ontapScenario();

// Derived lookups.
const nodeUuid = (name) => uuidFor(`node-${name}`);
const svmUuid = (name) => uuidFor(`svm-${name}`);
const aggrUuid = (name) => uuidFor(`aggr-${name}`);
const volUuid = (svm, name) => uuidFor(`vol-${svm}-${name}`);
const aggrOf = (name) => S.aggregates.find((a) => a.name === name);
const nodeRef = (name) => ({ uuid: nodeUuid(name), name, _links: link(`/api/cluster/nodes/${nodeUuid(name)}`) });
const svmRef = (name) => ({ uuid: svmUuid(name), name, _links: link(`/api/svm/svms/${svmUuid(name)}`) });
const aggrRef = (name) => ({ uuid: aggrUuid(name), name, _links: link(`/api/storage/aggregates/${aggrUuid(name)}`) });
const publicVolumes = () => S.volumes.filter((v) => !v.nodeRoot);
const volumeByName = (name) => S.volumes.find((v) => v.name === name && !v.nodeRoot);
const clusterProfile = () => sumProfiles(publicVolumes().map((v) => v.perf));

// ---- Volume space ----------------------------------------------------------

function volumeSpace(v) {
  const reservePercent = v.type === "dp" || v.nodeRoot ? 0 : 5;
  const reserve = Math.floor((v.size * reservePercent) / 100);
  const total = v.size - reserve;
  const used = Math.floor((total * (v.usedPercent || 0)) / 100);
  const available = total - used;
  const snapshotUsed = Math.floor(reserve * 0.6);
  const logicalUsed = Math.floor(used * 1.9);
  const dedupe = Math.floor(used * 0.42);
  const compress = Math.floor(used * 0.21);
  return {
    reservePercent, reserve, total, used, available, snapshotUsed, logicalUsed, dedupe, compress,
    files: Math.max(31122, Math.floor(v.size / (32 * KIB))),
    filesUsed: Math.floor((v.size / (32 * KIB)) * ((v.usedPercent || 0) / 100) * 0.35) + 101,
  };
}

// ---- Endpoints -------------------------------------------------------------
// Each returns { records, keys } for a collection, or { object } for one.

function clusterObject(t) {
  const c = S.cluster;
  const p = clusterProfile();
  const out = {
    name: c.name,
    uuid: c.uuid,
    location: c.location,
    contact: c.contact,
    version: { full: c.release, generation: c.version[0], major: c.version[1], minor: c.version[2] },
    dns_domains: c.dnsDomains,
    name_servers: c.nameServers,
    ntp_servers: c.ntpServers,
    management_interfaces: [
      { uuid: uuidFor("lif-cluster-mgmt"), name: "cluster_mgmt", ip: { address: c.managementIp }, _links: link(`/api/network/ip/interfaces/${uuidFor("lif-cluster-mgmt")}`) },
    ],
    metric: metricBlock(p, t),
    statistics: statisticsBlock(p, t),
    timezone: { name: "Etc/UTC" },
    certificate: { uuid: uuidFor("cluster-certificate"), _links: link(`/api/security/certificates/${uuidFor("cluster-certificate")}`) },
    san_optimized: c.sanOptimized,
    health: "ok",
    peering_policy: { minimum_passphrase_length: 8, authentication_required: true, encryption_required: true },
    _links: link("/api/cluster"),
  };
  if (c.disaggregated !== undefined) {
    out.disaggregated = c.disaggregated;
  }
  return out;
}

function nodeRecords(t) {
  return S.nodes.map((n, i) => {
    const base = grown(1000000, Math.floor(t));
    return {
      uuid: nodeUuid(n.name),
      name: n.name,
      serial_number: n.serial,
      location: S.cluster.location,
      model: n.model,
      system_id: n.systemId,
      vendor_serial_number: n.serial,
      version: { full: S.cluster.release, generation: S.cluster.version[0], major: S.cluster.version[1], minor: S.cluster.version[2] },
      date: isoOffset(t),
      uptime: Math.floor(t - BOOT_S),
      state: "up",
      membership: "available",
      management_interfaces: [
        { uuid: uuidFor(`lif-${n.name}-mgmt`), name: `${n.name}_mgmt1`, ip: { address: n.managementIp } },
      ],
      controller: {
        board: SCENARIO === "fsx" ? "FSx" : "System Board XXVIII",
        memory_size: SCENARIO === "fsx" ? 34359738368 : 137438953472,
        over_temperature: "normal",
        failed_fan: { count: n.failedFans, message: { message: n.failedFanMessage, code: n.failedFanCode } },
        failed_power_supply: { count: 0, message: { message: "There are no failed power supplies.", code: "111411206" } },
        cpu: { firmware_release: SCENARIO === "fsx" ? "" : "12.14", processor: "Intel(R) Xeon(R) Silver 4210 CPU @ 2.20GHz", count: 20 },
      },
      ha: {
        enabled: true,
        auto_giveback: true,
        partners: [{ uuid: nodeUuid(n.partner), name: n.partner, _links: link(`/api/cluster/nodes/${nodeUuid(n.partner)}`) }],
        giveback: { state: "nothing_to_giveback" },
        takeover: { state: "not_attempted" },
        interconnect: { adapter: "MVIA-RDMA", state: "up" },
      },
      service_processor: SCENARIO === "fsx"
        ? { state: "unknown" }
        : { firmware_version: "12.14", state: "online", type: "bmc", ipv4_interface: { address: n.spIp, netmask: "255.255.255.0" } },
      nvram: { battery_state: "battery_ok", id: 4082368508 + i },
      statistics: {
        timestamp: isoZulu(t),
        status: "ok",
        processor_utilization_raw: Math.round(base * n.cpuBusy),
        processor_utilization_base: base,
      },
      _links: link(`/api/cluster/nodes/${nodeUuid(n.name)}`),
    };
  });
}

function privateNodeRecords(t) {
  return S.nodes.map((n) => ({
    node: n.name,
    health: true,
    eligibility: true,
    max_aggr_size: SCENARIO === "fsx" ? "192TB" : "800TB",
    max_node_vvols: 1000,
    max_vol_size: SCENARIO === "fsx" ? "300TB" : "300TB",
    vendor: SCENARIO === "fsx" ? "Amazon" : "NetApp",
    cpu_busy_time: Math.round((t - BOOT_S) * n.cpuBusy),
    model: n.model,
    serialnumber: n.serial,
    uptime: Math.floor(t - BOOT_S),
  }));
}

function aggregateSpace(a) {
  const used = Math.floor((a.size * a.usedPercent) / 100);
  const physical = Math.floor(used * 0.92);
  const ratio = a.reductionRatio || 1;
  const logicalWithout = Math.floor(physical * ratio);
  const logicalWith = Math.floor(logicalWithout * 1.55);
  return { used, available: a.size - used, physical, logicalWithout, logicalWith };
}

function aggregateRecords(t) {
  return S.aggregates
    .filter((a) => !a.root)
    .map((a) => {
      const s = aggregateSpace(a);
      const perf = sumProfiles((a.profileOf || []).map((name) => volumeByName(name).perf));
      return {
        uuid: aggrUuid(a.name),
        name: a.name,
        node: nodeRef(a.node),
        home_node: nodeRef(a.node),
        state: "online",
        snaplock_type: "non_snaplock",
        create_time: "2023-06-14T09:12:40+00:00",
        data_encryption: { software_encryption_enabled: false, drive_protection_enabled: false },
        block_storage: {
          primary: {
            disk_count: a.diskCount,
            disk_class: "solid_state",
            raid_type: "raid_dp",
            raid_size: 24,
            checksum_style: "block",
            disk_type: "ssd",
          },
          hybrid_cache: { enabled: false },
          mirror: { enabled: false, state: "unmirrored" },
          plexes: [{ name: "plex0" }],
          uses_partitions: true,
        },
        cloud_storage: { attach_eligible: false },
        inode_attributes: {
          files_total: 31250000,
          files_used: 412000,
          max_files_available: 31250000,
          max_files_possible: 2147483647,
          max_files_used: 418000,
          used_percent: 1,
          file_private_capacity: 31250000,
          file_public_capacity: 31250000,
          files_private_used: 1520,
          version: 4,
        },
        volume_count: a.volumeCount,
        space: {
          block_storage: {
            size: a.size,
            available: s.available,
            used: s.used,
            used_percent: a.usedPercent,
            full_threshold_percent: 98,
            physical_used: s.physical,
            physical_used_percent: Math.round((s.physical * 100) / a.size),
            aggregate_metadata: Math.floor(a.size * 0.004),
            aggregate_metadata_percent: 0,
            used_including_snapshot_reserve: s.used,
            used_including_snapshot_reserve_percent: a.usedPercent,
            data_compacted_count: Math.floor(s.used * 0.09),
            data_compaction_space_saved: Math.floor(s.used * 0.06),
            data_compaction_space_saved_percent: 6,
            volume_deduplication_shared_count: Math.floor(s.used * 0.11),
            volume_deduplication_space_saved: Math.floor(s.used * 0.14),
            volume_deduplication_space_saved_percent: 12,
            inactive_user_data: Math.floor(s.used * 0.31),
            inactive_user_data_percent: 31,
          },
          cloud_storage: { used: 0 },
          efficiency: {
            savings: s.logicalWith - s.physical,
            ratio: Number((s.logicalWith / s.physical).toFixed(6)),
            logical_used: s.logicalWith,
          },
          efficiency_without_snapshots: {
            savings: s.logicalWithout - s.physical,
            ratio: Number((s.logicalWithout / s.physical).toFixed(6)),
            logical_used: s.logicalWithout,
          },
          efficiency_without_snapshots_flexclones: {
            savings: s.logicalWithout - s.physical,
            ratio: Number((s.logicalWithout / s.physical).toFixed(6)),
            logical_used: s.logicalWithout,
          },
          footprint: s.used,
          footprint_percent: a.usedPercent,
          snapshot: { used_percent: 0, available: 0, total: 0, used: 0, reserve_percent: 0 },
        },
        snapshot: { files_total: 0, files_used: 0, max_files_available: 0, max_files_used: 0 },
        metric: metricBlock(perf, t),
        statistics: statisticsBlock(perf, t),
        _links: link(`/api/storage/aggregates/${aggrUuid(a.name)}`),
      };
    });
}

function privateAggrRecords() {
  return S.aggregates.map((a) => {
    const s = aggregateSpace(a);
    return {
      aggregate: a.name,
      uuid: aggrUuid(a.name),
      home_name: a.node,
      node: a.node,
      raidtype: "raid_dp",
      root: a.root,
      state: "online",
      size: a.size,
      usedsize: s.used,
      availsize: s.available,
      percent_used: a.usedPercent,
      physical_used: s.physical,
      physical_used_percent: Math.round((s.physical * 100) / a.size),
      diskcount: a.diskCount,
      maxraidsize: 24,
      percent_snapshot_space: 0,
      volcount: a.volumeCount,
      encrypt_with_aggr_key: false,
      composite: false,
      composite_capacity_tier_used: 0,
      uses_shared_disks: true,
      storage_type: "ssd",
      hybrid_cache_size_total: 0,
      data_compacted_count: Math.floor(s.used * 0.09),
      data_compaction_space_saved: Math.floor(s.used * 0.06),
      data_compaction_space_saved_percent: 6,
      sis_shared_count: Math.floor(s.used * 0.11),
      sis_space_saved: Math.floor(s.used * 0.14),
      sis_space_saved_percent: 12,
    };
  });
}

// aggr show-space: no FabricPool, so only the performance tier's rows, whose
// tier name is blank (Harvest's own filter drops them).
function aggrShowSpaceRecords() {
  return S.aggregates.map((a) => ({
    aggregate_name: a.name,
    bin_num: 0,
    tier_name: "",
    volume_footprints: aggregateSpace(a).used,
    aggregate_used: aggregateSpace(a).used,
  }));
}

function privateVserverRecords() {
  return S.svms.map((v) => {
    const r = { vserver: v.name, type: v.type, uuid: svmUuid(v.name) };
    if (v.type === "data") {
      r.subtype = "default";
      r.admin_state = v.state;
      r.operational_state = v.state;
      r.rootvolume = v.rootVolume;
      r.aggregate = v.aggregate;
      r.anti_ransomware_default_volume_state = "disabled";
      r.is_space_enforcement_logical = false;
      r.is_space_reporting_logical = false;
      r.language = "c.utf_8";
    }
    return r;
  });
}

const dataSvms = () => S.svms.filter((v) => v.type === "data");

function svmRecords() {
  return dataSvms().map((v) => ({
    uuid: svmUuid(v.name),
    name: v.name,
    subtype: "default",
    language: "c.utf_8",
    state: v.state,
    ipspace: { name: "Default" },
    snapshot_policy: { name: "default" },
    aggregates: [aggrRef(v.aggregate)],
    nfs: { enabled: Boolean(v.nfs) },
    cifs: { enabled: Boolean(v.cifs) },
    iscsi: { enabled: Boolean(v.iscsi) },
    fcp: { enabled: Boolean(v.fcp) },
    nvme: { enabled: false },
    nsswitch: { hosts: ["files", "dns"], group: ["files"], passwd: ["files"], netgroup: ["files"], namemap: ["files"] },
    _links: link(`/api/svm/svms/${svmUuid(v.name)}`),
  }));
}

function sshSvmRecords() {
  return dataSvms().map((v) => ({
    svm: svmRef(v.name),
    ciphers: ["aes256_ctr", "aes192_ctr", "aes128_ctr", "aes256_gcm", "aes128_gcm"],
    key_exchange_algorithms: ["diffie_hellman_group_exchange_sha256", "ecdh_sha2_nistp256", "ecdh_sha2_nistp384", "ecdh_sha2_nistp521"],
    mac_algorithms: ["hmac_sha2_256", "hmac_sha2_512"],
    max_authentication_retry_count: 4,
    _links: link(`/api/security/ssh/svms/${svmUuid(v.name)}`),
  }));
}

function cifsServiceRecords() {
  return dataSvms()
    .filter((v) => v.cifs)
    .map((v) => ({
      svm: svmRef(v.name),
      name: v.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15),
      enabled: true,
      ad_domain: { fqdn: "CORP.EXAMPLE.COM", organizational_unit: "CN=Computers" },
      security: { smb_encryption: false, smb_signing: false, restrict_anonymous: "no_enumeration", lm_compatibility_level: "lm_ntlm_ntlmv2_krb" },
      _links: link(`/api/protocols/cifs/services/${svmUuid(v.name)}`),
    }));
}

function cifsSecurityRecords() {
  return dataSvms()
    .filter((v) => v.cifs)
    .map((v) => ({ vserver: v.name, lm_compatibility_level: "lm-ntlm-ntlmv2-krb", is_signing_required: false, is_smb_encryption_required: false }));
}

function kerberosInterfaceRecords() {
  return S.lifs
    .filter((l) => l.nfs)
    .map((l) => ({
      interface: { uuid: uuidFor(`lif-${l.svm}-${l.name}`), name: l.name, ip: { address: l.ip } },
      svm: svmRef(l.svm),
      enabled: false,
      _links: link(`/api/protocols/nfs/kerberos/interfaces/${uuidFor(`lif-${l.svm}-${l.name}`)}`),
    }));
}

function iscsiServiceRecords() {
  return dataSvms()
    .filter((v) => v.iscsi)
    .map((v) => ({
      svm: svmRef(v.name),
      enabled: true,
      target: { name: `iqn.1992-08.com.netapp:sn.${hexFor(`iqn-${v.name}`, 32).toLowerCase()}:vs.4`, alias: v.name },
      _links: link(`/api/protocols/san/iscsi/services/${svmUuid(v.name)}`),
    }));
}

function iscsiCredentialRecords() {
  return dataSvms()
    .filter((v) => v.iscsi)
    .map((v) => ({
      svm: svmRef(v.name),
      initiator: "default",
      authentication_type: "none",
      initiator_address: { ranges: [] },
      _links: link(`/api/protocols/san/iscsi/credentials/${svmUuid(v.name)}/default`),
    }));
}

function nodeOfAggregate(name) {
  return aggrOf(name).node;
}

function privateVolumeRecords() {
  return S.volumes.map((v) => {
    const r = {
      vserver: v.svm,
      volume: v.name,
      aggr_list: [v.aggregate],
      nodes: [nodeOfAggregate(v.aggregate)],
      instance_uuid: v.nodeRoot ? uuidFor(`vol0-${v.svm}`) : volUuid(v.svm, v.name),
      state: v.state,
      type: v.type.toUpperCase(),
      volume_style_extended: "flexvol",
      is_constituent: false,
      vsroot: Boolean(v.svmRoot),
      size: v.size,
      snapshot_policy: v.snapshotPolicy || "none",
      tiering_policy: "none",
      snaplock_type: "non_snaplock",
      clone_volume: false,
      is_encrypted: false,
      autosize_mode: v.type === "dp" ? "grow_shrink" : "off",
      space_mgmt_try_first: "volume_grow",
      is_space_enforcement_logical: false,
      is_space_reporting_logical: false,
    };
    if (v.junction && v.state === "online") {
      r.junction_path = v.junction;
    }
    if (v.state !== "online") {
      return r;
    }
    const s = volumeSpace(v);
    Object.assign(r, {
      is_sis_volume: !v.nodeRoot,
      autosize_grow_threshold_percent: v.type === "dp" ? 98 : 85,
      autosize_shrink_threshold_percent: v.type === "dp" ? 70 : 50,
      max_autosize: Math.floor(v.size * 1.2),
      min_autosize: v.size,
      available: s.available,
      total: s.total,
      used: s.used,
      percent_used: v.usedPercent,
      expected_available: s.available,
      filesystem_size: v.size,
      files: s.files,
      files_used: s.filesUsed,
      logical_available: s.available,
      logical_used: s.logicalUsed,
      logical_used_by_afs: s.logicalUsed,
      logical_used_by_snapshots: Math.floor(s.snapshotUsed * 1.3),
      logical_used_percent: Math.min(99, Math.round((s.logicalUsed * 100) / v.size)),
      compression_space_saved: v.nodeRoot ? 0 : s.compress,
      compression_space_saved_percent: v.nodeRoot ? 0 : 11,
      dedupe_space_saved: v.nodeRoot ? 0 : s.dedupe,
      dedupe_space_saved_percent: v.nodeRoot ? 0 : 21,
      sis_space_saved: v.nodeRoot ? 0 : s.dedupe + s.compress,
      sis_space_saved_percent: v.nodeRoot ? 0 : 32,
      overwrite_reserve: 0,
      overwrite_reserve_used: 0,
      percent_snapshot_space: s.reservePercent,
      performance_tier_inactive_user_data: Math.floor(s.used * 0.28),
      performance_tier_inactive_user_data_percent: 28,
      size_available_for_snapshots: s.available + (s.reserve - s.snapshotUsed),
      size_used_by_snapshots: s.snapshotUsed,
      snapshot_count: v.nodeRoot ? 0 : v.type === "dp" ? 12 : 23,
      snapshot_reserve_available: s.reserve - s.snapshotUsed,
      snapshot_reserve_size: s.reserve,
      snapshot_space_used: s.reserve ? Math.round((s.snapshotUsed * 100) / s.reserve) : 0,
      virtual_used: s.used,
      virtual_used_percent: v.usedPercent,
    });
    return r;
  });
}

const onlineVolumes = () => S.volumes.filter((v) => v.state === "online");

function volumeEfficiencyStatRecords() {
  return onlineVolumes()
    .filter((v) => !v.nodeRoot)
    .map((v) => ({ vserver: v.svm, volume: v.name, num_compress_attempts: 812340, num_compress_fail: 1204 }));
}

function volumeFootprintRecords() {
  return onlineVolumes().map((v) => {
    const s = volumeSpace(v);
    const metadata = Math.floor(v.size * 0.003);
    return {
      vserver: v.svm,
      volume: v.name,
      volume_blocks_footprint_bin0: s.used,
      volume_blocks_footprint_bin0_percent: Math.round((s.used * 100) / aggrOf(v.aggregate).size),
      volume_blocks_footprint_bin1: 0,
      volume_blocks_footprint_bin1_percent: 0,
      flexvol_metadata_footprint: metadata,
      delayed_free_footprint: Math.floor(metadata / 4),
      total_metadata_footprint: metadata + Math.floor(metadata / 4),
      total_footprint: s.used + metadata + Math.floor(metadata / 4),
      volume_guarantee_footprint: 0,
    };
  });
}

function snapshotAutodeleteRecords() {
  return S.volumes.map((v) => ({ vserver: v.svm, volume: v.name, enabled: false, commitment: "try", trigger: "volume" }));
}

function nfsOps(v, atSeconds) {
  const t = Math.floor(atSeconds);
  const share = v.nfs ? 1 : 0;
  const op = (perSecond, latency) => ({
    count: grown(perSecond * share, t),
    total_time: grown(perSecond * share * latency, t),
  });
  return {
    access: op(v.perf.otherOps * 0.05, 60),
    getattr: op(v.perf.otherOps * 0.5, 45),
    lookup: op(v.perf.otherOps * 0.2, 80),
    read: op(v.perf.readOps, v.perf.readLatency),
    setattr: op(v.perf.otherOps * 0.02, 140),
    write: op(v.perf.writeOps, v.perf.writeLatency),
  };
}

function volumeRecords(t) {
  // The volumes of this cluster that a SnapMirror relationship copies.
  const protectedSources = new Set(S.snapmirrors.filter((m) => !m.sourceCluster).map((m) => `${m.sourceSvm}:${m.sourceVolume}`));
  return publicVolumes().map((v) => {
    const r = {
      uuid: volUuid(v.svm, v.name),
      name: v.name,
      comment: "",
      create_time: "2023-06-14T10:02:11+00:00",
      language: "c.utf_8",
      size: v.size,
      state: v.state,
      style: "flexvol",
      is_svm_root: Boolean(v.svmRoot),
      is_constituent: false,
      tiering: { policy: "none" },
      type: v.type,
      aggregates: [aggrRef(v.aggregate)],
      encryption: { enabled: false },
      clone: { is_flexclone: false },
      is_object_store: false,
      snaplock: { type: "non_snaplock" },
      snapshot_policy: { name: v.snapshotPolicy || "none" },
      svm: svmRef(v.svm),
      snapmirror: {
        is_protected: protectedSources.has(`${v.svm}:${v.name}`),
        destinations: { is_ontap: protectedSources.has(`${v.svm}:${v.name}`), is_cloud: false },
      },
      anti_ransomware: { state: "disabled" },
      statistics: { ...statisticsBlock(v.perf, t), nfs_ops_raw: nfsOps(v, t) },
      _links: link(`/api/storage/volumes/${volUuid(v.svm, v.name)}`),
    };
    if (v.junction && v.state === "online") {
      r.nas = { path: v.junction, export_policy: { name: "default" } };
    }
    if (v.state === "online") {
      const s = volumeSpace(v);
      r.space = {
        size: v.size,
        available: s.available,
        used: s.used,
        percent_used: v.usedPercent,
        afs_total: s.total,
        logical_space: { reporting: false, enforcement: false, used_by_afs: s.logicalUsed, used: s.logicalUsed },
        snapshot: { used: s.snapshotUsed, reserve_percent: s.reservePercent, reserve_size: s.reserve, autodelete_enabled: false },
      };
      r.metric = metricBlock(v.perf, t);
    }
    return r;
  });
}

function lunPath(l) {
  return `/vol/${l.volume}/${l.name}`;
}

function privateLunRecords() {
  return S.luns.map((l) => ({
    vserver: l.svm,
    path: lunPath(l),
    volume: l.volume,
    qtree: "",
    lun: l.name,
    node: nodeOfAggregate(volumeByName(l.volume).aggregate),
    serial_hex: hexFor(`lun-${l.name}`, 24).toLowerCase(),
    state: l.state,
    uuid: uuidFor(`lun-${l.name}`),
    size: l.size,
    size_used: Math.floor((l.size * l.usedPercent) / 100),
    ostype: "linux",
    mapped: l.state === "online" ? "mapped" : "unmapped",
  }));
}

function lunRecords(t) {
  return S.luns.map((l) => ({
    uuid: uuidFor(`lun-${l.name}`),
    name: lunPath(l),
    class: "regular",
    enabled: l.state === "online",
    os_type: "linux",
    serial_number: hexFor(`lun-${l.name}`, 12),
    svm: svmRef(l.svm),
    location: {
      logical_unit: l.name,
      node: nodeRef(nodeOfAggregate(volumeByName(l.volume).aggregate)),
      volume: { uuid: volUuid(l.svm, l.volume), name: l.volume },
    },
    space: { size: l.size, used: Math.floor((l.size * l.usedPercent) / 100), guarantee: { requested: false, reserved: false } },
    status: { container_state: "online", mapped: l.state === "online", read_only: false, state: l.state },
    statistics: statisticsBlock(l.perf, t),
    _links: link(`/api/storage/luns/${uuidFor(`lun-${l.name}`)}`),
  }));
}

function diskAggregates(d) {
  if (d.container !== "shared") {
    return [];
  }
  const roots = S.aggregates.filter((a) => a.root && a.node === d.owner).map((a) => a.name);
  return [...S.aggregates.filter((a) => !a.root).map((a) => a.name), ...roots];
}

function diskRecords(t) {
  return S.disks.map((d) => {
    const r = {
      name: d.name,
      uid: d.uid,
      serial_number: d.serial,
      model: "X4011WBORA3T8NTF",
      vendor: "NETAPP",
      firmware_version: "NA02",
      usable_size: 3840755982336,
      rated_life_used_percent: 2,
      type: "ssd",
      effective_type: "ssd",
      class: "solid_state",
      container_type: d.container,
      pool: "pool0",
      state: d.container === "broken" ? "broken" : "present",
      node: nodeRef(d.owner),
      home_node: nodeRef(d.owner),
      shelf: { uid: S.shelves[0].uid },
      local: true,
      bay: d.bay,
      bytes_per_sector: 512,
      sector_count: 7501476528,
      right_size_sector_count: 7501476528,
      physical_size: 3840755982336,
      fips_certified: false,
      self_encrypting: false,
      stats: {
        average_latency: d.ops ? 205 + d.bay * 3 : 0,
        throughput: d.ops * 16 * KIB,
        iops_total: d.ops,
        path_error_count: 0,
        power_on_hours: Math.floor((t - BOOT_S) / 3600),
      },
      _links: link(`/api/storage/disks/${d.name}`),
    };
    const aggregates = diskAggregates(d);
    if (aggregates.length) {
      r.aggregates = aggregates.map((name) => aggrRef(name));
    }
    if (d.container === "broken") {
      r.outage = { reason: { message: "Failed", code: "721081" }, persistently_failed: true };
    }
    return r;
  });
}

function privateDiskRecords(t) {
  return S.disks.map((d) => ({
    disk: d.name,
    uid: d.uid,
    type: "SSD",
    owner: d.owner,
    container_type: d.container,
    disk_io_kbps_total: d.ops * 16,
    path_count: d.owner === S.nodes[1].name ? 1 : 2,
    sectors_read: grown(d.ops * 0.6 * 32, Math.floor(t)),
    sectors_written: grown(d.ops * 0.4 * 32, Math.floor(t)),
  }));
}

function shelfRecords() {
  return S.shelves.map((s) => ({
    uid: s.uid,
    name: s.name,
    id: s.id,
    serial_number: s.serial,
    model: s.model,
    module_type: s.moduleType,
    internal: false,
    local: true,
    manufacturer: { name: "NETAPP" },
    state: s.state,
    connection_type: "nvme",
    disk_count: s.diskCount,
    location_led: "off",
    paths: [{ name: "e0a", node: { name: S.nodes[0].name } }],
    bays: S.disks.map((d) => ({ id: d.bay, has_disk: true, type: "single_disk", state: "ok" })),
    frus: [
      ...s.modules.map((m) => ({
        type: "module",
        id: m.id,
        state: m.state,
        installed: true,
        part_number: "111-04107+A0",
        serial_number: m.serial,
        firmware_version: m.firmware,
      })),
      ...s.psus.map((p) => ({
        type: "psu",
        id: p.id,
        state: p.state,
        installed: p.installed,
        part_number: "114-00172+A2",
        serial_number: p.serial,
        firmware_version: "0215",
        psu: { model: "00", type: "ac", crest_factor: 92, power_drawn: p.powerDrawn, power_rating: p.powerRating },
      })),
    ],
    fans: s.fans.map((f) => ({ id: f.id, location: f.location, rpm: f.rpm, state: f.state, installed: true })),
    temperature_sensors: s.temperatures.map((x) => ({
      id: x.id,
      location: x.location,
      temperature: x.temperature,
      ambient: x.ambient,
      state: "ok",
      installed: true,
      threshold: { high: { critical: x.ambient ? 42 : 70, warning: x.ambient ? 40 : 65 }, low: { critical: 0, warning: 5 } },
    })),
    voltage_sensors: s.voltages.map((x) => ({ id: x.id, location: x.location, voltage: x.voltage, state: "ok", installed: true })),
    current_sensors: s.currents.map((x) => ({ id: x.id, location: x.location, current: x.current, state: "ok", installed: true })),
    _links: link(`/api/storage/shelves/${s.uid}`),
  }));
}

function privateShelfRecords() {
  return S.shelves.map((s) => ({
    shelf: s.name,
    serial_number: s.serial,
    op_status: s.opStatus,
    error_type: s.error.type,
    error_severity: s.error.severity,
    error_text: s.error.text,
    module_type: s.moduleType.toUpperCase(),
  }));
}

function sensorRecords() {
  return S.sensors.map((x) => {
    const r = {
      node: nodeRef(x.node),
      index: x.index,
      name: x.name,
      type: x.type,
      value: x.value,
      value_units: x.units,
      threshold_state: x.state || "normal",
      _links: link(`/api/cluster/sensors/${nodeUuid(x.node)}/${x.index}`),
    };
    if (x.crit) {
      r.critical_low_threshold = x.crit[0];
      r.warning_low_threshold = x.warn[0];
      r.warning_high_threshold = x.warn[1];
      r.critical_high_threshold = x.crit[1];
    }
    return r;
  });
}

// system chassis fru show -type psu: the A400's two power supplies feed both
// controllers in its chassis.
function chassisFruRecords() {
  if (!S.sensors.length) {
    return [];
  }
  return [1, 2].map((psu) => ({
    node: S.nodes[0].name,
    serial_number: `XXT${hexFor(`psu-${psu}`, 9)}`,
    fru_name: `PSU${psu}`,
    type: "psu",
    status: "ok",
    connected_nodes: S.nodes.map((n) => n.name),
    num_nodes: S.nodes.length,
  }));
}

function ethernetPortRecords() {
  return S.ethernetPorts.map((p) => {
    const r = {
      uuid: uuidFor(`port-${p.node}-${p.name}`),
      name: p.name,
      node: nodeRef(p.node),
      type: "physical",
      enabled: true,
      state: p.state,
      mtu: p.mtu || 9000,
      mac_address: `d0:39:ea:${hexFor(`mac-${p.node}-${p.name}`, 6).toLowerCase().match(/../g).join(":")}`,
      broadcast_domain: {
        uuid: uuidFor(`bd-${p.role}`),
        name: p.role === "node-mgmt" ? "Default" : "Default-1",
        ipspace: { name: "Default" },
      },
      reachability: p.state === "up" ? "ok" : "not_repairable",
      _links: link(`/api/network/ethernet/ports/${uuidFor(`port-${p.node}-${p.name}`)}`),
    };
    if (p.speed) {
      r.speed = p.speed;
    }
    return r;
  });
}

function privatePortRecords() {
  return S.ethernetPorts.map((p) => ({
    node: p.node,
    port: p.name,
    role: p.role,
    duplex_admin: "auto",
    duplex_oper: p.state === "up" ? "full" : "-",
    flowcontrol_admin: "none",
    health_status: p.state === "up" ? "healthy" : "degraded",
    speed_admin: "auto",
    link: p.state,
  }));
}

function fcPortRecords() {
  return S.fcPorts.map((p) => ({
    uuid: uuidFor(`fc-${p.node}-${p.name}`),
    name: p.name,
    node: nodeRef(p.node),
    description: `Fibre Channel Target Adapter ${p.name} (QLogic 2742 (2742), rev. 2, 32G)`,
    enabled: true,
    state: "online",
    physical_protocol: "fibre_channel",
    supported_protocols: ["fcp"],
    speed: { configured: "auto", maximum: "32" },
    fabric: {
      connected: true,
      connected_speed: 32,
      name: `20:00:00:27:f8:${hexFor(`fabric-${p.name}`, 6).toLowerCase().match(/../g).join(":")}`,
      port_address: p.name === "0c" ? "010100" : "020100",
      switch_port: p.name === "0c" ? "fcsw-a:12" : "fcsw-b:12",
    },
    wwnn: "50:0a:09:80:80:d7:c5:f1",
    wwpn: `50:0a:09:8${p.name === "0c" ? 1 : 2}:${hexFor(`wwpn-${p.node}-${p.name}`, 8).toLowerCase().match(/../g).join(":")}:f1`,
    _links: link(`/api/network/fc/ports/${uuidFor(`fc-${p.node}-${p.name}`)}`),
  }));
}

function lifRecords() {
  return S.lifs.map((l) => ({
    uuid: uuidFor(`lif-${l.svm}-${l.name}`),
    name: l.name,
    svm: svmRef(l.svm),
    scope: S.svms.find((v) => v.name === l.svm && v.type === "data") ? "svm" : "cluster",
    state: "up",
    enabled: true,
    ip: { address: l.ip, netmask: "24", family: "ipv4" },
    location: {
      is_home: true,
      node: nodeRef(l.node),
      port: { name: l.port, node: { name: l.node } },
      home_node: nodeRef(l.node),
      home_port: { name: l.port, node: { name: l.node } },
    },
    _links: link(`/api/network/ip/interfaces/${uuidFor(`lif-${l.svm}-${l.name}`)}`),
  }));
}

function relationshipId(m) {
  return uuidFor(`snapmirror-${m.destination}`);
}

function privateSnapmirrorRecords(t) {
  return S.snapmirrors.map((m) => {
    const newest = Math.floor(t) - m.lag;
    const r = {
      destination_path: m.destination,
      relationship_id: relationshipId(m),
      destination_volume: m.destinationVolume,
      destination_volume_node: nodeOfAggregate(volumeByName(m.destinationVolume) ? volumeByName(m.destinationVolume).aggregate : "aggr1_n02"),
      destination_vserver: m.destinationSvm,
      source_path: `${m.sourceSvm}:${m.sourceVolume}`,
      source_volume: m.sourceVolume,
      source_vserver: m.sourceSvm,
      relationship_type: "extended_data_protection",
      relationship_group_type: "none",
      policy: m.policy,
      policy_type: m.policyType,
      state: "snapmirrored",
      status: m.status || "idle",
      healthy: m.healthy,
      last_transfer_type: m.policyType === "sync_mirror" ? "resync" : "update",
      lag_time: isoDuration(m.lag),
      last_transfer_duration: isoDuration(m.lastTransferDuration),
      last_transfer_end_timestamp: isoOffset(newest + m.lastTransferDuration),
      last_transfer_size: Math.round(m.lastTransferSize),
      newest_snapshot_timestamp: isoOffset(newest),
      newest_snapshot: m.policyType === "sync_mirror" ? undefined : `snapmirror.${hexFor(m.destination, 8).toLowerCase()}_2160${String(Math.floor(newest / 60) % 100000).padStart(6, "0")}`,
      total_transfer_bytes: Math.round(m.lastTransferSize * 1900),
      total_transfer_time_secs: Math.round(m.lastTransferDuration * 1900),
      update_successful_count: m.policyType === "sync_mirror" ? 0 : 2841,
      update_failed_count: m.failedUpdates || 0,
      resync_successful_count: m.policyType === "sync_mirror" ? 1 : 0,
      resync_failed_count: 0,
      break_successful_count: 0,
      break_failed_count: 0,
    };
    if (m.schedule) {
      r.schedule = m.schedule;
    }
    if (m.unhealthyReason) {
      r.unhealthy_reason = m.unhealthyReason;
    }
    if (r.newest_snapshot === undefined) {
      delete r.newest_snapshot;
    }
    return r;
  });
}

function snapmirrorRelationshipRecords(t) {
  return S.snapmirrors.map((m) => {
    const source = { path: `${m.sourceSvm}:${m.sourceVolume}`, svm: { name: m.sourceSvm } };
    if (m.sourceCluster) {
      const peer = S.clusterPeers.find((c) => c.name === m.sourceCluster);
      source.cluster = { name: m.sourceCluster, uuid: peer.uuid };
    }
    const r = {
      uuid: relationshipId(m),
      source,
      destination: { path: m.destination, svm: svmRef(m.destinationSvm) },
      healthy: m.healthy,
      state: "snapmirrored",
      lag_time: isoDuration(m.lag),
      group_type: "none",
      policy: { name: m.policy, type: m.policyType === "sync_mirror" ? "sync" : "async", uuid: uuidFor(`policy-${m.policy}`) },
      last_transfer_type: m.policyType === "sync_mirror" ? "resync" : "update",
      throttle: 0,
      _links: link(`/api/snapmirror/relationships/${relationshipId(m)}`),
    };
    if (m.schedule) {
      r.transfer_schedule = { name: m.schedule, uuid: uuidFor(`schedule-${m.schedule}`) };
    }
    if (m.unhealthyReason) {
      r.unhealthy_reason = [{ message: m.unhealthyReason, code: "6619546", arguments: [] }];
    }
    return r;
  });
}

function svmPeerRecords() {
  return S.svmPeers.map((p) => {
    const peerCluster = p.peerCluster === S.cluster.name ? { name: S.cluster.name, uuid: S.cluster.uuid } : S.clusterPeers.find((c) => c.name === p.peerCluster);
    return {
      uuid: uuidFor(`svm-peer-${p.svm}-${p.name}`),
      name: p.name,
      svm: svmRef(p.svm),
      peer: { svm: { name: p.peerSvm, uuid: uuidFor(`remote-svm-${p.peerSvm}`) }, cluster: { name: peerCluster.name, uuid: peerCluster.uuid } },
      state: "peered",
      applications: ["snapmirror"],
      _links: link(`/api/svm/peers/${uuidFor(`svm-peer-${p.svm}-${p.name}`)}`),
    };
  });
}

function clusterPeerRecords() {
  return S.clusterPeers.map((c) => ({
    uuid: uuidFor(`cluster-peer-${c.name}`),
    name: c.name,
    remote: { name: c.name, serial_number: "1-80-000456", ip_addresses: ["203.0.113.11", "203.0.113.12"] },
    status: { state: "available", update_time: isoOffset(nowSeconds() - 30) },
    authentication: { state: "ok", in_use: "ok" },
    encryption: { state: "tls_psk" },
    ipspace: { name: "Default" },
    _links: link(`/api/cluster/peers/${uuidFor(`cluster-peer-${c.name}`)}`),
  }));
}

function subsystemRecords() {
  return S.subsystems.map((name) => ({ subsystem: name, health: "ok", init_state: "initialized", outstanding_alert_count: 0, suppressed_alert_count: 0 }));
}

function failoverRecords() {
  return S.nodes.map((n) => ({
    node: n.name,
    partner_name: n.partner,
    possible: true,
    state_description: `Connected to ${n.partner}`,
    partner_state: "Up",
    mode: "ha",
    enabled: true,
    interconnect_up: true,
  }));
}

function licenseRecords() {
  return S.licenses.map((name) => ({
    name,
    scope: name === "base" ? "cluster" : "node",
    state: "compliant",
    licenses: S.nodes.map((n) => ({ owner: n.name, serial_number: `${n.serial}1`, active: true, evaluation: false, installed_license: "NLF" })),
    _links: link(`/api/cluster/licensing/licenses/${name}`),
  }));
}

function supportAlertRecords() {
  return S.supportAlerts.map((a, i) => ({
    node: nodeRef(a.node),
    monitor: a.monitor,
    name: a.name,
    resource: a.resource,
    time: isoOffset(a.raisedAt),
    acknowledge: false,
    suppress: false,
    perceived_severity: "major",
    probable_cause: "connection_establishment_error",
    possible_effect: a.possibleEffect,
    cause: { message: a.cause, code: "263270" },
    corrective_action: { message: a.correctiveAction, code: "263271" },
    additional_info: { message: "", code: "0" },
    _links: link(`/api/private/support/alerts/${nodeUuid(a.node)}/${a.monitor}/${a.name}/${i}`),
  }));
}

function clusterDateRecords(t) {
  return S.nodes.map((n) => ({ node: n.name, date: isoOffset(t), timezone: "Etc/UTC" }));
}

function emsMessageRecords() {
  return EMS_CATALOGUE.map((name) => ({ name, _links: link(`/api/support/ems/messages/${name}`) }));
}

// The events that have happened by now.
function emsEventRecords(t) {
  return S.ems
    .filter((e) => START_S + e.at <= t)
    .map((e) => ({
      node: nodeRef(e.node),
      index: e.index,
      time: isoOffset(START_S + e.at),
      message: { severity: e.severity, name: e.name },
      source: e.source,
      parameters: e.parameters.map(([name, value]) => ({ name, value })),
      log_message: e.logMessage,
      _links: link(`/api/support/ems/events/${e.node}/${e.index}`),
    }));
}

// ---- Counter tables --------------------------------------------------------
// The counter schemas list each counter with the type, unit and base counter
// Harvest's ontap-metrics documentation gives for it (string counters are
// the rows' properties).

function schema(name, type, unit, denominator, description) {
  const c = { name, description: description || name.replace(/[._]/g, " "), type, unit };
  if (denominator) {
    c.denominator = { name: denominator };
  }
  return c;
}

const NIC_SCHEMA = [
  schema("id", "string", "none", null, "Instance identifier"),
  schema("link_current_state", "string", "none", null, "Current state of the link"),
  schema("link_speed", "string", "none", null, "Link speed"),
  schema("link_up_to_down", "delta", "none", null, "Number of link state change from UP to DOWN."),
  schema("node.name", "string", "none", null, "System node name"),
  schema("receive_alignment_errors", "delta", "none", null, "Alignment errors detected on received packets"),
  schema("receive_bytes", "rate", "b_per_sec", null, "Bytes received"),
  schema("receive_crc_errors", "delta", "none", null, "CRC errors detected on received packets"),
  schema("receive_errors", "rate", "b_per_sec", null, "Error received"),
  schema("receive_length_errors", "delta", "none", null, "Length errors detected on received packets"),
  schema("receive_total_errors", "delta", "none", null, "Total errors received"),
  schema("transmit_bytes", "rate", "b_per_sec", null, "Bytes sent"),
  schema("transmit_errors", "rate", "b_per_sec", null, "Error sent"),
  schema("transmit_hw_errors", "delta", "none", null, "Transmit errors reported by hardware"),
  schema("transmit_total_errors", "delta", "none", null, "Total errors sent"),
  schema("type", "string", "none", null, "Type of the port"),
];

const FCP_RATE = (name) => schema(name, "rate", name.endsWith("_data") ? "b_per_sec" : "per_sec");
const FCP_DELTA = (name) => schema(name, "delta", "none");
const FCP_SCHEMA = [
  schema("average_other_latency", "average", "microsec", "other_ops"),
  schema("average_read_latency", "average", "microsec", "read_ops"),
  schema("average_write_latency", "average", "microsec", "write_ops"),
  ...["discarded_frames_count", "interrupt_count", "invalid.crc", "invalid.transmission_word", "isr.count", "link.down", "link.up", "link_failure", "loss_of_signal", "loss_of_sync", "primitive_seq_err", "queue_full", "reset_count", "shared_interrupt_count", "spurious_interrupt_count", "threshold_full"].map(FCP_DELTA),
  schema("link.speed", "raw", "none", null, "Link speed in bytes per second"),
  schema("name", "string", "none", null, "Port name"),
  schema("node.name", "string", "none", null, "System node name"),
  schema("nvmf.average_other_latency", "average", "microsec", "nvmf.other_ops"),
  schema("nvmf.average_read_latency", "average", "microsec", "nvmf.read_ops"),
  schema("nvmf.average_remote_other_latency", "average", "microsec", "nvmf_remote.other_ops"),
  schema("nvmf.average_remote_read_latency", "average", "microsec", "nvmf_remote.read_ops"),
  schema("nvmf.average_remote_write_latency", "average", "microsec", "nvmf_remote.write_ops"),
  schema("nvmf.average_write_latency", "average", "microsec", "nvmf.write_ops"),
  ...["nvmf.caw_data", "nvmf.caw_ops", "nvmf.command_slots", "nvmf.other_ops", "nvmf.read_data", "nvmf.read_ops", "nvmf.total_data", "nvmf.total_ops", "nvmf.write_data", "nvmf.write_ops"].map(FCP_RATE),
  ...["nvmf_remote.caw_data", "nvmf_remote.caw_ops", "nvmf_remote.other_ops", "nvmf_remote.read_data", "nvmf_remote.read_ops", "nvmf_remote.total_data", "nvmf_remote.total_ops", "nvmf_remote.write_data", "nvmf_remote.write_ops"].map(FCP_RATE),
  ...["other_ops", "read_data", "read_ops", "total_data", "total_ops", "write_data", "write_ops"].map(FCP_RATE),
];

const DISK_SCHEMA = [
  schema("base_for_disk_busy", "delta", "none", null, "Base for disk busy calculations"),
  schema("capacity", "raw", "mb", null, "Disk capacity in MB"),
  schema("cp_read_blocks", "rate", "per_sec", null, "Number of blocks transferred for consistency point read operations per second"),
  schema("cp_read_chain", "average", "none", "cp_read_count", "Average number of blocks transferred in each consistency point read operation during a CP"),
  schema("cp_read_count", "rate", "per_sec", null, "Number of disk read operations initiated each second for consistency point processing"),
  schema("cp_read_latency", "average", "microsec", "cp_read_blocks", "Average latency per block in microseconds for consistency point read operations"),
  schema("disk_busy_percent", "percent", "percent", "base_for_disk_busy", "The utilization percent of the disk"),
  schema("id", "string", "none", null, "Instance identifier"),
  schema("io_pending", "average", "none", "base_for_disk_busy", "Average number of I/Os issued to the disk for which we have not yet received the response"),
  schema("io_queued", "average", "none", "base_for_disk_busy", "Number of I/Os queued to the disk but not yet issued"),
  schema("name", "string", "none", null, "Name of the disk partition"),
  schema("node.name", "string", "none", null, "System node name"),
  schema("physical_disk_id", "string", "none", null, "Physical disk ID"),
  schema("physical_disk_name", "string", "none", null, "Physical disk name"),
  schema("raid.type", "string", "none", null, "RAID type"),
  schema("raid_group", "string", "none", null, "RAID group"),
  schema("speed", "string", "none", null, "Disk rotational speed"),
  schema("total_data", "rate", "b_per_sec", null, "Total throughput for user operations per second"),
  schema("total_transfer_count", "rate", "per_sec", null, "Total number of disk operations involving data transfer initiated per second"),
  schema("user_read_block_count", "rate", "per_sec", null, "Number of blocks transferred for user read operations per second"),
  schema("user_read_chain", "average", "none", "user_read_count", "Average number of blocks transferred in each user read operation"),
  schema("user_read_count", "rate", "per_sec", null, "Number of disk read operations initiated each second for retrieving data or metadata associated with user requests"),
  schema("user_read_latency", "average", "microsec", "user_read_block_count", "Average latency per block in microseconds for user read operations"),
  schema("user_write_block_count", "rate", "per_sec", null, "Number of blocks transferred for user write operations per second"),
  schema("user_write_chain", "average", "none", "user_write_count", "Average number of blocks transferred in each user write operation"),
  schema("user_write_count", "rate", "per_sec", null, "Number of disk write operations initiated each second for storing data or metadata associated with user requests"),
  schema("user_write_latency", "average", "microsec", "user_write_block_count", "Average latency per block in microseconds for user write operations"),
];

const COUNTER_TABLES = {
  nic_common: {
    description: "The nic_common table reports the per-port network statistics of the cluster's Ethernet ports.",
    schemas: NIC_SCHEMA,
    rows: nicRows,
  },
  fcp: {
    description: "This table reports FCP port statistics for each Fibre Channel target port.",
    schemas: FCP_SCHEMA,
    rows: fcpRows,
  },
  "disk:constituent": {
    description: "The disk table reports disk-level performance counters. The alias name for disk:constituent is disk_constituent.",
    schemas: DISK_SCHEMA,
    rows: diskRows,
  },
};

function row(table, id, properties, counters) {
  return {
    counter_table: { name: table },
    id,
    properties: Object.entries(properties).map(([name, value]) => ({ name, value })),
    counters: Object.entries(counters).map(([name, value]) => ({ name, value })),
    _links: link(`/api/cluster/counter/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`),
  };
}

function nicRows(t) {
  return S.ethernetPorts.map((p) =>
    row(
      "nic_common",
      `${p.node}:${p.name}`,
      {
        id: `${p.node}:${p.name}`,
        link_current_state: p.state,
        link_speed: p.speed ? `${p.speed}M` : "0M",
        "node.name": p.node,
        type: p.kind,
      },
      {
        link_up_to_down: p.state === "up" ? 0 : 1,
        receive_alignment_errors: 0,
        receive_bytes: grown(p.rx, t),
        receive_crc_errors: 0,
        receive_errors: 0,
        receive_length_errors: 0,
        receive_total_errors: 0,
        transmit_bytes: grown(p.tx, t),
        transmit_errors: 0,
        transmit_hw_errors: 0,
        transmit_total_errors: 0,
      },
    ),
  );
}

function fcpRows(t) {
  return S.fcPorts.map((p) => {
    const reads = p.ops * 0.6;
    const writes = p.ops * 0.38;
    const others = p.ops * 0.02;
    const counters = {
      average_other_latency: grown(others * 60, t),
      average_read_latency: grown(reads * 310, t),
      average_write_latency: grown(writes * 240, t),
      discarded_frames_count: 0,
      interrupt_count: grown(p.ops * 1.4, t),
      "invalid.crc": 0,
      "invalid.transmission_word": 0,
      "isr.count": grown(p.ops * 1.1, t),
      "link.down": p.linkFailuresPer30s ? Math.floor((t - BOOT_S) / 30) : 2,
      "link.speed": 3200000000,
      "link.up": p.linkFailuresPer30s ? Math.floor((t - BOOT_S) / 30) + 1 : 3,
      link_failure: p.linkFailuresPer30s ? Math.floor(((t - BOOT_S) * p.linkFailuresPer30s) / 30) : 0,
      loss_of_signal: 0,
      loss_of_sync: p.linkFailuresPer30s ? Math.floor((t - BOOT_S) / 30) : 0,
      other_ops: grown(others, t),
      primitive_seq_err: 0,
      queue_full: 0,
      read_data: grown(reads * 64 * KIB, t),
      read_ops: grown(reads, t),
      reset_count: 0,
      shared_interrupt_count: 0,
      spurious_interrupt_count: 0,
      threshold_full: 0,
      total_data: grown(reads * 64 * KIB + writes * 64 * KIB, t),
      total_ops: grown(p.ops, t),
      write_data: grown(writes * 64 * KIB, t),
      write_ops: grown(writes, t),
    };
    for (const s of FCP_SCHEMA) {
      if (s.name.startsWith("nvmf") && counters[s.name] === undefined) {
        counters[s.name] = 0;
      }
    }
    return row("fcp", `${p.node}:${p.name}`, { name: `port.${p.name}`, "node.name": p.node }, counters);
  });
}

// One row per partition in use: each SSD gives its first data partition to
// aggr1_n01, its second to aggr1_n02 and its root partition to its owner's
// root aggregate (root-data-data partitioning).
function diskRows(t) {
  const rows = [];
  const dataAggregates = S.aggregates.filter((a) => !a.root);
  for (const d of S.disks) {
    if (d.container !== "shared") {
      continue;
    }
    const parts = dataAggregates.map((a, i) => ({ name: `${d.name}.P${i + 1}`, aggregate: a, node: a.node, share: 0.49 }));
    const root = S.aggregates.find((a) => a.root && a.node === d.owner);
    parts.push({ name: `${d.name}.P${parts.length + 1}`, aggregate: root, node: d.owner, share: 0.02 });
    for (const part of parts) {
      const ops = d.ops * part.share;
      const reads = ops * 0.55;
      const writes = ops * 0.4;
      const cpReads = ops * 0.05;
      const readBlocks = reads * 8;
      const writeBlocks = writes * 16;
      const cpBlocks = cpReads * 12;
      const base = grown(1000000, t);
      rows.push(
        row(
          "disk:constituent",
          `${part.node}:${part.name}:${d.uid}`,
          {
            id: `${part.node}:${part.name}:${d.uid}`,
            name: part.name,
            "node.name": part.node,
            physical_disk_id: d.uid,
            physical_disk_name: d.name,
            "raid.type": "raid_dp",
            raid_group: `/${part.aggregate.name}/plex0/rg0`,
            speed: "0",
          },
          {
            base_for_disk_busy: base,
            capacity: part.aggregate.root ? 55296 : 1792500,
            cp_read_blocks: grown(cpBlocks, t),
            cp_read_chain: grown(cpReads * 12, t),
            cp_read_count: grown(cpReads, t),
            cp_read_latency: grown(cpBlocks * 85, t),
            disk_busy_percent: Math.round(base * Math.min(0.9, ops / 2600)),
            io_pending: Math.round(base * 0.4),
            io_queued: Math.round(base * 0.1),
            total_data: grown((readBlocks + writeBlocks + cpBlocks) * 4 * KIB, t),
            total_transfer_count: grown(ops, t),
            user_read_block_count: grown(readBlocks, t),
            user_read_chain: grown(reads * 8, t),
            user_read_count: grown(reads, t),
            user_read_latency: grown(readBlocks * 118, t),
            user_write_block_count: grown(writeBlocks, t),
            user_write_chain: grown(writes * 16, t),
            user_write_count: grown(writes, t),
            user_write_latency: grown(writeBlocks * 64, t),
          },
        ),
      );
    }
  }
  return rows;
}

// ---- Routes ----------------------------------------------------------------
// keys: the fields ONTAP returns whatever "fields" asks for.

const ROUTES = {
  "api/cluster": { object: (t) => clusterObject(t) },
  "api/cluster/nodes": { records: nodeRecords, keys: ["uuid", "name", "_links"] },
  "api/cluster/sensors": { records: sensorRecords, keys: ["node", "index", "_links"] },
  "api/cluster/peers": { records: clusterPeerRecords, keys: ["uuid", "name", "_links"] },
  "api/cluster/licensing/licenses": { records: licenseRecords, keys: ["name", "_links"] },
  "api/storage/aggregates": { records: aggregateRecords, keys: ["uuid", "name", "_links"] },
  "api/storage/volumes": { records: volumeRecords, keys: ["uuid", "name", "_links"] },
  "api/storage/luns": { records: lunRecords, keys: ["uuid", "name", "_links"] },
  "api/storage/disks": { records: diskRecords, keys: ["name", "_links"] },
  "api/storage/shelves": { records: shelfRecords, keys: ["uid", "name", "_links"] },
  "api/svm/svms": { records: svmRecords, keys: ["uuid", "name", "_links"] },
  "api/svm/peers": { records: svmPeerRecords, keys: ["uuid", "name", "_links"] },
  "api/security/ssh/svms": { records: sshSvmRecords, keys: ["svm", "_links"] },
  "api/protocols/cifs/services": { records: cifsServiceRecords, keys: ["svm", "name", "_links"] },
  "api/protocols/audit": { records: () => [], keys: ["svm", "_links"] },
  "api/protocols/fpolicy": { records: () => [], keys: ["svm", "_links"] },
  "api/protocols/nfs/kerberos/interfaces": { records: kerberosInterfaceRecords, keys: ["interface", "_links"] },
  "api/protocols/san/iscsi/services": { records: iscsiServiceRecords, keys: ["svm", "_links"] },
  "api/protocols/san/iscsi/credentials": { records: iscsiCredentialRecords, keys: ["svm", "initiator", "_links"] },
  "api/name-services/nis": { records: () => [], keys: ["svm", "_links"] },
  "api/name-services/ldap": { records: () => [], keys: ["svm", "_links"] },
  "api/network/ethernet/ports": { records: ethernetPortRecords, keys: ["uuid", "name", "node", "_links"] },
  "api/network/fc/ports": { records: fcPortRecords, keys: ["uuid", "name", "node", "_links"] },
  "api/network/ip/interfaces": { records: lifRecords, keys: ["uuid", "name", "_links"] },
  "api/snapmirror/relationships": { records: snapmirrorRelationshipRecords, keys: ["uuid", "_links"] },
  "api/support/ems/events": { records: emsEventRecords, keys: ["node", "index", "_links"] },
  "api/support/ems/messages": { records: emsMessageRecords, keys: ["name", "_links"] },
  "api/private/support/alerts": { records: supportAlertRecords, keys: ["node", "monitor", "name", "resource", "_links"] },
  "api/private/cli/node": { records: privateNodeRecords, keys: ["node"] },
  "api/private/cli/aggr": { records: privateAggrRecords, keys: ["aggregate"] },
  "api/private/cli/aggr/show-space": { records: aggrShowSpaceRecords, keys: ["aggregate_name", "bin_num"] },
  "api/private/cli/vserver": { records: privateVserverRecords, keys: ["vserver"] },
  "api/private/cli/vserver/cifs/server/security": { records: cifsSecurityRecords, keys: ["vserver"] },
  "api/private/cli/volume": { records: privateVolumeRecords, keys: ["vserver", "volume"] },
  "api/private/cli/volume/efficiency/stat": { records: volumeEfficiencyStatRecords, keys: ["vserver", "volume"] },
  "api/private/cli/volume/footprint": { records: volumeFootprintRecords, keys: ["vserver", "volume"] },
  "api/private/cli/volume/snapshot/autodelete": { records: snapshotAutodeleteRecords, keys: ["vserver", "volume"] },
  "api/private/cli/lun": { records: privateLunRecords, keys: ["vserver", "path"] },
  "api/private/cli/disk": { records: privateDiskRecords, keys: ["disk"] },
  "api/private/cli/storage/shelf": { records: privateShelfRecords, keys: ["shelf"] },
  "api/private/cli/storage/failover": { records: failoverRecords, keys: ["node"] },
  "api/private/cli/system/chassis/fru": { records: chassisFruRecords, keys: ["node", "serial_number"] },
  "api/private/cli/system/health/subsystem": { records: subsystemRecords, keys: ["subsystem"] },
  "api/private/cli/network/port": { records: privatePortRecords, keys: ["node", "port"] },
  "api/private/cli/network/port/ifgrp": { records: () => [], keys: ["node", "ifgrp"] },
  "api/private/cli/snapmirror": { records: privateSnapmirrorRecords, keys: ["destination_path"] },
  "api/private/cli/fabriclink": { records: () => [], keys: ["link_uuid"] },
  "api/private/cli/cluster/date": { records: clusterDateRecords, keys: ["node"] },
};

// Query parameters that are not filters on a record's fields.
const RESERVED = new Set([
  "fields", "return_records", "return_timeout", "max_records", "ignore_unknown_fields", "order_by",
  "privilege_level", "expand", "start", "query", "query_fields",
]);

// ---- ONTAP's query syntax --------------------------------------------------

// The values at a dotted path, through arrays.
function valuesAt(record, path) {
  let current = [record];
  for (const segment of path.split(".")) {
    const next = [];
    for (const value of current) {
      if (value === null || value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && segment in item) {
            next.push(item[segment]);
          }
        }
      } else if (typeof value === "object" && segment in value) {
        next.push(value[segment]);
      }
    }
    current = next;
  }
  const flat = [];
  for (const value of current) {
    if (Array.isArray(value)) {
      flat.push(...value);
    } else if (value !== null && value !== undefined) {
      flat.push(value);
    }
  }
  return flat;
}

// "a|b,c" -> ["a", "b", "c"], keeping quoted parts whole.
function splitAlternatives(expression) {
  const parts = [];
  let current = "";
  let quoted = false;
  for (const ch of expression) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (!quoted && (ch === "|" || ch === ",")) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function asNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed / 1000;
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return NaN;
}

function matchesOne(values, term) {
  if (term.startsWith('"') && term.endsWith('"') && term.length >= 2) {
    const literal = term.slice(1, -1);
    return values.some((v) => String(v) === literal);
  }
  if (term === "null") {
    return values.length === 0;
  }
  if (term === "*") {
    return true;
  }
  const comparison = term.match(/^(>=|<=|>|<)(.+)$/);
  if (comparison) {
    const limit = asNumber(comparison[2]);
    return values.some((v) => {
      const n = asNumber(v);
      if (Number.isNaN(n) || Number.isNaN(limit)) {
        return false;
      }
      switch (comparison[1]) {
        case ">=":
          return n >= limit;
        case "<=":
          return n <= limit;
        case ">":
          return n > limit;
        default:
          return n < limit;
      }
    });
  }
  const range = term.match(/^(.+)\.\.(.+)$/);
  if (range) {
    const low = asNumber(range[1]);
    const high = asNumber(range[2]);
    return values.some((v) => {
      const n = asNumber(v);
      return n >= low && n <= high;
    });
  }
  if (term.includes("*")) {
    const pattern = new RegExp(`^${term.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
    return values.some((v) => pattern.test(String(v)));
  }
  return values.some((v) => String(v).toLowerCase() === term.toLowerCase());
}

// field=expression: "!" before the expression negates all of it, so
// !a|b is neither a nor b.
function matchesFilter(record, field, expression) {
  const values = valuesAt(record, field);
  let negate = false;
  let body = expression;
  if (body.startsWith("!")) {
    negate = true;
    body = body.slice(1);
  }
  const any = splitAlternatives(body).some((term) => matchesOne(values, term));
  return negate ? !any : any;
}

// ---- Fields ----------------------------------------------------------------

function copyPath(source, target, segments) {
  if (source === null || typeof source !== "object") {
    return;
  }
  const [head, ...rest] = segments;
  if (!(head in source)) {
    return;
  }
  const value = source[head];
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  if (Array.isArray(value)) {
    const items = Array.isArray(target[head]) ? target[head] : value.map(() => ({}));
    value.forEach((item, i) => {
      if (item && typeof item === "object") {
        copyPath(item, items[i], rest);
      }
    });
    target[head] = items;
  } else if (value && typeof value === "object") {
    target[head] = target[head] && typeof target[head] === "object" ? target[head] : {};
    copyPath(value, target[head], rest);
  }
}

function project(record, fields, keys) {
  if (!fields || fields.includes("*") || fields.includes("**")) {
    return record;
  }
  const out = {};
  for (const field of [...keys, ...fields]) {
    copyPath(record, out, field.split("."));
  }
  return out;
}

// ---- HTTP ------------------------------------------------------------------

function elapsedLabel() {
  return `+${((Date.now() - START_MS) / 1000).toFixed(3)}s`;
}

// The query as logged: long lists (EMS's message names) are counted, not
// spelled out.
function queryForLog(params) {
  const parts = [];
  for (const [key, value] of params) {
    if (value.length > 160) {
      parts.push(`${key}=<${splitAlternatives(value).length} values>`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${elapsedLabel()} ${line}\n`);
}

let lastAuthVerdict = null;

// Whether the request's Basic credentials are exactly ONTAP_USERNAME and
// ONTAP_PASSWORD. The verdict names what differed, never the password.
function checkAuth(header) {
  if (!header || !header.startsWith("Basic ")) {
    return { ok: false, verdict: "none" };
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  const user = colon === -1 ? decoded : decoded.slice(0, colon);
  const password = colon === -1 ? "" : decoded.slice(colon + 1);
  if (user !== USERNAME) {
    return { ok: false, verdict: "wrong-user", detail: `user ${JSON.stringify(user)}` };
  }
  if (password !== PASSWORD) {
    const expected = Array.from(PASSWORD);
    const received = Array.from(password);
    let at = 0;
    while (at < expected.length && at < received.length && expected[at] === received[at]) {
      at++;
    }
    return {
      ok: false,
      verdict: "wrong-password",
      detail: `a password of ${received.length} characters (expected ${expected.length}), differing from character ${at + 1}`,
    };
  }
  return { ok: true, verdict: "ok" };
}

function send(res, status, body, extraHeaders) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/hal+json",
    "Content-Length": Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

function collectionResponse(path, params, route, t) {
  let records = route.records(t);
  const notes = [];

  // Filters.
  for (const [field, expression] of params) {
    if (RESERVED.has(field) || field.startsWith("start.")) {
      continue;
    }
    if (field === "counters.name" && route.counterRows) {
      continue;
    }
    records = records.filter((r) => matchesFilter(r, field, expression));
  }

  // A counter table's rows carry only the counters asked for.
  if (route.counterRows && params.has("counters.name")) {
    const wanted = new Set(splitAlternatives(params.get("counters.name")));
    records = records.map((r) => ({ ...r, counters: r.counters.filter((c) => wanted.has(c.name)) }));
  }

  // Fields (ONTAP accepts the CLI's hyphenated names too).
  const fields = params.has("fields") ? params.get("fields").split(",").map((f) => f.trim().replace(/-/g, "_")).filter(Boolean) : null;
  records = records.map((r) => project(r, fields, route.keys || []));

  const total = records.length;
  if (params.get("return_records") === "false") {
    return { body: { num_records: total, _links: link(`/${path}`) }, count: total, notes };
  }

  // Pages of max_records, linked by _links.next.
  const max = Number(params.get("max_records") || "0");
  const start = Number(params.get("start.offset") || "0");
  let page = records.slice(start);
  let next = null;
  if (max > 0 && page.length > max) {
    page = page.slice(0, max);
    const nextParams = new URLSearchParams(params);
    nextParams.set("start.offset", String(start + max));
    next = `/${path}?${nextParams.toString()}`;
  }
  const self = `/${path}${params.toString() ? `?${params.toString()}` : ""}`;
  const body = { records: page, num_records: page.length, _links: next ? { self: { href: self }, next: { href: next } } : link(self) };
  return { body, count: page.length, notes };
}

function counterRoute(path) {
  const match = path.match(/^api\/cluster\/counter\/tables\/([^/]+)(\/rows)?$/);
  if (!match) {
    return null;
  }
  const table = COUNTER_TABLES[match[1]];
  if (!table) {
    return { unknownTable: match[1] };
  }
  if (match[2]) {
    return { records: (t) => table.rows(t), keys: ["counter_table", "id", "_links"], counterRows: true };
  }
  return {
    object: () => ({
      name: match[1],
      description: table.description,
      counter_schemas: table.schemas,
      _links: link(`/api/cluster/counter/tables/${encodeURIComponent(match[1])}`),
    }),
  };
}

function handle(req, res) {
  const url = new URL(req.url, "https://fake-ontap");
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
  } catch (err) {
    path = url.pathname.replace(/^\/+|\/+$/g, "");
  }
  const params = url.searchParams;
  const where = `${req.method} /${path}${queryForLog(params)}`;

  const auth = checkAuth(req.headers.authorization);
  if (auth.verdict !== lastAuthVerdict) {
    lastAuthVerdict = auth.verdict;
    if (auth.ok) {
      log(`AUTH the Basic credentials received are exactly ONTAP_USERNAME and ONTAP_PASSWORD`);
    } else {
      log(`AUTH MISMATCH (${auth.verdict}): received ${auth.detail || "no Basic credentials"}`);
    }
  }
  if (!auth.ok) {
    send(res, 401, { error: { message: "User is not authorized", code: "6691623" } }, { "WWW-Authenticate": 'Basic realm="ONTAP"' });
    log(`${where} 401 auth=${auth.verdict}`);
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, { error: { message: `The "${req.method}" method is not supported by this stand-in.`, code: "3" } });
    log(`${where} 405 UNKNOWN auth=ok`);
    return;
  }

  if (S.forbidden.has(path)) {
    send(res, 403, { error: { message: "not authorized for that command", code: "6" } });
    log(`${where} 403 auth=ok`);
    return;
  }

  const t = nowSeconds();
  if (path === "api/cluster/counter/tables") {
    const names = Object.keys(COUNTER_TABLES).filter((name) => !S.forbidden.has(`api/cluster/counter/tables/${name}`));
    const route = { records: () => names.map((name) => ({ name, _links: link(`/api/cluster/counter/tables/${encodeURIComponent(name)}`) })), keys: ["name", "_links"] };
    const { body, count } = collectionResponse(path, params, route, t);
    send(res, 200, body);
    log(`${where} 200 records=${count} auth=ok`);
    return;
  }

  const route = ROUTES[path] || counterRoute(path);
  if (route && route.unknownTable) {
    send(res, 404, { error: { message: `Table requested is not found`, code: "8585320", target: route.unknownTable } });
    log(`${where} 404 UNKNOWN auth=ok`);
    return;
  }
  if (!route) {
    send(res, 200, { records: [], num_records: 0 });
    log(`${where} 200 records=0 UNKNOWN auth=ok`);
    return;
  }
  if (route.object) {
    const object = route.object(t);
    const fields = params.has("fields") ? params.get("fields").split(",").map((f) => f.trim()).filter(Boolean) : null;
    send(res, 200, project(object, fields, ["_links"]));
    log(`${where} 200 object auth=ok`);
    return;
  }
  const { body, count } = collectionResponse(path, params, route, t);
  send(res, 200, body);
  log(`${where} 200 records=${count} auth=ok`);
}

const server = https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, (req, res) => {
  try {
    handle(req, res);
  } catch (err) {
    log(`${req.method} ${req.url} 500 ${err && err.stack ? err.stack.replace(/\n\s*/g, " | ") : err}`);
    if (!res.headersSent) {
      send(res, 500, { error: { message: "internal error of the stand-in", code: "1" } });
    }
  }
});

server.listen(PORT, () => {
  log(
    `listening on ${PORT}: scenario ${SCENARIO}, cluster ${S.cluster.name} (${S.cluster.release}), ` +
      `user ${JSON.stringify(USERNAME)} with a password of ${Array.from(PASSWORD).length} characters`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
