import NetworkControllerDeviceMatcher, {
  NetworkControllerDeviceMatches,
} from "../../../../Server/Utils/NetworkController/NetworkControllerDeviceMatcher";
import { NetworkControllerAppliance } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { afterEach, describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Which Meraki appliances are devices in OneUptime: by serial number (as
 * Meraki prints it, or as an SNMP walk stored it) or by MAC address -
 * both exact, never a name two devices can share or an address a NAT
 * shares. A network's applications and clients go to its first matched
 * appliance. Nothing is written to the devices.
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

    await NetworkControllerDeviceMatcher.findDevices({
      projectId: PROJECT,
      serials: ["Q2XX-AAAA-0001"],
      macs: [],
    });

    expect(findBy).toHaveBeenCalledTimes(1);
  });
});
