import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import {
  ControllerDeviceAddPlan,
  ControllerDeviceAddVerdict,
  ControllerIdentityHolder,
  ControllerIdentityLookup,
  ControllerSitePlan,
  MAX_ADDED_DEVICE_NAME_LENGTH,
  MAX_ADDED_SITE_ADDRESS_LENGTH,
  MAX_ADDED_SITE_NAME_LENGTH,
  buildNetworkDeviceFromController,
  countUnaddedControllerDevices,
  getControllerDeviceBaseName,
  getControllerDeviceNameChoices,
  getControllerDeviceRoleKey,
  getControllerIdentityLookup,
  getControllerSiteNames,
  judgeControllerDevices,
  planControllerDeviceAdd,
  planControllerDeviceNames,
  planControllerSites,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import {
  ControllerInventoryCandidate,
  ControllerInventoryConnection,
  ControllerInventoryMatch,
  matchControllerDevices,
} from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import { NetworkControllerDevice } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  NetworkControllerUnaddedDeviceCount,
} from "../../../../Types/NetworkController/NetworkControllerDeviceAdd";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveryReaderType,
  readNetworkDeviceDiscoveredDetails,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Which of a Meraki organization's devices Add devices adds, and as what
 * (NetworkControllerDeviceAdd).
 *
 * The verdicts are the safety of the feature: a device is added only when no
 * device here is it, none holds its serial number, MAC or address, and it
 * has an address to be polled at - so Add devices never makes two devices
 * of one box or of one address, never brings back a box someone archived,
 * and never makes a device with nothing to reach it at. These pin each
 * verdict and its order, the counts a read keeps, what an ask plans, the
 * names and sites the devices are added under, and the device each becomes.
 */

const CONNECTION: ControllerInventoryConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
  provider: NetworkControllerProvider.Meraki,
};

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const READ_AT: Date = new Date("2026-11-03T10:00:00.000Z");

function id(index: number): string {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function controllerDevice(
  overrides: Partial<NetworkControllerDevice> = {},
): NetworkControllerDevice {
  return {
    serial: "Q2HP-SWCH-0001",
    name: "Store 0660 core",
    model: "MS225-48LP",
    mac: "88:15:44:aa:00:01",
    lanIp: "10.66.0.2",
    firmware: "switch-16-7",
    productType: "switch",
    controllerNetworkId: "L_0660",
    networkName: "Store 0660",
    address: "1 Main Street, Springfield",
    ...overrides,
  };
}

const SWITCH: NetworkControllerDevice = controllerDevice();

const ACCESS_POINT: NetworkControllerDevice = controllerDevice({
  serial: "Q2KD-WLAN-0001",
  name: "Store 0660 lobby",
  model: "MR46",
  mac: "e0:55:3d:aa:00:01",
  lanIp: "10.66.0.20",
  firmware: "wireless-29-7",
  productType: "wireless",
});

const MX: NetworkControllerDevice = controllerDevice({
  serial: "Q2XX-AAAA-0000",
  name: "Store 0660 MX",
  model: "MX68",
  mac: "00:18:0a:00:00:01",
  lanIp: "",
  firmware: "wired-18-211",
  productType: "appliance",
});

const CAMERA: NetworkControllerDevice = controllerDevice({
  serial: "Q2GV-CAMR-0001",
  name: "Store 0660 till camera",
  model: "MV12W",
  mac: "34:56:fe:00:00:01",
  lanIp: "10.66.0.40",
  firmware: "camera-5-4",
  productType: "camera",
});

const SENSOR: NetworkControllerDevice = controllerDevice({
  serial: "Q3CA-SNSR-0001",
  name: "Store 0660 freezer",
  model: "MT10",
  mac: "e8:2d:00:00:00:01",
  lanIp: "",
  firmware: "sensor-1-0",
  productType: "sensor",
});

function judge(data: {
  devices: Array<NetworkControllerDevice>;
  candidates?: Array<ControllerInventoryCandidate> | undefined;
  holders?: Array<ControllerIdentityHolder> | undefined;
}): Map<string, ControllerDeviceAddVerdict> {
  const matches: Map<string, ControllerInventoryMatch> = matchControllerDevices(
    { devices: data.devices, candidates: data.candidates || [] },
  );

  return judgeControllerDevices({
    devices: data.devices,
    matches,
    holders: data.holders || [],
  });
}

describe("judgeControllerDevices: one verdict for each Meraki device", () => {
  test("a switch, an access point and a camera nobody added are addable", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH, ACCESS_POINT, CAMERA],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(
      ControllerDeviceAddVerdict.Addable,
    );
    expect(verdicts.get(ACCESS_POINT.serial)).toBe(
      ControllerDeviceAddVerdict.Addable,
    );
    expect(verdicts.get(CAMERA.serial)).toBe(
      ControllerDeviceAddVerdict.Addable,
    );
  });

  test("a sensor, a Systems Manager endpoint and a kind Meraki did not name are never offered", () => {
    const endpoint: NetworkControllerDevice = controllerDevice({
      serial: "Q2SM-LAPT-0001",
      productType: "systemsManager",
      lanIp: "10.66.0.99",
    });
    const unknownKind: NetworkControllerDevice = controllerDevice({
      serial: "Q2ZZ-ZZZZ-0001",
      productType: "",
      lanIp: "10.66.0.98",
    });

    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SENSOR, endpoint, unknownKind],
    });

    expect(verdicts.get(SENSOR.serial)).toBe(
      ControllerDeviceAddVerdict.NotOffered,
    );
    expect(verdicts.get(endpoint.serial)).toBe(
      ControllerDeviceAddVerdict.NotOffered,
    );
    expect(verdicts.get(unknownKind.serial)).toBe(
      ControllerDeviceAddVerdict.NotOffered,
    );
  });

  test("a device here that is the box, by its serial number or its MAC, is already here", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH, ACCESS_POINT],
      candidates: [
        { id: id(1), serialNumber: " q2hp-swch-0001 ", hostname: "10.1.1.1" },
        { id: id(2), macAddress: "E0-55-3D-AA-00-01", hostname: "10.1.1.2" },
      ],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(
      ControllerDeviceAddVerdict.AlreadyHere,
    );
    expect(verdicts.get(ACCESS_POINT.serial)).toBe(
      ControllerDeviceAddVerdict.AlreadyHere,
    );
  });

  test("an MX lists no LAN address: there is nothing to poll it at", () => {
    expect(judge({ devices: [MX] }).get(MX.serial)).toBe(
      ControllerDeviceAddVerdict.WithoutAddress,
    );
  });

  test("a box someone archived is never brought back, by its serial number or its MAC - with an address or not", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH, ACCESS_POINT, MX],
      holders: [
        { serialNumber: "Q2HP-SWCH-0001", isArchived: true },
        { macAddress: "E0:55:3D:AA:00:01", isArchived: true },
        { learnedMacAddress: "00:18:0a:00:00:01", isArchived: true },
      ],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(
      ControllerDeviceAddVerdict.Archived,
    );
    expect(verdicts.get(ACCESS_POINT.serial)).toBe(
      ControllerDeviceAddVerdict.Archived,
    );
    // Archived is said before "no address": it is the more useful answer.
    expect(verdicts.get(MX.serial)).toBe(ControllerDeviceAddVerdict.Archived);
  });

  test("an address another device here has is taken: never two devices of one address", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH],
      // Another branch's box, at the same private address, called something else.
      candidates: [
        { id: id(3), name: "Other store core", hostname: "10.66.0.2" },
      ],
      holders: [{ hostname: "10.66.0.2", serialNumber: "Q2HP-OTHR-0009" }],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(ControllerDeviceAddVerdict.Taken);
  });

  test("an archived device's address is taken too: it would be polled at it again once unarchived", () => {
    expect(
      judge({
        devices: [SWITCH],
        holders: [{ hostname: "10.66.0.2", isArchived: true }],
      }).get(SWITCH.serial),
    ).toBe(ControllerDeviceAddVerdict.Taken);
  });

  test("a MAC another live device holds, whose serial number says it is another box, is taken", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH],
      candidates: [
        {
          id: id(4),
          serialNumber: "FOC1234X0AB",
          macAddress: "88:15:44:aa:00:01",
          hostname: "10.9.9.9",
        },
      ],
      holders: [
        {
          serialNumber: "FOC1234X0AB",
          macAddress: "88:15:44:aa:00:01",
          hostname: "10.9.9.9",
        },
      ],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(ControllerDeviceAddVerdict.Taken);
  });

  test("a learned MAC counts as held, as a typed one does", () => {
    expect(
      judge({
        devices: [SWITCH],
        holders: [{ learnedMacAddress: "88:15:44:AA:00:01" }],
      }).get(SWITCH.serial),
    ).toBe(ControllerDeviceAddVerdict.Taken);
  });

  test("two Meraki devices at one address: the first is added, the second is taken", () => {
    const twin: NetworkControllerDevice = controllerDevice({
      serial: "Q2HP-SWCH-0002",
      name: "Store 0661 core",
      mac: "88:15:44:aa:00:02",
      lanIp: SWITCH.lanIp,
      controllerNetworkId: "L_0661",
      networkName: "Store 0661",
    });

    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH, twin],
    });

    expect(verdicts.get(SWITCH.serial)).toBe(
      ControllerDeviceAddVerdict.Addable,
    );
    expect(verdicts.get(twin.serial)).toBe(ControllerDeviceAddVerdict.Taken);
  });

  test("the holders' serial numbers are compared without case or padding", () => {
    expect(
      judge({
        devices: [SWITCH],
        holders: [{ serialNumber: "  q2hp-swch-0001\t", isArchived: true }],
      }).get(SWITCH.serial),
    ).toBe(ControllerDeviceAddVerdict.Archived);
  });

  test("a holder of nothing it is asked about leaves a device addable", () => {
    expect(
      judge({
        devices: [SWITCH],
        holders: [
          {
            serialNumber: "Q2HP-OTHR-0001",
            macAddress: "aa:bb:cc:00:00:01",
            hostname: "10.1.1.1",
          },
          {},
        ],
      }).get(SWITCH.serial),
    ).toBe(ControllerDeviceAddVerdict.Addable);
  });
});

describe("getControllerIdentityLookup: what the holders lookup is asked about", () => {
  test("the serial numbers in upper case, the MACs and the addresses of the kinds that can be added", () => {
    const lookup: ControllerIdentityLookup = getControllerIdentityLookup([
      controllerDevice({ serial: "q2hp-swch-0001" }),
      ACCESS_POINT,
      MX,
      SENSOR,
      ACCESS_POINT,
    ]);

    expect(lookup.serials).toEqual([
      "Q2HP-SWCH-0001",
      "Q2KD-WLAN-0001",
      "Q2XX-AAAA-0000",
    ]);
    expect(lookup.macs).toEqual([
      "88:15:44:aa:00:01",
      "e0:55:3d:aa:00:01",
      "00:18:0a:00:00:01",
    ]);
    expect(lookup.addresses).toEqual(["10.66.0.2", "10.66.0.20"]);
  });
});

describe("countUnaddedControllerDevices: what a read keeps on the connection", () => {
  test("by kind, in the order they are listed, the devices here and the kinds never offered left out", () => {
    const second: NetworkControllerDevice = controllerDevice({
      serial: "Q2HP-SWCH-0002",
      mac: "88:15:44:aa:00:02",
      lanIp: "10.66.0.3",
    });
    const devices: Array<NetworkControllerDevice> = [
      CAMERA,
      SENSOR,
      MX,
      SWITCH,
      second,
      ACCESS_POINT,
    ];
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices,
      candidates: [{ id: id(5), serialNumber: ACCESS_POINT.serial }],
      holders: [{ hostname: "10.66.0.3" }],
    });

    expect(countUnaddedControllerDevices({ devices, verdicts })).toEqual([
      {
        productType: "switch",
        addable: 1,
        withoutAddress: 0,
        taken: 1,
        archived: 0,
      },
      {
        productType: "appliance",
        addable: 0,
        withoutAddress: 1,
        taken: 0,
        archived: 0,
      },
      {
        productType: "camera",
        addable: 1,
        withoutAddress: 0,
        taken: 0,
        archived: 0,
      },
    ]);
  });

  test("an organization whose devices are all here counts nothing", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH],
      candidates: [{ id: id(6), serialNumber: SWITCH.serial }],
    });

    expect(
      countUnaddedControllerDevices({ devices: [SWITCH], verdicts }),
    ).toEqual([]);
  });

  test("a device listed twice is counted once", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> = judge({
      devices: [SWITCH],
    });

    expect(
      countUnaddedControllerDevices({
        devices: [SWITCH, SWITCH],
        verdicts,
      }),
    ).toEqual([
      {
        productType: "switch",
        addable: 1,
        withoutAddress: 0,
        taken: 0,
        archived: 0,
      },
    ]);
  });

  test("every kind it counts is one Add devices offers", () => {
    const devices: Array<NetworkControllerDevice> =
      ADDABLE_CONTROLLER_PRODUCT_TYPES.map(
        (productType: string, index: number): NetworkControllerDevice => {
          return controllerDevice({
            serial: `Q2ZZ-KIND-${String(index).padStart(4, "0")}`,
            mac: `aa:bb:cc:00:00:${String(10 + index).padStart(2, "0")}`,
            lanIp: `10.70.0.${index + 1}`,
            productType,
          });
        },
      );
    const counts: Array<NetworkControllerUnaddedDeviceCount> =
      countUnaddedControllerDevices({
        devices,
        verdicts: judge({ devices }),
      });

    expect(
      counts.map((count: NetworkControllerUnaddedDeviceCount): string => {
        return count.productType;
      }),
    ).toEqual([...ADDABLE_CONTROLLER_PRODUCT_TYPES]);
  });
});

describe("planControllerDeviceAdd: what one ask adds", () => {
  function devicesOfStores(count: number): Array<NetworkControllerDevice> {
    const devices: Array<NetworkControllerDevice> = [];

    for (let index: number = count; index >= 1; index--) {
      devices.push(
        controllerDevice({
          serial: `Q2HP-STOR-${String(index).padStart(4, "0")}`,
          name: `Core ${index}`,
          mac: `88:15:44:bb:00:${String(index).padStart(2, "0")}`,
          lanIp: `10.80.${index}.2`,
          networkName: `Store ${String(index).padStart(4, "0")}`,
        }),
      );
    }

    return devices;
  }

  test("the addable devices of the kinds asked for, by network then name, whatever order Meraki listed them in", () => {
    const devices: Array<NetworkControllerDevice> = [
      CAMERA,
      ...devicesOfStores(3),
      ACCESS_POINT,
    ];
    const plan: ControllerDeviceAddPlan = planControllerDeviceAdd({
      devices,
      verdicts: judge({ devices }),
      productTypes: ["switch", "wireless"],
      limit: 100,
    });

    expect(
      plan.toAdd.map((device: NetworkControllerDevice): string => {
        return `${device.networkName}/${device.name}`;
      }),
    ).toEqual([
      "Store 0001/Core 1",
      "Store 0002/Core 2",
      "Store 0003/Core 3",
      "Store 0660/Store 0660 lobby",
    ]);
    expect(plan.remainingCount).toBe(0);
  });

  test("past the limit, the rest are counted as left for another ask", () => {
    const devices: Array<NetworkControllerDevice> = devicesOfStores(5);
    const plan: ControllerDeviceAddPlan = planControllerDeviceAdd({
      devices,
      verdicts: judge({ devices }),
      productTypes: ["switch"],
      limit: 2,
    });

    expect(plan.toAdd).toHaveLength(2);
    expect(plan.remainingCount).toBe(3);
  });

  test("what keeps devices of the kinds asked for out is counted, and nothing of the kinds left out", () => {
    const devices: Array<NetworkControllerDevice> = [
      MX,
      SWITCH,
      ACCESS_POINT,
      CAMERA,
    ];
    const plan: ControllerDeviceAddPlan = planControllerDeviceAdd({
      devices,
      verdicts: judge({
        devices,
        holders: [
          { hostname: SWITCH.lanIp },
          { serialNumber: ACCESS_POINT.serial, isArchived: true },
          { hostname: CAMERA.lanIp },
        ],
      }),
      productTypes: ["switch", "wireless", "appliance"],
      limit: 100,
    });

    expect(plan.toAdd).toEqual([]);
    expect(plan.withoutAddressCount).toBe(1);
    expect(plan.takenCount).toBe(1);
    expect(plan.archivedCount).toBe(1);
  });

  test("a negative or fractional limit adds nothing it should not", () => {
    const devices: Array<NetworkControllerDevice> = devicesOfStores(2);

    expect(
      planControllerDeviceAdd({
        devices,
        verdicts: judge({ devices }),
        productTypes: ["switch"],
        limit: -1,
      }).toAdd,
    ).toEqual([]);
    expect(
      planControllerDeviceAdd({
        devices,
        verdicts: judge({ devices }),
        productTypes: ["switch"],
        limit: 1.9,
      }).toAdd,
    ).toHaveLength(1);
  });
});

describe("the names devices are added under", () => {
  test("what Meraki calls a device; a device nobody named is its model and serial number", () => {
    expect(getControllerDeviceBaseName(SWITCH)).toBe("Store 0660 core");
    expect(getControllerDeviceBaseName(controllerDevice({ name: "  " }))).toBe(
      "MS225-48LP Q2HP-SWCH-0001",
    );
    expect(
      getControllerDeviceBaseName(controllerDevice({ name: "", model: "" })),
    ).toBe("Q2HP-SWCH-0001");
  });

  test("a name past the column's width is cut to it", () => {
    expect(
      getControllerDeviceBaseName(controllerDevice({ name: "x".repeat(300) })),
    ).toHaveLength(MAX_ADDED_DEVICE_NAME_LENGTH);
  });

  test("the choices: the name, then with its network, then with its serial number", () => {
    expect(getControllerDeviceNameChoices(SWITCH)).toEqual([
      "Store 0660 core",
      "Store 0660 core (Store 0660)",
      "Store 0660 core (Q2HP-SWCH-0001)",
    ]);
    expect(
      getControllerDeviceNameChoices(controllerDevice({ networkName: "" })),
    ).toEqual(["Store 0660 core", "Store 0660 core (Q2HP-SWCH-0001)"]);
  });

  test("every choice fits the column, the suffix kept whole", () => {
    const long: NetworkControllerDevice = controllerDevice({
      name: "a".repeat(98),
      networkName: "b".repeat(40),
    });

    for (const choice of getControllerDeviceNameChoices(long)) {
      expect(choice.length).toBeLessThanOrEqual(MAX_ADDED_DEVICE_NAME_LENGTH);
    }

    expect(
      getControllerDeviceNameChoices(long)[2]!.endsWith("(Q2HP-SWCH-0001)"),
    ).toBe(true);
  });

  test("names repeat from store to store: a taken one takes its network, then its serial number", () => {
    const store1: NetworkControllerDevice = controllerDevice({
      serial: "Q2KD-APAP-0001",
      name: "AP-1",
      networkName: "Store 0001",
    });
    const store2: NetworkControllerDevice = controllerDevice({
      serial: "Q2KD-APAP-0002",
      name: "AP-1",
      networkName: "Store 0002",
    });
    const sameNetwork: NetworkControllerDevice = controllerDevice({
      serial: "Q2KD-APAP-0003",
      name: "AP-1",
      networkName: "Store 0002",
    });

    const names: Map<string, string> = planControllerDeviceNames({
      devices: [store1, store2, sameNetwork],
      // A device here already has the plain name, in another case.
      takenNames: new Set<string>(["ap-1"]),
    });

    expect(names.get(store1.serial)).toBe("AP-1 (Store 0001)");
    expect(names.get(store2.serial)).toBe("AP-1 (Store 0002)");
    expect(names.get(sameNetwork.serial)).toBe("AP-1 (Q2KD-APAP-0003)");
  });

  test("a name nobody has is kept as Meraki wrote it", () => {
    expect(
      planControllerDeviceNames({
        devices: [SWITCH],
        takenNames: new Set<string>(),
      }).get(SWITCH.serial),
    ).toBe("Store 0660 core");
  });

  test("the taken names given are not changed", () => {
    const taken: Set<string> = new Set<string>(["store 0660 core"]);

    planControllerDeviceNames({ devices: [SWITCH], takenNames: taken });

    expect(Array.from(taken)).toEqual(["store 0660 core"]);
  });
});

describe("planControllerSites: the site each device goes into", () => {
  test("the project's site of its network's name is used, without case; one it lacks is planned with Meraki's street address", () => {
    const other: NetworkControllerDevice = controllerDevice({
      serial: "Q2HP-SWCH-0101",
      networkName: "Store 0101",
      address: "",
    });
    const otherAp: NetworkControllerDevice = controllerDevice({
      serial: "Q2KD-WLAN-0101",
      networkName: "STORE 0101",
      address: "101 High Street",
    });

    const plan: ControllerSitePlan = planControllerSites({
      devices: [SWITCH, ACCESS_POINT, other, otherAp],
      existingSiteNames: new Set<string>(["store 0660"]),
    });

    expect(plan.sitesToCreate).toEqual([
      { name: "Store 0101", address: "101 High Street" },
    ]);
    expect(plan.siteNameBySerial.get(SWITCH.serial)).toBe("Store 0660");
    expect(plan.siteNameBySerial.get(ACCESS_POINT.serial)).toBe("Store 0660");
    // Two networks of one name share their site, under the first's name.
    expect(plan.siteNameBySerial.get(other.serial)).toBe("Store 0101");
    expect(plan.siteNameBySerial.get(otherAp.serial)).toBe("Store 0101");
  });

  test("a device of a network with no name gets no site", () => {
    const nameless: NetworkControllerDevice = controllerDevice({
      networkName: "  ",
    });
    const plan: ControllerSitePlan = planControllerSites({
      devices: [nameless],
      existingSiteNames: new Set<string>(),
    });

    expect(plan.sitesToCreate).toEqual([]);
    expect(plan.siteNameBySerial.has(nameless.serial)).toBe(false);
  });

  test("a site's name and address fit their columns", () => {
    const plan: ControllerSitePlan = planControllerSites({
      devices: [
        controllerDevice({
          networkName: "n".repeat(300),
          address: "a".repeat(300),
        }),
      ],
      existingSiteNames: new Set<string>(),
    });

    expect(plan.sitesToCreate[0]!.name).toHaveLength(
      MAX_ADDED_SITE_NAME_LENGTH,
    );
    expect(plan.sitesToCreate[0]!.address).toHaveLength(
      MAX_ADDED_SITE_ADDRESS_LENGTH,
    );
  });

  test("the names looked up are each network's once", () => {
    expect(
      getControllerSiteNames([
        SWITCH,
        ACCESS_POINT,
        MX,
        controllerDevice({ networkName: "" }),
      ]),
    ).toEqual(["Store 0660"]);
  });
});

describe("buildNetworkDeviceFromController: the device a Meraki device becomes", () => {
  test("its name, management address, serial number, MAC, role, site and probe, and Meraki's reading of it", () => {
    const roleId: ObjectID = new ObjectID(id(10));
    const siteId: ObjectID = new ObjectID(id(11));
    const probeId: ObjectID = new ObjectID(id(12));

    const device: NetworkDevice = buildNetworkDeviceFromController({
      projectId: PROJECT_ID,
      device: SWITCH,
      name: "Store 0660 core",
      connection: CONNECTION,
      readAt: READ_AT,
      roleId,
      siteId,
      probeId,
    });

    expect(device.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(device.name).toBe("Store 0660 core");
    expect(device.hostname).toBe("10.66.0.2");
    expect(device.serialNumber).toBe("Q2HP-SWCH-0001");
    expect(device.macAddress).toBe("88:15:44:aa:00:01");
    expect(device.networkDeviceRoleId?.toString()).toBe(roleId.toString());
    expect(device.siteId?.toString()).toBe(siteId.toString());
    expect(device.probeId?.toString()).toBe(probeId.toString());

    const reading: NetworkDeviceControllerReading | undefined =
      readNetworkDeviceDiscoveredDetails(device.discoveredDetails).controller;

    expect(reading?.provider).toBe(NetworkControllerProvider.Meraki);
    expect(reading?.readBy).toEqual({
      type: NetworkDeviceDiscoveryReaderType.NetworkController,
      id: CONNECTION.id,
      name: "Acme Retail",
    });
    expect(reading?.readAt).toBe(READ_AT.toISOString());
    expect(reading?.values.model).toBe("MS225-48LP");
    expect(reading?.values.firmwareVersion).toBe("switch-16-7");
    expect(reading?.values.networkName).toBe("Store 0660");
  });

  test("nothing it does not know: no MAC, role, site or probe; and nothing a poll writes", () => {
    const device: NetworkDevice = buildNetworkDeviceFromController({
      projectId: PROJECT_ID,
      device: controllerDevice({ mac: "" }),
      name: "Store 0660 core",
      connection: CONNECTION,
      readAt: READ_AT,
    });

    expect(device.macAddress).toBeUndefined();
    expect(device.networkDeviceRoleId).toBeUndefined();
    expect(device.siteId).toBeUndefined();
    expect(device.probeId).toBeUndefined();
    // Meraki's model and firmware stay in its reading: a poll wins over them.
    expect(device.deviceModel).toBeUndefined();
    expect(device.firmwareVersion).toBeUndefined();
    expect(device.vendor).toBeUndefined();
  });

  test("the role each kind is added with", () => {
    expect(getControllerDeviceRoleKey(SWITCH)).toBe("switch");
    expect(getControllerDeviceRoleKey(ACCESS_POINT)).toBe(
      "wirelessAccessPoint",
    );
    expect(getControllerDeviceRoleKey(MX)).toBe("firewall");
    expect(getControllerDeviceRoleKey(CAMERA)).toBe("camera");
    expect(
      getControllerDeviceRoleKey(
        controllerDevice({ productType: "cellularGateway" }),
      ),
    ).toBe("router");
    expect(getControllerDeviceRoleKey(SENSOR)).toBeUndefined();
  });
});
