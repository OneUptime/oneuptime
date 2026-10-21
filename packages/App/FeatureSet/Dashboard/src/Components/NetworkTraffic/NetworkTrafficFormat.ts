import NetworkFlowApplicationUtil, {
  NetworkFlowApplicationName,
} from "Common/Types/NetFlow/NetworkFlowApplication";
import {
  NetworkTrafficInterfaceRow,
  NetworkTrafficSeriesPoint,
} from "Common/Types/NetFlow/NetworkTraffic";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the Traffic pages write their numbers: bytes and bit rates in decimal
 * units (what links are sold in: 1 Mbps is a million bits a second), shares
 * of the total, and the names of applications and interfaces.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

const BYTE_UNITS: Array<string> = ["B", "kB", "MB", "GB", "TB", "PB"];
const RATE_UNITS: Array<string> = ["bps", "kbps", "Mbps", "Gbps", "Tbps"];

// Three significant digits: 1.23, 12.3, 123.
function significant(value: number): string {
  if (value >= 100) {
    return value.toFixed(0);
  }

  if (value >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function scaled(value: number, units: Array<string>): string {
  if (!Number.isFinite(value) || value <= 0) {
    return `0 ${units[0]}`;
  }

  let unitIndex: number = 0;
  let scaledValue: number = value;

  while (scaledValue >= 1000 && unitIndex < units.length - 1) {
    scaledValue = scaledValue / 1000;
    unitIndex++;
  }

  if (unitIndex === 0) {
    return `${Math.round(scaledValue)} ${units[0]}`;
  }

  return `${significant(scaledValue)} ${units[unitIndex]}`;
}

// 1234567 -> "1.23 MB".
export function formatTrafficBytes(octets: number): string {
  return scaled(octets, BYTE_UNITS);
}

// 12345678 bits a second -> "12.3 Mbps".
export function formatBitsPerSecond(bitsPerSecond: number): string {
  return scaled(bitsPerSecond, RATE_UNITS);
}

// Average bits a second over a span: bytes * 8 / seconds.
export function getBitsPerSecond(octets: number, seconds: number): number {
  if (seconds <= 0 || !Number.isFinite(octets)) {
    return 0;
  }

  return (octets * 8) / seconds;
}

// The busiest bucket's rate - the peak the chart shows.
export function getPeakBitsPerSecond(
  series: Array<NetworkTrafficSeriesPoint>,
  bucketSeconds: number,
): number {
  let peak: number = 0;

  for (const point of series) {
    peak = Math.max(peak, getBitsPerSecond(point.octets, bucketSeconds));
  }

  return peak;
}

// A row's share of the total, 0-100, for the bar behind it.
export function getSharePercent(octets: number, total: number): number {
  if (total <= 0 || octets <= 0) {
    return 0;
  }

  return Math.min(100, (octets / total) * 100);
}

// "42%" or "<1%": a share as people read it.
export function formatSharePercent(octets: number, total: number): string {
  const share: number = getSharePercent(octets, total);

  if (share === 0) {
    return "0%";
  }

  if (share < 1) {
    return "<1%";
  }

  return `${Math.round(share)}%`;
}

export const PROTOCOL_NUMBER_LABEL: string = translationKey(
  "Protocol {{number}}",
);
export const PROTOCOL_PORT_LABEL: string = translationKey(
  "{{protocol}} port {{port}}",
);
export const INTERFACE_INDEX_LABEL: string = translationKey(
  "Interface {{index}}",
);

export interface ApplicationLabel {
  // What the row says first: "HTTPS", "TCP port 8081", "GRE".
  name: string;
  // What it says under it, when the name is a service: "TCP port 443".
  detail: string | null;
}

/*
 * An application's name: the service usually on its port ("HTTPS", with
 * "TCP port 443" under it), the protocol and port when the port is no known
 * service ("TCP port 8081"), the protocol alone when it has no ports
 * ("ICMP"), or its number when nobody named it ("Protocol 99").
 */
export function getApplicationLabel(
  protocolNumber: number,
  port: number,
  translator: Translator,
): ApplicationLabel {
  const name: NetworkFlowApplicationName =
    NetworkFlowApplicationUtil.getApplicationName(protocolNumber, port);

  const protocol: string =
    name.protocolName ||
    translator.translateTemplate(PROTOCOL_NUMBER_LABEL, {
      number: protocolNumber,
    });

  const protocolAndPort: string | null =
    NetworkFlowApplicationUtil.hasPorts(protocolNumber) && name.port > 0
      ? translator.translateTemplate(PROTOCOL_PORT_LABEL, {
          protocol: protocol,
          port: name.port,
        })
      : null;

  if (name.serviceName) {
    return { name: name.serviceName, detail: protocolAndPort };
  }

  return { name: protocolAndPort || protocol, detail: null };
}

// An interface's name from the device's walk, else its index.
export function getInterfaceLabel(
  row: NetworkTrafficInterfaceRow,
  translator: Translator,
): string {
  return (
    row.name ||
    translator.translateTemplate(INTERFACE_INDEX_LABEL, {
      index: row.interfaceIndex,
    })
  );
}

/*
 * How busy an interface was over the window, as a share of its speed: its
 * busier direction's average rate over the link's speed. Null when the speed
 * is not known (a device not walked over SNMP).
 */
export function getInterfaceUtilizationPercent(
  row: NetworkTrafficInterfaceRow,
  windowSeconds: number,
): number | null {
  if (!row.speedInMbps || row.speedInMbps <= 0 || windowSeconds <= 0) {
    return null;
  }

  const busierOctets: number = Math.max(row.inOctets, row.outOctets);
  const bitsPerSecond: number = getBitsPerSecond(busierOctets, windowSeconds);

  return Math.min(100, (bitsPerSecond / (row.speedInMbps * 1_000_000)) * 100);
}
