import {
  getIncidentFormIpAllowlistEntries,
  validateIncidentFormIpAllowlist,
} from "../../../Types/Incident/IncidentFormIpAllowlist";
import IP from "../../../Types/IP/IP";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An incident form's IP allowlist is checked with IP.isInWhitelist, which
 * matches an IPv4 or IPv6 address and an IPv4 CIDR range - and nothing
 * else. The check fails closed, so an entry it cannot match locks every
 * reporter on that network out without a word to the admin who saved it.
 * validateIncidentFormIpAllowlist refuses such a list when it is written,
 * naming each bad line, and never rewrites a list it accepts.
 */

const HINT: string =
  "Put one IPv4 or IPv6 address, or one IPv4 range such as 10.0.0.0/8, on each line.";

describe("validateIncidentFormIpAllowlist - lists the public routes can match", () => {
  test.each([
    ["no list", undefined],
    ["a cleared list", null],
    ["an empty list", ""],
    ["only blank lines, as a cleared textarea leaves", "\n \r\n\t\n"],
    ["an IPv4 address", "203.0.113.7"],
    ["an IPv4 range", "203.0.113.0/24"],
    ["a single-address range", "203.0.113.7/32"],
    ["the widest range that still means a range", "0.0.0.0/1"],
    ["a prefix written with a leading zero", "10.0.0.0/08"],
    ["a range whose address has host bits set", "10.1.2.3/8"],
    ["an IPv6 address", "2001:db8::1"],
    ["an IPv6 address in capitals", "2001:DB8::1"],
    [
      "an IPv6 address written out in full",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
    ],
    ["an IPv4-mapped IPv6 address", "::ffff:203.0.113.7"],
    [
      "a mix, with Windows line endings, padding and blank lines",
      "10.0.0.0/8\r\n\r\n  203.0.113.7  \n2001:db8::1\n",
    ],
  ])("accepts %s", (_label: string, value: string | null | undefined) => {
    expect(validateIncidentFormIpAllowlist(value)).toBeNull();
  });
});

describe("validateIncidentFormIpAllowlist - lists that could never match", () => {
  test("refuses an IPv6 range, naming the line", () => {
    expect(validateIncidentFormIpAllowlist("203.0.113.7\n2001:db8::/32")).toBe(
      `IP Allowlist: line 2 ("2001:db8::/32") is an IPv6 range, and only IPv4 ranges are supported - list each IPv6 address on a line of its own. ${HINT}`,
    );
  });

  test("refuses a /0 range, which would match only its own address", () => {
    expect(validateIncidentFormIpAllowlist("0.0.0.0/0")).toBe(
      `IP Allowlist: line 1 ("0.0.0.0/0") is a /0 range, which would match only its own address rather than every network - leave the list empty to allow every network. ${HINT}`,
    );
  });

  test.each([
    ["two addresses on one line", "10.0.0.1, 10.0.0.2"],
    ["a word", "not-a-network"],
    ["a host name", "office.example.com"],
    ["a prefix past 32", "203.0.113.0/99"],
    ["a prefix of 33", "203.0.113.0/33"],
    ["a prefix that is not a number", "203.0.113.0/abc"],
    ["a range with no prefix", "203.0.113.0/"],
    ["a range with no address", "/24"],
    ["two prefixes", "10.0.0.0/8/9"],
    ["a space before the prefix", "10.0.0.0 /8"],
    ["an address out of range", "10.0.0.256"],
    ["an address with a port", "203.0.113.7:443"],
    ["a range of IPv4 addresses written as a span", "10.0.0.1-10.0.0.9"],
  ])(
    "refuses %s, naming the line and the entry",
    (_label: string, entry: string) => {
      expect(validateIncidentFormIpAllowlist(`10.0.0.0/8\n${entry}`)).toBe(
        `IP Allowlist: line 2 (${JSON.stringify(entry)}) is not an IP address or an IPv4 range. ${HINT}`,
      );
    },
  );

  test("counts lines as the admin sees them, blank ones included", () => {
    expect(validateIncidentFormIpAllowlist("10.0.0.0/8\n\n\r\nbad")).toContain(
      'line 4 ("bad")',
    );
  });

  test("names the first five bad lines and counts the rest", () => {
    const message: string | null = validateIncidentFormIpAllowlist(
      ["a", "b", "c", "d", "e", "f", "g"].join("\n"),
    );

    expect(message).toBe(
      `IP Allowlist: line 1 ("a") is not an IP address or an IPv4 range; line 2 ("b") is not an IP address or an IPv4 range; line 3 ("c") is not an IP address or an IPv4 range; line 4 ("d") is not an IP address or an IPv4 range; line 5 ("e") is not an IP address or an IPv4 range; and 2 more lines are not valid either. ${HINT}`,
    );
    expect(validateIncidentFormIpAllowlist("a\nb\nc\nd\ne\nf")).toContain(
      "; and 1 more line is not valid either.",
    );
  });

  test("quotes a long entry shortened", () => {
    const message: string | null = validateIncidentFormIpAllowlist(
      "x".repeat(500),
    );

    expect(message).toContain(`("${"x".repeat(80)}...")`);
    expect(message!.length).toBeLessThan(300);
  });

  test.each([[42], [["10.0.0.0/8"]], [{ ip: "10.0.0.1" }], [true]])(
    "refuses %j, which is not text",
    (value: unknown) => {
      expect(validateIncidentFormIpAllowlist(value)).toBe(
        `IP Allowlist must be text. ${HINT}`,
      );
    },
  );

  /*
   * Why these are refused: the matcher the public routes use really cannot
   * match them, so each would lock its own network out.
   */
  test.each([
    ["2001:db8::/32", "2001:db8::1"],
    ["0.0.0.0/0", "203.0.113.7"],
    ["10.0.0.1, 10.0.0.2", "10.0.0.2"],
  ])("%s never lets %s in", (entry: string, address: string) => {
    expect(IP.isInWhitelist({ ip: address, whitelist: [entry] })).toBe(false);
  });
});

describe("getIncidentFormIpAllowlistEntries", () => {
  test("is each line trimmed, with blank lines left out", () => {
    expect(
      getIncidentFormIpAllowlistEntries(
        "  10.0.0.0/8 \r\n\r\n2001:db8::1\n\t\n203.0.113.7",
      ),
    ).toEqual(["10.0.0.0/8", "2001:db8::1", "203.0.113.7"]);
  });

  test.each([[null], [undefined], [""]])(
    "is empty for %p",
    (value: string | null | undefined) => {
      expect(getIncidentFormIpAllowlistEntries(value)).toEqual([]);
    },
  );
});

describe("the module stays pure", () => {
  test("imports only other pure modules of Common", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../Types/Incident/IncidentFormIpAllowlist.ts",
      ),
      "utf8",
    );

    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports).toEqual(["../IP/IP"]);
  });
});
