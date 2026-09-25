// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  buildDefaultLookup,
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
       * And the hosts file is NOT consulted for a failure: its fallback is
       * for "no record" answers, and asking reverse() here would only turn
       * the real code back into ENOTFOUND.
       */
      expect(methodsCalled(factory.created[0]!)).toEqual(["resolvePtr"]);
    },
  );
});

describe("buildDefaultLookup — the hosts file, after DNS says there is no record", () => {
  /*
   * reverse() read the hosts file before asking DNS; resolvePtr never reads
   * it. The bundled probes use host networking, so the probe host's
   * /etc/hosts is theirs, and an operator who listed devices there would
   * have lost those names in the switch. The fallback keeps them — only for
   * "no record", only once, inside the same race — and never lets reverse()'s
   * collapsed error replace the real one.
   */

  it.each(["ENOTFOUND", "ENODATA"])(
    "names the host from reverse() after resolvePtr's %s",
    async (code: string) => {
      const factory: FakeResolverFactory = fakeResolverFactory({
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError(code));
        },
        reverse: async (): Promise<Array<string>> => {
          return ["kds-from-hosts-file"];
        },
      });

      await expect(
        buildDefaultLookup(500, factory.create)("10.16.42.70"),
      ).resolves.toEqual(["kds-from-hosts-file"]);

      // Same resolver, resolvePtr first, then reverse on the ADDRESS.
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0]!.calls).toEqual([
        { method: "resolvePtr", argument: "70.42.16.10.in-addr.arpa" },
        { method: "reverse", argument: "10.16.42.70" },
      ]);
    },
  );

  it.each([
    ["rejects with reverse()'s collapsed ENOTFOUND", "ENODATA"],
    ["rejects with reverse()'s collapsed ENOTFOUND", "ENOTFOUND"],
  ])(
    "rethrows the ORIGINAL error when the fallback %s (original %s)",
    async (_label: string, code: string) => {
      const original: Error = fakeDnsError(code, `queryPtr ${code} original`);
      const factory: FakeResolverFactory = fakeResolverFactory({
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(original);
        },
        reverse: (): Promise<Array<string>> => {
          return Promise.reject(fakeDnsError("ENOTFOUND", "getHostByAddr"));
        },
      });

      const rejection: unknown = await buildDefaultLookup(
        500,
        factory.create,
      )("10.16.42.53").catch((caught: unknown): unknown => {
        return caught;
      });

      expect(rejection).toBe(original);
    },
  );

  it.each([
    ["an empty list", []],
    ["something that is not a list", undefined],
  ])(
    "rethrows the original error when the fallback answers %s",
    async (_label: string, value: unknown) => {
      const original: Error = fakeDnsError("ENODATA");
      const factory: FakeResolverFactory = fakeResolverFactory({
        resolvePtr: (): Promise<Array<string>> => {
          return Promise.reject(original);
        },
        reverse: (async (): Promise<unknown> => {
          return value;
        }) as unknown as () => Promise<Array<string>>,
      });

      await expect(
        buildDefaultLookup(500, factory.create)("10.16.42.53"),
      ).rejects.toBe(original);
    },
  );

  it("runs the fallback inside the SAME race, and cancels it when the race is lost", async () => {
    /*
     * The hosts file is local, but reverse() asks DNS after it; a fallback
     * with its own clock could double a black-holed address's cost.
     */
    const factory: FakeResolverFactory = fakeResolverFactory({
      resolvePtr: (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ENOTFOUND"));
      },
      reverse: (): Promise<Array<string>> => {
        return neverSettles();
      },
    });

    const startedAt: number = Date.now();

    await expect(
      buildDefaultLookup(40, factory.create)("10.16.42.52"),
    ).rejects.toMatchObject({ code: "ETIMEOUT" });

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(factory.created[0]!.cancelCount).toBe(1);
  });

  it("does not start the fallback once the race has been lost", async () => {
    /*
     * A "no record" answer can land just after the race gave up — and
     * cancel() has already run by then, so a reverse() started now would be
     * a query nobody waits for and nothing will ever cancel.
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
       * hosts file IS still consulted, on the pinned resolver.
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
      expect(methodsCalled(factory.created[1]!)).toEqual([
        "setServers",
        "resolvePtr",
        "reverse",
      ]);
    },
  );

  it("names the host from the hosts file after the primary's NXDOMAIN", async () => {
    const factory: FakeResolverFactory = fakeResolverFactory({
      servers: ["10.0.0.2", "10.0.0.3"],
      resolvePtr: (): Promise<Array<string>> => {
        return Promise.reject(fakeDnsError("ENOTFOUND"));
      },
      reverse: async (): Promise<Array<string>> => {
        return ["kds-from-hosts-file"];
      },
    });

    await expect(
      buildDefaultRetryLookup(4000, factory.create)("10.16.42.70"),
    ).resolves.toEqual(["kds-from-hosts-file"]);
  });

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
