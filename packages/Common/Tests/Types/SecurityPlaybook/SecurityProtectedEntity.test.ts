import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  PROTECTED_ENTITY_TYPES,
  findProtectingRule,
  isProtectedEntityType,
  matchesProtectedEntityPattern,
  normalizeProtectedEntityValue,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { describe, expect, test } from "@jest/globals";

/*
 * How a protected entry matches a user or host: the value itself, whatever
 * the case, or a pattern whose `*` stands for any run of characters.
 */

describe("matchesProtectedEntityPattern", () => {
  test("a plain value matches itself, whatever the case or the spaces around it", () => {
    expect(
      matchesProtectedEntityPattern(
        "BreakGlass@Acme.com",
        " breakglass@acme.com ",
      ),
    ).toBe(true);
    expect(
      matchesProtectedEntityPattern(
        "breakglass@acme.com",
        "breakglass@acme.co",
      ),
    ).toBe(false);
    expect(matchesProtectedEntityPattern("vpn-gw-01", "vpn-gw-010")).toBe(
      false,
    );
  });

  test("* stands for any run of characters, at the start, the end or between", () => {
    expect(matchesProtectedEntityPattern("svc-*", "svc-backup")).toBe(true);
    expect(matchesProtectedEntityPattern("svc-*", "svc-")).toBe(true);
    expect(matchesProtectedEntityPattern("svc-*", "my-svc-backup")).toBe(false);
    expect(
      matchesProtectedEntityPattern(
        "*.corp.example.com",
        "DC1.corp.example.com",
      ),
    ).toBe(true);
    expect(
      matchesProtectedEntityPattern(
        "*.corp.example.com",
        "dc1.corp.example.org",
      ),
    ).toBe(false);
    expect(matchesProtectedEntityPattern("dc*-*.corp", "dc01-east.corp")).toBe(
      true,
    );
    expect(matchesProtectedEntityPattern("dc*-*.corp", "dc01.corp")).toBe(
      false,
    );
    expect(matchesProtectedEntityPattern("*", "anything")).toBe(true);
  });

  test("the pieces of a pattern cannot overlap", () => {
    expect(matchesProtectedEntityPattern("ab*ba", "aba")).toBe(false);
    expect(matchesProtectedEntityPattern("ab*ba", "abba")).toBe(true);
  });

  test("an empty pattern or value matches nothing", () => {
    expect(matchesProtectedEntityPattern("", "web-01")).toBe(false);
    expect(matchesProtectedEntityPattern("  ", "web-01")).toBe(false);
    expect(matchesProtectedEntityPattern("*", "")).toBe(false);
  });

  test("reads a long value without a regular expression", () => {
    const value: string = `${"a".repeat(200000)}-gw`;

    expect(matchesProtectedEntityPattern("*a*a*a*-gw", value)).toBe(true);
    expect(matchesProtectedEntityPattern("*a*a*a*-gx", value)).toBe(false);
  });
});

describe("normalizeProtectedEntityValue", () => {
  test("trims, and folds a run of wildcards into one", () => {
    expect(normalizeProtectedEntityValue("  svc-***  ")).toBe("svc-*");
    expect(normalizeProtectedEntityValue(42)).toBe("");
  });
});

describe("findProtectingRule", () => {
  test("matches only a rule of the entity's own kind", () => {
    const rules: Array<{ type: SecurityEntityType; value: string }> = [
      { type: SecurityEntityType.User, value: "vpn-*" },
      { type: SecurityEntityType.Host, value: "VPN-GW-*" },
    ];

    expect(
      findProtectingRule({
        type: SecurityEntityType.Host,
        value: "vpn-gw-01",
        rules,
      }),
    ).toEqual({ type: SecurityEntityType.Host, value: "VPN-GW-*" });
    expect(
      findProtectingRule({
        type: SecurityEntityType.User,
        value: "alice",
        rules,
      }),
    ).toBeUndefined();
  });

  test("protects users and hosts, the kinds containment acts on, and nothing else", () => {
    expect([...PROTECTED_ENTITY_TYPES]).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
    ]);
    expect(isProtectedEntityType(SecurityEntityType.IpAddress)).toBe(false);
    expect(isProtectedEntityType("User")).toBe(true);
  });
});
