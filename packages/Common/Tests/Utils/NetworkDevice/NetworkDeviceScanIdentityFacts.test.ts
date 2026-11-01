import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
} from "../../../Utils/Inventory/AssetFactSource";
import {
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  getNetworkDeviceInventoryAssetDetails,
} from "../../../Utils/Inventory/InventoryAssetDetails";
import {
  NetworkDeviceAssetFacts,
  NetworkDeviceAssetSource,
  NetworkDeviceFactDetails,
  getNetworkDeviceAssetFacts,
  getNetworkDeviceFactDetails,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import {
  DiscoveredDetailsPatch,
  planDiscoveredDetails,
} from "../../../Utils/NetworkDiscovery/DiscoveredDetailsPlan";

/*
 * What this is for: a device OneUptime only pings, with no SNMP credentials of
 * its own, on a subnet a discovery scan can read over SNMP. Its poll reads
 * nothing, so it read Unknown for its MAC, serial number and firmware although
 * the scan had the credentials to ask it.
 *
 * These go the whole way: a host row as the probe uploads it, the plan that
 * records it on the device, and the facts the Inventory shows, each saying the
 * scan read it. What a person saved or the device's own poll read is never
 * touched by any of it.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000007";
const SCAN_ID: string = "20000000-0000-4000-8000-000000000001";
const SCANNED_AT: string = "2026-10-29T08:00:00.000Z";

const ADDRESS: string = "10.20.12.7";

const SCAN: { id: string; name: string; completedAt: string } = {
  id: SCAN_ID,
  name: "Store subnets",
  completedAt: SCANNED_AT,
};

// A host that answered the scan, as the probe uploads it.
function hostRow(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: ADDRESS,
    sysName: "edge-sw-07",
    sysDescr: "Edge switch",
    sysObjectId: "1.3.6.1.4.1.9.1.1208",
    snmpReachable: true,
    scannedMacAddress: "00:1b:54:c2:7a:01",
    model: "WS-C2960X-48TS-L",
    serialNumber: "FOC1932X0K1",
    firmwareVersion: "15.2(7r)E",
    softwareVersion: "15.2(7)E2",
    ...overrides,
  };
}

// The device: an address someone added, and whatever `overrides` say.
function device(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return { name: ADDRESS, hostname: ADDRESS, ...overrides };
}

// The details the scan leaves on a device, as the merge statement applies them.
function afterScan(
  source: NetworkDeviceAssetSource,
  host: DiscoveredNetworkDevice = hostRow(),
): NetworkDeviceAssetSource {
  const stored: Record<string, unknown> = {
    ...((source.discoveredDetails as Record<string, unknown>) || {}),
  };

  const patches: Array<DiscoveredDetailsPatch> = planDiscoveredDetails({
    projectId: PROJECT_ID,
    scan: SCAN,
    hosts: [host],
    devices: [
      {
        deviceId: DEVICE_ID,
        projectId: PROJECT_ID,
        hostname: ADDRESS,
        discoveredDetails: stored,
      },
    ],
  });

  for (const patch of patches) {
    for (const key of patch.unset) {
      delete stored[key];
    }
    Object.assign(stored, patch.set);
  }

  return { ...source, discoveredDetails: stored };
}

const READ_BY_THE_SCAN: AssetFactSource = {
  kind: AssetFactSourceKind.Discovered,
  method: NetworkDeviceDiscoveryMethod.Snmp,
  readBy: {
    type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
    id: SCAN_ID,
    name: "Store subnets",
  },
  readAt: SCANNED_AT,
};

describe("a ping-only device a scan can read over SNMP", () => {
  const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
    afterScan(device()),
  );

  test("shows its MAC, in the form hosts report, with the scan as its source", () => {
    expect(details.facts.macAddress.value).toBe("00-1B-54-C2-7A-01");
    expect(details.facts.macAddress.source).toEqual(READ_BY_THE_SCAN);
  });

  test("shows its serial number, with the scan as its source", () => {
    expect(details.facts.serialNumber.value).toBe("FOC1932X0K1");
    expect(details.facts.serialNumber.source).toEqual(READ_BY_THE_SCAN);
  });

  test("shows its firmware, with the scan as its source", () => {
    expect(details.facts.firmwareVersion.value).toBe("15.2(7r)E");
    expect(details.facts.firmwareVersion.source).toEqual(READ_BY_THE_SCAN);
  });

  test("shows its model and software version the same way", () => {
    expect(details.facts.model.value).toBe("WS-C2960X-48TS-L");
    expect(details.facts.model.source).toEqual(READ_BY_THE_SCAN);
    expect(details.facts.osVersion.value).toBe("15.2(7)E2");
    expect(details.facts.osVersion.source).toEqual(READ_BY_THE_SCAN);
  });

  test("its Inventory record says the same", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(
      afterScan(device()),
    );

    expect(facts.macAddress).toBe("00-1B-54-C2-7A-01");
    expect(facts.serialNumber).toBe("FOC1932X0K1");
    expect(facts.firmwareVersion).toBe("15.2(7r)E");
  });

  test("its Asset Details card names the scan", () => {
    const asset: InventoryAssetDetails = getNetworkDeviceInventoryAssetDetails(
      afterScan(device()),
    );

    const detailOf: (
      field: InventoryAssetField,
    ) => InventoryAssetDetail | undefined = (
      field: InventoryAssetField,
    ): InventoryAssetDetail | undefined => {
      return asset.details.find((detail: InventoryAssetDetail): boolean => {
        return detail.field === field;
      });
    };

    expect(detailOf(InventoryAssetField.SerialNumber)?.value).toBe(
      "FOC1932X0K1",
    );
    expect(detailOf(InventoryAssetField.MacAddress)?.value).toBe(
      "00-1B-54-C2-7A-01",
    );
    expect(detailOf(InventoryAssetField.FirmwareVersion)?.value).toBe(
      "15.2(7r)E",
    );

    for (const field of [
      InventoryAssetField.SerialNumber,
      InventoryAssetField.MacAddress,
      InventoryAssetField.FirmwareVersion,
    ]) {
      expect(detailOf(field)?.source).toEqual(READ_BY_THE_SCAN);
    }
  });
});

describe("a ping-only device the scan could not read further", () => {
  test("an older probe's result leaves those details Unknown, not blank text", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(
      afterScan(
        device(),
        hostRow({
          scannedMacAddress: undefined,
          model: undefined,
          serialNumber: undefined,
          firmwareVersion: undefined,
          softwareVersion: undefined,
        }),
      ),
    );

    expect(facts.hostname).toBe("edge-sw-07");
    expect(facts.macAddress).toBeUndefined();
    expect(facts.serialNumber).toBeUndefined();
    expect(facts.firmwareVersion).toBeUndefined();
  });

  test("what an earlier scan read survives a later result that says nothing about it", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(
      afterScan(
        afterScan(device()),
        hostRow({
          scannedMacAddress: undefined,
          serialNumber: undefined,
          firmwareVersion: undefined,
          softwareVersion: undefined,
          model: undefined,
        }),
      ),
    );

    expect(facts.macAddress).toBe("00-1B-54-C2-7A-01");
    expect(facts.serialNumber).toBe("FOC1932X0K1");
    expect(facts.firmwareVersion).toBe("15.2(7r)E");
  });

  test("a sysLocation the scan no longer reads is still dropped, beside them", () => {
    const earlier: NetworkDeviceAssetSource = afterScan(
      device(),
      hostRow({ sysLocation: "Store 12" }),
    );

    expect(getNetworkDeviceAssetFacts(earlier).location).toBe("Store 12");

    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(
      afterScan(earlier, hostRow({ serialNumber: undefined })),
    );

    expect(facts.location).toBeUndefined();
    expect(facts.serialNumber).toBe("FOC1932X0K1");
  });
});

describe("what wins over what a scan read", () => {
  test("a value saved on the device stays, and the scan's is shown beside it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(device({ serialNumber: "TYPED-BY-A-PERSON" })),
    );

    expect(details.facts.serialNumber.value).toBe("TYPED-BY-A-PERSON");
    expect(details.facts.serialNumber.source?.kind).toBe(
      AssetFactSourceKind.Saved,
    );
    expect(details.facts.serialNumber.discoveredDifferent).toEqual({
      value: "FOC1932X0K1",
      source: READ_BY_THE_SCAN,
    });
  });

  test("a saved value the scan agrees with shows no difference", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(device({ firmwareVersion: "15.2(7R)e" })),
    );

    expect(details.facts.firmwareVersion.value).toBe("15.2(7R)e");
    expect(details.facts.firmwareVersion.discoveredDifferent).toBeUndefined();
  });

  test("a device polled since keeps what its poll read", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(
        device({
          serialNumber: "FROM-THE-POLL",
          lastSnmpSeenAt: "2026-10-29T09:00:00.000Z",
        }),
      ),
    );

    expect(details.facts.serialNumber.value).toBe("FROM-THE-POLL");
    expect(details.facts.serialNumber.source?.kind).toBe(
      AssetFactSourceKind.SnmpPoll,
    );
  });

  test("a scan since a device's last poll has the newer reading", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(
        device({
          firmwareVersion: "15.2(6r)E",
          lastSnmpSeenAt: "2026-10-28T09:00:00.000Z",
        }),
      ),
    );

    expect(details.facts.firmwareVersion.value).toBe("15.2(7r)E");
    expect(details.facts.firmwareVersion.source).toEqual(READ_BY_THE_SCAN);
  });

  test("a device nothing else names a value for still takes what the scan read over its controller's", () => {
    const controller: Record<string, unknown> = {
      controller: buildControllerReading({
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: NetworkDeviceDiscoveryReaderType.NetworkController,
          id: "22222222-2222-4222-8222-222222222222",
          name: "Acme Retail",
        },
        readAt: "2026-10-29T10:00:00.000Z",
        values: { serialNumber: "Q2XX-5384-0001" },
      }),
    };

    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(device({ discoveredDetails: controller })),
    );

    expect(details.facts.serialNumber.value).toBe("FOC1932X0K1");
    expect(details.facts.serialNumber.source).toEqual(READ_BY_THE_SCAN);
  });
});

describe("the device's MAC, by what names it", () => {
  const OWN_PORT: Record<string, unknown> = {
    ownMacAddress: {
      value: "aa:bb:cc:06:25:ed",
      method: "snmp",
      readBy: { type: "probe", id: "30000000-0000-4000-8000-000000000001" },
      readAt: "2026-10-01T00:00:00.000Z",
    },
  };

  test("a typed MAC comes first, and a port of the device does not contradict it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(device({ macAddress: "00:1b:54:c2:7a:99" })),
    );

    expect(details.facts.macAddress.value).toBe("00-1B-54-C2-7A-99");
    expect(details.facts.macAddress.discoveredDifferent).toBeUndefined();
  });

  test("a port its own poll read comes before the same port a scan read, however old", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      afterScan(
        device({
          lastSnmpSeenAt: "2026-10-02T00:00:00.000Z",
          discoveredDetails: OWN_PORT,
        }),
      ),
    );

    expect(details.facts.macAddress.value).toBe("AA-BB-CC-06-25-ED");
    expect(details.facts.macAddress.source?.kind).toBe(
      AssetFactSourceKind.SnmpPoll,
    );
  });
});
