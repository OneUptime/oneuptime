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
 * "http://example.com:pass@169.254.169.254/" is one URL with two readings.
 *
 * OneUptime's Hostname keeps userinfo in the string it stores, on purpose:
 * customers really do put "https://user:token@host/path" in webhook fields and
 * those rows already exist. The guard then read that string and split it on
 * ":" to drop a port — and "example.com:pass@169.254.169.254" holds exactly
 * one colon, so the split answered "example.com". That name resolves publicly,
 * so the blocklist and the DNS re-check both passed, and axios — which parses
 * per RFC 3986 like every other client — connected to 169.254.169.254 with the
 * validated name sitting harmlessly in the Authorization material.
 *
 * The colon is what made it work. "http://example.com@169.254.169.254/" has no
 * colon, took the whole string to DNS, and failed closed. So this was never
 * about credentials being present; it was about the guard and the HTTP client
 * disagreeing over which substring is the host.
 *
 * Two properties are pinned below. First: the host is whatever comes after the
 * last "@", always. Second: when our parser and WHATWG disagree about the host
 * at all, both answers are judged and either one saying "internal" refuses the
 * request — because the next disagreement will not be about userinfo.
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let lookupSpy: LookupSpy;

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  /*
   * Only "example.com" and the hooks subdomain exist. Anything else throwing
   * ENOTFOUND is what production does with a name that does not resolve, and
   * it keeps a test from passing merely because a lookup was mocked away.
   */
  lookupSpy.mockImplementation(
    async (
      hostname: string,
    ): Promise<Array<{ address: string; family: number }>> => {
      if (hostname === "example.com" || hostname === "hooks.example.com") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      throw new Error(`ENOTFOUND ${hostname}`);
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function isBlocked(url: string): Promise<boolean> {
  try {
    await SSRFProtection.validateWebhookTargetIsSafe(url);
    return false;
  } catch {
    return true;
  }
}

describe("SSRFProtection — userinfo cannot stand in for the host", () => {
  /*
   * Every one of these connects to the address after the "@". Most of them
   * were allowed outright before the fix; the last two failed closed for a
   * reason that was never the guard doing its job — the ":80" gave the
   * authority a second colon so the whole unusable string went to DNS, and
   * "user" simply does not resolve on this host. A DNS search domain would
   * have carried that second one straight through.
   */
  const blocked: Array<[string, string]> = [
    [
      "metadata endpoint behind a public-looking username",
      "http://example.com:pass@169.254.169.254/latest/meta-data/",
    ],
    ["loopback behind userinfo", "http://example.com:pass@127.0.0.1/"],
    ["empty password is enough", "http://example.com:@169.254.169.254/"],
    ["a numeric password reads as a port", "http://example.com:80@10.0.0.5/"],
    ["localhost behind userinfo", "http://example.com:pass@localhost/"],
    ["RFC-1918 behind userinfo", "http://example.com:pass@192.168.1.1/"],
    ["CGNAT behind userinfo", "http://example.com:pass@100.64.0.1/"],
    ["unspecified address behind userinfo", "http://example.com:pass@0.0.0.0/"],
    [
      "metadata by name behind userinfo",
      "http://example.com:pass@metadata.google.internal/computeMetadata/v1/",
    ],
    [
      "internal host AND an explicit port",
      "http://example.com:pass@169.254.169.254:80/latest/",
    ],
    ["username only, with the colon in it", "http://user:pass@127.0.0.1/"],
    ["https is no different", "https://example.com:pass@169.254.169.254/"],
  ];

  test.each(blocked)("blocks %s", async (_label: string, url: string) => {
    expect(await isBlocked(url)).toBe(true);
  });

  /*
   * The bug needed a colon inside the userinfo to survive the port split.
   * These spellings failed closed even before the fix; they are here so a
   * future refactor cannot quietly re-open them.
   */
  const colonlessUserInfo: Array<string> = [
    "http://example.com@169.254.169.254/",
    "http://example.com@127.0.0.1/",
    "http://user@10.0.0.1/",
  ];

  test.each(colonlessUserInfo)(
    "blocks %s (no colon in userinfo)",
    async (url: string) => {
      expect(await isBlocked(url)).toBe(true);
    },
  );

  test("the last @ wins, not the first", async () => {
    /*
     * Hostname rejects a second "@" outright (userinfo may not contain one),
     * so this must be refused rather than parsed as host "b@127.0.0.1" or
     * host "a".
     */
    expect(await isBlocked("http://a@b@127.0.0.1/")).toBe(true);
  });

  test("an internal literal is refused without a DNS round trip", async () => {
    expect(await isBlocked("http://example.com:pass@169.254.169.254/")).toBe(
      true,
    );
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("the username is never the thing resolved", async () => {
    /*
     * The tell for the original bug: "example.com" went to DNS and the real
     * host never did. If anything is resolved here it must be the host.
     */
    await isBlocked("http://example.com:pass@internal.invalid/");

    for (const call of lookupSpy.mock.calls) {
      expect(call[0]).not.toBe("example.com");
    }
  });
});

describe("SSRFProtection — userinfo carrying an IPv6 host", () => {
  const blocked: Array<[string, string]> = [
    ["loopback", "http://example.com:pass@[::1]/"],
    [
      "IPv4-mapped metadata",
      "http://example.com:pass@[::ffff:169.254.169.254]/",
    ],
    ["link-local", "http://example.com:pass@[fe80::1]/"],
    ["unique-local", "http://example.com:pass@[fd12:3456:789a::1]/"],
    ["mapped loopback with a port", "http://user:pw@[::ffff:127.0.0.1]:8080/"],
  ];

  test.each(blocked)(
    "blocks %s behind userinfo",
    async (_label: string, url: string) => {
      expect(await isBlocked(url)).toBe(true);
    },
  );

  test("allows a public IPv6 host behind userinfo", async () => {
    expect(await isBlocked("https://user:pw@[2606:4700:4700::1111]/hook")).toBe(
      false,
    );
  });
});

describe("SSRFProtection — real basic-auth webhooks still work", () => {
  /*
   * The fix must not turn into a ban on userinfo. "https://user:token@host/"
   * is a documented way to authenticate a webhook and those URLs are already
   * stored; blocking them would break delivery on read, not just on write.
   */
  const allowed: Array<[string, string]> = [
    [
      "public host with user and password",
      "https://user:token@example.com/hook",
    ],
    ["public host with a username only", "https://user@example.com/hook"],
    ["subdomain with credentials", "https://svc:s3cr3t@hooks.example.com/x"],
    ["credentials plus a port", "https://user:token@example.com:8443/hook"],
    ["an empty password on a public host", "https://user:@example.com/hook"],
  ];

  test.each(allowed)("allows %s", async (_label: string, url: string) => {
    expect(await isBlocked(url)).toBe(false);
  });

  test("the DNS check still applies to the host behind userinfo", async () => {
    // A public-looking host that resolves internally is still refused.
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await isBlocked("https://user:token@example.com/hook")).toBe(true);
  });
});

describe("SSRFProtection — getBareHostname reads past userinfo", () => {
  /*
   * Host-pinning allowlists (Slack, Teams) compare against this. If userinfo
   * could pass for the host, "https://slack.com:x@169.254.169.254/" would
   * satisfy a pin on slack.com and dial the metadata endpoint instead.
   */
  const cases: Array<[string, string]> = [
    ["https://slack.com:x@169.254.169.254/", "169.254.169.254"],
    ["https://user:pass@hooks.example.com/x", "hooks.example.com"],
    ["https://user@example.com:8443/x", "example.com"],
    ["https://user:pass@[::1]/x", "::1"],
    ["https://example.com/x", "example.com"],
  ];

  test.each(cases)(
    "reads the host of %s as %s",
    (url: string, expected: string) => {
      expect(SSRFProtection.getBareHostname(url)).toBe(expected);
    },
  );

  test("an allowlist pin is not satisfied by a username", () => {
    expect(
      SSRFProtection.isUrlOnAllowedDomain(
        "https://slack.com:x@169.254.169.254/api",
        ["slack.com"],
      ),
    ).toBe(false);
  });

  test("an allowlist pin still accepts the real host", () => {
    expect(
      SSRFProtection.isUrlOnAllowedDomain(
        "https://user:t@hooks.slack.com/api",
        ["slack.com"],
      ),
    ).toBe(true);
  });
});

describe("SSRFProtection — both parsers' idea of the host are judged", () => {
  /*
   * Userinfo was one way for OneUptime's parser and WHATWG to disagree about
   * the host. The guard now checks whichever hosts the two of them name, so a
   * disagreement is a refusal rather than a bypass. These assert the property
   * directly, so a differential nobody has found yet still fails closed.
   */
  test("blocks when only WHATWG sees the internal host", async () => {
    /*
     * Our parser answers "example.com" from the userinfo; WHATWG answers
     * 169.254.169.254. One vote for "internal" is enough.
     */
    expect(await isBlocked("http://example.com:pass@169.254.169.254/")).toBe(
      true,
    );
  });

  test("blocks when only our parser sees the internal host", async () => {
    /*
     * The mirror image, and a real disagreement rather than a contrived one:
     * WHATWG treats "\" as an authority terminator for special schemes, so it
     * reads the host as "example.com" and the rest as a path. Ours does not,
     * and reads 169.254.169.254. Neither parser is wrong about its own spec —
     * which is the whole argument for consulting both.
     */
    expect(await isBlocked("http://example.com\\@169.254.169.254/")).toBe(true);
  });

  test("blocks an internal literal that a fragment tries to re-authority", async () => {
    expect(
      await isBlocked("http://[::ffff:169.254.169.254]#@example.com/"),
    ).toBe(true);
  });

  test("resolves the second host too, when neither is a literal", async () => {
    /*
     * The case that pins the DNS half rather than the blocklist half. Both
     * parsers name a NAME here, not an address, so the literal check cannot
     * settle it: WHATWG stops the authority at the backslash and says
     * "a.example", ours reads through to "b.example". Only a.example points
     * somewhere internal, and it is the one WE would not have looked up.
     *
     * Narrow the DNS loop back to a single host and this is the test that
     * goes red.
     */
    lookupSpy.mockImplementation(
      async (
        hostname: string,
      ): Promise<Array<{ address: string; family: number }>> => {
        if (hostname === "a.example") {
          return [{ address: "10.0.0.7", family: 4 }];
        }
        if (hostname === "b.example") {
          return [{ address: "93.184.216.34", family: 4 }];
        }
        throw new Error(`ENOTFOUND ${hostname}`);
      },
    );

    expect(await isBlocked("http://a.example\\@b.example/")).toBe(true);

    const looked: Array<unknown> = lookupSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0];
      },
    );
    expect(looked).toContain("a.example");
    expect(looked).toContain("b.example");
  });

  test("an internal literal in the USERINFO does not condemn a public host", async () => {
    /*
     * The false positive the old split produced, in mirror image: the address
     * is the username and the host is ordinary. Splitting on ":" answered
     * "169.254.169.254" and refused a perfectly good webhook.
     */
    expect(await isBlocked("https://169.254.169.254:x@example.com/hook")).toBe(
      false,
    );
  });

  test("a plain public URL costs no extra DNS lookup", async () => {
    /*
     * The two parsers agree here, so there is exactly one host to resolve.
     * If this starts failing, the agreement check has stopped short-circuiting
     * and every webhook delivery is paying for a second lookup.
     */
    expect(await isBlocked("https://hooks.example.com/hook")).toBe(false);
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });

  test("a public URL with credentials also costs one lookup", async () => {
    expect(await isBlocked("https://user:token@hooks.example.com/hook")).toBe(
      false,
    );
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });
});
