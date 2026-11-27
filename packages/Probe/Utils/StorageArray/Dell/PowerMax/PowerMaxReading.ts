import {
  UnispherePerformanceInstance,
  UnisphereTimedPoint,
  toNumber,
  toText,
} from "./UnisphereClient";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import {
  POWERMAX_DIRECTOR_ONLINE_STATUSES,
  POWERMAX_PORT_ONLINE_STATUSES,
  POWERMAX_SRDF_BROKEN_STATES,
  POWERMAX_SRDF_HEALTHY_STATES,
  PowerMaxDirectorRole,
  isBrokenSrdfState,
  normalizeSrdfState,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";

/*
 * ONE POWERMAX ARRAY AS A COLLECTION READ IT (#11004): what Unisphere's
 * answers mean, in one place, with Dell's attribute names read here and
 * nowhere else. The builder (PowerMaxOtlpBuilder) turns a reading into the
 * platform's series; tests read a reading of Dell's recorded answers.
 *
 * Unisphere's units: capacity in TB and GB (binary: 1 TB is 2^40 bytes),
 * throughput in MB per second (2^20 bytes), response time in milliseconds.
 */

export const TB: number = 1024 * 1024 * 1024 * 1024;
export const GB: number = 1024 * 1024 * 1024;
export const MB: number = 1024 * 1024;

export interface PowerMaxCapacity {
  usableBytes: number | null;
  usedBytes: number | null;
  subscribedBytes: number | null;
  dataReductionRatio: number | null;
}

export interface PowerMaxStorageGroup {
  id: string;
  type: string | null;
  srp: string | null;
  serviceLevel: string | null;
  volumeCount: number | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  dataReductionRatio: number | null;
  isRealtime: boolean;
  // Its SRDF pairs' states and modes, and the local SRDF groups, if any.
  srdfStates: Array<string>;
  srdfModes: Array<string>;
  srdfGroups: Array<string>;
}

export interface PowerMaxVolume {
  id: string;
  identifier: string | null;
  type: string | null;
  status: string | null;
  emulation: string | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  storageGroup: string | null;
}

export interface PowerMaxSrp {
  id: string;
  emulation: string | null;
  usableBytes: number | null;
  usedBytes: number | null;
  subscribedBytes: number | null;
  dataReductionRatio: number | null;
}

export interface PowerMaxDirector {
  id: string;
  role: PowerMaxDirectorRole;
  // Dell's type ("OSHostFibreChannel"), else the role in words.
  type: string;
  status: string | null;
  isOnline: boolean;
  engine: number | null;
  slot: number | null;
}

export interface PowerMaxPort {
  // "FA-1D:4": the director and the port number.
  id: string;
  director: string;
  port: string;
  protocol: string;
  type: string | null;
  status: string | null;
  isOnline: boolean;
  // In a port group, a masking view or an SRDF group: someone relies on it.
  isInUse: boolean;
  speedGbps: number | null;
  rxPowerMilliwatts: number | null;
  txPowerMilliwatts: number | null;
}

export interface PowerMaxSrdfGroup {
  // The group's number on this array, "11".
  id: string;
  label: string | null;
  type: string | null;
  modes: Array<string>;
  // The pair states of its storage groups, as Unisphere spells them.
  states: Array<string>;
  isOffline: boolean;
  remoteSymmetrixId: string | null;
  remoteGroup: string | null;
  lagSeconds: number | null;
  volumeCount: number | null;
  capacityBytes: number | null;
  isWitnessDegraded: boolean;
}

export type PowerMaxAlertSeverity = "critical" | "warning";

export interface PowerMaxAlert {
  id: string;
  severity: PowerMaxAlertSeverity;
  type: string | null;
  object: string | null;
  objectType: string | null;
  description: string;
  createdMs: number | null;
}

export interface PowerMaxPerformanceRegistration {
  // Unisphere collects 5-minute diagnostic data for the array.
  diagnostic: boolean | null;
  realtime: boolean | null;
  realtimeStorageGroups: Array<string>;
}

export interface PowerMaxArrayReading {
  symmetrixId: string;
  model: string | null;
  microcode: string | null;
  isLocal: boolean;
  capacity: PowerMaxCapacity | null;
  healthScores: Array<{ metric: string; score: number }>;
  registration: PowerMaxPerformanceRegistration;
  // The 5-minute KPIs of every instance, by category ("StorageGroup").
  performance: Map<string, Array<UnispherePerformanceInstance>>;
  // Null: not read. An empty list: read, and none there.
  storageGroups: Array<PowerMaxStorageGroup> | null;
  volumes: Array<PowerMaxVolume> | null;
  srps: Array<PowerMaxSrp> | null;
  directors: Array<PowerMaxDirector> | null;
  ports: Array<PowerMaxPort> | null;
  srdfGroups: Array<PowerMaxSrdfGroup> | null;
  alerts: Array<PowerMaxAlert> | null;
  realtimeStorageGroups: Map<string, Array<UnisphereTimedPoint>>;
  volumePerformance: Map<string, UnisphereTimedPoint>;
  // How many there are, where a list was cut at the probe's limit.
  totals: Record<string, number>;
  warnings: Array<string>;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scaled(value: unknown, unit: number): number | null {
  const number: number | null = toNumber(value);
  return number === null || number < 0 ? null : number * unit;
}

function idOf(value: unknown): string | null {
  return isObject(value) ? toText(value["id"]) : toText(value);
}

function texts(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : [])
    .map((entry: unknown): string | null => {
      return toText(entry);
    })
    .filter((entry: string | null): entry is string => {
      return entry !== null;
    });
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

// ---------------- The array ----------------

/*
 * Capacity from sloprovisioning/symmetrix/{id}: system_capacity's usable
 * total and used, else the storage resource pools' sum (an array whose
 * answer reports capacity per pool only).
 */
export function readCapacity(
  provisioning: JSONObject | null,
  srps: Array<PowerMaxSrp> | null,
): PowerMaxCapacity | null {
  const system: JSONValue | undefined = provisioning?.["system_capacity"];
  const efficiency: JSONValue | undefined = provisioning?.["system_efficiency"];

  let usableBytes: number | null = null;
  let usedBytes: number | null = null;
  let subscribedBytes: number | null = null;

  if (isObject(system)) {
    usableBytes = scaled(system["usable_total_tb"], TB);
    usedBytes = scaled(system["usable_used_tb"], TB);
    subscribedBytes = scaled(system["subscribed_total_tb"], TB);
  }

  if (usableBytes === null && srps && srps.length > 0) {
    let usable: number = 0;
    let used: number = 0;
    let subscribed: number = 0;
    let seen: boolean = false;
    for (const srp of srps) {
      if (srp.usableBytes !== null) {
        usable += srp.usableBytes;
        used += srp.usedBytes ?? 0;
        subscribed += srp.subscribedBytes ?? 0;
        seen = true;
      }
    }
    if (seen) {
      usableBytes = usable;
      usedBytes = used;
      subscribedBytes = subscribed;
    }
  }

  const dataReductionRatio: number | null = isObject(efficiency)
    ? toNumber(efficiency["data_reduction_ratio_to_one"])
    : null;

  if (
    usableBytes === null &&
    usedBytes === null &&
    subscribedBytes === null &&
    dataReductionRatio === null
  ) {
    return null;
  }

  return {
    usableBytes,
    usedBytes,
    subscribedBytes,
    dataReductionRatio:
      dataReductionRatio !== null && dataReductionRatio > 0
        ? dataReductionRatio
        : null,
  };
}

// Unisphere's health scores that are current, by metric.
export function readHealthScores(
  health: JSONObject | null,
): Array<{ metric: string; score: number }> {
  const scores: Array<{ metric: string; score: number }> = [];
  const list: JSONValue | undefined = health?.["health_score_metric"];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isObject(entry) || entry["expired"] === true) {
      continue;
    }
    const metric: string | null = toText(entry["metric"]);
    const score: number | null = toNumber(entry["health_score"]);
    if (metric && score !== null) {
      scores.push({ metric: metric.toLowerCase(), score });
    }
  }
  return scores;
}

export function readRegistration(
  details: JSONObject | null,
): PowerMaxPerformanceRegistration {
  if (!details) {
    return { diagnostic: null, realtime: null, realtimeStorageGroups: [] };
  }
  const selected: JSONValue | undefined = details["selectedSGs"];
  const groups: Array<string> = Array.isArray(selected)
    ? texts(selected)
    : (toText(selected) || "")
        .split(",")
        .map((name: string): string => {
          return name.trim();
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        });
  return {
    diagnostic:
      typeof details["diagnostic"] === "boolean"
        ? (details["diagnostic"] as boolean)
        : null,
    realtime:
      typeof details["realtime"] === "boolean"
        ? (details["realtime"] as boolean)
        : null,
    realtimeStorageGroups: unique(groups),
  };
}

// ---------------- Storage resource pools ----------------

export function readSrp(srp: JSONObject): PowerMaxSrp | null {
  const id: string | null = toText(srp["srpId"]);
  if (!id) {
    return null;
  }
  const capacity: JSONValue | undefined = srp["srp_capacity"];
  const efficiency: JSONValue | undefined = srp["srp_efficiency"];
  const ratio: number | null = isObject(efficiency)
    ? toNumber(efficiency["data_reduction_ratio_to_one"])
    : null;
  return {
    id,
    emulation: toText(srp["emulation"]),
    usableBytes: isObject(capacity)
      ? scaled(capacity["usable_total_tb"], TB)
      : null,
    usedBytes: isObject(capacity)
      ? scaled(capacity["usable_used_tb"], TB)
      : null,
    subscribedBytes: isObject(capacity)
      ? scaled(capacity["subscribed_total_tb"], TB)
      : null,
    dataReductionRatio: ratio !== null && ratio > 0 ? ratio : null,
  };
}

// ---------------- Storage groups and volumes ----------------

export function readStorageGroup(
  entry: JSONObject,
  realtimeGroups: ReadonlySet<string>,
): PowerMaxStorageGroup | null {
  const id: string | null = toText(entry["id"]);
  if (!id) {
    return null;
  }
  const states: Array<string> = [];
  const modes: Array<string> = [];
  const groups: Array<string> = [];
  for (const info of Array.isArray(entry["rdf_infos"])
    ? (entry["rdf_infos"] as JSONArray)
    : []) {
    if (!isObject(info)) {
      continue;
    }
    states.push(...texts(info["states"]));
    modes.push(...texts(info["modes"]));
    const local: string | null = idOf(info["local_rdf_group"]);
    if (local) {
      groups.push(local);
    }
  }
  const ratio: number | null = toNumber(entry["data_reduction_ratio_to_one"]);
  return {
    id,
    type: toText(entry["type"]),
    srp: idOf(entry["srp"]),
    serviceLevel: idOf(entry["service_level"]),
    volumeCount: toNumber(entry["num_of_volumes"]),
    capacityBytes: scaled(entry["cap_gb"], GB),
    usedBytes: scaled(entry["effective_used_capacity_gb"], GB),
    dataReductionRatio: ratio !== null && ratio > 0 ? ratio : null,
    isRealtime: realtimeGroups.has(id),
    srdfStates: unique(states),
    srdfModes: unique(modes),
    srdfGroups: unique(groups),
  };
}

/*
 * The SRDF state of a storage group's pairs worth showing: the first
 * broken one, else the first healthy one, else the first named.
 */
export function getWorstSrdfState(states: Array<string>): string | null {
  return (
    states.find((state: string): boolean => {
      return isBrokenSrdfState(state);
    }) ||
    states.find((state: string): boolean => {
      return POWERMAX_SRDF_HEALTHY_STATES.includes(normalizeSrdfState(state));
    }) ||
    states[0] ||
    null
  );
}

export function readVolume(entry: JSONObject): PowerMaxVolume | null {
  const id: string | null = toText(entry["id"]);
  if (!id) {
    return null;
  }
  const groups: JSONValue | undefined = entry["storage_groups"];
  const firstGroup: string | null = Array.isArray(groups)
    ? idOf(groups[0])
    : null;
  return {
    id,
    identifier: toText(entry["identifier"]),
    type: toText(entry["type"]),
    status: toText(entry["status"]),
    emulation: toText(entry["emulation"]),
    capacityBytes: scaled(entry["cap_gb"], GB),
    usedBytes: scaled(entry["effective_used_capacity_gb"], GB),
    storageGroup: firstGroup,
  };
}

// ---------------- Directors and ports ----------------

/*
 * A director's role from its name's letters, Dell's emulation codes:
 * FA, FN, SE, EF and OR serve hosts (OR serves SRDF too, on PowerMaxOS 10),
 * DF, DN and DX serve drives, RF and RE replicate, IM, ED and EM run the
 * array.
 */
export function getDirectorRole(directorId: string): PowerMaxDirectorRole {
  const prefix: string = directorId.split("-")[0]!.toUpperCase();
  switch (prefix) {
    case "FA":
    case "FN":
    case "SE":
    case "EF":
    case "OR":
    case "OS":
      return "frontend";
    case "DF":
    case "DN":
    case "DX":
    case "DA":
      return "backend";
    case "RF":
    case "RE":
      return "srdf";
    default:
      return "infrastructure";
  }
}

const ROLE_WORDS: Record<PowerMaxDirectorRole, string> = {
  frontend: "Front end",
  backend: "Back end",
  srdf: "SRDF",
  infrastructure: "Infrastructure",
};

export function readDirector(entry: JSONObject): PowerMaxDirector | null {
  // Enhanced: id, type, status. Classic: directorId, availability.
  const id: string | null = toText(entry["id"]) || toText(entry["directorId"]);
  if (!id) {
    return null;
  }
  const status: string | null =
    toText(entry["status"]) || toText(entry["availability"]);
  const role: PowerMaxDirectorRole = getDirectorRole(id);
  return {
    id,
    role,
    type: toText(entry["type"]) || ROLE_WORDS[role],
    status,
    isOnline: POWERMAX_DIRECTOR_ONLINE_STATUSES.includes(
      (status || "").toLowerCase(),
    ),
    engine: toNumber(entry["engine_number"]),
    slot:
      toNumber(entry["slot_number"]) ?? toNumber(entry["director_slot_number"]),
  };
}

// What a port carries, in a word a storage admin reads.
export function getPortProtocol(entry: JSONObject): string {
  const protocol: string = (toText(entry["protocol"]) || "").toLowerCase();
  const type: string = (toText(entry["type"]) || "").toLowerCase();
  if (entry["nvmetcp_endpoint"] === true) {
    return "NVMe/TCP";
  }
  if (protocol.includes("rdf") || type === "rdf") {
    return protocol.includes("gige") || protocol.includes("ip")
      ? "SRDF over IP"
      : "SRDF over FC";
  }
  if (entry["iscsi_endpoint"] === true || protocol.includes("iscsi")) {
    return "iSCSI";
  }
  if (protocol.includes("nvme")) {
    return "NVMe over FC";
  }
  if (protocol.includes("ficon")) {
    return "FICON";
  }
  if (protocol.includes("fc")) {
    return "Fibre Channel";
  }
  if (protocol.includes("gige")) {
    return "Ethernet";
  }
  return toText(entry["protocol"]) || toText(entry["type"]) || "Port";
}

export function readPort(
  entry: JSONObject,
  srdfPortIds: ReadonlySet<string>,
): PowerMaxPort | null {
  const director: string | null = idOf(entry["director"]);
  const port: string | null = toText(entry["port_number"]);
  if (!director || port === null) {
    return null;
  }
  const id: string = `${director}:${port}`;
  const status: string | null = toText(entry["port_status"]);
  const portGroups: number = toNumber(entry["num_of_port_groups"]) ?? 0;
  const maskingViews: number = toNumber(entry["num_of_masking_views"]) ?? 0;
  return {
    id,
    director,
    port,
    protocol: getPortProtocol(entry),
    type: toText(entry["type"]),
    status,
    isOnline: POWERMAX_PORT_ONLINE_STATUSES.includes(
      (status || "").toLowerCase(),
    ),
    isInUse: portGroups > 0 || maskingViews > 0 || srdfPortIds.has(id),
    speedGbps:
      toNumber(entry["negotiated_speed"]) ?? toNumber(entry["max_speed"]),
    rxPowerMilliwatts: toNumber(entry["rx_power_level_mw"]),
    txPowerMilliwatts: toNumber(entry["tx_power_level_mw"]),
  };
}

// ---------------- SRDF groups ----------------

// The ports an SRDF group replicates through: "OR-1C:2".
export function getSrdfGroupPortIds(entry: JSONObject): Array<string> {
  const ids: Array<string> = [];
  for (const port of Array.isArray(entry["ports"])
    ? (entry["ports"] as JSONArray)
    : []) {
    if (!isObject(port)) {
      continue;
    }
    const director: string | null = idOf(port["director"]);
    const number: string | null = toText(port["port_number"]);
    if (director && number !== null) {
      ids.push(`${director}:${number}`);
    }
  }
  return ids;
}

export function readSrdfGroup(
  entry: JSONObject,
  statesByGroup: ReadonlyMap<string, Array<string>>,
): PowerMaxSrdfGroup | null {
  const id: string | null = toText(entry["id"]);
  if (!id) {
    return null;
  }
  const remote: JSONValue | undefined = entry["remote_rdf_group"];
  const rdfa: JSONValue | undefined = entry["rdfa_properties"];
  const isAsync: boolean = entry["async"] === true;
  return {
    id,
    label: toText(entry["label"]),
    type: toText(entry["type"]),
    modes: texts(entry["modes"]),
    states: statesByGroup.get(id) || [],
    isOffline: entry["offline"] === true,
    remoteSymmetrixId: isObject(remote) ? idOf(remote["system"]) : null,
    remoteGroup: isObject(remote) ? toText(remote["id"]) : null,
    lagSeconds:
      isAsync && isObject(rdfa) ? toNumber(rdfa["r1_to_r2_lag_time"]) : null,
    volumeCount: toNumber(entry["num_of_volumes"]),
    capacityBytes: scaled(entry["cap_gb"], GB),
    isWitnessDegraded: entry["witness_degraded"] === true,
  };
}

/*
 * The SRDF groups a Unisphere older than 10.3 cannot list, as its storage
 * groups name them: each local group with the pair states and modes of the
 * storage groups replicated through it.
 */
export function deriveSrdfGroupsFromStorageGroups(
  storageGroups: Array<PowerMaxStorageGroup>,
): Array<PowerMaxSrdfGroup> {
  const byId: Map<string, PowerMaxSrdfGroup> = new Map();
  for (const group of storageGroups) {
    for (const id of group.srdfGroups) {
      let srdf: PowerMaxSrdfGroup | undefined = byId.get(id);
      if (!srdf) {
        srdf = {
          id,
          label: null,
          type: null,
          modes: [],
          states: [],
          isOffline: false,
          remoteSymmetrixId: null,
          remoteGroup: null,
          lagSeconds: null,
          volumeCount: null,
          capacityBytes: null,
          isWitnessDegraded: false,
        };
        byId.set(id, srdf);
      }
      srdf.states = unique([...srdf.states, ...group.srdfStates]);
      srdf.modes = unique([...srdf.modes, ...group.srdfModes]);
    }
  }
  return Array.from(byId.values());
}

// The pair states of each local SRDF group, from its storage groups.
export function getSrdfStatesByGroup(
  storageGroups: Array<PowerMaxStorageGroup>,
): Map<string, Array<string>> {
  const states: Map<string, Array<string>> = new Map();
  for (const derived of deriveSrdfGroupsFromStorageGroups(storageGroups)) {
    states.set(derived.id, derived.states);
  }
  return states;
}

/*
 * Whether an SRDF group stopped keeping its remote copy current, and the
 * state that says so: its link offline, or a pair in a broken state.
 */
export function getSrdfGroupProblem(group: PowerMaxSrdfGroup): string | null {
  if (group.isOffline) {
    return "Offline";
  }
  return (
    group.states.find((state: string): boolean => {
      return POWERMAX_SRDF_BROKEN_STATES.includes(normalizeSrdfState(state));
    }) || null
  );
}

// ---------------- Alerts ----------------

/*
 * An open alert, as the platform counts it: Critical and Fatal are
 * critical, Warning and Minor warning; acknowledged, cleared and
 * informational ones are not open.
 */
export function readAlert(entry: JSONObject): PowerMaxAlert | null {
  const id: string | null = toText(entry["alertId"]);
  if (!id) {
    return null;
  }
  if (entry["acknowledged"] === true) {
    return null;
  }
  const state: string = (toText(entry["state"]) || "").toUpperCase();
  if (state === "CLEARED" || state === "ACKNOWLEDGED") {
    return null;
  }
  const severity: string = (toText(entry["severity"]) || "").toUpperCase();
  let mapped: PowerMaxAlertSeverity | null = null;
  if (severity === "FATAL" || severity === "CRITICAL") {
    mapped = "critical";
  } else if (severity === "WARNING" || severity === "MINOR") {
    mapped = "warning";
  }
  if (!mapped) {
    return null;
  }
  return {
    id,
    severity: mapped,
    type: toText(entry["type"]),
    object: toText(entry["object"]),
    objectType: toText(entry["object_type"]),
    description: (toText(entry["description"]) || "Unisphere alert").slice(
      0,
      500,
    ),
    createdMs: toNumber(entry["created_date_milliseconds"]),
  };
}

// ---------------- Performance ----------------

/*
 * A port's instance id in a port category is "FA-1D:4"; a director's is
 * "FA-1D". Unisphere's port numbers are written without padding.
 */
export function readPortInstanceId(id: string): string | null {
  const match: RegExpMatchArray | null = id.match(/^([A-Za-z]{2}-\w+):(\d+)$/);
  return match ? `${match[1]}:${Number(match[2])}` : null;
}

export function getInstances(
  reading: PowerMaxArrayReading,
  category: string,
): Array<UnispherePerformanceInstance> {
  return reading.performance.get(category) || [];
}
