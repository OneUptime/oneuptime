import { NetworkTopologyDeviceRole } from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import SnmpVendorTemplateUtil from "../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { getNetworkControllerProviderTitle } from "../../Types/NetworkController/NetworkControllerProvider";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import {
  NetworkDeviceControllerField,
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
  getDiscoveredTime,
  readNetworkDeviceDiscoveredDetails,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import IP from "../../Types/IP/IP";
import {
  AssetFactDifference,
  AssetFactSource,
  AssetFactSourceKind,
  sourceOfControllerReading,
  sourceOfDiscoveredValue,
} from "../Inventory/AssetFactSource";
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
 * everything OneUptime holds about it (OneUptime issue #4569), and where each
 * one came from (issue #5185).
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
 *   IP address        the address the probe polls, when that is an address;
 *                     else the address its probe resolved its DNS name to.
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
 * WHAT DISCOVERY ADDS (issue #5185). A device OneUptime only pings has none of
 * the SNMP columns above, but the discovery scan that sweeps its subnet may
 * have read its system group, its reverse-DNS name and its NetBIOS name; a
 * walked router's ARP table its MAC; its probe the address its DNS name
 * resolves to. Those readings are kept apart, in the device's discovered
 * details (Types/NetworkDevice/NetworkDeviceDiscoveredDetails), and this is
 * the one place they meet the columns - the "effective" inputs below:
 *
 *   - A value SAVED on the device - typed, set through the API, kept from
 *     its import - always wins, and is never replaced by anything discovery
 *     read. When discovery read something different, both are reported.
 *   - A value the device's own SNMP poll read wins too, unless discovery
 *     read the same detail AFTER that poll last succeeded: of two automatic
 *     readings, the newer one describes the device as it is.
 *   - A detail the device has no value for takes what discovery read.
 *
 * A column of the SNMP system group counts as the poll's when the device has
 * been walked (lastSnmpSeenAt), and as saved otherwise; ENTITY-MIB's columns
 * likewise. A device read without its discovered details or its last walk
 * time therefore reads exactly as it did before #5185.
 *
 * WHAT ITS CONTROLLER ADDS. A device a network controller manages - a
 * Meraki switch, access point or appliance in an organization the project
 * reads - is described by the controller's device list too, recorded whole
 * as the device's controller reading. A Meraki device implements no
 * ENTITY-MIB, so its own poll reads no serial number, model or firmware, and
 * the dashboard knows all three. The controller FILLS IN: its model, serial
 * number, firmware and maker where neither a saved value nor the device's
 * own poll has one (a saved value it disagrees with is shown beside it);
 * its MAC, management address, name and street address where nothing else
 * gives them; and its product type when nothing it reports says what it is.
 * Its name never outranks what the device says it is called, and its
 * address never becomes the hostname.
 *
 * Every fact is either a real value or undefined - never a placeholder - so
 * "unknown" is decided once, by whoever shows it.
 *
 * Pure and in Common: the inventory mirror writes these onto the device's
 * inventory item, and the device's own page and its item's page show the same
 * values, with where each came from.
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
  // True when the MAC above was learned from an ARP table rather than typed.
  isMacAddressLearned?: unknown;
  vendor?: unknown;
  deviceModel?: unknown;
  serialNumber?: unknown;
  firmwareVersion?: unknown;
  softwareVersion?: unknown;
  sysDescr?: unknown;
  sysObjectId?: unknown;
  sysLocation?: unknown;
  sysContact?: unknown;
  // When the device's own SNMP poll last succeeded.
  lastSnmpSeenAt?: unknown;
  // What discovery read about the device (issue #5185).
  discoveredDetails?: unknown;
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

export type NetworkDeviceAssetFactKey = keyof NetworkDeviceAssetFacts;

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
 * One fact, with where it came from. `value` is undefined for unknown, and
 * then there is no source either.
 */
export interface NetworkDeviceFactDetail {
  value?: string | undefined;
  source?: AssetFactSource | undefined;
  /*
   * What discovery read for the same detail, when it differs from a value
   * saved on the device. The saved value is the one shown and kept.
   */
  discoveredDifferent?: AssetFactDifference | undefined;
}

// The SNMP system group, as the device's page lists it.
export type NetworkDeviceSystemKey =
  | "sysName"
  | "sysDescr"
  | "sysObjectId"
  | "sysLocation"
  | "sysContact";

export interface NetworkDeviceFactDetails {
  facts: Record<NetworkDeviceAssetFactKey, NetworkDeviceFactDetail>;
  system: Record<NetworkDeviceSystemKey, NetworkDeviceFactDetail>;
  // The discovery scan that last found the device at its address.
  foundBy?: NetworkDeviceDiscoverySighting | undefined;
  // A scan that found another machine answering at the device's address.
  otherMachine?: NetworkDeviceOtherMachineSighting | undefined;
  // What the device's network controller says about it (the Meraki dashboard).
  controller?: NetworkDeviceControllerReading | undefined;
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

/*
 * A time out of a row - a Date, or a date string from the API - as epoch
 * milliseconds, or undefined for anything else.
 */
function readTime(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value.trim()).getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  return undefined;
}

// --- The effective inputs: a column, or what discovery read ------------------

/*
 * One input the facts are worked out from, with where its value came from.
 * Empty when nothing has a value for it.
 */
export interface NetworkDeviceEffectiveInput {
  value?: string | undefined;
  source?: AssetFactSource | undefined;
  discoveredDifferent?: AssetFactDifference | undefined;
}

export interface NetworkDeviceEffectiveInputs {
  sysName: NetworkDeviceEffectiveInput;
  sysDescr: NetworkDeviceEffectiveInput;
  sysObjectId: NetworkDeviceEffectiveInput;
  sysLocation: NetworkDeviceEffectiveInput;
  sysContact: NetworkDeviceEffectiveInput;
  vendor: NetworkDeviceEffectiveInput;
  deviceModel: NetworkDeviceEffectiveInput;
  serialNumber: NetworkDeviceEffectiveInput;
  firmwareVersion: NetworkDeviceEffectiveInput;
  softwareVersion: NetworkDeviceEffectiveInput;
  // A saved DNS name, else a reverse-DNS name discovery found.
  dnsName: NetworkDeviceEffectiveInput;
  macAddress: NetworkDeviceEffectiveInput;
  // A NetBIOS name discovery found (the one discovery NAMED it by is below).
  netbiosName: NetworkDeviceEffectiveInput;
  // The address the device's probe resolved its DNS name to.
  resolvedIpAddress: NetworkDeviceEffectiveInput;
  /*
   * What the device's network controller says about it (the Meraki
   * dashboard), for the facts nothing else knows: its name there, its
   * management address and MAC, the street address it is filed under, and
   * its product type.
   */
  controllerName: NetworkDeviceEffectiveInput;
  controllerIpAddress: NetworkDeviceEffectiveInput;
  controllerMacAddress: NetworkDeviceEffectiveInput;
  controllerAddress: NetworkDeviceEffectiveInput;
  controllerProductType: NetworkDeviceEffectiveInput;
  details: NetworkDeviceDiscoveredDetails;
}

function isSameValue(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/*
 * One value of the device's controller reading, with its source - or nothing
 * when the controller says nothing about it.
 */
function controllerInput(
  reading: NetworkDeviceControllerReading | undefined,
  field: NetworkDeviceControllerField,
): NetworkDeviceEffectiveInput {
  const value: string | undefined = reading?.values[field];

  return reading && value
    ? { value: value, source: sourceOfControllerReading(reading) }
    : {};
}

/*
 * A column a poll writes (or a person saved), with what the device's
 * controller says about the same detail - its model, serial number,
 * firmware, maker. The controller FILLS IN:
 *
 *   - nothing else has a value: the controller's;
 *   - a value saved on the device: the saved value, which is never replaced,
 *     and the controller's beside it when the two differ;
 *   - a value the device's own poll read: the poll's. It is what the box
 *     says about itself, and both are read every few minutes - "the newer
 *     wins" between the two would hand the detail back and forth with every
 *     read wherever they spell it differently ("15.2(7)E" on the box,
 *     "switch-15-21" in the dashboard). A Meraki device's own poll reads no
 *     model, serial number or firmware, so for it the dashboard gives them.
 */
function withControllerReading(
  input: NetworkDeviceEffectiveInput,
  controller: NetworkDeviceEffectiveInput,
): NetworkDeviceEffectiveInput {
  if (!controller.value || !controller.source) {
    return input;
  }

  if (!input.value) {
    return controller;
  }

  if (
    input.source?.kind === AssetFactSourceKind.Saved &&
    !input.discoveredDifferent &&
    !isSameValue(input.value, controller.value)
  ) {
    return {
      ...input,
      discoveredDifferent: {
        value: controller.value,
        source: controller.source,
      },
    };
  }

  return input;
}

function differenceOf(
  entry: NetworkDeviceDiscoveredValue,
): AssetFactDifference {
  return { value: entry.value, source: sourceOfDiscoveredValue(entry) };
}

/*
 * A column the device's SNMP poll writes, against what discovery read for the
 * same detail (when it reads that detail at all).
 */
function readPolledColumn(data: {
  column: unknown;
  discovered?: NetworkDeviceDiscoveredValue | undefined;
  lastPolledAt?: number | undefined;
  lastPolledAtIso?: string | undefined;
}): NetworkDeviceEffectiveInput {
  const column: string | undefined = readText(data.column);
  const discovered: NetworkDeviceDiscoveredValue | undefined = data.discovered;

  if (!column) {
    return discovered
      ? { value: discovered.value, source: sourceOfDiscoveredValue(discovered) }
      : {};
  }

  // Never walked: the value was saved on the device, and it stays.
  if (data.lastPolledAt === undefined) {
    return {
      value: column,
      source: { kind: AssetFactSourceKind.Saved },
      discoveredDifferent:
        discovered && !isSameValue(discovered.value, column)
          ? differenceOf(discovered)
          : undefined,
    };
  }

  // Two automatic readings: the newer one wins.
  const discoveredAt: number | undefined = getDiscoveredTime(discovered);

  if (
    discovered &&
    discoveredAt !== undefined &&
    discoveredAt > data.lastPolledAt
  ) {
    return {
      value: discovered.value,
      source: sourceOfDiscoveredValue(discovered),
    };
  }

  return {
    value: column,
    source: {
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: data.lastPolledAtIso,
    },
  };
}

/*
 * A value discovery found and nothing on the device holds: the discovered
 * value, or nothing.
 */
function readDiscoveredOnly(
  discovered: NetworkDeviceDiscoveredValue | undefined,
): NetworkDeviceEffectiveInput {
  return discovered
    ? { value: discovered.value, source: sourceOfDiscoveredValue(discovered) }
    : {};
}

/**
 * Every input the facts are worked out from, each the device's own value or
 * what discovery read - see the header for which wins.
 */
export function getNetworkDeviceEffectiveInputs(
  device: NetworkDeviceAssetSource,
): NetworkDeviceEffectiveInputs {
  const details: NetworkDeviceDiscoveredDetails =
    readNetworkDeviceDiscoveredDetails(device.discoveredDetails);
  const lastPolledAt: number | undefined = readTime(device.lastSnmpSeenAt);
  const lastPolledAtIso: string | undefined =
    lastPolledAt === undefined
      ? undefined
      : new Date(lastPolledAt).toISOString();

  const polled: (
    column: unknown,
    field?: NetworkDeviceDiscoveredField,
  ) => NetworkDeviceEffectiveInput = (
    column: unknown,
    field?: NetworkDeviceDiscoveredField,
  ): NetworkDeviceEffectiveInput => {
    return readPolledColumn({
      column: column,
      discovered: field ? details.values[field] : undefined,
      lastPolledAt: lastPolledAt,
      lastPolledAtIso: lastPolledAtIso,
    });
  };

  // DNS name: saved on the device (an import's PTR name, or a person's).
  const savedDnsName: string | undefined = readText(device.dnsName);
  const discoveredDnsName: NetworkDeviceDiscoveredValue | undefined =
    details.values[NetworkDeviceDiscoveredField.DnsName];
  let dnsName: NetworkDeviceEffectiveInput =
    readDiscoveredOnly(discoveredDnsName);

  if (savedDnsName) {
    const isDiscoveredSame: boolean = Boolean(
      discoveredDnsName && isSameValue(discoveredDnsName.value, savedDnsName),
    );

    dnsName = {
      value: savedDnsName,
      source:
        isDiscoveredSame && discoveredDnsName
          ? sourceOfDiscoveredValue(discoveredDnsName)
          : { kind: AssetFactSourceKind.Saved },
      discoveredDifferent:
        discoveredDnsName && !isDiscoveredSame
          ? differenceOf(discoveredDnsName)
          : undefined,
    };
  }

  // MAC address: typed, or learned from an ARP table.
  const savedMac: string | undefined = readText(device.macAddress);
  const discoveredMac: NetworkDeviceDiscoveredValue | undefined =
    details.values[NetworkDeviceDiscoveredField.MacAddress];
  let macAddress: NetworkDeviceEffectiveInput =
    readDiscoveredOnly(discoveredMac);

  if (savedMac) {
    const normalizedSaved: string = normalizeMac(savedMac) || savedMac;
    const isDiscoveredSame: boolean = Boolean(
      discoveredMac && discoveredMac.value === normalizedSaved,
    );

    if (device.isMacAddressLearned === true) {
      macAddress = {
        value: savedMac,
        source:
          isDiscoveredSame && discoveredMac
            ? sourceOfDiscoveredValue(discoveredMac)
            : { kind: AssetFactSourceKind.LearnedFromArp },
      };
    } else {
      macAddress = {
        value: savedMac,
        source: { kind: AssetFactSourceKind.Saved },
        discoveredDifferent:
          discoveredMac && !isDiscoveredSame
            ? differenceOf(discoveredMac)
            : undefined,
      };
    }
  }

  /*
   * What the device's controller says (the Meraki dashboard): its maker
   * is the controller's own, and its model, serial number and firmware are
   * the box's. A controller reads no SNMP system group, so it fills none of
   * those.
   */
  const controller: NetworkDeviceControllerReading | undefined =
    details.controller;

  /*
   * Its MAC, when nothing else gives one; and beside a typed one it differs
   * from, when no ARP table already does.
   */
  const controllerMac: NetworkDeviceEffectiveInput = controllerInput(
    controller,
    NetworkDeviceControllerField.MacAddress,
  );

  if (controllerMac.value && controllerMac.source) {
    if (!macAddress.value) {
      macAddress = controllerMac;
    } else if (
      macAddress.source?.kind === AssetFactSourceKind.Saved &&
      !macAddress.discoveredDifferent &&
      (normalizeMac(macAddress.value) || macAddress.value) !==
        controllerMac.value
    ) {
      macAddress = {
        ...macAddress,
        discoveredDifferent: {
          value: controllerMac.value,
          source: controllerMac.source,
        },
      };
    }
  }

  const controllerMaker: NetworkDeviceEffectiveInput = controller
    ? {
        value: getNetworkControllerProviderTitle(controller.provider),
        source: sourceOfControllerReading(controller),
      }
    : {};

  return {
    sysName: polled(device.sysName, NetworkDeviceDiscoveredField.SystemName),
    sysDescr: polled(
      device.sysDescr,
      NetworkDeviceDiscoveredField.SystemDescription,
    ),
    sysObjectId: polled(
      device.sysObjectId,
      NetworkDeviceDiscoveredField.SystemObjectId,
    ),
    sysLocation: polled(
      device.sysLocation,
      NetworkDeviceDiscoveredField.SystemLocation,
    ),
    sysContact: polled(
      device.sysContact,
      NetworkDeviceDiscoveredField.SystemContact,
    ),
    vendor: withControllerReading(polled(device.vendor), controllerMaker),
    deviceModel: withControllerReading(
      polled(device.deviceModel),
      controllerInput(controller, NetworkDeviceControllerField.Model),
    ),
    serialNumber: withControllerReading(
      polled(device.serialNumber),
      controllerInput(controller, NetworkDeviceControllerField.SerialNumber),
    ),
    firmwareVersion: withControllerReading(
      polled(device.firmwareVersion),
      controllerInput(controller, NetworkDeviceControllerField.FirmwareVersion),
    ),
    softwareVersion: polled(device.softwareVersion),
    dnsName: dnsName,
    macAddress: macAddress,
    netbiosName: readDiscoveredOnly(
      details.values[NetworkDeviceDiscoveredField.NetbiosName],
    ),
    resolvedIpAddress: readDiscoveredOnly(
      details.values[NetworkDeviceDiscoveredField.IpAddress],
    ),
    controllerName: controllerInput(
      controller,
      NetworkDeviceControllerField.Name,
    ),
    controllerIpAddress: controllerInput(
      controller,
      NetworkDeviceControllerField.IpAddress,
    ),
    controllerMacAddress: controllerInput(
      controller,
      NetworkDeviceControllerField.MacAddress,
    ),
    controllerAddress: controllerInput(
      controller,
      NetworkDeviceControllerField.Address,
    ),
    controllerProductType: controllerInput(
      controller,
      NetworkDeviceControllerField.ProductType,
    ),
    details: details,
  };
}

// --- The facts, each with its source -----------------------------------------

const SAVED: AssetFactSource = { kind: AssetFactSourceKind.Saved };

function fact(
  value: string | undefined,
  input?: NetworkDeviceEffectiveInput | AssetFactSource | undefined,
): NetworkDeviceFactDetail {
  if (!value) {
    return {};
  }

  if (!input) {
    return { value: value };
  }

  if ("kind" in input) {
    return { value: value, source: input };
  }

  return {
    value: value,
    source: input.source,
    discoveredDifferent: input.discoveredDifferent,
  };
}

/*
 * The name discovery imported the device under, when it came from `source`:
 * the device's own record of it, so it counts as saved.
 */
function discoveredNameFrom(
  device: NetworkDeviceAssetSource,
  source: DeviceNameSource,
): string | undefined {
  return device.discoveredNameSource === source
    ? readText(device.discoveredName)
    : undefined;
}

/*
 * The device's DNS name with its source: a saved or discovered DNS name, else
 * the address it is polled at when that is a DNS name rather than an IP
 * address.
 */
function getDnsNameFact(
  device: NetworkDeviceAssetSource,
  inputs: NetworkDeviceEffectiveInputs,
): NetworkDeviceFactDetail {
  const polled: string | undefined = readText(device.hostname);

  // A DNS name saved on the device, whatever discovery says about it.
  if (readText(device.dnsName)) {
    return fact(inputs.dnsName.value, inputs.dnsName);
  }

  if (polled && !isIpAddressLiteral(polled)) {
    const polledName: string | undefined = normalizeReverseDnsName(polled);

    if (polledName) {
      return fact(polledName, { kind: AssetFactSourceKind.PolledAddress });
    }
  }

  return fact(inputs.dnsName.value, inputs.dnsName);
}

/*
 * The device's own name with its source, by DeviceNameRule - or nothing when
 * only its address could name it.
 *
 * The naming rule ranks the device's SNMP system name, then the NetBIOS name a
 * Windows host reported, then its DNS name. Discovery records which of those
 * named the device; when that name is no longer in its own column (a device
 * imported by its sysName before its first walk, say) the recorded one is
 * still the device's own name and is used for that source. The address is
 * deliberately not offered: issue #4569 is an inventory record that read
 * "hostname = 10.241.124.1".
 */
function getHostnameFact(
  device: NetworkDeviceAssetSource,
  inputs: NetworkDeviceEffectiveInputs,
  dnsName: NetworkDeviceFactDetail,
): NetworkDeviceFactDetail {
  const importedSystemName: string | undefined = discoveredNameFrom(
    device,
    DeviceNameSource.SystemName,
  );
  const importedNetbiosName: string | undefined = discoveredNameFrom(
    device,
    DeviceNameSource.NetbiosName,
  );
  const importedDnsName: string | undefined = discoveredNameFrom(
    device,
    DeviceNameSource.DnsName,
  );

  const systemName: NetworkDeviceFactDetail = inputs.sysName.value
    ? fact(inputs.sysName.value, inputs.sysName)
    : fact(importedSystemName, SAVED);
  const netbiosName: NetworkDeviceFactDetail = importedNetbiosName
    ? fact(importedNetbiosName, SAVED)
    : fact(inputs.netbiosName.value, inputs.netbiosName);
  const dnsNameForHostname: NetworkDeviceFactDetail = dnsName.value
    ? dnsName
    : fact(importedDnsName, SAVED);

  const choice: DeviceNameChoice | undefined = chooseDeviceName({
    systemName: systemName.value,
    netbiosName: netbiosName.value,
    dnsName: dnsNameForHostname.value,
  });

  if (!choice?.name) {
    /*
     * Nothing the device says names it: the name its controller files it
     * under (the Meraki dashboard's), when it has one. Still never its
     * address.
     */
    return fact(inputs.controllerName.value, inputs.controllerName);
  }

  const from: NetworkDeviceFactDetail =
    choice.source === DeviceNameSource.SystemName
      ? systemName
      : choice.source === DeviceNameSource.NetbiosName
        ? netbiosName
        : dnsNameForHostname;

  /*
   * A disagreement belongs to the detail it is about (the DNS name, the MAC),
   * not to the hostname that happens to be made of it.
   */
  return { value: choice.name, source: from.source };
}

/** The address the device is polled at, or its probe resolved it to. */
function getIpAddressFact(
  device: NetworkDeviceAssetSource,
  inputs: NetworkDeviceEffectiveInputs,
): NetworkDeviceFactDetail {
  const polled: string | undefined = readText(device.hostname);

  if (polled && isIpAddressLiteral(polled)) {
    return fact(polled, { kind: AssetFactSourceKind.PolledAddress });
  }

  /*
   * A device polled at a DNS name: the address its probe resolved the name
   * to - only ever recorded for that very name, so it is the device's.
   */
  if (inputs.resolvedIpAddress.value) {
    return fact(inputs.resolvedIpAddress.value, inputs.resolvedIpAddress);
  }

  // Else the management address its controller lists for it.
  return fact(inputs.controllerIpAddress.value, inputs.controllerIpAddress);
}

function isSnmpAgentVendor(vendor: string): boolean {
  return SNMP_AGENT_VENDORS.has(vendor.trim().toLowerCase());
}

/*
 * Who made the device, with the input it was read from.
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
function getManufacturerFact(
  inputs: NetworkDeviceEffectiveInputs,
  described: SystemDescriptionFacts,
): NetworkDeviceFactDetail {
  const stored: string | undefined = inputs.vendor.value;
  const fromEnterprise: string | undefined =
    SnmpVendorTemplateUtil.getVendorName({
      sysObjectId: inputs.sysObjectId.value,
      sysDescr: inputs.sysDescr.value,
    });
  /*
   * The enterprise vendor is read off the sysObjectID, or off the sysDescr
   * for an agent that answers with another vendor's arc.
   */
  const enterpriseInput: NetworkDeviceEffectiveInput = inputs.sysObjectId.value
    ? inputs.sysObjectId
    : inputs.sysDescr;

  if (stored && stored !== fromEnterprise && !isSnmpAgentVendor(stored)) {
    return fact(stored, inputs.vendor);
  }

  if (described.manufacturer) {
    return fact(described.manufacturer, inputs.sysDescr.source);
  }

  const candidate: string | undefined = stored || fromEnterprise;

  if (!candidate || isSnmpAgentVendor(candidate)) {
    return {};
  }

  return stored
    ? fact(candidate, inputs.vendor)
    : fact(candidate, enterpriseInput.source);
}

/*
 * What the device is, as the topology map draws it: the role an operator
 * assigned, else the role its SNMP identity and name classify it as, by the
 * name the project gives that role. Nothing when the classifier cannot say -
 * a neutral answer, the same one the map gives.
 */
function getDeviceTypeFact(
  device: NetworkDeviceAssetSource,
  inputs: NetworkDeviceEffectiveInputs,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): NetworkDeviceFactDetail {
  const assignedName: string | undefined = readText(
    device.networkDeviceRole?.name,
  );

  if (assignedName) {
    return fact(assignedName, { kind: AssetFactSourceKind.AssignedRole });
  }

  let classified: NetworkTopologyDeviceRole = classifyDeviceRole({
    sysDescr: inputs.sysDescr.value,
    sysObjectId: inputs.sysObjectId.value,
    vendor: inputs.vendor.value,
    deviceModel: inputs.deviceModel.value,
    name: readText(device.name),
    sysName: inputs.sysName.value || readText(device.hostname),
  });
  let classifiedBy: AssetFactSource = { kind: AssetFactSourceKind.Classified };

  /*
   * Nothing it reports or is called says what it is: what its controller
   * files it as (a Meraki "switch", "wireless"...), when it says.
   */
  const controllerRole: NetworkTopologyDeviceRole | undefined =
    classified === "unknown"
      ? getRoleOfControllerProductType(inputs.controllerProductType.value)
      : undefined;

  if (controllerRole && inputs.controllerProductType.source) {
    classified = controllerRole;
    classifiedBy = inputs.controllerProductType.source;
  }

  const assignedKey: string | undefined = readText(
    device.networkDeviceRole?.key,
  );
  const roleKey: string | undefined = roleKeyForNode(assignedKey, classified);
  const projectLabel: string | undefined = stampForRoleKey(
    roleKey,
    buildDeviceRoleIndex(options?.roles || []),
  ).roleLabel;

  if (projectLabel) {
    return fact(
      projectLabel,
      assignedKey ? { kind: AssetFactSourceKind.AssignedRole } : classifiedBy,
    );
  }

  if (classified === "unknown") {
    return {};
  }

  return fact(labelForDeviceRole(classified), classifiedBy);
}

/*
 * The role a controller's product type stands for, or undefined for one that
 * names no network role (a sensor, a Systems Manager endpoint). A Meraki MX
 * or Z - an "appliance" - is a security appliance, as the classifier draws an
 * MX; a cellular or campus gateway routes.
 */
const ROLE_BY_CONTROLLER_PRODUCT_TYPE: Readonly<
  Record<string, NetworkTopologyDeviceRole>
> = {
  appliance: "firewall",
  switch: "switch",
  wireless: "wirelessAccessPoint",
  wirelessController: "wirelessAccessPoint",
  camera: "camera",
  cellularGateway: "router",
  campusGateway: "router",
};

export function getRoleOfControllerProductType(
  productType: string | undefined,
): NetworkTopologyDeviceRole | undefined {
  if (
    !productType ||
    !Object.prototype.hasOwnProperty.call(
      ROLE_BY_CONTROLLER_PRODUCT_TYPE,
      productType,
    )
  ) {
    return undefined;
  }

  return ROLE_BY_CONTROLLER_PRODUCT_TYPE[productType];
}

/*
 * Where the device says it is (sysLocation) - else the street address its
 * controller files it under - or nothing for a blank or an agent's default.
 */
function getSystemLocation(
  inputs: NetworkDeviceEffectiveInputs,
): NetworkDeviceFactDetail {
  const location: string | undefined = inputs.sysLocation.value;

  if (!location || PLACEHOLDER_LOCATIONS.has(location.toLowerCase())) {
    return fact(inputs.controllerAddress.value, inputs.controllerAddress);
  }

  return fact(location, inputs.sysLocation);
}

/**
 * Every asset fact of one network device, each with where it came from, and
 * the SNMP system group the device's page lists. See the header for which
 * value wins when the device and discovery both have one.
 */
export function getNetworkDeviceFactDetails(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): NetworkDeviceFactDetails {
  const inputs: NetworkDeviceEffectiveInputs =
    getNetworkDeviceEffectiveInputs(device);
  const described: SystemDescriptionFacts = parseSystemDescription(
    inputs.sysDescr.value,
  );
  const sysDescrSource: AssetFactSource | undefined = inputs.sysDescr.source;

  const dnsName: NetworkDeviceFactDetail = getDnsNameFact(device, inputs);
  const site: string | undefined = readText(device.site?.name);

  const macAddress: NetworkDeviceFactDetail = fact(
    toOtelMacAddress(inputs.macAddress.value),
    inputs.macAddress,
  );

  if (macAddress.discoveredDifferent) {
    macAddress.discoveredDifferent = {
      value:
        toOtelMacAddress(macAddress.discoveredDifferent.value) ||
        macAddress.discoveredDifferent.value,
      source: macAddress.discoveredDifferent.source,
    };
  }

  const pickFirst: (
    column: NetworkDeviceEffectiveInput,
    fromDescription: string | undefined,
  ) => NetworkDeviceFactDetail = (
    column: NetworkDeviceEffectiveInput,
    fromDescription: string | undefined,
  ): NetworkDeviceFactDetail => {
    if (column.value) {
      return fact(column.value, column);
    }

    return fact(fromDescription, sysDescrSource);
  };

  return {
    facts: {
      hostname: getHostnameFact(device, inputs, dnsName),
      ipAddress: getIpAddressFact(device, inputs),
      dnsName: dnsName,
      macAddress: macAddress,
      serialNumber: fact(inputs.serialNumber.value, inputs.serialNumber),
      manufacturer: getManufacturerFact(inputs, described),
      model: pickFirst(inputs.deviceModel, described.model),
      firmwareVersion: pickFirst(
        inputs.firmwareVersion,
        described.firmwareVersion,
      ),
      operatingSystem: fact(described.operatingSystem, sysDescrSource),
      osVersion: pickFirst(inputs.softwareVersion, described.osVersion),
      deviceType: getDeviceTypeFact(device, inputs, options),
      site: fact(site, { kind: AssetFactSourceKind.Site }),
      // Where the device says it is; the Site above is where it is filed.
      location: getSystemLocation(inputs),
    },
    system: {
      sysName: fact(inputs.sysName.value, inputs.sysName),
      sysDescr: fact(inputs.sysDescr.value, inputs.sysDescr),
      sysObjectId: fact(inputs.sysObjectId.value, inputs.sysObjectId),
      sysLocation: fact(inputs.sysLocation.value, inputs.sysLocation),
      sysContact: fact(inputs.sysContact.value, inputs.sysContact),
    },
    foundBy: inputs.details.foundBy,
    otherMachine: inputs.details.otherMachine,
    controller: inputs.details.controller,
  };
}

/**
 * The device's own name, by DeviceNameRule - or undefined when only its
 * address could name it. See getNetworkDeviceFactDetails.
 */
export function getNetworkDeviceHostname(
  device: NetworkDeviceAssetSource,
): string | undefined {
  return getNetworkDeviceFactDetails(device).facts.hostname.value;
}

/**
 * The device's DNS name: the reverse-DNS name discovery stored or found, else
 * the address it is polled at when that is a DNS name rather than an IP
 * address.
 */
export function getNetworkDeviceDnsName(
  device: NetworkDeviceAssetSource,
): string | undefined {
  return getDnsNameFact(device, getNetworkDeviceEffectiveInputs(device)).value;
}

/**
 * The address the device is polled at, when it is an IP address - else the
 * address its probe resolved the DNS name it is polled at to.
 */
export function getNetworkDeviceIpAddress(
  device: NetworkDeviceAssetSource,
): string | undefined {
  return getIpAddressFact(device, getNetworkDeviceEffectiveInputs(device))
    .value;
}

/**
 * Who made the device. See getManufacturerFact. `described` is the sysDescr's
 * reading when the caller already has it.
 */
export function getNetworkDeviceManufacturer(
  device: NetworkDeviceAssetSource,
  described?: SystemDescriptionFacts | undefined,
): string | undefined {
  const inputs: NetworkDeviceEffectiveInputs =
    getNetworkDeviceEffectiveInputs(device);

  return getManufacturerFact(
    inputs,
    described || parseSystemDescription(inputs.sysDescr.value),
  ).value;
}

/**
 * What the device is, as the topology map draws it. See getDeviceTypeFact.
 */
export function getNetworkDeviceType(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): string | undefined {
  return getDeviceTypeFact(
    device,
    getNetworkDeviceEffectiveInputs(device),
    options,
  ).value;
}

/**
 * Where the device says it is (sysLocation), or undefined for a blank or an
 * agent's default.
 */
export function getNetworkDeviceLocation(
  device: NetworkDeviceAssetSource,
): string | undefined {
  return getSystemLocation(getNetworkDeviceEffectiveInputs(device)).value;
}

/**
 * The device's system description (sysDescr): what its poll read, or what
 * discovery read when its poll has not.
 */
export function getNetworkDeviceSystemDescription(
  device: NetworkDeviceAssetSource,
): string | undefined {
  return getNetworkDeviceEffectiveInputs(device).sysDescr.value;
}

/**
 * Every asset fact of one network device. See the header for where each one
 * comes from and what wins.
 */
export function getNetworkDeviceAssetFacts(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): NetworkDeviceAssetFacts {
  const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
    device,
    options,
  );

  return {
    hostname: details.facts.hostname.value,
    ipAddress: details.facts.ipAddress.value,
    dnsName: details.facts.dnsName.value,
    macAddress: details.facts.macAddress.value,
    serialNumber: details.facts.serialNumber.value,
    manufacturer: details.facts.manufacturer.value,
    model: details.facts.model.value,
    firmwareVersion: details.facts.firmwareVersion.value,
    operatingSystem: details.facts.operatingSystem.value,
    osVersion: details.facts.osVersion.value,
    deviceType: details.facts.deviceType.value,
    site: details.facts.site.value,
    location: details.facts.location.value,
  };
}

export default getNetworkDeviceAssetFacts;
