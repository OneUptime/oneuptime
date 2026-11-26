import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import DellPowerScalePlatform, {
  POWERSCALE_NODE_KIND,
  POWERSCALE_QUOTA_KIND,
} from "../../../../../Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform";
import {
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markStorageArrayKindComplete,
} from "../StorageArrayExtractor";

/*
 * DELL POWERSCALE: one powerscale_* datapoint into the cluster's inventory
 * and snapshot (#11003).
 *
 * The Storage Array Agent polls ISILON-MIB over SNMP
 * (agents/StorageArrayAgent/otel-collector-config.powerscale.yaml) and
 * names what each series describes in its labels:
 *
 *   - the cluster's poll (`scrape_endpoint: cluster`): its name, GUID,
 *     OneFS version, health and capacity, and its configured, online and
 *     offline nodes as comma-separated logical node numbers (LNNs);
 *   - the quotas' poll (`scrape_endpoint: quotas`): one series per quota,
 *     with its path, kind, owner and limits as labels;
 *   - each node's own poll (`node`: its host name): its health, throughput,
 *     CPU, chassis and protocols, and its drives (`drive`: "<node> bay
 *     <n>"), fans, sensors and ports.
 *
 * A cluster's poll is the complete list of its nodes and a quotas' poll of
 * its quotas (StorageArrayPlatform.scrapeEndpoints says so): the extractor
 * marks each complete from the series themselves - the configured nodes
 * listed, a quota's usage - so a poll that lists nothing never zeroes a
 * count. A node's poll lists only its own drives, sensors and ports, so it
 * completes no kind.
 */

// OneFS's health, cluster and node alike.
const HEALTH_STATUSES: Record<number, string> = {
  0: "healthy",
  1: "attention",
  2: "down",
  3: "invalid",
};

// ISILON-MIB quotaType.
const QUOTA_TYPES: Record<string, string> = {
  "0": "default-user",
  "1": "user",
  "2": "default-group",
  "3": "group",
  "4": "directory",
  "5": "special",
};

// IF-MIB ifOperStatus.
const INTERFACE_STATUSES: Record<number, string> = {
  1: "up",
  2: "down",
  3: "testing",
  4: "unknown",
  5: "dormant",
  6: "not_present",
  7: "down",
};

// IF-MIB ifType, for the ports a OneFS node has.
const INTERFACE_TYPES: Record<string, string> = {
  "6": "ethernet",
  "53": "virtual",
  "135": "vlan",
  "161": "aggregate",
  "199": "infiniband",
};

// The OneFS version in a node's sysDescr: "<node> <id> Isilon OneFS v9.11.0.0".
const ONEFS_VERSION: RegExp = /\bOneFS\s+v?(\d+(?:\.\d+)+)/i;

// A node's logical node number, which OneFS puts at the end of its name.
const TRAILING_LNN: RegExp = /-(\d+)$/;

// A whole number, as a label carries one ("10995116277760").
const DIGITS: RegExp = /^\d+$/;

// FreeBSD names an NVMe drive nvd<n> or nvme<n>.
const NVME_DEVICE: RegExp = /\bnv(d|me)\d/;

// A power sensor that reads amps rather than volts, by its name.
const CURRENT_SENSOR: RegExp = /current|amp/i;

function parseOneFsVersion(systemDescription: string | null): string | null {
  if (!systemDescription) {
    return null;
  }
  const match: RegExpExecArray | null = ONEFS_VERSION.exec(systemDescription);
  return match ? match[1]! : null;
}

// "1,2,4" (or "1, 2, 4") as logical node numbers; nothing for "" or junk.
export function parseNodeList(value: string | null): Array<number> {
  if (!value) {
    return [];
  }
  const numbers: Array<number> = [];
  for (const part of value.split(",")) {
    const trimmed: string = part.trim();
    if (DIGITS.test(trimmed)) {
      const lnn: number = Number(trimmed);
      if (!numbers.includes(lnn)) {
        numbers.push(lnn);
      }
    }
  }
  return numbers;
}

function whole(value: number): number {
  return Math.max(0, Math.trunc(value));
}

// A byte count a label carries ("10995116277760"), or null.
function labelBytes(series: StorageArraySeries, key: string): number | null {
  const value: string | null = series.label(key);
  if (!value || !DIGITS.test(value)) {
    return null;
  }
  return Number(value);
}

function labelIsYes(series: StorageArraySeries, key: string): boolean {
  return series.label(key) === "1";
}

// ---------------- The cluster ----------------

/*
 * The cluster's identity series: who it is, how healthy OneFS says it is,
 * and its nodes. Its health counts as an open alert while it is not OK, so
 * the array's health and the Active Alerts card follow OneFS's.
 */
function readClusterHealth(series: StorageArraySeries): void {
  const array: StorageArraySeries["array"] = series.array;
  const clusterName: string | null = series.label("cluster");
  array.reportedName = array.reportedName || clusterName;
  array.systemId = array.systemId || series.label("cluster_guid");
  const version: string | null = parseOneFsVersion(
    series.label("system_description"),
  );
  if (version) {
    array.osName = array.osName || "OneFS";
    array.osVersion = array.osVersion || version;
  }

  // The cluster's own poll: its health is the whole of its alert list.
  array.sawAlerts = true;

  const health: number = Math.trunc(series.value);
  if (health > 0) {
    const key: string = `cluster-health:${HEALTH_STATUSES[health] || health}`;
    array.openAlertKeys.add(key);
    if (health === 2) {
      array.criticalAlertKeys.add(key);
    } else {
      array.warningAlertKeys.add(key);
    }
  }

  const configured: Array<number> = parseNodeList(
    series.label("configured_nodes"),
  );
  if (!clusterName || configured.length === 0) {
    return;
  }
  /*
   * Every configured node, named the way OneFS names nodes
   * (<cluster>-<LNN>), which is the name a node's own poll reports. The
   * cluster says only which are offline: a node's health comes from its
   * own poll, so an online node's status is left to it.
   */
  markStorageArrayKindComplete(array, POWERSCALE_NODE_KIND);
  const offline: Array<number> = parseNodeList(series.label("offline_nodes"));
  for (const lnn of configured) {
    const name: string = `${clusterName}-${lnn}`;
    const patch: StorageArrayResourceBufferEntry = series.newResource(
      POWERSCALE_NODE_KIND,
      name,
    );
    patch.name = name;
    patch.details["lnn"] = lnn;
    if (offline.includes(lnn)) {
      patch.status = "offline";
    }
    series.fold(patch);
  }
}

function readCapacity(series: StorageArraySeries): void {
  const array: StorageArraySeries["array"] = series.array;
  if (series.metricName === "powerscale_ifs_total_bytes") {
    array.capacityBytes = Math.max(0, series.value);
  } else if (series.metricName === "powerscale_ifs_available_bytes") {
    array.emptyBytes = Math.max(0, series.value);
  } else if (series.metricName === "powerscale_ifs_used_percent") {
    array.utilizationPercent = Math.min(100, Math.max(0, series.value));
  }
}

// ---------------- Quotas ----------------

// The name a quota's series carry, or one made the same way from its labels.
function quotaName(series: StorageArraySeries): string | null {
  const name: string | null = series.label("quota");
  if (name) {
    return name;
  }
  const path: string | null = series.label("path");
  if (!path) {
    return null;
  }
  const type: string | null = series.label("type");
  const id: string | null = series.label("id");
  if (type === "4" || type === null) {
    return path;
  }
  if ((type === "1" || type === "3") && id) {
    return `${path} (${type === "1" ? "user" : "group"} ${id})`;
  }
  return `${path} (${(QUOTA_TYPES[type] || type).replace("-", " ")})`;
}

/*
 * The limit that stops writes: the hard one, or the soft one (after its
 * grace period) when there is no hard one. A quota with neither only
 * counts what it holds.
 */
function enforcedLimit(series: StorageArraySeries): number | null {
  const hard: number | null = labelIsYes(series, "hard_defined")
    ? labelBytes(series, "hard_limit")
    : null;
  if (hard !== null && hard > 0) {
    return hard;
  }
  const soft: number | null = labelIsYes(series, "soft_defined")
    ? labelBytes(series, "soft_limit")
    : null;
  if (soft !== null && soft > 0) {
    return soft;
  }
  return null;
}

/*
 * Where a quota stands against its limits, worst first: at its hard limit
 * writes are refused (full), past its soft limit they will be once the
 * grace period ends, and past its advisory limit OneFS only notifies.
 */
export function getQuotaStatus(data: {
  usageBytes: number;
  hardLimitBytes: number | null;
  softLimitBytes: number | null;
  advisoryLimitBytes: number | null;
}): string {
  if (data.hardLimitBytes && data.usageBytes >= data.hardLimitBytes) {
    return "full";
  }
  if (data.softLimitBytes && data.usageBytes > data.softLimitBytes) {
    return "over_soft_limit";
  }
  if (data.advisoryLimitBytes && data.usageBytes > data.advisoryLimitBytes) {
    return "over_advisory_limit";
  }
  return "ok";
}

function readQuota(series: StorageArraySeries): void {
  const name: string | null = quotaName(series);
  if (!name) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    POWERSCALE_QUOTA_KIND,
    name,
  );
  patch.name = name;
  const path: string | null = series.label("path");
  if (path) {
    patch.groupName = path;
    patch.details["path"] = path;
  }
  const type: string | null = series.label("type");
  if (type !== null) {
    patch.componentType = QUOTA_TYPES[type] || type;
  }
  const owner: string | null = series.label("id");
  if (owner && owner !== "0" && (type === "1" || type === "3")) {
    patch.details["ownerId"] = Number(owner);
  }

  if (series.metricName === "powerscale_quota_usage_bytes") {
    // The quotas' poll lists every quota.
    markStorageArrayKindComplete(series.array, POWERSCALE_QUOTA_KIND);
    const usage: number = whole(series.value);
    patch.usedBytes = usage;
    patch.capacityBytes = enforcedLimit(series);
    const hard: number | null = labelIsYes(series, "hard_defined")
      ? labelBytes(series, "hard_limit")
      : null;
    const soft: number | null = labelIsYes(series, "soft_defined")
      ? labelBytes(series, "soft_limit")
      : null;
    const advisory: number | null = labelIsYes(series, "advisory_defined")
      ? labelBytes(series, "advisory_limit")
      : null;
    patch.details["hardLimitBytes"] = hard;
    patch.details["softLimitBytes"] = soft;
    patch.details["advisoryLimitBytes"] = advisory;
    const grace: number | null = labelBytes(series, "grace_period");
    if (soft !== null && grace !== null && grace > 0) {
      patch.details["gracePeriodSeconds"] = grace;
    }
    if (series.label("includes_snapshots") !== null) {
      patch.details["includesSnapshots"] = labelIsYes(
        series,
        "includes_snapshots",
      );
    }
    if (series.label("includes_overhead") !== null) {
      patch.details["includesOverhead"] = labelIsYes(
        series,
        "includes_overhead",
      );
    }
    patch.status = getQuotaStatus({
      usageBytes: usage,
      hardLimitBytes: hard,
      softLimitBytes: soft,
      advisoryLimitBytes: advisory,
    });
  } else if (series.metricName === "powerscale_quota_physical_bytes") {
    patch.details["physicalBytes"] = whole(series.value);
  } else if (series.metricName === "powerscale_quota_inodes") {
    patch.details["inodes"] = whole(series.value);
  } else if (series.metricName === "powerscale_quota_used_percent") {
    patch.details["usedPercent"] =
      Math.round(Math.max(0, series.value) * 100) / 100;
    const limit: string | null = series.label("limit");
    if (limit) {
      patch.details["limit"] = limit;
    }
  }
  series.fold(patch);
}

// ---------------- Each node ----------------

function nodeRow(
  series: StorageArraySeries,
  node: string,
): StorageArrayResourceBufferEntry {
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    POWERSCALE_NODE_KIND,
    node,
  );
  patch.name = node;
  const lnn: RegExpExecArray | null = TRAILING_LNN.exec(node);
  if (lnn) {
    patch.details["lnn"] = Number(lnn[1]);
  }
  return patch;
}

function readNode(series: StorageArraySeries, node: string): void {
  const patch: StorageArrayResourceBufferEntry = nodeRow(series, node);
  const version: string | null = parseOneFsVersion(
    series.label("system_description"),
  );
  if (version) {
    patch.firmwareVersion = version;
  }
  switch (series.metricName) {
    case "powerscale_node_health":
      patch.status = HEALTH_STATUSES[Math.trunc(series.value)] || "unknown";
      break;
    case "powerscale_node_type":
      patch.componentType =
        Math.trunc(series.value) === 1 ? "accelerator" : "storage";
      break;
    case "powerscale_node_read_only":
      patch.details["readOnly"] = Math.trunc(series.value) === 1;
      break;
    case "powerscale_node_ifs_read_bytes_per_second":
      patch.readBytesPerSec = Math.max(0, series.value);
      break;
    case "powerscale_node_ifs_write_bytes_per_second":
      patch.writeBytesPerSec = Math.max(0, series.value);
      break;
    case "powerscale_node_cpu_busy_percent":
      patch.details["cpuBusyPercent"] =
        Math.round(Math.min(100, Math.max(0, series.value)) * 10) / 10;
      break;
    case "powerscale_chassis_service_light":
      patch.model = series.label("chassis_model");
      if (series.label("chassis_serial")) {
        patch.details["serialNumber"] = series.label("chassis_serial");
      }
      if (series.label("chassis_configuration")) {
        patch.details["configurationNumber"] = series.label(
          "chassis_configuration",
        );
      }
      // -1 when the chassis has no service light, 1 while it is lit.
      if (Math.trunc(series.value) >= 0) {
        patch.details["serviceLightOn"] = Math.trunc(series.value) === 1;
      }
      break;
    default:
      break;
  }
  series.fold(patch);
}

/*
 * A node's load per protocol, as details of its row: one key per protocol
 * (`operationsPerSecond.nfs3`, `latencyUsec.smb2`), each merged on its own.
 */
function readNodeProtocol(series: StorageArraySeries, node: string): void {
  const protocol: string | null = series.label("protocol");
  if (!protocol) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = nodeRow(series, node);
  if (series.metricName === "powerscale_protocol_operations_per_second") {
    patch.details[`operationsPerSecond.${protocol}`] = Math.max(
      0,
      series.value,
    );
  } else {
    patch.details[`latencyUsec.${protocol}`] = Math.max(0, series.value);
  }
  series.fold(patch);
}

function driveName(series: StorageArraySeries, node: string): string | null {
  const name: string | null = series.label("drive");
  if (name) {
    return name;
  }
  const bay: string | null = series.label("bay") || series.label("perf_bay");
  return bay ? `${node} bay ${bay}` : null;
}

function readDrive(series: StorageArraySeries, node: string): void {
  const name: string | null = driveName(series, node);
  if (!name) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Drive,
    name,
  );
  patch.name = name;
  patch.groupName = node;
  patch.details["node"] = node;
  if (series.metricName === "powerscale_drive_operations_per_second") {
    patch.details["operationsPerSecond"] = Math.max(0, series.value);
    series.fold(patch);
    return;
  }
  const status: string | null = series.label("status");
  patch.status = status ? status.toLowerCase() : null;
  patch.capacityBytes = whole(series.value);
  patch.model = series.label("model");
  patch.firmwareVersion = series.label("firmware");
  const bay: string | null = series.label("bay");
  if (bay && DIGITS.test(bay)) {
    patch.details["bay"] = Number(bay);
  }
  const serial: string | null = series.label("serial");
  if (serial) {
    patch.details["serialNumber"] = serial;
  }
  const device: string | null = series.label("device");
  if (device) {
    patch.details["device"] = device;
    if (NVME_DEVICE.test(device)) {
      patch.details["protocol"] = "NVMe";
    }
  }
  series.fold(patch);
}

function readSensor(series: StorageArraySeries, node: string): void {
  let type: string;
  let sensor: string | null;
  let description: string | null;
  if (series.metricName === "powerscale_fan_speed_rpm") {
    type = "fan";
    sensor = series.label("fan");
    description = series.label("fan_description");
  } else if (series.metricName === "powerscale_temperature_celsius") {
    type = "temperature";
    sensor = series.label("sensor");
    description = series.label("sensor_description");
  } else {
    type = "power";
    sensor = series.label("power_sensor");
    description = series.label("power_sensor_description");
  }
  if (!sensor) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Hardware,
    `${node}/${type}/${sensor}`,
  );
  patch.name = `${node} ${description || sensor}`;
  patch.groupName = node;
  patch.details["node"] = node;
  patch.details["sensor"] = sensor;
  if (type === "fan") {
    patch.componentType = "fan";
    patch.details["rpm"] = whole(series.value);
  } else if (type === "temperature") {
    patch.componentType = "temperature sensor";
    patch.temperatureCelsius = series.value;
  } else {
    const current: boolean = CURRENT_SENSOR.test(description || sensor);
    patch.componentType = current ? "current sensor" : "voltage sensor";
    patch.details["reading"] = series.value;
    patch.details["unit"] = current ? "A" : "V";
  }
  series.fold(patch);
}

function readInterface(series: StorageArraySeries, node: string): void {
  const port: string | null = series.label("interface");
  if (!port) {
    return;
  }
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.NetworkInterface,
    `${node}/${port}`,
  );
  patch.name = `${node} ${port}`;
  patch.groupName = node;
  patch.details["node"] = node;
  patch.details["port"] = port;
  const type: string | null = series.label("interface_type");
  patch.componentType = (type && INTERFACE_TYPES[type]) || "port";
  // A port an administrator turned off is not down.
  patch.status =
    series.label("admin_status") === "2"
      ? "disabled"
      : INTERFACE_STATUSES[Math.trunc(series.value)] || "unknown";
  const speed: string | null = series.label("speed_mbps");
  if (speed && DIGITS.test(speed) && Number(speed) > 0) {
    // ifHighSpeed is in megabits per second.
    patch.details["speedBytesPerSec"] = (Number(speed) * 1000000) / 8;
  }
  series.fold(patch);
}

function extractPowerScaleSeries(series: StorageArraySeries): void {
  const metricName: string = series.metricName;

  // ---------------- The cluster (no inventory row of its own) ----------------

  if (metricName === "powerscale_cluster_health") {
    readClusterHealth(series);
    return;
  }
  if (metricName.startsWith("powerscale_ifs_")) {
    readCapacity(series);
    return;
  }
  if (metricName.startsWith("powerscale_quota_")) {
    readQuota(series);
    return;
  }

  // ---------------- Each node's own poll ----------------

  const node: string | null = series.label("node");
  if (!node) {
    return;
  }
  if (
    metricName.startsWith("powerscale_node_") ||
    metricName === "powerscale_chassis_service_light"
  ) {
    readNode(series, node);
    return;
  }
  if (metricName.startsWith("powerscale_protocol_")) {
    readNodeProtocol(series, node);
    return;
  }
  if (metricName.startsWith("powerscale_drive_")) {
    readDrive(series, node);
    return;
  }
  if (
    metricName === "powerscale_fan_speed_rpm" ||
    metricName === "powerscale_temperature_celsius" ||
    metricName === "powerscale_power_sensor_reading"
  ) {
    readSensor(series, node);
    return;
  }
  if (metricName === "powerscale_interface_status") {
    readInterface(series, node);
  }
}

const PowerScaleExtractor: StorageArrayExtractor = {
  storageSystem: DellPowerScalePlatform.storageSystem,
  extract: extractPowerScaleSeries,
};

export default PowerScaleExtractor;
