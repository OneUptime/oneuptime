import {
  InventoryAssetField,
  InventoryAssetKind,
  NetworkDeviceUnknownReason,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How the asset details (Common/Utils/Inventory/InventoryAssetDetails) read
 * on screen and in a CSV export: one label per fact, the same for a host and
 * a network device (OneUptime issue #4569). English here, looked up where
 * they are shown.
 */
export const INVENTORY_ASSET_FIELD_LABELS: Readonly<
  Record<InventoryAssetField, string>
> = {
  [InventoryAssetField.Hostname]: translationKey("Hostname"),
  [InventoryAssetField.IpAddress]: translationKey("IP Address"),
  [InventoryAssetField.MacAddress]: translationKey("MAC Address"),
  [InventoryAssetField.SerialNumber]: translationKey("Serial Number"),
  [InventoryAssetField.Manufacturer]: translationKey("Manufacturer"),
  [InventoryAssetField.Model]: translationKey("Model"),
  [InventoryAssetField.FirmwareVersion]: translationKey("Firmware Version"),
  [InventoryAssetField.OperatingSystem]: translationKey("Operating System"),
  [InventoryAssetField.OsVersion]: translationKey("OS Version"),
  [InventoryAssetField.DeviceType]: translationKey("Device Type"),
  [InventoryAssetField.Location]: translationKey("Location"),
  [InventoryAssetField.DnsName]: translationKey("DNS Name"),
  [InventoryAssetField.Architecture]: translationKey("Architecture"),
  [InventoryAssetField.SystemDescription]: translationKey("System Description"),
};

// What an unknown fact reads: the same word everywhere, never a dash.
export const INVENTORY_ASSET_UNKNOWN: string = translationKey("Unknown");

/*
 * Where a reader learns how the unknown facts get filled in. A host's come
 * from its collector - most of them stamped on once, at provisioning; a
 * network device's from its SNMP poll and from discovery (issue #5185): a
 * discovery scan of its address, a router's ARP table, its probe. The
 * `unknown` sentences are plural templates, written as plain literals so the
 * extractor files them as one plural key (the "other" sentence, with its
 * "_one" form).
 */
export const INVENTORY_ASSET_HELP: Readonly<
  Record<
    InventoryAssetKind,
    {
      docsUrl: string;
      linkText: string;
      unknown: { one: string; other: string };
    }
  >
> = {
  [InventoryAssetKind.Host]: {
    docsUrl:
      "/docs/telemetry/host-otel-collector#inventory-attributes-ip-mac-serial-number-make-model-firmware",
    linkText: translationKey("How to collect them"),
    unknown: {
      one: "{{count}} detail is unknown: this host's collector has not reported it.",
      other:
        "{{count}} details are unknown: this host's collector has not reported them.",
    },
  },
  [InventoryAssetKind.NetworkDevice]: {
    docsUrl: "/docs/inventory/cmdb-sync#network-device-asset-attributes",
    linkText: translationKey("Where each detail comes from"),
    unknown: {
      one: "{{count}} detail is unknown: neither this device's SNMP poll nor a discovery scan has found it.",
      other:
        "{{count}} details are unknown: neither this device's SNMP poll nor a discovery scan has found them.",
    },
  },
};

/*
 * The same line for a network device the Meraki dashboard describes: the
 * dashboard was asked too, and it has not got them either (it knows no DNS
 * name or street address for every device, for one), so the line names it
 * beside the poll and the scans rather than leaving the reader to wonder
 * whether it was read.
 */
export const NETWORK_DEVICE_CONTROLLER_UNKNOWN: { one: string; other: string } =
  {
    one: "{{count}} detail is unknown: neither this device's SNMP poll, the Meraki dashboard nor a discovery scan has found it.",
    other:
      "{{count}} details are unknown: neither this device's SNMP poll, the Meraki dashboard nor a discovery scan has found them.",
  };

// One line under the facts: why they are unknown, and where to read more.
export interface InventoryAssetUnknownHelp {
  docsUrl: string;
  linkText: string;
  unknown: { one: string; other: string };
}

/*
 * The line for a device that answered its poll and reports no more (issue
 * #5384): nothing is waiting to read these, so the line does not read as if
 * something were.
 */
export const NETWORK_DEVICE_SNMP_UNKNOWN: { one: string; other: string } = {
  one: "{{count}} detail is unknown: this device does not report it over SNMP, and no discovery scan has found it.",
  other:
    "{{count}} details are unknown: this device does not report them over SNMP, and no discovery scan has found them.",
};

/*
 * The line for a Meraki device no Meraki connection describes. Its SNMP agent
 * holds no serial number or firmware to read, so the line says who does and
 * links to connecting it, not to a table of what a poll could have read.
 */
export const NETWORK_DEVICE_MERAKI_UNKNOWN: { one: string; other: string } = {
  one: "{{count}} detail is unknown: a Cisco Meraki device reports it only to the Meraki dashboard, not over SNMP.",
  other:
    "{{count}} details are unknown: a Cisco Meraki device reports them only to the Meraki dashboard, not over SNMP.",
};

export const CONNECT_MERAKI_DOCS_URL: string =
  "/docs/monitor/network-traffic#cisco-meraki-without-netflow";

export const CONNECT_MERAKI_LINK_TEXT: string = translationKey(
  "Connect the Meraki dashboard",
);

/**
 * What the card says about a machine's unknown details: a host's, or a
 * network device's by why they are unknown. A device read only through its
 * Inventory item gives no reason, and gets the general line.
 */
export function getInventoryAssetUnknownHelp(
  kind: InventoryAssetKind,
  reason: NetworkDeviceUnknownReason | undefined,
): InventoryAssetUnknownHelp {
  const help: InventoryAssetUnknownHelp = INVENTORY_ASSET_HELP[kind];

  switch (reason) {
    case NetworkDeviceUnknownReason.NotOnController:
      return { ...help, unknown: NETWORK_DEVICE_CONTROLLER_UNKNOWN };
    case NetworkDeviceUnknownReason.NotReportedOverSnmp:
      return { ...help, unknown: NETWORK_DEVICE_SNMP_UNKNOWN };
    case NetworkDeviceUnknownReason.OnControllerOnly:
      return {
        docsUrl: CONNECT_MERAKI_DOCS_URL,
        linkText: CONNECT_MERAKI_LINK_TEXT,
        unknown: NETWORK_DEVICE_MERAKI_UNKNOWN,
      };
    default:
      return help;
  }
}
