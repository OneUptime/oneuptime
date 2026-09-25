// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  classifyReverseDnsLookupError,
  ReverseDnsLookupErrorClassification,
  ReverseDnsLookupFunction,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import { fakeDnsError } from "../../TestingUtils/FakeReverseDnsResolver";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
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
 * OneUptime issue #3916 — "why does this host have no name?"
 *
 * Before this, a pass reported names and a handful of pass-wide counts, and
 * nothing about any single address. A kitchen display with no PTR record, one
 * whose lookup timed out, one the DNS server answered SERVFAIL for and one
 * the pass never reached all came back identically: absent from the map. The
 * Review dialog could only show a bare address, and an operator who knew the
 * device had a name could only conclude the product was broken.
 *
 * So every distinct address a pass is given now ends in exactly one of two
 * places: hostnameByIpAddress (it has a name) or statusByIpAddress (why it
 * has none). This suite pins the second map — which code each outcome
 * becomes, that the code and the failure budget read an outcome the same
 * way, and that the two maps partition the input exactly. It runs every
 * resolver WITHOUT a retry lookup, so what it sees is the first pass alone;
 * the retry is ReverseDnsResolverRetry.test.ts.
 *
 * NO TEST HERE SENDS A QUERY: every lookup is injected.
 */

let warnedMessages: Array<string> = [];

beforeEach(() => {
  warnedMessages = [];

  jest.spyOn(logger, "warn").mockImplementation((message: unknown): never => {
    warnedMessages.push(String(message));
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

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
    concurrency: options?.concurrency ?? 1,
    failureBudget: options?.failureBudget,
    totalBudgetInMs: options?.totalBudgetInMs,
    now: options?.now,
  });
}

function addressList(count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}`;
    },
  );
}

function steppingClock(stepInMs: number): () => number {
  let current: number = 0;

  return (): number => {
    const value: number = current;
    current += stepInMs;
    return value;
  };
}

/*
 * The invariant every caller relies on, checked on every pass below that
 * can break it: each distinct input address is named or explained, never
 * both, never neither.
 */
function expectPartition(
  result: ReverseDnsResolution,
  input: Array<string>,
): void {
  const named: Array<string> = [...result.hostnameByIpAddress.keys()];
  const explained: Array<string> = [...result.statusByIpAddress!.keys()];

  for (const ipAddress of named) {
    expect(result.statusByIpAddress!.has(ipAddress)).toBe(false);
  }

  expect([...named, ...explained].sort()).toEqual(
    [...new Set<string>(input)].sort(),
  );
}

const FAILURE_STATUSES: Array<DiscoveredHostReverseDnsStatus> = [
  DiscoveredHostReverseDnsStatus.Timeout,
  DiscoveredHostReverseDnsStatus.ServerFailure,
  DiscoveredHostReverseDnsStatus.Refused,
  DiscoveredHostReverseDnsStatus.Unreachable,
  DiscoveredHostReverseDnsStatus.Failed,
];

function countFailureStatuses(result: ReverseDnsResolution): number {
  return [...result.statusByIpAddress!.values()].filter(
    (status: DiscoveredHostReverseDnsStatus): boolean => {
      return FAILURE_STATUSES.includes(status);
    },
  ).length;
}

describe("classifyReverseDnsLookupError — what each rejection means", () => {
  /*
   * The table the dashboard's tooltip copy is written against. Each row is a
   * promise: change one and an operator is told something different about
   * the same DNS server behaviour.
   */
  const table: Array<
    [
      string,
      string,
      ReverseDnsLookupErrorClassification["kind"],
      DiscoveredHostReverseDnsStatus,
    ]
  > = [
    // The two ordinary "no record" answers resolvePtr gives, and their other spellings.
    [
      "NXDOMAIN",
      "ENOTFOUND",
      "no-record",
      DiscoveredHostReverseDnsStatus.NoRecord,
    ],
    ["NODATA", "ENODATA", "no-record", DiscoveredHostReverseDnsStatus.NoRecord],
    [
      "NOTFOUND",
      "NOTFOUND",
      "no-record",
      DiscoveredHostReverseDnsStatus.NoRecord,
    ],
    [
      "NODATA (bare)",
      "NODATA",
      "no-record",
      DiscoveredHostReverseDnsStatus.NoRecord,
    ],
    // An argument c-ares could not use: the address's fault, not the resolver's.
    [
      "an unparseable address",
      "EINVAL",
      "malformed-input",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
    [
      "a bad name",
      "EBADNAME",
      "malformed-input",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
    [
      "a bad string",
      "EBADSTR",
      "malformed-input",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
    // The failures reverse() used to report as ENOTFOUND.
    [
      "a timeout",
      "ETIMEOUT",
      "failure",
      DiscoveredHostReverseDnsStatus.Timeout,
    ],
    [
      "SERVFAIL",
      "ESERVFAIL",
      "failure",
      DiscoveredHostReverseDnsStatus.ServerFailure,
    ],
    ["REFUSED", "EREFUSED", "failure", DiscoveredHostReverseDnsStatus.Refused],
    [
      "nothing listening",
      "ECONNREFUSED",
      "failure",
      DiscoveredHostReverseDnsStatus.Unreachable,
    ],
    // Everything else is a failure the budget must count.
    ["NOTIMP", "ENOTIMP", "failure", DiscoveredHostReverseDnsStatus.Failed],
    ["FORMERR", "EFORMERR", "failure", DiscoveredHostReverseDnsStatus.Failed],
    [
      "a bad response",
      "EBADRESP",
      "failure",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
    [
      "a cancelled query",
      "ECANCELLED",
      "failure",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
    [
      "a lower-case spelling",
      "etimeout",
      "failure",
      DiscoveredHostReverseDnsStatus.Failed,
    ],
  ];

  it.each(table)(
    "reads %s (%s) as %s / %s",
    (
      _label: string,
      code: string,
      kind: ReverseDnsLookupErrorClassification["kind"],
      status: DiscoveredHostReverseDnsStatus,
    ) => {
      expect(classifyReverseDnsLookupError(fakeDnsError(code))).toEqual({
        kind: kind,
        status: status,
      });
    },
  );

  it.each([
    ["a code-less Error", new Error("something broke")],
    ["a thrown string", "a string, not an Error"],
    ["undefined", undefined],
    ["null", null],
    ["a numeric code", { code: 503 }],
  ])(
    "reads %s as a failure the budget counts",
    (_label: string, thrown: unknown) => {
      /*
       * The unrecognised case defaults to COUNTING. The opposite default
       * would make the failure budget unreachable exactly when a resolver
       * fails in a way nobody anticipated.
       */
      expect(classifyReverseDnsLookupError(thrown)).toEqual({
        kind: "failure",
        status: DiscoveredHostReverseDnsStatus.Failed,
      });
    },
  );

  it("reads the code, never the message", () => {
    /*
     * A message is prose — c-ares', or a wrapper's — and matching on it
     * would let "timed out" in a SERVFAIL's text turn it into a timeout, or
     * a code-less error that merely SAYS "not found" into "no record", which
     * would hide a real failure behind the ordinary outcome.
     */
    expect(
      classifyReverseDnsLookupError(
        fakeDnsError("ESERVFAIL", "upstream timed out: SERVFAIL"),
      ).status,
    ).toBe(DiscoveredHostReverseDnsStatus.ServerFailure);
    expect(
      classifyReverseDnsLookupError(new Error("queryPtr ENOTFOUND 1.0.0.10")),
    ).toEqual({
      kind: "failure",
      status: DiscoveredHostReverseDnsStatus.Failed,
    });
  });
});

describe("ReverseDnsResolver — the status of an address whose lookup rejected", () => {
  it.each([
    ["ENOTFOUND", DiscoveredHostReverseDnsStatus.NoRecord],
    ["ENODATA", DiscoveredHostReverseDnsStatus.NoRecord],
    ["NOTFOUND", DiscoveredHostReverseDnsStatus.NoRecord],
    ["NODATA", DiscoveredHostReverseDnsStatus.NoRecord],
  ])(
    "records %s as %s, answered, costing the budget nothing",
    async (code: string, status: DiscoveredHostReverseDnsStatus) => {
      const input: Array<string> = addressList(4);

      const result: ReverseDnsResolution = await resolverWith(
        async (): Promise<Array<string>> => {
          throw fakeDnsError(code);
        },
        { failureBudget: 2 },
      ).resolveHostnames(input);

      for (const ipAddress of input) {
        expect(result.statusByIpAddress!.get(ipAddress)).toBe(status);
      }

      // Four past a budget of two, and every address still asked.
      expect(result.lookedUpCount).toBe(4);
      expect(result.isReverseDnsAvailable).toBe(true);
      expect(result.failedAddressCount).toBe(0);
      expect(result.failureReason).toBeUndefined();
      expectPartition(result, input);
    },
  );

  it.each(["EINVAL", "EBADNAME", "EBADSTR"])(
    "records a malformed-input %s as a failed lookup, without blaming the resolver",
    async (code: string) => {
      /*
       * Failed rather than NoRecord: the address was never asked about, and
       * telling an operator "this device has no PTR record" about a value
       * that was not even an address would be a false statement. But it is
       * the ARGUMENT's fault, so it is counted like a lookup that came back —
       * exactly as it always was — and sets no failureReason.
       */
      const input: Array<string> = [" 10.0.0.1 ", "10.0.0.2/32", "junk"];

      const result: ReverseDnsResolution = await resolverWith(
        async (): Promise<Array<string>> => {
          throw fakeDnsError(code);
        },
        { failureBudget: 1 },
      ).resolveHostnames(input);

      for (const ipAddress of input) {
        expect(result.statusByIpAddress!.get(ipAddress)).toBe(
          DiscoveredHostReverseDnsStatus.Failed,
        );
      }

      expect(result.lookedUpCount).toBe(3);
      expect(result.isReverseDnsAvailable).toBe(true);
      expect(result.failureReason).toBeUndefined();
      // A failed lookup, so it is counted as one.
      expect(result.failedAddressCount).toBe(3);
      expect(warnedMessages).toHaveLength(0);
    },
  );

  it.each([
    ["ETIMEOUT", DiscoveredHostReverseDnsStatus.Timeout],
    ["ESERVFAIL", DiscoveredHostReverseDnsStatus.ServerFailure],
    ["EREFUSED", DiscoveredHostReverseDnsStatus.Refused],
    ["ECONNREFUSED", DiscoveredHostReverseDnsStatus.Unreachable],
    ["ENOTIMP", DiscoveredHostReverseDnsStatus.Failed],
  ])(
    "records %s as %s and spends the failure budget on it",
    async (code: string, status: DiscoveredHostReverseDnsStatus) => {
      /*
       * Budget of two, one at a time: two failures are counted, the breaker
       * trips at the third wave boundary, and the third address is never
       * asked. The status and the budget have to read the same rejection the
       * same way, or the tooltip would call "SERVFAIL" something the budget
       * treated as an answer.
       */
      const input: Array<string> = addressList(3);

      const result: ReverseDnsResolution = await resolverWith(
        async (): Promise<Array<string>> => {
          throw fakeDnsError(code);
        },
        { failureBudget: 2 },
      ).resolveHostnames(input);

      expect(result.statusByIpAddress!.get(input[0]!)).toBe(status);
      expect(result.statusByIpAddress!.get(input[1]!)).toBe(status);
      expect(result.statusByIpAddress!.get(input[2]!)).toBe(
        DiscoveredHostReverseDnsStatus.SkippedNoResolver,
      );
      expect(result.isReverseDnsAvailable).toBe(false);
      expect(result.failedAddressCount).toBe(2);
      expect(result.failureReason).toContain(code);
      expectPartition(result, input);
    },
  );

  it("records the race guard's own timeout as a timeout", async () => {
    // The shape buildDefaultLookup's race rejects with: ETIMEOUT, our words.
    const result: ReverseDnsResolution = await resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        throw fakeDnsError(
          "ETIMEOUT",
          `Reverse DNS lookup for ${ipAddress} timed out after 2000ms`,
        );
      },
    ).resolveHostnames(["10.18.166.51"]);

    expect(result.statusByIpAddress!.get("10.18.166.51")).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(result.failureReason).toContain("timed out after 2000ms");
  });

  it("still counts a code-less error as an infrastructure failure", async () => {
    /*
     * What "counts our own timeout as an infrastructure failure" in
     * ReverseDnsResolver.test.ts pinned before the race's error carried a
     * code: an error nobody recognises must spend the budget, or a resolver
     * failing in an unforeseen way could never trip it.
     */
    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        throw new Error("something nobody anticipated");
      },
      { failureBudget: 2 },
    ).resolveHostnames(addressList(4));

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.lookedUpCount).toBe(2);
    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.Failed,
    );
    expect(result.failureReason).toBe("something nobody anticipated");
  });
});

describe("ReverseDnsResolver — the status of an address whose lookup came back", () => {
  it("records no status for an address it named", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        return ["sw-core-01.corp.example.com"];
      },
    ).resolveHostnames(["10.0.0.1"]);

    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "sw-core-01.corp.example.com",
    );
    expect(result.statusByIpAddress!.size).toBe(0);
    expect(result.failedAddressCount).toBe(0);
  });

  it("records an empty answer list as 'no record'", async () => {
    // What a lookup that found nothing, without rejecting, has told us.
    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        return [];
      },
    ).resolveHostnames(["10.0.0.1"]);

    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "sw-core-01.corp.example.com"],
    ["an object", { hostname: "sw-core-01.corp.example.com" }],
  ])(
    "records %s from the lookup as 'no record', not as a failure",
    async (_label: string, value: unknown) => {
      const result: ReverseDnsResolution = await resolverWith(
        (async (): Promise<unknown> => {
          return value;
        }) as unknown as ReverseDnsLookupFunction,
        { failureBudget: 1 },
      ).resolveHostnames(["10.0.0.1", "10.0.0.2"]);

      expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
        DiscoveredHostReverseDnsStatus.NoRecord,
      );
      expect(result.failedAddressCount).toBe(0);
      expect(result.isReverseDnsAvailable).toBe(true);
    },
  );

  it("records answers that all normalise away as an unusable name, not as 'no record'", async () => {
    /*
     * The distinction an operator needs: `dig -x` on this address DOES show
     * a PTR record, so "no PTR record" would send them looking for a record
     * that exists. What is wrong is the record's content — an in-addr.arpa
     * echo, a label with a space in it — and the naming rules refused it.
     */
    const result: ReverseDnsResolution = await resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        return [
          `${ipAddress.split(".").reverse().join(".")}.in-addr.arpa`,
          "core switch",
          "<script>alert(1)</script>",
        ];
      },
    ).resolveHostnames(["10.0.0.1"]);

    expect(result.hostnameByIpAddress.size).toBe(0);
    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.UnusableName,
    );
    // It answered: not a failure, and the resolver is working.
    expect(result.failedAddressCount).toBe(0);
    expect(result.isReverseDnsAvailable).toBe(true);
  });

  it("records a list of non-strings as an unusable name: something came back, and none of it was a name", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      (async (): Promise<unknown> => {
        return [null, 42, {}];
      }) as unknown as ReverseDnsLookupFunction,
    ).resolveHostnames(["10.0.0.1"]);

    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.UnusableName,
    );
  });

  it("names the host after a usable answer that follows unusable ones, with no status", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        return ["1.0.0.10.in-addr.arpa", "sw-core-01.corp.example.com"];
      },
    ).resolveHostnames(["10.0.0.1"]);

    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "sw-core-01.corp.example.com",
    );
    expect(result.statusByIpAddress!.has("10.0.0.1")).toBe(false);
  });
});

describe("ReverseDnsResolver — the status of an address the pass never asked", () => {
  it("marks every address past a spent wall-clock budget as skipped for time", async () => {
    // Deadline 250, readings at 100 and 200 start two waves of four; 300 stops.
    const asked: Array<string> = [];
    const input: Array<string> = addressList(10);

    const result: ReverseDnsResolution = await resolverWith(
      async (ipAddress: string): Promise<Array<string>> => {
        asked.push(ipAddress);

        if (ipAddress === "10.0.0.1") {
          return ["gateway.corp.example.com"];
        }

        throw fakeDnsError("ENOTFOUND");
      },
      { concurrency: 4, totalBudgetInMs: 250, now: steppingClock(100) },
    ).resolveHostnames(input);

    expect(asked).toHaveLength(8);
    expect(result.isTimeBudgetExhausted).toBe(true);

    for (const ipAddress of input.slice(8)) {
      expect(result.statusByIpAddress!.get(ipAddress)).toBe(
        DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
      );
    }

    // The asked ones keep what they were actually told.
    expect(result.statusByIpAddress!.get("10.0.0.2")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
    expect(result.hostnameByIpAddress.get("10.0.0.1")).toBe(
      "gateway.corp.example.com",
    );
    // A skipped address is not a FAILED lookup: it was never made.
    expect(result.failedAddressCount).toBe(0);
    expectPartition(result, input);
  });

  it("marks every address after the breaker tripped as skipped for want of a resolver", async () => {
    const input: Array<string> = addressList(12);

    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        throw fakeDnsError("ECONNREFUSED");
      },
      { concurrency: 4, failureBudget: 2 },
    ).resolveHostnames(input);

    expect(result.lookedUpCount).toBe(4);
    expect(result.isReverseDnsAvailable).toBe(false);

    const statuses: Array<DiscoveredHostReverseDnsStatus | undefined> =
      input.map((ipAddress: string) => {
        return result.statusByIpAddress!.get(ipAddress);
      });

    expect(statuses.slice(0, 4)).toEqual(
      Array(4).fill(DiscoveredHostReverseDnsStatus.Unreachable),
    );
    expect(statuses.slice(4)).toEqual(
      Array(8).fill(DiscoveredHostReverseDnsStatus.SkippedNoResolver),
    );
    expect(result.failedAddressCount).toBe(4);
    expect(result.notLookedUpCount).toBe(8);
    expectPartition(result, input);
  });

  it("marks every address as skipped for time when the budget ran out before the first wave", async () => {
    const input: Array<string> = ["10.0.0.1", "10.0.0.2", "10.0.0.1"];

    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        return ["never.example.com"];
      },
      { totalBudgetInMs: 100, now: steppingClock(1000) },
    ).resolveHostnames(input);

    expect(result.lookedUpCount).toBe(0);
    expect([...result.statusByIpAddress!.entries()]).toEqual([
      ["10.0.0.1", DiscoveredHostReverseDnsStatus.SkippedTimeBudget],
      ["10.0.0.2", DiscoveredHostReverseDnsStatus.SkippedTimeBudget],
    ]);
  });

  it("marks nothing as skipped when the breaker's verdict lands on the final wave", async () => {
    /*
     * The resolver is reported unusable, but every address was asked, so
     * every address has the outcome it actually had — none is "skipped".
     */
    const input: Array<string> = addressList(8);

    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        throw fakeDnsError("ECONNREFUSED");
      },
      { concurrency: 4, failureBudget: 5 },
    ).resolveHostnames(input);

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.notLookedUpCount).toBe(0);
    expect(
      [...result.statusByIpAddress!.values()].every(
        (status: DiscoveredHostReverseDnsStatus): boolean => {
          return status === DiscoveredHostReverseDnsStatus.Unreachable;
        },
      ),
    ).toBe(true);
    expect(result.failedAddressCount).toBe(8);
  });
});

describe("ReverseDnsResolver — names and statuses partition the addresses passed in", () => {
  /*
   * The dashboard reads a host's status only when it has no name, and the
   * scan's status message reads failedAddressCount; both are wrong if an
   * address can be in neither map, in both, or counted twice. Checked over
   * a mixed pass rather than per outcome, because the bugs this catches are
   * the interactions — a duplicate address, a name after an unusable answer.
   */
  const outcomes: Record<string, () => Promise<Array<string>>> = {
    "10.0.0.1": async (): Promise<Array<string>> => {
      return ["sw-core-01.corp.example.com"];
    },
    "10.0.0.2": async (): Promise<Array<string>> => {
      throw fakeDnsError("ENOTFOUND");
    },
    "10.0.0.3": async (): Promise<Array<string>> => {
      throw fakeDnsError("ENODATA");
    },
    "10.0.0.4": async (): Promise<Array<string>> => {
      throw fakeDnsError("ETIMEOUT");
    },
    "10.0.0.5": async (): Promise<Array<string>> => {
      throw fakeDnsError("ESERVFAIL");
    },
    "10.0.0.6": async (): Promise<Array<string>> => {
      throw fakeDnsError("EREFUSED");
    },
    "10.0.0.7": async (): Promise<Array<string>> => {
      throw fakeDnsError("ECONNREFUSED");
    },
    "10.0.0.8": async (): Promise<Array<string>> => {
      return ["8.0.0.10.in-addr.arpa"];
    },
    "10.0.0.9": async (): Promise<Array<string>> => {
      return [];
    },
    " 10.0.0.10 ": async (): Promise<Array<string>> => {
      throw fakeDnsError("EINVAL");
    },
    "10.0.0.11": async (): Promise<Array<string>> => {
      throw new Error("unexpected");
    },
    "10.0.0.12": async (): Promise<Array<string>> => {
      return ["printer.corp.example.com"];
    },
  };

  const lookup: ReverseDnsLookupFunction = (
    ipAddress: string,
  ): Promise<Array<string>> => {
    return outcomes[ipAddress]!();
  };

  it.each([1, 3, 32])(
    "at a concurrency of %i, with every address listed twice",
    async (concurrency: number) => {
      const distinct: Array<string> = Object.keys(outcomes);
      const input: Array<string> = [...distinct, ...distinct.slice(0, 6)];

      const result: ReverseDnsResolution = await resolverWith(lookup, {
        concurrency: concurrency,
      }).resolveHostnames(input);

      expectPartition(result, input);

      expect(result.hostnameByIpAddress.size).toBe(2);
      expect(Object.fromEntries(result.statusByIpAddress!)).toEqual({
        "10.0.0.2": DiscoveredHostReverseDnsStatus.NoRecord,
        "10.0.0.3": DiscoveredHostReverseDnsStatus.NoRecord,
        "10.0.0.4": DiscoveredHostReverseDnsStatus.Timeout,
        "10.0.0.5": DiscoveredHostReverseDnsStatus.ServerFailure,
        "10.0.0.6": DiscoveredHostReverseDnsStatus.Refused,
        "10.0.0.7": DiscoveredHostReverseDnsStatus.Unreachable,
        "10.0.0.8": DiscoveredHostReverseDnsStatus.UnusableName,
        "10.0.0.9": DiscoveredHostReverseDnsStatus.NoRecord,
        " 10.0.0.10 ": DiscoveredHostReverseDnsStatus.Failed,
        "10.0.0.11": DiscoveredHostReverseDnsStatus.Failed,
      });

      /*
       * Six failed lookups, and the count is derived from the statuses, not
       * kept beside them — a caller can recompute it and get the same answer.
       */
      expect(result.failedAddressCount).toBe(6);
      expect(result.failedAddressCount).toBe(countFailureStatuses(result));
      expect(result.lookedUpCount + result.notLookedUpCount).toBe(12);
    },
  );

  it("reports an empty map and no failures for an empty sweep", async () => {
    const result: ReverseDnsResolution = await resolverWith(
      async (): Promise<Array<string>> => {
        return [];
      },
    ).resolveHostnames([]);

    expect(result.statusByIpAddress).toEqual(
      new Map<string, DiscoveredHostReverseDnsStatus>(),
    );
    expect(result.failedAddressCount).toBe(0);
  });

  it("gives each pass on one instance its own statuses", async () => {
    /*
     * Like the budget counters, the map lives inside the pass. Hoisting it
     * onto the instance would carry a SERVFAIL from last night's scan onto a
     * host that answered this morning.
     */
    let isBroken: boolean = true;

    const resolver: ReverseDnsResolver = resolverWith(
      async (): Promise<Array<string>> => {
        if (isBroken) {
          throw fakeDnsError("ESERVFAIL");
        }

        return ["sw-core-01.corp.example.com"];
      },
    );

    const first: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    isBroken = false;

    const second: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.0.0.1",
    ]);

    expect(first.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.ServerFailure,
    );
    expect(second.statusByIpAddress!.size).toBe(0);
    expect(second.failedAddressCount).toBe(0);
    expect(first.statusByIpAddress).not.toBe(second.statusByIpAddress);
  });
});
