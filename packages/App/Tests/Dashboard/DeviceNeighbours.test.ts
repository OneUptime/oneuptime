import { beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * The neighbour lookup imports ModelAPI, which loads Common/UI/Config and
 * reads `window` at import time. Mocking it keeps the import graph free of
 * the browser and is the seam the lookup's queries are asserted through.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      getItem: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import LldpNeighbor from "Common/Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";
import {
  DeviceNeighbour,
  NEIGHBOURS_SHOWN,
  NeighbourProtocol,
  getDeviceNeighbours,
  isPortNamedAsPort,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceNeighbours";
import {
  DeviceNeighbourNames,
  getAdvertisedNeighbourNames,
  getDeviceNeighbourNames,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceNeighbourLookupUtil";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * What a switch, router or firewall is cabled to, for the device Overview's
 * "Connected to" card: the LLDP and CDP neighbours its walk reported
 * (Components/NetworkDevice/DeviceNeighbours.ts), with its own port names
 * and links to the neighbours that are devices here
 * (DeviceNeighbourLookupUtil.ts). The card used to say "No switch at this
 * site has reported this device yet" on a core switch with five neighbours
 * drawn on the map.
 */

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

function lldp(overrides: Partial<LldpNeighbor>): LldpNeighbor {
  return {
    localInterfaceIndex: 1,
    remoteChassisId: "00:11:22:33:44:55",
    remotePortId: "Gi1/0/1",
    remoteSysName: "core-sw1",
    ...overrides,
  } as LldpNeighbor;
}

function cdp(overrides: Partial<CdpNeighbor>): CdpNeighbor {
  return {
    localInterfaceIndex: 2,
    remoteDeviceId: "edge-rtr1",
    remotePortId: "GigabitEthernet0/0",
    ...overrides,
  } as CdpNeighbor;
}

describe("getDeviceNeighbours", () => {
  test("a device that reports nothing has no neighbours", () => {
    expect(getDeviceNeighbours({})).toEqual([]);
    expect(
      getDeviceNeighbours({ lldpNeighbors: null, cdpNeighbors: undefined }),
    ).toEqual([]);
  });

  test("an LLDP neighbour is named by the system name it advertises", () => {
    expect(getDeviceNeighbours({ lldpNeighbors: [lldp({})] })).toEqual([
      {
        name: "core-sw1",
        hasAdvertisedName: true,
        remotePort: "Gi1/0/1",
        localInterfaceIndex: 1,
        protocol: NeighbourProtocol.Lldp,
      },
    ]);
  });

  test("an LLDP neighbour with no system name is named by its chassis id, and not linked", () => {
    const [neighbour]: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [lldp({ remoteSysName: "  " })],
    });

    expect(neighbour!.name).toBe("00:11:22:33:44:55");
    expect(neighbour!.hasAdvertisedName).toBe(false);
  });

  test("a CDP neighbour is named by its device id", () => {
    expect(getDeviceNeighbours({ cdpNeighbors: [cdp({})] })).toEqual([
      {
        name: "edge-rtr1",
        hasAdvertisedName: true,
        remotePort: "GigabitEthernet0/0",
        localInterfaceIndex: 2,
        protocol: NeighbourProtocol.Cdp,
      },
    ]);
  });

  test("a row that names nothing says nothing, and is left out", () => {
    expect(
      getDeviceNeighbours({
        lldpNeighbors: [lldp({ remoteSysName: "", remoteChassisId: "" })],
        cdpNeighbors: [cdp({ remoteDeviceId: " " })],
      }),
    ).toEqual([]);
  });

  test("a Cisco neighbour speaking both protocols on one port is one cable", () => {
    const neighbours: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [
        lldp({ remoteSysName: "Core-SW1", localInterfaceIndex: 3 }),
      ],
      cdpNeighbors: [
        cdp({ remoteDeviceId: "core-sw1", localInterfaceIndex: 3 }),
      ],
    });

    expect(neighbours).toHaveLength(1);
    expect(neighbours[0]!.protocol).toBe(NeighbourProtocol.Lldp);
  });

  test("the same neighbour on two ports is two cables", () => {
    expect(
      getDeviceNeighbours({
        lldpNeighbors: [
          lldp({ localInterfaceIndex: 49 }),
          lldp({ localInterfaceIndex: 50, remotePortId: "Gi1/0/2" }),
        ],
      }),
    ).toHaveLength(2);
  });

  test("listed in the order of this device's ports, then by name", () => {
    const neighbours: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [
        lldp({ remoteSysName: "ap-3", localInterfaceIndex: 12 }),
        lldp({ remoteSysName: "ap-1", localInterfaceIndex: 3 }),
        lldp({ remoteSysName: "unknown-port", localInterfaceIndex: undefined }),
      ],
      cdpNeighbors: [
        cdp({ remoteDeviceId: "phone-b", localInterfaceIndex: 7 }),
        cdp({ remoteDeviceId: "phone-a", localInterfaceIndex: 7 }),
      ],
    });

    expect(
      neighbours.map((neighbour: DeviceNeighbour): string => {
        return neighbour.name;
      }),
    ).toEqual(["ap-1", "phone-a", "phone-b", "ap-3", "unknown-port"]);
  });

  test("a port index that is not a number is no port index", () => {
    const [neighbour]: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [lldp({ localInterfaceIndex: "7" as unknown as number })],
    });

    expect(neighbour!.localInterfaceIndex).toBeUndefined();
  });

  test("an empty port id is no port", () => {
    const [neighbour]: Array<DeviceNeighbour> = getDeviceNeighbours({
      cdpNeighbors: [cdp({ remotePortId: "" })],
    });

    expect(neighbour!.remotePort).toBeUndefined();
  });

  /*
   * An LLDP agent that names its port by its chassis MAC (port id subtype
   * MAC address) and advertises no system name: the row would read
   * "00:11:22:33:44:55 · port 00:11:22:33:44:55".
   */
  test("a port id that only repeats the neighbour's name is no port", () => {
    const [byChassis]: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [
        lldp({ remoteSysName: "", remotePortId: "00:11:22:33:44:55" }),
      ],
    });

    expect(byChassis!.name).toBe("00:11:22:33:44:55");
    expect(byChassis!.remotePort).toBeUndefined();

    const [byName]: Array<DeviceNeighbour> = getDeviceNeighbours({
      cdpNeighbors: [cdp({ remotePortId: " EDGE-RTR1 " })],
    });

    expect(byName!.remotePort).toBeUndefined();
  });

  test("a port id that differs from the name is kept as it is written", () => {
    const [neighbour]: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [
        lldp({ remoteSysName: "", remotePortId: " 00:11:22:33:44:66 " }),
      ],
    });

    expect(neighbour!.remotePort).toBe("00:11:22:33:44:66");
  });

  test("the card lists eight before it says how many more are on the map", () => {
    expect(NEIGHBOURS_SHOWN).toBe(8);
  });
});

describe("isPortNamedAsPort", () => {
  test.each(["port1", "Port 3", "PORT-7", "port", "  port12 "])(
    "%s already says it is a port",
    (port: string) => {
      expect(isPortNamedAsPort(port)).toBe(true);
    },
  );

  test.each([
    "Gi1/0/1",
    "49",
    "eth0",
    "GigabitEthernet0/0",
    "portal",
    "airport1",
  ])("%s gets the word port in front", (port: string) => {
    expect(isPortNamedAsPort(port)).toBe(false);
  });

  /*
   * A port id is text a device sends, so the pattern that reads it has to
   * run in time that grows with the text, whatever the text is.
   */
  test("a port id as long as any device could send is read at once", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        isPortNamedAsPort("p".repeat(400_000));
        isPortNamedAsPort(`${"port".repeat(100_000)}x`);
        isPortNamedAsPort(`${" ".repeat(400_000)}port`);
        isPortNamedAsPort(`x${"port1".repeat(80_000)}`);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("getAdvertisedNeighbourNames", () => {
  test("only names a neighbour gave itself, each once, whatever its case", () => {
    const neighbours: Array<DeviceNeighbour> = getDeviceNeighbours({
      lldpNeighbors: [
        lldp({ remoteSysName: "core-sw1", localInterfaceIndex: 1 }),
        lldp({ remoteSysName: "CORE-SW1", localInterfaceIndex: 2 }),
        lldp({ remoteSysName: "", localInterfaceIndex: 3 }),
      ],
      cdpNeighbors: [cdp({ remoteDeviceId: "edge-rtr1" })],
    });

    expect(getAdvertisedNeighbourNames(neighbours)).toEqual([
      "core-sw1",
      "edge-rtr1",
    ]);
  });
});

describe("getDeviceNeighbourNames", () => {
  const DEVICE_ID: ObjectID = new ObjectID(
    "3f1b6b0e-0000-4000-8000-0000000000aa",
  );

  beforeEach(() => {
    getListMock.mockReset();
  });

  function interfaceRow(
    interfaceIndex: number,
    name: string,
  ): NetworkInterface {
    const row: NetworkInterface = new NetworkInterface();
    row.interfaceIndex = interfaceIndex;
    row.name = name;
    return row;
  }

  function deviceRow(id: string, name: string): NetworkDevice {
    const row: NetworkDevice = new NetworkDevice();
    row._id = id;
    row.name = name;
    return row;
  }

  test("reads this device's port names, and which neighbours are devices here", async () => {
    getListMock.mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        if (request.modelType === NetworkInterface) {
          return {
            data: [interfaceRow(1, "Gi1/0/1"), interfaceRow(2, "Gi1/0/2")],
          };
        }

        return {
          data: [deviceRow("3f1b6b0e-0000-4000-8000-00000000c001", "Core-SW1")],
        };
      },
    );

    const names: DeviceNeighbourNames = await getDeviceNeighbourNames(
      DEVICE_ID,
      getDeviceNeighbours({ lldpNeighbors: [lldp({})] }),
    );

    expect(Array.from(names.portNames.entries())).toEqual([
      [1, "Gi1/0/1"],
      [2, "Gi1/0/2"],
    ]);
    expect(Array.from(names.neighbourDeviceIds.entries())).toEqual([
      ["core-sw1", "3f1b6b0e-0000-4000-8000-00000000c001"],
    ]);
  });

  test("asks for this device's interfaces only, and the neighbours by their advertised names", async () => {
    getListMock.mockResolvedValue({ data: [] });

    await getDeviceNeighbourNames(
      DEVICE_ID,
      getDeviceNeighbours({
        lldpNeighbors: [lldp({ remoteSysName: "core-sw1" })],
        cdpNeighbors: [cdp({ remoteDeviceId: "edge-rtr1" })],
      }),
    );

    const interfaceRequest: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = getListMock.mock.calls.find((call: Array<unknown>): boolean => {
      return (call[0] as { modelType: unknown }).modelType === NetworkInterface;
    })![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    expect(interfaceRequest.query).toEqual({
      networkDeviceId: DEVICE_ID.toString(),
    });
    expect(Object.keys(interfaceRequest.select).sort()).toEqual([
      "_id",
      "interfaceIndex",
      "name",
    ]);

    const deviceRequest: {
      query: { name: Includes };
      select: Record<string, unknown>;
    } = getListMock.mock.calls.find((call: Array<unknown>): boolean => {
      return (call[0] as { modelType: unknown }).modelType === NetworkDevice;
    })![0] as { query: { name: Includes }; select: Record<string, unknown> };

    expect(deviceRequest.query.name).toBeInstanceOf(Includes);
    expect(deviceRequest.query.name.values).toEqual(["core-sw1", "edge-rtr1"]);
    expect(Object.keys(deviceRequest.select).sort()).toEqual(["_id", "name"]);
    // Never a project id: the API scopes the read to the viewer's project.
    expect(deviceRequest.query).not.toHaveProperty("projectId");
  });

  test("neighbours known only by chassis id look up no device", async () => {
    getListMock.mockResolvedValue({ data: [] });

    const names: DeviceNeighbourNames = await getDeviceNeighbourNames(
      DEVICE_ID,
      getDeviceNeighbours({
        lldpNeighbors: [lldp({ remoteSysName: "" })],
      }),
    );

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(NetworkInterface);
    expect(names.neighbourDeviceIds.size).toBe(0);
  });

  test("rows without a name or an index are passed over", async () => {
    getListMock.mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        if (request.modelType === NetworkInterface) {
          const unnamed: NetworkInterface = new NetworkInterface();
          unnamed.interfaceIndex = 4;
          const unindexed: NetworkInterface = new NetworkInterface();
          unindexed.name = "Gi1/0/9";
          return { data: [unnamed, unindexed] };
        }

        return { data: [new NetworkDevice()] };
      },
    );

    const names: DeviceNeighbourNames = await getDeviceNeighbourNames(
      DEVICE_ID,
      getDeviceNeighbours({ lldpNeighbors: [lldp({})] }),
    );

    expect(names.portNames.size).toBe(0);
    expect(names.neighbourDeviceIds.size).toBe(0);
  });

  test("two devices of one name: the first one read is the link", async () => {
    getListMock.mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        if (request.modelType === NetworkInterface) {
          return { data: [] };
        }

        return {
          data: [
            deviceRow("3f1b6b0e-0000-4000-8000-00000000c001", "core-sw1"),
            deviceRow("3f1b6b0e-0000-4000-8000-00000000c002", "CORE-SW1"),
          ],
        };
      },
    );

    const names: DeviceNeighbourNames = await getDeviceNeighbourNames(
      DEVICE_ID,
      getDeviceNeighbours({ lldpNeighbors: [lldp({})] }),
    );

    expect(names.neighbourDeviceIds.get("core-sw1")).toBe(
      "3f1b6b0e-0000-4000-8000-00000000c001",
    );
  });

  test("a failed read is the caller's to absorb", async () => {
    getListMock.mockRejectedValue(new Error("network down"));

    await expect(
      getDeviceNeighbourNames(
        DEVICE_ID,
        getDeviceNeighbours({ lldpNeighbors: [lldp({})] }),
      ),
    ).rejects.toThrow("network down");
  });
});
