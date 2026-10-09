import {
  InventoryAssetField,
  InventoryAssetKind,
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
 * network device's from its SNMP agent. The `unknown` sentences are plural
 * templates, written as plain literals so the extractor files them as one
 * plural key (the "other" sentence, with its "_one" form).
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
      one: "{{count}} detail is unknown: this device has not reported it over SNMP.",
      other:
        "{{count}} details are unknown: this device has not reported them over SNMP.",
    },
  },
};
