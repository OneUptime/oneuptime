import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { DEFAULT_DISCOVERY_IMPORT_SETTINGS } from "../../../Types/NetworkDevice/DiscoveryImport";
import {
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  buildDiscoveredListEntries,
  sanitizeDiscoveredDetailsOnWrite,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../../Types/ObjectID";
import { AssetFactSourceKind } from "../../../Utils/Inventory/AssetFactSource";
import {
  NetworkDeviceAssetSource,
  NetworkDeviceFactDetails,
  getNetworkDeviceAssetFacts,
  getNetworkDeviceFactDetails,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { buildNetworkDeviceFromDiscoveredDevice } from "../../../Utils/NetworkDiscovery/DiscoveredEndpointDeviceBuilder";

/*
 * OneUptime issue #9305: a device added to monitoring from Network >
 * Discovered Devices read an empty Vendor / Model, although the list's row
 * for the very same box named its maker - "PROFUSION-733451, 10.34.15.10,
 * Sunnovo International, 20:4b:22:91:d7:21".
 *
 * These go the whole way: the device an import creates from the row, and
 * the facts the Devices list, the device's page and its inventory item show,
 * each saying the list's row is where the value came from. Anything saved on
 * the device, reported by its own poll or said by its controller wins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const ENDPOINT_ID: string = "40000000-0000-4000-8000-000000000001";
const READ_AT: Date = new Date("2026-11-17T08:00:00.000Z");

function imported(
  facts: Partial<{
    vendor: string;
    hostname: string;
    name: string;
  }> = {},
): NetworkDevice {
  return buildNetworkDeviceFromDiscoveredDevice({
    projectId: PROJECT_ID,
    ipAddress: "10.34.15.10",
    facts: {
      endpointId: ENDPOINT_ID,
      name: "PROFUSION-733451",
      macAddress: "20:4b:22:91:d7:21",
      vendor: "Sunnovo International",
      ...facts,
    },
    settings: DEFAULT_DISCOVERY_IMPORT_SETTINGS,
    readAt: READ_AT,
  });
}

function sourceOf(device: NetworkDevice): NetworkDeviceAssetSource {
  return device as unknown as NetworkDeviceAssetSource;
}

describe("a device imported from the Discovered Devices list", () => {
  test("keeps the maker the list showed, with the row as its source", () => {
    const device: NetworkDevice = imported();

    expect(device.discoveredDetails).toEqual({
      vendor: {
        value: "Sunnovo International",
        method: NetworkDeviceDiscoveryMethod.DiscoveredDeviceList,
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.DiscoveredDevice,
          id: ENDPOINT_ID,
          name: "PROFUSION-733451",
        },
        readAt: READ_AT.toISOString(),
      },
    });

    // What the server keeps of a create is exactly that.
    expect(sanitizeDiscoveredDetailsOnWrite(device.discoveredDetails)).toEqual(
      device.discoveredDetails,
    );

    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      sourceOf(device),
    );

    expect(details.facts.manufacturer.value).toBe("Sunnovo International");
    expect(details.facts.manufacturer.source).toEqual({
      kind: AssetFactSourceKind.Discovered,
      method: NetworkDeviceDiscoveryMethod.DiscoveredDeviceList,
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveredDevice,
        id: ENDPOINT_ID,
        name: "PROFUSION-733451",
      },
      readAt: READ_AT.toISOString(),
    });
  });

  test("keeps its address, its MAC and the name its controller gives it", () => {
    const device: NetworkDevice = imported({ hostname: "kitchen-display-04" });

    expect(device.hostname).toBe("10.34.15.10");
    expect(device.macAddress).toBe("20:4b:22:91:d7:21");
    expect(device.isMacAddressLearned).toBe(true);

    expect(getNetworkDeviceAssetFacts(sourceOf(device))).toMatchObject({
      hostname: "kitchen-display-04",
      ipAddress: "10.34.15.10",
      macAddress: "20-4B-22-91-D7-21",
      manufacturer: "Sunnovo International",
    });
  });

  test("a row with neither a maker nor a client name adds no discovered details", () => {
    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredDevice({
      projectId: PROJECT_ID,
      ipAddress: "10.0.0.9",
      facts: {
        endpointId: ENDPOINT_ID,
        name: "10.0.0.9",
        macAddress: "aa:bb:cc:dd:ee:ff",
      },
      settings: DEFAULT_DISCOVERY_IMPORT_SETTINGS,
      readAt: READ_AT,
    });

    expect(device.discoveredDetails).toBeUndefined();
    expect(
      getNetworkDeviceAssetFacts(sourceOf(device)).manufacturer,
    ).toBeUndefined();
  });

  test("the devices' own columns stay empty: the list's maker is never saved as if someone typed it", () => {
    const device: NetworkDevice = imported({ hostname: "kitchen-display-04" });

    expect(device.vendor).toBeUndefined();
    expect(device.deviceModel).toBeUndefined();
  });
});

describe("what wins over the list's maker", () => {
  const listDetails: Record<string, unknown> = buildDiscoveredListEntries({
    reading: {
      endpointId: ENDPOINT_ID,
      name: "PROFUSION-733451",
      vendor: "Sunnovo International",
      clientName: "kitchen-display-04",
    },
    readAt: READ_AT,
  });

  test("a vendor someone saved on the device", () => {
    expect(
      getNetworkDeviceAssetFacts({
        vendor: "Zebra",
        discoveredDetails: listDetails,
      }).manufacturer,
    ).toBe("Zebra");
  });

  test("the maker its own SNMP identity names", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysObjectId: "1.3.6.1.4.1.9.1.1208",
        discoveredDetails: listDetails,
      }).manufacturer,
    ).toBe("Cisco");
  });

  test("an SNMP agent's name is still no maker: the list's maker is", () => {
    expect(
      getNetworkDeviceAssetFacts({
        vendor: "Net-SNMP",
        discoveredDetails: listDetails,
      }).manufacturer,
    ).toBe("Sunnovo International");
  });

  test("the device's own name, and its controller's name for it, before the client name", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysName: "core-sw-01",
        discoveredDetails: listDetails,
      }).hostname,
    ).toBe("core-sw-01");

    const controller: Record<string, unknown> = {
      ...listDetails,
      controller: buildControllerReading({
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkController,
          id: "50000000-0000-4000-8000-000000000001",
          name: "Acme Retail",
        },
        readAt: READ_AT,
        values: { name: "Store 12 AP" },
      }),
    };

    expect(
      getNetworkDeviceAssetFacts({ discoveredDetails: controller }).hostname,
    ).toBe("Store 12 AP");
  });

  test("the client name is never the hostname when it is only an address", () => {
    expect(
      getNetworkDeviceAssetFacts({
        hostname: "10.34.15.10",
        discoveredDetails: buildDiscoveredListEntries({
          reading: { endpointId: ENDPOINT_ID, vendor: "Sunnovo International" },
          readAt: READ_AT,
        }),
      }).hostname,
    ).toBeUndefined();
  });
});
