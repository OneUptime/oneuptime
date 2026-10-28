import { describe, expect, test } from "@jest/globals";
import { DiscoveredDetailsMerge } from "../../../../Server/Services/NetworkDeviceService";
import NetworkControllerInventory, {
  ControllerInventoryCandidate,
  ControllerInventoryConnection,
  ControllerInventoryLookup,
  ControllerInventoryMatch,
  ControllerInventoryOutcome,
  ControllerInventoryPlan,
  ControllerMatchRule,
  MAX_INVENTORY_CANDIDATES,
  UNCHANGED_READING_REFRESH_MS,
  buildReadingOf,
  getControllerInventoryLookup,
  matchControllerDevices,
  planControllerInventory,
} from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import { NetworkControllerDevice } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveryReaderType,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Which of a project's devices a Meraki organization's device list
 * describes, and what each records (NetworkControllerInventory).
 *
 * The rules are the whole safety of the feature: a device takes what Meraki
 * says about a box only when it IS that box - its serial number, else one of
 * its MACs, else its address AND its name, the address held once on both
 * sides. These pin each rule, each refusal, and when a reading is written,
 * kept or taken away.
 */

const CONNECTION: ControllerInventoryConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
  provider: NetworkControllerProvider.Meraki,
};

const OTHER_CONNECTION_ID: string = "55555555-5555-4555-8555-555555555555";
const READ_AT: Date = new Date("2026-10-28T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function id(index: number): string {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function controllerDevice(
  overrides: Partial<NetworkControllerDevice> = {},
): NetworkControllerDevice {
  return {
    serial: "Q2HP-SWCH-0001",
    name: "Branch 1 core",
    model: "MS225-48LP",
    mac: "88:15:44:aa:00:01",
    lanIp: "10.0.0.2",
    firmware: "switch-16-7",
    productType: "switch",
    controllerNetworkId: "L_1000",
    networkName: "Branch 1",
    address: "1 Main Street, Springfield",
    ...overrides,
  };
}

const MX: NetworkControllerDevice = controllerDevice({
  serial: "Q2XX-AAAA-0000",
  name: "Branch 1 MX",
  model: "MX68",
  mac: "00:18:0a:00:00:01",
  lanIp: "",
  firmware: "wired-18-211",
  productType: "appliance",
});

const SWITCH: NetworkControllerDevice = controllerDevice();

const ACCESS_POINT: NetworkControllerDevice = controllerDevice({
  serial: "Q2KD-WLAN-0001",
  name: "Branch 1 lobby AP",
  model: "MR46",
  mac: "e0:55:3d:aa:00:01",
  lanIp: "10.0.0.20",
  firmware: "wireless-29-7",
  productType: "wireless",
});

const LIST: Array<NetworkControllerDevice> = [MX, SWITCH, ACCESS_POINT];

function match(
  candidates: Array<ControllerInventoryCandidate>,
  devices: Array<NetworkControllerDevice> = LIST,
): Map<string, ControllerInventoryMatch> {
  return matchControllerDevices({ devices, candidates });
}

function ruleOf(
  matches: Map<string, ControllerInventoryMatch>,
  deviceId: string,
): string | undefined {
  const found: ControllerInventoryMatch | undefined = matches.get(deviceId);

  return found ? `${found.rule}:${found.device.serial}` : undefined;
}

function storedReading(
  device: NetworkControllerDevice,
  readAt: Date,
  connection: ControllerInventoryConnection = CONNECTION,
): NetworkDeviceControllerReading {
  return buildReadingOf({ connection, device, readAt })!;
}

describe("what the database is asked for", () => {
  test("every serial number, MAC and management address of the list, each once", () => {
    const lookup: ControllerInventoryLookup = getControllerInventoryLookup([
      ...LIST,
      controllerDevice({ serial: "q2hp-swch-0001" }),
    ]);

    expect(lookup).toEqual({
      serials: ["Q2XX-AAAA-0000", "Q2HP-SWCH-0001", "Q2KD-WLAN-0001"],
      macs: ["00:18:0a:00:00:01", "88:15:44:aa:00:01", "e0:55:3d:aa:00:01"],
      addresses: ["10.0.0.2", "10.0.0.20"],
    });
    expect(MAX_INVENTORY_CANDIDATES).toBe(50000);
  });
});

describe("1. its serial number", () => {
  test("a device whose serial number is a Meraki device's is that device, typed in any case", () => {
    const matches: Map<string, ControllerInventoryMatch> = match([
      { id: id(1), serialNumber: " q2xx-aaaa-0000 " },
    ]);

    expect(ruleOf(matches, id(1))).toBe("serialNumber:Q2XX-AAAA-0000");
  });

  test("its serial number wins over a MAC or an address that point elsewhere", () => {
    const matches: Map<string, ControllerInventoryMatch> = match([
      {
        id: id(1),
        serialNumber: "Q2XX-AAAA-0000",
        macAddress: SWITCH.mac,
        hostname: SWITCH.lanIp,
        name: SWITCH.name,
      },
    ]);

    expect(ruleOf(matches, id(1))).toBe("serialNumber:Q2XX-AAAA-0000");
  });
});

describe("2. one of its MAC addresses", () => {
  test("a typed MAC, in any spelling", () => {
    expect(
      ruleOf(match([{ id: id(1), macAddress: "88-15-44-AA-00-01" }]), id(1)),
    ).toBe("macAddress:Q2HP-SWCH-0001");
  });

  test("a MAC a router's ARP table taught", () => {
    expect(
      ruleOf(
        match([
          {
            id: id(1),
            discoveredDetails: {
              macAddress: {
                value: "e0:55:3d:aa:00:01",
                method: "arpTable",
                readBy: {
                  type: "networkDevice",
                  id: id(99),
                  name: "core-rtr-01",
                },
                readAt: "2026-10-28T09:00:00.000Z",
              },
            },
          },
        ]),
        id(1),
      ),
    ).toBe("macAddress:Q2KD-WLAN-0001");
  });

  test("not when its serial number says it is another box", () => {
    expect(
      match([
        {
          id: id(1),
          macAddress: SWITCH.mac,
          serialNumber: "FOC1840X0AB",
        },
      ]).size,
    ).toBe(0);
  });
});

describe("3. its address and its name, the address held once on both sides", () => {
  test("pinged at a switch's management address, and called what Meraki calls it", () => {
    expect(
      ruleOf(
        match([{ id: id(1), hostname: "10.0.0.2", name: "branch 1 CORE" }]),
        id(1),
      ),
    ).toBe("addressAndName:Q2HP-SWCH-0001");
  });

  test("the name may be the system name it reports, or the one a scan read", () => {
    expect(
      ruleOf(
        match([
          {
            id: id(1),
            hostname: "10.0.0.2",
            name: "10.0.0.2",
            sysName: "Branch 1 core",
          },
        ]),
        id(1),
      ),
    ).toBe("addressAndName:Q2HP-SWCH-0001");
    expect(
      ruleOf(
        match([
          {
            id: id(1),
            hostname: "10.0.0.20",
            name: "10.0.0.20",
            discoveredDetails: {
              sysName: {
                value: "Branch 1 lobby AP",
                method: "snmp",
                readBy: {
                  type: "discoveryScan",
                  id: id(98),
                  name: "Branch subnets",
                },
                readAt: "2026-10-28T08:00:00.000Z",
              },
            },
          },
        ]),
        id(1),
      ),
    ).toBe("addressAndName:Q2KD-WLAN-0001");
  });

  test("an address alone is never enough", () => {
    expect(match([{ id: id(1), hostname: "10.0.0.2", name: "printer-3" }]).size)
      .toBe(0);
    expect(match([{ id: id(1), hostname: "10.0.0.2" }]).size).toBe(0);
  });

  test("an address two Meraki devices list matches nothing: a private range repeats from branch to branch", () => {
    const twice: Array<NetworkControllerDevice> = [
      SWITCH,
      controllerDevice({
        serial: "Q2HP-SWCH-0002",
        name: "Branch 1 core",
        mac: "88:15:44:aa:00:02",
        controllerNetworkId: "L_1001",
        networkName: "Branch 2",
      }),
    ];

    expect(
      match([{ id: id(1), hostname: "10.0.0.2", name: "Branch 1 core" }], twice)
        .size,
    ).toBe(0);
  });

  test("an address two devices here are polled at matches neither", () => {
    expect(
      match([
        { id: id(1), hostname: "10.0.0.2", name: "Branch 1 core" },
        { id: id(2), hostname: "10.0.0.2", name: "Branch 1 core" },
      ]).size,
    ).toBe(0);
  });

  test("not when its serial number or MAC says it is another box", () => {
    expect(
      match([
        {
          id: id(1),
          hostname: "10.0.0.2",
          name: "Branch 1 core",
          serialNumber: "FOC1840X0AB",
        },
      ]).size,
    ).toBe(0);
    expect(
      match([
        {
          id: id(1),
          hostname: "10.0.0.2",
          name: "Branch 1 core",
          macAddress: "00:11:22:33:44:55",
        },
      ]).size,
    ).toBe(0);
  });

  test("a DNS name is not an address: nothing to match by", () => {
    expect(
      match([
        { id: id(1), hostname: "core.branch1.example", name: "Branch 1 core" },
      ]).size,
    ).toBe(0);
  });

  test("an appliance with no LAN address in the list is matched by nothing else", () => {
    expect(
      match([{ id: id(1), hostname: "10.0.0.1", name: "Branch 1 MX" }]).size,
    ).toBe(0);
  });
});

describe("what is left alone", () => {
  test("an archived device, a duplicated id and a candidate with no id", () => {
    expect(
      match([
        { id: id(1), serialNumber: SWITCH.serial, isArchived: true },
        { id: "", serialNumber: MX.serial },
      ]).size,
    ).toBe(0);

    const matches: Map<string, ControllerInventoryMatch> = match([
      { id: id(1), serialNumber: SWITCH.serial },
      { id: id(1), serialNumber: MX.serial },
    ]);
    expect(ruleOf(matches, id(1))).toBe("serialNumber:Q2HP-SWCH-0001");
  });

  test("two device records of one box each take its reading", () => {
    const matches: Map<string, ControllerInventoryMatch> = match([
      { id: id(1), serialNumber: SWITCH.serial, hostname: "10.0.0.2" },
      { id: id(2), serialNumber: SWITCH.serial, hostname: "10.9.0.2" },
    ]);

    expect(ruleOf(matches, id(1))).toBe("serialNumber:Q2HP-SWCH-0001");
    expect(ruleOf(matches, id(2))).toBe("serialNumber:Q2HP-SWCH-0001");
  });
});

describe("what a read records", () => {
  function plan(
    candidates: Array<ControllerInventoryCandidate>,
    options: { isDeviceListComplete?: boolean; readAt?: Date } = {},
  ): ControllerInventoryPlan {
    return planControllerInventory({
      connection: CONNECTION,
      readAt: options.readAt || READ_AT,
      devices: LIST,
      isDeviceListComplete: options.isDeviceListComplete !== false,
      candidates,
    });
  }

  test("a reading for every matched device, read by the connection, at the read's time", () => {
    const result: ControllerInventoryPlan = plan([
      { id: id(1), serialNumber: MX.serial },
      { id: id(2), hostname: "10.0.0.2", name: "Branch 1 core" },
      { id: id(3), hostname: "10.0.0.77", name: "printer" },
    ]);

    expect(result.describedDeviceCount).toBe(2);
    expect(result.patches).toEqual([
      { deviceId: id(1), set: { controller: storedReading(MX, READ_AT) } },
      { deviceId: id(2), set: { controller: storedReading(SWITCH, READ_AT) } },
    ]);
    expect(storedReading(SWITCH, READ_AT)).toEqual({
      provider: "meraki",
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.NetworkController,
        id: CONNECTION.id,
        name: "Acme Retail",
      },
      readAt: READ_AT.toISOString(),
      values: {
        name: "Branch 1 core",
        model: "MS225-48LP",
        serialNumber: "Q2HP-SWCH-0001",
        macAddress: "88:15:44:aa:00:01",
        ipAddress: "10.0.0.2",
        firmwareVersion: "switch-16-7",
        productType: "switch",
        networkName: "Branch 1",
        address: "1 Main Street, Springfield",
      },
    });
  });

  test("the same reading, read less than an hour ago, is not written again", () => {
    const candidate: ControllerInventoryCandidate = {
      id: id(2),
      hostname: "10.0.0.2",
      name: "Branch 1 core",
      discoveredDetails: {
        controller: storedReading(SWITCH, new Date(READ_AT.getTime() - 59 * MINUTE)),
      },
    };

    expect(plan([candidate]).patches).toEqual([]);
    // It still counts as described.
    expect(plan([candidate]).describedDeviceCount).toBe(1);

    // An hour old: written again, so "read 4 minutes ago" stays true.
    candidate.discoveredDetails = {
      controller: storedReading(
        SWITCH,
        new Date(READ_AT.getTime() - UNCHANGED_READING_REFRESH_MS),
      ),
    };
    expect(plan([candidate]).patches).toHaveLength(1);
  });

  test("a changed reading is written at once", () => {
    const candidate: ControllerInventoryCandidate = {
      id: id(2),
      hostname: "10.0.0.2",
      name: "Branch 1 core",
      discoveredDetails: {
        controller: storedReading(
          controllerDevice({ firmware: "switch-15-21" }),
          new Date(READ_AT.getTime() - 5 * MINUTE),
        ),
      },
    };

    expect(plan([candidate]).patches).toEqual([
      { deviceId: id(2), set: { controller: storedReading(SWITCH, READ_AT) } },
    ]);
  });

  test("a device someone asked to read again since its reading is written at once", () => {
    const candidate: ControllerInventoryCandidate = {
      id: id(2),
      hostname: "10.0.0.2",
      name: "Branch 1 core",
      refreshRequestedAt: new Date(READ_AT.getTime() - 2 * MINUTE),
      discoveredDetails: {
        controller: storedReading(SWITCH, new Date(READ_AT.getTime() - 5 * MINUTE)),
      },
    };

    expect(plan([candidate]).patches).toHaveLength(1);

    // Asked before its reading: that reading answered it.
    candidate.refreshRequestedAt = new Date(READ_AT.getTime() - 6 * MINUTE);
    expect(plan([candidate]).patches).toEqual([]);
  });

  test("another connection's reading is replaced by this one's", () => {
    const candidate: ControllerInventoryCandidate = {
      id: id(2),
      hostname: "10.0.0.2",
      name: "Branch 1 core",
      discoveredDetails: {
        controller: storedReading(SWITCH, new Date(READ_AT.getTime() - MINUTE), {
          ...CONNECTION,
          id: OTHER_CONNECTION_ID,
        }),
      },
    };

    expect(plan([candidate]).patches).toHaveLength(1);
  });

  test("a device this connection no longer describes loses its reading - after a read of the whole list only", () => {
    const candidate: ControllerInventoryCandidate = {
      id: id(4),
      hostname: "10.0.0.99",
      name: "moved-switch",
      discoveredDetails: {
        controller: storedReading(SWITCH, new Date(READ_AT.getTime() - MINUTE)),
      },
    };

    expect(plan([candidate]).patches).toEqual([
      { deviceId: id(4), unset: ["controller"] },
    ]);
    expect(plan([candidate], { isDeviceListComplete: false }).patches).toEqual(
      [],
    );
  });

  test("another connection's reading is never taken away by this one", () => {
    expect(
      plan([
        {
          id: id(4),
          hostname: "10.0.0.99",
          name: "moved-switch",
          discoveredDetails: {
            controller: storedReading(SWITCH, READ_AT, {
              ...CONNECTION,
              id: OTHER_CONNECTION_ID,
            }),
          },
        },
      ]).patches,
    ).toEqual([]);
  });

  test("an archived device and an id that is not one are left alone", () => {
    expect(
      plan([
        { id: id(1), serialNumber: MX.serial, isArchived: true },
        { id: "not-a-uuid", serialNumber: MX.serial },
      ]).patches,
    ).toEqual([]);
  });
});

describe("one read, end to end", () => {
  test("asks for the candidates once, merges the patches once, and says what it did", async () => {
    const asked: Array<{
      lookup: ControllerInventoryLookup;
      connectionId: string;
      limit: number;
    }> = [];
    const sent: Array<Array<DiscoveredDetailsMerge>> = [];

    const outcome: ControllerInventoryOutcome =
      await NetworkControllerInventory.record({
        projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
        connection: CONNECTION,
        readAt: READ_AT,
        devices: LIST,
        isDeviceListComplete: true,
        findCandidates: async (data: {
          connectionId: ObjectID;
          lookup: ControllerInventoryLookup;
          limit: number;
        }): Promise<Array<ControllerInventoryCandidate>> => {
          asked.push({
            lookup: data.lookup,
            connectionId: data.connectionId.toString(),
            limit: data.limit,
          });
          return [{ id: id(1), serialNumber: MX.serial }];
        },
        merge: async (data: {
          patches: Array<DiscoveredDetailsMerge>;
        }): Promise<number> => {
          sent.push(data.patches);
          return data.patches.length;
        },
      });

    expect(asked).toEqual([
      {
        lookup: getControllerInventoryLookup(LIST),
        connectionId: CONNECTION.id,
        limit: MAX_INVENTORY_CANDIDATES,
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(outcome).toEqual({
      deviceCount: 3,
      describedDeviceCount: 1,
      writtenDeviceCount: 1,
    });
  });

  test("nothing to write: no merge is sent", async () => {
    let merges: number = 0;

    const outcome: ControllerInventoryOutcome =
      await NetworkControllerInventory.record({
        projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
        connection: CONNECTION,
        readAt: READ_AT,
        devices: LIST,
        isDeviceListComplete: true,
        findCandidates: async () => {
          return [];
        },
        merge: async () => {
          merges++;
          return 0;
        },
      });

    expect(merges).toBe(0);
    expect(outcome).toEqual({
      deviceCount: 3,
      describedDeviceCount: 0,
      writtenDeviceCount: 0,
    });
  });

  test("the matched rule is kept for each device", () => {
    const matches: Map<string, ControllerInventoryMatch> = match([
      { id: id(1), serialNumber: MX.serial },
      { id: id(2), macAddress: ACCESS_POINT.mac },
      { id: id(3), hostname: "10.0.0.2", name: "Branch 1 core" },
    ]);

    expect(
      Array.from(matches.entries()).map(
        ([deviceId, found]: [string, ControllerInventoryMatch]): [
          string,
          ControllerMatchRule,
        ] => {
          return [deviceId, found.rule];
        },
      ),
    ).toEqual([
      [id(1), ControllerMatchRule.SerialNumber],
      [id(2), ControllerMatchRule.MacAddress],
      [id(3), ControllerMatchRule.AddressAndName],
    ]);
  });
});
