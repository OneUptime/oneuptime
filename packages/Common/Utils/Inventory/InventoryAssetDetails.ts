import EntityType from "../../Types/Telemetry/EntityType";
import { NetworkTopologyDeviceRole } from "../../Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  classifyDeviceRole,
  labelForDeviceRole,
} from "../Monitor/NetworkDeviceRoleUtil";

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
 * (TelemetryEntity), so the `descriptiveAttributes` a CMDB sync reads over
 * the API hold one key per fact whatever the row is. A fact nothing has
 * reported is `undefined` here and is shown as "Unknown" - never left out,
 * so a missing serial number is visible rather than silently absent.
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
}

// What an Inventory item contributes. Read defensively: these come off API rows.
export interface InventoryAssetSource {
  entityType?: unknown;
  identifyingAttributes?: unknown;
  descriptiveAttributes?: unknown;
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

  if (kind === InventoryAssetKind.Host) {
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

  for (const field of INVENTORY_ASSET_FIELDS) {
    const value: string | undefined = values.get(field);
    details.push({ field: field, value: value });

    if (!value) {
      unknownFields.push(field);
    }
  }

  for (const field of INVENTORY_ASSET_OPTIONAL_FIELDS) {
    const value: string | undefined = values.get(field);

    if (value) {
      details.push({ field: field, value: value });
    }
  }

  return { kind: kind, details: details, unknownFields: unknownFields };
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
