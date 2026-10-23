import EntityType from "../../Types/Telemetry/EntityType";
import { NetworkTopologyDeviceRole } from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  NetworkDeviceDiscoverySighting,
  NetworkDeviceOtherMachineSighting,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  classifyDeviceRole,
  labelForDeviceRole,
} from "../Monitor/NetworkDeviceRoleUtil";
import {
  NetworkDeviceAssetFactsOptions,
  NetworkDeviceAssetSource,
  NetworkDeviceFactDetail,
  NetworkDeviceFactDetails,
  getNetworkDeviceFactDetails,
} from "../NetworkDevice/NetworkDeviceAssetFacts";
import {
  AssetFactDifference,
  AssetFactSource,
  AssetFactSourceKind,
} from "./AssetFactSource";

/*
 * One set of asset details for every machine in Inventory (OneUptime issue
 * #4569).
 *
 * A discovered host and a mirrored network device arrive from different
 * places - OpenTelemetry resource attributes on one side, an SNMP poll on
 * the other - and Inventory used to show each as the raw attributes it came
 * in on: `host.arch`, `os.type` for one, `net.device.hostname` (which held
 * an IP address) for the other. Two machines, two vocabularies, and no way
 * to see at a glance which facts were missing.
 *
 * This is the one vocabulary. Every asset kind is described by the same
 * facts, in the same order, read from the same attribute keys:
 *
 *   Hostname           host.name               (a host's identity; a
 *                                               network device's own name,
 *                                               never its IP address)
 *   IP address         host.ip
 *   MAC address        host.mac
 *   Serial number      host.serial_number
 *   Manufacturer       device.manufacturer
 *   Model              device.model.name
 *   Firmware version   device.firmware.version
 *   Operating system   os.name                 (a host: os.description
 *                                               first, or its os.type)
 *   OS version         os.version
 *   Device type        device.type             (a network device: its role;
 *                                               a host: classified from its
 *                                               OS and name)
 *   Location           device.location         (a network device: its site
 *                                               too; a host: its cloud
 *                                               zone when it reports none)
 *
 * The mirror writes a network device's facts under exactly these keys
 * (InventoryEntityRegistry) and the host extractor keeps a host's
 * (Utils/Telemetry/TelemetryEntity), so the `descriptiveAttributes` a CMDB
 * sync reads over the API hold one key per fact whatever the row is. A fact
 * nothing has reported is `undefined` here and is shown as "Unknown" - never
 * left out, so a missing serial number is visible rather than silently absent.
 *
 * Pure and in Common, so the item page, the list's columns and their CSV
 * export, and the tests all read a row the same way.
 */

export enum InventoryAssetKind {
  Host = "host",
  NetworkDevice = "networkDevice",
}

export enum InventoryAssetField {
  Hostname = "hostname",
  IpAddress = "ipAddress",
  MacAddress = "macAddress",
  SerialNumber = "serialNumber",
  Manufacturer = "manufacturer",
  Model = "model",
  FirmwareVersion = "firmwareVersion",
  OperatingSystem = "operatingSystem",
  OsVersion = "osVersion",
  DeviceType = "deviceType",
  Location = "location",
  /*
   * Shown only when known: facts one kind of machine has and the other does
   * not, which would otherwise read "Unknown" on every row of that kind.
   */
  DnsName = "dnsName",
  Architecture = "architecture",
  SystemDescription = "systemDescription",
}

/*
 * The facts every asset is described by, in the order they are shown. Each
 * is always present in the details - a value, or undefined for unknown.
 */
export const INVENTORY_ASSET_FIELDS: ReadonlyArray<InventoryAssetField> = [
  InventoryAssetField.Hostname,
  InventoryAssetField.IpAddress,
  InventoryAssetField.MacAddress,
  InventoryAssetField.SerialNumber,
  InventoryAssetField.Manufacturer,
  InventoryAssetField.Model,
  InventoryAssetField.FirmwareVersion,
  InventoryAssetField.OperatingSystem,
  InventoryAssetField.OsVersion,
  InventoryAssetField.DeviceType,
  InventoryAssetField.Location,
];

// The facts shown after those, and only when known.
export const INVENTORY_ASSET_OPTIONAL_FIELDS: ReadonlyArray<InventoryAssetField> =
  [
    InventoryAssetField.DnsName,
    InventoryAssetField.Architecture,
    InventoryAssetField.SystemDescription,
  ];

/*
 * The attribute key each fact is stored under - the same key for every kind
 * of machine. This is the contract the CMDB docs publish
 * (docs/inventory/cmdb-sync).
 */
export const INVENTORY_ASSET_ATTRIBUTE_KEYS: Readonly<
  Record<InventoryAssetField, string>
> = {
  [InventoryAssetField.Hostname]: "host.name",
  [InventoryAssetField.IpAddress]: "host.ip",
  [InventoryAssetField.MacAddress]: "host.mac",
  [InventoryAssetField.SerialNumber]: "host.serial_number",
  [InventoryAssetField.Manufacturer]: "device.manufacturer",
  [InventoryAssetField.Model]: "device.model.name",
  [InventoryAssetField.FirmwareVersion]: "device.firmware.version",
  [InventoryAssetField.OperatingSystem]: "os.name",
  [InventoryAssetField.OsVersion]: "os.version",
  [InventoryAssetField.DeviceType]: "device.type",
  [InventoryAssetField.Location]: "device.location",
  [InventoryAssetField.DnsName]: "net.device.dns_name",
  [InventoryAssetField.Architecture]: "host.arch",
  [InventoryAssetField.SystemDescription]: "os.description",
};

// The OneUptime Network Site a network device is assigned to.
export const INVENTORY_SITE_ATTRIBUTE_KEY: string = "oneuptime.site.name";

/*
 * Kept on a mirrored network device for syncs written before #4569: the
 * address OneUptime polls, which is usually an IP address. Read host.ip and
 * host.name instead.
 */
export const INVENTORY_POLLED_ADDRESS_ATTRIBUTE_KEY: string =
  "net.device.hostname";

export interface InventoryAssetDetail {
  field: InventoryAssetField;
  // The value, or undefined when nothing has reported it.
  value: string | undefined;
  /*
   * Where the value came from and when it was read (issue #5185), when that
   * is known: always for a host, and for a network device read from its own
   * record (getNetworkDeviceInventoryAssetDetails). A network device's item
   * alone does not say.
   */
  source?: AssetFactSource | undefined;
  /*
   * What discovery read for the same detail, when it differs from a value
   * saved on the device. The saved value is the one shown.
   */
  discoveredDifferent?: AssetFactDifference | undefined;
}

export interface InventoryAssetDetails {
  kind: InventoryAssetKind;
  /*
   * Every fact of INVENTORY_ASSET_FIELDS in order, then whichever optional
   * facts are known.
   */
  details: Array<InventoryAssetDetail>;
  // The facts of INVENTORY_ASSET_FIELDS with no value, in order.
  unknownFields: Array<InventoryAssetField>;
  /*
   * A network device read from its own record: the discovery scan that last
   * found it at its address, and a scan that found another machine there.
   */
  foundBy?: NetworkDeviceDiscoverySighting | undefined;
  otherMachine?: NetworkDeviceOtherMachineSighting | undefined;
}

// What an Inventory item contributes. Read defensively: these come off API rows.
export interface InventoryAssetSource {
  entityType?: unknown;
  identifyingAttributes?: unknown;
  descriptiveAttributes?: unknown;
  /*
   * When the item was last reported: for a host, its collector's last batch,
   * which is when every detail it carries was last read.
   */
  lastSeenAt?: unknown;
}

const ASSET_KIND_BY_ENTITY_TYPE: ReadonlyMap<string, InventoryAssetKind> =
  new Map<string, InventoryAssetKind>([
    [EntityType.Host, InventoryAssetKind.Host],
    [EntityType.NetworkDevice, InventoryAssetKind.NetworkDevice],
  ]);

/**
 * The asset kind of an Inventory item's type, or undefined for a type that
 * is not a machine with asset details (a service, a pod, a cloud resource).
 */
export function getInventoryAssetKind(
  entityType: unknown,
): InventoryAssetKind | undefined {
  if (typeof entityType !== "string") {
    return undefined;
  }

  return ASSET_KIND_BY_ENTITY_TYPE.get(entityType);
}

/*
 * OpenTelemetry's `os.type` values, as people write them. A value outside the
 * list is shown as it came.
 */
const OPERATING_SYSTEM_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["windows", "Windows"],
  ["linux", "Linux"],
  ["darwin", "macOS"],
  ["freebsd", "FreeBSD"],
  ["netbsd", "NetBSD"],
  ["openbsd", "OpenBSD"],
  ["dragonflybsd", "DragonFly BSD"],
  ["hpux", "HP-UX"],
  ["aix", "AIX"],
  ["solaris", "Solaris"],
  ["z_os", "z/OS"],
  ["zos", "z/OS"],
]);

// OpenTelemetry's `cloud.provider` values, as people write them.
const CLOUD_PROVIDER_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["aws", "AWS"],
  ["azure", "Azure"],
  ["gcp", "Google Cloud"],
  ["alibaba_cloud", "Alibaba Cloud"],
  ["ibm_cloud", "IBM Cloud"],
  ["tencent_cloud", "Tencent Cloud"],
  ["oracle_cloud", "Oracle Cloud"],
  ["heroku", "Heroku"],
]);

// The separator between the parts of one value ("Store 0362 · Rack 4").
export const INVENTORY_ASSET_VALUE_SEPARATOR: string = " · ";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim();
  return text ? text : undefined;
}

/** `os.type` as people write it: "windows" is "Windows", "darwin" "macOS". */
export function getOperatingSystemName(
  osType: string | undefined,
): string | undefined {
  if (!osType) {
    return undefined;
  }

  return OPERATING_SYSTEM_NAMES.get(osType.toLowerCase()) || osType;
}

/**
 * Where a cloud machine runs, from its `cloud.*` attributes: "AWS
 * us-east-1a", or the region when no zone is known.
 */
export function getCloudPlacement(attributes: {
  provider?: string | undefined;
  region?: string | undefined;
  zone?: string | undefined;
}): string | undefined {
  const provider: string | undefined = attributes.provider
    ? CLOUD_PROVIDER_NAMES.get(attributes.provider.toLowerCase()) ||
      attributes.provider
    : undefined;
  const where: string | undefined = attributes.zone || attributes.region;

  if (!provider && !where) {
    return undefined;
  }

  return [provider, where].filter(Boolean).join(" ");
}

function joinParts(parts: Array<string | undefined>): string | undefined {
  const seen: Array<string> = [];

  for (const part of parts) {
    if (part && !seen.includes(part)) {
      seen.push(part);
    }
  }

  return seen.length > 0
    ? seen.join(INVENTORY_ASSET_VALUE_SEPARATOR)
    : undefined;
}

/*
 * What a host is, by the same classifier the network map uses for a device:
 * its operating system says "server" for Windows and Linux, and its name can
 * say more ("fw-01" is a firewall). A host that neither says anything about
 * is a host.
 */
function classifyHost(attributes: {
  hostname: string | undefined;
  osDescription: string | undefined;
}): string {
  const role: NetworkTopologyDeviceRole = classifyDeviceRole({
    sysDescr: attributes.osDescription,
    name: attributes.hostname,
  });

  return labelForDeviceRole(role === "unknown" ? "host" : role);
}

/**
 * The asset details of an Inventory item, or undefined when its type is not
 * an asset kind (see getInventoryAssetKind).
 *
 * Each fact is read from its key in INVENTORY_ASSET_ATTRIBUTE_KEYS - the
 * descriptive value first, then the identifying one (a host's name is its
 * identity) - with these per-kind fallbacks:
 *
 *   - Operating system: a host's `os.description` first, else `os.name`,
 *     else its `os.type`; a network device's `os.name` only (its
 *     `os.description` is the raw sysDescr, shown on its own).
 *   - Device type: a host is classified from its OS and name.
 *   - Location: a network device's site comes first; a host with no
 *     location of its own is placed by its cloud zone.
 */
export function getInventoryAssetDetails(
  item: InventoryAssetSource,
): InventoryAssetDetails | undefined {
  const kind: InventoryAssetKind | undefined = getInventoryAssetKind(
    item.entityType,
  );

  if (!kind) {
    return undefined;
  }

  const identifying: Record<string, unknown> = asObject(
    item.identifyingAttributes,
  );
  const descriptive: Record<string, unknown> = asObject(
    item.descriptiveAttributes,
  );

  const read: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    return readText(descriptive[key]) || readText(identifying[key]);
  };

  const keyOf: (field: InventoryAssetField) => string = (
    field: InventoryAssetField,
  ): string => {
    return INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
  };

  const values: Map<InventoryAssetField, string | undefined> = new Map<
    InventoryAssetField,
    string | undefined
  >();

  for (const field of [
    ...INVENTORY_ASSET_FIELDS,
    ...INVENTORY_ASSET_OPTIONAL_FIELDS,
  ]) {
    values.set(field, read(keyOf(field)));
  }

  /*
   * Where each value came from. A host's are all its collector's, read with
   * its last report, except the two the card works out when the collector
   * does not say: a type classified from its OS and name, and a location
   * standing in from its cloud zone. A network device's item does not say
   * (the device's own record does: getNetworkDeviceInventoryAssetDetails).
   */
  const sources: Map<InventoryAssetField, AssetFactSource> = new Map<
    InventoryAssetField,
    AssetFactSource
  >();
  let defaultSource: AssetFactSource | undefined = undefined;

  if (kind === InventoryAssetKind.Host) {
    defaultSource = {
      kind: AssetFactSourceKind.Collector,
      readAt: readIsoTime(item.lastSeenAt),
    };

    if (!values.get(InventoryAssetField.DeviceType)) {
      sources.set(InventoryAssetField.DeviceType, {
        kind: AssetFactSourceKind.Classified,
      });
    }

    if (!values.get(InventoryAssetField.Location)) {
      sources.set(InventoryAssetField.Location, {
        kind: AssetFactSourceKind.CloudPlacement,
      });
    }

    const osDescription: string | undefined = read(
      keyOf(InventoryAssetField.SystemDescription),
    );

    /*
     * The collector's `system` detector describes the OS in full
     * ("Windows Server 2022 10.0"); `os.name` ("Windows"), which some SDKs
     * send instead, and `os.type` ("windows") say less.
     */
    values.set(
      InventoryAssetField.OperatingSystem,
      osDescription ||
        values.get(InventoryAssetField.OperatingSystem) ||
        getOperatingSystemName(read("os.type")),
    );

    values.set(
      InventoryAssetField.DeviceType,
      values.get(InventoryAssetField.DeviceType) ||
        classifyHost({
          hostname: values.get(InventoryAssetField.Hostname),
          osDescription:
            osDescription ||
            values.get(InventoryAssetField.OperatingSystem) ||
            read("os.type"),
        }),
    );

    values.set(
      InventoryAssetField.Location,
      values.get(InventoryAssetField.Location) ||
        getCloudPlacement({
          provider: read("cloud.provider"),
          region: read("cloud.region"),
          zone: read("cloud.availability_zone"),
        }),
    );

    // A host's os.description IS its operating system, shown above.
    values.set(InventoryAssetField.SystemDescription, undefined);
  }

  if (kind === InventoryAssetKind.NetworkDevice) {
    values.set(
      InventoryAssetField.Location,
      joinParts([
        read(INVENTORY_SITE_ATTRIBUTE_KEY),
        values.get(InventoryAssetField.Location),
      ]),
    );
  }

  const details: Array<InventoryAssetDetail> = [];
  const unknownFields: Array<InventoryAssetField> = [];

  const detailOf: (field: InventoryAssetField) => InventoryAssetDetail = (
    field: InventoryAssetField,
  ): InventoryAssetDetail => {
    const value: string | undefined = values.get(field);
    const source: AssetFactSource | undefined = value
      ? sources.get(field) || defaultSource
      : undefined;

    return source
      ? { field: field, value: value, source: source }
      : { field: field, value: value };
  };

  for (const field of INVENTORY_ASSET_FIELDS) {
    const detail: InventoryAssetDetail = detailOf(field);
    details.push(detail);

    if (!detail.value) {
      unknownFields.push(field);
    }
  }

  for (const field of INVENTORY_ASSET_OPTIONAL_FIELDS) {
    const detail: InventoryAssetDetail = detailOf(field);

    if (detail.value) {
      details.push(detail);
    }
  }

  return { kind: kind, details: details, unknownFields: unknownFields };
}

/*
 * An item's time - a Date, or a date string off an API row - as ISO-8601, or
 * undefined for anything else.
 */
function readIsoTime(value: unknown): string | undefined {
  let time: number = Number.NaN;

  if (value instanceof Date) {
    time = value.getTime();
  } else if (typeof value === "string" && value.trim()) {
    time = new Date(value.trim()).getTime();
  }

  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/*
 * One network device fact as an asset detail, with its source and any
 * disagreement.
 */
function assetDetailOf(
  field: InventoryAssetField,
  fact: NetworkDeviceFactDetail,
): InventoryAssetDetail {
  const detail: InventoryAssetDetail = { field: field, value: fact.value };

  if (fact.value && fact.source) {
    detail.source = fact.source;
  }

  if (fact.value && fact.discoveredDifferent) {
    detail.discoveredDifferent = fact.discoveredDifferent;
  }

  return detail;
}

/**
 * A network device's asset details read from its OWN record rather than from
 * its Inventory item, with where each one came from and when (issue #5185).
 *
 * The same facts, in the same order, as getInventoryAssetDetails gives for
 * the device's item - the mirror writes the item from the very same
 * getNetworkDeviceFactDetails - but current to the moment, rather than to
 * the mirror's last pass, and with their sources, which an item does not
 * carry. The Asset Details card reads the device this way when it may.
 */
export function getNetworkDeviceInventoryAssetDetails(
  device: NetworkDeviceAssetSource,
  options?: NetworkDeviceAssetFactsOptions | undefined,
): InventoryAssetDetails {
  const facts: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
    device,
    options,
  );

  /*
   * Location reads as the item's does: the site first, then where the device
   * says it is. Its source is the reported location's when there is one -
   * the site is a choice, and says so on its own.
   */
  const location: NetworkDeviceFactDetail = facts.facts.location.value
    ? {
        ...facts.facts.location,
        value: joinParts([facts.facts.site.value, facts.facts.location.value]),
      }
    : facts.facts.site;

  const byField: Record<InventoryAssetField, NetworkDeviceFactDetail> = {
    [InventoryAssetField.Hostname]: facts.facts.hostname,
    [InventoryAssetField.IpAddress]: facts.facts.ipAddress,
    [InventoryAssetField.MacAddress]: facts.facts.macAddress,
    [InventoryAssetField.SerialNumber]: facts.facts.serialNumber,
    [InventoryAssetField.Manufacturer]: facts.facts.manufacturer,
    [InventoryAssetField.Model]: facts.facts.model,
    [InventoryAssetField.FirmwareVersion]: facts.facts.firmwareVersion,
    [InventoryAssetField.OperatingSystem]: facts.facts.operatingSystem,
    [InventoryAssetField.OsVersion]: facts.facts.osVersion,
    [InventoryAssetField.DeviceType]: facts.facts.deviceType,
    [InventoryAssetField.Location]: location,
    [InventoryAssetField.DnsName]: facts.facts.dnsName,
    // A network device has no architecture to report.
    [InventoryAssetField.Architecture]: {},
    [InventoryAssetField.SystemDescription]: facts.system.sysDescr,
  };

  const details: Array<InventoryAssetDetail> = [];
  const unknownFields: Array<InventoryAssetField> = [];

  for (const field of INVENTORY_ASSET_FIELDS) {
    const detail: InventoryAssetDetail = assetDetailOf(field, byField[field]);
    details.push(detail);

    if (!detail.value) {
      unknownFields.push(field);
    }
  }

  for (const field of INVENTORY_ASSET_OPTIONAL_FIELDS) {
    const detail: InventoryAssetDetail = assetDetailOf(field, byField[field]);

    if (detail.value) {
      details.push(detail);
    }
  }

  const result: InventoryAssetDetails = {
    kind: InventoryAssetKind.NetworkDevice,
    details: details,
    unknownFields: unknownFields,
  };

  if (facts.foundBy) {
    result.foundBy = facts.foundBy;
  }

  if (facts.otherMachine) {
    result.otherMachine = facts.otherMachine;
  }

  return result;
}

/**
 * One fact of an Inventory item, or undefined when it is unknown or the item
 * is not an asset. For a list cell or a CSV column.
 */
export function getInventoryAssetValue(
  item: InventoryAssetSource,
  field: InventoryAssetField,
): string | undefined {
  const details: InventoryAssetDetails | undefined =
    getInventoryAssetDetails(item);

  if (!details) {
    return undefined;
  }

  return details.details.find((detail: InventoryAssetDetail): boolean => {
    return detail.field === field;
  })?.value;
}

export default getInventoryAssetDetails;
