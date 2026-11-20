import crypto from "crypto";
import HashedAddressSearch, {
  HashedAddressTokens,
} from "../../../../Server/Utils/Telemetry/HashedAddressSearch";
import ScrubAction from "../../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import { appendAttributeFilters } from "../../../../Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import { MAX_WILDCARD_PATTERNS } from "../../../../Types/BaseDatabase/WildcardPattern";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  HashedAddressSignal,
  getHashedAddressSearchTexts,
} from "../../../../Types/Telemetry/HashedAddressSearch";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubPatternType from "../../../../Types/Trace/TraceScrubPatternType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH FOR AN IP ADDRESS ALSO MATCHES THE PROJECT'S HASH TOKEN FOR IT
 * (#10418).
 *
 * In a project with an IP Address scrub rule set to Hash, a record holds
 * "[HASHED:<16 hex>]" where the address was. A search for the address -
 * free text, an attribute filter, a monitor's - is read as "the address, or
 * the project's token for it":
 *
 *  - the token is the one ingest stored (ScrubAction under an IP Address
 *    Hash rule), whichever way the address is typed;
 *  - only the addresses an IP Address rule hides get a token: a private
 *    address, a fragment, a token already, get none;
 *  - each comparison keeps its kind - equals, contains, starts or ends
 *    with, a glob, and their negations - on the fields a scrub rule
 *    scrubs, and nothing else;
 *  - one project's token only: an address searched in two projects matches
 *    each project's own;
 *  - a project with no such rule, and a search that names no address, runs
 *    the query it ran before, and reads no rule for it;
 *  - an old 8-character token is never made or matched for an address.
 * ---------------------------------------------------------------------------
 */

const PROJECT_A: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-00000a010418",
);
const PROJECT_B: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-00000b010418",
);

const tokenOf: (address: string, projectId?: ObjectID) => string = (
  address: string,
  projectId: ObjectID = PROJECT_A,
): string => {
  return ScrubHashToken.ofIpAddress({ projectId, address });
};

// What ingest stores in place of an address, under an IP Address Hash rule of the project.
const storedAs: (address: string, projectId?: ObjectID) => string = (
  address: string,
  projectId: ObjectID = PROJECT_A,
): string => {
  return ScrubAction.apply({
    match: address,
    action: LogScrubAction.Hash,
    patternType: LogScrubPatternType.IPAddress,
    projectId,
  });
};

// The token a Hash rule wrote before #10394: the unkeyed SHA-256, 8 hex characters.
const legacyTokenOf: (value: string) => string = (value: string): string => {
  return `[HASHED:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 8)}]`;
};

const tokensA: HashedAddressTokens = new HashedAddressTokens(PROJECT_A);
const tokensB: HashedAddressTokens = new HashedAddressTokens(PROJECT_B);

const ROOT_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

type Hashing = { logs: boolean; traces: boolean };

// The projects whose rules hash IP addresses, and how the rule tables are read.
const hashingByProject: Map<string, Hashing> = new Map<string, Hashing>();

const ruleQueries: Array<{ table: string; query: JSONObject; props: unknown }> =
  [];

const mockRules: () => void = (): void => {
  jest
    .spyOn(LogScrubRuleService, "countBy")
    .mockImplementation((async (countBy: {
      query: JSONObject;
      props: unknown;
    }) => {
      ruleQueries.push({ table: "log", ...countBy });
      const hashing: Hashing | undefined = hashingByProject.get(
        String(countBy.query["projectId"]),
      );
      return new PositiveNumber(hashing?.logs ? 1 : 0);
    }) as never);

  jest
    .spyOn(TraceScrubRuleService, "countBy")
    .mockImplementation((async (countBy: {
      query: JSONObject;
      props: unknown;
    }) => {
      ruleQueries.push({ table: "trace", ...countBy });
      const hashing: Hashing | undefined = hashingByProject.get(
        String(countBy.query["projectId"]),
      );
      return new PositiveNumber(hashing?.traces ? 1 : 0);
    }) as never);
};

beforeEach(() => {
  HashedAddressSearch.clearCache();
  hashingByProject.clear();
  ruleQueries.length = 0;
  mockRules();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the token a search adds is the one ingest stored", () => {
  test.each([
    "203.0.113.7",
    "8.8.8.8",
    "2001:db8::1",
    "2001:4860:4860::8888",
    "::ffff:203.0.113.7",
    "2001:DB8:0:0:0:0:0:1",
    "64:ff9b::192.0.2.33",
  ])("%s", (address: string) => {
    expect(tokensA.hashedFormOf(address)).toBe(storedAs(address));
    expect(tokensA.hashedFormOf(address)).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
  });

  test("every way an IPv4 address is written makes one token", () => {
    const forms: Array<string> = [
      "203.0.113.7",
      "::ffff:203.0.113.7",
      "::FFFF:203.0.113.7",
      "::ffff:cb00:7107",
      "0:0:0:0:0:ffff:203.0.113.7",
    ];

    expect(
      new Set(
        forms.map((form: string): string | null => {
          return tokensA.hashedFormOf(form);
        }),
      ),
    ).toEqual(new Set([tokenOf("203.0.113.7")]));
  });

  test("every way an IPv6 address is written makes one token", () => {
    const forms: Array<string> = [
      "2001:db8::1",
      "2001:DB8::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "2001:db8:0:0:0:0:0:1",
    ];

    expect(
      new Set(
        forms.map((form: string): string | null => {
          return tokensA.hashedFormOf(form);
        }),
      ),
    ).toEqual(new Set([tokenOf("2001:db8::1")]));
  });

  test("an address inside a text is replaced where it stands, as ingest replaced it", () => {
    expect(
      tokensA.hashedFormOf("login failed for 203.0.113.7 at the gate"),
    ).toBe(`login failed for ${tokenOf("203.0.113.7")} at the gate`);
    expect(tokensA.hashedFormOf("dial [2001:db8::1]:443")).toBe(
      `dial [${tokenOf("2001:db8::1")}]:443`,
    );
    expect(tokensA.hashedFormOf("bound 2001:db8::1%eth0")).toBe(
      `bound ${tokenOf("2001:db8::1")}%eth0`,
    );
    expect(tokensA.hashedFormOf("203.0.113.7 then 198.51.100.4")).toBe(
      `${tokenOf("203.0.113.7")} then ${tokenOf("198.51.100.4")}`,
    );
  });

  test.each([
    ["a private address", "10.0.0.12"],
    ["loopback", "127.0.0.1"],
    ["link-local", "fe80::1"],
    ["the cloud metadata address", "169.254.169.254"],
    ["IPv6 loopback", "::1"],
    ["a private address written as IPv6", "::ffff:192.168.0.1"],
    ["part of an address", "203.0.113"],
    ["a glob over a range", "203.0.113.*"],
    ["a C++ scope", "std::vector"],
    ["a clock", "12:34:56"],
    ["nothing", ""],
    ["a token already", "[HASHED:3f9a1c0be27d4e5a]"],
    ["an old token", "[HASHED:8c87b489]"],
  ])("%s gets none: %s", (_kind: string, text: string) => {
    expect(tokensA.hashedFormOf(text)).toBeNull();
  });

  test("never across projects: one address, each project's own token", () => {
    expect(tokensA.hashedFormOf("203.0.113.7")).toBe(tokenOf("203.0.113.7"));
    expect(tokensB.hashedFormOf("203.0.113.7")).toBe(
      tokenOf("203.0.113.7", PROJECT_B),
    );
    expect(tokensA.hashedFormOf("203.0.113.7")).not.toBe(
      tokensB.hashedFormOf("203.0.113.7"),
    );
  });

  test("an old 8-character token is never made for an address", () => {
    for (const address of ["203.0.113.7", "2001:db8::1"]) {
      expect(tokensA.hashedFormOf(address)).not.toBe(legacyTokenOf(address));
      expect(tokensA.hashedFormOf(address)).not.toContain(
        legacyTokenOf(address).slice(8, 16),
      );
    }
  });
});

describe("one filter value: the same comparison, of the value or its hashed form", () => {
  const ADDRESS: string = "203.0.113.7";
  const TOKEN: string = tokenOf(ADDRESS);

  const bind: (value: unknown) => unknown = (value: unknown): unknown => {
    return HashedAddressSearch.bindQueryValue(value, tokensA);
  };

  test("a value is equal to the address or its token", () => {
    expect(bind(ADDRESS)).toEqual(new Includes([ADDRESS, TOKEN]));
    expect(bind(new EqualTo(ADDRESS))).toEqual(new Includes([ADDRESS, TOKEN]));
  });

  test("not equal leaves out both", () => {
    expect(bind(new NotEqual(ADDRESS))).toEqual(
      new IncludesNone([ADDRESS, TOKEN]),
    );
  });

  test("a list adds the token of each address in it, once", () => {
    expect(bind(new Includes([ADDRESS, "198.51.100.4", "web-1"]))).toEqual(
      new Includes([
        ADDRESS,
        "198.51.100.4",
        "web-1",
        TOKEN,
        tokenOf("198.51.100.4"),
      ]),
    );
    expect(bind(new Includes([ADDRESS, "::ffff:203.0.113.7"]))).toEqual(
      new Includes([ADDRESS, "::ffff:203.0.113.7", TOKEN]),
    );
    expect(bind(new IncludesNone([ADDRESS]))).toEqual(
      new IncludesNone([ADDRESS, TOKEN]),
    );
  });

  test("contains matches the text or its hashed form, each as Search compares it", () => {
    const bound: Wildcard<string> = bind(
      new Search(`user_1 from ${ADDRESS}`),
    ) as Wildcard<string>;

    expect(bound).toBeInstanceOf(Wildcard);
    expect(bound.toPatterns()).toEqual([
      `%${escapeIlikePattern(`user_1 from ${ADDRESS}`)}%`,
      `%${escapeIlikePattern(`user_1 from ${TOKEN}`)}%`,
    ]);
  });

  test("does not contain leaves out both", () => {
    const bound: NotWildcard<string> = bind(
      new NotContains(ADDRESS),
    ) as NotWildcard<string>;

    expect(bound).toBeInstanceOf(NotWildcard);
    expect(bound.toPatterns()).toEqual([
      `%${escapeIlikePattern(ADDRESS)}%`,
      `%${escapeIlikePattern(TOKEN)}%`,
    ]);
  });

  test("starts with and ends with keep their anchor", () => {
    expect(
      (bind(new StartsWith(`${ADDRESS}:`)) as Wildcard<string>).toPatterns(),
    ).toEqual([`${ADDRESS}:%`, `${TOKEN}:%`]);
    expect(
      (bind(new EndsWith(`peer ${ADDRESS}`)) as Wildcard<string>).toPatterns(),
    ).toEqual([`%peer ${ADDRESS}`, `%peer ${TOKEN}`]);
  });

  test("a glob gets a glob of its hashed form beside it", () => {
    expect(bind(new Wildcard([`${ADDRESS}*`, "web-*"]))).toEqual(
      new Wildcard([`${ADDRESS}*`, "web-*", `${TOKEN}*`]),
    );
    expect(bind(new NotWildcard(`*${ADDRESS}`))).toEqual(
      new NotWildcard([`*${ADDRESS}`, `*${TOKEN}`]),
    );
  });

  test("several comparisons on one field are each bound", () => {
    expect(bind([new Search(ADDRESS), new NotContains("health")])).toEqual([
      new Wildcard([`*${ADDRESS}*`, `*${TOKEN}*`]),
      new NotContains("health"),
    ]);
  });

  test.each([
    ["a value with no address", "web-1"],
    ["a private address", "10.0.0.12"],
    ["contains, no address", new Search("timeout")],
    ["a list with no address", new Includes(["a", "b"])],
    ["a glob with no address", new Wildcard(["203.0.113.*"])],
    ["a number", 500],
    ["is empty", new IsNull()],
    ["is not empty", new NotNull()],
    ["greater than", new GreaterThan(5)],
  ])("%s is left as it is, the same value", (_case: string, value: unknown) => {
    expect(bind(value)).toBe(value);
  });

  test("binding twice binds once", () => {
    const once: unknown = bind(new Includes([ADDRESS]));

    expect(bind(once)).toEqual(once);

    const glob: unknown = bind(new Search(ADDRESS));

    expect(bind(glob)).toEqual(glob);
  });

  test("a wildcard already at its most globs is left as it was", () => {
    const globs: Array<string> = Array.from(
      { length: MAX_WILDCARD_PATTERNS },
      (_value: unknown, index: number): string => {
        return `203.0.113.${index}*`;
      },
    );
    const wildcard: Wildcard<string> = new Wildcard(globs);

    expect(bind(wildcard)).toBe(wildcard);
  });
});

describe("a query: only the fields a scrub rule scrubs are bound", () => {
  const ADDRESS: string = "203.0.113.7";
  const TOKEN: string = tokenOf(ADDRESS);

  test("logs: the body and the attributes, nothing else", () => {
    const query: JSONObject = {
      projectId: PROJECT_A,
      body: new Search(ADDRESS),
      traceId: ADDRESS,
      severityText: new Includes(["Error"]),
      attributes: {
        "client.address": ADDRESS,
        "http.status_code": "500",
      },
    } as unknown as JSONObject;
    const before: string = JSON.stringify(query);

    const bound: JSONObject = HashedAddressSearch.bindQueryWith({
      query,
      signal: HashedAddressSignal.Logs,
      tokens: tokensA,
    });

    expect(bound["body"]).toEqual(new Wildcard([`*${ADDRESS}*`, `*${TOKEN}*`]));
    expect(bound["attributes"]).toEqual({
      "client.address": new Includes([ADDRESS, TOKEN]),
      "http.status_code": "500",
    });
    expect(bound["traceId"]).toBe(ADDRESS);
    expect(bound["severityText"]).toBe(query["severityText"]);
    expect(bound["projectId"]).toBe(PROJECT_A);
    // The caller's query is left as it was.
    expect(JSON.stringify(query)).toBe(before);
  });

  test("traces: the name, the status message and the attributes", () => {
    const bound: JSONObject = HashedAddressSearch.bindQueryWith({
      query: {
        name: new Search(`connect ${ADDRESS}`),
        statusMessage: `refused by ${ADDRESS}`,
        attributes: { "net.peer.ip": new Wildcard([`${ADDRESS}*`]) },
        body: new Search(ADDRESS),
      } as unknown as JSONObject,
      signal: HashedAddressSignal.Traces,
      tokens: tokensA,
    });

    expect(bound["name"]).toEqual(
      new Wildcard([`*connect ${ADDRESS}*`, `*connect ${TOKEN}*`]),
    );
    expect(bound["statusMessage"]).toEqual(
      new Includes([`refused by ${ADDRESS}`, `refused by ${TOKEN}`]),
    );
    expect(bound["attributes"]).toEqual({
      "net.peer.ip": new Wildcard([`${ADDRESS}*`, `${TOKEN}*`]),
    });
    // A span has no body: not one of its fields.
    expect(bound["body"]).toEqual(new Search(ADDRESS));
  });

  test("exceptions: the message, the stack trace and the attributes", () => {
    const bound: JSONObject = HashedAddressSearch.bindQueryWith({
      query: {
        message: new Search(ADDRESS),
        stackTrace: new Search(`at connect (${ADDRESS})`),
        exceptionType: ADDRESS,
        attributes: { "client.address": ADDRESS },
      } as unknown as JSONObject,
      signal: HashedAddressSignal.Exceptions,
      tokens: tokensA,
    });

    expect(bound["message"]).toEqual(
      new Wildcard([`*${ADDRESS}*`, `*${TOKEN}*`]),
    );
    expect(bound["stackTrace"]).toEqual(
      new Wildcard([`*at connect (${ADDRESS})*`, `*at connect (${TOKEN})*`]),
    );
    expect(bound["exceptionType"]).toBe(ADDRESS);
    expect(bound["attributes"]).toEqual({
      "client.address": new Includes([ADDRESS, TOKEN]),
    });
  });

  test("a query with nothing to bind comes back as the same object", () => {
    const query: JSONObject = {
      body: new Search("timeout"),
      attributes: { "server.address": "10.0.0.12" },
    } as unknown as JSONObject;

    expect(
      HashedAddressSearch.bindQueryWith({
        query,
        signal: HashedAddressSignal.Logs,
        tokens: tokensA,
      }),
    ).toBe(query);
  });

  test("a typed old token is searched as typed, and an address never adds one", () => {
    const legacy: string = legacyTokenOf(ADDRESS);
    const bound: JSONObject = HashedAddressSearch.bindQueryWith({
      query: {
        body: new Search(ADDRESS),
        attributes: { "client.address": legacy },
      } as unknown as JSONObject,
      signal: HashedAddressSignal.Logs,
      tokens: tokensA,
    });

    expect(bound["attributes"]).toEqual({ "client.address": legacy });
    expect(JSON.stringify(bound["body"])).not.toContain(legacy);
  });
});

describe("a chart's attribute filters, as they arrive serialized", () => {
  const ADDRESS: string = "203.0.113.7";
  const TOKEN: string = tokenOf(ADDRESS);

  test.each([
    ["a value", ADDRESS, [ADDRESS, TOKEN]],
    ["a list", [ADDRESS, "web"], [ADDRESS, "web", TOKEN]],
    [
      "equals",
      { _type: ObjectType.EqualTo, value: ADDRESS },
      { _type: ObjectType.Includes, value: [ADDRESS, TOKEN] },
    ],
    [
      "not equal",
      { _type: ObjectType.NotEqual, value: ADDRESS },
      { _type: ObjectType.IncludesNone, value: [ADDRESS, TOKEN] },
    ],
    [
      "contains",
      { _type: ObjectType.Search, value: ADDRESS },
      { _type: ObjectType.Wildcard, value: [`*${ADDRESS}*`, `*${TOKEN}*`] },
    ],
    [
      "does not contain",
      { _type: ObjectType.NotContains, value: ADDRESS },
      { _type: ObjectType.NotWildcard, value: [`*${ADDRESS}*`, `*${TOKEN}*`] },
    ],
    [
      "starts with",
      { _type: ObjectType.StartsWith, value: ADDRESS },
      { _type: ObjectType.Wildcard, value: [`${ADDRESS}*`, `${TOKEN}*`] },
    ],
    [
      "ends with",
      { _type: ObjectType.EndsWith, value: ADDRESS },
      { _type: ObjectType.Wildcard, value: [`*${ADDRESS}`, `*${TOKEN}`] },
    ],
    [
      "a glob",
      { _type: ObjectType.Wildcard, value: [`${ADDRESS}*`] },
      { _type: ObjectType.Wildcard, value: [`${ADDRESS}*`, `${TOKEN}*`] },
    ],
    [
      "is any of",
      { _type: ObjectType.Includes, value: [ADDRESS] },
      { _type: ObjectType.Includes, value: [ADDRESS, TOKEN] },
    ],
    [
      "is none of",
      { _type: ObjectType.IncludesNone, value: [ADDRESS] },
      { _type: ObjectType.IncludesNone, value: [ADDRESS, TOKEN] },
    ],
  ])("%s", (_case: string, value: unknown, expected: unknown) => {
    expect(
      HashedAddressSearch.bindSerializedAttributes(
        { "client.address": value } as Record<string, unknown>,
        tokensA,
      ),
    ).toEqual({ "client.address": expected });
  });

  test("is empty, a number and an operator without an address are kept", () => {
    const attributes: Record<string, unknown> = {
      a: "",
      b: { _type: ObjectType.GreaterThan, value: 5 },
      c: { _type: ObjectType.Search, value: "timeout" },
    };

    expect(
      HashedAddressSearch.bindSerializedAttributes(attributes, tokensA),
    ).toBe(attributes);
  });

  test("with no tokens the filters are the same object", () => {
    const attributes: Record<string, unknown> = { "client.address": ADDRESS };

    expect(
      HashedAddressSearch.bindSerializedAttributes(attributes, undefined),
    ).toBe(attributes);
  });

  test("compiled for a chart, the token is a value the row may hold", () => {
    const statement: Statement = SQL`SELECT count() FROM t WHERE projectId = 1`;

    appendAttributeFilters({
      statement,
      attributes: HashedAddressSearch.bindSerializedAttributes(
        { "client.address": ADDRESS },
        tokensA,
      ),
      validateKey: (): void => {},
    });

    expect(statement.query).toContain("hasAny(mapValues(attributes)");
    expect(Object.values(statement.query_params)).toContainEqual([
      ADDRESS,
      TOKEN,
    ]);
  });
});

describe("free text in a chart: the column contains the text or its hashed form", () => {
  const ADDRESS: string = "203.0.113.7";

  test("with no tokens it is the comparison it always was, byte for byte", () => {
    const before: Statement = SQL` AND body ILIKE ${{
      type: TableColumnType.Text,
      value: `%${escapeIlikePattern(ADDRESS)}%`,
    }}`;
    const now: Statement = new Statement().append(" AND ").append(
      HashedAddressSearch.containsCondition({
        column: "body",
        text: ADDRESS,
        tokens: undefined,
      }),
    );

    expect(now.query).toBe(before.query);
    expect(now.query_params).toEqual(before.query_params);
  });

  test("with tokens and an address: either, in brackets", () => {
    const condition: Statement = HashedAddressSearch.containsCondition({
      column: "body",
      text: `from ${ADDRESS}`,
      tokens: tokensA,
    });

    expect(condition.query).toMatch(
      /^\(body ILIKE \{p0:String\} OR body ILIKE \{p1:String\}\)$/,
    );
    expect(condition.query_params).toEqual({
      p0: `%from ${ADDRESS}%`,
      p1: `%from ${tokenOf(ADDRESS)}%`,
    });
  });

  test("with tokens and no address: the one comparison", () => {
    expect(
      HashedAddressSearch.containsCondition({
        column: "message",
        text: "100% full",
        tokens: tokensA,
      }).query_params,
    ).toEqual({ p0: "%100\\% full%" });
  });
});

describe("whose read is bound: one project's", () => {
  test("a person's read is their project's", () => {
    expect(
      HashedAddressSearch.getReadProjectId(
        { projectId: PROJECT_B },
        { tenantId: PROJECT_A },
      ),
    ).toEqual(PROJECT_A);
  });

  test("a read across projects is never bound", () => {
    expect(
      HashedAddressSearch.getReadProjectId(
        { projectId: PROJECT_A },
        { tenantId: PROJECT_A, isMultiTenantRequest: true },
      ),
    ).toBeNull();
  });

  test("OneUptime's own read is bound to the one project its query names", () => {
    expect(
      HashedAddressSearch.getReadProjectId(
        { projectId: PROJECT_A },
        ROOT_PROPS,
      ),
    ).toEqual(PROJECT_A);
    expect(
      HashedAddressSearch.getReadProjectId(
        { projectId: PROJECT_A.toString() },
        ROOT_PROPS,
      ),
    ).toEqual(PROJECT_A);
    expect(
      HashedAddressSearch.getReadProjectId(
        { projectId: new Includes([PROJECT_A, PROJECT_B]) },
        ROOT_PROPS,
      ),
    ).toBeNull();
    expect(HashedAddressSearch.getReadProjectId({}, ROOT_PROPS)).toBeNull();
  });

  test("a read with no project and no root is never bound", () => {
    expect(
      HashedAddressSearch.getReadProjectId({ projectId: PROJECT_A }, {}),
    ).toBeNull();
    expect(
      HashedAddressSearch.getReadProjectId({ projectId: PROJECT_A }, undefined),
    ).toBeNull();
  });
});

describe("which projects: an IP Address rule with the Hash action", () => {
  test.each([
    [
      "a log rule",
      { logs: true, traces: false },
      { logs: true, traces: false, exceptions: true },
    ],
    [
      "a trace rule",
      { logs: false, traces: true },
      { logs: false, traces: true, exceptions: true },
    ],
    [
      "both",
      { logs: true, traces: true },
      { logs: true, traces: true, exceptions: true },
    ],
    [
      "neither",
      { logs: false, traces: false },
      { logs: false, traces: false, exceptions: false },
    ],
  ])(
    "%s",
    async (
      _case: string,
      hashing: Hashing,
      expected: { logs: boolean; traces: boolean; exceptions: boolean },
    ) => {
      hashingByProject.set(PROJECT_A.toString(), hashing);

      const answer: { logs: boolean; traces: boolean; exceptions: boolean } = {
        logs: await HashedAddressSearch.isHashingAddresses({
          projectId: PROJECT_A,
          signal: HashedAddressSignal.Logs,
        }),
        traces: await HashedAddressSearch.isHashingAddresses({
          projectId: PROJECT_A,
          signal: HashedAddressSignal.Traces,
        }),
        exceptions: await HashedAddressSearch.isHashingAddresses({
          projectId: PROJECT_A,
          signal: HashedAddressSignal.Exceptions,
        }),
      };

      expect(answer).toEqual(expected);
    },
  );

  test("the rules are read in the project, by their pattern and action, as root - whatever their switch", async () => {
    await HashedAddressSearch.isHashingAddresses({
      projectId: PROJECT_A,
      signal: HashedAddressSignal.Logs,
    });

    expect(ruleQueries).toEqual([
      {
        table: "log",
        query: {
          projectId: PROJECT_A,
          patternType: LogScrubPatternType.IPAddress,
          scrubAction: LogScrubAction.Hash,
        },
        props: { isRoot: true },
      },
      {
        table: "trace",
        query: {
          projectId: PROJECT_A,
          patternType: TraceScrubPatternType.IPAddress,
          scrubAction: TraceScrubAction.Hash,
        },
        props: { isRoot: true },
      },
    ]);
  });

  test("a project's answer is kept a while: one read of the rules", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: false });

    for (let read: number = 0; read < 3; read++) {
      await HashedAddressSearch.isHashingAddresses({
        projectId: PROJECT_A,
        signal: HashedAddressSignal.Logs,
      });
    }

    expect(ruleQueries).toHaveLength(2);
  });

  test("rules that cannot be read bind nothing", async () => {
    jest
      .spyOn(LogScrubRuleService, "countBy")
      .mockRejectedValue(new Error("down") as never);

    expect(
      await HashedAddressSearch.isHashingAddresses({
        projectId: PROJECT_A,
        signal: HashedAddressSignal.Logs,
      }),
    ).toBe(false);
  });
});

describe("a read's query, bound", () => {
  const ADDRESS: string = "203.0.113.7";

  const logQuery: () => JSONObject = (): JSONObject => {
    return {
      projectId: PROJECT_A,
      body: new Search(ADDRESS),
      attributes: { "client.address": ADDRESS },
    } as unknown as JSONObject;
  };

  test("a project with no Hash rule runs the query it ran before: the same object", async () => {
    const query: JSONObject = logQuery();

    expect(
      await HashedAddressSearch.bindQuery({
        query,
        props: { tenantId: PROJECT_A },
        signal: HashedAddressSignal.Logs,
      }),
    ).toBe(query);
  });

  test("a search that names no address reads no rule", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: true });
    const query: JSONObject = {
      body: new Search("timeout"),
      attributes: { "server.address": "10.0.0.12" },
    } as unknown as JSONObject;

    expect(
      await HashedAddressSearch.bindQuery({
        query,
        props: { tenantId: PROJECT_A },
        signal: HashedAddressSignal.Logs,
      }),
    ).toBe(query);
    expect(ruleQueries).toHaveLength(0);
  });

  test("a project with an IP Address Hash rule matches the address or its token", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: false });

    const bound: JSONObject = await HashedAddressSearch.bindQuery({
      query: logQuery(),
      props: { tenantId: PROJECT_A },
      signal: HashedAddressSignal.Logs,
    });

    expect(bound["attributes"]).toEqual({
      "client.address": new Includes([ADDRESS, tokenOf(ADDRESS)]),
    });
    expect(bound["body"]).toEqual(
      new Wildcard([`*${ADDRESS}*`, `*${tokenOf(ADDRESS)}*`]),
    );
  });

  test("an address searched in two projects matches each project's own token only", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: false });
    hashingByProject.set(PROJECT_B.toString(), { logs: true, traces: false });

    const inA: string = JSON.stringify(
      await HashedAddressSearch.bindQuery({
        query: logQuery(),
        props: { tenantId: PROJECT_A },
        signal: HashedAddressSignal.Logs,
      }),
    );
    const inB: string = JSON.stringify(
      await HashedAddressSearch.bindQuery({
        query: { ...logQuery(), projectId: PROJECT_B },
        props: { tenantId: PROJECT_B },
        signal: HashedAddressSignal.Logs,
      }),
    );

    expect(inA).toContain(tokenOf(ADDRESS, PROJECT_A));
    expect(inA).not.toContain(tokenOf(ADDRESS, PROJECT_B));
    expect(inB).toContain(tokenOf(ADDRESS, PROJECT_B));
    expect(inB).not.toContain(tokenOf(ADDRESS, PROJECT_A));
  });

  test("a project whose trace rules hash binds its span searches, not its log searches", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: false, traces: true });
    const query: JSONObject = logQuery();

    expect(
      await HashedAddressSearch.bindQuery({
        query,
        props: { tenantId: PROJECT_A },
        signal: HashedAddressSignal.Logs,
      }),
    ).toBe(query);
    expect(
      await HashedAddressSearch.bindQuery({
        query: { attributes: { "client.address": ADDRESS } },
        props: { tenantId: PROJECT_A },
        signal: HashedAddressSignal.Traces,
      }),
    ).toEqual({
      attributes: {
        "client.address": new Includes([ADDRESS, tokenOf(ADDRESS)]),
      },
    });
  });

  test("a read across projects is left as it is, and reads no rule", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: true });
    const query: JSONObject = logQuery();

    expect(
      await HashedAddressSearch.bindQuery({
        query,
        props: { tenantId: PROJECT_A, isMultiTenantRequest: true },
        signal: HashedAddressSignal.Logs,
      }),
    ).toBe(query);
    expect(ruleQueries).toHaveLength(0);
  });
});

describe("what a search's note says: the addresses it also matched by token", () => {
  test("each address once, as first written, the spellings of one address counted once", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: true, traces: false });

    expect(
      await HashedAddressSearch.getAddressesMatchedByToken({
        projectId: PROJECT_A,
        signal: HashedAddressSignal.Logs,
        texts: [
          "203.0.113.7",
          "from ::ffff:203.0.113.7",
          "2001:db8::1",
          "10.0.0.12",
          "timeout",
        ],
      }),
    ).toEqual(["203.0.113.7", "2001:db8::1"]);
  });

  test("none for a project that hashes no addresses out of the signal", async () => {
    hashingByProject.set(PROJECT_A.toString(), { logs: false, traces: true });

    expect(
      await HashedAddressSearch.getAddressesMatchedByToken({
        projectId: PROJECT_A,
        signal: HashedAddressSignal.Logs,
        texts: ["203.0.113.7"],
      }),
    ).toEqual([]);
  });

  test("none, and no rule read, for a search that names no address", async () => {
    expect(
      await HashedAddressSearch.getAddressesMatchedByToken({
        projectId: PROJECT_A,
        signal: HashedAddressSignal.Logs,
        texts: ["timeout", "10.0.0.12"],
      }),
    ).toEqual([]);
    expect(ruleQueries).toHaveLength(0);
  });
});

describe("the texts a search compares, as the explorers and the server read them", () => {
  test("logs: the body and every attribute, from operators and their serialized form", () => {
    expect(
      getHashedAddressSearchTexts(
        {
          body: new Search("from 203.0.113.7"),
          traceId: "203.0.113.8",
          attributes: {
            "client.address": new Includes(["203.0.113.9", "x"]),
            "net.peer": { _type: ObjectType.Wildcard, value: ["2001:db8::*"] },
            "http.status_code": 500,
          },
        },
        HashedAddressSignal.Logs,
      ),
    ).toEqual(["from 203.0.113.7", "203.0.113.9", "x", "2001:db8::*"]);
  });

  test("traces: the name and status message; exceptions: the message and stack trace", () => {
    expect(
      getHashedAddressSearchTexts(
        { name: "a", statusMessage: new Search("b"), body: "c" },
        HashedAddressSignal.Traces,
      ),
    ).toEqual(["a", "b"]);
    expect(
      getHashedAddressSearchTexts(
        {
          message: [new Search("a"), new NotContains("b")],
          stackTrace: "c",
          exceptionType: "d",
        },
        HashedAddressSignal.Exceptions,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("nothing for a query that is not one", () => {
    expect(
      getHashedAddressSearchTexts(undefined, HashedAddressSignal.Logs),
    ).toEqual([]);
    expect(getHashedAddressSearchTexts("x", HashedAddressSignal.Logs)).toEqual(
      [],
    );
  });
});
