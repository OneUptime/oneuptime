import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import LogService from "../../../../Server/Services/LogService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import SpanService from "../../../../Server/Services/SpanService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SecuritySignedInAddresses, {
  KEYED_SCRUB_TOKENS_SINCE,
  SecuritySignedInAddressCheck,
  SecuritySignedInAddressState,
  SecuritySignedInManyCheck,
  SecuritySignedInMatch,
  SecuritySignedInSource,
  buildSignedInRequestsStatement,
  buildSignedInSignInsStatement,
  findNamedAddressRules,
  getSecuritySignedInMatch,
  listSecuritySignedInAddresses,
  readSignedInUsersByAddress,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import {
  expandIpv6,
  getSecurityAddressSpellings,
} from "../../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import ScrubbedClientAddresses from "../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../../Types/JSON";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { AddressScrubRule } from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * HAS A SIGNED-IN USER USED THIS ADDRESS? (#10350) The user ids an app
 * records on its requests, and an identity provider's sign-ins, read for
 * the address in every spelling a source writes it - and in the keyed token
 * a Hash scrub rule writes it as, so hashing hides nobody. Whatever keeps
 * OneUptime from telling - a rule that redacts or masks addresses, tokens
 * made before they were keyed, sign-ins that lost their address, a read
 * that fails - is CannotTell, with why: the address is left for a person.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADDRESS: string = "35.205.11.131";
const NOW: Date = new Date("2026-12-22T10:00:00.000Z");

interface Asked {
  table: string;
  statement: Statement;
}

let asked: Array<Asked>;
let spanRows: Array<JSONObject>;
let logRows: Array<JSONObject>;
let signInRows: Array<JSONObject>;
let hiddenSignIns: number;
let rules: { log: Array<AddressScrubRule>; trace: Array<AddressScrubRule> };
let storedRules: Array<{
  scrubAction: string;
  createdAt?: Date;
  name?: string;
  patternType?: string;
  attributeKeys?: Array<string>;
}>;
let failReads: boolean;

function answer(rows: Array<JSONObject>): unknown {
  return {
    json: async () => {
      return { data: rows };
    },
  };
}

function rule(
  name: string,
  scrubAction: string,
  fieldsToScrub: string = "",
): AddressScrubRule {
  return {
    id: `rule-${name}`,
    name,
    patternType: LogScrubPatternType.IPAddress,
    scrubAction,
    fieldsToScrub,
  };
}

function valuesOf(statement: Statement): string {
  return JSON.stringify(statement.query_params);
}

beforeEach(() => {
  asked = [];
  spanRows = [];
  logRows = [];
  signInRows = [];
  hiddenSignIns = 0;
  rules = { log: [], trace: [] };
  storedRules = [];
  failReads = false;

  jest.spyOn(SpanService, "executeQuery").mockImplementation((async (
    statement: Statement,
  ) => {
    asked.push({ table: "Span", statement });

    if (failReads) {
      throw new Error("Timeout exceeded: elapsed 30 seconds");
    }

    return answer(spanRows);
  }) as never);
  jest.spyOn(LogService, "executeQuery").mockImplementation((async (
    statement: Statement,
  ) => {
    asked.push({ table: "Log", statement });
    return answer(logRows);
  }) as never);
  jest.spyOn(SecurityEventService, "executeQuery").mockImplementation((async (
    statement: Statement,
  ) => {
    asked.push({ table: "SecurityEvent", statement });

    return answer(
      statement.query.includes("count() AS hidden")
        ? [{ hidden: hiddenSignIns }]
        : signInRows,
    );
  }) as never);
  jest
    .spyOn(ScrubbedClientAddresses, "getCachedAddressScrubRules")
    .mockImplementation(async (data: { signal: "log" | "trace" }) => {
      return rules[data.signal];
    });
  const readStoredRules: () => Promise<unknown> =
    async (): Promise<unknown> => {
      return storedRules;
    };
  jest
    .spyOn(LogScrubRuleService, "findBy")
    .mockImplementation(readStoredRules as never);
  jest
    .spyOn(TraceScrubRuleService, "findBy")
    .mockImplementation(readStoredRules as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function check(
  value: string = ADDRESS,
): Promise<SecuritySignedInAddressCheck> {
  return await SecuritySignedInAddresses.check({
    projectId: PROJECT_ID,
    value,
    now: NOW,
  });
}

describe("who used an address", () => {
  test("nobody: None, after reading the app's requests (traces and logs) and the identity provider's sign-ins over 30 days", async () => {
    const result: SecuritySignedInAddressCheck = await check();

    expect(result.state).toBe(SecuritySignedInAddressState.None);
    expect(result.since).toEqual(new Date("2026-11-22T10:00:00.000Z"));
    expect(
      asked.map((read: Asked): string => {
        return read.table;
      }),
    ).toEqual(["Span", "Log", "SecurityEvent"]);

    const [spans, logs, signIns] = asked.map((read: Asked) => {
      return read.statement;
    });

    // A server span of the app's, with a user id, from the address.
    expect(spans!.query).toContain("FROM SpanItemV3");
    expect(valuesOf(spans!)).toContain("SPAN_KIND_SERVER");
    expect(valuesOf(spans!)).toContain("enduser.id");
    expect(valuesOf(spans!)).toContain("user.id");
    expect(valuesOf(spans!)).toContain("client.address");
    expect(valuesOf(spans!)).toContain("http.client_ip");
    expect(valuesOf(spans!)).toContain(ADDRESS);
    // ...a log line too, by the fields access logs name the client in.
    expect(logs!.query).toContain("FROM LogItemV3");
    expect(valuesOf(logs!)).toContain("remote_addr");
    // ...and a successful sign-in naming a user.
    expect(signIns!.query).toContain("FROM SecurityEventItemV1");
    expect(valuesOf(signIns!)).toContain("Success");
    expect(valuesOf(signIns!)).toContain("3002");

    // Every value is a parameter: the address is never written into the SQL.
    for (const read of asked) {
      expect(read.statement.query).not.toContain(ADDRESS);
    }
  });

  test("a user the app recorded on a request from it, and one who signed in through the identity provider: SignedIn, naming each, the latest first", async () => {
    spanRows = [{ user: "jane@example.com", lastSeen: "2026-12-21 09:00:00" }];
    signInRows = [
      { user: "bob@example.com", lastSeen: "2026-12-22 08:00:00" },
      { user: "Jane@example.com", lastSeen: "2026-12-01 08:00:00" },
    ];

    const result: SecuritySignedInAddressCheck = await check();

    expect(result.state).toBe(SecuritySignedInAddressState.SignedIn);

    if (result.state !== SecuritySignedInAddressState.SignedIn) {
      return;
    }

    expect(result.users).toEqual([
      {
        name: "bob@example.com",
        source: SecuritySignedInSource.IdentityProvider,
        lastSeenAt: new Date("2026-12-22T08:00:00.000Z"),
      },
      {
        name: "jane@example.com",
        source: SecuritySignedInSource.Requests,
        lastSeenAt: new Date("2026-12-21T09:00:00.000Z"),
      },
      {
        name: "Jane@example.com",
        source: SecuritySignedInSource.IdentityProvider,
        lastSeenAt: new Date("2026-12-01T08:00:00.000Z"),
      },
    ]);
  });

  test("a read that fails or runs out of time: CannotTell, and the address is left for a person", async () => {
    failReads = true;

    const result: SecuritySignedInAddressCheck = await check();

    expect(result).toMatchObject({
      state: SecuritySignedInAddressState.CannotTell,
      reason:
        "OneUptime could not read the requests and sign-ins from 35.205.11.131 just now, so it cannot tell whether a signed-in user used it. It is left for a person.",
    });
  });

  test("what is no address: CannotTell", async () => {
    expect((await check("not an address")).state).toBe(
      SecuritySignedInAddressState.CannotTell,
    );
  });
});

describe("hashed addresses", () => {
  test("a Hash rule's token for the address is read beside the address, so hashing hides nobody", async () => {
    rules.trace = [rule("Hash client IPs", "hash")];
    storedRules = [
      { scrubAction: "hash", createdAt: new Date("2026-11-21T00:00:00.000Z") },
    ];
    const token: string = ScrubHashToken.ofIpAddress({
      projectId: PROJECT_ID,
      address: ADDRESS,
    });
    spanRows = [{ user: "jane@example.com", lastSeen: "2026-12-21 09:00:00" }];

    const result: SecuritySignedInAddressCheck = await check();

    expect(result.state).toBe(SecuritySignedInAddressState.SignedIn);
    expect(valuesOf(asked[0]!.statement)).toContain(token);
  });

  test("a rule that redacts or masks addresses leaves nothing to match: CannotTell, naming the rule", async () => {
    rules.log = [rule("Redact client IPs", "redact")];

    const result: SecuritySignedInAddressCheck = await check();

    expect(result).toMatchObject({
      state: SecuritySignedInAddressState.CannotTell,
      reason:
        "Your scrub rule Redact client IPs hides client addresses in your logs, so OneUptime cannot tell whether a signed-in user used 35.205.11.131. It is left for a person: hash addresses instead to let OneUptime check.",
    });
    // Nothing is read that could not answer anyway.
    expect(asked).toHaveLength(0);
  });

  /*
   * A Named Attributes rule (#10366) hides an attribute whole, whatever it
   * holds: one that names the attribute a client's address is read from -
   * client.address, or client, which names it too - leaves no address to
   * match, so OneUptime cannot tell, and says which rule. One that names
   * other attributes changes nothing.
   */
  test("a Named Attributes rule that redacts the client's address attribute: CannotTell, naming the rule", async () => {
    storedRules = [
      {
        name: "Hide the client",
        patternType: LogScrubPatternType.NamedKeys,
        scrubAction: "redact",
        attributeKeys: ["client"],
      },
    ];

    const result: SecuritySignedInAddressCheck = await check();

    expect(result.state).toBe(SecuritySignedInAddressState.CannotTell);
    expect(result.reason).toContain(
      "Your scrub rule Hide the client hides client addresses",
    );
  });

  test("Named Attributes rules: only those naming an attribute the address is read from count, by exact key or prefix", () => {
    const named: (
      attributeKeys: Array<string>,
      scrubAction: string,
    ) => {
      name: string;
      patternType: string;
      scrubAction: string;
      fieldsToScrub: string;
      attributeKeys: Array<string>;
    } = (attributeKeys: Array<string>, scrubAction: string) => {
      return {
        name: attributeKeys.join(", "),
        patternType: LogScrubPatternType.NamedKeys,
        scrubAction,
        fieldsToScrub: "",
        attributeKeys,
      };
    };

    // Other attributes, and a rule of another kind: nothing.
    expect(
      findNamedAddressRules({
        rules: [
          named(["user.email", "customer_name"], "redact"),
          { ...named(["client.address"], "redact"), patternType: "email" },
        ],
        signal: "trace",
      }),
    ).toEqual({ hiding: null, isHashing: false });

    // The span attribute, exactly: hidden.
    expect(
      findNamedAddressRules({
        rules: [named(["client.address"], "mask")],
        signal: "trace",
      }).hiding?.name,
    ).toBe("client.address");

    // A log's remote_addr is an address attribute of logs, not of spans.
    expect(
      findNamedAddressRules({
        rules: [named(["remote_addr"], "redact")],
        signal: "log",
      }).hiding?.name,
    ).toBe("remote_addr");
    expect(
      findNamedAddressRules({
        rules: [named(["remote_addr"], "redact")],
        signal: "trace",
      }).hiding,
    ).toBeNull();

    // One that hashes it: the address's tokens are matched instead.
    expect(
      findNamedAddressRules({
        rules: [named(["http"], "hash")],
        signal: "trace",
      }),
    ).toEqual({ hiding: null, isHashing: true });
  });

  test("a Hash rule older than keyed tokens, within the window: CannotTell until those tokens are past it", async () => {
    rules.trace = [rule("Hash client IPs", "hash")];
    storedRules = [
      { scrubAction: "hash", createdAt: new Date("2026-11-01T00:00:00.000Z") },
    ];

    const within: SecuritySignedInAddressCheck =
      await SecuritySignedInAddresses.check({
        projectId: PROJECT_ID,
        value: ADDRESS,
        now: new Date("2026-12-01T00:00:00.000Z"),
      });

    expect(within.state).toBe(SecuritySignedInAddressState.CannotTell);

    // Past the window, every token in it is a keyed one.
    const past: SecuritySignedInAddressCheck =
      await SecuritySignedInAddresses.check({
        projectId: PROJECT_ID,
        value: ADDRESS,
        now: new Date(
          KEYED_SCRUB_TOKENS_SINCE.getTime() + 31 * 24 * 60 * 60 * 1000,
        ),
      });

    expect(past.state).toBe(SecuritySignedInAddressState.None);
  });

  test("sign-ins in logs whose address a rule hashed away: CannotTell", async () => {
    rules.log = [rule("Hash client IPs", "hash")];
    storedRules = [
      { scrubAction: "hash", createdAt: new Date("2026-11-21T00:00:00.000Z") },
    ];
    hiddenSignIns = 3;

    expect((await check()).state).toBe(SecuritySignedInAddressState.CannotTell);
  });

  test("a range too wide to hash every address of: CannotTell", async () => {
    rules.trace = [rule("Hash client IPs", "hash")];
    storedRules = [
      { scrubAction: "hash", createdAt: new Date("2026-11-21T00:00:00.000Z") },
    ];

    expect((await check("35.205.0.0/16")).state).toBe(
      SecuritySignedInAddressState.CannotTell,
    );
  });
});

describe("a network (#10354)", () => {
  test("an IPv4 /24 or narrower is read address by address", async () => {
    await check("35.205.11.0/30");

    const values: string = valuesOf(asked[0]!.statement);

    for (const address of [
      "35.205.11.0",
      "35.205.11.1",
      "35.205.11.2",
      "35.205.11.3",
    ]) {
      expect(values).toContain(address);
    }
    expect(values).not.toContain("35.205.11.4");
  });

  test("a wider one is read as a range", async () => {
    await check("35.205.0.0/16");

    expect(asked[0]!.statement.query).toContain("isIPAddressInRange");
    expect(valuesOf(asked[0]!.statement)).toContain("35.205.0.0/16");
  });
});

describe("many addresses at once", () => {
  test("one read per source names who used each, since each one's own moment", async () => {
    spanRows = [
      {
        user: "jane@example.com",
        lastSeen: "2026-12-22 09:00:00",
        address0: ADDRESS,
        address1: "",
      },
      // Seen before this address was blocked: no doubt.
      {
        user: "old@example.com",
        lastSeen: "2026-12-20 09:00:00",
        address0: "35.205.11.132",
        address1: "",
      },
    ];

    const result: SecuritySignedInManyCheck =
      await SecuritySignedInAddresses.checkMany({
        projectId: PROJECT_ID,
        addresses: [
          { value: ADDRESS, since: new Date("2026-12-22T08:00:00.000Z") },
          {
            value: "35.205.11.132",
            since: new Date("2026-12-21T08:00:00.000Z"),
          },
        ],
        now: NOW,
      });

    expect(asked).toHaveLength(3);
    expect(result.state).toBe(SecuritySignedInAddressState.SignedIn);

    if (result.state !== SecuritySignedInAddressState.SignedIn) {
      return;
    }

    expect(Array.from(result.usersByAddress.keys())).toEqual([ADDRESS]);
    expect(result.usersByAddress.get(ADDRESS)![0]!.name).toBe(
      "jane@example.com",
    );
  });

  test("a hashed row counts for the address its token stands for", () => {
    const match: SecuritySignedInMatch = getSecuritySignedInMatch({
      projectId: PROJECT_ID,
      value: readSecurityBlockValue(ADDRESS)!,
      isHashing: true,
    });
    const token: string = ScrubHashToken.ofIpAddress({
      projectId: PROJECT_ID,
      address: ADDRESS,
    });

    expect(
      Array.from(
        readSignedInUsersByAddress({
          rows: [
            {
              user: "jane@example.com",
              lastSeen: "2026-12-22 09:00:00",
              address0: token,
            },
          ],
          source: SecuritySignedInSource.Requests,
          match,
        }).keys(),
      ),
    ).toEqual([ADDRESS]);
  });

  test("a rule that redacts addresses: CannotTell for all of them", async () => {
    rules.trace = [rule("Mask IPs", "mask")];

    const result: SecuritySignedInManyCheck =
      await SecuritySignedInAddresses.checkMany({
        projectId: PROJECT_ID,
        addresses: [{ value: ADDRESS, since: NOW }],
        now: NOW,
      });

    expect(result.state).toBe(SecuritySignedInAddressState.CannotTell);
  });
});

describe("how an address is written", () => {
  test("every spelling a source may write", () => {
    expect(getSecurityAddressSpellings(ADDRESS)).toEqual([
      ADDRESS,
      `::ffff:${ADDRESS}`,
    ]);
    expect(getSecurityAddressSpellings("2001:DB8::7")).toEqual([
      "2001:db8::7",
      "2001:db8:0:0:0:0:0:7",
      "2001:DB8::7",
      "2001:DB8:0:0:0:0:0:7",
    ]);
    expect(getSecurityAddressSpellings("35.205.11.0/24")).toEqual([]);
  });

  test("IPv6 written out in full", () => {
    expect(expandIpv6("2001:db8::7")).toBe("2001:db8:0:0:0:0:0:7");
    expect(expandIpv6("::1")).toBe("0:0:0:0:0:0:0:1");
    expect(expandIpv6("fe80::")).toBe("fe80:0:0:0:0:0:0:0");
    expect(expandIpv6("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2:3:4:5:6");
  });

  test("a /24's every address, and no list for wider or IPv6 ranges", () => {
    const value: SecurityBlockValue = readSecurityBlockValue("35.205.11.0/24")!;

    expect(listSecuritySignedInAddresses(value)).toHaveLength(256);
    expect(listSecuritySignedInAddresses(value)![255]).toBe("35.205.11.255");
    expect(
      listSecuritySignedInAddresses(readSecurityBlockValue("35.205.0.0/16")!),
    ).toBeNull();
    expect(
      listSecuritySignedInAddresses(readSecurityBlockValue("2001:db8::/48")!),
    ).toBeNull();
  });

  test("the statements say who, by address when asked", () => {
    const match: SecuritySignedInMatch = getSecuritySignedInMatch({
      projectId: PROJECT_ID,
      value: readSecurityBlockValue(ADDRESS)!,
      isHashing: false,
    });

    expect(
      buildSignedInRequestsStatement({
        projectId: PROJECT_ID,
        match,
        since: NOW,
        until: NOW,
        signal: "trace",
        byAddress: true,
      }).query,
    ).toContain("AS address0");
    expect(
      buildSignedInSignInsStatement({
        projectId: PROJECT_ID,
        match,
        since: NOW,
        until: NOW,
      }).query,
    ).toContain("GROUP BY user");
  });
});
