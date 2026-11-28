import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import DnsResolutionCache from "../../../../Server/Utils/Monitor/DnsResolutionCache";
import NetworkDeviceHydrationUtil, {
  HOSTNAME_RESOLVE_CONCURRENCY,
  MAX_HOSTNAMES_PER_RESOLVE,
} from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import { MAX_DNS_NAMED_DEVICES_PER_REPORT } from "../../../../Server/Utils/Monitor/SnmpTrapReceiverReports";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * THE ADDRESSES DEVICES' DNS NAMES RESOLVE TO, FOR A PROBE'S REFUSED SNMPv3
 * TRAPS (OneUptime issue #11406).
 *
 * A device added by its DNS name is matched to its refusals the way a trap
 * is matched to it: by the address its name resolves to, through the cache
 * trap matching resolves names with. This runs while a probe waits for its
 * SNMPv3 users, every thirty seconds, so it is bounded - names, lookups at
 * a time, and time - and every answer is cached.
 */

type HydrationInternals = { dnsCache: DnsResolutionCache };

const internals: HydrationInternals =
  NetworkDeviceHydrationUtil as unknown as HydrationInternals;
const sharedCache: DnsResolutionCache = internals.dnsCache;

function useCache(cache: DnsResolutionCache): void {
  internals.dnsCache = cache;
}

afterEach(() => {
  jest.restoreAllMocks();
  internals.dnsCache = sharedCache;
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
});

interface Deferred {
  promise: Promise<Array<string>>;
  resolve: (addresses: Array<string>) => void;
}

function deferred(): Deferred {
  let resolve: (addresses: Array<string>) => void = (): void => {};
  const promise: Promise<Array<string>> = new Promise(
    (done: (addresses: Array<string>) => void) => {
      resolve = done;
    },
  );
  return { promise: promise, resolve: resolve };
}

function asObject(map: Map<string, Array<string>>): Record<string, unknown> {
  return Object.fromEntries(map);
}

describe("resolveHostnames", () => {
  test("each name once, in lower case, with its addresses canonical and each once", async () => {
    const resolver: Mock<(hostname: string) => Promise<Array<string>>> =
      jest.fn(async (hostname: string): Promise<Array<string>> => {
        return hostname === "core-sw-01.acme.example"
          ? ["10.20.0.6", "2001:DB8:0:0::6", "10.20.0.6"]
          : ["10.20.0.7"];
      });
    useCache(new DnsResolutionCache({ resolver: resolver }));

    const resolved: Map<
      string,
      Array<string>
    > = await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: [
        "Core-SW-01.acme.example",
        " core-sw-01.acme.example ",
        "edge-fw.acme.example",
      ],
    });

    expect(asObject(resolved)).toEqual({
      "core-sw-01.acme.example": ["10.20.0.6", "2001:db8::6"],
      "edge-fw.acme.example": ["10.20.0.7"],
    });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  test("an address or nothing is no name to resolve", async () => {
    const resolver: Mock<(hostname: string) => Promise<Array<string>>> =
      jest.fn(async (): Promise<Array<string>> => {
        return ["10.0.0.1"];
      });
    useCache(new DnsResolutionCache({ resolver: resolver }));

    expect(
      asObject(
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["10.0.0.5", "2001:db8::5", "", "   "],
        }),
      ),
    ).toEqual({});
    expect(resolver).not.toHaveBeenCalled();
  });

  test("a name that does not resolve, or a resolver that fails, is a name with no address - never a throw", async () => {
    useCache(
      new DnsResolutionCache({
        resolver: async (hostname: string): Promise<Array<string>> => {
          if (hostname === "gone.example") {
            const error: Error & { code?: string } = new Error("ENOTFOUND");
            error.code = "ENOTFOUND";
            throw error;
          }

          throw new Error("SERVFAIL");
        },
      }),
    );

    expect(
      asObject(
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["gone.example", "broken.example"],
        }),
      ),
    ).toEqual({ "gone.example": [], "broken.example": [] });
  });

  test("a cache that throws is still no address, never a throw", async () => {
    jest
      .spyOn(sharedCache, "resolve")
      .mockRejectedValue(new Error("boom") as never);

    expect(
      asObject(
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["switch.example"],
        }),
      ),
    ).toEqual({ "switch.example": [] });
  });

  test("what a resolver says that is not an address is left out", async () => {
    useCache(
      new DnsResolutionCache({
        resolver: async (): Promise<Array<string>> => {
          return ["10.0.0.9", "not-an-address", ""];
        },
      }),
    );

    expect(
      asObject(
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["switch.example"],
        }),
      ),
    ).toEqual({ "switch.example": ["10.0.0.9"] });
  });

  test(`at most ${MAX_HOSTNAMES_PER_RESOLVE} names, the first given`, async () => {
    const asked: Array<string> = [];
    useCache(
      new DnsResolutionCache({
        resolver: async (hostname: string): Promise<Array<string>> => {
          asked.push(hostname);
          return ["10.0.0.1"];
        },
      }),
    );

    const resolved: Map<
      string,
      Array<string>
    > = await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: Array.from(
        { length: MAX_HOSTNAMES_PER_RESOLVE + 25 },
        (_: unknown, index: number): string => {
          return `device-${index}.example`;
        },
      ),
      budgetInMs: 60000,
    });

    expect(resolved.size).toBe(MAX_HOSTNAMES_PER_RESOLVE);
    expect(asked).toHaveLength(MAX_HOSTNAMES_PER_RESOLVE);
    expect(resolved.has(`device-${MAX_HOSTNAMES_PER_RESOLVE}.example`)).toBe(
      false,
    );
  });

  test(`at most ${HOSTNAME_RESOLVE_CONCURRENCY} lookups at a time`, async () => {
    let inFlight: number = 0;
    let mostAtOnce: number = 0;

    useCache(
      new DnsResolutionCache({
        resolver: async (): Promise<Array<string>> => {
          inFlight++;
          mostAtOnce = Math.max(mostAtOnce, inFlight);
          await new Promise<void>((done: () => void) => {
            setTimeout(done, 0);
          });
          inFlight--;
          return ["10.0.0.1"];
        },
      }),
    );

    const resolved: Map<
      string,
      Array<string>
    > = await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: Array.from(
        { length: 50 },
        (_: unknown, index: number): string => {
          return `device-${index}.example`;
        },
      ),
      budgetInMs: 60000,
    });

    expect(resolved.size).toBe(50);
    expect(mostAtOnce).toBe(HOSTNAME_RESOLVE_CONCURRENCY);
  });

  test("answers within its budget: a name not answered by then is left out, and nothing is added after", async () => {
    const slow: Deferred = deferred();

    useCache(
      new DnsResolutionCache({
        resolver: (hostname: string): Promise<Array<string>> => {
          return hostname === "slow.example"
            ? slow.promise
            : Promise.resolve(["10.0.0.1"]);
        },
      }),
    );

    const startedAt: number = Date.now();
    const resolved: Map<
      string,
      Array<string>
    > = await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: ["fast.example", "slow.example"],
      budgetInMs: 50,
    });

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(asObject(resolved)).toEqual({ "fast.example": ["10.0.0.1"] });

    // The late answer lands in the cache, never in an answer already given.
    slow.resolve(["10.0.0.2"]);
    await new Promise<void>((done: () => void) => {
      setTimeout(done, 0);
    });

    expect(asObject(resolved)).toEqual({ "fast.example": ["10.0.0.1"] });
    expect(
      asObject(
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["slow.example"],
        }),
      ),
    ).toEqual({ "slow.example": ["10.0.0.2"] });
  });

  test("past its budget no new name is asked about", async () => {
    const asked: Array<string> = [];
    const pending: Array<Deferred> = [];

    useCache(
      new DnsResolutionCache({
        resolver: (hostname: string): Promise<Array<string>> => {
          asked.push(hostname);
          const answer: Deferred = deferred();
          pending.push(answer);
          return answer.promise;
        },
      }),
    );

    await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: Array.from(
        { length: HOSTNAME_RESOLVE_CONCURRENCY * 3 },
        (_: unknown, index: number): string => {
          return `device-${index}.example`;
        },
      ),
      budgetInMs: 20,
    });

    // The lookups under way finish; the workers take nothing more.
    for (const answer of pending.splice(0)) {
      answer.resolve(["10.0.0.1"]);
    }

    await new Promise<void>((done: () => void) => {
      setTimeout(done, 0);
    });

    expect(asked).toHaveLength(HOSTNAME_RESOLVE_CONCURRENCY);
  });

  test("cached: a probe that reports every thirty seconds asks the resolver once in five minutes", async () => {
    let now: number = Date.UTC(2026, 10, 28, 9, 0, 0);
    const resolver: Mock<(hostname: string) => Promise<Array<string>>> =
      jest.fn(async (): Promise<Array<string>> => {
        return ["10.20.0.6"];
      });

    useCache(
      new DnsResolutionCache({
        resolver: resolver,
        now: (): number => {
          return now;
        },
      }),
    );

    for (let report: number = 0; report < 10; report++) {
      await NetworkDeviceHydrationUtil.resolveHostnames({
        hostnames: ["core-sw-01.acme.example"],
      });
      now += 30 * 1000;
    }

    expect(resolver).toHaveBeenCalledTimes(1);

    // Five minutes on, it is asked again.
    now += 5 * 60 * 1000;
    await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: ["core-sw-01.acme.example"],
    });
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  test("the cache is trap matching's own: a name resolved for the refusals is not asked about again for a trap", async () => {
    const resolver: Mock<(hostname: string) => Promise<Array<string>>> =
      jest.fn(async (): Promise<Array<string>> => {
        return ["10.20.0.6"];
      });
    useCache(new DnsResolutionCache({ resolver: resolver }));

    await NetworkDeviceHydrationUtil.resolveHostnames({
      hostnames: ["core-sw-01.acme.example"],
    });

    const dnsNamed: NetworkDevice = new NetworkDevice(ObjectID.generate());
    dnsNamed.projectId = ObjectID.generate();
    dnsNamed.hostname = "core-sw-01.acme.example";

    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }): Promise<Array<NetworkDevice>> => {
        return "hostname" in data.query ? [] : [dnsNamed];
      }) as never);

    const matched: Array<NetworkDevice> =
      await NetworkDeviceHydrationUtil.lookupDevicesByProbeAndSource({
        probeId: ObjectID.generate(),
        sourceIpAddress: "10.20.0.6",
      });

    expect(
      matched.map((device: NetworkDevice) => {
        return device.id;
      }),
    ).toEqual([dnsNamed.id]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  test("a real name, through the system's own resolver: localhost is the loopback", async () => {
    useCache(new DnsResolutionCache());

    const addresses: Array<string> =
      (
        await NetworkDeviceHydrationUtil.resolveHostnames({
          hostnames: ["localhost"],
        })
      ).get("localhost") || [];

    expect(
      addresses.some((address: string): boolean => {
        return address === "127.0.0.1" || address === "::1";
      }),
    ).toBe(true);
  });

  test("a long list is worked through report by report: what is cached answers at once, so each gets further", async () => {
    const asked: Set<string> = new Set();

    useCache(
      new DnsResolutionCache({
        resolver: async (hostname: string): Promise<Array<string>> => {
          asked.add(hostname);
          // A slow resolver: far more names than one budget covers.
          await new Promise<void>((done: () => void) => {
            setTimeout(done, 5);
          });
          return ["10.0.0.1"];
        },
      }),
    );

    const names: Array<string> = Array.from(
      { length: 400 },
      (_: unknown, index: number): string => {
        return `device-${index}.example`;
      },
    );

    let resolved: Map<string, Array<string>> = new Map();

    for (let report: number = 0; report < 40 && resolved.size < 400; report++) {
      resolved = await NetworkDeviceHydrationUtil.resolveHostnames({
        hostnames: names,
        budgetInMs: 40,
      });
    }

    // Every name, the last ones too, in the end.
    expect(resolved.size).toBe(400);
    expect(asked.size).toBe(400);
  });

  test("every DNS-named device a report reads has its name asked about", () => {
    expect(MAX_HOSTNAMES_PER_RESOLVE).toBeGreaterThanOrEqual(
      MAX_DNS_NAMED_DEVICES_PER_REPORT,
    );
  });

  test("no names, no lookup", async () => {
    const resolve: SpyInstance<typeof sharedCache.resolve> = jest.spyOn(
      sharedCache,
      "resolve",
    );

    expect(
      (await NetworkDeviceHydrationUtil.resolveHostnames({ hostnames: [] }))
        .size,
    ).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });
});
