// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  DEFAULT_REVERSE_DNS_FAILURE_BUDGET,
  ReverseDnsLookupFunction,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * OneUptime issue #3529 — "Network Discovery Scan should perform reverse DNS
 * lookup and display hostnames".
 *
 * This is the piece that talks to a resolver, so the whole suite runs against
 * an INJECTED lookup function: nothing here sends a real query, and every
 * failure mode a real resolver has is reproducible on demand.
 *
 * The contract being pinned is narrower than "does reverse DNS work", and the
 * narrow part is what matters. Reverse DNS is an enrichment bolted onto the
 * end of a sweep that has ALREADY SUCCEEDED. A scan that found twelve hosts
 * found twelve hosts whether or not any of them can be named — so the
 * resolver's job is to add names when it can and to get out of the way,
 * cheaply and silently, when it cannot. Every test below is ultimately about
 * one of those two halves.
 */

/*
 * A c-ares-shaped rejection: the code is what the classifier reads, and
 * getting that wrong in either direction is the bug this suite exists to
 * catch. Read as a failure when it is really "no record here", one ordinary
 * subnet disables naming for the rest of its own scan; read as "no record"
 * when the resolver is actually unreachable, every address in a /16 pays the
 * full timeout for nothing.
 */
function dnsError(code: string, message?: string): Error {
  const error: Error & { code?: string } = new Error(
    message || `queryPtr ${code}`,
  );
  error.code = code;
  return error;
}

function resolverWith(
  lookup: ReverseDnsLookupFunction,
  options?: {
    failureBudget?: number | undefined;
    concurrency?: number | undefined;
    totalBudgetInMs?: number | undefined;
    now?: (() => number) | undefined;
  },
): ReverseDnsResolver {
  return new ReverseDnsResolver({
    lookup: lookup,
    // Serial by default so per-address ordering assertions are deterministic.
    concurrency: options?.concurrency ?? 1,
    failureBudget: options?.failureBudget,
    totalBudgetInMs: options?.totalBudgetInMs,
    now: options?.now,
  });
}

beforeEach(() => {
  // These paths log on purpose; the suite asserts on them, not on stdout.
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ReverseDnsResolver — resolving names", () => {
  it("maps each address to its PTR name", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.18.166.51",
      "10.18.166.53",
    ]);

    expect(result.hostnameByIpAddress.get("10.18.166.51")).toBe(
      "host-51.corp.example.com",
    );
    expect(result.hostnameByIpAddress.get("10.18.166.53")).toBe(
      "host-53.corp.example.com",
    );
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.isTimeBudgetExhausted).toBe(false);
  });

  it("omits an address rather than mapping it to undefined", async () => {
    /*
     * Callers write `if (name)`. An explicit undefined value would make
     * `has()` and a truthiness check disagree about the same address, which
     * is the shape of bug normalizeDiscoveredHosts was written to end.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return [];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(result.hostnameByIpAddress.has("10.0.0.1")).toBe(false);
    expect(result.hostnameByIpAddress.size).toBe(0);
  });

  it("takes the first USABLE answer, not simply the first", async () => {
    /*
     * An address with several PTR records is legal. A junk first record — a
     * query name echoed back is the realistic one — must not hide a good
     * second one, or a host with a perfectly good name would show as its
     * address because of the order a resolver happened to return.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return [
          "51.166.18.10.in-addr.arpa",
          "core switch",
          "sw-core-01.corp.example.com",
          "later.example.com",
        ];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.18.166.51",
    ]);

    expect(result.hostnameByIpAddress.get("10.18.166.51")).toBe(
      "sw-core-01.corp.example.com",
    );
  });

  it("normalises the answer it stores", async () => {
    // The stored value is what a device gets named; it is never raw RDATA.
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return ["  SW-Core-01.corp.example.com.  "];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "SW-Core-01.corp.example.com",
    );
  });

  it("stores no name when every answer normalises away", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return ["10.0.0.1", "<script>alert(1)</script>", "   "];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(result.hostnameByIpAddress.size).toBe(0);
    // Not a failure — the resolver answered. Naming stays on.
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("asks for each address once, even when the sweep lists it twice", async () => {
    /*
     * The SNMP path appends hosts in completion order across two passes, so a
     * duplicate address is reachable. Paying for the same query twice is pure
     * waste, and on a large sweep it is waste against the time budget.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return ["host.example.com"];
      },
    );

    await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.1",
      "10.0.0.1",
    ]);

    expect(asked).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("asks nothing and reports availability for an empty sweep", async () => {
    const lookup: jest.Mock<ReverseDnsLookupFunction> = jest.fn(async () => {
      return [];
    }) as unknown as jest.Mock<ReverseDnsLookupFunction>;

    const result: ReverseDnsResolution = await resolverWith(
      lookup as unknown as ReverseDnsLookupFunction,
    ).resolveHostnames([]);

    expect(lookup).not.toHaveBeenCalled();
    expect(result.hostnameByIpAddress.size).toBe(0);
    expect(result.isReverseDnsAvailable).toBe(true);
  });
});

describe("ReverseDnsResolver — an address with no PTR record", () => {
  /*
   * The ORDINARY outcome. Most addresses on most networks have no reverse
   * record, so this must be free: no failure counted, no budget consumed, no
   * warning logged, naming still on for the rest of the sweep.
   */

  const noRecordCodes: Array<string> = [
    "ENOTFOUND",
    "ENODATA",
    "NOTFOUND",
    "NODATA",
    "EBADNAME",
    "EBADSTR",
  ];

  it.each(noRecordCodes)(
    "treats %s as 'no name here' rather than as a failure",
    async (code: string) => {
      const resolver: ReverseDnsResolver = resolverWith(
        async (): Promise<Array<string>> => {
          throw dnsError(code);
        },
        { failureBudget: 2 },
      );

      const result: ReverseDnsResolution = await resolver.resolveHostnames([
        "10.0.0.1",
        "10.0.0.2",
        "10.0.0.3",
        "10.0.0.4",
      ]);

      // Well past a failure budget of 2, and still on.
      expect(result.isReverseDnsAvailable).toBe(true);
      expect(result.failureReason).toBeUndefined();
      expect(result.hostnameByIpAddress.size).toBe(0);
    },
  );

  it("keeps asking every address when none of them has a record", async () => {
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        throw dnsError("ENOTFOUND");
      },
      { failureBudget: 2 },
    );

    await resolver.resolveHostnames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(asked).toHaveLength(3);
  });

  it("names the hosts that do have records among ones that do not", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        if (ipAddress === "10.0.0.2") {
          return ["printer.corp.example.com"];
        }
        throw dnsError("ENOTFOUND");
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);

    expect(result.hostnameByIpAddress.size).toBe(1);
    expect(result.hostnameByIpAddress.get("10.0.0.2")).toBe(
      "printer.corp.example.com",
    );
  });
});

describe("ReverseDnsResolver — a probe with no usable resolver", () => {
  /*
   * The case the failure budget exists for: a hardened probe container with
   * no resolver configured, or one whose DNS is firewalled. Without a budget
   * every discovered address in a large sweep would pay the full per-address
   * timeout to learn the same thing the first ten already established.
   */

  it("stops asking once the failure budget is spent and nothing has resolved", async () => {
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        throw dnsError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.53:53");
      },
      { failureBudget: 3 },
    );

    const addresses: Array<string> = Array.from(
      { length: 50 },
      (_unused: unknown, index: number) => {
        return `10.0.0.${index + 1}`;
      },
    );

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    expect(asked).toHaveLength(3);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.failureReason).toContain("ECONNREFUSED");
  });

  it("says why, once, in the probe log", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        throw dnsError("ESERVFAIL");
      },
      { failureBudget: 2 },
    );

    await resolver.resolveHostnames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    /*
     * Exactly one line. The budget is spent once, and a warning per skipped
     * address would bury the sentence that explains the whole scan.
     */
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String((logger.warn as jest.Mock).mock.calls[0]![0])).toContain(
      "reverse DNS",
    );
  });

  it("keeps the FIRST failure reason, not the last", async () => {
    // They are all the same failure; the first is the one with context.
    let call: number = 0;
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        call++;
        throw dnsError("ECONNREFUSED", `failure number ${call}`);
      },
      { failureBudget: 3 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);

    expect(result.failureReason).toBe("failure number 1");
  });

  it("counts our own timeout as an infrastructure failure", async () => {
    /*
     * A wedged resolver rejects through the race guard with a plain Error and
     * no code. That is the archetypal "resolver is broken" case, so an
     * unrecognised error must default to counting — the opposite default
     * would make the budget unreachable exactly when it is needed.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        throw new Error(`Reverse DNS lookup for ${ipAddress} timed out`);
      },
      { failureBudget: 2 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
    ]);

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.failureReason).toContain("timed out");
  });

  it("never rejects, whatever the lookup throws", async () => {
    /*
     * The one guarantee that outranks every other in this file: a sweep that
     * succeeded must not be lost on the way out of it.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        // eslint-disable-next-line no-throw-literal
        throw "a string, not an Error";
      },
    );

    await expect(
      resolver.resolveHostnames(["10.0.0.1", "10.0.0.2"]),
    ).resolves.toBeDefined();
  });

  it("defaults to a budget generous enough to survive a sparse subnet", () => {
    /*
     * The budget only counts INFRASTRUCTURE failures, so an address with no
     * record never touches it — but the number should still be comfortably
     * above "a couple of flaky queries".
     */
    expect(DEFAULT_REVERSE_DNS_FAILURE_BUDGET).toBeGreaterThanOrEqual(5);
  });
});

describe("ReverseDnsResolver — a resolver that works but not for everything", () => {
  /*
   * The awkward middle case, and the reason the budget is conditional. A
   * resolver that has answered for ONE address is present and working, so a
   * later timeout is a fact about that address (a stale delegation, a reverse
   * zone whose nameserver is down) rather than about the probe. Disabling
   * naming over it would throw away names that would have resolved fine.
   */

  it("keeps going past the failure budget once any address has resolved", async () => {
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        if (ipAddress === "10.0.0.1") {
          return ["gateway.corp.example.com"];
        }

        throw dnsError("ETIMEOUT");
      },
      { failureBudget: 2 },
    );

    const addresses: Array<string> = Array.from(
      { length: 10 },
      (_unused: unknown, index: number) => {
        return `10.0.0.${index + 1}`;
      },
    );

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    expect(asked).toHaveLength(10);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "gateway.corp.example.com",
    );
  });

  it("still trips the budget when the failures come BEFORE the first success", async () => {
    /*
     * Order decides this, which is worth pinning: the budget is spent on the
     * first three addresses, so the fourth — which would have resolved — is
     * never asked. That is the correct trade. Ten failures with nothing to
     * show is the signature of a probe that cannot resolve at all, and paying
     * a full sweep of timeouts on the chance that address 4001 is different
     * is what the budget exists to refuse.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        if (ipAddress === "10.0.0.4") {
          return ["late.corp.example.com"];
        }
        throw dnsError("ECONNREFUSED");
      },
      { failureBudget: 3 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
    ]);

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.hostnameByIpAddress.size).toBe(0);
  });
});

describe("ReverseDnsResolver — the wall-clock budget", () => {
  /*
   * The failure budget cannot bound the case where SOME addresses resolve and
   * many time out: it is disarmed by the first success and the pass then runs
   * to completion. On a sweep with thousands of live hosts that is minutes,
   * spent inside a sweep that is itself under a deadline — so an enrichment
   * would be able to turn an already-successful scan into a failed one. This
   * budget is what makes that impossible.
   */

  function clockAdvancingBy(stepInMs: number): () => number {
    let current: number = 0;
    return (): number => {
      const value: number = current;
      current += stepInMs;
      return value;
    };
  }

  it("stops starting lookups once the budget is spent", async () => {
    const asked: Array<string> = [];
    /*
     * `now` is read once for the deadline and then once per address, so a
     * 100ms step against a 350ms budget leaves room for addresses at t=100,
     * 200 and 300.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return [`host-${asked.length}.example.com`];
      },
      { totalBudgetInMs: 350, now: clockAdvancingBy(100) },
    );

    const addresses: Array<string> = Array.from(
      { length: 20 },
      (_unused: unknown, index: number) => {
        return `10.0.0.${index + 1}`;
      },
    );

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    expect(asked).toHaveLength(3);
    expect(result.isTimeBudgetExhausted).toBe(true);
    // The resolver itself was fine; it simply ran out of time.
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("keeps the names it resolved before the budget ran out", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        return [`host-${ipAddress.split(".").pop()}.example.com`];
      },
      { totalBudgetInMs: 250, now: clockAdvancingBy(100) },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
    ]);

    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "host-1.example.com",
    );
    expect(result.hostnameByIpAddress.get("10.0.0.2")).toBe(
      "host-2.example.com",
    );
    expect(result.hostnameByIpAddress.has("10.0.0.3")).toBe(false);
  });

  it("warns once, not once per skipped address", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return ["host.example.com"];
      },
      { totalBudgetInMs: 150, now: clockAdvancingBy(100) },
    );

    await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
    ]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("reports a budget it never came close to as not exhausted", async () => {
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return ["host.example.com"];
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("ReverseDnsResolver — concurrency", () => {
  it("runs at most `concurrency` lookups at once", async () => {
    let inFlight: number = 0;
    let peak: number = 0;

    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1);
        });
        inFlight--;
        return ["host.example.com"];
      },
      { concurrency: 4 },
    );

    const addresses: Array<string> = Array.from(
      { length: 40 },
      (_unused: unknown, index: number) => {
        return `10.0.0.${index + 1}`;
      },
    );

    await resolver.resolveHostnames(addresses);

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("resolves every address when there are fewer than the concurrency", async () => {
    // The worker pool must not deadlock or drop work on a short list.
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        return [`host-${ipAddress.split(".").pop()}.example.com`];
      },
      { concurrency: 32 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
    ]);

    expect(result.hostnameByIpAddress.size).toBe(2);
  });
});
