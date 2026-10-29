import IP from "../IP/IP";
import NetworkControllerProvider, {
  isNetworkControllerProvider,
} from "../NetworkController/NetworkControllerProvider";
import { normalizeMac } from "../../Utils/Monitor/EndpointAttachmentUtil";
import { normalizeNetbiosName } from "../../Utils/NetworkDiscovery/NetbiosNameUtil";
import { normalizeReverseDnsName } from "../../Utils/NetworkDiscovery/ReverseDnsNameUtil";

/*
 * What discovery found out about a network device, where it found it, and
 * when (OneUptime issue #5185).
 *
 * WHY. A device's details came from one place: its own SNMP poll. A device
 * OneUptime only pings - one added by hand, imported from a ping sweep, or
 * monitored by another monitor - therefore read "Unknown" for its hostname,
 * maker, model, operating system, type and location, although the discovery
 * scan that sweeps its subnet had asked it for exactly those, over SNMP, in a
 * single GET, and the probe had looked its address up in DNS. That scan used
 * what it read to name NEW devices and threw the rest away. Likewise the MAC
 * address a router's ARP table taught OneUptime said nothing about which
 * router, or when; and a device polled at a DNS name had no IP address at all,
 * although its probe resolves the name every time it polls.
 *
 * WHAT IS STORED. One entry per detail a reader found, each with the value,
 * HOW it was read (an SNMP query, a reverse-DNS lookup, an ARP table...), WHO
 * read it (the discovery scan, the walked device whose ARP table it is, the
 * probe) and WHEN. Plus two notes about the device's address: the scan that
 * last found the device there (`foundBy`), and - when a scan found a
 * DIFFERENT machine answering at the address - what that machine said it was
 * (`otherMachine`), so its details are never mistaken for this device's.
 *
 * WHAT IT IS NOT. It is never the device's own columns. Discovery writes here
 * and only here, so nothing a person typed, the API wrote or Terraform set -
 * and nothing the device's own SNMP poll read - is ever overwritten by it.
 * The device's asset facts (Utils/NetworkDevice/NetworkDeviceAssetFacts) read
 * a column first and a discovered value only when the column says nothing (or
 * when the column is an older reading by an automatic source), and say where
 * each fact came from; when a value someone saved disagrees with what
 * discovery read, both are shown.
 *
 * FLAT, ON PURPOSE. Each entry is a top-level key of the jsonb column, so the
 * four writers - the discovery engine (scan results), the ARP learner (MACs),
 * the poll pipeline (resolved addresses) and a network controller connection
 * (what the device's controller says it is, under one key of its own) - each
 * merge their own keys with jsonb `||` in one statement
 * (NetworkDeviceService.mergeDiscoveredDetails) and never overwrite one
 * another's.
 *
 * EVERY VALUE IS UNTRUSTED. A PTR name is chosen by whoever runs DNS for the
 * scanned subnet, a NetBIOS name and an SNMP system group by the machine at
 * the address. Every value is normalised on the way in (buildDiscoveredValue)
 * and again on the way out (readNetworkDeviceDiscoveredDetails), because the
 * column is jsonb that an API create can also carry.
 */

// The details discovery can find about a device, by the key each is stored under.
export enum NetworkDeviceDiscoveredField {
  // SNMP system group, read by a discovery scan's SNMP query.
  SystemName = "sysName",
  SystemDescription = "sysDescr",
  SystemObjectId = "sysObjectId",
  SystemLocation = "sysLocation",
  SystemContact = "sysContact",
  // The PTR record of the device's address, looked up by a scan's probe.
  DnsName = "dnsName",
  // The computer name a Windows or Samba host answered a scan's NBSTAT with.
  NetbiosName = "netbiosName",
  // The MAC a walked router's ARP table binds the device's address to.
  MacAddress = "macAddress",
  // The address the device's probe resolved the DNS name it is polled at to.
  IpAddress = "ipAddress",
}

// How a value was read.
export enum NetworkDeviceDiscoveryMethod {
  Snmp = "snmp",
  ReverseDns = "reverseDns",
  Netbios = "netbios",
  ArpTable = "arpTable",
  Dns = "dns",
}

// What read it.
export enum NetworkDeviceDiscoveryReaderType {
  DiscoveryScan = "discoveryScan",
  // A walked device: the router or switch whose ARP table it is.
  NetworkDevice = "networkDevice",
  Probe = "probe",
  /*
   * A network controller connection - a Meraki organization the project
   * reads (NetworkControllerConnection): what its controller says about the
   * device. Only the controller reading below is read by one.
   */
  NetworkController = "networkController",
}

export interface NetworkDeviceDiscoveryReader {
  type: NetworkDeviceDiscoveryReaderType;
  // The scan's, device's or probe's id.
  id: string;
  /*
   * Its name when it read the value, so the detail still says where it came
   * from after the scan, device or probe is renamed or deleted.
   */
  name?: string | undefined;
}

export interface NetworkDeviceDiscoveredValue {
  value: string;
  method: NetworkDeviceDiscoveryMethod;
  readBy: NetworkDeviceDiscoveryReader;
  // ISO-8601, UTC.
  readAt: string;
}

/*
 * The discovery scan that last found this device at its address - the
 * device's discovery source, and when it last confirmed the device is there.
 */
export interface NetworkDeviceDiscoverySighting {
  readBy: NetworkDeviceDiscoveryReader;
  readAt: string;
}

/*
 * A scan found a different machine answering at the device's address: what it
 * said it was. None of what the scan read there is used for this device.
 */
export interface NetworkDeviceOtherMachineSighting {
  readBy: NetworkDeviceDiscoveryReader;
  readAt: string;
  sysName?: string | undefined;
  sysObjectId?: string | undefined;
  dnsName?: string | undefined;
  netbiosName?: string | undefined;
}

/*
 * What a device's network controller says it is: one reading of the
 * controller's device list (the Meraki dashboard's, for a Meraki
 * organization the project reads), recorded whole by the connection that
 * read it - unlike the per-field entries above, every value of it was read
 * at the same moment by the same reader, and it is replaced whole by the next
 * reading. Integration data as a source of a device's details (the
 * follow-ups of #5185 and #5225).
 *
 * The controller knows the box by its serial number, so what it says is the
 * device's own: its model, serial number, firmware, MAC address and
 * management address, the name it carries in the controller, its product
 * type, the controller network it belongs to and the street address the
 * controller files it under.
 */
export enum NetworkDeviceControllerField {
  Name = "name",
  Model = "model",
  SerialNumber = "serialNumber",
  MacAddress = "macAddress",
  IpAddress = "ipAddress",
  FirmwareVersion = "firmwareVersion",
  ProductType = "productType",
  NetworkName = "networkName",
  Address = "address",
}

export const NETWORK_DEVICE_CONTROLLER_FIELDS: ReadonlyArray<NetworkDeviceControllerField> =
  [
    NetworkDeviceControllerField.Name,
    NetworkDeviceControllerField.Model,
    NetworkDeviceControllerField.SerialNumber,
    NetworkDeviceControllerField.MacAddress,
    NetworkDeviceControllerField.IpAddress,
    NetworkDeviceControllerField.FirmwareVersion,
    NetworkDeviceControllerField.ProductType,
    NetworkDeviceControllerField.NetworkName,
    NetworkDeviceControllerField.Address,
  ];

/*
 * The product types a Meraki device list names
 * (developer.cisco.com/meraki/api-v1/get-organization-devices). Anything
 * else is not one and is dropped, never shown.
 */
export const NETWORK_CONTROLLER_PRODUCT_TYPES: ReadonlyArray<string> = [
  "appliance",
  "switch",
  "wireless",
  "camera",
  "sensor",
  "cellularGateway",
  "wirelessController",
  "campusGateway",
  "secureConnect",
  "systemsManager",
];

/*
 * The longest each controller value is kept: a name, model, serial number,
 * firmware and network name as wide as the device columns that hold the
 * same kind of detail (varchar(100)); a street address 255.
 */
export const MAX_CONTROLLER_VALUE_LENGTH: Readonly<
  Record<NetworkDeviceControllerField, number>
> = {
  [NetworkDeviceControllerField.Name]: 100,
  [NetworkDeviceControllerField.Model]: 100,
  [NetworkDeviceControllerField.SerialNumber]: 100,
  [NetworkDeviceControllerField.MacAddress]: 17,
  [NetworkDeviceControllerField.IpAddress]: 45,
  [NetworkDeviceControllerField.FirmwareVersion]: 100,
  [NetworkDeviceControllerField.ProductType]: 32,
  [NetworkDeviceControllerField.NetworkName]: 100,
  [NetworkDeviceControllerField.Address]: 255,
};

export interface NetworkDeviceControllerReading {
  // The controller: a NetworkControllerProvider ("meraki").
  provider: NetworkControllerProvider;
  // The connection that read it, by id and by its name at the time.
  readBy: NetworkDeviceDiscoveryReader;
  // ISO-8601, UTC: when the connection read the controller's device list.
  readAt: string;
  values: Partial<Record<NetworkDeviceControllerField, string>>;
}

export interface NetworkDeviceDiscoveredDetails {
  values: Partial<
    Record<NetworkDeviceDiscoveredField, NetworkDeviceDiscoveredValue>
  >;
  foundBy?: NetworkDeviceDiscoverySighting | undefined;
  otherMachine?: NetworkDeviceOtherMachineSighting | undefined;
  controller?: NetworkDeviceControllerReading | undefined;
}

// The jsonb key of the controller reading.
export const DISCOVERED_DETAILS_CONTROLLER_KEY: string = "controller";

// The jsonb keys of the two address notes.
export const DISCOVERED_DETAILS_FOUND_BY_KEY: string = "foundBy";
export const DISCOVERED_DETAILS_OTHER_MACHINE_KEY: string = "otherMachine";

export const NETWORK_DEVICE_DISCOVERED_FIELDS: ReadonlyArray<NetworkDeviceDiscoveredField> =
  [
    NetworkDeviceDiscoveredField.SystemName,
    NetworkDeviceDiscoveredField.SystemDescription,
    NetworkDeviceDiscoveredField.SystemObjectId,
    NetworkDeviceDiscoveredField.SystemLocation,
    NetworkDeviceDiscoveredField.SystemContact,
    NetworkDeviceDiscoveredField.DnsName,
    NetworkDeviceDiscoveredField.NetbiosName,
    NetworkDeviceDiscoveredField.MacAddress,
    NetworkDeviceDiscoveredField.IpAddress,
  ];

// The SNMP system group: the fields a discovery scan's SNMP query reads.
export const NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS: ReadonlyArray<NetworkDeviceDiscoveredField> =
  [
    NetworkDeviceDiscoveredField.SystemName,
    NetworkDeviceDiscoveredField.SystemDescription,
    NetworkDeviceDiscoveredField.SystemObjectId,
    NetworkDeviceDiscoveredField.SystemLocation,
    NetworkDeviceDiscoveredField.SystemContact,
  ];

/*
 * The one method, and the one kind of reader, each field is read by. A stored
 * entry that pairs a field with anything else was not written by OneUptime
 * and is dropped on read.
 */
const METHOD_BY_FIELD: Readonly<
  Record<NetworkDeviceDiscoveredField, NetworkDeviceDiscoveryMethod>
> = {
  [NetworkDeviceDiscoveredField.SystemName]: NetworkDeviceDiscoveryMethod.Snmp,
  [NetworkDeviceDiscoveredField.SystemDescription]:
    NetworkDeviceDiscoveryMethod.Snmp,
  [NetworkDeviceDiscoveredField.SystemObjectId]:
    NetworkDeviceDiscoveryMethod.Snmp,
  [NetworkDeviceDiscoveredField.SystemLocation]:
    NetworkDeviceDiscoveryMethod.Snmp,
  [NetworkDeviceDiscoveredField.SystemContact]:
    NetworkDeviceDiscoveryMethod.Snmp,
  [NetworkDeviceDiscoveredField.DnsName]:
    NetworkDeviceDiscoveryMethod.ReverseDns,
  [NetworkDeviceDiscoveredField.NetbiosName]:
    NetworkDeviceDiscoveryMethod.Netbios,
  [NetworkDeviceDiscoveredField.MacAddress]:
    NetworkDeviceDiscoveryMethod.ArpTable,
  [NetworkDeviceDiscoveredField.IpAddress]: NetworkDeviceDiscoveryMethod.Dns,
};

const READER_TYPE_BY_FIELD: Readonly<
  Record<NetworkDeviceDiscoveredField, NetworkDeviceDiscoveryReaderType>
> = {
  [NetworkDeviceDiscoveredField.SystemName]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.SystemDescription]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.SystemObjectId]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.SystemLocation]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.SystemContact]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.DnsName]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.NetbiosName]:
    NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  [NetworkDeviceDiscoveredField.MacAddress]:
    NetworkDeviceDiscoveryReaderType.NetworkDevice,
  [NetworkDeviceDiscoveredField.IpAddress]:
    NetworkDeviceDiscoveryReaderType.Probe,
};

/*
 * The longest each value is kept: the width of the device column that holds
 * the same detail (sysDescr is varchar(500), the rest of the system group
 * varchar(100)), a DNS name's 253 characters, a NetBIOS name's 15, an IPv6
 * address with an IPv4 tail's 45. A longer value is cut, never refused: a
 * sysDescr of 600 characters still names the platform in its first 500.
 */
export const MAX_DISCOVERED_VALUE_LENGTH: Readonly<
  Record<NetworkDeviceDiscoveredField, number>
> = {
  [NetworkDeviceDiscoveredField.SystemName]: 100,
  [NetworkDeviceDiscoveredField.SystemDescription]: 500,
  [NetworkDeviceDiscoveredField.SystemObjectId]: 100,
  [NetworkDeviceDiscoveredField.SystemLocation]: 100,
  [NetworkDeviceDiscoveredField.SystemContact]: 100,
  [NetworkDeviceDiscoveredField.DnsName]: 253,
  [NetworkDeviceDiscoveredField.NetbiosName]: 15,
  [NetworkDeviceDiscoveredField.MacAddress]: 17,
  [NetworkDeviceDiscoveredField.IpAddress]: 45,
};

// A reader's id and name, cut to these.
export const MAX_DISCOVERY_READER_ID_LENGTH: number = 100;
export const MAX_DISCOVERY_READER_NAME_LENGTH: number = 100;

/*
 * The scan input a value is read from can be megabytes of jsonb. Nothing
 * longer than this is even looked at: it is cut first, so every scan below is
 * of a bounded string.
 */
const MAX_INPUT_SCAN_LENGTH: number = 1024;

const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>(
  NETWORK_DEVICE_DISCOVERED_FIELDS,
);

const KNOWN_READER_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(NetworkDeviceDiscoveryReaderType),
);

export function isNetworkDeviceDiscoveredField(
  value: unknown,
): value is NetworkDeviceDiscoveredField {
  return typeof value === "string" && KNOWN_FIELDS.has(value);
}

/*
 * True for a top-level key of the jsonb column: a field, one of the two
 * address notes, or the controller reading. A writer may set or drop only
 * these.
 */
export function isDiscoveredDetailsKey(value: unknown): value is string {
  return (
    isNetworkDeviceDiscoveredField(value) ||
    value === DISCOVERED_DETAILS_FOUND_BY_KEY ||
    value === DISCOVERED_DETAILS_OTHER_MACHINE_KEY ||
    value === DISCOVERED_DETAILS_CONTROLLER_KEY
  );
}

export function getDiscoveryMethodForField(
  field: NetworkDeviceDiscoveredField,
): NetworkDeviceDiscoveryMethod {
  return METHOD_BY_FIELD[field];
}

export function getDiscoveryReaderTypeForField(
  field: NetworkDeviceDiscoveredField,
): NetworkDeviceDiscoveryReaderType {
  return READER_TYPE_BY_FIELD[field];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * Free text out of an SNMP agent, as a value worth showing: trimmed, every
 * control character (a NUL from a fixed-size buffer, a line break) turned
 * into a space and runs of spaces closed up, cut to `maxLength`. Undefined
 * for anything that is not text or is blank once cleaned.
 *
 * A character loop rather than a pattern: the input is untrusted and read out
 * of jsonb of any length, and a loop is linear whatever it holds.
 */
export function cleanDiscoveredText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const input: string = value.substring(0, MAX_INPUT_SCAN_LENGTH);
  let cleaned: string = "";
  let lastWasSpace: boolean = true;

  for (let index: number = 0; index < input.length; index++) {
    const code: number = input.charCodeAt(index);
    const isControl: boolean = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const isSpace: boolean = isControl || code === 0x20;

    if (isSpace) {
      if (!lastWasSpace) {
        cleaned += " ";
      }
      lastWasSpace = true;
      continue;
    }

    cleaned += input.charAt(index);
    lastWasSpace = false;
  }

  cleaned = cleaned.trim();

  if (!cleaned) {
    return undefined;
  }

  return cleaned.length > maxLength
    ? cleaned.substring(0, maxLength).trim()
    : cleaned;
}

/*
 * An sysObjectID: a dotted numeric OID ("1.3.6.1.4.1.9.1.1208"), with or
 * without a leading dot. Anything else is not one, and is dropped rather than
 * shown or fed to the vendor fingerprint.
 */
function normalizeSystemObjectId(value: unknown): string | undefined {
  const text: string | undefined = cleanDiscoveredText(
    value,
    MAX_DISCOVERED_VALUE_LENGTH[NetworkDeviceDiscoveredField.SystemObjectId],
  );

  if (!text) {
    return undefined;
  }

  const oid: string = text.startsWith(".") ? text.substring(1) : text;

  if (!oid || oid.startsWith(".") || oid.endsWith(".")) {
    return undefined;
  }

  for (let index: number = 0; index < oid.length; index++) {
    const character: string = oid.charAt(index);

    if (character === ".") {
      if (oid.charAt(index - 1) === ".") {
        return undefined;
      }
      continue;
    }

    if (character < "0" || character > "9") {
      return undefined;
    }
  }

  return oid;
}

/**
 * The value of `field` as it may be stored and shown, or undefined when it is
 * not usable as one: the field's own normaliser for a name or an address (the
 * same one every other reader of these values uses), and cleaned, bounded
 * text for the rest of the SNMP system group.
 */
export function normalizeDiscoveredValue(
  field: NetworkDeviceDiscoveredField,
  value: unknown,
): string | undefined {
  switch (field) {
    case NetworkDeviceDiscoveredField.DnsName:
      return normalizeReverseDnsName(value);
    case NetworkDeviceDiscoveredField.NetbiosName:
      return normalizeNetbiosName(value);
    case NetworkDeviceDiscoveredField.MacAddress:
      return typeof value === "string" ? normalizeMac(value) : undefined;
    case NetworkDeviceDiscoveredField.IpAddress: {
      const text: string | undefined = cleanDiscoveredText(
        value,
        MAX_DISCOVERED_VALUE_LENGTH[NetworkDeviceDiscoveredField.IpAddress],
      );
      return text && IP.isIP(text) ? text : undefined;
    }
    case NetworkDeviceDiscoveredField.SystemObjectId:
      return normalizeSystemObjectId(value);
    default:
      return cleanDiscoveredText(value, MAX_DISCOVERED_VALUE_LENGTH[field]);
  }
}

/*
 * An ISO-8601 instant, re-written in canonical form, or undefined for
 * anything that does not parse.
 */
export function readDiscoveryTime(value: unknown): string | undefined {
  let time: number = Number.NaN;

  if (value instanceof Date) {
    time = value.getTime();
  } else if (typeof value === "string" && value.trim()) {
    time = new Date(value.trim()).getTime();
  }

  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * The reader of a stored entry, or undefined when it is not one OneUptime
 * wrote: a known type and an id, and a name only when it is usable text.
 */
export function readDiscoveryReader(
  value: unknown,
): NetworkDeviceDiscoveryReader | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const type: unknown = value["type"];

  if (typeof type !== "string" || !KNOWN_READER_TYPES.has(type)) {
    return undefined;
  }

  const id: string | undefined = cleanDiscoveredText(
    value["id"],
    MAX_DISCOVERY_READER_ID_LENGTH,
  );

  if (!id) {
    return undefined;
  }

  const reader: NetworkDeviceDiscoveryReader = {
    type: type as NetworkDeviceDiscoveryReaderType,
    id: id,
  };

  const name: string | undefined = cleanDiscoveredText(
    value["name"],
    MAX_DISCOVERY_READER_NAME_LENGTH,
  );

  if (name) {
    reader.name = name;
  }

  return reader;
}

/**
 * One discovered value, ready to store - or undefined when the value is not
 * usable, the reader is not one this field is read by, or the time does not
 * parse. Every writer builds its entries here, so what is stored is what the
 * reader below would accept.
 */
export function buildDiscoveredValue(data: {
  field: NetworkDeviceDiscoveredField;
  value: unknown;
  // A NetworkDeviceDiscoveryReader; read defensively all the same.
  readBy: unknown;
  readAt: unknown;
}): NetworkDeviceDiscoveredValue | undefined {
  const readBy: NetworkDeviceDiscoveryReader | undefined = readDiscoveryReader(
    data.readBy,
  );

  if (!readBy || readBy.type !== READER_TYPE_BY_FIELD[data.field]) {
    return undefined;
  }

  const value: string | undefined = normalizeDiscoveredValue(
    data.field,
    data.value,
  );
  const readAt: string | undefined = readDiscoveryTime(data.readAt);

  if (!value || !readAt) {
    return undefined;
  }

  return {
    value: value,
    method: METHOD_BY_FIELD[data.field],
    readBy: readBy,
    readAt: readAt,
  };
}

/*
 * A stored value entry, or undefined when it is not one OneUptime would have
 * written for `field`.
 */
function readDiscoveredValue(
  field: NetworkDeviceDiscoveredField,
  value: unknown,
): NetworkDeviceDiscoveredValue | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (value["method"] !== METHOD_BY_FIELD[field]) {
    return undefined;
  }

  return buildDiscoveredValue({
    field: field,
    value: value["value"],
    readBy: value["readBy"],
    readAt: value["readAt"],
  });
}

/**
 * The scan-found-the-device note, ready to store, or undefined when the
 * reader is not a discovery scan or the time does not parse.
 */
export function buildDiscoverySighting(data: {
  // A NetworkDeviceDiscoveryReader; read defensively all the same.
  readBy: unknown;
  readAt: unknown;
}): NetworkDeviceDiscoverySighting | undefined {
  const readBy: NetworkDeviceDiscoveryReader | undefined = readDiscoveryReader(
    data.readBy,
  );
  const readAt: string | undefined = readDiscoveryTime(data.readAt);

  if (
    !readBy ||
    readBy.type !== NetworkDeviceDiscoveryReaderType.DiscoveryScan ||
    !readAt
  ) {
    return undefined;
  }

  return { readBy: readBy, readAt: readAt };
}

/**
 * The another-machine-answers-here note, ready to store: the sighting plus
 * whichever of the four identifying values the scan read there, each through
 * its own normaliser. Undefined when the sighting itself is not usable.
 */
export function buildOtherMachineSighting(data: {
  readBy: unknown;
  readAt: unknown;
  sysName?: unknown;
  sysObjectId?: unknown;
  dnsName?: unknown;
  netbiosName?: unknown;
}): NetworkDeviceOtherMachineSighting | undefined {
  const sighting: NetworkDeviceDiscoverySighting | undefined =
    buildDiscoverySighting(data);

  if (!sighting) {
    return undefined;
  }

  const note: NetworkDeviceOtherMachineSighting = {
    readBy: sighting.readBy,
    readAt: sighting.readAt,
  };

  const sysName: string | undefined = normalizeDiscoveredValue(
    NetworkDeviceDiscoveredField.SystemName,
    data.sysName,
  );
  const sysObjectId: string | undefined = normalizeDiscoveredValue(
    NetworkDeviceDiscoveredField.SystemObjectId,
    data.sysObjectId,
  );
  const dnsName: string | undefined = normalizeDiscoveredValue(
    NetworkDeviceDiscoveredField.DnsName,
    data.dnsName,
  );
  const netbiosName: string | undefined = normalizeDiscoveredValue(
    NetworkDeviceDiscoveredField.NetbiosName,
    data.netbiosName,
  );

  if (sysName) {
    note.sysName = sysName;
  }
  if (sysObjectId) {
    note.sysObjectId = sysObjectId;
  }
  if (dnsName) {
    note.dnsName = dnsName;
  }
  if (netbiosName) {
    note.netbiosName = netbiosName;
  }

  return note;
}

/**
 * One value of a controller reading as it may be stored and shown, or
 * undefined when it is not usable as one: a MAC through the one MAC
 * normaliser, an address only when it is an address literal, a product type
 * only when it is one the controller names, and cleaned, bounded text for the
 * rest. The controller's answer is outside text, and so is the column an API
 * create can carry: both pass through here.
 */
export function normalizeControllerValue(
  field: NetworkDeviceControllerField,
  value: unknown,
): string | undefined {
  switch (field) {
    case NetworkDeviceControllerField.MacAddress:
      return typeof value === "string"
        ? normalizeMac(value.substring(0, MAX_INPUT_SCAN_LENGTH))
        : undefined;
    case NetworkDeviceControllerField.IpAddress: {
      const text: string | undefined = cleanDiscoveredText(
        value,
        MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.IpAddress],
      );
      return text && IP.isIP(text) ? text : undefined;
    }
    case NetworkDeviceControllerField.ProductType: {
      const text: string | undefined = cleanDiscoveredText(
        value,
        MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.ProductType],
      );
      return text && NETWORK_CONTROLLER_PRODUCT_TYPES.includes(text)
        ? text
        : undefined;
    }
    default:
      return cleanDiscoveredText(value, MAX_CONTROLLER_VALUE_LENGTH[field]);
  }
}

/**
 * A controller reading, ready to store - or undefined when the controller is
 * not one OneUptime reads, the reader is not a network controller
 * connection, the time does not parse, or nothing it holds is usable. Every
 * writer builds its reading here, and the reader below reads stored ones
 * through it, so what is stored is what is read back.
 */
export function buildControllerReading(data: {
  provider: unknown;
  // A NetworkDeviceDiscoveryReader; read defensively all the same.
  readBy: unknown;
  readAt: unknown;
  values: unknown;
}): NetworkDeviceControllerReading | undefined {
  if (!isNetworkControllerProvider(data.provider)) {
    return undefined;
  }

  const readBy: NetworkDeviceDiscoveryReader | undefined = readDiscoveryReader(
    data.readBy,
  );
  const readAt: string | undefined = readDiscoveryTime(data.readAt);

  if (
    !readBy ||
    readBy.type !== NetworkDeviceDiscoveryReaderType.NetworkController ||
    !readAt ||
    !isPlainObject(data.values)
  ) {
    return undefined;
  }

  const values: Partial<Record<NetworkDeviceControllerField, string>> = {};

  for (const field of NETWORK_DEVICE_CONTROLLER_FIELDS) {
    const value: string | undefined = normalizeControllerValue(
      field,
      data.values[field],
    );

    if (value) {
      values[field] = value;
    }
  }

  if (Object.keys(values).length === 0) {
    return undefined;
  }

  return {
    provider: data.provider,
    readBy: readBy,
    readAt: readAt,
    values: values,
  };
}

/**
 * A device's discovered details, read defensively out of its jsonb column:
 * every entry that is not exactly what OneUptime writes - an unknown key, a
 * field read by the wrong method or reader, a value its normaliser refuses,
 * a time that does not parse - is left out, and anything that is not an
 * object at all reads as nothing discovered.
 */
export function readNetworkDeviceDiscoveredDetails(
  raw: unknown,
): NetworkDeviceDiscoveredDetails {
  const details: NetworkDeviceDiscoveredDetails = { values: {} };

  if (!isPlainObject(raw)) {
    return details;
  }

  for (const field of NETWORK_DEVICE_DISCOVERED_FIELDS) {
    const entry: NetworkDeviceDiscoveredValue | undefined = readDiscoveredValue(
      field,
      raw[field],
    );

    if (entry) {
      details.values[field] = entry;
    }
  }

  const foundBy: unknown = raw[DISCOVERED_DETAILS_FOUND_BY_KEY];

  if (isPlainObject(foundBy)) {
    const sighting: NetworkDeviceDiscoverySighting | undefined =
      buildDiscoverySighting({
        readBy: foundBy["readBy"],
        readAt: foundBy["readAt"],
      });

    if (sighting) {
      details.foundBy = sighting;
    }
  }

  const otherMachine: unknown = raw[DISCOVERED_DETAILS_OTHER_MACHINE_KEY];

  if (isPlainObject(otherMachine)) {
    const note: NetworkDeviceOtherMachineSighting | undefined =
      buildOtherMachineSighting({
        readBy: otherMachine["readBy"],
        readAt: otherMachine["readAt"],
        sysName: otherMachine["sysName"],
        sysObjectId: otherMachine["sysObjectId"],
        dnsName: otherMachine["dnsName"],
        netbiosName: otherMachine["netbiosName"],
      });

    if (note) {
      details.otherMachine = note;
    }
  }

  const controller: unknown = raw[DISCOVERED_DETAILS_CONTROLLER_KEY];

  if (isPlainObject(controller)) {
    const reading: NetworkDeviceControllerReading | undefined =
      buildControllerReading({
        provider: controller["provider"],
        readBy: controller["readBy"],
        readAt: controller["readAt"],
        values: controller["values"],
      });

    if (reading) {
      details.controller = reading;
    }
  }

  return details;
}

/**
 * The discovered details as the jsonb column stores them: one top-level key
 * per value, then the two notes. The inverse of
 * readNetworkDeviceDiscoveredDetails for what it accepts.
 */
export function toDiscoveredDetailsJson(
  details: NetworkDeviceDiscoveredDetails,
): Record<string, unknown> {
  const json: Record<string, unknown> = {};

  for (const field of NETWORK_DEVICE_DISCOVERED_FIELDS) {
    const entry: NetworkDeviceDiscoveredValue | undefined =
      details.values[field];

    if (entry) {
      json[field] = entry;
    }
  }

  if (details.foundBy) {
    json[DISCOVERED_DETAILS_FOUND_BY_KEY] = details.foundBy;
  }

  if (details.otherMachine) {
    json[DISCOVERED_DETAILS_OTHER_MACHINE_KEY] = details.otherMachine;
  }

  if (details.controller) {
    json[DISCOVERED_DETAILS_CONTROLLER_KEY] = details.controller;
  }

  return json;
}

/**
 * What an API create may carry in the column: exactly what the reader keeps,
 * or null for nothing. A discovery import fills it from the scan the device
 * is imported from; anything a caller put there that OneUptime would not have
 * written is dropped rather than refused, like the rest of a create's
 * server-managed bookkeeping.
 */
export function sanitizeDiscoveredDetailsOnWrite(
  raw: unknown,
): Record<string, unknown> | null {
  const json: Record<string, unknown> = toDiscoveredDetailsJson(
    readNetworkDeviceDiscoveredDetails(raw),
  );

  return Object.keys(json).length > 0 ? json : null;
}

/**
 * The time of a stored entry as epoch milliseconds, or undefined. Entries
 * that came through the reader always parse.
 */
export function getDiscoveredTime(
  entry: { readAt: string } | undefined,
): number | undefined {
  if (!entry) {
    return undefined;
  }

  const time: number = new Date(entry.readAt).getTime();
  return Number.isNaN(time) ? undefined : time;
}

export default NetworkDeviceDiscoveredDetails;
