import { describe, expect, test } from "@jest/globals";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import {
  DISCOVERED_DETAILS_CONTROLLER_KEY,
  DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY,
  DISCOVERED_DETAILS_FOUND_BY_KEY,
  DISCOVERED_DETAILS_OTHER_MACHINE_KEY,
  NETWORK_DEVICE_DISCOVERED_FIELDS,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
  buildDiscoveredListEntries,
  buildDiscoveredValue,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  NetworkDeviceAssetSource,
  getNetworkDeviceAssetFacts,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import {
  MAX_STORED_MANUFACTURER_LENGTH,
  NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS,
  NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS,
  getStoredNetworkDeviceManufacturer,
  isNetworkDeviceManufacturerChangedByWalk,
  isNetworkDeviceManufacturerDiscoveredPatch,
  isNetworkDeviceManufacturerInputWrite,
} from "../../../Utils/NetworkDevice/NetworkDeviceStoredManufacturer";

/*
 * OneUptime issue #9363: the Devices list's Vendor filter searched the
 * `vendor` column, while its Vendor / Model column names the maker the
 * device's asset facts give - the Discovered Devices list's maker for a
 * device only that list knows one for (issue #9305), a discovery scan's
 * reading of its SNMP identity (issue #5185), its controller, or the platform
 * its sysDescr names. The server now keeps that very maker on the device
 * (NetworkDevice.manufacturer), and the filter and the column's sort read it.
 *
 * What is kept is what the column shows, whatever the device holds: these
 * hold getStoredNetworkDeviceManufacturer to getNetworkDeviceAssetFacts'
 * manufacturer, the function the cell draws, over every source of a maker
 * and every order of precedence between them. And the service works it out
 * again after a write only when the write can change it: these hold the
 * lists of what it is worked out from to what the function reads.
 */

const ENDPOINT_ID: string = "40000000-0000-4000-8000-000000000001";
const SCAN_ID: string = "20000000-0000-4000-8000-000000000001";
const CONNECTION_ID: string = "50000000-0000-4000-8000-000000000001";

const LIST_READ_AT: Date = new Date("2026-11-17T08:00:00.000Z");
const SCANNED_AT: Date = new Date("2026-11-10T08:00:00.000Z");
const WALKED_BEFORE_SCAN: Date = new Date("2026-11-09T08:00:00.000Z");
const WALKED_AFTER_SCAN: Date = new Date("2026-11-11T08:00:00.000Z");

// What the Discovered Devices list knows about the device: its MAC's maker.
function listVendor(vendor: string): Record<string, unknown> {
  return buildDiscoveredListEntries({
    reading: {
      endpointId: ENDPOINT_ID,
      name: "PROFUSION-733451",
      vendor: vendor,
    },
    readAt: LIST_READ_AT,
  });
}

// What a discovery scan read over SNMP at the device's address.
function scanned(
  field: NetworkDeviceDiscoveredField,
  value: string,
  readAt: Date = SCANNED_AT,
): Record<string, unknown> {
  const entry: NetworkDeviceDiscoveredValue | undefined = buildDiscoveredValue({
    field: field,
    value: value,
    readBy: {
      type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
      id: SCAN_ID,
      name: "Store subnets",
    },
    readAt: readAt,
  });

  expect(entry).toBeDefined();

  return { [field]: entry };
}

// What the device's Meraki dashboard says it is.
function merakiReading(): Record<string, unknown> {
  return {
    [DISCOVERED_DETAILS_CONTROLLER_KEY]: buildControllerReading({
      provider: NetworkControllerProvider.Meraki,
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.NetworkController,
        id: CONNECTION_ID,
        name: "Acme Retail",
      },
      readAt: LIST_READ_AT,
      values: { model: "MS120-8LP", serialNumber: "Q2CX-ABCD-1234" },
    }),
  };
}

// What the column shows: the cell's own function.
function shown(device: NetworkDeviceAssetSource): string | null {
  return getNetworkDeviceAssetFacts(device).manufacturer || null;
}

interface Case {
  name: string;
  device: NetworkDeviceAssetSource;
  maker: string | null;
}

const EDGE_SWITCH_DESCRIPTION: string =
  "EdgeSwitch 24-Port Lite, 1.8.2.5249835, Linux 3.6.5-f4a26ed5";

const CASES: ReadonlyArray<Case> = [
  {
    name: "a device only the Discovered Devices list names a maker for",
    device: {
      hostname: "10.34.15.10",
      discoveredDetails: listVendor("Sunnovo International"),
    },
    maker: "Sunnovo International",
  },
  {
    name: "a vendor saved on the device",
    device: { hostname: "10.0.0.1", vendor: "Zebra" },
    maker: "Zebra",
  },
  {
    name: "a saved vendor and the list's maker: the saved one",
    device: {
      vendor: "Zebra",
      discoveredDetails: listVendor("Sunnovo International"),
    },
    maker: "Zebra",
  },
  {
    name: "a vendor its own poll read and the list's maker: the poll's",
    device: {
      vendor: "Cisco Systems, Inc.",
      sysObjectId: "1.3.6.1.4.1.9.1.1208",
      lastSnmpSeenAt: WALKED_AFTER_SCAN,
      discoveredDetails: listVendor("Sunnovo International"),
    },
    maker: "Cisco Systems, Inc.",
  },
  {
    name: "an SNMP agent's name is no maker: the list's maker is",
    device: {
      vendor: "Net-SNMP",
      sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
      lastSnmpSeenAt: WALKED_AFTER_SCAN,
      discoveredDetails: listVendor("Raspberry Pi Trading"),
    },
    maker: "Raspberry Pi Trading",
  },
  {
    name: "the device's controller, over the list's maker",
    device: {
      discoveredDetails: {
        ...listVendor("Sunnovo International"),
        ...merakiReading(),
      },
    },
    maker: "Cisco Meraki",
  },
  {
    name: "the platform its sysDescr names, over the enterprise arc's vendor its poll stored",
    device: {
      vendor: "Broadcom",
      sysObjectId: "1.3.6.1.4.1.4413.1.1",
      sysDescr: EDGE_SWITCH_DESCRIPTION,
      lastSnmpSeenAt: WALKED_AFTER_SCAN,
    },
    maker: "Ubiquiti",
  },
  {
    name: "a ping-only device a discovery scan read over SNMP: its sysObjectID's maker",
    device: {
      hostname: "10.20.12.7",
      discoveredDetails: {
        ...scanned(
          NetworkDeviceDiscoveredField.SystemObjectId,
          "1.3.6.1.4.1.9.1.1208",
        ),
        ...listVendor("Cisco Systems, Inc"),
      },
    },
    maker: "Cisco",
  },
  {
    name: "a scan's reading newer than the last walk wins over the walk's",
    device: {
      vendor: "Broadcom",
      sysObjectId: "1.3.6.1.4.1.4413.1.1",
      sysDescr: "FASTPATH Switching",
      lastSnmpSeenAt: WALKED_BEFORE_SCAN,
      discoveredDetails: scanned(
        NetworkDeviceDiscoveredField.SystemDescription,
        EDGE_SWITCH_DESCRIPTION,
      ),
    },
    maker: "Ubiquiti",
  },
  {
    name: "a walk newer than the scan wins over the scan's reading",
    device: {
      vendor: "Broadcom",
      sysObjectId: "1.3.6.1.4.1.4413.1.1",
      sysDescr: "FASTPATH Switching",
      lastSnmpSeenAt: WALKED_AFTER_SCAN,
      discoveredDetails: scanned(
        NetworkDeviceDiscoveredField.SystemDescription,
        EDGE_SWITCH_DESCRIPTION,
      ),
    },
    maker: "Broadcom",
  },
  {
    name: "a device nothing names a maker for",
    device: { name: "10.0.0.9", hostname: "10.0.0.9" },
    maker: null,
  },
  {
    name: "a blank vendor and nothing else",
    device: { vendor: "   ", discoveredDetails: {} },
    maker: null,
  },
];

describe("the maker kept on a device is the one its Vendor / Model column shows", () => {
  for (const item of CASES) {
    test(item.name, () => {
      expect(getStoredNetworkDeviceManufacturer(item.device)).toBe(item.maker);
      expect(getStoredNetworkDeviceManufacturer(item.device)).toBe(
        shown(item.device),
      );
    });
  }

  test("a value read out of a row as anything but text names no maker", () => {
    expect(
      getStoredNetworkDeviceManufacturer({
        vendor: 42,
        discoveredDetails: "not an object",
      }),
    ).toBeNull();
  });

  test("never longer than the column: a longer one is cut, never refused", () => {
    const long: string = "V".repeat(MAX_STORED_MANUFACTURER_LENGTH + 20);

    expect(getStoredNetworkDeviceManufacturer({ vendor: long })).toBe(
      long.substring(0, MAX_STORED_MANUFACTURER_LENGTH),
    );
    expect(MAX_STORED_MANUFACTURER_LENGTH).toBe(100);
  });
});

describe("what the maker is worked out from", () => {
  test("a write of a column it is worked out from asks for it again", () => {
    expect(NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS).toEqual([
      "vendor",
      "sysDescr",
      "sysObjectId",
      "lastSnmpSeenAt",
      "discoveredDetails",
    ]);

    for (const column of NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS) {
      expect(isNetworkDeviceManufacturerInputWrite([column])).toBe(true);
      expect(isNetworkDeviceManufacturerInputWrite(["name", column])).toBe(
        true,
      );
    }
  });

  test("a write of anything else does not", () => {
    expect(isNetworkDeviceManufacturerInputWrite([])).toBe(false);
    expect(
      isNetworkDeviceManufacturerInputWrite([
        "name",
        "hostname",
        "sysName",
        "deviceModel",
        "macAddress",
        "siteId",
        "lastSeenAt",
        "isReachable",
        "manufacturer",
      ]),
    ).toBe(false);
  });

  /*
   * The guard on the list above: a column the maker turns out to read that
   * is not on it would be written without the maker being worked out again,
   * and the filter would miss the device until something else changed.
   */
  test("no other column of the device changes the maker", () => {
    const columns: Record<string, unknown> = {
      name: "core-sw-01",
      hostname: "10.0.0.1",
      dnsName: "core-sw-01.example.com",
      sysName: "core-sw-01",
      discoveredName: "core-sw-01",
      discoveredNameSource: "sysName",
      macAddress: "00:1b:54:c2:7a:01",
      isMacAddressLearned: true,
      deviceModel: "WS-C2960X-48TS-L",
      serialNumber: "FOC1932X0K1",
      firmwareVersion: "15.2(7r)E",
      softwareVersion: "15.2(7)E2",
      sysLocation: "DC1, Rack 14",
      sysContact: "netops@example.com",
      site: { name: "Head office" },
      networkDeviceRole: { key: "switch", name: "Switch" },
    };

    for (const item of CASES) {
      const maker: string | null = getStoredNetworkDeviceManufacturer(
        item.device,
      );

      for (const [column, value] of Object.entries(columns)) {
        expect(
          getStoredNetworkDeviceManufacturer({
            ...item.device,
            [column]: value,
          }),
        ).toBe(maker);
      }
    }
  });

  test("a merge of a key it reads asks for it again", () => {
    expect(NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS).toEqual([
      NetworkDeviceDiscoveredField.SystemDescription,
      NetworkDeviceDiscoveredField.SystemObjectId,
      NetworkDeviceDiscoveredField.Vendor,
      DISCOVERED_DETAILS_CONTROLLER_KEY,
    ]);

    for (const key of NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS) {
      expect(
        isNetworkDeviceManufacturerDiscoveredPatch({ set: { [key]: {} } }),
      ).toBe(true);
      expect(isNetworkDeviceManufacturerDiscoveredPatch({ unset: [key] })).toBe(
        true,
      );
    }
  });

  test("a merge of any other key does not", () => {
    const otherKeys: Array<string> = [
      ...NETWORK_DEVICE_DISCOVERED_FIELDS.filter((field: string): boolean => {
        return !NETWORK_DEVICE_MANUFACTURER_DISCOVERED_KEYS.includes(field);
      }),
      DISCOVERED_DETAILS_FOUND_BY_KEY,
      DISCOVERED_DETAILS_OTHER_MACHINE_KEY,
      DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY,
    ];

    expect(otherKeys).toContain(NetworkDeviceDiscoveredField.MacAddress);
    expect(otherKeys).toContain(NetworkDeviceDiscoveredField.IpAddress);

    expect(isNetworkDeviceManufacturerDiscoveredPatch({})).toBe(false);

    for (const key of otherKeys) {
      expect(
        isNetworkDeviceManufacturerDiscoveredPatch({ set: { [key]: {} } }),
      ).toBe(false);
      expect(isNetworkDeviceManufacturerDiscoveredPatch({ unset: [key] })).toBe(
        false,
      );
    }
  });

  /*
   * The guard on the keys: whatever else discovery records about a device,
   * dropping it never changes the maker.
   */
  test("no other key of the discovered details changes the maker", () => {
    const others: Record<string, unknown> = {
      ...scanned(NetworkDeviceDiscoveredField.SystemName, "edge-sw-07"),
      ...scanned(NetworkDeviceDiscoveredField.Model, "WS-C2960X-48TS-L"),
      ...scanned(NetworkDeviceDiscoveredField.SerialNumber, "FOC1932X0K1"),
      ...scanned(
        NetworkDeviceDiscoveredField.ScannedMacAddress,
        "00:1b:54:c2:7a:01",
      ),
      ...buildDiscoveredListEntries({
        reading: {
          endpointId: ENDPOINT_ID,
          name: "PROFUSION-733451",
          clientName: "kitchen-display-04",
        },
        readAt: LIST_READ_AT,
      }),
    };

    for (const item of CASES) {
      const details: Record<string, unknown> =
        (item.device.discoveredDetails as Record<string, unknown>) || {};

      expect(
        getStoredNetworkDeviceManufacturer({
          ...item.device,
          discoveredDetails: { ...details, ...others },
        }),
      ).toBe(getStoredNetworkDeviceManufacturer(item.device));
    }
  });
});

describe("a walk that reads nothing new", () => {
  const afterScan: NetworkDeviceAssetSource = {
    vendor: "Broadcom",
    sysObjectId: "1.3.6.1.4.1.4413.1.1",
    sysDescr: "FASTPATH Switching",
    lastSnmpSeenAt: WALKED_BEFORE_SCAN,
    discoveredDetails: scanned(
      NetworkDeviceDiscoveredField.SystemDescription,
      EDGE_SWITCH_DESCRIPTION,
    ),
  };

  test("changes the maker when it makes the device's own reading the newer one again", () => {
    expect(getStoredNetworkDeviceManufacturer(afterScan)).toBe("Ubiquiti");
    expect(
      isNetworkDeviceManufacturerChangedByWalk(afterScan, WALKED_AFTER_SCAN),
    ).toBe(true);
  });

  test("does not while the scan's reading is still the newer", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        afterScan,
        new Date(SCANNED_AT.getTime() - 1000),
      ),
    ).toBe(false);
  });

  test("does not when the walk is older than the one the device holds", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        { ...afterScan, lastSnmpSeenAt: WALKED_AFTER_SCAN },
        WALKED_BEFORE_SCAN,
      ),
    ).toBe(false);
  });

  test("does not when the two readings name the same maker", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        {
          ...afterScan,
          sysDescr: EDGE_SWITCH_DESCRIPTION,
        },
        WALKED_AFTER_SCAN,
      ),
    ).toBe(false);
  });

  test("does not for a device discovery read nothing of", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        {
          vendor: "Cisco",
          sysObjectId: "1.3.6.1.4.1.9.1.1208",
          lastSnmpSeenAt: WALKED_BEFORE_SCAN,
        },
        WALKED_AFTER_SCAN,
      ),
    ).toBe(false);
  });

  test("a device walked for the first time: what it holds becomes the poll's reading", () => {
    // Saved, a device's identity beats a scan's; walked, the newer wins.
    const neverWalked: NetworkDeviceAssetSource = {
      ...afterScan,
      lastSnmpSeenAt: undefined,
    };

    expect(getStoredNetworkDeviceManufacturer(neverWalked)).toBe("Broadcom");
    expect(
      isNetworkDeviceManufacturerChangedByWalk(neverWalked, WALKED_BEFORE_SCAN),
    ).toBe(true);
    expect(
      isNetworkDeviceManufacturerChangedByWalk(neverWalked, WALKED_AFTER_SCAN),
    ).toBe(false);
  });

  test("a walk time that is not a time changes nothing", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        afterScan,
        new Date("not a date"),
      ),
    ).toBe(false);
  });

  test("reads the device's last walk as the API sends it, as text", () => {
    expect(
      isNetworkDeviceManufacturerChangedByWalk(
        {
          ...afterScan,
          lastSnmpSeenAt: WALKED_BEFORE_SCAN.toISOString(),
        },
        WALKED_AFTER_SCAN,
      ),
    ).toBe(true);
  });
});
