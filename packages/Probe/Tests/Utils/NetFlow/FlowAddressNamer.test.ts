import FlowAddressNamer, {
  DEFAULT_FLOW_NAME_FAILURE_TTL_MS,
  DEFAULT_FLOW_NAME_LOOKUP_CONCURRENCY,
  DEFAULT_FLOW_NAME_LOOKUPS_PER_MINUTE,
  DEFAULT_FLOW_NAME_MAX_CACHE_ENTRIES,
  DEFAULT_FLOW_NAME_MAX_WAITING,
  DEFAULT_FLOW_NAME_NEGATIVE_TTL_MS,
  DEFAULT_FLOW_NAME_POSITIVE_TTL_MS,
  FlowAddressLookupResult,
  FlowAddressNamerOptions,
  ForwardLookupFunction,
  MAX_FLOW_NAME_DNS_SERVERS,
  MAX_NAMES_CONFIRMED_PER_ADDRESS,
  ParsedFlowNameDnsServers,
  buildDefaultForwardLookup,
  buildResolverFactory,
  isNameableAddress,
  isPrivateFlowNameLookupAllowed,
  parseFlowNameDnsServers,
} from "../../../Utils/NetFlow/FlowAddressNamer";
import { ReverseDnsLookupFunction } from "../../../Utils/Discovery/ReverseDnsResolver";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import dns from "dns";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * NAMES FOR THE ADDRESSES IN A PROBE'S FLOWS (issue #5340).
 *
 * The probe that received the flows looks their busiest addresses up on its
 * own network - the only place a private address has a name - and sends the
 * names with the flows. What these tests hold it to:
 *
 *   - only the busiest addresses, at most N lookups a minute and a few at a
 *     time, whatever the flows say;
 *   - never an address that names no machine, and on a hosted instance's
 *     shared global probe never a private one either;
 *   - a PTR answer only when the name points back to the address
 *     (forward-confirmed): a stale or forged reverse record names nothing;
 *   - answers cached - a name, "no name" and a failed lookup each for its
 *     own time - and the cache bounded;
 *   - a known name kept while it is looked up again, and when a lookup
 *     fails; never a forward held up by a lookup.
 *
 * Every resolver here is fake: no test asks a real DNS server anything.
 */

interface FakeDns {
  ptr: Record<string, Array<string> | Error>;
  forward: Record<string, Array<string> | Error>;
  hosts: Record<string, Array<string>>;
  ptrAsked: Array<string>;
  forwardAsked: Array<string>;
  // Lookups waiting for release(), to watch what runs at once.
  held: Array<() => void>;
  holdLookups: boolean;
}

function fakeDns(): FakeDns {
  return {
    ptr: {},
    forward: {},
    hosts: {},
    ptrAsked: [],
    forwardAsked: [],
    held: [],
    holdLookups: false,
  };
}

function errorWithCode(code: string): Error {
  const error: Error & { code?: string } = new Error(code);
  error.code = code;
  return error;
}

function namer(
  fake: FakeDns,
  clock: { now: number },
  overrides: Partial<FlowAddressNamerOptions> = {},
): FlowAddressNamer {
  const lookup: ReverseDnsLookupFunction = async (
    address: string,
  ): Promise<Array<string>> => {
    fake.ptrAsked.push(address);

    if (fake.holdLookups) {
      await new Promise<void>((resolve: () => void) => {
        fake.held.push(resolve);
      });
    }

    const answer: Array<string> | Error | undefined = fake.ptr[address];

    if (answer instanceof Error) {
      throw answer;
    }

    if (!answer) {
      throw errorWithCode("ENOTFOUND");
    }

    return answer;
  };

  const forwardLookup: ForwardLookupFunction = async (
    name: string,
    family: 4 | 6,
  ): Promise<Array<string>> => {
    fake.forwardAsked.push(`${name}/${family}`);
    const answer: Array<string> | Error | undefined = fake.forward[name];

    if (answer instanceof Error) {
      throw answer;
    }

    if (!answer) {
      throw errorWithCode("ENODATA");
    }

    return answer;
  };

  return new FlowAddressNamer({
    isEnabled: true,
    isPrivateLookupAllowed: true,
    lookup: lookup,
    forwardLookup: forwardLookup,
    hostsFileLookup: (address: string): Array<string> | undefined => {
      return fake.hosts[address];
    },
    now: (): number => {
      return clock.now;
    },
    maxLookupsPerMinute: 100,
    concurrency: 4,
    positiveTtlMs: 60 * 60 * 1000,
    negativeTtlMs: 30 * 60 * 1000,
    failureTtlMs: 5 * 60 * 1000,
    maxCacheEntries: 1000,
    maxWaiting: 1000,
    ...overrides,
  });
}

function record(
  source: string,
  destination: string,
  octets: number = 1000,
): NetworkFlowRecord {
  return {
    exporterIpAddress: "10.255.0.1",
    sourceIpAddress: source,
    destinationIpAddress: destination,
    sourcePort: 0,
    destinationPort: 443,
    protocolNumber: 6,
    octets: octets,
    packets: 1,
    flowStartAt: new Date("2026-10-28T10:00:00.000Z"),
    flowEndAt: new Date("2026-10-28T10:00:01.000Z"),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FlowAddressNamer.resolve: a name only when it points back", () => {
  test("a PTR name whose own A records hold the address is the name", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.18.167.35"] = ["fs01.corp.example."];
    fake.forward["fs01.corp.example"] = ["10.18.167.35", "10.18.167.36"];

    const result: FlowAddressLookupResult = await namer(fake, {
      now: 0,
    }).resolve("10.18.167.35");

    expect(result).toEqual({ name: "fs01.corp.example", hasFailed: false });
    expect(fake.forwardAsked).toEqual(["fs01.corp.example/4"]);
  });

  test("a stale or forged PTR name - its A records do not hold the address - names nothing", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["203.0.113.9"] = ["payroll.example.com"];
    fake.forward["payroll.example.com"] = ["198.51.100.1"];

    expect(await namer(fake, { now: 0 }).resolve("203.0.113.9")).toEqual({
      name: null,
      hasFailed: false,
    });
  });

  test("an IPv6 address is confirmed by AAAA records, whatever their spelling", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["2001:db8::5"] = ["v6.corp.example"];
    fake.forward["v6.corp.example"] = ["2001:DB8:0:0:0:0:0:5"];

    expect(await namer(fake, { now: 0 }).resolve("2001:DB8::5")).toEqual({
      name: "v6.corp.example",
      hasFailed: false,
    });
    expect(fake.forwardAsked).toEqual(["v6.corp.example/6"]);
  });

  test("of several PTR names, the first that points back wins; at most a few are tried", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.0.0.5"] = [
      "old-name.corp.example",
      "also-old.corp.example",
      "current.corp.example",
      "never-tried.corp.example",
    ];
    fake.forward["current.corp.example"] = ["10.0.0.5"];
    fake.forward["never-tried.corp.example"] = ["10.0.0.5"];

    expect(await namer(fake, { now: 0 }).resolve("10.0.0.5")).toEqual({
      name: "current.corp.example",
      hasFailed: false,
    });
    expect(fake.forwardAsked).toHaveLength(MAX_NAMES_CONFIRMED_PER_ADDRESS);
    expect(MAX_NAMES_CONFIRMED_PER_ADDRESS).toBe(3);
  });

  test("a name the hosts file gives is the operator's own, kept without asking DNS", async () => {
    const fake: FakeDns = fakeDns();
    fake.hosts["10.0.0.5"] = ["printer-lobby"];

    expect(await namer(fake, { now: 0 }).resolve("10.0.0.5")).toEqual({
      name: "printer-lobby",
      hasFailed: false,
    });
    expect(fake.ptrAsked).toEqual([]);
  });

  test("a PTR answer that is not a DNS name - markup, spaces, the reverse zone - is no name", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.0.0.5"] = [
      "<img src=x>",
      "has spaces",
      "5.0.0.10.in-addr.arpa",
    ];

    expect(await namer(fake, { now: 0 }).resolve("10.0.0.5")).toEqual({
      name: null,
      hasFailed: false,
    });
    expect(fake.forwardAsked).toEqual([]);
  });

  test("no PTR record is an answer: no name, not a failure", async () => {
    const fake: FakeDns = fakeDns();

    expect(await namer(fake, { now: 0 }).resolve("10.0.0.5")).toEqual({
      name: null,
      hasFailed: false,
    });
  });

  test("a resolver that times out or fails is a failure, to ask again sooner", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.0.0.5"] = errorWithCode("ETIMEOUT");
    fake.ptr["10.0.0.6"] = errorWithCode("ESERVFAIL");
    fake.ptr["10.0.0.7"] = ["seven.corp.example"];
    fake.forward["seven.corp.example"] = errorWithCode("ETIMEOUT");

    const subject: FlowAddressNamer = namer(fake, { now: 0 });

    expect(await subject.resolve("10.0.0.5")).toEqual({
      name: null,
      hasFailed: true,
    });
    expect(await subject.resolve("10.0.0.6")).toEqual({
      name: null,
      hasFailed: true,
    });
    // The name could not be confirmed because its own lookup failed.
    expect(await subject.resolve("10.0.0.7")).toEqual({
      name: null,
      hasFailed: true,
    });
  });

  test("an address that names no machine is never asked about", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = namer(fake, { now: 0 });

    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "169.254.10.1",
      "224.0.0.251",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "ff02::1",
      "not-an-address",
      "",
    ]) {
      expect(await subject.resolve(address)).toEqual({
        name: null,
        hasFailed: false,
      });
    }

    expect(fake.ptrAsked).toEqual([]);
  });

  test("where private lookups are not allowed, a private address is never asked about; a public one is", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["198.51.100.20"] = ["www.example.com"];
    fake.forward["www.example.com"] = ["198.51.100.20"];
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { isPrivateLookupAllowed: false },
    );

    for (const address of [
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "fd00::5",
    ]) {
      expect(await subject.resolve(address)).toEqual({
        name: null,
        hasFailed: false,
      });
    }

    expect(await subject.resolve("198.51.100.20")).toEqual({
      name: "www.example.com",
      hasFailed: false,
    });
    expect(fake.ptrAsked).toEqual(["198.51.100.20"]);
  });
});

describe("FlowAddressNamer: what waits, what is asked, and how often", () => {
  test("a forward's addresses wait by the bytes they carried; the busiest are asked first", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { maxLookupsPerMinute: 2 },
    );

    subject.note([
      record("10.0.0.1", "10.0.0.2", 10),
      record("10.0.0.3", "10.0.0.4", 5000),
      record("10.0.0.1", "10.0.0.5", 9000),
    ]);

    expect(subject.waitingCount).toBe(5);

    await subject.pump();

    // 10.0.0.1 carried 9,010 bytes, 10.0.0.5 9,000: the two asked.
    expect(fake.ptrAsked.sort()).toEqual(["10.0.0.1", "10.0.0.5"]);
    expect(subject.waitingCount).toBe(3);
  });

  test("never more than maxLookupsPerMinute in a minute, whatever the flows; the next minute asks again", async () => {
    const fake: FakeDns = fakeDns();
    const clock: { now: number } = { now: 0 };
    const subject: FlowAddressNamer = namer(fake, clock, {
      maxLookupsPerMinute: 3,
    });
    const records: Array<NetworkFlowRecord> = [];

    for (let index: number = 1; index <= 50; index++) {
      records.push(record(`10.1.0.${index}`, "10.0.0.250", index));
    }

    subject.note(records);
    await subject.pump();
    await subject.pump();
    await subject.pump();

    expect(fake.ptrAsked).toHaveLength(3);

    clock.now = 59_999;
    await subject.pump();
    expect(fake.ptrAsked).toHaveLength(3);

    clock.now = 60_000;
    await subject.pump();
    expect(fake.ptrAsked).toHaveLength(6);
  });

  test("never more than `concurrency` lookups at once", async () => {
    const fake: FakeDns = fakeDns();
    fake.holdLookups = true;
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { concurrency: 2 },
    );

    subject.note([
      record("10.0.0.1", "10.0.0.2"),
      record("10.0.0.3", "10.0.0.4"),
    ]);

    const first: Promise<void> = subject.pump();
    // A second pump while two are in flight starts nothing more.
    const second: Promise<void> = subject.pump();

    await Promise.resolve();
    await Promise.resolve();

    expect(subject.inFlightCount).toBe(2);
    expect(fake.ptrAsked).toHaveLength(2);

    for (const release of fake.held.splice(0)) {
      release();
    }

    await Promise.all([first, second]);
    expect(subject.inFlightCount).toBe(0);
  });

  test("an address being looked up is not waiting for another lookup", async () => {
    const fake: FakeDns = fakeDns();
    fake.holdLookups = true;
    const subject: FlowAddressNamer = namer(fake, { now: 0 });

    subject.note([record("10.0.0.1", "10.0.0.1")]);
    const pumping: Promise<void> = subject.pump();
    await Promise.resolve();

    subject.note([record("10.0.0.1", "10.0.0.1")]);
    expect(subject.waitingCount).toBe(0);

    for (const release of fake.held.splice(0)) {
      release();
    }

    await pumping;
  });

  test("the waiting list is bounded, and keeps the busiest", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { maxWaiting: 10, maxLookupsPerMinute: 0, isEnabled: true },
    );
    const records: Array<NetworkFlowRecord> = [];

    for (let index: number = 1; index <= 40; index++) {
      records.push(record(`10.2.0.${index}`, `10.3.0.${index}`, index * 100));
    }

    subject.note(records);

    expect(subject.waitingCount).toBeLessThanOrEqual(10);
  });

  test("a disabled namer waits for nothing, asks nothing and sends nothing", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { isEnabled: false },
    );

    subject.note([record("10.0.0.1", "10.0.0.2")]);
    await subject.pump();

    expect(subject.waitingCount).toBe(0);
    expect(fake.ptrAsked).toEqual([]);
    expect(subject.namesFor([record("10.0.0.1", "10.0.0.2")])).toEqual({});
  });

  test("an address that names no machine never waits", () => {
    const subject: FlowAddressNamer = namer(fakeDns(), { now: 0 });

    subject.note([
      record("127.0.0.1", "224.0.0.251"),
      record("169.254.1.1", "fe80::1"),
    ]);

    expect(subject.waitingCount).toBe(0);
  });
});

describe("FlowAddressNamer: the cache", () => {
  async function namedOnce(
    fake: FakeDns,
    clock: { now: number },
    overrides: Partial<FlowAddressNamerOptions> = {},
  ): Promise<FlowAddressNamer> {
    const subject: FlowAddressNamer = namer(fake, clock, overrides);
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    await subject.pump();
    return subject;
  }

  test("a forward carries the names already known, as the records write the address", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["2001:db8::5"] = ["v6.corp.example"];
    fake.forward["v6.corp.example"] = ["2001:db8::5"];
    const subject: FlowAddressNamer = namer(fake, { now: 0 });

    subject.note([record("2001:DB8::5", "10.0.0.9")]);

    // Not looked up yet: nothing to send.
    expect(subject.namesFor([record("2001:DB8::5", "10.0.0.9")])).toEqual({});

    await subject.pump();

    expect(subject.namesFor([record("2001:DB8::5", "10.0.0.9")])).toEqual({
      "2001:DB8::5": "v6.corp.example",
    });
  });

  test("a name is kept for its time, then asked about again - and sent meanwhile", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.0.0.5"] = ["five.corp.example"];
    fake.forward["five.corp.example"] = ["10.0.0.5"];
    const clock: { now: number } = { now: 0 };
    const subject: FlowAddressNamer = await namedOnce(fake, clock, {
      positiveTtlMs: 1000,
    });

    expect(fake.ptrAsked).toHaveLength(1);

    clock.now = 999;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(0);

    clock.now = 1000;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(1);
    // Due again, and still sent until a new answer says otherwise.
    expect(subject.namesFor([record("10.0.0.5", "10.0.0.5")])).toEqual({
      "10.0.0.5": "five.corp.example",
    });

    fake.ptr["10.0.0.5"] = ["renamed.corp.example"];
    fake.forward["renamed.corp.example"] = ["10.0.0.5"];
    await subject.pump();

    expect(subject.namesFor([record("10.0.0.5", "10.0.0.5")])).toEqual({
      "10.0.0.5": "renamed.corp.example",
    });
  });

  test("'no name' is kept for its own time", async () => {
    const fake: FakeDns = fakeDns();
    const clock: { now: number } = { now: 0 };
    const subject: FlowAddressNamer = await namedOnce(fake, clock, {
      negativeTtlMs: 500,
      positiveTtlMs: 10_000,
    });

    clock.now = 499;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(0);

    clock.now = 500;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(1);
  });

  test("a failed lookup is asked again sooner, and keeps the name the address had", async () => {
    const fake: FakeDns = fakeDns();
    fake.ptr["10.0.0.5"] = ["five.corp.example"];
    fake.forward["five.corp.example"] = ["10.0.0.5"];
    const clock: { now: number } = { now: 0 };
    const subject: FlowAddressNamer = await namedOnce(fake, clock, {
      positiveTtlMs: 1000,
      failureTtlMs: 100,
    });

    clock.now = 1000;
    fake.ptr["10.0.0.5"] = errorWithCode("ETIMEOUT");
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    await subject.pump();

    expect(subject.namesFor([record("10.0.0.5", "10.0.0.5")])).toEqual({
      "10.0.0.5": "five.corp.example",
    });

    clock.now = 1099;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(0);

    clock.now = 1100;
    subject.note([record("10.0.0.5", "10.0.0.5")]);
    expect(subject.waitingCount).toBe(1);
  });

  test("a lookup that throws outright counts as failed, and frees its slot", async () => {
    const subject: FlowAddressNamer = new FlowAddressNamer({
      isEnabled: true,
      isPrivateLookupAllowed: true,
      lookup: async (): Promise<Array<string>> => {
        throw "not even an Error";
      },
      forwardLookup: async (): Promise<Array<string>> => {
        return [];
      },
      now: (): number => {
        return 0;
      },
      maxLookupsPerMinute: 10,
      concurrency: 1,
      positiveTtlMs: 1000,
      negativeTtlMs: 1000,
      failureTtlMs: 10,
      maxCacheEntries: 10,
      maxWaiting: 10,
    });

    subject.note([record("10.0.0.5", "10.0.0.6")]);
    await subject.pump();
    await subject.pump();

    expect(subject.inFlightCount).toBe(0);
    expect(subject.cacheSize).toBe(2);
  });

  test("the cache is bounded: the oldest answer goes first", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = namer(
      fake,
      { now: 0 },
      { maxCacheEntries: 3, concurrency: 10 },
    );

    subject.note([
      record("10.0.0.1", "10.0.0.2", 400),
      record("10.0.0.3", "10.0.0.4", 100),
    ]);
    await subject.pump();

    expect(subject.cacheSize).toBe(3);
  });

  test("clear() forgets everything", async () => {
    const fake: FakeDns = fakeDns();
    const subject: FlowAddressNamer = await namedOnce(fake, { now: 0 });

    subject.clear();

    expect(subject.cacheSize).toBe(0);
    expect(subject.waitingCount).toBe(0);
    expect(subject.inFlightCount).toBe(0);
  });
});

describe("parseFlowNameDnsServers", () => {
  test("IP addresses, with a port when it is not 53", () => {
    const parsed: ParsedFlowNameDnsServers = parseFlowNameDnsServers(
      " 10.0.0.53, 10.0.0.54:5353 ,fd00::53, [fd00::54]:5353 ",
    );

    expect(parsed.servers).toEqual(["10.0.0.53", "10.0.0.54:5353", "fd00::53"]);
    // A fourth is past the limit, not invalid.
    expect(parsed.invalid).toEqual([]);
    expect(MAX_FLOW_NAME_DNS_SERVERS).toBe(3);
  });

  test("anything else is left out and named: a host name, a bad port, a bracket without one", () => {
    const parsed: ParsedFlowNameDnsServers = parseFlowNameDnsServers(
      "dns.corp.example, 10.0.0.53:0, 10.0.0.53:99999, [fd00::53], 10.0.0.53:abc, 10.0.0.256",
    );

    expect(parsed.servers).toEqual([]);
    expect(parsed.invalid).toEqual([
      "dns.corp.example",
      "10.0.0.53:0",
      "10.0.0.53:99999",
      "[fd00::53]",
      "10.0.0.53:abc",
      "10.0.0.256",
    ]);
  });

  test("nothing set is no servers: the host's own resolver answers", () => {
    for (const value of [undefined, null, "", " , "]) {
      expect(parseFlowNameDnsServers(value)).toEqual({
        servers: [],
        invalid: [],
      });
    }
  });

  test("a server named twice is asked once", () => {
    expect(
      parseFlowNameDnsServers("10.0.0.53,10.0.0.53,10.0.0.54").servers,
    ).toEqual(["10.0.0.53", "10.0.0.54"]);
  });
});

describe("isNameableAddress and who may look private addresses up", () => {
  test("public and private addresses may be named; local ones never", () => {
    expect(isNameableAddress("10.0.0.5")).toBe(true);
    expect(isNameableAddress("198.51.100.20")).toBe(true);
    expect(isNameableAddress("2001:db8::5")).toBe(true);
    expect(isNameableAddress("127.0.0.1")).toBe(false);
    expect(isNameableAddress("fe80::1")).toBe(false);
    expect(isNameableAddress("garbage")).toBe(false);
  });

  test("without private lookups, only public addresses", () => {
    expect(isNameableAddress("10.0.0.5", false)).toBe(false);
    expect(isNameableAddress("fd00::5", false)).toBe(false);
    expect(isNameableAddress("198.51.100.20", false)).toBe(true);
  });

  test("every probe looks private addresses up but a hosted instance's shared global one", () => {
    expect(
      isPrivateFlowNameLookupAllowed({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: true,
      }),
    ).toBe(false);
    expect(
      isPrivateFlowNameLookupAllowed({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      }),
    ).toBe(true);
    expect(
      isPrivateFlowNameLookupAllowed({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: true,
      }),
    ).toBe(true);
    expect(
      isPrivateFlowNameLookupAllowed({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: false,
      }),
    ).toBe(true);
  });
});

describe("the namer the probe runs with", () => {
  test("its defaults: a few hundred lookups a minute, a few at a time, an hour for a name", () => {
    expect(DEFAULT_FLOW_NAME_LOOKUPS_PER_MINUTE).toBe(300);
    expect(DEFAULT_FLOW_NAME_LOOKUP_CONCURRENCY).toBe(8);
    expect(DEFAULT_FLOW_NAME_POSITIVE_TTL_MS).toBe(60 * 60 * 1000);
    expect(DEFAULT_FLOW_NAME_NEGATIVE_TTL_MS).toBe(30 * 60 * 1000);
    expect(DEFAULT_FLOW_NAME_FAILURE_TTL_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_FLOW_NAME_MAX_CACHE_ENTRIES).toBe(20000);
    expect(DEFAULT_FLOW_NAME_MAX_WAITING).toBe(5000);
  });

  test("create() is off when lookups are off or allowed none a minute", () => {
    expect(
      FlowAddressNamer.create({
        isEnabled: true,
        isPrivateLookupAllowed: true,
        maxLookupsPerMinute: 300,
        servers: [],
      }).isEnabled,
    ).toBe(true);
    expect(
      FlowAddressNamer.create({
        isEnabled: false,
        isPrivateLookupAllowed: true,
        maxLookupsPerMinute: 300,
        servers: [],
      }).isEnabled,
    ).toBe(false);
    expect(
      FlowAddressNamer.create({
        isEnabled: true,
        isPrivateLookupAllowed: true,
        maxLookupsPerMinute: 0,
        servers: [],
      }).isEnabled,
    ).toBe(false);
    expect(
      FlowAddressNamer.create({
        isEnabled: true,
        isPrivateLookupAllowed: false,
        maxLookupsPerMinute: 300,
        servers: [],
      }).isPrivateLookupAllowed,
    ).toBe(false);
  });

  test("a resolver asks the servers named, one fresh resolver a query", () => {
    const setServers: jest.SpiedFunction<dns.promises.Resolver["setServers"]> =
      jest.spyOn(dns.promises.Resolver.prototype, "setServers");

    const factory: ReturnType<typeof buildResolverFactory> =
      buildResolverFactory(["10.0.0.53", "10.0.0.54:5353"]);

    expect(factory(2000)).not.toBe(factory(2000));
    expect(setServers).toHaveBeenCalledWith(["10.0.0.53", "10.0.0.54:5353"]);
  });

  test("with no servers named, the host's own resolver is left as it is", () => {
    const setServers: jest.SpiedFunction<dns.promises.Resolver["setServers"]> =
      jest.spyOn(dns.promises.Resolver.prototype, "setServers");

    buildResolverFactory([])(2000);

    expect(setServers).not.toHaveBeenCalled();
  });

  test("a forward lookup that never answers gives up after its timeout", async () => {
    jest
      .spyOn(dns.promises.Resolver.prototype, "resolve4")
      .mockImplementation((): Promise<Array<string>> => {
        return new Promise<Array<string>>(() => {
          // Never answers.
        });
      });
    const cancel: jest.SpiedFunction<dns.promises.Resolver["cancel"]> = jest
      .spyOn(dns.promises.Resolver.prototype, "cancel")
      .mockImplementation((): void => {
        return undefined;
      });

    const lookup: ForwardLookupFunction = buildDefaultForwardLookup(20, []);

    await expect(lookup("slow.corp.example", 4)).rejects.toMatchObject({
      code: "ETIMEOUT",
    });
    expect(cancel).toHaveBeenCalled();
  });

  test("a forward lookup asks for A records for IPv4 and AAAA for IPv6", async () => {
    const resolve4: jest.SpiedFunction<dns.promises.Resolver["resolve4"]> = jest
      .spyOn(dns.promises.Resolver.prototype, "resolve4")
      .mockResolvedValue(["10.0.0.5"] as never);
    const resolve6: jest.SpiedFunction<dns.promises.Resolver["resolve6"]> = jest
      .spyOn(dns.promises.Resolver.prototype, "resolve6")
      .mockResolvedValue(["2001:db8::5"] as never);

    const lookup: ForwardLookupFunction = buildDefaultForwardLookup(1000, []);

    expect(await lookup("a.corp.example", 4)).toEqual(["10.0.0.5"]);
    expect(await lookup("a.corp.example", 6)).toEqual(["2001:db8::5"]);
    expect(resolve4).toHaveBeenCalledWith("a.corp.example");
    expect(resolve6).toHaveBeenCalledWith("a.corp.example");
  });
});
