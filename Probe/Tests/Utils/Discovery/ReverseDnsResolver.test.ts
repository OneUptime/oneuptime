// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  buildDefaultLookup,
  ReverseDnsResolverLike,
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
 * This is the piece that talks to a resolver, so almost the whole suite runs
 * against an INJECTED lookup function: every failure mode a real resolver has
 * is reproducible on demand, and none of it depends on this machine's DNS,
 * clock or locale. NO TEST HERE SENDS A QUERY. The one describe block that
 * exercises the real buildDefaultLookup does so with an argument c-ares
 * refuses to parse, which rejects before anything reaches the wire; the note
 * on that block explains why that is the most of it that can be covered.
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

/*
 * A sweep's worth of distinct addresses. Written as a helper because the
 * interesting cases here are about SIZE — one wave of the shipped concurrency,
 * a hundred hosts, a budget's worth of failures — and hand-listing those
 * buries the assertion under addresses nobody reads.
 */
function addressList(count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}`;
    },
  );
}

interface DeferredLookup {
  promise: Promise<Array<string>>;
  resolve: (answers: Array<string>) => void;
  reject: (error: Error) => void;
}

/*
 * A lookup the TEST settles, rather than one a timer settles.
 *
 * The concurrency bugs in this class are all about the ORDER in which a wave
 * of in-flight lookups comes back, and a test that expressed that order with
 * setTimeout would be pinning the event loop rather than the resolver: the
 * skip path costs no macrotask, so anything scheduled on a timer lands after
 * the pass has already made the decision under test. Handing the test the
 * resolve/reject functions makes the interleaving exact and the test
 * independent of how fast the machine is.
 */
function deferredLookup(): DeferredLookup {
  let resolveAnswers: (answers: Array<string>) => void = (): void => {};
  let rejectWith: (error: Error) => void = (): void => {};

  const promise: Promise<Array<string>> = new Promise<Array<string>>(
    (
      resolve: (answers: Array<string>) => void,
      reject: (error: Error) => void,
    ) => {
      resolveAnswers = resolve;
      rejectWith = reject;
    },
  );

  return {
    promise: promise,
    resolve: (answers: Array<string>): void => {
      resolveAnswers(answers);
    },
    reject: (error: Error): void => {
      rejectWith(error);
    },
  };
}

/*
 * A lookup that hands back something that is not a list of names. The cast is
 * the point of the helper: the signature promises Array<string>, and these
 * tests exist precisely because a signature is not a guarantee at runtime.
 */
function lookupReturning(value: unknown): ReverseDnsLookupFunction {
  return (async (): Promise<unknown> => {
    return value;
  }) as unknown as ReverseDnsLookupFunction;
}

/*
 * Every warning the pass emitted, in order.
 *
 * Captured rather than dug back out of the spy's `mock.calls` because the
 * interesting assertions are about WHAT the operator is told, and the two warn
 * paths share the phrase "reverse DNS": only the rest of the sentence
 * separates "this probe cannot resolve" from "this pass was too big to
 * finish". A test that matched on the shared phrase alone would pass for
 * either message, which is the wrong log line reaching the wrong operator.
 */
let warnedMessages: Array<string> = [];

beforeEach(() => {
  warnedMessages = [];

  // These paths log on purpose; the suite asserts on them, not on stdout.
  jest.spyOn(logger, "warn").mockImplementation((message: unknown): never => {
    warnedMessages.push(String(message));
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

  it("steps over non-string answers on the way to a good name", async () => {
    /*
     * The answer LIST is untrusted the same way its contents are. It is typed
     * `Array<string>` by a signature, not by a check — the values arrive from
     * a resolver on the scanned network, through a Node API this class does
     * not own, and on the server side the same names are read back out of a
     * jsonb column. normalizeReverseDnsName takes `unknown` for exactly this
     * reason, and the "first usable answer" loop hands it whatever the array
     * held.
     *
     * Two mutations die here. Inline the normaliser as anything that touches
     * the value directly — `answer.trim()` is the obvious one — and `null`
     * throws a TypeError inside the loop, which the catch below counts as an
     * INFRASTRUCTURE failure: one malformed answer list would then spend the
     * failure budget as well as losing the name, which is why failureReason is
     * asserted here. Coerce instead of type-checking — `String(answer)` — and
     * `null` becomes the legal label "null" and the switch is named after it.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      lookupReturning([null, 42, {}, "sw-core-01.corp.example.com"]),
      { failureBudget: 1 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.18.166.51",
    ]);

    expect(result.hostnameByIpAddress.get("10.18.166.51")).toBe(
      "sw-core-01.corp.example.com",
    );
    expect(result.failureReason).toBeUndefined();
    expect(result.isReverseDnsAvailable).toBe(true);
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
    const asked: Array<string> = [];

    const result: ReverseDnsResolution = await resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return [];
      },
    ).resolveHostnames([]);

    expect(asked).toHaveLength(0);
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
    /*
     * EINVAL is what Node's reverse() rejects with when the ARGUMENT is not a
     * parseable address — " 1.2.3.4 ", an IPv6 form c-ares will not take,
     * anything a future caller of the public attachReverseDnsHostnames hands
     * it. That is a fact about one address and says nothing about the
     * resolver, so counting it would let a handful of malformed inputs
     * convict a working probe of having no DNS.
     */
    "EINVAL",
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
    expect(warnedMessages).toHaveLength(1);

    /*
     * And the line has to name the CAUSE, which is the whole reason
     * failureReason is threaded through to the log at all. "reverse DNS" on
     * its own would be satisfied by the wall-clock message too — the two warn
     * paths share that phrase — so an operator reading it would be told the
     * pass ran out of time when in fact their resolver is answering SERVFAIL.
     * Asserting the injected code pins that the message an operator acts on
     * came from the failure they actually have.
     */
    expect(warnedMessages[0]).toContain("ESERVFAIL");
    expect(warnedMessages[0]).toContain("not usable from this probe");
    // And that it says the remaining hosts were skipped rather than scanned.
    expect(warnedMessages[0]).toContain("skipped");
  });

  it("says 'unknown error' rather than nothing when the lookup threw nothing", async () => {
    /*
     * `throw undefined` is not a hypothetical: a rejected promise with no
     * reason is what a badly-written wrapper around a resolver produces, and
     * so is `new Error()`.
     *
     * Two things have to hold, and they pull in opposite directions. The warn
     * template's `|| "unknown error"` has to fire, or the operator's one log
     * line ends mid-sentence at "Resolver reported: " — a message that reports
     * a fault and then declines to say what it was. And `failureReason` has to
     * come back UNDEFINED rather than as the empty string: the field is typed
     * `string | undefined`, and an empty string is present-but-blank, so a
     * caller asking `failureReason !== undefined` would be told there is a
     * reason and then shown nothing. describeError returns undefined for an
     * empty message for exactly that reason.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        // eslint-disable-next-line no-throw-literal
        throw undefined;
      },
      { failureBudget: 1 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);

    expect(result.isReverseDnsAvailable).toBe(false);
    // Nothing to say about it, and nothing invented either.
    expect(result.failureReason).toBeUndefined();
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("unknown error");
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

  it("truncates a failure reason too long to be a log line", async () => {
    /*
     * A resolver error is not a sentence we wrote. c-ares errors routinely
     * carry the whole server list they tried, and a probe pointed at a host
     * with a large resolv.conf — or at a container runtime that injects
     * one — can produce a message thousands of characters long. This value
     * ends up in a probe log line AND on the ScanResult that goes back to the
     * server, so an untruncated one turns a best-effort enrichment's failure
     * into the largest field in the payload.
     *
     * FAILURE_REASON_EXCERPT_LENGTH is module-private, so the shipped 200 is
     * pinned here as a literal on purpose: it is a promise about what one log
     * line looks like, and changing it should require changing this test.
     *
     * The head is kept, not the tail. `queryPtr ESERVFAIL` is the part an
     * operator acts on and it is at the front; truncating from the other end
     * would keep the server list and throw away the diagnosis.
     */
    const excerptLength: number = 200;

    const hugeMessage: string = `queryPtr ESERVFAIL ${"10.18.166.51, ".repeat(
      500,
    )}`;

    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        throw dnsError("ESERVFAIL", hugeMessage);
      },
      { failureBudget: 1 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(hugeMessage.length).toBeGreaterThan(excerptLength);
    expect(result.failureReason).toHaveLength(excerptLength);
    expect(result.failureReason).toBe(hugeMessage.substring(0, excerptLength));
    expect(result.failureReason).toContain("queryPtr ESERVFAIL");
  });

  it("counts our own timeout as an infrastructure failure", async () => {
    /*
     * A wedged resolver rejects through the race guard with a plain Error and
     * no code. That is the archetypal "resolver is broken" case, so an
     * unrecognised error must default to counting — the opposite default
     * would make the budget unreachable exactly when it is needed.
     *
     * This is also the closest an injected lookup can get to buildDefaultLookup's
     * per-address race: injecting a lookup that never settles would hang the
     * pass forever, because the 2s timeout lives INSIDE the default lookup and
     * not in this class. So the error that race produces is reproduced
     * verbatim instead, message shape and all, and what is pinned is how the
     * classifier reads it.
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
    // Bounded, and back with a result, rather than pinned on the wedged address.
    expect(result.hostnameByIpAddress.size).toBe(0);
  });

  it("never rejects, and describes a non-Error throw, whatever the lookup threw", async () => {
    /*
     * The one guarantee that outranks every other in this file: a sweep that
     * succeeded must not be lost on the way out of it. The bare `await` below
     * is that assertion — a rejection propagates out of it and fails the test.
     *
     * The second half is describeError's `String(error ?? "")` fallback. A
     * thrown string has no `.message`, and a fallback that produced ""
     * (falsy, so failureReason would never be set at all) or the
     * "[object Object]" a careless coercion gives would satisfy a test that
     * only checked the pass came back. Asserting the exact text pins that what
     * the lookup actually threw is what an operator eventually reads.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        // eslint-disable-next-line no-throw-literal
        throw "a string, not an Error";
      },
      { failureBudget: 4 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
    ]);

    expect(result.hostnameByIpAddress.size).toBe(0);
    expect(result.failureReason).toBe("a string, not an Error");
    // Two failures against a budget of four: nothing has been concluded yet.
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("survives one failure short of the DEFAULT budget before the first success", async () => {
    /*
     * The default is exercised as a behaviour rather than asserted as a
     * number: what matters is that a probe whose first several queries are
     * eaten by a flaky forwarder still names the host that answers next.
     * Tightening the shipped default would break this test, which is the
     * point — that number is a promise to sparse subnets, not a constant.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        if (ipAddress === "10.0.1.1") {
          return ["gateway.corp.example.com"];
        }

        throw dnsError("ESERVFAIL");
      },
    );

    const addresses: Array<string> = [
      ...addressList(DEFAULT_REVERSE_DNS_FAILURE_BUDGET - 1),
      "10.0.1.1",
      "10.0.1.2",
    ];

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    expect(asked).toHaveLength(addresses.length);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.hostnameByIpAddress.get("10.0.1.1")).toBe(
      "gateway.corp.example.com",
    );
    // The budget was never crossed, so the operator is told nothing.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("spends the DEFAULT budget on exactly that many failures", async () => {
    /*
     * The other side of the same promise: the default is a ceiling too, or a
     * probe with no resolver would pay a full sweep of timeouts.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        if (ipAddress === "10.0.1.1") {
          return ["gateway.corp.example.com"];
        }

        throw dnsError("ECONNREFUSED");
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      ...addressList(DEFAULT_REVERSE_DNS_FAILURE_BUDGET),
      "10.0.1.1",
    ]);

    expect(asked).toHaveLength(DEFAULT_REVERSE_DNS_FAILURE_BUDGET);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.hostnameByIpAddress.size).toBe(0);
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

    /*
     * failureReason is SET on a pass that WORKED, and that pairing is the
     * documented reading of the field rather than an accident of this test.
     * Nine addresses genuinely timed out, so there is a real fault to report —
     * but the resolver is present and the gateway was named, so
     * isReverseDnsAvailable is true and nothing is logged. A caller that reads
     * failureReason on its own as "DNS is broken" would tell an operator their
     * probe has no resolver on a sweep where it plainly does, which is why the
     * field's doc comment says to read it beside isReverseDnsAvailable.
     */
    expect(result.failureReason).toContain("ETIMEOUT");
    expect(warnedMessages).toHaveLength(0);
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

  it("does not report exhaustion while the clock is still short of the deadline", async () => {
    /*
     * The negative control, and it is only worth having with an INJECTED
     * clock. Written against the real Date.now and the shipped sixty-second
     * default — which is how it started life — it asserted that a budget
     * nothing came near had not been spent, and would have passed just as
     * happily if the wall-clock budget had been deleted from the class
     * outright. It could not fail for the behaviour in its own title.
     *
     * Driven by the same stepping clock as its siblings it becomes a real
     * boundary: three readings at 100, 200 and 300 against a deadline of 400.
     * Invert the comparison, or take the deadline from the wrong end (`now()`
     * rather than `now() + budget`), and the pass trips on its first wave and
     * asks one address instead of three. Paired with the test below — which
     * puts a reading exactly ON the deadline — the threshold is bracketed from
     * both sides without either test asserting a bare boolean nothing can
     * move.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return ["host.example.com"];
      },
      { totalBudgetInMs: 400, now: clockAdvancingBy(100) },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(3),
    );

    expect(asked).toHaveLength(3);
    expect(result.isTimeBudgetExhausted).toBe(false);
    expect(warnedMessages).toHaveLength(0);
  });

  it("stops the moment the clock REACHES the deadline, not once it has passed it", async () => {
    /*
     * The check is `now() >= deadline`, and the difference between that and
     * `>` is one whole wave of lookups — at the shipped concurrency, thirty-two
     * addresses each able to spend the full per-address timeout, on a pass that
     * has already been told it is out of time. That is the exact overshoot the
     * budget exists to prevent, so the boundary is pinned rather than left to
     * whichever comparison a later edit happens to write.
     *
     * Deadline 300, readings at 100 (ask), 200 (ask), 300 (stop). Relax the
     * comparison to `>` and a third address is asked before the reading at 400
     * stops it.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return [`host-${ipAddress.split(".").pop()}.example.com`];
      },
      { totalBudgetInMs: 300, now: clockAdvancingBy(100) },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(4),
    );

    expect(asked).toHaveLength(2);
    expect(result.isTimeBudgetExhausted).toBe(true);

    /*
     * And the operator is told which budget stopped them. This message and the
     * failure-budget one both contain "reverse DNS"; only the rest of the
     * sentence says whether to go and look at their resolver or at the size of
     * their sweep. It must also say the sweep itself survived, because the
     * whole design constraint here is that an enrichment may not turn a
     * successful scan into a reported failure.
     */
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toContain("300ms budget");
    expect(warnedMessages[0]).toContain("naming 2 host(s)");
    expect(warnedMessages[0]).toContain("The sweep itself is unaffected");
    // Nothing was learned against the resolver: it answered everything asked.
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("keeps the names from lookups that were IN FLIGHT when the deadline passed", async () => {
    /*
     * The source contract is explicit that the deadline is read before a wave
     * STARTS and never in the middle of one, so a pass overruns its budget by
     * at most one wave — and the queries in that wave are already on the wire,
     * paid for, with answers coming back. Throwing those answers away because
     * the clock moved while they were outstanding would cost the sweep names
     * it had already bought.
     *
     * The wave is settled by hand so the clock can be moved past the deadline
     * at the one moment that matters: after both lookups have been issued and
     * before either has answered. A design that raced the wave against the
     * deadline, or that cleared the map on exhaustion, returns nothing here.
     */
    let clock: number = 0;
    const asked: Array<string> = [];
    const inFlight: Array<DeferredLookup> = [];
    const addresses: Array<string> = addressList(6);

    const resolver: ReverseDnsResolver = resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        const pending: DeferredLookup = deferredLookup();
        inFlight.push(pending);
        return pending.promise;
      },
      {
        concurrency: 2,
        totalBudgetInMs: 100,
        now: (): number => {
          return clock;
        },
      },
    );

    const pass: Promise<ReverseDnsResolution> =
      resolver.resolveHostnames(addresses);

    // The first wave is out and unanswered.
    expect(asked).toHaveLength(2);

    // The budget expires while both queries are still outstanding.
    clock = 1000;

    inFlight[0]!.resolve(["sw-core-01.corp.example.com"]);
    inFlight[1]!.resolve(["sw-core-02.corp.example.com"]);

    const result: ReverseDnsResolution = await pass;

    // Overrun by at most one wave: the next four addresses are never started.
    expect(asked).toHaveLength(2);
    expect(result.isTimeBudgetExhausted).toBe(true);
    // And both names that were in flight when the clock ran out are kept.
    expect(result.hostnameByIpAddress.size).toBe(2);
    expect(result.hostnameByIpAddress.get(addresses[0]!)).toBe(
      "sw-core-01.corp.example.com",
    );
    expect(result.hostnameByIpAddress.get(addresses[1]!)).toBe(
      "sw-core-02.corp.example.com",
    );
  });
});

describe("ReverseDnsResolver — concurrency", () => {
  it.each([1, 4, 32])(
    "keeps exactly %i lookups in flight while work remains",
    async (concurrency: number) => {
      /*
       * Both halves are load-bearing, and the upper bound alone is not enough:
       * "no more than 32" is satisfied by a pool that only ever ran two
       * workers, which would quietly turn a 4000-host sweep's enrichment into
       * a serial crawl against the wall-clock budget. Pinning the peak to the
       * configured width catches a pool that under-fills as well as one that
       * over-fills — and the width is what every failure-budget assertion
       * below is really about, since the budget cannot stop a lookup that is
       * already in flight.
       */
      let inFlight: number = 0;
      let peak: number = 0;
      const asked: Array<string> = [];

      const resolver: ReverseDnsResolver = resolverWith(
        async (ipAddress: string): Promise<Array<string>> => {
          asked.push(ipAddress);
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1);
          });
          inFlight--;
          return ["host.example.com"];
        },
        { concurrency: concurrency },
      );

      await resolver.resolveHostnames(addressList(40));

      expect(peak).toBe(concurrency);
      // The pool must also REFILL: 40 addresses, not one wave of them.
      expect(asked).toHaveLength(40);
      expect(inFlight).toBe(0);
    },
  );

  it("runs whole WAVES: no lookup starts until every lookup before it has settled", async () => {
    /*
     * Waves rather than a work-stealing pool is not a performance choice, it is
     * what makes the failure budget answerable at all: the breaker is read
     * between waves precisely because that is the only moment when every
     * lookup that has started has finished and the counters cannot be lying.
     * A pool refills the instant ONE worker frees up, so the counters are
     * always mid-flight — and the previous design, which read the breaker
     * there, silently skipped two thirds of a sweep and reported success.
     *
     * That property is structural and invisible in every result-shaped
     * assertion in this file, so it is pinned directly, on the sequence of
     * starts and settles. Ten addresses at a concurrency of four is 4 + 4 + 2:
     * a pool would produce start-0..3, settle-0, start-4, settle-1, start-5 —
     * interleaved, and unequal to the expected sequence on its sixth entry.
     * The short final wave is part of the test on purpose: a loop that
     * advanced by the concurrency without clamping the slice would either drop
     * the last two addresses or ask for addresses that do not exist.
     */
    const events: Array<string> = [];
    const addresses: Array<string> = addressList(10);
    const indexByAddress: Map<string, number> = new Map<string, number>(
      addresses.map((address: string, index: number): [string, number] => {
        return [address, index];
      }),
    );

    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        const index: number = indexByAddress.get(ipAddress)!;

        events.push(`start ${index}`);

        /*
         * A real macrotask, not a microtask: it is the gap a pool would use to
         * pull its next address, so a test that only yielded the microtask
         * queue could not tell the two designs apart. Timers armed with the
         * same delay fire in the order they were created, which is what makes
         * the expected sequence exact rather than merely grouped.
         */
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        events.push(`settle ${index}`);

        return [`host-${index}.corp.example.com`];
      },
      { concurrency: 4 },
    );

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    const expectedEvents: Array<string> = [];
    const expectedWaves: Array<Array<number>> = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ];

    for (const wave of expectedWaves) {
      for (const index of wave) {
        expectedEvents.push(`start ${index}`);
      }

      for (const index of wave) {
        expectedEvents.push(`settle ${index}`);
      }
    }

    expect(events).toEqual(expectedEvents);

    /*
     * Stated a second way, independently of the exact interleave: a wave is a
     * start that is not preceded by another start, and there are three of
     * them. Ten addresses at a concurrency of four in two waves would mean the
     * width was wrong; in ten waves it would mean the pass had gone serial.
     */
    const waveCount: number = events.filter(
      (event: string, index: number): boolean => {
        return (
          event.startsWith("start ") &&
          (index === 0 || !events[index - 1]!.startsWith("start "))
        );
      },
    ).length;

    expect(waveCount).toBe(3);
    expect(result.hostnameByIpAddress.size).toBe(10);
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

describe("ReverseDnsResolver — the failure budget at the SHIPPED concurrency of 32", () => {
  /*
   * Everything above this point runs the pool one address at a time, which
   * makes ordering assertions readable but is a configuration production
   * never uses: the shipped default is 32, and the budget behaves differently
   * there in a way that decided the outcome of this feature.
   *
   * Thirty-two lookups leave together. The budget is checked before a lookup
   * STARTS and can never recall one already in flight, so the first wave is
   * always paid for in full — and the verdict on the resolver is reached
   * while twenty-two other queries are still outstanding. Whether those
   * queries are allowed to change that verdict is the whole question.
   */

  it("bounds a probe with no resolver to a single wave of lookups", async () => {
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        throw dnsError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.53:53");
      },
      { concurrency: 32, failureBudget: 10 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(200),
    );

    /*
     * Exactly 32, not 10: the budget is a floor on what a broken probe costs,
     * not a cap, and pretending otherwise is what made the serial tests above
     * read as if a budget of 10 meant ten queries. 32 out of 200 is still the
     * point — a probe with no DNS pays for one wave and stops.
     */
    expect(asked).toHaveLength(32);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("asks every address when the first wave's failures land before its successes", async () => {
    /*
     * THE regression this hardening exists for.
     *
     * A reverse zone delegated to a dead nameserver at the bottom of the
     * subnet — the single most common way for this to go wrong — makes the
     * first handful of addresses time out while the rest of the wave answers
     * a moment later. The budget was once a latch set inside the failure
     * branch, so those ten failures flipped it permanently and the
     * twenty-two good names already on their way back could not flip it
     * again. Sixty-eight hosts with perfectly good PTR records were never
     * asked, and the operator saw the bare IPs of issue #3529 on a network
     * that publishes a name for every one of them.
     *
     * The wave is settled by hand so the ORDER is the test rather than the
     * machine: the ten failures land first, exactly filling a budget of ten,
     * and the twenty-two answers land behind them in the same wave. Because
     * the breaker is only read once that wave has fully settled, it sees a
     * wave that answered and never trips at all.
     *
     * Three assertions carry it, and each kills a different mutation. `asked`
     * reaching a hundred is what fails if the `successfulLookupCount === 0`
     * conjunct is dropped from isReverseDnsUnusable — the pass would stop
     * dead at 32. `failureReason` is what distinguishes "the budget was met
     * and correctly overruled" from "the budget was never reached at all": it
     * is the only observable proof that those ten rejections really were
     * counted as infrastructure failures rather than quietly reclassified,
     * and without it removing the failure budget from the class entirely
     * would leave this test green. And `warnedMessages` being empty is the
     * operator-facing half — a probe that named ninety of a hundred hosts must
     * not also log that its reverse DNS is unusable.
     *
     * Its sibling below makes the same point at a concurrency of four; this
     * one makes it at the SHIPPED thirty-two, and adds that the pass goes on
     * to refill three more waves rather than merely surviving the first.
     */
    const asked: Array<string> = [];
    const firstWave: Array<DeferredLookup> = [];
    const addresses: Array<string> = addressList(100);
    const indexByAddress: Map<string, number> = new Map<string, number>(
      addresses.map((address: string, index: number): [string, number] => {
        return [address, index];
      }),
    );

    const resolver: ReverseDnsResolver = resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        const index: number = indexByAddress.get(ipAddress)!;

        // The wave the pass opens with is settled by hand, below.
        if (index < 32) {
          const pending: DeferredLookup = deferredLookup();
          firstWave.push(pending);
          return pending.promise;
        }

        return Promise.resolve([`host-${index}.corp.example.com`]);
      },
      { concurrency: 32, failureBudget: 10 },
    );

    const pass: Promise<ReverseDnsResolution> =
      resolver.resolveHostnames(addresses);

    // The pool opens the whole wave before anything can come back.
    expect(asked).toHaveLength(32);

    // Ten dead-delegation timeouts come back first — the budget, exactly.
    for (let index: number = 0; index < 10; index++) {
      firstWave[index]!.reject(dnsError("ETIMEOUT"));
    }

    // The other twenty-two answer immediately behind them.
    for (let index: number = 10; index < 32; index++) {
      firstWave[index]!.resolve([`host-${index}.corp.example.com`]);
    }

    const result: ReverseDnsResolution = await pass;

    expect(asked).toHaveLength(100);
    expect(result.isReverseDnsAvailable).toBe(true);
    // Every address except the ten that genuinely failed.
    expect(result.hostnameByIpAddress.size).toBe(90);
    expect(result.hostnameByIpAddress.get(addresses[99]!)).toBe(
      "host-99.corp.example.com",
    );

    /*
     * The ten failures WERE counted — a budget of ten was met, not dodged —
     * and the pass carried on anyway. Delete the failure budget from the class
     * and every assertion above still holds; this one is the witness that
     * there was a budget to overrule.
     */
    expect(result.failureReason).toContain("ETIMEOUT");
    // Nothing was wrong with this resolver, so the operator hears nothing.
    expect(warnedMessages).toHaveLength(0);
  });

  it("does not trip at all when the failing wave also contained a success", async () => {
    /*
     * The property that replaced "un-tripping", and the reason the pass is
     * organised as waves rather than as a worker pool.
     *
     * An earlier design asked the breaker on every address so it could trip
     * and then un-trip. That is unsound under concurrency for a reason that is
     * pure scheduling: once tripped, the pool's workers return WITHOUT
     * AWAITING, so the whole remaining queue drains through the skip path in
     * microtasks — and a success settling one macrotask later (which is to say
     * every real DNS answer) always lost the race. Two thirds of a sweep was
     * skipped while the result still reported success, because by the time
     * anyone asked, the breaker had un-tripped.
     *
     * Deciding at a wave boundary removes the race instead of managing it:
     * every lookup that started has settled, so a wave containing ANY answer
     * never trips in the first place. Here the first wave carries two
     * ESERVFAILs against a budget of two — enough to trip on the old
     * counting — alongside two answers. Nothing trips, nothing is skipped,
     * and the operator is not warned about a resolver that plainly works.
     */
    const asked: Array<string> = [];
    const firstWave: Array<DeferredLookup> = [];
    const addresses: Array<string> = addressList(12);
    const indexByAddress: Map<string, number> = new Map<string, number>(
      addresses.map((address: string, index: number): [string, number] => {
        return [address, index];
      }),
    );

    const resolver: ReverseDnsResolver = resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        const index: number = indexByAddress.get(ipAddress)!;

        if (index < 4) {
          const pending: DeferredLookup = deferredLookup();
          firstWave.push(pending);
          return pending.promise;
        }

        return Promise.resolve([`host-${index}.corp.example.com`]);
      },
      { concurrency: 4, failureBudget: 2 },
    );

    const pass: Promise<ReverseDnsResolution> =
      resolver.resolveHostnames(addresses);

    firstWave[0]!.reject(dnsError("ESERVFAIL"));
    firstWave[1]!.reject(dnsError("ESERVFAIL"));
    firstWave[2]!.resolve(["sw-core-01.corp.example.com"]);
    firstWave[3]!.resolve(["sw-core-02.corp.example.com"]);

    const result: ReverseDnsResolution = await pass;

    // Every address behind the mixed wave was still asked.
    expect(asked).toHaveLength(12);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.hostnameByIpAddress.size).toBe(10);
    // And nothing was reported to the operator, because nothing was wrong.
    expect(logger.warn).not.toHaveBeenCalled();
    /*
     * The failure was still SEEN, though — which is why failureReason is
     * documented as "the first infrastructure failure seen" and must never be
     * read without isReverseDnsAvailable beside it.
     */
    expect(result.failureReason).toContain("ESERVFAIL");
  });

  it("skips the rest only after a whole wave in which nothing answered", async () => {
    /*
     * The other half of the same contract. Here the first wave answers
     * nothing at all — not a name, not even an NXDOMAIN — which is the
     * signature of a probe that cannot resolve rather than of an estate with
     * one dead zone. The second wave is never started.
     */
    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        return Promise.reject(dnsError("ECONNREFUSED"));
      },
      { concurrency: 4, failureBudget: 2 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(12),
    );

    /*
     * Four, not two: the budget is a floor taken at a wave boundary, because
     * that is the only point at which the counters are complete. Stopping
     * mid-wave is what the racy design did.
     */
    expect(asked).toHaveLength(4);
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("ReverseDnsResolver — a resolver that answers with nothing usable", () => {
  /*
   * The distinction between "the lookup came back" and "the lookup produced a
   * name I can use". Only the first says anything about the probe's DNS, and
   * conflating them is how a working resolver gets convicted.
   */

  it("is disarmed by a lookup that RETURNED, even when every answer normalises away", async () => {
    /*
     * A wildcard reverse zone that echoes the query name is a real and common
     * configuration: every address answers, and every answer is
     * "N.166.18.10.in-addr.arpa", which normalizeReverseDnsName refuses
     * because it is a strictly worse label than the address it came from. That
     * resolver WORKS. Disarming on usable names rather than on returned
     * lookups would let a handful of unrelated timeouts sitting between those
     * echoes spend the budget and skip the rest of the subnet — including the
     * addresses further down that do have real names.
     */
    const asked: Array<string> = [];
    const addresses: Array<string> = addressList(12);
    const indexByAddress: Map<string, number> = new Map<string, number>(
      addresses.map((address: string, index: number): [string, number] => {
        return [address, index];
      }),
    );

    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        const index: number = indexByAddress.get(ipAddress)!;

        if (index % 2 === 1) {
          throw new Error(`Reverse DNS lookup for ${ipAddress} timed out`);
        }

        return [`${index}.166.18.10.in-addr.arpa`];
      },
      { concurrency: 1, failureBudget: 3 },
    );

    const result: ReverseDnsResolution =
      await resolver.resolveHostnames(addresses);

    // Six infrastructure failures against a budget of three, and still asking.
    expect(asked).toHaveLength(12);
    expect(result.isReverseDnsAvailable).toBe(true);
    // Zero names, which is the whole trap: nothing resolved, yet DNS works.
    expect(result.hostnameByIpAddress.size).toBe(0);
  });

  const nonArrayReturns: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "sw-core-01.corp.example.com"],
    ["an object", { hostname: "sw-core-01.corp.example.com" }],
  ];

  it.each(nonArrayReturns)(
    "treats %s from the lookup as 'no name here' rather than as a fault",
    async (_label: string, value: unknown) => {
      /*
       * `for...of` over a non-iterable THROWS, and delete the Array.isArray
       * guard and that throw lands in the catch below, where an unrecognised
       * error is counted as an INFRASTRUCTURE failure. A lookup that answered
       * `null` would then not merely fail to name one host: it would be
       * reported to the operator as evidence that this probe cannot resolve.
       *
       * `failureReason` is the assertion that kills that mutation, and it is
       * worth being precise about WHY, because the obvious candidate does not.
       * `isReverseDnsAvailable` cannot fail here: successfulLookupCount is
       * incremented the moment the lookup RETURNS, before its answers are
       * looked at, so by the time a guardless loop throws, the resolver has
       * already been recorded as working and isReverseDnsUnusable() — which
       * requires successfulLookupCount === 0 — can never be true again for
       * this pass. It is asserted below as a statement of the contract, not as
       * a witness. The two assertions that can actually move are the map size
       * and the failure reason.
       *
       * The string case is the nastier one, and there the map size is what
       * catches it: a string IS iterable, so a guardless loop walks it
       * character by character, hands normalizeReverseDnsName "s", and names
       * the host after it — a single letter is a legal DNS label.
       */
      const resolver: ReverseDnsResolver = resolverWith(
        lookupReturning(value),
        { failureBudget: 1 },
      );

      const result: ReverseDnsResolution = await resolver.resolveHostnames([
        "10.0.0.1",
        "10.0.0.2",
      ]);

      expect(result.hostnameByIpAddress.size).toBe(0);
      expect(result.failureReason).toBeUndefined();
      expect(warnedMessages).toHaveLength(0);
      expect(result.isReverseDnsAvailable).toBe(true);
    },
  );

  it("walks a pathologically long answer list without giving up on it", async () => {
    /*
     * An answer list is chosen by the scanned network, not by us, so its
     * length is untrusted input like everything else in a PTR answer. Five
     * thousand junk records must neither name the host nor cost more than the
     * pass can afford — and the search must still reach the good record at the
     * end, because "stop after the first few" would be exactly the kind of
     * quiet cap that reintroduces issue #3529 for one unlucky host. The test's
     * own timeout is the bound on "without pathological behaviour"; a scan
     * that walked this quadratically would never reach the assertions.
     */
    const junkAnswers: Array<string> = Array.from(
      { length: 5000 },
      (_unused: unknown, index: number): string => {
        return `${index}.166.18.10.in-addr.arpa`;
      },
    );

    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        if (ipAddress === "10.0.0.2") {
          return [...junkAnswers.slice(0, 4999), "sw-core-01.corp.example.com"];
        }

        return junkAnswers;
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
      "10.0.0.2",
    ]);

    expect(result.hostnameByIpAddress.has("10.0.0.1")).toBe(false);
    expect(result.hostnameByIpAddress.get("10.0.0.2")).toBe(
      "sw-core-01.corp.example.com",
    );
    expect(result.isReverseDnsAvailable).toBe(true);
  });
});

describe("ReverseDnsResolver — an address the resolver cannot parse", () => {
  it("names the hosts either side of a malformed address", async () => {
    /*
     * attachReverseDnsHostnames is public and takes whatever a sweep result
     * carried, so a value that is not a parseable address can reach the
     * lookup — Node rejects those with EINVAL before any query leaves the
     * host. Classified as infrastructure (which it was, until this
     * hardening), a budget's worth of malformed entries would convict a
     * perfectly good resolver and skip every real address behind them. The
     * budget of one is what makes this test able to fail.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        if (ipAddress === "10.0.0.9") {
          return ["sw-core-01.corp.example.com"];
        }

        throw dnsError("EINVAL", `getHostByAddr EINVAL ${ipAddress}`);
      },
      { failureBudget: 1 },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      " 10.18.166.51 ",
      "not-an-ip-address",
      "10.18.166.51/32",
      "10.0.0.9",
    ]);

    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(result.hostnameByIpAddress.get("10.0.0.9")).toBe(
      "sw-core-01.corp.example.com",
    );
  });
});

describe("ReverseDnsResolver — the default lookup", () => {
  /*
   * buildDefaultLookup is the only code in this file's subject that talks to a
   * resolver, and this suite may not send a query.
   *
   * It is exported with an injectable resolver FACTORY for exactly that
   * reason. Before the seam existed, three things in it were unreachable from
   * any test — the Promise.race's timeout arm, the `resolver.cancel()` inside
   * it, and the `finally` that clears the timer — and deleting the cancel or
   * the finally broke nothing. That is the state a piece of cleanup code
   * should never be in: the cancel is what stops a black-holing forwarder
   * leaving one outstanding query and one retry timer behind per timed-out
   * address, on a resolver object the sweep no longer holds.
   *
   * The real dns.promises.Resolver is still exercised once below, on the one
   * path that cannot reach the network: `reverse()` on an unparseable address
   * fails inside ares_inet_pton and rejects with EINVAL without emitting
   * anything.
   */

  /*
   * A resolver that never answers, and remembers whether it was cancelled.
   * Nothing here touches DNS.
   */
  function neverAnsweringResolver(): ReverseDnsResolverLike & {
    cancelCount: number;
  } {
    const stub: ReverseDnsResolverLike & { cancelCount: number } = {
      cancelCount: 0,
      reverse: (): Promise<Array<string>> => {
        return new Promise<Array<string>>(() => {});
      },
      cancel: (): void => {
        stub.cancelCount++;
      },
    };

    return stub;
  }

  it("gives up on a resolver that never answers, and says so", async () => {
    const stub: ReverseDnsResolverLike & { cancelCount: number } =
      neverAnsweringResolver();

    const lookup: ReverseDnsLookupFunction = buildDefaultLookup(20, () => {
      return stub;
    });

    /*
     * The timeout arm, reached for the first time. Without it this await
     * never returns — which is the failure the arm exists to prevent, and the
     * reason the assertion is on the rejection rather than on a flag.
     */
    await expect(lookup("10.18.166.51")).rejects.toThrow(/timed out/);
  });

  it("cancels the query it abandoned", async () => {
    /*
     * Losing the race is not the same as the query being over. c-ares is
     * still holding it, and on a forwarder that answers nothing every address
     * in the sweep would leave one behind. Deleting `resolver.cancel()` from
     * the timeout branch fails only this assertion.
     */
    const stub: ReverseDnsResolverLike & { cancelCount: number } =
      neverAnsweringResolver();

    const lookup: ReverseDnsLookupFunction = buildDefaultLookup(20, () => {
      return stub;
    });

    await expect(lookup("10.18.166.51")).rejects.toThrow(/timed out/);

    expect(stub.cancelCount).toBe(1);
  });

  it("does not cancel a query that answered in time", async () => {
    /*
     * The other half, and the one that pins the `finally` clearing the timer.
     * Promise.race leaves the loser pending, so an uncleared timer would fire
     * 20ms after this fast answer and call cancel() on a resolver whose result
     * is already in the caller's map. On a sweep of thousands of hosts that is
     * thousands of live timers, each ending in a pointless cancel.
     */
    const stub: ReverseDnsResolverLike & { cancelCount: number } = {
      cancelCount: 0,
      reverse: async (): Promise<Array<string>> => {
        return ["sw-core-01.corp.example.com"];
      },
      cancel: (): void => {
        stub.cancelCount++;
      },
    };

    const lookup: ReverseDnsLookupFunction = buildDefaultLookup(20, () => {
      return stub;
    });

    await expect(lookup("10.18.166.51")).resolves.toEqual([
      "sw-core-01.corp.example.com",
    ]);

    // Long enough that an uncleared 20ms timer would have fired by now.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 60);
    });

    expect(stub.cancelCount).toBe(0);
  });

  it("passes a rejection from the resolver through unchanged", async () => {
    // The classifier reads `code`, so the error object must survive the race.
    const lookup: ReverseDnsLookupFunction = buildDefaultLookup(50, () => {
      return {
        reverse: (): Promise<Array<string>> => {
          return Promise.reject(dnsError("ECONNREFUSED", "connect refused"));
        },
        cancel: (): void => {
          return undefined;
        },
      };
    });

    await expect(lookup("10.18.166.51")).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });

  it("completes, names nothing, and blames no infrastructure for an unparseable address", async () => {
    /*
     * The REAL dns.promises.Resolver, on the one path that cannot reach the
     * network: reverse() rejects in ares_inet_pton with EINVAL before a packet
     * is built. The lookup is injected rather than defaulted so that this
     * construction is not the one exception to the rule
     * ReverseDnsStubIntegrity.test.ts enforces — the real resolver is reached
     * through buildDefaultLookup itself, which is what is under test.
     */
    const resolver: ReverseDnsResolver = new ReverseDnsResolver({
      lookup: buildDefaultLookup(50),
      concurrency: 1,
      failureBudget: 1,
    });

    const result: ReverseDnsResolution = await resolver.resolveHostnames([
      "not-an-ip-address",
      " 10.18.166.51 ",
    ]);

    expect(result.hostnameByIpAddress.size).toBe(0);
    /*
     * The load-bearing assertion. A budget of one means that if the default
     * lookup's EINVAL were read as "this probe cannot resolve", the second
     * address would never be asked and this would be false.
     */
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(result.isTimeBudgetExhausted).toBe(false);
  });
});

describe("ReverseDnsResolver — options that make no sense", () => {
  /*
   * concurrency, failureBudget and totalBudgetInMs are each clamped with
   * Math.max(1, ...), and none of the three clamps is decoration.
   *
   * What they have in common is the shape of their failure: every one of the
   * three has a zero value that turns the feature off SILENTLY — no throw, no
   * warning, and in two of the three cases a result that still reports
   * isReverseDnsAvailable true with an empty map, which is indistinguishable
   * to the caller from a network where no host has a PTR record. Reverse DNS
   * is best-effort by design, so there is no failing test anywhere else in the
   * product that would notice; issue #3529 would simply come back, and the
   * only evidence would be an operator saying the hostnames stopped appearing.
   *
   * Zero is not a hypothetical value either. These come through
   * attachReverseDnsHostnames' options from a caller, and zero is what an
   * unset numeric config, a parsed empty string, or an arithmetic mistake in a
   * caller dividing a budget by a worker count all produce.
   */

  it.each([0, -4])(
    "treats a concurrency of %i as one address at a time",
    async (concurrency: number) => {
      /*
       * The worst of the three. Without the clamp the wave loop advances
       * `start` by zero, `slice(start, start + 0)` is empty, `Promise.all([])`
       * settles immediately — and the pass spins in the microtask queue
       * forever, never yielding, so a probe would hang inside an enrichment
       * with no timer able to fire and stop it. A negative value walks `start`
       * backwards for the same result. This test does not merely fail without
       * the clamp; it never finishes.
       */
      const asked: Array<string> = [];
      const resolver: ReverseDnsResolver = resolverWith(
        async (ipAddress: string): Promise<Array<string>> => {
          asked.push(ipAddress);
          return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
        },
        { concurrency: concurrency },
      );

      const result: ReverseDnsResolution = await resolver.resolveHostnames(
        addressList(3),
      );

      expect(asked).toHaveLength(3);
      expect(result.hostnameByIpAddress.size).toBe(3);
      expect(result.isReverseDnsAvailable).toBe(true);
    },
  );

  it.each([0, -4])(
    "treats a failure budget of %i as one failure, not as none",
    async (failureBudget: number) => {
      /*
       * Without the clamp the breaker's second clause is
       * `infrastructureFailureCount >= 0`, which is true before a single
       * lookup has been made. The very first wave boundary — the one checked
       * BEFORE any wave runs — would find the pass unusable, warn that this
       * probe cannot resolve, ask nothing at all, and return
       * isReverseDnsAvailable false for a resolver that answers every query
       * put to it. Every host in every scan would be named by IP.
       */
      const asked: Array<string> = [];
      const resolver: ReverseDnsResolver = resolverWith(
        async (ipAddress: string): Promise<Array<string>> => {
          asked.push(ipAddress);
          return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
        },
        { failureBudget: failureBudget },
      );

      const result: ReverseDnsResolution = await resolver.resolveHostnames(
        addressList(3),
      );

      expect(asked).toHaveLength(3);
      expect(result.hostnameByIpAddress.size).toBe(3);
      expect(result.isReverseDnsAvailable).toBe(true);
      expect(warnedMessages).toHaveLength(0);
    },
  );

  it.each([0, -4])(
    "treats a total budget of %i ms as one millisecond, not as a deadline already past",
    async (totalBudgetInMs: number) => {
      /*
       * Without the clamp the deadline is `now() + 0`, so the first reading of
       * the clock is already `>= deadline`: the pass asks nothing, warns that
       * it ran out of time, and reports isTimeBudgetExhausted on a sweep it
       * never began.
       *
       * The clock is FROZEN rather than stepping, which is what makes the
       * clamp observable at all: one millisecond of budget is only enough to
       * do any work if no time passes, and a stepping clock would spend it on
       * the first reading and make clamped and unclamped look alike.
       */
      const asked: Array<string> = [];
      const resolver: ReverseDnsResolver = resolverWith(
        async (ipAddress: string): Promise<Array<string>> => {
          asked.push(ipAddress);
          return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
        },
        {
          totalBudgetInMs: totalBudgetInMs,
          now: (): number => {
            return 0;
          },
        },
      );

      const result: ReverseDnsResolution = await resolver.resolveHostnames(
        addressList(3),
      );

      expect(asked).toHaveLength(3);
      expect(result.hostnameByIpAddress.size).toBe(3);
      expect(result.isTimeBudgetExhausted).toBe(false);
      expect(warnedMessages).toHaveLength(0);
    },
  );
});

describe("ReverseDnsResolver — one instance, two sweeps", () => {
  /*
   * A probe holds its resolver across sweeps, so every pass after the first is
   * the one that matters in production, and all of this pass's budget state
   * lives in locals and a `state` object created inside resolveHostnames
   * rather than on `this`.
   *
   * That is not an incidental implementation detail: the whole hardening this
   * file exists for was "a latched flag becomes a recomputed function", and
   * the most natural way to reintroduce the original bug in a worse form is to
   * hoist a counter onto the instance for convenience. A tripped budget that
   * survives into the next sweep would name every host by IP for the lifetime
   * of the probe, on the strength of one bad minute — and would look, in every
   * log and every result, exactly like a network with no reverse zone.
   */

  it("does not carry a tripped failure budget into the next sweep", async () => {
    let isResolverBroken: boolean = true;
    const asked: Array<string> = [];

    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        if (isResolverBroken) {
          throw dnsError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.53:53");
        }

        return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
      },
      { concurrency: 4, failureBudget: 2 },
    );

    const brokenPass: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(12),
    );

    // The first sweep really did trip: one wave, then nothing.
    expect(asked).toHaveLength(4);
    expect(brokenPass.isReverseDnsAvailable).toBe(false);
    expect(brokenPass.failureReason).toContain("ECONNREFUSED");

    // The resolver comes back — a restarted container, a firewall rule fixed.
    isResolverBroken = false;
    asked.length = 0;
    warnedMessages = [];

    const healthyPass: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(12),
    );

    /*
     * Hoist infrastructureFailureCount or successfulLookupCount onto the
     * instance and this second pass never starts: at its first wave boundary
     * the leaked counters read "two failures, no successes", the breaker is
     * already tripped, and `asked` is zero rather than twelve.
     */
    expect(asked).toHaveLength(12);
    expect(healthyPass.isReverseDnsAvailable).toBe(true);
    expect(healthyPass.hostnameByIpAddress.size).toBe(12);
    // Nor does the previous sweep's reason bleed into this one's result.
    expect(healthyPass.failureReason).toBeUndefined();
    expect(warnedMessages).toHaveLength(0);
  });

  it("gives the next sweep its own wall-clock budget", async () => {
    /*
     * The deadline is computed from `now()` at the top of each call. Compute
     * it once — in the constructor, say, which is where a reader optimising
     * "this never changes" would put it — and the first sweep to exhaust its
     * budget would leave every later sweep on the same probe permanently past
     * its deadline, asking nothing and reporting exhaustion forever.
     */
    let clock: number = 0;

    const asked: Array<string> = [];
    const resolver: ReverseDnsResolver = resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);
        // Each lookup costs 100ms of the injected clock.
        clock += 100;
        return [`host-${ipAddress.split(".").pop()}.corp.example.com`];
      },
      {
        concurrency: 1,
        totalBudgetInMs: 250,
        now: (): number => {
          return clock;
        },
      },
    );

    // Deadline 250; readings at 0, 100 and 200 buy three addresses of five.
    const firstPass: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(5),
    );

    expect(asked).toHaveLength(3);
    expect(firstPass.isTimeBudgetExhausted).toBe(true);

    // A new sweep, on the same instance, at the top of a new minute.
    clock = 0;
    asked.length = 0;
    warnedMessages = [];

    const secondPass: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(3),
    );

    // A fresh deadline of 250: readings at 0, 100, 200 cover all three.
    expect(asked).toHaveLength(3);
    expect(secondPass.isTimeBudgetExhausted).toBe(false);
    expect(secondPass.hostnameByIpAddress.size).toBe(3);
    expect(warnedMessages).toHaveLength(0);
  });
});

describe("ReverseDnsResolver — the two verdicts are independent", () => {
  /*
   * `isReverseDnsAvailable` and `isTimeBudgetExhausted` answer different
   * questions — "does DNS work from this probe" versus "was this pass simply
   * too big to finish" — and the caller logs them differently. Deriving one
   * from the other would tell an operator with four thousand healthy hosts
   * that their probe has no resolver.
   */

  it("keeps availability true when only the wall clock ran out", async () => {
    /*
     * A clock that jumps a full budget on its second reading: the deadline is
     * taken from the first, so the very first address is already too late.
     */
    let reading: number = 0;
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        return ["sw-core-01.corp.example.com"];
      },
      {
        totalBudgetInMs: 100,
        now: (): number => {
          const value: number = reading;
          reading += 1000;
          return value;
        },
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(5),
    );

    expect(result.isTimeBudgetExhausted).toBe(true);
    // Nothing was ever asked, so nothing is known against the resolver.
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failureReason).toBeUndefined();
  });

  it("keeps the time budget unexhausted when only the resolver is broken", async () => {
    /*
     * A clock that never moves: the wall-clock budget cannot be what stopped
     * this pass, so the false below can only come from the failure budget.
     */
    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        throw dnsError("ECONNREFUSED");
      },
      {
        failureBudget: 2,
        now: (): number => {
          return 0;
        },
      },
    );

    const result: ReverseDnsResolution = await resolver.resolveHostnames(
      addressList(20),
    );

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.isTimeBudgetExhausted).toBe(false);
  });
});
