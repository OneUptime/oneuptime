import { describe, expect, test } from "@jest/globals";
import EntityType from "../../../Types/Telemetry/EntityType";
import { NetworkDeviceDiscoveryReaderType } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { AssetFactSourceKind } from "../../../Utils/Inventory/AssetFactSource";
import {
  INVENTORY_ASSET_FIELDS,
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  InventoryAssetKind,
  getInventoryAssetDetails,
  getNetworkDeviceInventoryAssetDetails,
} from "../../../Utils/Inventory/InventoryAssetDetails";
import {
  NetworkDeviceAssetFacts,
  NetworkDeviceAssetSource,
  getNetworkDeviceAssetFacts,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { TopologyDeviceRoleInput } from "../../../Utils/Monitor/NetworkDeviceRoleCatalog";

/*
 * The Asset Details card's read model with where each detail came from
 * (issue #5185). A host's details are its collector's, read with its last
 * report - except a type the card classifies and a location it takes from the
 * cloud zone, which say so. A network device read from its own record carries
 * the same facts as its Inventory item, each with its source, plus the scan
 * that last found it and a scan that found another machine there. A network
 * device's item alone carries no sources: the item does not know them.
 */

const LAST_REPORT: string = "2026-10-23T09:58:00.000Z";
const SCANNED: string = "2026-10-23T07:00:00.000Z";

const SCAN_READER: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  id: "80000000-0000-4000-8000-000000000001",
  name: "Store subnets",
};

function detailOf(
  details: InventoryAssetDetails | undefined,
  field: InventoryAssetField,
): InventoryAssetDetail | undefined {
  return details?.details.find((detail: InventoryAssetDetail): boolean => {
    return detail.field === field;
  });
}

describe("a host's details come from its collector", () => {
  const host: InventoryAssetDetails | undefined = getInventoryAssetDetails({
    entityType: EntityType.Host,
    identifyingAttributes: { "host.name": "wbqajdebsv001" },
    descriptiveAttributes: {
      "host.ip": "10.210.72.109",
      "os.description": "Windows Server 2022 10.0",
      "cloud.provider": "azure",
      "cloud.availability_zone": "westeurope-1",
    },
    lastSeenAt: new Date(LAST_REPORT),
  });

  test("a reported value: its collector, read with its last report", () => {
    expect(detailOf(host, InventoryAssetField.Hostname)?.source).toEqual({
      kind: AssetFactSourceKind.Collector,
      readAt: LAST_REPORT,
    });
    expect(detailOf(host, InventoryAssetField.IpAddress)?.source).toEqual({
      kind: AssetFactSourceKind.Collector,
      readAt: LAST_REPORT,
    });
    expect(
      detailOf(host, InventoryAssetField.OperatingSystem)?.source?.kind,
    ).toBe(AssetFactSourceKind.Collector);
  });

  test("a type the card classifies, and a location from the cloud zone, say so", () => {
    expect(detailOf(host, InventoryAssetField.DeviceType)).toEqual({
      field: InventoryAssetField.DeviceType,
      value: "Server",
      source: { kind: AssetFactSourceKind.Classified },
    });
    expect(detailOf(host, InventoryAssetField.Location)).toEqual({
      field: InventoryAssetField.Location,
      value: "Azure westeurope-1",
      source: { kind: AssetFactSourceKind.CloudPlacement },
    });
  });

  test("a type and a location the collector stamps are the collector's", () => {
    const stamped: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.Host,
        identifyingAttributes: { "host.name": "hv-01" },
        descriptiveAttributes: {
          "device.type": "Hypervisor",
          "device.location": "Frankfurt DC, Rack B4",
          "cloud.provider": "aws",
        },
        lastSeenAt: LAST_REPORT,
      },
    );

    expect(
      detailOf(stamped, InventoryAssetField.DeviceType)?.source?.kind,
    ).toBe(AssetFactSourceKind.Collector);
    expect(detailOf(stamped, InventoryAssetField.Location)?.source?.kind).toBe(
      AssetFactSourceKind.Collector,
    );
  });

  test("an unknown detail has no source, and a host that never reported has no time", () => {
    expect(detailOf(host, InventoryAssetField.SerialNumber)).toEqual({
      field: InventoryAssetField.SerialNumber,
      value: undefined,
    });

    const silent: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.Host,
      identifyingAttributes: { "host.name": "quiet" },
    });
    expect(detailOf(silent, InventoryAssetField.Hostname)?.source).toEqual({
      kind: AssetFactSourceKind.Collector,
      readAt: undefined,
    });
  });
});

describe("a network device's item alone carries no sources", () => {
  test("its facts, none of them with a source", () => {
    const item: InventoryAssetDetails | undefined = getInventoryAssetDetails({
      entityType: EntityType.NetworkDevice,
      descriptiveAttributes: {
        "host.name": "core-sw-01",
        "host.ip": "10.20.0.1",
      },
      lastSeenAt: LAST_REPORT,
    });

    expect(item?.kind).toBe(InventoryAssetKind.NetworkDevice);
    for (const detail of item?.details || []) {
      expect(detail.source).toBeUndefined();
      expect(detail.discoveredDifferent).toBeUndefined();
    }
    expect(item?.foundBy).toBeUndefined();
  });
});

describe("getNetworkDeviceInventoryAssetDetails - a device read from its own record", () => {
  const device: NetworkDeviceAssetSource = {
    name: "edge-sw-07",
    hostname: "10.20.12.7",
    site: { name: "Store 12" },
    macAddress: "00:1b:54:c2:7a:99",
    isMacAddressLearned: false,
    discoveredDetails: {
      sysName: {
        value: "edge-sw-07",
        method: "snmp",
        readBy: SCAN_READER,
        readAt: SCANNED,
      },
      sysDescr: {
        value:
          "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)",
        method: "snmp",
        readBy: SCAN_READER,
        readAt: SCANNED,
      },
      sysObjectId: {
        value: "1.3.6.1.4.1.9.1.1208",
        method: "snmp",
        readBy: SCAN_READER,
        readAt: SCANNED,
      },
      sysLocation: {
        value: "Back office rack",
        method: "snmp",
        readBy: SCAN_READER,
        readAt: SCANNED,
      },
      dnsName: {
        value: "edge-sw-07.store-12.acme.example",
        method: "reverseDns",
        readBy: SCAN_READER,
        readAt: SCANNED,
      },
      macAddress: {
        value: "00:1b:54:c2:7a:07",
        method: "arpTable",
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
          id: "40000000-0000-4000-8000-000000000099",
          name: "core-rtr-01",
        },
        readAt: SCANNED,
      },
      foundBy: { readBy: SCAN_READER, readAt: SCANNED },
      otherMachine: {
        readBy: SCAN_READER,
        readAt: SCANNED,
        sysName: "LAPTOP-12",
      },
    },
  };

  const details: InventoryAssetDetails =
    getNetworkDeviceInventoryAssetDetails(device);

  test("the core facts in the item's order, then the known optional ones", () => {
    expect(
      details.details.map((detail: InventoryAssetDetail): string => {
        return detail.field;
      }),
    ).toEqual([
      ...INVENTORY_ASSET_FIELDS,
      InventoryAssetField.DnsName,
      InventoryAssetField.SystemDescription,
    ]);
  });

  test("the same values the mirror writes onto its item", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(device);

    expect(detailOf(details, InventoryAssetField.Hostname)?.value).toBe(
      facts.hostname,
    );
    expect(detailOf(details, InventoryAssetField.Manufacturer)?.value).toBe(
      facts.manufacturer,
    );
    expect(detailOf(details, InventoryAssetField.OperatingSystem)?.value).toBe(
      facts.operatingSystem,
    );
    expect(detailOf(details, InventoryAssetField.MacAddress)?.value).toBe(
      facts.macAddress,
    );
  });

  test("its location is the site, then where it says it is - credited to what it said", () => {
    expect(detailOf(details, InventoryAssetField.Location)?.value).toBe(
      "Store 12 · Back office rack",
    );
    expect(detailOf(details, InventoryAssetField.Location)?.source?.kind).toBe(
      AssetFactSourceKind.Discovered,
    );

    const siteOnly: InventoryAssetDetails =
      getNetworkDeviceInventoryAssetDetails({
        hostname: "10.0.0.1",
        site: { name: "Store 12" },
      });
    expect(detailOf(siteOnly, InventoryAssetField.Location)).toEqual({
      field: InventoryAssetField.Location,
      value: "Store 12",
      source: { kind: AssetFactSourceKind.Site },
    });
  });

  test("a typed MAC, with what the ARP table says beside it", () => {
    const mac: InventoryAssetDetail | undefined = detailOf(
      details,
      InventoryAssetField.MacAddress,
    );

    expect(mac?.value).toBe("00-1B-54-C2-7A-99");
    expect(mac?.source).toEqual({ kind: AssetFactSourceKind.Saved });
    expect(mac?.discoveredDifferent?.value).toBe("00-1B-54-C2-7A-07");
  });

  test("the unknown facts are named, as on the item", () => {
    expect(details.unknownFields).toEqual([
      InventoryAssetField.SerialNumber,
      InventoryAssetField.Model,
      InventoryAssetField.FirmwareVersion,
    ]);
    expect(detailOf(details, InventoryAssetField.SerialNumber)).toEqual({
      field: InventoryAssetField.SerialNumber,
      value: undefined,
    });
  });

  test("the scan that last found it, and the other machine a scan found there", () => {
    expect(details.foundBy).toEqual({ readBy: SCAN_READER, readAt: SCANNED });
    expect(details.otherMachine?.sysName).toBe("LAPTOP-12");
  });

  test("a device with nothing discovered has no address notes and no architecture", () => {
    const plain: InventoryAssetDetails = getNetworkDeviceInventoryAssetDetails({
      hostname: "10.0.0.1",
    });

    expect(plain.foundBy).toBeUndefined();
    expect(plain.otherMachine).toBeUndefined();
    expect(detailOf(plain, InventoryAssetField.Architecture)).toBeUndefined();
    expect(plain.kind).toBe(InventoryAssetKind.NetworkDevice);
  });

  test("a classified type is named as the project names its role", () => {
    const roles: Array<TopologyDeviceRoleInput> = [
      { key: "accessSwitch", name: "Store Switch" },
      { key: "switch", name: "Store Switch" },
    ];

    const named: InventoryAssetDetails = getNetworkDeviceInventoryAssetDetails(
      device,
      { roles: roles },
    );

    expect(detailOf(named, InventoryAssetField.DeviceType)?.value).toBe(
      "Store Switch",
    );
    expect(detailOf(named, InventoryAssetField.DeviceType)?.source?.kind).toBe(
      AssetFactSourceKind.Classified,
    );
  });
});
