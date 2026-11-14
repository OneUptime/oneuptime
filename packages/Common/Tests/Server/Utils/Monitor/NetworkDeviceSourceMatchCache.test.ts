import NetworkDeviceHydrationUtil, {
  SOURCE_MATCH_CACHE_MAX_ENTRIES,
  SOURCE_MATCH_CACHE_TTL_MS,
} from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import { CACHE_TTL_MS as SYSLOG_CACHE_TTL_MS } from "../../../../Server/Utils/Syslog/SyslogDeviceMatcher";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
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
 * findDevicesByProbeAndSource answers, for every SNMP trap and every syslog
 * message, which devices of the receiving probe the sender's address
 * belongs to. The rules are lookupDevicesByProbeAndSource's
 * (NetworkDeviceSourceMatching.test.ts); this pins the cache in front of
 * them. Without it, a trap from an address no device has as its hostname -
 * a router sending from its loopback, a device registered by DNS name, a
 * sender nobody added - read every device the probe polls and resolved
 * their DNS names, on every trap.
 */

const PROBE: ObjectID = ObjectID.generate();
const OTHER_PROBE: ObjectID = ObjectID.generate();
const PROJECT: ObjectID = ObjectID.generate();

function device(hostname: string, name?: string): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(ObjectID.generate());
  value.projectId = PROJECT;
  value.hostname = hostname;

  if (name !== undefined) {
    value.name = name;
  }

  return value;
}

type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

let lookup: MockFunction;

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();

  lookup = jest
    .spyOn(NetworkDeviceHydrationUtil, "lookupDevicesByProbeAndSource")
    .mockResolvedValue([] as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
});

async function match(
  address: string,
  probeId: ObjectID = PROBE,
): Promise<Array<NetworkDevice>> {
  return NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
    probeId: probeId,
    sourceIpAddress: address,
    select: { name: true },
  });
}

function ids(devices: Array<NetworkDevice>): Array<string> {
  return devices.map((value: NetworkDevice): string => {
    return value.id!.toString();
  });
}

describe("hits", () => {
  test("a second trap from the same address reads nothing", async () => {
    const router: NetworkDevice = device("10.0.0.1", "Core Router");
    lookup.mockResolvedValue([router] as never);

    const first: Array<NetworkDevice> = await match("10.0.0.1");
    const second: Array<NetworkDevice> = await match("10.0.0.1");

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(ids(first)).toEqual([router.id!.toString()]);
    expect(ids(second)).toEqual([router.id!.toString()]);
  });

  test("a cached device carries its id, its project and its name", async () => {
    const router: NetworkDevice = device("10.0.0.1", "Core Router");
    lookup.mockResolvedValue([router] as never);

    await match("10.0.0.1");
    const [cached] = await match("10.0.0.1");

    expect(cached).toBeInstanceOf(NetworkDevice);
    expect(cached!.id!.toString()).toBe(router.id!.toString());
    expect(cached!.projectId!.toString()).toBe(PROJECT.toString());
    expect(cached!.name).toBe("Core Router");
  });

  test("the lookup is asked for the device's name, with the address trimmed", async () => {
    await match(" 10.0.0.1 ");

    expect(lookup).toHaveBeenCalledWith({
      probeId: PROBE,
      sourceIpAddress: "10.0.0.1",
      select: { name: true },
    });
  });

  test("the same address with stray whitespace shares the entry", async () => {
    lookup.mockResolvedValue([device("10.0.0.1")] as never);

    await match("10.0.0.1");
    await match(" 10.0.0.1\n");

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("a device with no name comes back with none", async () => {
    lookup.mockResolvedValue([device("10.0.0.1")] as never);

    await match("10.0.0.1");
    const [cached] = await match("10.0.0.1");

    expect(cached!.name).toBeUndefined();
  });

  test("an address several devices share answers with all of them, every time", async () => {
    const siteA: NetworkDevice = device("192.168.1.1", "Site A");
    const siteB: NetworkDevice = device("192.168.1.1", "Site B");
    lookup.mockResolvedValue([siteA, siteB] as never);

    await match("192.168.1.1");

    expect(ids(await match("192.168.1.1"))).toEqual([
      siteA.id!.toString(),
      siteB.id!.toString(),
    ]);
  });

  test("a device the lookup hands back without an id or a project is not kept", async () => {
    const whole: NetworkDevice = device("10.0.0.1");
    const noProject: NetworkDevice = new NetworkDevice(ObjectID.generate());
    lookup.mockResolvedValue([noProject, whole] as never);

    expect(ids(await match("10.0.0.1"))).toEqual([whole.id!.toString()]);
  });

  test("the devices handed back are the caller's own", async () => {
    lookup.mockResolvedValue([device("10.0.0.1", "Core Router")] as never);

    const [first] = await match("10.0.0.1");
    first!.name = "changed by the first caller";
    first!.projectId = ObjectID.generate();

    const [second] = await match("10.0.0.1");

    expect(second).not.toBe(first);
    expect(second!.name).toBe("Core Router");
    expect(second!.projectId!.toString()).toBe(PROJECT.toString());
  });
});

describe("misses", () => {
  test("another address is looked up on its own", async () => {
    await match("10.0.0.1");
    await match("10.0.0.2");

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test("another probe is asked on its own, even for the same address", async () => {
    const mine: NetworkDevice = device("10.0.0.1", "Mine");
    const theirs: NetworkDevice = device("10.0.0.1", "Theirs");
    lookup.mockImplementation((async (data: {
      probeId: ObjectID;
    }): Promise<Array<NetworkDevice>> => {
      return data.probeId.toString() === PROBE.toString() ? [mine] : [theirs];
    }) as never);

    expect(ids(await match("10.0.0.1", PROBE))).toEqual([mine.id!.toString()]);
    expect(ids(await match("10.0.0.1", OTHER_PROBE))).toEqual([
      theirs.id!.toString(),
    ]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test("concurrent traps from an address not yet cached share one lookup", async () => {
    let finish: (devices: Array<NetworkDevice>) => void = () => {};
    lookup.mockImplementation((() => {
      return new Promise<Array<NetworkDevice>>(
        (resolve: (devices: Array<NetworkDevice>) => void) => {
          finish = resolve;
        },
      );
    }) as never);

    const router: NetworkDevice = device("10.0.0.1");
    const burst: Array<Promise<Array<NetworkDevice>>> = [];

    for (let index: number = 0; index < 20; index++) {
      burst.push(match("10.0.0.1"));
    }

    finish([router]);

    for (const answer of await Promise.all(burst)) {
      expect(ids(answer)).toEqual([router.id!.toString()]);
    }

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("a lookup that fails is not cached: the next trap asks again", async () => {
    lookup.mockRejectedValueOnce(new Error("database is down") as never);

    await expect(match("10.0.0.1")).rejects.toThrow("database is down");

    const router: NetworkDevice = device("10.0.0.1");
    lookup.mockResolvedValue([router] as never);

    expect(ids(await match("10.0.0.1"))).toEqual([router.id!.toString()]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test("every trap waiting on a lookup that fails is told so, and none is cached", async () => {
    let fail: (error: Error) => void = () => {};
    lookup.mockImplementationOnce((() => {
      return new Promise<Array<NetworkDevice>>(
        (_resolve: unknown, reject: (error: Error) => void) => {
          fail = reject;
        },
      );
    }) as never);

    const first: Promise<Array<NetworkDevice>> = match("10.0.0.1");
    const second: Promise<Array<NetworkDevice>> = match("10.0.0.1");

    fail(new Error("timeout"));

    await expect(first).rejects.toThrow("timeout");
    await expect(second).rejects.toThrow("timeout");

    await match("10.0.0.1");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("negative entries", () => {
  test("an address that is no device's is remembered as nobody's", async () => {
    expect(await match("203.0.113.9")).toEqual([]);
    expect(await match("203.0.113.9")).toEqual([]);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("a sender nobody added scans the probe's devices and resolves their names once, not once per trap", async () => {
    lookup.mockRestore();

    const findBy: MockFunction = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([] as never) as unknown as MockFunction;

    // The exact lookup finds nothing; the probe polls one DNS-named device.
    findBy.mockImplementation((async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<NetworkDevice>> => {
      return data.query["hostname"] !== undefined
        ? []
        : [device("core.example.com")];
    }) as never);

    const resolve: MockFunction = jest
      .spyOn(
        (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
          .dnsCache,
        "resolve",
      )
      .mockResolvedValue(["10.9.9.9"] as never) as unknown as MockFunction;

    for (let index: number = 0; index < 50; index++) {
      expect(await match("203.0.113.9")).toEqual([]);
    }

    // One exact lookup and one scan of the probe's devices, for 50 traps.
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("a device found by the slow path is remembered as well", async () => {
    lookup.mockRestore();

    const byDns: NetworkDevice = device("core.example.com", "Core");

    const findBy: MockFunction = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }): Promise<Array<NetworkDevice>> => {
        return data.query["hostname"] !== undefined ? [] : [byDns];
      }) as never) as unknown as MockFunction;

    jest
      .spyOn(
        (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
          .dnsCache,
        "resolve",
      )
      .mockResolvedValue(["10.255.0.1"] as never);

    expect(ids(await match("10.255.0.1"))).toEqual([byDns.id!.toString()]);
    expect(ids(await match("10.255.0.1"))).toEqual([byDns.id!.toString()]);
    expect(findBy).toHaveBeenCalledTimes(2);
  });
});

describe("expiry", () => {
  test("an answer is used until it is SOURCE_MATCH_CACHE_TTL_MS old, then asked again", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));

    expect(await match("10.50.0.1")).toEqual([]);

    const added: NetworkDevice = device("10.50.0.1", "New Switch");
    lookup.mockResolvedValue([added] as never);

    // A second before it is due: still nobody's.
    jest.setSystemTime(new Date(Date.now() + SOURCE_MATCH_CACHE_TTL_MS - 1000));
    expect(await match("10.50.0.1")).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(1);

    // Past it: the device added meanwhile receives its traps.
    jest.setSystemTime(new Date(Date.now() + 2000));
    expect(ids(await match("10.50.0.1"))).toEqual([added.id!.toString()]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test("a device removed stops matching once its answer expires", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));

    lookup.mockResolvedValue([device("10.0.0.1")] as never);
    expect(await match("10.0.0.1")).toHaveLength(1);

    lookup.mockResolvedValue([] as never);
    jest.setSystemTime(new Date(Date.now() + SOURCE_MATCH_CACHE_TTL_MS + 1));

    expect(await match("10.0.0.1")).toEqual([]);
  });

  test("clearSourceMatchCache forgets every answer at once", async () => {
    await match("10.0.0.1");
    await match("10.0.0.2");

    NetworkDeviceHydrationUtil.clearSourceMatchCache();

    await match("10.0.0.1");
    await match("10.0.0.2");

    expect(lookup).toHaveBeenCalledTimes(4);
  });

  test("answers stay a minute, the bound syslog has always had, and a large fleet fits", () => {
    expect(SOURCE_MATCH_CACHE_TTL_MS).toBe(60_000);
    expect(SOURCE_MATCH_CACHE_TTL_MS).toBe(SYSLOG_CACHE_TTL_MS);
    expect(SOURCE_MATCH_CACHE_MAX_ENTRIES).toBeGreaterThanOrEqual(50_000);
  });
});
