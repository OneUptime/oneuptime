import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import { SnmpTrapSourceTiers } from "../../../../Server/Utils/Monitor/SnmpTrapDeviceSelection";
import ObjectID from "../../../../Types/ObjectID";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY DEVICE ON A PROBE THAT HAS A TRAP'S ADDRESS, BY HOW IT HAS IT
 * (#11172).
 *
 * What an authenticated SNMPv3 trap is matched by. Unlike the lookup a v1
 * or v2c trap and syslog go by - the first way the address finds any
 * device - it reads the devices that list the address among their Other
 * Addresses even when one has it as its hostname: a NAT gateway registered
 * at the address and the devices behind it, a chassis and its blades.
 */

const PROBE: ObjectID = new ObjectID("11720000-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("11720000-0000-4000-8000-00000000ac0e");

let counter: number = 0;

function device(
  name: string,
  fields: Record<string, unknown> = {},
): NetworkDevice {
  counter++;
  const model: NetworkDevice = new NetworkDevice(
    new ObjectID(
      `11720000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    ),
  );
  model.projectId = PROJECT;
  model.name = name;
  Object.assign(model, fields);
  return model;
}

let findBy: MockFunction;
let fallback: MockFunction;

function probeHas(data: {
  byHostname?: Array<NetworkDevice>;
  listingTheAddress?: Array<NetworkDevice>;
  fallback?: Array<NetworkDevice>;
}): void {
  findBy.mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<NetworkDevice>> => {
    if ("hostname" in args.query) {
      return data.byHostname || [];
    }

    if ("otherAddresses" in args.query) {
      return data.listingTheAddress || [];
    }

    return [];
  }) as never);
  fallback.mockResolvedValue((data.fallback || []) as never);
}

async function tiersAt(address: string): Promise<Record<string, Array<string>>> {
  const found: SnmpTrapSourceTiers =
    await NetworkDeviceHydrationUtil.findDeviceTiersByProbeAndSource({
      probeId: PROBE,
      sourceIpAddress: address,
    });

  const namesOf: (devices: Array<NetworkDevice>) => Array<string> = (
    devices: Array<NetworkDevice>,
  ): Array<string> => {
    return devices.map((model: NetworkDevice): string => {
      return model.name || "";
    });
  };

  return {
    hostname: namesOf(found.hostname),
    otherAddress: namesOf(found.otherAddress),
    dns: namesOf(found.dns),
  };
}

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  findBy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockResolvedValue([] as never) as unknown as MockFunction;
  fallback = jest
    .spyOn(NetworkDeviceHydrationUtil, "lookupDevicesByProbeAndSource")
    .mockResolvedValue([] as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
});

describe("both ways an address is a device's, read together", () => {
  test("a NAT gateway at the address, and the devices behind it that list it", async () => {
    probeHas({
      byHostname: [device("nat-gateway", { hostname: "203.0.113.7" })],
      listingTheAddress: [
        device("behind-1", {
          hostname: "10.0.0.1",
          otherAddresses: "203.0.113.7",
        }),
        device("behind-2", {
          hostname: "10.0.0.2",
          otherAddresses: "10.9.9.9, 203.0.113.7",
        }),
      ],
    });

    expect(await tiersAt("203.0.113.7")).toEqual({
      hostname: ["nat-gateway"],
      otherAddress: ["behind-1", "behind-2"],
      dns: [],
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  test("the text search's near misses are compared whole: 203.0.113.70 is not 203.0.113.7", async () => {
    probeHas({
      listingTheAddress: [
        device("near-miss", {
          hostname: "10.0.0.3",
          otherAddresses: "203.0.113.70",
        }),
        device("the-one", {
          hostname: "10.0.0.4",
          otherAddresses: "203.0.113.7",
        }),
      ],
    });

    expect((await tiersAt("203.0.113.7")).otherAddress).toEqual(["the-one"]);
  });

  test("a device with the address as its hostname and in its Other Addresses is listed once, by its hostname", async () => {
    const both: NetworkDevice = device("both", {
      hostname: "203.0.113.7",
      otherAddresses: "203.0.113.7",
    });
    probeHas({ byHostname: [both], listingTheAddress: [both] });

    expect(await tiersAt("203.0.113.7")).toEqual({
      hostname: ["both"],
      otherAddress: [],
      dns: [],
    });
  });

  test("Other Addresses are searched by the canonical address the datagram came from", async () => {
    probeHas({});

    await tiersAt("2001:DB8:0:0::7");

    const otherAddressQuery: unknown = findBy.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { query: Record<string, unknown> }).query;
      })
      .find((query: Record<string, unknown>) => {
        return "otherAddresses" in query;
      });

    expect(JSON.stringify(otherAddressQuery)).toContain("2001:db8::7");
  });

  test("each device read with its project, name, SNMPv3 context and engine ID, as root, on this probe", async () => {
    probeHas({});

    await tiersAt("203.0.113.7");

    for (const call of findBy.mock.calls) {
      const args: {
        query: Record<string, unknown>;
        select: Record<string, boolean>;
        props: { isRoot: boolean };
      } = call[0] as {
        query: Record<string, unknown>;
        select: Record<string, boolean>;
        props: { isRoot: boolean };
      };

      expect(args.query["probeId"]).toEqual(PROBE);
      expect(args.select).toMatchObject({
        _id: true,
        projectId: true,
        name: true,
        snmpV3ContextName: true,
        snmpEngineId: true,
      });
      expect(args.props).toEqual({ isRoot: true });
    }
  });
});

describe("neither: the trap path's fallback, told apart by its hostname", () => {
  test("an IPv6 hostname written another way is a hostname; a DNS name is DNS", async () => {
    probeHas({
      fallback: [
        device("v6-literal", { hostname: "2001:DB8::7" }),
        device("by-name", { hostname: "switch.example.com" }),
      ],
    });

    expect(await tiersAt("2001:db8::7")).toEqual({
      hostname: ["v6-literal"],
      otherAddress: [],
      dns: ["by-name"],
    });
    expect(fallback).toHaveBeenCalledWith({
      probeId: PROBE,
      sourceIpAddress: "2001:db8::7",
      select: { name: true, snmpV3ContextName: true, snmpEngineId: true },
    });
  });

  test("nothing anywhere is nothing", async () => {
    probeHas({});

    expect(await tiersAt("192.0.2.1")).toEqual({
      hostname: [],
      otherAddress: [],
      dns: [],
    });
  });
});

describe("cached, as the address lookup is", () => {
  test("a second trap from the address reads nothing, and gets devices of its own", async () => {
    probeHas({
      byHostname: [
        device("switch", { hostname: "203.0.113.7", snmpEngineId: "80000009030000000001" }),
      ],
    });

    const first: SnmpTrapSourceTiers =
      await NetworkDeviceHydrationUtil.findDeviceTiersByProbeAndSource({
        probeId: PROBE,
        sourceIpAddress: "203.0.113.7",
      });
    first.hostname[0]!.name = "changed by a caller";

    const second: SnmpTrapSourceTiers =
      await NetworkDeviceHydrationUtil.findDeviceTiersByProbeAndSource({
        probeId: PROBE,
        sourceIpAddress: "203.0.113.7",
      });

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(second.hostname[0]!.name).toBe("switch");
    expect(second.hostname[0]!.snmpEngineId).toBe("80000009030000000001");
    expect(second.hostname[0]!.projectId).toEqual(PROJECT);
  });

  test("a lookup that fails is not cached: the next trap asks again", async () => {
    findBy.mockRejectedValueOnce(new Error("connection reset") as never);

    await expect(tiersAt("203.0.113.7")).rejects.toThrow("connection reset");

    probeHas({ byHostname: [device("switch", { hostname: "203.0.113.7" })] });

    expect((await tiersAt("203.0.113.7")).hostname).toEqual(["switch"]);
  });

  test("concurrent traps from one address share one lookup", async () => {
    probeHas({ byHostname: [device("switch", { hostname: "203.0.113.7" })] });

    await Promise.all([
      tiersAt("203.0.113.7"),
      tiersAt("203.0.113.7"),
      tiersAt("203.0.113.7"),
    ]);

    // The hostname read and the Other Addresses read, once.
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("clearSourceMatchCache forgets these answers too", async () => {
    probeHas({ byHostname: [device("switch", { hostname: "203.0.113.7" })] });

    await tiersAt("203.0.113.7");
    NetworkDeviceHydrationUtil.clearSourceMatchCache();
    await tiersAt("203.0.113.7");

    expect(findBy).toHaveBeenCalledTimes(4);
  });
});
