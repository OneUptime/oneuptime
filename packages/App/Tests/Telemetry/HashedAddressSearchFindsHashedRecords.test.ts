import crypto from "crypto";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import HashedAddressSearch, {
  HashedAddressTokens,
} from "Common/Server/Utils/Telemetry/HashedAddressSearch";
import { escapeIlikePattern } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { HashedAddressSignal } from "Common/Types/Telemetry/HashedAddressSearch";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH FOR AN IP ADDRESS FINDS THE RECORDS INGEST HASHED IT OUT OF
 * (#10418), END TO END BUT FOR THE DATABASE.
 *
 * Records are scrubbed here exactly as ingest scrubs them (the log and trace
 * engines, under an IP Address rule set to Hash), and a search is bound
 * exactly as every read binds it (HashedAddressSearch). Whether a stored
 * record matches is then decided as ClickHouse decides the compiled read: a
 * value `IN` the list, a text `ILIKE` a pattern, by the patterns the
 * statement binds (Wildcard.toPatterns, as StatementGenerator compiles
 * them). So:
 *
 *  - a log whose client.address was hashed is found by
 *    `@client.address:203.0.113.7` and by the free text `203.0.113.7`; a
 *    record from another address is not; the search as it was, unbound,
 *    finds neither;
 *  - however the address is typed (::ffff:203.0.113.7, 2001:DB8::1), or
 *    was written in the record, it is found;
 *  - spans: the name, the status message and the attributes;
 *  - never across projects: project B's search never finds project A's
 *    hashed record of the same address;
 *  - a record hashed before tokens were keyed (8 hex characters) is not
 *    matched, which the explorers say;
 *  - "-@client.address:203.0.113.7" leaves out the hashed record too.
 * ---------------------------------------------------------------------------
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

const PROJECT_A: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a20418",
);
const PROJECT_B: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000b20418",
);

const regexOf: (service: unknown, patternType: string) => ScrubRegExp = (
  service: unknown,
  patternType: string,
): ScrubRegExp => {
  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(patternType);

  expect(regex).not.toBeNull();

  return regex as ScrubRegExp;
};

// A project's IP Address rule for its logs, set to Hash, as ingest loads it.
const logHashRules: (projectId: ObjectID) => never = (
  projectId: ObjectID,
): never => {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "Hash IP addresses";
  rule.projectId = projectId;
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = LogScrubAction.Hash;
  rule.fieldsToScrub = LogScrubField.Both;

  return [
    {
      rule,
      regex: regexOf(LogScrubRuleService, LogScrubPatternType.IPAddress),
    },
  ] as never;
};

const traceHashRules: (projectId: ObjectID) => never = (
  projectId: ObjectID,
): never => {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "Hash IP addresses";
  rule.projectId = projectId;
  rule.patternType = TraceScrubPatternType.IPAddress;
  rule.scrubAction = TraceScrubAction.Hash;
  rule.fieldsToScrub = TraceScrubField.All;

  return [
    {
      rule,
      regex: regexOf(TraceScrubRuleService, TraceScrubPatternType.IPAddress),
    },
  ] as never;
};

// What ingest stores of a log, in a project hashing IP addresses.
const storedLog: (
  projectId: ObjectID,
  address: string,
) => { body: string; attributes: Record<string, string> } = (
  projectId: ObjectID,
  address: string,
): { body: string; attributes: Record<string, string> } => {
  return LogScrubRuleService.scrubLog(
    {
      body: `login failed for ${address} after 3 tries`,
      attributes: { "client.address": address, "user.id": "u-42" },
    } as JSONObject,
    logHashRules(projectId),
  ) as unknown as { body: string; attributes: Record<string, string> };
};

// A SQL LIKE pattern, read case-insensitively as ClickHouse reads ILIKE.
const ilikeMatches: (value: string, pattern: string) => boolean = (
  value: string,
  pattern: string,
): boolean => {
  let source: string = "";

  for (let index: number = 0; index < pattern.length; index++) {
    const character: string = pattern[index]!;

    if (character === "\\" && index + 1 < pattern.length) {
      source += escapeRegExp(pattern[index + 1]!);
      index++;
    } else if (character === "%") {
      source += "[\\s\\S]*";
    } else if (character === "_") {
      source += "[\\s\\S]";
    } else {
      source += escapeRegExp(character);
    }
  }

  return new RegExp(`^${source}$`, "iu").test(value);
};

// Whether a stored value meets one compiled comparison of a read.
const meets: (stored: string | undefined, comparison: unknown) => boolean = (
  stored: string | undefined,
  comparison: unknown,
): boolean => {
  const value: string = stored ?? "";

  if (typeof comparison === "string") {
    return value === comparison;
  }

  if (comparison instanceof Includes) {
    return comparison.values.map(String).includes(value);
  }

  if (comparison instanceof IncludesNone) {
    return !comparison.values.map(String).includes(value);
  }

  if (comparison instanceof Search) {
    return ilikeMatches(value, `%${escapeIlikePattern(comparison.value)}%`);
  }

  if (comparison instanceof Wildcard) {
    return comparison.toPatterns().some((pattern: string): boolean => {
      return ilikeMatches(value, pattern);
    });
  }

  if (comparison instanceof NotWildcard) {
    return !comparison.toPatterns().some((pattern: string): boolean => {
      return ilikeMatches(value, pattern);
    });
  }

  throw new Error("A comparison this test does not read");
};

interface StoredRecord {
  [field: string]: unknown;
  attributes: Record<string, string>;
}

// Whether a stored record meets every comparison of a query.
const isFound: (record: StoredRecord, query: JSONObject) => boolean = (
  record: StoredRecord,
  query: JSONObject,
): boolean => {
  return Object.entries(query).every(
    ([field, comparison]: [string, unknown]): boolean => {
      if (field === "attributes") {
        return Object.entries(comparison as Record<string, unknown>).every(
          ([key, attributeComparison]: [string, unknown]): boolean => {
            return meets(record.attributes[key], attributeComparison);
          },
        );
      }

      return meets(record[field] as string | undefined, comparison);
    },
  );
};

const bound: (
  query: JSONObject,
  signal: HashedAddressSignal,
  projectId: ObjectID,
) => JSONObject = (
  query: JSONObject,
  signal: HashedAddressSignal,
  projectId: ObjectID,
): JSONObject => {
  return HashedAddressSearch.bindQueryWith({
    query,
    signal,
    tokens: new HashedAddressTokens(projectId),
  });
};

const ADDRESS: string = "203.0.113.7";

describe("a log whose address was hashed is found by a search for the address", () => {
  const hashed: StoredRecord = storedLog(PROJECT_A, ADDRESS);
  const fromAnotherAddress: StoredRecord = storedLog(PROJECT_A, "198.51.100.4");

  test("ingest stored no address, only the project's token", () => {
    expect(JSON.stringify(hashed)).not.toContain(ADDRESS);
    expect(hashed.attributes["client.address"]).toMatch(
      /^\[HASHED:[0-9a-f]{16}\]$/,
    );
  });

  test.each([
    [
      "@client.address:203.0.113.7",
      { attributes: { "client.address": ADDRESS } },
    ],
    ["free text 203.0.113.7", { body: new Search(ADDRESS) }],
    [
      "free text around it",
      { body: new Search(`login failed for ${ADDRESS}`) },
    ],
    [
      "both",
      {
        body: new Search(ADDRESS),
        attributes: { "client.address": ADDRESS },
      },
    ],
    [
      "@client.address:~203.0.113.7",
      { attributes: { "client.address": new Search(ADDRESS) } },
    ],
    [
      "@client.address:(203.0.113.7 OR 192.0.2.1)",
      {
        attributes: {
          "client.address": new Includes([ADDRESS, "192.0.2.1"]),
        },
      },
    ],
  ])("%s", (_search: string, query: unknown) => {
    expect(isFound(hashed, query as JSONObject)).toBe(false);
    expect(
      isFound(
        hashed,
        bound(query as JSONObject, HashedAddressSignal.Logs, PROJECT_A),
      ),
    ).toBe(true);
    expect(
      isFound(
        fromAnotherAddress,
        bound(query as JSONObject, HashedAddressSignal.Logs, PROJECT_A),
      ),
    ).toBe(false);
  });

  test("-@client.address:203.0.113.7 leaves the hashed record out, and keeps another address's", () => {
    const query: JSONObject = bound(
      { attributes: { "client.address": new IncludesNone([ADDRESS]) } },
      HashedAddressSignal.Logs,
      PROJECT_A,
    );

    expect(isFound(hashed, query)).toBe(false);
    expect(isFound(fromAnotherAddress, query)).toBe(true);
  });

  test("never across projects: project B's search does not find project A's hashed record", () => {
    const query: JSONObject = {
      body: new Search(ADDRESS),
      attributes: { "client.address": ADDRESS },
    } as unknown as JSONObject;

    expect(
      isFound(hashed, bound(query, HashedAddressSignal.Logs, PROJECT_B)),
    ).toBe(false);
    expect(
      isFound(
        storedLog(PROJECT_B, ADDRESS),
        bound(query, HashedAddressSignal.Logs, PROJECT_B),
      ),
    ).toBe(true);
  });
});

describe("however the address is typed, or was written", () => {
  test.each([
    ["typed as IPv6, stored as IPv4", "203.0.113.7", "::ffff:203.0.113.7"],
    ["typed as IPv4, stored as IPv6", "::ffff:203.0.113.7", "203.0.113.7"],
    ["IPv6 in capitals", "2001:db8::1", "2001:DB8::1"],
    [
      "IPv6 written out",
      "2001:db8::1",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    ],
  ])("%s", (_case: string, written: string, typed: string) => {
    const record: StoredRecord = storedLog(PROJECT_A, written);

    expect(
      isFound(
        record,
        bound(
          { attributes: { "client.address": typed } } as unknown as JSONObject,
          HashedAddressSignal.Logs,
          PROJECT_A,
        ),
      ),
    ).toBe(true);
  });
});

describe("a span whose address was hashed", () => {
  const span: StoredRecord = TraceScrubRuleService.scrubSpan(
    {
      name: `connect ${ADDRESS}:5432`,
      statusMessage: `refused by ${ADDRESS}`,
      attributes: { "net.peer.ip": ADDRESS },
    } as JSONObject,
    traceHashRules(PROJECT_A),
  ) as unknown as StoredRecord;

  test("is found by its name, its status message and its attributes", () => {
    for (const query of [
      { name: new Search(ADDRESS) },
      { statusMessage: new Search(`refused by ${ADDRESS}`) },
      { attributes: { "net.peer.ip": ADDRESS } },
    ]) {
      expect(isFound(span, query as unknown as JSONObject)).toBe(false);
      expect(
        isFound(
          span,
          bound(
            query as unknown as JSONObject,
            HashedAddressSignal.Traces,
            PROJECT_A,
          ),
        ),
      ).toBe(true);
    }
  });
});

describe("an old token", () => {
  test("a record hashed before tokens were keyed is not matched, by design", () => {
    const legacyToken: string = `[HASHED:${crypto
      .createHash("sha256")
      .update(ADDRESS)
      .digest("hex")
      .slice(0, 8)}]`;
    const oldRecord: StoredRecord = {
      body: `login failed for ${legacyToken}`,
      attributes: { "client.address": legacyToken },
    };

    expect(
      isFound(
        oldRecord,
        bound(
          {
            body: new Search(ADDRESS),
          } as unknown as JSONObject,
          HashedAddressSignal.Logs,
          PROJECT_A,
        ),
      ),
    ).toBe(false);
    expect(
      isFound(
        oldRecord,
        bound(
          {
            attributes: { "client.address": ADDRESS },
          } as unknown as JSONObject,
          HashedAddressSignal.Logs,
          PROJECT_A,
        ),
      ),
    ).toBe(false);
  });
});
