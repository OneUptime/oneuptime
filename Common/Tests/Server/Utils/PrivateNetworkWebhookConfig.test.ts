import PrivateNetworkWebhookConfig, {
  AllowlistPattern,
  ParsedAllowlist,
} from "../../../Server/Utils/PrivateNetworkWebhookConfig";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The instance half of the private-network webhook opt-in (issue #3424).
 *
 * Everything this module answers "true" to becomes reachable from a project
 * that opted in, so the tests below pin both directions: what an operator
 * wrote must match, and a near-miss of what they wrote must NOT. An allowlist
 * that quietly matches more than it says is worse than no allowlist at all —
 * it reads as protection that is not there.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

describe("PrivateNetworkWebhookConfig", () => {
  let originalAllow: string | undefined;
  let originalAllowlist: string | undefined;

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    originalAllowlist = process.env[ALLOWLIST_ENV];
    delete process.env[ALLOW_ENV];
    delete process.env[ALLOWLIST_ENV];
  });

  afterEach(() => {
    if (originalAllow === undefined) {
      delete process.env[ALLOW_ENV];
    } else {
      process.env[ALLOW_ENV] = originalAllow;
    }

    if (originalAllowlist === undefined) {
      delete process.env[ALLOWLIST_ENV];
    } else {
      process.env[ALLOWLIST_ENV] = originalAllowlist;
    }
  });

  describe("isPrivateNetworkAllowed", () => {
    test("is false when the variable is unset", () => {
      expect(PrivateNetworkWebhookConfig.isPrivateNetworkAllowed()).toBe(false);
    });

    test("is true only for the exact string 'true'", () => {
      process.env[ALLOW_ENV] = "true";
      expect(PrivateNetworkWebhookConfig.isPrivateNetworkAllowed()).toBe(true);
    });

    /*
     * Anything else is a typo, and a typo in a security switch must fail
     * closed. "TRUE"/"1"/"yes" all read as "on" to a human writing the .env
     * file, which is exactly why the test names them.
     */
    test.each(["TRUE", "True", "1", "yes", "on", "", " true"])(
      "is false for %p",
      (value: string) => {
        process.env[ALLOW_ENV] = value;
        expect(PrivateNetworkWebhookConfig.isPrivateNetworkAllowed()).toBe(
          false,
        );
      },
    );
  });

  describe("isConfiguredOnInstance", () => {
    test("is false when neither knob is set", () => {
      expect(PrivateNetworkWebhookConfig.isConfiguredOnInstance()).toBe(false);
    });

    test("is true with only the boolean set", () => {
      process.env[ALLOW_ENV] = "true";
      expect(PrivateNetworkWebhookConfig.isConfiguredOnInstance()).toBe(true);
    });

    test("is true with only the allowlist set", () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal";
      expect(PrivateNetworkWebhookConfig.isConfiguredOnInstance()).toBe(true);
    });

    // An allowlist of pure garbage configures nothing, and must not read as if it did.
    test("is false when the allowlist holds no usable entry", () => {
      process.env[ALLOWLIST_ENV] = "!!!, ???";
      expect(PrivateNetworkWebhookConfig.isConfiguredOnInstance()).toBe(false);
    });
  });

  describe("parsing", () => {
    test("accepts commas, spaces and newlines as separators", () => {
      const parsed: ParsedAllowlist =
        PrivateNetworkWebhookConfig.parseAllowlist(
          "a.internal, b.internal\nc.internal   d.internal",
        );

      expect(parsed.invalidEntries).toEqual([]);
      expect(
        parsed.patterns.map((pattern: AllowlistPattern) => {
          return pattern.type === "hostname" ? pattern.hostname : pattern.type;
        }),
      ).toEqual(["a.internal", "b.internal", "c.internal", "d.internal"]);
    });

    test("collects entries it cannot understand", () => {
      const parsed: ParsedAllowlist =
        PrivateNetworkWebhookConfig.parseAllowlist(
          "good.internal, 10.0.0.0/99, ??? , 999.1.1.1/8",
        );

      expect(parsed.invalidEntries).toEqual([
        "10.0.0.0/99",
        "???",
        "999.1.1.1/8",
      ]);
      expect(parsed.patterns).toHaveLength(1);
    });

    test("an empty allowlist parses to nothing", () => {
      expect(PrivateNetworkWebhookConfig.parseAllowlist("").patterns).toEqual(
        [],
      );
      expect(
        PrivateNetworkWebhookConfig.parseAllowlist("  ,  , ").patterns,
      ).toEqual([]);
    });

    test("re-reads the environment when the value changes", () => {
      process.env[ALLOWLIST_ENV] = "first.internal";
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("first.internal"),
      ).toBe(true);

      process.env[ALLOWLIST_ENV] = "second.internal";
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("first.internal"),
      ).toBe(false);
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("second.internal"),
      ).toBe(true);
    });
  });

  describe("hostname entries", () => {
    beforeEach(() => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal, JIRA.Internal";
    });

    test("matches the exact host, case-insensitively", () => {
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("mattermost.internal"),
      ).toBe(true);
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("MATTERMOST.INTERNAL"),
      ).toBe(true);
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("jira.internal"),
      ).toBe(true);
    });

    test("treats a trailing dot as the same name", () => {
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("mattermost.internal."),
      ).toBe(true);
    });

    /*
     * The shapes an attacker reaches for when a suffix check is unanchored.
     * None of them is the host the operator named.
     */
    test.each([
      "notmattermost.internal",
      "mattermost.internal.attacker.tld",
      "mattermost-internal",
      "sub.mattermost.internal",
      "internal",
      "",
    ])("does not match %p", (hostname: string) => {
      expect(PrivateNetworkWebhookConfig.isHostnameAllowed(hostname)).toBe(
        false,
      );
    });
  });

  describe("wildcard entries", () => {
    beforeEach(() => {
      process.env[ALLOWLIST_ENV] = "*.svc.cluster.local";
    });

    test("matches any subdomain of the suffix", () => {
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed(
          "mattermost.svc.cluster.local",
        ),
      ).toBe(true);
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("a.b.svc.cluster.local"),
      ).toBe(true);
    });

    // Anchored on the dot, so a host that merely ends with the letters loses.
    test.each([
      "svc.cluster.local",
      "evilsvc.cluster.local",
      "svc.cluster.local.attacker.tld",
    ])("does not match %p", (hostname: string) => {
      expect(PrivateNetworkWebhookConfig.isHostnameAllowed(hostname)).toBe(
        false,
      );
    });
  });

  describe("forgiving entry normalization", () => {
    /*
     * An operator filling in a .env file will paste the webhook URL, or add
     * the port they connect on. Silently ignoring those entries would surface
     * only as "I allowlisted it and it still fails".
     */
    test.each([
      ["https://mattermost.internal/hooks/abc123", "mattermost.internal"],
      ["mattermost.internal:8065", "mattermost.internal"],
      ["http://user:pw@mattermost.internal:8065/x", "mattermost.internal"],
      ["  MatterMost.Internal.  ", "mattermost.internal"],
    ])("%p allowlists %p", (entry: string, hostname: string) => {
      process.env[ALLOWLIST_ENV] = entry;
      expect(PrivateNetworkWebhookConfig.isHostnameAllowed(hostname)).toBe(
        true,
      );
    });
  });

  describe("IPv4 entries", () => {
    test("a bare address matches only itself", () => {
      process.env[ALLOWLIST_ENV] = "10.20.30.40";

      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.20.30.40")).toBe(
        true,
      );
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.20.30.41")).toBe(
        false,
      );
    });

    test("a CIDR matches its range and nothing outside it", () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";

      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.20.0.0")).toBe(
        true,
      );
      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("10.20.255.255"),
      ).toBe(true);
      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("10.19.255.255"),
      ).toBe(false);
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.21.0.0")).toBe(
        false,
      );
    });

    // A prefix that is not a whole number of bytes is where naive masking breaks.
    test("honours a prefix length that splits a byte", () => {
      process.env[ALLOWLIST_ENV] = "10.0.0.0/12";

      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("10.15.255.255"),
      ).toBe(true);
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.16.0.0")).toBe(
        false,
      );
    });

    test("an IPv4-mapped IPv6 address matches an IPv4 entry", () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";

      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("::ffff:10.20.1.1"),
      ).toBe(true);
      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("::ffff:10.21.1.1"),
      ).toBe(false);
    });

    test("an IPv4 entry never matches an unrelated IPv6 address", () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";

      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd00::1")).toBe(
        false,
      );
    });
  });

  describe("IPv6 entries", () => {
    test("a bare address matches every spelling of itself", () => {
      process.env[ALLOWLIST_ENV] = "fd00::1";

      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd00::1")).toBe(
        true,
      );
      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed(
          "fd00:0000:0000:0000:0000:0000:0000:0001",
        ),
      ).toBe(true);
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("FD00::1")).toBe(
        true,
      );
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd00::2")).toBe(
        false,
      );
    });

    test("a CIDR matches its range", () => {
      process.env[ALLOWLIST_ENV] = "fd12:3456::/32";

      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd12:3456::1")).toBe(
        true,
      );
      expect(
        PrivateNetworkWebhookConfig.isAddressAllowed("fd12:3456:ffff::9"),
      ).toBe(true);
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd12:3457::1")).toBe(
        false,
      );
    });

    test("accepts a bracketed literal, with a port or a prefix", () => {
      process.env[ALLOWLIST_ENV] = "[fd00::1]:8065";
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd00::1")).toBe(
        true,
      );

      process.env[ALLOWLIST_ENV] = "[fd12:3456::]/32";
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd12:3456::9")).toBe(
        true,
      );
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd12:3457::9")).toBe(
        false,
      );
    });

    test("strips a zone id before comparing", () => {
      process.env[ALLOWLIST_ENV] = "fe80::1";
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fe80::1%eth0")).toBe(
        true,
      );
    });
  });

  describe("rejects malformed entries rather than matching loosely", () => {
    test.each([
      "10.0.0.0/33",
      "fd00::/129",
      "999.999.999.999",
      "10.0.0.256",
      "10.0.0.0.0",
      "host..name",
      "-",
      "___",
      "!!!",
    ])("%p allowlists nothing", (entry: string) => {
      process.env[ALLOWLIST_ENV] = entry;

      expect(PrivateNetworkWebhookConfig.getAllowlist().patterns).toEqual([]);
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.0.0.1")).toBe(
        false,
      );
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("fd00::1")).toBe(
        false,
      );
    });

    test("a hostname entry never matches an address lookup", () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal";
      expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.0.0.1")).toBe(
        false,
      );
    });

    test("a CIDR entry never matches a hostname lookup", () => {
      process.env[ALLOWLIST_ENV] = "10.0.0.0/8";
      expect(
        PrivateNetworkWebhookConfig.isHostnameAllowed("mattermost.internal"),
      ).toBe(false);
    });

    /*
     * A "/" followed by digits is read as a CIDR prefix and validated
     * strictly; a "/" followed by anything else is a URL path and dropped.
     * Both land on the safe side — the entry either fails to parse or narrows
     * to the single host — but the distinction is easy to lose in a refactor,
     * so pin it.
     */
    test.each(["10.20.0.0/", "10.20.0.0/abc", "10.20.0.0/hooks/abc"])(
      "%p narrows to that one host rather than a range",
      (entry: string) => {
        process.env[ALLOWLIST_ENV] = entry;

        expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.20.0.0")).toBe(
          true,
        );
        expect(PrivateNetworkWebhookConfig.isAddressAllowed("10.20.0.1")).toBe(
          false,
        );
      },
    );

    /*
     * Whitespace separates entries, so a phrase is several entries, not one
     * malformed one. Named here because "bad host" reads like a single typo.
     */
    test("splits a whitespace-separated phrase into separate entries", () => {
      const parsed: ParsedAllowlist =
        PrivateNetworkWebhookConfig.parseAllowlist("one.internal two.internal");

      expect(parsed.patterns).toHaveLength(2);
      expect(parsed.invalidEntries).toEqual([]);
    });
  });
});
