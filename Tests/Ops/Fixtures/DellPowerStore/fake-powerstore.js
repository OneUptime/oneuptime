"use strict";

/*
 * A stand-in for a Dell PowerStore cluster's REST API (PowerStoreOS 4.x,
 * `https://<cluster>/api/rest/...`), for the Storage Array Agent's behaviour
 * test (Tests/Ops/storage-array-agent-powerstore-behaviour.sh). Dell's own
 * powerstore-metrics-exporter v1.0.3, unmodified, polls it the way it polls an
 * array, and the agent's collector scrapes the exporter.
 *
 * What it answers, and where each shape comes from:
 *
 *   - Every resource and query the exporter's v1.0.3 source sends
 *     (collector/client/api.go, collector/bulkClient/api_bulk.go): the
 *     login, cluster, appliance, hardware by type, eth_port, fc_port, the
 *     volume, volume group and NAS server list views, nas_server,
 *     file_system, the Metro replication sessions and witnesses, POST
 *     metrics/generate for each entity, and the bulk five-minute metrics
 *     archive (latest_five_min_metrics/enable and /download).
 *   - Field names, enums and value shapes from Dell's PowerStore REST API
 *     reference (hardware_instance, HardwareLifecycleStateEnum,
 *     HardwareDriveTypeEnum, ClusterStateEnum, VolumeStateEnum,
 *     NASServerOperationalStatusEnum, FcPortSpeedEnum, EthPortSpeedEnum,
 *     MetricsEntityEnum), and from the recorded responses in the test
 *     fixtures of Dell's gopowerstore client and SODA Foundation's delfin
 *     PowerStore driver: names such as `BaseEnclosure-NodeA`,
 *     `Drive_0_0_24` and `BaseEnclosure-NodeA-IoModule0-FEPort2`, a down
 *     port's `current_speed: null`, a NVMe_NVRAM drive's 8484552704 bytes.
 *   - The bulk archive's CSV columns are the exporter's own (its
 *     api_bulk_model.go `csv` tags). Dell documents no sample archive, so
 *     its layout (one gzipped tar, one CSV per entity, one row per object)
 *     is the simplest the exporter reads.
 *
 * Guessed, because no source shows them: the names of fans, power supplies
 * and batteries (`BaseEnclosure-NodeA-Fan0`, `-PowerSupply`, `-Battery`,
 * after the pattern of the names above), every value, and how many samples
 * metrics/generate returns (three here; the exporter reads only the last).
 *
 * It checks HTTP Basic credentials against FAKE_POWERSTORE_USERNAME and
 * FAKE_POWERSTORE_PASSWORD and logs, never the password, whether they
 * matched exactly. Its session token and cookie are required on every
 * other call, as PowerStore requires them. FAKE_POWERSTORE_ROLE (Operator
 * or Storage Operator, the default) decides whether turning the bulk
 * archive on is allowed: Dell's README says an Operator cannot. A path it
 * does not know answers PowerStore's 404 and is logged as UNKNOWN.
 *
 * Environment: FAKE_POWERSTORE_CERT and FAKE_POWERSTORE_KEY (PEM paths),
 * FAKE_POWERSTORE_PORT (default 443), the credentials and role above.
 */

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const zlib = require("zlib");

const PORT = Number(process.env.FAKE_POWERSTORE_PORT || 443);
const USERNAME = process.env.FAKE_POWERSTORE_USERNAME || "oneuptime";
const PASSWORD = process.env.FAKE_POWERSTORE_PASSWORD || "";
const ROLE = process.env.FAKE_POWERSTORE_ROLE || "Storage Operator";

const TOKEN = crypto.randomBytes(16).toString("hex");
const COOKIE = crypto.randomBytes(24).toString("hex");

const TiB = 1024 ** 4;
const GiB = 1024 ** 3;

// ---------------------------------------------------------------- the cluster

const CLUSTER = {
  id: "0",
  global_id: "PS4f5c9a3d21e7",
  name: "ps-prod-01",
  physical_mtu: 1500,
  master_appliance_id: "A1",
  primary_appliance_id: "A1",
  state: "Configured",
  appliance_count: 2,
  management_address: "10.20.30.40",
  compatibility_level: 22,
  state_l10n: "Configured",
};

const APPLIANCES = [
  {
    id: "A1",
    name: "ps-prod-01-appliance-1",
    model: "PowerStore 3200T",
    service_tag: "7XKQ2T3",
    drive_failure_tolerance_level: "Single",
    nodes: [{ id: "N1" }, { id: "N2" }],
  },
  {
    id: "A2",
    name: "ps-prod-01-appliance-2",
    model: "PowerStore 3200T",
    service_tag: "9FHM4V2",
    drive_failure_tolerance_level: "Single",
    nodes: [{ id: "N3" }, { id: "N4" }],
  },
];

// A stable 32-hex-digit id per name, as PowerStore's hardware and port ids look.
function idFor(name) {
  return crypto.createHash("md5").update(name).digest("hex");
}

// A stable UUID per name, as PowerStore's volume, group and file ids look.
function uuidFor(name) {
  return idFor(name).replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    "$1-$2-$3-$4-$5",
  );
}

/*
 * Each appliance's parts. What is wrong today: appliance A1's drive in slot
 * 7 has failed and its node B power supply is disconnected; appliance A2's
 * node B fan 1 has failed.
 */
const BROKEN = {
  "A1/Drive_0_0_7": "Failed",
  "A1/BaseEnclosure-NodeB-PowerSupply": "Disconnected",
  "A2/BaseEnclosure-NodeB-Fan1": "Failed",
};

function lifecycle(applianceId, name) {
  return BROKEN[`${applianceId}/${name}`] || "Healthy";
}

const HARDWARE = [];
for (const appliance of APPLIANCES) {
  const a = appliance.id;
  HARDWARE.push({
    appliance_id: a,
    name: "BaseEnclosure",
    type: "Base_Enclosure",
    lifecycle_state: "Healthy",
    slot: 0,
    serial_number: `${appliance.service_tag}-BE`,
    extra_details: { dell_service_tag: appliance.service_tag },
  });
  for (const [slot, node] of ["NodeA", "NodeB"].entries()) {
    HARDWARE.push({
      appliance_id: a,
      name: `BaseEnclosure-${node}`,
      type: "Node",
      lifecycle_state: lifecycle(a, `BaseEnclosure-${node}`),
      slot,
      part_number: "110-558-301A-00",
      serial_number: `FXTSP2213${a === "A1" ? "006" : "009"}7${slot}`,
      extra_details: {
        physical_memory_size_gb: 384,
        cpu_model: "Intel(R) Xeon(R) Gold 6330 CPU @ 2.00GHz",
        cpu_cores: 28,
        cpu_sockets: 2,
      },
    });
    for (const fan of [0, 1]) {
      const name = `BaseEnclosure-${node}-Fan${fan}`;
      HARDWARE.push({
        appliance_id: a,
        name,
        type: "Fan",
        lifecycle_state: lifecycle(a, name),
        slot: fan,
      });
    }
    for (const [type, suffix] of [
      ["Power_Supply", "PowerSupply"],
      ["Battery", "Battery"],
    ]) {
      const name = `BaseEnclosure-${node}-${suffix}`;
      HARDWARE.push({
        appliance_id: a,
        name,
        type,
        lifecycle_state: lifecycle(a, name),
        slot,
      });
    }
  }
  // Ten NVMe SSDs in slots 0-9, and the two NVRAM drives in slots 23 and 24.
  for (let slot = 0; slot < 10; slot++) {
    const name = `Drive_0_0_${slot}`;
    HARDWARE.push({
      appliance_id: a,
      name,
      type: "Drive",
      lifecycle_state: lifecycle(a, name),
      slot,
      serial_number: `PHLP04010${a === "A1" ? 1 : 2}${slot}AK2P0A`,
      extra_details: {
        firmware_version: "VPV1ET0K",
        drive_type: "NVMe_SSD",
        size: 3840755982336,
        encryption_status: "Supported_Locked_Cluster_PIN",
        fips_status: "FIPS_Compliance_None",
      },
    });
  }
  for (const slot of [23, 24]) {
    const name = `Drive_0_0_${slot}`;
    HARDWARE.push({
      appliance_id: a,
      name,
      type: "Drive",
      lifecycle_state: lifecycle(a, name),
      slot,
      serial_number: `1A48F300A${a === "A1" ? "D" : "E"}${slot}`,
      extra_details: {
        firmware_version: "3.1.11.0",
        drive_type: "NVMe_NVRAM",
        size: 8484552704,
        encryption_status: "Disabled",
        fips_status: "FIPS_Compliance_None",
      },
    });
  }
}
for (const part of HARDWARE) {
  part.id = idFor(`hardware/${part.appliance_id}/${part.name}`);
}

// Percent endurance left, by appliance/drive: A1's slot 3 is nearly worn out.
function enduranceLeft(applianceId, name) {
  if (applianceId === "A1" && name === "Drive_0_0_3") {
    return 8;
  }
  if (name.endsWith("_23") || name.endsWith("_24")) {
    return 100;
  }
  return 97;
}

/*
 * Front-end ports, on each node of each appliance: a 4-port 25 GbE card
 * (ports 0 and 1 cabled) and the embedded service port; a 4-port 32 Gb
 * Fibre Channel module (ports 0 and 1 cabled). A2's node B Fibre Channel
 * port 1 lost its link.
 */
const ETH_PORTS = [];
const FC_PORTS = [];
for (const appliance of APPLIANCES) {
  for (const node of ["NodeA", "NodeB"]) {
    const nodeId = idFor(`hardware/${appliance.id}/BaseEnclosure-${node}`);
    for (let port = 0; port < 4; port++) {
      const up = port < 2;
      ETH_PORTS.push({
        appliance_id: appliance.id,
        name: `BaseEnclosure-${node}-4PortCard-FEPort${port}`,
        node_id: nodeId,
        is_link_up: up,
        current_speed: up ? "25_Gbps" : null,
        supported_speeds: ["Auto", "10_Gbps", "25_Gbps"],
        current_mtu: 9000,
        mac_address: idFor(`mac/${appliance.id}/${node}/${port}`).slice(0, 12),
      });
    }
    ETH_PORTS.push({
      appliance_id: appliance.id,
      name: `BaseEnclosure-${node}-EmbeddedModule-ServicePort`,
      node_id: nodeId,
      is_link_up: true,
      current_speed: "1_Gbps",
      supported_speeds: ["Auto", "10_Mbps", "100_Mbps", "1_Gbps"],
      current_mtu: 1500,
      mac_address: idFor(`mac/${appliance.id}/${node}/service`).slice(0, 12),
    });
    for (let port = 0; port < 4; port++) {
      const lostLink =
        appliance.id === "A2" && node === "NodeB" && port === 1;
      const up = port < 2 && !lostLink;
      FC_PORTS.push({
        appliance_id: appliance.id,
        name: `BaseEnclosure-${node}-IoModule0-FEPort${port}`,
        node_id: nodeId,
        is_link_up: up,
        current_speed: up ? "32_Gbps" : null,
        supported_speeds: ["Auto", "8_Gbps", "16_Gbps", "32_Gbps"],
        wwn: `58:cc:f0:90:4d:2${port}:1${appliance.id === "A1" ? 9 : 8}:fb`,
        port_connector_type: "LC",
      });
    }
  }
}
for (const port of ETH_PORTS) {
  port.id = idFor(`eth/${port.appliance_id}/${port.name}`);
}
for (const port of FC_PORTS) {
  port.id = idFor(`fc/${port.appliance_id}/${port.name}`);
}

// Block volumes, by appliance. archive-legacy is offline.
const VOLUMES = [
  ["A1", "oracle-prod-data", 4 * TiB, 2.9 * TiB, "Ready"],
  ["A1", "oracle-prod-redo", 512 * GiB, 210 * GiB, "Ready"],
  ["A1", "vmware-ds-01", 10 * TiB, 7.2 * TiB, "Ready"],
  ["A1", "vmware-ds-02", 10 * TiB, 3.1 * TiB, "Ready"],
  ["A1", "sql-prod-01", 2 * TiB, 1.4 * TiB, "Ready"],
  ["A2", "vdi-gold-01", 4 * TiB, 1.1 * TiB, "Ready"],
  ["A2", "backup-landing", 20 * TiB, 18.6 * TiB, "Ready"],
  ["A2", "sql-prod-logs", 512 * GiB, 120 * GiB, "Ready"],
  ["A2", "archive-legacy", 1 * TiB, 0.6 * TiB, "Offline"],
].map(([appliance_id, name, size, logicalUsed, state], index) => {
  return {
    id: uuidFor(`volume/${name}`),
    name,
    appliance_id,
    state,
    type: "Primary",
    size: Math.round(size),
    logical_used: Math.round(logicalUsed),
    wwn: `naa.68ccf0980048d7ab86ec9f7fdfa99${String(index).padStart(3, "0")}`,
  };
});

// Volume groups: the SQL group spans both appliances.
const VOLUME_GROUPS = [
  ["vg-oracle-prod", ["A1"], 4.5 * TiB, 3.11 * TiB],
  ["vg-sql-prod", ["A1", "A2"], 2.5 * TiB, 1.52 * TiB],
].map(([name, appliance_ids, provisioned, used]) => {
  return {
    id: uuidFor(`vg/${name}`),
    name,
    appliance_ids,
    logical_provisioned: Math.round(provisioned),
    logical_used: Math.round(used),
  };
});

// NAS servers: the second runs without its backup node.
const NAS_SERVERS = [
  ["nas-prod-01", "Started"],
  ["nas-files-02", "Degraded"],
].map(([name, operational_status]) => {
  return {
    id: uuidFor(`nas/${name}`),
    name,
    operational_status,
    current_node_id: "N1",
  };
});

// File systems: fs-home is nearly full.
const FILE_SYSTEMS = [
  ["fs-home", 2 * TiB, 1.89 * TiB, 1.4],
  ["fs-projects", 10 * TiB, 4.1 * TiB, 2.1],
  ["fs-archive", 20 * TiB, 9 * TiB, 1.2],
].map(([name, provisioned, used, thinSavings]) => {
  return {
    id: uuidFor(`fs/${name}`),
    name,
    provisioned: Math.round(provisioned),
    used: Math.round(used),
    thinSavings,
  };
});

// Metro: one session, engaged; its witness reaches only some nodes.
const METRO_SESSIONS = [
  {
    id: "3d6f2b0e-8a41-4c9e-9b57-2f1a6e0c4d18",
    type: "Metro_Active_Active",
    state: "OK",
    witness_details: { state: "Engaged" },
  },
];
const WITNESSES = [
  {
    id: "e5b8c2d1-4f7a-4e6b-8c3d-9a0f1b2c3d4e",
    name: "witness-dc3",
    address: "10.20.99.5",
    state: "Partially_Connected",
    connections: [
      { node_id: "N1", state: "OK" },
      { node_id: "N2", state: "OK" },
      { node_id: "N3", state: "OK" },
      { node_id: "N4", state: "Disconnected" },
    ],
  },
];

// -------------------------------------------------------------- the metrics

// Each appliance's latest five-minute performance: A2 reads slowly.
const APPLIANCE_PERFORMANCE = {
  A1: {
    avg_read_latency: 412.6,
    avg_write_latency: 638.2,
    avg_latency: 498.4,
    avg_read_iops: 18240.5,
    avg_write_iops: 9120.25,
    avg_total_iops: 27360.75,
    avg_read_bandwidth: 1195376640,
    avg_write_bandwidth: 597688320,
    avg_total_bandwidth: 1793064960,
    avg_io_workload_cpu_utilization: 38.5,
    avg_io_size: 65536,
    avg_read_size: 65536,
    avg_write_size: 65536,
  },
  A2: {
    avg_read_latency: 6214.9,
    avg_write_latency: 911.3,
    avg_latency: 4123.7,
    avg_read_iops: 7310.0,
    avg_write_iops: 2480.5,
    avg_total_iops: 9790.5,
    avg_read_bandwidth: 479068160,
    avg_write_bandwidth: 81264640,
    avg_total_bandwidth: 560332800,
    avg_io_workload_cpu_utilization: 71.25,
    avg_io_size: 57232,
    avg_read_size: 65536,
    avg_write_size: 32768,
  },
};

// Each appliance's daily space rollup: A2 is 92% full.
const APPLIANCE_SPACE = {
  A1: {
    physical_total: 92363213692928,
    physical_used: 71124373159117,
    data_physical_used: 65170000000000,
    logical_provisioned: 288230376151711,
    logical_used: 221589000000000,
    shared_logical_used: 180000000000000,
    efficiency_ratio: 6.12,
    data_reduction: 3.4,
    snapshot_savings: 1.31,
    thin_savings: 1.37,
  },
  A2: {
    physical_total: 92363213692928,
    physical_used: 85061518991360,
    data_physical_used: 80100000000000,
    logical_provisioned: 211106232532992,
    logical_used: 232290000000000,
    shared_logical_used: 190000000000000,
    efficiency_ratio: 4.81,
    data_reduction: 2.9,
    snapshot_savings: 1.12,
    thin_savings: 1.48,
  },
};

// A sample of an object's five-minute performance, from its index.
function blockPerformance(seed, scale) {
  const readLatency = 300 + ((seed * 137) % 900);
  const writeLatency = 450 + ((seed * 211) % 1100);
  const readIops = Math.round((1200 + ((seed * 389) % 5000)) * scale);
  const writeIops = Math.round((600 + ((seed * 263) % 3000)) * scale);
  return {
    avg_read_latency: readLatency,
    avg_write_latency: writeLatency,
    avg_latency: Math.round((readLatency + writeLatency) / 2),
    avg_read_iops: readIops,
    avg_write_iops: writeIops,
    avg_total_iops: readIops + writeIops,
    avg_read_bandwidth: readIops * 32768,
    avg_write_bandwidth: writeIops * 16384,
    avg_total_bandwidth: readIops * 32768 + writeIops * 16384,
    avg_io_size: 24576,
    avg_read_size: 32768,
    avg_write_size: 16384,
  };
}

// The same, with the file and NAS spelling of the average I/O size.
function filePerformance(seed) {
  const performance = blockPerformance(seed, 0.4);
  const { avg_io_size, ...rest } = performance;
  return { ...rest, avg_size: avg_io_size };
}

function fcPortPerformance(port, index) {
  if (!port.is_link_up) {
    return {
      avg_read_latency: 0,
      avg_write_latency: 0,
      avg_latency: 0,
      avg_total_iops: 0,
      avg_total_bandwidth: 0,
      avg_dumped_frames_ps: 0,
      avg_loss_of_signal_count_ps: 0,
      avg_invalid_crc_count_ps: 0,
      avg_loss_of_sync_count_ps: 0,
      avg_invalid_tx_word_count_ps: 0,
      avg_prim_seq_prot_err_count_ps: 0,
      avg_link_failure_count_ps: 0,
    };
  }
  const crc =
    port.appliance_id === "A2" && port.name.includes("NodeA-IoModule0-FEPort0")
      ? 0.4
      : 0;
  return {
    avg_read_latency: 180 + index * 7,
    avg_write_latency: 240 + index * 9,
    avg_latency: 210 + index * 8,
    avg_total_iops: 4200 + index * 310,
    avg_total_bandwidth: (4200 + index * 310) * 32768,
    avg_dumped_frames_ps: 0,
    avg_loss_of_signal_count_ps: 0,
    avg_invalid_crc_count_ps: crc,
    avg_loss_of_sync_count_ps: 0,
    avg_invalid_tx_word_count_ps: crc ? 0.2 : 0,
    avg_prim_seq_prot_err_count_ps: 0,
    avg_link_failure_count_ps: 0,
  };
}

function ethPortPerformance(port, index) {
  if (!port.is_link_up) {
    return {
      avg_bytes_rx_ps: 0,
      avg_bytes_tx_ps: 0,
      avg_pkt_rx_ps: 0,
      avg_pkt_tx_ps: 0,
      avg_pkt_rx_crc_error_ps: 0,
      avg_pkt_rx_no_buffer_error_ps: 0,
      avg_pkt_tx_error_ps: 0,
    };
  }
  return {
    avg_bytes_rx_ps: 120000000 + index * 1500000,
    avg_bytes_tx_ps: 95000000 + index * 1100000,
    avg_pkt_rx_ps: 14000 + index * 100,
    avg_pkt_tx_ps: 11800 + index * 90,
    avg_pkt_rx_crc_error_ps: 0,
    avg_pkt_rx_no_buffer_error_ps: 0,
    avg_pkt_tx_error_ps: 0,
  };
}

function nowFiveMinutes(offsetSteps) {
  const step = 5 * 60 * 1000;
  return new Date(
    Math.floor(Date.now() / step) * step - offsetSteps * step,
  ).toISOString();
}

// Three five-minute samples, oldest first, the last one the current values.
function fiveMinuteSeries(entity, ids, values) {
  return [2, 1, 0].map((offset) => {
    const factor = offset === 0 ? 1 : 1 - offset * 0.03;
    const sample = {};
    for (const [key, value] of Object.entries(values)) {
      sample[key] =
        typeof value === "number" && offset !== 0
          ? Math.round(value * factor * 100) / 100
          : value;
    }
    return {
      ...ids,
      timestamp: nowFiveMinutes(offset),
      ...sample,
      repeat_count: 1,
      entity,
      response_definition: entity,
    };
  });
}

// The daily space rollups metrics/generate answers for One_Day.
function dailySpace(applianceId) {
  const space = APPLIANCE_SPACE[applianceId];
  const day = 24 * 60 * 60 * 1000;
  return [1, 0].map((offset) => {
    const start = new Date(Math.floor(Date.now() / day) * day - offset * day);
    const shrink = offset === 0 ? 1 : 0.995;
    const sample = {
      appliance_id: applianceId,
      timestamp: start.toISOString(),
      repeat_count: 1,
      entity: "space_metrics_by_appliance",
      response_definition: "space_metrics_by_appliance",
    };
    for (const [key, value] of Object.entries(space)) {
      sample[`last_${key}`] = Math.round(value * shrink * 100) / 100;
      sample[`max_${key}`] = Math.round(value * shrink * 100) / 100;
    }
    return sample;
  });
}

function findBy(list, id) {
  return list.find((item) => item.id === id);
}

function generateMetrics(body) {
  const { entity, entity_id: id, interval } = body;
  switch (entity) {
    case "performance_metrics_by_appliance":
      return APPLIANCE_PERFORMANCE[id]
        ? fiveMinuteSeries(entity, { appliance_id: id }, APPLIANCE_PERFORMANCE[id])
        : null;
    case "space_metrics_by_appliance":
      if (interval !== "One_Day") {
        return null;
      }
      return APPLIANCE_SPACE[id] ? dailySpace(id) : null;
    case "performance_metrics_by_volume": {
      const volume = findBy(VOLUMES, id);
      if (!volume) {
        return null;
      }
      const index = VOLUMES.indexOf(volume);
      return fiveMinuteSeries(
        entity,
        { volume_id: volume.id, appliance_id: volume.appliance_id },
        volume.state === "Ready" ? blockPerformance(index + 1, 1) : blockPerformance(0, 0),
      );
    }
    case "performance_metrics_by_vg": {
      const group = findBy(VOLUME_GROUPS, id);
      return group
        ? fiveMinuteSeries(entity, { vg_id: group.id }, blockPerformance(VOLUME_GROUPS.indexOf(group) + 11, 2))
        : null;
    }
    case "performance_metrics_by_fe_fc_port": {
      const port = findBy(FC_PORTS, id);
      return port
        ? fiveMinuteSeries(
            entity,
            { fe_port_id: port.id, appliance_id: port.appliance_id, node_id: port.node_id },
            fcPortPerformance(port, FC_PORTS.indexOf(port)),
          )
        : null;
    }
    case "performance_metrics_by_fe_eth_port": {
      const port = findBy(ETH_PORTS, id);
      return port
        ? fiveMinuteSeries(
            entity,
            { fe_port_id: port.id, appliance_id: port.appliance_id, node_id: port.node_id },
            ethPortPerformance(port, ETH_PORTS.indexOf(port)),
          )
        : null;
    }
    case "wear_metrics_by_drive": {
      const drive = HARDWARE.find((part) => part.id === id && part.type === "Drive");
      return drive
        ? fiveMinuteSeries(
            entity,
            { drive_id: drive.id, appliance_id: drive.appliance_id },
            { percent_endurance_remaining: enduranceLeft(drive.appliance_id, drive.name) },
          )
        : null;
    }
    case "performance_metrics_by_nas_server": {
      const nas = findBy(NAS_SERVERS, id);
      return nas
        ? fiveMinuteSeries(entity, { nas_server_id: nas.id }, filePerformance(NAS_SERVERS.indexOf(nas) + 21))
        : null;
    }
    case "space_metrics_by_file_system": {
      const fileSystem = findBy(FILE_SYSTEMS, id);
      return fileSystem
        ? fiveMinuteSeries(
            entity,
            { file_system_id: fileSystem.id },
            {
              logical_provisioned: fileSystem.provisioned,
              logical_used: fileSystem.used,
              thin_savings: fileSystem.thinSavings,
            },
          )
        : null;
    }
    case "performance_metrics_by_file_system": {
      const fileSystem = findBy(FILE_SYSTEMS, id);
      return fileSystem
        ? fiveMinuteSeries(entity, { file_system_id: fileSystem.id }, filePerformance(FILE_SYSTEMS.indexOf(fileSystem) + 31))
        : null;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------ the bulk archive

function csv(columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const value = row[column];
          return value === undefined || value === null ? "0" : String(value);
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

const PERFORMANCE_COLUMNS = [
  "avg_read_latency",
  "avg_read_size",
  "avg_latency",
  "avg_write_latency",
  "avg_write_size",
  "avg_read_iops",
  "avg_read_bandwidth",
  "avg_total_iops",
  "avg_total_bandwidth",
  "avg_write_iops",
  "avg_write_bandwidth",
  "avg_io_size",
];

function bulkFiles() {
  const timestamp = nowFiveMinutes(0);
  return {
    "performance_metrics_by_appliance.csv": csv(
      ["appliance_id", "timestamp", ...PERFORMANCE_COLUMNS, "avg_io_workload_cpu_utilization"],
      APPLIANCES.map((appliance) => {
        return { appliance_id: appliance.id, timestamp, ...APPLIANCE_PERFORMANCE[appliance.id] };
      }),
    ),
    "performance_metrics_by_volume.csv": csv(
      ["volume_id", "appliance_id", "timestamp", ...PERFORMANCE_COLUMNS],
      VOLUMES.map((volume, index) => {
        return {
          volume_id: volume.id,
          appliance_id: volume.appliance_id,
          timestamp,
          ...(volume.state === "Ready" ? blockPerformance(index + 1, 1) : blockPerformance(0, 0)),
        };
      }),
    ),
    "performance_metrics_by_vg.csv": csv(
      ["timestamp", "vg_id", ...PERFORMANCE_COLUMNS],
      VOLUME_GROUPS.map((group, index) => {
        return { vg_id: group.id, timestamp, ...blockPerformance(index + 11, 2) };
      }),
    ),
    "performance_metrics_by_fe_fc_port.csv": csv(
      [
        "fe_port_id",
        "node_id",
        "timestamp",
        "appliance_id",
        "avg_read_latency",
        "avg_latency",
        "avg_write_latency",
        "avg_total_iops",
        "avg_total_bandwidth",
        "avg_dumped_frames_ps",
        "avg_loss_of_signal_count_ps",
        "avg_invalid_crc_count_ps",
        "avg_loss_of_sync_count_ps",
        "avg_invalid_tx_word_count_ps",
        "avg_prim_seq_prot_err_count_ps",
        "avg_link_failure_count_ps",
      ],
      FC_PORTS.map((port, index) => {
        return {
          fe_port_id: port.id,
          node_id: port.node_id,
          appliance_id: port.appliance_id,
          timestamp,
          ...fcPortPerformance(port, index),
        };
      }),
    ),
    "performance_metrics_by_fe_eth_port.csv": csv(
      [
        "fe_port_id",
        "node_id",
        "timestamp",
        "avg_pkt_rx_ps",
        "avg_pkt_tx_ps",
        "avg_bytes_tx_ps",
        "avg_bytes_rx_ps",
        "avg_pkt_rx_no_buffer_error_ps",
        "avg_pkt_rx_crc_error_ps",
        "avg_pkt_tx_error_ps",
        "appliance_id",
      ],
      ETH_PORTS.map((port, index) => {
        return {
          fe_port_id: port.id,
          node_id: port.node_id,
          appliance_id: port.appliance_id,
          timestamp,
          ...ethPortPerformance(port, index),
        };
      }),
    ),
    "performance_metrics_by_nas_server.csv": csv(
      [
        "nas_server_id",
        "timestamp",
        "avg_read_iops",
        "avg_write_iops",
        "avg_total_iops",
        "avg_read_bandwidth",
        "avg_write_bandwidth",
        "avg_total_bandwidth",
        "avg_read_latency",
        "avg_write_latency",
        "avg_latency",
        "avg_read_size",
        "avg_write_size",
        "avg_size",
      ],
      NAS_SERVERS.map((nas, index) => {
        return { nas_server_id: nas.id, timestamp, ...filePerformance(index + 21) };
      }),
    ),
    "performance_metrics_by_file_system.csv": csv(
      [
        "file_system_id",
        "timestamp",
        "avg_read_iops",
        "avg_write_iops",
        "avg_total_iops",
        "avg_read_bandwidth",
        "avg_write_bandwidth",
        "avg_total_bandwidth",
        "avg_read_latency",
        "avg_write_latency",
        "avg_latency",
        "avg_read_size",
        "avg_write_size",
        "avg_size",
      ],
      FILE_SYSTEMS.map((fileSystem, index) => {
        return { file_system_id: fileSystem.id, timestamp, ...filePerformance(index + 31) };
      }),
    ),
    "space_metrics_by_appliance.csv": csv(
      [
        "appliance_id",
        "timestamp",
        "logical_provisioned",
        "logical_used",
        "physical_total",
        "physical_used",
        "efficiency_ratio",
        "data_reduction",
        "snapshot_savings",
        "thin_savings",
      ],
      APPLIANCES.map((appliance) => {
        const space = APPLIANCE_SPACE[appliance.id];
        return { appliance_id: appliance.id, timestamp, ...space };
      }),
    ),
    "space_metrics_by_file_system.csv": csv(
      ["file_system_id", "timestamp", "logical_provisioned", "logical_used", "thin_savings"],
      FILE_SYSTEMS.map((fileSystem) => {
        return {
          file_system_id: fileSystem.id,
          timestamp,
          logical_provisioned: fileSystem.provisioned,
          logical_used: fileSystem.used,
          thin_savings: fileSystem.thinSavings,
        };
      }),
    ),
    "wear_metrics_by_drive.csv": csv(
      ["drive_id", "timestamp", "percent_endurance_remaining", "appliance_id"],
      HARDWARE.filter((part) => part.type === "Drive").map((drive) => {
        return {
          drive_id: drive.id,
          timestamp,
          percent_endurance_remaining: enduranceLeft(drive.appliance_id, drive.name),
          appliance_id: drive.appliance_id,
        };
      }),
    ),
  };
}

// A ustar header and the file, padded to 512-byte blocks.
function tarEntry(name, content) {
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write(
    Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0",
    136,
    12,
    "ascii",
  );
  header.write("        ", 148, 8, "ascii");
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

function bulkArchive() {
  const entries = Object.entries(bulkFiles()).map(([name, content]) => {
    return tarEntry(name, content);
  });
  return zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024, 0)]));
}

// ----------------------------------------------------------------- serving

function sendJson(res, status, body, headers) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...(headers || {}),
  });
  res.end(text);
}

function error(status, code, message) {
  return {
    status,
    body: { messages: [{ severity: "Error", code, message_l10n: message }] },
  };
}

// The objects a `select=` asks for: only `id,name` (and `appliance_ids`) or all.
function selected(items, query) {
  const select = query.get("select");
  if (!select || select === "*") {
    return items;
  }
  const fields = select.split(",");
  return items.map((item) => {
    const picked = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        picked[field] = item[field];
      }
    }
    return picked;
  });
}

function limited(items, query) {
  const limit = Number(query.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? items.slice(0, limit) : items;
}

function listOf(items, query) {
  return { status: 200, body: limited(selected(items, query), query) };
}

function basicCredentials(req) {
  const header = req.headers["authorization"] || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) {
    return null;
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) {
    return null;
  }
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function hasSession(req) {
  const token = req.headers["dell-emc-token"];
  const cookie = req.headers["cookie"] || "";
  return token === TOKEN && cookie.includes(`auth_cookie=${COOKIE}`);
}

function basicMatches(req, path) {
  const credentials = basicCredentials(req);
  if (!credentials) {
    console.log(`AUTH ${path} no basic credentials`);
    return false;
  }
  const userMatches = credentials.user === USERNAME;
  const passwordMatches = credentials.password === PASSWORD;
  console.log(
    `AUTH ${path} user ${userMatches ? "matched" : "did not match"}, password ${
      passwordMatches ? "matched exactly" : "did not match"
    }`,
  );
  return userMatches && passwordMatches;
}

function handle(req, bodyText) {
  const url = new URL(req.url, "https://powerstore.invalid");
  const path = url.pathname;
  const query = url.searchParams;

  if (!path.startsWith("/api/rest/")) {
    return error(404, "0xE04040020009", "Resource not found.");
  }
  const resource = path.slice("/api/rest/".length);

  if (resource === "login_session" && req.method === "GET") {
    if (!basicMatches(req, path)) {
      return error(401, "0xE09010010001", "Authentication failed.");
    }
    return {
      status: 200,
      body: [
        {
          id: crypto.randomUUID(),
          user: USERNAME,
          role_ids: [ROLE === "Operator" ? "4" : "6"],
          is_password_change_required: false,
          is_built_in_user: false,
          idle_timeout: 3600,
        },
      ],
      headers: {
        "DELL-EMC-TOKEN": TOKEN,
        "Set-Cookie": `auth_cookie=${COOKIE}; Path=/; Secure; HttpOnly`,
      },
    };
  }

  // The bulk archive authenticates each call with Basic credentials.
  if (resource.startsWith("latest_five_min_metrics/")) {
    if (req.method !== "POST" || !basicMatches(req, path)) {
      return error(401, "0xE09010010001", "Authentication failed.");
    }
    if (resource === "latest_five_min_metrics/enable") {
      if (ROLE === "Operator") {
        return error(
          403,
          "0xE09040020002",
          "The user does not have the privileges to perform this operation.",
        );
      }
      return { status: 204 };
    }
    if (resource === "latest_five_min_metrics/download") {
      if (ROLE === "Operator") {
        return error(
          403,
          "0xE09040020002",
          "The user does not have the privileges to perform this operation.",
        );
      }
      return {
        status: 200,
        raw: bulkArchive(),
        headers: { "Content-Type": "application/gzip" },
      };
    }
    return error(404, "0xE04040020009", "Resource not found.");
  }

  if (!hasSession(req)) {
    return error(401, "0xE09010010002", "The session token is not valid.");
  }

  if (resource === "metrics/generate" && req.method === "POST") {
    let request = null;
    try {
      request = JSON.parse(bodyText || "{}");
    } catch {
      return error(400, "0xE04040010001", "Unable to parse the request body.");
    }
    const samples = generateMetrics(request);
    if (!samples) {
      return error(
        422,
        "0xE04040030001",
        `No metrics for ${request.entity} ${request.entity_id} at ${request.interval}.`,
      );
    }
    return { status: 200, body: samples };
  }

  if (req.method !== "GET") {
    return error(405, "0xE04040010005", "Method not allowed.");
  }

  switch (resource) {
    case "cluster":
      return listOf([CLUSTER], query);
    case "appliance":
      return listOf(APPLIANCES, query);
    case "hardware": {
      const type = (query.get("type") || "").replace(/^eq\./, "");
      return listOf(
        HARDWARE.filter((part) => !type || part.type === type),
        query,
      );
    }
    case "eth_port":
      return listOf(ETH_PORTS, query);
    case "fc_port":
      return listOf(FC_PORTS, query);
    case "volume_list_cma_view":
      return listOf(VOLUMES, query);
    case "volume_group_list_cma_view":
      return listOf(VOLUME_GROUPS, query);
    case "nas_server":
    case "nas_server_list_cma_view":
      return listOf(NAS_SERVERS, query);
    case "file_system":
      return listOf(
        FILE_SYSTEMS.map((fileSystem) => {
          return { id: fileSystem.id, name: fileSystem.name };
        }),
        query,
      );
    case "replication_session": {
      const type = (query.get("type") || "").replace(/^eq\./, "");
      return listOf(
        METRO_SESSIONS.filter((session) => !type || session.type === type),
        query,
      );
    }
    case "witness":
      return listOf(WITNESSES, query);
    default:
      console.log(`UNKNOWN ${req.method} ${req.url}`);
      return error(404, "0xE04040020009", "Resource not found.");
  }
}

const server = https.createServer(
  {
    cert: fs.readFileSync(process.env.FAKE_POWERSTORE_CERT),
    key: fs.readFileSync(process.env.FAKE_POWERSTORE_KEY),
  },
  (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let answer;
      try {
        answer = handle(req, Buffer.concat(chunks).toString("utf8"));
      } catch (err) {
        console.log(`ERROR ${req.method} ${req.url} ${err && err.stack}`);
        answer = error(500, "0xE04040000000", "Internal error.");
      }
      console.log(`${req.method} ${req.url} ${answer.status}`);
      if (answer.raw) {
        res.writeHead(answer.status, answer.headers || {});
        res.end(answer.raw);
        return;
      }
      if (answer.status === 204) {
        res.writeHead(204, answer.headers || {});
        res.end();
        return;
      }
      sendJson(res, answer.status, answer.body, answer.headers);
    });
  },
);

server.listen(PORT, () => {
  console.log(`fake PowerStore listening on ${PORT}, role ${ROLE}`);
});
