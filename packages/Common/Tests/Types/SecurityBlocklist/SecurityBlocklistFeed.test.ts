import {
  SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS,
  SECURITY_BLOCKLIST_FEED_FAMILIES,
  SECURITY_BLOCKLIST_FEED_FIREWALLS,
  SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
  SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES,
  SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
  SECURITY_BLOCKLIST_FEED_STOPPED_READING_FLOOR_IN_MS,
  SecurityBlocklistFeedAllowlist,
  SecurityBlocklistFeedBlock,
  SecurityBlocklistFeedEntry,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
  SecurityBlocklistFeedStatus,
  filterProtectedSecurityBlocklistFeedEntries,
  getSecurityBlocklistFeedFamilyRefusal,
  getSecurityBlocklistFeedSecretHint,
  getSecurityBlocklistFeedStatus,
  getSecurityBlocklistFeedStoppedReadingAfterInMs,
  getSecurityBlocklistFeedUsualIntervalInMs,
  hasSecurityBlocklistFeedStoppedReading,
  isPreviousSecurityBlocklistFeedSecretInGrace,
  isSecurityBlocklistFeedFamily,
  isSecurityBlocklistFeedFirewall,
  isSecurityBlocklistFeedSecretShape,
  isSecurityBlocklistFeedSourceAllowed,
  readSecurityBlocklistFeedAllowlist,
  selectSecurityBlocklistFeedEntries,
  toSecurityBlocklistFeedComment,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { describe, expect, test } from "@jest/globals";

/*
 * What a blocklist feed serves, to whom, and whether its firewall still
 * reads it (#10345): the rules the server serves a feed by and the
 * Dashboard draws it by.
 */

const NOW: Date = new Date("2026-11-21T10:00:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

function at(offsetInMs: number): Date {
  return new Date(NOW.getTime() + offsetInMs);
}

function block(
  value: string,
  extra?: Partial<SecurityBlocklistFeedBlock>,
): SecurityBlocklistFeedBlock {
  return {
    value,
    action: SecurityBlockAction.Block,
    state: SecurityBlockState.Active,
    expiresAt: at(HOUR_IN_MS),
    comment: `OneUptime blocklist until 2026-11-21 11:00 UTC`,
    ...(extra || {}),
  };
}

function values(entries: Array<SecurityBlocklistFeedEntry>): Array<string> {
  return entries.map((entry: SecurityBlocklistFeedEntry): string => {
    return entry.value;
  });
}

function protection(value: string): SecurityAddressProtection {
  return {
    source: SecurityProtectedAddressSource.ProtectedEntity,
    protectedValue: value,
    name: "office",
  };
}

describe("the kinds a feed has", () => {
  test("a feed serves both families, IPv4 or IPv6, and nothing else", () => {
    expect(SECURITY_BLOCKLIST_FEED_FAMILIES).toEqual([
      SecurityBlocklistFeedFamily.Both,
      SecurityBlocklistFeedFamily.IPv4,
      SecurityBlocklistFeedFamily.IPv6,
    ]);
    expect(isSecurityBlocklistFeedFamily("IPv4")).toBe(true);
    expect(isSecurityBlocklistFeedFamily("ipv4")).toBe(false);
    expect(isSecurityBlocklistFeedFamily(undefined)).toBe(false);
  });

  test("every firewall has its maker's name, and Other is last", () => {
    for (const firewall of SECURITY_BLOCKLIST_FEED_FIREWALLS) {
      expect(isSecurityBlocklistFeedFirewall(firewall)).toBe(true);
      expect(SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES[firewall]).toBeTruthy();
    }

    expect(SECURITY_BLOCKLIST_FEED_FIREWALLS.at(-1)).toBe(
      SecurityBlocklistFeedFirewall.Other,
    );
    expect(isSecurityBlocklistFeedFirewall("Juniper")).toBe(false);
  });
});

describe("the secret", () => {
  const SECRET: string = "a".repeat(60) + "9e2b";

  test("a secret is 64 lower-case hex digits; anything else is no secret", () => {
    expect(isSecurityBlocklistFeedSecretShape(SECRET)).toBe(true);
    expect(isSecurityBlocklistFeedSecretShape(SECRET.toUpperCase())).toBe(
      false,
    );
    expect(isSecurityBlocklistFeedSecretShape(SECRET.slice(1))).toBe(false);
    expect(isSecurityBlocklistFeedSecretShape(`${SECRET}0`)).toBe(false);
    expect(isSecurityBlocklistFeedSecretShape(`${SECRET.slice(1)}g`)).toBe(
      false,
    );
    expect(isSecurityBlocklistFeedSecretShape(undefined)).toBe(false);
  });

  test("its hint is its last four characters", () => {
    expect(getSecurityBlocklistFeedSecretHint(SECRET)).toBe("9e2b");
  });

  test("the secret a rotation replaced works for a day, and not a moment longer", () => {
    expect(SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS).toBe(24 * HOUR_IN_MS);
    expect(
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: at(1),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: NOW,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: at(-1).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
    // Revoking clears it: no expiry is no grace.
    expect(
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: "not a date",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("the source allowlist", () => {
  test("addresses and ranges, one a line or separated by commas, are kept the way blocks are, each once", () => {
    const allowlist: SecurityBlocklistFeedAllowlist =
      readSecurityBlocklistFeedAllowlist(
        " 203.0.113.7\n198.51.100.77/24, 2001:DB8::1;203.0.113.7  2001:db8:0:0::1 ",
      );

    expect(allowlist.problem).toBeNull();
    expect(allowlist.entries).toEqual([
      "203.0.113.7",
      "198.51.100.0/24",
      "2001:db8::1",
    ]);
    expect(allowlist.blocks).toHaveLength(3);
  });

  test("empty is no allowlist", () => {
    for (const text of ["", "   \n ", null, undefined]) {
      expect(readSecurityBlocklistFeedAllowlist(text)).toEqual({
        entries: [],
        blocks: [],
        problem: null,
      });
    }
  });

  test("a value that is no address is refused, naming it", () => {
    const allowlist: SecurityBlocklistFeedAllowlist =
      readSecurityBlocklistFeedAllowlist("203.0.113.7\nfirewall.example.com");

    expect(allowlist.entries).toEqual([]);
    expect(allowlist.problem).toBe(
      SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS.notAnAddress(
        "firewall.example.com",
      ),
    );
    expect(allowlist.problem).toContain("firewall.example.com is not an IP");
  });

  test("more than the most a feed takes is refused", () => {
    const many: string = Array.from(
      { length: SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES + 1 },
      (_value: unknown, index: number): string => {
        return `203.0.113.${index}`;
      },
    ).join("\n");

    expect(readSecurityBlocklistFeedAllowlist(many).problem).toBe(
      SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS.tooMany,
    );

    const enough: string = many.split("\n").slice(1).join("\n");

    expect(readSecurityBlocklistFeedAllowlist(enough).entries).toHaveLength(
      SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES,
    );
  });

  test("with no allowlist any address may read; with one, only the addresses it holds", () => {
    expect(
      isSecurityBlocklistFeedSourceAllowed({
        allowlist: [],
        clientIp: "192.0.2.50",
      }),
    ).toBe(true);
    expect(
      isSecurityBlocklistFeedSourceAllowed({ allowlist: [], clientIp: null }),
    ).toBe(true);

    const allowlist: SecurityBlocklistFeedAllowlist =
      readSecurityBlocklistFeedAllowlist("198.51.100.0/24\n2001:db8:5::/48");

    for (const clientIp of [
      "198.51.100.1",
      "198.51.100.255",
      // An IPv4 address an IPv6 one maps is that IPv4 address.
      "::ffff:198.51.100.9",
      "2001:db8:5::1",
      "2001:DB8:5:ffff::1",
    ]) {
      expect(
        isSecurityBlocklistFeedSourceAllowed({
          allowlist: allowlist.blocks,
          clientIp,
        }),
      ).toBe(true);
    }

    for (const clientIp of [
      "198.51.101.1",
      "2001:db8:6::1",
      // An address that cannot be read is not known to be on the list.
      "",
      "unknown",
      null,
    ]) {
      expect(
        isSecurityBlocklistFeedSourceAllowed({
          allowlist: allowlist.blocks,
          clientIp,
        }),
      ).toBe(false);
    }
  });
});

describe("what a feed serves", () => {
  test("every active block that blocks, in address order, IPv4 before IPv6, each value once", () => {
    const entries: Array<SecurityBlocklistFeedEntry> =
      selectSecurityBlocklistFeedEntries({
        blocks: [
          block("2001:db8::7"),
          block("35.205.11.131"),
          block("9.9.9.9"),
          block("35.205.11.0/24"),
          block("100.64.0.1"),
          block("35.205.11.131"),
          block("2001:db8::/48"),
        ],
        family: SecurityBlocklistFeedFamily.Both,
        now: NOW,
      });

    // Numerically: 9.9.9.9 before 35..., a range before the addresses it holds.
    expect(values(entries)).toEqual([
      "9.9.9.9",
      "35.205.11.0/24",
      "35.205.11.131",
      "100.64.0.1",
      "2001:db8::/48",
      "2001:db8::7",
    ]);
    expect(entries[0]!.family).toBe(4);
    expect(entries[4]!.family).toBe(6);
  });

  test("an expired or lifted block is gone at once, even one past its end that the expiry worker has not marked yet", () => {
    const entries: Array<SecurityBlocklistFeedEntry> =
      selectSecurityBlocklistFeedEntries({
        blocks: [
          block("203.0.113.1"),
          block("203.0.113.2", { state: SecurityBlockState.Lifted }),
          block("203.0.113.3", { state: SecurityBlockState.Expired }),
          // Active, but its end has come.
          block("203.0.113.4", { expiresAt: NOW }),
          block("203.0.113.5", { expiresAt: at(-1).toISOString() }),
          // Kept until someone lifts it.
          block("203.0.113.6", { expiresAt: null }),
        ],
        family: SecurityBlocklistFeedFamily.Both,
        now: NOW,
      });

    expect(values(entries)).toEqual(["203.0.113.1", "203.0.113.6"]);
  });

  test("a challenge is never served: a firewall cannot challenge", () => {
    expect(
      values(
        selectSecurityBlocklistFeedEntries({
          blocks: [
            block("203.0.113.1", { action: SecurityBlockAction.Challenge }),
            block("203.0.113.2"),
          ],
          family: SecurityBlocklistFeedFamily.Both,
          now: NOW,
        }),
      ),
    ).toEqual(["203.0.113.2"]);
  });

  test("a feed of one family serves that family alone", () => {
    const blocks: Array<SecurityBlocklistFeedBlock> = [
      block("203.0.113.1"),
      block("2001:db8::1"),
    ];

    expect(
      values(
        selectSecurityBlocklistFeedEntries({
          blocks,
          family: SecurityBlocklistFeedFamily.IPv4,
          now: NOW,
        }),
      ),
    ).toEqual(["203.0.113.1"]);
    expect(
      values(
        selectSecurityBlocklistFeedEntries({
          blocks,
          family: SecurityBlocklistFeedFamily.IPv6,
          now: NOW,
        }),
      ),
    ).toEqual(["2001:db8::1"]);
  });

  test("a value that is no address is never served", () => {
    expect(
      selectSecurityBlocklistFeedEntries({
        blocks: [block("evil.example.com"), block(""), block("1.2.3.4/40")],
        family: SecurityBlocklistFeedFamily.Both,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("an entry's comment is one line of printable text", () => {
    expect(
      toSecurityBlocklistFeedComment(
        "OneUptime case CASE-1\nuntil\r\n2026 later\u0000",
      ),
    ).toBe("OneUptime case CASE-1 until 2026 later");
    expect(toSecurityBlocklistFeedComment("x".repeat(500))).toHaveLength(200);

    const [entry] = selectSecurityBlocklistFeedEntries({
      blocks: [block("203.0.113.1", { comment: "a\nb" })],
      family: SecurityBlocklistFeedFamily.Both,
      now: NOW,
    });

    expect(entry!.comment).toBe("a b");
  });

  test("a feed of one family says why it cannot hold the other", () => {
    expect(
      getSecurityBlocklistFeedFamilyRefusal({
        feedName: "Check Point feed",
        family: SecurityBlocklistFeedFamily.IPv4,
        value: "2001:db8::1",
      }),
    ).toBe("Check Point feed serves IPv4 only");
    expect(
      getSecurityBlocklistFeedFamilyRefusal({
        feedName: "v6 feed",
        family: SecurityBlocklistFeedFamily.IPv6,
        value: "203.0.113.1",
      }),
    ).toBe("v6 feed serves IPv6 only");
    expect(
      getSecurityBlocklistFeedFamilyRefusal({
        feedName: "Feed",
        family: SecurityBlocklistFeedFamily.Both,
        value: "203.0.113.1",
      }),
    ).toBeNull();
    expect(
      getSecurityBlocklistFeedFamilyRefusal({
        feedName: "Feed",
        family: SecurityBlocklistFeedFamily.Both,
        value: "evil.example.com",
      }),
    ).toBe("Feed serves IP addresses and ranges only");
  });
});

describe("protected addresses are never served", () => {
  const entries: Array<SecurityBlocklistFeedEntry> =
    selectSecurityBlocklistFeedEntries({
      blocks: [
        block("203.0.113.7"),
        block("198.51.100.0/24"),
        block("192.0.2.9"),
        block("8.8.8.8"),
        block("2001:db8:1::1"),
        block("2001:db8:2::/48"),
      ],
      family: SecurityBlocklistFeedFamily.Both,
      now: NOW,
    });

  test("an address protected itself, a range holding a protected address, and an address in a protected range are held back", () => {
    const filtered: {
      served: Array<SecurityBlocklistFeedEntry>;
      withheld: Array<{
        entry: SecurityBlocklistFeedEntry;
        protection: SecurityAddressProtection;
      }>;
    } = filterProtectedSecurityBlocklistFeedEntries({
      entries,
      protections: [
        protection("203.0.113.7"),
        // A host inside the blocked range.
        protection("198.51.100.20"),
        // A protected range holding a blocked address.
        protection("192.0.2.0/24"),
        protection("2001:db8:1::/64"),
        protection("2001:db8:2:5::9"),
      ],
    });

    expect(values(filtered.served)).toEqual(["8.8.8.8"]);
    expect(
      filtered.withheld.map((withheld: { entry: SecurityBlocklistFeedEntry; protection: SecurityAddressProtection }): [string, string] => {
        return [withheld.entry.value, withheld.protection.protectedValue];
      }),
    ).toEqual([
      ["192.0.2.9", "192.0.2.0/24"],
      ["198.51.100.0/24", "198.51.100.20"],
      ["203.0.113.7", "203.0.113.7"],
      ["2001:db8:1::1", "2001:db8:1::/64"],
      ["2001:db8:2::/48", "2001:db8:2:5::9"],
    ]);
  });

  test("protections of other addresses, of the other family, or that cannot be read hold nothing back", () => {
    const filtered: {
      served: Array<SecurityBlocklistFeedEntry>;
    } = filterProtectedSecurityBlocklistFeedEntries({
      entries,
      protections: [
        protection("203.0.113.8"),
        protection("198.51.101.0/24"),
        protection("::ffff:8.8.4.4"),
        protection("not an address"),
        protection("2001:db8:3::/48"),
      ],
    });

    expect(values(filtered.served)).toEqual(values(entries));
  });

  test("thousands of entries are held to thousands of protected addresses", () => {
    const many: Array<SecurityBlocklistFeedEntry> =
      selectSecurityBlocklistFeedEntries({
        blocks: Array.from(
          { length: 5000 },
          (_value: unknown, index: number): SecurityBlocklistFeedBlock => {
            return block(`10.${Math.floor(index / 250)}.${index % 250}.1`);
          },
        ),
        family: SecurityBlocklistFeedFamily.Both,
        now: NOW,
      });

    const protections: Array<SecurityAddressProtection> = Array.from(
      { length: 5000 },
      (_value: unknown, index: number): SecurityAddressProtection => {
        return protection(`10.${Math.floor(index / 250)}.${index % 250}.2`);
      },
    );

    protections.push(protection("10.3.7.1"));

    const filtered: { served: Array<SecurityBlocklistFeedEntry> } =
      filterProtectedSecurityBlocklistFeedEntries({
        entries: many,
        protections,
      });

    expect(filtered.served).toHaveLength(4999);
    expect(values(filtered.served)).not.toContain("10.3.7.1");
  });
});

describe("whether the firewall still reads the feed", () => {
  test("its usual interval is the median gap between its latest fetches", () => {
    expect(
      getSecurityBlocklistFeedUsualIntervalInMs([
        at(0),
        at(-5 * MINUTE_IN_MS),
        at(-10 * MINUTE_IN_MS),
        // One slow poll does not move it.
        at(-45 * MINUTE_IN_MS),
        at(-50 * MINUTE_IN_MS),
      ]),
    ).toBe(5 * MINUTE_IN_MS);

    // An even number of gaps: the middle two, halved.
    expect(
      getSecurityBlocklistFeedUsualIntervalInMs([
        at(0),
        at(-4 * MINUTE_IN_MS),
        at(-10 * MINUTE_IN_MS),
      ]),
    ).toBe(5 * MINUTE_IN_MS);
  });

  test("fetches in the same poll - the list and its MD5, a retry - say nothing of the interval", () => {
    expect(
      getSecurityBlocklistFeedUsualIntervalInMs([
        at(0),
        at(-2000),
        at(-HOUR_IN_MS),
        at(-HOUR_IN_MS - 3000),
        at(-2 * HOUR_IN_MS),
      ]),
    ).toBe(HOUR_IN_MS);
  });

  test("fewer than two polls have no interval", () => {
    expect(getSecurityBlocklistFeedUsualIntervalInMs([])).toBeNull();
    expect(getSecurityBlocklistFeedUsualIntervalInMs([at(0)])).toBeNull();
    expect(
      getSecurityBlocklistFeedUsualIntervalInMs([at(0), at(-5000)]),
    ).toBeNull();
  });

  test("it stopped after three usual intervals, and never before a block's confirmation runs out", () => {
    expect(SECURITY_BLOCKLIST_FEED_STOPPED_READING_FLOOR_IN_MS).toBe(
      SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS,
    );
    expect(getSecurityBlocklistFeedStoppedReadingAfterInMs(HOUR_IN_MS)).toBe(
      3 * HOUR_IN_MS,
    );
    expect(getSecurityBlocklistFeedStoppedReadingAfterInMs(MINUTE_IN_MS)).toBe(
      10 * MINUTE_IN_MS,
    );
    expect(getSecurityBlocklistFeedStoppedReadingAfterInMs(null)).toBe(
      10 * MINUTE_IN_MS,
    );

    // An hourly firewall: 3 hours.
    expect(
      hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: at(-3 * HOUR_IN_MS),
        usualIntervalInMs: HOUR_IN_MS,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: at(-3 * HOUR_IN_MS - 1),
        usualIntervalInMs: HOUR_IN_MS,
        now: NOW,
      }),
    ).toBe(true);

    // A firewall every minute: ten minutes, not three.
    expect(
      hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: at(-9 * MINUTE_IN_MS),
        usualIntervalInMs: MINUTE_IN_MS,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: at(-11 * MINUTE_IN_MS).toISOString(),
        usualIntervalInMs: MINUTE_IN_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a feed never fetched has not stopped: it was never set up", () => {
    expect(
      hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: null,
        usualIntervalInMs: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a feed's status: revoked, not set up, reading or stopped", () => {
    expect(
      getSecurityBlocklistFeedStatus({
        hasSecret: false,
        lastFetchedAt: at(-MINUTE_IN_MS),
        usualIntervalInMs: MINUTE_IN_MS,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedStatus.Revoked);
    expect(
      getSecurityBlocklistFeedStatus({
        hasSecret: true,
        lastFetchedAt: null,
        usualIntervalInMs: null,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedStatus.NotSetUp);
    expect(
      getSecurityBlocklistFeedStatus({
        hasSecret: true,
        lastFetchedAt: at(-MINUTE_IN_MS),
        usualIntervalInMs: MINUTE_IN_MS,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedStatus.Reading);
    expect(
      getSecurityBlocklistFeedStatus({
        hasSecret: true,
        lastFetchedAt: at(-HOUR_IN_MS),
        usualIntervalInMs: MINUTE_IN_MS,
        now: NOW,
      }),
    ).toBe(SecurityBlocklistFeedStatus.StoppedReading);
  });
});
