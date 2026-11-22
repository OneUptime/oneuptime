import {
  SECURITY_BLOCK_ACTIONS,
  SECURITY_BLOCK_ADDRESS_TYPES,
  SECURITY_BLOCK_DURATION_IN_MS,
  SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS,
  SECURITY_BLOCK_FILE_TYPES,
  SECURITY_BLOCK_INDICATOR_TYPES,
  SECURITY_BLOCK_LARGEST_IPV4_PREFIX,
  SECURITY_BLOCK_LARGEST_IPV6_PREFIX,
  SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS,
  SECURITY_BLOCK_MESSAGES,
  SECURITY_BLOCK_REACHES,
  SECURITY_BLOCK_SENTENCES,
  SECURITY_BLOCK_VALUE_MAX_LENGTH,
  SECURITY_BLOCK_WIDEST_IPV4_PREFIX,
  SECURITY_BLOCK_WIDEST_IPV6_PREFIX,
  SecurityBlockAction,
  SecurityBlockCandidate,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  SecurityBlockSentence,
  SecurityBlockState,
  SecurityBlockValue,
  describeSecurityBlockLength,
  doesSecurityBlockReachCover,
  fillSecurityBlockSentence,
  findCoveringSecurityBlock,
  getSecurityBlockActionProblem,
  getSecurityBlockAlreadyBlockedSentence,
  getSecurityBlockCheckFailedSentence,
  getSecurityBlockExpiry,
  getSecurityBlockExpiryProblem,
  getSecurityBlockFileType,
  getSecurityBlockReach,
  getSecurityBlockValueKey,
  getSecurityBlockValueProblem,
  getSecurityBlockValueSentence,
  isSecurityBlockAddressType,
  isSecurityBlockFileType,
  isSecurityBlockInForce,
  isSecurityBlockIndicatorType,
  isSecurityBlockReach,
  isWiderThanLargestRange,
  readSecurityBlockIndicator,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockHashKind } from "../../../Types/SecurityBlocklist/SecurityBlockIndicator";
import { describe, expect, test } from "@jest/globals";

/*
 * The blocklist's rules for a value (#10338): one way of writing it however
 * it was typed - so two spellings of one address are one block, and a range
 * covers what it says - how wide a range anyone may block, when a block
 * ends, and which active block already covers a value. The Dashboard checks
 * what is typed with these, and the server what is saved.
 */

const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;

// A value that must read; the test fails on one that does not.
function read(text: string): SecurityBlockValue {
  const value: SecurityBlockValue | null = readSecurityBlockValue(text);

  if (!value) {
    throw new Error(`${text} did not read as a block's value`);
  }

  return value;
}

describe("readSecurityBlockValue", () => {
  test("an IPv4 address is one address, dotted, white space forgiven", () => {
    expect(readSecurityBlockValue(" 35.205.11.131 ")).toMatchObject({
      indicatorType: SecurityBlockIndicatorType.IpAddress,
      value: "35.205.11.131",
    });
  });

  test("an IPv6 address is compressed in lowercase, however it was typed", () => {
    expect(read("2001:DB8:0:0:0:0:0:7").value).toBe("2001:db8::7");
    expect(read("2001:0db8:0000:0000:0000:0000:0000:0007").value).toBe(
      "2001:db8::7",
    );
    expect(read("2001:db8::7").value).toBe("2001:db8::7");
    expect(read("2001:DB8::7").indicatorType).toBe(
      SecurityBlockIndicatorType.IpAddress,
    );
  });

  test("an IPv4 address an IPv6 one maps is that IPv4 address", () => {
    expect(read("::ffff:35.205.11.131").value).toBe("35.205.11.131");
    expect(read("::FFFF:35.205.11.131").block.family).toBe(4);
  });

  test("a range is kept as its first address and its length", () => {
    const range: SecurityBlockValue = read("35.205.11.77/24");

    expect(range.value).toBe("35.205.11.0/24");
    expect(range.indicatorType).toBe(SecurityBlockIndicatorType.IpRange);
    expect(range.block.prefixLength).toBe(24);
    expect(read("2001:DB8:0:1::5/48").value).toBe("2001:db8::/48");
    expect(read("2001:db8:1::/56").indicatorType).toBe(
      SecurityBlockIndicatorType.IpRange,
    );
  });

  test("a /32 or a /128 is the bare address it is", () => {
    expect(read("35.205.11.131/32")).toMatchObject({
      value: "35.205.11.131",
      indicatorType: SecurityBlockIndicatorType.IpAddress,
    });
    expect(read("2001:db8::7/128")).toMatchObject({
      value: "2001:db8::7",
      indicatorType: SecurityBlockIndicatorType.IpAddress,
    });
  });

  test("anything that is no address or range is null", () => {
    for (const text of [
      "",
      "   ",
      "not-an-address",
      "evil.example.com",
      "35.205.11",
      "35.205.11.256",
      "35.205.11.0/33",
      "2001:db8::/129",
      "35.205.11.0/24/8",
      "fe80::1%eth0",
      "35.205.11.131:443",
    ]) {
      expect(readSecurityBlockValue(text)).toBeNull();
    }

    expect(readSecurityBlockValue(undefined)).toBeNull();
    expect(readSecurityBlockValue(42)).toBeNull();
  });
});

describe("getSecurityBlockValueSentence", () => {
  test("an empty value asks for one, of any kind a block takes (#10346)", () => {
    expect(
      getSecurityBlockValueSentence({ value: "  ", mayBlockWideRanges: false }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.enterValue, values: {} });
    expect(
      getSecurityBlockValueSentence({ value: 7, mayBlockWideRanges: false }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.enterValue, values: {} });
  });

  test("a value that is none of them says how each is written", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "not a value",
        mayBlockWideRanges: true,
      }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.notAValue, values: {} });
    // A page of text is not a value, however it reads.
    expect(
      getSecurityBlockValueSentence({
        value: "1".repeat(SECURITY_BLOCK_VALUE_MAX_LENGTH * 2 + 1),
        mayBlockWideRanges: true,
      }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.notAValue, values: {} });
  });

  test("a domain, a URL and a file's hash are values a block takes (#10346)", () => {
    for (const value of [
      "evil.example.com",
      "https://evil.example/login",
      "44d88612fea8a8f36de82e1278abb02f",
      "3395856ce81f2b7382dee72602f798b642f14140",
      "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
    ]) {
      expect(
        getSecurityBlockValueSentence({ value, mayBlockWideRanges: false }),
      ).toBeNull();
    }
  });

  test("a wildcard, a SHA-512 digest, a URL too long or of another scheme each say why (#10346)", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "*.evil.example",
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.wildcardDomain,
      values: {},
    });
    expect(
      getSecurityBlockValueSentence({
        value: "ab".repeat(64),
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.unsupportedHash,
      values: {},
    });
    expect(
      getSecurityBlockValueSentence({
        value: `https://evil.example/${"a".repeat(SECURITY_BLOCK_VALUE_MAX_LENGTH)}`,
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.urlTooLong,
      values: { max: String(SECURITY_BLOCK_VALUE_MAX_LENGTH) },
    });
    expect(
      getSecurityBlockValueSentence({
        value: "ftp://evil.example/payload",
        mayBlockWideRanges: false,
      }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.urlScheme, values: {} });
  });

  test("nobody blocks wider than a /8 of IPv4 or a /16 of IPv6", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "34.0.0.0/7",
        mayBlockWideRanges: true,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.widerThanAnyone,
      values: {
        value: "34.0.0.0/7",
        widest: `/${SECURITY_BLOCK_WIDEST_IPV4_PREFIX}`,
      },
    });
    expect(
      getSecurityBlockValueSentence({
        value: "0.0.0.0/0",
        mayBlockWideRanges: true,
      })?.template,
    ).toBe(SECURITY_BLOCK_SENTENCES.widerThanAnyone);
    expect(
      getSecurityBlockValueSentence({
        value: "2001::/15",
        mayBlockWideRanges: true,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.widerThanAnyone,
      values: {
        value: "2000::/15",
        widest: `/${SECURITY_BLOCK_WIDEST_IPV6_PREFIX}`,
      },
    });
  });

  test("a range wider than a /24 or a /48 takes someone who may block one", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "35.205.0.0/16",
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.tooWide,
      values: {
        value: "35.205.0.0/16",
        largest: `/${SECURITY_BLOCK_LARGEST_IPV4_PREFIX}`,
      },
    });
    expect(
      getSecurityBlockValueSentence({
        value: "2001:db8::/47",
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.tooWide,
      values: {
        value: "2001:db8::/47",
        largest: `/${SECURITY_BLOCK_LARGEST_IPV6_PREFIX}`,
      },
    });

    // A Security Admin, a Project Admin or a Project Owner may, down to the widest.
    expect(
      getSecurityBlockValueSentence({
        value: "35.205.0.0/16",
        mayBlockWideRanges: true,
      }),
    ).toBeNull();
    expect(
      getSecurityBlockValueSentence({
        value: "35.0.0.0/8",
        mayBlockWideRanges: true,
      }),
    ).toBeNull();
    expect(
      getSecurityBlockValueSentence({
        value: "2001::/16",
        mayBlockWideRanges: true,
      }),
    ).toBeNull();
  });

  test("a /24, a /48 and anything narrower is anyone's to block", () => {
    for (const value of [
      "35.205.11.0/24",
      "35.205.11.128/25",
      "35.205.11.131",
      "2001:db8:1::/48",
      "2001:db8:1:2::/64",
      "2001:db8::7",
    ]) {
      expect(
        getSecurityBlockValueSentence({ value, mayBlockWideRanges: false }),
      ).toBeNull();
    }
  });

  test("the server's problem is the same sentence, filled in English", () => {
    expect(
      getSecurityBlockValueProblem({
        value: "35.205.0.0/16",
        mayBlockWideRanges: false,
      }),
    ).toBe(
      "35.205.0.0/16 is wider than a /24, which would block whole networks. Block single addresses or a narrower range, or ask a Security Admin to block it.",
    );
    expect(
      getSecurityBlockValueProblem({
        value: "35.205.11.0/24",
        mayBlockWideRanges: false,
      }),
    ).toBeNull();
    expect(
      getSecurityBlockValueProblem({ value: "", mayBlockWideRanges: false }),
    ).toBe(SECURITY_BLOCK_MESSAGES.enterValue);
  });

  test("how wide is wider than the largest range, for each family", () => {
    expect(isWiderThanLargestRange(read("35.205.11.0/24").block)).toBe(false);
    expect(isWiderThanLargestRange(read("35.205.10.0/23").block)).toBe(true);
    expect(isWiderThanLargestRange(read("2001:db8::/48").block)).toBe(false);
    expect(isWiderThanLargestRange(read("2001:db8::/47").block)).toBe(true);
  });
});

describe("findCoveringSecurityBlock", () => {
  const blocks: Array<SecurityBlockCandidate> = [
    { value: "35.205.0.0/16" },
    { value: "35.205.11.0/24" },
    { value: "203.0.113.7" },
    { value: "2001:db8::/48" },
    { value: "not an address" },
  ];

  test("a block of the same value covers it, however the value was typed", () => {
    expect(findCoveringSecurityBlock(read("203.0.113.7/32"), blocks)).toEqual({
      value: "203.0.113.7",
    });
    expect(findCoveringSecurityBlock(read("35.205.11.9/24"), blocks)).toEqual({
      value: "35.205.11.0/24",
    });
  });

  test("an address inside an active range is covered, by the narrowest range", () => {
    expect(findCoveringSecurityBlock(read("35.205.11.131"), blocks)).toEqual({
      value: "35.205.11.0/24",
    });
    expect(findCoveringSecurityBlock(read("35.205.40.1"), blocks)).toEqual({
      value: "35.205.0.0/16",
    });
    expect(findCoveringSecurityBlock(read("35.205.11.128/25"), blocks)).toEqual(
      { value: "35.205.11.0/24" },
    );
    expect(findCoveringSecurityBlock(read("2001:db8::99"), blocks)).toEqual({
      value: "2001:db8::/48",
    });
  });

  test("a wider range is not covered by a narrower one", () => {
    expect(findCoveringSecurityBlock(read("35.204.0.0/15"), blocks)).toBeNull();
  });

  test("an IPv4 value is never covered by an IPv6 range, nor the other way", () => {
    expect(
      findCoveringSecurityBlock(read("2001:db9::1"), [
        { value: "35.205.0.0/16" },
      ]),
    ).toBeNull();
    expect(
      findCoveringSecurityBlock(read("35.205.11.131"), [
        { value: "::/16" },
        { value: "2001:db8::/48" },
      ]),
    ).toBeNull();
  });

  test("nothing covers an address no block holds", () => {
    expect(findCoveringSecurityBlock(read("198.51.100.4"), blocks)).toBeNull();
    expect(findCoveringSecurityBlock(read("198.51.100.4"), [])).toBeNull();
  });
});

describe("isSecurityBlockInForce", () => {
  test("an active block is in force until its expiry, and one with none until lifted", () => {
    expect(
      isSecurityBlockInForce(
        {
          state: SecurityBlockState.Active,
          expiresAt: new Date(NOW.getTime() + HOUR_IN_MS),
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      isSecurityBlockInForce(
        { state: SecurityBlockState.Active, expiresAt: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      isSecurityBlockInForce(
        {
          state: SecurityBlockState.Active,
          expiresAt: new Date(NOW.getTime() + HOUR_IN_MS).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
  });

  test("a block past its expiry is ended, even before the expiry worker marks it", () => {
    expect(
      isSecurityBlockInForce(
        {
          state: SecurityBlockState.Active,
          expiresAt: new Date(NOW.getTime() - 1),
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isSecurityBlockInForce(
        { state: SecurityBlockState.Active, expiresAt: NOW },
        NOW,
      ),
    ).toBe(false);
  });

  test("a lifted or expired block is never in force", () => {
    expect(
      isSecurityBlockInForce(
        { state: SecurityBlockState.Lifted, expiresAt: null },
        NOW,
      ),
    ).toBe(false);
    expect(
      isSecurityBlockInForce(
        {
          state: SecurityBlockState.Expired,
          expiresAt: new Date(NOW.getTime() + HOUR_IN_MS),
        },
        NOW,
      ),
    ).toBe(false);
    expect(isSecurityBlockInForce({}, NOW)).toBe(false);
  });
});

describe("how long a block lasts", () => {
  test("each length ends that long from when the block is made", () => {
    expect(
      getSecurityBlockExpiry(SecurityBlockDuration.OneHour, NOW)?.toISOString(),
    ).toBe("2026-11-20T11:00:00.000Z");
    expect(
      getSecurityBlockExpiry(SecurityBlockDuration.OneDay, NOW)?.toISOString(),
    ).toBe("2026-11-21T10:00:00.000Z");
    expect(
      getSecurityBlockExpiry(
        SecurityBlockDuration.SevenDays,
        NOW,
      )?.toISOString(),
    ).toBe("2026-11-27T10:00:00.000Z");
    expect(
      getSecurityBlockExpiry(
        SecurityBlockDuration.ThirtyDays,
        NOW,
      )?.toISOString(),
    ).toBe("2026-12-20T10:00:00.000Z");
    expect(
      getSecurityBlockExpiry(SecurityBlockDuration.UntilLifted, NOW),
    ).toBeNull();
  });

  test("an expiry in the past is refused, beyond a browser's clock running a little behind", () => {
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date(
          NOW.getTime() - SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS,
        ),
        now: NOW,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.expiryInThePast);
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date(
          NOW.getTime() - SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS + 1000,
        ),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date("not a date"),
        now: NOW,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.expiryInThePast);
  });

  test("a block that expires lasts a year at most", () => {
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date(
          NOW.getTime() + SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS,
        ),
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date(
          NOW.getTime() + SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS + 1,
        ),
        now: NOW,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.expiryTooFar);
    expect(
      getSecurityBlockExpiryProblem({
        expiresAt: new Date(
          NOW.getTime() +
            SECURITY_BLOCK_DURATION_IN_MS[SecurityBlockDuration.ThirtyDays],
        ),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("the length a block was made for, as its expiry is said", () => {
    expect(
      describeSecurityBlockLength({
        from: NOW,
        until: new Date(NOW.getTime() + HOUR_IN_MS),
      }),
    ).toBe("1 hour");
    expect(
      describeSecurityBlockLength({
        from: NOW,
        until: new Date(NOW.getTime() + 24 * HOUR_IN_MS),
      }),
    ).toBe("24 hours");
    expect(
      describeSecurityBlockLength({
        from: NOW,
        until: new Date(NOW.getTime() + 7 * 24 * HOUR_IN_MS),
      }),
    ).toBe("7 days");
    expect(
      describeSecurityBlockLength({
        from: NOW,
        until: new Date(NOW.getTime() + 30 * 24 * HOUR_IN_MS),
      }),
    ).toBe("30 days");
    expect(describeSecurityBlockLength({ from: NOW, until: null })).toBeNull();
    expect(
      describeSecurityBlockLength({ from: NOW, until: undefined }),
    ).toBeNull();
    expect(describeSecurityBlockLength({ from: NOW, until: NOW })).toBe(
      "a moment",
    );
  });
});

describe("the blocklist's sentences", () => {
  test("a sentence is filled with every one of its values, wherever they stand", () => {
    expect(
      fillSecurityBlockSentence({
        template: "{{value}} is {{value}}, {{by}} covers it.",
        values: { value: "35.205.11.131", by: "35.205.11.0/24" },
      }),
    ).toBe("35.205.11.131 is 35.205.11.131, 35.205.11.0/24 covers it.");
    expect(
      fillSecurityBlockSentence({ template: "Nothing to fill.", values: {} }),
    ).toBe("Nothing to fill.");
  });

  test("already blocked names the range that covers it, and only when it is another", () => {
    expect(
      getSecurityBlockAlreadyBlockedSentence({
        value: "35.205.11.131",
        by: "35.205.11.131",
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.alreadyBlocked,
      values: { value: "35.205.11.131" },
    });
    expect(
      getSecurityBlockAlreadyBlockedSentence({
        value: "35.205.11.131",
        by: "35.205.11.0/24",
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.alreadyBlockedBy,
      values: { value: "35.205.11.131", by: "35.205.11.0/24" },
    });
  });

  test("every sentence the Dashboard says is the message the server says, filled in English", () => {
    const values: Record<string, string> = {
      value: "35.205.11.131",
      by: "35.205.11.0/24",
      largest: "/24",
      widest: "/8",
      max: "500",
    };

    // Each template and the message the server fills it as: a new template needs its message.
    const messages: Record<keyof typeof SECURITY_BLOCK_SENTENCES, string> = {
      enterAddress: SECURITY_BLOCK_MESSAGES.enterAddress,
      notAnAddress: SECURITY_BLOCK_MESSAGES.notAnAddress,
      enterValue: SECURITY_BLOCK_MESSAGES.enterValue,
      notAValue: SECURITY_BLOCK_MESSAGES.notAValue,
      wildcardDomain: SECURITY_BLOCK_MESSAGES.wildcardDomain,
      unsupportedHash: SECURITY_BLOCK_MESSAGES.unsupportedHash,
      urlTooLong: SECURITY_BLOCK_MESSAGES.urlTooLong({ max: "500" }),
      urlScheme: SECURITY_BLOCK_MESSAGES.urlScheme,
      checkFailedValue: SECURITY_BLOCK_MESSAGES.checkFailedValue({
        value: "35.205.11.131",
      }),
      tooWide: SECURITY_BLOCK_MESSAGES.tooWide({
        value: "35.205.11.131",
        largest: "/24",
      }),
      widerThanAnyone: SECURITY_BLOCK_MESSAGES.widerThanAnyone({
        value: "35.205.11.131",
        widest: "/8",
      }),
      alreadyBlocked: SECURITY_BLOCK_MESSAGES.alreadyBlocked({
        value: "35.205.11.131",
        by: "35.205.11.131",
      }),
      alreadyBlockedBy: SECURITY_BLOCK_MESSAGES.alreadyBlocked({
        value: "35.205.11.131",
        by: "35.205.11.0/24",
      }),
      checkFailed: SECURITY_BLOCK_MESSAGES.checkFailed({
        value: "35.205.11.131",
      }),
    };

    expect(Object.keys(messages).sort()).toEqual(
      Object.keys(SECURITY_BLOCK_SENTENCES).sort(),
    );

    for (const [key, template] of Object.entries(SECURITY_BLOCK_SENTENCES)) {
      const sentence: SecurityBlockSentence = { template, values };

      expect(messages[key as keyof typeof SECURITY_BLOCK_SENTENCES]).toBe(
        fillSecurityBlockSentence(sentence),
      );
    }

    expect(messages.alreadyBlockedBy).toBe(
      "35.205.11.131 is already blocked: 35.205.11.0/24 covers it.",
    );
    expect(messages.alreadyBlocked).toBe("35.205.11.131 is already blocked.");
  });

  test("every sentence is one, and leaves no placeholder the values do not fill", () => {
    for (const template of Object.values(SECURITY_BLOCK_SENTENCES)) {
      expect(template.trim().endsWith(".")).toBe(true);
      expect(template.charAt(0)).toMatch(/[A-Z{]/);
    }

    expect(
      SECURITY_BLOCK_MESSAGES.tooWide({ value: "a", largest: "b" }),
    ).not.toContain("{{");
    expect(
      SECURITY_BLOCK_MESSAGES.widerThanAnyone({ value: "a", widest: "b" }),
    ).not.toContain("{{");
    expect(SECURITY_BLOCK_MESSAGES.checkFailed({ value: "a" })).not.toContain(
      "{{",
    );
  });

  test("an ended block says how it ended", () => {
    expect(
      SECURITY_BLOCK_MESSAGES.notActive({
        value: "35.205.11.131",
        state: SecurityBlockState.Expired,
      }),
    ).toContain("has expired");
    expect(
      SECURITY_BLOCK_MESSAGES.notActive({
        value: "35.205.11.131",
        state: SecurityBlockState.Lifted,
      }),
    ).toContain("was lifted");
  });
});

// ---------- Domains, URLs and files, and where a block is enforced (#10346) ----------

const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
const MD5: string = "44d88612fea8a8f36de82e1278abb02f";

function readIndicator(value: string): SecurityBlockIndicatorValue {
  const read: SecurityBlockIndicatorValue | null =
    readSecurityBlockIndicator(value);

  if (!read) {
    throw new Error(`${value} is no value a block takes.`);
  }

  return read;
}

describe("the kinds of value, action and reach a block has", () => {
  test("every kind is listed once, the addresses and the files among them", () => {
    expect(new Set(SECURITY_BLOCK_INDICATOR_TYPES).size).toBe(
      Object.values(SecurityBlockIndicatorType).length,
    );
    expect([...SECURITY_BLOCK_ADDRESS_TYPES]).toEqual([
      SecurityBlockIndicatorType.IpAddress,
      SecurityBlockIndicatorType.IpRange,
    ]);
    expect([...SECURITY_BLOCK_FILE_TYPES]).toEqual([
      SecurityBlockIndicatorType.FileSha256,
      SecurityBlockIndicatorType.FileSha1,
      SecurityBlockIndicatorType.FileMd5,
    ]);
    expect(SECURITY_BLOCK_ACTIONS).toContain(
      SecurityBlockAction.BlockAndQuarantine,
    );
    expect([...SECURITY_BLOCK_REACHES]).toEqual([
      SecurityBlockReach.Edge,
      SecurityBlockReach.Everywhere,
    ]);
  });

  test("each kind is read as one, and nothing else is", () => {
    expect(isSecurityBlockIndicatorType(SecurityBlockIndicatorType.Url)).toBe(
      true,
    );
    expect(isSecurityBlockIndicatorType("Hostname")).toBe(false);
    expect(isSecurityBlockReach(SecurityBlockReach.Everywhere)).toBe(true);
    expect(isSecurityBlockReach("Machines")).toBe(false);
    expect(isSecurityBlockAddressType(SecurityBlockIndicatorType.IpRange)).toBe(
      true,
    );
    expect(isSecurityBlockAddressType(SecurityBlockIndicatorType.Domain)).toBe(
      false,
    );
    expect(isSecurityBlockAddressType(undefined)).toBe(false);
    expect(isSecurityBlockFileType(SecurityBlockIndicatorType.FileMd5)).toBe(
      true,
    );
    expect(isSecurityBlockFileType(SecurityBlockIndicatorType.Url)).toBe(false);
    expect(getSecurityBlockFileType(SecurityBlockHashKind.Md5)).toBe(
      SecurityBlockIndicatorType.FileMd5,
    );
    expect(getSecurityBlockFileType(SecurityBlockHashKind.Sha1)).toBe(
      SecurityBlockIndicatorType.FileSha1,
    );
    expect(getSecurityBlockFileType(SecurityBlockHashKind.Sha256)).toBe(
      SecurityBlockIndicatorType.FileSha256,
    );
  });
});

describe("readSecurityBlockIndicator", () => {
  test("an address or a range first, as readSecurityBlockValue reads it", () => {
    expect(readIndicator("2001:DB8::7")).toEqual(
      readSecurityBlockValue("2001:DB8::7"),
    );
    expect(readIndicator("35.205.11.77/24").value).toBe("35.205.11.0/24");
  });

  test("then a file's hash, a URL and a domain, each written one way", () => {
    expect(readIndicator(MD5.toUpperCase())).toEqual({
      indicatorType: SecurityBlockIndicatorType.FileMd5,
      value: MD5,
    });
    expect(readIndicator(SHA256)).toEqual({
      indicatorType: SecurityBlockIndicatorType.FileSha256,
      value: SHA256,
    });
    expect(readIndicator("HTTPS://Evil.Example/Login#x")).toEqual({
      indicatorType: SecurityBlockIndicatorType.Url,
      value: "https://evil.example/Login",
      domain: "evil.example",
    });
    expect(readIndicator("http://198.51.100.7/x")).toEqual({
      indicatorType: SecurityBlockIndicatorType.Url,
      value: "http://198.51.100.7/x",
      address: "198.51.100.7",
    });
    expect(readIndicator("Evil.Example.")).toEqual({
      indicatorType: SecurityBlockIndicatorType.Domain,
      value: "evil.example",
      domain: "evil.example",
    });
  });

  test("a URL longer than a block holds, and text that is none of them, are not read", () => {
    expect(
      readSecurityBlockIndicator(
        `https://evil.example/${"a".repeat(SECURITY_BLOCK_VALUE_MAX_LENGTH)}`,
      ),
    ).toBeNull();
    expect(readSecurityBlockIndicator("not a value")).toBeNull();
    expect(readSecurityBlockIndicator("   ")).toBeNull();
    expect(readSecurityBlockIndicator(12)).toBeNull();
  });

  test("a value's key is it as blocks write it, or the text folded", () => {
    expect(getSecurityBlockValueKey("Evil.Example.")).toBe("evil.example");
    expect(getSecurityBlockValueKey("2001:0db8:0:0:0:0:0:7")).toBe(
      "2001:db8::7",
    );
    expect(getSecurityBlockValueKey(MD5.toUpperCase())).toBe(MD5);
    expect(getSecurityBlockValueKey("  Not A Value ")).toBe("not a value");
  });
});

describe("where a block is enforced", () => {
  test("an address at the edge unless asked for everywhere; anything else everywhere", () => {
    expect(
      getSecurityBlockReach({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
      }),
    ).toBe(SecurityBlockReach.Edge);
    expect(
      getSecurityBlockReach({
        indicatorType: SecurityBlockIndicatorType.IpRange,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(SecurityBlockReach.Everywhere);
    expect(
      getSecurityBlockReach({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        reach: "Somewhere",
      }),
    ).toBe(SecurityBlockReach.Edge);

    for (const indicatorType of [
      SecurityBlockIndicatorType.Domain,
      SecurityBlockIndicatorType.Url,
      SecurityBlockIndicatorType.FileSha256,
    ]) {
      expect(
        getSecurityBlockReach({
          indicatorType,
          reach: SecurityBlockReach.Edge,
        }),
      ).toBe(SecurityBlockReach.Everywhere);
    }
  });

  test("a block everywhere does what one at the edge would, never the other way round", () => {
    expect(
      doesSecurityBlockReachCover({
        held: SecurityBlockReach.Everywhere,
        wanted: SecurityBlockReach.Edge,
      }),
    ).toBe(true);
    expect(
      doesSecurityBlockReachCover({
        held: SecurityBlockReach.Everywhere,
        wanted: SecurityBlockReach.Everywhere,
      }),
    ).toBe(true);
    expect(
      doesSecurityBlockReachCover({
        held: SecurityBlockReach.Edge,
        wanted: SecurityBlockReach.Edge,
      }),
    ).toBe(true);
    expect(
      doesSecurityBlockReachCover({
        held: SecurityBlockReach.Edge,
        wanted: SecurityBlockReach.Everywhere,
      }),
    ).toBe(false);
    // A block written before reach was kept is at the edge.
    expect(
      doesSecurityBlockReachCover({
        held: undefined,
        wanted: SecurityBlockReach.Everywhere,
      }),
    ).toBe(false);
  });

  test("a challenge is for an address at the edge, quarantine for a file", () => {
    expect(
      getSecurityBlockActionProblem({
        indicatorType: SecurityBlockIndicatorType.Domain,
        action: SecurityBlockAction.Challenge,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.challengeOnlyAddresses);
    expect(
      getSecurityBlockActionProblem({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.Challenge,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.challengeOnlyAtTheEdge);
    expect(
      getSecurityBlockActionProblem({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Edge,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.quarantineOnlyFiles);
    expect(
      getSecurityBlockActionProblem({
        indicatorType: SecurityBlockIndicatorType.Url,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(SECURITY_BLOCK_MESSAGES.quarantineOnlyFiles);

    for (const allowed of [
      {
        indicatorType: SecurityBlockIndicatorType.IpRange,
        action: SecurityBlockAction.Challenge,
        reach: SecurityBlockReach.Edge,
      },
      {
        indicatorType: SecurityBlockIndicatorType.FileSha1,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Everywhere,
      },
      {
        indicatorType: SecurityBlockIndicatorType.Domain,
        action: SecurityBlockAction.Block,
        reach: SecurityBlockReach.Everywhere,
      },
    ]) {
      expect(getSecurityBlockActionProblem(allowed)).toBeNull();
    }
  });

  test("OneUptime could not tell: of an address whether it is the project's own, of anything else whether it is protected", () => {
    expect(getSecurityBlockCheckFailedSentence("35.205.11.131")).toEqual({
      template: SECURITY_BLOCK_SENTENCES.checkFailed,
      values: { value: "35.205.11.131" },
    });
    expect(getSecurityBlockCheckFailedSentence("evil.example")).toEqual({
      template: SECURITY_BLOCK_SENTENCES.checkFailedValue,
      values: { value: "evil.example" },
    });
    expect(SECURITY_BLOCK_MESSAGES.checkFailed({ value: MD5 })).toBe(
      `OneUptime could not check whether ${MD5} is protected, so it did not block it. Try again in a minute.`,
    );
  });
});

describe("findCoveringSecurityBlock, where a block is enforced (#10346)", () => {
  const edge: SecurityBlockCandidate = {
    value: "198.51.100.7",
    reach: SecurityBlockReach.Edge,
  };
  const everywhere: SecurityBlockCandidate = {
    value: "198.51.100.7",
    reach: SecurityBlockReach.Everywhere,
  };

  test("a block everywhere covers an address at the edge", () => {
    expect(
      findCoveringSecurityBlock(
        readIndicator("198.51.100.7"),
        [everywhere],
        SecurityBlockReach.Edge,
      ),
    ).toBe(everywhere);
  });

  test("a block at the edge never covers an address everywhere, a range at the edge neither", () => {
    expect(
      findCoveringSecurityBlock(
        readIndicator("198.51.100.7"),
        [edge, { value: "198.51.100.0/24", reach: SecurityBlockReach.Edge }],
        SecurityBlockReach.Everywhere,
      ),
    ).toBeNull();
    expect(
      findCoveringSecurityBlock(
        readIndicator("198.51.100.7"),
        [edge, everywhere],
        SecurityBlockReach.Everywhere,
      ),
    ).toBe(everywhere);
  });

  test("a block written before reach was kept covers at the edge only", () => {
    const old: SecurityBlockCandidate = { value: "198.51.100.7" };

    expect(
      findCoveringSecurityBlock(readIndicator("198.51.100.7"), [old]),
    ).toBe(old);
    expect(
      findCoveringSecurityBlock(
        readIndicator("198.51.100.7"),
        [old],
        SecurityBlockReach.Everywhere,
      ),
    ).toBeNull();
  });

  test("a domain, a URL or a file is covered by a block of the same value alone", () => {
    const domain: SecurityBlockCandidate = {
      value: "evil.example",
      reach: SecurityBlockReach.Everywhere,
    };
    const file: SecurityBlockCandidate = {
      value: MD5,
      reach: SecurityBlockReach.Everywhere,
    };

    expect(
      findCoveringSecurityBlock(
        readIndicator("Evil.Example."),
        [domain],
        SecurityBlockReach.Everywhere,
      ),
    ).toBe(domain);
    // Whether a block of a domain blocks the names under it is the provider's to say.
    expect(
      findCoveringSecurityBlock(
        readIndicator("www.evil.example"),
        [domain],
        SecurityBlockReach.Everywhere,
      ),
    ).toBeNull();
    expect(
      findCoveringSecurityBlock(
        readIndicator(MD5.toUpperCase()),
        [file, domain],
        SecurityBlockReach.Everywhere,
      ),
    ).toBe(file);
    expect(
      findCoveringSecurityBlock(
        readIndicator("https://evil.example/login"),
        [domain],
        SecurityBlockReach.Everywhere,
      ),
    ).toBeNull();
  });
});
