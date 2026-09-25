// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  buildDefaultLookup,
  buildDefaultRescueLookup,
  buildDefaultRetryLookup,
  DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS,
  MAX_REVERSE_DNS_RETRY_SERVERS,
  REVERSE_DNS_RETRY_RACE_SLACK_IN_MS,
  ReverseDnsLookupFunction,
  toReverseLookupName,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  FakeResolverCall,
  FakeResolverFactory,
  FakeReverseDnsResolver,
  fakeDnsError,
  fakeResolverFactory,
  fakeReverseDnsResolver,
  neverSettles,
} from "../../TestingUtils/FakeReverseDnsResolver";
import { describe, expect, it } from "@jest/globals";

/*
 * OneUptime issue #3916 — WHICH query the probe sends, to WHICH server, and
 * when it gives up.
 *
 * Everything here runs against fake resolvers that record every call
 * (TestingUtils/FakeReverseDnsResolver.ts), because none of it is visible in
 * a lookup's result: a lookup that asked reverse() instead of resolvePtr()
 * still names a healthy host, and a retry that asked the primary three times
 * instead of each server once still names a host whose primary is fine. What
 * those mistakes cost is precisely the customer's report — every DNS failure
 * filed as "no PTR record", and a dead primary nameserver taking every name
 * with it — so the calls themselves are the assertion.
 *
 * NO TEST HERE SENDS A QUERY. The same code against the real c-ares is
 * ReverseDnsResolverRealResolver.test.ts.
 */

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

function methodsCalled(resolver: FakeReverseDnsResolver): Array<string> {
  return resolver.calls.map((call: FakeResolverCall): string => {
    return call.method;
  });
}

describe("toReverseLookupName — the in-addr.arpa name for an IPv4 address", () => {
  it.each([
    ["10.18.166.51", "51.166.18.10.in-addr.arpa"],
    ["10.16.42.51", "51.42.16.10.in-addr.arpa"],
    ["192.168.1.1", "1.1.168.192.in-addr.arpa"],
    ["0.0.0.0", "0.0.0.0.in-addr.arpa"],
    ["255.255.255.255", "255.255.255.255.in-addr.arpa"],
    ["1.2.3.4", "4.3.2.1.in-addr.arpa"],
    ["100.64.0.10", "10.0.64.100.in-addr.arpa"],
  ])("maps %s to %s", (ipAddress: string, name: string) => {
    expect(toReverseLookupName(ipAddress)).toBe(name);
  });

  it.each([
    // IPv6 in every spelling stays on reverse().
    ["IPv6 loopback", "::1"],
    ["a link-local IPv6 address", "fe80::1"],
    ["a scoped IPv6 address", "fe80::1%eth0"],
    ["an IPv4-mapped IPv6 address", "::ffff:10.0.0.1"],
    // Whitespace anywhere: the sweep never produces it, and it is not trimmed.
    ["an address padded with spaces", " 10.18.166.51 "],
    ["an address with a trailing newline", "10.18.166.51\n"],
    ["an address with a leading tab", "\t10.18.166.51"],
    // Things that look like an address and are not one.
    ["an address with a CIDR suffix", "10.18.166.51/32"],
    ["an address with a port", "10.18.166.51:53"],
    ["an octet above 255", "10.18.166.256"],
    ["a leading zero", "010.18.166.51"],
    ["three octets", "10.18.166"],
    ["five octets", "10.18.166.51.1"],
    ["a trailing dot", "10.18.166.51."],
    ["a negative octet", "10.18.-1.51"],
    ["a hostname", "sw-core-01.corp.example.com"],
    ["a word", "not-an-ip-address"],
    ["the empty string", ""],
  ])("refuses %s (%p)", (_label: string, value: string) => {
    expect(toReverseLookupName(value)).toBeUndefined();
  });

  it.each([
    ["a number", 167772161],
    ["undefined", undefined],
    ["null", null],
    [
      "an object",
      {
        toString: (): string => {
          return "10.0.0.1";
        },
      },
    ],
  ])(
    "refuses %s that reached it through a cast",
    (_label: string, value: unknown) => {
      /*
       * The argument is typed string, but it arrives from a sweep result that
       * a public method passes through; an object whose toString() happens to
       * spell an address must not become a query.
       */
      expect(toReverseLookupName(value as string)).toBeUndefined();
    },
  );
});

describe("buildDefaultLookup — which query an address is asked with", () => {
  it("asks an IPv4 address with resolvePtr on its in-addr.arpa name, not with reverse()", async () => {
    /*
     * THE change behind issue #3916's first defect. reverse() reported
     * SERVFAIL, REFUSED, NODATA, "nothing listening" and c-ares' own timeout
     * all as ENOTFOUND; resolvePtr rejects with the code the server sent.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: async (): Promise<Array<string>> => {
        return ["sw-core-01.corp.example.com"];
      },
    });

    const names: Array<string> = await buildDefaultLookup(
      500,
      factory.create,
    )("10.18.166.51");

    expect(names).toEqual(["sw-core-01.corp.example.com"]);
    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]!.calls).toEqual([
      { method: "resolvePtr", argument: "51.166.18.10.in-addr.arpa" },
    ]);
    // The first pass's own timeout, handed to the resolver unchanged.
    expect(factory.created[0]!.timeoutInMs).toBe(500);
  });

  it("builds a FRESH resolver for every lookup", async () => {
    /*
     * A shared channel would size its timeouts from the latency it had
     * already seen, and would give the race one cancel() for every lookup
     * in the wave. One per lookup, always.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: async (): Promise<Array<string>> => {
        return ["host.example.com"];
      },
    });
    const lookup: ReverseDnsLookupFunction = buildDefaultLookup(
      500,
      factory.create,
    );

    await lookup("10.0.0.1");
    await lookup("10.0.0.2");
    await lookup("10.0.0.1");

    expect(factory.created).toHaveLength(3);
    expect(
      factory.created.map((resolver: FakeReverseDnsResolver): unknown => {
        return resolver.calls[0]!.argument;
      }),
    ).toEqual([
      "1.0.0.10.in-addr.arpa",
      "2.0.0.10.in-addr.arpa",
      "1.0.0.10.in-addr.arpa",
    ]);
  });

  it.each([
    ["IPv6", "::1"],
    ["a padded address", " 10.18.166.51 "],
    ["junk", "not-an-ip-address"],
    ["a CIDR", "10.18.166.51/32"],
  ])(
    "asks %s with reverse(), exactly as given, and never builds a query name for it",
    async (_label: string, value: string) => {
      /*
       * reverse() is what rejects a malformed argument with EINVAL inside
       * c-ares, before a packet is built — the property the network-free
       * test in ReverseDnsResolver.test.ts relies on. Anything that is not
       * exactly IPv4 must keep reaching it untouched.
       */
      const factory: FakeResolverFactory = fakeResolverFactory({
        reverse: (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("EINVAL", "getHostByAddr EINVAL"));
        },
      });

      await expect(
        buildDefaultLookup(500, factory.create)(value),
      ).rejects.toMatchObject({ code: "EINVAL" });

      expect(factory.created[0]!.calls).toEqual([
        { method: "reverse", argument: value },
      ]);
    },
  );

  it("passes an IPv6 name from reverse() straight through", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      reverse: async (): Promise<Array<string>> => {
        return ["ip6-localhost"];
      },
    });

    await expect(
      buildDefaultLookup(500, factory.create)("::1"),
    ).resolves.toEqual(["ip6-localhost"]);
  });

  it.each(["ESERVFAIL", "EREFUSED", "ECONNREFUSED", "ETIMEOUT", "ENOTIMP"])(
    "rejects with resolvePtr's own %s, the very same error object",
    async (code: string) => {
      const error: Error = fakeDnsError(code);
      const factory: FakeResolverFactory = fakeResolverFactory({
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(error);
        },
      });

      const rejection: unknown = await buildDefaultLookup(
        500,
        factory.create,
      )("10.18.166.51").catch((caught: unknown): unknown => {
        return caught;
      });

      expect(rejection).toBe(error);
      /*
       * And nothing else is asked: reverse() here would only turn the real
       * code back into ENOTFOUND, and the hosts file is the pass's business,
       * read before any lookup (ReverseDnsResolverHostsFile.test.ts).
       */
      expect(methodsCalled(factory.created[0]!)).toEqual(["resolvePtr"]);
    },
  );
});

describe("buildDefaultLookup — one DNS query, and never the hosts file", () => {
  /*
   * OneUptime issue #3916. reverse() read the hosts file before asking DNS;
   * resolvePtr never reads it. The pass now reads the file itself, before
   * any lookup is made (ReverseDnsResolverHostsFile.test.ts). It used to be
   * read HERE, by a second reverse() after an NXDOMAIN, inside the same race
   * — and reverse() asks DNS again after the file, so on a server that took
   * 1.1 seconds per answer the second query lost the two-second race and a
   * "no record" that had arrived in time was reported as a timeout: retried,
   * counted against the failure budget, and on a big enough sweep blamed on
   * the probe's first nameserver. One lookup is now one query.
   */

  it.each(["ENOTFOUND", "ENODATA"])(
    "rejects with resolvePtr's own %s, the very same error, and asks nothing else",
    async (code: string) => {
      const original: Error = fakeDnsError(code, `queryPtr ${code} original`);
      const factory: FakeResolverFactory = fakeResolverFactory({
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(original);
        },
        reverse: async (): Promise<Array<string>> => {
          return ["never-asked.example"];
        },
      });

      const rejection: unknown = await buildDefaultLookup(
        500,
        factory.create,
      )("10.16.42.70").catch((caught: unknown): unknown => {
        return caught;
      });

      expect(rejection).toBe(original);
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0]!.calls).toEqual([
        { method: "resolvePtr", argument: "70.42.16.10.in-addr.arpa" },
      ]);
    },
  );

  it("reports a slow NXDOMAIN that arrived in time as NXDOMAIN, not as a timeout", async () => {
    /*
     * The finding's reproduction, scaled down: the server answers NXDOMAIN
     * at 60% of the race, and anything asked after that would take longer
     * than the time left (here, forever). The old fallback asked reverse()
     * then, and the race reported ETIMEOUT for an address the server had
     * already answered.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: async (): Promise<Array<string>> => {
        await sleep(150);
        throw fakeDnsError("ENOTFOUND");
      },
      reverse: (): Promise<Array<string>> => {
        return neverSettles();
      },
    });

    await expect(
      buildDefaultLookup(250, factory.create)("10.9.9.1"),
    ).rejects.toMatchObject({ code: "ENOTFOUND" });

    expect(methodsCalled(factory.created[0]!)).toEqual(["resolvePtr"]);
    expect(factory.created[0]!.cancelCount).toBe(0);
  });

  it("starts nothing when a late NXDOMAIN lands after the race was lost", async () => {
    /*
     * The race gave up and cancelled; the answer lands afterwards. Nothing
     * may be started then — it would be a query nobody waits for and
     * nothing will ever cancel.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: async (): Promise<Array<string>> => {
        await sleep(80);
        throw fakeDnsError("ENOTFOUND");
      },
      reverse: async (): Promise<Array<string>> => {
        return ["too-late.example.com"];
      },
    });

    await expect(
      buildDefaultLookup(20, factory.create)("10.16.42.52"),
    ).rejects.toMatchObject({ code: "ETIMEOUT" });

    // Let the late NXDOMAIN arrive.
    await sleep(120);

    expect(methodsCalled(factory.created[0]!)).toEqual([
      "resolvePtr",
      "cancel",
    ]);
  });
});

describe("buildDefaultLookup — the race", () => {
  it("rejects with ETIMEOUT and a message naming the address and the budget", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: (): Promise<Array<string>> => {
        return neverSettles();
      },
    });

    await expect(
      buildDefaultLookup(25, factory.create)("10.16.42.61"),
    ).rejects.toMatchObject({
      code: "ETIMEOUT",
      message: "Reverse DNS lookup for 10.16.42.61 timed out after 25ms",
    });
    expect(factory.created[0]!.cancelCount).toBe(1);
  });

  it("races the first attempt at exactly its timeout — no slack on the first pass", async () => {
    /*
     * Deliberate. A healthy address answers in milliseconds, and the retry
     * pass — not a longer first attempt — is what rescues a slow one. Slack
     * here would make every black-holed address cost the whole first pass
     * more, for nothing.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: (): Promise<Array<string>> => {
        return neverSettles();
      },
    });

    const startedAt: number = Date.now();

    await expect(
      buildDefaultLookup(50, factory.create)("10.16.42.61"),
    ).rejects.toMatchObject({ code: "ETIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(
      50 + REVERSE_DNS_RETRY_RACE_SLACK_IN_MS / 2,
    );
  });
});

describe("buildDefaultRetryLookup — each configured nameserver, in turn", () => {
  /*
   * c-ares will not move past a SERVFAIL or REFUSED from the first server —
   * Node runs it with NOCHECKRESP — and moves past a silent one only once
   * the whole timeout is spent, which the first pass's race always ends
   * first. So the retry pins a fresh resolver to each configured server,
   * one at a time.
   */

  function serverScript(
    outcomes: Record<string, () => Promise<Array<string>>>,
    configured: Array<string>,
  ): FakeResolverFactory {
    return fakeResolverFactory({
      servers: configured,
      resolvePtr: (
        _hostname: string,
        resolver: FakeReverseDnsResolver,
      ): Promise<Array<string>> => {
        const pinned: string = resolver.servers.join(",");
        const outcome: (() => Promise<Array<string>>) | undefined =
          outcomes[pinned];

        return outcome
          ? outcome()
          : Promise.reject(new Error(`unpinned query to ${pinned}`));
      },
      reverse: (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ENOTFOUND", "getHostByAddr"));
      },
    });
  }

  function pinnedServers(factory: FakeResolverFactory): Array<string> {
    return factory.created
      .filter((resolver: FakeReverseDnsResolver): boolean => {
        return resolver.calls.some((call: FakeResolverCall): boolean => {
          return call.method === "setServers";
        });
      })
      .map((resolver: FakeReverseDnsResolver): string => {
        return resolver.servers.join(",");
      });
  }

  it("asks the primary first, and stops at its answer", async () => {
    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": async (): Promise<Array<string>> => {
          return ["kds-01.wbhq.example"];
        },
      },
      ["10.0.0.2", "10.0.0.3"],
    );

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
    ).resolves.toEqual(["kds-01.wbhq.example"]);

    expect(pinnedServers(factory)).toEqual(["10.0.0.2"]);
  });

  it.each([
    ["SERVFAIL", "ESERVFAIL"],
    ["REFUSED", "EREFUSED"],
    ["a timeout", "ETIMEOUT"],
    ["nothing listening", "ECONNREFUSED"],
    ["an unknown failure", "ENOTIMP"],
  ])(
    "moves on to the secondary after %s from the primary",
    async (_label: string, code: string) => {
      const factory: FakeResolverFactory = serverScript(
        {
          "10.0.0.2": (): Promise<Array<string>> => {
            return Promise.reject(fakeDnsError(code));
          },
          "10.0.0.3": async (): Promise<Array<string>> => {
            return ["kds-01.wbhq.example"];
          },
        },
        ["10.0.0.2", "10.0.0.3"],
      );

      await expect(
        buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
      ).resolves.toEqual(["kds-01.wbhq.example"]);

      expect(pinnedServers(factory)).toEqual(["10.0.0.2", "10.0.0.3"]);
    },
  );

  it("reads the configuration from a fresh resolver, then pins a NEW resolver to each server, with the retry's timeout", async () => {
    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("ESERVFAIL"));
        },
        "10.0.0.3": async (): Promise<Array<string>> => {
          return ["kds-01.wbhq.example"];
        },
      },
      ["10.0.0.2", "10.0.0.3"],
    );

    await buildDefaultRetryLookup(4000, factory.create)("10.16.42.51");

    expect(factory.created).toHaveLength(3);
    expect(factory.created[0]!.calls).toEqual([{ method: "getServers" }]);
    expect(factory.created[1]!.calls).toEqual([
      { method: "setServers", argument: ["10.0.0.2"] },
      { method: "resolvePtr", argument: "51.42.16.10.in-addr.arpa" },
    ]);
    expect(factory.created[2]!.calls).toEqual([
      { method: "setServers", argument: ["10.0.0.3"] },
      { method: "resolvePtr", argument: "51.42.16.10.in-addr.arpa" },
    ]);

    for (const resolver of factory.created) {
      expect(resolver.timeoutInMs).toBe(4000);
    }
  });

  it("asks at most three servers, however many are configured", async () => {
    const configured: Array<string> = [
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
      "10.0.0.6",
    ];
    const outcomes: Record<string, () => Promise<Array<string>>> = {};

    for (const server of configured) {
      outcomes[server] = (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ESERVFAIL", `from ${server}`));
      };
    }

    const factory: FakeResolverFactory = serverScript(outcomes, configured);

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
    ).rejects.toMatchObject({ code: "ESERVFAIL" });

    expect(MAX_REVERSE_DNS_RETRY_SERVERS).toBe(3);
    expect(pinnedServers(factory)).toEqual(configured.slice(0, 3));
  });

  it("rejects with the FIRST server's error when every server fails", async () => {
    /*
     * The primary is the server the probe normally uses, so its failure is
     * the one that describes the probe's normal path — not whichever server
     * happened to be asked last.
     */
    const primaryError: Error = fakeDnsError("ESERVFAIL", "from the primary");

    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": (): Promise<Array<string>> => {
          return Promise.reject(primaryError);
        },
        "10.0.0.3": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("ETIMEOUT", "from the second"));
        },
        "10.0.0.4": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("EREFUSED", "from the third"));
        },
      },
      ["10.0.0.2", "10.0.0.3", "10.0.0.4"],
    );

    const rejection: unknown = await buildDefaultRetryLookup(
      4000,
      factory.create,
    )("10.16.42.51").catch((caught: unknown): unknown => {
      return caught;
    });

    expect(rejection).toBe(primaryError);
    expect(pinnedServers(factory)).toHaveLength(3);
  });

  it.each([
    ["NXDOMAIN", "ENOTFOUND"],
    ["NODATA", "ENODATA"],
  ])(
    "stops at the primary's %s: a server that says 'no record' is not second-guessed",
    async (_label: string, code: string) => {
      /*
       * Hunting across servers for one that disagrees would make naming
       * depend on which server happened to be asked, and turn a zone that
       * is missing records on one server into an intermittent symptom. The
       * PRIMARY's word on it is final; see the server-health suite below for
       * whose else is.
       */
      const noRecord: Error = fakeDnsError(code);
      const factory: FakeResolverFactory = serverScript(
        {
          "10.0.0.2": (): Promise<Array<string>> => {
            return Promise.reject(noRecord);
          },
          "10.0.0.3": async (): Promise<Array<string>> => {
            return ["never-asked.example"];
          },
        },
        ["10.0.0.2", "10.0.0.3"],
      );

      const rejection: unknown = await buildDefaultRetryLookup(
        4000,
        factory.create,
      )("10.16.42.52").catch((caught: unknown): unknown => {
        return caught;
      });

      expect(rejection).toBe(noRecord);
      expect(pinnedServers(factory)).toEqual(["10.0.0.2"]);
      // One query, and no hosts-file reverse() after it.
      expect(methodsCalled(factory.created[1]!)).toEqual([
        "setServers",
        "resolvePtr",
      ]);
    },
  );

  it.each(["ENOTFOUND", "ESERVFAIL"])(
    "never asks reverse() of an IPv4 address on any server, after %s either",
    async (code: string) => {
      /*
       * The hosts file is read by the pass before the first attempt; a
       * retry that asked reverse() would send a second DNS query per server
       * for nothing.
       */
      const factory: FakeResolverFactory = fakeResolverFactory({
        servers: ["10.0.0.2", "10.0.0.3"],
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError(code));
        },
        reverse: async (): Promise<Array<string>> => {
          return ["kds-from-hosts-file"];
        },
      });

      await expect(
        buildDefaultRetryLookup(4000, factory.create)("10.16.42.70"),
      ).rejects.toMatchObject({ code: code });

      for (const resolver of factory.created) {
        expect(methodsCalled(resolver)).not.toContain("reverse");
      }
    },
  );

  it("stops at a malformed-input rejection: no server can fix the argument", async () => {
    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("EBADNAME"));
        },
        "10.0.0.3": async (): Promise<Array<string>> => {
          return ["never-asked.example"];
        },
      },
      ["10.0.0.2", "10.0.0.3"],
    );

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
    ).rejects.toMatchObject({ code: "EBADNAME" });
    expect(pinnedServers(factory)).toEqual(["10.0.0.2"]);
  });

  it("asks each server once even when the configuration lists it twice", async () => {
    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("ESERVFAIL"));
        },
        "10.0.0.3": (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("ESERVFAIL"));
        },
      },
      ["10.0.0.2", "10.0.0.2", "10.0.0.3"],
    );

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.54"),
    ).rejects.toMatchObject({ code: "ESERVFAIL" });
    expect(pinnedServers(factory)).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  it("skips a server the resolver will not take, rather than asking the primary again in its place", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: ["not a server", "10.0.0.3"],
      setServers: (servers: Array<string>): void => {
        if (servers[0] === "not a server") {
          throw new TypeError("ERR_INVALID_IP_ADDRESS");
        }
      },
      resolvePtr: async (
        _hostname: string,
        resolver: FakeReverseDnsResolver,
      ): Promise<Array<string>> => {
        return [`answered-by-${resolver.servers.join(",")}`];
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
    ).resolves.toEqual(["answered-by-10.0.0.3"]);

    // The refused resolver was never used to ask anything.
    expect(methodsCalled(factory.created[1]!)).toEqual(["setServers"]);
  });

  it("reports a server's DNS failure rather than another server's refused spelling", async () => {
    /*
     * The primary could not be pinned; the secondary answered SERVFAIL. The
     * SERVFAIL is the thing to report — it says something about DNS — even
     * though the pinning failure came first.
     */
    const servfail: Error = fakeDnsError("ESERVFAIL", "from the secondary");
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: ["not a server", "10.0.0.3"],
      setServers: (servers: Array<string>): void => {
        if (servers[0] === "not a server") {
          throw new TypeError("ERR_INVALID_IP_ADDRESS");
        }
      },
      resolvePtr: (): Promise<Array<string>> => {
        return Promise.reject(servfail);
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.54"),
    ).rejects.toBe(servfail);
  });

  it("rejects with the pinning error when no server could be asked at all", async () => {
    const refused: TypeError = new TypeError("ERR_INVALID_IP_ADDRESS");
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: ["not a server"],
      setServers: (): void => {
        throw refused;
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.54"),
    ).rejects.toBe(refused);
    // Nothing was asked of any resolver.
    for (const resolver of factory.created) {
      expect(methodsCalled(resolver)).not.toContain("resolvePtr");
    }
  });

  it("makes ONE attempt on a default resolver when no server is configured", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: [],
      resolvePtr: async (): Promise<Array<string>> => {
        return ["kds-01.wbhq.example"];
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
    ).resolves.toEqual(["kds-01.wbhq.example"]);

    // The resolver that reported no servers is the one that asks.
    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]!.calls).toEqual([
      { method: "getServers" },
      { method: "resolvePtr", argument: "51.42.16.10.in-addr.arpa" },
    ]);
  });

  it.each([
    [
      "throws",
      (): Array<string> => {
        throw new Error("channel closed");
      },
    ],
    [
      "returns something that is not a list",
      (): Array<string> => {
        return "10.0.0.2" as unknown as Array<string>;
      },
    ],
    [
      "returns only empty strings",
      (): Array<string> => {
        return [""];
      },
    ],
  ])(
    "makes one default attempt when getServers() %s",
    async (_label: string, getServers: () => Array<string>) => {
      const factory: FakeResolverFactory = fakeResolverFactory({
        getServers: getServers,
        resolvePtr: async (): Promise<Array<string>> => {
          return ["kds-01.wbhq.example"];
        },
      });

      await expect(
        buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
      ).resolves.toEqual(["kds-01.wbhq.example"]);
      expect(factory.created).toHaveLength(1);
    },
  );

  it("asks a value that is not IPv4 once, with reverse(), and walks no servers", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: ["10.0.0.2", "10.0.0.3"],
      reverse: (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("EINVAL"));
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)(" 10.16.42.51 "),
    ).rejects.toMatchObject({ code: "EINVAL" });

    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]!.calls).toEqual([
      { method: "reverse", argument: " 10.16.42.51 " },
    ]);
  });

  it("moves on from a silent server once its attempt's race is lost, cancelling only that server's query", async () => {
    const factory: FakeResolverFactory = serverScript(
      {
        "10.0.0.2": (): Promise<Array<string>> => {
          return neverSettles();
        },
        "10.0.0.3": async (): Promise<Array<string>> => {
          return ["kds-01.wbhq.example"];
        },
      },
      ["10.0.0.2", "10.0.0.3"],
    );

    // A 10ms c-ares timeout: the race is 10ms plus the one-second slack.
    await expect(
      buildDefaultRetryLookup(10, factory.create)("10.16.42.51"),
    ).resolves.toEqual(["kds-01.wbhq.example"]);

    expect(factory.created[1]!.cancelCount).toBe(1);
    expect(factory.created[2]!.cancelCount).toBe(0);
  });

  it("gives each attempt its timeout PLUS the slack before the race abandons it", async () => {
    /*
     * On the retry the race is a backstop for a resolver that never calls
     * back, not the timeout itself: c-ares ends a silent query with its own
     * ETIMEOUT at the configured timeout. Racing at exactly that instant, as
     * the first pass does, would cancel() attempts c-ares was about to
     * finish on its own. This fake never calls back, so only the race can
     * end it — and not before the timeout plus the slack.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: [],
      resolvePtr: (): Promise<Array<string>> => {
        return neverSettles();
      },
    });

    const startedAt: number = Date.now();
    const attempt: Promise<Array<string>> = buildDefaultRetryLookup(
      10,
      factory.create,
    )("10.16.42.61");

    // Well past the 10ms c-ares timeout, and still waiting.
    await sleep(300);
    expect(factory.created[0]!.cancelCount).toBe(0);

    await expect(attempt).rejects.toMatchObject({
      code: "ETIMEOUT",
      message: `Reverse DNS lookup for 10.16.42.61 timed out after ${
        10 + REVERSE_DNS_RETRY_RACE_SLACK_IN_MS
      }ms`,
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      10 + REVERSE_DNS_RETRY_RACE_SLACK_IN_MS - 5,
    );
    expect(factory.created[0]!.cancelCount).toBe(1);
  });
});

describe("the retry's budget, as shipped", () => {
  it("waits twice as long as the first attempt, and bounds one address's retry at fifteen seconds", () => {
    /*
     * Pinned as figures because other arithmetic leans on them: the retry
     * wave is the longest a pass can overrun its deadline by, and the reaper
     * sum in Tests/ConfigDiscoveryNamingBudget.test.ts adds "one wave in
     * flight" to the reverse-DNS budget.
     */
    expect(DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS).toBe(2000);
    expect(DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS).toBe(4000);
    expect(REVERSE_DNS_RETRY_RACE_SLACK_IN_MS).toBe(1000);
    expect(MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS).toBe(15000);
    expect(MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS).toBe(
      MAX_REVERSE_DNS_RETRY_SERVERS *
        (DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS +
          REVERSE_DNS_RETRY_RACE_SLACK_IN_MS),
    );
  });

  it("defaults its per-attempt timeout to the shipped retry timeout", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: [],
      resolvePtr: async (): Promise<Array<string>> => {
        return ["kds-01.wbhq.example"];
      },
    });

    await buildDefaultRetryLookup(undefined, factory.create)("10.16.42.51");

    expect(factory.created[0]!.timeoutInMs).toBe(
      DEFAULT_REVERSE_DNS_RETRY_TIMEOUT_IN_MS,
    );
  });

  it("uses a fresh fake per call through fakeReverseDnsResolver as well", () => {
    // A guard on the helper: two fakes never share a call log.
    const first: FakeReverseDnsResolver = fakeReverseDnsResolver();
    const second: FakeReverseDnsResolver = fakeReverseDnsResolver();

    first.cancel();

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });
});

/*
 * The two server walks (#3916), and why they differ.
 *
 * The RETRY walk is stateless: configured order every time, and a "no
 * record" is final only from the primary. The Helm chart gives the probe pod
 * [CoreDNS, 8.8.8.8, 1.1.1.1], and a public resolver answers NXDOMAIN for
 * every private address — so after a failing primary, a later server may
 * still NAME the address, but its NXDOMAIN must not turn a failed lookup
 * into "no PTR record". Being stateless is the point: what an address is
 * called never depends on which address was asked before it.
 *
 * The RESCUE walk is used only after a budget's worth of first-try lookups
 * met silence with not one response — the evidence that the primary is
 * down. There, and only there, the primary is asked last until it names
 * something, a server that has NAMED something is asked first, and its
 * NXDOMAIN is trusted: a name for a private address is what a public
 * resolver never gives.
 *
 * Both replaced a shared "server health" record the retry walk used to keep,
 * which inferred a dead primary from retry walks alone — and a primary that
 * is silent only for the one zone the retry pass is made of looks dead from
 * there, so it was demoted and a secondary's NXDOMAIN made final.
 */
describe("the server walks — whose word ends the walk, and who is asked first", () => {
  const PRIMARY: string = "10.0.0.2";
  const SECONDARY: string = "10.0.0.3";
  const TERTIARY: string = "10.0.0.4";

  type ServerOutcome = (ipAddress: string) => Promise<Array<string>>;

  /*
   * Each server scripted per address: what a resolver PINNED to that server
   * answers for the address it was asked about.
   */
  function scriptedServers(data: {
    outcomes: Record<string, ServerOutcome>;
    configured: Array<string>;
    unpinnable?: Array<string> | undefined;
  }): FakeResolverFactory {
    return fakeResolverFactory({
      servers: data.configured,
      setServers: (servers: Array<string>): void => {
        if (data.unpinnable?.includes(servers[0]!)) {
          throw new Error(`cannot pin ${servers[0]}`);
        }
      },
      resolvePtr: (
        hostname: string,
        resolver: FakeReverseDnsResolver,
      ): Promise<Array<string>> => {
        const pinned: string = resolver.servers.join(",");
        const outcome: ServerOutcome | undefined = data.outcomes[pinned];
        const ipAddress: string = hostname
          .replace(".in-addr.arpa", "")
          .split(".")
          .reverse()
          .join(".");

        return outcome
          ? outcome(ipAddress)
          : Promise.reject(new Error(`unpinned query to ${pinned}`));
      },
    });
  }

  // The servers each lookup pinned, in the order it pinned them.
  function pinnedSince(
    factory: FakeResolverFactory,
    fromIndex: number,
  ): Array<string> {
    return factory.created
      .slice(fromIndex)
      .filter((resolver: FakeReverseDnsResolver): boolean => {
        return resolver.calls.some((call: FakeResolverCall): boolean => {
          return call.method === "setServers";
        });
      })
      .map((resolver: FakeReverseDnsResolver): string => {
        return resolver.servers.join(",");
      });
  }

  function failingWith(code: string): () => Promise<Array<string>> {
    return (): Promise<Array<string>> => {
      return Promise.reject(fakeDnsError(code, `queryPtr ${code}`));
    };
  }

  const timingOut: () => Promise<Array<string>> = failingWith("ETIMEOUT");
  const servFailing: () => Promise<Array<string>> = failingWith("ESERVFAIL");
  const noRecord: () => Promise<Array<string>> = failingWith("ENOTFOUND");

  function naming(ipAddress: string): Promise<Array<string>> {
    return Promise.resolve([`host-${ipAddress}.wbhq.example`]);
  }

  async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
    return await attempt.then(
      (): unknown => {
        return undefined;
      },
      (caught: unknown): unknown => {
        return caught;
      },
    );
  }

  function codeOf(error: unknown): string | undefined {
    return (error as { code?: string } | undefined)?.code;
  }

  describe("buildDefaultRetryLookup — stateless, configured order, only the primary's 'no record' is final", () => {
    it("asks the primary first on every walk, however often it has been silent", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [PRIMARY]: timingOut, [SECONDARY]: naming },
        configured: [PRIMARY, SECONDARY],
      });
      const retry: ReverseDnsLookupFunction = buildDefaultRetryLookup(
        4000,
        factory.create,
      );

      for (const ipAddress of ["10.16.42.51", "10.16.42.52", "10.16.42.53"]) {
        const before: number = factory.created.length;

        await expect(retry(ipAddress)).resolves.toEqual([
          `host-${ipAddress}.wbhq.example`,
        ]);
        expect(pinnedSince(factory, before)).toEqual([PRIMARY, SECONDARY]);
      }
    });

    it.each([
      ["SERVFAIL", "ESERVFAIL"],
      ["REFUSED", "EREFUSED"],
      ["a timeout", "ETIMEOUT"],
    ])(
      "keeps the primary's %s when the public fallbacks only say NXDOMAIN (the Helm chart's defaults)",
      async (_label: string, code: string) => {
        const factory: FakeResolverFactory = scriptedServers({
          outcomes: {
            [PRIMARY]: failingWith(code),
            [SECONDARY]: noRecord,
            [TERTIARY]: noRecord,
          },
          configured: [PRIMARY, SECONDARY, TERTIARY],
        });

        const rejection: unknown = await rejectionOf(
          buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
        );

        expect(codeOf(rejection)).toBe(code);
        expect(pinnedSince(factory, 0)).toEqual([PRIMARY, SECONDARY, TERTIARY]);
      },
    );

    it("takes a NAME from a later server after the primary failed", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: {
          [PRIMARY]: servFailing,
          [SECONDARY]: noRecord,
          [TERTIARY]: naming,
        },
        configured: [PRIMARY, SECONDARY, TERTIARY],
      });

      await expect(
        buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
      ).resolves.toEqual(["host-10.16.42.51.wbhq.example"]);
    });

    it("does not let a secondary that named SOME addresses speak for the rest", async () => {
      /*
       * The secondary names 198.51.100.x (a public block, a router's DHCP
       * names) and says NXDOMAIN for the private ones. The primary times out
       * on the first private address. Nothing the secondary did earlier makes
       * its NXDOMAIN final: that address keeps the primary's timeout.
       */
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: {
          [PRIMARY]: timingOut,
          [SECONDARY]: (ipAddress: string): Promise<Array<string>> => {
            return ipAddress.startsWith("198.51.100.")
              ? naming(ipAddress)
              : noRecord();
          },
        },
        configured: [PRIMARY, SECONDARY],
      });
      const retry: ReverseDnsLookupFunction = buildDefaultRetryLookup(
        4000,
        factory.create,
      );

      await retry("198.51.100.7");

      const rejection: unknown = await rejectionOf(retry("10.16.42.51"));

      expect(codeOf(rejection)).toBe("ETIMEOUT");
    });

    it("gives the same answer for an address whatever was asked before it", async () => {
      const outcomes: Record<string, ServerOutcome> = {
        [PRIMARY]: (ipAddress: string): Promise<Array<string>> => {
          return ipAddress === "10.16.42.51" ? timingOut() : naming(ipAddress);
        },
        [SECONDARY]: noRecord,
      };

      const coldFactory: FakeResolverFactory = scriptedServers({
        outcomes: outcomes,
        configured: [PRIMARY, SECONDARY],
      });
      const cold: unknown = await rejectionOf(
        buildDefaultRetryLookup(4000, coldFactory.create)("10.16.42.51"),
      );

      const warmFactory: FakeResolverFactory = scriptedServers({
        outcomes: outcomes,
        configured: [PRIMARY, SECONDARY],
      });
      const warm: ReverseDnsLookupFunction = buildDefaultRetryLookup(
        4000,
        warmFactory.create,
      );

      for (let index: number = 0; index < 5; index++) {
        await rejectionOf(warm("10.16.42.51"));
      }

      const afterHistory: unknown = await rejectionOf(warm("10.16.42.51"));

      expect(codeOf(cold)).toBe("ETIMEOUT");
      expect(codeOf(afterHistory)).toBe("ETIMEOUT");
    });

    it("treats the first server it can pin as the primary, and takes ITS 'no record' as final", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [SECONDARY]: noRecord, [TERTIARY]: naming },
        configured: [PRIMARY, SECONDARY, TERTIARY],
        unpinnable: [PRIMARY],
      });

      const rejection: unknown = await rejectionOf(
        buildDefaultRetryLookup(4000, factory.create)("10.16.42.51"),
      );

      expect(codeOf(rejection)).toBe("ENOTFOUND");
      // The refused pin leaves its resolver on the full list; count the rest.
      expect(
        pinnedSince(factory, 0).filter((pinned: string): boolean => {
          return !pinned.includes(",");
        }),
      ).toEqual([SECONDARY]);
    });
  });

  describe("buildDefaultRescueLookup — the silent primary last, a naming server first and trusted", () => {
    it("asks the other servers before the primary, and names from the first that can", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [PRIMARY]: timingOut, [SECONDARY]: naming },
        configured: [PRIMARY, SECONDARY],
      });

      await expect(
        buildDefaultRescueLookup(4000, factory.create)("10.16.42.51"),
      ).resolves.toEqual(["host-10.16.42.51.wbhq.example"]);
      // The primary is never reached: the secondary named it first.
      expect(pinnedSince(factory, 0)).toEqual([SECONDARY]);
    });

    it("does not trust a server that has named nothing: its NXDOMAIN leaves the primary's failure", async () => {
      /*
       * A dead primary behind a public resolver. The public resolver is asked
       * first, says NXDOMAIN, and is not believed; the primary is asked last,
       * times out, and that is the answer — which is what makes the breaker
       * rescue fail for this setup instead of taking a public resolver's
       * word for every host.
       */
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: {
          [PRIMARY]: timingOut,
          [SECONDARY]: noRecord,
          [TERTIARY]: noRecord,
        },
        configured: [PRIMARY, SECONDARY, TERTIARY],
      });

      const rejection: unknown = await rejectionOf(
        buildDefaultRescueLookup(4000, factory.create)("10.16.42.51"),
      );

      expect(codeOf(rejection)).toBe("ETIMEOUT");
      expect(pinnedSince(factory, 0)).toEqual([SECONDARY, TERTIARY, PRIMARY]);
    });

    it("trusts the NXDOMAIN of a server once it has named something, and asks it first", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: {
          [PRIMARY]: timingOut,
          [SECONDARY]: noRecord,
          [TERTIARY]: (ipAddress: string): Promise<Array<string>> => {
            return ipAddress === "10.16.42.51" ? naming(ipAddress) : noRecord();
          },
        },
        configured: [PRIMARY, SECONDARY, TERTIARY],
      });
      const rescue: ReverseDnsLookupFunction = buildDefaultRescueLookup(
        4000,
        factory.create,
      );

      await rescue("10.16.42.51");

      const before: number = factory.created.length;
      const rejection: unknown = await rejectionOf(rescue("10.16.42.52"));

      expect(codeOf(rejection)).toBe("ENOTFOUND");
      // The naming server first, and its word ends the walk at once.
      expect(pinnedSince(factory, before)).toEqual([TERTIARY]);
    });

    it("takes the primary's own NXDOMAIN as final even when it is asked last", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [PRIMARY]: noRecord, [SECONDARY]: timingOut },
        configured: [PRIMARY, SECONDARY],
      });

      const rejection: unknown = await rejectionOf(
        buildDefaultRescueLookup(4000, factory.create)("10.16.42.51"),
      );

      expect(codeOf(rejection)).toBe("ENOTFOUND");
      expect(pinnedSince(factory, 0)).toEqual([SECONDARY, PRIMARY]);
    });

    it("puts a primary that names something back at the front", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [PRIMARY]: naming, [SECONDARY]: timingOut },
        configured: [PRIMARY, SECONDARY],
      });
      const rescue: ReverseDnsLookupFunction = buildDefaultRescueLookup(
        4000,
        factory.create,
      );

      await rescue("10.16.42.51");
      expect(pinnedSince(factory, 0)).toEqual([SECONDARY, PRIMARY]);

      const before: number = factory.created.length;

      await rescue("10.16.42.52");
      expect(pinnedSince(factory, before)).toEqual([PRIMARY]);
    });

    it("reports the PRIMARY's error when every server fails, though it was asked last", async () => {
      const primaryError: Error = fakeDnsError("ETIMEOUT", "from the primary");
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: {
          [PRIMARY]: (): Promise<Array<string>> => {
            return Promise.reject(primaryError);
          },
          [SECONDARY]: servFailing,
        },
        configured: [PRIMARY, SECONDARY],
      });

      const rejection: unknown = await rejectionOf(
        buildDefaultRescueLookup(4000, factory.create)("10.16.42.51"),
      );

      expect(rejection).toBe(primaryError);
    });

    it("keeps what it has learned to itself: a new rescue lookup starts with no naming servers", async () => {
      const factory: FakeResolverFactory = scriptedServers({
        outcomes: { [PRIMARY]: timingOut, [SECONDARY]: naming },
        configured: [PRIMARY, SECONDARY],
      });

      await buildDefaultRescueLookup(4000, factory.create)("10.16.42.51");

      const before: number = factory.created.length;
      const rejection: unknown = await rejectionOf(
        buildDefaultRescueLookup(
          4000,
          scriptedServers({
            outcomes: { [PRIMARY]: timingOut, [SECONDARY]: noRecord },
            configured: [PRIMARY, SECONDARY],
          }).create,
        )("10.16.42.52"),
      );

      // Untrusted without a name of its own: the primary's timeout stands.
      expect(codeOf(rejection)).toBe("ETIMEOUT");
      expect(factory.created.length).toBe(before);
    });
  });
});
