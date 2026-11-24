import {
  isCloudflareAsnAccessRule,
  toCloudflareAccessRuleConfiguration,
} from "../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SECURITY_BLOCK_SENTENCES,
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockIndicatorValue,
  SecurityBlockReach,
  findCoveringSecurityBlock,
  getSecurityBlockActionProblem,
  getSecurityBlockReach,
  getSecurityBlockValueKey,
  getSecurityBlockValueSentence,
  isSecurityBlockAddressType,
  isSecurityBlockIndicatorType,
  isSecurityBlockNetworkType,
  readSecurityAsnNumber,
  readSecurityBlockAsn,
  readSecurityBlockIndicator,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_BLOCK_SAMPLE_VALUES,
  getSecurityBlockUnheldMessage,
} from "../../../Types/SecurityBlocklist/SecurityBlockHolders";
import { describe, expect, test } from "@jest/globals";

/*
 * A WHOLE NETWORK BY ITS ASN ON THE BLOCKLIST (#10354): written one way
 * ("AS14061"), held at the edge alone, challenged or blocked, a Security
 * Admin's to make, and held at Cloudflare as an IP Access Rule whose target
 * is asn.
 */

describe("reading an ASN", () => {
  test.each([
    ["AS14061", "AS14061"],
    ["as14061", "AS14061"],
    ["  AS 14061  ", "AS14061"],
    ["AS4294967295", "AS4294967295"],
    ["AS014061", "AS14061"],
  ])("%s is %s", (typed: string, kept: string) => {
    expect(readSecurityBlockAsn(typed)).toBe(kept);
  });

  test.each([
    ["14061"],
    ["AS"],
    ["AS0"],
    ["AS4294967296"],
    ["AS-1"],
    ["AS14061x"],
    ["ASN14061"],
    [""],
  ])("%s is no ASN", (typed: string) => {
    expect(readSecurityBlockAsn(typed)).toBeNull();
  });

  test("digits alone, as Cloudflare's events carry an ASN, read as one", () => {
    expect(readSecurityAsnNumber("14061")).toBe("AS14061");
    expect(readSecurityAsnNumber(" 396982 ")).toBe("AS396982");
    expect(readSecurityAsnNumber("0")).toBeNull();
    expect(readSecurityAsnNumber("12a")).toBeNull();
    expect(readSecurityAsnNumber(14061)).toBeNull();
  });

  test("a block's value reads an ASN after an address, and before a domain", () => {
    const read: SecurityBlockIndicatorValue | null =
      readSecurityBlockIndicator("as14061");

    expect(read).toEqual({
      indicatorType: SecurityBlockIndicatorType.Asn,
      value: "AS14061",
    });
    expect(getSecurityBlockValueKey(" as 14061 ")).toBe("AS14061");
    expect(readSecurityBlockIndicator("203.0.113.7")?.indicatorType).toBe(
      SecurityBlockIndicatorType.IpAddress,
    );
  });

  test("an ASN is a kind of value, a network's, and no address", () => {
    expect(isSecurityBlockIndicatorType(SecurityBlockIndicatorType.Asn)).toBe(
      true,
    );
    expect(isSecurityBlockNetworkType(SecurityBlockIndicatorType.Asn)).toBe(
      true,
    );
    expect(isSecurityBlockNetworkType(SecurityBlockIndicatorType.IpRange)).toBe(
      true,
    );
    expect(isSecurityBlockNetworkType(SecurityBlockIndicatorType.Domain)).toBe(
      false,
    );
    expect(isSecurityBlockAddressType(SecurityBlockIndicatorType.Asn)).toBe(
      false,
    );
  });
});

describe("where and how an ASN is blocked", () => {
  test("only at the edge, even when asked for everywhere", () => {
    expect(
      getSecurityBlockReach({
        indicatorType: SecurityBlockIndicatorType.Asn,
        reach: SecurityBlockReach.Everywhere,
      }),
    ).toBe(SecurityBlockReach.Edge);
  });

  test("it can be challenged or blocked, never quarantined", () => {
    for (const action of [
      SecurityBlockAction.Challenge,
      SecurityBlockAction.Block,
    ]) {
      expect(
        getSecurityBlockActionProblem({
          indicatorType: SecurityBlockIndicatorType.Asn,
          action,
          reach: SecurityBlockReach.Edge,
        }),
      ).toBeNull();
    }

    expect(
      getSecurityBlockActionProblem({
        indicatorType: SecurityBlockIndicatorType.Asn,
        action: SecurityBlockAction.BlockAndQuarantine,
        reach: SecurityBlockReach.Edge,
      }),
    ).not.toBeNull();
  });

  test("only someone who may block past the largest range blocks one", () => {
    expect(
      getSecurityBlockValueSentence({
        value: "AS14061",
        mayBlockWideRanges: false,
      }),
    ).toEqual({
      template: SECURITY_BLOCK_SENTENCES.asnTakesAdmin,
      values: { value: "AS14061" },
    });

    expect(
      getSecurityBlockValueSentence({
        value: "AS14061",
        mayBlockWideRanges: true,
      }),
    ).toBeNull();
  });

  test("an ASN is covered by a block of the same ASN alone", () => {
    const value: SecurityBlockIndicatorValue =
      readSecurityBlockIndicator("AS14061")!;

    expect(
      findCoveringSecurityBlock(value, [
        { value: "203.0.113.0/24" },
        { value: "AS64500" },
      ]),
    ).toBeNull();
    expect(
      findCoveringSecurityBlock(value, [{ value: "as14061" }])?.value,
    ).toBe("as14061");
  });

  test("with nothing that holds one connected, a block of an ASN says what to turn on", () => {
    expect(
      getSecurityBlockUnheldMessage({
        indicatorType: SecurityBlockIndicatorType.Asn,
        action: SecurityBlockAction.Challenge,
        reach: SecurityBlockReach.Edge,
      }),
    ).toContain("Cloudflare");
    expect(SECURITY_BLOCK_SAMPLE_VALUES[SecurityBlockIndicatorType.Asn]).toBe(
      "AS64500",
    );
  });
});

describe("an ASN at Cloudflare", () => {
  test("is an IP Access Rule with an asn target", () => {
    expect(toCloudflareAccessRuleConfiguration("as14061")).toEqual({
      target: "asn",
      value: "AS14061",
    });
    expect(isCloudflareAsnAccessRule({ target: "asn" })).toBe(true);
    expect(isCloudflareAsnAccessRule({ target: "ASN" })).toBe(true);
    expect(isCloudflareAsnAccessRule({ target: "ip_range" })).toBe(false);
    expect(isCloudflareAsnAccessRule({})).toBe(false);
  });

  test("addresses and ranges keep their targets", () => {
    expect(toCloudflareAccessRuleConfiguration("203.0.113.7")).toEqual({
      target: "ip",
      value: "203.0.113.7",
    });
    expect(toCloudflareAccessRuleConfiguration("203.0.113.0/24")).toEqual({
      target: "ip_range",
      value: "203.0.113.0/24",
    });
  });
});
