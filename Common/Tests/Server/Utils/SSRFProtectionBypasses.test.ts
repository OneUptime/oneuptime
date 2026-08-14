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
 * The blocklist in SSRFProtection used to compare SPELLINGS - "::1", a "fe80:"
 * prefix, a dotted-quad regex - and anything containing a colon skipped DNS
 * resolution entirely. Between those two facts, every one of the addresses in
 * "equivalent spellings" below reached the network: "::ffff:169.254.169.254"
 * is the AWS metadata endpoint written as IPv6, and a dual-stack Linux host
 * connects to it happily.
 *
 * These tests are organised by BYPASS CLASS rather than by URL, because the
 * property that matters is that one address has one verdict no matter how it
 * is written. They cover the guard used by workflow API components
 * (GHSA-v5xh-rw9h-77fv), project webhooks, and status page subscriber
 * webhooks (GHSA-gf3v-98g2-qffx).
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
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
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

describe("SSRFProtection — IPv4-mapped and IPv4-embedding IPv6", () => {
  const blocked: Array<[string, string]> = [
    ["AWS metadata, IPv4-mapped", "http://[::ffff:169.254.169.254]/latest/"],
    ["AWS metadata, mapped in hex", "http://[::ffff:a9fe:a9fe]/latest/"],
    ["loopback, IPv4-mapped", "http://[::ffff:127.0.0.1]/"],
    ["loopback, mapped in hex", "http://[::ffff:7f00:1]/"],
    ["RFC-1918, IPv4-mapped", "http://[::ffff:10.0.0.1]/"],
    ["RFC-1918, IPv4-mapped with port", "http://[::ffff:192.168.1.1]:8080/"],
    ["CGNAT, IPv4-mapped", "http://[::ffff:100.64.0.1]/"],
    ["loopback, IPv4-compatible", "http://[::127.0.0.1]/"],
    ["metadata, IPv4-compatible", "http://[::169.254.169.254]/"],
    ["metadata via NAT64 prefix", "http://[64:ff9b::169.254.169.254]/"],
    ["loopback via NAT64 prefix", "http://[64:ff9b::127.0.0.1]/"],
  ];

  test.each(blocked)("blocks %s", async (_label: string, url: string) => {
    expect(await isBlocked(url)).toBe(true);
    // Literals must be decided without a DNS round trip.
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  const allowed: Array<[string, string]> = [
    ["a public address, IPv4-mapped", "http://[::ffff:8.8.8.8]/"],
    ["a public address via NAT64", "http://[64:ff9b::8.8.8.8]/"],
  ];

  test.each(allowed)("allows %s", async (_label: string, url: string) => {
    expect(await isBlocked(url)).toBe(false);
  });
});

describe("SSRFProtection — equivalent spellings of one address", () => {
  const loopbackSpellings: Array<string> = [
    "http://[::1]/",
    "http://[::1]:8080/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[0000:0000:0000:0000:0000:0000:0000:0001]/",
    "http://[0:0:0::1]/",
    "http://[::0001]/",
  ];

  test.each(loopbackSpellings)(
    "blocks IPv6 loopback written as %s",
    async (url: string) => {
      expect(await isBlocked(url)).toBe(true);
    },
  );

  const unspecifiedSpellings: Array<string> = [
    "http://[::]/",
    "http://[::0]/",
    "http://[0:0:0:0:0:0:0:0]/",
    "http://[0000:0000:0000:0000:0000:0000:0000:0000]/",
  ];

  test.each(unspecifiedSpellings)(
    "blocks the unspecified address written as %s",
    async (url: string) => {
      expect(await isBlocked(url)).toBe(true);
    },
  );

  const linkLocalSpellings: Array<string> = [
    "http://[fe80::1]/",
    "http://[fe80:0:0:0:0:0:0:1]/",
    "http://[FE80::1]/",
    "http://[febf::1]/", // top of the fe80::/10 range
    "http://[fe80::1%25eth0]/", // percent-encoded zone id
  ];

  test.each(linkLocalSpellings)(
    "blocks IPv6 link-local written as %s",
    async (url: string) => {
      expect(await isBlocked(url)).toBe(true);
    },
  );
});

describe("SSRFProtection — remaining internal IPv6 ranges", () => {
  const blocked: Array<[string, string]> = [
    ["unique-local fc00::/7 (low)", "http://[fc00::1]/"],
    ["unique-local fc00::/7 (high)", "http://[fdff::1]/"],
    ["unique-local, common ULA", "http://[fd12:3456:789a::1]/"],
    ["site-local fec0::/10", "http://[fec0::1]/"],
    ["multicast all-nodes", "http://[ff02::1]/"],
    ["multicast ff00::/8", "http://[ff00::1]/"],
  ];

  test.each(blocked)("blocks %s", async (_label: string, url: string) => {
    expect(await isBlocked(url)).toBe(true);
  });

  const allowed: Array<[string, string]> = [
    ["Cloudflare public resolver", "http://[2606:4700:4700::1111]/"],
    ["Google public resolver", "http://[2001:4860:4860::8888]/"],
    ["a public 2000::/3 address with a port", "http://[2606:4700::1]:8443/"],
  ];

  test.each(allowed)(
    "allows public IPv6 %s",
    async (_label: string, url: string) => {
      expect(await isBlocked(url)).toBe(false);
    },
  );
});

describe("SSRFProtection — IPv4 ranges", () => {
  const blocked: Array<string> = [
    "http://0.0.0.0/",
    "http://0.1.2.3/",
    "http://127.0.0.1/",
    "http://127.255.255.254/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.254/",
    "http://192.168.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254:80/latest/meta-data/",
    "http://100.64.0.1/",
    "http://100.127.255.254/",
    "http://224.0.0.1/", // multicast
    "http://255.255.255.255/", // broadcast
  ];

  test.each(blocked)("blocks %s", async (url: string) => {
    expect(await isBlocked(url)).toBe(true);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  const allowed: Array<string> = [
    "http://8.8.8.8/",
    "https://1.1.1.1/",
    "http://172.15.255.255/",
    "http://172.32.0.1/",
    "http://100.63.255.255/",
    "http://100.128.0.1/",
    "http://223.255.255.255/",
  ];

  test.each(allowed)("allows %s", async (url: string) => {
    expect(await isBlocked(url)).toBe(false);
  });
});

describe("SSRFProtection — alternate IPv4 notations are decoded, not delegated", () => {
  /*
   * net.isIP rejects all of these, so our own parser does not see a literal.
   * WHATWG does: it decodes decimal, octal, hex and short-form IPv4 per the URL
   * spec, and since the guard checks the host WHATWG names as well as our own,
   * the address is judged directly.
   *
   * This used to be delegated to getaddrinfo instead - "not a literal" meant
   * "send it to DNS and check the answer". That worked only where the platform
   * resolver happened to decode the same notations, and macOS does not decode
   * octal: "http://0177.0.0.1/" resolved to the public 177.0.0.1 and was
   * ALLOWED, while axios connected to 127.0.0.1. Deciding it from the URL is
   * both stricter and the same everywhere.
   */
  const notations: Array<[string, string]> = [
    ["decimal", "http://2852039166/"],
    ["octal", "http://0177.0.0.1/"],
    ["hex", "http://0x7f000001/"],
    ["short form", "http://127.1/"],
  ];

  test.each(notations)(
    "blocks %s notation without asking DNS",
    async (_label: string, url: string) => {
      // A resolver that answers "public" must not be able to rescue these.
      lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      expect(await isBlocked(url)).toBe(true);
      expect(lookupSpy).not.toHaveBeenCalled();
    },
  );
});

describe("SSRFProtection — DNS answers are judged, not just hostnames", () => {
  test("blocks a public name that resolves to the metadata endpoint", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await isBlocked("https://harmless.example.com/hook")).toBe(true);
  });

  test("blocks a public name that resolves to an internal IPv6 address", async () => {
    lookupSpy.mockResolvedValue([{ address: "::1", family: 6 }]);
    expect(await isBlocked("https://harmless.example.com/hook")).toBe(true);
  });

  test("blocks a public name that resolves to an IPv4-mapped internal address", async () => {
    lookupSpy.mockResolvedValue([
      { address: "::ffff:169.254.169.254", family: 6 },
    ]);
    expect(await isBlocked("https://harmless.example.com/hook")).toBe(true);
  });

  test("blocks when only ONE of several answers is internal", async () => {
    lookupSpy.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "8.8.8.8", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ]);
    expect(await isBlocked("https://round-robin.example.com/hook")).toBe(true);
  });

  test("blocks when DNS resolution fails outright", async () => {
    lookupSpy.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isBlocked("https://nope.invalid/hook")).toBe(true);
  });

  test("allows a name whose every answer is public", async () => {
    lookupSpy.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    expect(await isBlocked("https://hooks.example.com/hook")).toBe(false);
  });
});

describe("SSRFProtection — hostname forms of internal targets", () => {
  const blocked: Array<string> = [
    "http://localhost/",
    "http://localhost:3000/",
    "http://localhost./",
    "http://api.localhost/",
    "http://metadata.google.internal/computeMetadata/v1/",
  ];

  test.each(blocked)("blocks %s", async (url: string) => {
    expect(await isBlocked(url)).toBe(true);
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

describe("SSRFProtection — scheme handling", () => {
  /*
   * URL.fromString silently defaults an unrecognized scheme to https, so the
   * scheme has to be read off the raw string or "file:///etc/passwd" arrives
   * at the blocklist already rewritten as the host "file".
   */
  const blockedSchemes: Array<string> = [
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_SET%20x%20y",
    "ftp://internal.example.com/",
    "dict://127.0.0.1:11211/stat",
    "ldap://127.0.0.1:389/",
    "jar://127.0.0.1/",
    "mongodb://8.8.8.8/",
    "ws://8.8.8.8/",
    "wss://8.8.8.8/",
  ];

  test.each(blockedSchemes)("rejects %s", async (url: string) => {
    expect(await isBlocked(url)).toBe(true);
  });

  test("rejects a URL with no host", async () => {
    expect(await isBlocked("http:///no-host")).toBe(true);
  });

  test("rejects a protocol-relative URL", async () => {
    expect(await isBlocked("//evil.example.com/hook")).toBe(true);
  });

  test("still accepts a scheme-less host:port, which is not a scheme", async () => {
    expect(await isBlocked("hooks.example.com:8443/webhook")).toBe(false);
  });

  test.each(["http", "https", "HTTP", "HTTPS"])(
    "accepts the %s scheme",
    async (scheme: string) => {
      expect(await isBlocked(`${scheme}://hooks.example.com/webhook`)).toBe(
        false,
      );
    },
  );
});

describe("SSRFProtection — host extraction helpers", () => {
  test("getBareHostname strips scheme, port, path and query", () => {
    expect(
      SSRFProtection.getBareHostname(
        "https://hooks.slack.com:443/services/x?a=b",
      ),
    ).toBe("hooks.slack.com");
  });

  test("getBareHostname unwraps a bracketed IPv6 literal", () => {
    expect(SSRFProtection.getBareHostname("http://[::1]:8080/x")).toBe("::1");
  });

  /*
   * The allowlist has to parse the host the way axios will. OneUptime's own
   * URL.fromString takes everything before the first "/" as the authority and
   * never stops at "?" or "#", so it read the host of
   * "https://169.254.169.254#.office.com" as "169.254.169.254#.office.com" -
   * which ends with ".office.com" and passed the Teams pin, while the request
   * went to 169.254.169.254. Reachable by unauthenticated status page
   * subscribers.
   */
  const parserDifferentials: Array<[string, string]> = [
    ["fragment", "https://169.254.169.254#.office.com"],
    ["query", "https://169.254.169.254?.office.com"],
    ["fragment after a public host", "https://evil.example.com#.office.com"],
    ["query after a public host", "https://evil.example.com?.office.com"],
    ["fragment with a path", "https://evil.example.com#.office.com/webhook"],
    ["userinfo", "https://outlook.office.com@evil.example.com/webhook"],
  ];

  test.each(parserDifferentials)(
    "isUrlOnAllowedDomain is not fooled by a %s",
    (_label: string, url: string) => {
      expect(SSRFProtection.isUrlOnAllowedDomain(url, ["office.com"])).toBe(
        false,
      );
    },
  );

  test.each(parserDifferentials)(
    "getBareHostname agrees with the WHATWG parser on a %s",
    (_label: string, url: string) => {
      expect(SSRFProtection.getBareHostname(url)).toBe(
        new globalThis.URL(url).hostname.toLowerCase(),
      );
    },
  );

  test("isUrlOnAllowedDomain pins on the host, not on a substring of the URL", () => {
    // The classic break: an attacker-controlled path that contains the domain.
    expect(
      SSRFProtection.isUrlOnAllowedDomain(
        "https://169.254.169.254/?x=hooks.slack.com",
        ["hooks.slack.com"],
      ),
    ).toBe(false);
  });

  test("isUrlOnAllowedDomain anchors suffix matching on a dot", () => {
    expect(
      SSRFProtection.isUrlOnAllowedDomain("https://evil-slack.com/x", [
        "slack.com",
      ]),
    ).toBe(false);
    expect(
      SSRFProtection.isUrlOnAllowedDomain("https://slack.com.evil.tld/x", [
        "slack.com",
      ]),
    ).toBe(false);
    expect(
      SSRFProtection.isUrlOnAllowedDomain("https://hooks.slack.com/x", [
        "slack.com",
      ]),
    ).toBe(true);
  });

  test("isUrlOnAllowedDomain requires https", () => {
    expect(
      SSRFProtection.isUrlOnAllowedDomain("http://hooks.slack.com/x", [
        "slack.com",
      ]),
    ).toBe(false);
  });
});
