import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import {
  DISCOVERED_DETAILS_FOUND_BY_KEY,
  DISCOVERED_DETAILS_OTHER_MACHINE_KEY,
  NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
  buildDiscoveredValue,
  buildDiscoverySighting,
  buildOtherMachineSighting,
  cleanDiscoveredText,
  getDiscoveredTime,
  isNetworkDeviceDiscoveredField,
  normalizeDiscoveredValue,
  readDiscoveryTime,
  readNetworkDeviceDiscoveredDetails,
  MAX_DISCOVERY_READER_NAME_LENGTH,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { normalizeSystemName } from "../NetworkDevice/DeviceNameRule";
import { normalizeDiscoveredHosts } from "./DiscoveredHostUtil";
import { normalizeNetbiosName } from "./NetbiosNameUtil";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";
import { ScanNameUtil } from "./ScanNameUtil";

/*
 * What a discovery scan's result says about the devices already registered
 * at the addresses it swept (OneUptime issue #5185).
 *
 * A scan asks every host that answers for its SNMP system group (when the
 * scan checks SNMP), looks its address up in reverse DNS and, for Windows
 * hosts, asks for its NetBIOS name. Until #5185 that was used to NAME new
 * devices and to rename the ones discovery had named, and thrown away for
 * every other device at those addresses - a switch added by hand, a printer
 * imported from a ping sweep - which kept reading "Unknown" for details the
 * scan had just read. This plans, for each such device, what the result
 * should record as its discovered details
 * (Types/NetworkDevice/NetworkDeviceDiscoveredDetails): never a column of the
 * device, only the record of what discovery read, where and when.
 *
 * IS IT THE SAME MACHINE? A scan finds an ADDRESS, and an address is not a
 * machine: on a DHCP range the lease moves and the next scan finds somebody
 * else's laptop where the printer was. So before anything the scan read is
 * recorded for a device, the result has to agree with what the device
 * already says it is (isSameMachine), strongest evidence first:
 *
 *   1. What the machine says about itself - its SNMP system object ID (its
 *      model), its system name and its NetBIOS name. When the device knows
 *      one of these (from its own SNMP poll, or the name discovery imported
 *      it under) and the result read the same one, they must match.
 *   2. Only when neither side can be compared that way, its reverse-DNS name:
 *      the device's DNS name must be the PTR name the result found. A device
 *      with a DNS name and a result with no PTR name for its address (a
 *      lookup that failed) cannot be checked, and nothing is recorded.
 *   3. When nothing can be compared - a device known only by its address -
 *      the machine at the address is the device. It is what OneUptime pings
 *      there.
 *
 * A result that contradicts the device records ONE thing: that another
 * machine answered at its address, and what it said it was, so the device's
 * page can say so. None of its values are used for the device.
 *
 * FRESH VALUES, KEPT VALUES. A value the result read replaces the one an
 * earlier scan recorded, so the details follow the device as it changes. A
 * value the result did not read is kept, with the time it was read - unless
 * the result shows it is gone: a host that answered the scan's SNMP query
 * with no location has no location any more, so its old one is dropped.
 *
 * NEVER BACKWARDS. Results are not always processed in the order they were
 * read - two scans cover the same subnet, a worker catches up on a backlog -
 * so a result never replaces, or drops, anything recorded from a NEWER
 * reading than its own: each key is compared with the time it was recorded
 * at. Which also makes processing one result twice change nothing.
 *
 * Pure, like the rename planners beside it: the rule engine does the reads
 * and the one batched write (NetworkDeviceAutoImportRuleEngineService), and
 * the import builder records the same values for a device it creates.
 */

/*
 * The longest address worth looking a device up by: a device's hostname is
 * varchar(100), so a longer "address" can never match one - the same ceiling
 * the rename planners use (RunImportedDeviceNaming). Kept here rather than
 * imported, because the device builder imports this module and that one
 * imports the builder.
 */
const MAX_ADDRESS_LENGTH: number = 100;

// A row's text field, trimmed, or "" for anything that is not text.
function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The device columns the plan reads. Every field is re-checked at run time.
export interface DiscoveredDetailsDeviceRow {
  deviceId: string;
  projectId?: string | null | undefined;
  // The address the device is polled at - what the result is matched on.
  hostname?: string | null | undefined;
  // What the device already says it is.
  sysName?: string | null | undefined;
  sysObjectId?: string | null | undefined;
  dnsName?: string | null | undefined;
  discoveredName?: string | null | undefined;
  discoveredNameSource?: string | null | undefined;
  // What discovery has recorded already: nothing newer is ever replaced.
  discoveredDetails?: unknown;
}

// The scan the result belongs to: who read the values, and when.
export interface DiscoveredDetailsScan {
  id: string;
  name?: string | null | undefined;
  cidr?: string | null | undefined;
  // When the run finished: the time every value in the result was read by.
  completedAt?: Date | string | null | undefined;
}

/*
 * When the values a scan row holds were read: its last run's end, or - for a
 * run still going, whose partial results an import can already take - that
 * run's start. A row keeps the PREVIOUS run's completedAt while a new run
 * sweeps, so of the two times the later one is the run the hosts are from.
 */
export function getScanReadTime(scan: {
  completedAt?: Date | string | null | undefined;
  startedAt?: Date | string | null | undefined;
}): string | undefined {
  const completedAt: string | undefined = readDiscoveryTime(scan.completedAt);
  const startedAt: string | undefined = readDiscoveryTime(scan.startedAt);

  if (!completedAt || !startedAt) {
    return completedAt || startedAt;
  }

  return new Date(completedAt).getTime() >= new Date(startedAt).getTime()
    ? completedAt
    : startedAt;
}

/*
 * One device's change: the jsonb keys to set (whole entries) and the keys to
 * drop. NetworkDeviceService.mergeDiscoveredDetails applies it with `-` and
 * `||`, so keys other writers own (the MAC an ARP table taught, the address a
 * probe resolved) are never touched.
 */
export interface DiscoveredDetailsPatch {
  deviceId: string;
  set: Record<string, unknown>;
  unset: Array<string>;
}

// Why a result is, or is not, about the device at its address.
export enum DiscoveredMachineMatch {
  // The result agrees with what the device says it is.
  Same = "same",
  // Nothing could be compared; the machine at the address is the device.
  AddressOnly = "addressOnly",
  /*
   * The device has a DNS name and the result has nothing to hold it to: no
   * PTR name for the address (a lookup that failed or timed out) and nothing
   * the machine said about itself that the device knows too. Nothing is
   * recorded - a value that cannot be checked is not used.
   */
  Unverified = "unverified",
  // The result contradicts the device: another machine answers there.
  Other = "other",
}

/*
 * One address of a result, its rows merged: the SNMP system group from the
 * one row that read it (never mixed across rows, which could describe two
 * machines), and the names from the first row that has each.
 */
export interface DiscoveredAddressFindings {
  address: string;
  /*
   * True when the scan's SNMP query of this address succeeded: the values
   * below are the WHOLE system group, so a field missing from them is empty
   * on the device, not merely unread.
   */
  answeredSnmp: boolean;
  snmp: Partial<Record<NetworkDeviceDiscoveredField, string>>;
  dnsName?: string | undefined;
  netbiosName?: string | undefined;
}

function snmpValuesOf(
  host: DiscoveredNetworkDevice,
): Partial<Record<NetworkDeviceDiscoveredField, string>> {
  const values: Partial<Record<NetworkDeviceDiscoveredField, string>> = {};

  for (const field of NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS) {
    const value: string | undefined = normalizeDiscoveredValue(
      field,
      (host as unknown as Record<string, unknown>)[field],
    );

    if (value) {
      values[field] = value;
    }
  }

  return values;
}

/**
 * Each address of a result with what the scan found there, read through
 * normalizeDiscoveredHosts like every other reader of the jsonb. Accepts
 * `unknown`: "not an array" means "no hosts", never a throw inside a worker.
 */
export function getDiscoveredAddressFindings(
  hosts: unknown,
): Map<string, DiscoveredAddressFindings> {
  const findings: Map<string, DiscoveredAddressFindings> = new Map<
    string,
    DiscoveredAddressFindings
  >();

  if (!Array.isArray(hosts)) {
    return findings;
  }

  for (const host of normalizeDiscoveredHosts(
    hosts as Array<DiscoveredNetworkDevice>,
  )) {
    const address: string = host.ipAddress;

    if (!address || address.length > MAX_ADDRESS_LENGTH) {
      continue;
    }

    const current: DiscoveredAddressFindings = findings.get(address) || {
      address: address,
      answeredSnmp: false,
      snmp: {},
    };

    const snmp: Partial<Record<NetworkDeviceDiscoveredField, string>> =
      snmpValuesOf(host);
    const snmpCount: number = Object.keys(snmp).length;

    /*
     * The row whose SNMP answer says the most wins, whole. A row that
     * answered ping only (snmpReachable false) never read the system group.
     */
    if (
      host.snmpReachable !== false &&
      snmpCount > Object.keys(current.snmp).length
    ) {
      current.snmp = snmp;
      current.answeredSnmp = true;
    }

    if (!current.dnsName) {
      const dnsName: string | undefined = normalizeReverseDnsName(
        host.dnsHostname,
      );

      if (dnsName) {
        current.dnsName = dnsName;
      }
    }

    if (!current.netbiosName) {
      const netbiosName: string | undefined = normalizeNetbiosName(
        host.netbiosName,
      );

      if (netbiosName) {
        current.netbiosName = netbiosName;
      }
    }

    findings.set(address, current);
  }

  return findings;
}

/*
 * A DNS name as two are compared: trimmed, without the root label's dot, and
 * without case (RFC 4343).
 */
function toComparableDnsName(value: string): string {
  const trimmed: string = value.trim();

  return (
    trimmed.endsWith(".") ? trimmed.substring(0, trimmed.length - 1) : trimmed
  ).toLowerCase();
}

/*
 * True when two DNS names name the same host: equal, or - for a device whose
 * DNS name was shortened to its first label - the found name's first label.
 */
function isSameDnsName(deviceDnsName: string, foundDnsName: string): boolean {
  const expected: string = toComparableDnsName(deviceDnsName);
  const found: string = toComparableDnsName(foundDnsName);

  if (expected === found) {
    return true;
  }

  return !expected.includes(".") && found.split(".")[0] === expected;
}

function isSameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

// What the device already says it is, by the evidence the match reads.
interface DeviceIdentity {
  sysObjectId?: string | undefined;
  systemName?: string | undefined;
  netbiosName?: string | undefined;
  dnsName?: string | undefined;
}

function getDeviceIdentity(row: DiscoveredDetailsDeviceRow): DeviceIdentity {
  const source: string = readTrimmedString(row.discoveredNameSource);
  const discoveredName: string = readTrimmedString(row.discoveredName);

  return {
    sysObjectId: normalizeDiscoveredValue(
      NetworkDeviceDiscoveredField.SystemObjectId,
      row.sysObjectId,
    ),
    systemName:
      normalizeSystemName(row.sysName) ||
      (source === DeviceNameSource.SystemName
        ? normalizeSystemName(discoveredName)
        : undefined),
    netbiosName:
      source === DeviceNameSource.NetbiosName
        ? normalizeNetbiosName(discoveredName)
        : undefined,
    dnsName:
      normalizeReverseDnsName(row.dnsName) ||
      (source === DeviceNameSource.DnsName
        ? normalizeReverseDnsName(discoveredName)
        : undefined),
  };
}

/**
 * Whether what a scan found at the device's address is the device - see the
 * header for the order the evidence is read in.
 */
export function matchDiscoveredMachine(
  row: DiscoveredDetailsDeviceRow,
  found: DiscoveredAddressFindings,
): DiscoveredMachineMatch {
  const device: DeviceIdentity = getDeviceIdentity(row);
  const foundSystemName: string | undefined = normalizeSystemName(
    found.snmp[NetworkDeviceDiscoveredField.SystemName],
  );
  const foundSysObjectId: string | undefined =
    found.snmp[NetworkDeviceDiscoveredField.SystemObjectId];

  let comparedStrongEvidence: boolean = false;

  const strongPairs: Array<[string | undefined, string | undefined]> = [
    [device.sysObjectId, foundSysObjectId],
    [device.systemName, foundSystemName],
    [device.netbiosName, found.netbiosName],
  ];

  for (const [deviceValue, foundValue] of strongPairs) {
    if (!deviceValue || !foundValue) {
      continue;
    }

    comparedStrongEvidence = true;

    if (!isSameText(deviceValue, foundValue)) {
      return DiscoveredMachineMatch.Other;
    }
  }

  if (comparedStrongEvidence) {
    return DiscoveredMachineMatch.Same;
  }

  if (device.dnsName) {
    if (!found.dnsName) {
      return DiscoveredMachineMatch.Unverified;
    }

    return isSameDnsName(device.dnsName, found.dnsName)
      ? DiscoveredMachineMatch.Same
      : DiscoveredMachineMatch.Other;
  }

  return DiscoveredMachineMatch.AddressOnly;
}

/**
 * Who read a result's values: the scan, under the name it is listed by (its
 * own name, else its target), so a detail still says where it came from after
 * the scan is renamed or deleted.
 */
export function getScanReader(
  scan: DiscoveredDetailsScan,
): NetworkDeviceDiscoveryReader | undefined {
  const id: string = readTrimmedString(scan.id);

  if (!id) {
    return undefined;
  }

  const reader: NetworkDeviceDiscoveryReader = {
    type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
    id: id,
  };

  const name: string | undefined = cleanDiscoveredText(
    ScanNameUtil.getDisplayName(scan) || scan.cidr || "",
    MAX_DISCOVERY_READER_NAME_LENGTH,
  );

  if (name) {
    reader.name = name;
  }

  return reader;
}

/**
 * The entries a result records for a device it found at its address: every
 * value it read there, and that it found the device. Shared by the plan below
 * and the import builder, so a device imported from a scan starts with
 * exactly what that scan would have recorded for it.
 */
export function buildFoundMachineEntries(data: {
  found: DiscoveredAddressFindings;
  reader: NetworkDeviceDiscoveryReader;
  readAt: string;
}): DiscoveredDetailsPatch["set"] {
  const set: Record<string, unknown> = {};

  const add: (field: NetworkDeviceDiscoveredField, value: unknown) => void = (
    field: NetworkDeviceDiscoveredField,
    value: unknown,
  ): void => {
    const entry: NetworkDeviceDiscoveredValue | undefined =
      buildDiscoveredValue({
        field: field,
        value: value,
        readBy: data.reader,
        readAt: data.readAt,
      });

    if (entry) {
      set[field] = entry;
    }
  };

  for (const field of NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS) {
    add(field, data.found.snmp[field]);
  }

  add(NetworkDeviceDiscoveredField.DnsName, data.found.dnsName);
  add(NetworkDeviceDiscoveredField.NetbiosName, data.found.netbiosName);

  const sighting: NetworkDeviceDiscoverySighting | undefined =
    buildDiscoverySighting({ readBy: data.reader, readAt: data.readAt });

  if (sighting) {
    set[DISCOVERED_DETAILS_FOUND_BY_KEY] = sighting;
  }

  return set;
}

/**
 * The discovered details of a device created from `host`, as the scan it is
 * imported from read them - or null when the scan has no id or time to name,
 * or read nothing worth keeping. `scan.completedAt` is the time the values
 * were read (getScanReadTime).
 */
export function buildDiscoveredDetailsForImport(data: {
  host: DiscoveredNetworkDevice;
  scan: DiscoveredDetailsScan;
}): Record<string, unknown> | null {
  const reader: NetworkDeviceDiscoveryReader | undefined = getScanReader(
    data.scan,
  );
  const readAt: string | undefined = readDiscoveryTime(data.scan.completedAt);

  if (!reader || !readAt) {
    return null;
  }

  const found: DiscoveredAddressFindings | undefined =
    getDiscoveredAddressFindings([data.host]).values().next().value;

  if (!found) {
    return null;
  }

  const set: Record<string, unknown> = buildFoundMachineEntries({
    found: found,
    reader: reader,
    readAt: readAt,
  });

  return Object.keys(set).length > 0 ? set : null;
}

/*
 * When the device's current entry for `key` was read, or undefined when it
 * has none: the time a new reading has to be at least as recent as.
 */
function getRecordedTime(
  existing: NetworkDeviceDiscoveredDetails,
  key: string,
): number | undefined {
  if (isNetworkDeviceDiscoveredField(key)) {
    return getDiscoveredTime(existing.values[key]);
  }

  if (key === DISCOVERED_DETAILS_FOUND_BY_KEY) {
    return getDiscoveredTime(existing.foundBy);
  }

  if (key === DISCOVERED_DETAILS_OTHER_MACHINE_KEY) {
    return getDiscoveredTime(existing.otherMachine);
  }

  return undefined;
}

/*
 * The patch with every key the device holds a NEWER reading for left out, so
 * a result never moves a device's details backwards in time.
 */
function keepNotOlder(
  patch: DiscoveredDetailsPatch,
  existing: NetworkDeviceDiscoveredDetails,
  readAtTime: number,
): DiscoveredDetailsPatch {
  const isNotOlder: (key: string) => boolean = (key: string): boolean => {
    const recordedAt: number | undefined = getRecordedTime(existing, key);
    return recordedAt === undefined || recordedAt <= readAtTime;
  };

  const set: Record<string, unknown> = {};

  for (const key of Object.keys(patch.set)) {
    if (isNotOlder(key)) {
      set[key] = patch.set[key];
    }
  }

  return {
    deviceId: patch.deviceId,
    set: set,
    unset: patch.unset.filter((key: string): boolean => {
      return isNotOlder(key);
    }),
  };
}

/**
 * What one result records for each device registered at an address it
 * reports. One patch per device, in the order the devices were given, and
 * none for a device the result has nothing newer for.
 *
 * A device of another project, at an address the result does not report, or
 * listed twice, gets nothing. So does every device when the scan has no id or
 * no completion time to say who read the values and when.
 */
export function planDiscoveredDetails(data: {
  projectId: string;
  scan: DiscoveredDetailsScan;
  hosts: unknown;
  devices: Array<DiscoveredDetailsDeviceRow>;
  /*
   * getDiscoveredAddressFindings(hosts), when the caller already has it - the
   * engine reads it once for its device lookup. `hosts` is not read then.
   */
  findings?: Map<string, DiscoveredAddressFindings> | undefined;
}): Array<DiscoveredDetailsPatch> {
  const projectId: string = readTrimmedString(data.projectId);
  const reader: NetworkDeviceDiscoveryReader | undefined = getScanReader(
    data.scan,
  );
  const readAt: string | undefined = readDiscoveryTime(data.scan.completedAt);

  if (!projectId || !reader || !readAt || !Array.isArray(data.devices)) {
    return [];
  }

  const readAtTime: number = new Date(readAt).getTime();

  const findings: Map<string, DiscoveredAddressFindings> =
    data.findings ?? getDiscoveredAddressFindings(data.hosts);

  if (findings.size === 0) {
    return [];
  }

  const patches: Array<DiscoveredDetailsPatch> = [];
  const seenDeviceIds: Set<string> = new Set<string>();

  for (const row of data.devices) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const deviceId: string = readTrimmedString(row.deviceId);

    if (!deviceId || seenDeviceIds.has(deviceId)) {
      continue;
    }

    if (readTrimmedString(row.projectId) !== projectId) {
      continue;
    }

    const found: DiscoveredAddressFindings | undefined = findings.get(
      readTrimmedString(row.hostname),
    );

    if (!found) {
      continue;
    }

    seenDeviceIds.add(deviceId);

    const match: DiscoveredMachineMatch = matchDiscoveredMachine(row, found);

    if (match === DiscoveredMachineMatch.Unverified) {
      continue;
    }

    const existing: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(row.discoveredDetails);

    if (match === DiscoveredMachineMatch.Other) {
      /*
       * Not when a newer scan found the device itself there: the address is
       * the device's again, whatever this older reading saw.
       */
      const foundAt: number | undefined = getDiscoveredTime(existing.foundBy);

      if (foundAt !== undefined && foundAt > readAtTime) {
        continue;
      }

      const note: NetworkDeviceOtherMachineSighting | undefined =
        buildOtherMachineSighting({
          readBy: reader,
          readAt: readAt,
          sysName: found.snmp[NetworkDeviceDiscoveredField.SystemName],
          sysObjectId: found.snmp[NetworkDeviceDiscoveredField.SystemObjectId],
          dnsName: found.dnsName,
          netbiosName: found.netbiosName,
        });

      if (note) {
        const patch: DiscoveredDetailsPatch = keepNotOlder(
          {
            deviceId: deviceId,
            set: { [DISCOVERED_DETAILS_OTHER_MACHINE_KEY]: note },
            unset: [],
          },
          existing,
          readAtTime,
        );

        if (Object.keys(patch.set).length > 0) {
          patches.push(patch);
        }
      }

      continue;
    }

    const set: Record<string, unknown> = buildFoundMachineEntries({
      found: found,
      reader: reader,
      readAt: readAt,
    });

    /*
     * The device is where the scan found it, so an earlier note that another
     * machine answered there is no longer true.
     */
    const unset: Array<string> = [DISCOVERED_DETAILS_OTHER_MACHINE_KEY];

    /*
     * A system group the scan READ is the whole system group: a field it
     * lacks is empty on the device now, so the value an earlier scan
     * recorded for it goes.
     */
    if (found.answeredSnmp) {
      for (const field of NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS) {
        if (!(field in set)) {
          unset.push(field);
        }
      }
    }

    const patch: DiscoveredDetailsPatch = keepNotOlder(
      { deviceId: deviceId, set: set, unset: unset },
      existing,
      readAtTime,
    );

    if (Object.keys(patch.set).length > 0 || patch.unset.length > 0) {
      patches.push(patch);
    }
  }

  return patches;
}

/**
 * The addresses of a result worth looking devices up by: every address it
 * found anything at. Devices registered elsewhere are not this result's.
 */
export function listDiscoveredAddresses(
  findings: Map<string, DiscoveredAddressFindings>,
): Array<string> {
  return Array.from(findings.keys());
}

export default planDiscoveredDetails;
