import { describe, expect, test } from "@jest/globals";
import {
  getMerakiAppliances,
  readMerakiDevices,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiDeviceList";
import { NetworkControllerDevice } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * The organization's device list, as a read keeps it (MerakiDeviceList):
 * Meraki's answer is outside text, so every value is cleaned, every address
 * must be an address, every product type one Meraki names, and a device is
 * known by its serial number.
 */

const NETWORKS: Map<string, string> = new Map([
  ["L_1000", "Branch 1"],
  ["L_1001", "Branch 2"],
]);

// GET organizations/{id}/devices, as Meraki answers it.
const ANSWER: Array<unknown> = [
  {
    name: "Branch 1 MX",
    lat: 37.418,
    lng: -122.098,
    address: "",
    notes: "",
    tags: [],
    networkId: "L_1000",
    serial: "Q2XX-AAAA-0000",
    model: "MX68",
    mac: "00:18:0a:00:00:01",
    lanIp: null,
    firmware: "wired-18-211",
    productType: "appliance",
  },
  {
    name: "Branch 1 core",
    address: "1 Main Street\nSpringfield",
    networkId: "L_1000",
    serial: "q2hp-swch-0001",
    model: "MS225-48LP",
    mac: "88-15-44-AA-00-01",
    lanIp: "10.0.0.2",
    firmware: "switch-16-7",
    productType: "switch",
  },
  {
    name: "Lobby AP",
    networkId: "L_1001",
    serial: "Q2KD-WLAN-0001",
    model: "MR46",
    mac: "e0:55:3d:aa:00:01",
    lanIp: "fe80::1",
    firmware: "wireless-29-7",
    productType: "wireless",
  },
];

describe("readMerakiDevices", () => {
  const devices: Array<NetworkControllerDevice> = readMerakiDevices(
    ANSWER,
    NETWORKS,
  );

  test("every device, each as the read keeps it", () => {
    expect(devices).toEqual([
      {
        serial: "Q2XX-AAAA-0000",
        name: "Branch 1 MX",
        model: "MX68",
        mac: "00:18:0a:00:00:01",
        lanIp: "",
        firmware: "wired-18-211",
        productType: "appliance",
        controllerNetworkId: "L_1000",
        networkName: "Branch 1",
        address: "",
      },
      {
        serial: "Q2HP-SWCH-0001",
        name: "Branch 1 core",
        model: "MS225-48LP",
        mac: "88:15:44:aa:00:01",
        lanIp: "10.0.0.2",
        firmware: "switch-16-7",
        productType: "switch",
        controllerNetworkId: "L_1000",
        networkName: "Branch 1",
        address: "1 Main Street Springfield",
      },
      {
        serial: "Q2KD-WLAN-0001",
        name: "Lobby AP",
        model: "MR46",
        mac: "e0:55:3d:aa:00:01",
        lanIp: "fe80::1",
        firmware: "wireless-29-7",
        productType: "wireless",
        controllerNetworkId: "L_1001",
        networkName: "Branch 2",
        address: "",
      },
    ]);
  });

  test("a device with no serial number or no network, or listed twice, is left out", () => {
    expect(
      readMerakiDevices(
        [
          { name: "unclaimed", serial: "", networkId: "L_1000" },
          { name: "no network", serial: "Q2ZZ-0000-0001" },
          ANSWER[2],
          {
            ...(ANSWER[2] as Record<string, unknown>),
            name: "the same box again",
          },
          null,
          "Q2ZZ",
          [ANSWER[0]],
        ],
        NETWORKS,
      ).map((device: NetworkControllerDevice): string => {
        return device.name;
      }),
    ).toEqual(["Lobby AP"]);
  });

  test("an address that is not one, and a product type Meraki does not name, are kept as nothing", () => {
    const [device] = readMerakiDevices(
      [
        {
          ...(ANSWER[1] as Record<string, unknown>),
          lanIp: "core.branch1.example",
          productType: "router",
        },
      ],
      NETWORKS,
    );

    expect(device?.lanIp).toBe("");
    expect(device?.productType).toBe("");
  });

  test("a network the read did not list leaves the network's name empty", () => {
    expect(
      readMerakiDevices(
        [{ ...(ANSWER[1] as Record<string, unknown>), networkId: "L_9999" }],
        NETWORKS,
      )[0]?.networkName,
    ).toBe("");
  });

  test("megabytes of text in every field are read in linear time", () => {
    const huge: string = "x".repeat(400000);
    const answer: Array<unknown> = Array.from(
      { length: 20 },
      (_: unknown, index: number) => {
        return {
          name: huge,
          address: huge,
          networkId: `L_${index}`,
          serial: `Q2${index}${huge}`,
          model: huge,
          mac: huge,
          lanIp: huge,
          firmware: huge,
          productType: huge,
        };
      },
    );

    const timed: FastestRun<Array<NetworkControllerDevice>> = fastestRun({
      run: (): Array<NetworkControllerDevice> => {
        return readMerakiDevices(answer, NETWORKS);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result[0]?.name.length).toBeLessThanOrEqual(128);
  });
});

describe("getMerakiAppliances", () => {
  test("the appliances of a list, as the uplinks are named by them", () => {
    expect(getMerakiAppliances(readMerakiDevices(ANSWER, NETWORKS))).toEqual([
      {
        serial: "Q2XX-AAAA-0000",
        name: "Branch 1 MX",
        model: "MX68",
        mac: "00:18:0a:00:00:01",
        controllerNetworkId: "L_1000",
      },
    ]);
  });

  test("a list without an appliance has none", () => {
    expect(
      getMerakiAppliances(readMerakiDevices(ANSWER.slice(1), NETWORKS)),
    ).toEqual([]);
  });
});
