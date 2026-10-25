import {
  EXACT_SECURITY_CONNECTION_REASONS,
  POSSIBLE_SECURITY_CONNECTION_REASONS,
  SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  SECURITY_CONNECTION_KINDS,
  SECURITY_CONNECTION_MAX_ADDRESSES,
  SECURITY_CONNECTION_MAX_ENTITIES,
  SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  MAX_HOST_NAME_LENGTH,
  SecurityAddressScope,
  SecurityConnectionLookups,
  SecurityConnectionWindow,
  canonicalAddress,
  compareConnectedResources,
  foldConnectionValue,
  getBestCertainty,
  getCaseConnectionWindow,
  getEventConnectionWindow,
  getObservableSearchValues,
  getRecordSecurityValues,
  getSecurityAddressScope,
  getSecurityConnectionLookups,
  getShortHostName,
  isEmailLike,
  isHostNameLike,
  matchAddress,
  matchEmail,
  matchHostName,
  readRecordAddresses,
  readSecurityLogResource,
  recordReportsAddress,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  getEntityCaseGroupingKey,
  getEntityRiskKey,
} from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether a value Security Events names is one of the project's own records,
 * and how sure that is (Types/SecurityCase/SecurityConnection): exact,
 * possible - shown, said to be possible, counted nowhere - or not at all.
 * Every value here is outside text, so each rule is held to its shape too:
 * what it must never be handed, and how long it may take.
 */

const NOW: Date = new Date("2026-10-25T12:00:00.000Z");

function minutes(date: Date, offset: number): Date {
  return new Date(date.getTime() + offset * 60 * 1000);
}

describe("one identity: the way an entity's risk and a case's grouping key fold a value", () => {
  test("trimmed and case folded, as getEntityRiskKey folds it", () => {
    expect(foldConnectionValue("  WEB-1 ")).toBe("web-1");
    expect(foldConnectionValue("Web-1")).toBe(getEntityRiskKey("web-1"));
    expect(getEntityCaseGroupingKey("WEB-1")).toBe(
      `entity:${foldConnectionValue("web-1")}`,
    );
  });

  test("a value too long to index whole is hashed on both sides, so it still meets itself", () => {
    const long: string = `${"a".repeat(240)}.example`;

    expect(foldConnectionValue(long)).toBe(getEntityRiskKey(long));
    expect(foldConnectionValue(long.toUpperCase())).toBe(
      foldConnectionValue(long),
    );
    expect(foldConnectionValue(long).startsWith("sha256:")).toBe(true);
  });

  test("nothing folds to nothing", () => {
    expect(foldConnectionValue(undefined)).toBe("");
    expect(foldConnectionValue(null)).toBe("");
    expect(foldConnectionValue("   ")).toBe("");
  });
});

describe("the kinds and reasons", () => {
  test("every kind is listed once, machines first and inventory items last", () => {
    expect(new Set(SECURITY_CONNECTION_KINDS).size).toBe(
      Object.values(SecurityConnectionKind).length,
    );
    expect(SECURITY_CONNECTION_KINDS[0]).toBe(SecurityConnectionKind.Host);
    expect(
      SECURITY_CONNECTION_KINDS[SECURITY_CONNECTION_KINDS.length - 1],
    ).toBe(SecurityConnectionKind.InventoryItem);
  });

  test("every reason is either exact or possible, never both", () => {
    const all: Array<SecurityConnectionReason> = [
      ...EXACT_SECURITY_CONNECTION_REASONS,
      ...POSSIBLE_SECURITY_CONNECTION_REASONS,
    ];

    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(Object.values(SecurityConnectionReason)));
  });
});

describe("isHostNameLike", () => {
  test.each([
    "web-1",
    "WEB-1",
    "web_1",
    "web-1.acme.internal",
    "ip-10-0-1-5.ec2.internal",
    "a",
    "1234",
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  ])("%s can be a machine's name", (value: string) => {
    expect(isHostNameLike(value)).toBe(true);
  });

  test.each([
    "",
    "   ",
    "web 1",
    "web-1.",
    ".web-1",
    "-web",
    "web-",
    "a..b",
    "%",
    "web*",
    "web'1",
    "web/1",
    "https://web-1.example",
    "k.morgan@acme.example",
    "10.0.0.5",
    "2001:db8::7",
    "a".repeat(MAX_HOST_NAME_LENGTH + 1),
  ])("%s is no machine's name, and is never looked up as one", (value: string) => {
    expect(isHostNameLike(value)).toBe(false);
  });
});

describe("getShortHostName", () => {
  test("a full name's first label", () => {
    expect(getShortHostName("web-1.acme.internal")).toBe("web-1");
    expect(getShortHostName("WEB-1.ACME.INTERNAL")).toBe("web-1");
  });

  test("a bare name, an address or anything else has none", () => {
    expect(getShortHostName("web-1")).toBeNull();
    expect(getShortHostName("10.0.0.5")).toBeNull();
    expect(getShortHostName("web 1.acme")).toBeNull();
    expect(getShortHostName(undefined)).toBeNull();
  });
});

describe("matchHostName", () => {
  test("the same name, whatever its case or spaces: exact", () => {
    expect(
      matchHostName({ entityValue: " WEB-1 ", resourceName: "web-1" }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.HostName,
    });
  });

  test("an exact match is named as the record's kind names it", () => {
    expect(
      matchHostName({
        entityValue: "prod-eu",
        resourceName: "prod-eu",
        exactReason: SecurityConnectionReason.ClusterName,
      })?.reason,
    ).toBe(SecurityConnectionReason.ClusterName);
  });

  test("a host or domain entity can be exact; an untyped value only possible", () => {
    expect(
      matchHostName({
        entityValue: "web-1.acme.internal",
        entityType: SecurityEntityType.Domain,
        resourceName: "web-1.acme.internal",
      })?.certainty,
    ).toBe(SecurityConnectionCertainty.Exact);

    expect(
      matchHostName({
        entityValue: "production",
        entityType: SecurityEntityType.Other,
        resourceName: "production",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.UntypedValue,
    });
  });

  test("a bare name and the full name starting with it: possible, either way round", () => {
    const possible: object = {
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.ShortHostName,
    };

    expect(
      matchHostName({
        entityValue: "web-1",
        resourceName: "web-1.acme.internal",
      }),
    ).toEqual(possible);
    expect(
      matchHostName({
        entityValue: "WEB-1.acme.internal",
        resourceName: "web-1",
      }),
    ).toEqual(possible);
  });

  test("two full names sharing a first label are two machines", () => {
    expect(
      matchHostName({
        entityValue: "web-1.prod.acme",
        resourceName: "web-1.staging.acme",
      }),
    ).toBeNull();
  });

  test("a different name, an address or nothing matches nothing", () => {
    expect(
      matchHostName({ entityValue: "web-2", resourceName: "web-1" }),
    ).toBeNull();
    expect(
      matchHostName({ entityValue: "10.0.0", resourceName: "10.0.0.5" }),
    ).toBeNull();
    expect(
      matchHostName({ entityValue: "web-1", resourceName: undefined }),
    ).toBeNull();
    expect(matchHostName({ entityValue: "", resourceName: "" })).toBeNull();
  });
});

describe("emails", () => {
  test("isEmailLike: one @, a domain with a dot, no white space", () => {
    expect(isEmailLike("k.morgan@acme.example")).toBe(true);
    expect(isEmailLike("root")).toBe(false);
    expect(isEmailLike("a@b")).toBe(false);
    expect(isEmailLike("a@@b.example")).toBe(false);
    expect(isEmailLike("@acme.example")).toBe(false);
    expect(isEmailLike("a b@acme.example")).toBe(false);
    expect(isEmailLike(`${"a".repeat(250)}@b.example`)).toBe(false);
  });

  test("the member with this email, folded: exact", () => {
    expect(
      matchEmail({
        entityValue: "K.Morgan@ACME.example",
        email: "k.morgan@acme.example",
      }),
    ).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.Email,
    });
  });

  test("a bare user name names nobody in particular; another email is another person", () => {
    expect(matchEmail({ entityValue: "kmorgan", email: "kmorgan" })).toBeNull();
    expect(
      matchEmail({
        entityValue: "k.morgan@acme.example",
        email: "kim@acme.example",
      }),
    ).toBeNull();
  });
});

describe("addresses", () => {
  test("canonicalAddress: one spelling for each address", () => {
    expect(canonicalAddress("10.0.0.5")).toBe("10.0.0.5");
    expect(canonicalAddress(" 10.0.0.5 ")).toBe("10.0.0.5");
    expect(canonicalAddress("2001:db8::7")).toBe("2001:db8:0:0:0:0:0:7");
    expect(canonicalAddress("2001:0DB8:0:0:0:0:0:7")).toBe(
      "2001:db8:0:0:0:0:0:7",
    );
    expect(canonicalAddress("fe80::1%eth0")).toBe("fe80:0:0:0:0:0:0:1");
    expect(canonicalAddress("::ffff:10.0.0.5")).toBe("10.0.0.5");
    expect(canonicalAddress("::1")).toBe("0:0:0:0:0:0:0:1");
  });

  test.each([
    "",
    "10.0.0",
    "10.0.0.256",
    "10.0.0.5.1",
    "1.2.3.-4",
    "2001:db8::7::1",
    "2001:db8:zz::1",
    "12345::1",
    "web-1",
    "1:2:3:4:5:6:7:8:9",
  ])("%s is no address", (value: string) => {
    expect(canonicalAddress(value)).toBeNull();
    expect(getSecurityAddressScope(value)).toBeNull();
  });

  test.each([
    ["203.0.113.7", SecurityAddressScope.Public],
    ["8.8.8.8", SecurityAddressScope.Public],
    ["2001:db8::7", SecurityAddressScope.Public],
    ["10.0.3.17", SecurityAddressScope.Private],
    ["172.16.0.1", SecurityAddressScope.Private],
    ["172.31.255.255", SecurityAddressScope.Private],
    ["192.168.1.2", SecurityAddressScope.Private],
    ["100.64.0.1", SecurityAddressScope.Private],
    ["fd12:3456::1", SecurityAddressScope.Private],
    ["fec0::1", SecurityAddressScope.Private],
    ["::ffff:192.168.1.2", SecurityAddressScope.Private],
    ["172.32.0.1", SecurityAddressScope.Public],
    ["127.0.0.1", SecurityAddressScope.Local],
    ["0.0.0.0", SecurityAddressScope.Local],
    ["169.254.10.10", SecurityAddressScope.Local],
    ["224.0.0.1", SecurityAddressScope.Local],
    ["255.255.255.255", SecurityAddressScope.Local],
    ["::1", SecurityAddressScope.Local],
    ["::", SecurityAddressScope.Local],
    ["fe80::1", SecurityAddressScope.Local],
    ["ff02::1", SecurityAddressScope.Local],
  ])("%s is %s", (address: string, scope: SecurityAddressScope) => {
    expect(getSecurityAddressScope(address)).toBe(scope);
  });

  test("a public address only one record holds: exact", () => {
    expect(matchAddress({ address: "203.0.113.7", holderCount: 1 })).toEqual({
      certainty: SecurityConnectionCertainty.Exact,
      reason: SecurityConnectionReason.Address,
    });
  });

  test("a private address: possible, however few hold it", () => {
    expect(matchAddress({ address: "10.0.3.17", holderCount: 1 })).toEqual({
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.PrivateAddress,
    });
  });

  test("an address several records hold: possible, public or not", () => {
    for (const address of ["203.0.113.7", "10.0.3.17"]) {
      expect(matchAddress({ address, holderCount: 2 })).toEqual({
        certainty: SecurityConnectionCertainty.Possible,
        reason: SecurityConnectionReason.SharedAddress,
      });
    }
  });

  test("a local address, an address nobody holds or no address: nothing", () => {
    expect(matchAddress({ address: "127.0.0.1", holderCount: 1 })).toBeNull();
    expect(matchAddress({ address: "fe80::1", holderCount: 1 })).toBeNull();
    expect(matchAddress({ address: "203.0.113.7", holderCount: 0 })).toBeNull();
    expect(matchAddress({ address: "web-1", holderCount: 1 })).toBeNull();
  });

  test("a record's addresses: commas or spaces, each once in its one spelling, the local ones left out", () => {
    expect(
      readRecordAddresses(
        "10.0.0.5, 127.0.0.1 fe80::1,2001:DB8::7, 2001:db8:0:0:0:0:0:7,,  10.0.0.5",
      ),
    ).toEqual(["10.0.0.5", "2001:db8:0:0:0:0:0:7"]);
    expect(readRecordAddresses(["203.0.113.9", "not-an-address"])).toEqual([
      "203.0.113.9",
    ]);
    expect(readRecordAddresses(undefined)).toEqual([]);
  });

  test("recordReportsAddress: exact addresses only, whatever their spelling", () => {
    expect(recordReportsAddress("10.0.0.10", "10.0.0.1")).toBe(false);
    expect(recordReportsAddress("10.0.0.1, 10.0.0.10", "10.0.0.1")).toBe(true);
    expect(recordReportsAddress("2001:0db8::7", "2001:DB8:0:0:0:0:0:7")).toBe(
      true,
    );
    expect(recordReportsAddress("10.0.0.1", "nonsense")).toBe(false);
  });
});

describe("getSecurityConnectionLookups: what each entity is looked up as", () => {
  const entities: Array<SecurityEntity> = [
    { type: SecurityEntityType.Host, value: "WEB-1" },
    { type: SecurityEntityType.Domain, value: "db-1.acme.internal" },
    { type: SecurityEntityType.Other, value: "prod-eu" },
    { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    { type: SecurityEntityType.IpAddress, value: "127.0.0.1" },
    { type: SecurityEntityType.User, value: "K.Morgan@acme.example" },
    { type: SecurityEntityType.User, value: "root" },
    {
      type: SecurityEntityType.FileHash,
      value: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    { type: SecurityEntityType.Url, value: "https://evil.example/x" },
    { type: SecurityEntityType.Process, value: "powershell.exe -enc" },
    // The same host again, in another case: looked up once.
    { type: SecurityEntityType.Host, value: "web-1" },
  ];
  const lookups: SecurityConnectionLookups =
    getSecurityConnectionLookups(entities);

  test("names: hosts, domains and untyped values shaped like a name, folded, each once", () => {
    expect(lookups.hostNames).toEqual(["web-1", "db-1.acme.internal", "prod-eu"]);
    expect(lookups.hostNameEntities.get("web-1")).toEqual({
      type: SecurityEntityType.Host,
      value: "WEB-1",
    });
    expect(lookups.hostNameEntities.get("prod-eu")?.type).toBe(
      SecurityEntityType.Other,
    );
  });

  test("a full name is looked up as itself and its short form; a bare one as the full names it starts", () => {
    expect(lookups.hostNameQueryValues).toEqual([
      "web-1",
      "db-1.acme.internal",
      "db-1",
      "prod-eu",
    ]);
    expect(lookups.hostNamePrefixes).toEqual(["web-1", "prod-eu"]);
  });

  test("addresses in their one spelling, the local ones left out", () => {
    expect(lookups.addresses).toEqual(["203.0.113.7"]);
  });

  test("emails folded; a bare user name, a hash, a URL and a process are never looked up", () => {
    expect(lookups.emails).toEqual(["k.morgan@acme.example"]);
    expect(
      lookups.lookedUp.map((entity: SecurityEntity): string => {
        return entity.value;
      }),
    ).toEqual([
      "WEB-1",
      "db-1.acme.internal",
      "prod-eu",
      "203.0.113.7",
      "K.Morgan@acme.example",
    ]);
  });

  test("at most a case's worth of entities, and a few addresses", () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({
        type: SecurityEntityType.IpAddress,
        value: `203.0.113.${index}`,
      });
      many.push({ type: SecurityEntityType.Host, value: `host-${index}` });
    }

    const bounded: SecurityConnectionLookups =
      getSecurityConnectionLookups(many);

    expect(bounded.addresses.length).toBe(SECURITY_CONNECTION_MAX_ADDRESSES);
    expect(bounded.hostNames.length + bounded.addresses.length).toBeLessThanOrEqual(
      SECURITY_CONNECTION_MAX_ENTITIES,
    );
  });

  test("an entity that is not one (no value, no object) is skipped", () => {
    expect(
      getSecurityConnectionLookups([
        null as unknown as SecurityEntity,
        { type: SecurityEntityType.Host, value: 5 as unknown as string },
        { type: SecurityEntityType.Host, value: "  " },
      ]).lookedUp,
    ).toEqual([]);
  });
});

describe("ordering", () => {
  test("the best certainty: exact when any match is", () => {
    expect(
      getBestCertainty([
        SecurityConnectionCertainty.Possible,
        SecurityConnectionCertainty.Exact,
      ]),
    ).toBe(SecurityConnectionCertainty.Exact);
    expect(getBestCertainty([SecurityConnectionCertainty.Possible])).toBe(
      SecurityConnectionCertainty.Possible,
    );
    expect(getBestCertainty([])).toBe(SecurityConnectionCertainty.Possible);
  });

  test("exact first, then by kind, then by name", () => {
    const rows: Array<{
      certainty: SecurityConnectionCertainty;
      kind: SecurityConnectionKind;
      name: string;
    }> = [
      {
        certainty: SecurityConnectionCertainty.Possible,
        kind: SecurityConnectionKind.Host,
        name: "a",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.User,
        name: "kim",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.Host,
        name: "web-2",
      },
      {
        certainty: SecurityConnectionCertainty.Exact,
        kind: SecurityConnectionKind.Host,
        name: "web-1",
      },
    ];

    expect(
      [...rows].sort(compareConnectedResources).map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["web-1", "web-2", "kim", "a"]);
  });
});

describe("windows", () => {
  test("an event: half an hour either side", () => {
    const time: Date = minutes(NOW, -120);
    const window: SecurityConnectionWindow = getEventConnectionWindow(
      time,
      NOW,
    );

    expect(window.start).toEqual(
      minutes(time, -SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES),
    );
    expect(window.end).toEqual(
      minutes(time, SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES),
    );
  });

  test("an event of the last half hour ends now, never in the future", () => {
    const time: Date = minutes(NOW, -10);

    expect(getEventConnectionWindow(time, NOW).end).toEqual(NOW);
  });

  test("an event the clock calls future still ends no earlier than the event", () => {
    const time: Date = minutes(NOW, 5);

    expect(getEventConnectionWindow(time, NOW).end).toEqual(time);
  });

  test("a case: from before its first detection to after its last", () => {
    const window: SecurityConnectionWindow = getCaseConnectionWindow({
      firstDetectedAt: minutes(NOW, -300),
      lastDetectedAt: minutes(NOW, -120),
      now: NOW,
    });

    expect(window.start).toEqual(minutes(NOW, -330));
    expect(window.end).toEqual(minutes(NOW, -90));
  });

  test("a long case: its last day", () => {
    const last: Date = minutes(NOW, -60);
    const window: SecurityConnectionWindow = getCaseConnectionWindow({
      firstDetectedAt: "2026-09-01T00:00:00.000Z",
      lastDetectedAt: last.toISOString(),
      now: NOW,
    });

    expect(window.end).toEqual(minutes(last, 30));
    expect(window.end.getTime() - window.start.getTime()).toBe(
      SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS * 60 * 60 * 1000,
    );
  });

  test("a case nothing has joined is read around its opening, and one with no time around now", () => {
    const opened: Date = minutes(NOW, -600);

    expect(
      getCaseConnectionWindow({ createdAt: opened, now: NOW }),
    ).toEqual({ start: minutes(opened, -30), end: minutes(opened, 30) });
    expect(getCaseConnectionWindow({ now: NOW })).toEqual({
      start: minutes(NOW, -30),
      end: NOW,
    });
    expect(
      getCaseConnectionWindow({
        firstDetectedAt: "not a date",
        lastDetectedAt: "",
        now: NOW,
      }).end,
    ).toEqual(NOW);
  });
});

describe("readSecurityLogResource", () => {
  test("the record a log line was sent under, when the event names a real one", () => {
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          " 33333333-3333-4333-8333-333333333333 ",
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: "Host",
      }),
    ).toEqual({ type: "Host", id: "33333333-3333-4333-8333-333333333333" });
  });

  test("an event of another source, or one naming no real id, has none", () => {
    expect(readSecurityLogResource({})).toBeNull();
    expect(readSecurityLogResource(undefined)).toBeNull();
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: "project-1",
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: "Host",
      }),
    ).toBeNull();
    expect(
      readSecurityLogResource({
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          "33333333-3333-4333-8333-333333333333",
      }),
    ).toBeNull();
  });
});

describe("the way back: what a record is searched for by", () => {
  test("its names folded, each once, and its public addresses - never a private or local one", () => {
    expect(
      getRecordSecurityValues({
        names: ["WEB-1", "web-1", undefined, "  ", "Web 1"],
        addresses: "10.0.0.5, 127.0.0.1, 203.0.113.9, fe80::1, 2001:db8::9",
      }),
    ).toEqual(["web-1", "web 1", "203.0.113.9", "2001:db8:0:0:0:0:0:9"]);
  });

  test("a name too long to be anyone's is left out", () => {
    expect(getRecordSecurityValues({ names: ["a".repeat(300)] })).toEqual([]);
  });

  test("observables are searched in the usual spellings, each once, within a limit", () => {
    expect(getObservableSearchValues(["Web-1", "web-1", " "])).toEqual([
      "Web-1",
      "web-1",
      "WEB-1",
    ]);
    expect(
      getObservableSearchValues(["a", "b", "c"], 4),
    ).toEqual(["a", "A", "b", "B"]);
  });
});

/*
 * Outside text is read in time in line with its length: a value an attacker
 * writes (400,000 characters of the worst case each reading meets) is
 * answered in well under two seconds.
 */
describe("every rule reads outside text in linear time", () => {
  const worstCases: Array<string> = [
    "a.".repeat(200000),
    "a-".repeat(200000),
    "1.".repeat(200000),
    ":".repeat(400000),
    "f:".repeat(200000),
    "@a".repeat(200000),
    `${"a".repeat(399999)}@`,
    "%".repeat(400000),
  ];

  test.each(worstCases.map((value: string, index: number) => {
    return [index, value];
  }))("worst case %i", (_index: number, value: string) => {
    const started: number = Date.now();

    isHostNameLike(value);
    getShortHostName(value);
    canonicalAddress(value);
    getSecurityAddressScope(value);
    isEmailLike(value);
    matchHostName({ entityValue: value, resourceName: value });
    readRecordAddresses(value);
    getSecurityConnectionLookups([
      { type: SecurityEntityType.Host, value },
      { type: SecurityEntityType.User, value },
    ]);

    expect(Date.now() - started).toBeLessThan(2000);
  });
});
