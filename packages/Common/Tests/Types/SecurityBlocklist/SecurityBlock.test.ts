import {
  SECURITY_BLOCK_DURATION_IN_MS,
  SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS,
  SECURITY_BLOCK_LARGEST_IPV4_PREFIX,
  SECURITY_BLOCK_LARGEST_IPV6_PREFIX,
  SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS,
  SECURITY_BLOCK_MESSAGES,
  SECURITY_BLOCK_SENTENCES,
  SECURITY_BLOCK_WIDEST_IPV4_PREFIX,
  SECURITY_BLOCK_WIDEST_IPV6_PREFIX,
  SecurityBlockCandidate,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSentence,
  SecurityBlockState,
  SecurityBlockValue,
  describeSecurityBlockLength,
  fillSecurityBlockSentence,
  findCoveringSecurityBlock,
  getSecurityBlockAlreadyBlockedSentence,
  getSecurityBlockExpiry,
  getSecurityBlockExpiryProblem,
  getSecurityBlockValueProblem,
  getSecurityBlockValueSentence,
  isSecurityBlockInForce,
  isWiderThanLargestRange,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
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
  test("an empty value asks for one", () => {
    expect(
      getSecurityBlockValueSentence({ value: "  ", mayBlockWideRanges: false }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.enterAddress, values: {} });
    expect(
      getSecurityBlockValueSentence({ value: 7, mayBlockWideRanges: false }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.enterAddress, values: {} });
  });

  test("a value that is no address or range says how one is written", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "evil.example.com",
        mayBlockWideRanges: true,
      }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.notAnAddress, values: {} });
    expect(
      getSecurityBlockValueSentence({
        value: "1".repeat(101),
        mayBlockWideRanges: true,
      }),
    ).toEqual({ template: SECURITY_BLOCK_SENTENCES.notAnAddress, values: {} });
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
    ).toBe(SECURITY_BLOCK_MESSAGES.enterAddress);
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
    };

    // Each template and the message the server fills it as: a new template needs its message.
    const messages: Record<keyof typeof SECURITY_BLOCK_SENTENCES, string> = {
      enterAddress: SECURITY_BLOCK_MESSAGES.enterAddress,
      notAnAddress: SECURITY_BLOCK_MESSAGES.notAnAddress,
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
