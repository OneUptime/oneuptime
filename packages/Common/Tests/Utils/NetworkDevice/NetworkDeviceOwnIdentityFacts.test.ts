import { describe, expect, test } from "@jest/globals";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryReaderType,
  NetworkDeviceDiscoveredField,
  buildControllerReading,
  buildDiscoveredValue,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
} from "../../../Utils/Inventory/AssetFactSource";
import {
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

/*
 * Issue #5384: "the inventory record for UN0362WANRTR01 identifies the device
 * as a Cisco Meraki MX85 firewall and displays its IP address, manufacturer,
 * model, and system description. However, fields such as MAC address, serial
 * number, firmware version, operating system, and OS version remain unknown."
 *
 * These read that device as its poll leaves it, with and without its Meraki
 * dashboard, and what wins when more than one place knows a detail. What
 * someone typed is never touched, by anything here.
 */

const POLLED_AT: string = "2026-10-28T09:58:00.000Z";
const OWN_MAC: string = "aa:bb:cc:06:25:ed";

function ownMac(value: string = OWN_MAC): NetworkDeviceDiscoveredValue {
  return buildDiscoveredValue({
    field: NetworkDeviceDiscoveredField.OwnMacAddress,
    value: value,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.Probe,
      id: "30000000-0000-4000-8000-000000000001",
    },
    readAt: "2026-10-01T00:00:00.000Z",
  })!;
}

function arpReading(value: string): NetworkDeviceDiscoveredValue {
  return buildDiscoveredValue({
    field: NetworkDeviceDiscoveredField.MacAddress,
    value: value,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
      id: "30000000-0000-4000-8000-000000000002",
      name: "core-rtr-01",
    },
    readAt: "2026-10-28T09:00:00.000Z",
  })!;
}

function dashboard(
  values: Record<string, string> = {},
): NetworkDeviceControllerReading {
  return buildControllerReading({
    provider: NetworkControllerProvider.Meraki,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.NetworkController,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Acme Retail",
    },
    readAt: "2026-10-28T10:00:00.000Z",
    values: {
      name: "UN0362WANRTR01",
      model: "MX85",
      serialNumber: "Q2XX-5384-0001",
      macAddress: "aa:bb:cc:06:25:e8",
      firmwareVersion: "wired-18-211-2",
      productType: "appliance",
      ...values,
    },
  })!;
}

// The device in the issue, as a successful walk leaves it.
function issueDevice(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "UN0362WANRTR01",
    hostname: "10.241.124.1",
    sysName: "UN0362WANRTR01",
    sysDescr: "Meraki MX85",
    sysObjectId: "1.3.6.1.4.1.29671.2.500",
    vendor: "Cisco Meraki",
    lastSnmpSeenAt: POLLED_AT,
    discoveredDetails: { ownMacAddress: ownMac() },
    ...overrides,
  };
}

function withDashboard(
  overrides: Record<string, string> = {},
): NetworkDeviceAssetSource {
  return issueDevice({
    discoveredDetails: {
      ownMacAddress: ownMac(),
      controller: dashboard(overrides),
    },
  });
}

describe("the device in the issue, polled and no more", () => {
  const facts: NetworkDeviceAssetFacts =
    getNetworkDeviceAssetFacts(issueDevice());

  test("its MAC is one of its own ports', in the form hosts report", () => {
    expect(facts.macAddress).toBe("AA-BB-CC-06-25-ED");
  });

  test("its operating system is the firmware every MX runs", () => {
    expect(facts.operatingSystem).toBe("Meraki MX firmware");
  });

  test("what only its dashboard knows stays Unknown, never a guess", () => {
    expect(facts.serialNumber).toBeUndefined();
    expect(facts.firmwareVersion).toBeUndefined();
    expect(facts.osVersion).toBeUndefined();
  });

  test("what it showed before, it still shows", () => {
    expect(facts).toMatchObject({
      hostname: "UN0362WANRTR01",
      ipAddress: "10.241.124.1",
      manufacturer: "Cisco Meraki",
      model: "MX85",
      deviceType: "Firewall",
    });
  });

  test("its MAC and its OS are said to come from its poll, as of its last walk", () => {
    const details: NetworkDeviceFactDetails =
      getNetworkDeviceFactDetails(issueDevice());
    const poll: AssetFactSource = {
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: POLLED_AT,
    };

    expect(details.facts.macAddress.source).toEqual(poll);
    expect(details.facts.operatingSystem.source).toEqual(poll);
    expect(details.facts.macAddress.discoveredDifferent).toBeUndefined();
  });

  test("the card lists what is left, and nothing else", () => {
    const details: InventoryAssetDetails =
      getNetworkDeviceInventoryAssetDetails(issueDevice());

    expect(details.unknownFields).toEqual([
      InventoryAssetField.SerialNumber,
      InventoryAssetField.FirmwareVersion,
      InventoryAssetField.OsVersion,
      InventoryAssetField.Location,
    ]);
  });
});

describe("the device in the issue, with its Meraki dashboard", () => {
  const facts: NetworkDeviceAssetFacts =
    getNetworkDeviceAssetFacts(withDashboard());

  test("every detail the issue lists is filled", () => {
    expect(facts).toMatchObject({
      macAddress: "AA-BB-CC-06-25-E8",
      serialNumber: "Q2XX-5384-0001",
      firmwareVersion: "wired-18-211-2",
      operatingSystem: "Meraki MX firmware",
      osVersion: "18.211.2",
    });
  });

  test("its OS version says the dashboard gave it", () => {
    const source: AssetFactSource | undefined =
      getNetworkDeviceFactDetails(withDashboard()).facts.osVersion.source;

    expect(source?.kind).toBe(AssetFactSourceKind.Controller);
    expect(source?.readBy?.name).toBe("Acme Retail");
  });

  test("its OS is what its sysDescr says, and its poll's to give", () => {
    expect(
      getNetworkDeviceFactDetails(withDashboard()).facts.operatingSystem.source
        ?.kind,
    ).toBe(AssetFactSourceKind.SnmpPoll);
  });

  test("a firmware the dashboard words otherwise fills the firmware and no OS version", () => {
    const locked: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts(
      withDashboard({
        firmwareVersion: "Firmware locked. Please contact support.",
      }),
    );

    expect(locked.firmwareVersion).toBe(
      "Firmware locked. Please contact support.",
    );
    expect(locked.osVersion).toBeUndefined();
  });

  test("a device nothing polls has its OS named by the model its dashboard lists", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      name: "UN0362WANRTR01",
      hostname: "10.241.124.1",
      discoveredDetails: {
        controller: dashboard({ model: "MR46", productType: "wireless" }),
      },
    });

    expect(details.facts.operatingSystem.value).toBe("Meraki MR firmware");
    expect(details.facts.operatingSystem.source?.kind).toBe(
      AssetFactSourceKind.Controller,
    );
    expect(details.facts.osVersion.value).toBe("18.211.2");
  });
});

describe("whose MAC wins", () => {
  function macOf(device: NetworkDeviceAssetSource): {
    value: string | undefined;
    kind: string | undefined;
  } {
    const details: NetworkDeviceFactDetails =
      getNetworkDeviceFactDetails(device);

    return {
      value: details.facts.macAddress.value,
      kind: details.facts.macAddress.source?.kind,
    };
  }

  test("a MAC someone typed, and nothing is said against it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      issueDevice({ macAddress: "00:1b:54:c2:7a:01" }),
    );

    expect(details.facts.macAddress.value).toBe("00-1B-54-C2-7A-01");
    expect(details.facts.macAddress.source?.kind).toBe(
      AssetFactSourceKind.Saved,
    );
    /*
     * A device has a MAC per port, so a port that differs from a typed MAC
     * is no disagreement: no amber line under it.
     */
    expect(details.facts.macAddress.discoveredDifferent).toBeUndefined();
  });

  test("a MAC learned from an ARP table, which is the MAC behind its address", () => {
    expect(
      macOf(
        issueDevice({
          macAddress: "00:1b:54:c2:7a:01",
          isMacAddressLearned: true,
        }),
      ),
    ).toEqual({
      value: "00-1B-54-C2-7A-01",
      kind: AssetFactSourceKind.LearnedFromArp,
    });
  });

  test("an ARP table's reading, recorded with who read it", () => {
    expect(
      macOf(
        issueDevice({
          discoveredDetails: {
            ownMacAddress: ownMac(),
            macAddress: arpReading("00:1b:54:c2:7a:01"),
          },
        }),
      ),
    ).toEqual({
      value: "00-1B-54-C2-7A-01",
      kind: AssetFactSourceKind.Discovered,
    });
  });

  test("the dashboard's, printed on the box, ahead of one of its ports", () => {
    expect(macOf(withDashboard())).toEqual({
      value: "AA-BB-CC-06-25-E8",
      kind: AssetFactSourceKind.Controller,
    });
  });

  test("its own port, when nothing else names one", () => {
    expect(macOf(issueDevice()).value).toBe("AA-BB-CC-06-25-ED");
  });

  test("without a walk's time, the time the port was read", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      issueDevice({ lastSnmpSeenAt: undefined }),
    );

    expect(details.facts.macAddress.source).toEqual({
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: "2026-10-01T00:00:00.000Z",
    });
  });

  test("nothing at all: Unknown, as ever", () => {
    expect(macOf(issueDevice({ discoveredDetails: undefined })).value).toBe(
      undefined,
    );
  });

  test("an entry in the wrong shape is not a MAC", () => {
    expect(
      macOf(
        issueDevice({
          discoveredDetails: {
            ownMacAddress: { ...ownMac(), method: "arpTable" },
          },
        }),
      ).value,
    ).toBeUndefined();
    expect(
      macOf(
        issueDevice({
          discoveredDetails: {
            ownMacAddress: {
              ...ownMac(),
              readBy: { type: "discoveryScan", id: "x" },
            },
          },
        }),
      ).value,
    ).toBeUndefined();
  });
});

describe("the operating system a platform runs", () => {
  test("a FortiGate sends a blank sysDescr, and its sysObjectID says FortiOS", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      sysDescr: "",
      sysObjectId: "1.3.6.1.4.1.12356.101.1.644",
      lastSnmpSeenAt: POLLED_AT,
      softwareVersion: "7.2.6",
    });

    expect(details.facts.operatingSystem.value).toBe("FortiOS");
    expect(details.facts.operatingSystem.source?.kind).toBe(
      AssetFactSourceKind.SnmpPoll,
    );
    expect(details.facts.osVersion.value).toBe("7.2.6");
  });

  test("a Sophos firewall built on Linux is a Sophos firewall", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr:
          "Linux localhost 4.14.38 #2 SMP Fri Jun 5 23:03:53 UTC 2020 x86_64",
        sysObjectId: "1.3.6.1.4.1.2604.5",
        lastSnmpSeenAt: POLLED_AT,
        softwareVersion: "18.0.1 MR-1-Build396",
      }),
    ).toMatchObject({
      operatingSystem: "Sophos Firewall OS",
      osVersion: "18.0.1 MR-1-Build396",
    });
  });

  test("a MikroTik whose description was replaced is still on RouterOS", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: "router",
        sysObjectId: "1.3.6.1.4.1.14988.1",
      }).operatingSystem,
    ).toBe("RouterOS");
  });

  test("a platform that says for itself keeps saying so", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr:
          "Juniper Networks, Inc. mx80 internet router, kernel JUNOS 16.2R2.8, Build date: 2017-07-06",
        sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.57",
      }).operatingSystem,
    ).toBe("Junos OS");
  });

  test("a Linux host is still a Linux host", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: "Linux fw01 5.10.0-21-amd64 #1 SMP Debian x86_64",
        sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
      }).operatingSystem,
    ).toBe("Linux");
  });

  test("a device nothing identifies has none", () => {
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: "some appliance",
        sysObjectId: "1.3.6.1.4.1.99999.1",
      }).operatingSystem,
    ).toBeUndefined();
  });
});

describe("whose OS version wins", () => {
  test("what the device's poll read, then its sysDescr, then its dashboard", () => {
    const cisco: string =
      "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, RELEASE SOFTWARE (fc3)";

    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: cisco,
        softwareVersion: "16.12.4",
        discoveredDetails: { controller: dashboard() },
      }).osVersion,
    ).toBe("16.12.4");
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: cisco,
        discoveredDetails: { controller: dashboard() },
      }).osVersion,
    ).toBe("15.0(2)SE11");
    expect(
      getNetworkDeviceAssetFacts({
        sysDescr: "Meraki MX85",
        discoveredDetails: { controller: dashboard() },
      }).osVersion,
    ).toBe("18.211.2");
  });
});
