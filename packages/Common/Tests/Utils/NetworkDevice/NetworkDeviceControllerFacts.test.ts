import { describe, expect, test } from "@jest/globals";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
  isAutomaticAssetFactSource,
  sourceOfControllerReading,
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
  getRoleOfControllerProductType,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";

/*
 * What a device's network controller says about it - the Meraki dashboard,
 * for a Meraki switch, access point or appliance in an organization the
 * project reads - as a source of its asset facts.
 *
 * A Meraki device implements no ENTITY-MIB: its own poll reads no serial
 * number, model or firmware, and the dashboard lists all three. The
 * controller FILLS IN: it never replaces a value someone saved (it is shown
 * beside one it disagrees with), never takes a detail from the device's own
 * poll, never names a device something it is not called, and never makes
 * its address the hostname.
 */

const CONNECTION: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.NetworkController,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
};

const READ_AT: string = "2026-10-28T10:00:00.000Z";
const POLLED_AT: string = "2026-10-28T09:00:00.000Z";

function controllerReading(
  values: Record<string, string> = {},
): NetworkDeviceControllerReading {
  const reading: NetworkDeviceControllerReading | undefined =
    buildControllerReading({
      provider: NetworkControllerProvider.Meraki,
      readBy: CONNECTION,
      readAt: READ_AT,
      values: {
        name: "Lobby AP",
        model: "MR46",
        serialNumber: "Q2KD-ABCD-1234",
        macAddress: "e0:55:3d:12:34:56",
        ipAddress: "10.20.30.41",
        firmwareVersion: "wireless-29-7",
        productType: "wireless",
        networkName: "Branch 12",
        address: "1600 Amphitheatre Pkwy, Mountain View",
        ...values,
      },
    });

  if (!reading) {
    throw new Error("no reading");
  }

  return reading;
}

const FROM_MERAKI: AssetFactSource = {
  kind: AssetFactSourceKind.Controller,
  readBy: CONNECTION,
  readAt: READ_AT,
  provider: NetworkControllerProvider.Meraki,
};

// An access point OneUptime only pings, which Meraki describes.
function pingedAccessPoint(
  overrides: Partial<NetworkDeviceAssetSource> = {},
  values: Record<string, string> = {},
): NetworkDeviceAssetSource {
  return {
    name: "10.20.30.41",
    hostname: "10.20.30.41",
    discoveredDetails: { controller: controllerReading(values) },
    ...overrides,
  };
}

describe("a device only Meraki describes takes every detail Meraki gives", () => {
  const details: NetworkDeviceFactDetails =
    getNetworkDeviceFactDetails(pingedAccessPoint());

  test("its model, serial number and firmware, from the dashboard", () => {
    expect(details.facts.model).toEqual({ value: "MR46", source: FROM_MERAKI });
    expect(details.facts.serialNumber).toEqual({
      value: "Q2KD-ABCD-1234",
      source: FROM_MERAKI,
    });
    expect(details.facts.firmwareVersion).toEqual({
      value: "wireless-29-7",
      source: FROM_MERAKI,
    });
  });

  test("its maker is the controller's", () => {
    expect(details.facts.manufacturer).toEqual({
      value: "Cisco Meraki",
      source: FROM_MERAKI,
    });
  });

  test("its MAC, in the IEEE form hosts report", () => {
    expect(details.facts.macAddress).toEqual({
      value: "E0-55-3D-12-34-56",
      source: FROM_MERAKI,
    });
  });

  test("its hostname is the name Meraki files it under, never its address", () => {
    expect(details.facts.hostname).toEqual({
      value: "Lobby AP",
      source: FROM_MERAKI,
    });
  });

  test("the address its probe polls stays its IP address", () => {
    expect(details.facts.ipAddress).toEqual({
      value: "10.20.30.41",
      source: { kind: AssetFactSourceKind.PolledAddress },
    });
  });

  test("its location is the street address Meraki files it under", () => {
    expect(details.facts.location).toEqual({
      value: "1600 Amphitheatre Pkwy, Mountain View",
      source: FROM_MERAKI,
    });
  });

  test("its type is worked out from the model Meraki gives", () => {
    expect(details.facts.deviceType).toEqual({
      value: "Wireless AP",
      source: { kind: AssetFactSourceKind.Classified },
    });
  });

  test("the reading itself is handed on, for the cards", () => {
    expect(details.controller).toEqual(controllerReading());
  });

  test("the mirror writes the same values onto its Inventory item", () => {
    const facts: NetworkDeviceAssetFacts =
      getNetworkDeviceAssetFacts(pingedAccessPoint());

    expect(facts).toMatchObject({
      hostname: "Lobby AP",
      ipAddress: "10.20.30.41",
      macAddress: "E0-55-3D-12-34-56",
      serialNumber: "Q2KD-ABCD-1234",
      manufacturer: "Cisco Meraki",
      model: "MR46",
      firmwareVersion: "wireless-29-7",
      deviceType: "Wireless AP",
      location: "1600 Amphitheatre Pkwy, Mountain View",
    });
  });

  test("Inventory's Asset Details card lists them, unknown only where Meraki says nothing", () => {
    const card: InventoryAssetDetails =
      getNetworkDeviceInventoryAssetDetails(pingedAccessPoint());

    expect(card.unknownFields).toEqual([
      InventoryAssetField.OperatingSystem,
      InventoryAssetField.OsVersion,
    ]);
  });
});

describe("what the device says comes first", () => {
  test("a system name, a NetBIOS name or a DNS name names it before Meraki does", () => {
    expect(
      getNetworkDeviceFactDetails(pingedAccessPoint({ sysName: "lobby-ap-01" }))
        .facts.hostname.value,
    ).toBe("lobby-ap-01");
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({ dnsName: "lobby-ap.branch12.acme.example" }),
      ).facts.hostname.value,
    ).toBe("lobby-ap.branch12.acme.example");
  });

  test("a device polled at a DNS name takes the address its probe resolved before Meraki's", () => {
    const resolved: NetworkDeviceAssetSource = pingedAccessPoint({
      hostname: "lobby-ap.branch12.acme.example",
    });

    // Its probe has resolved nothing yet: Meraki's management address.
    expect(getNetworkDeviceFactDetails(resolved).facts.ipAddress).toEqual({
      value: "10.20.30.41",
      source: FROM_MERAKI,
    });

    resolved.discoveredDetails = {
      ...(resolved.discoveredDetails as Record<string, unknown>),
      ipAddress: {
        value: "10.20.30.99",
        method: "dns",
        readBy: {
          type: "probe",
          id: "30000000-0000-4000-8000-000000000001",
          name: "Branch probe",
        },
        readAt: POLLED_AT,
      },
    };

    expect(getNetworkDeviceFactDetails(resolved).facts.ipAddress.value).toBe(
      "10.20.30.99",
    );
  });

  test("a sysLocation it reports comes before Meraki's street address; an agent's default does not", () => {
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({ sysLocation: "Branch 12, lobby ceiling" }),
      ).facts.location.value,
    ).toBe("Branch 12, lobby ceiling");
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({ sysLocation: "Sitting on the Dock of the Bay" }),
      ).facts.location.value,
    ).toBe("1600 Amphitheatre Pkwy, Mountain View");
  });

  test("what its own poll read keeps the detail, whatever Meraki says", () => {
    const walked: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({
        deviceModel: "MR46-HW",
        firmwareVersion: "29.7.1",
        serialNumber: "Q2KD-ABCD-1234",
        vendor: "Cisco Meraki",
        lastSnmpSeenAt: POLLED_AT,
      }),
    );

    expect(walked.facts.model).toEqual({
      value: "MR46-HW",
      source: { kind: AssetFactSourceKind.SnmpPoll, readAt: POLLED_AT },
    });
    expect(walked.facts.firmwareVersion.value).toBe("29.7.1");
    expect(walked.facts.firmwareVersion.source?.kind).toBe(
      AssetFactSourceKind.SnmpPoll,
    );
    // An automatic reading is never contradicted in amber.
    expect(walked.facts.model.discoveredDifferent).toBeUndefined();
    // Even a reading Meraki made AFTER the poll does not take it over.
    expect(Date.parse(READ_AT)).toBeGreaterThan(Date.parse(POLLED_AT));
  });

  test("a value saved on the device stays, with Meraki's beside it when the two differ", () => {
    const saved: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({ serialNumber: "Q2KD-ABCD-9999" }),
    );

    expect(saved.facts.serialNumber).toEqual({
      value: "Q2KD-ABCD-9999",
      source: { kind: AssetFactSourceKind.Saved },
      discoveredDifferent: { value: "Q2KD-ABCD-1234", source: FROM_MERAKI },
    });

    // The same value, saved: nothing beside it.
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({ serialNumber: "q2kd-abcd-1234" }),
      ).facts.serialNumber.discoveredDifferent,
    ).toBeUndefined();
  });

  test("a typed MAC Meraki disagrees with is shown beside Meraki's; an ARP table's disagreement comes first", () => {
    const typed: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({ macAddress: "e0:55:3d:12:34:99" }),
    );

    expect(typed.facts.macAddress.value).toBe("E0-55-3D-12-34-99");
    expect(typed.facts.macAddress.source).toEqual({
      kind: AssetFactSourceKind.Saved,
    });
    expect(typed.facts.macAddress.discoveredDifferent).toEqual({
      value: "E0-55-3D-12-34-56",
      source: FROM_MERAKI,
    });

    // Typed the way Meraki says it: nothing beside it.
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({ macAddress: "E0-55-3D-12-34-56" }),
      ).facts.macAddress.discoveredDifferent,
    ).toBeUndefined();

    const arp: Record<string, unknown> = {
      value: "e0:55:3d:12:34:77",
      method: "arpTable",
      readBy: {
        type: "networkDevice",
        id: "40000000-0000-4000-8000-000000000099",
        name: "core-rtr-01",
      },
      readAt: POLLED_AT,
    };

    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({
          macAddress: "e0:55:3d:12:34:99",
          discoveredDetails: {
            controller: controllerReading(),
            macAddress: arp,
          },
        }),
      ).facts.macAddress.discoveredDifferent?.value,
    ).toBe("E0-55-3D-12-34-77");
  });

  test("an assigned role names its type, whatever Meraki files it as", () => {
    const assigned: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({
        networkDeviceRole: { key: "switch", name: "Access Switch" },
      }),
    );

    expect(assigned.facts.deviceType).toEqual({
      value: "Access Switch",
      source: { kind: AssetFactSourceKind.AssignedRole },
    });
  });
});

describe("its type, from Meraki's product type when nothing else says", () => {
  test("a model the classifier does not know: the product type names it", () => {
    const gateway: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({}, { model: "MG21", productType: "cellularGateway" }),
    );

    expect(gateway.facts.deviceType).toEqual({
      value: "Router",
      source: FROM_MERAKI,
    });
  });

  test("the project's name for that role, when it has one", () => {
    const gateway: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedAccessPoint({}, { model: "MG21", productType: "cellularGateway" }),
      { roles: [{ key: "router", name: "WAN Router" }] },
    );

    expect(gateway.facts.deviceType).toEqual({
      value: "WAN Router",
      source: FROM_MERAKI,
    });
  });

  test("a product type that names no role leaves it unknown", () => {
    expect(
      getNetworkDeviceFactDetails(
        pingedAccessPoint({}, { model: "MT10", productType: "sensor" }),
      ).facts.deviceType,
    ).toEqual({});
  });

  test.each([
    ["appliance", "firewall"],
    ["switch", "switch"],
    ["wireless", "wirelessAccessPoint"],
    ["wirelessController", "wirelessAccessPoint"],
    ["camera", "camera"],
    ["cellularGateway", "router"],
    ["campusGateway", "router"],
  ])("%s is drawn as %s", (productType: string, role: string) => {
    expect(getRoleOfControllerProductType(productType)).toBe(role);
  });

  test("anything else is no role - inherited names included", () => {
    for (const other of [
      "sensor",
      "secureConnect",
      "systemsManager",
      "",
      undefined,
      "constructor",
      "__proto__",
      "toString",
    ]) {
      expect(getRoleOfControllerProductType(other)).toBeUndefined();
    }
  });
});

describe("a device Meraki does not describe reads as it did", () => {
  test("no controller reading: every fact as before", () => {
    const device: NetworkDeviceAssetSource = {
      name: "core-sw-01",
      hostname: "10.20.0.1",
      sysName: "core-sw-01",
      vendor: "Cisco",
      deviceModel: "WS-C3850-48P",
      lastSnmpSeenAt: POLLED_AT,
    };

    const withEmptyDetails: NetworkDeviceAssetSource = {
      ...device,
      discoveredDetails: { controller: "not a reading" },
    };

    expect(getNetworkDeviceFactDetails(withEmptyDetails)).toEqual(
      getNetworkDeviceFactDetails(device),
    );
    expect(getNetworkDeviceFactDetails(device).controller).toBeUndefined();
  });
});

describe("the controller as a source", () => {
  test("is automatic: a newer reading may replace it", () => {
    expect(isAutomaticAssetFactSource(FROM_MERAKI)).toBe(true);
  });

  test("names the connection that read it, when, and the controller", () => {
    expect(sourceOfControllerReading(controllerReading())).toEqual(
      FROM_MERAKI,
    );
  });
});
