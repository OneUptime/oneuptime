import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * The private-network webhook exception (issue #3424).
 *
 * SSRFProtection refuses every target that resolves into a private, loopback
 * or link-local range. A self-hosted install has a real reason to reach one of
 * those — an internal Mattermost on 10.x — and no reason at all to reach the
 * others, so the blocklist now has two tiers and only the PRIVATE one can be
 * opened.
 *
 * Three independent things all have to be true before anything changes:
 *   1. the caller passes `allowPrivateNetworkTargets` (an authenticated
 *      project context — never a status page subscriber webhook),
 *   2. that project turned the setting on (resolved by the caller), and
 *   3. the instance operator set ALLOW_PRIVATE_NETWORK_WEBHOOKS or named the
 *      host in PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.
 *
 * These tests pin all three, and — most importantly — pin that the FORBIDDEN
 * tier does not move: loopback and the 169.254.169.254 metadata endpoint stay
 * refused with the exception fully switched on.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

const OPTED_IN: { allowPrivateNetworkTargets: boolean } = {
  allowPrivateNetworkTargets: true,
};

describe("SSRFProtection — private network opt-in", () => {
  let lookupSpy: LookupSpy;
  let originalAllow: string | undefined;
  let originalAllowlist: string | undefined;

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    originalAllowlist = process.env[ALLOWLIST_ENV];
    delete process.env[ALLOW_ENV];
    delete process.env[ALLOWLIST_ENV];

    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
    lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();

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

  /*
   * Every private-tier target the exception is FOR. Each one is rejected in
   * the three "not fully opted in" states below and accepted in the one state
   * where all three conditions hold.
   */
  const privateTargets: Array<string> = [
    "http://10.0.0.5/incident",
    "http://172.16.0.1/hook",
    "http://172.31.255.1/hook",
    "http://192.168.1.10:8065/hooks/abc",
    "http://100.64.0.1/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
  ];

  /*
   * Targets that must NEVER become reachable through the boolean, however the
   * instance and the project are configured. The metadata endpoint is the one
   * that turns an SSRF into stolen cloud credentials.
   */
  const forbiddenTargets: Array<string> = [
    "http://127.0.0.1/webhook",
    "http://127.0.0.1:8080/webhook",
    "http://0.0.0.0/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254:80/latest/meta-data/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://255.255.255.255/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
  ];

  describe("with no opt-in at all (the default, and every SaaS install)", () => {
    test.each([...privateTargets, ...forbiddenTargets])(
      "rejects %s",
      async (url: string) => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url),
        ).rejects.toThrow();
      },
    );

    test("still allows public targets", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("https://8.8.8.8/webhook"),
      ).resolves.toBeUndefined();
    });
  });

  describe("caller opted in but the instance configured nothing", () => {
    /*
     * The project flag alone grants nothing. This is the case that keeps a
     * tenant from widening an operator's egress policy on their own.
     */
    test.each(privateTargets)("still rejects %s", async (url: string) => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
      ).rejects.toThrow();
    });
  });

  describe("instance allows private networks but the caller did not opt in", () => {
    beforeEach(() => {
      process.env[ALLOW_ENV] = "true";
    });

    // The instance setting alone grants nothing either — both halves are required.
    test.each(privateTargets)("still rejects %s", async (url: string) => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(url),
      ).rejects.toThrow();
    });
  });

  describe("instance allows private networks and the caller opted in", () => {
    beforeEach(() => {
      process.env[ALLOW_ENV] = "true";
    });

    test.each(privateTargets)("allows %s", async (url: string) => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
      ).resolves.toBeUndefined();
    });

    test.each(forbiddenTargets)(
      "still rejects %s — the forbidden tier does not move",
      async (url: string) => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
        ).rejects.toThrow();
      },
    );

    test("allows a hostname that resolves into a private range", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/hooks/abc",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
      expect(lookupSpy).toHaveBeenCalledWith("mattermost.internal", {
        all: true,
      });
    });

    test("rejects a hostname that resolves to the metadata endpoint", async () => {
      lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://rebind.attacker.example/",
          OPTED_IN,
        ),
      ).rejects.toThrow(/not allowed/i);
    });

    test("rejects a hostname that resolves to loopback", async () => {
      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://rebind.attacker.example/",
          OPTED_IN,
        ),
      ).rejects.toThrow(/not allowed/i);
    });

    /*
     * A multi-record answer must be judged on ALL of it, or a public decoy
     * record next to a forbidden one walks straight through.
     */
    test("rejects when any resolved address is forbidden", async () => {
      lookupSpy.mockResolvedValue([
        { address: "10.1.2.3", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });

    test("accepts a mix of public and private resolved addresses", async () => {
      lookupSpy.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "10.1.2.3", family: 4 },
      ]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
    });

    describe("IPv6 forms that embed an IPv4 target keep their tier", () => {
      test("an IPv4-mapped private address is allowed", async () => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(
            "http://[::ffff:10.0.0.5]/",
            OPTED_IN,
          ),
        ).resolves.toBeUndefined();
      });

      test.each([
        "http://[::ffff:169.254.169.254]/", // IPv4-mapped metadata endpoint
        "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
        "http://[64:ff9b::169.254.169.254]/", // NAT64
        "http://[2002:a9fe:a9fe::1]/", // 6to4 carrying 169.254.169.254
      ])("%s is still refused", async (url: string) => {
        await expect(
          SSRFProtection.validateWebhookTargetIsSafe(url, OPTED_IN),
        ).rejects.toThrow();
      });
    });

    /*
     * The two-parser check exists because OneUptime's URL parser and WHATWG
     * disagree about where the host ends. Opting in must not disable it: the
     * userinfo trick still has to lose.
     */
    test("still refuses a userinfo-smuggled forbidden host", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://example.com:pass@169.254.169.254/latest/meta-data/",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });

    test("still refuses a non-http protocol", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "file:///etc/passwd",
          OPTED_IN,
        ),
      ).rejects.toThrow("http or https");
    });

    test("still refuses a hostname that does not resolve", async () => {
      lookupSpy.mockRejectedValue(new Error("ENOTFOUND"));

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "https://does-not-resolve.invalid/",
          OPTED_IN,
        ),
      ).rejects.toThrow(/could not be resolved/i);
    });
  });

  describe("explicit host allowlist", () => {
    test("a named hostname is trusted without a DNS lookup", async () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal:8065/hooks/abc",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();

      /*
       * The point of naming a host is that it resolves somewhere the
       * blocklist would refuse — so it must not be resolved and re-judged.
       */
      expect(lookupSpy).not.toHaveBeenCalled();
    });

    test("a near-miss of a named hostname is still resolved and judged", async () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal";
      lookupSpy.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://notmattermost.internal/",
          OPTED_IN,
        ),
      ).rejects.toThrow();
      expect(lookupSpy).toHaveBeenCalled();
    });

    test("a named CIDR covers a literal inside it", async () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.20.30.40/hook",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.21.30.40/hook",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });

    test("a named CIDR covers an address DNS resolves to", async () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";
      lookupSpy.mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://jira.corp.example/",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
    });

    /*
     * The allowlist outranks the tiers, deliberately: "host.docker.internal"
     * and a host-networked service on 127.0.0.1 are both real self-hosted
     * targets, and an operator naming one has made an explicit decision that
     * no blanket boolean can express.
     */
    test("a named loopback address is allowed even though the tier forbids it", async () => {
      process.env[ALLOWLIST_ENV] = "127.0.0.1";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://127.0.0.1:9000/hook",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
    });

    test("naming one loopback address does not open the rest of the range", async () => {
      process.env[ALLOWLIST_ENV] = "127.0.0.1";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://127.0.0.2:9000/hook",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });

    /*
     * The status page subscriber path — the one sink whose URL an
     * unauthenticated visitor picks — reaches the guard exactly like this,
     * with no options at all.
     */
    test("the allowlist is ignored entirely when the caller did not opt in", async () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal, 10.20.0.0/16";
      lookupSpy.mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/hooks/abc",
        ),
      ).rejects.toThrow();

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://10.20.30.40/hook"),
      ).rejects.toThrow();
    });

    test("an allowlist without the private boolean opens only what it names", async () => {
      process.env[ALLOWLIST_ENV] = "10.20.0.0/16";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://10.20.30.40/hook",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();

      // A different private address is not covered by the entry.
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://192.168.1.1/hook",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });

    test("a wildcard entry covers its subdomains", async () => {
      process.env[ALLOWLIST_ENV] = "*.svc.cluster.local";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.svc.cluster.local:8065/hooks/abc",
          OPTED_IN,
        ),
      ).resolves.toBeUndefined();
      expect(lookupSpy).not.toHaveBeenCalled();
    });

    /*
     * An allowlisted host still has to survive the two-parser check: the
     * allowlist decides which host is trusted, not which substring is the
     * host.
     */
    test("does not let an allowlisted name in userinfo nominate the host", async () => {
      process.env[ALLOWLIST_ENV] = "mattermost.internal";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal:pass@169.254.169.254/latest/meta-data/",
          OPTED_IN,
        ),
      ).rejects.toThrow();
    });
  });

  /*
   * The same guard runs on the sandboxed axios bridge, which is shared between
   * the workflow Custom JavaScript component (settings on the API server) and
   * the Probe's custom code monitor (settings on the probe — a different
   * machine, often a different owner). A refusal that names the wrong noun or
   * the wrong machine sends an operator to the wrong config file, which is how
   * the bug behind this feature got filed in the first place.
   */
  describe("caller-supplied label and hint", () => {
    test("the label replaces the noun in every refusal", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://127.0.0.1/x", {
          targetLabel: "Request URL",
        }),
      ).rejects.toThrow(
        "Request URL points to a private, loopback, or link-local address and is not allowed.",
      );

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("ftp://example.com/x", {
          targetLabel: "Request URL",
        }),
      ).rejects.toThrow("Request URL must use http or https protocol.");

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http:///no-host", {
          targetLabel: "Request URL",
        }),
      ).rejects.toThrow(/^Request URL /);
    });

    test("the label reaches the DNS-resolution refusals too", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/",
          { targetLabel: "Request URL" },
        ),
      ).rejects.toThrow(/^Request URL resolves to a private network address/);

      lookupSpy.mockRejectedValue(new Error("ENOTFOUND"));

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://nope.invalid/", {
          targetLabel: "Request URL",
        }),
      ).rejects.toThrow("Request URL hostname could not be resolved via DNS.");
    });

    test("the hint replaces the default webhook advice", async () => {
      const probeHint: string =
        " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.";

      const error: Error = await SSRFProtection.validateWebhookTargetIsSafe(
        "http://10.0.0.5/health",
        { targetLabel: "Request URL", privateNetworkHint: probeHint },
      ).then(
        (): Error => {
          throw new Error("Expected the private target to be refused.");
        },
        (err: Error): Error => {
          return err;
        },
      );

      expect(error.message).toContain("PROBE_ALLOW_PRIVATE_NETWORK_MONITORS");
      expect(error.message).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
    });

    test("an empty hint suppresses the advice entirely", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://10.0.0.5/health", {
          privateNetworkHint: "",
        }),
      ).rejects.toThrow(
        "Webhook URL points to a private network address and is not allowed.",
      );
    });

    /*
     * A label is cosmetic. If it could reach the policy, a caller could relabel
     * its way past the blocklist.
     */
    test("neither option changes what is allowed", async () => {
      process.env[ALLOW_ENV] = "true";

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://10.0.0.5/health", {
          targetLabel: "Request URL",
          privateNetworkHint: "anything",
        }),
      ).rejects.toThrow();

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://169.254.169.254/", {
          ...OPTED_IN,
          targetLabel: "Request URL",
          privateNetworkHint: "anything",
        }),
      ).rejects.toThrow();

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://10.0.0.5/health", {
          ...OPTED_IN,
          targetLabel: "Request URL",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("error messages", () => {
    test("a private-tier refusal points at the settings that would allow it", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe("http://10.0.0.5/hook"),
      ).rejects.toThrow(/ALLOW_PRIVATE_NETWORK_WEBHOOKS/);
    });

    test("a forbidden-tier refusal does not suggest a way to allow it", async () => {
      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://169.254.169.254/latest/meta-data/",
        ),
      ).rejects.toThrow(
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      );
    });

    test("a private-tier refusal after DNS also points at the settings", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);

      await expect(
        SSRFProtection.validateWebhookTargetIsSafe(
          "http://mattermost.internal/",
        ),
      ).rejects.toThrow(/ALLOW_PRIVATE_NETWORK_WEBHOOKS/);
    });
  });
});
