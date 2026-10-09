import { NetworkTopologyDeviceRole } from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import SnmpVendorTemplateUtil from "../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import IP from "../../Types/IP/IP";
import { normalizeMac } from "../Monitor/EndpointAttachmentUtil";
import {
  TopologyDeviceRoleInput,
  buildDeviceRoleIndex,
  roleKeyForNode,
  stampForRoleKey,
} from "../Monitor/NetworkDeviceRoleCatalog";
import {
  classifyDeviceRole,
  labelForDeviceRole,
} from "../Monitor/NetworkDeviceRoleUtil";
import { normalizeReverseDnsName } from "../NetworkDiscovery/ReverseDnsNameUtil";
import { DeviceNameChoice, chooseDeviceName } from "./DeviceNameRule";
import {
  SystemDescriptionFacts,
  parseSystemDescription,
} from "./SystemDescriptionUtil";

/*
 * A network device's asset facts - the same set a host has - out of
 * everything OneUptime holds about it (OneUptime issue #4569).
 *
 * The Network Device record is the SNMP poller's: its columns are exactly
 * what the walk read, field by field. An asset register asks different
 * questions of it - what is the box called, what is its address, who made
 * it, what is it, where is it - and the answers are spread over several of
 * those columns, some of them only implied:
 *
 *   hostname          the device's own name, by the one naming rule
 *                     (DeviceNameRule): its sysName, the NetBIOS name
 *                     discovery found, its DNS name. NEVER its IP address:
 *                     an address is the IP address fact below, and a device
 *                     nothing names has no hostname to report.
 *   IP address        the address the probe polls, when that is an address.
 *   DNS name          its reverse-DNS name, or the DNS name it is polled at.
 *   MAC address       typed on the device or learned from an ARP table, in
 *                     the IEEE form hosts report (AC-DE-48-23-45-67).
 *   manufacturer      ENTITY-MIB's maker; else the sysDescr's; else the
 *                     sysObjectID enterprise's - but never an SNMP AGENT's
 *                     ("Net-SNMP" names the software answering, not the box).
 *   model, serial,    ENTITY-MIB; the model and versions read off the
 *   firmware, OS      sysDescr when the device implements no ENTITY-MIB
 *   version           (SystemDescriptionUtil). ENTITY-MIB always wins.
 *   operating system  the system the sysDescr names ("Cisco IOS").
 *   device type       the role: the one an operator assigned, else the one
 *                     the topology map draws it as, by the project's name for
 *                     that role. Undefined when nothing says.
 *   site, location    the Network Site it is assigned to, and the location it
 *                     reports itself (sysLocation).
 *
 * Every fact is either a real value or undefined - never a placeholder - so
 * "unknown" is decided once, by whoever shows it.
 *
 * Pure and in Common: the inventory mirror writes these onto the device's
 * inventory item, and the device's own page shows the same values.
 */

/*
 * What is read off a device. Every field is `unknown` and read defensively:
 * the values come out of database rows and API payloads, and "the column held
 * a number" must read as "no value", never throw inside a render or a sweep.
 */
export interface NetworkDeviceAssetSource {
  name?: unknown;
  hostname?: unknown;
  dnsName?: unknown;
  sysName?: unknown;
  discoveredName?: unknown;
  discoveredNameSource?: unknown;
  macAddress?: unknown;
  vendor?: unknown;
  deviceModel?: unknown;
  serialNumber?: unknown;
  firmwareVersion?: unknown;
  softwareVersion?: unknown;
  sysDescr?: unknown;
  sysObjectId?: unknown;
  sysLocation?: unknown;
  site?: { name?: unknown } | null | undefined;
  networkDeviceRole?: { key?: unknown; name?: unknown } | null | undefined;
}

export interface NetworkDeviceAssetFacts {
  hostname?: string | undefined;
  ipAddress?: string | undefined;
  dnsName?: string | undefined;
  macAddress?: string | undefined;
  serialNumber?: string | undefined;
  manufacturer?: string | undefined;
  model?: string | undefined;
  firmwareVersion?: string | undefined;
  operatingSystem?: string | undefined;
  osVersion?: string | undefined;
  deviceType?: string | undefined;
  site?: string | undefined;
  location?: string | undefined;
}

export interface NetworkDeviceAssetFactsOptions {
  /*
   * The project's configured device roles, so a device the classifier calls
   * a "wirelessAccessPoint" reads as whatever the project calls that role
   * ("Access Point"), exactly as the topology map labels it. Without them the
   * built-in label is used.
   */
  roles?: ReadonlyArray<TopologyDeviceRoleInput> | undefined;
}

/*
 * Vendors the sysObjectID table names that are SNMP agents rather than the
 * makers of the box the agent runs on. A Linux server, a NAS and a firewall
 * appliance can all answer with Net-SNMP's arc.
 */
const SNMP_AGENT_VENDORS: ReadonlySet<string> = new Set<string>(["net-snmp"]);

/*
 * sysLocation values that say nothing: the defaults agents ship with
 * (Net-SNMP's snmpd.conf really does say "Sitting on the Dock of the Bay")
 * and the placeholders a blank field is filled with. Compared without case.
 */
const PLACEHOLDER_LOCATIONS: ReadonlySet<string> = new Set<string>([
  "sitting on the dock of the bay",
  "unknown",
  "(unknown)",
  "none",
  "(none)",
  "null",
  "(null)",
  "n/a",
  "-",
  "not set",
  "not configured",
  "location",
  "default location",
]);

/**
 * A value as display text: a trimmed string, or undefined for anything that
 * is not a string or is blank. Numbers are not coerced - a column that holds
 * one is not holding what it is meant to.
 */
export function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim();
  return text ? text : undefined;
}

/**
 * A MAC in the form OpenTelemetry's `host.mac` prescribes - IEEE RA
 * hexadecimal, upper case, hyphen-separated (`AC-DE-48-23-45-67`) - which is
 * exactly what the collector's `system` detector emits for a host.
 *
 * NetworkDevice stores its MAC lower-case and colon-separated, so without
 * this the same NIC would be spelled two ways in one CMDB column depending on
 * whether it was a server or a switch. A value that is not a 48-bit MAC is
 * passed through rather than dropped: a strange spelling of a real value
 * beats no value.
 */
export function toOtelMacAddress(
  value: string | undefined | null,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized: string | undefined = normalizeMac(value);

  if (!normalized) {
    return value;
  }

  return normalized.toUpperCase().split(":").join("-");
}

/** True when `value` is an IPv4 or IPv6 address literal. */
export function isIpAddressLiteral(value: unknown): boolean {
  const text: string | undefined = readText(value);
  return Boolean(text && IP.isIP(text));
}

/**
 * The device's own name, by DeviceNameRule - or undefined when only its
 * address could name it.
 *
 * The naming rule ranks the device's SNMP system name, then the NetBIOS name a
 * Windows host reported, then its DNS name. Discovery records which of those
 * named the device; when that name is no longer in its own column (a device
 * imported by its sysName before its first walk, say) the recorded one is
 * still the device's own name and is used for that source. The address is
 * deliberately not offered: issue #4569 is an inventory record that read
 * "hostname = 10.241.124.1".
 */
export function getNetworkDeviceHostname(
  device: NetworkDeviceAssetSource,
): string | undefined {
  const source: unknown = device.discoveredNameSource;
  const discoveredName: unknown = device.discoveredName;

  const choice: DeviceNameChoice | undefined = chooseDeviceName({
    systemName:
      readText(device.sysName) ||
      (source === DeviceNameSource.SystemName ? discoveredName : undefined),
    netbiosName:
      source === DeviceNameSource.NetbiosName ? discoveredName : undefined,
    dnsName:
      getNetworkDeviceDnsName(device) ||
      (source === DeviceNameSource.DnsName ? discoveredName : undefined),
  });

  return choice?.name || undefined;
}

/**
 * The device's DNS name: the reverse-DNS name discovery stored, else the
 * address it is polled at when that is a DNS name rather than an IP address.
 */
export function getNetworkDeviceDnsName(
  device: NetworkDeviceAssetSource,
): string | undefined {
  const stored: string | undefined = readText(device.dnsName);

  if (stored) {
    return stored;
  }

  const polled: string | undefined = readText(device.hostname);

  if (!polled || isIpAddressLiteral(polled)) {
    return undefined;
  }

  return normalizeReverseDnsName(polled);
}

/** The address the device is polled at, when it is an IP address. */
export function getNetworkDeviceIpAddress(
  device: NetworkDeviceAssetSource,
): string | undefined {
  const polled: string | undefined = readText(device.hostname);
  return polled && isIpAddressLiteral(polled) ? polled : undefined;
}

/**
 * Who made the device.
 *
 * The vendor column holds ENTITY-MIB's manufacturer when the device has one,
 * and otherwise the vendor of its sysObjectID enterprise. The two can be told
 * apart, because the second is exactly what the sysObjectID gives: a column
 * that differs from it was written from ENTITY-MIB (or typed), and is kept as
 * it is. One that equals it is only the enterprise arc's vendor, and a
 * platform the sysDescr names is more specific - an EdgeSwitch answers with
 * Broadcom's arc and is a Ubiquiti switch. An SNMP agent's name is never a
 * manufacturer.
 */
export function getNetworkDeviceManufacturer(
  device: NetworkDeviceAssetSource,
  described: SystemDescriptionFacts = parseSystemDescription(device.sysDescr),
): string | undefined {
  const stored: string | undefined = readText(device.vendor);
  const fromEnterprise: string | undefined =
    SnmpVendorTemplateUtil.getVendorName({
      sysObjectId: readText(device.sysObjectId),
      sysDescr: readText(device.sysDescr),
    });

  if (stored && stored !== fromEnterprise && !isSnmpAgentVendor(stored)) {
    return stored;
  }

  if (described.manufacturer) {
    return described.manufacturer;
  }

  const candidate: string | undefined = stored || fromEnterprise;

  return candidate && !isSnmpAgentVendor(candidate) ? candidate : undefined;
}

function isSnmpAgentVendor(vendor: string): boolean {
  return SNMP_AGENT_VENDORS.has(vendor.trim().toLowerCase());
}

/**
 * What the device is, as the topology map draws it: the role an operator
 * assigned, else the role its SNMP identity and name classify it as, by the
 * name the project gives that role. Undefined when the classifier cannot say
 * - a neutral answer, the same one the map gives.
 */
export function getNetworkDeviceType(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): string | undefined {
  const assignedName: string | undefined = readText(
    device.networkDeviceRole?.name,
  );

  if (assignedName) {
    return assignedName;
  }

  const classified: NetworkTopologyDeviceRole = classifyDeviceRole({
    sysDescr: readText(device.sysDescr),
    sysObjectId: readText(device.sysObjectId),
    vendor: readText(device.vendor),
    deviceModel: readText(device.deviceModel),
    name: readText(device.name),
    sysName: readText(device.sysName) || readText(device.hostname),
  });

  const assignedKey: string | undefined = readText(
    device.networkDeviceRole?.key,
  );
  const roleKey: string | undefined = roleKeyForNode(assignedKey, classified);
  const projectLabel: string | undefined = stampForRoleKey(
    roleKey,
    buildDeviceRoleIndex(options?.roles || []),
  ).roleLabel;

  if (projectLabel) {
    return projectLabel;
  }

  if (classified === "unknown") {
    return undefined;
  }

  return labelForDeviceRole(classified);
}

/**
 * Where the device says it is (sysLocation), or undefined for a blank or an
 * agent's default.
 */
export function getNetworkDeviceLocation(
  device: NetworkDeviceAssetSource,
): string | undefined {
  const location: string | undefined = readText(device.sysLocation);

  if (!location || PLACEHOLDER_LOCATIONS.has(location.toLowerCase())) {
    return undefined;
  }

  return location;
}

/**
 * Every asset fact of one network device. See the header for where each one
 * comes from and what wins.
 */
export function getNetworkDeviceAssetFacts(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): NetworkDeviceAssetFacts {
  const described: SystemDescriptionFacts = parseSystemDescription(
    device.sysDescr,
  );

  return {
    hostname: getNetworkDeviceHostname(device),
    ipAddress: getNetworkDeviceIpAddress(device),
    dnsName: getNetworkDeviceDnsName(device),
    macAddress: toOtelMacAddress(readText(device.macAddress)),
    serialNumber: readText(device.serialNumber),
    manufacturer: getNetworkDeviceManufacturer(device, described),
    model: readText(device.deviceModel) || described.model,
    firmwareVersion:
      readText(device.firmwareVersion) || described.firmwareVersion,
    operatingSystem: described.operatingSystem,
    osVersion: readText(device.softwareVersion) || described.osVersion,
    deviceType: getNetworkDeviceType(device, options),
    site: readText(device.site?.name),
    location: getNetworkDeviceLocation(device),
  };
}

export default getNetworkDeviceAssetFacts;
