import NetworkControllerDeviceMatcher, {
  NetworkControllerDeviceMatches,
  NetworkControllerMatchCandidate,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceMatcher";
import { buildNetworkDeviceFromController } from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import {
  NetworkControllerAppliance,
  NetworkControllerDevice,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import { afterEach, describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Which Meraki appliances are devices in OneUptime: by serial number (as
 * Meraki prints it, or as an SNMP walk stored it, or as a person linked it),
 * by MAC address, or - issue #5762 - by Meraki's own record of the device,
 * when the connection's Inventory matched one to it (an MX tied by its name
 * and a MAC of its block). All exact, never a name two devices can share or
 * an address a NAT shares. A network's applications and clients go to its
 * first matched appliance. Nothing is written to the devices.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const DEVICE_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const DEVICE_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const DEVICE_C: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

function appliance(
  serial: string,
  networkId: string,
  mac: string = "",
  name: string = "MX",
): NetworkControllerAppliance {
  return { serial, name, model: "MX68", mac, controllerNetworkId: networkId };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("matching appliances to devices", () => {
  test("by serial, whatever case the device keeps it in, and by MAC", async () => {
    const asked: Array<{ serials: Array<string>; macs: Array<string> }> = [];

    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [
          appliance("Q2XX-AAAA-0001", "L_1", "00:18:0a:00:00:01"),
          appliance("Q2XX-AAAA-0002", "L_2", "00:18:0a:00:00:02"),
          appliance("Q2XX-AAAA-0003", "L_3", "00:18:0a:00:00:03"),
        ],
        findDevices: async (data: {
          projectId: ObjectID;
          serials: Array<string>;
          macs: Array<string>;
        }) => {
          asked.push({ serials: data.serials, macs: data.macs });
          return [
            { id: DEVICE_A, serialNumber: "q2xx-aaaa-0001 ", macAddress: "" },
            { id: DEVICE_B, serialNumber: "", macAddress: "00:18:0A:00:00:02" },
          ];
        },
      });

    expect(asked[0]!.serials).toEqual([
      "Q2XX-AAAA-0001",
      "q2xx-aaaa-0001",
      "Q2XX-AAAA-0002",
      "q2xx-aaaa-0002",
      "Q2XX-AAAA-0003",
      "q2xx-aaaa-0003",
    ]);
    expect(asked[0]!.macs).toEqual([
      "00:18:0a:00:00:01",
      "00:18:0a:00:00:02",
      "00:18:0a:00:00:03",
    ]);
    expect(Array.from(matches.bySerial.entries())).toEqual([
      ["Q2XX-AAAA-0001", DEVICE_A],
      ["Q2XX-AAAA-0002", DEVICE_B],
    ]);
    expect(matches.byNetwork.get("L_1")).toBe(DEVICE_A);
    expect(matches.byNetwork.get("L_2")).toBe(DEVICE_B);
    expect(matches.byNetwork.has("L_3")).toBe(false);
  });

  test("a network of two appliances goes to the first matched one, by serial", async () => {
    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [
          appliance("Q2XX-BBBB-0002", "L_1"),
          appliance("Q2XX-BBBB-0001", "L_1"),
        ],
        findDevices: async () => {
          return [
            { id: DEVICE_B, serialNumber: "Q2XX-BBBB-0002", macAddress: "" },
            { id: DEVICE_A, serialNumber: "Q2XX-BBBB-0001", macAddress: "" },
          ];
        },
      });

    expect(matches.byNetwork.get("L_1")).toBe(DEVICE_A);
    expect(matches.bySerial.size).toBe(2);
  });

  test("two devices with one serial: the first found keeps it", async () => {
    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [appliance("Q2XX-CCCC-0001", "L_1")],
        findDevices: async () => {
          return [
            { id: DEVICE_C, serialNumber: "Q2XX-CCCC-0001", macAddress: "" },
            { id: DEVICE_A, serialNumber: "Q2XX-CCCC-0001", macAddress: "" },
          ];
        },
      });

    expect(matches.bySerial.get("Q2XX-CCCC-0001")).toBe(DEVICE_C);
  });

  test("a name is never a match", async () => {
    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [appliance("Q2XX-DDDD-0001", "L_1", "", "core-router")],
        findDevices: async () => {
          return [];
        },
      });

    expect(matches.bySerial.size).toBe(0);
    expect(matches.byNetwork.size).toBe(0);
  });

  test("no appliances: nothing is looked up", async () => {
    let looked: boolean = false;

    await NetworkControllerDeviceMatcher.match({
      projectId: PROJECT,
      appliances: [],
      findDevices: async () => {
        looked = true;
        return [];
      },
    });

    expect(looked).toBe(false);
  });
});

describe("looking devices up", () => {
  function device(id: ObjectID, serial: string, mac: string): NetworkDevice {
    const value: NetworkDevice = new NetworkDevice();
    value.id = id;
    value.serialNumber = serial;
    value.macAddress = mac;
    return value;
  }

  test("by serial and by MAC, in the project, as root, selecting the keys alone", async () => {
    const findBy: jest.SpiedFunction<typeof NetworkDeviceService.findBy> = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValueOnce([device(DEVICE_A, "Q2XX-AAAA-0001", "")])
      .mockResolvedValueOnce([device(DEVICE_B, "", "00:18:0a:00:00:02")]);
    jest
      .spyOn(NetworkDeviceService, "findByControllerSerials")
      .mockResolvedValue([]);

    const found: Array<{
      id: ObjectID;
      serialNumber: string;
      macAddress: string;
    }> = await NetworkControllerDeviceMatcher.findDevices({
      projectId: PROJECT,
      serials: ["Q2XX-AAAA-0001"],
      macs: ["00:18:0a:00:00:02"],
    });

    expect(found).toEqual([
      { id: DEVICE_A, serialNumber: "Q2XX-AAAA-0001", macAddress: "" },
      { id: DEVICE_B, serialNumber: "", macAddress: "00:18:0a:00:00:02" },
    ]);
    expect(findBy).toHaveBeenCalledTimes(2);

    const first: { query: JSONObject; select: JSONObject; props: JSONObject } =
      findBy.mock.calls[0]![0] as never;
    expect(first.query["projectId"]).toBe(PROJECT);
    expect(Object.keys(first.query).sort()).toEqual([
      "projectId",
      "serialNumber",
    ]);
    expect(first.select).toEqual({
      _id: true,
      serialNumber: true,
      macAddress: true,
    });
    expect(first.props).toEqual({ isRoot: true });

    const second: { query: JSONObject } = findBy.mock.calls[1]![0] as never;
    expect(Object.keys(second.query).sort()).toEqual([
      "macAddress",
      "projectId",
    ]);
  });

  test("no MACs: one lookup, by serial", async () => {
    const findBy: jest.SpiedFunction<typeof NetworkDeviceService.findBy> = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([]);
    jest
      .spyOn(NetworkDeviceService, "findByControllerSerials")
      .mockResolvedValue([]);

    await NetworkControllerDeviceMatcher.findDevices({
      projectId: PROJECT,
      serials: ["Q2XX-AAAA-0001"],
      macs: [],
    });

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("and the devices whose Meraki record names one of the serials, in the project", async () => {
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    const described: jest.SpiedFunction<
      typeof NetworkDeviceService.findByControllerSerials
    > = jest
      .spyOn(NetworkDeviceService, "findByControllerSerials")
      .mockResolvedValue([
        { id: DEVICE_C, controllerSerial: "Q2XX-EEEE-0001" },
      ]);

    const found: Array<NetworkControllerMatchCandidate> =
      await NetworkControllerDeviceMatcher.findDevices({
        projectId: PROJECT,
        serials: ["Q2XX-EEEE-0001", "q2xx-eeee-0001"],
        macs: [],
      });

    expect(found).toEqual([
      {
        id: DEVICE_C,
        serialNumber: "",
        macAddress: "",
        controllerSerial: "Q2XX-EEEE-0001",
      },
    ]);

    const asked: { projectId: ObjectID; serials: Array<string> } = described
      .mock.calls[0]![0] as never;
    expect(asked.projectId).toBe(PROJECT);
    expect(asked.serials).toEqual(["Q2XX-EEEE-0001", "q2xx-eeee-0001"]);
  });

  test("no serials: no Meraki record is looked for", async () => {
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
    const described: jest.SpiedFunction<
      typeof NetworkDeviceService.findByControllerSerials
    > = jest
      .spyOn(NetworkDeviceService, "findByControllerSerials")
      .mockResolvedValue([]);

    await NetworkControllerDeviceMatcher.findDevices({
      projectId: PROJECT,
      serials: [],
      macs: ["00:18:0a:00:00:02"],
    });

    expect(described).not.toHaveBeenCalled();
  });
});

describe("a device Meraki's record was matched to (issue #5762)", () => {
  test("an MX Inventory tied by its name and MAC block gets its traffic: the bug this fixes", async () => {
    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [appliance("Q2XX-EEEE-0001", "L_5", "00:18:0a:00:00:05")],
        findDevices: async () => {
          // Neither its serial nor its MAC: only Meraki's record says it is.
          return [
            {
              id: DEVICE_C,
              serialNumber: "",
              macAddress: "",
              controllerSerial: "q2xx-eeee-0001",
            },
          ];
        },
      });

    expect(matches.bySerial.get("Q2XX-EEEE-0001")).toBe(DEVICE_C);
    expect(matches.byNetwork.get("L_5")).toBe(DEVICE_C);
  });

  test("its own serial number beats its MAC, which beats Meraki's record", async () => {
    const candidates: Array<NetworkControllerMatchCandidate> = [
      {
        id: DEVICE_A,
        serialNumber: "",
        macAddress: "",
        controllerSerial: "Q2XX-FFFF-0001",
      },
      { id: DEVICE_B, serialNumber: "", macAddress: "00:18:0a:00:00:06" },
      { id: DEVICE_C, serialNumber: "Q2XX-FFFF-0001", macAddress: "" },
    ];

    const matchWith: (
      found: Array<NetworkControllerMatchCandidate>,
    ) => Promise<ObjectID | undefined> = async (
      found: Array<NetworkControllerMatchCandidate>,
    ): Promise<ObjectID | undefined> => {
      return (
        await NetworkControllerDeviceMatcher.match({
          projectId: PROJECT,
          appliances: [appliance("Q2XX-FFFF-0001", "L_6", "00:18:0a:00:00:06")],
          findDevices: async () => {
            return found;
          },
        })
      ).bySerial.get("Q2XX-FFFF-0001");
    };

    expect(await matchWith(candidates)).toBe(DEVICE_C);
    expect(await matchWith(candidates.slice(0, 2))).toBe(DEVICE_B);
    expect(await matchWith(candidates.slice(0, 1))).toBe(DEVICE_A);
  });

  test("a device Add Meraki devices made is matched with no link at all", async () => {
    const controllerDevice: NetworkControllerDevice = {
      serial: "Q2XX-GGGG-0001",
      name: "Z3 teleworker",
      model: "Z3",
      mac: "00:18:0a:00:00:07",
      lanIp: "10.70.0.1",
      firmware: "MX 18.211",
      productType: "appliance",
      controllerNetworkId: "L_7",
      networkName: "Home office",
      address: "",
    };
    const added: NetworkDevice = buildNetworkDeviceFromController({
      projectId: PROJECT,
      device: controllerDevice,
      name: "Z3 teleworker",
      connection: {
        id: "20000000-0000-4000-8000-000000000001",
        name: "Acme Networks",
        provider: NetworkControllerProvider.Meraki,
      },
      readAt: new Date("2026-10-24T12:00:00.000Z"),
    });
    added.id = DEVICE_A;

    const matches: NetworkControllerDeviceMatches =
      await NetworkControllerDeviceMatcher.match({
        projectId: PROJECT,
        appliances: [
          appliance(
            controllerDevice.serial,
            controllerDevice.controllerNetworkId,
            controllerDevice.mac,
          ),
        ],
        findDevices: async (data: {
          projectId: ObjectID;
          serials: Array<string>;
          macs: Array<string>;
        }) => {
          // As the lookups would find it: by the serial number it was made with.
          return data.serials.includes(added.serialNumber || "")
            ? [
                {
                  id: added.id!,
                  serialNumber: added.serialNumber || "",
                  macAddress: added.macAddress || "",
                },
              ]
            : [];
        },
      });

    expect(matches.bySerial.get("Q2XX-GGGG-0001")?.toString()).toBe(
      DEVICE_A.toString(),
    );
  });
});
