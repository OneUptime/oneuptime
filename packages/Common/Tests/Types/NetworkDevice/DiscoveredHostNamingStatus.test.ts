import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
  readDiscoveredHostNetbiosStatus,
  readDiscoveredHostReverseDnsStatus,
} from "../../../Types/NetworkDevice/DiscoveredHostNamingStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The per-host "why is this host unnamed" codes (OneUptime issue #3916), and
 * the two readers every consumer goes through.
 *
 * The codes are PERSISTED: the probe stamps them into the scan's
 * `discoveredDevices` jsonb, and rows written today are read by every
 * dashboard build from now on. So the spellings are pinned here as literals
 * rather than read back out of the enum. A test that compared the enum with
 * itself would stay green through a rename, and a rename is exactly the
 * change that silently turns every stored code into "no code".
 *
 * The readers are the other half of the contract. The column is written
 * verbatim from the probe's payload, so the declared type says what a probe
 * SHOULD send, not what is stored. A reader that let anything else through
 * would hand the dashboard a value it has no sentence for. Two cases matter
 * most:
 *
 *   - A near miss, like "No-Record" or "timeout ". It looks like a code to a
 *     person, but the copy table is keyed by exact strings. Accepting it would
 *     need a normalisation step nothing else does, and an unknown key would
 *     then look up `undefined` copy.
 *   - A prototype key, like "constructor". A reader built on `value in
 *     SOME_OBJECT` would accept it, and the copy lookup would then return a
 *     FUNCTION, which ends up in the tooltip as its source text.
 *
 * Everything that is not exactly a code reads as undefined, which every
 * consumer already treats as "this row carries no code".
 */

const REVERSE_DNS_CODES: Array<string> = [
  "no-record",
  "unusable-name",
  "timeout",
  "server-failure",
  "refused",
  "unreachable",
  "failed",
  "skipped-time-budget",
  "skipped-no-resolver",
];

const NETBIOS_CODES: Array<string> = [
  "no-reply",
  "no-usable-name",
  "send-failed",
  "skipped",
  "skipped-host-cap",
  "skipped-ineligible-address",
  "skipped-global-probe",
];

/*
 * Every value that is not a string, as jsonb and a hand-written API call
 * can deliver them, plus the JavaScript values no JSON can hold. The readers
 * accept `unknown` because of these.
 */
const NON_STRING_VALUES: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["zero", 0],
  ["a positive number", 7],
  ["a negative number", -1],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["true", true],
  ["false", false],
  ["an empty object", {}],
  ["an empty array", []],
  ["an array holding a code", ["timeout"]],
  ["an array holding a NetBIOS code", ["no-reply"]],
  ["an object wrapping a code", { value: "timeout" }],
  ["a String object", new String("timeout")],
  [
    "an object whose toString is a code",
    {
      toString: (): string => {
        return "timeout";
      },
    },
  ],
  ["a symbol", Symbol("timeout")],
  ["a bigint", BigInt(1)],
  [
    "a function",
    (): string => {
      return "timeout";
    },
  ],
  ["a date", new Date(0)],
];

/*
 * Strings that are not codes. The prototype keys are listed separately
 * below.
 */
const JUNK_STRINGS: Array<[string, string]> = [
  ["the empty string", ""],
  ["a single space", " "],
  ["a sentence", "the DNS server timed out"],
  ["markup", "<img src=x onerror=1>"],
  ["a raw Node error code", "ENOTFOUND"],
  ["a raw DNS rcode", "SERVFAIL"],
  ["a hostname", "kds-01.corp.example.com"],
  ["an address", "10.16.42.51"],
];

const PROTOTYPE_KEYS: Array<string> = [
  "constructor",
  "__proto__",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "prototype",
  "__defineGetter__",
];

/*
 * The near misses a person would read as a code: every spelling here is one
 * edit away from a real one. A one-word code has no hyphen to swap, so the
 * spellings that come out identical to the code itself are dropped.
 */
function nearMissesOf(code: string): Array<string> {
  const camelCase: string = code.replace(
    /-([a-z])/g,
    (_match: string, letter: string): string => {
      return letter.toUpperCase();
    },
  );

  return [
    code.toUpperCase(),
    code.charAt(0).toUpperCase() + code.slice(1),
    ` ${code}`,
    `${code} `,
    `\t${code}\n`,
    `${code}\u0000`,
    code.replace(/-/g, "_"),
    code.replace(/-/g, " "),
    camelCase,
    // The enum KEY spelling, e.g. "NoRecord" for "no-record".
    camelCase.charAt(0).toUpperCase() + camelCase.slice(1),
    `${code}s`,
    code.slice(0, -1),
    `"${code}"`,
  ].filter((nearMiss: string): boolean => {
    return nearMiss !== code;
  });
}

describe("DiscoveredHostReverseDnsStatus", () => {
  test("holds exactly the persisted codes, spelled as they are stored", () => {
    expect(Object.values(DiscoveredHostReverseDnsStatus).sort()).toEqual(
      [...REVERSE_DNS_CODES].sort(),
    );
  });

  test.each([
    [DiscoveredHostReverseDnsStatus.NoRecord, "no-record"],
    [DiscoveredHostReverseDnsStatus.UnusableName, "unusable-name"],
    [DiscoveredHostReverseDnsStatus.Timeout, "timeout"],
    [DiscoveredHostReverseDnsStatus.ServerFailure, "server-failure"],
    [DiscoveredHostReverseDnsStatus.Refused, "refused"],
    [DiscoveredHostReverseDnsStatus.Unreachable, "unreachable"],
    [DiscoveredHostReverseDnsStatus.Failed, "failed"],
    [DiscoveredHostReverseDnsStatus.SkippedTimeBudget, "skipped-time-budget"],
    [DiscoveredHostReverseDnsStatus.SkippedNoResolver, "skipped-no-resolver"],
  ])("%s is stored as %p", (member: string, stored: string) => {
    expect(member).toBe(stored);
  });
});

describe("DiscoveredHostNetbiosStatus", () => {
  test("holds exactly the persisted codes, spelled as they are stored", () => {
    expect(Object.values(DiscoveredHostNetbiosStatus).sort()).toEqual(
      [...NETBIOS_CODES].sort(),
    );
  });

  test.each([
    [DiscoveredHostNetbiosStatus.NoReply, "no-reply"],
    [DiscoveredHostNetbiosStatus.NoUsableName, "no-usable-name"],
    [DiscoveredHostNetbiosStatus.SendFailed, "send-failed"],
    [DiscoveredHostNetbiosStatus.Skipped, "skipped"],
    [DiscoveredHostNetbiosStatus.SkippedHostCap, "skipped-host-cap"],
    [
      DiscoveredHostNetbiosStatus.SkippedIneligibleAddress,
      "skipped-ineligible-address",
    ],
    [DiscoveredHostNetbiosStatus.SkippedGlobalProbe, "skipped-global-probe"],
  ])("%s is stored as %p", (member: string, stored: string) => {
    expect(member).toBe(stored);
  });
});

describe("the two code sets", () => {
  /*
   * No code means one thing in one field and something else in the other.
   * If a spelling were shared, a probe that wrote it to the wrong field would
   * get a plausible but wrong sentence instead of the "no code" fallback.
   */
  test("share no spelling", () => {
    const reverseDnsCodes: Set<string> = new Set<string>(
      Object.values(DiscoveredHostReverseDnsStatus),
    );

    for (const code of Object.values(DiscoveredHostNetbiosStatus)) {
      expect(reverseDnsCodes.has(code)).toBe(false);
    }
  });

  /*
   * Short kebab-case: the column can hold tens of thousands of hosts, and
   * each code is repeated once per unnamed host. Anything longer, or with
   * spaces or capitals, is a sentence that has slipped into the payload.
   */
  test.each([
    ...Object.values(DiscoveredHostReverseDnsStatus),
    ...Object.values(DiscoveredHostNetbiosStatus),
  ])("%p is short lower-case kebab-case", (code: string) => {
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(code.length).toBeLessThanOrEqual(32);
  });
});

describe("readDiscoveredHostReverseDnsStatus", () => {
  test.each(Object.values(DiscoveredHostReverseDnsStatus))(
    "reads the exact code %p as itself",
    (code: DiscoveredHostReverseDnsStatus) => {
      expect(readDiscoveredHostReverseDnsStatus(code)).toBe(code);
    },
  );

  test.each(REVERSE_DNS_CODES)(
    "reads the literal %p as the matching enum member",
    (literal: string) => {
      /*
       * The value comes out of JSON as a plain string, never as an enum
       * member, so this is the case that happens in production.
       */
      const stored: unknown = JSON.parse(JSON.stringify(literal));

      expect(readDiscoveredHostReverseDnsStatus(stored)).toBe(literal);
    },
  );

  test.each(REVERSE_DNS_CODES)(
    "rejects every near miss of %p",
    (code: string) => {
      // Enough spellings survive the filter for this to test something.
      expect(nearMissesOf(code).length).toBeGreaterThanOrEqual(10);

      for (const nearMiss of nearMissesOf(code)) {
        expect(readDiscoveredHostReverseDnsStatus(nearMiss)).toBeUndefined();
      }
    },
  );

  test.each(NON_STRING_VALUES)(
    "rejects %s",
    (_label: string, value: unknown) => {
      expect(readDiscoveredHostReverseDnsStatus(value)).toBeUndefined();
    },
  );

  test.each(JUNK_STRINGS)("rejects %s", (_label: string, value: string) => {
    expect(readDiscoveredHostReverseDnsStatus(value)).toBeUndefined();
  });

  test.each(PROTOTYPE_KEYS)("rejects the prototype key %p", (key: string) => {
    expect(readDiscoveredHostReverseDnsStatus(key)).toBeUndefined();
  });

  test.each(Object.values(DiscoveredHostNetbiosStatus))(
    "rejects the NetBIOS code %p",
    (code: string) => {
      /*
       * A probe that stamped a NetBIOS code into the reverse-DNS field would
       * otherwise have the dashboard look up a key its reverse-DNS copy
       * table does not have.
       */
      expect(readDiscoveredHostReverseDnsStatus(code)).toBeUndefined();
    },
  );

  test("rejects the enum's own key names", () => {
    for (const key of Object.keys(DiscoveredHostReverseDnsStatus)) {
      expect(readDiscoveredHostReverseDnsStatus(key)).toBeUndefined();
    }
  });

  test("never throws, whatever it is handed", () => {
    const hostile: Array<unknown> = [
      Object.create(null),
      new Proxy(
        {},
        {
          get: (): never => {
            throw new Error("read");
          },
        },
      ),
      ...NON_STRING_VALUES.map((entry: [string, unknown]): unknown => {
        return entry[1];
      }),
    ];

    for (const value of hostile) {
      expect(() => {
        return readDiscoveredHostReverseDnsStatus(value);
      }).not.toThrow();
    }
  });
});

describe("readDiscoveredHostNetbiosStatus", () => {
  test.each(Object.values(DiscoveredHostNetbiosStatus))(
    "reads the exact code %p as itself",
    (code: DiscoveredHostNetbiosStatus) => {
      expect(readDiscoveredHostNetbiosStatus(code)).toBe(code);
    },
  );

  test.each(NETBIOS_CODES)(
    "reads the literal %p as the matching enum member",
    (literal: string) => {
      const stored: unknown = JSON.parse(JSON.stringify(literal));

      expect(readDiscoveredHostNetbiosStatus(stored)).toBe(literal);
    },
  );

  test.each(NETBIOS_CODES)("rejects every near miss of %p", (code: string) => {
    expect(nearMissesOf(code).length).toBeGreaterThanOrEqual(10);

    for (const nearMiss of nearMissesOf(code)) {
      expect(readDiscoveredHostNetbiosStatus(nearMiss)).toBeUndefined();
    }
  });

  test.each(NON_STRING_VALUES)(
    "rejects %s",
    (_label: string, value: unknown) => {
      expect(readDiscoveredHostNetbiosStatus(value)).toBeUndefined();
    },
  );

  test.each(JUNK_STRINGS)("rejects %s", (_label: string, value: string) => {
    expect(readDiscoveredHostNetbiosStatus(value)).toBeUndefined();
  });

  test.each(PROTOTYPE_KEYS)("rejects the prototype key %p", (key: string) => {
    expect(readDiscoveredHostNetbiosStatus(key)).toBeUndefined();
  });

  test.each(Object.values(DiscoveredHostReverseDnsStatus))(
    "rejects the reverse-DNS code %p",
    (code: string) => {
      expect(readDiscoveredHostNetbiosStatus(code)).toBeUndefined();
    },
  );

  test("rejects the enum's own key names", () => {
    for (const key of Object.keys(DiscoveredHostNetbiosStatus)) {
      expect(readDiscoveredHostNetbiosStatus(key)).toBeUndefined();
    }
  });

  test("never throws, whatever it is handed", () => {
    const hostile: Array<unknown> = [
      Object.create(null),
      new Proxy(
        {},
        {
          get: (): never => {
            throw new Error("read");
          },
        },
      ),
      ...NON_STRING_VALUES.map((entry: [string, unknown]): unknown => {
        return entry[1];
      }),
    ];

    for (const value of hostile) {
      expect(() => {
        return readDiscoveredHostNetbiosStatus(value);
      }).not.toThrow();
    }
  });
});
