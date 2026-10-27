import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../SecurityCase/SecurityConnectionMatch";
import { buildTelemetrySecurityEvent } from "./TelemetrySecurityEvent";

/*
 * WHAT NETWORK FLOWS SAY ABOUT AN ATTACK - read from the NetFlow, IPFIX and
 * sFlow records the project's devices export to OneUptime, a window of
 * arrivals at a time (Server/Utils/SecurityEvent/TelemetryScan/
 * FlowSecurityScan.ts):
 *
 *   port scan        one address reaching many ports of one host;
 *   network sweep    one address reaching one port on many hosts;
 *   threat intel     traffic with an address a threat-intel feed knows;
 *   large transfer   a private address sending a lot to a public one.
 *
 * Flows are many and every one is ordinary, so none becomes an event by
 * itself: each is one row the database already summed, per address (or
 * pair) per window. The thresholds are where ordinary traffic stops: return
 * traffic to a client lands on its ephemeral ports, so a port scan counts
 * only ports below EPHEMERAL_PORT_START; a resolver or a browser behind NAT
 * reaches many hosts on the same few ports, so a sweep ignores them.
 *
 * Pure: the scan hands it the rows it read.
 */

export const NETWORK_ACTIVITY_CLASS_UID: number = 4001;

// Ports at and above this are clients' own, where answers to them land.
export const EPHEMERAL_PORT_START: number = 32768;

// Distinct ports below EPHEMERAL_PORT_START, of one host, in one window.
export const PORT_SCAN_MIN_PORTS: number = 25;

// Distinct hosts on one port, in one window.
export const NETWORK_SWEEP_MIN_HOSTS: number = 30;

/*
 * Ports a sweep never counts: what clients reach many hosts on every day
 * (DNS, HTTP, NTP, HTTPS, QUIC).
 */
export const SWEEP_IGNORED_PORTS: ReadonlyArray<number> = [53, 80, 123, 443];

// Bytes from one private address to one public address, in one window.
export const LARGE_TRANSFER_MIN_BYTES: number = 1024 * 1024 * 1024;

// The most rows of each kind one window turns into events.
export const MAX_FLOW_ROWS_PER_SIGNAL: number = 50;

export const FLOW_ATTRIBUTES: {
  bytes: string;
  packets: string;
  flows: string;
  protocol: string;
  distinctPorts: string;
  samplePorts: string;
  distinctHosts: string;
  sampleHosts: string;
  deviceId: string;
  windowStart: string;
  windowEnd: string;
  indicator: string;
} = {
  bytes: "network.bytes",
  packets: "network.packets",
  flows: "network.flows",
  protocol: "network.transport",
  distinctPorts: "network.distinct_ports",
  samplePorts: "network.sample_ports",
  distinctHosts: "network.distinct_hosts",
  sampleHosts: "network.sample_hosts",
  deviceId: "oneuptime.network_device.id",
  windowStart: "oneuptime.window.start",
  windowEnd: "oneuptime.window.end",
  indicator: "oneuptime.threat_intel.address",
};

interface FlowRowBase {
  bytes: number;
  packets: number;
  flows: number;
  firstSeen: Date;
  lastSeen: Date;
  // The exporting device, when the flows name one.
  deviceId: string;
}

export interface PortScanRow extends FlowRowBase {
  srcIp: string;
  dstIp: string;
  ports: number;
  samplePorts: Array<number>;
}

export interface NetworkSweepRow extends FlowRowBase {
  srcIp: string;
  dstPort: number;
  hosts: number;
  sampleHosts: Array<string>;
}

export interface FlowPairRow extends FlowRowBase {
  srcIp: string;
  dstIp: string;
  dstPort: number;
  protocol: number;
}

// The window a scan read: the events it finds are about it.
export interface FlowWindow {
  from: Date;
  to: Date;
}

// IANA protocol numbers flows record, by name.
export function getProtocolName(protocol: number): string {
  switch (protocol) {
    case 1:
      return "icmp";
    case 6:
      return "tcp";
    case 17:
      return "udp";
    case 58:
      return "ipv6-icmp";
    default:
      return protocol > 0 ? String(protocol) : "";
  }
}

const BYTE_UNITS: ReadonlyArray<string> = ["B", "KB", "MB", "GB", "TB"];

// 1288490188 -> "1.2 GB": how a message says an amount of data.
export function formatBytes(bytes: number): string {
  let value: number = Math.max(0, bytes || 0);
  let unit: number = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value = value / 1024;
    unit++;
  }

  const rounded: string =
    unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1);

  return `${rounded} ${BYTE_UNITS[unit]}`;
}

function windowAttributes(window: FlowWindow, row: FlowRowBase): JSONObject {
  const attributes: JSONObject = {
    [FLOW_ATTRIBUTES.bytes]: String(Math.round(row.bytes)),
    [FLOW_ATTRIBUTES.packets]: String(Math.round(row.packets)),
    [FLOW_ATTRIBUTES.flows]: String(Math.round(row.flows)),
    [FLOW_ATTRIBUTES.windowStart]: window.from.toISOString(),
    [FLOW_ATTRIBUTES.windowEnd]: window.to.toISOString(),
  };

  if (row.deviceId) {
    attributes[FLOW_ATTRIBUTES.deviceId] = row.deviceId;
  }

  return attributes;
}

function windowKey(window: FlowWindow): string {
  return window.from.toISOString();
}

function eventTime(row: FlowRowBase, window: FlowWindow): Date {
  return row.firstSeen && !Number.isNaN(row.firstSeen.getTime())
    ? row.firstSeen
    : window.from;
}

export function buildPortScanEvent(
  row: PortScanRow,
  window: FlowWindow,
): NormalizedSecurityEvent | null {
  if (row.ports < PORT_SCAN_MIN_PORTS || !row.srcIp || !row.dstIp) {
    return null;
  }

  const sample: Array<number> = [...row.samplePorts]
    .filter((port: number): boolean => {
      return port > 0;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .slice(0, 10);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.PortScan,
    time: eventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.PortScan}:${row.srcIp}:${row.dstIp}:${windowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Medium,
    message: `Port scan: ${row.srcIp} reached ${row.ports} ports on ${row.dstIp}`,
    principalIp: row.srcIp,
    targetIp: row.dstIp,
    attributes: {
      ...windowAttributes(window, row),
      [FLOW_ATTRIBUTES.distinctPorts]: String(row.ports),
      [FLOW_ATTRIBUTES.samplePorts]: sample.join(","),
    },
  });
}

export function buildNetworkSweepEvent(
  row: NetworkSweepRow,
  window: FlowWindow,
): NormalizedSecurityEvent | null {
  if (
    row.hosts < NETWORK_SWEEP_MIN_HOSTS ||
    !row.srcIp ||
    SWEEP_IGNORED_PORTS.includes(row.dstPort)
  ) {
    return null;
  }

  const sample: Array<string> = [...row.sampleHosts]
    .filter(Boolean)
    .sort()
    .slice(0, 10);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.NetworkSweep,
    time: eventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.NetworkSweep}:${row.srcIp}:${row.dstPort}:${windowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Medium,
    message: `Network sweep: ${row.srcIp} reached port ${row.dstPort} on ${row.hosts} hosts`,
    principalIp: row.srcIp,
    targetPort: row.dstPort,
    attributes: {
      ...windowAttributes(window, row),
      [FLOW_ATTRIBUTES.distinctHosts]: String(row.hosts),
      [FLOW_ATTRIBUTES.sampleHosts]: sample.join(","),
    },
  });
}

/*
 * A private address sending a lot to a public one: the direction data
 * leaves a network in. Any other pair - two public addresses, data coming
 * in - is not this.
 */
export function isOutboundPair(srcIp: string, dstIp: string): boolean {
  return (
    getSecurityAddressScope(srcIp) === SecurityAddressScope.Private &&
    getSecurityAddressScope(dstIp) === SecurityAddressScope.Public
  );
}

export function buildLargeTransferEvent(
  row: FlowPairRow,
  window: FlowWindow,
): NormalizedSecurityEvent | null {
  if (row.bytes < LARGE_TRANSFER_MIN_BYTES || !isOutboundPair(row.srcIp, row.dstIp)) {
    return null;
  }

  const protocol: string = getProtocolName(row.protocol);
  const attributes: JSONObject = windowAttributes(window, row);

  if (protocol) {
    attributes[FLOW_ATTRIBUTES.protocol] = protocol;
  }

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.LargeOutboundTransfer,
    time: eventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.LargeOutboundTransfer}:${row.srcIp}:${row.dstIp}:${windowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Low,
    message: `Large transfer out: ${row.srcIp} sent ${formatBytes(row.bytes)} to ${row.dstIp}${
      row.dstPort ? ` on port ${row.dstPort}` : ""
    }`,
    principalIp: row.srcIp,
    targetIp: row.dstIp,
    targetPort: row.dstPort,
    attributes,
  });
}

/*
 * Traffic with an address a threat-intel feed knows. The feed's own facts
 * are stamped by the enrichment every stored event goes through
 * (ThreatIntelEnricher); this says which side it was.
 */
export function buildThreatIntelTrafficEvent(
  row: FlowPairRow,
  window: FlowWindow,
  knownAddress: string,
): NormalizedSecurityEvent | null {
  if (!knownAddress || (row.srcIp !== knownAddress && row.dstIp !== knownAddress)) {
    return null;
  }

  const inbound: boolean = row.srcIp === knownAddress;
  const protocol: string = getProtocolName(row.protocol);
  const attributes: JSONObject = {
    ...windowAttributes(window, row),
    [FLOW_ATTRIBUTES.indicator]: knownAddress,
  };

  if (protocol) {
    attributes[FLOW_ATTRIBUTES.protocol] = protocol;
  }

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.ThreatIntelTraffic,
    time: eventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.ThreatIntelTraffic}:${row.srcIp}:${row.dstIp}:${row.dstPort}:${windowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.High,
    message: inbound
      ? `Traffic from a known-bad address: ${row.srcIp} → ${row.dstIp}${
          row.dstPort ? `:${row.dstPort}` : ""
        } (${formatBytes(row.bytes)})`
      : `Traffic to a known-bad address: ${row.srcIp} → ${row.dstIp}${
          row.dstPort ? `:${row.dstPort}` : ""
        } (${formatBytes(row.bytes)})`,
    principalIp: row.srcIp,
    targetIp: row.dstIp,
    targetPort: row.dstPort,
    attributes,
  });
}

/*
 * The addresses of a window worth asking threat intel about: public ones
 * only - a feed never lists a private address, and asking about them would
 * spend the lookup on addresses no feed can know.
 */
export function selectThreatIntelCandidates(
  addresses: Array<string>,
  limit: number,
): Array<string> {
  const candidates: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const address of addresses) {
    const value: string = (address || "").trim();

    if (
      !value ||
      seen.has(value) ||
      getSecurityAddressScope(value) !== SecurityAddressScope.Public
    ) {
      continue;
    }

    seen.add(value);
    candidates.push(value);

    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}
